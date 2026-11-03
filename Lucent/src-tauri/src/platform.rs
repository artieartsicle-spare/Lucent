#[cfg(windows)]
pub use win::*;
#[cfg(not(windows))]
pub use other::*;

#[cfg(windows)]
mod win {
    use std::path::{Path, PathBuf};
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, POINT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetCursorPos, GetWindow, GetWindowLongPtrW, IsIconic, IsWindow,
        GetAncestor, GetLayeredWindowAttributes, SetLayeredWindowAttributes, WindowFromPoint, GA_ROOT, LWA_ALPHA,
        WS_EX_LAYERED,
        IsWindowVisible, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_HWNDPREV,
        HWND_TOP, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOW, SW_SHOWNOACTIVATE,
        WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn send_right_click(x: i32, y: i32) {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEINPUT,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;
        let ev = |flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        unsafe {
            SetCursorPos(x, y);
            let inputs = [ev(MOUSEEVENTF_RIGHTDOWN), ev(MOUSEEVENTF_RIGHTUP)];
            SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }

    pub fn find_desktop_hwnd() -> isize {
        unsafe extern "system" fn each(h: HWND, lp: LPARAM) -> BOOL {
            let cls = wide("SHELLDLL_DefView");
            let v = FindWindowExW(h, null_mut(), cls.as_ptr(), null());
            if !v.is_null() {
                *(lp as *mut isize) = h as isize;
                return 0;
            }
            1
        }
        let mut found: isize = 0;
        unsafe {
            EnumWindows(Some(each), &mut found as *mut isize as LPARAM);
            if found == 0 {
                let c = wide("Progman");
                found = FindWindowW(c.as_ptr(), null()) as isize;
            }
        }
        found
    }

    pub fn place_above_desktop(our: isize, desktop: isize) {
        if our == 0 || desktop == 0 {
            return;
        }
        unsafe {
            let ours = our as HWND;
            let desk = desktop as HWND;
            if IsWindow(desk) == 0 || IsWindow(ours) == 0 {
                return;
            }
            let above_desktop = GetWindow(desk, GW_HWNDPREV);
            if above_desktop == ours {
                return;
            }
            let after = if above_desktop.is_null() { HWND_TOP } else { above_desktop };
            SetWindowPos(ours, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
        }
    }

    pub fn restore_if_minimized(hwnd: isize) {
        unsafe {
            let h = hwnd as HWND;
            if hwnd != 0 && IsIconic(h) != 0 {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
        }
    }

    pub fn set_noactivate(hwnd: isize, noactivate: bool) {
        if hwnd == 0 {
            return;
        }
        unsafe {
            let h = hwnd as HWND;
            let cur = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE as isize;
            let new = if noactivate { cur | flag } else { cur & !flag };
            if new != cur {
                SetWindowLongPtrW(h, GWL_EXSTYLE, new);
            }
        }
    }

    pub fn no_blur_behind(hwnd: isize) {
        use windows_sys::Win32::Graphics::Dwm::{DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND};
        use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
        if hwnd == 0 {
            return;
        }
        unsafe {
            let rgn = CreateRectRgn(0, 0, 1, 1);
            let bb = DWM_BLURBEHIND {
                dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                fEnable: 1,
                hRgnBlur: rgn,
                fTransitionOnMaximized: 0,
            };
            DwmEnableBlurBehindWindow(hwnd as HWND, &bb);
            if !rgn.is_null() {
                DeleteObject(rgn);
            }
        }
    }

    pub fn bottom_inset(our: isize, mx: i32, my: i32, mw: i32, mh: i32) -> i32 {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, WS_EX_TOPMOST};
        struct Ctx {
            our: isize,
            mx: i32,
            my: i32,
            mw: i32,
            mh: i32,
            best: i32,
        }
        unsafe extern "system" fn each(h: HWND, lp: LPARAM) -> BOOL {
            let c = &mut *(lp as *mut Ctx);
            if h as isize == c.our || IsWindowVisible(h) == 0 || IsIconic(h) != 0 {
                return 1;
            }
            if (GetWindowLongPtrW(h, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST) == 0 {
                return 1;
            }
            let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            if GetWindowRect(h, &mut r) == 0 {
                return 1;
            }
            let (w, hh) = (r.right - r.left, r.bottom - r.top);
            let on_bottom = r.bottom >= c.my + c.mh - 6 && r.bottom <= c.my + c.mh + 40;
            let inside = r.left < c.mx + c.mw && r.right > c.mx;
            if on_bottom && inside && w >= 160 && (30..=260).contains(&hh) {
                c.best = c.best.max(c.my + c.mh - r.top);
            }
            1
        }
        let mut c = Ctx { our, mx, my, mw, mh, best: 0 };
        unsafe {
            EnumWindows(Some(each), &mut c as *mut Ctx as LPARAM);
        }
        c.best.clamp(0, 300)
    }

    pub fn blur_regions(hwnd: isize, rects: &[[i32; 5]]) -> bool {
        use windows_sys::Win32::Graphics::Dwm::{DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND};
        use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, RGN_OR};
        if hwnd == 0 {
            return false;
        }
        unsafe {
            let all = CreateRectRgn(0, 0, 0, 0);
            for r in rects {
                let part = CreateRoundRectRgn(r[0], r[1], r[0] + r[2] + 1, r[1] + r[3] + 1, r[4] * 2, r[4] * 2);
                CombineRgn(all, all, part, RGN_OR);
                DeleteObject(part);
            }
            if rects.is_empty() {
                let one = CreateRectRgn(0, 0, 1, 1);
                CombineRgn(all, all, one, RGN_OR);
                DeleteObject(one);
            }
            let bb = DWM_BLURBEHIND { dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION, fEnable: 1, hRgnBlur: all, fTransitionOnMaximized: 0 };
            let hr = DwmEnableBlurBehindWindow(hwnd as HWND, &bb);
            DeleteObject(all);
            hr >= 0
        }
    }

    pub fn no_backdrop(hwnd: isize) {
        use windows_sys::Win32::Graphics::Dwm::{DwmExtendFrameIntoClientArea, DwmSetWindowAttribute};
        use windows_sys::Win32::UI::Controls::MARGINS;
        if hwnd == 0 {
            return;
        }
        unsafe {
            let h = hwnd as HWND;
            let none: i32 = 1;
            DwmSetWindowAttribute(h, 38, &none as *const i32 as *const _, 4);
            let off: i32 = 0;
            DwmSetWindowAttribute(h, 1029, &off as *const i32 as *const _, 4);
            let m = MARGINS { cxLeftWidth: 0, cxRightWidth: 0, cyTopHeight: 0, cyBottomHeight: 0 };
            DwmExtendFrameIntoClientArea(h, &m);
        }
    }

    #[allow(dead_code)]
    pub fn round_corners(hwnd: isize) {
        use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
        if hwnd == 0 {
            return;
        }
        unsafe {
            let round: i32 = 2;
            DwmSetWindowAttribute(hwnd as HWND, 33, &round as *const i32 as *const _, 4);
        }
    }

    pub fn keep_clear(hwnd: isize) {
        no_backdrop(hwnd);
        no_blur_behind(hwnd);
    }

    pub fn foreground_window() -> isize {
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
    }

    pub fn no_backdrop_soon(hwnd: isize) {
        no_backdrop(hwnd);
        std::thread::spawn(move || {
            for ms in [60u64, 200, 500, 1200] {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                no_backdrop(hwnd);
            }
        });
    }

    /// Windows paints its own acrylic/Mica backdrop behind an undecorated window again whenever the wallpaper, the theme or the
    /// accent colour changes. That was the grey box that showed up around the Settings phone after a wallpaper change.
    /// This subclasses the window and clears the backdrop each time one of those system messages arrives. It has to run on the
    /// thread that owns the window.
    pub fn watch_backdrop(hwnd: isize) {
        use windows_sys::Win32::UI::Shell::SetWindowSubclass;
        if hwnd == 0 {
            return;
        }
        unsafe {
            SetWindowSubclass(hwnd as HWND, Some(backdrop_proc), 0x4C42, 0);
        }
    }

    static BACKDROP_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    /// Clears the backdrop now, and again a few times over the next seconds while Windows finishes its wallpaper transition.
    pub fn reapply_backdrop(hwnd: isize) {
        use std::sync::atomic::Ordering;
        no_backdrop(hwnd);
        if BACKDROP_BUSY.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(move || {
            for ms in [80u64, 250, 600, 1200, 2400] {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                no_backdrop(hwnd);
            }
            BACKDROP_BUSY.store(false, Ordering::SeqCst);
        });
    }

    unsafe extern "system" fn backdrop_proc(
        hwnd: HWND,
        msg: u32,
        wparam: windows_sys::Win32::Foundation::WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> windows_sys::Win32::Foundation::LRESULT {
        use windows_sys::Win32::UI::Shell::DefSubclassProc;
        const WM_SETTINGCHANGE: u32 = 0x001A;
        const WM_DISPLAYCHANGE: u32 = 0x007E;
        const WM_THEMECHANGED: u32 = 0x031A;
        const WM_DWMCOMPOSITIONCHANGED: u32 = 0x031E;
        const WM_DWMCOLORIZATIONCOLORCHANGED: u32 = 0x0320;
        let r = DefSubclassProc(hwnd, msg, wparam, lparam);
        if matches!(
            msg,
            WM_SETTINGCHANGE | WM_DISPLAYCHANGE | WM_THEMECHANGED | WM_DWMCOMPOSITIONCHANGED | WM_DWMCOLORIZATIONCOLORCHANGED
        ) {
            reapply_backdrop(hwnd as isize);
        }
        r
    }

    pub fn set_toolwindow(hwnd: isize) {
        if hwnd == 0 {
            return;
        }
        unsafe {
            let h = hwnd as HWND;
            let cur = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let new = (cur | WS_EX_TOOLWINDOW as isize) & !(WS_EX_APPWINDOW as isize);
            if new != cur {
                SetWindowLongPtrW(h, GWL_EXSTYLE, new);
            }
        }
    }

    pub fn foreground(hwnd: isize) {
        if hwnd != 0 {
            unsafe {
                SetForegroundWindow(hwnd as HWND);
            }
        }
    }


    pub fn capture_screen(x: i32, y: i32, w: i32, h: i32, div: i32) -> Option<(u32, u32, Vec<u8>)> {
        use windows_sys::Win32::Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
            SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
            DIB_RGB_COLORS, HALFTONE, SRCCOPY,
        };
        if w <= 0 || h <= 0 {
            return None;
        }
        let div = div.max(1);
        let (dw, dh) = ((w / div).max(1), (h / div).max(1));
        unsafe {
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return None;
            }
            let mem = CreateCompatibleDC(screen);
            let bmp = CreateCompatibleBitmap(screen, dw, dh);
            let mut out = None;
            if !mem.is_null() && !bmp.is_null() {
                let old = SelectObject(mem, bmp);
                SetStretchBltMode(mem, HALFTONE);
                let ok = StretchBlt(mem, 0, 0, dw, dh, screen, x, y, w, h, SRCCOPY | CAPTUREBLT);
                if ok != 0 {
                    let mut bi: BITMAPINFO = std::mem::zeroed();
                    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                    bi.bmiHeader.biWidth = dw;
                    bi.bmiHeader.biHeight = -dh;
                    bi.bmiHeader.biPlanes = 1;
                    bi.bmiHeader.biBitCount = 32;
                    bi.bmiHeader.biCompression = BI_RGB;
                    let mut buf = vec![0u8; (dw as usize) * (dh as usize) * 4];
                    let lines = GetDIBits(mem, bmp, 0, dh as u32, buf.as_mut_ptr() as *mut _, &mut bi, DIB_RGB_COLORS);
                    if lines != 0 {
                        for px in buf.chunks_exact_mut(4) {
                            px.swap(0, 2);
                            px[3] = 255;
                        }
                        out = Some((dw as u32, dh as u32, buf));
                    }
                }
                SelectObject(mem, old);
            }
            if !bmp.is_null() {
                DeleteObject(bmp);
            }
            if !mem.is_null() {
                DeleteDC(mem);
            }
            ReleaseDC(null_mut(), screen);
            out
        }
    }

    pub fn cursor_pos() -> Option<(i32, i32)> {
        unsafe {
            let mut p = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut p) != 0 {
                Some((p.x, p.y))
            } else {
                None
            }
        }
    }

