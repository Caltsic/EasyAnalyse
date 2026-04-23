use std::fs;
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
    use super::decode_json_text;

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
