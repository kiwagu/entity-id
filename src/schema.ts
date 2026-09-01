import { z } from 'zod';

import {
  type BrandedEntityId,
  CANONICAL_ENTITY_ID_PATTERN,
  hasWellFormedPrefix,
  CROCKFORD_CANONICAL_CLASS,
  CROCKFORD_CLASS,
  type EntityId,
  ENTITY_ID_PATTERN,
  normalizeEntityId,
  RAND_LENGTH,
  TS_LENGTH,
} from './entity-id.js';
import { resolveModeProfile } from './mode.js';
import { normalizePrefix } from './prefix.js';

/**
 * Zod schemas for entity ids.
 *
 * Every schema in this module is built as a **codec** — a bidirectional pipe
 * with a plain schema on each side — rather than with `.transform(...)`. This
 * is deliberate: a bare transform is unrepresentable in JSON Schema, which
 * breaks serializing any contract that embeds an id (an OpenAPI document, or an
 * MCP tool's `outputSchema`, hits exactly that). A codec parses identically —
 * validate, trim, normalize — while `z.toJSONSchema` renders the permissive
 * input side for requests and the canonical output side for responses.
 *
 * @module
 */

const INVALID_ID_MESSAGE =
  'Invalid entity id. Expected "<prefix>_<rand16>.<ts10>" with ULID Crockford base32.';

/**
 * The result of `z.toJSONSchema` for an entity-id schema.
 *
 * @public
 */
export type EntityIdJsonSchema = Record<string, unknown>;

function buildCodec(
  inputPattern: string,
  outputPattern: string,
  message: string
) {
  const input = z
    .string()
    .trim()
    .min(1, { message: 'Entity id must not be empty' })
    .regex(new RegExp(`^${inputPattern}$`), { message });

  const output = z.string().regex(new RegExp(`^${outputPattern}$`));

  return z.codec(input, output, {
    decode: (raw: string) => normalizeEntityId(raw.trim()),
    encode: (canonical: string) => canonical,
  });
}

/**
 * A schema whose runtime strictness follows the active mode, while its JSON
 * Schema keeps advertising the full canonical pattern.
 *
 * The two are deliberately decoupled: a mode is a local performance decision,
 * whereas the published contract must always describe what the format actually
 * is. A `'mixed'`-mode service still documents complete ids.
 */
function buildModalSchema(
  prefix: string | undefined,
  inputPattern: string,
  outputPattern: string,
  message: string
) {
  const expectedHead = prefix === undefined ? undefined : `${prefix}_`;

  const lenient = z
    .string()
    .superRefine((raw: string, ctx: z.RefinementCtx) => {
      const { validation } = resolveModeProfile();
      if (validation === 'none') return;

      const value = raw.trim();
      if (!value) {
        ctx.addIssue({
          code: 'custom',
          message: 'Entity id must not be empty',
        });
        return;
      }
      if (expectedHead === undefined) {
        // No fixed prefix to compare against, so 'mixed' still has to verify
        // that the head IS a valid prefix — otherwise the mode would accept
        // any non-empty string.
        if (!hasWellFormedPrefix(value)) {
          ctx.addIssue({ code: 'custom', message });
          return;
        }
      } else if (!value.startsWith(expectedHead)) {
        ctx.addIssue({ code: 'custom', message });
        return;
      }
      if (
        validation === 'full' &&
        !new RegExp(`^${inputPattern}$`).test(value)
      ) {
        ctx.addIssue({ code: 'custom', message });
      }
    })
    // The pattern is attached as metadata so a mode-aware schema still
    // serializes to a complete JSON Schema, exactly like the strict codec.
    .meta({ pattern: `^${inputPattern}$` });

  return z.codec(lenient, z.string().meta({ pattern: `^${outputPattern}$` }), {
    decode: (raw: string) => {
      const { validation } = resolveModeProfile();
      // Only `'full'` normalizes; the cheaper modes hand the value straight
      // through, which is the point of choosing them.
      return validation === 'full' ? normalizeEntityId(raw.trim()) : raw;
    },
    encode: (canonical: string) => canonical,
  });
}

/**
 * The canonical entity-id schema: validates any well-formed id, normalizes it
 * to lowercase, and brands the result as {@link EntityId}.
 *
 * Mixed-case input is accepted and surrounding whitespace is trimmed; the
 * parsed output is always canonical.
 *
 * @example
 * ```ts
 * const id = entityIdSchema.parse(' USR_A1B2C3D4E5F6G7H8.01JD8X2P4Q ');
 * // 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q', typed as EntityId
 *
 * entityIdSchema.safeParse('nope').success; // false
 * ```
 *
 * @public
 */
