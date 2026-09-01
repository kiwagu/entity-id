import {
  decodeTime as decodeUlidTime,
  encodeTime as encodeUlidTime,
  monotonicFactory,
  ulid as ulidCanonical,
} from 'ulid';
import type { z } from 'zod';

import { EntityIdError, normalizePrefix, PREFIX_PATTERN } from './prefix.js';

/**
 * An entity id: a prefixed, time-sortable identifier of the form
 * `<prefix>_<rand16>.<ts10>`, where `rand` and `ts` are the two halves of a
 * ULID rendered in lowercase Crockford Base32.
 *
 * The prefix names the kind of thing the id points at; the ULID supplies global
 * uniqueness plus an embedded creation timestamp, so an id carries its own
 * provenance.
 *
 * The type is *branded*: a plain `string` is not assignable to `EntityId`. The
 * only ways to obtain one are minting ({@link createEntityId}), parsing
 * ({@link entityIdSchema}), asserting ({@link assertEntityId}) or an explicit
 * unchecked cast ({@link unsafeBrandEntityId}).
 *
 * @public
 */
export type EntityId = string & z.BRAND<'EntityId'>;

/**
 * A distinctly branded entity id: {@link EntityId} narrowed by an extra brand
 * tag, so a `UserId` and an `OrderId` are different compile-time types while
 * both stay assignable to `EntityId`.
 *
 * @typeParam Brand - The brand tag, usually the entity kind.
 *
 * @example
 * ```ts
 * type UserId = BrandedEntityId<'user'>;
 * type OrderId = BrandedEntityId<'order'>;
 *
 * declare const userId: UserId;
 * const orderId: OrderId = userId; // compile error
 * ```
 *
 * @public
 */
export type BrandedEntityId<Brand extends string> = EntityId & z.BRAND<Brand>;

/**
 * Crockford Base32 character class — the ULID alphabet, without `I`, `L`, `O`
 * and `U`. Mixed case is accepted on input.
 *
 * Exported as the single source shared with the SQL generator; drift between
 * the two is caught by the package's `sql-sync` test.
 *
 * @public
 */
export const CROCKFORD_CLASS = '[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]';

/** Lowercase-only Crockford Base32 class, the canonical *output* alphabet. */
export const CROCKFORD_CANONICAL_CLASS = '[0-9a-hjkmnp-tv-z]';

/** Length of the randomness segment, in Base32 characters (80 bits). */
export const RAND_LENGTH = 16;

/** Length of the timestamp segment, in Base32 characters (48 bits used). */
export const TS_LENGTH = 10;

const CROCKFORD_BASE32 = new RegExp(`^${CROCKFORD_CLASS}+$`);
const TS_RE = new RegExp(`^${CROCKFORD_CLASS}{${TS_LENGTH}}$`);

/**
 * Anchored pattern for the accepted (input) id shape: mixed-case ULID segments.
 *
 * @public
 */
export const ENTITY_ID_PATTERN = `${PREFIX_PATTERN}_${CROCKFORD_CLASS}{${RAND_LENGTH}}\\.${CROCKFORD_CLASS}{${TS_LENGTH}}`;

/**
 * Anchored pattern for the canonical (output) id shape: lowercase only.
 *
 * This is what a serialized JSON Schema advertises for an id field in a
 * response payload.
 *
 * @public
 */
export const CANONICAL_ENTITY_ID_PATTERN = `${PREFIX_PATTERN}_${CROCKFORD_CANONICAL_CLASS}{${RAND_LENGTH}}\\.${CROCKFORD_CANONICAL_CLASS}{${TS_LENGTH}}`;

/** Named-group regular expression for the accepted id shape. */
export const ENTITY_ID_RE = new RegExp(
  `^(?<prefix>${PREFIX_PATTERN})_(?<rand>${CROCKFORD_CLASS}{${RAND_LENGTH}})\\.(?<ts>${CROCKFORD_CLASS}{${TS_LENGTH}})$`
);

