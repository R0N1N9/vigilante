//! Meshtastic radio link.
//!
//! Connects to one Meshtastic node over Bluetooth LE, a USB serial cable, or
//! the node's Wi-Fi HTTP API, and shuttles raw protobuf frames: ToRadio bytes
//! go out, FromRadio bytes come back as `mesh:rx` events. Encoding and
//! decoding live in TypeScript (src/lib/meshproto.ts).
//!
//! UUIDs, serial framing and HTTP paths follow the official Meshtastic
//! JavaScript transports.

use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;

const SERVICE: Uuid = Uuid::from_u128(0x6ba1b218_15a8_461f_9fa8_5dcae273eafd);
const TO_RADIO: Uuid = Uuid::from_u128(0xf75c76d2_129e_4dad_a1dd_7866124401e7);
const FROM_RADIO: Uuid = Uuid::from_u128(0x2c55e69e_4993_11ed_b878_0242ac120002);
const FROM_NUM: Uuid = Uuid::from_u128(0xed9da18c_a800_4f66_a670_aa7547e34453);
const MAX_FRAME: usize = 512;

enum Cmd {
    Send(Vec<u8>),
    Stop,
}

#[derive(Default)]
pub struct MeshLink {
    tx: Mutex<Option<mpsc::UnboundedSender<Cmd>>>,
}

#[derive(Clone, Serialize)]
struct Status {
    state: &'static str,
    detail: String,
}

fn status(app: &AppHandle, state: &'static str, detail: impl Into<String>) {
    let _ = app.emit("mesh:status", Status { state, detail: detail.into() });
}

// ---------- Serial framing: 0x94 0xC3 <len hi> <len lo> <protobuf> ----------

pub fn frame(payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0x94, 0xC3, (payload.len() >> 8) as u8, payload.len() as u8];
    out.extend_from_slice(payload);
    out
}

/// Pull complete frames out of `buf`, leaving any partial frame. Text between
/// frames is the node's debug log and is dropped.
pub fn deframe(buf: &mut Vec<u8>) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let Some(start) = buf.windows(2).position(|w| w == [0x94, 0xC3]) else {
            // Keep a trailing 0x94 in case its partner arrives next.
            let keep = usize::from(buf.last() == Some(&0x94));
            buf.drain(..buf.len() - keep);
            break;
        };
        buf.drain(..start);
        if buf.len() < 4 {
            break;
        }
        let len = ((buf[2] as usize) << 8) | buf[3] as usize;
        if len > MAX_FRAME {
            buf.drain(..2); // corrupt header: skip it and resync
            continue;
        }
        if buf.len() < 4 + len {
            break;
        }
        out.push(buf[4..4 + len].to_vec());
        buf.drain(..4 + len);
    }
    out
}

// ---------- Address checks ----------

/// The Wi-Fi API is only for radios on your own network: private, loopback or
/// link-local IPs, or local names (meshtastic.local, a bare hostname).
pub fn check_lan_host(host: &str) -> Result<String, String> {
    let h = host.trim().trim_start_matches("http://").trim_end_matches('/').to_ascii_lowercase();
    if h.is_empty() || h.contains('/') || h.contains('@') {
        return Err("enter just the radio's address, e.g. meshtastic.local or 192.168.1.50".into());
    }
    let bare = h.split(':').next().unwrap_or("");
    if let Ok(ip) = bare.parse::<std::net::Ipv4Addr>() {
        if ip.is_private() || ip.is_loopback() || ip.is_link_local() {
            return Ok(h);
        }
        return Err("the radio must be on your local network".into());
    }
    if bare.ends_with(".local") || bare.ends_with(".lan") || bare.ends_with(".home.arpa") || (!bare.contains('.') && !bare.is_empty()) {
        return Ok(h);
    }
    Err("use the radio's local IP address or its .local name".into())
}

// ---------- Transports ----------

