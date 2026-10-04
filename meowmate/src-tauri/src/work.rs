//! Explicit subscription CLI jobs. One writer per project; owned process trees.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::{io::AsRawHandle, process::CommandExt};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

const MAX_TEXT: usize = 65_536;
const MAX_LINE: usize = 1_048_576;
const MAX_JOBS: usize = 40;
const TIMEOUT: Duration = Duration::from_secs(900);
const CANCELLED: &str = "Úkol byl zastaven.";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkJob {
    pub id: String,
    pub project: String,
    pub project_name: String,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub status: String,
    pub text: String,
    pub step: Option<String>,
    pub error: Option<String>,
    pub started_ms: u64,
    pub updated_ms: u64,
}
struct Slot {
    job: WorkJob,
    cancel: Arc<AtomicBool>,
    process: Option<Arc<OwnedProcess>>,
}
#[derive(Default)]
struct Jobs {
    slots: Vec<Slot>,
}
pub struct WorkManager {
    jobs: Mutex<Jobs>,
    persist_lock: Mutex<()>,
    dir: PathBuf,
    app: Mutex<Option<AppHandle>>,
}

fn clean(text: &str) -> String {
    let mut out: String = text
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect();
    if out.len() > MAX_TEXT {
        let mut n = MAX_TEXT;
        while !out.is_char_boundary(n) {
            n -= 1;
        }
        out.truncate(n);
    }
    out
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
fn project_key(path: &str) -> String {
    path.trim_start_matches("\\\\?\\")
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}
fn failure(value: &Value) -> String {
    let text = value.to_string().to_ascii_lowercase();
    if text.contains("usage limit") || text.contains("quota") || text.contains("rate limit") {
        "Předplatné narazilo na limit. Zkus úkol po jeho obnovení.".into()
    } else if text.contains("login") || text.contains("auth") || text.contains("unauthorized") {
        "Ověř přihlášení vybraného agenta k předplatnému.".into()
    } else {
        "Agent úkol nedokončil. Ověř zadání a připojení.".into()
    }
}

struct JobTree(HANDLE);
// Windows Job Object handles can be queried/terminated from different threads.
unsafe impl Send for JobTree {}
unsafe impl Sync for JobTree {}
impl Drop for JobTree {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
impl JobTree {
    fn new() -> Result<Self, String> {
        unsafe {
            let handle = CreateJobObjectW(None, None).map_err(|_| "Nelze vytvořit správu běhu.")?;
            let tree = Self(handle);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .map_err(|_| "Nelze zabezpečit ukončení běhu.")?;
            Ok(tree)
        }
    }
    fn kill(&self) {
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
        }
    }
    fn empty(&self) -> bool {
        unsafe {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            QueryInformationJobObject(
                Some(self.0),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of_val(&info) as u32,
                None,
            )
            .is_ok()
                && info.ActiveProcesses == 0
        }
    }
}
struct OwnedProcess {
    child: Mutex<Child>,
    tree: JobTree,
}
impl OwnedProcess {
    fn spawn(mut cmd: Command) -> Result<Arc<Self>, String> {
        let tree = JobTree::new()?;
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000 | 0x4); // CREATE_NO_WINDOW | CREATE_SUSPENDED
        let mut child = cmd.spawn().map_err(|_| "Agent se nepodařil spustit.")?;
        if unsafe { AssignProcessToJobObject(tree.0, HANDLE(child.as_raw_handle())) }.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Nelze převzít správu procesu agenta.".into());
        }
        let owned = Arc::new(Self {
            child: Mutex::new(child),
            tree,
        });
        Ok(owned)
    }
    fn resume(&self) -> Result<(), String> {
        let pid = self.child.lock().map_err(|_| "Proces není dostupný.")?.id();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
                .map_err(|_| "Nelze spustit proces agenta.")?;
            let mut entry = THREADENTRY32 {
                dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            let mut available = Thread32First(snapshot, &mut entry).is_ok();
            let result = (|| {
                while available {
                    if entry.th32OwnerProcessID == pid {
                        let thread = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                            .map_err(|_| "Nelze spustit proces agenta.")?;
                        let resumed = ResumeThread(thread) != u32::MAX;
                        let _ = CloseHandle(thread);
                        return if resumed {
                            Ok(())
                        } else {
                            Err("Nelze spustit proces agenta.".into())
                        };
                    }
                    available = Thread32Next(snapshot, &mut entry).is_ok();
                }
                Err("Vlákno procesu není dostupné.".into())
            })();
            let _ = CloseHandle(snapshot);
            result
        }
    }
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        self.tree.kill();
    }
}

