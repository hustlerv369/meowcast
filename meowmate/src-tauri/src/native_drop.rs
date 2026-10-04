//! Own OLE targets for the capsule and popup, including late WebView2 children.
//! `refresh` must run on the Tauri UI thread. It never touches unrelated HWNDs.

use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{implement, w, Ref, Result, BOOL},
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, POINTL, E_POINTER},
        System::{
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL},
            Ole::{
                IDropTarget, IDropTarget_Impl, OleInitialize, OleUninitialize,
                RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP,
                DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
            Threading::GetCurrentThreadId,
        },
        UI::{
            Shell::{DragQueryFileW, HDROP},
            WindowsAndMessaging::{
                EnumChildWindows, GetPropW, GetWindowThreadProcessId, IsChild,
                IsWindow, RemovePropW, SetPropW,
            },
        },
    },
};

const MAX_FILES: u32 = 64;
const MAX_PATH_UNITS: usize = 32_768;
const MAX_TOTAL_UNITS: usize = 262_144;
const MAX_CHILDREN: usize = 128;
const MARKER: windows::core::PCWSTR = w!("Typek.NativeDropTarget.20261003");

/// IDataObject owns the medium's release contract, even when it contains HDROP.
struct Medium(STGMEDIUM);
impl Drop for Medium {
    fn drop(&mut self) { unsafe { ReleaseStgMedium(&mut self.0) }; }
}

fn valid_file_count(count: u32) -> bool { count > 0 && count <= MAX_FILES }
fn valid_path_size(units: usize, total: usize) -> bool {
    units > 0 && units <= MAX_PATH_UNITS && total <= MAX_TOTAL_UNITS
}

fn read_files(data: Ref<'_, IDataObject>) -> Option<Vec<PathBuf>> {
    let object = data.as_ref()?;
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium = Medium(unsafe { object.GetData(&format).ok()? });
    if medium.0.tymed != TYMED_HGLOBAL.0 as u32 { return None; }
    let global = unsafe { medium.0.u.hGlobal };
    if global.0.is_null() { return None; }
    let drop = HDROP(global.0);
    let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
    if !valid_file_count(count) { return None; }
    let mut total = 0usize;
    let mut files = Vec::with_capacity(count as usize);
    for index in 0..count {
        let units = unsafe { DragQueryFileW(drop, index, None) } as usize;
        total = total.checked_add(units)?;
        if !valid_path_size(units, total) { return None; }
        let mut buffer = vec![0u16; units + 1];
        let copied = unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) } as usize;
        if copied != units { return None; }
        let path = String::from_utf16(&buffer[..units]).ok()?;
        files.push(PathBuf::from(path));
    }
    // Medium is released here. No DragFinish: the HDROP is borrowed from it.
    Some(files)
}

fn copy_allowed(effect: DROPEFFECT) -> bool { effect.0 & DROPEFFECT_COPY.0 != 0 }

fn forward(app: &AppHandle, kind: &'static str, files: Option<Vec<PathBuf>>) {
    forward_payload(app, kind, files, None, None);
}

fn forward_payload(app: &AppHandle, kind: &'static str, files: Option<Vec<PathBuf>>, drop_token: Option<String>, error: Option<String>) {
    if kind != "over" {
        crate::log::line(format!("native drop {kind}: {} file(s)", files.as_ref().map_or(0, Vec::len)));
    }
    let mut payload = if let Some(paths) = files {
        serde_json::json!({ "type": kind, "paths": paths })
    } else {
        serde_json::json!({ "type": kind })
    };
    if let Some(token) = drop_token { payload["dropToken"] = token.into(); }
    if let Some(error) = error { payload["error"] = error.into(); }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if matches!(kind, "enter" | "drop" | "error") { crate::island::open_from_hover(&handle); }
        let _ = handle.emit_to(crate::island::WINDOW_LABEL, "dock-drop", &payload);
        let _ = handle.emit_to(crate::dock::LABEL, "dock-drop-state", matches!(kind, "enter" | "over"));
    });
}

