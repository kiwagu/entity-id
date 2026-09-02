import { afterEach, describe, expect, it } from 'vitest';

import { createEntityId } from './entity-id.js';
import { resetValidationMode, setValidationMode } from './mode.js';
import { defineEntityPrefixes } from './registry.js';
import { entityIdSchema, strictEntityIdSchema, withSchemas } from './schema.js';

/**
 * Regressions reported by a consumer adopting 1.0.0 (zero-memory), plus the
 * behaviour the fix guarantees.
 *
 * The reviewer's key insight: a mode-inheriting regression only shows on the
 * WEAK modes, so every claim here runs across the whole matrix rather than
 * under the default alone. The reported holes were invisible to typecheck,
 * lint, unit tests and 144 e2e tests.
 */
const MODES = ['fast', 'mixed', 'full'] as const;

const registry = defineEntityPrefixes({
  memory: 'mem',
  oauthClient: 'oac',
} as const);
const schemas = withSchemas(registry);

afterEach(() => {
  resetValidationMode();
});

describe('normalization is mode-independent', () => {
  // The reported correctness bug: under 'mixed' the codec returned the input
  // untouched, so an id parsed from a mixed-case source no longer compared
  // equal to the canonical form a database round-trip returns.
  it.each(MODES)('%s normalizes a mixed-case id', (mode) => {
    setValidationMode(mode);
    const canonical = createEntityId('mem');
    const shouted = canonical.replace(
      /^mem_(.*)$/,
      (_, rest: string) => `mem_${rest.toUpperCase()}`
    );

    expect(schemas.memory.schema.parse(shouted)).toBe(canonical);
    expect(entityIdSchema.parse(shouted)).toBe(canonical);
  });

  it.each(MODES)('%s trims surrounding whitespace', (mode) => {
    setValidationMode(mode);
    const id = createEntityId('mem');
    expect(schemas.memory.schema.parse(`  ${id}\n`)).toBe(id);
  });

  it.each(MODES)('%s round-trips: parse(parse(x)) === parse(x)', (mode) => {
    setValidationMode(mode);
    const id = createEntityId('mem');
    const once = schemas.memory.schema.parse(
      id.toUpperCase().replace('MEM_', 'mem_')
    );
    const twice = schemas.memory.schema.parse(once);
    expect(twice).toBe(once);
  });

  it('normalizes without throwing on a value only a lenient mode allows', () => {
    // normalizeEntityId() parses in 'full' and throws, so the codec cannot use
    // it: it would reject exactly the values the mode chose to accept.
    setValidationMode('mixed');
    expect(schemas.memory.schema.parse('mem_NOT-CANONICAL')).toBe(
      'mem_not-canonical'
    );
  });
});

describe('the documented strictness of each mode', () => {
  // These values are ACCEPTED under the default mode. That is the intended
  // trade, and the README says so — but it must be a deliberate, tested fact
  // rather than a surprise, because the consumer expected a sanitizer.
  const looseValues = [
    "mem_' OR 1=1--",
    'mem_garbage',
    `oac_${'x'.repeat(200)}`,
  ];

  it.each(looseValues)('mixed accepts %s (head-only check)', (value) => {
    setValidationMode('mixed');
    const kind = value.startsWith('oac') ? schemas.oauthClient : schemas.memory;
    expect(kind.schema.safeParse(value).success).toBe(true);
  });

  it.each(looseValues)('full rejects %s', (value) => {
    setValidationMode('full');
    const kind = value.startsWith('oac') ? schemas.oauthClient : schemas.memory;
    expect(kind.schema.safeParse(value).success).toBe(false);
  });

  it.each(looseValues)(
    'strictEntityIdSchema rejects %s whatever the mode',
    (value) => {
      for (const mode of MODES) {
        setValidationMode(mode);
        expect(strictEntityIdSchema.safeParse(value).success).toBe(false);
      }
    }
  );

  it.each(MODES)('%s still rejects a wrong-kind id', (mode) => {
    setValidationMode(mode);
    const memoryId = createEntityId('mem');
    // 'fast' performs no validation at all, by design.
    const expected = mode === 'fast';
    expect(schemas.oauthClient.schema.safeParse(memoryId).success).toBe(
      expected
    );
  });
});

describe('the advertised contract matches what strictness can deliver', () => {
  it.each(MODES)('%s advertises the full canonical pattern', (mode) => {
    setValidationMode(mode);
    const pattern = String(schemas.memory.jsonSchema().pattern);
    expect(pattern).toContain('mem_');
    expect(new RegExp(pattern).test(createEntityId('mem'))).toBe(true);
  });

  it('a value the advertised pattern rejects is rejected under full', () => {
    // The published JSON Schema is a contract for someone else's clients. It
    // may be stricter than a cheap runtime mode, but `full` must be able to
    // enforce exactly what it advertises — otherwise the contract is a lie no
    // configuration can honour.
    const pattern = new RegExp(String(schemas.memory.jsonSchema().pattern));
    setValidationMode('full');
    for (const value of ['mem_garbage', "mem_' OR 1=1--"]) {
      expect(pattern.test(value)).toBe(false);
      expect(schemas.memory.schema.safeParse(value).success).toBe(false);
    }
  });
});
