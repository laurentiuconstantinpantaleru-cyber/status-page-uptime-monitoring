import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyError } from '../../src/worker/check.js';
import { MAX_REDIRECTS, USER_AGENT, nodeHttpClient } from '../../src/worker/http-client.js';

const TIMEOUT_MS = 5_000;
const BIG_BODY = 'x'.repeat(2 * 1024 * 1024) + 'END-MARKER';

let server: Server;
let base: string;
let received: IncomingMessage[] = [];

/** Routes: /ok, /big, /status/503, /hops/<n> (redirects n more times, relatively, then 200). */
beforeAll(async () => {
  server = createServer((req, res) => {
    received.push(req);
    const url = req.url ?? '/';
    const hops = /^\/hops\/(\d+)$/.exec(url);
    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
    } else if (url === '/big') {
      res.writeHead(200).end(BIG_BODY);
    } else if (url === '/status/503') {
      res.writeHead(503).end('Service Unavailable');
    } else if (hops) {
      const left = Number(hops[1]);
      if (left === 0) res.writeHead(200).end('arrived');
      else res.writeHead(left % 2 === 0 ? 301 : 302, { location: `${left - 1}` }).end();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The cause runCheck would record for a request that rejects. */
async function causeOf(url: string): Promise<string> {
  try {
    await nodeHttpClient.request({ url, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return classifyError(error);
  }
  throw new Error(`expected ${url} to fail`);
}

describe('nodeHttpClient', () => {
  it('returns the status code and the body', async () => {
    const response = await nodeHttpClient.request({ url: `${base}/ok`, timeoutMs: TIMEOUT_MS });

    expect(response.status).toBe(200);
    expect(response.body).toBe('ok');
  });

  it('reads the whole body, with no size limit', async () => {
    const response = await nodeHttpClient.request({ url: `${base}/big`, timeoutMs: TIMEOUT_MS });

    expect(response.body.length).toBe(BIG_BODY.length);
    expect(response.body.endsWith('END-MARKER')).toBe(true);
  });

  it('sends a GET with the CampusUptime user agent', async () => {
    received = [];

    await nodeHttpClient.request({ url: `${base}/ok`, timeoutMs: TIMEOUT_MS });

    expect(USER_AGENT).toBe('CampusUptime/0.1');
    expect(received[0]?.method).toBe('GET');
    expect(received[0]?.headers['user-agent']).toBe('CampusUptime/0.1');
  });

  it('follows up to 5 redirects, relative ones included, and answers with the last hop', async () => {
    received = [];

    const response = await nodeHttpClient.request({ url: `${base}/hops/${MAX_REDIRECTS}`, timeoutMs: TIMEOUT_MS });

    expect(MAX_REDIRECTS).toBe(5);
    expect(response).toMatchObject({ status: 200, body: 'arrived' });
    expect(received).toHaveLength(6);
  });

  it('fails after more than 5 redirects, as unknown', async () => {
    const url = `${base}/hops/${MAX_REDIRECTS + 1}`;

    await expect(nodeHttpClient.request({ url, timeoutMs: TIMEOUT_MS })).rejects.toMatchObject({
      code: 'ERR_TOO_MANY_REDIRECTS',
    });
    expect(await causeOf(url)).toBe('unknown');
  });

  it('returns an error status as it came', async () => {
    const response = await nodeHttpClient.request({ url: `${base}/status/503`, timeoutMs: TIMEOUT_MS });

    expect(response).toMatchObject({ status: 503, body: 'Service Unavailable' });
  });

  it('has no certificate expiry over plain http', async () => {
    const response = await nodeHttpClient.request({ url: `${base}/ok`, timeoutMs: TIMEOUT_MS });

    expect(response.tlsExpiresAt).toBeUndefined();
  });

  it('rejects with a connection cause when the port is closed', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    expect(await causeOf(`http://127.0.0.1:${port}/`)).toBe('connection');
  });

  it('rejects with a dns cause when the host does not resolve', async () => {
    expect(await causeOf('http://nope.invalid/')).toBe('dns');
  });
});
