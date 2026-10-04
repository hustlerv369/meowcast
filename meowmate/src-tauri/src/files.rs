// Dropped files are copied into %LOCALAPPDATA%\Coucou\inbox so the original is
// never touched and the copy survives the drag source going away.
// The inbox is swept of anything older than a week, as on macOS.

use std::path::{Component, Path, PathBuf, Prefix};
use std::io::{Read, Seek, SeekFrom};
use std::time::{Duration, Instant, SystemTime};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::os::windows::fs::OpenOptionsExt;

use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::System::WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE, DRIVE_CDROM, DRIVE_RAMDISK};

use crate::settings;

const KEEP_FOR: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const DROP_TTL: Duration = Duration::from_secs(30);
const MAX_RESERVED_DROPS: usize = 4;

struct ReservedDrop {
    file: std::fs::File,
    source: PathBuf,
    created: Instant,
}

#[derive(Default)]
struct DropReservations { items: HashMap<String, ReservedDrop> }

impl DropReservations {
    fn expire(&mut self, now: Instant) {
        self.items.retain(|_, item| now.saturating_duration_since(item.created) < DROP_TTL);
    }

    fn insert(&mut self, token: String, item: ReservedDrop, now: Instant) -> Result<(), String> {
        self.expire(now);
        if self.items.len() >= MAX_RESERVED_DROPS || self.items.contains_key(&token) {
            return Err("Přílohy se ještě připravují. Chvíli počkej a přetáhni soubor znovu.".into());
        }
        self.items.insert(token, item);
        Ok(())
    }

    fn take(&mut self, token: &str, now: Instant) -> Result<ReservedDrop, String> {
        self.expire(now);
        self.items.remove(token).ok_or_else(|| "Přetažený soubor už není dostupný. Přetáhni ho znovu.".into())
    }
}

static RESERVED_DROPS: OnceLock<Mutex<DropReservations>> = OnceLock::new();

fn reservations() -> &'static Mutex<DropReservations> {
    RESERVED_DROPS.get_or_init(|| Mutex::new(DropReservations::default()))
}

/// The OLE callback only acquires a handle. Bytes and metadata are read later on
/// the blocking worker. Delete sharing keeps temporary sources readable after
/// the source application removes their directory entry following DoDragDrop.
pub fn reserve_drop(source: &Path) -> Result<String, String> {
    let local_drive = match source.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                let root = [letter as u16, b':' as u16, b'\\' as u16, 0];
                matches!(unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) },
                    DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_CDROM | DRIVE_RAMDISK)
            }
            _ => false,
        },
        _ => false,
    };
    if !source.is_absolute() || !local_drive {
        return Err("Přetáhni soubor z místního disku. Síťové soubory nejdřív ulož do počítače.".into());
    }
    let file = std::fs::OpenOptions::new().read(true).share_mode(0x1 | 0x2 | 0x4)
        .open(source).map_err(|_| "Soubor nelze otevřít. Přetáhni jeden dostupný soubor, ne složku.".to_string())?;
    let token = format!("{:?}", unsafe { windows::Win32::System::Com::CoCreateGuid() }
        .map_err(|_| "Přílohu se nepodařilo připravit.".to_string())?);
    let now = Instant::now();
    reservations().lock().map_err(|_| "Přílohu se nepodařilo připravit.".to_string())?
        .insert(token.clone(), ReservedDrop { file, source: source.to_path_buf(), created: now }, now)?;
    Ok(token)
}

pub fn expire_drop_reservations() {
    if let Some(storage) = RESERVED_DROPS.get() {
        if let Ok(mut registry) = storage.lock() { registry.expire(Instant::now()); }
    }
}

