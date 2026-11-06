#!/bin/sh
# Apply pending migrations, then start the API. Used as the Render start command.
# Neon's free tier suspends idle databases; the first connection can time out while
# it wakes, so retry the migration a few times before giving up.
cd /app/apps/api || exit 1
n=0
until npx prisma migrate deploy; do
  n=$((n + 1))
  if [ "$n" -ge 6 ]; then
    echo "prisma migrate deploy failed after $n attempts" >&2
    exit 1
  fi
  echo "migrate attempt $n failed, retrying in 8s..."
  sleep 8
done
exec node dist/server.js
