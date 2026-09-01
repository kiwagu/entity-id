import { describe, expect, it } from 'vitest';

import {
  CROCKFORD_CLASS,
  createEntityId,
  RAND_LENGTH,
  TS_LENGTH,
} from './entity-id.js';
import { PREFIX_PATTERN } from './prefix.js';
import {
  ENTITY_ID_SQL,
  entityIdCheckSql,
  entityIdColumnSql,
  entityIdDefaultSql,
  entityIdTimeIndexSql,
  entityIdTimeOrderSql,
} from './sql.js';

/**
 * The TypeScript and SQL sides of the contract are written twice — once in
 * `src/`, once in `sql/entity_id_generate.sql` — so these tests assert the two
 * never drift. A full behavioural cross-check against a live PostgreSQL
 * instance lives in `scripts/verify-sql-crosscheck.sh`.
 */
describe('SQL / TypeScript contract sync', () => {
  it('embeds the migration text', () => {
    expect(ENTITY_ID_SQL).toContain(
      'create or replace function public.entity_id_generate'
    );
    expect(ENTITY_ID_SQL).toContain('public.is_entity_id');
    expect(ENTITY_ID_SQL).toContain('public.is_entity_id_with_prefix');
  });

  it('uses the same prefix pattern on both sides', () => {
    expect(ENTITY_ID_SQL).toContain(PREFIX_PATTERN);
  });

  it('uses the same Crockford character class on both sides', () => {
    // The SQL regex escapes the dot; the class itself must match verbatim.
    expect(ENTITY_ID_SQL).toContain(CROCKFORD_CLASS);
  });

  it('uses the same segment lengths on both sides', () => {
    expect(ENTITY_ID_SQL).toContain(`{${RAND_LENGTH}}`);
    expect(ENTITY_ID_SQL).toContain(`{${TS_LENGTH}}`);
  });

  it('declares the same lowercase Crockford alphabet', () => {
    expect(ENTITY_ID_SQL).toContain('0123456789abcdefghjkmnpqrstvwxyz');
  });

  it('requires no extension, so it applies on a managed instance', () => {
    expect(ENTITY_ID_SQL).not.toContain('create extension');
    expect(ENTITY_ID_SQL).not.toContain('gen_random_bytes');
    expect(ENTITY_ID_SQL).toContain('gen_random_uuid()');
  });

  it('pins search_path on every function it defines', () => {
    const definitions =
      ENTITY_ID_SQL.match(/create or replace function/g) ?? [];
    const guards = ENTITY_ID_SQL.match(/set search_path = ''/g) ?? [];
    expect(definitions.length).toBeGreaterThan(0);
    expect(guards).toHaveLength(definitions.length);
  });
});

describe('entityIdColumnSql', () => {
  it('builds a primary-key column with a default and a CHECK', () => {
    const sql = entityIdColumnSql('usr');
    expect(sql).toBe(
      "id text primary key default public.entity_id_generate('usr') " +
        "check (public.is_entity_id_with_prefix(id, 'usr'))"
    );
  });

  it('honours a custom column name', () => {
    expect(entityIdColumnSql('usr', 'user_id')).toContain('user_id text');
  });

  it('normalizes the prefix', () => {
    expect(entityIdColumnSql('  USR ')).toContain("'usr'");
  });

  it('rejects an invalid prefix or column name', () => {
    expect(() => entityIdColumnSql('1bad')).toThrow();
    expect(() => entityIdColumnSql('usr', 'id; drop table users')).toThrow();
    expect(() => entityIdColumnSql('usr', "id'")).toThrow();
  });
});

describe('entityIdDefaultSql and entityIdCheckSql', () => {
  it('render the generator and validator calls', () => {
    expect(entityIdDefaultSql('ord')).toBe("public.entity_id_generate('ord')");
    expect(entityIdCheckSql('id', 'ord')).toBe(
      "public.is_entity_id_with_prefix(id, 'ord')"
    );
  });

  it('reject an invalid prefix rather than interpolating it', () => {
    expect(() => entityIdDefaultSql("x'); drop table t; --")).toThrow();
    expect(() => entityIdCheckSql('id', "x'")).toThrow();
  });
});

describe('entityIdTimeOrderSql and entityIdTimeIndexSql', () => {
  it('renders the ordering expression', () => {
    expect(entityIdTimeOrderSql()).toBe('public.entity_id_ts_of(id)');
    expect(entityIdTimeOrderSql('event_id')).toBe(
      'public.entity_id_ts_of(event_id)'
    );
  });

  it('renders a re-runnable index statement by default', () => {
    expect(entityIdTimeIndexSql('events')).toBe(
      'create index if not exists events_id_ts_idx ' +
        'on events (public.entity_id_ts_of(id) desc)'
    );
  });

  it('honours every option', () => {
    expect(
      entityIdTimeIndexSql('events', {
        column: 'event_id',
        name: 'custom_idx',
        direction: 'asc',
        concurrently: true,
        ifNotExists: false,
      })
    ).toBe(
      'create index concurrently custom_idx ' +
        'on events (public.entity_id_ts_of(event_id) asc)'
    );
  });

  it('rejects a hostile identifier in any position', () => {
    expect(() => entityIdTimeIndexSql('events; drop table t')).toThrow(
      /table name/i
    );
    expect(() =>
      entityIdTimeIndexSql('events', { column: 'id; drop table t' })
    ).toThrow(/column name/i);
    expect(() =>
      entityIdTimeIndexSql('events', { name: 'i; drop table t' })
    ).toThrow(/index name/i);
    expect(() => entityIdTimeOrderSql('id; drop table t')).toThrow(
      /column name/i
    );
  });

  it('rejects an invalid direction', () => {
    expect(() =>
      entityIdTimeIndexSql('events', {
        direction: 'sideways' as 'asc' | 'desc',
      })
    ).toThrow(/direction/i);
  });

  it('targets the function the migration installs', () => {
    // The generated statement is worthless if the migration does not define
    // the function it calls.
    expect(ENTITY_ID_SQL).toContain(
      'create or replace function public.entity_id_ts_of'
    );
    expect(ENTITY_ID_SQL).toContain('immutable');
    expect(entityIdTimeIndexSql('events')).toContain('public.entity_id_ts_of(');
  });

  it('orders by a suffix whose lexicographic order is chronological', () => {
    // The property the whole index rests on, asserted in TypeScript so a
    // format change cannot silently break it.
    const ids = [0, 1_000, 1_700_000_000_000, 2_000_000_000_000].map((timeMs) =>
      createEntityId('evt', { timeMs, monotonic: false })
    );
    const suffixes = ids.map((id) => id.slice(id.indexOf('.') + 1));
    const sorted = [...suffixes].sort();
    expect(sorted).toEqual(suffixes);
  });
});

describe('the SQL regex matches ids this package mints', () => {
  it('accepts real ids and rejects malformed ones', () => {
    // Mirror the exact regex the SQL validator uses.
    const sqlPattern = new RegExp(
      `^${PREFIX_PATTERN}_${CROCKFORD_CLASS}{${RAND_LENGTH}}\\.${CROCKFORD_CLASS}{${TS_LENGTH}}$`
    );
    for (let i = 0; i < 100; i++) {
      expect(sqlPattern.test(createEntityId('usr'))).toBe(true);
    }
    expect(sqlPattern.test(createEntityId('usr', { timeMs: 0 }))).toBe(true);
    expect(sqlPattern.test('not-an-id')).toBe(false);
    expect(sqlPattern.test('usr_short.0000000000')).toBe(false);
  });
});
