#!/bin/bash

# Development setup script for Prompt Engineering Platform
set -e

echo "🚀 Setting up Prompt Engineering Platform for development..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose > /dev/null 2>&1 && ! docker compose version > /dev/null 2>&1; then
    echo "❌ Docker Compose is not available. Please install Docker Compose and try again."
    exit 1
fi

# Create environment files if they don't exist
echo "📄 Setting up environment files..."

API_ENV_FILE="../../apps/api/.env"
WEB_ENV_FILE="../../apps/web/.env"

if [ ! -f "$API_ENV_FILE" ]; then
    echo "Creating API environment file..."
    cp "../../apps/api/.env.example" "$API_ENV_FILE"
    echo "⚠️  Please edit apps/api/.env with your actual API keys"
fi

if [ ! -f "$WEB_ENV_FILE" ]; then
    echo "Creating Web environment file..."
    cp "../../apps/web/.env.example" "$WEB_ENV_FILE"
    echo "⚠️  Please edit apps/web/.env with your configuration"
fi

# Start infrastructure services
echo "🐳 Starting infrastructure services..."
cd ../docker
docker-compose up -d postgres redis elasticsearch minio prometheus grafana mailhog

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if PostgreSQL is ready
echo "📊 Checking PostgreSQL connection..."
until docker-compose exec -T postgres pg_isready -U prompt_user -d prompt_platform; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

# Check if Redis is ready
echo "🔑 Checking Redis connection..."
until docker-compose exec -T redis redis-cli ping | grep -q PONG; do
    echo "Waiting for Redis..."
    sleep 2
done

# Install dependencies
echo "📦 Installing dependencies..."
cd ../../
npm install

# Generate Prisma client and run migrations
echo "🗃️  Setting up database..."
cd apps/api
npx prisma generate
npx prisma migrate dev --name init

# Seed the database with initial data
echo "🌱 Seeding database..."
npx prisma db seed

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "🌐 Services available at:"
echo "  • Web App:          http://localhost:3001"
echo "  • API:              http://localhost:3000"
echo "  • API Docs:         http://localhost:3000/api/docs"
echo "  • PostgreSQL:       localhost:5432"
echo "  • Redis:            localhost:6379"
echo "  • Elasticsearch:    http://localhost:9200"
echo "  • MinIO:            http://localhost:9001"
echo "  • Prometheus:       http://localhost:9090"
echo "  • Grafana:          http://localhost:3030 (admin/admin)"
echo "  • MailHog:          http://localhost:8025"
echo ""
echo "🚀 To start the development servers, run:"
echo "  npm run dev"
echo ""
echo "📚 Next steps:"
echo "  1. Edit apps/api/.env with your LLM API keys"
echo "  2. Edit apps/web/.env with your configuration"
echo "  3. Start the development servers: npm run dev"
echo ""