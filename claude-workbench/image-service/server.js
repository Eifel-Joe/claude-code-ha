#!/usr/bin/env node

/**
 * Claude Workbench - Image Upload Service
 *
 * Lightweight Express server that handles image uploads from browser paste/drag-drop.
 * Designed for resource-constrained environments (Raspberry Pi).
 *
 * Features:
 * - Serves custom HTML interface with embedded ttyd terminal
 * - Handles image uploads via POST /upload
 * - Saves images to /data/images (persistent storage)
 * - Returns file paths for use with Claude CLI
 * - ARM-compatible (no native dependencies)
 */

const express = require('express');
const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.IMAGE_SERVICE_PORT || 7680;
const TTYD_PORT = process.env.TTYD_PORT || 7681;
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/images';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
    console.log(`Created upload directory: ${UPLOAD_DIR}`);
}

// Accepted image types and the extension each is stored under. The extension
// never comes from the client's file name: the stored path is pasted into the
// terminal, and path.extname("x.png;touch $(id) #") is ".png;touch $(id) #"
// (owine/claude-terminal-home-assistant#379; tests/test-image-service.js).
const IMAGE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
};

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // The random part keeps two pastes in the same millisecond apart.
        const suffix = crypto.randomBytes(4).toString('hex');
        cb(null, `pasted-${Date.now()}-${suffix}${IMAGE_EXTENSIONS[file.mimetype]}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max file size
    },
    fileFilter: (req, file, cb) => {
        if (Object.hasOwn(IMAGE_EXTENSIONS, file.mimetype)) {
            cb(null, true);
        } else {
            const err = new Error('Only image files are allowed');
            err.status = 400; // the client sent the wrong type, not a server fault
            cb(err);
        }
    }
});

// API routes MUST come before static files middleware
// Otherwise static middleware will intercept API requests

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uploadDir: UPLOAD_DIR });
});

// Provide ttyd port to frontend
app.get('/config', (req, res) => {
    res.json({
        ttydPort: TTYD_PORT,
        uploadDir: UPLOAD_DIR
    });
});

// Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    console.log(`Image uploaded: ${filePath} (${(req.file.size / 1024).toFixed(2)} KB)`);

    res.json({
        success: true,
        path: filePath,
        filename: req.file.filename,
        size: req.file.size
    });
});

// Shown in the terminal frame while ttyd is not up yet: run.sh serves the panel
// before Claude Code's update and the package installs, and starts ttyd last.
// The page reloads itself until the terminal answers.
const STARTING_PAGE = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="3"><title>Claude Workbench</title>' +
    '<style>body{margin:0;height:100vh;display:flex;align-items:center;' +
    'justify-content:center;background:#1e1e1e;color:#ccc;font-family:sans-serif}</style>' +
    '</head><body><p>Claude Workbench is starting…</p></body></html>';

// Proxy endpoint for ttyd terminal
// This allows ttyd to work through Home Assistant ingress
// Handles both HTTP and WebSocket connections
// Target 127.0.0.1 explicitly rather than "localhost": ttyd binds the loopback
// IPv4 address only, and Node resolves "localhost" verbatim since v17, so a
// container whose /etc/hosts lists ::1 first would get ECONNREFUSED.
const terminalProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${TTYD_PORT}`,
    changeOrigin: true,
    ws: true, // Enable WebSocket proxying
    // Express strips the /terminal mount from req.url for HTTP; WebSocket
    // upgrades come through server.on('upgrade') with the raw path, so the
    // prefix is removed here for those.
    pathRewrite: {
        '^/terminal': ''
    },
    on: {
        error: (err, req, res) => {
            console.error('Proxy error:', err.message);
            // res may be a raw socket (WebSocket) instead of an Express response.
            // Once ttyd's headers are out (connection dropped mid-body) a 502
            // throws ERR_HTTP_HEADERS_SENT in this listener and kills the
            // service; just end the response then.
            // Before ttyd is up, the frame gets STARTING_PAGE instead of an error.
            if (typeof res.status === 'function' && !res.headersSent) {
                res.status(503).set('Retry-After', '3').type('html').send(STARTING_PAGE);
            } else if (typeof res.end === 'function') {
                res.end();
            }
        }
    },
    // Warnings and errors only (logLevel: 'warn' in http-proxy-middleware 2).
    logger: { info: () => {}, warn: console.warn, error: console.error }
});

app.use('/terminal', terminalProxy);

// Serve static files (HTML interface) - MUST be after API routes
app.use(express.static(path.join(__dirname, 'public')));

// Multer error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('Multer error:', err.message);
        return res.status(400).json({
            success: false,
            error: `Upload error: ${err.message}`
        });
    }

    if (err) {
        console.error('Error:', err.message);
        return res.status(err.status || 500).json({
            success: false,
            error: err.message
        });
    }

    next();
});

// Create HTTP server and start listening
const server = http.createServer(app);

// Subscribe to 'upgrade' explicitly so a WebSocket handshake that arrives
// before any HTTP request has passed through the proxy is still forwarded.
// http-proxy-middleware guards this with an internal flag, so this cannot
// double-handle an upgrade it already subscribed to itself.
server.on('upgrade', terminalProxy.upgrade);

// Binds 0.0.0.0 because Home Assistant ingress connects over the internal
// Docker network, not the loopback. No host port is published (see config.yaml).
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Claude Workbench image service running on port ${PORT}`);
    console.log(`Upload directory: ${UPLOAD_DIR}`);
    console.log(`ttyd terminal on port: ${TTYD_PORT}`);
    console.log(`Terminal proxy available at /terminal/`);
});
