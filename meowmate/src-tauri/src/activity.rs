use std::sync::{atomic::Ordering, Mutex};
use std::time::Duration;
use coucou_observer::{Activity, Monitor, Options, Record, Roots};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ActivityStore(pub Mutex<Vec<Record>>);

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut monitor = Monitor::new(Roots::environment());
        let mut paused = false;
        loop {
            if crate::integrations::PAUSED.load(Ordering::Relaxed) {
                paused = true;
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            let options = {
                let shared = app.state::<crate::Shared>();
                let Ok(settings) = shared.settings.lock() else { break };
                Options { codex: settings.monitor_codex, claude: settings.monitor_claude && !crate::hooks::status().installed, harness: settings.monitor_harness }
            };
            let mut records = monitor.poll(options, coucou_observer::now_ms());
            if paused {
                for record in &mut records { record.activity.restored = true; }
                paused = false;
            }
            let payload: Vec<Activity> = records.iter().map(|r| r.activity.clone()).collect();
            let changed = {
                let store = app.state::<ActivityStore>();
                let Ok(mut previous) = store.0.lock() else { break };
                let changed = previous.iter().map(|r| &r.activity).ne(records.iter().map(|r| &r.activity));
                *previous = records;
                changed
            };
            if changed {
                let working=payload.iter().filter(|r|!r.stale && matches!(r.phase,coucou_observer::Phase::Working|coucou_observer::Phase::Thinking)).count();
                crate::dock::status(&app,working,"#34D399");
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "local-activity", payload);
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
