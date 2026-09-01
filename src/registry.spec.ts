import { describe, expect, expectTypeOf, it } from 'vitest';

import { createEntityId, type EntityId } from './entity-id.js';
import { withValidationMode } from './mode.js';
import { EntityIdError } from './prefix.js';
import { defineEntityPrefixes, type EntityIdOf } from './registry.js';

const registry = defineEntityPrefixes({
  user: 'usr',
  order: 'ord',
  orderLine: 'orl',
} as const);

type UserId = EntityIdOf<typeof registry.prefixes, 'user'>;
type OrderId = EntityIdOf<typeof registry.prefixes, 'order'>;

describe('defineEntityPrefixes', () => {
  it('exposes the map, kinds and sorted prefixes', () => {
    expect(registry.prefixes).toEqual({
      user: 'usr',
      order: 'ord',
      orderLine: 'orl',
    });
    expect(registry.kinds).toEqual(['user', 'order', 'orderLine']);
    expect(registry.allPrefixes).toEqual(['ord', 'orl', 'usr']);
  });

  it('rejects a duplicate prefix, naming both claimants', () => {
    expect(() =>
      defineEntityPrefixes({ program: 'prg', progress: 'prg' } as const)
    ).toThrow(/Duplicate entity prefix "prg".*program.*progress/s);
  });

  it('rejects a malformed prefix, naming the kind', () => {
    expect(() => defineEntityPrefixes({ user: 'U' } as const)).toThrow(
      /Invalid prefix "U" for kind "user"/
    );
    expect(() => defineEntityPrefixes({ user: '1bad' } as const)).toThrow(
      EntityIdError
    );
  });

  it('rejects an empty registry', () => {
    expect(() => defineEntityPrefixes({} as const)).toThrow(EntityIdError);
  });

  it('is frozen against accidental mutation', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.ids)).toBe(true);
    expect(Object.isFrozen(registry.ids.user)).toBe(true);
  });
});

describe('registry lookups', () => {
  it('prefixFor resolves a kind', () => {
    expect(registry.prefixFor('user')).toBe('usr');
    expectTypeOf(registry.prefixFor('user')).toEqualTypeOf<'usr'>();
  });

  it('isKind and isRegisteredPrefix narrow correctly', () => {
    expect(registry.isKind('user')).toBe(true);
    expect(registry.isKind('nope')).toBe(false);
    expect(registry.isRegisteredPrefix('usr')).toBe(true);
    expect(registry.isRegisteredPrefix('xyz')).toBe(false);
    // Inherited object properties must not count as kinds.
    expect(registry.isKind('toString')).toBe(false);
    expect(registry.isKind('constructor')).toBe(false);
  });

  it('kindForPrefix maps a prefix back to its kind', () => {
    expect(registry.kindForPrefix('orl')).toBe('orderLine');
    expect(registry.kindForPrefix('zzz')).toBeUndefined();
  });

  it('kindOf routes a real id back to its kind', () => {
    expect(registry.kindOf(registry.ids.user.create())).toBe('user');
    expect(registry.kindOf(registry.ids.orderLine.create())).toBe('orderLine');
  });

  it('kindOf returns undefined for an unregistered or malformed id', () => {
    expect(registry.kindOf(createEntityId('zzz'))).toBeUndefined();
    expect(registry.kindOf('no-underscore')).toBeUndefined();
    expect(registry.kindOf('')).toBeUndefined();
    expect(registry.kindOf('_leading')).toBeUndefined();
    // A registered prefix with a non-canonical body routes in 'mixed' (the
    // prefix is what routing needs) but not under full validation.
    expect(registry.kindOf('usr_not-canonical')).toBe('user');
    withValidationMode('full', () => {
      expect(registry.kindOf('usr_not-canonical')).toBeUndefined();
    });
  });

  it('assertKnown accepts a registered id and rejects others', () => {
    const id = registry.ids.order.create();
    expect(registry.assertKnown(id)).toBe(id);
    // An unregistered prefix is rejected in every mode: that check is the
    // registry's own, not the validator's.
    expect(() => registry.assertKnown(createEntityId('zzz'))).toThrow(
      /Unregistered entity prefix/
    );
    withValidationMode('fast', () => {
      expect(() => registry.assertKnown(createEntityId('zzz'))).toThrow(
        /Unregistered entity prefix/
      );
    });
    withValidationMode('full', () => {
      expect(() => registry.assertKnown('usr_broken')).toThrow(EntityIdError);
    });
  });
});

