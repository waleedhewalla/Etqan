import { config } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
}

type Transport = (message: EmailMessage) => Promise<EmailResult>;

export function isEmailConfigured(): boolean {
  return Boolean(config.SENDGRID_API_KEY);
}

const sendgridTransport: Transport = async (message) => {
  if (!isEmailConfigured()) return { status: 'skipped', error: 'Email is not configured' };

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: config.FROM_EMAIL, name: config.FROM_NAME },
        subject: message.subject,
        content: [
          { type: 'text/plain', value: message.text },
          ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'failed', error: `HTTP ${res.status}` };
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
};

let transport: Transport = sendgridTransport;

/** Replaces the transport (tests use this to capture messages). */
export function setEmailTransport(next: Transport | null) {
  transport = next ?? sendgridTransport;
}

export function sendEmail(message: EmailMessage): Promise<EmailResult> {
  return transport(message);
}
