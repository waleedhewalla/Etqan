import { config } from '../../config';
import { DemoAsrProvider } from './demo';
import { OpenAICompatibleProvider } from './openai';
import type { AsrProvider } from './types';

export * from './types';

let override: AsrProvider | null | undefined;

/** Replaces the provider (tests). Pass `undefined` to go back to the configured one. */
export function setAsrProvider(provider: AsrProvider | null | undefined) {
  override = provider;
}

/** The configured provider, or null when recitation checking is off or not set up. */
export function getAsrProvider(): AsrProvider | null {
  if (override !== undefined) return override;
  if (!config.ENABLE_ASR) return null;

  switch (config.ASR_PROVIDER) {
    case 'demo':
      if (config.NODE_ENV === 'production') throw new Error('ASR_PROVIDER=demo cannot be used in production');
      return new DemoAsrProvider();
    case 'openai-compatible':
      if (!config.ASR_API_URL) throw new Error('ASR_API_URL is required for ASR_PROVIDER=openai-compatible');
      return new OpenAICompatibleProvider(config.ASR_API_URL, config.ASR_API_KEY, config.ASR_MODEL);
    default:
      return null;
  }
}
