/**
 * 02 — A typed registry: one declaration, distinct types per entity kind.
 *
 * Run: `npx tsx examples/02-registry.ts`
 */
import { defineEntityPrefixes, type EntityIdOf } from 'entity-id';

// Declare every kind once. A duplicate prefix throws here, at startup, rather
// than producing an un-routable id later.
export const registry = defineEntityPrefixes({
  user: 'usr',
  order: 'ord',
  orderLine: 'orl',
} as const);

export type UserId = EntityIdOf<typeof registry.prefixes, 'user'>;
export type OrderId = EntityIdOf<typeof registry.prefixes, 'order'>;

const { user, order } = registry.ids;

const userId = user.create();
const orderId = order.create();
console.log('user id           ', userId);
console.log('order id          ', orderId);

// Each kind guards its own ids.
console.log('user.is(userId)   ', user.is(userId));
console.log('order.is(userId)  ', order.is(userId));

// And the compiler enforces the same distinction, so this never reaches
// runtime in the first place:
function chargeOrder(id: OrderId): string {
  return `charging ${id}`;
}
// @ts-expect-error a UserId is not an OrderId
chargeOrder(userId);

console.log('charge            ', chargeOrder(orderId));

// Routing an unknown id back to its kind.
console.log('kindOf(userId)    ', registry.kindOf(userId));
console.log('kindOf(foreign)   ', registry.kindOf('zzz_unregistered'));

// A duplicate prefix is a startup error, naming both claimants.
try {
  defineEntityPrefixes({ program: 'prg', progress: 'prg' } as const);
} catch (error) {
  console.log('duplicate rejected', (error as Error).message.slice(0, 72), '…');
}
