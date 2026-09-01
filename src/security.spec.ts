import { describe, expect, it } from 'vitest';

import {
  createEntityId,
  isEntityId,
  parseEntityId,
  safeParseEntityId,
} from './entity-id.js';
import { normalizePrefix } from './prefix.js';
import { defineEntityPrefixes } from './registry.js';
import {
  entityIdCheckSql,
  entityIdColumnSql,
  entityIdDefaultSql,
} from './sql.js';

/**
 * Adversarial tests. Every case here either reproduces a real defect found by a
 * security review, or pins a property an attacker would try to break.
 */

describe('SQL injection', () => {
  // REGRESSION: entityIdCheckSql concatenated the column name without any
  // validation, so `entityIdCheckSql('id; drop table t', 'usr')` emitted the
  // injected SQL verbatim. entityIdColumnSql validated it; the two disagreed.
  const HOSTILE_COLUMNS = [
    'id; drop table t',
    'id"',
    "id'",
    'id--',
    'id/*',
    '1id',
    'ID',
    'id name',
    'id)',
    '',
    'id\n',
    'ідентифікатор',
  ];

  it.each(HOSTILE_COLUMNS)(
    'entityIdCheckSql rejects the column %j',
    (column) => {
      expect(() => entityIdCheckSql(column, 'usr')).toThrow(/column name/i);
    }
  );

  it.each(HOSTILE_COLUMNS)(
    'entityIdColumnSql rejects the column %j',
    (column) => {
      expect(() => entityIdColumnSql('usr', column)).toThrow(/column name/i);
    }
  );

  it('rejects an over-long identifier PostgreSQL would truncate', () => {
    expect(() => entityIdCheckSql('a'.repeat(64), 'usr')).toThrow(/63/);
    expect(entityIdCheckSql('a'.repeat(63), 'usr')).toContain('a'.repeat(63));
  });

  it.each([
    "usr'); drop table users; --",
    'usr" or "1"="1',
    'usr\\',
    "usr'",
    'usr;',
    'usr--',
    'usr /*',
  ])('every SQL helper rejects the prefix %j', (prefix) => {
    expect(() => entityIdColumnSql(prefix)).toThrow();
    expect(() => entityIdDefaultSql(prefix)).toThrow();
    expect(() => entityIdCheckSql('id', prefix)).toThrow();
  });

  it('emits no quotes or semicolons beyond its own literal', () => {
    const sql = entityIdColumnSql('usr', 'user_id');
    // Two single-quoted prefix literals, nothing else quoted, no statement break.
    expect(sql.match(/'/g)).toHaveLength(4);
    expect(sql).not.toContain(';');
    expect(sql).not.toContain('--');
  });
});

describe('ReDoS resistance', () => {
  // Every quantifier in the id patterns is bounded, so matching stays linear.
  // A regression to an unbounded group would make these time out.
  it.each([
    ['a long prefix-like head', `${'a'.repeat(50_000)}_`],
    ['a long near-miss body', `usr_${'0'.repeat(50_000)}`],
    ['a flood of separators', `usr_${'0'.repeat(16)}${'.'.repeat(50_000)}`],
    ['a flood of underscores', '_'.repeat(50_000)],
    [
      'a valid id with a long tail',
      `usr_${'0'.repeat(16)}.${'0'.repeat(10)}${'x'.repeat(50_000)}`,
    ],
  ])('stays fast on %s', (_label, payload) => {
    const started = performance.now();
    for (let i = 0; i < 100; i++) {
      isEntityId(payload, { mode: 'full' });
      isEntityId(payload, { mode: 'mixed' });
      safeParseEntityId(payload, { mode: 'full' });
    }
    // Linear matching finishes in single-digit milliseconds; catastrophic
    // backtracking would blow well past this.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('prototype pollution', () => {
  it('never writes to Object.prototype', () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": true}, "user": "usr"}'
    ) as Record<string, string>;

    // The kind is rejected outright, but assert the global invariant too.
    expect(() => defineEntityPrefixes(hostile)).toThrow(/Reserved entity kind/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects %s as an entity kind',
    (kind) => {
      const map = JSON.parse(`{"${kind}": "aaa"}`) as Record<string, string>;
      expect(() => defineEntityPrefixes(map)).toThrow(/Reserved entity kind/);
    }
  );

  it('does not treat an inherited property as a registered kind', () => {
    const registry = defineEntityPrefixes({ user: 'usr' } as const);
    expect(registry.isKind('toString')).toBe(false);
    expect(registry.isKind('hasOwnProperty')).toBe(false);
    expect(registry.isKind('valueOf')).toBe(false);
  });

  it('rejects __proto__ as a prefix, but allows other reserved-looking words', () => {
    // `__proto__` fails the prefix pattern anyway (underscores are not
    // allowed). `constructor` and `prototype` are ordinary words that happen
    // to name Object members — and they are safe as PREFIX VALUES, because
    // prefixes are only ever used as Map keys and string comparisons, never
    // as plain-object keys. Verified: no prototype is reachable through them.
    expect(() => {
      normalizePrefix('__proto__');
    }).toThrow();

    expect(normalizePrefix('constructor')).toBe('constructor');
    expect(normalizePrefix('prototype')).toBe('prototype');

    const registry = defineEntityPrefixes({
      ctor: 'constructor',
      user: 'usr',
    } as const);
    const id = registry.ids.ctor.create();

    expect(registry.kindOf(id)).toBe('ctor');
    expect(registry.ids.user.is(id)).toBe(false);
    // A prototype member name must not masquerade as a registered prefix.
    expect(registry.isRegisteredPrefix('toString')).toBe(false);
    expect(registry.kindForPrefix('toString')).toBeUndefined();
    expect(({} as Record<string, unknown>).ctor).toBeUndefined();
  });
});

describe('type confusion', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}],
    ['an array', []],
    ['a thenable-looking object', { then: () => undefined }],
    [
      'an object with a malicious toString',
      { toString: () => createEntityId('usr') },
    ],
    [
      'a symbol-keyed object',
      { [Symbol.iterator]: (): undefined => undefined },
    ],
  ])('isEntityId rejects %s in every mode', (_label, value) => {
    for (const mode of ['fast', 'mixed', 'full'] as const) {
      expect(isEntityId(value, { mode })).toBe(false);
    }
  });

  it('parseEntityId does not coerce a non-string into an id', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(() => parseEntityId(value as never, { mode: 'full' })).toThrow();
    }
  });
});

