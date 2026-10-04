// Preferences, stored as plain JSON in %APPDATA%\Coucou\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Legacy field retained to load settings written by upstream builds.
    #[serde(default = "default_model")]
    pub model: String,
    /// Empty follows the existing Codex CLI model, without changing its config.
    #[serde(default)]
    pub codex_model: String,
    #[serde(default = "default_true")]
    pub monitor_codex: bool,
    #[serde(default = "default_true")]
    pub monitor_claude: bool,
    #[serde(default = "default_true")]
    pub monitor_harness: bool,
}

fn default_true() -> bool { true }

fn default_model() -> String {
    "claude-opus-5".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            codex_model: String::new(),
            monitor_codex: true,
            monitor_claude: true,
            monitor_harness: true,
        }
    }
}

/// %APPDATA%\Coucou
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %LOCALAPPDATA%\Coucou — where coucou-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("coucou-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    save_to(settings, &settings_path())
}

fn save_to(settings: &Settings, destination: &std::path::Path) -> std::io::Result<()> {
    let dir = destination.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Missing settings directory"))?;
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    use std::io::Write;
    let temporary = dir.join(format!(".settings-{}-{}.tmp", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(&json)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, destination)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn atomic_save_replaces_valid_json_and_preserves_locked_destination() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = std::env::temp_dir().join(format!("meowmate-settings-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let path = directory.join("settings.json");
        let original = super::Settings::default();
        super::save_to(&original, &path).unwrap();
        let mut next = original.clone(); next.codex_model = "fixture-model".into();
        super::save_to(&next, &path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(serde_json::from_slice::<super::Settings>(&bytes).unwrap().codex_model, "fixture-model");
        let locked = std::fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
        assert!(super::save_to(&original, &path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        drop(locked);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn old_settings_keep_their_preferences_and_default_to_codex() {
        let mut old = serde_json::to_value(super::Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("codexModel");
        old["autoCloseInterval"] = serde_json::json!(10.0);
        let settings: super::Settings = serde_json::from_value(old).unwrap();
        assert!(settings.codex_model.is_empty());
        assert_eq!(settings.auto_close_interval,10.0);
        assert!(!settings.autostart);
    }
}
