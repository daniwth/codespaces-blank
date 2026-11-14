import { config, devLinks, mailMode } from './config.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Delivers one email. `log` prints it (links included) to the console; `http` POSTs a Resend-style JSON payload. */
export async function sendMail(mail: Mail): Promise<void> {
  if (mailMode === 'log') {
    console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n[mail] end`);
    return;
  }
  const res = await fetch(config.mail.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.mail.apiKey}` },
    body: JSON.stringify({ from: config.mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`mail API answered ${res.status}`);
}

/**
 * Sends an email in the background so the HTTP answer never depends on (or reveals) the outcome:
 * failures are logged without the address or link. Returns the link only where dev links are allowed.
 */
export function dispatchMail(mail: Mail, link: string): string | undefined {
  void sendMail(mail).catch((err: unknown) => {
    console.error('[mail] delivery failed:', err instanceof Error ? err.message : 'unknown error');
  });
  return devLinks ? link : undefined;
}

const footer = '\n\nIf you did not request this, you can ignore this email.\n— Hash Harvest Tycoon';

export const verifyMail = (to: string, link: string): Mail => ({
  to,
  subject: 'Confirm your Hash Harvest Tycoon account',
  text: `Welcome! Confirm your email to activate your account (the link works once and expires in 24 hours):\n\n${link}${footer}`,
});

export const alreadyRegisteredMail = (to: string, link: string): Mail => ({
  to,
  subject: 'You already have a Hash Harvest Tycoon account',
  text: `Someone (hopefully you) tried to create an account with this address, but it is already registered. Nothing was changed.\n\nLog in here: ${link}\nForgot your password? Use "Forgot password?" on the login screen.${footer}`,
});

export const resetMail = (to: string, link: string): Mail => ({
  to,
  subject: 'Reset your Hash Harvest Tycoon password',
  text: `Choose a new password (the link works once and expires in 1 hour). Resetting signs you out everywhere:\n\n${link}${footer}`,
});
