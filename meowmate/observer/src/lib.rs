//! Local metadata only: no network, subprocess, hooks, approvals or transcript output.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LINE: usize = 128 * 1024;
const MAX_READ: u64 = 512 * 1024;
const MAX_FILES_PER_SOURCE: usize = 8;
const RECENT_MS: u64 = 24 * 60 * 60 * 1000;
pub const STALE_MS: u64 = 10 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source { Codex, ClaudeCode, Harness }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase { Thinking, Working, Waiting, Review, Finished, Error, Cancelled, Idle }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub source: Source,
    pub provider: String,
    pub host: String,
    pub project: String,
    pub phase: Phase,
    pub tool: String,
    pub updated_ms: u64,
    pub stale: bool,
    pub restored: bool,
    pub revision: u64,
}

#[derive(Clone, Debug)]
pub struct Record { pub activity: Activity, pub project_path: Option<PathBuf> }

#[derive(Clone, Copy, Debug, Default)]
pub struct Options { pub codex: bool, pub claude: bool, pub harness: bool }

impl Options {
    fn enabled(self, source: &Source) -> bool {
        match source { Source::Codex => self.codex, Source::ClaudeCode => self.claude, Source::Harness => self.harness }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn timestamp(value: &Value) -> Option<u64> {
    let raw = value.as_str()?;
    let parsed = time::OffsetDateTime::parse(raw, &time::format_description::well_known::Rfc3339).ok()?;
    u64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

fn label(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() && !matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')).take(96).collect()
}

fn identifier(value: &str) -> Option<String> {
    if !value.is_empty() && value.len() <= 128 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        Some(value.to_string())
    } else { None }
}

fn tool_name(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':')).take(96).collect()
}

fn project_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().map(label).filter(|v| !v.is_empty()).unwrap_or_else(|| "Session".into())
}

fn local_project(path: &str) -> Option<PathBuf> {
    let bytes = path.as_bytes();
    // Reject UNC/device paths and relative paths before any filesystem access.
    if bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\') && !path.contains('\0') {
        Some(PathBuf::from(path))
    } else { None }
}

fn metadata_path(record: &mut Record, value: &Value) {
    if let Some(cwd) = value.as_str() {
        record.activity.project = project_name(cwd);
        record.project_path = local_project(cwd);
    }
}

fn record(source: Source, fallback_id: &str) -> Record {
    let provider = match source { Source::Codex => "Codex", Source::ClaudeCode => "Claude Code", Source::Harness => "Harness" };
    Record { activity: Activity {
        id: format!("{}:{fallback_id}", match source { Source::Codex => "codex", Source::ClaudeCode => "claude", Source::Harness => "harness" }),
        source, provider: provider.into(), host: provider.into(), project: "Session".into(), phase: Phase::Idle,
        tool: String::new(), updated_ms: 0, stale: false, restored: true, revision: 0,
    }, project_path: None }
}

/// Select metadata by known keys. Arguments, prompt, content, output and errors are never copied.
pub fn apply_codex(record: &mut Record, row: &Value) -> bool {
    let kind = row["type"].as_str().unwrap_or("");
    let p = &row["payload"];
    if kind == "session_meta" {
        if let Some(id) = p["id"].as_str().and_then(identifier) { record.activity.id = format!("codex:{id}"); }
        record.activity.host = match p["originator"].as_str().unwrap_or("") {
            "Codex Desktop" => "Codex Desktop",
            _ if p["source"] == "vscode" => "VS Code / Antigravity",
            _ if p["source"] == "cli" => "Codex CLI",
            _ => "Codex",
        }.into();
        metadata_path(record, &p["cwd"]);
        return false;
    }
    if kind == "turn_context" { metadata_path(record, &p["cwd"]); return false; }
    let phase = if kind == "event_msg" {
        match p["type"].as_str().unwrap_or("") {
            "task_started" | "turn_started" => Some(Phase::Thinking),
            "task_complete" | "turn_complete" => Some(Phase::Finished),
            "turn_aborted" | "task_cancelled" | "interrupted" => Some(Phase::Cancelled),
            "error" => Some(Phase::Error),
            "exec_approval_request" | "apply_patch_approval_request" => Some(Phase::Waiting),
            _ => None,
        }
    } else if kind == "response_item" {
        match p["type"].as_str().unwrap_or("") {
            "function_call" | "custom_tool_call" => {
                record.activity.tool = tool_name(p["name"].as_str().unwrap_or("Tool"));
                if record.activity.tool.rsplit('.').next() == Some("request_user_input") { Some(Phase::Waiting) } else { Some(Phase::Working) }
            },
            "function_call_output" | "custom_tool_call_output" => Some(Phase::Working),
            "reasoning" => Some(Phase::Thinking),
            "message" if p["role"] == "user" => Some(Phase::Thinking),
            _ => None,
        }
    } else { None };
    update(record, phase, timestamp(&row["timestamp"]))
}

