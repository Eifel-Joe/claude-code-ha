## `persist-install --ha-cli --force` installed an old HA CLI

It always installed version 4.46.0, a pin left over from 32-bit builds. That copy sits in `/data/packages/bin`, ahead of the image's newer `ha` in PATH, so it silently downgraded the CLI. It now installs the latest release and stops with an error if the version lookup fails, and `--force` replaces an existing copy instead of keeping it. If you used `--force` before, run `persist-install --ha-cli --force` again, or remove the copy with `rm /data/packages/bin/ha` to use the one shipped in the image.

## Cleanup
- Remaining 32-bit code paths and an unused HA CLI installer script removed.
- CI moved to current GitHub Actions releases; tests run on Node 22 like the image.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
