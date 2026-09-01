# entity-id

Prefixed, time-sortable entity identifiers with branded TypeScript types, a Zod
validator and a matching PostgreSQL generator.

```
usr_a1b2c3d4e5f6g7h8.01jd8x2p4q
└─┬─┘ └──────┬──────┘ └────┬───┘
  │          │             └── ULID time segment  (10 chars, ms since epoch)
  │          └──────────────── ULID randomness    (16 chars, 80 bits)
  └─────────────────────────── entity-type prefix (2–16 chars)
```

An id says what it points at (`usr_…` is a user, `ord_…` is an order), is
globally unique, and carries its own creation time. Because the type is
*branded*, the compiler will not let a `UserId` reach a slot expecting an
`OrderId` — and because the same contract is implemented in SQL, an id minted by
Postgres validates in TypeScript and vice versa.

Runs unchanged in Node, Bun, Deno, edge workers and the browser.

## Install

```bash
npm install entity-id
```

`ulid` and `zod` are regular dependencies — nothing else to install.

## Quick start

```ts
import { createEntityId, parseEntityId, isEntityId } from 'entity-id';

const id = createEntityId('usr');
// 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q'

isEntityId(id); // true

parseEntityId(id);
// {
//   prefix: 'usr',
//   rand:   'a1b2c3d4e5f6g7h8',
//   ts:     '01jd8x2p4q',
//   ulid:   '01JD8X2P4QA1B2C3D4E5F6G7H8',
//   timeMs: 1731412345678,
// }
```

## Why prefixed ids

A UUID in a log line, a URL or a support ticket is anonymous: you cannot tell
what it identifies, and pasting one into the wrong query silently returns
nothing. A prefixed id is self-describing, greppable, and — because the prefix
is part of the value — verifiable at the boundary.

Compared to the alternatives:

| | UUIDv4 | ULID | `entity-id` |
| --- | --- | --- | --- |
| Globally unique | yes | yes | yes |
| Carries creation time | no | yes | yes |
| Says what it identifies | no | no | **yes** |
| Distinct type per entity | no | no | **yes** |
| Wrong-kind id caught at runtime | no | no | **yes** |
| Database-native generator | yes | no | **yes** |

## Registry: one place for every prefix

Declare each entity kind once. The registry validates the map eagerly — a
malformed or duplicated prefix throws at startup rather than producing an
un-routable id later — and derives a typed toolkit per kind.

```ts
import { defineEntityPrefixes, type EntityIdOf } from 'entity-id';

export const registry = defineEntityPrefixes({
  user: 'usr',
  order: 'ord',
  orderLine: 'orl',
} as const);

export type UserId = EntityIdOf<typeof registry.prefixes, 'user'>;
export type OrderId = EntityIdOf<typeof registry.prefixes, 'order'>;

const { user, order } = registry.ids;

const id = user.create();        // UserId
user.is(id);                     // true  — type guard
order.is(id);                    // false — a different kind
order.assert(id);                // throws: expected prefix "ord_"
registry.kindOf(id);             // 'user'
```

Duplicate prefixes are rejected with both claimants named, because an ambiguous
prefix makes an id impossible to route back to one kind:

```ts
defineEntityPrefixes({ program: 'prg', progress: 'prg' });
// EntityIdError: Duplicate entity prefix "prg": claimed by both "program" and "progress".
```

### The per-kind toolkit

| Member | Purpose |
| --- | --- |
| `create(options?)` | Mint a fresh branded id |
| `is(value)` | Type guard narrowing to this kind |
| `assert(value)` | Throwing parse at a boundary |
| `brand(value)` | Unchecked cast, for trusted construction |
| `schema` | Strict Zod schema (full format) |
| `prefixSchema` | Lenient schema (prefix only) |
| `jsonSchema(io?)` | JSON Schema for a contract |

## Branded types

The brand is what turns a naming convention into a compiler-enforced one. A
plain `string` is not assignable to an `EntityId`, and two kinds are not
assignable to each other:

```ts
declare function getUser(id: UserId): Promise<User>;

getUser(orderId);        // compile error: OrderId is not a UserId
getUser('usr_whatever'); // compile error: string is not a UserId
getUser(user.assert(x)); // fine — parsed at the boundary
```

The only ways to obtain a branded value are minting, parsing, asserting, or the
explicit `unsafeBrandEntityId` escape hatch — so an unvalidated string cannot
reach your domain by accident.

## Validation with Zod

```ts
import { entityIdSchema, brandedEntityIdSchema } from 'entity-id';

entityIdSchema.parse(' usr_A1B2C3D4E5F6G7H8.01JD8X2P4Q ');
// 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q'  — trimmed, lowercased, branded

const userIdSchema = brandedEntityIdSchema<'user'>('usr');

const CreateOrder = z.object({
  userId: userIdSchema,
  total: z.number(),
});
```

The ULID segments are accepted in mixed case and normalized to canonical
lowercase on the way through. The prefix itself is lowercase-only, so an
upper-cased prefix is rejected rather than silently coerced.

### JSON Schema

The schemas are built as Zod **codecs** rather than with `.transform()`, which
matters in practice: a bare transform is unrepresentable in JSON Schema, so any
contract embedding an id would fail to serialize. Here both sides render.

