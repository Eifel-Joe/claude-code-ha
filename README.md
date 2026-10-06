# Claude Terminal Pro for Home Assistant

[![Version](https://img.shields.io/badge/version-2.1.0-1f6feb)](claude-terminal/CHANGELOG.md)
[![Latest release](https://img.shields.io/github/v/release/Eifel-Joe/claude-code-ha?label=release&color=1f6feb)](https://github.com/Eifel-Joe/claude-code-ha/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-3fb950)](LICENSE)
[![Architectures](https://img.shields.io/badge/arch-amd64%20%7C%20aarch64%20%7C%20armv7-8957e5)](#architecture-support)
[![Base image](https://img.shields.io/badge/base-Alpine%203.21-0db7ed)](claude-terminal/Dockerfile)

A Home Assistant app that runs Anthropic's **Claude Code CLI** in a browser-based terminal, right inside your dashboard. It ships the tools you actually need for HA work — the `ha` and `gh` CLIs, git, Python — keeps your session alive across restarts with tmux, and lets you install extra packages that survive reboots.

![Claude Terminal Screenshot](claude-terminal/screenshot.png)

> **This is [Eifel-Joe](https://github.com/Eifel-Joe)'s maintained fork** of
> [ESJavadex/claude-code-ha](https://github.com/ESJavadex/claude-code-ha) by Javier Santos,
> which itself builds on [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons)
> by Tom Cassady. Upstream's last release was 2.0.13 in July 2026 and several community pull
> requests are still open, so this fork collects the fixes published across the community forks
> and keeps Claude Code current. Huge thanks to Javier for the app this is built on.
> Same MIT license as the original.

## What's different in this fork

- **One-step switch from the ESJavadex app** — memories, logins, packages and settings are taken over on first start
- **New models work** — Claude Code updates itself on every start (Opus 5.5, Fable, …), plus a 🔄 *Update Claude Code* menu item
- **Security fix** — no unauthenticated root shell on port 7681; access only through the HA sidebar (ingress)
- **Rebuilds no longer hang** on the Claude installer
- **Phone-friendly terminal** — copy, swipe scrolling, on-screen keyboard, image paste
- **Remote Control** and access to other apps' config folders

Everything collected from community forks is credited in the [changelog](claude-terminal/CHANGELOG.md).
**Switching from the ESJavadex app?** Install this app next to it. On first start it
finds the old app and, when you open the panel, offers to take over your Claude
memories, `CLAUDE.md`, history, logins, packages and settings — via a partial
backup of the old app, which is kept as a fallback. The old app is stopped
afterwards; uninstall it once everything works.

---

## Install

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FEifel-Joe%2Fclaude-code-ha)

Or add it manually:

1. **Settings → Apps → App Store**
2. Top-right menu (⋮) → **Repositories**
3. Add `https://github.com/Eifel-Joe/claude-code-ha` and click **Add**
4. Install **Claude Terminal Pro**, start it, and open the panel from the sidebar

Authentication uses OAuth — no API key or config needed for a normal setup. The terminal opens in your `/config` directory.

---

## Features

### Terminal & session
- **Web terminal** via ttyd, embedded in the HA sidebar (`code-braces-box` panel icon) — reachable only through Home Assistant ingress, no host ports
- **Auto-launch** Claude on open, or an interactive **session picker** (`auto_launch_claude`)
- **Persistent tmux session** — closing the browser tab or restarting Home Assistant Core does not kill your Claude session; reopening reattaches to the same one
- **Remote Control** — start Claude paired with claude.ai/code and the Claude app (`remote_control`)
- **Reliable browser copy/paste** — tmux mouse capture is **off by default** so pasting works (including OAuth login codes); re-enable with `tmux_mouse` if you prefer tmux mouse selection

### Bundled tooling
- **Claude Code CLI** — latest native release on amd64/aarch64
- **Home Assistant CLI** (`ha`) — talk to Supervisor and Core from the terminal
- **GitHub CLI** (`gh`) — with persistent auth
- **git, Python 3 + pip, Node.js, jq, yq, vim, nano, tree** and more, out of the box
- **Claude Code skills & commands** for Home Assistant pre-installed

### Persistence & packages
- **Everything in `/data`** survives reboots and app updates (auth, config, packages)
- **`persist-install`** — install APK/pip packages that stick across restarts, into an isolated Python venv
- **Auto-install** — declare packages in the config and they install on startup (`persistent_apk_packages`, `persistent_pip_packages`)
- **Always-current Claude Code** — kept in `/data/npm` and updated on each start (on by default: `use_persistent_claude`, `auto_update_claude_on_start`), validated before activation; or update manually from the session picker

### Extras
- **Image paste** — paste (Ctrl+V), drag-drop, or upload images for Claude to analyze (JPEG/PNG/GIF/WebP/SVG, ~10 MB), stored in `/data/images/`. Lightweight service (~10 MB RAM), ARM-compatible
- **Unrestricted mode** — optionally run Claude with `--dangerously-skip-permissions` for full file access (`dangerously_skip_permissions`)

---

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `auto_launch_claude` | `true` | Start Claude automatically, or show the session picker |
| `remote_control` | `false` | Start the auto-launched session with `--remote-control` (claude.ai/code, Claude app) |
| `remote_control_session_name` | `""` | Optional name for the Remote Control session |
| `tmux_mouse` | `false` | Enable tmux mouse mode. Keep off for native browser copy/paste |
| `dangerously_skip_permissions` | `false` | Run Claude with unrestricted file access |
| `persistent_apk_packages` | `[]` | Alpine (APK) packages to auto-install on startup |
| `persistent_pip_packages` | `[]` | Python (pip) packages to auto-install on startup |
| `use_persistent_claude` | `true` | Use a Claude Code install kept in `/data/npm` instead of the baked-in one |
| `auto_update_claude_on_start` | `true` | When the override is enabled, update it on each start |

**Example:**

```yaml
auto_launch_claude: true
tmux_mouse: false
dangerously_skip_permissions: false
persistent_apk_packages:
  - htop
  - ripgrep
persistent_pip_packages:
  - httpx
```

See [DOCS.md](claude-terminal/DOCS.md) for the full guide.

---

## Quick start

```bash
# Ask Claude directly
claude "Write a Home Assistant automation that turns on the porch light at sunset"

# Interactive session
claude

# Install a package that survives restarts
persist-install ripgrep
persist-install --python httpx

# Use the bundled CLIs
ha core info
gh repo list
```

---

## Architecture support

| Architecture | Claude Code | Home Assistant CLI | GitHub CLI |
| --- | --- | --- | --- |
| `amd64` | native, latest | latest | latest |
| `aarch64` | native, latest | latest | latest |
| `armv7` | portable JS `1.0.128` ¹ | `4.46.0` ² | `armv6` build ³ |

¹ Current Claude Code native releases do not publish a 32-bit ARM binary, so armv7 uses the last portable JavaScript release.
² `4.46.0` is the last HA CLI release that still ships the `ha_armv7` asset (later releases dropped it).
³ GitHub CLI has no armv7 build; the armv6 binary runs on armv7 and is pinned to a version verified to publish it.

The target architecture is resolved from Home Assistant's `BUILD_ARCH` build argument, so the image builds correctly on each device without relying on BuildKit-specific variables.

---

## Recommended: Home Assistant plugins for Claude

Pair the app with the **[Claude Home Assistant Plugins](https://github.com/ESJavadex/claude-homeassistant-plugins)** for HA-specific tools and context (entity management, automation helpers, and more):

```bash
npx claude-plugins install @ESJavadex/claude-homeassistant-plugins/homeassistant-config
```

This drops a `CLAUDE.md` into your config directory with context tailored for Home Assistant development.

---

## Documentation

- [App documentation](claude-terminal/DOCS.md) — options, usage, persistent packages
- [Development guide](DEVELOPMENT.md) — build and test the app locally
- [Changelog](claude-terminal/CHANGELOG.md) — release history

## Community tools

- **[ha-ws-client-go](https://github.com/schoolboyqueue/home-assistant-blueprints/tree/main/scripts/ha-ws-client-go)** by [@schoolboyqueue](https://github.com/schoolboyqueue) — lightweight Go CLI for the Home Assistant WebSocket API. Gives Claude direct access to entity states, service calls, automation traces, and real-time monitoring. Single binary, no dependencies.

## Support

Found a bug or have a request? [Open an issue](https://github.com/Eifel-Joe/claude-code-ha/issues).

## Credits

- **Fork maintainer:** [@Eifel-Joe](https://github.com/Eifel-Joe)
- **Upstream:** Javier Santos ([@ESJavadex](https://github.com/ESJavadex)) — creator of
  Claude Terminal Pro: persistent packages, tmux persistence, multi-arch and much more.
  Greetings and thanks, Javier! More of his AI + Home Assistant work: [Javadex](https://www.javadex.es/)
- **Original creator:** Tom Cassady ([@heytcass](https://github.com/heytcass)) — the initial Claude Terminal app
- **Community fork contributions in 2.1.0:** [@Moulbi](https://github.com/Moulbi),
  [@PeterLinuxOSS](https://github.com/PeterLinuxOSS), [@nsleigh](https://github.com/nsleigh),
  [@marcjay](https://github.com/marcjay), [@martinboksa](https://github.com/martinboksa)

Built and maintained with the help of Claude Code itself.

## License

MIT — see [LICENSE](LICENSE).
