//! A separate, non-activating capsule over a verified empty taskbar gap.
//! Explorer remains untouched. UIAutomation discovery never runs on the UI thread.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use crate::dock_position::{self, Anchor, Edge};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::core::w;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ButtonControlTypeId,
    UIA_ComboBoxControlTypeId, UIA_EditControlTypeId,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetAncestor, GetCursorPos, GetTopWindow, GetWindow, GetWindowLongPtrW,
    GetWindowRect, IsIconic, IsWindowVisible, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    WindowFromPoint, GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GW_HWNDNEXT, HWND_TOPMOST, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_MAXIMIZE, WS_MINIMIZE, WS_OVERLAPPEDWINDOW, WS_POPUP,
};

pub const LABEL: &str = "taskbar-dock";
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);
pub fn ready() {
    FRONTEND_READY.store(true, Ordering::Release);
}
pub fn is_ready() -> bool { FRONTEND_READY.load(Ordering::Acquire) }
const WIDTH: f64 = 224.0;
const HEIGHT: f64 = 52.0;

#[derive(Clone, Copy)]
pub struct Placement { pub slot: RECT, pub work: RECT, pub edge: Edge, pub scale: f64 }
struct Press { origin: POINT, moved: bool }
#[derive(Default)]
struct Runtime { anchor: Option<Anchor>, placement: Option<Placement>, press: Option<Press>, visible: bool }
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
fn runtime() -> &'static Mutex<Runtime> { RUNTIME.get_or_init(|| Mutex::new(Runtime::default())) }
pub fn placement() -> Option<Placement> { runtime().lock().ok()?.placement }
fn left_down() -> bool { unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 } }
pub fn press() {
    let mut point=POINT::default();
    if left_down() && unsafe {GetCursorPos(&mut point).is_ok()} {
        runtime().lock().unwrap().press=Some(Press {origin:point,moved:false});
    }
}

/// Only the capsule and a narrow bridge into the *visible* popup hold a preview.
pub fn pointer_bridge(app: &AppHandle, point: POINT) -> bool {
    let (visible,placement)={let state=runtime().lock().unwrap();(state.visible,state.placement)};
    if !visible { return false; }
    let Some(p)=placement else {return false};
    if contains(p.slot,point) {return true;}
    let Some(shared)=app.try_state::<crate::Shared>() else {return false};
    let Some(win)=crate::island::window(app) else {return false};
    let Ok(origin)=win.outer_position() else {return false};
    let r=*shared.gate.rect.lock().unwrap();
    let panel=RECT{left:origin.x+(r.x*p.scale) as i32,top:origin.y+(r.y*p.scale) as i32,
        right:origin.x+((r.x+r.w)*p.scale) as i32,bottom:origin.y+((r.y+r.h)*p.scale) as i32};
    let bridge=match p.edge {
        Edge::Bottom => RECT{left:p.slot.left.max(panel.left),right:p.slot.right.min(panel.right),top:panel.bottom-2,bottom:p.slot.top+2},
        Edge::Top => RECT{left:p.slot.left.max(panel.left),right:p.slot.right.min(panel.right),top:p.slot.bottom-2,bottom:panel.top+2},
        Edge::Left => RECT{left:p.slot.right-2,right:panel.left+2,top:p.slot.top.max(panel.top),bottom:p.slot.bottom.min(panel.bottom)},
        Edge::Right => RECT{left:panel.right-2,right:p.slot.left+2,top:p.slot.top.max(panel.top),bottom:p.slot.bottom.min(panel.bottom)},
    };
    contains(bridge,point)
}

fn persist(anchor: &Anchor) {
    let dir=crate::settings::local_dir();
    if let Ok(json)=serde_json::to_vec(anchor) {
        let result=std::fs::create_dir_all(&dir).and_then(|_|std::fs::write(dir.join("dock-position.json"),json));
        if result.is_err() {crate::log::line("dock position could not be saved");}
    }
}

struct Display { name:String, rect:RECT, work:RECT, scale:f64 }
fn displays(app: &AppHandle) -> Vec<Display> {
    app.available_monitors().unwrap_or_default().iter().map(|m| {
        let pos=m.position();let size=m.size();
        let rect=RECT{left:pos.x,top:pos.y,right:pos.x+size.width as i32,bottom:pos.y+size.height as i32};
        let mut info=MONITORINFO{cbSize:std::mem::size_of::<MONITORINFO>() as u32,..Default::default()};
        let work=unsafe {if GetMonitorInfoW(MonitorFromPoint(POINT{x:pos.x+1,y:pos.y+1},MONITOR_DEFAULTTONEAREST),&mut info).as_bool(){info.rcWork}else{rect}};
        Display{name:m.name().cloned().unwrap_or_default(),rect,work,scale:m.scale_factor()}
    }).collect()
}

