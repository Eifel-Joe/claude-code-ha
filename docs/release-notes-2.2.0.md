## Switch from the ESJavadex app in one step

Install this app next to your existing Claude Terminal Pro (for example the ESJavadex original). On first start it finds the old app, and when you open the panel a window lets you choose what to take over:

1. Claude data — memories, `CLAUDE.md`, history, settings
2. Claude login
3. GitHub login (`gh`)
4. Packages — reinstalled, not copied (only explicitly installed pip packages)
5. Stop the old app and disable its autostart
6. App settings (`auto_launch_claude`, `dangerously_skip_permissions`, `tmux_mouse`, `remote_control*`)

Digits toggle, Enter takes over, `s` asks again on the next start, `n` never asks.

- It works through a **partial backup of the old app** created via the Supervisor API, with progress shown while it runs. The backup is kept under *Settings → System → Backups* as a fallback. It contains the old app's image (several hundred MB) and the old login, so delete it once everything works.
- Nothing that already exists in this app is overwritten. Apart from being stopped (if you choose 5), the old app is never modified.
- If an item fails, or Claude data/login are not found, the old app keeps running. If the takeover fails after the backup was made, that backup is deleted again.

> **Using the ESJavadex app 2.0.13?** It publishes ports 7680/7681, which expose an unauthenticated root shell on your network. Switch soon, or clear both port fields in the old app's network settings until then.

## Fixes
- `persist-install --python` reported failed installs as success, so broken packages looked installed (also during automatic installation at startup). It now fails with a clear message.

## Wording
- "Add-on" is now "app" throughout, as in Home Assistant since 2026.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
