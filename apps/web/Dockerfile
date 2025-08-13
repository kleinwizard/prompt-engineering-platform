# Multi-stage Dockerfile for Next.js Web App

# Base stage
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

# Dependencies stage
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ./packages/*/
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Build packages first
RUN pnpm run build:packages

# Build web app
RUN pnpm run build:web

# Development stage
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "dev:web"]

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies
COPY package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ./packages/*/
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile --prod && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set ownership
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

# Production start command
CMD ["node", "apps/web/server.js"]