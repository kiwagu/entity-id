import {
  assertEntityIdWithPrefix,
  type BrandedEntityId,
  createEntityId,
  type CreateEntityIdOptions,
  type EntityId,
  isEntityIdWithPrefix,
  unsafeBrandEntityId,
} from './entity-id.js';
import { type ValidationOptions } from './mode.js';
import { EntityIdError, normalizePrefix, PREFIX_RE } from './prefix.js';
import {
  brandedEntityIdSchema,
  type EntityIdSchema,
  entityIdJsonSchema,
  type EntityIdJsonSchema,
  prefixGatedEntityIdSchema,
} from './schema.js';

/**
 * The entity-prefix registry: one place that maps every entity kind in an
 * application to its wire prefix, and derives a typed toolkit from that map.
 *
 * @module
 */

/**
 * A prefix map: semantic entity kind to wire prefix.
 *
 * Keys are stable semantic names rather than table names, so renaming a table
 * does not churn the registry. Values are the prefixes that appear in ids and
 * must match whatever the database emits.
 *
 * @public
 */
export type EntityPrefixMap = Readonly<Record<string, string>>;

/**
 * The branded id type for one kind of a registry.
 *
 * @typeParam TMap - The prefix map.
 * @typeParam K - A kind of that map.
 *
 * @public
 */
export type EntityIdOf<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
> = BrandedEntityId<K>;

/**
 * The create/guard/assert/schema toolkit bound to a single entity kind.
 *
 * Every member is branded to that kind's id type, so mixing two kinds is a
 * compile-time error.
 *
 * @typeParam TMap - The prefix map the kind belongs to.
 * @typeParam K - The entity kind.
 *
 * @public
 */
export type EntityIdToolkit<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
> = Readonly<{
  /** The entity kind this toolkit is bound to. */
  kind: K;
  /** The registered wire prefix, for example `'usr'`. */
  prefix: TMap[K];
  /**
   * Mint a fresh, branded id for this kind.
   *
   * @param options - See {@link CreateEntityIdOptions}.
   */
  create: (options?: CreateEntityIdOptions) => EntityIdOf<TMap, K>;
  /**
   * Runtime type guard narrowing to this kind's branded id. Strictness follows
   * the active mode; pass `{ mode }` to override it for one call.
   */
  is: (
    value: unknown,
    options?: ValidationOptions
  ) => value is EntityIdOf<TMap, K>;
  /**
   * Throwing assert returning the branded id — the parse-at-the-boundary entry
   * point. Strictness follows the active mode.
   *
   * @throws {EntityIdError} When the value is not an id of this kind.
   */
  assert: (value: string, options?: ValidationOptions) => EntityIdOf<TMap, K>;
  /**
   * Cast a string to this kind's branded id with **no** runtime validation.
   * For trusted construction only.
   */
  brand: (value: string) => EntityIdOf<TMap, K>;
  /**
   * Strict Zod schema: validates the full `<prefix>_<rand16>.<ts10>` contract
   * and brands the parsed output as this kind's id.
   */
  schema: EntityIdSchema<K>;
  /**
   * Lenient, prefix-gated Zod schema: checks the `<prefix>_` head only, then
   * brands. Tolerates non-canonical placeholder suffixes in fixtures.
   */
  prefixSchema: EntityIdSchema<K>;
  /**
   * JSON Schema for this kind's id.
   *
   * @param io - `'input'` for request payloads, `'output'` for responses.
   * Default: `'output'`.
   */
  jsonSchema: (io?: 'input' | 'output') => EntityIdJsonSchema;
}>;

/**
 * A registry: the prefix map plus the derived per-kind toolkits and lookup
 * helpers.
 *
 * @typeParam TMap - The prefix map passed to {@link defineEntityPrefixes}.
 *
 * @public
 */
