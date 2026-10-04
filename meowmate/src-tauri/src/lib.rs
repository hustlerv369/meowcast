// Coucou for Windows — app wiring and the commands the island calls.

mod activity;
mod codex;
mod dock;
mod dock_position;
mod encoding;
mod files;
mod gemini_browser;
mod hooks;
mod integrations;
mod island;
mod log;
mod native_drop;
mod pipe;
mod projects;
mod secrets;
mod settings;
mod shared_theme;
mod surfaces;
mod tray;
mod win_user;
mod work;

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use codex::{Chat, ChatContext, ChatReply, ChatStatus};
use files::DroppedFile;
use hooks::{HookPreview, HookStatus};
use island::{PollGate, ScreenInfo};
use pipe::Pending;
use settings::Settings;

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    hook_path: String,
    collapsed: bool,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let mut settings = shared.settings.lock().unwrap().clone();
    // The real state of ~/.claude/settings.json wins over whatever we stored.
    settings.hooks_installed = hooks::status().installed;
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
        collapsed: shared.gate.collapsed.load(Ordering::Relaxed),
    }
}

/// Apply OS registration and persistence before publishing the new preference.
fn commit_settings(
    current: &mut Settings,
    next: &Settings,
    persist: impl FnOnce(&Settings) -> Result<(), ()>,
    mut autostart: impl FnMut(bool) -> Result<(), ()>,
) -> Result<(), String> {
    let changed = current.autostart != next.autostart;
    if changed {
        autostart(next.autostart).map_err(|_| "Windows startup registration failed. Your settings were not saved. Try again.".to_string())?;
    }
    if persist(next).is_err() {
        if changed && autostart(current.autostart).is_err() {
            return Err("Settings could not be saved and Windows startup could not be restored. Check Startup Apps in Windows Settings.".into());
        }
        return Err("Settings could not be saved. Check that the settings folder is writable and try again.".into());
    }
    *current = next.clone();
    Ok(())
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) -> Result<(), String> {
    let screen_changed = {
        let mut current = shared.settings.lock().unwrap();
        let changed = current.screen != settings.screen;
        commit_settings(&mut current, &settings,
            |value| settings::save(value).map_err(|_| ()),
            |enabled| {
                let manager = app.autolaunch();
                (if enabled { manager.enable() } else { manager.disable() }).map_err(|_| ())
            })?;
        changed
    };
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        if !collapsed { island::apply_geometry(&app, &settings.screen, false); }
    }
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

/// Frontend transitions can close the popup, but cannot restore a closed app.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    if collapsed {
        island::close_to_taskbar(&app);
        return;
    }
    if shared.gate.collapsed.load(Ordering::Relaxed) { return; }
    let pref = shared.settings.lock().unwrap().screen.clone();
    island::apply_geometry(&app, &pref, false);
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(true);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    if app.state::<Shared>().gate.collapsed.load(Ordering::Relaxed) { return; }
    let Some(win) = island::window(&app) else { return };
    island::set_activating(&win, focused);
    if focused {
        // Hover restores native HWND without activation. Synchronize Tao's
        // minimized flag before an explicit click asks it to focus the window.
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    if !collapsed { island::apply_geometry(&app, &pref, false); }
}

#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn gemini_browser_command() -> Result<Command, String> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| "Could not locate the Windows browser launcher.".to_string())?;
    let executable = std::path::PathBuf::from(system_root).join("System32").join("rundll32.exe");
    let mut command = Command::new(executable);
    command.args(["url.dll,FileProtocolHandler", "https://gemini.google.com/app"])
        .creation_flags(CREATE_NO_WINDOW);
    Ok(command)
}

/// Fixed browser handoff. No prompt, account, or arbitrary URL is accepted.
#[tauri::command]
fn open_gemini() -> Result<(), String> {
    gemini_browser_command()?.spawn()
        .map(|_| ())
        .map_err(|_| "Could not open your browser. Open gemini.google.com manually.".to_string())
}

