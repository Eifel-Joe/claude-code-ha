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

  // Network-level failures surface as a bare "TypeError: fetch failed";
  // name the request and the underlying cause instead.
  async function send(method, urlPath, init) {
    try {
      return await fetch(baseUrl + urlPath, { method, ...init });
    } catch (e) {
      throw new Error(`${method} ${urlPath} -> ${e.cause?.code || e.cause?.message || e.message}`);
    }
  }

  async function call(method, urlPath, body) {
    const res = await send(method, urlPath, {
      headers: body ? { ...auth, 'Content-Type': 'application/json' } : auth,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result !== 'ok') {
      throw new Error(`${method} ${urlPath} -> ${res.status} ${json.message || ''}`.trim());
    }
    return json.data || {};
  }

  // Streams to disk: a backup can be hundreds of MB.
  async function download(urlPath, dest) {
    const res = await send('GET', urlPath, { headers: auth });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(`GET ${urlPath} -> ${res.status} ${j.message || ''}`.trim());
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }

  return {
    get: (urlPath) => call('GET', urlPath),
    post: (urlPath, body) => call('POST', urlPath, body || {}),
    download,
  };
}

module.exports = { createClient };
