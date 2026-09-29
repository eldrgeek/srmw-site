'use strict';

/* soma-feedback.js — same-origin proxy for the soma-feedback chip.
 *
 * WHY THIS EXISTS
 *   The canonical chip is documented as same-origin-safe. It was not. Until
 *   2026-08-10 the standard embed loaded soma-feedback.js/.css cross-origin
 *   from the shared feedback service host and, on most sites, POSTed
 *   submissions to that same host. That made one host a single point of
 *   failure for every feedback chip in the estate: on 2026-07-22 its TLS
 *   certificate expired and every chip on every site went dark at the same
 *   moment, silently. Nothing reported it, because the asset checker only
 *   probed SAME-origin assets and nothing at all probed the submission
 *   endpoint.
 *
 *   The fix is boring and structural: each site serves its own copy of the
 *   chip assets and routes submissions through this function. A dead shared
 *   host now degrades ONE feature on ONE site — the chip still renders, the
 *   panel still opens, and the submit returns a real 502 the visitor can see
 *   and the ship-check can detect — instead of removing the chip everywhere
 *   at once with no signal.
 *
 *   Pattern first shipped on soma-explainer (2026-08-10) and generalised here.
 *
 * INSTALL
 *   See ../../README.md. Short version: copy this file to your site's
 *   netlify/functions/, copy vendor/soma-feedback/* into your publish dir,
 *   point the chip's data-endpoint at /.netlify/functions/soma-feedback, and
 *   set SOMA_FEEDBACK_ENDPOINT in Netlify env.
 *
 * ENV
 *   SOMA_FEEDBACK_ENDPOINT          required. Absolute URL of the upstream
 *                                   feedback service (the shared service, or
 *                                   any endpoint speaking the same JSON).
 *   SOMA_FEEDBACK_HEALTH_VERBOSE    optional. "1" to include the upstream
 *                                   hostname in the health response. Off by
 *                                   default so unlisted sites don't publish
 *                                   their infrastructure addresses.
 *
 * ROUTES
 *   POST  /.netlify/functions/soma-feedback         proxy a chip submission
 *   GET   /.netlify/functions/soma-feedback?health=1
 *         Non-mutating liveness probe. POSTs an empty object upstream, which
 *         every conforming backend rejects with 400 "text is required"
 *         WITHOUT writing a row, and reports whether a real HTTP response
 *         came back. This is what soma-chip-check.py reads.
 *         200 {"ok":true,...}  upstream answered
 *         503 {"ok":false,...} upstream unreachable / not configured
 */

const https = require('https');
const http = require('http');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const TIMEOUT_MS = 20000;

function forward(endpoint, body, extraHeaders) {
  return new Promise(function (resolve) {
    let u;
    try {
      u = new URL(endpoint);
    } catch (e) {
      return resolve({ status: 0, body: '', error: 'SOMA_FEEDBACK_ENDPOINT is not a valid URL' });
    }
    const lib = u.protocol === 'http:' ? http : https;
    const headers = Object.assign(
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      extraHeaders || {}
    );
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: headers,
        timeout: TIMEOUT_MS,
      },
      function (res) {
        let out = '';
        res.on('data', function (c) { out += c; });
        res.on('end', function () {
          resolve({ status: res.statusCode || 502, body: out, error: null });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('upstream timed out after ' + TIMEOUT_MS + 'ms')); });
    req.on('error', function (e) { resolve({ status: 0, body: '', error: String((e && e.message) || e) }); });
    req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  const method = (event && event.httpMethod) || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const endpoint = process.env.SOMA_FEEDBACK_ENDPOINT;
  const qs = (event && event.queryStringParameters) || {};
  const verbose = process.env.SOMA_FEEDBACK_HEALTH_VERBOSE === '1';

  // ---- health probe -------------------------------------------------------
  if (method === 'GET' || qs.health === '1') {
    if (!endpoint) {
      return {
        statusCode: 503,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          configured: false,
          error: 'SOMA_FEEDBACK_ENDPOINT is not set on this deploy',
        }),
      };
    }
    const r = await forward(endpoint, '{}', {});
    const reachable = r.status > 0;
    const ok = reachable && r.status < 500;
    const payload = {
      ok: ok,
      configured: true,
      upstream_reachable: reachable,
      upstream_status: reachable ? r.status : null,
      error: r.error,
    };
    if (verbose) {
      try { payload.upstream_host = new URL(endpoint).host; } catch (e) { /* ignore */ }
    }
    return { statusCode: ok ? 200 : 503, headers: CORS, body: JSON.stringify(payload) };
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };
  }

  if (!endpoint) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ error: 'Feedback endpoint is not configured on this deploy.' }),
    };
  }

  // Pass the chip's optional bearer through — some backends resolve admin
  // identity from it (see playmaker submit-feedback-widget.ts).
  const inbound = (event && event.headers) || {};
  const auth = inbound.authorization || inbound.Authorization;
  const extra = auth ? { Authorization: auth } : {};

  const r = await forward(endpoint, event.body || '{}', extra);
  if (r.status === 0) {
    // Loud, local, one-site failure — this is the whole point of the proxy.
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Feedback service unreachable: ' + (r.error || 'unknown') }),
    };
  }
  return { statusCode: r.status, headers: CORS, body: r.body || '{}' };
};
