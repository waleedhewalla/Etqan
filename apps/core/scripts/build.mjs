/**
 * Bundles the API for production: `node dist/server.mjs`.
 *
 * The workspace packages (@itqan/*) ship TypeScript source, which plain Node cannot load, so they are
 * compiled into the bundle. Everything else from npm stays external and is installed in the image.
 * (`tsc` is type-check only here: the shared tsconfig has noEmit.)
 */
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter((name) => !name.startsWith('@itqan/'))
  .flatMap((name) => [name, `${name}/*`]);

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: {
    server: 'src/server.ts',
    migrate: 'src/db/migrate.ts',
    'quran-seed': 'src/db/quran-seed.ts',
    bootstrap: 'src/db/bootstrap.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  // Lets bundled code that still uses require() or __dirname work inside an ES module.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_ } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});
