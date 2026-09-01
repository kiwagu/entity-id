#!/usr/bin/env bash
#
# Cross-checks the SQL generator against the TypeScript implementation on a
# real PostgreSQL instance.
#
#   1. applies sql/entity_id_generate.sql to a throwaway container;
#   2. feeds database-generated ids through the TS validator;
#   3. feeds TS-generated ids into a column constrained by the SQL CHECK;
#   4. asserts the CHECK rejects malformed, wrong-prefix and wrong-alphabet ids.
#
# Requires Docker. Usage: ./scripts/verify-sql-crosscheck.sh
set -euo pipefail

CONTAINER="entity-id-sql-check-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting $PG_IMAGE"
docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=pg "$PG_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

psql_c() { docker exec "$CONTAINER" psql -U postgres -At -v ON_ERROR_STOP=1 "$@"; }

echo "==> applying sql/entity_id_generate.sql"
docker cp "$ROOT/sql/entity_id_generate.sql" "$CONTAINER:/tmp/eid.sql" >/dev/null
psql_c -q -f /tmp/eid.sql

echo "==> database ids must satisfy the TypeScript contract"
psql_c -c "select public.entity_id_generate('usr') from generate_series(1,200);" \
  > "$ROOT/.db_ids.tmp"
npx tsx "$ROOT/scripts/verify-db-ids.ts" "$ROOT/.db_ids.tmp"
rm -f "$ROOT/.db_ids.tmp"

echo "==> database ids must be unique in bulk"
distinct=$(psql_c -c "select count(distinct public.entity_id_generate('usr')) from generate_series(1,2000);")
[ "$distinct" = "2000" ] || { echo "FAIL: only $distinct/2000 distinct ids"; exit 1; }

echo "==> TypeScript ids must pass the SQL CHECK"
psql_c -c "create table t (id text primary key default public.entity_id_generate('usr') check (public.is_entity_id_with_prefix(id,'usr')));" >/dev/null
node --input-type=module -e "
  import { createEntityId } from '$ROOT/dist/index.js';
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push(createEntityId('usr'));
  rows.push(createEntityId('usr', { timeMs: 0, monotonic: false }));
  process.stdout.write(rows.join('\n') + '\n');
" > "$ROOT/.ts_ids.tmp"
docker cp "$ROOT/.ts_ids.tmp" "$CONTAINER:/tmp/ts_ids.txt" >/dev/null
rm -f "$ROOT/.ts_ids.tmp"
psql_c -c "\copy t(id) from '/tmp/ts_ids.txt'" >/dev/null
accepted=$(psql_c -c "select count(*) from t;")
[ "$accepted" = "51" ] || { echo "FAIL: only $accepted/51 TS ids accepted"; exit 1; }

echo "==> the CHECK must reject bad values"
for bad in "not-an-id" "ord_3d15nt10w6bvf24c.0000000000" "usr_SHORT.0000000000" "usr_3d15nt10w6bvf24u.0000000000"; do
  if docker exec "$CONTAINER" psql -U postgres -At -c "insert into t(id) values ('$bad');" >/dev/null 2>&1; then
    echo "FAIL: the CHECK accepted \"$bad\""
    exit 1
  fi
done

echo "==> OK: SQL and TypeScript agree on the id contract"
