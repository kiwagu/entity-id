import { afterEach, describe, expect, it } from 'vitest';

import {
  bindValidationMode,
  hasAsyncModeScope,
  withValidationModeAsync,
} from './async.js';
import { createEntityId, isEntityId } from './entity-id.js';
import {
  getValidationMode,
  resetValidationMode,
  setValidationMode,
  withValidationMode,
} from './mode.js';

afterEach(() => {
  resetValidationMode();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A promise plus its resolver, so one task can hand control to the next.
const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};
const HALF_VALID = 'usr_not-canonical';

describe('withValidationMode rejects async callbacks', () => {
  it('throws rather than restoring the mode at the first await', () => {
    expect(() => withValidationMode('full', async () => 'nope')).toThrow(
      TypeError
    );
  });

  it('names the safe alternatives in the error', () => {
    expect(() => withValidationMode('full', async () => 1)).toThrow(
      /entity-id\/async|per-call/
    );
  });

  it('restores the mode even when it rejects the callback', () => {
    setValidationMode('mixed');
    expect(() => withValidationMode('full', async () => 1)).toThrow();
    expect(getValidationMode()).toBe('mixed');
  });

  it('still accepts a thenable-free synchronous result', () => {
    expect(withValidationMode('full', () => 'ok')).toBe('ok');
  });
});

describe('withValidationModeAsync', () => {
  it('holds the mode across awaits', async () => {
    await withValidationModeAsync('full', async () => {
      expect(getValidationMode()).toBe('full');
      await sleep(5);
      // This is the assertion the synchronous helper cannot satisfy.
      expect(getValidationMode()).toBe('full');
      expect(isEntityId(HALF_VALID)).toBe(false);
    });
  });

  it('restores the ambient mode afterwards', async () => {
    setValidationMode('mixed');
    await withValidationModeAsync('full', async () => {
      await sleep(1);
    });
    expect(getValidationMode()).toBe('mixed');
    expect(hasAsyncModeScope()).toBe(false);
  });

  it('isolates concurrent scopes', async () => {
    setValidationMode('mixed');
    const seen: string[] = [];

    // The interleaving is choreographed, not timed. Sleeps of 2, 6 and 10 ms
    // read as ordered, but the three tasks arm their timers one after another,
    // so a loaded machine can start the 6 ms one late enough to expire after
    // the 10 ms one — the order then flips and the test fails on the
    // scheduler rather than on the isolation it is meant to check.
    const bDone = deferred();
    const cDone = deferred();

    await Promise.all([
      withValidationModeAsync('full', async () => {
        // Suspended inside its own scope for the whole of B and C.
        await cDone.promise;
        seen.push(`A:${getValidationMode()}`);
        expect(isEntityId(HALF_VALID)).toBe(false);
      }),
      withValidationModeAsync('fast', async () => {
        await sleep(1);
        seen.push(`B:${getValidationMode()}`);
        expect(isEntityId('anything')).toBe(true);
        bDone.resolve();
      }),
      (async () => {
        await bDone.promise;
        seen.push(`C:${getValidationMode()}`);
        cDone.resolve();
      })(),
    ]);

    // B finishes first, then the unscoped task, then A — each with its own mode.
    expect(seen).toEqual(['B:fast', 'C:mixed', 'A:full']);
    expect(getValidationMode()).toBe('mixed');
  });

  it('nests, innermost winning', async () => {
    await withValidationModeAsync('full', async () => {
      expect(getValidationMode()).toBe('full');
      await withValidationModeAsync('fast', async () => {
        await sleep(1);
        expect(getValidationMode()).toBe('fast');
      });
      await sleep(1);
      expect(getValidationMode()).toBe('full');
    });
  });

  it('propagates into functions called within the scope', async () => {
    const check = async () => {
      await sleep(1);
      return isEntityId(HALF_VALID);
    };
    expect(await check()).toBe(true); // default 'mixed'
    expect(await withValidationModeAsync('full', check)).toBe(false);
  });

  it('restores the scope when the body throws', async () => {
    setValidationMode('mixed');
    await expect(
      withValidationModeAsync('full', async () => {
        await sleep(1);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(getValidationMode()).toBe('mixed');
  });

  it('accepts a synchronous callback too', async () => {
    expect(
      await withValidationModeAsync('full', () => getValidationMode())
    ).toBe('full');
  });

  it('reports whether a scope is active', async () => {
    expect(hasAsyncModeScope()).toBe(false);
    await withValidationModeAsync('fast', async () => {
      expect(hasAsyncModeScope()).toBe(true);
    });
  });
});

describe('bindValidationMode', () => {
  it('pins a handler to a mode', async () => {
    const handler = bindValidationMode('full', async (value: string) => {
      await sleep(1);
      return isEntityId(value);
    });

    expect(await handler(HALF_VALID)).toBe(false);
    expect(await handler(createEntityId('usr'))).toBe(true);
    expect(getValidationMode()).toBe('mixed');
  });

  it('forwards every argument', async () => {
    const join = bindValidationMode(
      'fast',
      async (a: string, b: number, c: boolean) => `${a}${b}${c}`
    );
    expect(await join('x', 1, true)).toBe('x1true');
  });
});

describe('per-call overrides remain the safest option', () => {
  it('work across awaits without any ambient state', async () => {
    setValidationMode('fast');
    const value = HALF_VALID;
    await sleep(1);
    // Not ambient: the option travels with the call, so nothing can race it.
    expect(isEntityId(value, { mode: 'full' })).toBe(false);
    expect(isEntityId(value)).toBe(true);
  });
});