/// "Open terminal" opens the working folder in VS Code when `code` is on PATH,
/// and falls back to Explorer otherwise.
#[tauri::command]
fn open_in_vscode(path: Option<String>) -> bool {
    let path = match path.as_deref().filter(|p| !p.is_empty()) {
        Some(input) => match projects::validate_path(std::path::Path::new(input)) {
            Ok(validated) => Some(validated.to_string_lossy().trim_start_matches("\\\\?\\").to_string()),
            Err(_) => return false,
        },
        None => None,
    };
    // No `cmd /C` anywhere near this. The path is a project folder chosen by
    // whoever is using Claude Code, and cmd would happily read `&`, `^` and `%`
    // in a folder name as syntax. Finding the launcher ourselves and handing the
    // path over as a separate argument keeps it a path.
    if let Some(code) = find_on_path("code") {
        let mut cmd = Command::new(code);
        if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
            cmd.arg(p);
        }
        if cmd.creation_flags(CREATE_NO_WINDOW).spawn().is_ok() {
            return true;
        }
    }
    if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
        let _ = Command::new("explorer").arg(p).spawn();
    }
    false
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
fn find_on_path(stem: &str) -> Option<std::path::PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Tray → Pause. Paused means paused: the pollers stop talking to the network,
/// not just the island stopping showing things.
#[tauri::command]
fn set_paused(paused: bool) {
    integrations::set_paused(paused);
}

#[tauri::command]
fn activity_snapshot(store: State<activity::ActivityStore>) -> Vec<coucou_observer::Activity> {
    store.0.lock().map(|rows| rows.iter().map(|r| r.activity.clone()).collect()).unwrap_or_default()
}

#[tauri::command]
fn activity_project(id: String, store: State<activity::ActivityStore>) -> bool {
    let target = store.0.lock().ok().and_then(|rows| rows.iter().find(|r| r.activity.id == id).and_then(|r| r.project_path.clone()));
    let Some(path) = target else { return false };
    // Never open a remote share or a junction supplied by an event record.
    use std::os::windows::fs::MetadataExt;
    for ancestor in path.ancestors() {
        let Ok(meta) = std::fs::symlink_metadata(ancestor) else { return false };
        if meta.file_attributes() & 0x400 != 0 { return false; }
    }
    if !path.is_dir() { return false; }
    open_in_vscode(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_surface(id: String) -> bool { surfaces::open(&id) }

// ── Claude Code hooks ─────────────────────────────────────────────────────────

#[tauri::command]
fn hooks_status() -> HookStatus {
    hooks::status()
}

/// Returns the diff the user has to look at before anything is written.
#[tauri::command]
fn hooks_preview(install: bool) -> Result<HookPreview, String> {
    hooks::preview(install)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn hooks_apply(
    app: AppHandle,
    shared: State<Shared>,
    install: bool,
    fingerprint: String,
) -> Result<String, String> {
    // The fingerprint comes from the preview the user actually looked at, so a
    // settings.json that changed in between is refused rather than overwritten.
    let backup = hooks::write(install, &fingerprint)?;
    let updated = {
        let mut current = shared.settings.lock().unwrap();
        current.hooks_installed = install;
        let _ = settings::save(&current);
        current.clone()
    };
    let _ = app.emit("settings-changed", updated);
    Ok(backup)
}

#[tauri::command]
fn approval_decision(app: AppHandle, request_id: String, decision: String) {
    if app.state::<Shared>().gate.collapsed.load(Ordering::Relaxed) {
        pipe::decline(&app, &request_id);
        return;
    }
    pipe::answer(&app, &request_id, &decision);
}

/// The island has the card on screen, so the long wait for a human may begin.
/// Until this arrives the relay only waits a few hundred milliseconds, which is
/// what stops a paused or unresponsive island from freezing Claude Code.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    if app.state::<Shared>().gate.collapsed.load(Ordering::Relaxed) {
        pipe::decline(&app, &request_id);
        return;
    }
    pipe::acknowledge(&app, &request_id);
}

/// Nobody can act on this request — the island is paused, or another card is
/// already up. Claude Code falls back to asking in the terminal immediately.
#[tauri::command]
fn approval_decline(app: AppHandle, request_id: String) {
    pipe::decline(&app, &request_id);
}

// ── Chat, files and secrets ───────────────────────────────────────────────────

/// Codex owns subscription authentication; the UI receives only chat text.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    shared: State<'_, Shared>,
    chat: State<'_, Arc<Chat>>,
    query: String,
    context: Option<ChatContext>,
    request_id: String,
) -> Result<ChatReply, String> {
    let model = shared.settings.lock().unwrap().codex_model.clone();
    let chat = chat.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        chat.send(&model, query, context, request_id, |delta| {
            let _ = app.emit("chat-delta", delta);
        })
    }).await.map_err(|_| "Chat se nepodařilo dokončit.".to_string())?
}