    fn list_view() -> HWND {
        unsafe extern "system" fn each(h: HWND, lp: LPARAM) -> BOOL {
            let defview = wide("SHELLDLL_DefView");
            let v = FindWindowExW(h, null_mut(), defview.as_ptr(), null());
            if !v.is_null() {
                let lvc = wide("SysListView32");
                let lv = FindWindowExW(v, null_mut(), lvc.as_ptr(), null());
                if !lv.is_null() {
                    *(lp as *mut isize) = lv as isize;
                    return 0;
                }
            }
            1
        }
        let mut found: isize = 0;
        unsafe {
            EnumWindows(Some(each), &mut found as *mut isize as LPARAM);
        }
        found as HWND
    }

    unsafe fn make_transparent(lv: HWND) -> bool {
        let cur = GetWindowLongPtrW(lv, GWL_EXSTYLE);
        SetWindowLongPtrW(lv, GWL_EXSTYLE, cur | WS_EX_LAYERED as isize);
        SetLayeredWindowAttributes(lv, 0, 0, LWA_ALPHA) != 0
    }

    unsafe fn make_opaque(lv: HWND) {
        SetLayeredWindowAttributes(lv, 0, 255, LWA_ALPHA);
        let cur = GetWindowLongPtrW(lv, GWL_EXSTYLE);
        SetWindowLongPtrW(lv, GWL_EXSTYLE, cur & !(WS_EX_LAYERED as isize));
        if IsWindowVisible(lv) == 0 {
            ShowWindow(lv, SW_SHOW);
        }
    }

