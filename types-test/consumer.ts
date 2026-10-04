/**
 * Type-level tests from a CONSUMER's seat.
 *
 * These assert what must NOT compile. An `@ts-expect-error` that stops erroring
 * is itself a compile error, so unlike a prose claim in the README these have
 * teeth: if the branding ever weakens, this file fails to build.
 *
 * Compiled by `npm run verify:types` against the packed tarball, and by the
 * TypeScript matrix in CI. Nothing here runs — it exists to be type-checked.
 */
import {
  assertEntityId,
  type BrandedEntityId,
  createEntityId,
  defineEntityPrefixes,
  type EntityId,
  type EntityIdOf,
  entityIdSchema,
  isEntityId,
  parseEntityId,
  unsafeBrandEntityId,
} from 'entity-id';

const registry = defineEntityPrefixes({
  user: 'usr',
  order: 'ord',
} as const);

type UserId = EntityIdOf<typeof registry.prefixes, 'user'>;
type OrderId = EntityIdOf<typeof registry.prefixes, 'order'>;

const userId: UserId = registry.ids.user.create();
const orderId: OrderId = registry.ids.order.create();

/* ── The core claim: a plain string is not an id ─────────────────────────── */

// @ts-expect-error a plain string is not assignable to EntityId
const notAnId: EntityId = 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q';

// @ts-expect-error not even a correctly-shaped literal
const notAUserId: UserId = 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q';

// @ts-expect-error and an arbitrary string certainly is not
const notAnIdEither: EntityId = 'whatever';

/* ── Kinds are mutually exclusive ────────────────────────────────────────── */

// @ts-expect-error a UserId is not an OrderId
const wrongKind: OrderId = userId;

// @ts-expect-error and the reverse holds too
const wrongKindReverse: UserId = orderId;

declare function chargeOrder(id: OrderId): void;
// @ts-expect-error passing a UserId where an OrderId is expected
chargeOrder(userId);

/* ── But every branded id IS an EntityId ─────────────────────────────────── */

const widenedUser: EntityId = userId;
const widenedOrder: EntityId = orderId;

// And an EntityId is still a string, so string operations keep working.
const asString: string = userId;
const upper: string = userId.toUpperCase();

/* ── Custom brands compose the same way ──────────────────────────────────── */

type TicketId = BrandedEntityId<'ticket'>;

// @ts-expect-error a UserId is not a TicketId
const wrongBrand: TicketId = userId;

const ticketId: TicketId = unsafeBrandEntityId<'ticket'>('tkt_x');
const ticketWidened: EntityId = ticketId;

/* ── Producers return branded values, not strings ────────────────────────── */

const minted: EntityId = createEntityId('usr');
const parsed: EntityId = entityIdSchema.parse(
  'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q'
);
const asserted: EntityId = assertEntityId('usr_a1b2c3d4e5f6g7h8.01jd8x2p4q');

/* ── The prefix keeps its literal type through the registry ──────────────── */

const literalPrefix: 'usr' = registry.ids.user.prefix;
// @ts-expect-error the prefix is the literal 'usr', not 'ord'
const wrongLiteral: 'ord' = registry.ids.user.prefix;

/* ── Kind names are checked at compile time ──────────────────────────────── */

registry.prefixFor('user');
// @ts-expect-error 'nope' is not a registered kind
registry.prefixFor('nope');

// @ts-expect-error there is no such toolkit
registry.ids.nope.create();

/* ── Guards narrow rather than merely returning boolean ──────────────────── */

const unknownValue: string = 'usr_a1b2c3d4e5f6g7h8.01jd8x2p4q';
if (registry.ids.user.is(unknownValue)) {
  const narrowed: UserId = unknownValue;
  void narrowed;
}
if (isEntityId(unknownValue)) {
  const narrowedGeneric: EntityId = unknownValue;
  void narrowedGeneric;
}

/* ── Decoded parts are plain data, not branded ───────────────────────────── */

const decodedPrefix: string = parseEntityId(userId).prefix;
const decodedTime: number = parseEntityId(userId).timeMs;
const decodedIso: string = parseEntityId(userId).iso;

// Keep every binding used so `noUnusedLocals` stays satisfiable either way.
export {
  asString,
  asserted,
  decodedIso,
  decodedPrefix,
  decodedTime,
  literalPrefix,
  minted,
  notAUserId,
  notAnId,
  notAnIdEither,
  parsed,
  ticketId,
  ticketWidened,
  upper,
  widenedOrder,
  widenedUser,
  wrongBrand,
  wrongKind,
  wrongKindReverse,
  wrongLiteral,
};
