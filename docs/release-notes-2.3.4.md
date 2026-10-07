## HA CLI and GitHub CLI lookups no longer hit GitHub's API limit

The image build and `persist-install --ha-cli` asked GitHub's REST API for the latest release. Without a token it allows 60 requests per hour per IP, and builds could fail with 403. The version now comes from where `github.com/<repo>/releases/latest` redirects to, which has no such limit. If that lookup fails, nothing is downloaded and an existing copy stays.

## Mac clipboard monitor removed

`mac-clipboard-monitor.py` could not reach the app since 2.1.0 (it uploaded to Home Assistant itself or to the closed direct port). Paste or drop an image into the terminal instead.

## Cleanup
- Migration tests remove their temporary directories.
- `DEVELOPMENT.md` no longer suggests `sudo kill -9` for a busy port.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
