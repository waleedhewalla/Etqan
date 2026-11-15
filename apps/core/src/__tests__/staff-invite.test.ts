import { afterEach, describe, expect, it } from 'vitest';
import { setEmailTransport, type EmailMessage } from '../lib/email';
import { inviteStaff } from '../lib/staff-invite';

describe('staff invitation', () => {
  afterEach(() => setEmailTransport(null));
  const send = async (role: string) => {
    const sent: EmailMessage[] = [];
    setEmailTransport(async (m) => { sent.push(m); return { status: 'sent' }; });
    await inviteStaff('x@example.org', 'الاسم', role);
    return sent[0];
  };

  it('addresses an admin in the masculine', async () => {
    const m = await send('admin');
    expect(m.subject).toBe('أُضيفتَ إلى إتقان');
    expect(m.text).toContain('مسؤولاً');
    expect(m.text).toContain('افتح ');
    expect(m.text).not.toContain('افتحي');
  });

  it('addresses teachers and advisors in the feminine', async () => {
    for (const [role, word] of [['lecturer', 'معلمةً'], ['advisor', 'مرشدةً']] as const) {
      const m = await send(role);
      expect(m.subject).toBe('أُضيفتِ إلى إتقان');
      expect(m.text).toContain(word);
      expect(m.text).toContain('افتحي');
    }
  });
});
