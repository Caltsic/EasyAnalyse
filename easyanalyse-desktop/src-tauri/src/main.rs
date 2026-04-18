#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::new_document,
            commands::validate_document,
            commands::open_document_from_path,
            commands::save_document_to_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running EASYAnalyse desktop");
}

fn main() {
    run();
}
