import nodemailer from 'nodemailer';

// Email for the monthly reports and the alerts (Q-004, D-041, D-044): SMTP through nodemailer,
// configured by SMTP_URL (for example smtps://user:pass@smtp.example.com:465) and MAIL_FROM.
// The real mailer only sends and rethrows (PATTERN-006).

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer }[];
}

/** Injected so tests never send mail (PATTERN-006); `smtpMailer` is the real one. */
export interface Mailer {
  /** Resolves with how many recipients the mail server accepted; throws when it took none. */
  send(mail: Mail): Promise<{ accepted: number }>;
}

/** What of a failed send may be stored and logged. An SMTP error's message, `response`,
 *  `rejected` and `rejectedErrors` quote the recipients' addresses (personal data, AGENTS.md). */
export function mailErrorFields(error: unknown): { code?: string; responseCode?: number; command?: string; name: string } {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown; name?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : 'Error',
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof e.responseCode === 'number' ? { responseCode: e.responseCode } : {}),
    ...(typeof e.command === 'string' ? { command: e.command } : {}),
  };
}

/** `EENVELOPE 550 RCPT TO`, or the error's name when it has none of those fields. */
export const mailErrorText = (f: ReturnType<typeof mailErrorFields>) =>
  f.code === undefined && f.responseCode === undefined && f.command === undefined
    ? f.name
    : [f.code, f.responseCode, f.command].filter((x) => x !== undefined).join(' ');

/** What a log line may carry about a failed send: the SMTP fields, or the error's name. */
export function mailErrorLog(error: unknown) {
  const { name, ...smtp } = mailErrorFields(error);
  return Object.keys(smtp).length ? smtp : { name };
}

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(mail) {
      const info = await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, attachments: mail.attachments });
      // A send resolves once one recipient is accepted; the refused ones are in info.rejected.
      return { accepted: Array.isArray(info.accepted) ? info.accepted.length : mail.to.length };
    },
  };
}

/** The mailer from the environment, or null (with the reason) when it is not configured. */
export function mailerFromEnv(env: NodeJS.ProcessEnv): { mailer: Mailer | null; missing: string[] } {
  const missing = ['SMTP_URL', 'MAIL_FROM'].filter((name) => !env[name]);
  return { mailer: missing.length ? null : smtpMailer(env.SMTP_URL!, env.MAIL_FROM!), missing };
}