```ts
import { entityIdJsonSchema } from 'entity-id';

entityIdJsonSchema(registry.ids.user.schema);
// { type: 'string', pattern: '^usr_[0-9a-hjkmnp-tv-z]{16}\\.[0-9a-hjkmnp-tv-z]{10}$' }

entityIdJsonSchema(entityIdSchema, 'input');  // permissive: accepts mixed case
```

Use `'input'` for request payloads and `'output'` for responses — an OpenAPI
document or an MCP tool contract can embed either directly.

## Ordering

The randomness segment precedes the timestamp, so an id string is **not**
chronologically sortable. Sort by the embedded time explicitly:

```ts
import { compareEntityIds } from 'entity-id';

ids.sort((a, b) => compareEntityIds(a, b, 'time'));
```

This layout is deliberate: ids beginning with random bytes spread across a
B-tree instead of all landing on the right-hand edge, which avoids index
hot-spotting on insert. For list APIs, order by a `created_at` column.

## PostgreSQL

The database side implements the same contract, so ids generated in either place
validate in the other.

```bash
npx entity-id sql | psql "$DATABASE_URL"
```

or from code, using whatever migration runner you already have:

```ts
import { ENTITY_ID_SQL, entityIdColumnSql } from 'entity-id/sql';

await db.query(ENTITY_ID_SQL);
await db.query(`create table users (${entityIdColumnSql('usr')}, email text)`);
```

`entityIdColumnSql('usr')` expands to a column that both generates and enforces
the contract:

```sql
id text primary key
  default public.entity_id_generate('usr')
  check (public.is_entity_id_with_prefix(id, 'usr'))
```

The migration installs `entity_id_generate(prefix)`, `is_entity_id(value)` and
`is_entity_id_with_prefix(value, prefix)`. It needs no extension —
randomness comes from core `gen_random_uuid()` (PostgreSQL 13+) — and every
function pins an empty `search_path`.

The equivalence is enforced, not assumed: `src/sql.spec.ts` asserts the two
definitions share one pattern, and `scripts/verify-sql-crosscheck.sh` applies
the migration to a throwaway PostgreSQL container, feeds database ids through
the TypeScript validator, feeds TypeScript ids through the SQL `CHECK`, and
asserts the constraint rejects malformed, wrong-prefix and wrong-alphabet
values.

## Choosing a prefix

Hand-pick a conventional prefix (`user` → `usr`, `order` → `ord`), or derive one
deterministically:

```ts
import { derivePrefixFromSlug, ensureUniquePrefix } from 'entity-id';

derivePrefixFromSlug('project'); // 'prj'
derivePrefixFromSlug('program'); // 'prg'

const used = new Set(['prj']);
ensureUniquePrefix('prj', 'projection', used); // 'prjr'
```

A prefix is lowercase, starts with a letter, and is 2–16 alphanumeric
characters.

## CLI

```bash
npx entity-id new usr              # mint one id
npx entity-id new usr --count 5    # mint five
npx entity-id inspect "usr_…"      # decode to JSON
npx entity-id check "usr_…" usr    # exit 0 when valid, 1 when not
npx entity-id derive project       # → prj
npx entity-id sql                  # print the migration
```

## API reference

**Creating** — `createEntityId(prefix, options?)`, `fromUlid(prefix, ulid)`,
`unsafeBrandEntityId(value)`

**Validating** — `isEntityId`, `isEntityIdWithPrefix`, `assertEntityId`,
`assertEntityIdWithPrefix`, `entityIdSchema`, `entityIdWithPrefixSchema`,
`brandedEntityIdSchema`, `prefixGatedEntityIdSchema`, `toEntityId`

**Inspecting** — `parseEntityId`, `safeParseEntityId`, `normalizeEntityId`,
`entityIdPrefix`, `entityIdToTimeMs`, `entityIdToDate`, `entityIdToIso`,
`entityIdToTuple`, `toUlid`, `compareEntityIds`

**Prefixes** — `normalizePrefix`, `isValidPrefix`, `derivePrefixFromSlug`,
`ensureUniquePrefix`, `PREFIX_PATTERN`, `PREFIX_RE`

**Registry** — `defineEntityPrefixes`, and the types `EntityIdRegistry`,
`EntityIdToolkit`, `EntityIdOf`, `EntityPrefixMap`

**SQL** (`entity-id/sql`) — `ENTITY_ID_SQL`, `entityIdColumnSql`,
`entityIdDefaultSql`, `entityIdCheckSql`

**Types** — `EntityId`, `BrandedEntityId`, `ParsedEntityId`, `EntityIdParts`,
`CreateEntityIdOptions`, `EntityIdError`

Every error thrown is an `EntityIdError` carrying the offending `value`.

## Notes on the format

- **Uniqueness** — 80 bits of randomness per millisecond, from the platform CSPRNG.
- **Monotonic by default** — ids minted in the same millisecond in one process
  are strictly increasing; pass `{ monotonic: false }` to honour an explicit
  past `timeMs`.
- **Length** — 31 characters for a 3-character prefix, against 36 for a UUID.
- **URL- and shell-safe** — lowercase Crockford Base32 excludes `I`, `L`, `O`
  and `U`, so ids resist transcription errors and never form accidental words.

## License

MIT © Kiwagu