fn monitor_fullscreen(app:&AppHandle, monitor:RECT, work:RECT) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    unsafe {
        if let Some((bar,r))=bar_rect() {
            if r.left>=monitor.left&&r.right<=monitor.right&&r.top>=monitor.top&&r.bottom<=monitor.bottom {
                let mut probe=r;
                probe.left=((r.left+r.right)/2-80).max(r.left+3);
                probe.right=(probe.left+160).min(r.right-3);
                probe.top=r.top+3;
                probe.bottom=r.bottom-3;
                if !taskbar_occluded(app,bar,probe) {return false;}
            }
        }
        let own:Vec<_>=[LABEL,crate::island::WINDOW_LABEL,"settings"].iter()
            .filter_map(|label|app.get_webview_window(label).and_then(|w|w.hwnd().ok()).map(|h|HWND(h.0))).collect();
        let mut next=GetTopWindow(None).ok();
        for _ in 0..512 {
            let Some(hwnd)=next else {break};next=GetWindow(hwnd,GW_HWNDNEXT).ok();
            if own.contains(&hwnd)||!IsWindowVisible(hwnd).as_bool()||IsIconic(hwnd).as_bool(){continue;}
            let mut cloaked=0u32;
            let _=DwmGetWindowAttribute(hwnd,DWMWA_CLOAKED,&mut cloaked as *mut _ as *mut _,4);
            if cloaked!=0 {continue;}
            let ex=GetWindowLongPtrW(hwnd,GWL_EXSTYLE);
            if ex & WS_EX_TRANSPARENT.0 as isize !=0 {continue;}
            let mut class=[0u16;128];let len=GetClassNameW(hwnd,&mut class).max(0) as usize;
            let class=String::from_utf16_lossy(&class[..len]);
            if matches!(class.as_ref(),"Progman"|"WorkerW") {continue;}
            let mut r=RECT::default();if GetWindowRect(hwnd,&mut r).is_err(){continue;}
            if matches!(class.as_ref(),"Shell_TrayWnd"|"Shell_SecondaryTrayWnd") {
                if r.left>=monitor.left&&r.right<=monitor.right&&r.top>=monitor.top&&r.bottom<=monitor.bottom{return false;}
                continue;
            }
            if r.left<=monitor.left&&r.right>=monitor.right&&r.top<=monitor.top&&r.bottom>=monitor.bottom{return true;}
            // A normal maximized app above a background fullscreen surface owns this display.
            if r.left<=work.left&&r.right>=work.right&&r.top<=work.top&&r.bottom>=work.bottom{return false;}
        }
        false
    }
}

pub fn forward_drop(app:&AppHandle, event:&tauri::DragDropEvent) {
    if !FRONTEND_READY.load(Ordering::Acquire) {return;}
    let payload=match event {
        tauri::DragDropEvent::Enter{paths,..} => serde_json::json!({"type":"enter","paths":paths}),
        tauri::DragDropEvent::Over{..} => serde_json::json!({"type":"over"}),
        tauri::DragDropEvent::Drop{paths,..} => serde_json::json!({"type":"drop","paths":paths}),
        tauri::DragDropEvent::Leave => serde_json::json!({"type":"leave"}),
        _ => return,
    };
    if !matches!(event,tauri::DragDropEvent::Leave) {crate::island::open_from_hover(app);}
    let _=app.emit_to(crate::island::WINDOW_LABEL,"dock-drop",&payload);
    let _=app.emit_to(LABEL,"dock-drop-state",!matches!(event,tauri::DragDropEvent::Leave|tauri::DragDropEvent::Drop{..}));
}

