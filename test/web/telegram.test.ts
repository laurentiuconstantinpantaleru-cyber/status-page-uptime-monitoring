import { describe, expect, it } from 'vitest';
import { telegramClient, type HttpPost } from '../../src/web/alerts/telegram.js';

// The Telegram Bot API client (C-002): sendMessage, plain text, no link preview. The bot
// token is part of the URL, so it must never reach an error message.

const TOKEN = '123456:ABC-secret-token';

function post(status: number, body: unknown) {
  const calls: { url: string; body: string }[] = [];
  const fn: HttpPost = async (url, json) => {
    calls.push({ url, body: json });
    return { status, json: async () => body };
  };
  return { calls, fn };
}

describe('telegramClient (C-002)', () => {
  it('posts sendMessage to the chat with the text and no link preview', async () => {
    const { calls, fn } = post(200, { ok: true, result: {} });

    await telegramClient(TOKEN, fn).send('-1001234', 'Bookings API is down');

    expect(calls).toEqual([{
      url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      body: JSON.stringify({ chat_id: '-1001234', text: 'Bookings API is down', link_preview_options: { is_disabled: true } }),
    }]);
  });

  it('429 throws with the reply code and the seconds to wait', async () => {
    const { fn } = post(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 35', parameters: { retry_after: 35 } });

    const error = await telegramClient(TOKEN, fn).send('-1', 'x').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'ETELEGRAM', responseCode: 429, command: 'sendMessage', retryAfterS: 35 });
  });

  it.each([
    [400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }],
    [403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }],
    [200, { ok: false, description: 'odd' }],
    [502, 'not json'],
  ])('%i throws an ETELEGRAM error without the token', async (status, body) => {
    const { fn } = post(status, body);

    const error = await telegramClient(TOKEN, fn).send('-1', 'x').catch((e: unknown) => e) as Error & { responseCode: number };
    expect(error).toMatchObject({ code: 'ETELEGRAM', responseCode: status, command: 'sendMessage' });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('secret-token');
  });

  it('a network failure throws an ETELEGRAM error without the URL', async () => {
    const fn: HttpPost = async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    };

    const error = await telegramClient(TOKEN, fn).send('-1', 'x').catch((e: unknown) => e) as Error;
    expect(error).toMatchObject({ code: 'ETELEGRAM', responseCode: 0, command: 'sendMessage' });
    expect(`${error.message} ${error.stack}`).not.toContain('secret-token');
  });
});
