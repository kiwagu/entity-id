import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    async: 'src/async.ts',
    sql: 'src/sql.ts',
    cli: 'src/cli.ts',
    // `schema.ts` and `registry.ts` are listed as entries so tsup emits them as
    // their OWN chunks instead of inlining them into `dist/index.js`. Inlined,
    // their top-level `import { z } from 'zod'` sits in the main entry, and a
    // bundler must pull all of Zod in for `import { createEntityId }` — ~88 KB
    // gzip for code the consumer never called. As separate chunks the import
    // travels with the schema code, so a consumer who never touches Zod does
    // not pay for it. `scripts/verify-bundle.mjs` measures this and fails if
    // the cost comes back.
    schema: 'src/schema.ts',
    registry: 'src/registry.ts',
  },
  // ESM only. Every Node release still receiving security fixes (22, 24, 26)
  // implements `require(ESM)`, so a CommonJS consumer can load this package
  // without a CJS build; Node 18 and 20 are past end-of-life. Verified against
  // real runtimes: `require()` of an ESM-only build fails on 18 with
  // ERR_REQUIRE_ESM and succeeds on 20+, which is why `engines` demands
  // >=20.19. Dropping CJS removes 32 artifacts (~268 KB unpacked) and the
  // entire dual-package-hazard class, where a consumer can otherwise end up
  // holding two copies of `src/mode.ts` module state.
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Code splitting is REQUIRED, not cosmetic: `src/mode.ts` holds module-level
  // state (the active mode, the async resolver hook). Without splitting, tsup
  // inlines a separate copy of it into every entry, so `entity-id/async` would
  // install its resolver into one copy while the validators read another — and
  // async scopes would silently do nothing. Splitting puts that state in one
  // shared chunk, and `src/async.spec.ts` plus the packaged-artifact smoke test
  // guard the behaviour.
  splitting: true,
  // `ulid` and `zod` stay external: consumers dedupe them with their own copy.
  external: ['ulid', 'zod'],
});
