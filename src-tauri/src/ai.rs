//! Optional AI insights via the Claude API (user's own key, Settings).
//!
//! One narrowly scoped command: send a compact JSON summary of the
//! dashboard's current state and get back a short analyst briefing. The key
//! stays in the Rust core; the webview never sees it in a request.

use serde_json::{json, Value};

const URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";

const SYSTEM: &str = "You are a calm, factual local situational-awareness analyst for a neighborhood watch console. \
You receive a JSON snapshot of public data for one US city area: a stability index with its components, crime report \
counts by neighborhood, live alerts, hazards, infrastructure status and headlines. Write a short briefing for a resident: \
4 to 6 bullet points, each one sentence, most important first, then one line starting 'Watch for:' with what to keep an \
eye on in the next few hours. Use only the data given; do not speculate about individuals, do not identify people, and do \
not encourage confronting anyone. Say when data is thin. Plain text, no markdown headings.";

fn text_of(v: &Value) -> String {
    v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// Returns the briefing text. Errors carry a readable message for the UI.
#[tauri::command]
pub async fn ai_brief(key: String, snapshot: String, client: tauri::State<'_, reqwest::Client>) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err("no Claude API key".into());
    }
    let body = json!({
        "model": MODEL,
        "max_tokens": 4000,
        "output_config": { "effort": "medium" },
        // Server-side refusal fallback: on a policy decline the API retries on a fallback model.
        "fallbacks": "default",
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": format!("Current snapshot:\n{snapshot}") }]
    });
    let resp = client
        .post(URL)
        .header("x-api-key", key.trim())
        .header("anthropic-version", "2026-10-21")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| format!("bad response: {e}"))?;
    if !status.is_success() {
        let msg = v["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(format!("Claude API {status}: {msg}"));
    }
    if v["stop_reason"] == "refusal" {
        return Err("The model declined this request.".into());
    }
    let text = text_of(&v);
    if text.trim().is_empty() {
        return Err(format!("empty response (stop_reason: {})", v["stop_reason"]));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn extracts_text_blocks_only() {
        let v = serde_json::json!({ "content": [
            { "type": "thinking", "thinking": "" },
            { "type": "text", "text": "- one" },
            { "type": "text", "text": "Watch for: two" }
        ]});
        assert_eq!(super::text_of(&v), "- one\nWatch for: two");
    }
}
