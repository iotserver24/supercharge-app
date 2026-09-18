<h1 align="center">Supercharge App</h1>
<p align="center"><strong>building beyond limits</strong></p>
<p align="center"><em>A native desktop workbench for the Supercharge CLI.</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tauri-2-orange" alt="Tauri 2" />
</p>

## Overview

Supercharge App is the desktop interface for the local [`supercharge`](https://github.com/iotserver24/supercharge-releases) coding-agent CLI. The desktop shell communicates with `supercharge agent stdio` through the Agent Client Protocol (ACP); model requests, tools, permissions, sessions, skills, and provider behavior remain owned by the CLI.

Credit: original desktop workbench by [RongleCat](https://github.com/RongleCat).

## Features

- Multi-project chat workspace with concurrent sessions and background streaming.
- Structured assistant text, reasoning, tool calls, plans, permissions, and ask-user prompts.
- Live model discovery from the configured Supercharge CLI.
- OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages provider formats.
- Project files, code editor, Git diffs, worktrees, terminal, and rich media/document previews.
- MCP servers, skills, plugins, hooks, workflows, agents, memory, and scheduled tasks.
- Local session API, mobile browser mirror, SSH workflows, and Remote IM integrations.
- Local, Openverse, and Pexels wallpaper sources plus custom OpenAI-compatible dictation.
- macOS, Windows, and Linux desktop packages.

## Requirements

- Supercharge CLI 1.x available as `supercharge` or `supercharge-pager`.
- Node.js 22.22.2 or newer for development.
- pnpm 9.x.
- Rust and the platform dependencies required by Tauri 2.

Install the CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts/install.ps1 | iex
```

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Frontend-only preview:

```bash
pnpm dev:ui
```

Validation:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:ui
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The desktop discovers the CLI through `SUPERCHARGE_BIN`, the app’s configured binary path, colocated binaries, standard install locations, and `PATH`. Shared sessions use `SUPERCHARGE_HOME` or `~/.supercharge`; independent mode uses the app-owned Supercharge home.

## Local data and migration

The application uses its own Supercharge data namespace. On first run it can copy compatible non-secret project, session, layout, automation, extension, attachment, skin, and local wallpaper data from an older desktop home if one is present. Existing destination data wins, source data is not deleted, and credentials are never copied automatically.

## Security

Provider credentials and conversation history are sensitive. Do not commit `secrets.json`, authentication files, app data, or generated session contents. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE). Credit: original workbench by [RongleCat](https://github.com/RongleCat).
