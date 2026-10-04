// The closed assistant is a minimized taskbar application. Its popup grows
// upward from the monitor work area and closes when a fullscreen app is active.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowLongPtrW,
    SetWindowLongPtrW, GWL_EXSTYLE, GWL_STYLE, WS_MINIMIZE, WS_MAXIMIZE,
    WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, ShowWindow, SW_SHOWNOACTIVATE,
};

/// Logical size of the full window — the largest island view, like the macOS panel.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 520.0;
/// Logical size of the invisible strip that wakes the island when it is hidden.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

pub const WINDOW_LABEL: &str = "island";

/// Margin around the island that still counts as "on the island", in logical px.
/// Wider than the macOS 6 pt because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;

/// Logical-pixel gap between the bottom of the dock and the top of the taskbar.
const DOCK_GAP: f64 = 8.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
    pub dock: bool,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The poll thread owns the click-through decision so it lands in the same 16 ms
/// tick as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn accepts_pointer(rect: IslandRect, x: f64, y: f64, size: (f64, f64), down: bool, held: bool) -> bool {
    let on_island = rect.w > 0.0 && rect.h > 0.0
        && x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN
        && y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;
    let in_panel = x >= 0.0 && x <= size.0 && y >= 0.0 && y <= size.1;
    on_island || ((down || held) && in_panel)
}

/// Wakes / parks the cursor poll thread so a hidden island costs literally nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    pub ui_hold: AtomicBool,
    pub rect: Mutex<IslandRect>,
    /// Mirrors the window flag so we only call into Win32 when it changes.
    ignoring: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            ui_hold: AtomicBool::new(false),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.lock().unwrap() = rect;
    }

    /// Forces the next poll tick to re-apply the flag (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// True while the left mouse button is held — the only signal we get that a
/// drag might be in flight before it reaches the window.
fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64
        && x < (p.x + s.width as i32) as f64
        && y >= p.y as f64
        && y < (p.y + s.height as i32) as f64
}

/// The display the island lives on: the primary one, or the one under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if pref == "cursor" {
        if let Some((cx, cy)) = cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
}

