use coucou_observer::{Monitor, Options, Phase, Roots, now_ms, STALE_MS};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);
fn setup() -> (Roots, PathBuf, u64, String) {
    let base = std::env::temp_dir().join(format!("typek-observer-owned-{}-{}-{}", std::process::id(), now_ms(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let roots = Roots { codex: base.join("codex"), claude: base.join("claude"), harness: base.join("harness") };
    let now = now_ms();
    let date = time::OffsetDateTime::from_unix_timestamp((now / 1000) as i64).unwrap();
    let folder = roots.codex.join(format!("{:04}/{:02}/{:02}", date.year(), date.month() as u8, date.day()));
    fs::create_dir_all(&folder).unwrap(); fs::create_dir_all(&roots.claude).unwrap(); fs::create_dir_all(&roots.harness).unwrap();
    // Avoid another time feature: this is the exact RFC3339 UTC representation used by native logs.
    let stamp = format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", date.year(), date.month() as u8, date.day(), date.hour(), date.minute(), date.second());
    (roots, folder.join("session.jsonl"), now, stamp)
}
fn opts() -> Options { Options { codex: true, claude: true, harness: true } }
fn line(kind: &str, stamp: &str) -> String { format!("{{\"type\":\"event_msg\",\"timestamp\":\"{stamp}\",\"payload\":{{\"type\":\"{kind}\"}}}}\n") }

#[test] fn startup_restores_and_append_is_live_without_replay() {
    let (roots, path, now, stamp) = setup(); fs::write(&path, line("task_started", &stamp)).unwrap();
    let mut monitor = Monitor::new(roots);
    let first = monitor.poll(opts(), now); assert_eq!(first.len(),1); assert!(first[0].activity.restored);
    fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(line("task_complete", &stamp).as_bytes()).unwrap();
    let second = monitor.poll(opts(), now + 2000); assert_eq!(second[0].activity.phase, Phase::Finished); assert!(!second[0].activity.restored);
    assert_eq!(second[0].activity.revision, 2);
    assert_eq!(monitor.poll(opts(), now + 4000)[0].activity.revision, 2);
}
#[test] fn incomplete_last_record_waits_for_the_next_read() {
    let (roots, path, now, stamp) = setup(); let done = line("task_complete", &stamp); let split = done.len() / 2;
    fs::write(&path, format!("{}{}", line("task_started", &stamp), &done[..split])).unwrap();
    let mut monitor = Monitor::new(roots); assert_eq!(monitor.poll(opts(),now)[0].activity.phase,Phase::Thinking);
    fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(done[split..].as_bytes()).unwrap();
    assert_eq!(monitor.poll(opts(),now + 2000)[0].activity.phase,Phase::Finished);
}
#[test] fn truncation_recovers_and_does_not_leave_stale_finished_state() {
    let (roots, path, now, stamp) = setup(); fs::write(&path, line("task_complete",&stamp).repeat(3)).unwrap();
    let mut monitor = Monitor::new(roots); assert_eq!(monitor.poll(opts(),now)[0].activity.phase,Phase::Finished);
    fs::write(&path,line("task_started",&stamp)).unwrap(); assert_eq!(monitor.poll(opts(),now+2000)[0].activity.phase,Phase::Thinking);
}
#[test] fn idle_is_not_reported_as_completion_and_disabled_source_is_removed() {
    let (roots,path,now,stamp)=setup(); fs::write(&path,line("task_started",&stamp)).unwrap(); let mut monitor=Monitor::new(roots);
    monitor.poll(opts(),now); let stale=monitor.poll(opts(),now+STALE_MS+2000); assert!(stale[0].activity.stale); assert_eq!(stale[0].activity.phase,Phase::Idle);
    assert!(monitor.poll(Options::default(),now+STALE_MS+4000).is_empty());
}
#[test] fn parallel_session_ids_never_overwrite_each_other() {
    let (roots,path,now,stamp)=setup(); fs::write(&path,line("task_started",&stamp)).unwrap(); fs::write(path.with_file_name("second.jsonl"),line("task_complete",&stamp)).unwrap();
    let rows=Monitor::new(roots).poll(opts(),now); assert_eq!(rows.len(),2); assert_ne!(rows[0].activity.id,rows[1].activity.id);
}
#[test] fn harness_state_changes_preserve_pending_review() {
    let (roots,_,now,stamp)=setup(); let job=roots.harness.join("j0123456789abcdef"); fs::create_dir_all(&job).unwrap(); let state=job.join("state.json");
    fs::write(&state,format!("{{\"state\":\"running\",\"providerId\":\"minimax\",\"updatedAt\":\"{stamp}\",\"spec\":{{\"projectRoot\":\"D:/Work/Demo\",\"prompt\":\"secret-canary\"}}}}")).unwrap();
    let mut monitor=Monitor::new(roots); let first=monitor.poll(opts(),now); assert_eq!(first[0].activity.phase,Phase::Working);
    fs::write(&state,format!("{{\"state\":\"completed_pending_review\",\"providerId\":\"minimax\",\"updatedAt\":\"{stamp}\"}}")).unwrap();
    let rows=monitor.poll(opts(),now+2000); assert_eq!(rows[0].activity.phase,Phase::Review); assert!(!rows[0].activity.restored);
    assert!(!serde_json::to_string(&rows[0].activity).unwrap().contains("secret-canary"));
}
#[test] fn large_bootstrap_skips_only_incomplete_prefix_and_remains_bounded() {
    let (roots,path,now,stamp)=setup(); let mut data=vec![b'x';2*1024*1024]; data.extend_from_slice(b"\n"); data.extend_from_slice(line("task_started",&stamp).as_bytes()); fs::write(&path,data).unwrap();
    let rows=Monitor::new(roots).poll(opts(),now); assert_eq!(rows.len(),1); assert_eq!(rows[0].activity.revision,1);
}
