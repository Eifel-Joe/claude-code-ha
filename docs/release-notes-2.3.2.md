## `persist-install --ha-cli` now installs and reports the current HA CLI

**Since 2.3.1:** `persist-install --ha-cli --force` installed version 4.46.0, a pin left over from 32-bit builds, on every architecture. That copy sits in `/data/packages/bin`, ahead of the image's newer `ha` in PATH, so it silently downgraded the CLI. It now installs the latest release, stops with an error if the version lookup fails, and `--force` replaces an existing copy instead of keeping it.

**New in 2.3.2:** the `ha` CLI has no `--version` flag, so the install and the "already installed" message printed `Error: unknown flag: --version` and the usage text. The install now records the version it downloaded and shows it; a copy installed before 2.3.1 is reported as `unknown (installed before 2.3.1)`.

If you used `--force` before, run `persist-install --ha-cli --force` again, or remove the copy with `rm /data/packages/bin/ha` to use the one shipped in the image.

## Cleanup (2.3.1)
- Remaining 32-bit code paths and an unused HA CLI installer script removed.
- CI moved to current GitHub Actions releases; tests run on Node 22 like the image.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
