#!/bin/bash

echo "🚀 Setting up Prompt Engineering Platform Database..."

# Wait for PostgreSQL to be ready
until docker exec $(docker ps -qf "name=postgres") pg_isready -U postgres; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

echo "✅ PostgreSQL is ready!"

# Navigate to API directory
cd apps/api

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
npx prisma generate

# Run migrations
echo "🔄 Running database migrations..."
npx prisma migrate deploy

# Seed database
echo "🌱 Seeding database..."
npx prisma db seed

echo "✅ Database setup complete!"