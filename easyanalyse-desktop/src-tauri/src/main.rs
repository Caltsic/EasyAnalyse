#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod commands;
mod share;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn run() {
    tauri::Builder::default()
        .manage(share::MobileShareState::default())
        .setup(|app| {
            let state = app.state::<share::MobileShareState>();
            if let Err(error) = share::start_backend_server(app.handle().clone(), state.inner()) {
                eprintln!("Failed to start mobile share backend: {error}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::new_document,
            commands::validate_document,
            commands::open_document_from_path,
            commands::save_document_to_path,
            commands::get_blueprint_sidecar_path,
            commands::load_blueprint_workspace_from_path,
            commands::save_blueprint_workspace_to_path,
            commands::secret_store_status,
            commands::secret_store_save,
            commands::secret_store_read,
            commands::secret_store_delete,
            share::start_mobile_share,
            share::stop_mobile_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running EASYAnalyse desktop");
}

fn main() {
    run();
}
