//! Supercharge model catalog from the CLI cache plus live ACP initialization.
//!
//! Providers / relays are channels managed on the Providers settings page and
//! do not appear as selectable model chips unless the Supercharge runtime
//! advertises their models through ACP.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

/// Live model catalog reported by the active agent during `initialize`.
/// Once populated it replaces, rather than augments, the cold-start cache.
static LIVE_MODELS: LazyLock<Mutex<BTreeMap<String, AvailableModel>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static LIVE_DEFAULT_MODEL_ID: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static LIVE_MODEL_STATE_SEEN: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

/// Store the latest complete live model snapshot discovered during `initialize`.
/// Replacing the map is important: unioning snapshots would keep models that the
/// active provider no longer advertises.
pub fn merge_live_models(models: Vec<AvailableModel>, current_model_id: Option<String>) {
    let next = models
        .into_iter()
        .filter(|model| !model.id.trim().is_empty())
        .map(|mut model| {
            model.id = model.id.trim().to_string();
            model.label = model.label.trim().to_string();
            if model.label.is_empty() {
                model.label = model.id.clone();
            }
            model.source = "live".into();
            (model.id.clone(), model)
        })
        .collect();
    *LIVE_MODELS.lock().expect("LIVE_MODELS poisoned") = next;
    *LIVE_MODEL_STATE_SEEN
        .lock()
        .expect("LIVE_MODEL_STATE_SEEN poisoned") = true;
    *LIVE_DEFAULT_MODEL_ID
        .lock()
        .expect("LIVE_DEFAULT_MODEL_ID poisoned") = current_model_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffort {
    pub id: String,
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub label: String,
    /// Catalog provenance (`live` or `cache`; DTO kept stable for the frontend).
    pub source: String,
    #[serde(default)]
    pub is_default: bool,
    /// Per-model reasoning efforts from CLI `info.reasoning_efforts` (may be empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<ReasoningEffort>,
    /// Model context window in tokens from live ACP, or the cold-start cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModelsResult {
    pub models: Vec<AvailableModel>,
    pub default_model_id: String,
    pub origin: Option<String>,
    pub fetched_at: Option<String>,
}

struct ParsedCacheModel {
    label: String,
    reasoning_efforts: Vec<ReasoningEffort>,
    context_window: Option<u64>,
}

fn user_supercharge_home() -> PathBuf {
    crate::process_util::user_home().join(".supercharge")
}

fn configured_default_model(home: &std::path::Path) -> Option<String> {
    let raw = fs::read_to_string(home.join("config.toml")).ok()?;
    let mut in_models = false;
    for line in raw.lines() {
        let line = line.trim();
        if let Some((is_array, table)) = crate::agent_home_config::parse_table_header(line) {
            in_models = !is_array && table == "models";
            continue;
        }
        if !in_models || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != "default" {
            continue;
        }
        let value = value
            .split_once('#')
            .map_or(value, |(before_comment, _)| before_comment)
            .trim()
            .trim_matches(['\"', '\''])
            .trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Keep the first catalog-declared default when malformed input marks more
/// than one effort. Do not encode model-family-specific priorities here.
fn normalize_effort_defaults(efforts: &mut [ReasoningEffort]) {
    let mut saw_default = false;
    for effort in efforts {
        if !effort.is_default {
            continue;
        }
        if saw_default {
            effort.is_default = false;
        } else {
            saw_default = true;
        }
    }
}

fn preferred_model_id(
    by_id: &BTreeMap<String, AvailableModel>,
    configured_model: Option<&str>,
) -> String {
    if let Some(id) = configured_model.map(str::trim).filter(|s| !s.is_empty()) {
        if by_id.contains_key(id) {
            return id.to_string();
        }
    }
    by_id.keys().next().cloned().unwrap_or_default()
}

/// Parse `/info/reasoning_efforts` from a models_cache entry body.
fn parse_reasoning_efforts(body: &serde_json::Value) -> Vec<ReasoningEffort> {
    let Some(arr) = body
        .pointer("/info/reasoning_efforts")
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    let mut efforts: Vec<ReasoningEffort> = arr
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let value = item
                .get("value")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(id)
                .to_string();
            let label = item
                .get("label")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(id)
                .to_string();
            let description = item
                .get("description")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            // CLI cache uses `"default": true`; host API exposes `isDefault`.
            let is_default = item
                .get("default")
                .and_then(|x| x.as_bool())
                .or_else(|| item.get("isDefault").and_then(|x| x.as_bool()))
                .or_else(|| item.get("is_default").and_then(|x| x.as_bool()))
                .unwrap_or(false);
            Some(ReasoningEffort {
                id: id.to_string(),
                value,
                label,
                description,
                is_default,
            })
        })
        .collect();
    normalize_effort_defaults(&mut efforts);
    efforts
}

#[allow(clippy::type_complexity)]
fn read_models_cache(
    path: &PathBuf,
) -> Option<(
    BTreeMap<String, ParsedCacheModel>,
    Option<String>,
    Option<String>,
)> {
    let raw = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let models_obj = v.get("models")?.as_object()?;
    let mut map = BTreeMap::new();
    for (id, body) in models_obj {
        if id.trim().is_empty() {
            continue;
        }
        let hidden = body
            .pointer("/info/hidden")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        if hidden {
            continue;
        }
        let label = body
            .pointer("/info/name")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(id)
            .to_string();
        let reasoning_efforts = parse_reasoning_efforts(body);
        let context_window = body
            .pointer("/info/totalContextTokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                body.pointer("/info/context_window")
                    .and_then(|v| v.as_u64())
            })
            .or_else(|| {
                body.pointer("/info/context_window")
                    .and_then(|v| v.as_str())
                    .and_then(|v| v.parse::<u64>().ok())
            });
        map.insert(
            id.clone(),
            ParsedCacheModel {
                label,
                reasoning_efforts,
                context_window,
            },
        );
    }
    let origin = v
        .get("origin")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let fetched_at = v
        .get("fetched_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    Some((map, origin, fetched_at))
}

fn cache_result(home: &std::path::Path) -> Option<AvailableModelsResult> {
    let cache = home.join("models_cache.json");
    let (map, origin, fetched_at) = read_models_cache(&cache)?;
    if map.is_empty() {
        return None;
    }
    let by_id: BTreeMap<String, AvailableModel> = map
        .into_iter()
        .map(|(id, parsed)| {
            (
                id.clone(),
                AvailableModel {
                    id,
                    label: parsed.label,
                    source: "cache".into(),
                    is_default: false,
                    reasoning_efforts: parsed.reasoning_efforts,
                    context_window: parsed.context_window,
                },
            )
        })
        .collect();
    let configured_default = configured_default_model(home);
    let preferred = preferred_model_id(&by_id, configured_default.as_deref());
    let mut models: Vec<AvailableModel> = by_id.into_values().collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    for model in &mut models {
        model.is_default = model.id == preferred;
    }
    Some(AvailableModelsResult {
        models,
        default_model_id: preferred,
        origin,
        fetched_at,
    })
}

/// Models the user can select in the composer.
///
/// Live ACP `_meta.modelState` is the complete authoritative snapshot. Before
/// an ACP handshake succeeds, use only `~/.supercharge/models_cache.json` plus
/// `[models].default` from the matching `config.toml`.
pub fn list_available_models() -> AvailableModelsResult {
    let live = LIVE_MODELS.lock().expect("LIVE_MODELS poisoned").clone();
    let live_seen = *LIVE_MODEL_STATE_SEEN
        .lock()
        .expect("LIVE_MODEL_STATE_SEEN poisoned");
    if live_seen {
        let live_default = LIVE_DEFAULT_MODEL_ID
            .lock()
            .expect("LIVE_DEFAULT_MODEL_ID poisoned")
            .clone();
        let preferred = preferred_model_id(&live, live_default.as_deref());
        let mut models: Vec<AvailableModel> = live.into_values().collect();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        for model in &mut models {
            model.is_default = model.id == preferred;
        }
        return AvailableModelsResult {
            models,
            default_model_id: preferred,
            origin: Some("acp".into()),
            fetched_at: None,
        };
    }

    let home = user_supercharge_home();
    if let Some(result) = cache_result(&home) {
        return result;
    }

    AvailableModelsResult {
        models: Vec::new(),
        default_model_id: String::new(),
        origin: None,
        fetched_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "supercharge-models-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn configured_default_reads_only_models_default() {
        let dir = unique_temp_dir("configured-default");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config.toml"),
            r#"default = "wrong-root"

[model.demo]
default = "wrong-model"

[models] # active catalog
default_model = "wrong-key"
default = "configured-model"
"#,
        )
        .unwrap();
        assert_eq!(
            configured_default_model(&dir).as_deref(),
            Some("configured-model")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_result_uses_configured_default_and_preserves_all_models() {
        let dir = unique_temp_dir("cold-start");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("models_cache.json"),
            r#"{
              "origin": "https://provider.example/v1/models",
              "models": {
                "alpha": { "info": { "name": "Alpha", "context_window": "131072" } },
                "beta": { "info": { "name": "Beta", "context_window": 262144 } }
              }
            }"#,
        )
        .unwrap();
        fs::write(dir.join("config.toml"), "[models]\ndefault = 'beta'\n").unwrap();

        let result = cache_result(&dir).expect("cache result");
        assert_eq!(result.default_model_id, "beta");
        assert_eq!(result.models.len(), 2);
        assert_eq!(result.models[0].source, "cache");
        assert_eq!(result.models[0].context_window, Some(131_072));
        assert!(result.models[1].is_default);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn live_snapshot_replaces_stale_entries_and_default() {
        let stale = AvailableModel {
            id: "stale".into(),
            label: "Stale".into(),
            source: "live".into(),
            is_default: true,
            reasoning_efforts: Vec::new(),
            context_window: Some(1),
        };
        merge_live_models(vec![stale], Some("stale".into()));
        let fresh = AvailableModel {
            id: "fresh".into(),
            label: "Fresh model".into(),
            source: "ignored".into(),
            is_default: false,
            reasoning_efforts: Vec::new(),
            context_window: Some(262_144),
        };
        merge_live_models(vec![fresh], Some("fresh".into()));

        let live = LIVE_MODELS.lock().expect("not poisoned");
        assert!(!live.contains_key("stale"));
        assert_eq!(live.get("fresh").map(|m| m.source.as_str()), Some("live"));
        drop(live);
        assert_eq!(
            LIVE_DEFAULT_MODEL_ID
                .lock()
                .expect("not poisoned")
                .as_deref(),
            Some("fresh")
        );
    }

    #[test]
    fn read_cache_parses_model_entry() {
        let dir = unique_temp_dir("cache-entry");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "fetched_at": "2026-07-23T00:00:00Z",
              "origin": "https://provider.example/v1/models",
              "models": {
                "grok-4.5": {
                  "info": { "id": "grok-4.5", "name": "Grok 4.5", "hidden": false }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, origin, _) = read_models_cache(&path).expect("cache");
        assert_eq!(
            map.get("grok-4.5").map(|m| m.label.as_str()),
            Some("Grok 4.5")
        );
        assert!(map
            .get("grok-4.5")
            .map(|m| m.reasoning_efforts.is_empty())
            .unwrap_or(false));
        assert_eq!(
            origin.as_deref(),
            Some("https://provider.example/v1/models")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_reasoning_efforts_from_cache_pointer() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{
              "info": {
                "reasoning_efforts": [
                  {
                    "id": "high",
                    "value": "high",
                    "label": "High Effort",
                    "description": "Highest quality",
                    "default": true
                  },
                  {
                    "id": "medium",
                    "value": "medium",
                    "label": "Medium Effort",
                    "description": "Balanced",
                    "default": false
                  },
                  {
                    "id": "low",
                    "value": "low",
                    "label": "Low Effort",
                    "description": "Quick",
                    "default": false
                  }
                ]
              }
            }"#,
        )
        .unwrap();
        let efforts = parse_reasoning_efforts(&body);
        assert_eq!(efforts.len(), 3);
        assert_eq!(efforts[0].id, "high");
        assert_eq!(efforts[0].value, "high");
        assert_eq!(efforts[0].label, "High Effort");
        assert_eq!(efforts[0].description, "Highest quality");
        assert!(efforts[0].is_default);
        assert!(!efforts[1].is_default);
        assert_eq!(efforts[2].id, "low");
    }

    #[test]
    fn parse_reasoning_efforts_keeps_first_declared_default() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{
              "info": {
                "reasoning_efforts": [
                  {
                    "id": "high",
                    "value": "high",
                    "label": "High Effort",
                    "default": true
                  },
                  {
                    "id": "xhigh",
                    "value": "xhigh",
                    "label": "Extra High Effort",
                    "default": true
                  },
                  {
                    "id": "medium",
                    "value": "medium",
                    "label": "Medium Effort",
                    "default": false
                  }
                ]
              }
            }"#,
        )
        .unwrap();
        let efforts = parse_reasoning_efforts(&body);
        assert_eq!(efforts.len(), 3);
        assert_eq!(efforts[0].id, "high");
        assert!(efforts[0].is_default);
        assert_eq!(efforts[1].id, "xhigh");
        assert!(!efforts[1].is_default);
        assert!(!efforts[2].is_default);
    }

    #[test]
    fn parse_reasoning_efforts_skips_empty_id() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{
              "info": {
                "reasoning_efforts": [
                  { "id": "", "value": "x", "label": "X" },
                  { "id": "medium", "label": "Med" }
                ]
              }
            }"#,
        )
        .unwrap();
        let efforts = parse_reasoning_efforts(&body);
        assert_eq!(efforts.len(), 1);
        assert_eq!(efforts[0].id, "medium");
        assert_eq!(efforts[0].value, "medium");
        assert_eq!(efforts[0].label, "Med");
    }

    #[test]
    fn read_cache_includes_reasoning_efforts() {
        let dir = unique_temp_dir("efforts");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "fetched_at": "2026-07-25T00:00:00Z",
              "origin": "https://provider.example/v1/models",
              "models": {
                "grok-4.5": {
                  "info": {
                    "id": "grok-4.5",
                    "name": "Grok 4.5",
                    "hidden": false,
                    "reasoning_efforts": [
                      {
                        "id": "high",
                        "value": "high",
                        "label": "High Effort",
                        "description": "Deep",
                        "default": true
                      }
                    ]
                  }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, _, _) = read_models_cache(&path).expect("cache");
        let m = map.get("grok-4.5").expect("model");
        assert_eq!(m.reasoning_efforts.len(), 1);
        assert_eq!(m.reasoning_efforts[0].id, "high");
        assert!(m.reasoning_efforts[0].is_default);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_cache_parses_context_window_total_tokens() {
        let dir = unique_temp_dir("context-window");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "models": {
                "grok-4.5": {
                  "info": { "name": "Grok 4.5", "totalContextTokens": 256000 }
                },
                "grok-4": {
                  "info": { "name": "Grok 4", "context_window": 128000 }
                },
                "grok-mini": {
                  "info": { "name": "Grok Mini" }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, _, _) = read_models_cache(&path).expect("cache");
        assert_eq!(
            map.get("grok-4.5").and_then(|m| m.context_window),
            Some(256000)
        );
        assert_eq!(
            map.get("grok-4").and_then(|m| m.context_window),
            Some(128000)
        );
        assert_eq!(map.get("grok-mini").and_then(|m| m.context_window), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