/// All occupied spans are merged before selecting a blank horizontal gap.
pub fn gap_position(bar: RECT, occupied: &[RECT], scale: f64) -> Option<RECT> {
    gap_position_near(bar,occupied,scale,None)
}
fn gap_position_near(bar: RECT, occupied: &[RECT], scale: f64, desired: Option<i32>) -> Option<RECT> {
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let width = (WIDTH * scale).round() as i32;
    let height = (HEIGHT * scale).round() as i32;
    let pad = (8.0 * scale).round() as i32;
    if bar.right - bar.left <= bar.bottom - bar.top || bar.bottom - bar.top < height {
        return None;
    }
    let mut spans: Vec<(i32, i32)> = occupied
        .iter()
        .filter(|r| r.right > r.left && r.bottom > bar.top && r.top < bar.bottom)
        .map(|r| (r.left.max(bar.left), r.right.min(bar.right)))
        .filter(|(l, r)| r > l)
        .collect();
    if spans.is_empty() {
        return None;
    } // Missing Explorer accessibility is not a blank taskbar.
    spans.sort_unstable();
    spans.push((bar.right, bar.right));
    let mut edge = bar.left;
    let mut best = None;
    let mut best_size = 0;
    let mut best_distance = i32::MAX;
    for (left, right) in spans {
        let size = left - edge;
        if size >= width + pad * 2 {
            let x = desired.map(|cx|(cx-width/2).clamp(edge+pad,left-pad-width)).unwrap_or(edge+(size-width)/2);
            let distance=desired.map(|cx|(x+width/2-cx).abs()).unwrap_or(0);
            if (desired.is_some() && distance>=best_distance) || (desired.is_none() && size<=best_size) {edge=edge.max(right);continue;}
            best_distance=distance;
            best_size = size;
            let y = bar.top + (bar.bottom - bar.top - height) / 2;
            best = Some(RECT {
                left: x,
                top: y,
                right: x + width,
                bottom: y + height,
            });
        }
        edge = edge.max(right);
    }
    best
}

fn contains(r: RECT, p: POINT) -> bool {
    p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
}

unsafe fn bar_rect() -> Option<(HWND, RECT)> {
    let bar = FindWindowW(w!("Shell_TrayWnd"), None).ok()?;
    if !IsWindowVisible(bar).as_bool() {
        return None;
    }
    let mut rect = RECT::default();
    GetWindowRect(bar, &mut rect).ok()?;
    let mut monitor = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let middle = POINT {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
    };
    if !GetMonitorInfoW(
        MonitorFromPoint(middle, MONITOR_DEFAULTTONEAREST),
        &mut monitor,
    )
    .as_bool()
    {
        return None;
    }
    // An auto-hidden/offscreen bar cannot host the capsule.
    if rect.left < monitor.rcMonitor.left
        || rect.top < monitor.rcMonitor.top
        || rect.right > monitor.rcMonitor.right
        || rect.bottom > monitor.rcMonitor.bottom
    {
        return None;
    }
    Some((bar, rect))
}

unsafe fn occupied(automation: &IUIAutomation, bar: HWND) -> Option<Vec<RECT>> {
    let root = automation.ElementFromHandle(bar).ok()?;
    let all = root
        .FindAll(
            TreeScope_Descendants,
            &automation.CreateTrueCondition().ok()?,
        )
        .ok()?;
    let count = all.Length().ok()?.min(500);
    let mut rects = Vec::new();
    for index in 0..count {
        let Ok(element) = all.GetElement(index) else {
            continue;
        };
        let Ok(kind) = element.CurrentControlType() else {
            continue;
        };
        if ![
            UIA_ButtonControlTypeId,
            UIA_EditControlTypeId,
            UIA_ComboBoxControlTypeId,
        ]
        .contains(&kind)
        {
            continue;
        }
        if element
            .CurrentIsOffscreen()
            .map(|v| v.as_bool())
            .unwrap_or(true)
        {
            continue;
        }
        if let Ok(rect) = element.CurrentBoundingRectangle() {
            rects.push(rect);
        }
    }
    Some(rects)
}