pub fn apply_claude(record: &mut Record, row: &Value) -> bool {
    if row["isSidechain"] == true { return false; }
    if let Some(id) = row["sessionId"].as_str().and_then(identifier) { record.activity.id = format!("claude:{id}"); }
    metadata_path(record, &row["cwd"]);
    record.activity.host = if row["entrypoint"] == "vscode" { "VS Code / Antigravity" } else { "Claude Code" }.into();
    let message = &row["message"];
    let phase = match row["type"].as_str().unwrap_or("") {
        "assistant" if row["isApiErrorMessage"] == true => Some(Phase::Error),
        "assistant" => {
            let tool = message["content"].as_array().and_then(|items| items.iter().find(|v| v["type"] == "tool_use"));
            if let Some(tool) = tool {
                record.activity.tool = tool_name(tool["name"].as_str().unwrap_or("Tool"));
                Some(Phase::Working)
            } else if message["stop_reason"] == "end_turn" { Some(Phase::Finished) } else { Some(Phase::Thinking) }
        },
        "user" => {
            if message["content"].as_array().is_some_and(|items| items.iter().any(|v| v["type"] == "tool_result")) { Some(Phase::Working) }
            else { Some(Phase::Thinking) }
        },
        // Queue operations may contain a future prompt; they are not evidence of active inference.
        _ => None,
    };
    update(record, phase, timestamp(&row["timestamp"]))
}

fn update(record: &mut Record, phase: Option<Phase>, at: Option<u64>) -> bool {
    let Some(phase) = phase else { return false };
    let Some(at) = at else { return false };
    if at < record.activity.updated_ms { return false; }
    record.activity.phase = phase;
    record.activity.updated_ms = at;
    record.activity.revision += 1;
    true
}

pub fn harness_record(row: &Value, fallback_id: &str) -> Option<Record> {
    let phase = match row["state"].as_str()? {
        "queued" => Phase::Thinking,
        "running" => Phase::Working,
        "cancel_requested" => Phase::Waiting,
        "completed_pending_review" => Phase::Review,
        "accepted" => Phase::Finished,
        "failed" => Phase::Error,
        "cancelled" => Phase::Cancelled,
        "interrupted_unknown" => Phase::Idle,
        _ => return None,
    };
    let mut result = record(Source::Harness, fallback_id);
    result.activity.phase = phase;
    result.activity.updated_ms = timestamp(&row["updatedAt"])?;
    let provider = row["providerId"].as_str().or_else(|| row["spec"]["providerId"].as_str()).unwrap_or("");
    result.activity.provider = match provider {
        "minimax" => "MiniMax", "grok" => "Grok", "claude" => "Claude", "gemini" => "Gemini",
        "cursor-composer" => "Cursor Composer", "cursor-sonnet" => "Cursor Sonnet", "cursor-opus" => "Cursor Opus", "cursor-grok" => "Cursor Grok",
        "openrouter-free" => "Free worker", "codex" => "Codex", _ => "Harness worker",
    }.into();
    result.activity.host = "Antigravity / VS Code harness".into();
    metadata_path(&mut result, &row["spec"]["projectRoot"]);
    result.activity.revision = 1;
    Some(result)
}

/// Incremental newline decoder. Partial UTF-8 is held until a complete line arrives.
#[derive(Default)]
pub struct Lines { pending: Vec<u8>, discard: bool }

impl Lines {
    pub fn skip_partial(&mut self) { self.pending.clear(); self.discard = true; }
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Value> {
        let mut result = Vec::new();
        for &byte in bytes {
            if byte == b'\n' {
                if !self.discard && !self.pending.is_empty() {
                    if let Ok(row) = serde_json::from_slice(&self.pending) { result.push(row); }
                }
                self.pending.clear(); self.discard = false;
            } else if !self.discard {
                if self.pending.len() == MAX_LINE { self.pending.clear(); self.discard = true; }
                else { self.pending.push(byte); }
            }
        }
        result
    }
}

#[derive(Clone)]
pub struct Roots { pub codex: PathBuf, pub claude: PathBuf, pub harness: PathBuf }

