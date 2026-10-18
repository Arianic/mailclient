use crate::{
    outlook::{
        self,
        drafts::{Draft, DraftStore},
    },
    valid_draft_id,
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

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
pub async fn open_outlook_compose(
    app: tauri::AppHandle,
    window: WebviewWindow,
    draft_id: Option<String>,
    reply_id: Option<String>,
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
        service.create_draft(id, reply_id, &store).await?
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
    app.state::<outlook::OutlookService>()
        .send_draft(id, &app.state::<DraftStore>())
        .await
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
