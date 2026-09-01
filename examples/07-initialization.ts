/**
 * 07 — Where to initialize the mode in a real application.
 *
 * The short answer: once, in your entry point, before you serve traffic. This
 * file lays out the whole picture — what to do, what not to do, and why the
 * import order of your modules does not matter.
 *
 * Run: `npx tsx examples/07-initialization.ts`
 */
import {
  createEntityId,
  defineEntityPrefixes,
  getValidationMode,
  isEntityId,
  resetValidationMode,
  setValidationMode,
  type ValidationMode,
} from 'entity-id';
import { bindValidationMode } from 'entity-id/async';

const HALF_VALID = 'usr_not-canonical';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Where the mode is set
 *
 * In the application's entry point — `main.ts`, `server.ts`, `index.ts` —
 * before the first request is served. Not in a library, not in a module that
 * merely happens to load early: setting it from a library would silently
 * change the behaviour of the application depending on it.
 * ═══════════════════════════════════════════════════════════════════════════ */

function bootstrap(): void {
  // Typically driven by the environment, so a deployment can tighten or
  // loosen validation without a code change.
  const configured = process.env.ENTITY_ID_MODE as ValidationMode | undefined;
  const mode: ValidationMode =
    configured ?? (process.env.NODE_ENV === 'production' ? 'mixed' : 'full');

  setValidationMode(mode);
  console.log('[bootstrap] mode set to', getValidationMode());
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Import order does not matter
 *
 * These objects are built at module load — before bootstrap() runs. They still
 * obey the mode set later, because the mode is read when a value is validated,
 * not when the schema is created. You never have to police your imports.
 * ═══════════════════════════════════════════════════════════════════════════ */

const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' } as const);
const userIdSchema = registry.ids.user.schema; // created now, at import time

console.log('[before bootstrap] mode is', getValidationMode(), '(the default)');
console.log(
  '  schema accepts half-valid id:',
  userIdSchema.safeParse(HALF_VALID).success
);

bootstrap();

console.log('[after bootstrap] the same schema object, stricter now:');
console.log(
  '  schema accepts half-valid id:',
  userIdSchema.safeParse(HALF_VALID).success
);

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. A typical layering
 *
 * Set a cheap default for the application's interior, then tighten at the
 * edges where untrusted data arrives. The edge is per-route, so one strict
 * endpoint does not slow down everything else.
 * ═══════════════════════════════════════════════════════════════════════════ */

setValidationMode('mixed'); // the interior: prefix checks, cheap

// Public endpoint: strict, because the payload comes from outside.
const publicEndpoint = bindValidationMode('full', async (payload: string) => {
  const { id } = JSON.parse(payload) as { id: string };
  if (!isEntityId(id)) throw new Error('rejected at the edge');
  return `accepted ${id}`;
});

// Internal worker reading rows from a column that already has the CHECK
// constraint: nothing left to validate, so skip it.
const internalWorker = bindValidationMode('fast', async (rows: string[]) => {
  return rows.filter((row) => registry.ids.user.is(row)).length;
});

async function demonstrateLayering(): Promise<void> {
  console.log('\n[layering]');
  console.log(
    ' ',
    await publicEndpoint(JSON.stringify({ id: createEntityId('usr') }))
  );

  try {
    await publicEndpoint(JSON.stringify({ id: HALF_VALID }));
  } catch (error) {
    console.log('  edge rejected half-valid id:', (error as Error).message);
  }

  const trustedRows = [createEntityId('usr'), createEntityId('usr')];
  console.log(
    '  worker counted',
    await internalWorker(trustedRows),
    'rows (unvalidated)'
  );
  console.log('  interior mode still', getValidationMode());
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Tests
 *
 * Set the mode a test needs, and reset it afterwards. A leaked mode silently
 * changes the meaning of every later assertion in the run.
 * ═══════════════════════════════════════════════════════════════════════════ */

function demonstrateTestHygiene(): void {
  console.log('\n[tests]');
  // afterEach(() => resetValidationMode());
  setValidationMode('full');
  console.log('  during the test:', getValidationMode());
  resetValidationMode();
  console.log(
    '  after reset    :',
    getValidationMode(),
    '(back to the default)'
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. What NOT to do
 * ═══════════════════════════════════════════════════════════════════════════ */

function antiPatterns(): void {
  console.log('\n[anti-patterns]');

  // ✗ Do not set the mode from inside a library or a request handler: it is
  //   process-wide, so it would change behaviour for concurrent work too.
  //   Use a per-call { mode } or an async scope instead.
  console.log('  ✗ setValidationMode() inside a request handler');
  console.log(
    '  ✓ isEntityId(v, { mode: "full" }), or withValidationModeAsync'
  );

  // ✗ Do not assume `fast` is a safe default. It validates nothing, so a
  //   malformed id flows straight into your domain.
  console.log('  ✗ fast as the global default "for performance"');
  console.log('  ✓ mixed by default; fast only for data already proven good');
}

await demonstrateLayering();
demonstrateTestHygiene();
antiPatterns();

console.log('\nSummary: set the mode once in the entry point; tighten at the');
console.log(
  'edges with an async scope or a per-call override; reset in tests.'
);