/// Work area of the monitor the island lives on, in physical pixels. Falls back
/// to the full monitor rect (which equals the work area on devices that report
/// no taskbar reservation).
fn monitor_work_area(app: &AppHandle, pref: &str) -> Option<(i32, i32, u32, u32, f64)> {
    if let Some(p)=crate::dock::placement() {
        return Some((p.work.left,p.work.top,(p.work.right-p.work.left) as u32,(p.work.bottom-p.work.top) as u32,p.scale));
    }
    let m = target_monitor(app, pref)?;
    let p = m.position();
    let scale = m.scale_factor();
    unsafe {
        let hmon = MonitorFromPoint(POINT { x: p.x + 1, y: p.y + 1 }, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: std::mem::zeroed(),
            rcWork: std::mem::zeroed(),
            dwFlags: 0,
        };
        // cbSize must be set per the GetMonitorInfoW contract.
        if GetMonitorInfoW(hmon, &mut info).as_bool() {
            return Some((
                info.rcWork.left,
                info.rcWork.top,
                (info.rcWork.right - info.rcWork.left) as u32,
                (info.rcWork.bottom - info.rcWork.top) as u32,
                scale,
            ));
        }
    }
    let s = m.size();
    Some((p.x, p.y, s.width, s.height, scale))
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match monitor_work_area(app, pref) {
        Some((x, y, w, h, scale)) => ScreenInfo {
            x: x as f64 / scale,
            y: y as f64 / scale,
            width: w as f64 / scale,
            height: h as f64 / scale,
            scale,
        },
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Pure geometry helper. Given a work-area rect (logical px), the panel/strip
/// logical size, the dock gap and the scale, return the physical pixel position
/// and size of the window. Bottom-centred: the dock rests on `DOCK_GAP` above
/// the bottom edge of the work area, regardless of which edge the taskbar
/// occupies (taskbar always reduces the work area).
pub fn compute_dock_position(
    work: (i32, i32, u32, u32),
    lw: f64,
    lh: f64,
    scale: f64,
) -> (u32, u32, i32, i32) {
    let (wx, wy, ww, wh) = work;
    let pw = ((lw * scale).round().max(1.0) as u32).min(ww.max(1));
    let ph = ((lh * scale).round().max(1.0) as u32).min(wh.max(1));
    let x_phys = wx + (ww as i32 - pw as i32) / 2;
    // Round sizes once so strip/panel baselines agree at fractional DPI.
    let y_phys = (wy + wh as i32 - ph as i32 - (DOCK_GAP * scale).round() as i32).max(wy);
    (pw, ph, x_phys, y_phys)
}

/// Places and sizes the window. `collapsed` picks the wake strip instead of the panel.
pub fn apply_geometry(app: &AppHandle, pref: &str, collapsed: bool) {
    let Some(win) = window(app) else { return };
    if !collapsed {
        if let Some(p)=crate::dock::placement() {
            let r=crate::dock_position::popup(p.work,p.slot,p.edge,p.scale);
            let size=PhysicalSize::new((r.right-r.left) as u32,(r.bottom-r.top) as u32);
            let _=win.set_size(size);let _=win.set_position(PhysicalPosition::new(r.left,r.top));let _=win.set_size(size);
            let _=win.set_always_on_top(true);
            let _=app.emit_to(WINDOW_LABEL,"dock-placement",serde_json::json!({"edge":p.edge}));
            return;
        }
    }
    let Some((wx, wy, ww, wh, scale)) = monitor_work_area(app, pref) else { return };

    let (lw, lh) = if collapsed { (STRIP_W, STRIP_H) } else { (PANEL_W, PANEL_H) };
    let (pw, ph, mut x, y) = compute_dock_position((wx, wy, ww, wh), lw, lh, scale);
    if !collapsed {
        if let Some(dock) = app.get_webview_window(crate::dock::LABEL).filter(|dock| dock.is_visible().unwrap_or(false)) {
            if let (Ok(position), Ok(size)) = (dock.outer_position(), dock.outer_size()) {
                let center = position.x + size.width as i32 / 2;
                if center >= wx && center < wx + ww as i32 && ww >= pw {
                    x = (center - pw as i32 / 2).clamp(wx, wx + ww as i32 - pw as i32);
                }
            }
        }
    }

    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

fn taskbar_style(style: isize) -> isize {
    (style | WS_EX_APPWINDOW.0 as isize) & !(WS_EX_TOOLWINDOW.0 as isize)
}

/// An APPWINDOW keeps its taskbar button even while non-activating or minimized.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = taskbar_style(ex) | WS_EX_NOACTIVATE.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

pub fn close_to_taskbar(app: &AppHandle) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    shared.gate.collapsed.store(true, Ordering::Relaxed);
    shared.gate.ui_hold.store(false,Ordering::Relaxed);
    shared.gate.set_active(false);
    app.state::<crate::pipe::Pending>().release_all();
    if let Some(win) = window(app) {
        // A taskbar click must be able to activate and restore the closed window.
        set_activating(&win, true);
        let _ = win.minimize();
    }
    let _ = app.emit_to(WINDOW_LABEL, "dock-closed", ());
}

/// Called only by a taskbar restore, tray action, or explicit second launch.
pub fn open_from_taskbar(app: &AppHandle) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let Some(win) = window(app) else { return };
    shared.gate.collapsed.store(false, Ordering::Relaxed);
    // Let Tao observe the actual iconic state and issue SW_RESTORE. Clearing
    // WS_MINIMIZE first makes its state-diff restoration a no-op on Windows.
    set_activating(&win, true);
    let _ = win.unminimize();
    let pref = shared.settings.lock().unwrap().screen.clone();
    apply_geometry(app, &pref, false);
    set_ignore_cursor(app, false);
    shared.gate.forget_ignore_state();
    set_activating(&win, true);
    let _ = win.show();
    let _ = win.set_focus();
    shared.gate.set_active(true);
    let _ = app.emit_to(WINDOW_LABEL, "tray", "open".to_string());
}

fn restore_without_activation(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return; };
    set_activating(win, false);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(hwnd, GWL_STYLE,
            style & !((WS_MINIMIZE | WS_MAXIMIZE).0 as isize));
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

/// Hover reveals the popup while the user's current app keeps keyboard focus.
pub fn open_from_hover(app: &AppHandle) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let Some(win) = window(app) else { return };
    if !shared.gate.collapsed.swap(false, Ordering::Relaxed) { return; }
    restore_without_activation(&win);
    let pref = shared.settings.lock().unwrap().screen.clone();
    apply_geometry(app, &pref, false);
    set_ignore_cursor(app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(true);
    let _ = app.emit_to(WINDOW_LABEL, "tray", "hover".to_string());
}

fn covers_monitor(rect: RECT, monitor: RECT, class: &str) -> bool {
    if matches!(class, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
        return false;
    }
    rect.right > rect.left && rect.bottom > rect.top
        && rect.left <= monitor.left && rect.top <= monitor.top
        && rect.right >= monitor.right && rect.bottom >= monitor.bottom
}

fn fullscreen_foreground(win: &WebviewWindow) -> bool {
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() || Some(foreground) == hwnd_of(win) { return false; }
        let mut rect = RECT::default();
        if GetWindowRect(foreground, &mut rect).is_err() { return false; }
        let point = POINT { x: rect.left + (rect.right - rect.left) / 2, y: rect.top + (rect.bottom - rect.top) / 2 };
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() { return false; }
        if let Ok(position)=win.outer_position() {
            if position.x<info.rcMonitor.left || position.x>=info.rcMonitor.right || position.y<info.rcMonitor.top || position.y>=info.rcMonitor.bottom {return false;}
        }
        let mut class = [0u16; 128];
        let len = GetClassNameW(foreground, &mut class).max(0) as usize;
        covers_monitor(rect, info.rcMonitor, &String::from_utf16_lossy(&class[..len]))
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let (x, y, w, h, scale) = monitor_work_area(app, &pref)?;
    Some((x, y, w, h, scale.to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// visible. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, u64)> = None;
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            let mut last_dock=false;
            let mut ticks: u32 = 0;
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(16));

                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked about twice a second — the cursor poll
                // is already running, so this costs one monitor query.
                ticks = ticks.wrapping_add(1);
                if ticks % 30 == 0 {
                    if let Some(win) = window(&app) {
                        if fullscreen_foreground(&win) {
                            gate.set_active(false);
                            let handle = app.clone();
                            let _ = app.run_on_main_thread(move || close_to_taskbar(&handle));
                            break;
                        }
                    }
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed — repositioning".to_string());
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                // Hit coordinates belong to this WebView, not the dock's cached monitor.
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                let size = match win.inner_size() {
                    Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
                    Err(_) => (PANEL_W, PANEL_H),
                };
                let dock=crate::dock::pointer_bridge(&app,POINT{x:cx as i32,y:cy as i32});
                let cursor_changed = (x - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0 || dock != last_dock;

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                let r = *gate.rect.lock().unwrap();

                // A file being dragged has to be able to find us. WS_EX_TRANSPARENT
                // — what click-through is on Windows — hides the window from
                // WindowFromPoint, so OLE finds no drop target and shows the "no
                // drop" cursor. macOS has no such problem: AppKit delivers drags to
                // registered destinations whatever ignoresMouseEvents says. So while
                // a button is held anywhere over the panel, the whole panel takes
                // the mouse, which also makes the drop zone as forgiving as the Mac's.
                let down = left_button_down();

                let accept = accepts_pointer(r, x, y, size, down, gate.ui_hold.load(Ordering::Relaxed));
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!accept);
                }

                // Geometry, popup hold and button state can change under a stationary cursor.
                // Always update native hit acceptance; suppress only redundant renderer events.
                if cursor_changed {
                    last = (x, y);
                    last_dock=dock;
                    let _ = win.emit("cursor", CursorPayload { x, y, dock });
                }
            }
        }
    });
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[cfg(test)]
mod dock_geometry {
    use super::*;