#[tauri::command]
async fn chat_status(shared: State<'_, Shared>, chat: State<'_, Arc<Chat>>, model: Option<String>) -> Result<ChatStatus, String> {
    let model = model.unwrap_or_else(|| shared.settings.lock().unwrap().codex_model.clone());
    let chat = chat.inner().clone();
    tauri::async_runtime::spawn_blocking(move || chat.status(&model))
        .await.map_err(|_| "Připojení ke Codexu se nepodařilo ověřit.".to_string())?
}

#[tauri::command]
async fn chat_reset(app: AppHandle, chat: State<'_, Arc<Chat>>) -> Result<(), String> {
    let chat = chat.inner().clone();
    tauri::async_runtime::spawn_blocking(move || chat.reset())
        .await.map_err(|_| "Nový chat se nepodařilo otevřít.".to_string())??;
    let _ = app.emit("chat-reset", ());
    Ok(())
}

#[tauri::command]
fn chat_cancel(chat: State<Arc<Chat>>) -> bool {
    chat.cancel()
}

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
async fn ingest_file(path: String, drop_token: Option<String>) -> Result<DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || files::ingest_request(&path, drop_token.as_deref())).await.map_err(|_|"Přílohu se nepodařilo zkopírovat.".to_string())?
}

/// The island may only ask whether a key exists — never read it.
#[tauri::command]
fn secret_present(key: String) -> bool {
    secrets::present(&key)
}

#[tauri::command]
fn secret_set(window: tauri::WebviewWindow, key: String, value: String) -> Result<(), String> {
    require_settings_window(window.label())?;
    secrets::set(&key, &value)
}

#[tauri::command]
fn secret_clear(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    require_settings_window(window.label())?;
    secrets::clear(&key)
}

fn require_settings_window(label: &str) -> Result<(), String> {
    if label == "settings" { Ok(()) } else { Err("Open Settings to change credentials.".into()) }
}

/// Opens the configured n8n instance — the URL lives in the Credential Manager.
#[tauri::command]
fn open_n8n() {
    if let Some(url) = secrets::get("n8n-url") {
        open_url(url);
    }
}

/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    integrations::poll_once(app, &id).await;
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
fn settings_browser_args(config: &tauri::Config) -> &str {
    config.app.windows.iter().find(|window| window.label == island::WINDOW_LABEL)
        .and_then(|window| window.additional_browser_args.as_deref()).unwrap_or("")
}

