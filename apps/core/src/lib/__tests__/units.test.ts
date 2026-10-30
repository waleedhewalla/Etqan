import { describe, expect, it } from 'vitest';
import { recordActivity, type StreakState } from '../streak';
import { addDays, daysBetween, localDate, startOfLocalDay, weekStart } from '../dates';
import { buildTemplatePayload } from '../whatsapp';

const base: StreakState = { currentStreak: 4, longestStreak: 6, freezesRemaining: 2, lastActiveDate: '2026-10-10' };

describe('recordActivity', () => {
  it('does nothing on a second activity the same day', () => {
    expect(recordActivity(base, '2026-10-10')).toEqual({ state: base, frozenDates: [] });
  });

  it('extends the streak on the next day', () => {
    expect(recordActivity(base, '2026-10-11').state.currentStreak).toBe(5);
  });

  it('uses a freeze to cover exactly one missed day', () => {
    const { state, frozenDates } = recordActivity(base, '2026-10-12');
    expect(state.currentStreak).toBe(5);
    expect(state.freezesRemaining).toBe(1);
    expect(frozenDates).toEqual(['2026-10-11']);
  });

  it('restarts after a longer gap or with no freezes left', () => {
    expect(recordActivity(base, '2026-10-14').state.currentStreak).toBe(1);
    expect(recordActivity({ ...base, freezesRemaining: 0 }, '2026-10-12').state.currentStreak).toBe(1);
  });

  it('starts at 1 for a first activity and tracks the longest streak', () => {
    const first = recordActivity({ currentStreak: 0, longestStreak: 0, freezesRemaining: 2, lastActiveDate: null }, '2026-10-10');
    expect(first.state).toMatchObject({ currentStreak: 1, longestStreak: 1 });
    expect(recordActivity({ ...base, currentStreak: 6 }, '2026-10-11').state.longestStreak).toBe(7);
  });
});

describe('dates', () => {
  it('uses Cairo calendar days', () => {
    // 22:30 UTC on 9 Oct is already 10 Oct in Cairo (UTC+3 in October 2026).
    expect(localDate(new Date('2026-10-09T22:30:00Z'), 'Africa/Cairo')).toBe('2026-10-10');
    expect(startOfLocalDay('2026-10-10', 'Africa/Cairo').toISOString()).toBe('2026-10-09T21:00:00.000Z');
  });

  it('starts the week on Saturday', () => {
    expect(weekStart('2026-10-10')).toBe('2026-10-10'); // Saturday
    expect(weekStart('2026-10-16')).toBe('2026-10-10'); // Friday
    expect(weekStart('2026-10-17')).toBe('2026-10-17');
  });

  it('adds and counts days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-10', '2026-10-12')).toBe(2);
  });
});

describe('buildTemplatePayload', () => {
  it('sends the OTP in the body and the copy-code button, without the leading +', () => {
    const payload = buildTemplatePayload({ to: '+201001234567', template: 'otp', params: ['4821'] });
    expect(payload.to).toBe('201001234567');
    expect(payload.template.language.code).toBe('ar');
    expect(payload.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '4821' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '4821' }] },
    ]);
  });

  it('fills absence alerts with name, halaqa and date', () => {
    const payload = buildTemplatePayload({
      to: '+201001234567', template: 'absence_alert', params: ['مريم', 'حلقة البقرة', '2026-10-10'],
    });
    expect(payload.template.components).toHaveLength(1);
    expect(payload.template.components[0]).toMatchObject({ type: 'body' });
  });
});
