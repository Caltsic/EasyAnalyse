use std::fs;
use std::path::{Path, PathBuf};

use easyanalyse_core::{
    CoreError, DiffSummary, DocumentFile, ValidationReport, default_document,
    summarize_document_diff, validate_value,
};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentResult {
    document: DocumentFile,
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
    Ok(default_document(
        title.as_deref().unwrap_or("Untitled circuit"),
    ))
}

#[tauri::command]
pub fn validate_document(document: Value) -> Result<ValidationReport, String> {
    validate_value(document).map_err(error_to_string)
}

#[tauri::command]
pub fn open_document_from_path(path: String) -> Result<OpenDocumentResult, String> {
    let json = fs::read_to_string(&path).map_err(error_to_string)?;
    let value: Value = serde_json::from_str(&json).map_err(error_to_string)?;
    let report = validate_value(value).map_err(error_to_string)?;
    let document = report
        .normalized_document
        .clone()
        .ok_or_else(|| "Document could not be parsed into the application model".to_string())?;

    Ok(OpenDocumentResult {
        document,
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

    let normalized = report
        .normalized_document
        .clone()
        .ok_or_else(|| "Document could not be normalized before saving".to_string())?;

    let final_path = ensure_json_extension(Path::new(&path));
    let content = serde_json::to_string_pretty(&normalized).map_err(error_to_string)?;
    fs::write(&final_path, content).map_err(error_to_string)?;

    Ok(SaveDocumentResult {
        path: final_path.to_string_lossy().to_string(),
        report,
    })
}

#[tauri::command]
pub fn summarize_diff(previous: Value, next: Value) -> Result<DiffSummary, String> {
    let previous_report = validate_value(previous).map_err(error_to_string)?;
    let next_report = validate_value(next).map_err(error_to_string)?;

    let previous_document = previous_report
        .normalized_document
        .ok_or_else(|| "Previous document could not be normalized".to_string())?;
    let next_document = next_report
        .normalized_document
        .ok_or_else(|| "Next document could not be normalized".to_string())?;

    Ok(summarize_document_diff(&previous_document, &next_document))
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
