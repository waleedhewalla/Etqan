/**
 * Contact details shown on public pages. Set at build time; the phone is omitted until a real one is given,
 * so a placeholder never reaches a page.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@itqan.link';
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE || '';
