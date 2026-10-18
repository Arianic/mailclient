use super::index::MailIndex;
use super::*;
#[derive(Clone)]
pub struct UndoEntry {
    id: String,
    folder: String,
    read: bool,
    expected_folder: String,
    expected_read: bool,
    expires: Instant,
}
#[derive(Serialize)]
pub struct ActionFailure {
    pub id: String,
    pub error: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub ids: Vec<String>,
    pub failures: Vec<ActionFailure>,
    pub undo: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Current {
    id: String,
    parent_folder_id: String,
    is_read: bool,
}
fn message_url(id: &str, action: Option<&str>) -> reqwest::Url {
    let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
    url.path_segments_mut().unwrap().pop_if_empty().push(id);
    if let Some(action) = action {
        url.path_segments_mut().unwrap().push(action);
    }
    url
}
impl OutlookService {
    async fn mutate(
        &self,
        index: &MailIndex,
        account: &str,
        id: &str,
        target: Option<&str>,
        read: Option<bool>,
    ) -> Result<(), String> {
        let token = {
            let mut s = self.session.lock().await;
            let token = self.access(&mut s).await?;
            if !s
                .credential
                .as_ref()
                .is_some_and(|c| c.manage_enabled && c.account.email.eq_ignore_ascii_case(account))
            {
                return Err(
                    "Enable mail actions in Settings → Personal Outlook (Mail.ReadWrite).".into(),
                );
            }
            token
        };
        let response = if let Some(target) = target {
            self.http
                .post(message_url(id, Some("move")))
                .bearer_auth(&token)
                .header("Prefer", "IdType=\"ImmutableId\"")
                .json(&serde_json::json!({"destinationId":target}))
                .send()
                .await
        } else {
            self.http
                .patch(message_url(id, None))
                .bearer_auth(&token)
                .header("Prefer", "IdType=\"ImmutableId\"")
                .json(&serde_json::json!({"isRead":read.ok_or("Choose read or unread")?}))
                .send()
                .await
        };
        let response =
            response.map_err(|_| "The action result is uncertain. Refresh before trying again.")?;
        if !response.status().is_success() {
            if response.status().as_u16() == 401 {
                self.session.lock().await.access = None;
            }
            return Err(
                "Outlook could not apply this action. Refresh to check its current state.".into(),
            );
        }
        let updated: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "The action may have completed. Refresh to check its result.")?;
        let folder = updated["parentFolderId"].as_str().unwrap_or("");
        if index.raw(account, id)?.is_some() {
            index.upsert(account, folder, &[updated.clone()])?;
        }
        if let Ok(summary) = serde_json::from_value::<MessageSummary>(updated) {
            self.session
                .lock()
                .await
                .known_messages
                .insert(summary.id.clone(), summary);
        }
        Ok(())
    }
    pub async fn action(
        &self,
        index: &MailIndex,
        ids: Vec<String>,
        action: String,
        destination: Option<String>,
    ) -> Result<ActionResult, String> {
        if ids.is_empty() || ids.len() > 100 {
            return Err("Select between 1 and 100 messages.".into());
        }
        let account = self.draft_account().await?.to_lowercase();
        let _guard = index.1.lock().await;
        let target = match action.as_str() {
            "archive" => Some("archive".to_string()),
            "delete" => Some("deleteditems".into()),
            "junk" => Some("junkemail".into()),
            "notJunk" => Some("inbox".into()),
            "move" => {
                let folder = destination.ok_or("Choose a destination folder")?;
                if !self.session.lock().await.known_folders.contains(&folder) {
                    return Err("Choose a folder from your mailbox.".into());
                }
                Some(folder)
            }
            "read" | "unread" => None,
            _ => return Err("Unsupported mail action".into()),
        };
        let mut result = ActionResult {
            ids: Vec::new(),
            failures: Vec::new(),
            undo: None,
        };
        let mut undo = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            let operation = async {
                let token = {
                    let mut s = self.session.lock().await;
                    if !s.known_messages.contains_key(&id) && index.raw(&account, &id)?.is_none() {
                        return Err("Refresh before changing this message.".to_string());
                    }
                    self.access(&mut s).await?
                };
                let current: Current = self
                    .get(
                        &format!(
                            "{}?$select=id,parentFolderId,isRead",
                            message_url(&id, None)
                        ),
                        &token,
                    )
                    .await?;
                self.mutate(
                    index,
                    &account,
                    &id,
                    target.as_deref(),
                    Some(action == "read"),
                )
                .await?;
                let expected: Current = self
                    .get(
                        &format!(
                            "{}?$select=id,parentFolderId,isRead",
                            message_url(&current.id, None)
                        ),
                        &token,
                    )
                    .await?;
                Ok::<_, String>(UndoEntry {
                    id: expected.id,
                    folder: current.parent_folder_id,
                    read: current.is_read,
                    expected_folder: expected.parent_folder_id,
                    expected_read: expected.is_read,
                    expires: Instant::now() + Duration::from_secs(600),
                })
            }
            .await;
            match operation {
                Ok(entry) => {
                    result.ids.push(id);
                    undo.push(entry);
                }
                Err(error) => result.failures.push(ActionFailure { id, error }),
            }
        }
        if !undo.is_empty() {
            let key = CsrfToken::new_random().secret().clone();
            let mut s = self.session.lock().await;
            s.undo
                .retain(|_, v| v.first().is_some_and(|u| u.expires > Instant::now()));
            s.undo.insert(key.clone(), undo);
            result.undo = Some(key);
        }
        Ok(result)
    }
    pub async fn undo_action(
        &self,
        index: &MailIndex,
        key: String,
    ) -> Result<ActionResult, String> {
        let account = self.draft_account().await?.to_lowercase();
        let _guard = index.1.lock().await;
        let entries = self
            .session
            .lock()
            .await
            .undo
            .remove(&key)
            .ok_or("This Undo is no longer available.")?;
        let mut result = ActionResult {
            ids: vec![],
            failures: vec![],
            undo: None,
        };
        for e in entries {
            let restore = async {
                if e.expires < Instant::now() {
                    return Err("Undo expired; move the message manually.".to_string());
                }
                let token = {
                    let mut s = self.session.lock().await;
                    self.access(&mut s).await?
                };
                let current: Current = self
                    .get(
                        &format!(
                            "{}?$select=id,parentFolderId,isRead",
                            message_url(&e.id, None)
                        ),
                        &token,
                    )
                    .await?;
                if current.parent_folder_id != e.expected_folder
                    || current.is_read != e.expected_read
                {
                    return Err(
                        "This message changed elsewhere. Refresh before changing it again.".into(),
                    );
                }
                if e.folder != e.expected_folder {
                    self.mutate(index, &account, &e.id, Some(&e.folder), None)
                        .await?;
                }
                if e.read != e.expected_read {
                    self.mutate(index, &account, &e.id, None, Some(e.read))
                        .await?;
                }
                Ok::<_, String>(())
            }
            .await;
            match restore {
                Ok(()) => result.ids.push(e.id),
                Err(error) => result.failures.push(ActionFailure { id: e.id, error }),
            }
        }
        Ok(result)
    }
}
