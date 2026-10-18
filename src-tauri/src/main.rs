#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[allow(dead_code)]
mod privacy;
mod storage;

#[tauri::command]
fn load_workspace(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<storage::Snapshot, String> {
    trusted_window(&window)?;
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
        .any(|label| label.starts_with("compose-"))
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_compose,
            quit_app,
            load_workspace,
            store_value,
            remove_value
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
