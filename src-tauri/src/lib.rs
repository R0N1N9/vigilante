//! Vigilante desktop core.
//!
//! Phase 0 keeps the core thin: it fetches data for the webview (so the UI is not
//! subject to browser CORS rules), remembers window positions per monitor via the
//! window-state plugin, and closes every pop-out window when the main console closes.

use std::time::Duration;
use tauri::{Manager, WindowEvent};

/// Hosts the UI may fetch through the core. Keep in sync with `src/lib/hosts.ts`.
const ALLOWED_HOSTS: &[&str] = &["api.adsb.lol", "api.weather.gov"];

const USER_AGENT: &str = concat!(
    "Vigilante/",
    env!("CARGO_PKG_VERSION"),
    " (neighborhood awareness console; github.com/r0n1n9/vigilante)"
);

fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("bad url: {e}"))?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https" || !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("host not allowed: {host}"));
    }
    Ok(parsed)
}

/// GET an allow-listed HTTPS URL and return the body as text.
#[tauri::command]
async fn http_get(url: String, client: tauri::State<'_, reqwest::Client>) -> Result<String, String> {
    let parsed = check_url(&url)?;
    let resp = client
        .get(parsed)
        .header("Accept", "application/geo+json, application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    Ok(body)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(client)
        .invoke_handler(tauri::generate_handler![http_get])
        .on_window_event(|window, event| {
            // Closing the main console closes the whole app, pop-outs included.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Vigilante");
}

#[cfg(test)]
mod tests {
    use super::check_url;

    #[test]
    fn allows_known_https_hosts() {
        assert!(check_url("https://api.adsb.lol/v2/point/1/2/3").is_ok());
        assert!(check_url("https://api.weather.gov/alerts/active?point=1,2").is_ok());
    }

    #[test]
    fn rejects_other_hosts_and_schemes() {
        assert!(check_url("https://example.com/").is_err());
        assert!(check_url("http://api.adsb.lol/v2").is_err());
        assert!(check_url("https://api.adsb.lol.evil.com/").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
    }
}
