use std::sync::Mutex;

use serde::Serialize;

#[derive(Serialize, Default, Clone)]
pub struct Media {
    pub session: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub art: String,
}

static ART: Mutex<Option<(String, String)>> = Mutex::new(None);

#[cfg(windows)]
mod imp {
    use super::{Media, ART};
    use base64::Engine;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::core::Interface;
    use windows::Storage::Streams::{DataReader, IContentTypeProvider, IInputStream, IRandomAccessStream};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    fn init() {
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn session() -> windows::core::Result<Session> {
        Manager::RequestAsync()?.get()?.GetCurrentSession()
    }

    fn read_art(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> String {
        let go = || -> windows::core::Result<String> {
            let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
            let size = stream.cast::<IRandomAccessStream>()?.Size()? as u32;
            if size == 0 || size > 8 * 1024 * 1024 {
                return Ok(String::new());
            }
            let reader = DataReader::CreateDataReader(&stream.cast::<IInputStream>()?)?;
            reader.LoadAsync(size)?.get()?;
            let mut buf = vec![0u8; size as usize];
            reader.ReadBytes(&mut buf)?;
            let mime = stream.cast::<IContentTypeProvider>().and_then(|c| c.ContentType()).map(|h| h.to_string()).unwrap_or_default();
            let mime = if mime.starts_with("image/") { mime } else { "image/jpeg".to_string() };
            Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf)))
        };
        go().unwrap_or_default()
    }

    pub fn get() -> Media {
        init();
        let Ok(s) = session() else { return Media::default() };
        let playing = s
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|st| st == Status::Playing)
            .unwrap_or(false);
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        let Ok(props) = s.TryGetMediaPropertiesAsync().and_then(|a| a.get()) else {
            return Media { session: true, playing, app, ..Default::default() };
        };
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();

        let key = format!("{app}\u{1}{title}\u{1}{artist}\u{1}{album}");
        let mut cache = ART.lock().unwrap();
        let art = match &*cache {
            Some((k, a)) if *k == key && !a.is_empty() => a.clone(),
            _ => {
                let a = read_art(&props);
                *cache = Some((key, a.clone()));
                a
            }
        };
        Media { session: true, playing, title, artist, album, app, art }
    }

    pub fn control(action: &str) {
        init();
        let Ok(s) = session() else { return };
        let _ = match action {
            "toggle" => s.TryTogglePlayPauseAsync().and_then(|a| a.get()),
            "next" => s.TrySkipNextAsync().and_then(|a| a.get()),
            "prev" => s.TrySkipPreviousAsync().and_then(|a| a.get()),
            _ => return,
        };
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Media;
    pub fn get() -> Media {
        Media::default()
    }
    pub fn control(_action: &str) {}
}

#[tauri::command]
pub async fn media_get() -> Media {
    tauri::async_runtime::spawn_blocking(imp::get).await.unwrap_or_default()
}

#[tauri::command]
pub async fn media_control(action: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || imp::control(&action)).await;
}