impl Jobs {
    /// The lookup, limits and reservation share one mutex in WorkManager::start.
    fn reserve(
        &mut self,
        job: WorkJob,
        cancel: Arc<AtomicBool>,
    ) -> Result<Option<WorkJob>, String> {
        if let Some(slot) = self.slots.iter().find(|s| s.job.id == job.id) {
            if slot.job.prompt != job.prompt
                || slot.job.provider != job.provider
                || project_key(&slot.job.project) != project_key(&job.project)
            {
                return Err("Identifikátor už patří jinému úkolu.".into());
            }
            return Ok(Some(slot.job.clone()));
        }
        let running: Vec<_> = self
            .slots
            .iter()
            .filter(|s| s.job.status == "running")
            .collect();
        if running
            .iter()
            .any(|s| project_key(&s.job.project) == project_key(&job.project))
        {
            return Err("V tomto projektu už běží úkol. Počkej, nebo ho zastav.".into());
        }
        if running.len() >= 4 {
            return Err("Už běží čtyři úkoly. Počkej na dokončení.".into());
        }
        self.slots.push(Slot {
            job,
            cancel,
            process: None,
        });
        while self.slots.len() > MAX_JOBS {
            if let Some(index) = self
                .slots
                .iter()
                .enumerate()
                .filter(|(_, s)| s.job.status != "running")
                .min_by_key(|(_, s)| s.job.started_ms)
                .map(|(index, _)| index)
            {
                self.slots.remove(index);
            } else {
                break;
            }
        }
        Ok(None)
    }
}

