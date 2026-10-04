import { afterEach, describe, expect, it } from 'vitest';

import {
  assertEntityId,
  assertEntityIdWithPrefix,
  createEntityId,
  entityIdToTimeMs,
  hasWellFormedPrefix,
  isEntityId,
  isEntityIdWithPrefix,
  normalizeEntityId,
  parseEntityId,
  safeParseEntityId,
} from './entity-id.js';
import {
  DEFAULT_VALIDATION_MODE,
  getModeProfile,
  getValidationMode,
  resetValidationMode,
  setAmbientModeResolver,
  setValidationMode,
  type ValidationMode,
  withValidationMode,
} from './mode.js';
import { EntityIdError } from './prefix.js';
import { defineEntityPrefixes } from './registry.js';
import { entityIdSchema, withSchemas } from './schema.js';

// The mode is process-wide, so every test restores it. A leaked mode would
// silently change the meaning of every later assertion in the run.
afterEach(() => {
  resetValidationMode();
});

const VALID = createEntityId('usr');
const WRONG_KIND = createEntityId('ord');
const WELL_PREFIXED_GARBAGE = 'usr_not-canonical';
const NO_PREFIX = 'not-an-id';

describe('mode selection', () => {
  it('defaults to mixed', () => {
    expect(getValidationMode()).toBe('mixed');
    expect(DEFAULT_VALIDATION_MODE).toBe('mixed');
  });

  it('setValidationMode returns the previous mode', () => {
    expect(setValidationMode('full')).toBe('mixed');
    expect(getValidationMode()).toBe('full');
    expect(setValidationMode('fast')).toBe('full');
  });

  it('rejects an unknown mode', () => {
    expect(() => setValidationMode('turbo' as ValidationMode)).toThrow(
      TypeError
    );
    // A rejected change must not leave the mode altered.
    expect(getValidationMode()).toBe('mixed');
  });

  it('withValidationMode restores the previous mode, even on throw', () => {
    setValidationMode('mixed');
    expect(() =>
      withValidationMode('full', () => {
        expect(getValidationMode()).toBe('full');
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(getValidationMode()).toBe('mixed');
  });

  it('withValidationMode returns the function result', () => {
    expect(withValidationMode('fast', () => 42)).toBe(42);
  });

  it('exposes a profile per mode', () => {
    expect(getModeProfile('fast')).toEqual({
      mode: 'fast',
      validation: 'none',
      fastDecode: true,
    });
    expect(getModeProfile('mixed').validation).toBe('prefix');
    expect(getModeProfile('full').validation).toBe('full');
    expect(getModeProfile('full').fastDecode).toBe(false);
  });

  it('profiles are frozen, so a mode cannot be mutated at a distance', () => {
    expect(Object.isFrozen(getModeProfile('mixed'))).toBe(true);
  });
});

describe('fast mode', () => {
  it('accepts anything, validating nothing', () => {
    withValidationMode('fast', () => {
      expect(isEntityId(VALID)).toBe(true);
      expect(isEntityId(NO_PREFIX)).toBe(true);
      expect(isEntityId('')).toBe(true);
      // Even a swapped kind passes: fast trusts the caller entirely.
      expect(isEntityIdWithPrefix(WRONG_KIND, 'usr')).toBe(true);
    });
  });

  it('still rejects a non-string', () => {
    withValidationMode('fast', () => {
      expect(isEntityId(42)).toBe(false);
      expect(isEntityId(null)).toBe(false);
      expect(isEntityId(undefined)).toBe(false);
    });
  });

  it('asserts without throwing, returning the value unchanged', () => {
    withValidationMode('fast', () => {
      expect(assertEntityId(NO_PREFIX)).toBe(NO_PREFIX);
      expect(assertEntityIdWithPrefix(WRONG_KIND, 'usr')).toBe(WRONG_KIND);
    });
  });

  it('decodes a real id correctly', () => {
    const timeMs = 1_700_000_000_000;
    const id = createEntityId('usr', { timeMs, monotonic: false });
    withValidationMode('fast', () => {
      const parsed = parseEntityId(id);
      expect(parsed.prefix).toBe('usr');
      expect(parsed.timeMs).toBe(timeMs);
      expect(parsed.rand).toHaveLength(16);
      expect(parsed.ts).toHaveLength(10);
    });
  });

  it('agrees with full mode on every well-formed id', () => {
    for (let i = 0; i < 200; i++) {
      const id = createEntityId('usr');
      const strict = parseEntityId(id, { mode: 'full' });
      const fast = parseEntityId(id, { mode: 'fast' });
      expect(fast).toEqual(strict);
    }
  });

  it('preserves the epoch through the fast decoder', () => {
    const id = createEntityId('usr', { timeMs: 0, monotonic: false });
    expect(parseEntityId(id, { mode: 'fast' }).timeMs).toBe(0);
  });

  it('yields nonsense rather than an error on garbage', () => {
    withValidationMode('fast', () => {
      // The documented trade-off: no error, no guarantee.
      const parsed = parseEntityId(NO_PREFIX);
      expect(parsed.prefix).toBe(NO_PREFIX);
      expect(Number.isNaN(parsed.timeMs)).toBe(true);
      expect(parsed.iso).toBe('');
    });
  });
});

describe('mixed mode (the default)', () => {
  it('accepts a well-formed prefix without inspecting the body', () => {
    withValidationMode('mixed', () => {
      expect(isEntityId(VALID)).toBe(true);
      expect(isEntityId(WELL_PREFIXED_GARBAGE)).toBe(true);
    });
  });

  it('rejects a value with no valid prefix head', () => {
    withValidationMode('mixed', () => {
      expect(isEntityId(NO_PREFIX)).toBe(false);
      expect(isEntityId('')).toBe(false);
      expect(isEntityId('_leading')).toBe(false);
      expect(isEntityId('U_uppercase')).toBe(false);
      expect(isEntityId('1digit_first')).toBe(false);
      expect(isEntityId('a_tooshort')).toBe(false);
    });
  });

  it('catches the mistake that matters: a swapped kind', () => {
    withValidationMode('mixed', () => {
      expect(isEntityIdWithPrefix(VALID, 'usr')).toBe(true);
      expect(isEntityIdWithPrefix(WRONG_KIND, 'usr')).toBe(false);
      expect(() => assertEntityIdWithPrefix(WRONG_KIND, 'usr')).toThrow(
        EntityIdError
      );
    });
  });

  it('does not normalize, which is why it is cheap', () => {
    const id = createEntityId('usr');
    const [prefix, body] = id.split('_');
    const mixed = `${prefix}_${(body ?? '').toUpperCase()}`;
    withValidationMode('mixed', () => {
      expect(assertEntityId(mixed)).toBe(mixed);
    });
  });

  it('throws a helpful error for a missing prefix head', () => {
    withValidationMode('mixed', () => {
      expect(() => assertEntityId(NO_PREFIX)).toThrow(/"<prefix>_" head/);
    });
  });
});

describe('full mode', () => {
  it('enforces every rule', () => {
    withValidationMode('full', () => {
      expect(isEntityId(VALID)).toBe(true);
      expect(isEntityId(WELL_PREFIXED_GARBAGE)).toBe(false);
      expect(isEntityId(NO_PREFIX)).toBe(false);
      // `u` is outside the Crockford alphabet.
      expect(isEntityId('usr_tsv4rrffq69g5fau.01arz3ndek')).toBe(false);
      // Wrong segment lengths.
      expect(isEntityId('usr_tsv4rrffq69g5fa.01arz3ndek')).toBe(false);
      expect(isEntityId('usr_tsv4rrffq69g5fav.01arz3nde')).toBe(false);
    });
  });

  it('normalizes on assert', () => {
    const id = createEntityId('usr');
    const [prefix, body] = id.split('_');
    const mixed = `${prefix}_${(body ?? '').toUpperCase()}`;
    withValidationMode('full', () => {
      expect(assertEntityId(mixed)).toBe(id);
    });
  });
});

describe('per-call override', () => {
  it('beats the active mode in both directions', () => {
    setValidationMode('fast');
    expect(isEntityId(NO_PREFIX)).toBe(true);
    expect(isEntityId(NO_PREFIX, { mode: 'full' })).toBe(false);

    setValidationMode('full');
    expect(isEntityId(WELL_PREFIXED_GARBAGE)).toBe(false);
    expect(isEntityId(WELL_PREFIXED_GARBAGE, { mode: 'mixed' })).toBe(true);
  });

  it('does not leak into the active mode', () => {
    setValidationMode('mixed');
    isEntityId(VALID, { mode: 'full' });
    expect(getValidationMode()).toBe('mixed');
  });

  it('is honoured by safeParseEntityId and the time accessors', () => {
    setValidationMode('fast');
    expect(safeParseEntityId(NO_PREFIX, { mode: 'full' })).toBeUndefined();
    expect(() => entityIdToTimeMs(NO_PREFIX, { mode: 'full' })).toThrow(
      EntityIdError
    );
  });
});

describe('mode-independent behaviour', () => {
  it('createEntityId always mints a canonical id', () => {
    for (const mode of ['fast', 'mixed', 'full'] as const) {
      withValidationMode(mode, () => {
        expect(isEntityId(createEntityId('usr'), { mode: 'full' })).toBe(true);
      });
    }
  });

  it('normalizeEntityId stays strict in every mode', () => {
    for (const mode of ['fast', 'mixed', 'full'] as const) {
      withValidationMode(mode, () => {
        expect(() => normalizeEntityId(NO_PREFIX)).toThrow(EntityIdError);
        expect(normalizeEntityId(VALID)).toBe(VALID);
      });
    }
  });

  it('the registry rejects a duplicate prefix in every mode', () => {
    for (const mode of ['fast', 'mixed', 'full'] as const) {
      withValidationMode(mode, () => {
        expect(() =>
          defineEntityPrefixes({ program: 'prg', progress: 'prg' } as const)
        ).toThrow(/Duplicate entity prefix/);
      });
    }
  });

  it('the registry still routes a known prefix in fast mode', () => {
    const registry = defineEntityPrefixes({ user: 'usr' } as const);
    withValidationMode('fast', () => {
      expect(registry.kindOf(registry.ids.user.create())).toBe('user');
      expect(registry.kindOf('zzz_whatever')).toBeUndefined();
    });
  });
});

describe('setAmbientModeResolver', () => {
  // The extension point documented for browsers, where no AsyncLocalStorage
  // exists: a consumer can plug in their own scope provider (a future
  // AsyncContext.Variable, or anything else) and the core will consult it.
  afterEach(() => {
    setAmbientModeResolver(undefined);
  });

  it('lets a custom provider supply the mode', () => {
    let current: ValidationMode | undefined;
    setAmbientModeResolver(() => current);

    current = 'full';
    expect(getValidationMode()).toBe('full');
    expect(isEntityId('usr_not-canonical')).toBe(false);

    current = 'fast';
    expect(isEntityId('anything')).toBe(true);
  });

  it('falls back to the process-wide mode when the provider returns nothing', () => {
    setAmbientModeResolver(() => undefined);
    setValidationMode('mixed');
    expect(getValidationMode()).toBe('mixed');
  });

  it('is still overridden by a per-call mode', () => {
    setAmbientModeResolver(() => 'fast');
    expect(isEntityId('nope')).toBe(true);
    expect(isEntityId('nope', { mode: 'full' })).toBe(false);
  });

  it('can be uninstalled', () => {
    setAmbientModeResolver(() => 'full');
    expect(getValidationMode()).toBe('full');
    setAmbientModeResolver(undefined);
    expect(getValidationMode()).toBe('mixed');
  });
});

describe('initialization order does not matter', () => {
  // Schemas and registries are often built at module load, before an
  // application's bootstrap runs. The mode is read at CALL time, so a later
  // setValidationMode still governs objects created earlier. Without this
  // guarantee, users would have to police their import order.
  const earlyRegistry = defineEntityPrefixes({ user: 'usr' } as const);
  const earlySchema = withSchemas(earlyRegistry).user.schema;
  const HALF_VALID = 'usr_not-canonical';

  it('a schema built before setValidationMode obeys it afterwards', () => {
    expect(earlySchema.safeParse(HALF_VALID).success).toBe(true); // mixed
    setValidationMode('full');
    expect(earlySchema.safeParse(HALF_VALID).success).toBe(false);
  });

  it('a registry guard built earlier obeys it too', () => {
    expect(earlyRegistry.ids.user.is(HALF_VALID)).toBe(true); // mixed
    setValidationMode('full');
    expect(earlyRegistry.ids.user.is(HALF_VALID)).toBe(false);
  });

  it('the module-level entityIdSchema follows the mode as well', () => {
    setValidationMode('full');
    expect(entityIdSchema.safeParse(HALF_VALID).success).toBe(false);
    setValidationMode('fast');
    expect(entityIdSchema.safeParse(HALF_VALID).success).toBe(true);
  });
});

describe('hasWellFormedPrefix', () => {
  it.each([
    ['usr_x', true],
    ['ab_x', true],
    ['v2doc_x', true],
    ['a_x', false],
    ['_x', false],
    ['1ab_x', false],
    ['USR_x', false],
    ['no-underscore', false],
    ['toolongprefixhere_x', false],
  ])('%s -> %s', (value, expected) => {
    expect(hasWellFormedPrefix(value)).toBe(expected);
  });
});