/** Regular expression for the canonical, already-normalized id shape. */
export const CANONICAL_ENTITY_ID_RE = new RegExp(
  `^${CANONICAL_ENTITY_ID_PATTERN}$`
);

const INVALID_ID_MESSAGE =
  'Invalid entity id. Expected "<prefix>_<rand16>.<ts10>" with ULID Crockford base32.';

const ulidMonotonic = monotonicFactory();

/**
 * The three lexical parts of an entity id.
 *
 * @public
 */
export type EntityIdParts = Readonly<{
  /** Entity-type tag, lowercase. */
  prefix: string;
  /** 16-character ULID randomness segment, lowercase Crockford Base32. */
  rand: string;
  /** 10-character ULID time segment, lowercase Crockford Base32. */
  ts: string;
}>;

/**
 * A fully decoded entity id: its parts plus the reconstructed ULID and the
 * creation timestamp it encodes.
 *
 * @public
 */
export type ParsedEntityId = Readonly<
  EntityIdParts & {
    /** The canonical 26-character uppercase ULID (`ts` followed by `rand`). */
    ulid: string;
    /** Creation time, in milliseconds since the Unix epoch. */
    timeMs: number;
  }
>;

function requiredGroup(
  groups: Record<string, string | undefined> | undefined,
  key: string,
  value: string
): string {
  const group = groups?.[key];
  if (!group) {
    throw new EntityIdError(
      `Invalid entity id: missing group "${key}".`,
      value
    );
  }
  return group;
}

/**
 * Split a canonical ULID into the `rand` and `ts` segments an entity id uses.
 *
 * @param ulid - A 26-character canonical ULID.
 * @returns The lowercase `rand` and `ts` segments.
 * @throws {EntityIdError} When the ULID has the wrong length or alphabet.
 *
 * @public
 */
export function ulidToEntityIdParts(
  ulid: string
): Omit<EntityIdParts, 'prefix'> {
  const value = String(ulid ?? '');
  if (value.length !== TS_LENGTH + RAND_LENGTH) {
    throw new EntityIdError(
      `Invalid ULID length. Expected ${TS_LENGTH + RAND_LENGTH}, got ${value.length}.`,
      value
    );
  }
  const upper = value.toUpperCase();
  const ts = upper.slice(0, TS_LENGTH).toLowerCase();
  const rand = upper.slice(TS_LENGTH).toLowerCase();
  if (!CROCKFORD_BASE32.test(ts) || !CROCKFORD_BASE32.test(rand)) {
    throw new EntityIdError(
      'Invalid ULID alphabet (Crockford base32 expected).',
      value
    );
  }
  return { rand, ts };
}

/**
 * Recombine entity-id parts into a canonical uppercase ULID.
 *
 * @param parts - Parts carrying `ts` and `rand`.
 * @returns The 26-character uppercase ULID.
 * @throws {EntityIdError} When a segment has the wrong length or alphabet.
 *
 * @public
 */
export function entityIdPartsToUlid(
  parts: Omit<EntityIdParts, 'prefix'>
): string {
  const ts = String(parts.ts ?? '').toUpperCase();
  const rand = String(parts.rand ?? '').toUpperCase();
  if (ts.length !== TS_LENGTH || rand.length !== RAND_LENGTH) {
    throw new EntityIdError(
      `Invalid ULID segments (expected ts=${TS_LENGTH}, rand=${RAND_LENGTH}).`
    );
  }
  if (!CROCKFORD_BASE32.test(ts) || !CROCKFORD_BASE32.test(rand)) {
    throw new EntityIdError(
      'Invalid ULID alphabet (Crockford base32 expected).'
    );
  }
  return `${ts}${rand}`;
}

