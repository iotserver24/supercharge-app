use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct SkillMdSearchItem {
    pub slug: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub title: String,
    pub description: String,
    pub category: Option<String>,
    pub agents: Vec<String>,
    pub verified: bool,
    #[serde(rename = "rawUrl")]
    pub raw_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SkillMdSearchResponse {
    pub items: Vec<SkillMdSearchItem>,
}

#[tauri::command]
pub async fn skillmd_search(query: String) -> Result<SkillMdSearchResponse, String> {
    let query = query.trim().to_owned();
    if query.chars().count() < 2 || query.chars().count() > 100 {
        return Ok(SkillMdSearchResponse { items: Vec::new() });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Supercharge/0.2.48")
        .build()
        .map_err(|error| format!("SkillMD client error: {error}"))?;
    let response = client
        .get("https://api.skillmd.com/v1/search")
        .query(&[("q", &query)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("SkillMD search failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("SkillMD search failed ({})", response.status()));
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("SkillMD response failed: {error}"))?;
    if body.len() > 512 * 1024 {
        return Err("SkillMD response is too large".to_owned());
    }
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Invalid SkillMD response: {error}"))?;
    let items = payload
        .get("items")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let slug = value.get("slug")?.as_str()?.trim();
                    let title = value.get("title")?.as_str()?.trim();
                    let item_type = value.get("type")?.as_str()?;
                    if slug.is_empty()
                        || title.is_empty()
                        || !matches!(item_type, "single" | "pack")
                    {
                        return None;
                    }
                    let raw_url = value
                        .get("raw_url")
                        .and_then(serde_json::Value::as_str)
                        .filter(|url| url.starts_with("https://"));
                    let agents = value
                        .get("agents")
                        .and_then(serde_json::Value::as_str)
                        .map(|agents| {
                            agents
                                .split(',')
                                .map(str::trim)
                                .filter(|agent| !agent.is_empty())
                                .map(ToOwned::to_owned)
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(SkillMdSearchItem {
                        slug: slug.to_owned(),
                        item_type: item_type.to_owned(),
                        title: title.to_owned(),
                        description: value
                            .get("description")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("No description provided.")
                            .to_owned(),
                        category: value
                            .get("category")
                            .and_then(serde_json::Value::as_str)
                            .map(ToOwned::to_owned),
                        agents,
                        verified: value
                            .get("verified")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                        raw_url: raw_url.map(ToOwned::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SkillMdSearchResponse { items })
}
