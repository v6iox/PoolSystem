# Moonpool — multi-stage build for Raspberry Pi (arm64) and x86_64.
# Runs the Next.js standalone server; SQLite lives on a mounted volume.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 is a native module — toolchain needed at install time only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/moonpool.db

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Schema is read at boot; make sure it's present regardless of tracing.
COPY --from=build /app/src/server/db/schema.sql ./src/server/db/schema.sql

RUN mkdir -p /data && chown node:node /data /app
USER node
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
