# syntax=docker/dockerfile:1
#
# Two images from one file:
#   docker build --target api -t itqan-api .
#   docker build --target web --build-arg NEXT_PUBLIC_API_URL=https://api.example.org -t itqan-web .
# (NEXT_PUBLIC_API_URL is baked into the web build: it is the address the browser calls.)

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-slim AS base
RUN corepack enable
WORKDIR /repo

# ── Install dependencies (cached until a package.json or the lockfile changes) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/core/package.json apps/core/
COPY apps/web/package.json apps/web/
COPY packages/fsrs/package.json packages/fsrs/
COPY packages/quran/package.json packages/quran/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY apps ./apps
COPY packages ./packages

# ── API ──
FROM source AS api-build
RUN pnpm --filter @itqan/core build \
 && pnpm --filter @itqan/core deploy --prod /out/api \
 && cp -r apps/core/dist /out/api/dist \
 && cp -r apps/core/drizzle /out/api/drizzle

FROM node:${NODE_VERSION}-slim AS api
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=api-build --chown=node:node /out/api ./
# Where recordings are kept. Created here, owned by the non-root user, so a volume mounted on it is writable.
RUN mkdir -p /data/audio && chown -R node:node /data
VOLUME /data/audio
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]

# ── Web ──
FROM source AS web-build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Set --build-arg NEXT_PUBLIC_API_URL (the public address of the API)" && exit 1)
RUN pnpm --filter @itqan/web build

FROM node:${NODE_VERSION}-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
