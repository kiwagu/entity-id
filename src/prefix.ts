/**
 * Prefix primitives for entity ids.
 *
 * A prefix is the short, human-readable tag at the head of an entity id
 * (`usr_…`, `ord_…`). Validation is permissive — lowercase, starts with a
 * letter, alphanumeric, 2–16 characters — so a conventional prefix such as
 * `req` may keep its vowels. To mint a prefix from an entity slug
 * programmatically, use {@link derivePrefixFromSlug}, which compresses a word
 * to a short consonant skeleton (`program` → `prg`, `project` → `prj`).
 *
 * @module
 */

/**
 * Prefix body pattern, without anchors.
 *
 * Exported as the single source of the prefix shape so that the full-id regular
 * expression, the JSON Schema output and the SQL generator all stay in sync.
 *
 * @public
 */
export const PREFIX_PATTERN = '[a-z][a-z0-9]{1,15}';

/**
 * Anchored prefix pattern: lowercase, starts with a letter, 2–16 characters.
 *
 * @public
 */
export const PREFIX_RE = new RegExp(`^${PREFIX_PATTERN}$`);

/** Minimum prefix length allowed by {@link PREFIX_RE}. */
export const PREFIX_MIN_LENGTH = 2;

/** Maximum prefix length allowed by {@link PREFIX_RE}. */
export const PREFIX_MAX_LENGTH = 16;

/**
 * Thrown when a value does not satisfy the entity-id or prefix contract.
 *
 * Carries the offending value so a caller can log or re-throw with context
 * without re-parsing the message.
 *
 * @public
 */
export class EntityIdError extends Error {
  override readonly name = 'EntityIdError';

  /** The value that failed validation, when one was available. */
  readonly value: string | undefined;

