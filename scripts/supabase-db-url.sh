#!/usr/bin/env bash
# Prints the "Session pooler" connection string of a Supabase project, from
# its ref, its pooler address and its database password (in DB_PASSWORD), so
# a GitHub secret can hold just the password instead of the whole string.
#
# The pooler address is the host in the dashboard's Connect -> Direct ->
# Session pooler string. Checked 2026-10-27 (a pooler that hosts a project
# asks for its password; the others answer "tenant not found"):
#   live     vsxwwgglvckbjxvifxuw  aws-1-ap-northeast-2.pooler.supabase.com
#   staging  hoezwrpnhgyltrqbomdc  aws-0-ap-northeast-1.pooler.supabase.com
#
# The password is URL-encoded, so any character in it is fine. The string is
# tried once and printed only if the login works. The caller must mask it
# (::add-mask::) before anything could print it.
#
# Usage: DB_PASSWORD=... scripts/supabase-db-url.sh <project ref> <pooler host>
set -euo pipefail

ref=$1
host=$2
password=$(python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["DB_PASSWORD"], safe=""))')
url="postgresql://postgres.${ref}:${password}@${host}:5432/postgres"

if ! error=$(psql "$url" --no-psqlrc --quiet --tuples-only --command 'select 1' 2>&1 >/dev/null); then
  # psql's message names the server and user, never the password.
  echo "Could not log in to project ${ref}: ${error}" >&2
  exit 1
fi

echo "$url"