    unsafe fn is_transparent(lv: HWND) -> bool {
        if IsWindowVisible(lv) == 0 {
            return true;
        }
        if GetWindowLongPtrW(lv, GWL_EXSTYLE) & WS_EX_LAYERED as isize == 0 {
            return false;
        }
        let (mut key, mut alpha, mut flags) = (0u32, 255u8, 0u32);
        GetLayeredWindowAttributes(lv, &mut key, &mut alpha, &mut flags) != 0 && flags & LWA_ALPHA != 0 && alpha == 0
    }

    pub fn apply_icons(hide: bool, we_hid: &mut bool, marker: &Path) {
        unsafe {
            let lv = list_view();
            if lv.is_null() {
                return;
            }
            if hide && !is_transparent(lv) {
                if !make_transparent(lv) {
                    ShowWindow(lv, SW_HIDE);
                }
                *we_hid = true;
                let _ = std::fs::write(marker, "1");
            } else if !hide && *we_hid {
                make_opaque(lv);
                *we_hid = false;
                let _ = std::fs::remove_file(marker);
            }
        }
    }

    pub fn clipboard_set_files(owner: isize, paths: &[String], cut: bool) -> bool {
        use windows_sys::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
        };
        use windows_sys::Win32::Foundation::GlobalFree;
        use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};
        const CF_HDROP: u32 = 15;
        if paths.is_empty() {
            return false;
        }
        let mut list: Vec<u16> = Vec::new();
        for p in paths {
            list.extend(p.encode_utf16());
            list.push(0);
        }
        list.push(0);
        unsafe {
            let size = 20 + list.len() * 2;
            let h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size);
            if h.is_null() {
                return false;
            }
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                GlobalFree(h);
                return false;
            }
            *(p as *mut u32) = 20;
            *(p.add(16) as *mut u32) = 1;
            std::ptr::copy_nonoverlapping(list.as_ptr() as *const u8, p.add(20), list.len() * 2);
            GlobalUnlock(h);

            let eff = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 4);
            if !eff.is_null() {
                let e = GlobalLock(eff) as *mut u32;
                if !e.is_null() {
                    *e = if cut { 2 } else { 1 };
                    GlobalUnlock(eff);
                }
            }
            if OpenClipboard(owner as HWND) == 0 {
                GlobalFree(h);
                if !eff.is_null() {
                    GlobalFree(eff);
                }
                return false;
            }
            EmptyClipboard();
            let ok = !SetClipboardData(CF_HDROP, h).is_null();
            if !ok {
                GlobalFree(h);
            }
            let fmt = RegisterClipboardFormatW(wide("Preferred DropEffect").as_ptr());
            if !eff.is_null() {
                if !(ok && fmt != 0 && !SetClipboardData(fmt, eff).is_null()) {
                    GlobalFree(eff);
                }
            }
            CloseClipboard();
            ok
        }
    }

    pub fn clipboard_get_files(owner: isize) -> Option<(Vec<String>, bool)> {
        use windows_sys::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
        };
        use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
        use windows_sys::Win32::UI::Shell::DragQueryFileW;
        const CF_HDROP: u32 = 15;
        unsafe {
            if OpenClipboard(owner as HWND) == 0 {
                return None;
            }
            let mut files: Vec<String> = Vec::new();
            let mut cut = false;
            if IsClipboardFormatAvailable(CF_HDROP) != 0 {
                let h = GetClipboardData(CF_HDROP);
                if !h.is_null() {
                    let n = DragQueryFileW(h as _, 0xFFFF_FFFF, null_mut(), 0);
                    for i in 0..n {
                        let len = DragQueryFileW(h as _, i, null_mut(), 0) as usize;
                        let mut buf = vec![0u16; len + 1];
                        DragQueryFileW(h as _, i, buf.as_mut_ptr(), buf.len() as u32);
                        files.push(String::from_utf16_lossy(&buf[..len]));
                    }
                }
                let fmt = RegisterClipboardFormatW(wide("Preferred DropEffect").as_ptr());
                if fmt != 0 && IsClipboardFormatAvailable(fmt) != 0 {
                    let he = GetClipboardData(fmt);
                    if !he.is_null() {
                        let v = GlobalLock(he) as *const u32;
                        if !v.is_null() {
                            cut = *v & 2 != 0;
                            GlobalUnlock(he);
                        }
                    }
                }
            }
            CloseClipboard();
            if files.is_empty() { None } else { Some((files, cut)) }
        }
    }

    pub fn lbutton_down() -> bool {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) as u16) & 0x8000 != 0 }
    }

    pub fn cursor_over_other_window(our: isize) -> bool {
        unsafe {
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) == 0 {
                return false;
            }
            let w = WindowFromPoint(pt);
            if w.is_null() {
                return false;
            }
            GetAncestor(w, GA_ROOT) as isize != our
        }
    }

    pub fn run_icons_watchdog(args: &[String]) {
        let pid: u32 = args.first().and_then(|s| s.parse().ok()).unwrap_or(0);
        let marker: PathBuf = args.get(1).map(PathBuf::from).unwrap_or_default();
        if pid == 0 {
            return;
        }
        unsafe {
            let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !h.is_null() {
                WaitForSingleObject(h, INFINITE);
                CloseHandle(h);
            }
            if marker.exists() {
                let lv = list_view();
                if !lv.is_null() {
                    make_opaque(lv);
                }
                let _ = std::fs::remove_file(&marker);
            }
        }
    }

    pub fn spawn_icons_watchdog(marker: &Path) {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        if let Ok(exe) = std::env::current_exe() {
            let _ = std::process::Command::new(exe)
                .arg("--icons-watchdog")
                .arg(std::process::id().to_string())
                .arg(marker)
                .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                .spawn();
        }
    }
}

