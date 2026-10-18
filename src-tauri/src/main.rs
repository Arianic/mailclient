#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
mod outlook;
mod outlook_commands;
#[allow(dead_code)]
mod privacy;
mod storage;
use tauri_plugin_opener::OpenerExt;

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Account connections are available only in the main Mail window".into())
    }
}

#[tauri::command]
async fn outlook_status(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<outlook::Status, String> {
    outlook_commands::account_window(&window)?;
    app.state::<outlook::OutlookService>().status().await
}
#[tauri::command]
async fn outlook_connect(
    app: tauri::AppHandle,
    window: WebviewWindow,
    client_id: String,
    enable_sending: Option<bool>,
    enable_managing: Option<bool>,
) -> Result<outlook::Status, String> {
    main_window(&window)?;
    let result = app
        .state::<outlook::OutlookService>()
        .connect(
            client_id,
            enable_sending.unwrap_or(false),
            enable_managing.unwrap_or(false),
            |url| {
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|_| "Could not open your browser for Microsoft sign-in".into())
            },
        )
        .await;
    if result.is_ok() {
        app.state::<outlook::index::MailIndex>().2.notify_one();
    }
    result
}
#[tauri::command]
fn outlook_cancel(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    app.state::<outlook::OutlookService>().cancel();
    Ok(())
}
#[tauri::command]
async fn outlook_disconnect(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    if app
        .webview_windows()
        .keys()
        .any(|label| label.starts_with("outlook-compose-"))
    {
        return Err(
            "Close your Outlook compose windows before disconnecting so drafts can finish saving."
                .into(),
        );
    }
    app.state::<outlook::OutlookService>().disconnect().await
}
#[tauri::command]
async fn outlook_inbox(
    app: tauri::AppHandle,
    window: WebviewWindow,
    view: String,
    older: bool,
    folder: Option<String>,
    offset: Option<u32>,
) -> Result<outlook::Inbox, String> {
    main_window(&window)?;
    let service = app.state::<outlook::OutlookService>();
    let account = service.draft_account().await?.to_lowercase();
    let index = app.state::<outlook::index::MailIndex>();
    let folder = folder.unwrap_or_else(|| "inbox".into());
    let resolved = if folder == "inbox" {
        index
            .folders(&account)?
            .into_iter()
            .find(|f| f.is_inbox)
            .map(|f| f.id)
            .unwrap_or_else(|| folder.clone())
    } else {
        folder.clone()
    };
    let cached_query = format!(
        "folderid:\"{resolved}\" {}",
        match view.as_str() {
            "important" => "is:important",
            "other" => "is:other",
            _ => "",
        }
    );
    if index.folder_ready(&account, &resolved)? {
        let page = index.search(&account, &cached_query, offset.unwrap_or(0), "newest")?;
        service
            .session
            .lock()
            .await
            .known_messages
            .extend(page.messages.iter().map(|m| (m.id.clone(), m.clone())));
        return Ok(outlook::Inbox {
            messages: page.messages,
            has_more: page.has_more,
            offline: index.status(&account)?.error.is_some(),
        });
    }
    match service.inbox(view, older, folder).await {
        Ok(page) => Ok(page),
        Err(error) => {
            let page = index.search(&account, &cached_query, offset.unwrap_or(0), "newest")?;
            if page.messages.is_empty() {
                return Err(error);
            }
            service
                .session
                .lock()
                .await
                .known_messages
                .extend(page.messages.iter().map(|m| (m.id.clone(), m.clone())));
            Ok(outlook::Inbox {
                messages: page.messages,
                has_more: page.has_more,
                offline: true,
            })
        }
    }
}
#[tauri::command]
async fn outlook_message(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<outlook::Message, String> {
    main_window(&window)?;
    outlook_commands::read_message(&app, id).await
}

#[tauri::command]
fn load_workspace(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<storage::Snapshot, String> {
    outlook_commands::account_window(&window).or_else(|_| trusted_window(&window))?;
    let state = app.state::<storage::WorkspaceStore>();
    let database = state
        .0
        .lock()
        .map_err(|_| "Workspace storage is unavailable")?;
    let snapshot = database.load()?;
    #[cfg(debug_assertions)]
    eprintln!("Mail local workspace loaded");
    Ok(snapshot)
}

#[tauri::command]
fn store_value(
    app: tauri::AppHandle,
    window: WebviewWindow,
    key: String,
    value: String,
) -> Result<storage::Update, String> {
    trusted_window(&window)?;
    let update = {
        let state = app.state::<storage::WorkspaceStore>();
        let mut database = state
            .0
            .lock()
            .map_err(|_| "Workspace storage is unavailable")?;
        database.set(key, value)?
    };
    let _ = app.emit("workspace-updated", update.clone());
    Ok(update)
}

#[tauri::command]
fn remove_value(
    app: tauri::AppHandle,
    window: WebviewWindow,
    key: String,
) -> Result<storage::Update, String> {
    trusted_window(&window)?;
    let update = {
        let state = app.state::<storage::WorkspaceStore>();
        let mut database = state
            .0
            .lock()
            .map_err(|_| "Workspace storage is unavailable")?;
        database.remove(key)?
    };
    let _ = app.emit("workspace-updated", update.clone());
    Ok(update)
}

fn trusted_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" || window.label().starts_with("compose-") {
        Ok(())
    } else {
        Err("This view cannot control the application".into())
    }
}