#[tauri::command]
fn dock_open(app:AppHandle) { island::open_from_taskbar(&app); }
#[tauri::command]
fn dock_ready() { dock::ready(); }
#[tauri::command]
fn dock_press() { dock::press(); }
#[tauri::command]
fn popup_interaction(state: State<'_, Shared>, active:bool) { state.gate.ui_hold.store(active,Ordering::Relaxed); }
#[tauri::command]
fn project_targets(app:AppHandle)->Vec<projects::Project> {projects::targets(&app)}
#[tauri::command]
fn project_selected(app:AppHandle,id:String)->Option<projects::Project>{projects::selected(&app,&id)}
#[tauri::command]
async fn project_pick()->Option<projects::Project>{tauri::async_runtime::spawn_blocking(projects::pick).await.ok().flatten()}
#[tauri::command]
async fn work_auth(app:AppHandle,provider:String)->Result<projects::WorkAuth,String>{
    if provider=="claude" {return tauri::async_runtime::spawn_blocking(projects::claude_auth).await.map_err(|_|"Stav Clauda není dostupný.".into());}
    if provider!="codex"{return Err("Vyber Codex nebo Claude Code.".into());}
    let chat=app.state::<Arc<Chat>>().inner().clone();
    let model=app.state::<Shared>().settings.lock().unwrap().codex_model.clone();
    tauri::async_runtime::spawn_blocking(move||chat.status(&model).map(|s|projects::WorkAuth{connected:s.connected,provider:"codex".into(),message:s.message})).await.map_err(|_|"Stav Codexu není dostupný.".to_string())?
}
#[tauri::command]
fn claude_login()->Result<(),String>{projects::login()}

#[tauri::command]
fn project_work_list(manager:State<Arc<work::WorkManager>>)->Vec<work::WorkJob>{manager.list()}
#[tauri::command]
fn project_work_cancel(manager:State<Arc<work::WorkManager>>,id:String)->bool{manager.cancel(&id)}
fn validate_task_model<'a>(connected: bool, selected: &str, models: impl Iterator<Item=&'a str>) -> Result<String,String> {
    if !connected || !models.into_iter().any(|id|id==selected) {
        return Err("Sign in to Codex and choose an available model.".into());
    }
    Ok(selected.to_owned())
}
#[cfg(test)]
mod task_model_tests {
    use super::validate_task_model;
    #[test]
    fn validates_live_model_without_silent_fallback() {
        assert_eq!(validate_task_model(true,"model-b",["model-a","model-b"].into_iter()).unwrap(),"model-b");
        assert!(validate_task_model(true,"removed-model",["model-a"].into_iter()).is_err());
        assert!(validate_task_model(false,"model-a",["model-a"].into_iter()).is_err());
        assert!(validate_task_model(true,"",["model-a"].into_iter()).is_err());
    }
}
#[tauri::command]
async fn project_work_start(app:AppHandle,project:String,provider:String,prompt:String,request_id:String,model:Option<String>)->Result<work::WorkJob,String>{
    if app.state::<Shared>().gate.collapsed.load(Ordering::Relaxed){return Err("Otevři Týpka a zadej úkol.".into());}
    let manager=app.state::<Arc<work::WorkManager>>().inner().clone();
    let chat=app.state::<Arc<Chat>>().inner().clone();
    let selected=model.unwrap_or_else(||app.state::<Shared>().settings.lock().unwrap().codex_model.clone());
    tauri::async_runtime::spawn_blocking(move||{
        let project=projects::validate_path(std::path::Path::new(&project))?;
        projects::ensure_free(&app,&project)?;
        let model=match provider.as_str(){
            "codex"=>{
                let auth=chat.status(&selected)?;
                validate_task_model(auth.connected, &auth.model, auth.models.iter().map(|m|m.id.as_str()))?
            },
            "claude"=>{let auth=projects::claude_auth();if !auth.connected{return Err(auth.message);} "opus".into()},
            _=>return Err("Vyber Codex nebo Claude Code.".into()),
        };
        let path=std::path::PathBuf::from(project.to_string_lossy().trim_start_matches("\\\\?\\"));
        manager.start(app,path,provider,model,prompt,request_id)
    }).await.map_err(|_|"Úkol se nepodařilo spustit.".to_string())?
}

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(settings_browser_args(app.config()))
        .title("Settings — Meowmate")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Closing it must only hide it, or it could never be reopened.
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

fn activate_existing_instance(argv: &[String]) -> bool {
    !argv.iter().any(|arg| arg == "--background")
}

pub fn run() {
    let loaded = settings::load();
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if activate_existing_instance(&argv) {
                island::open_from_taskbar(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Pending::default())
        .manage(activity::ActivityStore::default())
        .manage(Arc::new(Chat::default()))
        .manage(Arc::new(gemini_browser::GeminiBrowser::default()))
        .manage(Arc::new(work::WorkManager::new()))
        .on_window_event(|win, event| {
            if win.label()==dock::LABEL {
                if let tauri::WindowEvent::DragDrop(event)=event {dock::forward_drop(win.app_handle(),event);}
                return;
            }
            if win.label() != island::WINDOW_LABEL { return; }
            let app = win.app_handle();
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let _ = app.emit_to(island::WINDOW_LABEL, "dock-drop", files::native_drop_payload(paths));
            }
            let Some(shared) = app.try_state::<Shared>() else { return };
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    island::close_to_taskbar(app);
                }
                tauri::WindowEvent::Focused(false) => {
                    if win.is_minimized().unwrap_or(false) { island::close_to_taskbar(app); }
                }
                // Programmatic resize during hover restoration is not a taskbar action.
                tauri::WindowEvent::Focused(true) => {
                    let minimized = win.is_minimized().unwrap_or(true);
                    let closed = shared.gate.collapsed.load(Ordering::Relaxed);
                    if minimized && !closed { island::close_to_taskbar(app); }
                    else if !minimized && closed { island::open_from_taskbar(app); }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            shared_theme::shared_theme,
            boot,
            dock_ready,
            dock_press,
            popup_interaction,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            open_url,
            open_gemini,
            gemini_browser::gemini_browser_open,
            gemini_browser::gemini_browser_generate,
            gemini_browser::gemini_browser_cancel,
            open_in_vscode,
            quit_app,
            hooks_status,
            hooks_preview,
            hooks_apply,
            approval_decision,
            approval_ack,
            approval_decline,
            log_line,
            chat_send,
            chat_reset,
            chat_status,
            chat_cancel,
            ingest_file,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            open_n8n,
            open_settings_window,
            set_paused,
            activity_snapshot,
            activity_project,
            open_surface,
            dock_open,
            project_targets,
            project_selected,
            project_pick,
            work_auth,
            claude_login,
            project_work_list,
            project_work_start,
            project_work_cancel,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            handle.state::<Arc<work::WorkManager>>().bind(handle.clone());
            tray::build(&handle)?;
            // Before the island: see create_settings_window.
            create_settings_window(&handle);
            dock::start(handle.clone());

            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded.screen, false);
                let _ = win.minimize();
                island::set_activating(&win, true);
            }
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::line(format!("--- Coucou {} started ---", env!("CARGO_PKG_VERSION")));
            hooks::ensure_hook_exe(&handle);
            pipe::start(handle.clone());
            integrations::start(handle.clone());
            activity::start(handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Coucou")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                if let Some(chat) = app.try_state::<Arc<Chat>>() { chat.shutdown(); }
                if let Some(manager) = app.try_state::<Arc<work::WorkManager>>() { manager.shutdown(); }
                if let Some(browser) = app.try_state::<Arc<gemini_browser::GeminiBrowser>>() { browser.shutdown(); }
            }
        });
}