export type EntityIdRegistry<TMap extends EntityPrefixMap> = Readonly<{
  /** The prefix map this registry was built from. */
  prefixes: TMap;
  /** Every registered kind, in declaration order. */
  kinds: readonly (keyof TMap & string)[];
  /** Every registered prefix, sorted. */
  allPrefixes: readonly string[];
  /** One toolkit per kind: `registry.ids.user.create()`. */
  ids: { readonly [K in keyof TMap & string]: EntityIdToolkit<TMap, K> };
  /** The registered prefix for a kind. Unknown kinds do not compile. */
  prefixFor: <K extends keyof TMap & string>(kind: K) => TMap[K];
  /** Whether a string is a registered kind, narrowing to the key union. */
  isKind: (value: string) => value is keyof TMap & string;
  /** Whether a prefix is registered, narrowing to the value union. */
  isRegisteredPrefix: (prefix: string) => prefix is TMap[keyof TMap & string];
  /** The kind that owns a prefix, or `undefined`. */
  kindForPrefix: (prefix: string) => (keyof TMap & string) | undefined;
  /**
   * The kind an id belongs to, or `undefined` when the id is malformed or its
   * prefix is not registered.
   */
  kindOf: (value: string) => (keyof TMap & string) | undefined;
  /**
   * Assert that a value is an id of any registered kind.
   *
   * @throws {EntityIdError} When the value is malformed or carries an
   * unregistered prefix.
   */
  assertKnown: (value: string) => EntityId;
}>;

/**
 * Object-prototype member names, rejected as entity kinds. Using one is not
 * exploitable here, but it makes the registry's key space ambiguous to read.
 */
const RESERVED_KIND_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function makeToolkit<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
>(kind: K, prefix: TMap[K]): EntityIdToolkit<TMap, K> {
  // The three Zod-backed members are lazy. Building them eagerly would put a
  // top-level Zod call on the path of every `defineEntityPrefixes`, so an
  // application that only mints and checks ids would still pay for the whole
  // validator library in its bundle. As getters, the cost arrives with the
  // first access and never for a consumer who does not use schemas.
  let cached: EntityIdSchema<K> | undefined;
  const schemaOf = (): EntityIdSchema<K> => {
    cached ??= brandedEntityIdSchema<K>(prefix);
    return cached;
  };

  let cachedPrefixSchema: EntityIdSchema<K> | undefined;

  return Object.freeze({
    kind,
    prefix,
    create: (options?: CreateEntityIdOptions) =>
      createEntityId(prefix, options) as EntityIdOf<TMap, K>,
    is: (
      value: unknown,
      options?: ValidationOptions
    ): value is EntityIdOf<TMap, K> =>
      isEntityIdWithPrefix(value, prefix, options),
    assert: (value: string, options?: ValidationOptions) =>
      assertEntityIdWithPrefix(value, prefix, options) as EntityIdOf<TMap, K>,
    brand: (value: string) => unsafeBrandEntityId<K>(value),
    get schema(): EntityIdSchema<K> {
      return schemaOf();
    },
    get prefixSchema(): EntityIdSchema<K> {
      cachedPrefixSchema ??= prefixGatedEntityIdSchema<K>(prefix);
      return cachedPrefixSchema;
    },
    jsonSchema: (io: 'input' | 'output' = 'output') =>
      entityIdJsonSchema(schemaOf() as never, io),
  });
}

/**
 * Build an entity-id registry from a prefix map.
 *
 * The map is validated eagerly: every prefix must be well-formed and no two
 * kinds may share one. A collision is fatal here rather than at runtime,
 * because an ambiguous prefix makes an id un-routable — the classic hazard is
 * two slugs compressing to the same skeleton, such as `program` and `project`
 * both yielding `prg`.
 *
 * @typeParam TMap - The literal prefix map; declare it `as const` to keep the
 * key and value types narrow.
 * @param prefixes - The kind-to-prefix map.
 * @returns The registry, see {@link EntityIdRegistry}.
 * @throws {EntityIdError} When a prefix is malformed or duplicated.
 *
 * @example
 * ```ts
 * export const registry = defineEntityPrefixes({
 *   user: 'usr',
 *   order: 'ord',
 *   orderLine: 'orl',
 * } as const);
 *
 * export type UserId = EntityIdOf<typeof registry.prefixes, 'user'>;
 * export type OrderId = EntityIdOf<typeof registry.prefixes, 'order'>;
 *
 * const { user, order } = registry.ids;
 *
 * const id = user.create();          // UserId
 * user.is(id);                       // true
 * order.assert(id);                  // throws: wrong prefix
 * registry.kindOf(id);               // 'user'
 * ```
 *
 * @public
 */
