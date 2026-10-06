'use strict';
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Minimal Supervisor API client. Responses are {result: "ok", data: {...}};
// anything else throws with the HTTP status and Supervisor's message.
function createClient({
  baseUrl = process.env.SUPERVISOR_API || 'http://supervisor',
  token = process.env.SUPERVISOR_TOKEN || '',
} = {}) {
  const auth = { Authorization: `Bearer ${token}` };

  async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body ? { ...auth, 'Content-Type': 'application/json' } : auth,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result !== 'ok') {
      throw new Error(`${method} ${path} -> ${res.status} ${json.message || ''}`.trim());
    }
    return json.data || {};
  }

  // Streams to disk: a backup can be hundreds of MB.
  async function download(path, dest) {
    const res = await fetch(baseUrl + path, { headers: auth });
    if (!res.ok || !res.body) throw new Error(`GET ${path} -> ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body || {}),
    download,
  };
}

module.exports = { createClient };
