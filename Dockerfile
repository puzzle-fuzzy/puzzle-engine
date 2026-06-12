FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/provider/package.json packages/provider/
COPY packages/billing/package.json packages/billing/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/worker/package.json apps/worker/
RUN bun install --frozen-lockfile --production

# Copy source
COPY packages/ packages/
COPY apps/ apps/

# Build client
RUN bun run --cwd apps/client build

EXPOSE 5007

# Copy client dist to shared location for nginx
RUN cp -r apps/client/dist /client-dist

CMD ["bun", "run", "apps/server/src/index.ts"]
