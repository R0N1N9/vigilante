//! Outgoing alert webhooks (Slack, Discord, Microsoft Teams, or plain JSON).
//! The user pastes the URL in Settings; only https to a named host is allowed,
//! never an IP address or a local network name.

use serde_json::json;

pub fn check_webhook_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|e| format!("bad webhook URL: {e}"))?;
    if url.scheme() != "https" {
        return Err("webhook must use https".into());
    }
    match url.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            if d == "localhost" || d.ends_with(".local") || d.ends_with(".internal") || d.ends_with(".lan") || !d.contains('.') {
                return Err("webhook host must be a public domain".into());
            }
        }
        _ => return Err("webhook host must be a domain name, not an IP address".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("webhook URL must not contain a username or password".into());
    }
    Ok(url)
}

/// Shape the message for the chat service the URL belongs to.
pub fn webhook_body(format: &str, title: &str, message: &str, severity: u8, link: Option<&str>) -> serde_json::Value {
    let level = ["INFO", "INFO", "WARNING", "SERIOUS", "CRITICAL"][severity.min(4) as usize];
    let text = match link {
        Some(l) => format!("[{level}] {title}\n{message}\n{l}"),
        None => format!("[{level}] {title}\n{message}"),
    };
    match format {
        "slack" => json!({ "text": text }),
        "discord" => json!({ "content": text.chars().take(1900).collect::<String>(), "username": "Vigilante" }),
        "teams" => json!({ "text": text.replace('\n', "  \n") }),
        _ => json!({ "source": "vigilante", "title": title, "message": message, "severity": severity, "level": level, "url": link }),
    }
}

#[tauri::command]
pub async fn webhook_send(
    url: String,
    format: String,
    title: String,
    message: String,
    severity: u8,
    link: Option<String>,
) -> Result<(), String> {
    let url = check_webhook_url(&url)?;
    let link = link.filter(|l| l.starts_with("https://"));
    // Own client: no redirects, so a webhook can't bounce the alert somewhere else.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Vigilante/0.1 (alert webhook)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(url)
        .json(&webhook_body(&format, &title, &message, severity, link.as_deref()))
        .send()
        .await
        .map_err(|e| format!("send failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("webhook answered HTTP {}", resp.status()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_https_only() {
        assert!(check_webhook_url("https://hooks.slack.com/services/T/B/x").is_ok());
        assert!(check_webhook_url("https://discord.com/api/webhooks/1/abc").is_ok());
        assert!(check_webhook_url("http://hooks.slack.com/x").is_err());
        assert!(check_webhook_url("https://127.0.0.1/x").is_err());
        assert!(check_webhook_url("https://[::1]/x").is_err());
        assert!(check_webhook_url("https://localhost/x").is_err());
        assert!(check_webhook_url("https://printer.local/x").is_err());
        assert!(check_webhook_url("https://user:pw@example.com/x").is_err());
    }

    #[test]
    fn formats_per_service() {
        assert_eq!(webhook_body("slack", "T", "M", 4, None)["text"], "[CRITICAL] T\nM");
        assert!(webhook_body("discord", "T", "M", 2, Some("https://x.y"))["content"].as_str().unwrap().contains("https://x.y"));
        assert_eq!(webhook_body("json", "T", "M", 3, None)["level"], "SERIOUS");
    }
}