fn taskbar_occluded(app: &AppHandle, bar: HWND, slot: RECT) -> bool {
    unsafe {
        // Explorer can paint its raised taskbar above a fullscreen surface even
        // while that surface remains ahead of Shell_TrayWnd in native z-order.
        // Probe the free margin, outside our own topmost capsule.
        let probes = [
            POINT {
                x: slot.left - 2,
                y: (slot.top + slot.bottom) / 2,
            },
            POINT {
                x: slot.right + 2,
                y: (slot.top + slot.bottom) / 2,
            },
            POINT {
                x: (slot.left + slot.right) / 2,
                y: slot.bottom + 2,
            },
        ];
        if probes
            .into_iter()
            .all(|point| GetAncestor(WindowFromPoint(point), GA_ROOT) == bar)
        {
            return false;
        }
        let own: Vec<HWND> = [LABEL, crate::island::WINDOW_LABEL, "settings"]
            .into_iter()
            .filter_map(|label| {
                app.get_webview_window(label)
                    .and_then(|w| w.hwnd().ok())
                    .map(|h| HWND(h.0))
            })
            .collect();
        let mut next = GetTopWindow(None).ok();
        // The taskbar can be covered on one display while another owns focus.
        // Native z-order checks stay bounded and never wait for UIAutomation.
        for _ in 0..512 {
            let Some(hwnd) = next else {
                return true;
            };
            if hwnd == bar {
                return false;
            }
            next = GetWindow(hwnd, GW_HWNDNEXT).ok();
            if own.contains(&hwnd) || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                continue;
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let overlay = (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE).0 as isize;
            if ex & overlay == overlay {
                continue;
            }
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut _ as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
            {
                continue;
            }
            let mut rect = RECT::default();
            // WindowRect includes an invisible resize border above the taskbar.
            let have_rect = DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut _ as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
            .is_ok()
                || GetWindowRect(hwnd, &mut rect).is_ok();
            if have_rect
                && rect.left < slot.right
                && rect.right > slot.left
                && rect.top < slot.bottom
                && rect.bottom > slot.top
            {
                return true;
            }
        }
        true
    }
}

fn place_capsule(win: &WebviewWindow, r: RECT) -> bool {
    let Ok(handle) = win.hwnd() else {
        return false;
    };
    unsafe {
        let hwnd = HWND(handle.0);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_STYLE,
            (style & !((WS_OVERLAPPEDWINDOW | WS_MINIMIZE | WS_MAXIMIZE).0 as isize))
                | WS_POPUP.0 as isize,
        );
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            (ex | WS_EX_TOOLWINDOW.0 as isize | WS_EX_NOACTIVATE.0 as isize)
                & !(WS_EX_APPWINDOW.0 as isize),
        );
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        )
        .is_ok()
    }
}

