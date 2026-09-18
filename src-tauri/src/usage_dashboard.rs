//! Read-only, bounded projection of the CLI's persisted usage ledger.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cached_read_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    total_tokens: Option<u64>,
    model_calls: Option<u64>,
    #[serde(default)]
    usage_is_incomplete: bool,
    #[serde(default)]
    model_usage: BTreeMap<String, ModelUsage>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cached_read_tokens: Option<u64>,
    total_tokens: Option<u64>,
    model_calls: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsage {
    turn_number: u64,
    #[serde(default)]
    ended_at: String,
    #[serde(flatten)]
    usage: UsageRow,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedSession {
    session_id: String,
    #[serde(default)]
    updated_at: String,
    session: UsageRow,
    #[serde(default)]
    turns: Vec<TurnUsage>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardUsage {
    sessions: Vec<RecordedSession>,
    skipped_files: usize,
    truncated: bool,
}

fn read_usage(path: &Path) -> Option<RecordedSession> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return None;
    }
    let mut raw = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut raw)
        .ok()?;
    if raw.len() as u64 > MAX_BYTES {
        return None;
    }
    let value: RecordedSession = serde_json::from_slice(&raw).ok()?;
    if value.session_id.is_empty() {
        return None;
    }
    Some(value)
}

fn collect(roots: &[PathBuf]) -> DashboardUsage {
    let mut result = DashboardUsage::default();
    let mut seen = HashSet::new();
    let mut stack: Vec<_> = roots.iter().rev().map(|p| (p.clone(), 0)).collect();
    let mut visited = 0;
    let mut bytes_read = 0u64;
    while let Some((dir, depth)) = stack.pop() {
        if depth > 6 {
            result.truncated = true;
            continue;
        }
        if fs::symlink_metadata(&dir)
            .map(|m| !m.is_dir())
            .unwrap_or(true)
        {
            continue;
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => {
                result.skipped_files += 1;
                continue;
            }
        };
        for entry in entries {
            visited += 1;
            if visited > MAX_FILES {
                result.truncated = true;
                return result;
            }
            let Ok(entry) = entry else {
                result.skipped_files += 1;
                continue;
            };
            let Ok(kind) = entry.file_type() else {
                result.skipped_files += 1;
                continue;
            };
            if kind.is_dir() {
                stack.push((entry.path(), depth + 1));
            } else if kind.is_file() && entry.file_name() == "usage.json" {
                bytes_read = bytes_read
                    .saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(MAX_BYTES));
                if bytes_read > 128 * 1024 * 1024 {
                    result.truncated = true;
                    return result;
                }
                match read_usage(&entry.path()) {
                    Some(session) if seen.insert(session.session_id.clone()) => {
                        result.sessions.push(session)
                    }
                    Some(_) => {}
                    None => result.skipped_files += 1,
                }
            }
        }
    }
    result
}

#[tauri::command]
pub async fn usage_dashboard() -> Result<DashboardUsage, String> {
    tauri::async_runtime::spawn_blocking(|| {
        collect(&[
            crate::paths::shared_supercharge_home().join("sessions"),
            crate::paths::agent_home_dir().join("sessions"),
        ])
    })
    .await
    .map_err(|_| "Could not read local usage records".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projects_only_usage_fields_and_keeps_unknowns() {
        let value: RecordedSession = serde_json::from_value(serde_json::json!({
            "sessionId":"s", "secret":"never expose", "session":{"totalTokens":10},
            "turns":[{"turnNumber":1,"endedAt":"2026-09-17T10:00:00Z","totalTokens":10}]
        }))
        .unwrap();
        let output = serde_json::to_value(value).unwrap();
        assert!(output.get("secret").is_none());
        assert!(output["session"]["inputTokens"].is_null());
        assert_eq!(output["turns"][0]["totalTokens"], 10);
    }
    #[test]
    fn deduplicates_roots_and_reports_bad_files() {
        let root =
            std::env::temp_dir().join(format!("supercharge-usage-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("a")).unwrap();
        fs::create_dir_all(root.join("b")).unwrap();
        fs::write(
            root.join("a/usage.json"),
            r#"{"sessionId":"s","session":{"totalTokens":10},"turns":[]}"#,
        )
        .unwrap();
        fs::write(root.join("b/usage.json"), "invalid").unwrap();
        let result = collect(&[root.clone(), root.clone()]);
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.skipped_files, 2);
        fs::remove_dir_all(root).unwrap();
    }
}
