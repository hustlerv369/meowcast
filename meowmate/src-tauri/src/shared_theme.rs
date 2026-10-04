//! Reads only the explicit appearance bridge, never launcher settings or credentials.
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SharedTheme {
    version: u8,
    source: String,
    resolved: String,
}

fn parse(bytes: &[u8]) -> Option<SharedTheme> {
    if bytes.len() > 256 {
        return None;
    }
    let value: SharedTheme = serde_json::from_slice(bytes).ok()?;
    if value.version != 1
        || !["system", "light", "dark"].contains(&value.source.as_str())
        || !["light", "dark"].contains(&value.resolved.as_str())
        || (value.source != "system" && value.source != value.resolved)
    {
        return None;
    }
    Some(value)
}

fn read(path: &Path) -> Option<SharedTheme> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 256 {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(257)
        .read_to_end(&mut bytes)
        .ok()?;
    parse(&bytes)
}

#[tauri::command]
pub fn shared_theme() -> Option<SharedTheme> {
    let base = std::env::var_os("APPDATA")?;
    read(
        &std::path::PathBuf::from(base)
            .join("HustleCMD")
            .join("meowmate-theme.json"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_valid_bounded_appearance_is_accepted() {
        assert!(parse(br#"{"version":1,"source":"system","resolved":"dark"}"#).is_some());
        assert!(parse(br#"{"version":1,"source":"light","resolved":"light"}"#).is_some());
        for input in [
            br#"{"version":1,"source":"light","resolved":"dark"}"#.as_slice(),
            br#"{"version":2,"source":"dark","resolved":"dark"}"#,
            br#"{"version":1,"source":"system","resolved":"dark","key":"secret"}"#,
            br#"{"version":1,"source":"script","resolved":"dark"}"#,
            b"broken",
        ] {
            assert!(parse(input).is_none());
        }
        assert!(parse(&vec![b' '; 257]).is_none());
        assert!(read(Path::new("__missing_theme_fixture__")).is_none());
    }
}
