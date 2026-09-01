import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guards the three places that describe the package's entry points and must
 * agree: `exports` in package.json, `paths` in tsconfig.json, and `entry` in
 * tsup.config.ts.
 *
 * They drifted once and CI caught it only after a push: `entity-id/schema` was
 * added to `exports` and to the tsup entries, but not to `paths`. A local
 * `npm run typecheck` still passed, because TypeScript fell back to
 * self-referencing the package through its own `exports` and found a stale
 * `dist/` from an earlier build. On a clean checkout — CI typechecks before it
 * builds — there is no `dist/`, and the examples failed to compile.
 *
 * A grep-based check is enough here and needs no build.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
) as Record<string, unknown>;

const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
const tsup = readFileSync(join(root, 'tsup.config.ts'), 'utf8');

/** Subpaths that map to real TypeScript modules, e.g. `.` and `./schema`. */
const codeSubpaths = Object.keys(pkg.exports as Record<string, unknown>).filter(
  (key) => !key.endsWith('.json') && !key.endsWith('.sql')
);

describe('entry points stay in step', () => {
  it('exposes the expected subpaths', () => {
    expect(codeSubpaths.sort()).toEqual([
      '.',
      './async',
      './registry',
      './schema',
      './sql',
    ]);
  });

  it.each(codeSubpaths)('%s has a tsconfig paths mapping', (subpath) => {
    // Without this mapping a local typecheck silently resolves through a stale
    // dist/ and CI fails on a clean checkout.
    const specifier =
      subpath === '.' ? 'entity-id' : `entity-id/${subpath.slice(2)}`;
    expect(tsconfig).toContain(`"${specifier}":`);
  });

  it.each(codeSubpaths)('%s maps to source, not dist', (subpath) => {
    const specifier =
      subpath === '.' ? 'entity-id' : `entity-id/${subpath.slice(2)}`;
    const line = tsconfig
      .split('\n')
      .find((l) => l.includes(`"${specifier}":`));
    expect(line).toBeDefined();
    expect(line).toContain('./src/');
    expect(line).not.toContain('dist');
  });

  it.each(codeSubpaths)('%s is built by tsup', (subpath) => {
    const name = subpath === '.' ? 'index' : subpath.slice(2);
    expect(tsup).toContain(`${name}: 'src/`);
  });

  it.each(codeSubpaths)('%s declares types first', (subpath) => {
    // A condition order where "types" is not first makes TypeScript resolve the
    // runtime file instead of the declarations.
    const entry = (pkg.exports as Record<string, Record<string, string>>)[
      subpath
    ];
    expect(Object.keys(entry!)[0]).toBe('types');
  });

  it('ships no CommonJS condition', () => {
    // The package is ESM-only; a stray "require" condition would point at a
    // file the build no longer emits.
    for (const subpath of codeSubpaths) {
      const entry = (pkg.exports as Record<string, Record<string, string>>)[
        subpath
      ];
      expect(Object.keys(entry!)).not.toContain('require');
    }
  });
});
