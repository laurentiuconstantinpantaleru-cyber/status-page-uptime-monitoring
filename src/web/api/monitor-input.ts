import { DEFAULT_TIMEOUT_MS } from '../../worker/check.js';

// The body of `POST /api/v1/monitors` (Q-018). Absent or null optional fields take their
// defaults: interval 5 minutes (D-016), expected status 200, timeout 30 000 ms (D-022).

export interface NewMonitor {
  name: string;
  url: string;
  intervalMinutes: number;
  expectedStatus: number;
  timeoutMs: number;
  keyword: string | null;
  /** Derived from the url: an https:// target has a certificate to check. */
  checkTls: boolean;
  latencyThresholdMs: number | null;
}

export type ParsedMonitor = { ok: true; monitor: NewMonitor } | { ok: false; errors: Record<string, string> };

const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_EXPECTED_STATUS = 200;

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const unset = (value: unknown) => value === undefined || value === null;

export function parseNewMonitor(body: unknown): ParsedMonitor {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, errors: { body: 'Send a JSON object.' } };
  }
  const b = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  let name = '';
  if (unset(b.name)) errors.name = 'Give a name.';
  else if (typeof b.name !== 'string') errors.name = 'Give the name as text.';
  else {
    name = b.name.trim();
    if (!name) errors.name = 'Give a name.';
    else if (name.length > 255) errors.name = 'Keep the name to 255 characters.';
  }

  let url = '';
  if (unset(b.url) || b.url === '') errors.url = 'Give a url.';
  else if (typeof b.url !== 'string' || !isHttpUrl(b.url)) errors.url = 'Give a url that starts with http:// or https://.';
  else if (b.url.length > 2048) errors.url = 'Keep the url to 2048 characters.';
  else url = b.url;

  const whole = (field: string, min: number, max: number, fallback: number, message: string) => {
    const value = b[field];
    if (unset(value)) return fallback;
    if (isWhole(value, min, max)) return value;
    errors[field] = message;
    return fallback;
  };
  const intervalMinutes = whole('interval_minutes', 1, 60, DEFAULT_INTERVAL_MINUTES, 'Give interval_minutes as a whole number from 1 to 60.');
  const expectedStatus = whole('expected_status', 100, 599, DEFAULT_EXPECTED_STATUS, 'Give expected_status as a whole number from 100 to 599.');
  const timeoutMs = whole('timeout_ms', 1000, 60_000, DEFAULT_TIMEOUT_MS, 'Give timeout_ms as a whole number from 1000 to 60000.');

  let keyword: string | null = null;
  if (!unset(b.keyword)) {
    if (typeof b.keyword === 'string' && b.keyword.length >= 1 && b.keyword.length <= 255) keyword = b.keyword;
    else errors.keyword = 'Give the keyword as 1 to 255 characters, or leave it out.';
  }

  let latencyThresholdMs: number | null = null;
  if (!unset(b.latency_threshold_ms)) {
    // INT UNSIGNED column.
    if (isWhole(b.latency_threshold_ms, 1, 4_294_967_295)) latencyThresholdMs = b.latency_threshold_ms;
    else errors.latency_threshold_ms = 'Give latency_threshold_ms as a whole number of at least 1, or leave it out.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    monitor: { name, url, intervalMinutes, expectedStatus, timeoutMs, keyword, checkTls: new URL(url).protocol === 'https:', latencyThresholdMs },
  };
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
