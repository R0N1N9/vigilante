//! Ships via AISstream.io (free key, https://aisstream.io).
//!
//! AISstream only accepts WebSocket connections from servers, not browsers
//! (to protect the key), so the Rust core holds the connection, subscribes to
//! a bounding box around the watched area and forwards each JSON message to
//! the UI as an `ais:msg` event.

use futures::{SinkExt, StreamExt};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

const URL: &str = "wss://stream.aisstream.io/v0/stream";

#[derive(Default)]
pub struct AisStream {
    stop: Mutex<Option<watch::Sender<bool>>>,
}

fn subscription(key: &str, bbox: [f64; 4]) -> String {
    let [west, south, east, north] = bbox;
    serde_json::json!({
        "APIKey": key,
        "BoundingBoxes": [[[south, west], [north, east]]],
        "FilterMessageTypes": ["PositionReport", "ShipStaticData", "StandardClassBPositionReport"]
    })
    .to_string()
}

async fn run(app: &AppHandle, key: String, bbox: [f64; 4], mut stop: watch::Receiver<bool>) -> Result<(), String> {
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.map_err(|e| format!("connect failed: {e}"))?;
    ws.send(Message::Text(subscription(&key, bbox).into())).await.map_err(|e| e.to_string())?;
    let _ = app.emit("ais:status", "connected");
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            msg = ws.next() => match msg {
                Some(Ok(Message::Text(t))) => { let _ = app.emit("ais:msg", t.to_string()); }
                Some(Ok(Message::Binary(b))) => { let _ = app.emit("ais:msg", String::from_utf8_lossy(&b).to_string()); }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(format!("stream error: {e}")),
                None => return Err("stream closed by server (check the API key)".into()),
            }
        }
    }
    let _ = ws.close(None).await;
    Ok(())
}

/// Start (or restart) the stream for a bounding box [west, south, east, north].
#[tauri::command]
pub fn ais_start(app: AppHandle, key: String, bbox: [f64; 4], state: tauri::State<'_, AisStream>) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("no AISstream key".into());
    }
    let mut guard = state.stop.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        let _ = old.send(true);
    }
    let (tx, rx) = watch::channel(false);
    *guard = Some(tx);
    tauri::async_runtime::spawn(async move {
        let status = match run(&app, key, bbox, rx).await {
            Ok(()) => "stopped".to_string(),
            Err(e) => format!("error: {e}"),
        };
        let _ = app.emit("ais:status", status);
    });
    Ok(())
}

#[tauri::command]
pub fn ais_stop(state: tauri::State<'_, AisStream>) -> Result<(), String> {
    if let Some(tx) = state.stop.lock().map_err(|e| e.to_string())?.take() {
        let _ = tx.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn subscription_uses_lat_lon_corner_order() {
        let s = super::subscription("k", [-81.5, 31.8, -80.7, 32.3]);
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["BoundingBoxes"][0][0], serde_json::json!([31.8, -81.5]));
        assert_eq!(v["BoundingBoxes"][0][1], serde_json::json!([32.3, -80.7]));
        assert_eq!(v["APIKey"], "k");
    }
}
