use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::shell::ps_command;
use crate::state::{BatDevice, Shared};

#[derive(Serialize)]
pub struct Device {
    name: String,
    pct: i64,
    charging: bool,
}

#[derive(Serialize)]
pub struct Batteries {
    host: String,
    devices: Vec<Device>,
}

const SCRIPT: &str = "$ErrorActionPreference='SilentlyContinue';\
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|HID|USB)' -and $_.FriendlyName } | ForEach-Object {\
$p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2';\
if ($p -and $p.Data -ne $null -and $p.Type -ne 'Empty') { [pscustomobject]@{ name = $_.FriendlyName; level = [int]$p.Data } } } | ConvertTo-Json -Compress";

fn read_bt() -> Vec<BatDevice> {
    let out = ps_command(SCRIPT, &[], Duration::from_secs(25));
    if !out.ok {
        return Vec::new();
    }
    let txt = out.stdout.trim();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(if txt.is_empty() { "[]" } else { txt }) else {
        return Vec::new();
    };
    let list = match v {
        serde_json::Value::Array(a) => a,
        o @ serde_json::Value::Object(_) => vec![o],
        _ => vec![],
    };
    let mut seen = std::collections::HashSet::new();
    let mut devices = Vec::new();
    for d in list {
        let name = d.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        let level = d.get("level").and_then(|n| n.as_i64()).unwrap_or(-1);
        if name.is_empty() || !(0..=100).contains(&level) || name.to_lowercase().starts_with("hid-compliant") {
            continue;
        }
        if seen.insert(name.clone()) {
            devices.push(BatDevice { name, pct: level });
        }
    }
    devices
}

#[tauri::command]
pub async fn bat_get(app: AppHandle) -> Batteries {
    let host = sysinfo::System::host_name().unwrap_or_else(|| "This PC".into());
    let devices = tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Shared>();
        let mut g = st.bat.lock().unwrap();
        let stale = g.0.map(|t| t.elapsed() > Duration::from_secs(60)).unwrap_or(true);
        if stale {
            g.1 = read_bt();
            g.0 = Some(Instant::now());
        }
        g.1.clone()
    })
    .await
    .unwrap_or_default();
    Batteries {
        host,
        devices: devices.into_iter().map(|d| Device { name: d.name, pct: d.pct, charging: false }).collect(),
    }
}
