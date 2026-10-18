use oauth2::{AuthorizationCode, CsrfToken};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::{sleep, timeout, Duration},
};

pub const CALLBACK_PATH: &str = "/oauth/callback";

// An invalid/unrelated request must not complete or cancel a genuine sign-in.
fn callback(request: &str, port: u16, expected: &CsrfToken) -> Option<Result<String, String>> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let target = first.next()?;
    if !target.starts_with("/oauth/callback?") {
        return None;
    }
    if first.next()? != "HTTP/1.1" || first.next().is_some() {
        return None;
    }
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    if hosts != [format!("localhost:{port}")] {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://localhost:{port}{target}")).ok()?;
    if url.path() != CALLBACK_PATH || url.fragment().is_some() {
        return None;
    }
    let fields: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = fields.iter().filter(|(key, _)| key == "state").collect();
    if states.len() != 1 || CsrfToken::new(states[0].1.to_string()) != *expected {
        return None;
    }
    let codes: Vec<_> = fields.iter().filter(|(key, _)| key == "code").collect();
    let errors: Vec<_> = fields.iter().filter(|(key, _)| key == "error").collect();
    if codes.len() == 1 && errors.is_empty() && !codes[0].1.is_empty() {
        Some(Ok(codes[0].1.to_string()))
    } else if codes.is_empty() && errors.len() == 1 {
        Some(Err(
            "Microsoft sign-in was declined or canceled. You can try again.".into(),
        ))
    } else {
        None
    }
}

pub async fn wait_for_code(
    listener: TcpListener,
    state: CsrfToken,
    canceled: &AtomicBool,
) -> Result<AuthorizationCode, String> {
    let port = listener
        .local_addr()
        .map_err(|_| "Could not read the sign-in port")?
        .port();
    timeout(Duration::from_secs(180), async {
        loop {
            if canceled.load(Ordering::SeqCst) { return Err("Sign-in canceled".into()); }
            let (mut stream, peer) = tokio::select! {
                result = listener.accept() => result.map_err(|_| "The local sign-in listener stopped")?,
                _ = sleep(Duration::from_millis(200)) => continue,
            };
            if !peer.ip().is_loopback() { continue; }
            let headers = timeout(Duration::from_secs(3), async {
                let mut bytes = Vec::new();
                let mut chunk = [0; 1024];
                loop {
                    let n = stream.read(&mut chunk).await.ok()?;
                    if n == 0 || bytes.len() + n > 8192 { return None; }
                    bytes.extend_from_slice(&chunk[..n]);
                    if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                        return String::from_utf8(bytes).ok();
                    }
                }
            }).await.ok().flatten();
            let result = headers.as_deref().and_then(|request| callback(request, port, &state));
            let (status, body) = if result.is_some() {
                ("200 OK", "Sign-in received. Return to Mail to finish connecting. You can close this tab.")
            } else { ("400 Bad Request", "This request does not match a Mail sign-in.") };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = timeout(Duration::from_secs(1), stream.write_all(response.as_bytes())).await;
            if let Some(result) = result { return result.map(AuthorizationCode::new); }
        }
    }).await.map_err(|_| "Sign-in timed out. Please try again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(target: &str, host: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n")
    }
    #[test]
    fn callback_requires_exact_state_host_path_and_unambiguous_parameters() {
        let state = CsrfToken::new("random-state".into());
        let valid = "/oauth/callback?state=random-state&code=secret-code";
        assert_eq!(
            callback(&request(valid, "localhost:1234"), 1234, &state)
                .unwrap()
                .unwrap(),
            "secret-code"
        );
        for target in [
            "/oauth/callback?code=x",
            "/oauth/callback?state=wrong&code=x",
            "/other?state=random-state&code=x",
            "/oauth/callback?state=random-state&state=random-state&code=x",
            "/oauth/callback?state=random-state&code=x&code=y",
            "/oauth/callback?state=random-state&code=x&error=denied",
            "/oauth/callback?state=random-state&code=x#fragment",
        ] {
            assert!(callback(&request(target, "localhost:1234"), 1234, &state).is_none());
        }
        assert!(callback(&request(valid, "attacker.example:1234"), 1234, &state).is_none());
        assert!(callback(&request(valid, "localhost:1235"), 1234, &state).is_none());
    }
    #[test]
    fn provider_errors_are_redacted_and_must_match_the_pending_session() {
        let state = CsrfToken::new("random-state".into());
        let result = callback(&request("/oauth/callback?state=random-state&error=access_denied&error_description=private-content", "localhost:1234"), 1234, &state).unwrap().unwrap_err();
        assert!(!result.contains("private-content"));
    }
    #[tokio::test]
    async fn local_listener_ignores_wrong_state_then_accepts_the_genuine_return() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let receiver = tokio::spawn(async move {
            wait_for_code(
                listener,
                CsrfToken::new("expected-state".into()),
                &AtomicBool::new(false),
            )
            .await
        });
        for state in ["wrong-state", "expected-state"] {
            let mut stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                .await
                .unwrap();
            stream
                .write_all(
                    request(
                        &format!("/oauth/callback?state={state}&code=return-code"),
                        &format!("localhost:{port}"),
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with(if state == "wrong-state" {
                "HTTP/1.1 400"
            } else {
                "HTTP/1.1 200"
            }));
            assert!(!response.contains("return-code"));
        }
        assert_eq!(
            timeout(Duration::from_secs(2), receiver)
                .await
                .unwrap()
                .unwrap()
                .unwrap()
                .secret(),
            "return-code"
        );
    }
    #[tokio::test]
    async fn cancel_closes_the_listener_without_waiting_for_the_browser() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        assert!(timeout(
            Duration::from_secs(1),
            wait_for_code(listener, CsrfToken::new_random(), &AtomicBool::new(true))
        )
        .await
        .unwrap()
        .is_err());
    }
}
