/**
 * Operating modes.
 *
 * A mode is a named trade-off between speed and strictness, chosen once for a
 * process and overridable per call. Today a mode decides how thoroughly a value
 * is checked before it is accepted as an id; the concept is deliberately
 * broader than "validation level" so that later capabilities can be added as
 * new fields of a mode's profile, without renaming the modes themselves or
 * breaking a caller that already selected one.
 *
 * @module
 */

/**
 * How strictly this package validates.
 *
 * - `'fast'` — **no validation at all**, on the cheapest possible code path.
 *   Decoding splits the string instead of matching a regular expression, and
 *   malformed input yields nonsense rather than an error. Use it only where the
 *   value is already known to be good: rows read back from a column with the
 *   `CHECK` constraint installed, or ids this process minted itself.
 * - `'mixed'` — **the default**, and where business logic should start. A value
 *   must carry a well-formed prefix (`usr_`), which is what catches the mistake
 *   that actually happens in practice: an id of the wrong kind arriving in the
 *   wrong slot. The random and timestamp segments are not inspected.
 * - `'full'` — every rule: prefix shape, both segment lengths, the Crockford
 *   alphabet, and the overall shape. Use it at a trust boundary — an HTTP
 *   request, a webhook, a file import.
 *
 * @public
 */
export type ValidationMode = 'fast' | 'mixed' | 'full';

/**
 * How much checking a mode performs.
 *
 * - `'none'` — accept anything.
 * - `'prefix'` — require a well-formed (or, when known, a specific) prefix.
 * - `'full'` — require the complete canonical contract.
 *
 * @public
 */
export type ValidationDepth = 'none' | 'prefix' | 'full';

/**
 * The capabilities a mode turns on.
 *
 * New capabilities are added here as optional fields, so a future release can
 * extend what a mode does without changing the mode names or the call sites
 * that select them.
 *
 * @public
 */
export type ModeProfile = Readonly<{
  /** The mode this profile describes. */
  mode: ValidationMode;
  /** How thoroughly a value is checked before it is accepted. */
  validation: ValidationDepth;
  /**
   * Whether decoding takes the cheap path — splitting the string rather than
   * matching a regular expression, and decoding the timestamp with a direct
   * base32 loop. Malformed input then produces nonsense instead of an error.
   */
  fastDecode: boolean;
}>;

const PROFILES: Readonly<Record<ValidationMode, ModeProfile>> = Object.freeze({
  fast: Object.freeze({
    mode: 'fast',
    validation: 'none',
    fastDecode: true,
  }),
  mixed: Object.freeze({
    mode: 'mixed',
    validation: 'prefix',
    fastDecode: true,
  }),
  full: Object.freeze({
    mode: 'full',
    validation: 'full',
    fastDecode: false,
  }),
});

/**
 * The mode used when nothing is configured: `'mixed'`.
 *
 * @public
 */
export const DEFAULT_VALIDATION_MODE: ValidationMode = 'mixed';

let activeMode: ValidationMode = DEFAULT_VALIDATION_MODE;

/**
 * The profile of a mode, or of the active mode when none is given.
 *
 * @param mode - Mode to describe. Defaults to the active mode.
 * @returns The frozen profile.
 *
 * @public
 */
export function getModeProfile(mode?: ValidationMode): ModeProfile {
  return PROFILES[mode ?? activeMode];
}

/**
 * The mode currently in force for this process.
 *
 * @returns The active mode.
 *
 * @public
 */
export function getValidationMode(): ValidationMode {
  return activeMode;
}

/**
 * Set the mode for this process.
 *
 * Call it once, at startup, before any id is validated. A library should not
 * call this — it would silently change the behaviour of the application that
 * depends on it; pass a per-call `mode` instead.
 *
 * @param mode - The mode to activate.
 * @returns The previous mode, so a caller can restore it.
 * @throws {TypeError} When the mode is not one of the three known values.
 *
 * @example
 * ```ts
 * import { setValidationMode } from 'entity-id';
 *
 * setValidationMode('full'); // strict at the edge of a public API
 * ```
 *
 * @public
 */
export function setValidationMode(mode: ValidationMode): ValidationMode {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, mode)) {
    throw new TypeError(
      `Unknown validation mode "${String(mode)}". Expected 'fast', 'mixed' or 'full'.`
    );
  }
  const previous = activeMode;
  activeMode = mode;
  return previous;
}

/**
 * Restore the default mode (`'mixed'`).
 *
 * @returns The previous mode.
 *
 * @public
 */
export function resetValidationMode(): ValidationMode {
  return setValidationMode(DEFAULT_VALIDATION_MODE);
}

/**
 * Run a function with a mode temporarily in force, restoring the previous mode
 * afterwards — including when the function throws.
 *
 * The override is synchronous and process-wide: it is not tied to an async
 * context, so do not rely on it across an `await` that yields to other work.
 * For a single operation, prefer the per-call `mode` option.
 *
 * @param mode - The mode to apply for the duration of the call.
 * @param fn - The function to run.
 * @returns Whatever `fn` returns.
 *
 * @example
 * ```ts
 * const parsed = withValidationMode('full', () => parseEntityId(untrusted));
 * ```
 *
 * @public
 */
export function withValidationMode<T>(mode: ValidationMode, fn: () => T): T {
  const previous = setValidationMode(mode);
  try {
    return fn();
  } finally {
    activeMode = previous;
  }
}

/**
 * A per-call mode override, accepted by every validating function.
 *
 * @public
 */
export type ValidationOptions = Readonly<{
  /**
   * Mode for this call only, overriding the process-wide setting. Use it when
   * one boundary needs to be stricter (or cheaper) than the rest of the
   * application.
   */
  mode?: ValidationMode;
}>;

/**
 * Resolve the mode a call should use: its own override, else the active mode.
 *
 * @param options - Per-call options, possibly carrying a `mode`.
 * @returns The mode profile to apply.
 *
 * @public
 */
export function resolveModeProfile(options?: ValidationOptions): ModeProfile {
  const override = options?.mode;
  return PROFILES[override ?? activeMode];
}
