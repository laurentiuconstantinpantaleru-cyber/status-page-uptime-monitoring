import nodemailer from 'nodemailer';
import type { Mailer } from './job.js';

// The real mailer (Q-004): SMTP through nodemailer, configured by SMTP_URL (for example
// smtps://user:pass@smtp.example.com:465) and MAIL_FROM. It only sends and rethrows (PATTERN-006).

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
