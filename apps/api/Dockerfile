# Multi-stage Dockerfile for NestJS API

# Base stage
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

# Dependencies stage
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/*/
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm run build:api

# Development stage
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "dev:api"]

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies
COPY package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/*/
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile --prod && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/*/dist ./packages/*/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Set ownership
RUN chown -R nestjs:nodejs /app
USER nestjs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

# Production start command
CMD ["node", "apps/api/dist/main.js"]