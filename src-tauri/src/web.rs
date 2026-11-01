use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const HOSTS: [&str; 11] = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "ipwho.is",
    "get.geojs.io",
    "ipapi.co",
    "api.open-meteo.com",
    "geocoding-api.open-meteo.com",
    "site.api.espn.com",
    "air-quality-api.open-meteo.com",
    "api.dictionaryapi.dev",
    "en.wiktionary.org",
];
const MAX_BYTES: u64 = 2 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

fn host_of(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..end];
    if host.contains('@') || host.contains(':') {
        return None;
    }
    Some(host)
}

fn get(url: &str) -> Result<String, String> {
    let host = host_of(url).ok_or("only plain https URLs are allowed")?;
    if !HOSTS.contains(&host.to_ascii_lowercase().as_str()) {
        return Err(format!("host not allowed: {host}"));
    }
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).redirects(0).build();
    let resp = agent
        .get(url)
        .set("User-Agent", UA)
        .set("Accept", "application/json")
        .call()
        .map_err(|e| e.to_string())?;
    let mut body = String::new();
    resp.into_reader().take(MAX_BYTES).read_to_string(&mut body).map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
pub async fn http_get(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get(&url)).await.map_err(|e| e.to_string())?
}


fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xC0) == 64)
                || o[0] >= 224)
        }
        IpAddr::V6(v) => {
            if let Some(m) = v.to_ipv4_mapped() {
                return is_public(IpAddr::V4(m));
            }
            let s0 = v.segments()[0];
            !(v.is_loopback()
                || v.is_unspecified()
                || (s0 & 0xfe00) == 0xfc00
                || (s0 & 0xffc0) == 0xfe80
                || (s0 & 0xff00) == 0xff00)
        }
    }
}

struct PublicOnly;
impl ureq::Resolver for PublicOnly {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        let ok: Vec<SocketAddr> = netloc.to_socket_addrs()?.filter(|a| is_public(a.ip())).collect();
        if ok.is_empty() {
            Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "address not allowed"))
        } else {
            Ok(ok)
        }
    }
}

fn get_feed(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).redirects(0).resolver(PublicOnly).build();
    let mut cur = url.to_string();
    for _ in 0..4 {
        let host = host_of(&cur).ok_or("only plain https URLs are allowed")?.to_string();
        let resp = agent
            .get(&cur)
            .set("User-Agent", UA)
            .set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5")
            .call()
            .map_err(|e| e.to_string())?;
        if matches!(resp.status(), 301 | 302 | 303 | 307 | 308) {
            let loc = resp.header("Location").ok_or("redirect without a location")?.to_string();
            cur = if loc.starts_with("https://") {
                loc
            } else if loc.starts_with('/') && !loc.starts_with("//") {
                format!("https://{host}{loc}")
            } else {
                return Err("redirect not allowed".into());
            };
            continue;
        }
        let mut body = String::new();
        resp.into_reader().take(MAX_BYTES).read_to_string(&mut body).map_err(|e| e.to_string())?;
        let t = body.trim_start_matches('\u{feff}').trim_start();
        return if t.starts_with('<') { Ok(body) } else { Err("not a feed".into()) };
    }
    Err("too many redirects".into())
}

#[tauri::command]
pub async fn rss_get(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get_feed(&url)).await.map_err(|e| e.to_string())?
}

fn meta_content(html: &str, keys: &[&str]) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<meta") {
        let start = from + i;
        let end = lower[start..].find('>').map(|e| start + e)?;
        let tag = &html[start..end];
        let tl = &lower[start..end];
        let hit = keys.iter().any(|k| tl.contains(&format!("\"{k}\"")) || tl.contains(&format!("'{k}'")));
        if hit {
            if let Some(ci) = tl.find("content=") {
                let rest = &tag[ci + 8..];
                let q = rest.chars().next()?;
                if q == '"' || q == '\'' {
                    if let Some(e) = rest[1..].find(q) {
                        return Some(rest[1..1 + e].replace("&amp;", "&"));
                    }
                }
            }
        }
        from = end;
    }
    None
}

fn get_page_image(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).redirects(0).resolver(PublicOnly).build();
    let mut cur = url.to_string();
    for _ in 0..4 {
        let host = host_of(&cur).ok_or("only plain https URLs are allowed")?.to_string();
        let resp = agent
            .get(&cur)
            .set("User-Agent", UA)
            .set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.4")
            .call()
            .map_err(|e| e.to_string())?;
        if matches!(resp.status(), 301 | 302 | 303 | 307 | 308) {
            let loc = resp.header("Location").ok_or("redirect without a location")?.to_string();
            cur = if loc.starts_with("https://") {
                loc
            } else if loc.starts_with('/') && !loc.starts_with("//") {
                format!("https://{host}{loc}")
            } else {
                return Err("redirect not allowed".into());
            };
            continue;
        }
        let mut raw = Vec::new();
        resp.into_reader().take(300 * 1024).read_to_end(&mut raw).map_err(|e| e.to_string())?;
        let html = String::from_utf8_lossy(&raw).into_owned();
        let found = meta_content(&html, &["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]).unwrap_or_default();
        let found = found.trim().to_string();
        return Ok(if found.starts_with("https://") {
            found
        } else if found.starts_with("//") {
            format!("https:{found}")
        } else if found.starts_with('/') {
            format!("https://{host}{found}")
        } else {
            String::new()
        });
    }
    Err("too many redirects".into())
}

#[tauri::command]
pub async fn page_image(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get_page_image(&url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) {
    if url.starts_with("https://") && !url.contains(char::is_whitespace) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[cfg(test)]
mod tests {
    use super::host_of;
    #[test]
    fn public_addresses_only() {
        use super::is_public;
        for bad in ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.5.5", "169.254.1.1", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"] {
            assert!(!is_public(bad.parse().unwrap()), "{bad} must be refused");
        }
        for good in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(is_public(good.parse().unwrap()), "{good} must be allowed");
        }
    }
    #[test]
    fn hosts() {
        assert_eq!(host_of("https://query1.finance.yahoo.com/v8/x?a=1"), Some("query1.finance.yahoo.com"));
        assert_eq!(host_of("http://query1.finance.yahoo.com/"), None);
        assert_eq!(host_of("https://query1.finance.yahoo.com@evil.com/"), None);
        assert_eq!(host_of("https://query1.finance.yahoo.com:444/"), None);
    }
}
