use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

pub const ATTACHMENT_LIMIT: usize = 20_000_000;
#[derive(Clone, Serialize, Deserialize)]
pub struct DraftAttachment {
    pub id: String,
    pub name: String,
    pub size: usize,
}

pub struct DraftStore(pub(super) Mutex<Connection>);
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
    #[serde(default)]
    pub body_html: Option<String>,
    #[serde(default)]
    pub signature: Option<super::writing::WritingItem>,
    #[serde(default)]
    pub quote: Option<String>,
    #[serde(default)]
    pub writing_initialized: bool,
    pub reply_id: Option<String>,
    pub state: String,
    #[serde(default)]
    pub attachments: Vec<DraftAttachment>,
    #[serde(default)]
    pub notice: Option<String>,
}
impl DraftStore {
    pub(super) fn clear_remote(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute("DELETE FROM draft_remotes WHERE id=?1", [id])
            .map_err(|_| "Could not clear prepared-draft reference")?;
        Ok(())
    }
    pub(super) fn remote(&self, id: &str) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        self.0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .query_row(
                "SELECT remote_id FROM draft_remotes WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Could not read upload draft".into())
    }
    pub(super) fn save_remote(&self, id: &str, remote: &str) -> Result<(), String> {
        self.0.lock().map_err(|_|"Draft storage unavailable")?.execute("INSERT INTO draft_remotes(id,remote_id) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET remote_id=excluded.remote_id",params![id,remote]).map_err(|_|"Could not save upload draft")?;
        Ok(())
    }
    pub(super) fn phase(&self, id: &str, from: &str, to: &str) -> Result<(), String> {
        let changed = self
            .0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "UPDATE drafts SET state=?1 WHERE id=?2 AND state=?3",
                params![to, id, from],
            )
            .map_err(|_| "Could not save send phase")?;
        if changed != 1 {
            return Err("The send phase changed; reopen this draft.".into());
        }
        Ok(())
    }
    pub(super) fn files(&self, id: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
        let c = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let mut query = c
            .prepare("SELECT name,bytes FROM draft_attachments WHERE draft_id=?1 ORDER BY rowid")
            .map_err(|_| "Could not read attachments")?;
        let rows = query
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "Could not read attachments")?;
        rows.map(|r| r.map_err(|_| "Could not read attachment".into()))
            .collect()
    }
    pub fn discard(&self, id: &str) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let tx = c.transaction().map_err(|_| "Could not discard draft")?;
        editable(&tx, id)?;
        tx.execute("DELETE FROM draft_attachments WHERE draft_id=?1", [id])
            .map_err(|_| "Could not discard attachments")?;
        tx.execute("DELETE FROM draft_remotes WHERE id=?1", [id])
            .map_err(|_| "Could not discard upload reference")?;
        tx.execute("DELETE FROM drafts WHERE id=?1 AND state='draft'", [id])
            .map_err(|_| "Could not discard draft")?;
        tx.commit()
            .map_err(|_| "Could not finish discarding draft")?;
        Ok(())
    }
    pub fn set_forward(&self, draft: &Draft) -> Result<(), String> {
        validate(draft)?;
        let previous = self.load(&draft.id)?;
        if previous.account != draft.account || draft.reply_id.is_some() {
            return Err("Invalid forwarding identity".into());
        }
        let c = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        editable(&c, &draft.id)?;
        c.execute(
            "UPDATE drafts SET value=?1 WHERE id=?2 AND state='draft'",
            params![draft_json(draft)?, draft.id],
        )
        .map_err(|_| "Could not prepare forward")?;
        Ok(())
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|_| "Could not open mail drafts")?;
        Self::initialize(connection)
    }
    pub(super) fn initialize(connection: Connection) -> Result<Self, String> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "Could not configure draft storage")?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| "Could not read draft storage version")?;
        if version > 4 {
            return Err("Mail drafts require a newer app version".into());
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN; CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, account TEXT NOT NULL, value TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL DEFAULT(unixepoch())); CREATE TABLE IF NOT EXISTS draft_attachments (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, name TEXT NOT NULL, bytes BLOB NOT NULL); UPDATE drafts SET state='uncertain' WHERE state='sending'; CREATE TABLE IF NOT EXISTS draft_remotes(id TEXT PRIMARY KEY,remote_id TEXT NOT NULL); UPDATE drafts SET state='draft' WHERE state='preparing'; CREATE TABLE IF NOT EXISTS writing_library(account TEXT PRIMARY KEY,value TEXT NOT NULL,revision INTEGER NOT NULL); PRAGMA user_version=4; COMMIT;").map_err(|_| "Could not initialize draft storage")?;
        Ok(Self(Mutex::new(connection)))
    }
    pub fn create(&self, draft: &Draft) -> Result<(), String> {
        validate(draft)?;
        self.0
            .lock()
            .map_err(|_| "Draft storage unavailable")?
            .execute(
                "INSERT INTO drafts(id,account,value,state) VALUES(?1,?2,?3,'draft')",
                params![draft.id, draft.account.to_lowercase(), draft_json(draft)?],
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
        draft.attachments = attachment_metadata(&connection, id)?;
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
            draft.attachments = attachment_metadata(&connection, &draft.id)?;
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
                params![draft_json(draft)?, draft.id],
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
    pub fn add_files(
        &self,
        id: &str,
        files: Vec<(String, Vec<u8>)>,
    ) -> Result<Vec<DraftAttachment>, String> {
        let mut connection = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Could not attach files")?;
        editable(&tx, id)?;
        let (count, size): (i64, i64) = tx.query_row("SELECT COUNT(*),COALESCE(SUM(length(bytes)),0) FROM draft_attachments WHERE draft_id=?1", [id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|_| "Could not inspect attachments")?;
        if count + files.len() as i64 > 20
            || size
                + files
                    .iter()
                    .map(|(_, bytes)| bytes.len() as i64)
                    .sum::<i64>()
                > ATTACHMENT_LIMIT as i64
        {
            return Err("Attachments can total up to 20 MB (20 files).".into());
        }
        for (name, bytes) in files {
            let file_id = oauth2::CsrfToken::new_random().secret().clone();
            tx.execute(
                "INSERT INTO draft_attachments(id,draft_id,name,bytes) VALUES(?1,?2,?3,?4)",
                params![file_id, id, name, bytes],
            )
            .map_err(|_| "Could not save attachment")?;
        }
        tx.commit().map_err(|_| "Could not save attachments")?;
        attachment_metadata(&connection, id)
    }
    pub fn remove_file(
        &self,
        id: &str,
        attachment_id: &str,
    ) -> Result<Vec<DraftAttachment>, String> {
        let mut connection = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Could not remove attachment")?;
        editable(&tx, id)?;
        tx.execute(
            "DELETE FROM draft_attachments WHERE draft_id=?1 AND id=?2",
            params![id, attachment_id],
        )
        .map_err(|_| "Could not remove attachment")?;
        tx.commit().map_err(|_| "Could not remove attachment")?;
        attachment_metadata(&connection, id)
    }
    fn send_attachments(&self, id: &str) -> Result<Vec<serde_json::Value>, String> {
        let connection = self.0.lock().map_err(|_| "Draft storage unavailable")?;
        let mut query = connection
            .prepare("SELECT name,bytes FROM draft_attachments WHERE draft_id=?1 ORDER BY rowid")
            .map_err(|_| "Could not read attachments")?;
        let rows = query
            .query_map([id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|_| "Could not read attachments")?;
        rows.map(|row| { let (name, bytes) = row.map_err(|_| "Could not read attachment")?; Ok(serde_json::json!({"@odata.type":"#microsoft.graph.fileAttachment","name":name,"contentType":"application/octet-stream","contentBytes":STANDARD.encode(bytes)})) }).collect()
    }
}
fn draft_json(draft: &Draft) -> Result<String, String> {
    // Attachment metadata from a webview is never authoritative or persisted.
    let mut saved = super::writing::normalized_draft(draft)?;
    saved.attachments.clear();
    serde_json::to_string(&saved).map_err(|_| "Could not save draft".into())
}
fn editable(connection: &Connection, id: &str) -> Result<(), String> {
    let state: String = connection
        .query_row("SELECT state FROM drafts WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(|_| "Draft was not found")?;
    if state != "draft" {
        return Err("Attachments cannot change while sending or after submission.".into());
    }
    Ok(())
}
fn attachment_metadata(connection: &Connection, id: &str) -> Result<Vec<DraftAttachment>, String> {
    let mut query = connection
        .prepare(
            "SELECT id,name,length(bytes) FROM draft_attachments WHERE draft_id=?1 ORDER BY rowid",
        )
        .map_err(|_| "Could not read attachments")?;
    let rows = query
        .query_map([id], |row| {
            Ok(DraftAttachment {
                id: row.get(0)?,
                name: row.get(1)?,
                size: row.get::<_, i64>(2)? as usize,
            })
        })
        .map_err(|_| "Could not read attachments")?;
    rows.map(|row| row.map_err(|_| "Could not read attachment".into()))
        .collect()
}
fn validate(draft: &Draft) -> Result<(), String> {
    if !crate::valid_draft_id(&draft.id)
        || draft.body.len() > 1_000_000
        || draft
            .body_html
            .as_ref()
            .is_some_and(|h| h.len() > 1_000_000)
        || draft.quote.as_ref().is_some_and(|q| q.len() > 1_000_000)
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
    let message = serde_json::json!({"subject":draft.subject,"body":super::writing::message_body(draft)?,"toRecipients":to,"ccRecipients":cc,"bccRecipients":bcc});
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
    pub async fn discard_local_draft(&self, id: &str, store: &DraftStore) -> Result<(), String> {
        let draft = store.load(id)?;
        if draft.state != "draft" {
            return Err("An uncertain or submitted send record cannot be discarded here. Check Sent Items first.".into());
        }
        if let Some(remote) = store.remote(id)? {
            let token = {
                let mut s = self.session.lock().await;
                self.access(&mut s).await?
            };
            let mut url = reqwest::Url::parse(&format!("{}/me/messages/", super::GRAPH)).unwrap();
            url.path_segments_mut()
                .unwrap()
                .pop_if_empty()
                .push(&remote);
            let raw: serde_json::Value =
                self.get(&format!("{url}?$select=isDraft"), &token).await?;
            if raw["isDraft"] != true {
                return Err("The Outlook copy may already have been sent. Check Sent Items before discarding this record.".into());
            }
            let r = self
                .http
                .delete(url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| {
                    "Could not discard the Outlook upload draft; the local draft was kept."
                })?;
            if r.status().as_u16() != 204 {
                return Err(
                    "Could not discard the Outlook upload draft; the local draft was kept.".into(),
                );
            }
        }
        store.discard(id)
    }
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
            body_html: Some("<p></p>".into()),
            signature: None,
            quote: None,
            writing_initialized: false,
            reply_id: reply_id.clone(),
            state: "draft".into(),
            attachments: Vec::new(),
            notice: None,
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
    pub async fn send_draft(
        &self,
        id: String,
        store: &DraftStore,
        progress: impl Fn(usize, usize) + Send + Sync,
    ) -> Result<String, String> {
        let mut session = self.session.lock().await;
        let token = self.access(&mut session).await?;
        let credential = session
            .credential
            .as_ref()
            .ok_or("Connect Outlook first")?
            .clone();
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
        drop(session);
        // Claim the durable draft first. Concurrent saves cannot change the
        // recipient/body snapshot used for this single network attempt.
        let draft = store.begin_send(&id)?;
        if draft
            .attachments
            .iter()
            .map(|file| file.size)
            .sum::<usize>()
            > 2_000_000
            || store.remote(&id)?.is_some()
        {
            if !credential.manage_enabled {
                store.finish_send(&id, "draft")?;
                return Err("Files over 2 MB need Mail.ReadWrite for Outlook uploads. Enable mail actions in Settings first; your draft is saved.".into());
            }
            return super::delivery::send_large(&self.http, &token, &draft, store, &progress).await;
        }
        let prepared = prepare(&draft).and_then(|(url, mut payload)| {
            let attachments = store.send_attachments(&id)?;
            if !attachments.is_empty() {
                payload["message"]["attachments"] = serde_json::json!(attachments);
            }
            if serde_json::to_vec(&payload)
                .map_err(|_| "Could not prepare email")?
                .len()
                > 3_900_000
            {
                return Err(
                    "This email is too large. Shorten the message or remove an attachment.".into(),
                );
            }
            Ok((url, payload))
        });
        let (url, payload) = match prepared {
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
                    self.session.lock().await.access = None;
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
    #[test]
    fn interrupted_upload_preparation_recovers_as_a_draft_and_discard_removes_files() {
        let path = std::env::temp_dir().join(format!(
            "mail-preparation-{}.sqlite",
            oauth2::CsrfToken::new_random().secret()
        ));
        {
            let store = DraftStore::open(&path).unwrap();
            store.create(&draft()).unwrap();
            store
                .add_files("test-1", vec![("file.txt".into(), vec![1, 2, 3])])
                .unwrap();
            store.begin_send("test-1").unwrap();
            store.phase("test-1", "sending", "preparing").unwrap();
        }
        {
            let store = DraftStore::open(&path).unwrap();
            assert_eq!(store.load("test-1").unwrap().state, "draft");
            store.discard("test-1").unwrap();
            assert!(store.load("test-1").is_err());
            assert!(store.files("test-1").unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }
    fn draft() -> Draft {
        Draft {
            id: "test-1".into(),
            account: "you@example.test".into(),
            to: "friend@example.test".into(),
            cc: "".into(),
            bcc: "".into(),
            subject: "Hello".into(),
            body: "Text".into(),
            body_html: None,
            signature: None,
            quote: None,
            writing_initialized: false,
            reply_id: None,
            state: "draft".into(),
            attachments: Vec::new(),
            notice: None,
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
            store
                .add_files(
                    "test-1",
                    vec![("retained.txt".into(), b"retained".to_vec())],
                )
                .unwrap();
            store.begin_send("test-1").unwrap();
        }
        {
            let store = DraftStore::open(&path).unwrap();
            assert_eq!(store.load("test-1").unwrap().state, "uncertain");
            assert_eq!(store.list("you@example.test").unwrap().len(), 1);
            assert_eq!(
                store.load("test-1").unwrap().attachments[0].name,
                "retained.txt"
            );
            assert_eq!(
                store.send_attachments("test-1").unwrap()[0]["contentBytes"],
                STANDARD.encode(b"retained")
            );
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
    #[test]
    fn attachments_survive_stale_autosaves_and_cannot_change_after_send_claim() {
        let store = DraftStore::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let original = draft();
        store.create(&original).unwrap();
        let files = store
            .add_files(
                &original.id,
                vec![("report.txt".into(), b"hello attachment".to_vec())],
            )
            .unwrap();
        store.save(&original).unwrap();
        assert_eq!(store.load(&original.id).unwrap().attachments.len(), 1);
        let payload = store.send_attachments(&original.id).unwrap();
        assert_eq!(
            STANDARD
                .decode(payload[0]["contentBytes"].as_str().unwrap())
                .unwrap(),
            b"hello attachment"
        );
        assert_eq!(payload[0]["name"], "report.txt");
        let mut other = original.clone();
        other.id = "another-draft".into();
        store.create(&other).unwrap();
        store.remove_file(&other.id, &files[0].id).unwrap();
        assert_eq!(store.load(&original.id).unwrap().attachments.len(), 1);
        store.begin_send(&original.id).unwrap();
        assert!(store.remove_file(&original.id, &files[0].id).is_err());
        assert!(store
            .add_files(&original.id, vec![("extra".into(), vec![1])])
            .is_err());
    }
    #[test]
    fn attachment_limits_are_atomic_and_old_drafts_load_without_attachment_fields() {
        let store = DraftStore::initialize(Connection::open_in_memory().unwrap()).unwrap();
        store.create(&draft()).unwrap();
        assert!(store
            .add_files(
                "test-1",
                vec![
                    ("small".into(), vec![1]),
                    ("too-big".into(), vec![0; ATTACHMENT_LIMIT])
                ]
            )
            .is_err());
        assert!(store.load("test-1").unwrap().attachments.is_empty());
        let mut json = serde_json::to_value(draft()).unwrap();
        json.as_object_mut().unwrap().remove("attachments");
        let old: Draft = serde_json::from_value(json).unwrap();
        assert!(old.attachments.is_empty());
        let files = store
            .add_files("test-1", vec![("small".into(), vec![1])])
            .unwrap();
        store.remove_file("test-1", &files[0].id).unwrap();
        assert!(store.send_attachments("test-1").unwrap().is_empty());
    }
    #[test]
    fn the_same_address_in_to_and_cc_is_preserved_in_both_headers() {
        let mut draft = draft();
        draft.cc = draft.to.clone();
        let (_, payload) = prepare(&draft).unwrap();
        assert_eq!(
            payload["message"]["toRecipients"],
            payload["message"]["ccRecipients"]
        );
    }
}
