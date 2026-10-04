import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  assertEntityId,
  assertEntityIdWithPrefix,
  type BrandedEntityId,
  compareEntityIds,
  createEntityId,
  type EntityId,
  entityIdPartsToUlid,
  entityIdPrefix,
  entityIdToDate,
  entityIdToIso,
  entityIdToTimeMs,
  entityIdToTuple,
  entityIdTsToTimeMs,
  fromUlid,
  isEntityId,
  isEntityIdWithPrefix,
  normalizeEntityId,
  parseEntityId,
  RAND_LENGTH,
  safeParseEntityId,
  toUlid,
  TS_LENGTH,
  ulidToEntityIdParts,
  unsafeBrandEntityId,
} from './entity-id.js';
import { EntityIdError } from './prefix.js';

/** A canonical ULID from the ULID specification's own examples. */
const SAMPLE_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SAMPLE_TS = '01arz3ndek';
const SAMPLE_RAND = 'tsv4rrffq69g5fav';
const SAMPLE_TIME_MS = 1_469_922_850_259;

describe('createEntityId', () => {
  it('mints a "<prefix>_<rand16>.<ts10>" id that round-trips', () => {
    const id = createEntityId('usr');
    expect(isEntityId(id)).toBe(true);

    const parsed = parseEntityId(id);
    expect(parsed.prefix).toBe('usr');
    expect(parsed.rand).toHaveLength(RAND_LENGTH);
    expect(parsed.ts).toHaveLength(TS_LENGTH);
    expect(id.startsWith('usr_')).toBe(true);
  });

  it('embeds the provided timestamp, recoverable from the id', () => {
    // monotonic:false honours the seed; the default monotonic mode clamps a
    // past timestamp up to the process's last-seen time (it never goes back).
    const timeMs = 1_700_000_000_000;
    const id = createEntityId('usr', { timeMs, monotonic: false });
    expect(parseEntityId(id).timeMs).toBe(timeMs);
    expect(entityIdToTimeMs(id)).toBe(timeMs);
    expect(entityIdToDate(id).getTime()).toBe(timeMs);
    expect(entityIdToIso(id)).toBe(new Date(timeMs).toISOString());
  });

  it('is monotonic within the same millisecond', () => {
    const timeMs = 1_700_000_000_000;
    const a = createEntityId('ord', { timeMs });
    const b = createEntityId('ord', { timeMs });
    expect(a).not.toBe(b);
  });

  it('emits canonical lowercase output', () => {
    const id = createEntityId('usr');
    expect(id).toBe(id.toLowerCase());
  });

  it('produces unique ids in bulk', () => {
    const ids = new Set(
      Array.from({ length: 5_000 }, () => createEntityId('usr'))
    );
    expect(ids.size).toBe(5_000);
  });

  it('rejects an invalid prefix', () => {
    expect(() => createEntityId('1bad')).toThrow(EntityIdError);
    expect(() => createEntityId('a')).toThrow(EntityIdError);
    expect(() => createEntityId('waaaaaaaaaaaaaaaaaay-too-long')).toThrow(
      EntityIdError
    );
  });

  it('rejects a nonsensical timestamp', () => {
    expect(() => createEntityId('usr', { timeMs: -1 })).toThrow(EntityIdError);
    expect(() => createEntityId('usr', { timeMs: Number.NaN })).toThrow(
      EntityIdError
    );
  });

  it('preserves the Unix epoch as a timestamp', () => {
    // Regression: `ulid(0)` treats the seed as falsy and substitutes the
    // current time, which would silently lose an epoch timestamp.
    for (const monotonic of [true, false]) {
      const id = createEntityId('usr', { timeMs: 0, monotonic });
      expect(entityIdToTimeMs(id)).toBe(0);
      expect(entityIdToIso(id)).toBe('1970-01-01T00:00:00.000Z');
      expect(isEntityId(id)).toBe(true);
    }
  });

  it('round-trips a range of explicit timestamps', () => {
    for (const timeMs of [
      0, 1, 1_000, 1_469_922_850_259, 253_370_764_800_000,
    ]) {
      const id = createEntityId('usr', { timeMs, monotonic: false });
      expect(entityIdToTimeMs(id)).toBe(timeMs);
    }
  });
});

