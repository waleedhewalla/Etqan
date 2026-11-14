import { describe, expect, it } from 'vitest';
import { institutionTimeToIso, wallClock } from './live-time';

describe('lesson times in the institution’s zone', () => {
  it('turns a Cairo wall-clock time into the instant it means, whatever the browser’s zone is', () => {
    // Cairo is UTC+2 in winter and UTC+3 in summer.
    expect(institutionTimeToIso('2026-01-15T20:00')).toBe('2026-01-15T18:00:00.000Z');
    expect(institutionTimeToIso('2026-07-15T20:00')).toBe('2026-07-15T17:00:00.000Z');
  });

  it('reads an instant back as the same wall-clock time', () => {
    for (const value of ['2026-01-15T20:00', '2026-07-15T08:05', '2026-12-31T23:59', '2027-03-01T00:00']) {
      expect(wallClock(new Date(institutionTimeToIso(value)!))).toBe(value);
    }
  });

  it('refuses what is not a time, and an hour that clocks skip when they go forward', () => {
    expect(institutionTimeToIso('')).toBeNull();
    expect(institutionTimeToIso('tomorrow')).toBeNull();
    expect(institutionTimeToIso('2026-13-40T25:00')).toBeNull();
    // Egypt moves its clocks forward at midnight on the last Friday of April: 00:00–01:00 on 2026-04-24 does not exist.
    expect(institutionTimeToIso('2026-04-24T00:30')).toBeNull();
    expect(institutionTimeToIso('2026-04-24T01:30')).not.toBeNull();
  });
});
