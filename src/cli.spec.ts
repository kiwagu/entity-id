import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createEntityId, entityIdToIso, parseEntityId } from './entity-id.js';

/**
 * `src/cli.ts` runs at import time, so these tests spawn it as a real process
 * and assert on its exit status, stdout and stderr.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const tsxCli = fileURLToPath(
  new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)
);

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(...args: string[]): CliResult {
  try {
    const stdout = execFileSync(
      process.execPath,
      [tsxCli, 'src/cli.ts', ...args],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' }
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as {
      status: number;
      stdout: string;
      stderr: string;
    };
    return {
      status: failure.status,
      stdout: failure.stdout,
      stderr: failure.stderr,
    };
  }
}

describe('cli inspect', () => {
  it('prints the full decoding of a valid id, iso included', () => {
    const id = createEntityId('usr');

    const result = runCli('inspect', id);

    expect(result.status).toBe(0);
    const decoded = JSON.parse(result.stdout) as { iso: string };
    expect(decoded).toEqual(parseEntityId(id));
    expect(decoded.iso).toBe(entityIdToIso(id));
  });

  it('rejects an id whose body is malformed even though its time decodes', () => {
    const result = runCli('inspect', 'usr_x.0000000000');

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Invalid entity id/);
  });

  it('rejects a bad prefix head', () => {
    const result = runCli('inspect', 'not-an-id');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid entity id/);
  });
});