pub fn start(app: AppHandle) {
    FRONTEND_READY.store(false, Ordering::Release);
    let args = crate::settings_browser_args(app.config());
    let url = {
        #[cfg(dev)]
        {
            let mut base = app.config().build.dev_url.clone().unwrap();
            base.set_path("/dock.html");
            WebviewUrl::External(base)
        }
        #[cfg(not(dev))]
        {
            WebviewUrl::App("dock.html".into())
        }
    };
    let Ok(win) = WebviewWindowBuilder::new(&app, LABEL, url)
        .additional_browser_args(args)
        .title("Meowmate — lišta")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()
    else {
        crate::log::line("taskbar capsule could not be created");
        return;
    };
    if let Ok(handle) = win.hwnd() {
        unsafe {
            let hwnd = HWND(handle.0);
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                (style | WS_EX_TOOLWINDOW.0 as isize | WS_EX_NOACTIVATE.0 as isize)
                    & !(WS_EX_APPWINDOW.0 as isize),
            );
        }
    }
    runtime().lock().unwrap().anchor=std::fs::read(crate::settings::local_dir().join("dock-position.json"))
        .ok().and_then(|b|serde_json::from_slice::<Anchor>(&b).ok())
        .filter(|a|a.fraction.is_finite() && a.monitor.len()<512);
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
            return;
        }
        let automation: Result<IUIAutomation, _> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        if let Ok(automation) = automation {
            loop {
                let slot = bar_rect().and_then(|(bar, rect)| {
                    occupied(&automation, bar).map(|rows| (rect,rows,GetDpiForWindow(bar) as f64 / 96.0))
                });
                if tx.send((slot, Instant::now())).is_err() {break;}
                std::thread::sleep(Duration::from_secs(3));
            }
        }
        CoUninitialize();
    });
    std::thread::spawn(move || {
        let queued = Arc::new(AtomicBool::new(false));
        let mut cached = None;
        let mut screens=displays(&app);
        let mut screen_at=Instant::now();
        let mut hover = None;
        let mut opened = false;
        let mut suppress_until=Instant::now();
        let mut last_rect: Option<(i32, i32, i32, i32)> = None;
        let mut drop_refresh=Instant::now()-Duration::from_secs(1);
        loop {
            while let Ok(next) = rx.try_recv() {
                cached = Some(next);
            }
            if screen_at.elapsed()>Duration::from_secs(1) {
                screens=displays(&app);screen_at=Instant::now();
            }
            let mut point = POINT::default();
            let have_cursor=unsafe {GetCursorPos(&mut point).is_ok()};
            let down=left_down();
            let mut close_for_drag=false;
            let mut explicit_click=false;
            let (anchor,dragging)={
                let mut state=runtime().lock().unwrap();
                if let Some(mut press)=state.press.take() {
                    if have_cursor && ((point.x-press.origin.x).abs()>6 || (point.y-press.origin.y).abs()>6) {
                        if !press.moved {close_for_drag=true;}
                        press.moved=true;
                        if let Some(display)=screens.iter().find(|m|contains(m.rect,point)) {
                            let edge=dock_position::nearest_edge(display.work,point);
                            state.anchor=Some(Anchor{monitor:display.name.clone(),edge,fraction:dock_position::fraction(display.work,point,edge)});
                        }
                    }
                    if down {state.press=Some(press);} else if press.moved {
                        if let Some(anchor)=&state.anchor {persist(anchor);}
                        suppress_until=Instant::now()+Duration::from_millis(500);
                    } else {explicit_click=true;}
                }
                (state.anchor.clone(),state.press.is_some())
            };
            let display=anchor.as_ref().and_then(|a|screens.iter().find(|m|m.name==a.monitor))
                .or_else(||screens.iter().find(|m|contains(m.rect,POINT{x:0,y:0}))).or_else(||screens.first());
            let mut selected=None;
            let mut visible=None;
            if let Some(display)=display {
                let scale=display.scale;
                let edge=anchor.as_ref().map(|a|a.edge).unwrap_or(Edge::Bottom);
                let fraction=anchor.as_ref().map(|a|a.fraction).unwrap_or(0.75);
                let fallback=dock_position::position(display.work,scale,edge,fraction);
                let gap=if edge==Edge::Bottom {cached.as_ref().and_then(|(cache,at):&(Option<(RECT,Vec<RECT>,f64)>,Instant)| {
                    if at.elapsed()>Duration::from_secs(12) {return None;}
                    let (bar,rows,_)=cache.as_ref()?;
                    if bar.left<display.rect.left || bar.right>display.rect.right || bar.bottom!=display.rect.bottom {return None;}
                    let desired=anchor.as_ref().map(|_|(display.rect.left as f64+fraction*(display.rect.right-display.rect.left) as f64) as i32);
                    let slot=if desired.is_some(){gap_position_near(*bar,rows,scale,desired)}else{gap_position(*bar,rows,scale)}?;
                    // A manual anchor must follow the hand, not jump across occupied icons.
                    if desired.map(|x|((slot.left+slot.right)/2-x).abs()>40).unwrap_or(false) {return None;}
                    Some(slot)
                })}else{None};
                let slot=gap.unwrap_or(fallback);
                let hidden=if gap.is_some() {unsafe {bar_rect().map(|(bar,_)|taskbar_occluded(&app,bar,slot)).unwrap_or(true)}}
                    else {monitor_fullscreen(&app,display.rect,display.work)};
                selected=Some(Placement{slot,work:display.work,edge,scale});
                if !hidden {visible=Some(slot);}
            }
            {
                let mut state=runtime().lock().unwrap();state.placement=selected;state.visible=visible.is_some();
            }
            let inside = have_cursor
                && visible.map(|r| contains(r, point)).unwrap_or(false);
            if inside && !dragging && Instant::now()>=suppress_until {
                if hover.is_none() {
                    hover = Some(Instant::now());
                }
            } else {
                hover = None;
                opened = false;
            }
            let reveal = FRONTEND_READY.load(Ordering::Acquire)
                && !opened
                && hover
                    .map(|at| at.elapsed() >= Duration::from_millis(200))
                    .unwrap_or(false);
            let next_rect = visible.map(|r| (r.left, r.top, r.right, r.bottom));
            let native_visible=app.get_webview_window(LABEL).and_then(|w|w.hwnd().ok())
                .map(|h|unsafe {IsWindowVisible(HWND(h.0)).as_bool()}).unwrap_or(false);
            let changed = last_rect != next_rect || native_visible!=visible.is_some();
            let refresh_drop=drop_refresh.elapsed()>=Duration::from_millis(500);
            if !changed && !reveal && !close_for_drag && !explicit_click && !refresh_drop {
                std::thread::sleep(Duration::from_millis(32));
                continue;
            }
            if !queued.swap(true, Ordering::AcqRel) {
                let done = queued.clone();
                let app_for_ui = app.clone();
                let dispatched = app.run_on_main_thread(move || {
                    if refresh_drop {crate::native_drop::refresh(&app_for_ui);}
                    if close_for_drag {crate::island::close_to_taskbar(&app_for_ui);}
                    if !changed && !reveal && !explicit_click {
                        done.store(false, Ordering::Release);
                        return;
                    }
                    if let Some(win) = app_for_ui.get_webview_window(LABEL) {
                        if let Some(r) = visible {
                            // Keep Tao/WebView2 visibility coherent, then remove native frame.
                            if !native_visible {let _=win.show();}
                            if place_capsule(&win, r) && reveal && !dragging {
                                crate::island::open_from_hover(&app_for_ui);
                            }
                            if explicit_click {crate::island::open_from_taskbar(&app_for_ui);}
                        } else {
                            let _=win.hide();
                            if let Ok(handle) = win.hwnd() {
                                unsafe {
                                    let _ = ShowWindow(HWND(handle.0), SW_HIDE);
                                }
                            }
                        }
                    }
                    done.store(false, Ordering::Release);
                });
                if dispatched.is_ok() {
                    if refresh_drop {drop_refresh=Instant::now();}
                    last_rect = next_rect;
                    if reveal {
                        opened = true;
                    }
                } else {
                    queued.store(false, Ordering::Release);
                }
            }
            std::thread::sleep(Duration::from_millis(32));
        }
    });
}

