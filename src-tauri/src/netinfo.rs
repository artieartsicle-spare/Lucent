use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::shell::ps_command;

fn json_list(txt: &str) -> Vec<Value> {
    let t = txt.trim();
    match serde_json::from_str::<Value>(if t.is_empty() { "[]" } else { t }) {
        Ok(Value::Array(a)) => a,
        Ok(o @ Value::Object(_)) => vec![o],
        _ => vec![],
    }
}

const NET_SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
$prof=@{}
Get-NetConnectionProfile | ForEach-Object { $prof[[string]$_.InterfaceAlias]=[string]$_.Name }
$a=@(Get-NetIPConfiguration | ForEach-Object {
  $n=$_.NetAdapter
  [pscustomobject]@{
    name=[string]$_.InterfaceAlias; desc=[string]$_.InterfaceDescription; status=[string]$n.Status; speed=[string]$n.LinkSpeed; media=[string]$n.PhysicalMediaType
    ip=(@($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ', ')
    gw=(@($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', ')
    dns=(@($_.DNSServer | ForEach-Object { $_.ServerAddresses }) -join ', ')
    profile=$prof[[string]$_.InterfaceAlias]
  } })
$w=(netsh wlan show interfaces | Out-String)
[pscustomobject]@{ wlan=$w; adapters=$a } | ConvertTo-Json -Compress -Depth 4"#;

#[tauri::command]
pub async fn net_status() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let out = ps_command(NET_SCRIPT, &[], Duration::from_secs(15));
        let v: Value = serde_json::from_str(out.stdout.trim()).unwrap_or(Value::Null);
        let adapters = match v.get("adapters") {
            Some(Value::Array(a)) => a.clone(),
            Some(o @ Value::Object(_)) => vec![o.clone()],
            _ => vec![],
        };
        let wlan = v.get("wlan").and_then(|w| w.as_str()).unwrap_or("");
        let mut signal: Option<i64> = None;
        let mut ssid_netsh = String::new();
        for line in wlan.lines() {
            if let Some((k, val)) = line.split_once(':') {
                let (k, val) = (k.trim(), val.trim());
                if signal.is_none() && val.len() <= 4 && val.ends_with('%') {
                    signal = val.trim_end_matches('%').parse().ok();
                }
                if k.eq_ignore_ascii_case("ssid") {
                    ssid_netsh = val.to_string();
                }
            }
        }
        let wifi_ad = adapters.iter().find(|a| {
            a.get("media").and_then(|m| m.as_str()).map(|m| m.contains("802.11")).unwrap_or(false)
        });
        let connected = wifi_ad
            .map(|a| a.get("status").and_then(|s| s.as_str()) == Some("Up"))
            .unwrap_or(false);
        let ssid = wifi_ad
            .and_then(|a| a.get("profile").and_then(|p| p.as_str()))
            .filter(|p| !p.is_empty())
            .map(|p| p.to_string())
            .unwrap_or(ssid_netsh);
        json!({
            "adapters": adapters,
            "wifi": { "available": wifi_ad.is_some() || !wlan.trim().is_empty(), "connected": connected && !ssid.is_empty(), "ssid": ssid, "signal": signal },
        })
    })
    .await
    .unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn net_ping() -> Option<u32> {
    tauri::async_runtime::spawn_blocking(|| {
        let targets: [SocketAddr; 2] = [([1, 1, 1, 1], 443).into(), ([8, 8, 8, 8], 443).into()];
        for t in targets {
            let start = Instant::now();
            if TcpStream::connect_timeout(&t, Duration::from_millis(1500)).is_ok() {
                return Some(start.elapsed().as_millis().min(9999) as u32);
            }
        }
        None
    })
    .await
    .unwrap_or(None)
}

const RADIO_HEAD: &str = r#"$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op,$t){ $m=$asTask.MakeGenericMethod($t); $x=$m.Invoke($null,@($op)); [void]$x.Wait(-1); $x.Result }
[void][Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
[void][Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime]
[void][Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime]
[void](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))
$r=Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
"#;

const RADIO_LIST: &str = "$r | ForEach-Object { \"$($_.Kind)=$($_.State)\" }";
const RADIO_SET: &str = "$t=$r | Where-Object { [string]$_.Kind -eq $env:LG_KIND } | Select-Object -First 1\n\
if ($t) { [void](Await ($t.SetStateAsync([Windows.Devices.Radios.RadioState]::($env:LG_STATE))) ([Windows.Devices.Radios.RadioAccessStatus])) }\n\
$r = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])\n";

fn parse_radios(txt: &str) -> Value {
    let mut m = serde_json::Map::new();
    for line in txt.lines() {
        if let Some((k, v)) = line.trim().split_once('=') {
            if k == "WiFi" || k == "Bluetooth" {
                m.insert(k.to_string(), Value::Bool(v == "On"));
            }
        }
    }
    Value::Object(m)
}

#[tauri::command]
pub async fn radios_get() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let out = ps_command(&format!("{RADIO_HEAD}{RADIO_LIST}"), &[], Duration::from_secs(15));
        parse_radios(&out.stdout)
    })
    .await
    .unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn radio_set(kind: String, on: bool) -> Value {
    if kind != "WiFi" && kind != "Bluetooth" {
        return Value::Null;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let envs = [("LG_KIND", kind), ("LG_STATE", if on { "On".to_string() } else { "Off".to_string() })];
        let out = ps_command(&format!("{RADIO_HEAD}{RADIO_SET}{RADIO_LIST}"), &envs, Duration::from_secs(20));
        parse_radios(&out.stdout)
    })
    .await
    .unwrap_or(Value::Null)
}

const BT_SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
Get-PnpDevice -Class Bluetooth -PresentOnly | Where-Object { $_.FriendlyName -and $_.InstanceId -match '^BTH(ENUM|LE)\\DEV_' } | ForEach-Object {
  $c=Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
  [pscustomobject]@{ name=[string]$_.FriendlyName; connected=[bool]$c.Data } } | ConvertTo-Json -Compress"#;

#[tauri::command]
pub async fn bt_devices() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let out = ps_command(BT_SCRIPT, &[], Duration::from_secs(25));
        let mut seen = std::collections::HashSet::new();
        let mut list: Vec<Value> = json_list(&out.stdout)
            .into_iter()
            .filter(|d| d.get("name").and_then(|n| n.as_str()).map(|n| !n.is_empty()).unwrap_or(false))
            .filter(|d| seen.insert(d["name"].as_str().unwrap_or("").to_string()))
            .collect();
        list.sort_by_key(|d| !d.get("connected").and_then(|c| c.as_bool()).unwrap_or(false));
        Value::Array(list)
    })
    .await
    .unwrap_or(Value::Null)
}

#[cfg(windows)]
fn power() -> Value {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return json!({ "hasBattery": false });
    }
    let has = s.BatteryFlag != 128 && s.BatteryFlag != 255;
    json!({
        "hasBattery": has,
        "percent": if s.BatteryLifePercent == 255 { Value::Null } else { json!(s.BatteryLifePercent) },
        "ac": s.ACLineStatus == 1,
        "charging": s.BatteryFlag != 255 && (s.BatteryFlag & 8) != 0,
        "secondsLeft": if s.BatteryLifeTime == u32::MAX { Value::Null } else { json!(s.BatteryLifeTime) },
        "saver": s.SystemStatusFlag == 1,
    })
}
#[cfg(not(windows))]
fn power() -> Value {
    json!({ "hasBattery": false })
}

#[tauri::command]
pub fn power_status() -> Value {
    power()
}
