# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ParsedEntityId` carries `iso`, the creation time as an ISO 8601 string, so
  the result of `parseEntityId` or `safeParseEntityId` can go straight into a
  log line or an API response without a second decode. It is `''` when the
  time does not decode, which only the `fast` and `mixed` modes let through.
  The CLI's `inspect` output keeps its shape: it already printed `iso`, and now
  takes it from the parse.
- `registry.factories`: the per-kind factories keyed `<kind>IdFactory`, and the
  `EntityIdFactory` type that names one. `registry.ids` keys each factory by the
  bare kind, so destructuring it shadowed the entity variables beside it
  (`user`, `order`); the new keys say what the value is:

  ```ts
  // before
  const { user, order } = registry.ids;
  // after
  const { userIdFactory, orderIdFactory } = registry.factories;
  ```

  Both maps hold the same frozen factory objects.

### Changed

- `parseEntityId` builds the ISO string on every call, which costs about
  0.4–0.5 µs: a `fast`-mode parse runs at ~1.8 M/s against ~7.3 M/s for the
  same decoding without it, and a `full`-mode parse at ~0.95 M/s against
  ~1.9 M/s. `entityIdToTimeMs`, `entityIdToDate`, `normalizeEntityId`,
  `compareEntityIds`, `entityIdPrefix` and `toUlid` decode without it and are
  unaffected.
- `entityIdToTuple` no longer throws a `RangeError` on a value the `fast` or
  `mixed` mode lets through but whose time does not decode (`usr_abc.def` under
  the default mode): it returns `''` for the ISO time and `NaN` for the time,
  as `parseEntityId` does.
- The CLI's `inspect` command decodes with full validation. It used to decode
  under the default `mixed` mode, which checks only the `<prefix>_` head, so a
  malformed id behind a valid head either printed a meaningless decode and
  exited 0, or, when its time did not decode, failed with the unrelated
  `Invalid time value` message. Any malformed id now exits 1 with the
  `EntityIdError` message.
- Dependencies: `zod` 4.6, ESLint 10 and the current dev toolchain. With zod
  4.6 the `entity-id/schema` entry bundles to ~93 KB gzip, up from ~88 KB; the
  main entry and the registry still carry no Zod. `vitest` stays on 4 while
  Node 20 is in the CI matrix, since vitest 5 requires Node 22.12 or newer. The
  `typescript` devDependency stays on 5.9 because `typescript-eslint` supports
  TypeScript only below 6.1; consumers are not held back, as the CI matrix
  type-checks the declarations against TypeScript 7.0.

### Deprecated

- `registry.ids`, in favour of `registry.factories`, and the `EntityIdToolkit`
  type, in favour of `EntityIdFactory`. Both keep working through 1.x; removal
  is planned for the next major.

## [1.1.3] - 2026-09-02

No change to the packaged code. Cut so that the tag, the published version and
`main` all name the same commit: 1.1.2 was published from a manually dispatched
run, and later commits left its tag behind. It is also the first release to go
through the tag-triggered path from end to end.

## [1.1.2] - 2026-09-02

Re-release of 1.1.1 which, like 1.1.0 before it, was tagged but never reached
the registry — the publish path was being moved off a personal token and onto
trusted publishing. The packaged files are unchanged, so everything listed
under 1.1.1 and 1.1.0 ships here.

### Changed

- The README describes what `mixed` accepts instead of embedding a sample
  injection string. The literal payload was what had kept the package from
  being published at all: every release attempt carrying it was refused by the
  registry, and the same tarball went through once the line was reworded. The
  warning itself is unchanged — if anything sharper, since the text now says
  outright that the tail is returned untouched.

## [1.1.1] - 2026-09-02

Re-release of 1.1.0, which was tagged but never reached the registry. The
packaged files are identical, so everything listed under 1.1.0 ships here.

### Fixed

- `package-lock.json` no longer drifts from `package.json`. Since 1.0.0 it had
  kept recording version `1.0.0`, `dist/cli.cjs` as the `bin` target and
  `node >=18`; `npm ci` validates only the dependency graph and never reads
  those fields, so no pipeline could catch it. The lockfile is not part of the
  published tarball — no released artifact was affected, and the stale metadata
  only reached people cloning the repository.

### Repository

- CI now re-resolves the lockfile on a clean tree and fails if it moves, so the
  drift above cannot come back unnoticed. The step pins npm, because npm 11 and
  12 disagree about the `libc` field on optional native packages and an
  unpinned runner would rewrite the lock on its own.
- `allowScripts` denies esbuild's `postinstall` (npm 12 blocks unreviewed
  install scripts and asks for a decision). The script only swaps the `esbuild`
  CLI shim for the native binary; both `tsup` and `vitest` reach esbuild
  through its JavaScript API, and the full build and test suite pass without it.
  The field is project-local policy and has no effect on anyone installing this
  package.

## [1.1.0] - 2026-09-02