/**
 * Build an entity id from a prefix and an existing ULID.
 *
 * Useful when migrating from a ULID-keyed table: the original ULID, and hence
 * the original creation time, is preserved.
 *
 * @param prefix - Entity-type tag; normalized via `normalizePrefix`.
 * @param ulid - A 26-character canonical ULID.
 * @returns The branded entity id.
 * @throws {EntityIdError} When the prefix or ULID is invalid.
 *
 * @example
 * ```ts
 * fromUlid('usr', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
 * // 'usr_ktsv4rrffq69g5fav.01arz3ndek'
 * ```
 *
 * @public
 */
export function fromUlid(prefix: string, ulid: string): EntityId {
  const normalizedPrefix = normalizePrefix(prefix);
  const { rand, ts } = ulidToEntityIdParts(ulid);
  return `${normalizedPrefix}_${rand}.${ts}` as EntityId;
}

/**
 * Options for {@link createEntityId}.
 *
 * @public
 */
export type CreateEntityIdOptions = Readonly<{
  /**
   * Use per-process monotonic ULID generation, so ids minted within the same
   * millisecond keep a stable, strictly increasing order.
   *
   * Default: `true`.
   */
  monotonic?: boolean;
  /**
   * An explicit creation timestamp, in milliseconds since the Unix epoch. When
   * omitted, the current time is used.
   */
  timeMs?: number;
}>;

/**
 * Mint a fresh entity id.
 *
 * @param prefix - Entity-type tag, for example `'usr'`.
 * @param options - See {@link CreateEntityIdOptions}.
 * @returns A newly minted, branded entity id.
 * @throws {EntityIdError} When the prefix is invalid.
 *
 * @example
 * ```ts
 * createEntityId('usr');
 * // 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q'
 *
 * createEntityId('usr', { timeMs: Date.UTC(2026, 0, 1), monotonic: false });
 * ```
 *
 * @public
 */
export function createEntityId(
  prefix: string,
  options: CreateEntityIdOptions = {}
): EntityId {
  const normalizedPrefix = normalizePrefix(prefix);
  const monotonic = options.monotonic ?? true;
  const { timeMs } = options;

  if (timeMs !== undefined && (!Number.isFinite(timeMs) || timeMs < 0)) {
    throw new EntityIdError(
      `Invalid timeMs "${String(timeMs)}". Expected a non-negative finite number.`
    );
  }

  let ulid: string;
  if (timeMs === undefined) {
    ulid = monotonic ? ulidMonotonic() : ulidCanonical();
  } else if (timeMs === 0) {
    // `ulid(0)` treats the seed as falsy and silently substitutes the current
    // time, so the Unix epoch — a legitimate timestamp — would be lost. Build
    // the ULID from an explicitly encoded time instead.
    const seeded = monotonic ? ulidMonotonic(1) : ulidCanonical(1);
    ulid = `${encodeUlidTime(0, TS_LENGTH)}${seeded.slice(TS_LENGTH)}`;
  } else {
    ulid = monotonic ? ulidMonotonic(timeMs) : ulidCanonical(timeMs);
  }

  return fromUlid(normalizedPrefix, ulid);
}

/**
 * Runtime type guard: is the value a well-formed entity id?
 *
 * @param value - Candidate string.
 * @returns `true` when the value matches the id contract, narrowing to
 * {@link EntityId}.
 *
 * @public
 */
export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && ENTITY_ID_RE.test(value);
}

/**
 * Runtime type guard for an id carrying a specific prefix, where the prefix is
 * known only at runtime.
 *
 * @param value - Candidate string.
 * @param prefix - Required entity-type tag.
 * @returns `true` when the value is an entity id with that prefix.
 *
 * @public
 */
export function isEntityIdWithPrefix(
  value: unknown,
  prefix: string
): value is EntityId {
  return isEntityId(value) && value.startsWith(`${normalizePrefix(prefix)}_`);
}

