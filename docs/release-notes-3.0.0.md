## Claude Terminal Pro is now Claude Workbench

This project has its own name now: **Claude Workbench**, in the repository `Eifel-Joe/claude-workbench`, with a new logo. Same app, same features — it is no longer mistaken for ESJavadex's Claude Terminal Pro, which it grew out of.

### ⚠️ Breaking: install it as a new app

Home Assistant treats Claude Workbench as a new app (new slug `claude_workbench`). Your existing Claude Terminal Pro app keeps running but gets no more updates.

1. Add the repository `https://github.com/Eifel-Joe/claude-workbench` (Settings → Apps → App Store → ⋮ → Repositories).
2. Install **Claude Workbench** and start it.
3. Open the panel and confirm the takeover: memories, `CLAUDE.md`, history, logins, packages and settings come over from the old app (a partial backup of it is kept).
4. Uninstall the old app.
5. Remove the old repository entry `https://github.com/Eifel-Joe/claude-code-ha` — GitHub redirects it, so Claude Workbench would otherwise show up twice.

Coming from ESJavadex's Claude Terminal Pro? Same steps.

### Credits
Claude Workbench builds on Claude Terminal Pro by Javier Santos (@ESJavadex) and the original Claude Terminal by Tom Cassady (@heytcass). Thank you!

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
