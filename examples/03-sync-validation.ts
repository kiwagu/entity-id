/**
 * 03 — Synchronous validation: the three modes at work.
 *
 * Run: `npx tsx examples/03-sync-validation.ts`
 */
import {
  assertEntityIdWithPrefix,
  createEntityId,
  defineEntityPrefixes,
  EntityIdError,
  getValidationMode,
  isEntityId,
  setValidationMode,
  withValidationMode,
} from 'entity-id';

const registry = defineEntityPrefixes({ user: 'usr', order: 'ord' } as const);
const validId = createEntityId('usr');
const wrongKind = createEntityId('ord');
const wellPrefixedGarbage = 'usr_not-canonical';
const nonsense = 'not-an-id';

console.log('default mode      ', getValidationMode()); // 'mixed'

// --- mixed (the default) ---------------------------------------------------
// Checks the prefix head and stops. This is where business logic starts: it
// catches the mistake that actually happens — an id of the wrong kind.
console.log('\n[mixed]');
console.log('  valid id        ', isEntityId(validId));
console.log('  no prefix head  ', isEntityId(nonsense));
console.log(
  '  well-prefixed   ',
  isEntityId(wellPrefixedGarbage),
  '(body not inspected)'
);

try {
  registry.ids.user.assert(wrongKind);
} catch (error) {
  console.log(
    '  wrong kind      ',
    (error as EntityIdError).message.slice(0, 52),
    '…'
  );
}

// --- full ------------------------------------------------------------------
// Every rule: prefix, segment lengths, Crockford alphabet. Use it where the
// data comes from outside — a request, a webhook, an import.
console.log('\n[full]');
withValidationMode('full', () => {
  console.log('  valid id        ', isEntityId(validId));
  console.log(
    '  well-prefixed   ',
    isEntityId(wellPrefixedGarbage),
    '(now rejected)'
  );
  console.log(
    '  bad alphabet    ',
    isEntityId('usr_tsv4rrffq69g5fau.01arz3ndek')
  );
});

// --- fast ------------------------------------------------------------------
// No checking at all. Only for data whose provenance already guarantees the
// format: rows from a column with the CHECK, or ids this process just minted.
console.log('\n[fast]');
withValidationMode('fast', () => {
  console.log('  anything passes ', isEntityId(nonsense));
  console.log('  even wrong kind ', registry.ids.user.is(wrongKind));
});

// --- per-call override -----------------------------------------------------
// Safest of all: it travels with the call, so nothing ambient can race it.
console.log('\n[per-call override]');
setValidationMode('fast');
console.log('  ambient is fast ', isEntityId(nonsense));
console.log('  this call: full ', isEntityId(nonsense, { mode: 'full' }));
console.log('  ambient intact  ', getValidationMode());
setValidationMode('mixed');

// --- what never changes ----------------------------------------------------
// Some guarantees hold in every mode.
console.log('\n[mode-independent]');
for (const mode of ['fast', 'mixed', 'full'] as const) {
  withValidationMode(mode, () => {
    const minted = createEntityId('usr');
    // Generation is always canonical, and the registry always rejects a
    // duplicate prefix — those checks cost nothing at runtime.
    console.log(
      `  ${mode.padEnd(5)} mints valid`,
      isEntityId(minted, { mode: 'full' })
    );
  });
}

// Prefixes are still compared even when the format is not:
console.log(
  '\n  assert keeps prefix check in mixed:',
  assertEntityIdWithPrefix(validId, 'usr') === validId
);
