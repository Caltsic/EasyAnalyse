use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use easyanalyse_core::{
    default_document, validate_value, CoreError, DocumentFile, ValidationReport,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentResult {
    document: Option<DocumentFile>,
    report: ValidationReport,
    path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResult {
    path: String,
    report: ValidationReport,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStoreSecurityStatus {
    kind: String,
    warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSaveResult {
    r#ref: String,
    security: SecretStoreSecurityStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretDeleteResult {
    deleted: bool,
}

const SECRET_STORE_FILE_NAME: &str = "easyanalyse-secrets.json";
const SECRET_REF_PREFIX: &str = "secret-ref:";
#[cfg(any(target_os = "macos", target_os = "windows"))]
const SECRET_KEYRING_SERVICE: &str = "EasyAnalyse API Keys";
const SECRET_STORE_WEAK_SECURITY_WARNING: &str = "Weak security: stored in local app data secret file fallback instead of an OS keychain or credential manager.";

#[tauri::command]
pub fn secret_store_status() -> SecretStoreSecurityStatus {
    secret_store_status_for_native_availability(native_keychain_available())
}

#[tauri::command]
pub fn secret_store_save(
    app: AppHandle,
    provider_id: String,
    value: String,
    r#ref: String,
) -> Result<SecretSaveResult, String> {
    let secret_ref = validate_secret_ref(r#ref)?;
    if provider_id.trim().is_empty() {
        return Err("Provider id is required before saving an API key secret".to_string());
    }
    if value.trim().is_empty() {
        return Err("Cannot save an empty API key secret".to_string());
    }

    if native_keychain_available() && native_secret_save(&secret_ref, &value).is_ok() {
        return Ok(SecretSaveResult {
            r#ref: secret_ref,
            security: native_keychain_status(),
        });
    }

    let mut secrets = read_secret_map(&app)?;
    secrets.insert(secret_ref.clone(), Value::String(value));
    write_secret_map(&app, &secrets)?;

    Ok(SecretSaveResult {
        r#ref: secret_ref,
        security: local_secret_file_status(),
    })
}

#[tauri::command]
pub fn secret_store_read(app: AppHandle, r#ref: String) -> Result<Option<String>, String> {
    let secret_ref = validate_secret_ref(r#ref)?;
    if native_keychain_available() {
        match native_secret_read(&secret_ref) {
            Ok(Some(value)) => return Ok(Some(value)),
            Ok(None) | Err(_) => {}
        }
    }
    let secrets = read_secret_map(&app)?;
    Ok(secrets
        .get(&secret_ref)
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

#[tauri::command]
pub fn secret_store_delete(app: AppHandle, r#ref: String) -> Result<SecretDeleteResult, String> {
    let secret_ref = validate_secret_ref(r#ref)?;
    let native_deleted = if native_keychain_available() {
        native_secret_delete(&secret_ref).unwrap_or(false)
    } else {
        false
    };
    let mut secrets = read_secret_map(&app)?;
    let deleted = secrets.remove(&secret_ref).is_some() || native_deleted;
    write_secret_map(&app, &secrets)?;
    Ok(SecretDeleteResult { deleted })
}

fn secret_store_status_for_native_availability(native_available: bool) -> SecretStoreSecurityStatus {
    if native_available {
        native_keychain_status()
    } else {
        local_secret_file_status()
    }
}

fn native_keychain_status() -> SecretStoreSecurityStatus {
    SecretStoreSecurityStatus {
        kind: "native-keychain".to_string(),
        warning: None,
    }
}

fn native_keychain_available() -> bool {
    native_keychain_command().is_some()
}

enum NativeKeychainCommand {
    #[cfg(target_os = "linux")]
    SecretTool,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    KeyringCrate,
}

fn command_exists(binary: &str) -> bool {
    Command::new(binary)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

fn native_keychain_command() -> Option<NativeKeychainCommand> {
    #[cfg(target_os = "linux")]
    {
        if command_exists("secret-tool") {
            return Some(NativeKeychainCommand::SecretTool);
        }
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        return Some(NativeKeychainCommand::KeyringCrate);
    }
    None
}

fn native_secret_save(secret_ref: &str, value: &str) -> Result<(), String> {
    match native_keychain_command().ok_or_else(|| "Native keychain unavailable".to_string())? {
        #[cfg(target_os = "linux")]
        NativeKeychainCommand::SecretTool => {
            let mut child = Command::new("secret-tool")
                .args([
                    "store",
                    "--label=EasyAnalyse API key",
                    "service",
                    "easyanalyse",
                    "account",
                    secret_ref,
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| error.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                stdin.write_all(value.as_bytes()).map_err(|error| error.to_string())?;
                drop(stdin);
            }
            let status = child.wait().map_err(|error| error.to_string())?;
            if status.success() {
                Ok(())
            } else {
                Err("Native keychain save failed".to_string())
            }
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        NativeKeychainCommand::KeyringCrate => {
            let entry = keyring::Entry::new(SECRET_KEYRING_SERVICE, secret_ref).map_err(|error| error.to_string())?;
            entry.set_password(value).map_err(|error| error.to_string())
        }
    }
}
fn native_secret_read(secret_ref: &str) -> Result<Option<String>, String> {
    match native_keychain_command().ok_or_else(|| "Native keychain unavailable".to_string())? {
        #[cfg(target_os = "linux")]
        NativeKeychainCommand::SecretTool => {
            let output = Command::new("secret-tool")
                .args(["lookup", "service", "easyanalyse", "account", secret_ref])
                .stderr(Stdio::null())
                .output()
                .map_err(|error| error.to_string())?;
            if output.status.success() {
                Ok(Some(String::from_utf8_lossy(&output.stdout).trim_end_matches('\n').to_string()))
            } else {
                Ok(None)
            }
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        NativeKeychainCommand::KeyringCrate => {
            let entry = keyring::Entry::new(SECRET_KEYRING_SERVICE, secret_ref).map_err(|error| error.to_string())?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error.to_string()),
            }
        }
    }
}

fn native_secret_delete(secret_ref: &str) -> Result<bool, String> {
    match native_keychain_command().ok_or_else(|| "Native keychain unavailable".to_string())? {
        #[cfg(target_os = "linux")]
        NativeKeychainCommand::SecretTool => {
            let status = Command::new("secret-tool")
                .args(["clear", "service", "easyanalyse", "account", secret_ref])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|error| error.to_string())?;
            Ok(status.success())
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        NativeKeychainCommand::KeyringCrate => {
            let entry = keyring::Entry::new(SECRET_KEYRING_SERVICE, secret_ref).map_err(|error| error.to_string())?;
            match entry.delete_credential() {
                Ok(()) => Ok(true),
                Err(keyring::Error::NoEntry) => Ok(false),
                Err(error) => Err(error.to_string()),
            }
        }
    }
}

fn local_secret_file_status() -> SecretStoreSecurityStatus {
    SecretStoreSecurityStatus {
        kind: "local-secret-file".to_string(),
        warning: Some(SECRET_STORE_WEAK_SECURITY_WARNING.to_string()),
    }
}

fn validate_secret_ref(secret_ref: String) -> Result<String, String> {
    let trimmed = secret_ref.trim().to_string();
    let valid = trimmed.starts_with(SECRET_REF_PREFIX)
        && trimmed[SECRET_REF_PREFIX.len()..]
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '/'));
    if valid {
        Ok(trimmed)
    } else {
        Err("Invalid secret reference. Expected secret-ref:<id>.".to_string())
    }
}

fn secret_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(directory.join(SECRET_STORE_FILE_NAME))
}

fn read_secret_map(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = secret_store_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(error.to_string()),
    };
    let value: Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Ok(Map::new()),
    }
}

fn write_secret_map_to_path(path: &Path, secrets: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        set_owner_only_dir_permissions(parent)?;
    }
    let content = serde_json::to_string_pretty(secrets).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    set_owner_only_file_permissions(path)?;
    use std::io::Write;
    file.write_all(content.as_bytes()).map_err(|error| error.to_string())
}

fn write_secret_map(app: &AppHandle, secrets: &Map<String, Value>) -> Result<(), String> {
    let path = secret_store_path(app)?;
    write_secret_map_to_path(&path, secrets)
}

#[cfg(unix)]
fn set_owner_only_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_owner_only_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_dir_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_owner_only_dir_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn new_document(title: Option<String>) -> Result<DocumentFile, String> {
    Ok(default_document(title.as_deref().unwrap_or_default()))
}

#[tauri::command]
pub fn validate_document(document: Value) -> Result<ValidationReport, String> {
    validate_value(document).map_err(error_to_string)
}

#[tauri::command]
pub fn open_document_from_path(path: String) -> Result<OpenDocumentResult, String> {
    let bytes = fs::read(&path).map_err(error_to_string)?;
    let json = decode_json_text(&bytes)?;
    let value: Value = serde_json::from_str(&json).map_err(error_to_string)?;
    let report = validate_value(value).map_err(error_to_string)?;

    if report.normalized_document.is_none() {
        return Err("Document could not be parsed into the semantic editor model".to_string());
    }

    Ok(OpenDocumentResult {
        document: report.normalized_document.clone(),
        report,
        path: Some(path),
    })
}

#[tauri::command]
pub fn save_document_to_path(path: String, document: Value) -> Result<SaveDocumentResult, String> {
    let report = validate_value(document).map_err(error_to_string)?;
    if !report.schema_valid || !report.semantic_valid {
        return Err(validation_summary(&report));
    }
    let final_path = ensure_json_extension(Path::new(&path));
    let normalized = report
        .normalized_document
        .clone()
        .ok_or_else(|| validation_summary(&report))?;
    let content = serde_json::to_string_pretty(&normalized).map_err(error_to_string)?;

    fs::write(&final_path, content).map_err(error_to_string)?;

    Ok(SaveDocumentResult {
        path: final_path.to_string_lossy().to_string(),
        report,
    })
}

#[tauri::command]
pub fn get_blueprint_sidecar_path(document_path: String) -> Result<String, String> {
    Ok(derive_blueprint_sidecar_path(&document_path))
}

#[tauri::command]
pub fn load_blueprint_workspace_from_path(path: String) -> Result<Option<Value>, String> {
    ensure_blueprint_sidecar_path(&path)?;

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    let json = decode_json_text(&bytes)?;
    let value = serde_json::from_str(&json)
        .map_err(|error| format!("Failed to parse blueprint sidecar JSON: {error}"))?;

    Ok(Some(value))
}

#[tauri::command]
pub fn save_blueprint_workspace_to_path(path: String, workspace: Value) -> Result<(), String> {
    ensure_blueprint_sidecar_path(&path)?;
    let content = serde_json::to_string_pretty(&workspace).map_err(error_to_string)?;
    fs::write(&path, content).map_err(error_to_string)
}

fn decode_json_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Selected file is empty".to_string());
    }

    let text = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8(bytes[3..].to_vec()).map_err(|error| error.to_string())?
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        decode_utf16_bytes(&bytes[2..], u16::from_le_bytes)?
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        decode_utf16_bytes(&bytes[2..], u16::from_be_bytes)?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|error| error.to_string())?
    };

    let normalized = text.trim_start_matches('\u{feff}').to_string();
    if normalized.trim().is_empty() {
        return Err("Selected file is empty".to_string());
    }

    Ok(normalized)
}

fn decode_utf16_bytes(
    bytes: &[u8],
    decode_unit: fn([u8; 2]) -> u16,
) -> Result<String, String> {
    let mut chunks = bytes.chunks_exact(2);
    if !chunks.remainder().is_empty() {
        return Err("Invalid UTF-16 byte length".to_string());
    }

    let units = chunks
        .by_ref()
        .map(|chunk| decode_unit([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|error| error.to_string())
}

fn ensure_json_extension(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return path.to_path_buf();
    }

    let mut owned = path.to_path_buf();
    owned.set_extension("json");
    owned
}

fn derive_blueprint_sidecar_path(document_path: &str) -> String {
    let slash_index = document_path.rfind('/');
    let (directory, file_name) = match slash_index {
        Some(index) => (&document_path[..=index], &document_path[index + 1..]),
        None => ("", document_path),
    };
    let stem = file_name.strip_suffix(".json").unwrap_or(file_name);

    format!("{directory}{stem}.easyanalyse-blueprints.json")
}

fn ensure_blueprint_sidecar_path(path: &str) -> Result<(), String> {
    if path.ends_with(".easyanalyse-blueprints.json") {
        return Ok(());
    }

    Err("Blueprint sidecar path must end with .easyanalyse-blueprints.json".to_string())
}

fn error_to_string<E>(error: E) -> String
where
    E: Into<CoreError>,
{
    let error: CoreError = error.into();
    error.to_string()
}

fn validation_summary(report: &ValidationReport) -> String {
    let details = report
        .issues
        .iter()
        .take(3)
        .map(|issue| issue.message.clone())
        .collect::<Vec<_>>();

    if details.is_empty() {
        return "Document failed validation before saving".to_string();
    }

    format!(
        "Document failed validation before saving: {}",
        details.join("; ")
    )
}

#[cfg(test)]
mod tests {
    use super::{
        decode_json_text, get_blueprint_sidecar_path, load_blueprint_workspace_from_path,
        save_blueprint_workspace_to_path, secret_store_status_for_native_availability,
        write_secret_map_to_path,
    };
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "easyanalyse-sidecar-test-{}-{nonce}-{file_name}",
            std::process::id()
        ))
    }

    #[test]
    fn derives_blueprint_sidecar_path_from_document_path() {
        assert_eq!(
            get_blueprint_sidecar_path("/tmp/example.json".to_string())
                .expect("sidecar path should be derived"),
            "/tmp/example.easyanalyse-blueprints.json"
        );
        assert_eq!(
            get_blueprint_sidecar_path("example".to_string()).expect("sidecar path should be derived"),
            "example.easyanalyse-blueprints.json"
        );
    }

    #[test]
    fn blueprint_sidecar_load_returns_none_when_missing() {
        let path = unique_temp_path("missing.easyanalyse-blueprints.json");
        let loaded = load_blueprint_workspace_from_path(path.to_string_lossy().to_string())
            .expect("missing sidecar should not be an error");
        assert!(loaded.is_none());
    }

    #[test]
    fn blueprint_sidecar_load_rejects_corrupt_json_with_readable_error() {
        let path = unique_temp_path("corrupt.easyanalyse-blueprints.json");
        fs::write(&path, b"{not-json").expect("test fixture should write");

        let error = load_blueprint_workspace_from_path(path.to_string_lossy().to_string())
            .expect_err("corrupt sidecar JSON should fail");

        let _ = fs::remove_file(&path);
        assert!(error.contains("Failed to parse blueprint sidecar JSON"), "{error}");
        assert!(error.contains("expected") || error.contains("line"), "{error}");
    }

    #[test]
    fn blueprint_sidecar_save_pretty_json_and_load_round_trips_without_semantic_validation() {
        let path = unique_temp_path("workspace.easyanalyse-blueprints.json");
        let workspace = json!({
            "blueprintWorkspaceVersion": "1.0.0",
            "blueprints": [{ "intentionallyInvalidBlueprint": true }]
        });

        save_blueprint_workspace_to_path(path.to_string_lossy().to_string(), workspace.clone())
            .expect("valid sidecar path should save arbitrary JSON values");

        let content = fs::read_to_string(&path).expect("sidecar should be written");
        let loaded = load_blueprint_workspace_from_path(path.to_string_lossy().to_string())
            .expect("written sidecar should load")
            .expect("written sidecar should exist");

        let _ = fs::remove_file(&path);
        assert!(content.contains("\n  \"blueprintWorkspaceVersion\""), "{content}");
        assert_eq!(loaded, workspace);
    }

    #[test]
    fn blueprint_sidecar_io_rejects_non_sidecar_paths() {
        let path = unique_temp_path("workspace.json");

        let load_error = load_blueprint_workspace_from_path(path.to_string_lossy().to_string())
            .expect_err("non-sidecar load path should be rejected");
        let save_error = save_blueprint_workspace_to_path(path.to_string_lossy().to_string(), json!({}))
            .expect_err("non-sidecar save path should be rejected");

        assert!(load_error.contains(".easyanalyse-blueprints.json"), "{load_error}");
        assert!(save_error.contains(".easyanalyse-blueprints.json"), "{save_error}");
    }

    #[test]
    fn decodes_utf8_json_with_bom() {
        let text = decode_json_text(&[0xEF, 0xBB, 0xBF, b'{', b'"', b'a', b'"', b':', b'1', b'}'])
            .expect("utf-8 bom json should decode");
        assert_eq!(text, "{\"a\":1}");
    }

    #[test]
    fn decodes_utf16le_json_with_bom() {
        let bytes = [
            0xFF, 0xFE, 0x7B, 0x00, 0x22, 0x00, 0x61, 0x00, 0x22, 0x00, 0x3A, 0x00, 0x31,
            0x00, 0x7D, 0x00,
        ];
        let text = decode_json_text(&bytes).expect("utf-16le bom json should decode");
        assert_eq!(text, "{\"a\":1}");
    }

    #[test]
    fn rejects_empty_files() {
        let error = decode_json_text(&[]).expect_err("empty files should be rejected");
        assert_eq!(error, "Selected file is empty");
    }

    #[test]
    fn rejects_invalid_utf16_lengths() {
        let error = decode_json_text(&[0xFF, 0xFE, 0x7B]).expect_err("odd utf-16 length should fail");
        assert_eq!(error, "Invalid UTF-16 byte length");
    }

    #[test]
    fn secret_store_status_prioritizes_native_backend_when_available() {
        let native_status = secret_store_status_for_native_availability(true);
        assert_eq!(native_status.kind, "native-keychain");
        assert!(native_status.warning.is_none());

        let fallback_status = secret_store_status_for_native_availability(false);
        assert_eq!(fallback_status.kind, "local-secret-file");
        assert!(fallback_status
            .warning
            .expect("fallback warning should be present")
            .contains("Weak security"));
    }

    #[test]
    fn source_does_not_use_macos_security_password_argument() {
        let source = include_str!("commands.rs");
        assert!(!source.contains(&format!("{}{}", "add-generic", "-password")));
        assert!(!source.contains("\"-w\",\n                    value"));
    }

    #[test]
    fn source_closes_secret_tool_stdin_before_waiting() {
        let source = include_str!("commands.rs");
        assert!(source.contains("child.stdin.take()"));
        assert!(source.contains("drop(stdin)"));
    }

    #[test]
    fn source_falls_back_when_native_read_returns_none() {
        let source = include_str!("commands.rs");
        assert!(source.contains("Ok(Some(value)) => return Ok(Some(value))"));
        assert!(!source.contains("if let Ok(value) = native_secret_read(&secret_ref) {\n            return Ok(value);"));
    }

    #[cfg(unix)]
    #[test]
    fn local_secret_file_fallback_uses_owner_only_permissions() {
        let directory = unique_temp_path("secret-permissions");
        let path = directory.join("easyanalyse-secrets.json");
        let mut secrets = serde_json::Map::new();
        secrets.insert("secret-ref:test".to_string(), json!("fixture-secret"));

        write_secret_map_to_path(&path, &secrets).expect("secret map should be written");

        let file_mode = fs::metadata(&path).expect("secret file should exist").permissions().mode() & 0o777;
        let directory_mode = fs::metadata(&directory).expect("secret directory should exist").permissions().mode() & 0o777;
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&directory);

        assert_eq!(file_mode, 0o600);
        assert_eq!(directory_mode, 0o700);
    }
}
