import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    async: 'src/async.ts',
    sql: 'src/sql.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
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
  // shared chunk. ESM supports it; CJS gets the same effect from tsup's
  // interop, and `src/async.spec.ts` plus the packaged-artifact smoke test
  // guard the behaviour either way.
  splitting: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // `ulid` and `zod` stay external: consumers dedupe them with their own copy.
  external: ['ulid', 'zod'],
  banner({ format }) {
    // The CLI is published as CJS so it runs under a bare `node` shebang
    // regardless of the consumer's package type.
    return format === 'cjs' ? {} : {};
  },
});