describe('randomness quality', () => {
  it('produces no duplicates across a large batch', () => {
    const count = 50_000;
    const ids = new Set(
      Array.from({ length: count }, () => createEntityId('usr'))
    );
    expect(ids.size).toBe(count);
  });

  it('spreads the random segment across the alphabet', () => {
    // Monotonic generation (the default) INCREMENTS the random field within a
    // millisecond, so only the low-order characters churn — measuring the
    // high-order one would be testing the increment, not the entropy. Sample
    // the last position, and check a full re-seed separately.
    const monotonicTail = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const { rand } = parseEntityId(createEntityId('usr'));
      monotonicTail.add(rand[rand.length - 1]!);
    }
    expect(monotonicTail.size).toBe(32);

    // A fresh seed per id must vary every position; a constant or broken
    // CSPRNG would collapse this.
    const perPosition = Array.from({ length: 16 }, () => new Set<string>());
    for (let i = 0; i < 1_000; i++) {
      const { rand } = parseEntityId(
        createEntityId('usr', { monotonic: false })
      );
      for (let p = 0; p < 16; p++) perPosition[p]!.add(rand[p]!);
    }
    for (const position of perPosition) {
      expect(position.size).toBeGreaterThan(28);
    }
  });

  it('increases strictly within a millisecond, without repeating', () => {
    // The monotonic guarantee itself: same timestamp, ordered random field.
    const ids = Array.from({ length: 5_000 }, () => createEntityId('usr'));
    expect(new Set(ids).size).toBe(ids.length);

    for (let i = 1; i < ids.length; i++) {
      const previous = parseEntityId(ids[i - 1]!);
      const current = parseEntityId(ids[i]!);
      if (previous.ts === current.ts) {
        expect(current.rand > previous.rand).toBe(true);
      }
    }
  });

  it('does not leak the timestamp into the random segment', () => {
    const timeMs = 1_700_000_000_000;
    const a = parseEntityId(
      createEntityId('usr', { timeMs, monotonic: false })
    );
    const b = parseEntityId(
      createEntityId('usr', { timeMs, monotonic: false })
    );
    expect(a.ts).toBe(b.ts);
    expect(a.rand).not.toBe(b.rand);
  });
});

describe('input hygiene', () => {
  it.each([
    ['a NUL byte', 'usr\u0000'],
    ['a newline in the middle', 'us\nr'],
    ['a full-width homoglyph', 'ｕｓｒ'],
    ['a right-to-left override', 'usr\u202e'],
    ['a zero-width space', 'u\u200bsr'],
  ])('normalizePrefix rejects %s', (_label: string, prefix: string) => {
    expect(() => {
      normalizePrefix(prefix);
    }).toThrow();
  });

  it('does not accept a homoglyph id as canonical', () => {
    // Cyrillic 'е' inside an otherwise valid-looking body.
    expect(
      isEntityId('usr_0123456789abcdеf.0123456789', { mode: 'full' })
    ).toBe(false);
  });
});
