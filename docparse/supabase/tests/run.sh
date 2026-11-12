#!/usr/bin/env bash
# Applies the shim + all migrations to a scratch Postgres DB and runs the SQL tests.
# Uses the standard libpq env vars (PGHOST, PGUSER, PGPASSWORD...). Needs a superuser.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="docparse_test_$$"
export PGCONNECT_TIMEOUT=10
psql -X -w -d postgres -qc "create database $db" >/dev/null
trap 'psql -X -w -d postgres -qc "drop database if exists $db" >/dev/null' EXIT
run() { psql -X -w -d "$db" -v ON_ERROR_STOP=1 -q "$@"; }
run -f "$here/supabase_shim.sql"
for f in "$here"/../migrations/*.sql; do run -f "$f"; done
run -o /dev/null -f "$here/rls_and_quota.test.sql"
echo "SQL tests passed"
