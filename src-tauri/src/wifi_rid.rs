//! Wi-Fi Remote ID receiver (Linux).
//!
//! Many drones (e.g. DJI Mavic 3) broadcast FAA Remote ID as Wi-Fi *beacon*
//! frames, not Bluetooth. The Remote ID data rides in a vendor-specific
//! information element (ID 221) with OUI FA:0B:BC and type 0x0D, followed by a
//! message counter and an ASTM F3411 message pack.
//!
//! Capturing beacons needs a Wi-Fi card in **monitor mode** (e.g. `wlan0mon`
//! from `airmon-ng start wlan0`, tuned to channel 6) and the CAP_NET_RAW
//! capability. Frames are read from a raw AF_PACKET socket; each Remote ID
//! payload is forwarded to the UI as `drones:raw` (same path as Bluetooth).

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const RID_OUI: [u8; 3] = [0xFA, 0x0B, 0xBC];
const RID_OUI_TYPE: u8 = 0x0D;

#[derive(Default)]
pub struct WifiScanner {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
struct RawRemoteId {
    device: String,
    data: String,
    at: u64,
}

/// Parse one captured frame (radiotap header + 802.11 frame). Returns the
/// transmitter MAC and the Remote ID payload (counter + message pack).
pub fn parse_beacon(frame: &[u8]) -> Option<(String, Vec<u8>)> {
    if frame.len() < 4 || frame[0] != 0 {
        return None; // not radiotap v0
    }
    let rt_len = u16::from_le_bytes([frame[2], frame[3]]) as usize;
    let wlan = frame.get(rt_len..)?;
    if wlan.len() < 36 {
        return None;
    }
    let fc = wlan[0];
    let (ftype, subtype) = ((fc >> 2) & 0x3, (fc >> 4) & 0xF);
    if ftype != 0 || subtype != 8 {
        return None; // management / beacon only
    }
    let mac = wlan[10..16].iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":");
    let mut i = 36; // 24-byte header + 12 bytes fixed beacon fields
    while i + 2 <= wlan.len() {
        let (id, len) = (wlan[i], wlan[i + 1] as usize);
        let body = wlan.get(i + 2..i + 2 + len)?;
        if id == 221 && len > 5 && body[..3] == RID_OUI && body[3] == RID_OUI_TYPE {
            return Some((mac, body[4..].to_vec()));
        }
        i += 2 + len;
    }
    None
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn capture(app: &AppHandle, iface: &str, stop: &AtomicBool) -> Result<(), String> {
    use std::ffi::CString;
    let name = CString::new(iface).map_err(|_| "bad interface name".to_string())?;
    // SAFETY: plain libc socket calls; the fd is closed before returning.
    unsafe {
        let idx = libc::if_nametoindex(name.as_ptr());
        if idx == 0 {
            return Err(format!("interface {iface} not found"));
        }
        let proto = (libc::ETH_P_ALL as u16).to_be() as i32;
        let fd = libc::socket(libc::AF_PACKET, libc::SOCK_RAW, proto);
        if fd < 0 {
            return Err("cannot open raw socket: run with CAP_NET_RAW (see README)".into());
        }
        let mut addr: libc::sockaddr_ll = std::mem::zeroed();
        addr.sll_family = libc::AF_PACKET as u16;
        addr.sll_protocol = proto as u16;
        addr.sll_ifindex = idx as i32;
        if libc::bind(fd, &addr as *const _ as *const libc::sockaddr, std::mem::size_of::<libc::sockaddr_ll>() as u32) != 0 {
            libc::close(fd);
            return Err(format!("cannot bind to {iface}"));
        }
        let tv = libc::timeval { tv_sec: 1, tv_usec: 0 };
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &tv as *const _ as *const libc::c_void, std::mem::size_of::<libc::timeval>() as u32);
        let _ = app.emit("drones:wifi-status", format!("listening on {iface}"));
        let mut buf = vec![0u8; 8192];
        while !stop.load(Ordering::Relaxed) {
            let n = libc::recv(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len(), 0);
            if n <= 0 {
                continue; // timeout: check the stop flag
            }
            if let Some((mac, payload)) = parse_beacon(&buf[..n as usize]) {
                // Same shape as Bluetooth service data: [0x0D][counter][message pack]
                let mut data = vec![0x0D];
                data.extend_from_slice(&payload);
                let hex: String = data.iter().map(|b| format!("{b:02x}")).collect();
                let _ = app.emit("drones:raw", RawRemoteId { device: format!("wifi:{mac}"), data: hex, at: now_ms() });
            }
        }
        libc::close(fd);
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn capture(_app: &AppHandle, _iface: &str, _stop: &AtomicBool) -> Result<(), String> {
    Err("Wi-Fi Remote ID capture is only supported on Linux (monitor mode); use an ESP32 receiver on other systems".into())
}

#[tauri::command]
pub fn wifi_rid_start(app: AppHandle, iface: String, state: tauri::State<'_, WifiScanner>) -> Result<(), String> {
    let mut guard = state.stop.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        old.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *guard = Some(stop.clone());
    std::thread::spawn(move || {
        let status = match capture(&app, &iface, &stop) {
            Ok(()) => "stopped".to_string(),
            Err(e) => format!("error: {e}"),
        };
        let _ = app.emit("drones:wifi-status", status);
    });
    Ok(())
}

#[tauri::command]
pub fn wifi_rid_stop(state: tauri::State<'_, WifiScanner>) -> Result<(), String> {
    if let Some(stop) = state.stop.lock().map_err(|e| e.to_string())?.take() {
        stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_beacon;

    fn beacon(ies: &[u8]) -> Vec<u8> {
        let mut f = vec![0u8, 0, 8, 0, 0, 0, 0, 0]; // minimal radiotap header (len 8)
        let mut wlan = vec![0x80, 0x00, 0, 0]; // beacon frame control, duration
        wlan.extend([0xff; 6]); // addr1 broadcast
        wlan.extend([0x60, 0x60, 0x1F, 0x12, 0x34, 0x56]); // addr2 transmitter
        wlan.extend([0x60, 0x60, 0x1F, 0x12, 0x34, 0x56]); // addr3 bssid
        wlan.extend([0, 0]); // seq
        wlan.extend([0u8; 12]); // timestamp, interval, capabilities
        wlan.extend(ies);
        f.extend(wlan);
        f
    }

    #[test]
    fn finds_remote_id_vendor_element() {
        let mut ies = vec![0, 4, b'D', b'J', b'I', b'-']; // SSID
        let payload = [7u8, 0xF2, 25, 1]; // counter, pack header...
        ies.extend([221, (4 + payload.len()) as u8, 0xFA, 0x0B, 0xBC, 0x0D]);
        ies.extend(payload);
        let (mac, data) = parse_beacon(&beacon(&ies)).expect("remote id found");
        assert_eq!(mac, "60:60:1F:12:34:56");
        assert_eq!(data, payload);
    }

    #[test]
    fn ignores_other_beacons_and_frames() {
        assert!(parse_beacon(&beacon(&[0, 3, b'a', b'b', b'c'])).is_none());
        let mut probe = beacon(&[]);
        probe[8] = 0x40; // probe request
        assert!(parse_beacon(&probe).is_none());
        assert!(parse_beacon(&[1, 2, 3]).is_none());
    }
}
