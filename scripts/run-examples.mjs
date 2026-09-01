/**
 * Runs every example in `examples/`, in order, and fails on the first error.
 *
 * The examples import the package by its public name (`entity-id`,
 * `entity-id/async`, `entity-id/sql`) so they read exactly as they would in a
 * consumer's project; `tsx` resolves those names to the local sources through
 * the `paths` mapping in tsconfig.json.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'examples');

const files = readdirSync(examplesDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

if (files.length === 0) {
  process.stderr.write('No examples found.\n');
  process.exit(1);
}

const only = process.argv[2];
let failures = 0;

for (const file of files) {
  if (only && !file.includes(only)) continue;

  process.stdout.write(`\n${'═'.repeat(70)}\n${file}\n${'═'.repeat(70)}\n`);

  const result = spawnSync('npx', ['tsx', join(examplesDir, file)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    failures++;
    process.stderr.write(`\n✗ ${file} exited with ${String(result.status)}\n`);
  }
}

process.stdout.write(
  failures === 0
    ? '\nAll examples ran successfully.\n'
    : `\n${failures} example(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
