use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub display_name: String,
    pub unread_item_count: u32,
    #[serde(default)]
    pub total_item_count: Option<u64>,
    pub child_folder_count: u32,
    #[serde(default)]
    pub is_inbox: bool,
}
#[derive(Deserialize)]
struct FolderPage {
    value: Vec<Folder>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}
fn folder_page(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid folder page")?;
    if url.scheme() != "https"
        || url.host_str() != Some("graph.microsoft.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/v1.0/me/mailFolders")
        || !(url.path().ends_with("/mailFolders") || url.path().ends_with("/childFolders"))
    {
        return Err("Outlook returned an unsupported folder page".into());
    }
    Ok(url.to_string())
}
impl OutlookService {
    pub async fn folders(&self, parent: Option<String>) -> Result<Vec<Folder>, String> {
        let mut session = self.session.lock().await;
        let token = self.access(&mut session).await?;
        if session.inbox_id.is_none() {
            let inbox: Folder = self.get(&format!("{GRAPH}/me/mailFolders/inbox?$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount"), &token).await?;
            session.inbox_id = Some(inbox.id);
        }
        let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/mailFolders")).unwrap();
        if let Some(parent) = parent {
            if !session.known_folders.contains(&parent) {
                return Err("Open the parent folder first".into());
            }
            url.path_segments_mut()
                .unwrap()
                .push(&parent)
                .push("childFolders");
        }
        url.query_pairs_mut()
            .append_pair("$top", "100")
            .append_pair(
                "$select",
                "id,displayName,unreadItemCount,totalItemCount,childFolderCount",
            );
        let mut next = Some(url.to_string());
        let mut folders = Vec::new();
        while let Some(url) = next {
            if folders.len() >= 1000 {
                return Err(
                    "Too many folders to list here. Use Outlook to organize this mailbox.".into(),
                );
            }
            let page: FolderPage = self.get(&url, &token).await?;
            folders.extend(page.value);
            next = page.next_link.map(|url| folder_page(&url)).transpose()?;
        }
        for folder in &mut folders {
            folder.is_inbox = session.inbox_id.as_deref() == Some(&folder.id);
            session.known_folders.insert(folder.id.clone());
        }
        folders.sort_by(|a, b| {
            b.is_inbox.cmp(&a.is_inbox).then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
        });
        Ok(folders)
    }
    pub async fn mark_read(&self, id: String) -> Result<(), String> {
        let mut session = self.session.lock().await;
        if session
            .opened_message
            .as_ref()
            .map(|message| message.id.as_str())
            != Some(&id)
        {
            return Err("Open the message before marking it as read".into());
        }
        let token = self.access(&mut session).await?;
        if !session
            .credential
            .as_ref()
            .is_some_and(|value| value.manage_enabled)
        {
            return Err("Enable read-status sync in Settings → Personal Outlook first.".into());
        }
        let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
        url.path_segments_mut().unwrap().pop_if_empty().push(&id);
        let result = self
            .http
            .patch(url)
            .bearer_auth(token)
            .header("Prefer", "IdType=\"ImmutableId\"")
            .json(&serde_json::json!({"isRead":true}))
            .send()
            .await
            .map_err(|_| "Could not sync read status. The message is still available.")?;
        match result.status().as_u16() {
            200 => {
                if let Some(message) = session.known_messages.get_mut(&id) {
                    message.is_read = true;
                }
                Ok(())
            }
            401 => {
                session.access = None;
                Err("Sign-in expired. Refresh and reopen the message to sync read status.".into())
            }
            403 => Err(
                "Microsoft denied read-status sync. Review Mail.ReadWrite permission in Settings."
                    .into(),
            ),
            _ => Err(
                "Read status could not be synced. Refresh and reopen the message to try again."
                    .into(),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_pages_reject_untrusted_origins_and_non_folder_routes() {
        assert!(folder_page("https://graph.microsoft.com/v1.0/me/mailFolders?$skip=100").is_ok());
        assert!(folder_page(
            "https://graph.microsoft.com/v1.0/me/mailFolders/id/childFolders?$skip=100"
        )
        .is_ok());
        for url in [
            "https://evil.test/v1.0/me/mailFolders",
            "http://graph.microsoft.com/v1.0/me/mailFolders",
            "https://graph.microsoft.com/v1.0/me/messages",
            "https://user@graph.microsoft.com/v1.0/me/mailFolders",
        ] {
            assert!(folder_page(url).is_err());
        }
    }
}
