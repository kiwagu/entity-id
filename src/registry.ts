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

/**
 * The entity-prefix registry: one place that maps every entity kind in an
 * application to its wire prefix, and derives a typed id factory per kind
 * from that map.
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
 * The create/guard/assert/brand id factory bound to a single entity kind.
 *
 * Every member is branded to that kind's id type, so mixing two kinds is a
 * compile-time error.
 *
 * @typeParam TMap - The prefix map the kind belongs to.
 * @typeParam K - The entity kind.
 *
 * @public
 */
export type EntityIdFactory<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
> = Readonly<{
  /** The entity kind this factory is bound to. */
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
}>;

/**
 * The per-kind id factory under its former name.
 *
 * @deprecated Renamed to {@link EntityIdFactory}; removal planned for the next
 * major.
 *
 * @typeParam TMap - The prefix map the kind belongs to.
 * @typeParam K - The entity kind.
 *
 * @public
 */
export type EntityIdToolkit<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
> = EntityIdFactory<TMap, K>;

/**
 * A registry: the prefix map plus the derived per-kind id factories and lookup
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
  /**
   * One factory per kind under a name that says what it is, e.g.
   * `registry.factories.userIdFactory.create()`. Destructure without
   * shadowing your entities:
   * `const { userIdFactory, orderIdFactory } = registry.factories;`.
   *
   * The key is the kind name followed by `IdFactory`.
   */
  factories: {
    readonly [K in keyof TMap & string as `${K}IdFactory`]: EntityIdFactory<
      TMap,
      K
    >;
  };
  /**
   * One factory per kind, keyed by the bare kind name.
   *
   * @deprecated Use {@link EntityIdRegistry.factories}: `registry.ids.user` is
   * now `registry.factories.userIdFactory`. Kept through 1.x; removal planned
   * for the next major.
   */
  ids: { readonly [K in keyof TMap & string]: EntityIdFactory<TMap, K> };
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

function makeFactory<
  TMap extends EntityPrefixMap,
  K extends keyof TMap & string,
>(kind: K, prefix: TMap[K]): EntityIdFactory<TMap, K> {
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
 * const { userIdFactory, orderIdFactory } = registry.factories;
 *
 * const id = userIdFactory.create(); // UserId
 * userIdFactory.is(id);              // true
 * orderIdFactory.assert(id);         // throws: wrong prefix
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

  // Each factory is built once; `factories` and the deprecated `ids` map hold
  // the same frozen objects under different keys.
  const ids = Object.freeze(
    Object.fromEntries(
      entries.map(([kind, prefix]) => [
        kind,
        makeFactory<TMap, typeof kind>(kind, prefix as TMap[typeof kind]),
      ])
    )
  ) as EntityIdRegistry<TMap>['ids'];

  const factories = Object.freeze(
    Object.fromEntries(entries.map(([kind]) => [`${kind}IdFactory`, ids[kind]]))
  ) as EntityIdRegistry<TMap>['factories'];

  const kindForPrefix = (prefix: string): (keyof TMap & string) | undefined =>
    seen.get(prefix);

  return Object.freeze({
    prefixes,
    kinds,
    allPrefixes,
    factories,
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
