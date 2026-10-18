mod auth;
mod vault;

use oauth2::{
    basic::{BasicClient, BasicTokenResponse},
    AuthUrl, ClientId, CsrfToken, PkceCodeChallenge, RedirectUrl, RefreshToken, Scope,
    TokenResponse, TokenUrl,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{net::TcpListener, sync::Mutex};
use vault::{KeyringVault, Vault};

const AUTH_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const SESSION_EXPIRED: &str =
    "Outlook sign-in expired. Refresh to renew it, or reconnect in Settings.";
const SCOPES: [&str; 3] = [
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.Read",
];

// Only a consumers-authority personal account is supported. No configurable
// authority, endpoint, arbitrary fetch URL, token export or cloud AI route.
pub struct OutlookService {
    http: reqwest::Client,
    vault: Arc<dyn Vault>,
    session: Mutex<Session>,
    canceled: AtomicBool,
}
#[derive(Default)]
struct Session {
    credential: Option<Credential>,
    access: Option<(String, Instant)>,
    known_messages: HashSet<String>,
}
// Deliberately no Debug: tokens must not appear in diagnostics.
#[derive(Clone, Serialize, Deserialize)]
struct Credential {
    client_id: String,
    refresh_token: String,
    account: Account,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub display_name: String,
    pub email: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub account: Option<Account>,
    pub client_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphProfile {
    display_name: Option<String>,
    mail: Option<String>,
    user_principal_name: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: Option<String>,
    pub address: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sender {
    pub email_address: Address,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub subject: Option<String>,
    pub from: Option<Sender>,
    pub received_date_time: String,
    pub is_read: bool,
    pub has_attachments: bool,
}
#[derive(Deserialize)]
struct GraphInbox {
    value: Vec<MessageSummary>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub messages: Vec<MessageSummary>,
    pub has_more: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub content_type: String,
    pub content: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub body: Body,
}

fn valid_client_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
fn client(
    client_id: &str,
) -> BasicClient<
    oauth2::EndpointSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointSet,
> {
    BasicClient::new(ClientId::new(client_id.into()))
        .set_auth_uri(AuthUrl::new(AUTH_URL.into()).expect("fixed Microsoft authorization URL"))
        .set_token_uri(TokenUrl::new(TOKEN_URL.into()).expect("fixed Microsoft token URL"))
}
fn access_from(token: &BasicTokenResponse) -> Result<(String, Instant), String> {
    if token.access_token().secret().is_empty() {
        return Err("Microsoft did not return an access token".into());
    }
    let lifetime = token
        .expires_in()
        .unwrap_or(Duration::from_secs(300))
        .min(Duration::from_secs(86400));
    Ok((
        token.access_token().secret().clone(),
        Instant::now() + lifetime.saturating_sub(Duration::from_secs(60)),
    ))
}

impl OutlookService {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            http: reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| "Could not initialize secure Outlook networking")?,
            vault: Arc::new(KeyringVault),
            session: Mutex::new(Session::default()),
            canceled: AtomicBool::new(false),
        })
    }
    async fn read_credential(&self) -> Result<Option<Credential>, String> {
        let vault = self.vault.clone();
        let raw = tokio::task::spawn_blocking(move || vault.read())
            .await
            .map_err(|_| "Could not access GNOME Keyring")??;
        raw.map(|value| {
            let credential: Credential = serde_json::from_str(&value).map_err(|_| {
                "The saved Outlook sign-in is invalid. Disconnect and sign in again."
            })?;
            if !valid_client_id(&credential.client_id) || credential.refresh_token.is_empty() {
                return Err(
                    "The saved Outlook sign-in is invalid. Disconnect and sign in again.".into(),
                );
            }
            Ok(credential)
        })
        .transpose()
    }
    async fn write_credential(&self, credential: &Credential) -> Result<(), String> {
        let raw = serde_json::to_string(credential)
            .map_err(|_| "Could not prepare secure Outlook storage")?;
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.write(&raw))
            .await
            .map_err(|_| "Could not access GNOME Keyring")?
    }
    async fn delete_credential(&self) -> Result<(), String> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.delete())
            .await
            .map_err(|_| "Could not access GNOME Keyring")?
    }
    pub async fn status(&self) -> Result<Status, String> {
        let mut session = self
            .session
            .try_lock()
            .map_err(|_| "An Outlook operation is already running")?;
        if session.credential.is_none() {
            session.credential = self.read_credential().await?;
        }
        Ok(Status {
            account: session
                .credential
                .as_ref()
                .map(|value| value.account.clone()),
            client_id: session
                .credential
                .as_ref()
                .map(|value| value.client_id.clone()),
        })
    }
    pub fn cancel(&self) {
        self.canceled.store(true, Ordering::SeqCst);
    }
    pub async fn connect(
        &self,
        client_id: String,
        open_browser: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<Status, String> {
        let client_id = client_id.trim().to_string();
        if !valid_client_id(&client_id) {
            return Err(
                "Enter the Application (client) ID from your Microsoft app registration.".into(),
            );
        }
        let mut session = self
            .session
            .try_lock()
            .map_err(|_| "An Outlook operation is already running")?;
        self.canceled.store(false, Ordering::SeqCst);
        if session.credential.is_some() || self.read_credential().await?.is_some() {
            return Err("Disconnect the current Outlook account before adding another.".into());
        }
        if self.canceled.load(Ordering::SeqCst) {
            return Err("Sign-in canceled".into());
        }
        // Bind before opening the browser, and expose the listener only on loopback.
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "Could not open a local port for Microsoft sign-in")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not read the sign-in port")?
            .port();
        let oauth = client(&client_id).set_redirect_uri(
            RedirectUrl::new(format!("http://localhost:{port}{}", auth::CALLBACK_PATH))
                .map_err(|_| "Could not prepare the sign-in return address")?,
        );
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, state) = oauth
            .authorize_url(CsrfToken::new_random)
            .add_scopes(SCOPES.map(|scope| Scope::new(scope.into())))
            .add_extra_param("prompt", "select_account")
            .set_pkce_challenge(challenge)
            .url();
        open_browser(url.as_str())?;
        let code = auth::wait_for_code(listener, state, &self.canceled).await?;
        let token = oauth.exchange_code(code).set_pkce_verifier(verifier).request_async(&self.http).await
            .map_err(|_| "Microsoft could not finish sign-in. Check the app registration, connection and consent, then try again.")?;
        if self.canceled.load(Ordering::SeqCst) {
            return Err("Sign-in canceled".into());
        }
        let access = access_from(&token)?;
        let profile: GraphProfile = self
            .get(
                &format!("{GRAPH}/me?$select=displayName,mail,userPrincipalName"),
                &access.0,
            )
            .await?;
        let account = Account {
            email: profile
                .mail
                .or(profile.user_principal_name)
                .filter(|value| !value.is_empty())
                .ok_or("Microsoft did not return an account address")?,
            display_name: profile.display_name.unwrap_or_else(|| "Outlook".into()),
        };
        let credential = Credential { client_id: client_id.clone(), account: account.clone(),
            refresh_token: token.refresh_token().map(|value| value.secret().clone()).filter(|value| !value.is_empty()).ok_or("Microsoft did not allow staying signed in. Reconnect and allow offline access.")? };
        if self.canceled.load(Ordering::SeqCst) {
            return Err("Sign-in canceled".into());
        }
        // Never claim a connected session unless its credentials were saved securely.
        self.write_credential(&credential).await?;
        if self.canceled.load(Ordering::SeqCst) {
            self.delete_credential().await?;
            return Err("Sign-in canceled".into());
        }
        session.credential = Some(credential);
        session.access = Some(access);
        Ok(Status {
            account: Some(account),
            client_id: Some(client_id),
        })
    }
    async fn access(&self, session: &mut Session) -> Result<String, String> {
        if let Some((token, until)) = &session.access {
            if *until > Instant::now() {
                return Ok(token.clone());
            }
        }
        if session.credential.is_none() {
            session.credential = self.read_credential().await?;
        }
        let credential = session
            .credential
            .clone()
            .ok_or("Connect your personal Outlook account in Settings first.")?;
        let token = client(&credential.client_id).exchange_refresh_token(&RefreshToken::new(credential.refresh_token.clone()))
            .request_async(&self.http).await.map_err(|_| "Outlook could not renew sign-in. Check your connection; if it persists, disconnect and sign in again.")?;
        self.install_refreshed_token(session, credential, token)
            .await
    }
    async fn install_refreshed_token(
        &self,
        session: &mut Session,
        mut credential: Credential,
        token: BasicTokenResponse,
    ) -> Result<String, String> {
        session.access = None;
        let access = access_from(&token)?;
        if let Some(refresh) = token.refresh_token() {
            if refresh.secret().is_empty() {
                return Err(
                    "Microsoft returned an invalid renewed sign-in. Please reconnect.".into(),
                );
            }
            credential.refresh_token = refresh.secret().clone();
            self.write_credential(&credential).await?;
        }
        session.credential = Some(credential);
        session.access = Some(access.clone());
        Ok(access.0)
    }
    async fn get<T: DeserializeOwned>(&self, url: &str, token: &str) -> Result<T, String> {
        let mut response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header(
                "Prefer",
                "IdType=\"ImmutableId\", outlook.body-content-type=\"html\"",
            )
            .send()
            .await
            .map_err(|_| "Could not reach Outlook. Check your connection and try again.")?;
        match response.status().as_u16() {
            200 => (),
            401 => return Err(SESSION_EXPIRED.into()),
            403 => {
                return Err(
                    "Microsoft did not allow mail access. Check Mail.Read consent for this app."
                        .into(),
                )
            }
            429 => return Err("Outlook is busy. Wait a little before refreshing again.".into()),
            _ => {
                return Err(
                    "Outlook could not complete this request. Please try again later.".into(),
                )
            }
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "The Outlook response was interrupted")?
        {
            if bytes.len() + chunk.len() > 8_000_000 {
                return Err("This Outlook response is too large for the initial reader.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "Outlook returned an unsupported response. No message was changed.".into())
    }
    pub async fn inbox(&self) -> Result<Inbox, String> {
        let mut session = self
            .session
            .try_lock()
            .map_err(|_| "An Outlook operation is already running")?;
        let token = self.access(&mut session).await?;
        let response: Result<GraphInbox, _> = self.get(&format!("{GRAPH}/me/mailFolders/inbox/messages?$top=25&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,isRead,hasAttachments"), &token).await;
        // A 401 may arrive before the advertised token expiry; allow the next
        // explicit retry to refresh, without replaying arbitrary mail operations.
        if matches!(&response, Err(message) if message == SESSION_EXPIRED) {
            session.access = None;
        }
        let response = response?;
        session.known_messages = response
            .value
            .iter()
            .map(|message| message.id.clone())
            .collect();
        Ok(Inbox {
            messages: response.value,
            has_more: response.next_link.is_some(),
        })
    }
    pub async fn message(&self, id: String) -> Result<Message, String> {
        let mut session = self
            .session
            .try_lock()
            .map_err(|_| "An Outlook operation is already running")?;
        if id.is_empty() || id.len() > 2048 || !session.known_messages.contains(&id) {
            return Err("Refresh your Outlook inbox before opening this message.".into());
        }
        let token = self.access(&mut session).await?;
        let mut url =
            reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).expect("fixed Graph URL");
        url.path_segments_mut()
            .map_err(|_| "Could not prepare the message address")?
            .pop_if_empty()
            .push(&id);
        url.query_pairs_mut().append_pair("$select", "id,body");
        let result: Result<Message, String> = self.get(url.as_str(), &token).await;
        if matches!(&result, Err(message) if message == SESSION_EXPIRED) {
            session.access = None;
        }
        let message = result?;
        if message.id != id {
            return Err(
                "Outlook returned a different message. Refresh the inbox and try again.".into(),
            );
        }
        Ok(message)
    }
    pub async fn disconnect(&self) -> Result<(), String> {
        self.cancel();
        let mut session = self
            .session
            .try_lock()
            .map_err(|_| "Wait for the current Outlook operation to finish, then disconnect.")?;
        // Clear memory even if keyring removal fails; report the failure so the
        // user knows automatic reconnection is still possible until removal works.
        *session = Session::default();
        self.delete_credential().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    #[derive(Default)]
    struct MemoryVault {
        value: StdMutex<Option<String>>,
        fail_write: bool,
    }
    impl Vault for MemoryVault {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.value.lock().unwrap().clone())
        }
        fn write(&self, value: &str) -> Result<(), String> {
            if self.fail_write {
                return Err("keyring locked".into());
            }
            *self.value.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }
    fn credential() -> Credential {
        Credential {
            client_id: "11111111-2222-3333-4444-555555555555".into(),
            refresh_token: "refresh-secret".into(),
            account: Account {
                email: "you@outlook.example".into(),
                display_name: "Example".into(),
            },
        }
    }
    #[test]
    fn application_id_cannot_inject_authorization_parameters() {
        assert!(valid_client_id(&credential().client_id));
        for value in [
            "",
            "https://evil.example",
            "client&scope=Mail.Send",
            "11111111-2222-3333-4444-55555555555z",
        ] {
            assert!(!valid_client_id(value));
        }
        let oauth = client(&credential().client_id);
        let (challenge, _) = PkceCodeChallenge::new_random_sha256();
        let (url, _) = oauth
            .authorize_url(CsrfToken::new_random)
            .set_pkce_challenge(challenge)
            .add_scopes(SCOPES.map(|value| Scope::new(value.into())))
            .url();
        assert_eq!(url.host_str(), Some("login.microsoftonline.com"));
        assert!(url.path().starts_with("/consumers/"));
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "code_challenge_method" && value == "S256"));
        assert!(!url.as_str().contains("Mail.Send"));
        assert!(!url.as_str().contains("Mail.ReadWrite"));
    }
    #[tokio::test]
    async fn public_status_never_exposes_tokens_and_disconnect_removes_credentials() {
        let mut service = OutlookService::new().unwrap();
        let vault = Arc::new(MemoryVault::default());
        service.vault = vault.clone();
        service.write_credential(&credential()).await.unwrap();
        let status = serde_json::to_string(&service.status().await.unwrap()).unwrap();
        assert!(status.contains("you@outlook.example"));
        assert!(!status.contains("refresh-secret"));
        assert!(!status.contains("refresh_token"));
        service.disconnect().await.unwrap();
        assert!(vault.read().unwrap().is_none());
        assert!(service.status().await.unwrap().account.is_none());
    }
    #[tokio::test]
    async fn secure_storage_failure_and_unknown_message_ids_fail_closed() {
        let mut service = OutlookService::new().unwrap();
        service.vault = Arc::new(MemoryVault {
            fail_write: true,
            ..Default::default()
        });
        assert!(service.write_credential(&credential()).await.is_err());
        assert!(service.status().await.unwrap().account.is_none());
        assert!(service
            .message("https://attacker.example/steal".into())
            .await
            .is_err());
    }
    fn renewed_token() -> BasicTokenResponse {
        serde_json::from_value(serde_json::json!({"access_token":"new-access-secret", "refresh_token":"new-refresh-secret", "token_type":"Bearer", "expires_in":3600})).unwrap()
    }
    #[tokio::test]
    async fn rotates_refresh_tokens_in_keyring_before_exposing_the_renewed_session() {
        let mut service = OutlookService::new().unwrap();
        let vault = Arc::new(MemoryVault::default());
        service.vault = vault.clone();
        let mut session = Session::default();
        service
            .install_refreshed_token(&mut session, credential(), renewed_token())
            .await
            .unwrap();
        let saved: Credential = serde_json::from_str(&vault.read().unwrap().unwrap()).unwrap();
        assert_eq!(saved.refresh_token, "new-refresh-secret");
        assert!(!vault.read().unwrap().unwrap().contains("new-access-secret"));
        assert_eq!(session.access.as_ref().unwrap().0, "new-access-secret");
    }
    #[tokio::test]
    async fn failed_rotation_does_not_install_an_unsaved_token() {
        let mut service = OutlookService::new().unwrap();
        service.vault = Arc::new(MemoryVault {
            fail_write: true,
            ..Default::default()
        });
        let mut session = Session {
            credential: Some(credential()),
            ..Default::default()
        };
        assert!(service
            .install_refreshed_token(&mut session, credential(), renewed_token())
            .await
            .is_err());
        assert!(session.access.is_none());
        assert_eq!(session.credential.unwrap().refresh_token, "refresh-secret");
    }
}
