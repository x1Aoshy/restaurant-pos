#!/bin/bash
# Roles that Supabase provides out of the box and a plain Postgres does not.
#
# `sync-server.sql` revokes table access from `anon` and `authenticated` and
# grants EXECUTE on the two sync functions to `anon`. On a self-hosted Postgres
# those roles do not exist, so that script aborts with
# `role "anon" does not exist` and the server comes up with no schema at all.
#
# This runs first — the Postgres entrypoint applies files in alphabetical order
# — and creates them with the same shape Supabase uses:
#
#   authenticator   logs in, owns nothing, can only become the other two
#   anon            what an unauthenticated HTTP request runs as
#   authenticated   unused here, but named by the revokes in sync-server.sql
#
# `authenticator` is NOINHERIT on purpose. It holds the other two roles but does
# not gain their privileges until PostgREST explicitly switches, so a connection
# that never switches can do nothing.
#
# It is a shell script and not plain SQL because the password comes from the
# environment, and a `.sql` file has no way to read it.
set -euo pipefail

: "${AUTHENTICATOR_PASSWORD:?set AUTHENTICATOR_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	create role anon nologin;
	create role authenticated nologin;

	create role authenticator login noinherit
	  password '${AUTHENTICATOR_PASSWORD}';
	grant anon, authenticated to authenticator;

	-- Nothing may be created in \`public\` by these roles. The schema is built
	-- by the superuser while this container initialises and never changes
	-- afterwards.
	revoke create on schema public from anon, authenticated, public;
SQL
