# Claude Terminal Pro for Home Assistant

An enhanced, web-based terminal with Claude Code CLI and persistent package management for Home Assistant.

![Claude Terminal Screenshot](screenshot.png)

*Claude Terminal Pro running in Home Assistant*

> **Fork Attribution:** Maintained by [@Eifel-Joe](https://github.com/Eifel-Joe) as a fork of [ESJavadex/claude-code-ha](https://github.com/ESJavadex/claude-code-ha) by Javier Santos, which builds on [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons) by Tom Cassady.

## What is Claude Terminal Pro?

This app provides a web-based terminal interface with Claude Code CLI pre-installed plus persistent package management, allowing you to use Claude's powerful AI capabilities directly from your Home Assistant dashboard. It gives you direct access to Anthropic's Claude AI assistant through a terminal, ideal for:

- Writing and editing code
- Debugging problems
- Learning new programming concepts
- Creating Home Assistant scripts and automations

## Features

### Core Features
- **Web Terminal Interface**: Access Claude through a browser-based terminal using ttyd
- **Auto-Launch**: Claude starts automatically when you open the terminal
- **Claude Code CLI**: Latest native release on amd64/aarch64; ARMv7 uses the final portable JavaScript release (`1.0.128`) because current native releases do not publish ARM32 binaries
- **No Configuration Needed**: Uses OAuth authentication for easy setup
- **Direct Config Access**: Terminal starts in your `/config` directory for immediate access to all Home Assistant files
- **Home Assistant Integration**: Access directly from your dashboard
- **Panel Icon**: Quick access from the sidebar with the code-braces-box icon
- **Multi-Architecture Support**: Works on amd64, aarch64, and armv7 platforms
- **Secure Credential Management**: Persistent authentication with safe credential storage
- **Automatic Recovery**: Built-in fallbacks and error handling for reliable operation

### Enhanced Features (Pro)
- **Persistent Package Management**: Install APK and pip packages that survive container restarts
- **Auto-Install Configuration**: Configure packages to install automatically on startup
- **Python Virtual Environment**: Isolated Python environment in `/data/packages`
- **Simple Commands**: Use `persist-install` for easy package management
- **Persistent Storage**: All packages stored in `/data` which survives all reboots
- **Optional Persistent Claude Override**: Advanced users can opt into a Claude Code install stored in `/data/npm`

## Quick Start

The terminal automatically starts Claude when you open it. You can immediately start using commands like:

```bash
# Ask Claude a question directly
claude "How can I write a Python script to control my lights?"

# Start an interactive session
claude -i

# Get help with available commands
claude --help

# Debug authentication if needed
claude-auth debug

# Log out and re-authenticate
claude-logout
```

## Installation

1. Add this repository to your Home Assistant app store:
   - Go to Settings → Apps → App Store
   - Click the menu (⋮) and select Repositories
   - Add: `https://github.com/Eifel-Joe/claude-code-ha`
2. Install the Claude Terminal Pro app
3. Start the app
4. Click "OPEN WEB UI" or the sidebar icon to access
5. On first use, follow the OAuth prompts to log in to your Anthropic account

## Configuration

The app works out of the box, but also supports a few optional advanced settings:

- **Access**: through the Home Assistant sidebar panel (ingress) only. The app
  publishes no host port: `ttyd` runs writable with no credentials, so exposing it
  on the LAN meant an unauthenticated root shell. See CHANGELOG 2.1.0.
- **Authentication**: OAuth with Anthropic (credentials kept in the app's private `/data`, under `/data/home/.claude`, not in `/config`)
- **Terminal**: Full bash environment with Claude Code CLI pre-installed
- **Persistent Claude override**: Optional `use_persistent_claude` / `auto_update_claude_on_start`
- **Volumes**: Access to both `/config` (Home Assistant) and `/addons` (for development)

## Troubleshooting

### Authentication Issues
If you have authentication problems:
```bash
claude-auth debug    # Show credential status
claude-logout        # Clear credentials and re-authenticate
```

### Container Issues
- Credentials are automatically saved and restored between restarts
- Check app logs if the terminal doesn't load
- Restart the app if Claude commands aren't recognized

### Development
For local development and testing:
```bash
# Enter development environment
nix develop

# Build and test locally
build-addon
run-addon

# Lint and validate
lint-dockerfile
test-endpoint
```

## Architecture

- **Base Image**: Home Assistant Alpine Linux base (3.21)
- **Container Runtime**: Compatible with Docker/Podman
- **Web Terminal**: ttyd for browser-based access
- **Process Management**: s6-overlay for reliable service startup
- **Networking**: Ingress support with Home Assistant reverse proxy

## Security

Version 1.0.2 includes important security improvements:
- ✅ **Secure Credential Management**: Limited filesystem access to safe directories only
- ✅ **Safe Cleanup Operations**: No more dangerous system-wide file deletions
- ✅ **Proper Permission Handling**: Consistent file permissions (600) for credentials
- ✅ **Input Validation**: Enhanced error checking and bounds validation

## Development Environment

This app includes a comprehensive development setup using Nix:

```bash
# Available development commands
build-addon      # Build the app container with Podman
run-addon        # Run app locally on port 7680
lint-dockerfile  # Lint Dockerfile with hadolint
test-endpoint    # Test web endpoint availability
```

**Requirements for development:**
- NixOS or Nix package manager
- Podman (automatically provided in dev shell)
- Optional: direnv for automatic environment activation

## Documentation

For detailed usage instructions, see the [documentation](DOCS.md).

## Version History

### v1.0.2 (Current) - Security & Bug Fix Release
- 🔒 **CRITICAL**: Fixed dangerous filesystem operations
- 🐛 Added missing armv7 architecture support
- 🔧 Pinned NPM packages and improved error handling
- 🛠️ Enhanced development environment with Podman support

### v1.0.1
- Improved credential management
- Enhanced startup reliability

### v1.0.0
- Initial stable release
- Web terminal interface with ttyd
- Pre-installed Claude Code CLI
- OAuth authentication support

## Useful Links

- [Claude Code Documentation](https://docs.anthropic.com/claude/docs/claude-code)
- [Get an Anthropic API Key](https://console.anthropic.com/)
- [Claude Code GitHub Repository](https://github.com/anthropics/claude-code)
- [Home Assistant Apps](https://www.home-assistant.io/addons/)

## Credits

**Fork Maintainer:** [@Eifel-Joe](https://github.com/Eifel-Joe) - Maintains this fork and collects community fork fixes
**Upstream:** Javier Santos ([@ESJavadex](https://github.com/ESJavadex)) - Created Claude Terminal Pro: persistent package management and enhancements
**Original Creator:** Tom Cassady ([@heytcass](https://github.com/heytcass)) - Created the initial Claude Terminal app

This app was created and enhanced with the assistance of Claude Code itself! The development process, debugging, and documentation were all completed using Claude's AI capabilities - a perfect demonstration of what this app can help you accomplish.

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.
