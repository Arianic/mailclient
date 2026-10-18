use crate::{
    outlook::{
        self,
        drafts::{Draft, DraftAttachment, DraftStore, ATTACHMENT_LIMIT},
    },
    valid_draft_id,
};
use outlook::index::{IndexStatus, MailIndex, SearchPage};
pub async fn attach_paths(
    app: tauri::AppHandle,
    id: String,
    paths: Vec<std::path::PathBuf>,
) -> Result<Vec<DraftAttachment>, String> {
    let draft = app.state::<DraftStore>().load(&id)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?;
    if !draft.account.eq_ignore_ascii_case(&account) || draft.state != "draft" {
        return Err("This draft cannot receive attachments".into());
    }
    if paths.len() > 20 {
        return Err("Choose up to 20 files".into());
    }
    let files = tokio::task::spawn_blocking(move || -> Result<Vec<(String, Vec<u8>)>, String> {
        use std::io::Read;
        let mut result = Vec::new();
        let mut total = 0;
        for path in paths {
            let file = std::fs::File::open(&path).map_err(|_| "Could not open chosen file")?;
            if !file
                .metadata()
                .map_err(|_| "Could not inspect chosen file")?
                .is_file()
            {
                return Err("Choose regular files".into());
            }
            let mut bytes = Vec::new();
            file.take((ATTACHMENT_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read chosen file")?;
            total += bytes.len();
            if total > ATTACHMENT_LIMIT {
                return Err("Attachments can total up to 20 MB.".into());
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("attachment")
                .chars()
                .filter(|c| !c.is_control())
                .take(240)
                .collect::<String>();
            result.push((name, bytes));
        }
        Ok(result)
    })
    .await
    .map_err(|_| "Could not copy attachments")??;
    app.state::<DraftStore>().add_files(&id, files)
}
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

pub async fn read_message(app: &tauri::AppHandle, id: String) -> Result<outlook::Message, String> {
    let service = app.state::<outlook::OutlookService>();
    let account = service.draft_account().await?.to_lowercase();
    let index = app.state::<MailIndex>();
    let cached = index.raw(&account, &id)?;
    if let Some(raw) = &cached {
        if let Ok(summary) = serde_json::from_value::<outlook::MessageSummary>(raw.clone()) {
            service
                .session
                .lock()
                .await
                .known_messages
                .insert(id.clone(), summary);
        }
    }
    match service.message(id.clone()).await {
        Ok(message) => {
            let fallback = service
                .session
                .lock()
                .await
                .known_messages
                .get(&id)
                .and_then(|summary| serde_json::to_value(summary).ok());
            if let Some(mut raw) = cached.or(fallback) {
                raw["_cachedAt"] = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Could not date cached mail")?
                    .as_secs()
                    .into();
                raw["body"] =
                    serde_json::to_value(&message.body).map_err(|_| "Could not cache message")?;
                let folder = raw["parentFolderId"].as_str().unwrap_or("").to_string();
                // A foreground read must not repopulate a cleared/paused cache or
                // wait behind a network sync. The next delta can cache it later.
                if let Ok(_guard) = index.1.try_lock() {
                    if !index.status(&account)?.paused {
                        index.upsert(&account, &folder, &[raw])?;
                    }
                }
            }
            Ok(message)
        }
        Err(error) => {
            if let Some(raw) = cached {
                if let Ok(mut message) = serde_json::from_value::<outlook::Message>(raw) {
                    message.offline = true;
                    let mut s = service.session.lock().await;
                    s.opened_message = Some(message.clone());
                    s.loaded_images.clear();
                    return Ok(message);
                }
            }
            Err(error)
        }
    }
}
#[tauri::command]
pub async fn outlook_search(
    app: tauri::AppHandle,
    window: WebviewWindow,
    query: String,
    offset: u32,
    sort: String,
) -> Result<SearchPage, String> {
    crate::main_window(&window)?;
    let service = app.state::<outlook::OutlookService>();
    let account = service.draft_account().await?.to_lowercase();
    let page = app
        .state::<MailIndex>()
        .search(&account, &query, offset, &sort)?;
    service
        .session
        .lock()
        .await
        .known_messages
        .extend(page.messages.iter().map(|m| (m.id.clone(), m.clone())));
    Ok(page)
}
#[tauri::command]
pub async fn outlook_index_status(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<IndexStatus, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    let index = app.state::<MailIndex>();
    let status = index.status(&account)?;
    if status.folders == 0 && !status.paused && status.error.is_none() {
        index.2.notify_one();
    }
    Ok(status)
}
#[tauri::command]
pub async fn outlook_sync(app: tauri::AppHandle, window: WebviewWindow) -> Result<bool, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    app.state::<MailIndex>().request_sync(&account)?;
    app.state::<outlook::OutlookService>()
        .sync_step(&app.state::<MailIndex>())
        .await
}
#[tauri::command]
pub async fn outlook_index_control(
    app: tauri::AppHandle,
    window: WebviewWindow,
    action: String,
) -> Result<IndexStatus, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    let index = app.state::<MailIndex>();
    let _guard = index.1.lock().await;
    index.control(&account, &action)?;
    if action == "clear" {
        let service = app.state::<outlook::OutlookService>();
        let mut session = service.session.lock().await;
        session.known_messages.clear();
        session.opened_message = None;
        session.loaded_images.clear();
    }
    Ok(index.status(&account)?)
}
#[tauri::command]
pub async fn outlook_cached_folders(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Vec<outlook::folders::Folder>, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    app.state::<MailIndex>().folders(&account)
}
#[tauri::command]
pub async fn outlook_action(
    app: tauri::AppHandle,
    window: WebviewWindow,
    ids: Vec<String>,
    action: String,
    destination: Option<String>,
) -> Result<outlook::actions::ActionResult, String> {
    crate::main_window(&window)?;
    app.state::<outlook::OutlookService>()
        .action(&app.state::<MailIndex>(), ids, action, destination)
        .await
}
#[tauri::command]
pub async fn outlook_undo(
    app: tauri::AppHandle,
    window: WebviewWindow,
    key: String,
) -> Result<outlook::actions::ActionResult, String> {
    crate::main_window(&window)?;
    app.state::<outlook::OutlookService>()
        .undo_action(&app.state::<MailIndex>(), key)
        .await
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    messages: Vec<serde_json::Value>,
    complete: bool,
}
#[tauri::command]
pub async fn outlook_conversation(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Conversation, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    let index = app.state::<MailIndex>();
    let messages = index.conversation(&account, &id)?;
    let status = index.status(&account)?;
    Ok(Conversation {
        messages,
        complete: status.pending == 0 && status.coverage_gaps == 0 && status.error.is_none(),
    })
}
#[tauri::command]
pub async fn outlook_contacts(
    app: tauri::AppHandle,
    window: WebviewWindow,
    query: String,
) -> Result<Vec<outlook::Address>, String> {
    account_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?
        .to_lowercase();
    app.state::<MailIndex>().contacts(&account, &query)
}
#[tauri::command]
pub async fn outlook_discard_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    if window.label() == "main" {
        if app
            .get_webview_window(&format!("outlook-compose-{id}"))
            .is_some()
        {
            return Err("Close the compose window before discarding this draft.".into());
        }
    } else {
        draft_window(&window, &id)?;
    }
    let service = app.state::<outlook::OutlookService>();
    let draft = app.state::<DraftStore>().load(&id)?;
    if !draft
        .account
        .eq_ignore_ascii_case(&service.draft_account().await?)
    {
        return Err("This draft belongs to another account".into());
    }
    service
        .discard_local_draft(&id, &app.state::<DraftStore>())
        .await
}

