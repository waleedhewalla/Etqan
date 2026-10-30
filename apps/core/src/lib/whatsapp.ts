import { config } from '../config';

/**
 * WhatsApp Business messaging through 360dialog (Cloud API).
 *
 * Business-initiated messages must use templates approved in the WhatsApp
 * Business Manager. Template names are configurable so the pilot can register
 * its own Arabic templates without a code change.
 */

export type WhatsAppTemplate = 'otp' | 'absence_alert';

export interface WhatsAppMessage {
  to: string;
  template: WhatsAppTemplate;
  /** Positional body parameters ({{1}}, {{2}}, …) in template order. */
  params: string[];
}

export interface WhatsAppResult {
  status: 'sent' | 'skipped' | 'failed';
  messageId?: string;
  error?: string;
}

type Transport = (message: WhatsAppMessage) => Promise<WhatsAppResult>;

export function isWhatsAppConfigured(): boolean {
  return Boolean(config.WHATSAPP_API_URL && config.WHATSAPP_API_KEY);
}

function templateName(template: WhatsAppTemplate): string {
  return template === 'otp' ? config.WHATSAPP_TEMPLATE_OTP : config.WHATSAPP_TEMPLATE_ABSENCE;
}

/** Builds the 360dialog Cloud API request body for a template message. */
export function buildTemplatePayload(message: WhatsAppMessage) {
  const components: Record<string, unknown>[] = [
    {
      type: 'body',
      parameters: message.params.map((text) => ({ type: 'text', text })),
    },
  ];

  // Authentication templates carry the code again on their copy-code button.
  if (message.template === 'otp') {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: message.params[0] }],
    });
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: templateName(message.template),
      language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE },
      components,
    },
  };
}

const httpTransport: Transport = async (message) => {
  if (!isWhatsAppConfigured()) {
    return { status: 'skipped', error: 'WhatsApp is not configured' };
  }

  try {
    const res = await fetch(`${config.WHATSAPP_API_URL!.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'D360-API-KEY': config.WHATSAPP_API_KEY!,
      },
      body: JSON.stringify(buildTemplatePayload(message)),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      return { status: 'failed', error: body.error?.message ?? `HTTP ${res.status}` };
    }
    return { status: 'sent', messageId: body.messages?.[0]?.id };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
};

let transport: Transport = httpTransport;

/** Replaces the transport (tests use this to capture messages). */
export function setWhatsAppTransport(next: Transport | null) {
  transport = next ?? httpTransport;
}

export function sendWhatsApp(message: WhatsAppMessage): Promise<WhatsAppResult> {
  return transport(message);
}