Prompted by a review of the first real adoption of 1.0.0, which found that the
default mode was weaker than the documentation implied.

### Fixed

- **Parsed ids are now normalized in every mode.** Previously only `'full'`
  canonicalized, so under the default `'mixed'` a schema returned mixed-case
  input unchanged — and the same logical id stopped comparing equal to the
  canonical form a database round-trip returns. Normalization decides what a
  value *is*, not how strictly it is checked, so it no longer depends on a
  performance setting. Costs ~42 ns per parse in `mixed` (7.6 M/s to 5.8 M/s);
  `full` is unaffected.

### Changed

- `withSchemas(...).schema` no longer documents itself as "strict". It follows
  the active mode — the code always did, but the JSDoc promised otherwise,
  which is how a consumer shipped a laxer boundary than they intended. The
  README now states plainly that `mixed` checks the `<prefix>_` head only,
  shows what that accepts (`mem_' OR 1=1--`, unbounded length), and names the
  three ways to demand strictness where it matters.

### Notes for adopters

If ids cross a trust boundary or reach a database, do not rely on the ambient
mode. Use `strictEntityIdSchema`, pass `{ mode: 'full' }` per call, or build
project-owned schemas from the exported `CROCKFORD_CANONICAL_CLASS`,
`RAND_LENGTH` and `TS_LENGTH`; the last is the only option that cannot be
weakened by a future entry point forgetting a line.

## [1.0.0] - 2026-09-01

First public release.

### Added

- Three operating modes — `fast`, `mixed` (default) and `full` — selected
  globally with `setValidationMode`, scoped with `withValidationMode`, or
  overridden per call with a `{ mode }` argument. A mode is an extensible
  profile (`ModeProfile`), so later capabilities can be added without renaming
  the modes. `strictEntityIdSchema` stays strict regardless of the active mode,
  and the emitted JSON Schema always advertises the full canonical pattern.
- `entity-id/async`: `withValidationModeAsync`, `bindValidationMode` and
  `hasAsyncModeScope`, backing mode scopes with `AsyncLocalStorage` so a mode
  survives an `await` and concurrent scopes stay isolated. It is a separate
  entry point so the main one remains isomorphic.
- `withValidationMode` now throws a `TypeError` when handed an `async`
  function, instead of silently restoring the mode at the first `await`.
- **ESM only.** Every Node release still receiving security fixes implements
  `require(ESM)`, so a CommonJS consumer loads the package directly; `engines`
  is `>=20.19`, the floor where that works (Node 18 fails with
  `ERR_REQUIRE_ESM`, verified against real runtimes). This removes 32 build
  artifacts (~268 KB unpacked, tarball 114.9 KB to 70.9 KB) and the
  dual-package hazard around the module-level validation mode.
- `entity-id/schema` and `entity-id/registry` subpath entry points, added
  alongside the existing main-entry re-exports — nothing moved, so no import
  breaks. They exist so the build emits those modules as separate chunks:
  previously their top-level Zod import was inlined into `dist/index.js`, and
  `import { createEntityId }` cost ~88 KB gzip in a consumer bundle. It now
  costs ~2.5 KB. `scripts/verify-bundle.mjs` (`npm run verify:bundle`) measures
  this against the packed tarball and fails if the cost returns.
- The per-kind toolkit no longer carries `.schema`, `.prefixSchema` or
  `.jsonSchema`. They move to `withSchemas(registry)` in `entity-id/schema`,
  which returns the same three members keyed by kind. This is what makes the
  registry Zod-free in a consumer bundle — 3.1 KB gzip against 89.1 KB — and a
  lazy getter could not have achieved it, because a static import pulls Zod
  into the module graph however the value is reached.

  ```ts
  // before
  registry.ids.user.schema.parse(value);
  // after
  import { withSchemas } from 'entity-id/schema';
  const schemas = withSchemas(registry);
  schemas.user.schema.parse(value);
  ```
- Optional chronological ordering in PostgreSQL without adding a column: the
  migration installs the immutable `public.entity_id_ts_of`, and
  `entityIdTimeIndexSql` / `entityIdTimeOrderSql` in `entity-id/sql` render the
  index and the `ORDER BY`. Measured on 200 000 rows: ~0.17 ms for a
  newest-first `LIMIT 50` against ~142 ms with no index. A `created_at` column
  remains the recommended default (~0.08 ms, smaller index).
- Seven runnable examples in `examples/`, executed by `npm run examples`,
  covering the three modes synchronously and asynchronously, and where to
  initialize the mode in an application.
- `hasWellFormedPrefix`, the `'mixed'`-mode head check, exported for reuse.
- `bench/throughput.bench.ts` (`npm run bench`): ids per second for generation,
  validation and decoding in every mode, against `ulid` and `crypto.randomUUID`
  baselines.
- `createEntityId`, `fromUlid` and `unsafeBrandEntityId` for minting ids in the
  `<prefix>_<rand16>.<ts10>` format.
