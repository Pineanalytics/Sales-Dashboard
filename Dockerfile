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

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
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
CMD ["node", "server.js"]
