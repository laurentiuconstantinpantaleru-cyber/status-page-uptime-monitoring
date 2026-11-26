import type { Clock } from '../shared/clock.js';

/** Used when a monitor sets no timeout: free Render apps can take this long to wake (D-022). */
export const DEFAULT_TIMEOUT_MS = 30_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stored in `checks.error_cause`. */
export type ErrorCause =
  | 'timeout'
  | 'http_5xx'
  | 'unexpected_status'
  | 'keyword_missing'
  | 'dns'
  | 'tls'
  | 'connection'
  | 'unknown';

/** The fields of a `monitors` row a check needs. */
export interface CheckConfig {
  url: string;
  expectedStatus: number;
  timeoutMs?: number;
  keyword: string | null;
  checkTls: boolean;
  latencyThresholdMs: number | null;
}

export interface HttpRequest {
  url: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  /** The server certificate's `validTo`, when the connection was TLS. */
  tlsExpiresAt?: Date;
}

/** Performs the request; rejects with the underlying error (its Node `code` or `name` is kept). */
export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** One check, in the shape of a `checks` row. */
export interface CheckResult {
  outcome: 'up' | 'down';
  httpStatus: number | null;
  latencyMs: number | null;
  errorCause: ErrorCause | null;
  /** Above the monitor's latency threshold; the check still counts as up. */
  slow: boolean;
  tlsExpiresAt: Date | null;
  tlsDaysRemaining: number | null;
}

/** Judges a response that arrived: status, then keyword, then latency and certificate. */
export function evaluateResponse(
  config: CheckConfig,
  response: HttpResponse,
  latencyMs: number,
  now: Date,
): CheckResult {
  const tlsExpiresAt = config.checkTls ? (response.tlsExpiresAt ?? null) : null;
  const result: CheckResult = {
    outcome: 'up',
    httpStatus: response.status,
    latencyMs,
    errorCause: null,
    slow: config.latencyThresholdMs !== null && latencyMs > config.latencyThresholdMs,
    tlsExpiresAt,
    tlsDaysRemaining:
      tlsExpiresAt === null ? null : Math.floor((tlsExpiresAt.getTime() - now.getTime()) / DAY_MS),
  };

  if (response.status !== config.expectedStatus) {
    const errorCause = response.status >= 500 && response.status <= 599 ? 'http_5xx' : 'unexpected_status';
    return { ...result, outcome: 'down', errorCause };
  }
  if (config.keyword !== null && !response.body.includes(config.keyword)) {
    return { ...result, outcome: 'down', errorCause: 'keyword_missing' };
  }
  return result;
}

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

/** Maps a request error to its cause from the Node error `name` and `code`. */
export function classifyError(error: unknown): ErrorCause {
  const name = error instanceof Error ? error.name : undefined;
  const code = (error as { code?: unknown } | null)?.code;

  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (typeof code !== 'string') return 'unknown';
  if (TIMEOUT_CODES.has(code)) return 'timeout';
  if (DNS_CODES.has(code)) return 'dns';
  if (CONNECTION_CODES.has(code)) return 'connection';
  if (TLS_CODES.has(code) || code.startsWith('CERT_') || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) {
    return 'tls';
  }
  return 'unknown';
}

/** Runs one check through the injected client, timing it with the injected clock. */
export async function runCheck(
  config: CheckConfig,
  deps: { client: HttpClient; clock: Clock },
): Promise<CheckResult> {
  const startedAt = deps.clock.now();
  let response: HttpResponse;
  try {
    response = await deps.client.request({ url: config.url, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  } catch (error) {
    return {
      outcome: 'down',
      httpStatus: null,
      latencyMs: null,
      errorCause: classifyError(error),
      slow: false,
      tlsExpiresAt: null,
      tlsDaysRemaining: null,
    };
  }
  const finishedAt = deps.clock.now();
  return evaluateResponse(config, response, finishedAt.getTime() - startedAt.getTime(), finishedAt);
}
