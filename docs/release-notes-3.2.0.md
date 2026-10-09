## Cleaner backups, a panel that answers right away

- **Old pasted images are deleted.** New option *Keep pasted images (days)*, default 30 (`0` keeps all). Pasted images sat in `/data/images` and in every backup forever.
- **The panel comes up immediately.** Before, it waited for Claude Code's update and the package installs (Home Assistant showed a 502). The terminal now says "Claude Workbench is starting…" until it is ready.
- **Fixes:** the health check runs every check and prints its summary; the app's own commands and skill are refreshed on every start; uploaded images get their extension from the image type; the authentication helper leaves no copy of the login code behind.

Most of these come from the fork by [@owine](https://github.com/owine) ([owine/claude-terminal-home-assistant](https://github.com/owine/claude-terminal-home-assistant), #374, #379, #380), found in a survey of the forks of heytcass/home-assistant-addons; the image clean-up was also suggested by msvinth and mattbsea. Thank you! Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
