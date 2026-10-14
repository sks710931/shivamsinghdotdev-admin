#!/usr/bin/env bash
# Brings up a local SQL Server container and starts the app against it.
# Shared container "blogdesk-mssql"; each checkout gets its own database (LOCAL_DB_NAME).
set -euo pipefail
cd "$(dirname "$0")/.."
# mssql/tedious require Node >= 22. Prefer a user-local Node 22 if the system one is older.
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  if [ -x "$HOME/.local/node22/bin/node" ]; then export PATH="$HOME/.local/node22/bin:$PATH"; else echo "Node >= 22 is required (found $(node -v))."; exit 1; fi
fi
CONTAINER=blogdesk-mssql
# Exported DB vars in the shell override .env.local inside Next, so refuse to run with them set.
for v in DATABASE_URL DB_SERVER DB_DATABASE DB_USER DB_PASSWORD; do
  [ -n "${!v:-}" ] && { echo "Unset $v in your shell first; it would override .env.local."; exit 1; }
done
IMAGE=mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04
SECRET_FILE="${HOME}/.blogdesk/sa_password"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo --preserve-env=SQLCMDPASSWORD,MSSQL_SA_PASSWORD docker"

if ! $DOCKER info >/dev/null 2>&1; then
  echo "Starting Docker daemon..."
  (sudo nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do $DOCKER info >/dev/null 2>&1 && break; sleep 1; done
  $DOCKER info >/dev/null 2>&1 || { echo "Docker failed to start, see /tmp/dockerd.log"; exit 1; }
fi

mkdir -p "$(dirname "$SECRET_FILE")"; chmod 700 "$(dirname "$SECRET_FILE")"
if [ ! -s "$SECRET_FILE" ]; then
  umask 077; printf '%sAa1!' "$(openssl rand -hex 16)" > "$SECRET_FILE"
fi
SA_PASSWORD="$(cat "$SECRET_FILE")"

if ! $DOCKER ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Creating $CONTAINER..."
  MSSQL_SA_PASSWORD="$SA_PASSWORD" $DOCKER run -d --name "$CONTAINER" --restart unless-stopped \
    -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD -e MSSQL_MEMORY_LIMIT_MB=2048 \
    -p 127.0.0.1:1433:1433 -v blogdesk-mssql-data:/var/opt/mssql "$IMAGE" >/dev/null
else
  [ "$($DOCKER inspect -f '{{.Config.Image}}' "$CONTAINER")" = "$IMAGE" ] || echo "Warning: $CONTAINER runs a different image and is not recreated automatically."
  [ "$($DOCKER inspect -f '{{.State.Running}}' "$CONTAINER")" = "true" ] || $DOCKER start "$CONTAINER" >/dev/null
fi

# Password goes through the environment, never argv, so it does not show in `ps`.
export SQLCMDPASSWORD="$SA_PASSWORD"
SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -b)
echo -n "Waiting for SQL Server"
for _ in $(seq 1 60); do
  $DOCKER exec -e SQLCMDPASSWORD "$CONTAINER" "${SQLCMD[@]}" -Q "SELECT 1" >/dev/null 2>&1 && { echo " ready"; break; }
  echo -n "."; sleep 2
done
$DOCKER exec -e SQLCMDPASSWORD "$CONTAINER" "${SQLCMD[@]}" -Q "SELECT 1" >/dev/null 2>&1 || { echo " SQL Server not healthy"; exit 1; }

DB_NAME="${LOCAL_DB_NAME:-blogdesk_$(whoami)_$(basename "$PWD" | tr -c 'A-Za-z0-9\n' '_')}"
[[ "$DB_NAME" =~ ^[A-Za-z][A-Za-z0-9_]{0,99}$ ]] || { echo "Invalid database name: $DB_NAME"; exit 1; }
$DOCKER exec -e SQLCMDPASSWORD "$CONTAINER" "${SQLCMD[@]}" -Q "IF DB_ID(N'$DB_NAME') IS NULL CREATE DATABASE [$DB_NAME]" >/dev/null

# Write .env.local (gitignored). Keep any non-DB values the developer already set.
touch .env.local; chmod 600 .env.local
grep -vE '^(DATABASE_URL|DB_SERVER|DB_PORT|DB_DATABASE|DB_USER|DB_PASSWORD|DB_ENCRYPT|DB_TRUST_SERVER_CERTIFICATE)=' .env.local > .env.local.tmp || true
cat >> .env.local.tmp <<ENV
DB_SERVER=127.0.0.1
DB_PORT=1433
DB_DATABASE=$DB_NAME
DB_USER=sa
DB_PASSWORD=$SA_PASSWORD
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
ENV
grep -q '^ADMIN_EMAIL=' .env.local.tmp || echo "ADMIN_EMAIL=admin@localhost.test" >> .env.local.tmp
grep -q '^ADMIN_PASSWORD=' .env.local.tmp || echo "ADMIN_PASSWORD=$(openssl rand -hex 12)" >> .env.local.tmp
grep -q '^APP_URL=' .env.local.tmp || echo "APP_URL=http://localhost:3000" >> .env.local.tmp
mv .env.local.tmp .env.local
echo "Database $DB_NAME ready. Credentials are in .env.local (not committed)."

if node -e "process.exit(require('./package.json').scripts['db:migrate']?0:1)"; then
  # db:migrate reads .env.local itself or via dotenv; do not export secrets into this shell.
  pnpm db:migrate
else
  echo "No db:migrate script yet; the app will bootstrap its schema on first request."
fi

[ "${1:-}" = "--db-only" ] && exit 0
exec pnpm dev
