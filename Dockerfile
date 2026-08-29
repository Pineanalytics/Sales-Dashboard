# Self-hosted replacement for Netlify's per-request serverless functions (see
# migration plan Step 2) — this builds a standalone Next.js server that runs
# as one long-lived Node process instead of one function invocation per
# request, which is what actually eliminates the credit-metered billing
# rather than just moving it.
#
# Debian-slim (not Alpine) throughout, deliberately: Prisma's query engine
# needs glibc + OpenSSL, and mixing Alpine's musl libc between build and
# runtime stages is a well-known source of "engine not found" failures.

FROM node:20-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Long-running source workers use the same checked-in bridge code as the
# dashboard, but run in their own containers. Keeping them separate means a
# slow SAP/Pine read can never occupy the Next.js request process.
FROM deps AS sync-worker
ARG APP_BUILD_COMMIT=development
ARG APP_BUILD_BRANCH=local
ARG APP_BUILT_AT=unknown
ARG APP_SCHEMA_FINGERPRINT=unavailable
WORKDIR /app
ENV APP_BUILD_COMMIT=$APP_BUILD_COMMIT
ENV APP_BUILD_BRANCH=$APP_BUILD_BRANCH
ENV APP_BUILT_AT=$APP_BUILT_AT
ENV APP_SCHEMA_FINGERPRINT=$APP_SCHEMA_FINGERPRINT
LABEL org.opencontainers.image.revision=$APP_BUILD_COMMIT
COPY . .
# Bridge entry points call process.loadEnvFile(). The real values are injected
# by Compose at runtime; this harmless template only makes the file available
# inside the image and cannot override an already-set environment variable.
COPY .env.example .env
RUN npx prisma generate
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
USER nextjs
CMD ["node", "--import", "tsx", "scripts/continuous-sync-worker.ts"]

FROM base AS runner
ARG APP_BUILD_COMMIT=development
ARG APP_BUILD_BRANCH=local
ARG APP_BUILT_AT=unknown
ARG APP_SCHEMA_FINGERPRINT=unavailable
WORKDIR /app
ENV NODE_ENV=production
ENV APP_BUILD_COMMIT=$APP_BUILD_COMMIT
ENV APP_BUILD_BRANCH=$APP_BUILD_BRANCH
ENV APP_BUILT_AT=$APP_BUILT_AT
ENV APP_SCHEMA_FINGERPRINT=$APP_SCHEMA_FINGERPRINT
LABEL org.opencontainers.image.revision=$APP_BUILD_COMMIT
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Next's standalone file-tracing doesn't reliably pick up Prisma's generated
# query engine binary — copied explicitly so the runtime image actually has it.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Next.js's standalone server.js binds to `process.env.HOSTNAME || '0.0.0.0'`. Docker
# reserves HOSTNAME and always auto-sets it to the container's own ID regardless of what
# `-e`/compose `environment:` tries to pass in (confirmed: an externally-set value never
# even reaches the container's Config.Env) — and that ID resolves via /etc/hosts to the
# container's bridge-network IP, not 127.0.0.1. Left as-is, the server only binds to that
# bridge IP: Caddy (reaching it over the Docker network) still works fine, but any
# self-fetch to localhost from inside the same container — like the healthcheck below —
# always fails, permanently marking the container "unhealthy" despite serving real traffic
# correctly. Overriding HOSTNAME here, at the shell layer immediately before exec'ing node,
# happens after Docker's own injection and is the only thing that actually sticks.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