impl Roots {
    pub fn environment() -> Self {
        let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
        let codex = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".codex"));
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
        Self { codex: codex.join("sessions"), claude: home.join(".claude/projects"), harness: local.join("HustleHarness/jobs") }
    }
}

fn normal_file(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else { return false };
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return false; }
    }
    !meta.file_type().is_symlink()
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|t| t.as_millis() as u64).unwrap_or(0)
}

fn children(path: &Path, limit: usize) -> Vec<PathBuf> {
    if !normal_file(path) { return vec![]; }
    fs::read_dir(path).map(|items| items.take(limit).filter_map(Result::ok).map(|v| v.path()).filter(|p| normal_file(p)).collect()).unwrap_or_default()
}

fn discover(roots: &Roots, options: Options, now: u64) -> Vec<(Source, PathBuf)> {
    let mut result = Vec::new();
    for source in [Source::Codex, Source::ClaudeCode, Source::Harness] {
        if !options.enabled(&source) { continue; }
        let mut candidates = Vec::new();
        match source {
            Source::Codex => {
                let today = time::OffsetDateTime::from_unix_timestamp((now / 1000) as i64).unwrap_or(time::OffsetDateTime::UNIX_EPOCH).date();
                for ago in 0..7 {
                    let date = today - time::Duration::days(ago);
                    let path = roots.codex.join(format!("{:04}/{:02}/{:02}", date.year(), date.month() as u8, date.day()));
                    candidates.extend(children(&path, 512).into_iter().filter(|p| p.extension().is_some_and(|e| e == "jsonl")));
                }
            },
            Source::ClaudeCode => {
                for project in children(&roots.claude, 512) {
                    if project.is_dir() { candidates.extend(children(&project, 256).into_iter().filter(|p| p.extension().is_some_and(|e| e == "jsonl"))); }
                }
            },
            Source::Harness => {
                for job in children(&roots.harness, 2048) {
                    if job.file_name().and_then(|n| n.to_str()).is_some_and(|s| s.starts_with('j') && s.len() == 17 && s[1..].bytes().all(|b| b.is_ascii_hexdigit())) {
                        let state = job.join("state.json");
                        if state.is_file() && normal_file(&state) { candidates.push(state); }
                    }
                }
            },
        }
        let mut fresh: Vec<_> = candidates.into_iter().filter_map(|path| {
            let m = modified_ms(&fs::metadata(&path).ok()?);
            if now.saturating_sub(m) <= RECENT_MS { Some((m, path)) } else { None }
        }).collect();
        fresh.sort_by(|a, b| b.0.cmp(&a.0));
        result.extend(fresh.into_iter().take(MAX_FILES_PER_SOURCE).map(|(_, p)| (source.clone(), p)));
    }
    result
}

struct Tail { offset: u64, modified: u64, lines: Lines, record: Record, initialized: bool }

