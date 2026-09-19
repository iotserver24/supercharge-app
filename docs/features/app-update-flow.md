# Combined app and CLI updates

The conversation banner, sidebar update indicator, Settings → About, and Runtime use the same update controller. Checks do not download or restart anything.

## Flow

1. Check desktop and CLI versions independently. A CLI `v1.x` release is not a desktop `0.x` release.
2. **Update app & CLI** downloads only newer components. App packages are staged and verified; CLI installation does not recycle active agents.
3. Show **Restart to use updates** when an app package is downloaded or a newer CLI has been installed. Downloads alone never restart the app.
4. On explicit restart confirmation, install the staged app, then stop managed agents and relaunch. A failed app install leaves agents running and the verified download available for retry.
5. On restart failure, retry without reinstalling an already-applied app package. Preserve independent results if one component fails.

## Version and cache rules

- Use semantic version ordering, including prereleases. Build metadata is not an update.
- Never download an equal or older version than the installed or already-staged version.
- Keep a staged app version stable until restart; repeated checks do not discard its installation handle.
- Signed downloads are stored under app data `updates/` and reverified against the updater public key before installation.
- Native Linux desktop downloads require a published SHA-256 digest or checksum manifest. Checksum mismatch, missing checksums, wrong executable architecture, or an untrusted URL block installation.
- CLI downloads are reused only when they match the release's published checksum. A fresh version check precedes CLI installation.

## Desktop release identity

The public repository `iotserver24/supercharge-releases` also carries CLI releases. App discovery examines stable release assets and ignores releases without a desktop package. Recommended app tags are `app-v0.2.37`; legacy `v0.x` tags with desktop assets remain accepted. Do not mark app releases as the repository's generic latest release while the CLI installer uses `/releases/latest`.

The currently checked repository has CLI releases but no desktop app release. The UI therefore shows **No desktop release published**, rather than claiming the CLI version is an app update.

### Package support

- Signed macOS, Windows, and Linux AppImage distributions retain Tauri signature verification and its platform installer.
- User-owned Linux native installations at `~/.local/bin/supercharge-app` accept the matching `supercharge-app-linux-x86_64` or `supercharge-app-linux-aarch64` executable. Downloads are verified, retained, and installed through a sibling-file atomic rename with an app-local backup.
- System-managed `.deb`/`.rpm` packages and unsigned macOS/Windows builds keep an explicit manual-installer action. Never silently overwrite a package manager's installation.
- No public signing keys are invented and no checksum/signature verification is disabled to claim update support.

## Key files

- `src/lib/updateController.ts`: shared lifecycle, independent component results, restart gate.
- `src/hooks/useUpdater.ts`: Tauri/CLI adapters and periodic metadata checks.
- `src/components/UpdatesPanel.tsx`: shared status, progress, and confirmation controls.
- `src-tauri/src/app_update.rs`: desktop-only release discovery.
- `src-tauri/src/app_update_package.rs`: checksum-verified native Linux package caching/install.
- `src-tauri/src/signed_update_cache.rs`: signed Tauri package cache.
- `src-tauri/src/update_versions.rs`, `src/lib/updateVersion.ts`: version comparison.

## Verification boundaries

Unit/component tests cover newer/equal/older versions, prereleases, repeated clicks, cache reuse, offline checks, partial failure, manual packages, restart confirmation, and install/relaunch failure. Test updates with an isolated profile or the explicitly enabled Developer mode simulation. Do not replace a real binary or publish a release to exercise UI states.