async fn run_ble(app: AppHandle, address: String, mut rx: mpsc::UnboundedReceiver<Cmd>) -> Result<(), String> {
    let manager = Manager::new().await.map_err(|e| format!("bluetooth unavailable: {e}"))?;
    let central = manager.adapters().await.map_err(|e| e.to_string())?.into_iter().next().ok_or("no bluetooth adapter found")?;
    central.start_scan(ScanFilter { services: vec![SERVICE] }).await.map_err(|e| format!("scan failed: {e}"))?;
    let mut found: Option<Peripheral> = None;
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        for p in central.peripherals().await.map_err(|e| e.to_string())? {
            let id = p.id().to_string();
            let name = p.properties().await.ok().flatten().and_then(|x| x.local_name).unwrap_or_default();
            let is_mesh = p.properties().await.ok().flatten().map(|x| x.services.contains(&SERVICE)).unwrap_or(false);
            if is_mesh && (address.is_empty() || id == address || name == address) {
                found = Some(p);
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }
    let _ = central.stop_scan().await;
    let p = found.ok_or("no Meshtastic radio found nearby (is Bluetooth on, and is the radio paired or in range?)")?;
    p.connect().await.map_err(|e| format!("connect failed: {e}"))?;
    p.discover_services().await.map_err(|e| e.to_string())?;
    let chars = p.characteristics();
    let get = |u: Uuid| -> Result<Characteristic, String> { chars.iter().find(|c| c.uuid == u).cloned().ok_or_else(|| "radio is missing the Meshtastic service".to_string()) };
    let (to, from, num) = (get(TO_RADIO)?, get(FROM_RADIO)?, get(FROM_NUM)?);
    p.subscribe(&num).await.map_err(|e| e.to_string())?;
    let mut notes = p.notifications().await.map_err(|e| e.to_string())?;
    let name = p.properties().await.ok().flatten().and_then(|x| x.local_name).unwrap_or_else(|| "radio".into());
    status(&app, "connected", format!("Bluetooth · {name}"));

    async fn drain(app: &AppHandle, p: &Peripheral, from: &Characteristic) -> Result<(), String> {
        for _ in 0..64 {
            let v = p.read(from).await.map_err(|e| format!("read failed: {e}"))?;
            if v.is_empty() {
                break;
            }
            let _ = app.emit("mesh:rx", v);
        }
        Ok(())
    }
    let mut tick = tokio::time::interval(Duration::from_secs(3));
    loop {
        tokio::select! {
            cmd = rx.recv() => match cmd {
                Some(Cmd::Send(bytes)) => {
                    p.write(&to, &bytes, WriteType::WithResponse).await.map_err(|e| format!("write failed: {e}"))?;
                    drain(&app, &p, &from).await?;
                }
                _ => break,
            },
            n = notes.next() => {
                if n.is_none() { return Err("radio disconnected".into()); }
                drain(&app, &p, &from).await?;
            }
            _ = tick.tick() => drain(&app, &p, &from).await?,
        }
    }
    let _ = p.disconnect().await;
    Ok(())
}

fn run_serial(app: AppHandle, path: String, mut rx: mpsc::UnboundedReceiver<Cmd>) -> Result<(), String> {
    let mut port = serialport::new(&path, 115_200).timeout(Duration::from_millis(100)).open().map_err(|e| format!("can't open {path}: {e}"))?;
    status(&app, "connected", format!("USB · {path}"));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match rx.try_recv() {
            Ok(Cmd::Send(bytes)) => port.write_all(&frame(&bytes)).map_err(|e| format!("write failed: {e}"))?,
            Ok(Cmd::Stop) | Err(mpsc::error::TryRecvError::Disconnected) => break,
            Err(mpsc::error::TryRecvError::Empty) => {}
        }
        match port.read(&mut chunk) {
            Ok(0) => {}
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                for f in deframe(&mut buf) {
                    let _ = app.emit("mesh:rx", f);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(format!("radio disconnected: {e}")),
        }
    }
    Ok(())
}

async fn run_http(app: AppHandle, host: String, mut rx: mpsc::UnboundedReceiver<Cmd>) -> Result<(), String> {
    let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?;
    let base = format!("http://{host}/api/v1");
    let poll = |c: reqwest::Client, url: String| async move {
        let r = c.get(url).header("Accept", "application/x-protobuf").send().await.map_err(|e| format!("radio unreachable: {e}"))?;
        if !r.status().is_success() {
            return Err(format!("radio answered HTTP {}", r.status()));
        }
        r.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
    };
    // First contact proves the address is a Meshtastic radio.
    poll(client.clone(), format!("{base}/fromradio?all=false")).await?;
    status(&app, "connected", format!("Wi-Fi · {host}"));
    let mut tick = tokio::time::interval(Duration::from_millis(1500));
    loop {
        tokio::select! {
            cmd = rx.recv() => match cmd {
                Some(Cmd::Send(bytes)) => {
                    let r = client.put(format!("{base}/toradio")).header("Content-Type", "application/x-protobuf").body(bytes).send().await.map_err(|e| format!("send failed: {e}"))?;
                    if !r.status().is_success() { return Err(format!("radio answered HTTP {}", r.status())); }
                }
                _ => break,
            },
            _ = tick.tick() => {
                for _ in 0..64 {
                    let v = poll(client.clone(), format!("{base}/fromradio?all=false")).await?;
                    if v.is_empty() { break; }
                    let _ = app.emit("mesh:rx", v);
                }
            }
        }
    }
    Ok(())
}

// ---------- Commands ----------

#[tauri::command]
pub fn mesh_connect(app: AppHandle, state: tauri::State<'_, MeshLink>, transport: String, address: String) -> Result<(), String> {
    let mut guard = state.tx.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        let _ = old.send(Cmd::Stop);
    }
    let (tx, rx) = mpsc::unbounded_channel();
    *guard = Some(tx);
    status(&app, "connecting", transport.clone());
    let done = |app: AppHandle, r: Result<(), String>| match r {
        Ok(()) => status(&app, "disconnected", ""),
        Err(e) => status(&app, "error", e),
    };
    match transport.as_str() {
        "ble" => {
            tauri::async_runtime::spawn(async move {
                let r = run_ble(app.clone(), address, rx).await;
                done(app, r);
            });
        }
        "http" => {
            let host = check_lan_host(&address)?;
            tauri::async_runtime::spawn(async move {
                let r = run_http(app.clone(), host, rx).await;
                done(app, r);
            });
        }
        "serial" => {
            if address.trim().is_empty() {
                return Err("choose the radio's serial port".into());
            }
            std::thread::spawn(move || {
                let r = run_serial(app.clone(), address, rx);
                done(app, r);
            });
        }
        _ => return Err("unknown connection type".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn mesh_send(state: tauri::State<'_, MeshLink>, data: Vec<u8>) -> Result<(), String> {
    if data.len() > MAX_FRAME {
        return Err("message too large for the radio".into());
    }
    let guard = state.tx.lock().map_err(|e| e.to_string())?;
    guard.as_ref().ok_or("radio not connected")?.send(Cmd::Send(data)).map_err(|_| "radio not connected".to_string())
}

#[tauri::command]
pub fn mesh_disconnect(state: tauri::State<'_, MeshLink>) -> Result<(), String> {
    if let Some(tx) = state.tx.lock().map_err(|e| e.to_string())?.take() {
        let _ = tx.send(Cmd::Stop);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PortInfo {
    path: String,
    label: String,
}

#[tauri::command]
pub fn mesh_serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let label = match &p.port_type {
                serialport::SerialPortType::UsbPort(u) => format!("{} {}", u.manufacturer.clone().unwrap_or_default(), u.product.clone().unwrap_or_default()).trim().to_string(),
                _ => String::new(),
            };
            PortInfo { path: p.port_name, label }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_skip_log_text() {
        let mut buf = b"INFO boot ok\n".to_vec();
        buf.extend(frame(&[1, 2, 3]));
        buf.extend(b"more log");
        buf.extend(frame(&[9]));
        buf.extend(&frame(&[7, 7])[..3]); // partial
        let got = deframe(&mut buf);
        assert_eq!(got, vec![vec![1, 2, 3], vec![9]]);
        assert_eq!(buf, vec![0x94, 0xC3, 0]);
    }

    #[test]
    fn lan_hosts_only() {
        assert!(check_lan_host("meshtastic.local").is_ok());
        assert!(check_lan_host("192.168.1.50").is_ok());
        assert!(check_lan_host("10.0.0.7:80").is_ok());
        assert!(check_lan_host("meshtastic").is_ok());
        assert!(check_lan_host("8.8.8.8").is_err());
        assert!(check_lan_host("example.com").is_err());
        assert!(check_lan_host("192.168.1.5/evil").is_err());
    }
}
