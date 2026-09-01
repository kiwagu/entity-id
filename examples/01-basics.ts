/**
 * 01 — Basics: minting, inspecting and comparing ids.
 *
 * Run: `npx tsx examples/01-basics.ts`
 */
import {
  compareEntityIds,
  createEntityId,
  entityIdToIso,
  fromUlid,
  isEntityId,
  parseEntityId,
} from 'entity-id';

// Mint an id. The prefix names the kind of thing it points at.
const userId = createEntityId('usr');
console.log('minted            ', userId);

// An id is self-describing: you can tell what it is by looking at it.
console.log('is an entity id   ', isEntityId(userId));

// It also carries its own creation time.
const parsed = parseEntityId(userId);
console.log('prefix            ', parsed.prefix);
console.log('created at        ', entityIdToIso(userId));

// Ids are not chronologically sortable as plain strings — the randomness comes
// first, on purpose, to keep database index inserts spread out. Sort by the
// embedded timestamp instead.
const ids = [3, 1, 2].map((offset) =>
  createEntityId('usr', {
    timeMs: Date.UTC(2026, 0, 1) + offset * 86_400_000,
    monotonic: false,
  })
);

const chronological = [...ids].sort((a, b) => compareEntityIds(a, b, 'time'));
console.log(
  'sorted by time    ',
  chronological.map((id) => entityIdToIso(id).slice(0, 10))
);

// Migrating from a ULID-keyed table? The original id, and its timestamp,
// survive the conversion.
const migrated = fromUlid('usr', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
console.log('from an old ULID  ', migrated, '->', entityIdToIso(migrated));
