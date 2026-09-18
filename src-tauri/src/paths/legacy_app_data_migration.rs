use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path};

const MIGRATION_VERSION: u32 = 1;
const MARKER_FILE: &str = ".legacy-grok-app-migration-v1";
const COMPATIBLE_ENTRIES: &[&str] = &[
    "projects.json",
    "workspaces.json",
    "sessions_index.json",
    "settings.json",
    "automations.json",
    "extensions.json",
    "sessions",
    "attachments",
    "skin-presets",
    "skin-catalog-cache",
    "wallpapers/library",
];

/// Copy the explicitly allowlisted, non-secret Supercharge App data into a Supercharge
/// app-data root. Existing destination entries win, source symlinks are ignored,
/// and destination symlinks are never traversed.
pub(super) fn migrate_legacy_app_data(
    source_root: &Path,
    destination_root: &Path,
) -> io::Result<()> {
    let source_metadata = match fs::symlink_metadata(source_root) {
        Ok(metadata) if metadata.file_type().is_dir() => metadata,
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if source_metadata.file_type().is_symlink() {
        return Ok(());
    }

    if roots_are_same(source_root, destination_root) {
        return Ok(());
    }
    ensure_root_directory(destination_root)?;

    let marker = destination_root.join(MARKER_FILE);
    if is_regular_file(&marker)? {
        return Ok(());
    }

    let mut saw_compatible_entry = false;
    for relative in COMPATIBLE_ENTRIES {
        let relative = Path::new(relative);
        let source = source_root.join(relative);
        let source_metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !source_metadata.is_file() && !source_metadata.is_dir() {
            continue;
        }

        saw_compatible_entry = true;
        let Some(destination_parent) = ensure_relative_directory(
            destination_root,
            relative.parent().unwrap_or_else(|| Path::new("")),
        )?
        else {
            continue;
        };
        let Some(name) = relative.file_name() else {
            continue;
        };
        copy_entry_without_overwrite(&source, &destination_parent.join(name))?;
    }

    if saw_compatible_entry {
        write_marker(&marker)?;
    }
    Ok(())
}

fn ensure_root_directory(root: &Path) -> io::Result<()> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "migration destination is not a directory: {}",
                root.display()
            ),
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(root)?;
            let metadata = fs::symlink_metadata(root)?;
            if metadata.file_type().is_dir() {
                Ok(())
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "migration destination is not a directory: {}",
                        root.display()
                    ),
                ))
            }
        }
        Err(error) => Err(error),
    }
}

fn roots_are_same(source: &Path, destination: &Path) -> bool {
    if source == destination {
        return true;
    }
    match (source.canonicalize(), destination.canonicalize()) {
        (Ok(source), Ok(destination)) => source == destination,
        _ => false,
    }
}

