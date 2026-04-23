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
            share::start_mobile_share,
            share::stop_mobile_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running EASYAnalyse desktop");
}

fn main() {
    run();
}
