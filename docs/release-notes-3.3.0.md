## claude-doctor, own tmux settings, honest security notes

- **`claude-doctor`** runs the app's health check in the terminal — and the check now actually starts Claude Code, Node.js and npm, so a binary that cannot run no longer gets a green tick.
- **Own tmux settings** go in `~/.tmux.conf.local`; they override the defaults and survive restarts and updates.
- **Security notes:** every signed-in Home Assistant user can open the panel, not only administrators (`panel_admin` only hides the sidebar entry). The README now says so and what is behind the panel. If you hand out limited accounts, stop or uninstall the app.
- **Fixes:** the panel's files are no longer served stale after an update; CI runs on a pinned Ubuntu 24.04.

These come from [@umrath](https://github.com/umrath) in [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons) (`ff4ebec`, `8e65403`) and the fork by [@owine](https://github.com/owine) ([owine/claude-terminal-home-assistant](https://github.com/owine/claude-terminal-home-assistant), `cc0d74e7`, `1175851a`, `1e0a33e2`, `67dd7e55`); BartBourgeois and Maheidem had the tmux idea too. Thank you! Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