  constructor(message: string, value?: string) {
    super(message);
    this.value = value;
    // Restore the prototype chain when compiled down to ES5-era output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Whether a string is a well-formed prefix, after trimming and lowercasing.
 *
 * @param prefix - Candidate prefix.
 * @returns `true` when the normalized value matches {@link PREFIX_RE}.
 *
 * @example
 * ```ts
 * isValidPrefix('usr'); // true
 * isValidPrefix('U');   // false — too short
 * ```
 *
 * @public
 */
export function isValidPrefix(prefix: string): boolean {
  return PREFIX_RE.test(
    String(prefix ?? '')
      .trim()
      .toLowerCase()
  );
}

/**
 * Normalize and validate a prefix: trim, lowercase, then assert the shape.
 *
 * @param prefix - Candidate prefix.
 * @returns The normalized (lowercase, trimmed) prefix.
 * @throws {EntityIdError} When the value cannot form a valid id head.
 *
 * @example
 * ```ts
 * normalizePrefix('  USR '); // 'usr'
 * ```
 *
 * @public
 */
export function normalizePrefix(prefix: string): string {
  const value = String(prefix ?? '')
    .trim()
    .toLowerCase();
  if (!PREFIX_RE.test(value)) {
    throw new EntityIdError(
      `Invalid entity prefix "${String(prefix)}". Expected ${PREFIX_RE.source}.`,
      String(prefix)
    );
  }
  return value;
}

/**
 * Options for {@link derivePrefixFromSlug}.
 *
 * @public
 */
export type DerivePrefixOptions = Readonly<{
  /** Minimum length of the derived prefix. Default: `3`. */
  minLen?: number;
  /** Maximum length of the derived prefix. Default: `10`. */
  maxLen?: number;
}>;

/**
 * Derive a short, readable prefix from an entity slug.
 *
 * The algorithm is deterministic:
 * 1. keep the first character of the slug;
 * 2. drop vowels from the remainder;
 * 3. split on non-letters into words;
 * 4. drop a trailing plural `s` per word;
 * 5. keep the first four characters per word;
 * 6. collapse repeated letters;
 * 7. truncate to `maxLen`, and fall back to `slug.slice(0, minLen)` when the
 *    result is shorter than `minLen`.
 *
 * @param slug - Entity slug, for example `'knowledge_resource'`.
 * @param options - Length bounds, see {@link DerivePrefixOptions}.
 * @returns A normalized prefix.
 * @throws {EntityIdError} When the slug is empty or compresses to an invalid
 * prefix.
 *
 * @example
 * ```ts
 * derivePrefixFromSlug('project');  // 'prj'
 * derivePrefixFromSlug('program');  // 'prg'
 * derivePrefixFromSlug('user');     // 'usr'
 * ```
 *
 * @public
 */
export function derivePrefixFromSlug(
  slug: string,
  options: DerivePrefixOptions = {}
): string {
  const minLen = options.minLen ?? 3;
  const maxLen = options.maxLen ?? 10;

  const raw = String(slug ?? '').trim();
  if (raw.length === 0) {
    throw new EntityIdError('Cannot derive a prefix from an empty slug.', slug);
  }

  const first = raw[0] ?? '';
  const rest = raw
    .slice(1)
    .replace(/[aeiou]/gi, '')
    .split(/[^a-zA-Z]+/)
    .map((word) => word.replace(/s$/i, ''))
    .map((word) => word.slice(0, 4))
    .join('');

  let basePrefix = `${first}${rest}`
    .replace(/([a-zA-Z])\1+/g, '$1')
    .slice(0, maxLen)
    .toLowerCase();

  if (basePrefix.length < minLen) {
    basePrefix = raw.slice(0, minLen).toLowerCase();
  }

  // Guarantee the leading character is a letter, as the contract requires.
  if (!/^[a-z]/.test(basePrefix)) {
    basePrefix = `x${basePrefix}`.slice(0, maxLen);
  }

  // A very short slug (`'a'`) cannot reach the minimum on its own; pad it so
  // the function's contract — "always returns a valid prefix" — holds.
  if (basePrefix.length < PREFIX_MIN_LENGTH) {
    basePrefix = basePrefix.padEnd(PREFIX_MIN_LENGTH, 'x');
  }

  return normalizePrefix(
    basePrefix.slice(0, Math.max(minLen, PREFIX_MIN_LENGTH))
  );
}

/**
 * Make a prefix unique within a set of already-used prefixes by appending
 * further slug characters, then a numeric suffix.
 *
 * @param basePrefix - The candidate prefix, typically from
 * {@link derivePrefixFromSlug}.
 * @param slug - The slug the base prefix came from, used to source extra
 * characters.
 * @param usedPrefixes - Prefixes already taken.
 * @param options - `maxLen` caps the result. Default: `10`.
 * @returns A normalized prefix not present in `usedPrefixes`.
 * @throws {EntityIdError} When no valid unique prefix can be produced.
 *
 * @example
 * ```ts
 * const used = new Set(['prj']);
 * ensureUniquePrefix('prj', 'project', used); // 'prjr'
 * ```
 *
 * @public
 */
export function ensureUniquePrefix(
  basePrefix: string,
  slug: string,
  usedPrefixes: ReadonlySet<string>,
  options: Readonly<{ maxLen?: number }> = {}
): string {
  const maxLen = options.maxLen ?? 10;
  const normalizedBase = normalizePrefix(basePrefix).slice(0, maxLen);

  let prefix = normalizedBase;
  let i = 1;

  while (usedPrefixes.has(prefix)) {
    if (i > 1000) {
      throw new EntityIdError(
        `Could not derive a unique prefix from "${normalizedBase}".`,
        normalizedBase
      );
    }
    const extra = slug[i] ?? String(i);
    const candidate = `${normalizedBase}${extra}`.slice(0, maxLen);
    const filtered = candidate.replace(/[^a-z0-9]/g, '').slice(0, maxLen);
    prefix = normalizePrefix(filtered.length === 0 ? normalizedBase : filtered);
    i++;
  }

  return prefix;
}