- Branded types `EntityId` and `BrandedEntityId<Brand>`, so a plain string is
  not assignable to an id and two entity kinds are not interchangeable.
- Zod schemas built as codecs — `entityIdSchema`, `entityIdWithPrefixSchema`,
  `brandedEntityIdSchema`, `prefixGatedEntityIdSchema` — which stay
  representable in JSON Schema, unlike a `.transform()`-based schema.
- `entityIdJsonSchema(schema, io)` rendering the permissive input side or the
  canonical output side of the contract.
- `defineEntityPrefixes(map)`: a registry that validates prefixes eagerly
  (rejecting malformed and duplicate entries) and derives a
  create/guard/assert/schema toolkit per entity kind, plus `kindOf`,
  `kindForPrefix` and `assertKnown` lookups.
- Inspection helpers: `parseEntityId`, `safeParseEntityId`, `normalizeEntityId`,
  `entityIdPrefix`, `entityIdToTimeMs`, `entityIdToDate`, `entityIdToIso`,
  `entityIdToTuple`, `toUlid`, `compareEntityIds`.
- Prefix helpers: `normalizePrefix`, `isValidPrefix`, `derivePrefixFromSlug`,
  `ensureUniquePrefix`.
- `entity-id/sql`: the PostgreSQL implementation of the same contract
  (`ENTITY_ID_SQL`, `entityIdColumnSql`, `entityIdDefaultSql`,
  `entityIdCheckSql`). It requires no extension, sourcing randomness from core
  `gen_random_uuid()`, and pins an empty `search_path` on every function.
- `entity-id` CLI: `new`, `inspect`, `check`, `derive` and `sql`.
- `EntityIdError`, carrying the offending value on every failure.
- Dual ESM/CommonJS builds with type declarations for both.
- An optional `typescript >=5.4.0` peer dependency. The floor is set by `zod`,
  whose declarations use `NoInfer` (TS 5.4+); the branded types here need 5.0+
  for `const` type parameters. Verified against 5.4, 5.5, 5.6, 5.9 and 7.0 with
  `skipLibCheck` off.
- `scripts/verify-package.mjs` (`npm run verify:package`): installs the packed
  tarball into throwaway ESM and CommonJS projects and exercises the public API
  there, so bundling faults cannot reach a release.
- `types-test/consumer.ts` (`npm run verify:types`): compile-time assertions
  from a consumer's seat. Each `@ts-expect-error` pins something that must NOT
  compile — a plain string is not an `EntityId`, two kinds are not
  interchangeable — and stops erroring loudly if the branding ever weakens.
- `scripts/verify-browser.mjs` (`npm run verify:browser`): bundles the packed
  tarball with esbuild and runs it in Playwright Chromium, asserting behaviour
  (5000 distinct ids from the platform CSPRNG) rather than just that the module
  loads. Skips cleanly when Playwright is absent.

### Security

- `entityIdCheckSql` no longer interpolates an unvalidated column name. It
  accepted `entityIdCheckSql('id; drop table t', 'usr')` and emitted the
  injected SQL verbatim, while `entityIdColumnSql` validated the same argument
  — the check now lives in one shared helper used by both, and also rejects
  identifiers past PostgreSQL's 63-character limit.
- `defineEntityPrefixes` rejects `__proto__`, `constructor` and `prototype` as
  entity kinds. Not exploitable (the registry never wrote to `Object.prototype`)
  but ambiguous to read and debug.
- Added `src/security.spec.ts`: ReDoS resistance under 50 KB payloads, SQL
  injection through every helper, prototype pollution, type confusion,
  randomness quality, and Unicode homoglyph input.

### Fixed

- Async mode scopes now work in the **built** package. Multi-entry bundling
  inlined a private copy of the mode module into each entry, so
  `entity-id/async` installed its resolver into one copy while the validators
  read another, and a scope silently did nothing. Code splitting now keeps that
  state in one shared chunk; a smoke test against the packed tarball guards it.
- `createEntityId(prefix, { timeMs: 0 })` now preserves the Unix epoch. The
  underlying `ulid` library treats a `0` seed as falsy and substitutes the
  current time, which silently lost an epoch timestamp.
- `derivePrefixFromSlug` no longer produces an invalid one-character prefix for
  a single-character slug; the result is padded to the minimum length so the
  function's contract always holds.

[Unreleased]: https://github.com/kiwagu/entity-id/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/kiwagu/entity-id/releases/tag/v1.1.3
[1.1.2]: https://github.com/kiwagu/entity-id/releases/tag/v1.1.2
[1.1.1]: https://github.com/kiwagu/entity-id/releases/tag/v1.1.1
[1.1.0]: https://github.com/kiwagu/entity-id/releases/tag/v1.1.0
[1.0.0]: https://github.com/kiwagu/entity-id/releases/tag/v1.0.0
