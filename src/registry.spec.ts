import { describe, expect, expectTypeOf, it } from 'vitest';

import { createEntityId, type EntityId } from './entity-id.js';
import { withValidationMode } from './mode.js';
import { EntityIdError } from './prefix.js';
import { defineEntityPrefixes, type EntityIdOf } from './registry.js';
import { withSchemas } from './schema.js';

const registry = defineEntityPrefixes({
  user: 'usr',
  order: 'ord',
  orderLine: 'orl',
} as const);

const schemas = withSchemas(registry);

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
    expect(schemas.user.schema.parse(id)).toBe(id);
    expect(schemas.user.schema.safeParse(order.create()).success).toBe(false);
  });

  it('tolerates placeholders through its prefix schema', () => {
    expect(schemas.user.prefixSchema.parse('usr_fixture')).toBe('usr_fixture');
    expect(schemas.user.prefixSchema.safeParse('ord_fixture').success).toBe(
      false
    );
  });

  it('emits a JSON Schema carrying its prefix', () => {
    const output = schemas.user.jsonSchema();
    expect(output.type).toBe('string');
    expect(String(output.pattern)).toContain('usr_');
    expect(new RegExp(String(output.pattern)).test(user.create())).toBe(true);

    const input = schemas.user.jsonSchema('input');
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

describe('the registry stays free of schemas', () => {
  // The toolkit is deliberately Zod-free: `registry.ts` must not import
  // `schema.ts` at all, so an application that only mints and checks ids does
  // not bundle a validator library it never calls. Schemas come from
  // `withSchemas` in `entity-id/schema`, and `scripts/verify-bundle.mjs`
  // measures that the separation holds in the packed artifact.
  it('exposes only id operations on a toolkit', () => {
    const registry = defineEntityPrefixes({ user: 'usr' });
    expect(Object.keys(registry.ids.user).sort()).toEqual([
      'assert',
      'brand',
      'create',
      'is',
      'kind',
      'prefix',
    ]);
  });

  it('derives schemas through withSchemas instead', () => {
    const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' });
    const schemas = withSchemas(registry);

    const id = registry.ids.user.create();
    expect(schemas.user.schema.parse(id)).toBe(id);
    expect(() => schemas.order.schema.parse(id)).toThrow();
  });

  it('keeps schema identity stable per kind', () => {
    // A schema rebuilt on every access would break `z.infer` narrowing and any
    // Map keyed by it.
    const schemas = withSchemas(defineEntityPrefixes({ user: 'usr' }));
    expect(schemas.user.schema).toBe(schemas.user.schema);
    expect(schemas.user.prefixSchema).not.toBe(schemas.user.schema);
  });

  it('emits a JSON Schema carrying the kind prefix', () => {
    const schemas = withSchemas(defineEntityPrefixes({ user: 'usr' }));
    expect(schemas.user.jsonSchema().pattern).toContain('usr_');
  });

  it('accepts any object shaped like a registry', () => {
    // `withSchemas` is typed structurally so `schema.ts` need not import
    // `registry.ts`; this pins that the contract really is structural.
    const schemas = withSchemas({ ids: { thing: { prefix: 'thg' } } });
    expect(schemas.thing.jsonSchema().pattern).toContain('thg_');
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
