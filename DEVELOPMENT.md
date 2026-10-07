# Development Guide

This guide covers local development and testing workflows for the Claude Terminal add-on.

## Local Container Testing

### Prerequisites

- **Podman** (or Docker) installed
- **Git** repository cloned locally
- **NixOS development environment** (optional, for `nix develop`)

### Quick Start Testing

The fastest way to test changes without publishing new versions:

```bash
# 1. Build test container
podman build -t local/claude-terminal:test ./claude-terminal

# 2. Create test directories. /config is Home Assistant's configuration,
#    /data is the app's private storage (credentials in /data/home/.claude).
# App options: bashio reads them from the Supervisor API, not from a file, so a
# local run without the Supervisor uses the defaults in run.sh (auto-launch on).
mkdir -p /tmp/test-config /tmp/test-data

# 3. Run test container
# Publish 7680 (the image service / ingress entry point), not 7681.
# ttyd binds 127.0.0.1 inside the container and is reached through the
# image service's /terminal proxy, so -p 7681:7681 would connect to nothing.
podman run -d --name test-claude-dev \
  -p 7680:7680 \
  -v /tmp/test-config:/config \
  -v /tmp/test-data:/data \
  local/claude-terminal:test

# 4. Check startup logs
podman logs test-claude-dev

# 5. Test in browser: http://localhost:7680

# 6. Clean up when done
podman stop test-claude-dev && podman rm test-claude-dev
```

### Development Workflow

#### 1. Iterative Development

```bash
# Make changes to code
vim claude-terminal/scripts/claude-session-picker.sh

# Rebuild image
podman build -t local/claude-terminal:test ./claude-terminal

# Stop old container
podman stop test-claude-dev && podman rm test-claude-dev

# Start new container with changes
podman run -d --name test-claude-dev -p 7680:7680 \
  -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test

# Test changes
open http://localhost:7680
```

#### 2. Hot-reload Script Testing

For script changes without full rebuilds:

```bash
# Copy updated script to running container
podman cp ./claude-terminal/scripts/claude-session-picker.sh \
  test-claude-dev:/opt/scripts/claude-session-picker.sh

# Make executable
podman exec test-claude-dev chmod +x /opt/scripts/claude-session-picker.sh

# Test directly
podman exec -it test-claude-dev /opt/scripts/claude-session-picker.sh
```

### Testing Scenarios

#### Session Picker Testing

```bash
# App options: bashio reads them from the Supervisor API, not from a file, so a
# local run without the Supervisor uses the defaults in run.sh (auto-launch on).
# Run the picker directly instead of switching auto_launch_claude off:
podman exec -it test-claude-dev /opt/scripts/claude-session-picker.sh
```

#### Authentication Testing

```bash
# Start with clean credentials
rm -rf /tmp/test-data/home/.claude

# Pre-populate credentials for testing
mkdir -p /tmp/test-data/home/.claude
cp ~/.claude/.credentials.json /tmp/test-data/home/.claude/
```

#### Multi-session Testing

```bash
# Run multiple containers on different ports
podman run -d --name test-claude-dev-8680 -p 8680:7680 -v /tmp/test-config-2:/config -v /tmp/test-data-2:/data local/claude-terminal:test
podman run -d --name test-claude-dev-9680 -p 9680:7680 -v /tmp/test-config-3:/config -v /tmp/test-data-3:/data local/claude-terminal:test
```

### Debugging Techniques

#### Container Inspection

```bash
# Follow logs in real-time
podman logs -f test-claude-dev

# Execute shell inside container
podman exec -it test-claude-dev /bin/bash

# Check running processes
podman exec test-claude-dev ps aux

# Inspect environment variables
podman exec test-claude-dev env | grep CLAUDE
```

#### Script Debugging

```bash
# Test session picker with debug output
podman exec -it test-claude-dev bash -x /opt/scripts/claude-session-picker.sh

# Test startup script components
podman exec test-claude-dev /usr/local/bin/claude-session-picker

# Check file permissions and locations
podman exec test-claude-dev ls -la /opt/scripts/
podman exec test-claude-dev ls -la /data/home/.claude/
```

#### Network Testing

```bash
# Test web endpoint and the service health probe used at startup
curl -I http://localhost:7680
curl -fsS http://localhost:7680/health

# Test the proxied WebSocket connection (ttyd is not exposed directly)
curl --include --no-buffer \
  --header "Connection: Upgrade" \
  --header "Upgrade: websocket" \
  --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  --header "Sec-WebSocket-Version: 13" \
  http://localhost:7680/terminal/ws
```

### Performance Testing

#### Resource Usage

```bash
# Monitor container resources
podman stats test-claude-dev

# Check container size
podman images local/claude-terminal:test

# Inspect layers
podman history local/claude-terminal:test
```

#### Load Testing

```bash
# Multiple concurrent connections
for i in {1..5}; do
  curl http://localhost:7680 &
done
wait
```

### Common Issues & Solutions

#### Port Already In Use
```bash
# Map the container's 7680 to a free host port instead
podman run -d --name test-claude-dev -p 7682:7680 -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test
```

#### Volume Mount Issues
```bash
# Ensure directory exists and has correct permissions
mkdir -p /tmp/test-config /tmp/test-data
chmod 755 /tmp/test-config /tmp/test-data

# Check SELinux labels (if applicable)
ls -laZ /tmp/test-config/ /tmp/test-data/
```

#### Build Cache Issues
```bash
# Force rebuild without cache
podman build --no-cache -t local/claude-terminal:test ./claude-terminal

# Clean up unused images
podman image prune
```

### Cleanup Commands

#### Clean Up Test Environment
```bash
# Stop and remove test containers
podman stop test-claude-dev && podman rm test-claude-dev

# Remove test configurations
rm -rf /tmp/test-config* /tmp/test-data*

# Clean up test images
podman rmi local/claude-terminal:test
```

#### Full System Cleanup
```bash
# Remove all stopped containers
podman container prune

# Remove unused images
podman image prune

# Remove unused volumes
podman volume prune
```

## Production Deployment

Once testing is complete:

```bash
# Bump the version in claude-terminal/config.yaml and add a matching section
# at the top of claude-terminal/CHANGELOG.md; tests/test-release-metadata.sh
# fails the build if they disagree.
./tests/run-tests.sh

# Stage deliberately and commit on a branch, then open a pull request.
git status
git add <changed files>
git commit
```

Home Assistant rebuilds the app on each device once `version` in `config.yaml` changes.

## Advanced Testing

### Integration with Home Assistant

```bash
# Test with real Home Assistant config structure
mkdir -p /tmp/ha-config/.storage /tmp/ha-data

podman run -d --name test-ha-claude -p 7680:7680 \
  -v /tmp/ha-config:/config -v /tmp/ha-data:/data local/claude-terminal:test
```

### Cross-Platform Testing

```bash
# The base image is multi-arch (amd64, arm64). Home Assistant Supervisor always
# passes BUILD_ARCH; reproduce that locally so the Dockerfile resolves the right
# architecture, and add --platform so the emulated toolchain matches.
podman build --platform linux/arm64 \
  --build-arg BUILD_ARCH=aarch64 \
  -t local/claude-terminal:arm64 ./claude-terminal
```