export function defineEntityPrefixes<const TMap extends EntityPrefixMap>(
  prefixes: TMap
): EntityIdRegistry<TMap> {
  const entries = Object.entries(prefixes) as [keyof TMap & string, string][];

  if (entries.length === 0) {
    throw new EntityIdError('An entity prefix registry must not be empty.');
  }

  const seen = new Map<string, string>();
  for (const [kind, prefix] of entries) {
    // Not exploitable — `Object.fromEntries` creates own properties, so
    // `Object.prototype` is never touched — but a kind named `__proto__` or
    // `constructor` makes every later lookup ambiguous to read and to debug.
    // Rejecting them keeps the registry's key space plain.
    if (RESERVED_KIND_NAMES.has(kind)) {
      throw new EntityIdError(
        `Reserved entity kind "${kind}". Object-prototype names cannot be used as kinds.`,
        kind
      );
    }
    if (!PREFIX_RE.test(prefix)) {
      throw new EntityIdError(
        `Invalid prefix "${prefix}" for kind "${kind}". Expected ${PREFIX_RE.source}.`,
        prefix
      );
    }
    const owner = seen.get(prefix);
    if (owner !== undefined) {
      throw new EntityIdError(
        `Duplicate entity prefix "${prefix}": claimed by both "${owner}" and "${kind}". Prefixes must be unique so an id routes back to exactly one kind.`,
        prefix
      );
    }
    seen.set(prefix, kind);
  }

  const kinds = Object.freeze(entries.map(([kind]) => kind));
  const allPrefixes = Object.freeze(entries.map(([, prefix]) => prefix).sort());

  const ids = Object.freeze(
    Object.fromEntries(
      entries.map(([kind, prefix]) => [
        kind,
        makeToolkit<TMap, typeof kind>(kind, prefix as TMap[typeof kind]),
      ])
    )
  ) as { readonly [K in keyof TMap & string]: EntityIdToolkit<TMap, K> };

  const kindForPrefix = (prefix: string): (keyof TMap & string) | undefined =>
    seen.get(prefix);

  return Object.freeze({
    prefixes,
    kinds,
    allPrefixes,
    ids,
    prefixFor: <K extends keyof TMap & string>(kind: K) => prefixes[kind],
    isKind: (value: string): value is keyof TMap & string =>
      Object.prototype.hasOwnProperty.call(prefixes, value),
    isRegisteredPrefix: (prefix: string): prefix is TMap[keyof TMap & string] =>
      seen.has(prefix),
    kindForPrefix,
    kindOf: (value: string): (keyof TMap & string) | undefined => {
      const underscore = String(value ?? '').indexOf('_');
      if (underscore < 1) return undefined;
      const prefix = value.slice(0, underscore);
      if (!seen.has(prefix)) return undefined;
      // The prefix is registered, which is the routing question. Whether the
      // remainder is inspected is the mode's decision.
      return isEntityIdWithPrefix(value, prefix)
        ? kindForPrefix(prefix)
        : undefined;
    },
    assertKnown: (value: string): EntityId => {
      const underscore = String(value ?? '').indexOf('_');
      const prefix = underscore > 0 ? value.slice(0, underscore) : '';
      if (!prefix || !seen.has(prefix)) {
        throw new EntityIdError(
          `Unregistered entity prefix in "${String(value)}". Known prefixes: ${allPrefixes.join(', ')}.`,
          String(value)
        );
      }
      return assertEntityIdWithPrefix(value, normalizePrefix(prefix));
    },
  });
}
