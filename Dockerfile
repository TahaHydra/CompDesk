FROM node:24-alpine AS base
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
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/storage/attachments \
    && chown -R nextjs:nodejs /app/storage
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Ephemeral setup/migration target. It deliberately retains Prisma CLI tooling;
# normal application containers use the smaller production-only runner below.
FROM runtime-base AS setup
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
CMD ["node", "scripts/setup-bootstrap.mjs"]

FROM runtime-base AS runner
USER nextjs
CMD ["sh", "-c", "node scripts/validate-runtime-env.mjs && exec node server.js"]
