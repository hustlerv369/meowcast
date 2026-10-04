//! Explicit Gemini browser handoff through a dedicated, locally owned profile.
//! CDP: https://chromedevtools.github.io/devtools-protocol/
//! No credentials, ambient profiles, page instructions or remote endpoints are read.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tungstenite::{client::client_with_config, protocol::WebSocketConfig, Message, WebSocket};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

const GEMINI: &str = "https://gemini.google.com/app";
const MAX_REFERENCE: usize = 10 * 1024 * 1024;
const CHANGED: &str = "Gemini's page is not ready or its controls changed. Finish sign-in or review the page in the dedicated browser, then try again.";
const TIMEOUT: &str =
    "The Gemini browser operation timed out. Check the browser before trying again.";
const CANCELLED: &str =
    "The Gemini browser operation was cancelled. Check the browser before trying again.";
const UNKNOWN_SEND: &str = "The previous Send result is unknown. Check Gemini manually; automatic retry is blocked to avoid duplicates.";

#[derive(Serialize, Debug)]
pub struct BrowserReply {
    pub status: &'static str,
    pub message: String,
}
impl BrowserReply {
    fn new(status: &'static str, message: &str) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    fn error(message: &str) -> Self {
        Self::new(
            if message == CANCELLED {
                "cancelled"
            } else if message == UNKNOWN_SEND {
                "retry_blocked"
            } else {
                "error"
            },
            message,
        )
    }
    fn login() -> Self {
        Self::new("needs_sign_in", "Sign in to Google yourself in the dedicated Gemini browser. Then click Send prompt again. Nothing is sent automatically.")
    }
}
#[derive(Deserialize)]
pub struct Reference {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}
#[derive(Default)]
pub struct GeminiBrowser {
    child: Mutex<Option<OwnedBrowser>>,
    operation_gate: Mutex<()>,
    busy: Arc<AtomicBool>,
    cancelled: AtomicBool,
    uncertain_send: AtomicBool,
    stopping: AtomicBool,
    retained_reference: Mutex<Option<TempReference>>,
}
struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl GeminiBrowser {
    fn begin(&self) -> Result<BusyGuard, &'static str> {
        let _gate = self
            .operation_gate
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if self.stopping.load(Ordering::Acquire) {
            return Err("The application is closing.");
        }
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Another Gemini browser operation is already running.")?;
        self.cancelled.store(false, Ordering::Release);
        Ok(BusyGuard(Arc::clone(&self.busy)))
    }
    fn cancel(&self) -> bool {
        let Ok(_gate) = self.operation_gate.lock() else {
            return false;
        };
        let busy = self.busy.load(Ordering::Acquire);
        if busy {
            self.cancelled.store(true, Ordering::Release);
        }
        busy
    }
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Release);
        self.cancelled.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            child.take();
        }
        if let Ok(mut reference) = self.retained_reference.lock() {
            reference.take();
        }
    }
    fn check(&self, deadline: Instant) -> Result<(), &'static str> {
        if self.stopping.load(Ordering::Acquire) || self.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED)
        } else if Instant::now() >= deadline {
            Err(TIMEOUT)
        } else {
            Ok(())
        }
    }
    fn owned_profile() -> Result<PathBuf, &'static str> {
        let base = crate::settings::local_dir();
        if !base.is_absolute() {
            return Err("A local application data folder is required.");
        }
        ensure_directory(&base)?;
        let profile = base.join("gemini-browser");
        ensure_directory(&profile)?;
        Ok(profile)
    }
    fn alive(&self) -> Result<bool, &'static str> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        match child.as_mut() {
            Some(process) => match process.child.try_wait() {
                Ok(None) => Ok(true),
                Ok(Some(_)) => {
                    *child = None;
                    Ok(false)
                }
                Err(_) => Err("The dedicated browser could not be checked."),
            },
            None => Ok(false),
        }
    }
    fn open_active(&self) -> Result<BrowserReply, &'static str> {
        let deadline = Instant::now() + Duration::from_secs(20);
        self.check(deadline)?;
        let profile = Self::owned_profile()?;
        if !self.alive()? {
            let port_file = profile.join("DevToolsActivePort");
            if let Ok((port, _)) = read_endpoint(&port_file) {
                if TcpStream::connect_timeout(&loopback(port), Duration::from_millis(250)).is_ok() {
                    return Err("Close the previously opened Meowmate Gemini browser, then open it again here. Other browser profiles are never attached.");
                }
            }
            if port_file.exists() {
                fs::remove_file(&port_file)
                    .map_err(|_| "The dedicated browser profile is unavailable.")?;
            }
            let executable = browser_executable().ok_or(
                "Install Microsoft Edge, Google Chrome or Comet in its standard location first.",
            )?;
            self.check(deadline)?;
            let mut command = Command::new(executable);
            command
                .args([
                    "--remote-debugging-address=127.0.0.1",
                    "--remote-debugging-port=0",
                    "--no-first-run",
                    "--no-default-browser-check",
                ])
                .arg(format!("--user-data-dir={}", profile.display()))
                .arg(GEMINI)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let child = OwnedBrowser::spawn(command)?;
            {
                let mut owned = self
                    .child
                    .lock()
                    .map_err(|_| "Browser state is unavailable.")?;
                self.check(deadline)?;
                *owned = Some(child);
            }
            loop {
                self.check(deadline)?;
                if !self.alive()? {
                    return Err("The browser exited. Close any previous Meowmate Gemini browser and try again.");
                }
                if read_endpoint(&port_file).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let mut cdp = self.connect(&profile, deadline)?;
        match cdp.attach_wait(self, deadline)? {
            Some(session) => {
                let state = cdp.eval(
                    self,
                    deadline,
                    &session,
                    &expression("return inspect();"),
                    true,
                )?;
                match state.as_str() {
                    Some("ready") => Ok(BrowserReply::new("ready","The Gemini composer is available in the dedicated browser. This is not a generation test.")),
                    Some("needs_sign_in") => Ok(BrowserReply::login()),
                    _ => Ok(BrowserReply::new("not_ready","Review sign-in, consent and the Gemini page in the dedicated browser, then connect again.")),
                }
            }
            None => Ok(BrowserReply::new(
                "not_ready",
                "Open Gemini in the dedicated browser, then connect again.",
            )),
        }
    }
    fn connect(&self, profile: &Path, deadline: Instant) -> Result<Cdp, &'static str> {
        self.check(deadline)?;
        if !self.alive()? {
            return Err("Open the dedicated Gemini browser first.");
        }
        let (port, path) = read_endpoint(&profile.join("DevToolsActivePort"))?;
        let pid = self
            .child
            .lock()
            .map_err(|_| "Browser state is unavailable.")?
            .as_ref()
            .ok_or("Open the dedicated Gemini browser first.")?
            .child
            .id();
        verify_listener_owner(port, pid)?;
        Cdp::connect(port, &path, deadline)
    }
    fn generate_active(
        &self,
        prompt: String,
        reference: Option<Reference>,
    ) -> Result<BrowserReply, &'static str> {
        let prompt = validate_prompt(&prompt)?;
        let extension = reference.as_ref().map(validate_reference).transpose()?;
        if self.uncertain_send.load(Ordering::Acquire) {
            return Err(UNKNOWN_SEND);
        }
        let deadline = Instant::now() + Duration::from_secs(55);
        self.check(deadline)?;
        let profile = Self::owned_profile()?;
        let mut cdp = self.connect(&profile, deadline)?;
        let Some(session) = cdp.attach_wait(self, deadline)? else {
            return Ok(BrowserReply::new(
                "not_ready",
                "Open Gemini in the dedicated browser, then connect again.",
            ));
        };
        let state = cdp.eval(
            self,
            deadline,
            &session,
            &expression("return inspect();"),
            true,
        )?;
        if state == "needs_sign_in" {
            return Ok(BrowserReply::login());
        }
        if state != "ready" {
            return Err(CHANGED);
        }
        if cdp.eval(self,deadline,&session,&expression("return composerText()==='' && previews().length===0 && imageInputs().every(i=>!i.files.length);"),true)?!=true {
            return Err("Gemini already has a draft or attachment. Review it in the browser before sending another request.");
        }
        // A previous file is released only after the page has no draft attachment.
        self.retained_reference.lock().map_err(|_| CHANGED)?.take();
        let mut expected_reference = Value::Null;
        if let (Some(reference), Some(extension)) = (reference.as_ref(), extension) {
            let file = TempReference::new(reference, extension)?;
            expected_reference = json!({"name":file.0.file_name().ok_or(CHANGED)?.to_string_lossy(),"size":reference.bytes.len()});
            let path = file.0.to_string_lossy().into_owned();
            let result=cdp.eval(self,deadline,&session,&expression("const inputs=imageInputs(); if(inspect()!=='ready'||inputs.length!==1)throw Error('changed'); return inputs[0];"),false)?;
            let object = result
                .get("objectId")
                .and_then(Value::as_str)
                .ok_or(CHANGED)?;
            // Keep this file after cancellation/ambiguous upload until the owned browser releases it.
            *self.retained_reference.lock().map_err(|_| CHANGED)? = Some(file);
            cdp.request(
                self,
                deadline,
                "DOM.setFileInputFiles",
                json!({"files":[path],"objectId":object}),
                Some(&session),
            )?;
            loop {
                self.check(deadline)?;
                if cdp.eval(
                    self,
                    deadline,
                    &session,
                    &expression(&format!("return uploadReady({expected_reference});")),
                    true,
                )? == true
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(150));
            }
        }
        let data =
            serde_json::to_string(&prompt).map_err(|_| "The prompt could not be prepared.")?;
        let script = expression(&format!("return putPrompt({data});"));
        if cdp.eval(self, deadline, &session, &script, true)? != true {
            return Err("The prompt could not be entered safely. Review the browser draft; nothing was submitted.");
        }
        loop {
            self.check(deadline)?;
            let ready = expression(&format!("return canSend({data},{expected_reference});"));
            if cdp.eval(self, deadline, &session, &ready, true)? == true {
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        self.check(deadline)?;
        let send=expression(&format!("if(!canSend({data},{expected_reference}))return false; sendButtons()[0].click(); return true;"));
        let clicked = cdp
            .eval_send(self, deadline, &session, &send)
            .map_err(|error| {
                if self.uncertain_send.load(Ordering::Acquire) {
                    UNKNOWN_SEND
                } else {
                    error
                }
            })?;
        if clicked == false {
            self.uncertain_send.store(false, Ordering::Release);
            return Err(CHANGED);
        }
        if clicked != true {
            return Err(UNKNOWN_SEND);
        }
        self.uncertain_send.store(false, Ordering::Release);
        // The retained file remains readable even if Gemini consumes it after click() returns.
        Ok(BrowserReply::new("send_clicked","Send was clicked in Gemini. Check the browser for acceptance and the result; generation is not confirmed."))
    }
}
impl Drop for GeminiBrowser {
    fn drop(&mut self) {
        self.shutdown();
    }
}
struct BrowserJob(HANDLE);
// Job handles can be closed and terminated from any thread.
unsafe impl Send for BrowserJob {}
unsafe impl Sync for BrowserJob {}
impl Drop for BrowserJob {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
impl BrowserJob {
    fn new() -> Result<Self, &'static str> {
        unsafe {
            let job = Self(
                CreateJobObjectW(None, None)
                    .map_err(|_| "Browser process isolation is unavailable.")?,
            );
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .map_err(|_| "Browser process isolation is unavailable.")?;
            Ok(job)
        }
    }
}
struct OwnedBrowser {
    child: Child,
    job: BrowserJob,
}
impl OwnedBrowser {
    fn spawn(mut command: Command) -> Result<Self, &'static str> {
        let job = BrowserJob::new()?;
        // Assign before executing any browser code, so descendants cannot escape the job.
        let mut child = command
            .creation_flags(0x08000000 | 0x4)
            .spawn()
            .map_err(|_| "The dedicated Gemini browser could not open.")?;
        if unsafe { AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())) }.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The dedicated browser could not be isolated.");
        }
        let owned = Self { child, job };
        owned.resume()?;
        Ok(owned)
    }
    fn resume(&self) -> Result<(), &'static str> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
                .map_err(|_| "The dedicated browser could not start.")?;
            let mut entry = THREADENTRY32 {
                dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            let mut available = Thread32First(snapshot, &mut entry).is_ok();
            let result = (|| {
                while available {
                    if entry.th32OwnerProcessID == self.child.id() {
                        let thread = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                            .map_err(|_| "The dedicated browser could not start.")?;
                        let resumed = ResumeThread(thread) != u32::MAX;
                        let _ = CloseHandle(thread);
                        return if resumed {
                            Ok(())
                        } else {
                            Err("The dedicated browser could not start.")
                        };
                    }
                    available = Thread32Next(snapshot, &mut entry).is_ok();
                }
                Err("The dedicated browser could not start.")
            })();
            let _ = CloseHandle(snapshot);
            result
        }
    }
}
impl Drop for OwnedBrowser {
    fn drop(&mut self) {
        unsafe {
            let _ = TerminateJobObject(self.job.0, 1);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn verify_listener_owner(port: u16, pid: u32) -> Result<(), &'static str> {
    // Only the exact IPv4 loopback listener of our still-owned child is accepted.
    let error = "The browser endpoint does not belong to the dedicated browser process.";
    unsafe {
        let mut size = 0;
        let _ = GetExtendedTcpTable(None, &mut size, false, 2, TCP_TABLE_OWNER_PID_LISTENER, 0);
        if size < 4 || size > 4 * 1024 * 1024 {
            return Err(error);
        }
        let mut buffer = vec![0u32; (size as usize + 3) / 4];
        if GetExtendedTcpTable(
            Some(buffer.as_mut_ptr().cast()),
            &mut size,
            false,
            2,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        ) != 0
        {
            return Err(error);
        }
        let count = buffer[0] as usize;
        let row_size = std::mem::size_of::<MIB_TCPROW_OWNER_PID>();
        if size < 4 || count > (size as usize - 4) / row_size {
            return Err(error);
        }
        let mut matches = 0;
        for index in 0..count {
            let row = std::ptr::read_unaligned(
                buffer
                    .as_ptr()
                    .cast::<u8>()
                    .add(4 + index * row_size)
                    .cast::<MIB_TCPROW_OWNER_PID>(),
            );
            if u16::from_be(row.dwLocalPort as u16) == port {
                if row.dwLocalAddr.to_ne_bytes() != [127, 0, 0, 1] || row.dwOwningPid != pid {
                    return Err(error);
                }
                matches += 1;
            }
        }
        if matches == 1 {
            Ok(())
        } else {
            Err(error)
        }
    }
}
fn ensure_directory(path: &Path) -> Result<(), &'static str> {
    fs::create_dir_all(path).map_err(|_| "The dedicated browser folder could not be created.")?;
    let meta =
        fs::symlink_metadata(path).map_err(|_| "The dedicated browser folder is unavailable.")?;
    if !meta.is_dir() || meta.file_attributes() & 0x400 != 0 {
        return Err("The dedicated browser folder must be a normal local folder.");
    }
    Ok(())
}
fn browser_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(base);
        for path in [
            "Perplexity/Comet/Application/comet.exe",
            "Microsoft/Edge/Application/msedge.exe",
            "Google/Chrome/Application/chrome.exe",
        ] {
            candidates.push(base.join(path));
        }
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(key) {
            let base = PathBuf::from(base);
            for path in [
                "Microsoft/Edge/Application/msedge.exe",
                "Google/Chrome/Application/chrome.exe",
                "Perplexity/Comet/Application/comet.exe",
            ] {
                candidates.push(base.join(path));
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_absolute() && p.is_file())
}
fn loopback(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}
fn parse_endpoint(text: &str) -> Result<(u16, String), &'static str> {
    if text.len() > 256 {
        return Err("The dedicated browser endpoint is invalid.");
    }
    let mut lines = text.lines();
    let port = lines
        .next()
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|p| *p > 0)
        .ok_or("The dedicated browser endpoint is invalid.")?;
    let path = lines
        .next()
        .ok_or("The dedicated browser endpoint is invalid.")?;
    let id = path
        .strip_prefix("/devtools/browser/")
        .ok_or("The dedicated browser endpoint is invalid.")?;
    if id.len() != 36 || uuid::Uuid::parse_str(id).is_err() || lines.any(|s| !s.is_empty()) {
        return Err("The dedicated browser endpoint is invalid.");
    }
    Ok((port, path.into()))
}
fn read_endpoint(path: &Path) -> Result<(u16, String), &'static str> {
    let meta =
        fs::symlink_metadata(path).map_err(|_| "The dedicated browser connection is not ready.")?;
    if !meta.is_file() || meta.len() > 256 || meta.file_attributes() & 0x400 != 0 {
        return Err("The dedicated browser endpoint is invalid.");
    }
    parse_endpoint(
        &fs::read_to_string(path).map_err(|_| "The dedicated browser connection is not ready.")?,
    )
}
fn gemini_url(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("gemini.google.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == "/app"
            || url.path().strip_prefix("/app/").is_some_and(|tail| {
                !tail.is_empty()
                    && tail
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            }))
}
fn validate_prompt(prompt: &str) -> Result<String, &'static str> {
    if prompt.trim().is_empty() || prompt.encode_utf16().count() > 8000 || prompt.contains('\0') {
        return Err("Enter a prompt between 1 and 8000 characters.");
    }
    Ok(prompt.into())
}
fn validate_reference(reference: &Reference) -> Result<&'static str, &'static str> {
    let b = &reference.bytes;
    if b.is_empty() || b.len() > MAX_REFERENCE || reference.name.len() > 255 {
        return Err("Choose a PNG, JPEG or WebP image up to 10 MiB.");
    }
    match reference.mime.as_str() {
        "image/png"
            if b.len() >= 33
                && b.starts_with(b"\x89PNG\r\n\x1a\n")
                && &b[12..16] == b"IHDR"
                && b[16..20] != [0, 0, 0, 0]
                && b[20..24] != [0, 0, 0, 0] =>
        {
            Ok("png")
        }
        "image/jpeg"
            if b.len() >= 12
                && b.starts_with(&[0xff, 0xd8, 0xff])
                && b.ends_with(&[0xff, 0xd9]) =>
        {
            Ok("jpg")
        }
        "image/webp"
            if b.len() >= 20
                && &b[..4] == b"RIFF"
                && &b[8..12] == b"WEBP"
                && matches!(&b[12..16], b"VP8 " | b"VP8L" | b"VP8X")
                && (u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize).checked_add(8)
                    == Some(b.len()) =>
        {
            Ok("webp")
        }
        _ => Err("The reference image's contents do not match its PNG, JPEG or WebP type."),
    }
}
struct TempReference(PathBuf);
impl TempReference {
    fn new(reference: &Reference, extension: &str) -> Result<Self, &'static str> {
        let base = crate::settings::local_dir();
        if !base.is_absolute() {
            return Err("A local application data folder is required.");
        }
        ensure_directory(&base)?;
        let dir = base.join("gemini-browser-uploads");
        ensure_directory(&dir)?;
        let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "The reference image could not be prepared.")?;
        let temp = Self(path);
        let written = file
            .write_all(&reference.bytes)
            .and_then(|_| file.sync_all());
        drop(file);
        written.map_err(|_| "The reference image could not be prepared.")?;
        Ok(temp)
    }
}
impl Drop for TempReference {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
struct Cdp {
    socket: WebSocket<TcpStream>,
    next: u64,
}
impl Cdp {
    fn connect(port: u16, path: &str, deadline: Instant) -> Result<Self, &'static str> {
        let remaining = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_secs(2));
        if remaining.is_zero() {
            return Err(TIMEOUT);
        }
        let stream = TcpStream::connect_timeout(&loopback(port), remaining)
            .map_err(|_| "The dedicated browser connection is unavailable.")?;
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|_| CHANGED)?;
        stream
            .set_write_timeout(Some(remaining))
            .map_err(|_| CHANGED)?;
        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(2 * 1024 * 1024);
        config.max_frame_size = Some(2 * 1024 * 1024);
        let (mut socket, _) =
            client_with_config(format!("ws://127.0.0.1:{port}{path}"), stream, Some(config))
                .map_err(|_| "The dedicated browser connection was rejected.")?;
        socket
            .get_mut()
            .set_read_timeout(Some(Duration::from_millis(250)))
            .map_err(|_| CHANGED)?;
        Ok(Self { socket, next: 0 })
    }
    fn request(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
        method: &str,
        params: Value,
        session: Option<&str>,
    ) -> Result<Value, &'static str> {
        self.request_tracked(owner, deadline, method, params, session, false)
    }
    fn request_tracked(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
        method: &str,
        params: Value,
        session: Option<&str>,
        track_send: bool,
    ) -> Result<Value, &'static str> {
        owner.check(deadline)?;
        self.next += 1;
        let id = self.next;
        let mut message = json!({"id":id,"method":method,"params":params});
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        let remaining = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_secs(2));
        self.socket
            .get_mut()
            .set_write_timeout(Some(remaining.max(Duration::from_millis(1))))
            .map_err(|_| CHANGED)?;
        // Cancellation before transport write cannot latch an unknown send. A failed write
        // may be partial, so retain the latch even when socket.send itself returns an error.
        owner.check(deadline)?;
        if track_send {
            owner.uncertain_send.store(true, Ordering::Release);
        }
        self.socket
            .send(Message::Text(message.to_string().into()))
            .map_err(|_| "The dedicated browser disconnected. Check it before trying again.")?;
        loop {
            owner.check(deadline)?;
            let remaining = deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(250));
            self.socket
                .get_mut()
                .set_read_timeout(Some(remaining.max(Duration::from_millis(1))))
                .map_err(|_| CHANGED)?;
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    let message: Value = serde_json::from_str(&text).map_err(|_| CHANGED)?;
                    if message.get("id").and_then(Value::as_u64) != Some(id) {
                        continue;
                    }
                    if message.get("error").is_some() {
                        return Err(CHANGED);
                    }
                    return message.get("result").cloned().ok_or(CHANGED);
                }
                Ok(Message::Close(_)) => return Err("The dedicated browser was closed."),
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(_) => {
                    return Err("The dedicated browser disconnected. Check it before trying again.")
                }
            }
        }
    }
    fn attach_wait(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
    ) -> Result<Option<String>, &'static str> {
        let ready_until = deadline.min(Instant::now() + Duration::from_secs(4));
        loop {
            if let Some(session) = self.attach(owner, deadline)? {
                return Ok(Some(session));
            }
            owner.check(deadline)?;
            if Instant::now() >= ready_until {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn attach(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
    ) -> Result<Option<String>, &'static str> {
        let data = self.request(owner, deadline, "Target.getTargets", json!({}), None)?;
        let targets = data["targetInfos"].as_array().ok_or(CHANGED)?;
        let pages: Vec<_> = targets
            .iter()
            .filter(|t| t["type"] == "page" && t["url"].as_str().is_some_and(gemini_url))
            .collect();
        if pages.is_empty() {
            return Ok(None);
        }
        if pages.len() != 1 {
            return Err("More than one Gemini page is open in the dedicated browser. Keep one Gemini tab and try again.");
        }
        let id = pages[0]["targetId"].as_str().ok_or(CHANGED)?;
        let attached = self.request(
            owner,
            deadline,
            "Target.attachToTarget",
            json!({"targetId":id,"flatten":true}),
            None,
        )?;
        Ok(Some(attached["sessionId"].as_str().ok_or(CHANGED)?.into()))
    }
    fn eval(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
        session: &str,
        script: &str,
        by_value: bool,
    ) -> Result<Value, &'static str> {
        let result=self.request(owner,deadline,"Runtime.evaluate",json!({"expression":script,"returnByValue":by_value,"awaitPromise":false,"userGesture":true,"timeout":1500}),Some(session))?;
        if result.get("exceptionDetails").is_some() {
            return Err(CHANGED);
        }
        if by_value {
            Ok(result["result"]["value"].clone())
        } else {
            Ok(result["result"].clone())
        }
    }
    fn eval_send(
        &mut self,
        owner: &GeminiBrowser,
        deadline: Instant,
        session: &str,
        script: &str,
    ) -> Result<Value, &'static str> {
        let result = self.request_tracked(owner, deadline, "Runtime.evaluate", json!({"expression":script,"returnByValue":true,"awaitPromise":false,"userGesture":true,"timeout":1500}), Some(session), true)?;
        if result.get("exceptionDetails").is_some() {
            return Err(CHANGED);
        }
        Ok(result["result"]["value"].clone())
    }
}
fn expression(action: &str) -> String {
    format!("(()=>{{{DOM_HELPERS}\n{action}}})()")
}
const DOM_HELPERS: &str = r#"
function visible(e){return !!e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';}
function allowed(){return location.protocol==='https:' && location.hostname==='gemini.google.com' && (!location.port||location.port==='443') && /^\/app(?:\/[A-Za-z0-9_-]+)?$/.test(location.pathname);}
function composers(){return [...document.querySelectorAll('[role="textbox"][contenteditable="true"],textarea[aria-label]')].filter(visible);}
function previews(){const all=[...document.querySelectorAll('user-uploaded-file,[data-test-id="file-preview"],.file-preview,.image-preview')].filter(visible);return all.filter(e=>!all.some(parent=>parent!==e&&parent.contains(e)));}
function imageInputs(){return [...document.querySelectorAll('input[type="file"][accept]')].filter(i=>/(image\/|\.png|\.jpe?g|\.webp)/i.test(i.accept));}
function inspect(){
 if(!allowed())return 'changed';
 if([...document.querySelectorAll('iframe[src*="recaptcha"],[role="dialog"],[aria-modal="true"]')].some(visible))return 'blocked';
 const login=[...document.querySelectorAll('a[href^="https://accounts.google.com/"],button')].filter(e=>visible(e)&&/^(sign in|přihlásit se)$/i.test(e.textContent.trim()));
 if(login.length)return 'needs_sign_in';
 return composers().length===1?'ready':'changed';
}
function composerText(){const c=composers()[0];return (c?.value??c?.innerText??'').replace(/\r\n/g,'\n');}
function sendButtons(){return [...new Set(document.querySelectorAll('button.send-button,button[aria-label="Send message"],button[aria-label="Send"],button[aria-label="Odeslat zprávu"],button[aria-label="Odeslat"]'))].filter(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');}
function uploadReady(expected){const items=previews();const inputs=imageInputs();return !!expected && inputs.length===1 && inputs[0].files.length===1 && inputs[0].files[0].name===expected.name && inputs[0].files[0].size===expected.size && inspect()==='ready' && items.length===1 && [...items[0].querySelectorAll('img')].some(img=>visible(img)&&img.complete&&img.naturalWidth>0) && ![...document.querySelectorAll('[role="progressbar"],mat-spinner,mat-progress-spinner,.upload-progress')].some(visible);}
function putPrompt(prompt){
 if(inspect()!=='ready'||composerText()!=='')return false;
 const c=composers()[0];c.focus();
 if(c.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(c,prompt);c.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}
 else {const range=document.createRange();range.selectNodeContents(c);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);if(!document.execCommand('insertText',false,prompt))return false;}
 return composerText()===prompt.replace(/\r\n/g,'\n');
}
function canSend(prompt,reference){return inspect()==='ready'&&composerText()===prompt.replace(/\r\n/g,'\n')&&sendButtons().length===1&&(reference?uploadReady(reference):previews().length===0&&imageInputs().every(i=>!i.files.length));}
"#;

#[tauri::command]
pub async fn gemini_browser_open(
    manager: tauri::State<'_, Arc<GeminiBrowser>>,
) -> Result<BrowserReply, String> {
    let manager = manager.inner().clone();
    // Reserve synchronously before queueing work: a cancellation must not be reset by a late worker.
    let operation = match manager.begin() {
        Ok(operation) => operation,
        Err(message) => return Ok(BrowserReply::error(message)),
    };
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        manager.open_active().unwrap_or_else(BrowserReply::error)
    })
    .await
    .unwrap_or_else(|_| BrowserReply::error("The Gemini browser operation could not finish.")))
}
#[tauri::command]
pub async fn gemini_browser_generate(
    manager: tauri::State<'_, Arc<GeminiBrowser>>,
    prompt: String,
    reference: Option<Reference>,
) -> Result<BrowserReply, String> {
    let manager = manager.inner().clone();
    let operation = match manager.begin() {
        Ok(operation) => operation,
        Err(message) => return Ok(BrowserReply::error(message)),
    };
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        manager
            .generate_active(prompt, reference)
            .unwrap_or_else(BrowserReply::error)
    })
    .await
    .unwrap_or_else(|_| {
        BrowserReply::error(
            "The Gemini browser operation could not finish. Check the browser before retrying.",
        )
    }))
}
#[tauri::command]
pub fn gemini_browser_cancel(manager: tauri::State<'_, Arc<GeminiBrowser>>) -> bool {
    manager.cancel()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_boundary() {
        assert!(validate_prompt(" \n ").is_err());
        assert!(validate_prompt(&"a".repeat(8001)).is_err());
        assert!(validate_prompt("bad\0prompt").is_err());
        assert_eq!(validate_prompt(" hello \n").unwrap(), " hello \n");
        assert!(validate_prompt(&"🐈".repeat(4000)).is_ok());
        assert!(validate_prompt(&"🐈".repeat(4001)).is_err());
    }
    #[test]
    fn strict_origin() {
        for url in [GEMINI, "https://gemini.google.com/app/abc_123"] {
            assert!(gemini_url(url));
        }
        for url in [
            "http://gemini.google.com/app",
            "https://gemini.google.com.evil/app",
            "https://gemini.google.com:444/app",
            "https://user@gemini.google.com/app",
            "https://gemini.google.com/app/../../settings",
            "https://accounts.google.com/",
        ] {
            assert!(!gemini_url(url), "{url}");
        }
    }
    #[test]
    fn owned_loopback_endpoint() {
        let id = "12345678-1234-1234-1234-123456789abc";
        assert_eq!(
            parse_endpoint(&format!("9222\n/devtools/browser/{id}\n"))
                .unwrap()
                .0,
            9222
        );
        for bad in [
            "0\n/devtools/browser/x",
            "9222\nws://evil/abc",
            "65536\n/devtools/browser/x",
            "9222\n/devtools/page/123",
            "9222\n/devtools/browser/../../secrets",
        ] {
            assert!(parse_endpoint(bad).is_err());
        }
    }
    #[test]
    fn rejects_disguised_or_large_images() {
        let mut r = Reference {
            name: "../../secret.png".into(),
            mime: "image/png".into(),
            bytes: b"not an image".to_vec(),
        };
        assert!(validate_reference(&r).is_err());
        r.bytes = vec![0; MAX_REFERENCE + 1];
        assert!(validate_reference(&r).is_err());
        r.bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9];
        r.mime = "image/jpeg".into();
        assert_eq!(validate_reference(&r).unwrap(), "jpg");
        r.mime = "image/webp".into();
        assert!(validate_reference(&r).is_err());
    }
    #[test]
    fn operation_gate_and_cancel() {
        let manager = GeminiBrowser::default();
        let guard = manager.begin().unwrap();
        assert!(manager.begin().is_err());
        manager.cancelled.store(true, Ordering::Release);
        assert_eq!(
            manager.check(Instant::now() + Duration::from_secs(1)),
            Err(CANCELLED)
        );
        drop(guard);
        assert!(manager.begin().is_ok());
        assert_eq!(
            manager.check(Instant::now() - Duration::from_millis(1)),
            Err(TIMEOUT)
        );
    }
    #[test]
    fn prompt_is_serialized_as_data() {
        let prompt = "');fetch('https://evil');</script>";
        let expression = expression(&format!(
            "return putPrompt({});",
            serde_json::to_string(prompt).unwrap()
        ));
        assert!(expression.contains(&serde_json::to_string(prompt).unwrap()));
    }
    #[test]
    fn unknown_send_blocks_retry_without_touching_profile() {
        let manager = GeminiBrowser::default();
        manager.uncertain_send.store(true, Ordering::Release);
        assert!(manager
            .generate_active("image of a cat".into(), None)
            .unwrap_err()
            .contains("unknown"));
        assert!(!manager.busy.load(Ordering::Acquire));
    }
    #[test]
    fn queued_cancel_prevents_open_or_send_before_profile_access() {
        let manager = GeminiBrowser::default();
        let operation = manager.begin().unwrap();
        assert!(manager.cancel());
        assert_eq!(manager.open_active().unwrap_err(), CANCELLED);
        assert_eq!(
            manager
                .generate_active("Create an image of a cat".into(), None)
                .unwrap_err(),
            CANCELLED
        );
        assert!(manager.busy.load(Ordering::Acquire));
        drop(operation);
        assert!(!manager.busy.load(Ordering::Acquire));
        assert_eq!(BrowserReply::error(CANCELLED).status, "cancelled");
    }
    #[test]
    fn listener_must_belong_to_exact_owned_pid() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(verify_listener_owner(port, std::process::id()).is_ok());
        assert!(verify_listener_owner(port, 0).is_err());
        let wildcard = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        assert!(
            verify_listener_owner(wildcard.local_addr().unwrap().port(), std::process::id())
                .is_err()
        );
    }
    #[test]
    #[ignore = "child fixture; invoked only by the lifecycle test"]
    fn owned_process_fixture() {
        if let Some(marker) = std::env::var_os("MEOWMATE_BROWSER_JOB_FIXTURE") {
            fs::write(marker, b"ready").unwrap();
            std::thread::sleep(Duration::from_secs(30));
        }
    }
    #[test]
    fn job_shutdown_terminates_only_owned_fixture() {
        let marker =
            std::env::temp_dir().join(format!("meowmate-job-fixture-{}", uuid::Uuid::new_v4()));
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "gemini_browser::tests::owned_process_fixture",
                "--ignored",
            ])
            .env("MEOWMATE_BROWSER_JOB_FIXTURE", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let owned = OwnedBrowser::spawn(command).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(marker.exists(), "owned native child reached test fixture");
        let now = Instant::now();
        drop(owned);
        assert!(
            now.elapsed() < Duration::from_secs(2),
            "job terminates before child's 30 second sleep"
        );
        fs::remove_file(marker).unwrap();
    }
    #[test]
    fn retained_reference_survives_until_explicit_release() {
        let path =
            std::env::temp_dir().join(format!("meowmate-retained-{}.png", uuid::Uuid::new_v4()));
        fs::write(&path, b"fixture").unwrap();
        let manager = GeminiBrowser::default();
        *manager.retained_reference.lock().unwrap() = Some(TempReference(path.clone()));
        assert!(path.exists());
        manager.shutdown();
        assert!(!path.exists());
    }
    #[test]
    fn shutdown_prevents_queued_or_new_operations() {
        let manager = GeminiBrowser::default();
        let _operation = manager.begin().unwrap();
        manager.shutdown();
        // Even a concurrent start resetting its cancellation flag cannot undo shutdown.
        manager.cancelled.store(false, Ordering::Release);
        assert_eq!(
            manager.check(Instant::now() + Duration::from_secs(1)),
            Err(CANCELLED)
        );
        assert!(manager.begin().is_err());
    }
    #[test]
    fn cancelled_before_socket_write_does_not_latch_or_send() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let command: Value =
                serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(command["method"], "SafeRetry");
            ws.send(Message::Text(
                json!({"id":command["id"],"result":{"ok":true}})
                    .to_string()
                    .into(),
            ))
            .unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut cdp = Cdp::connect(
            port,
            "/devtools/browser/12345678-1234-1234-1234-123456789abc",
            deadline,
        )
        .unwrap();
        let owner = GeminiBrowser::default();
        let guard = owner.begin().unwrap();
        owner.cancel();
        assert_eq!(
            cdp.eval_send(&owner, deadline, "fixture", "must not send"),
            Err(CANCELLED)
        );
        assert!(!owner.uncertain_send.load(Ordering::Acquire));
        drop(guard);
        let _next = owner.begin().unwrap();
        assert_eq!(
            cdp.request(&owner, deadline, "SafeRetry", json!({}), None)
                .unwrap()["ok"],
            true
        );
        server.join().unwrap();
    }
    #[test]
    fn written_send_without_reply_remains_blocked() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let _command = ws.read().unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut cdp = Cdp::connect(
            port,
            "/devtools/browser/12345678-1234-1234-1234-123456789abc",
            deadline,
        )
        .unwrap();
        let owner = GeminiBrowser::default();
        assert!(cdp.eval_send(&owner, deadline, "fixture", "send").is_err());
        assert!(owner.uncertain_send.load(Ordering::Acquire));
        assert_eq!(BrowserReply::error(UNKNOWN_SEND).status, "retry_blocked");
        server.join().unwrap();
    }
    #[test]
    fn owned_temp_guard_removes_only_its_file() {
        let path = std::env::temp_dir().join(format!(
            "meowmate-reference-test-{}.png",
            uuid::Uuid::new_v4()
        ));
        fs::write(&path, b"fixture").unwrap();
        {
            let _guard = TempReference(path.clone());
        }
        assert!(!path.exists());
    }
    #[test]
    fn loopback_cdp_matches_reply_ids() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let command: Value =
                serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap();
            ws.send(Message::Text(
                json!({"method":"event","params":{}}).to_string().into(),
            ))
            .unwrap();
            ws.send(Message::Text(
                json!({"id":command["id"],"result":{"ok":true}})
                    .to_string()
                    .into(),
            ))
            .unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut cdp = Cdp::connect(
            port,
            "/devtools/browser/12345678-1234-1234-1234-123456789abc",
            deadline,
        )
        .unwrap();
        let owner = GeminiBrowser::default();
        assert_eq!(
            cdp.request(&owner, deadline, "Fixture", json!({}), None)
                .unwrap()["ok"],
            true
        );
        server.join().unwrap();
    }
    #[test]
    fn loopback_cdp_deadline_is_bounded() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let _ = ws.read();
            std::thread::sleep(Duration::from_millis(500));
        });
        let mut cdp = Cdp::connect(
            port,
            "/devtools/browser/12345678-1234-1234-1234-123456789abc",
            Instant::now() + Duration::from_secs(2),
        )
        .unwrap();
        let owner = GeminiBrowser::default();
        let now = Instant::now();
        assert_eq!(
            cdp.request(
                &owner,
                now + Duration::from_millis(80),
                "Fixture",
                json!({}),
                None
            ),
            Err(TIMEOUT)
        );
        assert!(now.elapsed() < Duration::from_millis(400));
        server.join().unwrap();
    }
}
