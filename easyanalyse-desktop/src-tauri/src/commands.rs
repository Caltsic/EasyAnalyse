use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use easyanalyse_core::{
    default_document, validate_value, CoreError, DocumentFile, ValidationReport,
};
use serde::Serialize;
use serde_json::Value;

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
        save_blueprint_workspace_to_path,
    };
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
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
}
