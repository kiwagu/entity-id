/**
 * Async-scoped validation modes, for Node, Bun and Deno.
 *
 * The synchronous {@link withValidationMode} cannot survive an `await`: its
 * callback returns a promise immediately, so the mode would be restored at the
 * first suspension point, and two concurrent requests would overwrite each
 * other's setting. This module fixes that with `AsyncLocalStorage`, so a scope
 * follows the logical flow of control rather than the call stack.
 *
 * It lives behind a separate entry point because it imports `node:async_hooks`,
 * which does not exist in a browser. The main entry point stays isomorphic.
 *
 * ```ts
 * import { withValidationModeAsync } from 'entity-id/async';
 *
 * await withValidationModeAsync('full', async () => {
 *   const body = await request.json();
 *   return userIdSchema.parse(body.userId); // strict, across awaits
 * });
 * ```
 *
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getValidationMode,
  setAmbientModeResolver,
  type ValidationMode,
} from './mode.js';

const storage = new AsyncLocalStorage<ValidationMode>();

// Route the core's mode lookup through this store. Installed on import, so
// merely importing the module makes every scope below it async-aware.
setAmbientModeResolver(() => storage.getStore());

/**
 * Run an asynchronous function with a mode in force for the whole of its
 * execution, including across `await` points and inside anything it calls.
 *
 * Concurrent scopes are isolated: two requests handled at the same time under
 * different modes do not interfere.
 *
 * @param mode - The mode to apply within the scope.
 * @param fn - The function to run; may be async.
 * @returns Whatever `fn` resolves to.
 *
 * @example
 * ```ts
 * // Strict at the edge, cheap inside.
 * const id = await withValidationModeAsync('full', async () => {
 *   const payload = await readBody(request);
 *   return assertEntityIdWithPrefix(payload.id, 'usr');
 * });
 * ```
 *
 * @public
 */
export function withValidationModeAsync<T>(
  mode: ValidationMode,
  fn: () => T | Promise<T>
): Promise<T> {
  return storage.run(mode, async () => fn());
}

/**
 * Wrap a function so every call runs in the given mode — useful as middleware,
 * or to pin one module's entry points to a stricter setting.
 *
 * @param mode - The mode to apply on each call.
 * @param fn - The function to wrap.
 * @returns A function with the same arguments, returning a promise.
 *
 * @example
 * ```ts
 * const handler = bindValidationMode('full', async (req) => { ... });
 * ```
 *
 * @public
 */
export function bindValidationMode<Args extends unknown[], R>(
  mode: ValidationMode,
  fn: (...args: Args) => R | Promise<R>
): (...args: Args) => Promise<R> {
  return (...args: Args) => withValidationModeAsync(mode, () => fn(...args));
}

/**
 * Whether an async mode scope is currently active.
 *
 * @returns `true` when the call sits inside {@link withValidationModeAsync}.
 *
 * @public
 */
export function hasAsyncModeScope(): boolean {
  return storage.getStore() !== undefined;
}

export { getValidationMode };
export type { ValidationMode };