#[cfg(not(windows))]
mod other {
    pub fn send_right_click(_x: i32, _y: i32) {}
    use std::path::Path;

    pub fn find_desktop_hwnd() -> isize {
        0
    }
    pub fn place_above_desktop(_our: isize, _desktop: isize) {}
    pub fn restore_if_minimized(_hwnd: isize) {}
    pub fn set_noactivate(_hwnd: isize, _noactivate: bool) {}
    pub fn set_toolwindow(_hwnd: isize) {}
    pub fn no_backdrop(_hwnd: isize) {}
    pub fn no_backdrop_soon(_hwnd: isize) {}
    pub fn watch_backdrop(_hwnd: isize) {}
    pub fn reapply_backdrop(_hwnd: isize) {}
    pub fn keep_clear(_hwnd: isize) {}
    pub fn foreground_window() -> isize {
        0
    }
    pub fn round_corners(_hwnd: isize) {}
    pub fn no_blur_behind(_hwnd: isize) {}
    pub fn blur_regions(_hwnd: isize, _rects: &[[i32; 5]]) -> bool {
        false
    }
    pub fn bottom_inset(_our: isize, _mx: i32, _my: i32, _mw: i32, _mh: i32) -> i32 {
        0
    }
    pub fn foreground(_hwnd: isize) {}
    pub fn cursor_pos() -> Option<(i32, i32)> {
        None
    }
    pub fn capture_screen(_x: i32, _y: i32, _w: i32, _h: i32, _div: i32) -> Option<(u32, u32, Vec<u8>)> {
        None
    }
    pub fn apply_icons(_hide: bool, _we_hid: &mut bool, _marker: &Path) {}
    pub fn lbutton_down() -> bool {
        false
    }
    pub fn clipboard_set_files(_owner: isize, _paths: &[String], _cut: bool) -> bool {
        false
    }
    pub fn clipboard_get_files(_owner: isize) -> Option<(Vec<String>, bool)> {
        None
    }
    pub fn cursor_over_other_window(_our: isize) -> bool {
        false
    }
    pub fn run_icons_watchdog(_args: &[String]) {}
    pub fn spawn_icons_watchdog(_marker: &Path) {}
}
