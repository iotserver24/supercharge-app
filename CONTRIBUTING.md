# Contributing to Supercharge App

Thanks for your interest in contributing.

## Development

The root application uses pnpm. Do not run `npm install` or Yarn at the repository root because that creates a competing lockfile. The legacy `remote-bridge/` package is separate and is not part of the normal desktop build.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Frontend-only preview:

```bash
pnpm dev:ui
```

Run the checks before submitting changes:

```bash
pnpm deps:check
pnpm audit:prod
pnpm typecheck
pnpm lint
pnpm test
pnpm build:ui
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

For a local agent, install the Supercharge CLI and make `supercharge` available on `PATH`, or set `SUPERCHARGE_BIN`. Shared sessions use `SUPERCHARGE_HOME` or `~/.supercharge`.

## Guidelines

- Product name: **Supercharge App**; installed bundle name: **Supercharge**.
- Preserve the desktop-to-agent boundary: the app is an ACP client and must not duplicate the CLI’s model/tool loop.
- Keep all user-facing text in `src/i18n/`; all locale catalogs must retain the same key set.
- Do not add new feature state or large blocks to `src/App.tsx` or `src/app/AppWorkbench.tsx`; use domain hooks, providers, components, and library modules.
- Do not use browser-native confirm, prompt, select, or context menus for product interactions; reuse existing application components.
- Do not commit `node_modules`, `target`, `dist`, authentication files, app data, API keys, or `secrets.json`.
- Preserve compatibility readers for legacy Grok App data until a deliberate migration release removes them.
- Keep [LICENSE](LICENSE) and [NOTICE-UPSTREAM.md](NOTICE-UPSTREAM.md) intact.

## Pull requests

Keep changes focused, explain user-visible behavior and validation, and include tests for protocol, migration, persistence, and settings changes. Do not tag or publish a release without explicit maintainer approval.
