FROM node:25-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS prod-deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime-base
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="CompDesk" \
      org.opencontainers.image.description="Self-hosted helpdesk and ticketing platform." \
      org.opencontainers.image.licenses="MIT"
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/migrate-private-attachments.mjs ./scripts/migrate-private-attachments.mjs
COPY --from=builder /app/scripts/validate-runtime-env.mjs ./scripts/validate-runtime-env.mjs
COPY --from=builder /app/scripts/setup-bootstrap.mjs ./scripts/setup-bootstrap.mjs
COPY --from=builder /app/scripts/setup-core.mjs ./scripts/setup-core.mjs
COPY --from=builder /app/scripts/setup-ui.html ./scripts/setup-ui.html
COPY --from=builder /app/scripts/setup-installed.html ./scripts/setup-installed.html
COPY --from=builder /app/scripts/orchestrator.mjs ./scripts/orchestrator.mjs
COPY --from=builder /app/scripts/orchestrator-core.mjs ./scripts/orchestrator-core.mjs
COPY --from=builder /app/scripts/config-init.mjs ./scripts/config-init.mjs
COPY --from=builder /app/scripts/config-store.mjs ./scripts/config-store.mjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/storage/attachments \
    && chown -R nextjs:nodejs /app/storage
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# One final runtime image serves initialization (config-init), first-run
# setup, migrations, and production — Compose selects the role per service
# via `command:`/`user:` overrides rather than a separate Dockerfile target.
# It layers just the Prisma CLI (`prisma`) plus its own dependencies
# (`@prisma/engines`, which holds both the Query Engine and Schema Engine
# binaries needed by `prisma migrate deploy`) on top of the lean prod-only
# node_modules above — never the full `deps` devDependency tree (eslint,
# jest, playwright, typescript, tailwind, ...), which the old two-stage
# split used to drag into every long-running production container.
FROM runtime-base AS runner
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
CMD ["node", "scripts/orchestrator.mjs"]
