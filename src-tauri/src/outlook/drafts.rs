use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

pub struct DraftStore(Mutex<Connection>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub account: String,
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
    pub reply_id: Option<String>,
    pub state: String,
}
impl DraftStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|_| "Could not open mail drafts")?;
        Self::initialize(connection)
    }
    fn initialize(connection: Connection) -> Result<Self, String> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "Could not configure draft storage")?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| "Could not read draft storage version")?;
        if version > 1 {
            return Err("Mail drafts require a newer app version".into());
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN; CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, account TEXT NOT NULL, value TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL DEFAULT(unixepoch())); UPDATE drafts SET state='uncertain' WHERE state='sending'; PRAGMA user_version=1; COMMIT;").map_err(|_| "Could not initialize draft storage")?;
        Ok(Self(Mutex::new(connection)))
    }
    pub fn create(&self, draft: &Draft) -> Result<(), String> {
        validate(draft)?;
        self.0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "INSERT INTO drafts(id,account,value,state) VALUES(?1,?2,?3,'draft')",
                params![
                    draft.id,
                    draft.account.to_lowercase(),
                    serde_json::to_string(draft).map_err(|_| "Could not save draft")?
                ],
            )
            .map_err(|_| "Could not create draft")?;
        Ok(())
    }
    pub fn load(&self, id: &str) -> Result<Draft, String> {
        let connection = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let (value, state): (String, String) = connection
            .query_row("SELECT value,state FROM drafts WHERE id=?1", [id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|_| "Draft was not found")?;
        let mut draft: Draft = serde_json::from_str(&value).map_err(|_| "Could not read draft")?;
        draft.state = state;
        Ok(draft)
    }
    pub fn list(&self, account: &str) -> Result<Vec<Draft>, String> {
        let connection = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let mut query = connection.prepare("SELECT value,state FROM drafts WHERE account=?1 AND state!='accepted' ORDER BY updated DESC").map_err(|_| "Could not list drafts")?;
        let rows = query
            .query_map([account.to_lowercase()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| "Could not list drafts")?;
        rows.map(|row| {
            let (value, state) = row.map_err(|_| "Could not read draft")?;
            let mut draft: Draft =
                serde_json::from_str(&value).map_err(|_| "Could not read draft")?;
            draft.state = state;
            Ok(draft)
        })
        .collect()
    }
    pub fn save(&self, draft: &Draft) -> Result<(), String> {
        validate(draft)?;
        let previous = self.load(&draft.id)?;
        if previous.account != draft.account || previous.reply_id != draft.reply_id {
            return Err("Draft identity cannot be changed".into());
        }
        let changed = self
            .0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "UPDATE drafts SET value=?1,updated=unixepoch() WHERE id=?2 AND state='draft'",
                params![
                    serde_json::to_string(draft).map_err(|_| "Could not save draft")?,
                    draft.id
                ],
            )
            .map_err(|_| "Could not save draft")?;
        if changed != 1 {
            return Err(
                "This message is already being sent or needs its send result checked.".into(),
            );
        }
        Ok(())
    }
    pub fn begin_send(&self, id: &str) -> Result<Draft, String> {
        let changed = self
            .0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "UPDATE drafts SET state='sending' WHERE id=?1 AND state='draft'",
                [id],
            )
            .map_err(|_| "Could not record send operation")?;
        if changed != 1 {
            return Err("This message was already submitted or has an uncertain send result. Check Sent Items before creating a new message.".into());
        }
        self.load(id)
    }
    pub fn finish_send(&self, id: &str, state: &str) -> Result<(), String> {
        if !matches!(state, "accepted" | "uncertain" | "draft") {
            return Err("Invalid send result".into());
        }
        self.0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "UPDATE drafts SET state=?1 WHERE id=?2 AND state='sending'",
                params![state, id],
            )
            .map_err(|_| "Could not record send result; check Sent Items before resending")?;
        Ok(())
    }
}
fn validate(draft: &Draft) -> Result<(), String> {
    if !crate::valid_draft_id(&draft.id)
        || draft.body.len() > 1_000_000
        || draft.subject.len() > 998
        || draft.to.len() + draft.cc.len() + draft.bcc.len() > 20_000
    {
        return Err("Draft is too large or has an invalid identifier".into());
    }
    Ok(())
}
pub fn recipients(value: &str) -> Result<Vec<serde_json::Value>, String> {
    let recipients: Vec<_> = value
        .split([',', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if recipients.len() > 100
        || recipients.iter().any(|address| {
            address.contains(['\r', '\n']) || !email_address::EmailAddress::is_valid(address)
        })
    {
        return Err(
            "Use valid email addresses separated by commas (up to 100 recipients per field)."
                .into(),
        );
    }
    Ok(recipients
        .into_iter()
        .map(|address| serde_json::json!({"emailAddress":{"address":address}}))
        .collect())
}

fn prepare(draft: &Draft) -> Result<(String, serde_json::Value), String> {
    let to = recipients(&draft.to)?;
    let cc = recipients(&draft.cc)?;
    let bcc = recipients(&draft.bcc)?;
    if to.is_empty() || to.len() + cc.len() + bcc.len() > 100 {
        return Err(
            "Add at least one To recipient, with no more than 100 recipients total.".into(),
        );
    }
    let message = serde_json::json!({"subject":draft.subject,"body":{"contentType":"Text","content":draft.body},"toRecipients":to,"ccRecipients":cc,"bccRecipients":bcc});
    let (url, payload) = if let Some(reply_id) = &draft.reply_id {
        let mut url = reqwest::Url::parse(&format!("{}/me/messages/", super::GRAPH)).unwrap();
        url.path_segments_mut()
            .unwrap()
            .pop_if_empty()
            .push(reply_id)
            .push("reply");
        (url.to_string(), serde_json::json!({"message":message}))
    } else {
        (
            format!("{}/me/sendMail", super::GRAPH),
            serde_json::json!({"message":message,"saveToSentItems":true}),
        )
    };
    Ok((url, payload))
}

impl super::OutlookService {
    pub async fn draft_account(&self) -> Result<String, String> {
        let mut session = self.session.lock().await;
        if session.credential.is_none() {
            session.credential = self.read_credential().await?;
        }
        session
            .credential
            .as_ref()
            .map(|credential| credential.account.email.clone())
            .ok_or_else(|| "Connect Outlook before composing mail".into())
    }
    pub async fn create_draft(
        &self,
        id: String,
        reply_id: Option<String>,
        store: &DraftStore,
    ) -> Result<Draft, String> {
        let account = self.draft_account().await?;
        let mut draft = Draft {
            id,
            account,
            to: String::new(),
            cc: String::new(),
            bcc: String::new(),
            subject: String::new(),
            body: String::new(),
            reply_id: reply_id.clone(),
            state: "draft".into(),
        };
        if let Some(reply_id) = reply_id {
            let session = self.session.lock().await;
            let message = session
                .known_messages
                .get(&reply_id)
                .ok_or("Open the inbox message before replying")?;
            let addresses = if message.reply_to.is_empty() {
                message.from.iter().collect::<Vec<_>>()
            } else {
                message.reply_to.iter().collect()
            };
            draft.to = addresses
                .into_iter()
                .filter_map(|sender| sender.email_address.address.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let subject = message.subject.as_deref().unwrap_or("");
            draft.subject = if subject.to_lowercase().starts_with("re:") {
                subject.into()
            } else {
                format!("Re: {subject}")
            };
        }
        store.create(&draft)?;
        Ok(draft)
    }
    pub async fn send_draft(&self, id: String, store: &DraftStore) -> Result<String, String> {
        let mut session = self.session.lock().await;
        let token = self.access(&mut session).await?;
        let credential = session.credential.as_ref().ok_or("Connect Outlook first")?;
        if !credential.send_enabled {
            return Err("Enable sending in Settings and approve Microsoft Mail.Send first.".into());
        }
        let draft = store.load(&id)?;
        if !draft
            .account
            .eq_ignore_ascii_case(&credential.account.email)
        {
            return Err("This draft belongs to another account".into());
        }
        // Claim the durable draft first. Concurrent saves cannot change the
        // recipient/body snapshot used for this single network attempt.
        let draft = store.begin_send(&id)?;
        let (url, payload) = match prepare(&draft) {
            Ok(payload) => payload,
            Err(error) => {
                store.finish_send(&id, "draft")?;
                return Err(error);
            }
        };
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .header("Prefer", "IdType=\"ImmutableId\"")
            .json(&payload)
            .send()
            .await;
        match response {
            Ok(response) if response.status().as_u16() == 202 => {
                store.finish_send(&id, "accepted")?;
                Ok("Submitted to Outlook. Delivery may still be processing.".into())
            }
            Ok(response)
                if matches!(
                    response.status().as_u16(),
                    400 | 401 | 403 | 404 | 413 | 429
                ) =>
            {
                store.finish_send(&id, "draft")?;
                if response.status().as_u16() == 401 {
                    session.access = None;
                }
                Err("Outlook rejected this send. Your draft is saved. Check recipients, sending permission or connection before trying again.".into())
            }
            _ => {
                store.finish_send(&id, "uncertain")?;
                Err("Send result is uncertain. Check Outlook Sent Items before creating another message; this draft will not be resent automatically.".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> Draft {
        Draft {
            id: "test-1".into(),
            account: "you@example.test".into(),
            to: "friend@example.test".into(),
            cc: "".into(),
            bcc: "".into(),
            subject: "Hello".into(),
            body: "Text".into(),
            reply_id: None,
            state: "draft".into(),
        }
    }
    #[test]
    fn send_cannot_be_replayed_and_identity_cannot_be_rewritten() {
        let store = DraftStore::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let mut draft = draft();
        store.create(&draft).unwrap();
        draft.account = "someone@example.test".into();
        assert!(store.save(&draft).is_err());
        store.begin_send("test-1").unwrap();
        assert!(store.begin_send("test-1").is_err());
        store.finish_send("test-1", "uncertain").unwrap();
        assert!(store.begin_send("test-1").is_err());
        assert_eq!(store.load("test-1").unwrap().state, "uncertain");
    }
    #[test]
    fn interrupted_sends_reopen_as_uncertain_and_drafts_survive() {
        let path = std::env::temp_dir().join(format!(
            "outlook-drafts-{}.sqlite",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = DraftStore::open(&path).unwrap();
            store.create(&draft()).unwrap();
            store.begin_send("test-1").unwrap();
        }
        {
            let store = DraftStore::open(&path).unwrap();
            assert_eq!(store.load("test-1").unwrap().state, "uncertain");
            assert_eq!(store.list("you@example.test").unwrap().len(), 1);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn validates_recipients_and_disallows_header_injection() {
        assert_eq!(
            recipients("one@example.test; two@example.test")
                .unwrap()
                .len(),
            2
        );
        assert!(recipients("bad address").is_err());
        assert!(recipients("one@example.test\r\nBcc:other@example.test").is_err());
    }
    #[test]
    fn outgoing_payload_uses_the_claimed_identity_recipients_and_reply_target() {
        let mut draft = draft();
        draft.cc = "copy@example.test".into();
        draft.bcc = "private@example.test".into();
        let (url, payload) = prepare(&draft).unwrap();
        assert_eq!(url, "https://graph.microsoft.com/v1.0/me/sendMail");
        assert_eq!(
            payload["message"]["toRecipients"][0]["emailAddress"]["address"],
            "friend@example.test"
        );
        assert_eq!(payload["message"]["body"]["content"], "Text");
        assert!(payload["message"].get("from").is_none());
        draft.reply_id = Some("message/with+symbols=".into());
        let (url, _) = prepare(&draft).unwrap();
        assert!(url.ends_with("message%2Fwith+symbols=/reply"));
        draft.to.clear();
        assert!(prepare(&draft).is_err());
    }
}
