#!/usr/bin/env node
/**
 * Smoke-tests the PACKED tarball, not the sources.
 *
 * Unit tests import from `src/`, so they cannot see bundling faults: a wrong
 * `exports` map, a missing file, or module state duplicated across entry
 * points. That last one is not hypothetical — async mode scopes once worked in
 * the sources and silently did nothing in the build, because each entry had
 * received its own copy of the mode module.
 *
 * Run after `npm run build`: `node scripts/verify-package.mjs`
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'entity-id-verify-'));

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${actual}, want ${expected})`}\n`
  );
};

try {
  process.stdout.write('==> packing\n');
  run('npm', ['pack', '--pack-destination', work], root);
  const tarball = join(
    work,
    readdirSync(work).find((f) => f.endsWith('.tgz'))
  );

  for (const type of ['module', 'commonjs']) {
    const dir = join(work, type);
    run('mkdir', ['-p', dir], work);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `probe-${type}`, version: '1.0.0', type })
    );
    run('npm', ['install', tarball, '--no-audit', '--no-fund'], dir);

    process.stdout.write(`\n==> ${type}\n`);

    const isEsm = type === 'module';
    const ext = isEsm ? 'mjs' : 'cjs';
    const load = isEsm
      ? `const m = await import('entity-id'); const a = await import('entity-id/async'); const s = await import('entity-id/sql'); const sc = await import('entity-id/schema'); const rg = await import('entity-id/registry');`
      : `const m = require('entity-id'); const a = require('entity-id/async'); const s = require('entity-id/sql'); const sc = require('entity-id/schema'); const rg = require('entity-id/registry');`;

    // CommonJS has no top-level await, so the body runs inside an async IIFE
    // in both formats.
    const probe = `(async () => {
${load}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HALF = 'usr_not-canonical';
const out = {};

const id = m.createEntityId('usr');
out.mints = m.isEntityId(id, { mode: 'full' });
out.defaultMode = m.getValidationMode();
out.mixedAcceptsHead = m.isEntityId(HALF);
out.fullRejectsHead = m.isEntityId(HALF, { mode: 'full' });
out.parseIso = m.parseEntityId(id).iso === new Date(m.parseEntityId(id).timeMs).toISOString();
out.sql = s.ENTITY_ID_SQL.includes('entity_id_generate');

// The registry must work without the schema module, and withSchemas must
// bolt the Zod layer back on from the separate entry point.
const reg = rg.defineEntityPrefixes({ user: 'usr', order: 'ord' });
out.registryMints = reg.ids.user.is(reg.ids.user.create());
out.toolkitHasNoSchema = reg.ids.user.schema === undefined;
const derived = sc.withSchemas(reg);
out.withSchemas = derived.user.schema.parse(reg.ids.user.create()).startsWith('usr_');
out.withSchemasJson = String(derived.user.jsonSchema().pattern).includes('usr_');
out.tsIndex = s.entityIdTimeIndexSql('events');
out.tsFn = s.ENTITY_ID_SQL.includes('entity_id_ts_of');
try { s.entityIdTimeIndexSql('events; drop table t'); out.tsGuard = 'none'; }
catch { out.tsGuard = 'threw'; }

// The regression this file exists for: a scope must survive an await, and
// two concurrent scopes must not bleed into each other.
await a.withValidationModeAsync('full', async () => {
  await sleep(5);
  out.scopeSurvivesAwait = m.getValidationMode();
  out.scopeIsStrict = !m.isEntityId(HALF);
});
out.scopeRestored = m.getValidationMode();

const [x, y] = await Promise.all([
  a.withValidationModeAsync('full', async () => { await sleep(8); return m.getValidationMode(); }),
  a.withValidationModeAsync('fast', async () => { await sleep(2); return m.getValidationMode(); }),
]);
out.concurrent = x + ',' + y;

try { m.withValidationMode('full', async () => 1); out.asyncTrap = 'none'; }
catch (e) { out.asyncTrap = e.constructor.name; }

process.stdout.write(JSON.stringify(out));
})().catch((error) => { console.error(error); process.exit(1); });
`;

    const probePath = join(dir, `probe.${ext}`);
    writeFileSync(probePath, probe);
    const raw = run('node', [probePath], dir);
    const r = JSON.parse(raw);

    check('mints a valid id', r.mints, true);
    check('default mode is mixed', r.defaultMode, 'mixed');
    check('mixed accepts a prefixed body', r.mixedAcceptsHead, true);
    check('full rejects it', r.fullRejectsHead, false);
    check('parse carries iso', r.parseIso, true);
    check('sql entry point loads', r.sql, true);
    check('registry entry point works', r.registryMints, true);
    check('toolkit carries no schema', r.toolkitHasNoSchema, true);
    check('withSchemas parses', r.withSchemas, true);
    check('withSchemas emits JSON Schema', r.withSchemasJson, true);
    check('migration installs entity_id_ts_of', r.tsFn, true);
    check(
      'time index statement renders',
      r.tsIndex,
      'create index if not exists events_id_ts_idx on events (public.entity_id_ts_of(id) desc)'
    );
    check('time index rejects a hostile table name', r.tsGuard, 'threw');
    check('async scope survives await', r.scopeSurvivesAwait, 'full');
    check('async scope is strict', r.scopeIsStrict, true);
    check('async scope restores', r.scopeRestored, 'mixed');
    check('concurrent scopes isolated', r.concurrent, 'full,fast');
    check('sync helper rejects async fn', r.asyncTrap, 'TypeError');
  }

  process.stdout.write(
    failures === 0
      ? '\nOK: the packaged artifact behaves correctly.\n'
      : `\n${failures} check(s) failed against the packaged artifact.\n`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
