## Update menu no longer claims "up to date" without knowing

With `use_persistent_claude`, the session menu's **🔄 Update Claude Code** item showed the latest release as "up to date" even when it could not tell which version was installed — on a CPU without x86-64-v2, or when the Claude binary was missing. It now says so instead.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
