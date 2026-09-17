FROM node:22-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN npx turbo run build --filter=@closebuy/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
