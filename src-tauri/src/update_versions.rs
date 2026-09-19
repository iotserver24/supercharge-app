pub fn parse(raw: &str) -> Option<semver::Version> {
    let token = raw.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(token).ok()
}

pub fn newer(current: &str, candidate: &str) -> bool {
    match (parse(current), parse(candidate)) {
        (Some(mut current), Some(mut candidate)) => {
            current.build = semver::BuildMetadata::EMPTY;
            candidate.build = semver::BuildMetadata::EMPTY;
            candidate > current
        }
        _ => false,
    }
}

pub fn needs_download(installed: &str, downloaded: Option<&str>, candidate: &str) -> bool {
    newer(installed, candidate) && downloaded.is_none_or(|version| newer(version, candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_numeric_versions_and_prereleases_without_build_metadata() {
        assert!(newer("0.2.9", "v0.2.10"));
        assert!(!newer("0.2.10", "0.2.9"));
        assert!(!newer("0.2.10", "v0.2.10"));
        assert!(newer("1.0.0-beta.2", "1.0.0-beta.10"));
        assert!(newer("1.0.0-beta.10", "1.0.0"));
        assert!(!newer("1.0.0", "1.0.0-rc.1"));
        assert!(!newer("1.0.0+a", "1.0.0+b"));
        assert!(!newer("invalid", "1.0.0"));
        assert!(!newer("1.0.0", "latest"));
    }

    #[test]
    fn never_downloads_the_same_or_an_older_staged_version() {
        assert!(needs_download("0.2.36", None, "0.2.37"));
        assert!(!needs_download("0.2.36", Some("0.2.37"), "0.2.37"));
        assert!(!needs_download("0.2.36", Some("0.2.38"), "0.2.37"));
        assert!(needs_download("0.2.36", Some("0.2.37"), "0.2.38"));
        assert!(!needs_download("0.2.38", None, "0.2.37"));
    }
}
