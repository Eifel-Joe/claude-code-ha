First release from **Eifel-Joe/claude-code-ha**. Upstream (ESJavadex/claude-code-ha) has been inactive for months; this release collects the fixes published in its community forks. Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).

## Highlights

### New models: Claude Code stays current
New models (Opus 5.5, Fable, …) need a newer Claude Code CLI, and the add-on was frozen on the version current at first build.
- The persistent Claude override now actually takes effect: the baked binary used to win on `PATH` (marcjay, nsleigh).
- New session-picker item **🔄 Update Claude Code**, showing installed vs. latest version (nsleigh).
- `use_persistent_claude` and `auto_update_claude_on_start` now **default to `true`**.

### Rebuilds no longer hang
`install.sh` ends in an interactive TUI that never returns in a Docker build (ESJavadex/claude-code-ha#44). It now times out and the npm fallback takes over.

### 🔒 Security — breaking
ttyd was published on port 7681 as an **unauthenticated root shell** reachable from the LAN. No host ports are published any more and ttyd binds to `127.0.0.1` (Moulbi). **Open the add-on from the sidebar panel; direct `http://<host>:7680/7681` access is gone.**

### More
- Copy out of the terminal, swipe scrolling and on-screen keyboard fixes on phones (PeterLinuxOSS, nsleigh)
- Image and text paste inside the terminal (nsleigh)
- `remote_control` option to start Claude with `--remote-control` (martinboksa)
- Access to other apps' config folders via `all_app_configs` (requested in ESJavadex/claude-code-ha#9, #11)
- Image-service health check, credential migration and WebSocket proxy fixes; CI with lint, tests and amd64/aarch64 builds (Moulbi)
- Dependency updates: `proxy-addr` (critical) and `multer` advisories patched

## Switching from the ESJavadex repository
Home Assistant treats the add-on from this repository as a new add-on: add `https://github.com/Eifel-Joe/claude-code-ha`, install **Claude Terminal Pro**, and log in to Claude once. Both can run side by side until you remove the old one.

Thanks to everyone whose fork work is included: Moulbi, PeterLinuxOSS, nsleigh, marcjay, martinboksa, and ESJavadex for the original add-on.