impl WorkManager {
    pub fn new() -> Self {
        Self::with_dir(crate::settings::local_dir().join("work"))
    }
    fn with_dir(dir: PathBuf) -> Self {
        let mut jobs = Jobs::default();
        let file = dir.join("history.json");
        // JSON escaping can double text size; forty valid jobs fit in 16 MiB.
        if std::fs::metadata(&file)
            .map(|m| m.len() <= 16_777_216)
            .unwrap_or(false)
        {
            if let Ok(rows) = std::fs::read(&file)
                .ok()
                .and_then(|b| serde_json::from_slice::<Vec<WorkJob>>(&b).ok())
                .ok_or(())
            {
                for mut job in rows.into_iter().take(MAX_JOBS).filter(|j| valid_id(&j.id)) {
                    job.text = clean(&job.text);
                    job.prompt = clean(&job.prompt);
                    if job.status == "running" {
                        job.status = "interrupted".into();
                        job.error =
                            Some("Aplikace byla ukončena během práce. Zadej úkol znovu.".into());
                    }
                    jobs.slots.push(Slot {
                        job,
                        cancel: Arc::new(AtomicBool::new(false)),
                        process: None,
                    });
                }
            }
        }
        Self {
            jobs: Mutex::new(jobs),
            persist_lock: Mutex::new(()),
            dir,
            app: Mutex::new(None),
        }
    }
    pub fn bind(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }
    pub fn list(&self) -> Vec<WorkJob> {
        let mut jobs: Vec<_> = self
            .jobs
            .lock()
            .unwrap()
            .slots
            .iter()
            .map(|s| s.job.clone())
            .collect();
        jobs.sort_by_key(|j| std::cmp::Reverse(j.started_ms));
        jobs
    }
    fn emit(&self, job: WorkJob) {
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            let _ = app.emit_to(crate::island::WINDOW_LABEL, "project-work", job);
            let count = self.list().iter().filter(|j| j.status == "running").count();
            crate::dock::status(app, count, "#34D399");
        }
    }
    fn persist(&self) {
        let Ok(_write) = self.persist_lock.lock() else {
            return;
        };
        let rows = self.list();
        let Ok(bytes) = serde_json::to_vec(&rows) else {
            return;
        };
        if std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let tmp = self.dir.join("history.tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(tmp, self.dir.join("history.json"));
        }
    }
    pub fn start(
        self: &Arc<Self>,
        _app: AppHandle,
        project: PathBuf,
        provider: String,
        model: String,
        prompt: String,
        request_id: String,
    ) -> Result<WorkJob, String> {
        if !valid_id(&request_id) || !valid_id(&model) {
            return Err("Neplatný identifikátor úkolu nebo modelu.".into());
        }
        if !matches!(provider.as_str(), "codex" | "claude") {
            return Err("Vyber Codex nebo Claude Code.".into());
        }
        let prompt = prompt.trim().to_string();
        if prompt.is_empty() || prompt.len() > 16_000 {
            return Err("Zadání musí mít 1 až 16 000 bajtů.".into());
        }
        let path = crate::projects::validate_path(&project)?;
        let project = path
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_string();
        let job = WorkJob {
            id: request_id,
            project_name: clean(
                &path
                    .file_name()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            ),
            project,
            provider,
            model,
            prompt,
            status: "running".into(),
            text: String::new(),
            step: Some("Spouštím agenta".into()),
            error: None,
            started_ms: coucou_observer::now_ms(),
            updated_ms: coucou_observer::now_ms(),
        };
        let cancel = Arc::new(AtomicBool::new(false));
        if let Some(existing) = self
            .jobs
            .lock()
            .unwrap()
            .reserve(job.clone(), cancel.clone())?
        {
            return Ok(existing);
        }
        self.persist();
        self.emit(job.clone());
        let manager = self.clone();
        let running = job.clone();
        std::thread::spawn(move || manager.run(running, cancel));
        Ok(job)
    }
    fn update(&self, id: &str, text: Option<String>, step: Option<String>) {
        let next = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(slot) = jobs.slots.iter_mut().find(|s| s.job.id == id) else {
                return;
            };
            if let Some(text) = text {
                slot.job.text = clean(&text);
            }
            if let Some(step) = step {
                slot.job.step = Some(step);
            }
            slot.job.updated_ms = coucou_observer::now_ms();
            slot.job.clone()
        };
        self.emit(next);
    }
    fn finish(&self, id: &str, result: Result<(), String>, cancelled: bool) {
        let next = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(slot) = jobs.slots.iter_mut().find(|s| s.job.id == id) else {
                return;
            };
            slot.process = None;
            slot.job.updated_ms = coucou_observer::now_ms();
            if cancelled {
                slot.job.status = "cancelled".into();
                slot.job.error = None;
                slot.job.step = Some(CANCELLED.into());
            } else if let Err(error) = result {
                slot.job.status = "failed".into();
                slot.job.error = Some(error);
            } else {
                slot.job.status = "completed".into();
                slot.job.step = Some("Dokončeno".into());
            }
            slot.job.clone()
        };
        self.persist();
        self.emit(next);
    }
    pub fn cancel(&self, id: &str) -> bool {
        let next = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(slot) = jobs
                .slots
                .iter_mut()
                .find(|s| s.job.id == id && s.job.status == "running")
            else {
                return false;
            };
            slot.cancel.store(true, Ordering::Release);
            if let Some(process) = &slot.process {
                process.tree.kill();
            }
            slot.job.step = Some("Zastavuji…".into());
            slot.job.clone()
        };
        self.emit(next);
        true
    }
    pub fn shutdown(&self) {
        let ids: Vec<_> = self
            .list()
            .into_iter()
            .filter(|j| j.status == "running")
            .map(|j| j.id)
            .collect();
        for id in ids {
            self.cancel(&id);
        }
    }
    fn command(job: &WorkJob) -> Result<Command, String> {
        let mut cmd = if job.provider == "codex" {
            let mut cmd = Command::new(crate::codex::codex_executable()?);
            cmd.args([
                "exec",
                "--json",
                "--ignore-user-config",
                "--skip-git-repo-check",
                "--sandbox",
                "workspace-write",
                "--model",
                &job.model,
                "-C",
                &job.project,
                "-c",
                "model_provider=\"openai\"",
                "-c",
                "forced_login_method=\"chatgpt\"",
                "-c",
                "web_search=\"disabled\"",
                "-c",
                "windows.sandbox=\"elevated\"",
                "-",
            ]);
            for name in ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"] {
                cmd.env_remove(name);
            }
            // A new job must not inherit the host app's thread, tools pipe or
            // permission profile. Its own CLI flags define its workspace.
            for (name, _) in std::env::vars_os() {
                let upper = name.to_string_lossy().to_ascii_uppercase();
                if upper.starts_with("CODEX_") && upper != "CODEX_HOME" {
                    cmd.env_remove(name);
                }
            }
            cmd
        } else {
            let mut cmd = crate::projects::claude_command()?;
            cmd.args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "acceptEdits",
                "--allowedTools",
                "Read,Glob,Grep,Edit,Write,Bash",
                "--model",
                &job.model,
                "--setting-sources",
                "",
                "--settings",
                "{\"disableAllHooks\":true,\"enabledPlugins\":{}}",
                "--strict-mcp-config",
                "--mcp-config",
                "{\"mcpServers\":{}}",
            ]);
            cmd
        };
        cmd.current_dir(&job.project);
        Ok(cmd)
    }
    fn run(self: &Arc<Self>, job: WorkJob, cancel: Arc<AtomicBool>) {
        if cancel.load(Ordering::Acquire) {
            self.finish(&job.id, Ok(()), true);
            return;
        }
        let result = Self::command(&job).and_then(|cmd| OwnedProcess::spawn(cmd));
        let process = match result {
            Ok(p) => p,
            Err(e) => {
                self.finish(&job.id, Err(e), cancel.load(Ordering::Acquire));
                return;
            }
        };
        {
            let mut jobs = self.jobs.lock().unwrap();
            if let Some(slot) = jobs.slots.iter_mut().find(|s| s.job.id == job.id) {
                slot.process = Some(process.clone());
            }
        }
        if cancel.load(Ordering::Acquire) {
            process.tree.kill();
        }
        let result = self.drive(&job, &process, &cancel, TIMEOUT);
        // No project lock is released until every process in this owned tree exits.
        process.tree.kill();
        while !process.tree.empty() {
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = process.child.lock().unwrap().wait();
        self.finish(&job.id, result, cancel.load(Ordering::Acquire));
    }
    fn drive(
        &self,
        job: &WorkJob,
        process: &OwnedProcess,
        cancel: &AtomicBool,
        timeout: Duration,
    ) -> Result<(), String> {
        let (stdout, stdin) = {
            let mut child = process.child.lock().unwrap();
            (
                child.stdout.take().ok_or("Výstup agenta není dostupný.")?,
                child.stdin.take().ok_or("Vstup agenta není dostupný.")?,
            )
        };
        let (tx, rx) = mpsc::sync_channel(32);
        let provider = job.provider.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match bounded_line(&mut reader) {
                    Ok(Some(line)) => {
                        if tx.send(Stream::Event(parse(&provider, &line))).is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ = tx.send(Stream::End);
                        break;
                    }
                    Err(_) => {
                        let _ = tx.send(Stream::Bad);
                        break;
                    }
                }
            }
        });
        let (input_tx, input_rx) = mpsc::channel();
        let prompt = job.prompt.clone();
        std::thread::spawn(move || {
            let mut stdin = stdin;
            let ok = stdin.write_all(prompt.as_bytes()).is_ok();
            let _ = input_tx.send(ok);
            drop(stdin);
        });
        if let Err(error) = process.resume() {
            return Err(error);
        }
        let deadline = Instant::now() + timeout;
        let mut input_ok = None;
        let mut terminal = None;
        let mut text = String::new();
        let mut ended = false;
        let mut exit = None;
        let mut error = None;
        let mut last_save = Instant::now();
        loop {
            if cancel.load(Ordering::Acquire) {
                error = Some(CANCELLED.to_string());
                process.tree.kill();
            }
            if Instant::now() >= deadline && error.is_none() {
                error = Some("Úkol dosáhl časového limitu 15 minut.".into());
                process.tree.kill();
            }
            if let Ok(ok) = input_rx.try_recv() {
                input_ok = Some(ok);
                if !ok {
                    error = Some("Zadání se nepodařilo předat agentovi.".into());
                    process.tree.kill();
                }
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Stream::Event(event)) => {
                    let mut changed = false;
                    if let Some(next) = event.replace {
                        text = clean(&next);
                        changed = true;
                    }
                    if !event.text.is_empty() {
                        text = clean(&format!("{text}{}", event.text));
                        changed = true;
                    }
                    if let Some(done) = event.terminal {
                        terminal = Some(done);
                    }
                    if let Some(problem) = event.error {
                        error = Some(problem);
                        process.tree.kill();
                    }
                    if changed || event.step.is_some() {
                        self.update(&job.id, changed.then(|| text.clone()), event.step);
                    }
                }
                Ok(Stream::End) => ended = true,
                Ok(Stream::Bad) => {
                    error = Some("Výstup agenta překročil povolenou velikost.".into());
                    process.tree.kill();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => ended = true,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if exit.is_none() {
                exit = process
                    .child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .map_err(|_| "Stav procesu není dostupný.")?;
                if exit.is_some() {
                    process.tree.kill();
                }
            }
            if last_save.elapsed() >= Duration::from_secs(2) {
                self.persist();
                last_save = Instant::now();
            }
            if exit.is_some() && ended && input_ok.is_some() && process.tree.empty() {
                break;
            }
            if ended && exit.is_none() {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        if let Some(error) = error {
            return Err(error);
        }
        if input_ok != Some(true) || terminal != Some(true) || !exit.is_some_and(|e| e.success()) {
            return Err("Agent skončil bez potvrzeného výsledku.".into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct Parsed {
    text: String,
    replace: Option<String>,
    step: Option<String>,
    terminal: Option<bool>,
    error: Option<String>,
}
enum Stream {
    Event(Parsed),
    End,
    Bad,
}
fn bounded_line(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::new();
    loop {
        let next = reader.fill_buf()?;
        if next.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| std::io::ErrorKind::InvalidData.into())
            };
        }
        let length = next
            .iter()
            .position(|&b| b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(next.len());
        if bytes.len() + length > MAX_LINE {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        let done = next[length - 1] == b'\n';
        bytes.extend_from_slice(&next[..length]);
        reader.consume(length);
        if done {
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| std::io::ErrorKind::InvalidData.into());
        }
    }
}
fn parse(provider: &str, line: &str) -> Parsed {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Parsed::default();
    };
    let mut out = Parsed::default();
    if provider == "codex" {
        match value["type"].as_str().unwrap_or("") {
            "item.started" | "item.completed" => {
                let item = &value["item"];
                match item["type"].as_str().unwrap_or("") {
                    "agent_message" if value["type"] == "item.completed" => {
                        out.text = format!("{}\n", clean(item["text"].as_str().unwrap_or("")))
                    }
                    "command_execution" => out.step = Some("Spouští příkaz".into()),
                    "file_change" => out.step = Some("Upravuje soubory".into()),
                    "error"
                        if !item["message"]
                            .as_str()
                            .unwrap_or("")
                            .starts_with("Skill descriptions were shortened") =>
                    {
                        out.error = Some(failure(item))
                    }
                    _ => {}
                }
            }
            "turn.completed" => out.terminal = Some(true),
            "turn.failed" | "error" => {
                out.terminal = Some(false);
                out.error = Some(failure(&value));
            }
            _ => {}
        }
    } else {
        match value["type"].as_str().unwrap_or("") {
            "assistant" => {
                for block in value["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str().unwrap_or("") {
                        "text" => {
                            out.text
                                .push_str(&clean(block["text"].as_str().unwrap_or("")));
                            out.text.push('\n');
                        }
                        "tool_use" => {
                            out.step = Some(
                                if matches!(block["name"].as_str(), Some("Edit" | "Write")) {
                                    "Upravuje soubory"
                                } else {
                                    "Pracuje v projektu"
                                }
                                .into(),
                            )
                        }
                        _ => {}
                    }
                }
            }
            "result" => {
                let success = value["subtype"] == "success" && value["is_error"] != true;
                out.terminal = Some(success);
                if success {
                    out.replace = value["result"].as_str().map(clean);
                } else {
                    out.error = Some(failure(&value));
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(id: &str, path: &str) -> WorkJob {
        WorkJob {
            id: id.into(),
            project: path.into(),
            project_name: "Fixture".into(),
            provider: "codex".into(),
            model: "gpt-6-astra".into(),
            prompt: "Write fixture".into(),
            status: "running".into(),
            text: String::new(),
            step: None,
            error: None,
            started_ms: 1,
            updated_ms: 1,
        }
    }
    #[test]
    fn real_exec_protocol_and_no_command_leak() {
        let p = parse(
            "codex",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Hotovo"}}"#,
        );
        assert_eq!(p.text, "Hotovo\n");
        let p = parse(
            "codex",
            r#"{"type":"item.completed","item":{"type":"command_execution","command":"SECRET_ARGUMENT","aggregated_output":"SECRET_OUTPUT"}}"#,
        );
        assert!(p.text.is_empty());
        assert_eq!(p.step.as_deref(), Some("Spouští příkaz"));
        assert_eq!(
            parse("codex", r#"{"type":"turn.completed"}"#).terminal,
            Some(true)
        );
    }
    #[test]
    fn command_failure_cannot_become_completed() {
        let p = parse(
            "codex",
            r#"{"type":"item.completed","item":{"type":"error","message":"sandbox failed"}}"#,
        );
        assert!(p.error.is_some());
        assert_eq!(
            parse("codex", r#"{"type":"turn.failed"}"#).terminal,
            Some(false)
        );
    }
    #[test]
    fn claude_mixed_blocks_and_error_terminal() {
        let p = parse(
            "claude",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"secret":"never show"}},{"type":"text","text":"Upravuji soubor"}]}}"#,
        );
        assert_eq!(p.text, "Upravuji soubor\n");
        assert_eq!(p.step.as_deref(), Some("Upravuje soubory"));
        assert!(parse(
            "claude",
            r#"{"type":"result","subtype":"success","is_error":true}"#
        )
        .error
        .is_some());
    }
    #[test]
    fn unicode_and_line_limits() {
        let text = clean(&"🐸č".repeat(20_000));
        assert!(text.len() <= MAX_TEXT);
        assert!(text.is_char_boundary(text.len()));
        assert!(bounded_line(&mut BufReader::new(vec![b'x'; MAX_LINE + 1].as_slice())).is_err());
    }
    #[test]
    fn duplicate_and_project_reservation_are_atomic() {
        let state = Arc::new(Mutex::new(Jobs::default()));
        let mut threads = Vec::new();
        for id in ["a", "b"] {
            let state = state.clone();
            threads.push(std::thread::spawn(move || {
                state
                    .lock()
                    .unwrap()
                    .reserve(job(id, "D:\\Project"), Arc::new(AtomicBool::new(false)))
                    .is_ok()
            }));
        }
        assert_eq!(
            threads
                .into_iter()
                .map(|t| t.join().unwrap())
                .filter(|ok| *ok)
                .count(),
            1
        );
        let mut state = state.lock().unwrap();
        let original = state.slots[0].job.clone();
        assert!(state
            .reserve(original, Arc::new(AtomicBool::new(false)))
            .unwrap()
            .is_some());
        assert!(state
            .reserve(
                job("different", "d:\\PROJECT"),
                Arc::new(AtomicBool::new(false))
            )
            .is_err());
    }
    #[test]
    fn history_retains_active_jobs() {
        let mut state = Jobs::default();
        for n in 0..45 {
            let mut j = job(&format!("j{n}"), &format!("D:\\P{n}"));
            if n != 0 {
                j.status = "completed".into();
            }
            state.reserve(j, Arc::new(AtomicBool::new(false))).unwrap();
        }
        assert_eq!(state.slots.len(), MAX_JOBS);
        assert!(state.slots.iter().any(|s| s.job.id == "j0"));
    }
    #[test]
    fn restored_history_prunes_oldest_terminal_result() {
        let mut state = Jobs::default();
        for n in (1..=40).rev() {
            let mut j = job(&format!("j{n}"), &format!("D:\\P{n}"));
            j.started_ms = n;
            j.status = "completed".into();
            state.reserve(j, Arc::new(AtomicBool::new(false))).unwrap();
        }
        let mut next = job("j41", "D:\\P41");
        next.started_ms = 41;
        state
            .reserve(next, Arc::new(AtomicBool::new(false)))
            .unwrap();
        assert!(!state.slots.iter().any(|s| s.job.id == "j1"));
        assert!(state.slots.iter().any(|s| s.job.id == "j40"));
        assert_eq!(state.slots.len(), 40);
    }
    #[test]
    #[ignore]
    fn process_fixture() {
        let Ok(mode) = std::env::var("TYPEK_WORK_FIXTURE") else {
            return;
        };
        if mode != "hold" {
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).unwrap();
            assert_eq!(input, "Write fixture");
        }
        println!(r#"{{"type":"turn.started"}}"#);
        std::io::stdout().flush().unwrap();
        if mode == "hold" || mode == "timeout" {
            std::thread::sleep(Duration::from_secs(90));
        }
        println!(
            r#"{{"type":"item.completed","item":{{"type":"agent_message","text":"Fixture done"}}}}"#
        );
        println!(r#"{{"type":"turn.completed"}}"#);
        std::io::stdout().flush().unwrap();
        std::process::exit(if mode == "bad_exit" { 7 } else { 0 });
    }
    fn fixture_drive(mode: &str, timeout: Duration) -> Result<(), String> {
        let manager = WorkManager::with_dir(
            crate::settings::local_dir().join(format!("fixture-work-{mode}")),
        );
        let j = job(mode, "D:\\Fixture");
        manager
            .jobs
            .lock()
            .unwrap()
            .reserve(j.clone(), Arc::new(AtomicBool::new(false)))
            .unwrap();
        let mut cmd = Command::new(std::env::current_exe().unwrap());
        cmd.args([
            "--exact",
            "work::tests::process_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("TYPEK_WORK_FIXTURE", mode);
        let process = OwnedProcess::spawn(cmd).unwrap();
        let result = manager.drive(&j, &process, &AtomicBool::new(false), timeout);
        assert!(process.tree.empty());
        assert!(process.child.lock().unwrap().try_wait().unwrap().is_some());
        result
    }
    #[test]
    fn real_process_stream_confirms_success() {
        assert!(fixture_drive("success", Duration::from_secs(5)).is_ok());
    }
    #[test]
    fn terminal_event_does_not_mask_bad_exit() {
        assert!(fixture_drive("bad_exit", Duration::from_secs(5)).is_err());
    }
    #[test]
    fn deadline_terminates_owned_tree() {
        assert!(fixture_drive("timeout", Duration::from_millis(200))
            .unwrap_err()
            .contains("časového limitu"));
    }
    #[test]
    fn owned_suspended_process_terminates() {
        let mut cmd = Command::new(std::env::current_exe().unwrap());
        cmd.args([
            "--exact",
            "work::tests::process_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("TYPEK_WORK_FIXTURE", "hold");
        let process = OwnedProcess::spawn(cmd).unwrap();
        process.resume().unwrap();
        process.tree.kill();
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if process.tree.empty() && process.child.lock().unwrap().try_wait().unwrap().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("Owned process tree and root did not terminate");
    }
}
