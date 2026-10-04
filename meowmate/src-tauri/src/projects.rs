//! Explicit project selection and subscription preflight. No credential values.
use serde::Serialize;
use std::io::Read;
use std::os::windows::{fs::MetadataExt, process::CommandExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

#[derive(Clone, Serialize)]
pub struct Project {
    pub path: String,
    pub label: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAuth {
    pub connected: bool,
    pub provider: String,
    pub message: String,
}

pub fn validate_path(input: &Path) -> Result<PathBuf, String> {
    let raw = input.to_string_lossy();
    if !input.is_absolute()
        || raw.starts_with("\\\\")
        || raw.starts_with("//")
        || raw.contains('\0')
    {
        return Err("Vyber místní složku projektu.".into());
    }
    for ancestor in input.ancestors() {
        let meta =
            std::fs::symlink_metadata(ancestor).map_err(|_| "Složka projektu není dostupná.")?;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Vyber přímo složku projektu, bez přesměrování.".into());
        }
    }
    if !input.is_dir() || input.parent().is_none() {
        return Err("Vyber složku projektu.".into());
    }
    let canonical = std::fs::canonicalize(input).map_err(|_| "Složka projektu není dostupná.")?;
    if canonical.components().count() < 3 {
        return Err("Vyber konkrétní projekt, ne celý disk.".into());
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        if std::fs::canonicalize(home).ok().as_ref() == Some(&canonical) {
            return Err("Vyber konkrétní projekt, ne celý profil.".into());
        }
    }
    Ok(canonical)
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_string()
}
pub fn targets(app: &AppHandle) -> Vec<Project> {
    let store = app.state::<crate::activity::ActivityStore>();
    let Ok(rows) = store.0.lock() else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows.iter() {
        let Some(path) = row
            .project_path
            .as_ref()
            .and_then(|p| validate_path(p).ok())
        else {
            continue;
        };
        let path = display_path(&path);
        if seen.insert(path.to_lowercase()) {
            result.push(Project {
                label: row.activity.project.clone(),
                path,
            });
        }
    }
    result.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    result
}

pub fn selected(app: &AppHandle, id: &str) -> Option<Project> {
    let store = app.state::<crate::activity::ActivityStore>();
    let rows = store.0.lock().ok()?;
    let row = rows.iter().find(|r| r.activity.id == id)?;
    let path = validate_path(row.project_path.as_ref()?).ok()?;
    Some(Project {
        label: row.activity.project.clone(),
        path: display_path(&path),
    })
}

pub fn ensure_free(app: &AppHandle, project: &Path) -> Result<(), String> {
    let store = app.state::<crate::activity::ActivityStore>();
    let rows = store.0.lock().map_err(|_| "Stav projektu není dostupný.")?;
    let key = display_path(project).to_lowercase();
    for row in rows.iter().filter(|r| {
        !r.activity.stale
            && matches!(
                r.activity.phase,
                coucou_observer::Phase::Working
                    | coucou_observer::Phase::Thinking
                    | coucou_observer::Phase::Waiting
            )
    }) {
        if row
            .project_path
            .as_ref()
            .and_then(|p| validate_path(p).ok())
            .map(|p| display_path(&p).to_lowercase() == key)
            .unwrap_or(false)
        {
            return Err(
                "V tomto projektu už agent pracuje. Počkej na dokončení, nebo vyber jiný projekt."
                    .into(),
            );
        }
    }
    Ok(())
}

/// Called only after the user clicks the folder picker. Dialog is foreground UI.
pub fn pick() -> Option<Project> {
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            return None;
        }
        let result = (|| {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
            dialog
                .SetOptions(dialog.GetOptions().ok()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
                .ok()?;
            dialog.Show(None).ok()?;
            let item = dialog.GetResult().ok()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let value = name.to_string().ok();
            CoTaskMemFree(Some(name.0.cast()));
            let path = validate_path(Path::new(&value?)).ok()?;
            Some(Project {
                label: path.file_name()?.to_string_lossy().to_string(),
                path: display_path(&path),
            })
        })();
        CoUninitialize();
        result
    }
}

pub fn claude_command() -> Result<Command, String> {
    let exe = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or("Profil Windows není dostupný.")?
        .join(".local/bin/claude.exe");
    if !exe.is_file() {
        return Err("Nainstaluj Claude Code a přihlas ho k předplatnému.".into());
    }
    let mut cmd = Command::new(exe);
    crate::codex::scrub_agent_environment(&mut cmd, std::env::vars_os().map(|(name, _)| name));
    for key in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "ANTHROPIC_FOUNDRY_API_KEY",
    ] {
        cmd.env_remove(key);
    }
    Ok(cmd)
}

pub fn claude_auth() -> WorkAuth {
    let disconnected = || WorkAuth {
        connected: false,
        provider: "claude".into(),
        message: "Přihlas Claude Code k předplatnému. Přihlášení v Claude Desktopu se nepřenáší."
            .into(),
    };
    let Ok(mut cmd) = claude_command() else {
        return disconnected();
    };
    let Ok(mut child) = cmd
        .args(["auth", "status"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return disconnected();
    };
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return disconnected();
    };
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.by_ref().take(8192).read_to_string(&mut buf);
        buf
    });
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            _ if Instant::now() >= until => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            _ => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    let value = reader
        .join()
        .ok()
        .and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok())
        .unwrap_or_default();
    let method = value["authMethod"].as_str().unwrap_or("");
    if value["loggedIn"] == true
        && value["apiProvider"] == "firstParty"
        && matches!(method, "claude.ai" | "oauth" | "oauth_token")
        && value["subscriptionType"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    {
        WorkAuth {
            connected: true,
            provider: "claude".into(),
            message: "Claude Code je připojený přes předplatné.".into(),
        }
    } else {
        disconnected()
    }
}

pub fn login() -> Result<(), String> {
    // Official subscription login opens its own browser. No key input is involved.
    claude_command()?
        .args(["auth", "login", "--claudeai"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Přihlášení se nepodařilo otevřít.".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_non_project_targets() {
        for p in ["relative", "C:\\", "\\\\server\\share", "//server/share"] {
            assert!(validate_path(Path::new(p)).is_err(), "{p}");
        }
    }
}
