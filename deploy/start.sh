#!/bin/sh
# Apply pending migrations, then start the API. Used as the Render start command.
set -e
cd /app/apps/api
npx prisma migrate deploy
exec node dist/server.js