#[implement(IDropTarget)]
struct FileDropTarget {
    app: AppHandle,
    accepts: Cell<bool>,
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for FileDropTarget_Impl {
    fn DragEnter(&self, data: Ref<'_, IDataObject>, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        if effect.is_null() { return Err(E_POINTER.into()); }
        let allowed = crate::dock::is_ready() && copy_allowed(unsafe { *effect });
        let files = allowed.then(|| read_files(data)).flatten();
        self.accepts.set(files.is_some());
        unsafe { *effect = if files.is_some() { DROPEFFECT_COPY } else { DROPEFFECT_NONE }; }
        if let Some(files) = files { forward(&self.app, "enter", Some(files)); }
        Ok(())
    }

    fn DragOver(&self, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        if effect.is_null() { return Err(E_POINTER.into()); }
        let accepts = crate::dock::is_ready() && self.accepts.get() && copy_allowed(unsafe { *effect });
        unsafe { *effect = if accepts { DROPEFFECT_COPY } else { DROPEFFECT_NONE }; }
        if accepts { forward(&self.app, "over", None); }
        Ok(())
    }

    fn DragLeave(&self) -> Result<()> {
        if self.accepts.replace(false) { forward(&self.app, "leave", None); }
        Ok(())
    }

    fn Drop(&self, data: Ref<'_, IDataObject>, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        if effect.is_null() { return Err(E_POINTER.into()); }
        let allowed = self.accepts.replace(false) && crate::dock::is_ready() && copy_allowed(unsafe { *effect });
        let files = allowed.then(|| read_files(data)).flatten();
        unsafe { *effect = DROPEFFECT_NONE; }
        if let Some(files) = files {
            let reserved = if files.len() == 1 {
                crate::files::reserve_drop(&files[0])
            } else {
                Err("Přetáhni jeden soubor. Více příloh zatím nepodporujeme.".into())
            };
            match reserved {
                Ok(token) => {
                    // Keep the source open before reporting COPY: some drag
                    // sources delete their temporary file as soon as we return.
                    unsafe { *effect = DROPEFFECT_COPY; }
                    forward_payload(&self.app, "drop", Some(files), Some(token), None);
                }
                Err(error) => forward_payload(&self.app, "error", None, None, Some(error)),
            }
        } else { forward(&self.app, "leave", None); }
        Ok(())
    }
}

struct Registration {
    hwnd: HWND,
    root: HWND,
    process: u32,
    thread: u32,
    marker: HANDLE,
    // OLE also owns a reference; retain ours until this HWND is destroyed/replaced.
    _target: IDropTarget,
}

impl Registration {
    fn still_owned(&self) -> bool {
        let mut process = 0;
        unsafe {
            IsWindow(Some(self.hwnd)).as_bool()
                && (self.hwnd == self.root || IsChild(self.root, self.hwnd).as_bool())
                && GetWindowThreadProcessId(self.hwnd, Some(&mut process)) == self.thread
                && process == self.process
                && GetPropW(self.hwnd, MARKER) == self.marker
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if self.still_owned() {
            unsafe {
                let _ = RevokeDragDrop(self.hwnd);
                let _ = RemovePropW(self.hwnd, MARKER);
            }
        }
    }
}

#[derive(Default)]
struct Registry {
    targets: HashMap<isize, Registration>,
    ole_initialized: bool,
    ole_failed: bool,
    next_marker: usize,
    last_report: Option<Instant>,
}

impl Drop for Registry {
    fn drop(&mut self) {
        self.targets.clear();
        if self.ole_initialized { unsafe { OleUninitialize() }; }
    }
}

thread_local! { static REGISTRY: RefCell<Registry> = RefCell::new(Registry::default()); }

unsafe extern "system" fn collect_child(hwnd: HWND, param: LPARAM) -> BOOL {
    let children = unsafe { &mut *(param.0 as *mut Vec<HWND>) };
    if children.len() >= MAX_CHILDREN { return false.into(); }
    children.push(hwnd);
    true.into()
}

/// Install once per current HWND; a late/recreated WebView2 child is picked up on
/// the next refresh. Call from setup and a bounded UI-thread refresh controller.
pub fn refresh(app: &AppHandle) {
    crate::files::expire_drop_reservations();
    let current_thread = unsafe { GetCurrentThreadId() };
    let roots: Vec<HWND> = [crate::island::WINDOW_LABEL, crate::dock::LABEL].iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter_map(|window| window.hwnd().ok().map(|handle| HWND(handle.0)))
        .filter(|root| {
            let mut process = 0;
            unsafe { GetWindowThreadProcessId(*root, Some(&mut process)) == current_thread && process == std::process::id() }
        }).collect();
    if roots.is_empty() { return; }
    REGISTRY.with(|storage| {
        let Ok(mut registry) = storage.try_borrow_mut() else { return; };
        if registry.ole_failed { return; }
        if !registry.ole_initialized {
            match unsafe { OleInitialize(None) } {
                Ok(()) => registry.ole_initialized = true,
                Err(error) => {
                    registry.ole_failed = true;
                    crate::log::line(format!("native drop OLE unavailable: {:?}", error.code()));
                    return;
                }
            }
        }
        registry.targets.retain(|_, target| target.still_owned() && roots.contains(&target.root));
        let mut seen = HashSet::new();
        let mut added = 0usize;
        let mut failed = 0usize;
        let mut first_error = None;
        for root in roots {
            let mut windows = vec![root];
            unsafe { let _ = EnumChildWindows(Some(root), Some(collect_child), LPARAM(&mut windows as *mut Vec<HWND> as isize)); }
            for hwnd in windows {
                let key = hwnd.0 as isize;
                if !seen.insert(key) || registry.targets.contains_key(&key) { continue; }
                if !unsafe { hwnd == root || IsChild(root, hwnd).as_bool() } { continue; }
                let mut process = 0;
                let thread = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process)) };
                if thread == 0 { continue; }
                let target: IDropTarget = FileDropTarget { app: app.clone(), accepts: Cell::new(false) }.into();
                // Only these exact app roots/descendants are ever revoked. A root
                // fallback covers gaps while a new render HWND is being created.
                unsafe { let _ = RevokeDragDrop(hwnd); }
                if let Err(error) = unsafe { RegisterDragDrop(hwnd, &target) } {
                    failed += 1;
                    first_error.get_or_insert(error.code());
                    continue;
                }
                registry.next_marker = registry.next_marker.wrapping_add(1).max(1);
                let marker = HANDLE(registry.next_marker as *mut std::ffi::c_void);
                if let Err(error) = unsafe { SetPropW(hwnd, MARKER, Some(marker)) } {
                    unsafe { let _ = RevokeDragDrop(hwnd); }
                    failed += 1;
                    first_error.get_or_insert(error.code());
                    continue;
                }
                registry.targets.insert(key, Registration { hwnd, root, process, thread, marker, _target: target });
                added += 1;
            }
        }
        if added > 0 || (failed > 0 && registry.last_report.is_none_or(|at| at.elapsed() >= Duration::from_secs(5))) {
            crate::log::line(format!("native drop targets: added={added} active={} failed={failed} first_error={first_error:?}", registry.targets.len()));
            registry.last_report = Some(Instant::now());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_drop_is_rejected_whole_instead_of_truncated() {
        assert!(!valid_file_count(0));
        assert!(valid_file_count(1));
        assert!(valid_file_count(64));
        assert!(!valid_file_count(65));
        assert!(!valid_file_count(u32::MAX));
        assert!(!valid_path_size(32_769, 32_769));
        assert!(!valid_path_size(1, MAX_TOTAL_UNITS + 1));
    }

    #[test]
    fn drop_target_never_promises_move_or_link() {
        assert!(!copy_allowed(DROPEFFECT_NONE));
        assert!(!copy_allowed(DROPEFFECT(2 | 4)));
        assert!(copy_allowed(DROPEFFECT_COPY));
        assert!(copy_allowed(DROPEFFECT(1 | 2)));
    }
}
