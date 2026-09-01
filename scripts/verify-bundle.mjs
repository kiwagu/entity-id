#!/usr/bin/env node
/**
 * Bundle-cost guard.
 *
 * The package depends on Zod, but a consumer who only mints and checks ids must
 * not pay for it. That property is a BUILD detail, not a source one: when tsup
 * inlines `schema.ts` into `dist/index.js`, its top-level `import { z }` lands
 * in the main entry and every bundler must pull Zod in — measured at ~88 KB
 * gzip for `import { createEntityId }` alone. Splitting those modules into
 * their own chunks removes it, and nothing in the unit tests would notice if
 * that regressed, because the tests import from `src/`.
 *
 * So this installs the packed tarball, bundles three consumer shapes with
 * esbuild, and asserts the measured gzip size of each.
 *
 * Run after `npm run build`: `node scripts/verify-bundle.mjs`
 */
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each case is a consumer entry plus the gzip ceiling it must stay under.
 * The ceilings sit a little above the measured size, so ordinary drift does
 * not trip them but a lost chunk split — which multiplies the size — does.
 */
const CASES = [
  {
    name: 'ids only (no Zod expected)',
    code: `import { createEntityId, isEntityId, parseEntityId } from 'entity-id';
console.log(createEntityId('usr'), isEntityId('x'), parseEntityId(createEntityId('usr')));`,
    maxGzipKb: 8,
    zod: false,
  },
  {
    name: 'registry (no Zod expected)',
    code: `import { defineEntityPrefixes } from 'entity-id/registry';
const r = defineEntityPrefixes({ user: 'usr', order: 'ord' });
console.log(r.ids.user.create(), r.kindOf('usr_a'));`,
    maxGzipKb: 8,
    zod: false,
  },
  {
    name: 'schemas (Zod expected)',
    code: `import { entityIdSchema } from 'entity-id/schema';
console.log(entityIdSchema);`,
    maxGzipKb: 120,
    zod: true,
  },
];

const work = mkdtempSync(join(tmpdir(), 'entity-id-bundle-'));
let failures = 0;

try {
  execFileSync('npm', ['pack', '--pack-destination', work], {
    cwd: root,
    stdio: 'pipe',
  });
  const tarball = join(
    work,
    readdirSync(work).find((f) => f.endsWith('.tgz'))
  );

  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'bundle-probe', version: '1.0.0', type: 'module' })
  );
  execFileSync('npm', ['install', tarball, '--no-audit', '--no-fund'], {
    cwd: work,
    stdio: 'pipe',
  });

  process.stdout.write(
    '\n  case                            gzip    limit   zod\n'
  );
  process.stdout.write(
    '  ---------------------------------------------------\n'
  );

  for (const testCase of CASES) {
    const entry = join(work, `${CASES.indexOf(testCase)}.mjs`);
    const out = `${entry}.out.js`;
    writeFileSync(entry, testCase.code);

    execFileSync(
      'npx',
      [
        '--yes',
        'esbuild',
        entry,
        '--bundle',
        '--format=esm',
        '--minify',
        `--outfile=${out}`,
        '--log-level=error',
      ],
      { cwd: work, stdio: 'pipe' }
    );

    const bundled = readFileSync(out);
    const gzipKb = gzipSync(bundled).length / 1024;
    const hasZod = bundled.includes('ZodError');

    const sizeOk = gzipKb <= testCase.maxGzipKb;
    const zodOk = hasZod === testCase.zod;
    if (!sizeOk || !zodOk) failures++;

    process.stdout.write(
      `  ${(sizeOk && zodOk ? 'PASS' : 'FAIL').padEnd(6)}${testCase.name.padEnd(26)}` +
        `${gzipKb.toFixed(1).padStart(6)}K ${String(testCase.maxGzipKb).padStart(6)}K   ` +
        `${hasZod ? 'yes' : 'no'}${zodOk ? '' : ` (want ${testCase.zod ? 'yes' : 'no'})`}\n`
    );
  }

  process.stdout.write(
    failures === 0
      ? '\nOK: a consumer who never touches Zod does not bundle it.\n'
      : `\n${failures} bundle check(s) failed. Did dist/index.js regain a top-level Zod import?\n`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