describe('per-kind toolkit', () => {
  const { user, order } = registry.ids;

  it('carries its kind and prefix', () => {
    expect(user.kind).toBe('user');
    expect(user.prefix).toBe('usr');
    expectTypeOf(user.prefix).toEqualTypeOf<'usr'>();
  });

  it('creates ids with the right prefix', () => {
    const id = user.create();
    expect(id.startsWith('usr_')).toBe(true);
    expect(user.is(id)).toBe(true);
    expect(order.is(id)).toBe(false);
  });

  it('honours create options', () => {
    const timeMs = 1_700_000_000_000;
    const id = user.create({ timeMs, monotonic: false });
    expect(registry.kindOf(id)).toBe('user');
  });

  it('asserts at a boundary', () => {
    const id = user.create();
    expect(user.assert(id)).toBe(id);
    expect(() => order.assert(id)).toThrow(/prefix "ord_"/);
    expect(() => user.assert('garbage')).toThrow(EntityIdError);
  });

  it('parses through its strict schema', () => {
    const id = user.create();
    expect(user.schema.parse(id)).toBe(id);
    expect(user.schema.safeParse(order.create()).success).toBe(false);
  });

  it('tolerates placeholders through its prefix schema', () => {
    expect(user.prefixSchema.parse('usr_fixture')).toBe('usr_fixture');
    expect(user.prefixSchema.safeParse('ord_fixture').success).toBe(false);
  });

  it('emits a JSON Schema carrying its prefix', () => {
    const output = user.jsonSchema();
    expect(output.type).toBe('string');
    expect(String(output.pattern)).toContain('usr_');
    expect(new RegExp(String(output.pattern)).test(user.create())).toBe(true);

    const input = user.jsonSchema('input');
    expect(String(input.pattern)).toContain('A-HJKMNP-TV-Z');
  });

  it('brands without validating, for trusted construction', () => {
    expect(user.brand('usr_seeded')).toBe('usr_seeded');
  });

  it('keeps kinds mutually unassignable at compile time', () => {
    const userId = user.create();
    const orderId = order.create();

    expectTypeOf(userId).toEqualTypeOf<UserId>();
    expectTypeOf(orderId).toEqualTypeOf<OrderId>();
    expectTypeOf<UserId>().not.toEqualTypeOf<OrderId>();
    expectTypeOf<UserId>().toExtend<EntityId>();

    // @ts-expect-error a UserId is not an OrderId
    const wrong: OrderId = userId;
    expect(typeof wrong).toBe('string');
  });

  it('narrows through its type guard', () => {
    const value: string = user.create();
    if (user.is(value)) {
      expectTypeOf(value).toExtend<UserId>();
    }
  });
});

describe('lazy schema members', () => {
  // The Zod-backed members are getters so `defineEntityPrefixes` does not build
  // two schemas per kind up front. Caching must be per member and per kind, and
  // identity must be stable — a schema rebuilt on every access would break
  // `z.infer` narrowing and any Map keyed by it.
  it('returns a stable instance across accesses', () => {
    const registry = defineEntityPrefixes({ user: 'usr' });
    const first = registry.ids.user.schema;
    expect(registry.ids.user.schema).toBe(first);
  });

  it('caches prefixSchema separately from schema', () => {
    const registry = defineEntityPrefixes({ user: 'usr' });
    const schema = registry.ids.user.schema;
    const prefixSchema = registry.ids.user.prefixSchema;
    expect(prefixSchema).not.toBe(schema);
    expect(registry.ids.user.prefixSchema).toBe(prefixSchema);
    expect(registry.ids.user.schema).toBe(schema);
  });

  it('keeps each kind independent', () => {
    const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' });
    expect(registry.ids.user.schema).not.toBe(registry.ids.order.schema);
  });

  it('still parses and rejects correctly through the getter', () => {
    const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' });
    const id = registry.ids.user.create();
    expect(registry.ids.user.schema.parse(id)).toBe(id);
    expect(() => registry.ids.order.schema.parse(id)).toThrow();
  });

  it('emits a JSON Schema built from the same cached instance', () => {
    const registry = defineEntityPrefixes({ user: 'usr' });
    const jsonSchema = registry.ids.user.jsonSchema();
    expect(jsonSchema.pattern).toContain('usr_');
    expect(registry.ids.user.jsonSchema()).toEqual(jsonSchema);
  });

  it('leaves the toolkit frozen', () => {
    // Getters must not have made the object extensible again.
    const registry = defineEntityPrefixes({ user: 'usr' });
    expect(Object.isFrozen(registry.ids.user)).toBe(true);
  });
});

describe('registry independence', () => {
  it('supports several registries side by side', () => {
    const other = defineEntityPrefixes({ ticket: 'tkt' } as const);
    const ticketId = other.ids.ticket.create();
    expect(other.kindOf(ticketId)).toBe('ticket');
    expect(registry.kindOf(ticketId)).toBeUndefined();
  });
});