impl Tail {
    fn new(source: Source, path: &Path) -> Self {
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new(); path.hash(&mut hash);
        Self { offset: 0, modified: 0, lines: Lines::default(), record: record(source, &format!("{:016x}", hash.finish())), initialized: false }
    }
    fn apply(&mut self, row: &Value) -> bool {
        match self.record.activity.source { Source::Codex => apply_codex(&mut self.record, row), Source::ClaudeCode => apply_claude(&mut self.record, row), Source::Harness => false }
    }
    fn read(&mut self, path: &Path) {
        if !normal_file(path) { return; }
        let Ok(meta) = fs::metadata(path) else { return };
        let mtime = modified_ms(&meta);
        if self.initialized && meta.len() == self.offset && mtime == self.modified { return; }
        let Ok(mut file) = File::open(path) else { return };
        let restored = !self.initialized;
        if meta.len() < self.offset || (meta.len() == self.offset && mtime != self.modified) {
            self.offset = 0; self.lines = Lines::default();
            let source = self.record.activity.source.clone();
            let id = self.record.activity.id.clone();
            self.record = record(source, id.rsplit(':').next().unwrap_or("rotated"));
        }
        if !self.initialized && self.record.activity.source == Source::Codex {
            // The first record identifies the client. Do not read a whole transcript to find it.
            let mut first = vec![0; MAX_LINE];
            if let Ok(n) = file.read(&mut first) {
                if let Some(end) = first[..n].iter().position(|b| *b == b'\n') {
                    if let Ok(value) = serde_json::from_slice::<Value>(&first[..end]) {
                        if value["type"] == "session_meta" { self.apply(&value); }
                    }
                }
            }
        }
        if meta.len().saturating_sub(self.offset) > MAX_READ {
            self.offset = meta.len() - MAX_READ;
            self.lines.skip_partial();
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() { return; }
        let mut bytes = Vec::new();
        if file.take(MAX_READ).read_to_end(&mut bytes).is_err() { return; }
        let mut changed = false;
        for row in self.lines.feed(&bytes) { changed |= self.apply(&row); }
        self.offset += bytes.len() as u64;
        self.modified = mtime; self.initialized = true;
        if changed { self.record.activity.restored = restored; }
    }
}

pub struct Monitor { roots: Roots, tails: HashMap<PathBuf, Tail>, jobs: HashMap<PathBuf, (u64, u64, Record)>, discovery: u64, paths: Vec<(Source, PathBuf)>, options: Options }

impl Monitor {
    pub fn new(roots: Roots) -> Self { Self { roots, tails: HashMap::new(), jobs: HashMap::new(), discovery: 0, paths: vec![], options: Options::default() } }
    pub fn poll(&mut self, options: Options, now: u64) -> Vec<Record> {
        let toggled = options.codex != self.options.codex || options.claude != self.options.claude || options.harness != self.options.harness;
        if toggled || now.saturating_sub(self.discovery) >= 10_000 {
            self.paths = discover(&self.roots, options, now); self.discovery = now; self.options = options;
            self.tails.retain(|p, t| options.enabled(&t.record.activity.source) && self.paths.iter().any(|(_, candidate)| candidate == p));
            self.jobs.retain(|p, _| options.harness && self.paths.iter().any(|(_, candidate)| candidate == p));
        }
        for (source, path) in &self.paths {
            if !options.enabled(source) { continue; }
            if *source == Source::Harness {
                let Ok(meta) = fs::metadata(path) else { continue };
                let mtime = modified_ms(&meta);
                if self.jobs.get(path).is_some_and(|(old, len, _)| *old == mtime && *len == meta.len()) { continue; }
                if meta.len() > MAX_READ || !normal_file(path) { continue; }
                let Ok(bytes) = fs::read(path) else { continue };
                let Ok(value) = serde_json::from_slice::<Value>(&bytes) else { continue };
                let fallback = path.parent().and_then(Path::file_name).and_then(|p| p.to_str()).unwrap_or("job");
                if let Some(mut rec) = harness_record(&value, fallback) {
                    rec.activity.restored = !self.jobs.contains_key(path);
                    rec.activity.revision = self.jobs.get(path).map(|(_, _, r)| r.activity.revision + 1).unwrap_or(1);
                    self.jobs.insert(path.clone(), (mtime, meta.len(), rec));
                }
            } else {
                self.tails.entry(path.clone()).or_insert_with(|| Tail::new(source.clone(), path)).read(path);
            }
        }
        let mut unique = BTreeMap::new();
        for mut item in self.tails.values().map(|v| v.record.clone()).chain(self.jobs.values().map(|(_, _, r)| r.clone())) {
            if !options.enabled(&item.activity.source) || item.activity.updated_ms == 0 || item.activity.updated_ms > now.saturating_add(60_000) { continue; }
            item.activity.stale = now.saturating_sub(item.activity.updated_ms) > STALE_MS;
            if item.activity.stale && matches!(item.activity.phase, Phase::Working | Phase::Thinking | Phase::Waiting) { item.activity.phase = Phase::Idle; }
            let replace = unique.get(&item.activity.id).is_none_or(|old: &Record| old.activity.updated_ms < item.activity.updated_ms);
            if replace { unique.insert(item.activity.id.clone(), item); }
        }
        let mut result: Vec<Record> = unique.into_values().collect();
        result.sort_by(|a, b| b.activity.updated_ms.cmp(&a.activity.updated_ms));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const AT: &str = "2026-10-01T15:00:00.000Z";
    fn event(kind: &str, payload: Value) -> Value { json!({"type":kind,"timestamp":AT,"payload":payload}) }
    #[test] fn codex_source_precedes_generic_vscode() {
        let mut r = record(Source::Codex, "a");
        apply_codex(&mut r, &event("session_meta", json!({"id":"abc","source":"vscode","originator":"Codex Desktop","cwd":"D:\\Work\\Demo"})));
        assert_eq!(r.activity.host, "Codex Desktop"); assert_eq!(r.activity.project, "Demo");
    }
    #[test] fn only_explicit_completion_finishes_codex() {
        let mut r = record(Source::Codex, "a");
        apply_codex(&mut r, &event("event_msg", json!({"type":"task_started"})));
        apply_codex(&mut r, &event("response_item", json!({"type":"message","role":"assistant","content":[{"text":"done?"}]})));
        assert_eq!(r.activity.phase, Phase::Thinking);
        apply_codex(&mut r, &event("event_msg", json!({"type":"task_complete"})));
        assert_eq!(r.activity.phase, Phase::Finished);
    }
    #[test] fn secrets_and_tool_arguments_never_escape() {
        let mut r = record(Source::Codex, "a");
        apply_codex(&mut r, &event("response_item", json!({"type":"function_call","name":"exec_command","arguments":"secret-canary-123","output":"secret-canary-123"})));
        let text = serde_json::to_string(&r.activity).unwrap(); assert!(!text.contains("secret-canary")); assert_eq!(r.activity.tool, "exec_command");
    }
    #[test] fn codex_waiting_is_observational_only() {
        let mut r = record(Source::Codex, "a");
        apply_codex(&mut r, &event("event_msg", json!({"type":"exec_approval_request","command":"secret"})));
        assert_eq!(r.activity.phase, Phase::Waiting);
        assert!(!serde_json::to_string(&r.activity).unwrap().contains("command"));
    }
    #[test] fn review_is_not_acceptance() {
        let r = harness_record(&json!({"state":"completed_pending_review","updatedAt":AT,"providerId":"minimax","spec":{"projectRoot":"D:\\Work\\Demo","prompt":"secret"}}), "j1").unwrap();
        assert_eq!(r.activity.phase, Phase::Review); assert_eq!(r.activity.provider, "MiniMax");
        assert!(!serde_json::to_string(&r.activity).unwrap().contains("secret"));
    }
    #[test] fn unknown_harness_states_are_ignored() { assert!(harness_record(&json!({"state":"done","updatedAt":AT}), "j1").is_none()); }
    #[test] fn cancellation_stays_distinct() {
        let r = harness_record(&json!({"state":"cancelled","updatedAt":AT}), "j1").unwrap(); assert_eq!(r.activity.phase, Phase::Cancelled);
    }
    #[test] fn claude_tool_result_is_not_a_new_user_turn() {
        let mut r = record(Source::ClaudeCode, "a");
        apply_claude(&mut r, &json!({"type":"user","timestamp":AT,"message":{"content":[{"type":"tool_result","content":"secret"}]}}));
        assert_eq!(r.activity.phase, Phase::Working);
    }
    #[test] fn claude_sidechain_does_not_replace_root() {
        let mut r = record(Source::ClaudeCode, "a");
        assert!(!apply_claude(&mut r, &json!({"type":"assistant","timestamp":AT,"isSidechain":true,"message":{"stop_reason":"end_turn"}})));
        assert_eq!(r.activity.phase, Phase::Idle);
    }
    #[test] fn partial_utf8_and_multiple_lines() {
        let mut lines = Lines::default(); let bytes = "{\"name\":\"příliš\"}\n{\"id\":2}\n".as_bytes();
        assert!(lines.feed(&bytes[..13]).is_empty()); let rows = lines.feed(&bytes[13..]); assert_eq!(rows.len(),2); assert_eq!(rows[0]["name"],"příliš");
    }
    #[test] fn oversize_line_recovers_on_the_next_newline() {
        let mut lines = Lines::default(); assert!(lines.feed(&vec![b'x'; MAX_LINE + 10]).is_empty());
        let rows = lines.feed(b"\n{\"ok\":true}\n"); assert_eq!(rows.len(),1);
    }
    #[test] fn malformed_lines_and_incomplete_records_are_ignored() {
        let mut lines = Lines::default(); assert!(lines.feed(b"garbage\n{\"ok\":").is_empty()); assert_eq!(lines.feed(b"true}\n").len(),1);
    }
    #[test] fn unc_device_and_relative_paths_are_not_openable() {
        for bad in ["\\\\server\\share", "\\\\?\\C:\\file", "../file", "file", "C:relative"] { assert!(local_project(bad).is_none()); }
        assert!(local_project("D:\\Work\\Demo").is_some());
    }
    #[test] fn metadata_cannot_hide_text_with_bidi_controls() { assert_eq!(label("Demo\u{202e}\n"), "Demo"); }
    #[test] fn missing_timestamp_cannot_create_a_fresh_event() {
        let mut r = record(Source::Codex,"a"); assert!(!apply_codex(&mut r,&json!({"type":"event_msg","payload":{"type":"task_complete"}})));
    }
}
