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

/**
 * The SQL expression yielding an entity id's time suffix, whose lexicographic
 * order is chronological order.
 *
 * Use it in an `ORDER BY`, or as the body of an index — see
 * {@link entityIdTimeIndexSql}.
 *
 * @param column - Column holding the id. Default: `'id'`.
 * @returns The `public.entity_id_ts_of(...)` call.
 * @throws {Error} When the column name is not a plain SQL identifier.
 *
 * @example
 * ```ts
 * `select * from events order by ${entityIdTimeOrderSql()} desc limit 50`;
 * ```
 *
 * @public
 */
export function entityIdTimeOrderSql(column = 'id'): string {
  assertSqlIdentifier(column);
  return `public.entity_id_ts_of(${column})`;
}

/**
 * Options for {@link entityIdTimeIndexSql}.
 *
 * @public
 */
export type EntityIdTimeIndexOptions = Readonly<{
  /** Column holding the id. Default: `'id'`. */
  column?: string;
  /** Index name. Default: `<table>_<column>_ts_idx`. */
  name?: string;
  /**
   * Emit `create index concurrently`, which does not lock the table for
   * writes. It cannot run inside a transaction block, so most migration
   * runners need to be told to run this statement on its own. Default: `false`.
   */
  concurrently?: boolean;
  /** Emit `if not exists`, making the statement re-runnable. Default: `true`. */
  ifNotExists?: boolean;
  /** Index direction. Default: `'desc'`, matching newest-first listings. */
  direction?: 'asc' | 'desc';
}>;

/**
 * A `create index` statement giving a table chronological ordering by id,
 * without adding a column.
 *
 * **This index is optional, and it is not the default recommendation.** A
 * dedicated `created_at` column is faster, smaller and independent of the id
 * format. Measured on 200 000 rows: a `created_at` index answers a
 * newest-first `LIMIT 50` in ~0.08 ms against ~0.17 ms here, for ~4.4 MB
 * against ~6.2 MB. Reach for this when adding a column is impractical — on an
 * existing table, or one you do not own.
 *
 * Requires `ENTITY_ID_SQL` to have been applied, which installs
 * `public.entity_id_ts_of`.
 *
 * @param table - Table to index.
 * @param options - See {@link EntityIdTimeIndexOptions}.
 * @returns The `create index` statement, without a trailing semicolon.
 * @throws {Error} When an identifier is not a plain SQL identifier.
 *
 * @example
 * ```ts
 * entityIdTimeIndexSql('events');
 * // create index if not exists events_id_ts_idx
 * //   on events (public.entity_id_ts_of(id) desc)
 *
 * entityIdTimeIndexSql('events', { concurrently: true, ifNotExists: false });
 * ```
 *
 * @public
 */
export function entityIdTimeIndexSql(
  table: string,
  options: EntityIdTimeIndexOptions = {}
): string {
  assertSqlIdentifier(table, 'table name');
  const column = options.column ?? 'id';
  assertSqlIdentifier(column);

  const name = options.name ?? `${table}_${column}_ts_idx`;
  assertSqlIdentifier(name, 'index name');

  const direction = options.direction ?? 'desc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error(
      `Invalid index direction "${String(direction)}". Expected 'asc' or 'desc'.`
    );
  }

  const concurrently = options.concurrently ? ' concurrently' : '';
  const ifNotExists = (options.ifNotExists ?? true) ? ' if not exists' : '';

  return (
    `create index${concurrently}${ifNotExists} ${name} ` +
    `on ${table} (${entityIdTimeOrderSql(column)} ${direction})`
  );
}