    #[test]
    fn stationary_pointer_reacts_to_shape_button_and_popup_changes() {
        let small = IslandRect { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let large = IslandRect { w: 600.0, h: 480.0, ..small };
        let size = (720.0, 520.0);
        assert!(!accepts_pointer(small, 400.0, 200.0, size, false, false));
        assert!(accepts_pointer(large, 400.0, 200.0, size, false, false));
        assert!(accepts_pointer(small, 400.0, 200.0, size, true, false));
        assert!(accepts_pointer(small, 400.0, 200.0, size, false, true));
        assert!(!accepts_pointer(small, 800.0, 200.0, size, true, true));
        assert!(!accepts_pointer(IslandRect::default(), 0.0, 0.0, size, false, false));
    }

    #[test]
    fn explicit_restore_retains_iconic_state_until_tao_restores_it() {
        // Source-contract regression: a headless test cannot activate a desktop
        // HWND. Keep the explicit restore separate from the no-focus hover path.
        let source = include_str!("island.rs");
        let explicit = source.split("pub fn open_from_taskbar(app: &AppHandle) {").nth(1).unwrap()
            .split("fn restore_without_activation").next().unwrap();
        assert!(!explicit.contains("restore_without_activation(&win)"));
        assert!(!explicit.contains("SetWindowLongPtrW"));
        assert!(explicit.find("win.unminimize()").unwrap() < explicit.find("apply_geometry(").unwrap());
        let hover = source.split("pub fn open_from_hover(app: &AppHandle) {").nth(1).unwrap()
            .split("fn covers_monitor").next().unwrap();
        assert!(hover.contains("restore_without_activation(&win)"));
        assert!(!hover.contains("set_focus()"));
    }

    #[test]
    fn small_work_area_clamps_panel_at_high_dpi() {
        let (w, h, x, y) = compute_dock_position((-800, -200, 800, 600), PANEL_W, PANEL_H, 2.0);
        assert_eq!((w, h, x, y), (800, 600, -800, -200));
    }

    /// The dock rests above the work-area bottom and is horizontally centred.
    /// A 48-pixel bottom taskbar must not eat into the panel.
    #[test]
    fn bottom_center_with_bottom_taskbar() {
        // Work area already excludes the taskbar: 1920 x 1032 with a 48 px
        // taskbar on the bottom of a 1080 px monitor.
        let work = (0, 0, 1920, 1032);
        let (pw, ph, x, y) = compute_dock_position(work, PANEL_W, PANEL_H, 1.0);
        assert_eq!(pw as i32, PANEL_W as i32);
        assert_eq!(ph as i32, PANEL_H as i32);
        // left = (1920 - 720) / 2 = 600
        assert_eq!(x, 600);
        // bottom = 1032; y = 1032 - 320 - 8 = 704
        assert_eq!(y, 504);
        // Top of the dock is above the taskbar reserve line by design.
        assert!(y + ph as i32 <= work.1 + work.3 as i32);
    }

    /// The dock uses logical-px dimensions that survive DPI scaling.
    #[test]
    fn scale_dpi_100_125_200() {
        let work = (0, 0, 2880, 1620);
        let cases = [(1.0, 720u32, 520u32), (1.25, 900u32, 650u32), (2.0, 1440u32, 1040u32)];
        for (scale, exp_w, exp_h) in cases {
            let (pw, ph, _, y) = compute_dock_position(work, PANEL_W, PANEL_H, scale);
            assert_eq!(pw, exp_w, "width scale {}", scale);
            assert_eq!(ph, exp_h, "height scale {}", scale);
            let (_, sh, _, sy) = compute_dock_position(work, STRIP_W, STRIP_H, scale);
            assert_eq!(y + ph as i32, sy + sh as i32);
            assert_eq!(y + ph as i32, work.3 as i32 - (DOCK_GAP * scale).round() as i32);
            // Bottom edge stays just above the work-area bottom (8 logical px gap).
            let y_logical = (work.3 as f64 / scale) - PANEL_H - DOCK_GAP;
            assert!(y_logical > 0.0);
        }
    }

    /// A secondary monitor with negative origin must not pull the dock
    /// off-screen.
    #[test]
    fn negative_origin_monitor() {
        // Work area of a left-of-primary monitor: x = -1920, y = 0.
        let work = (-1920, 0, 1920, 1042);
        let (pw, ph, x, y) = compute_dock_position(work, PANEL_W, PANEL_H, 1.0);
        // x = -1920 + (1920 - 720)/2 = -1920 + 600 = -1320
        assert_eq!(x, -1320);
        // bottom = 1042; y = 1042 - 320 - 8 = 714
        assert_eq!(y, 514);
        assert_eq!(pw as i32, PANEL_W as i32);
        assert_eq!(ph as i32, PANEL_H as i32);
        // The dock stays inside its work area.
        assert!(x >= work.0);
        assert!(y >= work.1);
        assert!(x + pw as i32 <= work.0 + work.2 as i32);
        assert!(y + ph as i32 <= work.1 + work.3 as i32);
    }

    /// When the taskbar lives on the left, the work area already starts past
    /// it. The dock must respect that and not bleed into the reserved column.
    #[test]
    fn left_taskbar_reserve() {
        // 1920 x 1042 work area (origin x = 64 because of a 64 px left taskbar).
        let work = (64, 0, 1856, 1042);
        let (_, _, x, _) = compute_dock_position(work, PANEL_W, PANEL_H, 1.0);
        // Horizontal centre is inside the work area: 64 + (1856 - 720)/2 = 64 + 568 = 632.
        assert_eq!(x, 632);
        assert!(x >= work.0);
    }

    /// The collapsed wake strip must share the same dock baseline as the full
    /// panel — i.e. its bottom edge aligns with the panel's bottom edge. This
    /// is what makes "click on the strip → expand above it" predictable.
    #[test]
    fn collapsed_aligns_with_full_panel() {
        let work = (0, 0, 1920, 1080);
        let (_, full_h, _, full_y) = compute_dock_position(work, PANEL_W, PANEL_H, 1.0);
        let (_, strip_h, _, strip_y) = compute_dock_position(work, STRIP_W, STRIP_H, 1.0);
        // The bottom edges coincide.
        assert_eq!(full_y + full_h as i32, strip_y + strip_h as i32);
        // Strip is 6 px tall, panel 320.
        assert_eq!(strip_h as i32, 6);
        assert_eq!(full_h as i32, 520);
    }
}

#[cfg(test)]
mod taskbar_tests {
    use super::*;