describe('ULID interoperability', () => {
  it('builds an id from an existing ULID, preserving its time', () => {
    const id = fromUlid('usr', SAMPLE_ULID);
    expect(id).toBe(`usr_${SAMPLE_RAND}.${SAMPLE_TS}`);
    expect(isEntityId(id)).toBe(true);
    expect(toUlid(id)).toBe(SAMPLE_ULID);
    expect(entityIdToTimeMs(id)).toBe(SAMPLE_TIME_MS);
  });

  it('splits and recombines ULID segments losslessly', () => {
    const parts = ulidToEntityIdParts(SAMPLE_ULID);
    expect(parts).toEqual({ ts: SAMPLE_TS, rand: SAMPLE_RAND });
    expect(entityIdPartsToUlid(parts)).toBe(SAMPLE_ULID);
  });

  it('rejects a malformed ULID', () => {
    expect(() => ulidToEntityIdParts('too-short')).toThrow(EntityIdError);
    // `U` is outside the Crockford alphabet.
    expect(() => ulidToEntityIdParts('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toThrow(
      EntityIdError
    );
    expect(() => entityIdPartsToUlid({ ts: 'short', rand: 'x' })).toThrow(
      EntityIdError
    );
  });
});

describe('parseEntityId', () => {
  it('decodes an id into parts, ULID and timestamp', () => {
    const id = fromUlid('ord', SAMPLE_ULID);
    expect(parseEntityId(id)).toEqual({
      prefix: 'ord',
      rand: SAMPLE_RAND,
      ts: SAMPLE_TS,
      ulid: SAMPLE_ULID,
      timeMs: SAMPLE_TIME_MS,
      iso: new Date(SAMPLE_TIME_MS).toISOString(),
    });
  });

  it('carries the creation time as an ISO string in every mode', () => {
    const id = createEntityId('usr', {
      timeMs: 1_700_000_000_000,
      monotonic: false,
    });
    const iso = entityIdToIso(id);
    expect(parseEntityId(id).iso).toBe(iso);
    expect(parseEntityId(id, { mode: 'fast' }).iso).toBe(iso);
    expect(parseEntityId(id, { mode: 'full' }).iso).toBe(iso);
    expect(safeParseEntityId(id)?.iso).toBe(iso);
  });

  it('serializes iso as plain data', () => {
    const id = createEntityId('usr', {
      timeMs: 1_700_000_000_000,
      monotonic: false,
    });
    const parsed = parseEntityId(id);
    expect(JSON.parse(JSON.stringify(parsed)).iso).toBe(entityIdToIso(id));
    const descriptor = Object.getOwnPropertyDescriptor(parsed, 'iso');
    expect(descriptor).toHaveProperty('value');
    expect(descriptor).not.toHaveProperty('get');
  });

  it('decodes the Unix epoch to its ISO string', () => {
    const id = createEntityId('usr', { timeMs: 0, monotonic: false });
    expect(parseEntityId(id).iso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('accepts mixed-case ULID segments and normalizes them', () => {
    const id = createEntityId('usr');
    const [prefix, body] = id.split('_');
    const mixed = `${prefix}_${(body ?? '').toUpperCase()}`;
    expect(normalizeEntityId(mixed)).toBe(id);
    expect(parseEntityId(mixed, { mode: 'full' }).rand).toBe(
      parseEntityId(id, { mode: 'full' }).rand
    );
  });

  it('throws an EntityIdError carrying the offending value', () => {
    try {
      parseEntityId('not-an-id', { mode: 'full' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EntityIdError);
      expect((error as EntityIdError).value).toBe('not-an-id');
      expect((error as EntityIdError).name).toBe('EntityIdError');
    }
  });

  it.each([
    ['empty', ''],
    ['no prefix', '_a1b2c3d4e5f6g7h8.01jd8x2p4q'],
    ['uppercase prefix', 'USR_tsv4rrffq69g5fav.01arz3ndek'],
    ['short rand', 'usr_tsv4rrffq69g5fa.01arz3ndek'],
    ['long rand', 'usr_tsv4rrffq69g5favv.01arz3ndek'],
    ['short ts', 'usr_tsv4rrffq69g5fav.01arz3nde'],
    ['missing dot', 'usr_tsv4rrffq69g5fav01arz3ndek'],
    ['ambiguous letter u', 'usr_tsv4rrffq69g5fau.01arz3ndek'],
    ['leading space', ' usr_tsv4rrffq69g5fav.01arz3ndek'],
    ['one-char prefix', 'u_tsv4rrffq69g5fav.01arz3ndek'],
  ])('rejects %s in full mode', (_label, value) => {
    const full = { mode: 'full' } as const;
    expect(isEntityId(value, full)).toBe(false);
    expect(() => parseEntityId(value, full)).toThrow(EntityIdError);
    expect(safeParseEntityId(value, full)).toBeUndefined();
  });

  it('safeParseEntityId returns the decoding instead of throwing', () => {
    const id = createEntityId('usr');
    expect(safeParseEntityId(id)?.prefix).toBe('usr');
    expect(safeParseEntityId('nope', { mode: 'full' })).toBeUndefined();
  });

  it('entityIdPrefix extracts the prefix', () => {
    expect(entityIdPrefix(createEntityId('ord'))).toBe('ord');
  });
});

describe('isEntityId', () => {
  it('narrows a string and rejects non-strings', () => {
    expect(isEntityId(createEntityId('usr'))).toBe(true);
    expect(isEntityId('not-an-id', { mode: 'full' })).toBe(false);
    expect(isEntityId(42)).toBe(false);
    expect(isEntityId(null)).toBe(false);
    expect(isEntityId(undefined)).toBe(false);
    expect(isEntityId({})).toBe(false);
  });
});

describe('prefix-aware runtime validation', () => {
  it('isEntityIdWithPrefix guards on a runtime prefix', () => {
    const id = createEntityId('usr');
    expect(isEntityIdWithPrefix(id, 'usr')).toBe(true);
    expect(isEntityIdWithPrefix(id, 'ord')).toBe(false);
    expect(isEntityIdWithPrefix('not-an-id', 'usr')).toBe(false);
  });

  it('does not confuse a prefix with a longer one sharing its head', () => {
    const id = createEntityId('usr');
    expect(isEntityIdWithPrefix(id, 'us')).toBe(false);
    const longer = createEntityId('usrx');
    expect(isEntityIdWithPrefix(longer, 'usr')).toBe(false);
  });

  it('assertEntityIdWithPrefix returns the normalized id or throws', () => {
    const id = createEntityId('usr');
    expect(assertEntityIdWithPrefix(id, 'usr')).toBe(normalizeEntityId(id));
    expect(() => assertEntityIdWithPrefix(id, 'ord')).toThrow(/prefix "ord_"/);
  });

  it('assertEntityId validates without a prefix requirement', () => {
    const id = createEntityId('usr');
    expect(assertEntityId(id)).toBe(id);
    expect(() => assertEntityId('nope')).toThrow(EntityIdError);
    expect(() => assertEntityId('nope', { mode: 'full' })).toThrow(
      EntityIdError
    );
  });
});

describe('entityIdTsToTimeMs', () => {
  it('decodes a bare time segment', () => {
    expect(entityIdTsToTimeMs(SAMPLE_TS)).toBe(SAMPLE_TIME_MS);
    expect(entityIdTsToTimeMs(` ${SAMPLE_TS.toUpperCase()} `)).toBe(
      SAMPLE_TIME_MS
    );
  });

  it('rejects a malformed segment', () => {
    expect(() => entityIdTsToTimeMs('short')).toThrow(EntityIdError);
    expect(() => entityIdTsToTimeMs('01arz3ndeu')).toThrow(EntityIdError);
  });
});

describe('entityIdToTuple', () => {
  it('flattens an id into [prefix, rand, iso, timeMs]', () => {
    const id = fromUlid('usr', SAMPLE_ULID);
    expect(entityIdToTuple(id)).toEqual([
      'usr',
      SAMPLE_RAND,
      new Date(SAMPLE_TIME_MS).toISOString(),
      SAMPLE_TIME_MS,
    ]);
  });
});

describe('compareEntityIds', () => {
  it('orders chronologically in "time" mode', () => {
    const older = createEntityId('usr', {
      timeMs: 1_600_000_000_000,
      monotonic: false,
    });
    const newer = createEntityId('usr', {
      timeMs: 1_700_000_000_000,
      monotonic: false,
    });
    expect(compareEntityIds(older, newer, 'time')).toBeLessThan(0);
    expect(compareEntityIds(newer, older, 'time')).toBeGreaterThan(0);
    expect(compareEntityIds(older, older, 'time')).toBe(0);
  });

  it('falls back to the ULID for ids minted in the same millisecond', () => {
    const timeMs = 1_700_000_000_000;
    const a = createEntityId('usr', { timeMs });
    const b = createEntityId('usr', { timeMs });
    const ordered = [b, a].sort((x, y) => compareEntityIds(x, y, 'time'));
    // A total order: the comparison is antisymmetric and never zero here.
    expect(compareEntityIds(a, b, 'time')).not.toBe(0);
    expect(ordered).toHaveLength(2);
  });

  it('sorts lexicographically in the default "string" mode', () => {
    const ids = ['usr_b.b', 'usr_a.a'];
    expect(compareEntityIds(ids[0]!, ids[1]!)).toBeGreaterThan(0);
    // The default mode never decodes, so it tolerates non-canonical input.
    expect(compareEntityIds('a', 'a')).toBe(0);
  });

  it('is a valid comparator for Array.prototype.sort', () => {
    const base = 1_700_000_000_000;
    const ids = [4, 1, 3, 2].map((offset) =>
      createEntityId('usr', { timeMs: base + offset, monotonic: false })
    );
    const sorted = [...ids].sort((a, b) => compareEntityIds(a, b, 'time'));
    expect(sorted.map((v) => entityIdToTimeMs(v))).toEqual([
      base + 1,
      base + 2,
      base + 3,
      base + 4,
    ]);
  });
});

describe('branded types', () => {
  it('unsafeBrandEntityId casts without validating', () => {
    // Deliberately not a valid id: the cast performs no runtime check.
    const branded = unsafeBrandEntityId('anything');
    expect(branded).toBe('anything');
  });

  it('keeps distinct brands mutually unassignable at compile time', () => {
    type UserId = BrandedEntityId<'user'>;
    type OrderId = BrandedEntityId<'order'>;

    const userId = unsafeBrandEntityId<'user'>(createEntityId('usr'));
    expectTypeOf(userId).toEqualTypeOf<UserId>();
    expectTypeOf<UserId>().not.toEqualTypeOf<OrderId>();
    // A branded id is still usable wherever an EntityId is expected.
    expectTypeOf<UserId>().toExtend<EntityId>();
    // A plain string is not assignable to a branded id.
    expectTypeOf<string>().not.toExtend<EntityId>();
  });

  it('createEntityId returns an EntityId, not a plain string', () => {
    expectTypeOf(createEntityId('usr')).toEqualTypeOf<EntityId>();
    expectTypeOf(parseEntityId(createEntityId('usr')).prefix).toBeString();
  });
});
