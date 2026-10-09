## Auto-continue after a usage limit, Shift+Enter

- **Auto-continue** (`auto_continue`, off by default): when Claude reports a usage limit ("5-hour limit reached ∙ resets 3pm"), the app types `continue` into the Claude session one minute after the reset, so a long task goes on unattended. It only types where Claude is the foreground program, the limit message is still on screen and it is Claude's own message at the start of a line; never twice for the same message.
- **Switch it at runtime** with the new ⏩ button in the panel header (shows off/on and the planned time) or `auto-continue on|off|status` in the terminal. After a restart the option applies again.
- **Shift+Enter** now inserts a new line in Claude's input instead of sending it (backslash + Enter, which Claude Code understands in any terminal).
- **3.4.1:** a limit message first seen after its reset time (auto-continue switched on late) waited a whole day; a reset time more than 12 hours ahead now counts as just passed, so `continue` follows a minute later. 3.4.0 was only on the test instance and gets no release of its own.
- **Security note:** auto-continue lets Claude go on unattended; with `dangerously_skip_permissions` that includes running commands.

**Upgrade notes:** nothing to do. Auto-continue is off until you turn it on.

Both features come from mattbsea's fork of [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons) (`16847c88`, `533ae0ef`, `5924cd08`, `00e22fc0` for auto-continue, `6e44e41f` for Shift+Enter); his message parser is used as is, the app only counts messages at the start of a line. Thank you! Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
