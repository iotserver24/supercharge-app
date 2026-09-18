# Security Policy

## Reporting a vulnerability

If you discover a security issue in Supercharge App, especially credential leakage, unsafe agent process spawning, path-scope bypass, or local data exposure, report it privately through a GitHub Security Advisory for the Supercharge project. Do not open a public issue until a fix is available.

Please include a clear description, reproduction steps, and an impact assessment when known.

## Local security notes

- The desktop runs the local `supercharge agent stdio` process and can grant it filesystem, terminal, Git, MCP, and automation capabilities. Review the selected permission and sandbox policy before allowing unattended work.
- Provider keys should remain in the operating-system secret store when that option is enabled. File fallback data is written with owner-only permissions on Unix.
- The app never imports old credential files during namespace migration. Only compatible non-secret projects, sessions, preferences, automations, extensions, attachments, skins, and local wallpaper-library data are copied.
- Support bundles and diagnostics must not include `secrets.json`, operating-system keychain material, authentication files, or raw API keys.
- The mobile mirror and local session API are token-gated. Expose them beyond loopback only when you understand the network boundary.
- Remote IM credentials are sensitive and should not be committed or included in support artifacts.