pub fn status(app: &AppHandle, working: usize, color: &str) {
    use tauri::Emitter;
    let _ = app.emit_to(
        LABEL,
        "taskbar-status",
        serde_json::json!({"working":working,"color":color}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(l: i32, t: i32, r: i32, b: i32) -> RECT {
        RECT {
            left: l,
            top: t,
            right: r,
            bottom: b,
        }
    }
    #[test]
    fn gap_between_icons_and_tray() {
        let r = gap_position(
            rect(0, 1016, 2560, 1080),
            &[rect(0, 1016, 1071, 1080), rect(2063, 1016, 2560, 1080)],
            1.0,
        )
        .unwrap();
        assert_eq!((r.left, r.top, r.right, r.bottom), (1455, 1022, 1679, 1074));
    }
    #[test]
    fn occupied_overlaps_merge() {
        let r = gap_position(
            rect(0, 0, 1000, 64),
            &[
                rect(0, 0, 250, 64),
                rect(100, 0, 450, 64),
                rect(750, 0, 1000, 64),
            ],
            1.0,
        )
        .unwrap();
        assert_eq!(r.left, 488);
    }
    #[test]
    fn crowds_unknown_vertical_hide() {
        assert!(gap_position(
            rect(0, 0, 200, 64),
            &[rect(0, 0, 100, 64), rect(160, 0, 200, 64)],
            1.0
        )
        .is_none());
        assert!(gap_position(rect(0, 0, 1000, 64), &[], 1.0).is_none());
        assert!(gap_position(rect(0, 0, 48, 1080), &[rect(0, 0, 48, 90)], 1.0).is_none());
    }
    #[test]
    fn dpi_and_negative_coordinates() {
        for s in [1.25, 2.0] {
            let r = gap_position(
                rect(-2000, -128, 0, 0),
                &[rect(-2000, -128, -1300, 0), rect(-500, -128, 0, 0)],
                s,
            )
            .unwrap();
            assert_eq!(r.right - r.left, (WIDTH * s) as i32);
            assert!(r.top >= -128 && r.bottom <= 0);
        }
    }
    #[test]
    fn manual_gap_follows_pointer_without_covering_icons() {
        let bar=rect(0,1016,1920,1080);
        let occupied=[rect(0,1016,900,1080),rect(1700,1016,1920,1080)];
        let slot=gap_position_near(bar,&occupied,1.0,Some(1100)).unwrap();
        assert_eq!((slot.left+slot.right)/2,1100);
        let slot=gap_position_near(bar,&occupied,1.0,Some(800)).unwrap();
        assert!(slot.left>=908 && slot.right<=1692);
    }
}
