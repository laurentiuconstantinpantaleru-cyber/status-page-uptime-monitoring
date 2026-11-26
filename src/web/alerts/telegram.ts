import type { TelegramClient } from './dispatcher.js';

// The Telegram Bot API (C-002): one call, sendMessage, plain text. The bot token is part of the
// URL, so no error built here carries the URL, the token or the chat id. The HTTP call is
// injected (PATTERN-006); `fetchPost` is the real one.

export type HttpPost = (url: string, json: string) => Promise<{ status: number; json(): Promise<unknown> }>;

export class TelegramError extends Error {
  readonly code = 'ETELEGRAM';
  readonly command = 'sendMessage';
  constructor(
    readonly responseCode: number,
    description: string,
    readonly retryAfterS?: number,
  ) {
    super(`Telegram sendMessage failed: ${responseCode} ${description}`);
    this.name = 'TelegramError';
  }
}

export const fetchPost: HttpPost = (url, json) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, signal: AbortSignal.timeout(15_000) });

export function telegramClient(token: string, post: HttpPost = fetchPost): TelegramClient {
  return {
    async send(chatId, text) {
      let response: Awaited<ReturnType<HttpPost>>;
      try {
        response = await post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
        );
      } catch {
        // The original error may quote the URL, and with it the token.
        throw new TelegramError(0, 'network error');
      }
      let body: { ok?: unknown; description?: unknown; parameters?: { retry_after?: unknown } } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // Not JSON: judged by the status alone.
      }
      if (response.status === 200 && body?.ok === true) return;
      const description = typeof body?.description === 'string' ? body.description : 'unexpected reply';
      const retryAfter = typeof body?.parameters?.retry_after === 'number' ? body.parameters.retry_after : undefined;
      throw new TelegramError(response.status, description, retryAfter);
    },
  };
}