export const entityIdSchema = buildModalSchema(
  undefined,
  ENTITY_ID_PATTERN,
  CANONICAL_ENTITY_ID_PATTERN,
  INVALID_ID_MESSAGE
).brand<'EntityId'>();

/**
 * The always-strict entity-id schema, unaffected by the active mode.
 *
 * Use it at a trust boundary that must stay strict no matter how the process is
 * configured — parsing a webhook body, say, inside an application that runs in
 * `'fast'` mode everywhere else.
 *
 * @public
 */
export const strictEntityIdSchema = buildCodec(
  ENTITY_ID_PATTERN,
  CANONICAL_ENTITY_ID_PATTERN,
  INVALID_ID_MESSAGE
).brand<'EntityId'>();

/**
 * The type of {@link entityIdSchema} and of every schema built by
 * {@link entityIdWithPrefixSchema} or {@link brandedEntityIdSchema}.
 *
 * @typeParam Brand - The brand tag carried by the parsed output.
 *
 * @public
 */
export type EntityIdSchema<Brand extends string = 'EntityId'> = z.ZodType<
  BrandedEntityId<Brand>,
  string
>;

/**
 * A schema that requires a specific prefix.
 *
 * The prefix is a runtime argument, so this doubles as the dynamic schema
 * factory for a prefix known only at runtime. The prefix is baked into the
 * regular expression, so the emitted JSON Schema advertises it too.
 *
 * @param prefix - Required entity-type tag.
 * @returns A schema whose parsed output is a branded {@link EntityId}.
 * @throws {EntityIdError} When the prefix itself is invalid.
 *
 * @example
 * ```ts
 * const userIdSchema = entityIdWithPrefixSchema('usr');
 * userIdSchema.parse('usr_a1b2c3d4e5f6g7h8.01jd8x2p4q'); // ok
 * userIdSchema.safeParse('ord_a1b2c3d4e5f6g7h8.01jd8x2p4q').success; // false
 * ```
 *
 * @public
 */
export function entityIdWithPrefixSchema(prefix: string): EntityIdSchema {
  const normalizedPrefix = normalizePrefix(prefix);
  return buildModalSchema(
    normalizedPrefix,
    `${normalizedPrefix}_${CROCKFORD_CLASS}{${RAND_LENGTH}}\\.${CROCKFORD_CLASS}{${TS_LENGTH}}`,
    `${normalizedPrefix}_${CROCKFORD_CANONICAL_CLASS}{${RAND_LENGTH}}\\.${CROCKFORD_CANONICAL_CLASS}{${TS_LENGTH}}`,
    `Entity id must start with "${normalizedPrefix}_" and match "<prefix>_<rand16>.<ts10>".`
  ).brand<'EntityId'>() as unknown as EntityIdSchema;
}

/**
 * A per-kind branded schema for a fixed prefix.
 *
 * `brandedEntityIdSchema<'user'>('usr')` yields a schema whose parsed output is
 * a `BrandedEntityId<'user'>`, distinct at compile time from every other
 * branded id. Parsing is the only way to obtain the branded value, which is
 * what makes "parse, don't validate" enforceable for identifiers.
 *
 * @typeParam Brand - The brand tag for the parsed output.
 * @param prefix - Required entity-type tag.
 * @returns A schema producing `BrandedEntityId<Brand>`.
 *
 * @example
 * ```ts
 * type UserId = BrandedEntityId<'user'>;
 * const userIdSchema = brandedEntityIdSchema<'user'>('usr');
 *
 * const id: UserId = userIdSchema.parse(input);
 * ```
 *
 * @public
 */
export function brandedEntityIdSchema<Brand extends string>(
  prefix: string
): EntityIdSchema<Brand> {
  return entityIdWithPrefixSchema(prefix) as unknown as EntityIdSchema<Brand>;
}

/**
 * A lenient, prefix-gated schema: it checks only that the value is a non-empty
 * string carrying `<prefix>_`, then brands it — **without** enforcing the
 * canonical `<rand16>.<ts10>` suffix.
 *
 * This catches a swapped-kind id at a boundary (a `usr_…` handed to an `ord_…`
 * slot is rejected at runtime, not merely at compile time) while tolerating
 * non-canonical placeholder suffixes, so fixtures and negative tests that pass
 * a correctly-prefixed but synthetic id still reach the handler's own
 * not-found path. Upgrade to {@link brandedEntityIdSchema} for full-format
 * validation.
 *
 * @typeParam Brand - The brand tag for the parsed output.
 * @param prefix - Required entity-type tag.
 * @returns A schema producing `BrandedEntityId<Brand>`.
 *
 * @public
 */
