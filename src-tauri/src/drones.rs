//! Bluetooth Remote ID receiver.
//!
//! Drones broadcast FAA Remote ID (ASTM F3411 / Open Drone ID) as Bluetooth
//! advertisements with service data under UUID 0xFFFA. We scan passively and
//! forward the raw bytes to the UI, which decodes them (see src/lib/odid.ts).
//! Range is short (roughly a few hundred meters) and drones that broadcast
//! only over Wi-Fi are not visible this way.

use btleplug::api::bleuuid::uuid_from_u16;
use btleplug::api::{Central, CentralEvent, Manager as _, ScanFilter};
use btleplug::platform::Manager;
use futures::StreamExt;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

#[derive(Clone, Serialize)]
pub struct RawRemoteId {
    pub device: String,
    pub data: String, // hex
    pub at: u64,      // epoch ms
}

#[derive(Default)]
pub struct DroneScanner {
    stop: Mutex<Option<watch::Sender<bool>>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn scan(app: AppHandle, mut stop: watch::Receiver<bool>) -> Result<(), String> {
    let manager = Manager::new().await.map_err(|e| format!("bluetooth unavailable: {e}"))?;
    let central = manager
        .adapters()
        .await
        .map_err(|e| format!("no bluetooth adapter: {e}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "no bluetooth adapter found".to_string())?;
    let mut events = central.events().await.map_err(|e| e.to_string())?;
    central.start_scan(ScanFilter::default()).await.map_err(|e| format!("scan failed: {e}"))?;
    let _ = app.emit("drones:status", "scanning");
    let rid = uuid_from_u16(0xFFFA);
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            ev = events.next() => {
                let Some(ev) = ev else { break };
                if let CentralEvent::ServiceDataAdvertisement { id, service_data } = ev {
                    if let Some(data) = service_data.get(&rid) {
                        let _ = app.emit("drones:raw", RawRemoteId { device: id.to_string(), data: to_hex(data), at: now_ms() });
                    }
                }
            }
        }
    }
    let _ = central.stop_scan().await;
    Ok(())
}

#[tauri::command]
pub fn drones_start(app: AppHandle, state: tauri::State<'_, DroneScanner>) -> Result<(), String> {
    let mut guard = state.stop.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let (tx, rx) = watch::channel(false);
    *guard = Some(tx);
    tauri::async_runtime::spawn(async move {
        let result = scan(app.clone(), rx).await;
        let status = match result {
            Ok(()) => "stopped".to_string(),
            Err(e) => format!("error: {e}"),
        };
        let _ = app.emit("drones:status", status);
    });
    Ok(())
}

#[tauri::command]
pub fn drones_stop(state: tauri::State<'_, DroneScanner>) -> Result<(), String> {
    if let Some(tx) = state.stop.lock().map_err(|e| e.to_string())?.take() {
        let _ = tx.send(true);
    }
    Ok(())
}