/**
 * Assert that a value is a well-formed entity id and return it normalized.
 *
 * @param value - Candidate string.
 * @returns The normalized, branded id.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function assertEntityId(value: string): EntityId {
  return normalizeEntityId(value);
}

/**
 * Assert that a value is an entity id carrying `prefix`, and return it
 * normalized.
 *
 * For a prefix known at compile time, prefer the toolkit produced by
 * `defineEntityPrefixes`, whose `assert` is branded per kind.
 *
 * @param value - Candidate string.
 * @param prefix - Required entity-type tag.
 * @returns The normalized, branded id.
 * @throws {EntityIdError} When the value is not an id with that prefix.
 *
 * @public
 */
export function assertEntityIdWithPrefix(
  value: string,
  prefix: string
): EntityId {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!isEntityIdWithPrefix(value, normalizedPrefix)) {
    throw new EntityIdError(
      `Expected an entity id with prefix "${normalizedPrefix}_", got "${String(value)}".`,
      String(value)
    );
  }
  return normalizeEntityId(value);
}

/**
 * Cast a string to a branded id **without any runtime validation**.
 *
 * For trusted construction only: test fixtures, seed data, or values read back
 * from a column that already enforces the contract with a `CHECK`. Never use it
 * on untrusted input — use {@link assertEntityId} or a schema instead.
 *
 * @param value - A string already known to be a valid entity id.
 * @returns The value, branded.
 *
 * @public
 */
export function unsafeBrandEntityId<Brand extends string = 'EntityId'>(
  value: string
): BrandedEntityId<Brand> {
  return value as BrandedEntityId<Brand>;
}

/**
 * Decode an entity id into its parts, ULID and timestamp.
 *
 * @param value - The id to decode.
 * @returns The decoded id, see {@link ParsedEntityId}.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @example
 * ```ts
 * parseEntityId('usr_a1b2c3d4e5f6g7h8.01jd8x2p4q');
 * // { prefix: 'usr', rand: 'a1b2…', ts: '01jd…', ulid: '01JD…', timeMs: 1731… }
 * ```
 *
 * @public
 */
export function parseEntityId(value: string): ParsedEntityId {
  const input = String(value ?? '');
  const match = ENTITY_ID_RE.exec(input);
  if (!match) {
    throw new EntityIdError(INVALID_ID_MESSAGE, input);
  }

  const prefix = requiredGroup(match.groups, 'prefix', input);
  const rand = requiredGroup(match.groups, 'rand', input).toLowerCase();
  const ts = requiredGroup(match.groups, 'ts', input).toLowerCase();

  const normalizedPrefix = normalizePrefix(prefix);
  const ulid = `${ts}${rand}`.toUpperCase();

  return {
    prefix: normalizedPrefix,
    rand,
    ts,
    ulid,
    timeMs: decodeUlidTime(ulid),
  };
}

/**
 * Parse an entity id, returning `undefined` instead of throwing.
 *
 * @param value - Candidate string.
 * @returns The decoded id, or `undefined` when the value is invalid.
 *
 * @public
 */
export function safeParseEntityId(value: string): ParsedEntityId | undefined {
  try {
    return parseEntityId(value);
  } catch {
    return undefined;
  }
}

/**
 * Normalize an entity id to its canonical lowercase form.
 *
 * @param value - The id to normalize; mixed case is accepted.
 * @returns The canonical, branded id.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function normalizeEntityId(value: string): EntityId {
  const parsed = parseEntityId(value);
  return `${parsed.prefix}_${parsed.rand}.${parsed.ts}` as EntityId;
}

/**
 * Extract the prefix of an entity id.
 *
 * @param value - The id to inspect.
 * @returns The lowercase prefix.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function entityIdPrefix(value: string): string {
  return parseEntityId(value).prefix;
}

/**
 * A decoded id flattened into a tuple, handy for logging and table rows.
 *
 * @public
 */
export type EntityIdTuple = readonly [
  prefix: string,
  rand: string,
  iso: string,
  timeMs: number,
];

