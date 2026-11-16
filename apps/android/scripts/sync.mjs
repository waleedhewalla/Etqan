/** Creates the Android project the first time, then copies the settings and the offline page into it. */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.ITQAN_APP_URL) {
  console.error('Set ITQAN_APP_URL to the address of the Itqan website, for example https://itqan.example.org');
  process.exit(1);
}
const bin = path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
const cap = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: root, stdio: 'inherit' });
if (!existsSync(path.join(root, 'android'))) cap('add', 'android');
cap('sync', 'android');
