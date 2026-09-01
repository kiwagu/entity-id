/**
 * The Postgres side of the entity-id contract.
 *
 * Import from `entity-id/sql` to get the migration text as a string, so a
 * project can apply it with whatever migration runner it already uses:
 *
 * ```ts
 * import { ENTITY_ID_SQL, entityIdColumnSql } from 'entity-id/sql';
 *
 * await db.query(ENTITY_ID_SQL);
 * await db.query(`create table users (${entityIdColumnSql('usr')}, …)`);
 * ```
 *
 * The same text ships as a raw file at `entity-id/entity_id_generate.sql` for
 * `psql -f`.
 *
 * @module
 */

import { normalizePrefix } from './prefix.js';

export { ENTITY_ID_SQL } from './sql.generated.js';

/**
 * A conservative SQL identifier: lowercase, starts with a letter or an
 * underscore, then letters, digits and underscores.
 *
 * Deliberately narrower than what PostgreSQL accepts. These helpers build SQL
 * by string concatenation, so an identifier that reached the output unchecked
 * would be an injection vector; a caller needing an exotic column name should
 * write that statement themselves.
 */
const SQL_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

/** Maximum identifier length PostgreSQL keeps without truncating (NAMEDATALEN). */
const SQL_IDENTIFIER_MAX_LENGTH = 63;

/**
 * Validate a SQL identifier before it is concatenated into a statement.
 *
 * @param identifier - Candidate column name.
 * @param role - What the identifier names, for the error message.
 * @returns The identifier, unchanged.
 * @throws {Error} When it is not a plain lowercase SQL identifier.
 */
function assertSqlIdentifier(identifier: string, role = 'column name'): string {
  if (typeof identifier !== 'string' || !SQL_IDENTIFIER_RE.test(identifier)) {
    throw new Error(
      `Invalid ${role} "${String(identifier)}". Expected a lowercase SQL identifier matching ${SQL_IDENTIFIER_RE.source}.`
    );
  }
  if (identifier.length > SQL_IDENTIFIER_MAX_LENGTH) {
    throw new Error(
      `Invalid ${role} "${identifier}". PostgreSQL truncates identifiers beyond ${SQL_IDENTIFIER_MAX_LENGTH} characters.`
    );
  }
  return identifier;
}

/**
 * The SQL fragment declaring an entity-id primary key for one table: a `text`
 * column defaulting to a generated id and constrained to the given prefix.
 *
 * @param prefix - Entity-type tag for this table, for example `'usr'`.
 * @param column - Column name; must be a plain lowercase SQL identifier.
 * Default: `'id'`.
 * @returns The column definition, without a trailing comma.
 * @throws {EntityIdError} When the prefix is invalid.
 * @throws {Error} When the column name is not a plain SQL identifier.
 *
 * @example
 * ```ts
 * entityIdColumnSql('usr');
 * // id text primary key default public.entity_id_generate('usr')
 * //   check (public.is_entity_id_with_prefix(id, 'usr'))
 * ```
 *
 * @public
 */
export function entityIdColumnSql(prefix: string, column = 'id'): string {
  const normalizedPrefix = normalizePrefix(prefix);
  assertSqlIdentifier(column);
  return [
    `${column} text primary key`,
    `default public.entity_id_generate('${normalizedPrefix}')`,
    `check (public.is_entity_id_with_prefix(${column}, '${normalizedPrefix}'))`,
  ].join(' ');
}

/**
 * The SQL expression that mints an id for a given prefix, for use as a column
 * default or in an `insert`.
 *
 * @param prefix - Entity-type tag.
 * @returns The `public.entity_id_generate('<prefix>')` call.
 * @throws {EntityIdError} When the prefix is invalid.
 *
 * @public
 */
export function entityIdDefaultSql(prefix: string): string {
  return `public.entity_id_generate('${normalizePrefix(prefix)}')`;
}

/**
 * The SQL boolean expression validating that a column holds an id of a given
 * prefix, for use in a `check` constraint.
 *
 * @param column - Column name; must be a plain lowercase SQL identifier.
 * @param prefix - Entity-type tag.
 * @returns The `public.is_entity_id_with_prefix(...)` call.
 * @throws {EntityIdError} When the prefix is invalid.
 * @throws {Error} When the column name is not a plain SQL identifier.
 *
 * @public
 */
export function entityIdCheckSql(column: string, prefix: string): string {
  assertSqlIdentifier(column);
  return `public.is_entity_id_with_prefix(${column}, '${normalizePrefix(prefix)}')`;
}