fn valid_draft_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[tauri::command]
fn open_compose(
    app: tauri::AppHandle,
    window: WebviewWindow,
    draft_id: String,
) -> Result<(), String> {
    trusted_window(&window)?;
    if !valid_draft_id(&draft_id) {
        return Err("Invalid draft identifier".into());
    }
    let label = format!("compose-{draft_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App(format!("index.html?compose={draft_id}").into()),
    )
    .title("New message — Mail")
    .inner_size(760.0, 700.0)
    .min_inner_size(520.0, 500.0)
    .decorations(false)
    .on_navigation(|url| {
        matches!(url.scheme(), "tauri" | "about")
            || (url.host_str() == Some("tauri.localhost"))
            || (url.host_str() == Some("127.0.0.1") && url.port() == Some(5173))
    })
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    trusted_window(&window)?;
    if app
        .webview_windows()
        .keys()
        .any(|label| label.starts_with("compose-") || label.starts_with("outlook-compose-"))
    {
        return Err(
            "Close your compose windows before quitting Mail so drafts can finish saving".into(),
        );
    }
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            let database = storage::Database::open(&directory.join("workspace.sqlite"))
                .map_err(std::io::Error::other)?;
            app.manage(storage::WorkspaceStore(std::sync::Mutex::new(database)));
            app.manage(outlook::OutlookService::new().map_err(std::io::Error::other)?);
            app.manage(
                outlook::drafts::DraftStore::open(&directory.join("outlook-drafts.sqlite"))
                    .map_err(std::io::Error::other)?,
            );
            app.manage(
                outlook::index::MailIndex::open(&directory.join("outlook-mail.sqlite"))
                    .map_err(std::io::Error::other)?,
            );
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let service = handle.state::<outlook::OutlookService>();
                    let index = handle.state::<outlook::index::MailIndex>();
                    let mut pending = false;
                    if let Ok(account) = service.draft_account().await {
                        match service.sync_step(&index).await {
                            Ok(more) => {
                                pending = more;
                                index.error(&account.to_lowercase(), None);
                                let _ = handle.emit("outlook-index-changed", ());
                            }
                            Err(error) => index.error(&account.to_lowercase(), Some(&error)),
                        }
                    }
                    tokio::select! { _=tokio::time::sleep(std::time::Duration::from_millis(if pending{400}else{60_000}))=>{},_=index.2.notified()=>{} }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_compose,
            quit_app,
            load_workspace,
            store_value,
            remove_value,
            outlook_status,
            outlook_connect,
            outlook_cancel,
            outlook_disconnect,
            outlook_inbox,
            outlook_message,
            outlook_commands::open_outlook_compose,
            outlook_commands::outlook_drafts,
            outlook_commands::outlook_load_draft,
            outlook_commands::outlook_save_draft,
            outlook_commands::outlook_writing_library,
            outlook_commands::outlook_save_writing_library,
            outlook_commands::outlook_send_draft,
            outlook_commands::outlook_add_draft_files,
            outlook_commands::outlook_remove_draft_file,
            outlook_commands::outlook_folders,
            outlook_commands::outlook_mark_read,
            outlook_commands::outlook_search,
            outlook_commands::outlook_search_diagnostics,
            outlook_commands::outlook_index_status,
            outlook_commands::outlook_index_control,
            outlook_commands::outlook_sync,
            outlook_commands::outlook_cached_folders,
            outlook_commands::outlook_action,
            outlook_commands::outlook_undo,
            outlook_commands::outlook_conversation,
            outlook_commands::outlook_contacts,
            outlook_commands::outlook_discard_draft,
            outlook_commands::outlook_attachments,
            outlook_commands::outlook_load_images,
            outlook_commands::outlook_download_attachment,
            outlook_commands::outlook_download_image
        ])
        .on_page_load(|webview, payload| {
            #[cfg(debug_assertions)]
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                eprintln!("Mail local application document loaded");
            }
        })
        .on_window_event(|window, event| {
            if let (Some(id),tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop{paths,..}))=(window.label().strip_prefix("outlook-compose-"),event){
                if valid_draft_id(id){let id=id.to_string();let paths=paths.clone();let handle=window.app_handle().clone();let label=window.label().to_string();let _=window.emit("outlook-draft-files",serde_json::json!({"busy":true}));tauri::async_runtime::spawn(async move{let result=outlook_commands::attach_paths(handle.clone(),id,paths).await;if let Some(window)=handle.get_webview_window(&label){let payload=match result{Ok(files)=>serde_json::json!({"busy":false,"attachments":files}),Err(error)=>serde_json::json!({"busy":false,"error":error})};let _=window.emit("outlook-draft-files",payload);}});}
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Mail could not start");
}

#[cfg(test)]
mod tests {
    use super::valid_draft_id;
    #[test]
    fn rejects_navigation_in_draft_identifiers() {
        assert!(valid_draft_id("sample-draft-123"));
        for id in [
            "",
            "../credentials",
            "a?redirect=evil",
            "https://evil",
            "x#fragment",
        ] {
            assert!(!valid_draft_id(id));
        }
        assert!(!valid_draft_id(&"a".repeat(81)));
    }
}