pub fn account_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main"
        || window
            .label()
            .strip_prefix("outlook-compose-")
            .is_some_and(valid_draft_id)
    {
        Ok(())
    } else {
        Err("This window cannot access Outlook".into())
    }
}
fn draft_window(window: &WebviewWindow, id: &str) -> Result<(), String> {
    if !valid_draft_id(id) || window.label() != format!("outlook-compose-{id}") {
        return Err("This window cannot edit that draft".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn outlook_folders(
    app: tauri::AppHandle,
    window: WebviewWindow,
    parent: Option<String>,
) -> Result<Vec<outlook::folders::Folder>, String> {
    crate::main_window(&window)?;
    app.state::<outlook::OutlookService>().folders(parent).await
}
#[tauri::command]
pub async fn outlook_mark_read(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    crate::main_window(&window)?;
    let service = app.state::<outlook::OutlookService>();
    let account = service.draft_account().await?.to_lowercase();
    let index = app.state::<MailIndex>();
    let _guard = index.1.lock().await;
    service.mark_read(id.clone()).await?;
    if let Some(raw) = index.raw(&account, &id)? {
        let folder = raw["parentFolderId"].as_str().unwrap_or("");
        if index
            .upsert(
                &account,
                folder,
                &[serde_json::json!({"id":id,"isRead":true})],
            )
            .is_err()
        {
            index.error(
                &account,
                Some("Read status changed; the local cache will catch up on sync."),
            );
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn outlook_add_draft_files(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Vec<DraftAttachment>, String> {
    // Reuse the exact window/account check; only a native picker supplies paths.
    let draft = outlook_load_draft(app.clone(), window.clone(), id.clone()).await?;
    if draft.state != "draft" {
        return Err("This draft cannot be edited".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_files(move |paths| {
        let _ = sender.send(paths);
    });
    let Some(paths) = receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly")?
    else {
        return Ok(draft.attachments);
    };
    if paths.len() > 20 {
        return Err("Choose up to 20 attachments".into());
    }
    let paths = paths
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| "Choose a local file".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    attach_paths(app, id, paths).await
}
#[tauri::command]
pub async fn outlook_remove_draft_file(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    attachment_id: String,
) -> Result<Vec<DraftAttachment>, String> {
    outlook_load_draft(app.clone(), window, id.clone()).await?;
    app.state::<DraftStore>().remove_file(&id, &attachment_id)
}
#[tauri::command]
pub async fn open_outlook_compose(
    app: tauri::AppHandle,
    window: WebviewWindow,
    draft_id: Option<String>,
    reply_id: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    crate::main_window(&window)?;
    let service = app.state::<outlook::OutlookService>();
    let store = app.state::<DraftStore>();
    let draft = if let Some(id) = draft_id {
        if !valid_draft_id(&id) {
            return Err("Invalid draft identifier".into());
        }
        let draft = store.load(&id)?;
        if !draft
            .account
            .eq_ignore_ascii_case(&service.draft_account().await?)
        {
            return Err("This draft belongs to another account".into());
        }
        draft
    } else {
        let id: String = oauth2::CsrfToken::new_random()
            .secret()
            .chars()
            .filter(|value| value.is_ascii_alphanumeric() || *value == '-')
            .collect();
        let mut draft = service.create_draft(id, reply_id, &store).await?;
        if let Some(mode) = mode {
            if !matches!(mode.as_str(), "reply" | "replyAll" | "forward") {
                return Err("Unsupported compose action".into());
            }
            if let Some(reply_id) = &draft.reply_id {
                let account = draft.account.to_lowercase();
                let mut original = app.state::<MailIndex>().raw(&account, reply_id)?;
                if original
                    .as_ref()
                    .is_none_or(|raw| raw.get("body").is_none())
                {
                    let message = read_message(&app, reply_id.clone()).await?;
                    let mut raw = service
                        .session
                        .lock()
                        .await
                        .known_messages
                        .get(reply_id)
                        .and_then(|summary| serde_json::to_value(summary).ok())
                        .unwrap_or_else(|| serde_json::json!({"id":reply_id}));
                    raw["body"] = serde_json::to_value(message.body)
                        .map_err(|_| "Could not quote this message")?;
                    original = Some(raw);
                }
                if let Some(raw) = original {
                    if mode == "replyAll" {
                        let mut seen = std::collections::HashSet::new();
                        seen.insert(draft.account.to_lowercase());
                        let mut to = Vec::new();
                        let mut cc = Vec::new();
                        for address in draft.to.split(',').map(str::trim).filter(|v| !v.is_empty())
                        {
                            if seen.insert(address.to_lowercase()) {
                                to.push(address.to_string());
                            }
                        }
                        for key in ["toRecipients", "ccRecipients"] {
                            if let Some(list) = raw[key].as_array() {
                                for person in list {
                                    if let Some(address) =
                                        person["emailAddress"]["address"].as_str()
                                    {
                                        if seen.insert(address.to_lowercase()) {
                                            if key == "ccRecipients" {
                                                cc.push(address.to_string());
                                            } else {
                                                to.push(address.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        draft.to = to.join(", ");
                        draft.cc = cc.join(", ");
                    }
                    let quote = outlook::index::body_text(&raw);
                    draft.quote = Some(format!(
                        "\n\n— Original message —\nFrom: {}\nDate: {}\nSubject: {}\n\n{}",
                        raw["from"]["emailAddress"]["address"]
                            .as_str()
                            .unwrap_or(""),
                        raw["receivedDateTime"].as_str().unwrap_or(""),
                        raw["subject"].as_str().unwrap_or(""),
                        quote
                    ));
                }
            }
            if mode == "forward" {
                if let Some(source) = draft.reply_id.clone() {
                    let has_files = service
                        .session
                        .lock()
                        .await
                        .known_messages
                        .get(&source)
                        .is_some_and(|message| message.has_attachments);
                    {
                        if has_files {
                            match read_message(&app, source.clone()).await {
                                Ok(_) => match service.forward_files(&source).await {
                                    Ok(files) => {
                                        if files.is_empty() {
                                            draft.notice=Some("Original files could not be copied automatically. Add any files you want to include.".into());
                                        } else {
                                            match store.add_files(&draft.id, files) {
                                                Ok(files) => draft.attachments = files,
                                                Err(error) => draft.notice = Some(error),
                                            }
                                        }
                                    }
                                    Err(error) => draft.notice = Some(error),
                                },
                                Err(error) => draft.notice = Some(error),
                            }
                        }
                    }
                }
                draft.to.clear();
                draft.reply_id = None;
                draft.subject = format!("Fwd: {}", draft.subject.trim_start_matches("Re: "));
                store.set_forward(&draft)?;
            } else {
                store.save(&draft)?;
            }
        }
        draft
    };
    let label = format!("outlook-compose-{}", draft.id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|_| "Could not show draft")?;
        existing.set_focus().map_err(|_| "Could not focus draft")?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App(format!("index.html?outlookCompose={}", draft.id).into()),
    )
    .title("New message — Mail")
    .inner_size(760.0, 700.0)
    .min_inner_size(520.0, 500.0)
    .decorations(false)
    .build()
    .map_err(|_| "Could not open compose window")?;
    Ok(())
}
#[tauri::command]
pub async fn outlook_drafts(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Vec<Draft>, String> {
    crate::main_window(&window)?;
    let account = app
        .state::<outlook::OutlookService>()
        .draft_account()
        .await?;
    app.state::<DraftStore>().list(&account)
}
#[tauri::command]
pub async fn outlook_load_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Draft, String> {
    draft_window(&window, &id)?;
    let draft = app.state::<DraftStore>().load(&id)?;
    if !draft.account.eq_ignore_ascii_case(
        &app.state::<outlook::OutlookService>()
            .draft_account()
            .await?,
    ) {
        return Err("This draft belongs to another account".into());
    }
    Ok(draft)
}
#[tauri::command]
pub async fn outlook_writing_library(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<outlook::writing::WritingLibrary, String> {
    let draft = outlook_load_draft(app.clone(), window, id).await?;
    app.state::<DraftStore>().writing_library(&draft.account)
}
#[tauri::command]
pub async fn outlook_save_writing_library(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    library: outlook::writing::WritingLibrary,
) -> Result<outlook::writing::WritingLibrary, String> {
    let draft = outlook_load_draft(app.clone(), window, id).await?;
    app.state::<DraftStore>()
        .save_writing_library(&draft.account, library)
}
#[tauri::command]
pub async fn outlook_save_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    draft: Draft,
) -> Result<(), String> {
    draft_window(&window, &draft.id)?;
    if !draft.account.eq_ignore_ascii_case(
        &app.state::<outlook::OutlookService>()
            .draft_account()
            .await?,
    ) {
        return Err("This draft belongs to another account".into());
    }
    app.state::<DraftStore>().save(&draft)
}
#[tauri::command]
pub async fn outlook_send_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<String, String> {
    draft_window(&window, &id)?;
    let service = app.state::<outlook::OutlookService>();
    let result = service
        .send_draft(id, &app.state::<DraftStore>(), move |sent, total| {
            let _ = window.emit(
                "outlook-upload-progress",
                serde_json::json!({"sent":sent,"total":total}),
            );
        })
        .await;
    if result.is_ok() {
        if let Ok(account) = service.draft_account().await {
            let _ = app
                .state::<MailIndex>()
                .request_sync(&account.to_lowercase());
        }
    }
    result
}
#[tauri::command]
pub async fn outlook_attachments(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Vec<outlook::media::Attachment>, String> {
    crate::main_window(&window)?;
    app.state::<outlook::OutlookService>().attachments(id).await
}
#[tauri::command]
pub async fn outlook_load_images(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<outlook::media::Images, String> {
    crate::main_window(&window)?;
    app.state::<outlook::OutlookService>().load_images(id).await
}
async fn save_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(name)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver
        .await
        .map_err(|_| "The save dialog closed unexpectedly")?
    else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|_| "Choose a local file location")?;
    tokio::task::spawn_blocking(move || std::fs::write(path, bytes))
        .await
        .map_err(|_| "Could not save this file")?
        .map_err(|_| "Could not save this file. Check the chosen location.")?;
    Ok(true)
}
#[tauri::command]
pub async fn outlook_download_attachment(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    attachment_id: String,
) -> Result<bool, String> {
    crate::main_window(&window)?;
    let (name, bytes) = app
        .state::<outlook::OutlookService>()
        .attachment_bytes(id, attachment_id)
        .await?;
    save_file(app, name, bytes).await
}
#[tauri::command]
pub async fn outlook_download_image(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    index: usize,
) -> Result<bool, String> {
    crate::main_window(&window)?;
    let bytes = app
        .state::<outlook::OutlookService>()
        .image_bytes(&id, index)
        .await?;
    save_file(app, format!("image-{}.png", index + 1), bytes).await
}
