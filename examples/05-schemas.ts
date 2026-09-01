/**
 * 05 — Zod schemas and JSON Schema contracts.
 *
 * Run: `npx tsx examples/05-schemas.ts`
 */
import { z } from 'zod';

import {
  createEntityId,
  defineEntityPrefixes,
  entityIdJsonSchema,
  entityIdSchema,
  strictEntityIdSchema,
  withValidationMode,
} from 'entity-id';
import { withSchemas } from 'entity-id/schema';

const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' } as const);

// Schemas are opt-in: the registry itself carries no Zod, so an application
// that only mints and checks ids never bundles a validator it does not call.
const schemas = withSchemas(registry);
const userId = createEntityId('usr');
const orderId = createEntityId('ord');

// A contract composed from per-kind schemas. Parsing is the only way to obtain
// a branded id, so an unvalidated string cannot reach the domain by accident.
const CreateOrder = z.object({
  userId: schemas.user.schema,
  total: z.number().positive(),
});

console.log(
  'valid payload     ',
  CreateOrder.safeParse({ userId, total: 10 }).success
);

// A swapped kind is rejected at runtime, not only by the compiler.
const swapped = CreateOrder.safeParse({ userId: orderId, total: 10 });
console.log('swapped kind      ', swapped.success);
if (!swapped.success) {
  console.log('  reason          ', swapped.error.issues[0]?.message);
}

// --- JSON Schema -----------------------------------------------------------
// The schemas are codecs, not `.transform()` chains, which is what keeps them
// representable in JSON Schema. Embed one in an OpenAPI document or a tool
// contract directly.
console.log('\n[JSON Schema]');
console.log('  output side     ', JSON.stringify(schemas.user.jsonSchema()));
console.log(
  '  input side      ',
  JSON.stringify(schemas.user.jsonSchema('input'))
);

// A whole contract serializes, ids and all.
const serialized = z.toJSONSchema(CreateOrder, { io: 'output' });
console.log('  full contract   ', JSON.stringify(serialized).slice(0, 96), '…');

// The published contract always describes the complete format, even when the
// process runs in a cheaper mode: a mode is a local performance decision.
withValidationMode('fast', () => {
  const stillComplete = String(entityIdJsonSchema(schemas.user.schema).pattern);
  console.log('  in fast mode    ', stillComplete);
});

// --- Strict where it matters ----------------------------------------------
// `strictEntityIdSchema` ignores the active mode, for a boundary that must
// stay strict inside an otherwise-fast application.
console.log('\n[always strict]');
withValidationMode('fast', () => {
  console.log(
    '  mode-aware      ',
    entityIdSchema.safeParse('anything').success
  );
  console.log(
    '  always strict   ',
    strictEntityIdSchema.safeParse('anything').success
  );
});