export function prefixGatedEntityIdSchema<Brand extends string>(
  prefix: string
): EntityIdSchema<Brand> {
  const normalizedPrefix = normalizePrefix(prefix);
  return z
    .string()
    .min(1)
    .refine((value) => value.startsWith(`${normalizedPrefix}_`), {
      message: `Entity id must start with "${normalizedPrefix}_".`,
    }) as unknown as EntityIdSchema<Brand>;
}

/**
 * The JSON Schema for an entity-id schema.
 *
 * @param schema - Any schema from this module. Defaults to
 * {@link entityIdSchema}.
 * @param io - Which side to render: `'input'` for a request payload (mixed case
 * accepted), `'output'` for a response payload (canonical lowercase). Default:
 * `'output'`.
 * @returns A plain JSON Schema object, safe to embed in an OpenAPI document or
 * a tool contract.
 *
 * @example
 * ```ts
 * entityIdJsonSchema(entityIdWithPrefixSchema('usr'), 'output');
 * // { type: 'string', pattern: '^usr_[0-9a-hjkmnp-tv-z]{16}\\.[0-9a-hjkmnp-tv-z]{10}$' }
 * ```
 *
 * @public
 */
export function entityIdJsonSchema(
  schema: z.ZodType = entityIdSchema,
  io: 'input' | 'output' = 'output'
): EntityIdJsonSchema {
  return z.toJSONSchema(schema, { io });
}

/**
 * Coerce an unknown value into a canonical entity id, or `undefined`.
 *
 * A convenience wrapper over `entityIdSchema.safeParse` for parsing values off
 * the wire where an invalid id should be treated as absent rather than fatal.
 *
 * @param value - Candidate value of any type.
 * @returns The canonical id, or `undefined` when the value is not one.
 *
 * @public
 */
export function toEntityId(value: unknown): EntityId | undefined {
  const result = entityIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * The Zod members for one registered entity kind, as returned by
 * {@link withSchemas}.
 *
 * @typeParam K - The entity kind's name, used as the brand.
 *
 * @public
 */
export type EntityIdSchemaToolkit<K extends string = string> = Readonly<{
  /**
   * Strict schema: validates the full `<prefix>_<rand16>.<ts10>` contract and
   * brands the parsed output as this kind's id.
   */
  schema: EntityIdSchema<K>;
  /**
   * Lenient, prefix-gated schema: checks the `<prefix>_` head only, then
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
 * The minimal shape {@link withSchemas} needs from a registry. Declared
 * structurally so `schema.ts` does not import `registry.ts` — the two modules
 * stay independent, and a consumer of one never pulls in the other.
 *
 * @public
 */
export type PrefixSource = Readonly<{
  ids: Readonly<Record<string, Readonly<{ prefix: string }>>>;
}>;

/**
 * Derive Zod schemas for every kind in a registry.
 *
 * The registry itself is Zod-free by design: an application that only mints and
 * checks ids should not bundle a validator library it never calls. Importing
 * this function is the opt-in — the cost arrives with the import, in the module
 * that actually wants schemas.
 *
 * @param registry - A registry from `defineEntityPrefixes`, or any object with
 * a compatible `ids` map.
 * @returns One {@link EntityIdSchemaToolkit} per kind, keyed by kind name.
 *
 * @example
 * ```ts
 * import { defineEntityPrefixes } from 'entity-id';
 * import { withSchemas } from 'entity-id/schema';
 *
 * const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' });
 * const schemas = withSchemas(registry);
 *
 * schemas.user.schema.parse(someValue);   // branded UserId
 * schemas.user.jsonSchema();              // { type: 'string', pattern: … }
 * ```
 *
 * @public
 */
export function withSchemas<TRegistry extends PrefixSource>(
  registry: TRegistry
): {
  readonly [K in keyof TRegistry['ids'] & string]: EntityIdSchemaToolkit<K>;
} {
  const entries = Object.entries(registry.ids).map(([kind, toolkit]) => {
    const { prefix } = toolkit;
    // Built once per kind and closed over, so repeated access is free and the
    // schema identity stays stable — `z.infer` narrowing and any Map keyed by
    // a schema depend on that.
    const schema = brandedEntityIdSchema(prefix);
    return [
      kind,
      Object.freeze({
        schema,
        prefixSchema: prefixGatedEntityIdSchema(prefix),
        jsonSchema: (io: 'input' | 'output' = 'output') =>
          entityIdJsonSchema(schema as never, io),
      }),
    ] as const;
  });

  return Object.freeze(Object.fromEntries(entries)) as {
    readonly [K in keyof TRegistry['ids'] & string]: EntityIdSchemaToolkit<K>;
  };
}
