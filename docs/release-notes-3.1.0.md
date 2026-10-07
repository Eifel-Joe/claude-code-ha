## Every option explained, no more log warnings

### Options with explanations
The Configuration tab now shows a name and a short explanation for every option — in English and German — instead of bare names like `tmux_mouse`.

### Cleaner logs
- The app log no longer shows `DEP0060 util._extend`: the terminal proxy moved from `http-proxy-middleware` 2 (with the unmaintained `http-proxy`) to version 4.
- The Supervisor log no longer warns about the deprecated `config` map option. The Home Assistant configuration stays at `/config`.

### Fix
- If the terminal dropped a connection mid-response, the image service crashed and the panel stayed blank until the app was restarted. Now only that one response is closed.

Just update — no other changes.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
