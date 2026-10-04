/**
 * Browser smoke test for the PACKED tarball.
 *
 * The package claims to be isomorphic, and a grep for `node:` in the bundle
 * only proves nothing obvious leaked in. This proves the claim: it installs the
 * tarball, bundles a consumer entry with esbuild, runs it in Chromium, and
 * asserts real BEHAVIOUR — thousands of distinct ids, so the platform CSPRNG is
 * genuinely working rather than the module merely loading.
 *
 * Requires Playwright with Chromium available. Skips (exit 0) with a clear
 * message when it is not installed, so it never blocks a machine without it.
 *
 * Run after `npm run build`: `node scripts/verify-browser.mjs`
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  process.stdout.write(
    'SKIP: playwright is not installed; browser verification skipped.\n' +
      '      Install it with `npm i -D playwright && npx playwright install chromium`.\n'
  );
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'entity-id-browser-'));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}\n`
  );
};

try {
  process.stdout.write('==> packing and installing\n');
  run('npm', ['pack', '--pack-destination', work], root);
  const tarball = join(
    work,
    readdirSync(work).find((f) => f.endsWith('.tgz'))
  );

  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'browser-probe', version: '1.0.0', type: 'module' })
  );
  run('npm', ['install', tarball, '--no-audit', '--no-fund'], work);

  // A consumer entry importing by package name, exactly as a real app would.
  writeFileSync(
    join(work, 'entry.mjs'),
    `
import {
  compareEntityIds, createEntityId, defineEntityPrefixes, entityIdSchema,
  entityIdToIso, isEntityId, parseEntityId,
} from 'entity-id';
import { withSchemas } from 'entity-id/schema';

const results = {};
const id = createEntityId('usr');
results.mints = isEntityId(id, { mode: 'full' });
results.schema = entityIdSchema.parse(id) === id;
results.prefix = parseEntityId(id).prefix;
results.iso = typeof entityIdToIso(id) === 'string';

// Real entropy from the browser's CSPRNG, not a constant fallback.
const many = new Set(Array.from({ length: 5000 }, () => createEntityId('usr')));
results.distinctIds = many.size;
results.distinctRandom = new Set([...many].map((v) => parseEntityId(v).rand)).size;

const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' });
const userId = registry.factories.userIdFactory.create();
results.kindOf = registry.kindOf(userId);
results.crossKind = registry.factories.orderIdFactory.is(userId);
results.jsonSchema = String(withSchemas(registry).user.jsonSchema().pattern).includes('usr_');

const a = createEntityId('usr', { timeMs: 1000, monotonic: false });
const b = createEntityId('usr', { timeMs: 2000, monotonic: false });
results.ordering = compareEntityIds(a, b, 'time') < 0;
results.epoch = createEntityId('usr', { timeMs: 0, monotonic: false }).endsWith('.0000000000');

window.__RESULTS__ = results;
`
  );

  process.stdout.write('==> bundling for the browser\n');
  run(
    'npx',
    [
      '--yes',
      'esbuild',
      'entry.mjs',
      '--bundle',
      '--format=iife',
      '--outfile=bundle.js',
      '--platform=browser',
    ],
    work
  );
  writeFileSync(
    join(work, 'index.html'),
    '<!doctype html><meta charset=utf-8><body><script src="bundle.js"></script></body>'
  );

  process.stdout.write('==> running in Chromium\n');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  await page.goto(`file://${join(work, 'index.html')}`);
  const results = await page.evaluate(() => window.__RESULTS__);
  const version = await page.evaluate(
    () => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown'
  );
  await browser.close();

  process.stdout.write(`\n==> ${version}\n`);

  if (!results) {
    process.stdout.write('  FAIL  the bundle did not execute\n');
    failures++;
  } else {
    check('mints a valid id', results.mints, true);
    check('schema parses', results.schema, true);
    check('decodes the prefix', results.prefix, 'usr');
    check('decodes the timestamp', results.iso, true);
    check('5000 distinct ids', results.distinctIds, 5000);
    check('5000 distinct random segments', results.distinctRandom, 5000);
    check('registry routes an id', results.kindOf, 'user');
    check('registry rejects another kind', results.crossKind, false);
    check('emits a JSON Schema', results.jsonSchema, true);
    check('orders chronologically', results.ordering, true);
    check('preserves the Unix epoch', results.epoch, true);
  }

  for (const error of pageErrors) {
    failures++;
    process.stdout.write(`  FAIL  page error: ${error}\n`);
  }

  process.stdout.write(
    failures === 0
      ? '\nOK: the package works in a real browser.\n'
      : `\n${failures} browser check(s) failed.\n`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
