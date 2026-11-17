//! Vigilante desktop core.
//!
//! The core stays thin: it fetches data for the webview (so the UI is not
//! subject to browser CORS rules), sends phone alerts through ntfy, keeps small
//! JSON files (settings, watch areas, history) in the app data folder, scans for
//! drone Remote ID over Bluetooth, remembers window positions per monitor, and
//! closes every pop-out window when the main console closes.

mod drones;
mod wifi_rid;
mod ais;
mod ai;
mod webhook;
mod mesh;

use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Manager, WindowEvent};

const USER_AGENT: &str = concat!(
    "Vigilante/",
    env!("CARGO_PKG_VERSION"),
    " (neighborhood awareness console; github.com/r0n1n9/vigilante)"
);

/// Shared with the browser dev proxy: config/hosts.json.
const HOSTS_JSON: &str = include_str!("../../config/hosts.json");

fn allowed_hosts() -> &'static Vec<String> {
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    HOSTS.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(HOSTS_JSON).expect("config/hosts.json is valid JSON");
        v["get"]
            .as_array()
            .map(|a| a.iter().filter_map(|h| h.as_str().map(str::to_owned)).collect())
            .unwrap_or_default()
    })
}

fn host_allowed(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "https" && allowed_hosts().iter().any(|h| h == host)
}

fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("bad url: {e}"))?;
    if !host_allowed(&parsed) {
        return Err(format!("host not allowed: {}", parsed.host_str().unwrap_or_default()));
    }
    Ok(parsed)
}

/// Request headers the UI may set (API keys for services that require them in a header).
const ALLOWED_HEADERS: &[&str] = &[];

/// GET an allow-listed HTTPS URL and return the body as text.
#[tauri::command]
async fn http_get(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<String, String> {
    let parsed = check_url(&url)?;
    let mut req = client
        .get(parsed)
        .header("Accept", "application/geo+json, application/json, application/rss+xml, application/xml, text/xml, */*");
    for (k, v) in headers.unwrap_or_default() {
        let k = k.to_ascii_lowercase();
        if !ALLOWED_HEADERS.contains(&k.as_str()) {
            return Err(format!("header not allowed: {k}"));
        }
        req = req.header(k, v);
    }
    let resp = req
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

/// GET an allow-listed HTTPS URL and return raw bytes (GTFS-Realtime protobuf, GTFS zip files).
#[tauri::command]
async fn http_get_bytes(url: String, client: tauri::State<'_, reqwest::Client>) -> Result<tauri::ipc::Response, String> {
    let parsed = check_url(&url)?;
    let resp = client.get(parsed).send().await.map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("read failed: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// Send a phone notification through an ntfy server (https://ntfy.sh or self-hosted).
#[tauri::command]
async fn ntfy_send(
    server: String,
    topic: String,
    title: String,
    message: String,
    priority: u8,
    tags: String,
    click: Option<String>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<(), String> {
    let base = reqwest::Url::parse(server.trim_end_matches('/')).map_err(|e| format!("bad server: {e}"))?;
    if base.scheme() != "https" {
        return Err("ntfy server must use https".into());
    }
    if topic.is_empty() || !topic.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("topic may only contain letters, numbers, - and _".into());
    }
    let url = base.join(&format!("/{topic}")).map_err(|e| e.to_string())?;
    let mut req = client
        .post(url)
        .header("Title", title.replace(['\r', '\n'], " "))
        .header("Priority", priority.clamp(1, 5).to_string())
        .header("Tags", tags);
    if let Some(c) = click.filter(|c| c.starts_with("https://")) {
        req = req.header("Click", c);
    }
    let resp = req.body(message).send().await.map_err(|e| format!("send failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ntfy answered HTTP {}", resp.status()));
    }
    Ok(())
}

fn store_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("bad store name".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

/// Read a small JSON document from the app data folder (None if it does not exist yet).
#[tauri::command]
fn store_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = store_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write a small JSON document atomically (write temp file, then rename).
#[tauri::command]
fn store_write(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    let path = store_path(&app, &name)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(60))
        // Follow redirects only to other allow-listed hosts (data portals often redirect to a CDN).
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !host_allowed(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(client)
        .manage(drones::DroneScanner::default())
        .manage(wifi_rid::WifiScanner::default())
        .manage(ais::AisStream::default())
        .manage(mesh::MeshLink::default())
        .invoke_handler(tauri::generate_handler![
            http_get,
            http_get_bytes,
            ntfy_send,
            store_read,
            store_write,
            drones::drones_start,
            drones::drones_stop,
            wifi_rid::wifi_rid_start,
            wifi_rid::wifi_rid_stop,
            ais::ais_start,
            ais::ais_stop,
            ai::ai_brief,
            webhook::webhook_send,
            mesh::mesh_connect,
            mesh::mesh_send,
            mesh::mesh_disconnect,
            mesh::mesh_serial_ports
        ])
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
        assert!(check_url("https://tfr.faa.gov/tfrapi/exportTfrList").is_ok());
        assert!(check_url("https://www.11alive.com/feeds/syndication/rss/news/local").is_ok());
    }

    #[test]
    fn rejects_other_hosts_and_schemes() {
        assert!(check_url("https://example.com/").is_err());
        assert!(check_url("http://api.adsb.lol/v2").is_err());
        assert!(check_url("https://api.adsb.lol.evil.com/").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
    }
}