#[cfg(test)]
mod window_config_tests {
    #[test]
    fn credential_mutation_requires_exact_settings_window_label() {
        assert!(super::require_settings_window("settings").is_ok());
        for label in ["", "island", "dock", "main", "Settings", "settings/other"] {
            assert!(super::require_settings_window(label).is_err(), "{label}");
        }
    }
    #[test]
    fn editor_rejects_options_and_remote_paths_before_process_lookup() {
        assert!(!super::open_in_vscode(Some("--reuse-window".into())));
        assert!(!super::open_in_vscode(Some("\\\\server\\share".into())));
        assert!(!super::open_in_vscode(Some("C:\\".into())));
    }
    #[test]
    fn failed_settings_write_restores_registration_and_does_not_publish_values() {
        let mut current = super::Settings::default();
        let mut next = current.clone();
        next.autostart = true;
        next.codex_model = "fixture-model".into();
        let mut changes = Vec::new();
        let result = super::commit_settings(&mut current, &next, |_| Err(()), |enabled| { changes.push(enabled); Ok(()) });
        assert!(result.is_err());
        assert_eq!(changes, [true, false]);
        assert!(!current.autostart);
        assert!(current.codex_model.is_empty());
    }
    #[test]
    fn failed_registration_never_attempts_disk_write() {
        let mut current = super::Settings::default();
        let mut next = current.clone(); next.autostart = true;
        let result = super::commit_settings(&mut current, &next, |_| panic!("must not write"), |_| Err(()));
        assert!(result.unwrap_err().contains("registration failed"));
        assert!(!current.autostart);
    }
    #[test]
    fn settings_commit_publishes_only_after_successful_write() {
        let mut current = super::Settings::default();
        let mut next = current.clone(); next.codex_model = "fixture-model".into();
        assert!(super::commit_settings(&mut current, &next, |_| Ok(()), |_| panic!("unchanged startup")).is_ok());
        assert_eq!(current.codex_model, "fixture-model");
    }

    #[test]
    fn background_launch_preserves_existing_window_and_jobs() {
        assert!(!super::activate_existing_instance(&["coucou.exe".into(), "--background".into()]));
        assert!(super::activate_existing_instance(&["coucou.exe".into()]));
        assert!(super::PollGate::new().collapsed.load(std::sync::atomic::Ordering::Relaxed));
    }
    #[test]
    fn gemini_handoff_uses_only_the_fixed_https_destination() {
        let command = super::gemini_browser_command().unwrap();
        let arguments: Vec<_> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(arguments, ["url.dll,FileProtocolHandler", "https://gemini.google.com/app"]);
        assert!(command.get_program().to_string_lossy().ends_with("System32\\rundll32.exe"));
    }

    #[test]
    fn closed_app_uses_an_ordinary_minimizable_taskbar_window() {
        let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config.app.windows[0];
        assert!(!window.skip_taskbar);
        assert!(window.minimizable);
        assert_eq!(window.title, "Meowmate");
    }

    #[test]
    fn settings_reuses_the_island_browser_environment() {
        let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(super::settings_browser_args(&config), config.app.windows[0].additional_browser_args.as_deref().unwrap());
        assert!(!super::settings_browser_args(&config).contains("msSmartScreenProtection"));
    }
}
