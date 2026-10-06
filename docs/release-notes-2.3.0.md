## Build parameters moved into the Dockerfile

The Supervisor warned on every install and update that `build.yaml` is deprecated. The Dockerfile now names the base image (`ghcr.io/home-assistant/base:3.21`) and the labels itself, and `build.yaml` is gone. Nothing changes in how the app runs.

## armv7 is no longer built

Home Assistant ended support for 32-bit systems with 2025.12, and the Supervisor there no longer offers app updates. 2.2.2 stays the last release for armv7; existing installations keep running on it.

## Documentation
- The development guide builds without a base-image argument and keeps test options and credentials under `/data`.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
