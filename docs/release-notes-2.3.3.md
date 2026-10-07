This release collects 2.3.1 to 2.3.3, which were not published separately.

## `persist-install --ha-cli` installs, reports and flags the HA CLI correctly

- **Old version installed:** `persist-install --ha-cli --force` installed version 4.46.0, a pin left over from 32-bit builds, on every architecture. That copy sits in `/data/packages/bin`, ahead of the image's newer `ha` in PATH, so it silently downgraded the CLI. It now installs the latest release, stops with an error if the version lookup fails, and `--force` replaces an existing copy instead of keeping it.
- **Error instead of a version:** the `ha` CLI has no `--version` flag, so the install printed `Error: unknown flag: --version` and the usage text. The install now records the version it downloaded and shows it.
- **"Nothing to do" over an active old copy:** without `--force`, the command said "Nothing to do" because the image ships `ha`, even when a copy in `/data/packages/bin` takes priority. It now names that copy with its version and shows both ways out.

If you used `--force` before, run `persist-install --ha-cli` to see whether an old copy is active, then either `persist-install --ha-cli --force` for the latest release or remove the copy to use the image's CLI.

## Cleanup
- Remaining 32-bit code paths and an unused HA CLI installer script removed.
- CI moved to current GitHub Actions releases; tests run on Node 22 like the image.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