pub fn ingest_reserved(token: &str) -> Result<DroppedFile, String> {
    if token.len() > 64 { return Err("Neplatná přetažená příloha.".into()); }
    let item = reservations().lock().map_err(|_| "Přílohu se nepodařilo připravit.".to_string())?
        .take(token, Instant::now())?;
    ingest_opened(item.file, &item.source, &inbox_dir())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

pub fn inbox_dir() -> PathBuf {
    settings::local_dir().join("inbox")
}

/// IPC paths never authorize a read. Only a one-use native drop reservation does.
pub fn ingest_request(_path: &str, token: Option<&str>) -> Result<DroppedFile, String> {
    ingest_reserved(token.ok_or("Drop a file onto Meowmate before attaching it.")?)
}

/// Called only by native drag callbacks, never exposed as an IPC command.
pub fn native_drop_payload(paths: &[PathBuf]) -> serde_json::Value {
    let reserved = if paths.len() == 1 { reserve_drop(&paths[0]) }
        else { Err("Drop one file at a time.".into()) };
    match reserved {
        Ok(token) => serde_json::json!({"type":"drop","paths":paths,"dropToken":token}),
        Err(error) => serde_json::json!({"type":"error","error":error}),
    }
}

fn ingest_opened(mut input: std::fs::File, src: &Path, dir: &Path) -> Result<DroppedFile, String> {
    let meta = input.metadata().map_err(|_| "Soubor nelze ověřit.".to_string())?;
    if !meta.is_file() {
        return Err("Složku zatím přiložit nelze. Přetáhni jeden textový soubor nebo obrázek.".into());
    }
    validate_opened(&mut input, src, meta.len())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let dest = copy_unique_opened(&mut input, src, dir, 999)?;
    let copied=std::fs::metadata(&dest).map_err(|_|"Kopii přílohy nelze ověřit.")?.len();
    if let Err(error)=validate_attachment(&dest,copied) {
        let _=std::fs::remove_file(&dest);
        return Err(error);
    }
    // CopyFileEx carries the source's timestamps across, so a file last edited
    // three years ago would arrive already older than the sweep window and be
    // deleted on the spot. The inbox ages from when *we* copied it.
    if let Ok(file) = std::fs::File::options().write(true).open(&dest) {
        let _ = file.set_modified(SystemTime::now());
    }
    sweep(&dir);

    Ok(DroppedFile {
        name,
        path: dest.to_string_lossy().to_string(),
        size: copied,
    })
}

fn validate_attachment(path:&Path,size:u64)->Result<(),String> {
    check_size(path, size)?;
    if byte_limit(path) == 200_000 {
        let mut input = std::fs::File::open(path).map_err(|_| "Přílohu nelze načíst.".to_string())?;
        validate_opened(&mut input, path, size)?;
    }
    Ok(())
}

fn byte_limit(path: &Path) -> u64 {
    let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
    if ["png","jpg","jpeg","webp"].contains(&ext.as_str()) { 10*1024*1024 } else { 200_000 }
}

fn check_size(path: &Path, size: u64) -> Result<(), String> {
    if byte_limit(path) > 200_000 {
        if size>10*1024*1024 {return Err("Obrázek může mít nejvýše 10 MB.".into());}
    } else {
        if size>200_000 {return Err("Textová příloha může mít nejvýše 200 kB. Obrázky PNG, JPEG a WebP nejvýše 10 MB.".into());}
    }
    Ok(())
}

fn validate_opened(input: &mut std::fs::File, path: &Path, size: u64) -> Result<(), String> {
    check_size(path, size)?;
    input.seek(SeekFrom::Start(0)).map_err(|_| "Přílohu nelze načíst.".to_string())?;
    if byte_limit(path) == 200_000 {
        let mut bytes=Vec::new();
        (&mut *input).take(200_001).read_to_end(&mut bytes).map_err(|_|"Přílohu nelze načíst.")?;
        if bytes.len()>200_000 || bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
            return Err("Přilož text UTF-8 nebo obrázek PNG, JPEG či WebP. PDF a další binární formáty zatím chat nepřijímá.".into());
        }
    }
    input.seek(SeekFrom::Start(0)).map_err(|_| "Přílohu nelze načíst.".to_string())?;
    Ok(())
}

#[cfg(test)]
fn copy_unique(src: &Path, dir: &Path, limit: usize) -> Result<PathBuf, String> {
    let mut input=std::fs::File::open(src).map_err(|_|"Zdrojový soubor nelze otevřít.".to_string())?;
    copy_unique_opened(&mut input, src, dir, limit)
}

fn copy_unique_opened(input: &mut std::fs::File, src: &Path, dir: &Path, limit: usize) -> Result<PathBuf, String> {
    input.seek(SeekFrom::Start(0)).map_err(|_| "Přílohu nelze načíst.".to_string())?;
    let byte_limit=byte_limit(src);
    let name = src.file_name().ok_or("The file has no name.")?;
    let stem = src.file_stem().map(|s| s.to_string_lossy()).unwrap_or_default();
    let ext = src.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    for index in 1..=limit {
        let dest = if index == 1 { dir.join(name) } else { dir.join(format!("{stem} ({index}){ext}")) };
        let mut output = match std::fs::File::options().write(true).create_new(true).open(&dest) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("cannot create a copy: {error}")),
        };
        let result = std::io::copy(&mut (&mut *input).take(byte_limit+1), &mut output).and_then(|count| {
            if count>byte_limit {Err(std::io::Error::other("Soubor během kopírování překročil limit přílohy."))}else{Ok(count)}
        });
        if let Err(error) = result {
            drop(output);
            let _ = std::fs::remove_file(&dest);
            return Err(format!("cannot copy: {error}"));
        }
        return Ok(dest);
    }
    Err("Too many copies of this file. Rename the file and try again.".into())
}

