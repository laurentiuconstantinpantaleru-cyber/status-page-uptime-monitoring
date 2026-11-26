import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { HttpClient, HttpResponse } from './check.js';

/** Sent with every check (D-026). */
export const USER_AGENT = 'CampusUptime/0.1';

/** Redirects followed before the check fails (D-026). */
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface Hop {
  response: HttpResponse;
  location: string | undefined;
}

/** One GET without following redirects; rejects with the original Node error, or the signal's reason. */
function get(url: URL, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    // agent: false gives each check its own socket, so the peer certificate is always there.
    const req = transport.request(url, { method: 'GET', agent: false, headers: { 'user-agent': USER_AGENT } });
    const onAbort = () => {
      req.destroy();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const done = () => signal.removeEventListener('abort', onAbort);

    req.on('error', (error) => {
      done();
      reject(error);
    });
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const location = REDIRECT_STATUSES.has(status) ? res.headers.location : undefined;
      const socket = res.socket as TLSSocket;
      const validTo = typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate().valid_to : undefined;
      const tlsExpiresAt = validTo ? new Date(validTo) : undefined;

      if (location !== undefined) {
        res.resume();
        res.on('end', () => {
          done();
          resolve({ response: { status, body: '' }, location });
        });
      } else {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          done();
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ response: tlsExpiresAt ? { status, body, tlsExpiresAt } : { status, body }, location });
        });
      }
      res.on('error', (error) => {
        done();
        reject(error);
      });
    });
    req.end();
  });
}

/**
 * The real client: GET with redirects followed up to MAX_REDIRECTS, the whole body read as UTF-8,
 * the certificate expiry of the last hop, and one timeout over all of it (D-022, D-026).
 */
export const nodeHttpClient: HttpClient = {
  async request({ url, timeoutMs }) {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = new URL(url);
    for (let hop = 0; ; hop++) {
      const { response, location } = await get(current, signal);
      if (location === undefined) return response;
      if (hop === MAX_REDIRECTS) {
        throw Object.assign(new Error(`More than ${MAX_REDIRECTS} redirects from ${url}`), {
          code: 'ERR_TOO_MANY_REDIRECTS',
        });
      }
      current = new URL(location, current);
    }
  },
};