/**
 * Decode an entity id into a `[prefix, rand, iso, timeMs]` tuple.
 *
 * @param entityId - The id to decode.
 * @returns The tuple form of the id.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function entityIdToTuple(entityId: string): EntityIdTuple {
  const parsed = parseEntityId(entityId);
  return [
    parsed.prefix,
    parsed.rand,
    new Date(parsed.timeMs).toISOString(),
    parsed.timeMs,
  ] as const;
}

/**
 * The creation time encoded in an entity id, in milliseconds since the Unix
 * epoch.
 *
 * @param entityId - The id to inspect.
 * @returns Milliseconds since the Unix epoch.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function entityIdToTimeMs(entityId: string): number {
  return parseEntityId(entityId).timeMs;
}

/**
 * Alias of {@link entityIdToTimeMs}.
 *
 * @public
 */
export const getEntityIdTimeMs = entityIdToTimeMs;

/**
 * The creation time encoded in an entity id, as a `Date`.
 *
 * @param entityId - The id to inspect.
 * @returns The creation time.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function entityIdToDate(entityId: string): Date {
  return new Date(entityIdToTimeMs(entityId));
}

/**
 * The creation time encoded in an entity id, as an ISO 8601 string.
 *
 * @param entityId - The id to inspect.
 * @returns The creation time in ISO 8601 form.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function entityIdToIso(entityId: string): string {
  return entityIdToDate(entityId).toISOString();
}

/**
 * Decode a bare 10-character time segment into milliseconds since the Unix
 * epoch.
 *
 * @param ts - The `ts` segment of an entity id.
 * @returns Milliseconds since the Unix epoch.
 * @throws {EntityIdError} When the segment is malformed.
 *
 * @public
 */
export function entityIdTsToTimeMs(ts: string): number {
  const normalized = String(ts ?? '').trim();
  if (!TS_RE.test(normalized)) {
    throw new EntityIdError(
      `Invalid ULID time segment. Expected ${TS_LENGTH} chars Crockford base32.`,
      normalized
    );
  }
  return decodeUlidTime(
    `${normalized}${'0'.repeat(RAND_LENGTH)}`.toUpperCase()
  );
}

/**
 * Recover the canonical ULID an entity id was built from.
 *
 * @param entityId - The id to convert.
 * @returns The 26-character uppercase ULID.
 * @throws {EntityIdError} When the value is not an entity id.
 *
 * @public
 */
export function toUlid(entityId: string): string {
  return parseEntityId(entityId).ulid;
}

/**
 * How {@link compareEntityIds} orders two ids.
 *
 * - `'string'` — plain lexicographic order. Cheap, and stable, but **not**
 *   chronological: the randomness segment precedes the timestamp.
 * - `'time'` — chronological by embedded timestamp, falling back to the ULID
 *   for ids minted in the same millisecond.
 *
 * @public
 */
export type EntityIdCompareMode = 'time' | 'string';

/**
 * Comparator for entity ids, suitable for `Array.prototype.sort`.
 *
 * @param a - First id.
 * @param b - Second id.
 * @param mode - Ordering strategy, see {@link EntityIdCompareMode}. Default:
 * `'string'`.
 * @returns A negative number, zero, or a positive number.
 * @throws {EntityIdError} In `'time'` mode, when either value is not an entity
 * id.
 *
 * @example
 * ```ts
 * ids.sort((a, b) => compareEntityIds(a, b, 'time'));
 * ```
 *
 * @public
 */
export function compareEntityIds(
  a: string,
  b: string,
  mode: EntityIdCompareMode = 'string'
): number {
  if (mode === 'time') {
    const aTime = entityIdToTimeMs(a);
    const bTime = entityIdToTimeMs(b);
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    // Same millisecond: fall back to the ULID for a stable total order.
    const aUlid = toUlid(a);
    const bUlid = toUlid(b);
    return aUlid < bUlid ? -1 : aUlid > bUlid ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
