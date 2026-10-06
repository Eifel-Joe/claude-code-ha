## Click a wrapped link to open all of it

Claude Code and tmux break a long URL, such as the login link from `/login`, across several rows. The terminal's built-in link detection only joins rows it wrapped itself, so clicking the first row opened a cut-off URL and the other rows did nothing.

Every row of such a link is now clickable and opens the full URL in a new tab, rebuilt the same way **🔗 Copy link** rebuilds it. With several similar links on screen (for example after running `/login` twice), the click opens the one you clicked.

Not covered: clicks with `tmux_mouse` enabled (they go to tmux) and tapping on a phone. Use **🔗 Copy link** there.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
