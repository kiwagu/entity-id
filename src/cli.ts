#!/usr/bin/env node
/**
 * The `entity-id` command-line interface.
 *
 * ```
 * entity-id new [prefix]        mint an id (default prefix: ent)
 * entity-id inspect <id>        decode an id into its parts, as JSON
 * entity-id check <id> [prefix] exit 0 when the id is valid (and matches prefix)
 * entity-id derive <slug>       show the prefix a slug compresses to
 * entity-id sql                 print the Postgres migration
 * ```
 *
 * @module
 */

import {
  createEntityId,
  entityIdToIso,
  isEntityId,
  isEntityIdWithPrefix,
  parseEntityId,
} from './entity-id.js';
import { derivePrefixFromSlug, normalizePrefix } from './prefix.js';
import { ENTITY_ID_SQL } from './sql.generated.js';

const HELP = `entity-id — prefixed, timestamped entity identifiers

Usage:
  entity-id new [prefix] [--count N]  mint id(s); default prefix "ent"
  entity-id inspect <id>              decode an id into its parts (JSON)
  entity-id check <id> [prefix]       exit 0 if valid, 1 if not
  entity-id derive <slug>             show the prefix a slug compresses to
  entity-id sql                       print the Postgres migration
  entity-id --help                    show this help
  entity-id --version                 show the package version

Examples:
  entity-id new usr
  entity-id new usr --count 5
  entity-id inspect usr_a1b2c3d4e5f6g7h8.01jd8x2p4q
  entity-id sql | psql "$DATABASE_URL"
`;

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function fail(message: string): never {
  process.stderr.write(`entity-id: ${message}\n`);
  process.exit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readCount(argv: readonly string[]): number {
  const index = argv.findIndex((a) => a === '--count' || a === '-n');
  if (index === -1) return 1;
  const raw = argv[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    fail(`invalid --count "${String(raw)}"; expected an integer in 1..10000`);
  }
  return value;
}

export function run(argv: readonly string[]): void {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    out(HELP.trimEnd());
    return;
  }

  if (command === '--version' || command === '-v') {
    out(process.env.npm_package_version ?? 'unknown');
    return;
  }

  switch (command) {
    case 'new':
    case 'gen':
    case 'generate': {
      const positional = rest.filter((a) => !a.startsWith('-'));
      const prefixArg = positional[0];
      // A bare positional after --count is the count value, not a prefix.
      const countIndex = rest.findIndex((a) => a === '--count' || a === '-n');
      const countValue = countIndex === -1 ? undefined : rest[countIndex + 1];
      const prefix = prefixArg && prefixArg !== countValue ? prefixArg : 'ent';
      try {
        const normalized = normalizePrefix(prefix);
        const count = readCount(rest);
        for (let i = 0; i < count; i++) {
          out(createEntityId(normalized));
        }
      } catch (error) {
        fail(messageOf(error));
      }
      return;
    }

    case 'inspect': {
      const value = rest[0];
      if (!value) fail('missing <id>');
      try {
        const parsed = parseEntityId(value);
        out(JSON.stringify({ ...parsed, iso: entityIdToIso(value) }, null, 2));
      } catch (error) {
        fail(messageOf(error));
      }
      return;
    }

    case 'check': {
      const value = rest[0];
      if (!value) fail('missing <id>');
      const prefix = rest[1];
      const ok = prefix
        ? isEntityIdWithPrefix(value, prefix)
        : isEntityId(value);
      if (!ok) {
        process.stderr.write(
          prefix
            ? `entity-id: "${value}" is not an entity id with prefix "${prefix}"\n`
            : `entity-id: "${value}" is not a valid entity id\n`
        );
        process.exit(1);
      }
      out('ok');
      return;
    }

    case 'derive': {
      const slug = rest[0];
      if (!slug) fail('missing <slug>');
      try {
        out(derivePrefixFromSlug(slug));
      } catch (error) {
        fail(messageOf(error));
      }
      return;
    }

    case 'sql': {
      process.stdout.write(ENTITY_ID_SQL);
      return;
    }

    default:
      fail(`unknown command "${command}". Run "entity-id --help".`);
  }
}

run(process.argv.slice(2));
