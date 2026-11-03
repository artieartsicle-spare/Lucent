use std::time::Duration;

use serde::Serialize;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
struct Disk {
    name: String,
    total: u64,
    used: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    cpu: f64,
    cores: Vec<f64>,
    model: String,
    mem_total: u64,
    mem_used: u64,
    disks: Vec<Disk>,
    uptime: u64,
    net_down: u64,
    net_up: u64,
}

fn disk_list() -> Vec<Disk> {
    let disks = Disks::new_with_refreshed_list();
    let mut out = Vec::new();
    for d in disks.list() {
        let mp = d.mount_point().to_string_lossy().to_string();
        let keep = if cfg!(windows) {
            let b = mp.as_bytes();
            b.len() >= 2 && b[1] == b':' && matches!(b[0].to_ascii_uppercase(), b'C'..=b'H')
        } else {
            mp == "/"
        };
        let total = d.total_space();
        if keep && total > 0 {
            out.push(Disk {
                name: mp.trim_end_matches(['\\', '/']).to_string(),
                total,
                used: total.saturating_sub(d.available_space()),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        let model = sys
            .cpus()
            .first()
            .map(|c| c.brand().split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default();
        let mut tick: u32 = 0;
        let mut disks = disk_list();
        let mut nets = Networks::new_with_refreshed_list();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick += 1;
            if tick % 30 == 0 {
                disks = disk_list();
            }
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            nets.refresh(true);
            let (mut net_down, mut net_up) = (0u64, 0u64);
            for (name, data) in nets.list() {
                let n = name.to_ascii_lowercase();
                if n.contains("loopback") || n.contains("isatap") || n.contains("teredo") || n == "lo" {
                    continue;
                }
                net_down += data.received();
                net_up += data.transmitted();
            }
            let cores: Vec<f64> = sys.cpus().iter().map(|c| (c.cpu_usage() as f64).clamp(0.0, 100.0)).collect();
            let cpu = if cores.is_empty() { 0.0 } else { cores.iter().sum::<f64>() / cores.len() as f64 };
            let total = sys.total_memory();
            let stats = Stats {
                cpu,
                cores,
                model: model.clone(),
                mem_total: total,
                mem_used: total.saturating_sub(sys.available_memory()),
                disks: disks
                    .iter()
                    .map(|d| Disk { name: d.name.clone(), total: d.total, used: d.used })
                    .collect(),
                uptime: System::uptime(),
                net_down,
                net_up,
            };
            let _ = app.emit_to("main", "system:stats", &stats);
        }
    });
}
