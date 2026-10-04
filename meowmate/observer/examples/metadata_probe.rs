use coucou_observer::{Monitor, Options, Roots, now_ms};
fn main() {
    let mut monitor = Monitor::new(Roots::environment());
    let rows = monitor.poll(Options { codex: true, claude: true, harness: true }, now_ms());
    let metadata: Vec<_> = rows.iter().map(|r| &r.activity).collect();
    println!("{}", serde_json::to_string_pretty(&metadata).unwrap());
}
