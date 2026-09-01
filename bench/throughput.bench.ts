/**
 * Throughput benchmark: how many ids per second this package mints, validates
 * and decodes, in each mode, against familiar baselines.
 *
 * Run it with `npm run bench` (add `--json` to emit machine-readable results).
 * Numbers are hardware-specific; what matters is the ratio between rows.
 */
import { randomUUID } from 'node:crypto';

import { ulid as ulidCanonical, monotonicFactory } from 'ulid';

import {
  assertEntityIdWithPrefix,
  createEntityId,
  entityIdToTimeMs,
  isEntityId,
  isEntityIdWithPrefix,
  normalizeEntityId,
  parseEntityId,
} from '../src/entity-id.js';
import { withValidationMode } from '../src/mode.js';
import { defineEntityPrefixes } from '../src/registry.js';
import { entityIdSchema, withSchemas } from '../src/schema.js';

type Result = Readonly<{
  group: string;
  name: string;
  opsPerSecond: number;
  nsPerOp: number;
}>;

const results: Result[] = [];
const asJson = process.argv.includes('--json');

/** Keep the optimiser from eliminating work whose result is unused. */
let sink: unknown;

function bench(
  group: string,
  name: string,
  fn: () => unknown,
  iterations = 1_000_000
): void {
  // Warm up, so the JIT has compiled the hot path before we measure.
  for (let i = 0; i < Math.min(iterations, 50_000); i++) sink = fn();

  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) sink = fn();
  const elapsedNs = Number(process.hrtime.bigint() - started);

  const opsPerSecond = (iterations / elapsedNs) * 1e9;
  results.push({
    group,
    name,
    opsPerSecond,
    nsPerOp: elapsedNs / iterations,
  });
}

function formatOps(ops: number): string {
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}K/s`;
  return `${ops.toFixed(0)}/s`;
}

function report(): void {
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ node: process.version, results }, null, 2)}\n`
    );
    return;
  }

  let currentGroup = '';
  for (const row of results) {
    if (row.group !== currentGroup) {
      currentGroup = row.group;
      process.stdout.write(`\n${currentGroup}\n${'─'.repeat(58)}\n`);
    }
    process.stdout.write(
      `  ${row.name.padEnd(34)} ${formatOps(row.opsPerSecond).padStart(10)}  ${row.nsPerOp.toFixed(0).padStart(6)} ns\n`
    );
  }
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------

const ulidMonotonic = monotonicFactory();
const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' } as const);
const registrySchemas = withSchemas(registry);
const ID = createEntityId('usr');
const WRONG = createEntityId('ord');
const GARBAGE = 'not-an-id';

process.stdout.write(
  `entity-id benchmark — Node ${process.version} on ${process.platform}/${process.arch}\n`
);

bench('Generation', 'createEntityId (monotonic)', () => createEntityId('usr'));
bench('Generation', 'createEntityId (random)', () =>
  createEntityId('usr', { monotonic: false })
);
bench('Generation', 'registry toolkit .create()', () =>
  registry.ids.user.create()
);
bench('Generation', 'baseline: ulid()', () => ulidCanonical());
bench('Generation', 'baseline: ulid() monotonic', () => ulidMonotonic());
bench('Generation', 'baseline: crypto.randomUUID()', () => randomUUID());

for (const mode of ['fast', 'mixed', 'full'] as const) {
  bench(`Validation — ${mode}`, 'isEntityId (valid)', () =>
    withValidationMode(mode, () => isEntityId(ID))
  );
  bench(`Validation — ${mode}`, 'isEntityId (garbage)', () =>
    withValidationMode(mode, () => isEntityId(GARBAGE))
  );
  bench(`Validation — ${mode}`, 'isEntityIdWithPrefix (match)', () =>
    withValidationMode(mode, () => isEntityIdWithPrefix(ID, 'usr'))
  );
  bench(`Validation — ${mode}`, 'isEntityIdWithPrefix (swapped)', () =>
    withValidationMode(mode, () => isEntityIdWithPrefix(WRONG, 'usr'))
  );
  bench(`Validation — ${mode}`, 'toolkit .is()', () =>
    withValidationMode(mode, () => registry.ids.user.is(ID))
  );
}

// Per-call overrides avoid the withValidationMode wrapper, so these rows show
// the validators' own cost without the mode-switching overhead.
for (const mode of ['fast', 'mixed', 'full'] as const) {
  bench(`Validation (per-call ${mode})`, 'isEntityId', () =>
    isEntityId(ID, { mode })
  );
  bench(`Validation (per-call ${mode})`, 'assertEntityIdWithPrefix', () =>
    assertEntityIdWithPrefix(ID, 'usr', { mode })
  );
}

for (const mode of ['fast', 'full'] as const) {
  bench(`Decoding — ${mode}`, 'parseEntityId', () =>
    parseEntityId(ID, { mode })
  );
  bench(`Decoding — ${mode}`, 'entityIdToTimeMs', () =>
    entityIdToTimeMs(ID, { mode })
  );
}
bench('Decoding — full', 'normalizeEntityId', () => normalizeEntityId(ID));
bench('Decoding — full', 'registry.kindOf', () => registry.kindOf(ID));

bench(
  'Zod schema',
  'entityIdSchema.parse (mixed)',
  () => entityIdSchema.parse(ID),
  200_000
);
bench(
  'Zod schema',
  'entityIdSchema.parse (full)',
  () => withValidationMode('full', () => entityIdSchema.parse(ID)),
  200_000
);
bench(
  'Zod schema',
  'withSchemas().schema.parse (mixed)',
  () => registrySchemas.user.schema.parse(ID),
  200_000
);

report();

if (sink === Symbol.for('never')) process.exit(1);