fn is_regular_file(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_file()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Create and validate a directory below `root` one component at a time. A
/// symlink or non-directory at any destination component makes that branch a
/// no-op rather than allowing migration to escape the destination root.
fn ensure_relative_directory(
    root: &Path,
    relative: &Path,
) -> io::Result<Option<std::path::PathBuf>> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Ok(None);
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        let metadata = fs::symlink_metadata(&current)?;
                        if !metadata.file_type().is_dir() {
                            return Ok(None);
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(Some(current))
}

fn copy_entry_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    let source_metadata = match fs::symlink_metadata(source) {
        Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    match fs::symlink_metadata(destination) {
        Ok(destination_metadata) => {
            if source_metadata.is_dir() && destination_metadata.file_type().is_dir() {
                copy_directory_without_overwrite(source, destination)
            } else {
                Ok(())
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if source_metadata.is_dir() {
                match fs::create_dir(destination) {
                    Ok(()) => copy_directory_without_overwrite(source, destination),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        match fs::symlink_metadata(destination) {
                            Ok(metadata) if metadata.file_type().is_dir() => {
                                copy_directory_without_overwrite(source, destination)
                            }
                            Ok(_) => Ok(()),
                            Err(error) => Err(error),
                        }
                    }
                    Err(error) => Err(error),
                }
            } else if source_metadata.is_file() {
                copy_file_without_overwrite(source, destination)
            } else {
                Ok(())
            }
        }
        Err(error) => Err(error),
    }
}

fn copy_directory_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        copy_entry_without_overwrite(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_file_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    let mut destination_file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
    {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(error),
    };

    let copy_result = (|| {
        let mut source_file = File::open(source)?;
        io::copy(&mut source_file, &mut destination_file)?;
        destination_file.sync_all()
    })();
    if let Err(error) = copy_result {
        drop(destination_file);
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}

fn write_marker(marker: &Path) -> io::Result<()> {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(marker) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(error),
    };
    if let Err(error) = writeln!(file, "{MIGRATION_VERSION}").and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(marker);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRoots {
        base: std::path::PathBuf,
        source: std::path::PathBuf,
        destination: std::path::PathBuf,
    }

    impl TestRoots {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after unix epoch")
                .as_nanos();
            let base = std::env::temp_dir().join(format!(
                "supercharge-legacy-migration-{name}-{}-{unique}",
                std::process::id()
            ));
            let source = base.join("legacy");
            let destination = base.join("supercharge");
            fs::create_dir_all(&source).expect("create source");
            Self {
                base,
                source,
                destination,
            }
        }
    }

    impl Drop for TestRoots {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write fixture");
    }

    #[test]
    fn copies_only_allowlisted_data_without_overwriting_destination() {
        let roots = TestRoots::new("allowlist");
        for file in [
            "projects.json",
            "workspaces.json",
            "sessions_index.json",
            "settings.json",
            "automations.json",
            "extensions.json",
        ] {
            write(&roots.source.join(file), &format!("legacy-{file}"));
        }
        write(&roots.source.join("sessions/one/session.json"), "session");
        write(
            &roots.source.join("attachments/paste/note.txt"),
            "attachment",
        );
        write(&roots.source.join("skin-presets/theme/skin.json"), "skin");
        write(
            &roots.source.join("skin-catalog-cache/catalog.json"),
            "catalog",
        );
        write(
            &roots.source.join("wallpapers/library/imported.jpg"),
            "library",
        );

        write(&roots.source.join("secrets.json"), "secret");
        write(&roots.source.join("accounts/account.json"), "account");
        write(
            &roots.source.join("remote/channel-secrets.json"),
            "channel-secret",
        );
        write(&roots.source.join("auth.json"), "auth");
        write(&roots.source.join("agent-home/config.toml"), "agent");
        write(&roots.source.join("logs/app.log"), "log");
        write(&roots.source.join("wallpapers/x/x.jpg"), "x-media");
        write(
            &roots.source.join("wallpapers/imagine/imagine.jpg"),
            "imagine-media",
        );

        write(
            &roots.destination.join("settings.json"),
            "supercharge-settings",
        );
        write(
            &roots.destination.join("sessions/existing/session.json"),
            "existing-session",
        );

        migrate_legacy_app_data(&roots.source, &roots.destination).expect("migrate");

        assert_eq!(
            fs::read_to_string(roots.destination.join("projects.json")).unwrap(),
            "legacy-projects.json"
        );
        assert_eq!(
            fs::read_to_string(roots.destination.join("settings.json")).unwrap(),
            "supercharge-settings"
        );
        assert_eq!(
            fs::read_to_string(roots.destination.join("sessions/one/session.json")).unwrap(),
            "session"
        );
        assert_eq!(
            fs::read_to_string(roots.destination.join("sessions/existing/session.json")).unwrap(),
            "existing-session"
        );
        assert!(roots
            .destination
            .join("wallpapers/library/imported.jpg")
            .is_file());

        for excluded in [
            "secrets.json",
            "accounts",
            "remote/channel-secrets.json",
            "auth.json",
            "agent-home",
            "logs",
            "wallpapers/x",
            "wallpapers/imagine",
        ] {
            assert!(
                !roots.destination.join(excluded).exists(),
                "excluded path was copied: {excluded}"
            );
        }
        assert_eq!(
            fs::read_to_string(roots.destination.join(MARKER_FILE)).unwrap(),
            "1\n"
        );
    }

    #[test]
    fn marker_makes_repeated_runs_idempotent() {
        let roots = TestRoots::new("idempotent");
        write(&roots.source.join("projects.json"), "legacy");

        migrate_legacy_app_data(&roots.source, &roots.destination).expect("first migration");
        write(
            &roots.destination.join("projects.json"),
            "supercharge-change",
        );
        write(&roots.source.join("projects.json"), "later-legacy-change");
        write(&roots.source.join("workspaces.json"), "later-file");

        migrate_legacy_app_data(&roots.source, &roots.destination).expect("second migration");

        assert_eq!(
            fs::read_to_string(roots.destination.join("projects.json")).unwrap(),
            "supercharge-change"
        );
        assert!(!roots.destination.join("workspaces.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn skips_source_and_destination_symlinks() {
        use std::os::unix::fs::symlink;

        let roots = TestRoots::new("symlinks");
        write(&roots.source.join("sessions/real/session.json"), "session");
        write(&roots.source.join("outside-secret.txt"), "secret");
        symlink(
            roots.source.join("outside-secret.txt"),
            roots.source.join("projects.json"),
        )
        .expect("source symlink");

        let outside_destination = roots.base.join("outside-destination");
        fs::create_dir_all(&outside_destination).expect("outside destination");
        fs::create_dir_all(&roots.destination).expect("destination");
        symlink(&outside_destination, roots.destination.join("sessions"))
            .expect("destination symlink");

        migrate_legacy_app_data(&roots.source, &roots.destination).expect("migrate");

        assert!(!roots.destination.join("projects.json").exists());
        assert!(!outside_destination.join("real/session.json").exists());
    }
}
