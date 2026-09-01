import { readFileSync } from 'node:fs';

import { entityIdSchema, isEntityId, parseEntityId } from '../src/index.js';

/**
 * Cross-checks that ids minted by the Postgres generator satisfy the
 * TypeScript contract. Fed by `scripts/verify-sql-crosscheck.sh`, which applies
 * the migration to a throwaway database and dumps generated ids to a file.
 */
const ids = readFileSync(process.argv[2] ?? '/tmp/db_ids.txt', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

if (ids.length === 0) {
  throw new Error('No ids to verify.');
}

let checked = 0;
for (const id of ids) {
  if (!isEntityId(id)) {
    throw new Error(`DB id rejected by isEntityId: ${id}`);
  }
  if (entityIdSchema.parse(id) !== id) {
    throw new Error(`DB id is not canonical: ${id}`);
  }
  const parsed = parseEntityId(id);
  if (parsed.prefix !== 'usr') {
    throw new Error(`Unexpected prefix in ${id}`);
  }
  const skew = Math.abs(parsed.timeMs - Date.now());
  if (skew > 60 * 60 * 1000) {
    throw new Error(`Timestamp in ${id} is off by ${skew}ms`);
  }
  checked++;
}

process.stdout.write(`OK: ${checked} database ids pass the TS contract\n`);
