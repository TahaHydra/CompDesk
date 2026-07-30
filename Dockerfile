# ── Build Stage ──────────────────────────────────────────────────
FROM node:24-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production Stage ─────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/migrate-private-attachments.mjs ./scripts/migrate-private-attachments.mjs
COPY --from=builder /app/scripts/validate-runtime-env.mjs ./scripts/validate-runtime-env.mjs
COPY --from=builder /app/scripts/setup-bootstrap.mjs ./scripts/setup-bootstrap.mjs
COPY --from=builder /app/scripts/setup-core.mjs ./scripts/setup-core.mjs
COPY --from=builder /app/scripts/setup-ui.html ./scripts/setup-ui.html
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/storage/attachments && chown -R nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "node scripts/validate-runtime-env.mjs && exec node server.js"]
