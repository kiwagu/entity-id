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
 * The SQL fragment declaring an entity-id primary key for one table: a `text`
 * column defaulting to a generated id and constrained to the given prefix.
 *
 * @param prefix - Entity-type tag for this table, for example `'usr'`.
 * @param column - Column name. Default: `'id'`.
 * @returns The column definition, without a trailing comma.
 * @throws {EntityIdError} When the prefix is invalid.
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
  if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
    throw new Error(
      `Invalid column name "${column}". Expected a lowercase SQL identifier.`
    );
  }
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
 * @param column - Column name.
 * @param prefix - Entity-type tag.
 * @returns The `public.is_entity_id_with_prefix(...)` call.
 * @throws {EntityIdError} When the prefix is invalid.
 *
 * @public
 */
export function entityIdCheckSql(column: string, prefix: string): string {
  return `public.is_entity_id_with_prefix(${column}, '${normalizePrefix(prefix)}')`;
}
