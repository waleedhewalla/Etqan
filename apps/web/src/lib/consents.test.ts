import { describe, expect, it } from 'vitest';
import { currentConsents } from './api';

describe('currentConsents', () => {
  it('keeps guardian access for a student who never decided, so saving another consent does not withdraw it', () => {
    expect(currentConsents({ consents: ['voice_recording'], guardianAccess: true }).sort()).toEqual(['mahram_access', 'voice_recording']);
  });

  it('does not bring it back once she withdrew it', () => {
    expect(currentConsents({ consents: ['voice_recording'], guardianAccess: false })).toEqual(['voice_recording']);
    // Even if a stale list still named it.
    expect(currentConsents({ consents: ['voice_recording', 'mahram_access'], guardianAccess: false })).toEqual(['voice_recording']);
  });

  it('counts it as given when the server does not say (an older response)', () => {
    expect(currentConsents({ consents: [] })).toEqual(['mahram_access']);
  });

  it('lists each consent once and sends nothing before the account is loaded', () => {
    expect(currentConsents({ consents: ['mahram_access', 'analytics'], guardianAccess: true }).filter((c) => c === 'mahram_access')).toHaveLength(1);
    expect(currentConsents(undefined)).toEqual([]);
  });
});
