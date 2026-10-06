## A hung download no longer keeps the panel blank

Before the terminal starts, the app updates Claude Code (on by default) and installs the packages from `persistent_apk_packages` / `persistent_pip_packages`. None of these had a time limit, so a stuck npm registry or package mirror left the panel blank with nothing in the log saying why.

They now give up and log `… timed out after Ns`, and the app starts as usual:
- 300 s for the Claude Code update (the built-in Claude Code is used if it did not finish)
- 300 s for each apk package, so one stuck package does not cost the rest
- 900 s for the pip install, since a Pi may compile packages on first install

The image now includes GNU `coreutils`: BusyBox `timeout` stops only the process it started, so a stuck `apk add` would have kept running and locked the package database. If the Claude Code update keeps failing after a cut-off, the log says how to recover (delete `/data/npm` and restart the app).

## Documentation
- The app description said credentials are stored in `/config/claude-config/`. They are in the app's private `/data` (`/data/home/.claude`).

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
