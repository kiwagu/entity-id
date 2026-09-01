import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  type BrandedEntityId,
  createEntityId,
  type EntityId,
  normalizeEntityId,
} from './entity-id.js';
import { EntityIdError } from './prefix.js';
import {
  brandedEntityIdSchema,
  entityIdJsonSchema,
  entityIdSchema,
  entityIdWithPrefixSchema,
  prefixGatedEntityIdSchema,
  toEntityId,
} from './schema.js';

describe('entityIdSchema', () => {
  it('parses a canonical id unchanged', () => {
    const id = createEntityId('usr');
    expect(entityIdSchema.parse(id)).toBe(id);
  });

  it('trims and lowercases mixed-case input', () => {
    const id = createEntityId('ent');
    const [prefix, body] = id.split('_');
    const mixed = `  ${prefix}_${(body ?? '').toUpperCase()}  `;
    expect(entityIdSchema.parse(mixed)).toBe(normalizeEntityId(id));
  });

  it('rejects malformed input', () => {
    expect(entityIdSchema.safeParse('not-an-id').success).toBe(false);
    expect(entityIdSchema.safeParse('').success).toBe(false);
    expect(entityIdSchema.safeParse('   ').success).toBe(false);
    expect(entityIdSchema.safeParse(42).success).toBe(false);
    expect(entityIdSchema.safeParse(null).success).toBe(false);
  });

  it('reports a helpful message', () => {
    const result = entityIdSchema.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        /<prefix>_<rand16>\.<ts10>/
      );
    }
  });

  it('brands the parsed output', () => {
    const parsed = entityIdSchema.parse(createEntityId('usr'));
    expectTypeOf(parsed).toExtend<EntityId>();
    expectTypeOf<string>().not.toExtend<typeof parsed>();
  });
});

describe('entityIdWithPrefixSchema', () => {
  it('accepts only ids carrying the required prefix', () => {
    const schema = entityIdWithPrefixSchema('usr');
    expect(schema.safeParse(createEntityId('usr')).success).toBe(true);
    expect(schema.safeParse(createEntityId('ord')).success).toBe(false);
  });

  it('still normalizes on the way through', () => {
    const id = createEntityId('usr');
    const [prefix, body] = id.split('_');
    const mixed = `${prefix}_${(body ?? '').toUpperCase()}`;
    expect(entityIdWithPrefixSchema('usr').parse(mixed)).toBe(id);
  });

  it('does not accept a prefix that merely shares a head', () => {
    const schema = entityIdWithPrefixSchema('usr');
    expect(schema.safeParse(createEntityId('usrx')).success).toBe(false);
  });

  it('rejects an invalid prefix argument eagerly', () => {
    expect(() => entityIdWithPrefixSchema('1bad')).toThrow(EntityIdError);
  });
});

describe('brandedEntityIdSchema', () => {
  it('enforces the prefix at runtime', () => {
    const userIdSchema = brandedEntityIdSchema<'user'>('usr');
    const id = createEntityId('usr');
    expect(userIdSchema.parse(id)).toBe(id);
    expect(userIdSchema.safeParse(createEntityId('ord')).success).toBe(false);
  });

  it('produces a distinct compile-time type per brand', () => {
    const userIdSchema = brandedEntityIdSchema<'user'>('usr');
    const orderIdSchema = brandedEntityIdSchema<'order'>('ord');

    type UserId = z.output<typeof userIdSchema>;
    type OrderId = z.output<typeof orderIdSchema>;

    expectTypeOf<UserId>().toEqualTypeOf<BrandedEntityId<'user'>>();
    expectTypeOf<UserId>().not.toEqualTypeOf<OrderId>();
    expectTypeOf<UserId>().toExtend<EntityId>();
  });

  it('composes inside an object schema', () => {
    const schema = z.object({
      id: brandedEntityIdSchema<'user'>('usr'),
      name: z.string(),
    });
    const id = createEntityId('usr');
    expect(schema.parse({ id, name: 'Ada' })).toEqual({ id, name: 'Ada' });
    expect(
      schema.safeParse({ id: createEntityId('ord'), name: 'Ada' }).success
    ).toBe(false);
  });
});

describe('prefixGatedEntityIdSchema', () => {
  it('accepts a correctly-prefixed but non-canonical placeholder', () => {
    const schema = prefixGatedEntityIdSchema<'user'>('usr');
    expect(schema.parse('usr_this_is_a_fixture')).toBe('usr_this_is_a_fixture');
  });

  it('still rejects a swapped kind', () => {
    const schema = prefixGatedEntityIdSchema<'user'>('usr');
    expect(schema.safeParse('ord_whatever').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
  });
});

describe('entityIdJsonSchema', () => {
  it('renders a JSON Schema for the canonical output side', () => {
    const jsonSchema = entityIdJsonSchema();
    expect(jsonSchema.type).toBe('string');
    expect(String(jsonSchema.pattern)).toContain('0-9a-hjkmnp-tv-z');
  });

  it('renders the permissive input side on request', () => {
    const input = entityIdJsonSchema(undefined, 'input');
    expect(input.type).toBe('string');
    expect(String(input.pattern)).toContain('A-HJKMNP-TV-Z');
  });

  it('bakes a fixed prefix into the pattern', () => {
    const pattern = String(
      entityIdJsonSchema(entityIdWithPrefixSchema('usr')).pattern
    );
    expect(pattern).toContain('usr_');
  });

  it('produces a pattern that actually matches a real id', () => {
    const pattern = String(entityIdJsonSchema().pattern);
    expect(new RegExp(pattern).test(createEntityId('usr'))).toBe(true);
    expect(new RegExp(pattern).test('not-an-id')).toBe(false);
  });

  it('serializes an embedding contract without throwing', () => {
    // The regression this guards: a `.transform()`-based schema is
    // unrepresentable in JSON Schema, so embedding an id in a contract used to
    // fail at serialization time. The codec keeps it representable.
    const contract = z.object({ id: entityIdSchema, name: z.string() });
    const jsonSchema = z.toJSONSchema(contract, {
      io: 'output',
    }) as unknown as {
      properties: { id: { pattern?: string } };
    };
    expect(jsonSchema.properties.id.pattern).toBeDefined();
    expect(JSON.stringify(jsonSchema)).toContain('pattern');
  });
});

describe('toEntityId', () => {
  it('returns a canonical id or undefined', () => {
    const id = createEntityId('usr');
    expect(toEntityId(id)).toBe(id);
    expect(toEntityId(id.toUpperCase())).toBeUndefined();
    expect(toEntityId('nope')).toBeUndefined();
    expect(toEntityId(undefined)).toBeUndefined();
    expect(toEntityId(123)).toBeUndefined();
  });
});
