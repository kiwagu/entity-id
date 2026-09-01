import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
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
  splitting: false,
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
