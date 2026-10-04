use std::os::windows::process::CommandExt;
use std::process::Command;

fn app_id(id: &str) -> Option<&'static str> {
    match id {
        "codex" => Some("OpenAI.Codex_2p2nqsd0c76g0!App"),
        "antigravity" => Some("Google.AntigravityIDE"),
        "claudeDesktop" => Some("Claude_pzs8sxrjxfjjc!Claude"),
        "cursor" => Some("Anysphere.Cursor"),
        _ => None,
    }
}

pub fn open(id: &str) -> bool {
    if id == "gemini" { crate::open_url("https://gemini.google.com/app".into()); return true; }
    let Some(target) = app_id(id) else { return false };
    // Only fixed, locally verified application IDs; no user-supplied command or URL.
    Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{target}"))
        .creation_flags(crate::CREATE_NO_WINDOW).spawn().is_ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn launcher_accepts_only_known_surfaces() {
        assert_eq!(super::app_id("claudeDesktop"), Some("Claude_pzs8sxrjxfjjc!Claude"));
        assert_eq!(super::app_id("cursor"), Some("Anysphere.Cursor"));
        for id in ["", "cmd.exe", "https://example.com", "codex & calc", "gemini"] {
            assert!(super::app_id(id).is_none());
        }
    }
}
