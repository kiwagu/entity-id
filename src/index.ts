/**
 * `entity-id` — prefixed, timestamped entity identifiers.
 *
 * An entity id looks like `usr_a1b2c3d4e5f6g7h8.01jd8x2p4q`: a short prefix
 * naming the kind of thing the id points at, then the two halves of a ULID in
 * lowercase Crockford Base32. The prefix makes an id self-describing in a log
 * or a URL; the ULID gives global uniqueness and an embedded creation time.
 *
 * The package is isomorphic — it runs unchanged in Node, Bun, Deno, edge
 * workers and the browser — and ships branded TypeScript types, Zod schemas and
 * a matching Postgres generator.
 *
 * @packageDocumentation
 */

export {
  assertEntityId,
  assertEntityIdWithPrefix,
  type BrandedEntityId,
  CANONICAL_ENTITY_ID_PATTERN,
  CANONICAL_ENTITY_ID_RE,
  compareEntityIds,
  createEntityId,
  type CreateEntityIdOptions,
  CROCKFORD_CANONICAL_CLASS,
  CROCKFORD_CLASS,
  type EntityId,
  type EntityIdCompareMode,
  ENTITY_ID_PATTERN,
  ENTITY_ID_RE,
  type EntityIdParts,
  entityIdPartsToUlid,
  entityIdPrefix,
  type EntityIdTuple,
  entityIdToDate,
  entityIdToIso,
  entityIdToTimeMs,
  entityIdToTuple,
  entityIdTsToTimeMs,
  fromUlid,
  getEntityIdTimeMs,
  isEntityId,
  isEntityIdWithPrefix,
  normalizeEntityId,
  type ParsedEntityId,
  parseEntityId,
  RAND_LENGTH,
  safeParseEntityId,
  toUlid,
  TS_LENGTH,
  ulidToEntityIdParts,
  unsafeBrandEntityId,
} from './entity-id.js';

export {
  derivePrefixFromSlug,
  type DerivePrefixOptions,
  EntityIdError,
  ensureUniquePrefix,
  isValidPrefix,
  normalizePrefix,
  PREFIX_MAX_LENGTH,
  PREFIX_MIN_LENGTH,
  PREFIX_PATTERN,
  PREFIX_RE,
} from './prefix.js';

export {
  DEFAULT_VALIDATION_MODE,
  getModeProfile,
  getValidationMode,
  type ModeProfile,
  resetValidationMode,
  resolveModeProfile,
  setAmbientModeResolver,
  setValidationMode,
  type ValidationDepth,
  type ValidationMode,
  type ValidationOptions,
  withValidationMode,
} from './mode.js';

export {
  brandedEntityIdSchema,
  type EntityIdJsonSchema,
  entityIdJsonSchema,
  type EntityIdSchema,
  type EntityIdSchemaToolkit,
  entityIdSchema,
  entityIdWithPrefixSchema,
  prefixGatedEntityIdSchema,
  type PrefixSource,
  strictEntityIdSchema,
  toEntityId,
  withSchemas,
} from './schema.js';

export {
  defineEntityPrefixes,
  type EntityIdFactory,
  type EntityIdOf,
  type EntityIdRegistry,
  type EntityIdToolkit,
  type EntityPrefixMap,
} from './registry.js';
