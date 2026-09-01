/**
 * 04 — Asynchronous code: scopes that survive an `await`.
 *
 * Run: `npx tsx examples/04-async-validation.ts`
 */
import {
  createEntityId,
  getValidationMode,
  isEntityId,
  setValidationMode,
  withValidationMode,
} from 'entity-id';
import {
  bindValidationMode,
  hasAsyncModeScope,
  withValidationModeAsync,
} from 'entity-id/async';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wellPrefixedGarbage = 'usr_not-canonical';

async function main(): Promise<void> {
  // --- The trap, and why it throws -----------------------------------------
  // `withValidationMode` is synchronous. An async callback returns a promise
  // immediately, so the mode would be restored at the first `await` — long
  // before the work finishes. Rather than fail silently, it refuses.
  console.log('[the trap]');
  try {
    withValidationMode('full', async () => {
      await sleep(1);
      return isEntityId(wellPrefixedGarbage);
    });
  } catch (error) {
    console.log('  refused:', (error as Error).message.slice(0, 64), '…');
  }

  // --- The async-safe scope ------------------------------------------------
  console.log('\n[withValidationModeAsync]');
  await withValidationModeAsync('full', async () => {
    console.log('  before await   ', getValidationMode());
    await sleep(5);
    console.log('  after await    ', getValidationMode(), '← survives');
    console.log('  strict here    ', isEntityId(wellPrefixedGarbage));
  });
  console.log('  after the scope', getValidationMode());

  // --- Concurrency ---------------------------------------------------------
  // Two requests handled at once under different modes do not interfere:
  // each scope follows its own logical flow of control.
  console.log('\n[concurrent scopes]');
  await Promise.all([
    withValidationModeAsync('full', async () => {
      await sleep(10);
      console.log(
        '  request A      ',
        getValidationMode(),
        '(strict endpoint)'
      );
    }),
    withValidationModeAsync('fast', async () => {
      await sleep(2);
      console.log(
        '  request B      ',
        getValidationMode(),
        '(trusted internal)'
      );
    }),
    (async () => {
      await sleep(6);
      console.log(
        '  unscoped task  ',
        getValidationMode(),
        '(process default)'
      );
    })(),
  ]);

  // --- A realistic boundary ------------------------------------------------
  // Strict where data arrives, cheap once it is inside.
  console.log('\n[an HTTP-style boundary]');

  const parseRequest = bindValidationMode('full', async (body: string) => {
    await sleep(1); // stand-in for reading the request stream
    const { id } = JSON.parse(body) as { id: string };
    if (!isEntityId(id)) throw new Error(`rejected at the edge: ${id}`);
    return id;
  });

  const good = JSON.stringify({ id: createEntityId('usr') });
  const bad = JSON.stringify({ id: wellPrefixedGarbage });

  console.log('  accepted       ', await parseRequest(good));
  try {
    await parseRequest(bad);
  } catch (error) {
    console.log('  ', (error as Error).message);
  }

  // Inside the application, after the edge has vouched for the data, the
  // cheaper default applies again.
  console.log(
    '  back to default',
    getValidationMode(),
    '| scope active:',
    hasAsyncModeScope()
  );

  // --- Per-call overrides need no scope at all -----------------------------
  // They are not ambient state, so they are immune to interleaving.
  console.log('\n[per-call, the race-free option]');
  setValidationMode('fast');
  await sleep(1);
  console.log('  ambient fast   ', isEntityId(wellPrefixedGarbage));
  console.log(
    '  this call full ',
    isEntityId(wellPrefixedGarbage, { mode: 'full' })
  );
  setValidationMode('mixed');
}

await main();
