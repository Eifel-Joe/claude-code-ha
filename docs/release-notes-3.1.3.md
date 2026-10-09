## Smaller backups, one permission less

- **npm's cache is out of your backups.** It sat in `/data/home/.npm` (about 115 MB) and went into every backup of the app, including the automatic one before each update. It now lives in `/tmp` and the old folder is removed on the first start. With *Update Claude Code on start* enabled (the default), each start downloads Claude Code again (about 113 MB, roughly 16 s longer). Idea from heytcass/home-assistant-addons#105.
- **`auth_api` removed.** The app never checks Home Assistant passwords, so it no longer asks for the permission to do so. Idea from heytcass/home-assistant-addons@3a6ee0d.

Thanks to Tom Cassady ([@heytcass](https://github.com/heytcass)). Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
