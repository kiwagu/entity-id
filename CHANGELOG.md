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

### Fixed

- `createEntityId(prefix, { timeMs: 0 })` now preserves the Unix epoch. The
  underlying `ulid` library treats a `0` seed as falsy and substitutes the
  current time, which silently lost an epoch timestamp.
- `derivePrefixFromSlug` no longer produces an invalid one-character prefix for
  a single-character slug; the result is padded to the minimum length so the
  function's contract always holds.

[1.0.0]: https://github.com/kiwagu/entity-id/releases/tag/v1.0.0