/// Drops anything copied here more than a week ago. `ingest` stamps every copy
/// with the time it landed, so this really is the age of the copy and not the
/// age of whatever the user happened to drag in.
fn sweep(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(copied) = meta.modified() else { continue };
        if now.duration_since(copied).map(|age| age > KEEP_FOR).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ingest(source: &str) -> Result<DroppedFile, String> {
        let src = Path::new(source);
        ingest_opened(std::fs::File::open(src).map_err(|_| "Missing test fixture")?, src, &inbox_dir())
    }

    fn reservation_fixture(label: &str) -> (PathBuf, PathBuf) {
        let unique = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("typek-{label}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("temporary.txt");
        std::fs::write(&source, b"held source survives deletion").unwrap();
        (directory, source)
    }

    #[test]
    fn ipc_path_without_native_reservation_never_authorizes_copy() {
        let (directory, source) = reservation_fixture("unreserved-ipc");
        assert!(ingest_request(source.to_str().unwrap(), None).is_err());
        assert!(ingest_request(source.to_str().unwrap(), Some("forged-token")).is_err());
        assert!(source.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_fallback_drop_issues_one_use_reservation_and_ignores_ipc_path() {
        let (directory, source) = reservation_fixture("native-fallback");
        assert_eq!(native_drop_payload(&[])["type"], "error");
        assert_eq!(native_drop_payload(&[source.clone(), source.clone()])["type"], "error");
        let payload = native_drop_payload(&[source.clone()]);
        assert_eq!(payload["type"], "drop");
        let token = payload["dropToken"].as_str().unwrap();
        std::fs::remove_file(&source).unwrap();
        let copied = ingest_request("C:/untrusted/ignored.txt", Some(token)).unwrap();
        assert_eq!(std::fs::read(&copied.path).unwrap(), b"held source survives deletion");
        assert!(ingest_request("anything", Some(token)).is_err());
        std::fs::remove_file(copied.path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn reserved_drop_survives_source_deletion_and_token_is_consumed_once() {
        let (directory, source) = reservation_fixture("reserved-source");
        let token = reserve_drop(&source).unwrap();
        std::fs::remove_file(&source).unwrap();
        assert!(!source.exists());
        let copied = ingest_reserved(&token).unwrap();
        assert_eq!(copied.name, "temporary.txt");
        assert_eq!(std::fs::read(&copied.path).unwrap(), b"held source survives deletion");
        assert!(ingest_reserved(&token).is_err());
        std::fs::remove_file(&copied.path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn reservation_capacity_and_expiry_release_handles() {
        let (directory, source) = reservation_fixture("reserved-capacity");
        let now = Instant::now();
        let mut registry = DropReservations::default();
        let item = || ReservedDrop { file: std::fs::File::open(&source).unwrap(), source: source.clone(), created: now };
        for index in 0..MAX_RESERVED_DROPS { registry.insert(index.to_string(), item(), now).unwrap(); }
        assert!(registry.insert("overflow".into(), item(), now).is_err());
        assert_eq!(registry.items.len(), MAX_RESERVED_DROPS);
        assert!(registry.take("0", now + DROP_TTL).is_err());
        assert!(registry.items.is_empty());
        registry.insert("new".into(), ReservedDrop { created: now + DROP_TTL, ..item() }, now + DROP_TTL).unwrap();
        let _held = registry.take("new", now + DROP_TTL).unwrap();
        assert!(registry.take("new", now + DROP_TTL).is_err());
        drop(_held);
        std::fs::remove_file(source).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn reserved_handle_still_rejects_oversized_and_binary_content() {
        let (directory, source) = reservation_fixture("reserved-validation");
        std::fs::write(&source, vec![b'x'; 200_001]).unwrap();
        let token = reserve_drop(&source).unwrap();
        std::fs::remove_file(&source).unwrap();
        assert!(ingest_reserved(&token).unwrap_err().contains("200 kB"));
        std::fs::write(&source, b"binary\0body").unwrap();
        let token = reserve_drop(&source).unwrap();
        std::fs::remove_file(&source).unwrap();
        assert!(ingest_reserved(&token).unwrap_err().contains("UTF-8"));
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn ole_reservation_rejects_network_and_device_paths_before_opening() {
        for path in [r"\\server\share\file.txt", r"\\?\unc\server\share\file.txt", r"\\.\pipe\example", "relative.txt"] {
            assert!(reserve_drop(Path::new(path)).unwrap_err().contains("místního disku"));
        }
    }

    #[test]
    fn copy_limits_bytes_even_without_metadata_validation() {
        let tmp=std::env::temp_dir().join(format!("typek-bounded-copy-{}",std::process::id()));
        let inbox=tmp.join("inbox");std::fs::create_dir_all(&inbox).unwrap();
        let source=tmp.join("growing.txt");
        std::fs::write(&source,vec![b'x';200_001]).unwrap();
        assert!(copy_unique(&source,&inbox,1).is_err());
        assert!(!inbox.join("growing.txt").exists());
        assert_eq!(std::fs::metadata(source).unwrap().len(),200_001);
    }

    #[test]
    fn unsupported_or_large_files_fail_before_copy() {
        let tmp=std::env::temp_dir().join(format!("typek-invalid-drop-{}",std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let binary=tmp.join("binary.pdf");std::fs::write(&binary,b"%PDF\0binary").unwrap();
        assert!(ingest(binary.to_str().unwrap()).unwrap_err().contains("UTF-8"));
        let large=tmp.join("large.txt");std::fs::write(&large,vec![b'x';200_001]).unwrap();
        assert!(ingest(large.to_str().unwrap()).unwrap_err().contains("200 kB"));
        assert!(validate_attachment(&tmp.join("large.png"),10*1024*1024+1).unwrap_err().contains("10 MB"));
    }

    #[test]
    fn all_slots_taken_never_overwrites_the_first_copy() {
        let tmp = std::env::temp_dir().join(format!("coucou-collision-{}", std::process::id()));
        let inbox = tmp.join("inbox");
        std::fs::create_dir_all(&inbox).unwrap();
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"new").unwrap();
        for name in ["note.txt", "note (2).txt", "note (3).txt"] {
            std::fs::write(inbox.join(name), b"keep").unwrap();
        }
        assert!(copy_unique(&source, &inbox, 3).is_err());
        for name in ["note.txt", "note (2).txt", "note (3).txt"] {
            assert_eq!(std::fs::read(inbox.join(name)).unwrap(), b"keep");
        }
    }

    #[test]
    fn concurrent_copies_get_different_names() {
        let tmp = std::env::temp_dir().join(format!("coucou-concurrent-{}", std::process::id()));
        let inbox = tmp.join("inbox");
        std::fs::create_dir_all(&inbox).unwrap();
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"keep").unwrap();
        let workers: Vec<_> = (0..2).map(|_| {
            let source = source.clone(); let inbox = inbox.clone();
            std::thread::spawn(move || copy_unique(&source, &inbox, 3).unwrap())
        }).collect();
        let paths: Vec<_> = workers.into_iter().map(|worker| worker.join().unwrap()).collect();
        assert_ne!(paths[0], paths[1]);
        for path in paths { assert_eq!(std::fs::read(path).unwrap(), b"keep"); }
    }

    #[test]
    fn ingest_copies_and_never_overwrites() {
        let tmp = std::env::temp_dir().join(format!("coucou-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"hello").unwrap();

        let first = ingest(source.to_str().unwrap()).unwrap();
        assert_eq!(first.name, "note.txt");
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");

        // A second drop of the same name must not clobber the first copy.
        std::fs::write(&source, b"second").unwrap();
        let second = ingest(source.to_str().unwrap()).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");
        assert_eq!(std::fs::read(&second.path).unwrap(), b"second");

        // Folders are refused rather than silently ignored.
        assert!(ingest(tmp.to_str().unwrap()).is_err());

        // An ancient source must not arrive already older than the sweep window.
        let old_source = tmp.join("ancient.txt");
        std::fs::write(&old_source, b"old").unwrap();
        let long_ago = SystemTime::now() - KEEP_FOR - Duration::from_secs(60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&old_source)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        let aged = ingest(old_source.to_str().unwrap()).unwrap();
        assert!(
            Path::new(&aged.path).exists(),
            "a file copied just now was swept as if it were a week old"
        );
        let _ = std::fs::remove_file(&aged.path);

        let _ = std::fs::remove_file(&first.path);
        let _ = std::fs::remove_file(&second.path);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
