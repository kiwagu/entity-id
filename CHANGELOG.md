# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/kiwagu/entity-id/releases/tag/v1.0.0