    #[test]
    fn taskbar_button_survives_nonactivating_mode() {
        let style = taskbar_style((WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize);
        assert_ne!(style & WS_EX_APPWINDOW.0 as isize, 0);
        assert_eq!(style & WS_EX_TOOLWINDOW.0 as isize, 0);
        assert_ne!(style & WS_EX_NOACTIVATE.0 as isize, 0);
    }

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT { left, top, right, bottom }
    }

    #[test]
    fn fullscreen_covers_monitor_but_maximized_work_area_does_not() {
        let monitor = rect(0, 0, 2560, 1080);
        assert!(covers_monitor(monitor, monitor, "GameWindow"));
        assert!(covers_monitor(rect(-1, -1, 2561, 1081), monitor, "BrowserFullscreen"));
        assert!(!covers_monitor(rect(0, 0, 2560, 1032), monitor, "MaximizedApp"));
        assert!(!covers_monitor(rect(700, 800, 1600, 1032), monitor, "Popup"));
        assert!(!covers_monitor(RECT::default(), monitor, "Unknown"));
    }

    #[test]
    fn fullscreen_on_negative_origin_monitor_and_shell_exclusions() {
        let monitor = rect(-1920, -1080, 0, 0);
        assert!(covers_monitor(monitor, monitor, "GameWindow"));
        for class in ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            assert!(!covers_monitor(monitor, monitor, class));
        }
    }
}
