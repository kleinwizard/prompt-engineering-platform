#!/bin/bash

echo "🚀 Starting Prompt Engineering Platform in Production Mode..."

# Check if .env files exist
if [ ! -f "apps/api/.env" ]; then
    echo "❌ Error: apps/api/.env file not found!"
    echo "Please create it using the template provided."
    exit 1
fi

if [ ! -f "apps/web/.env.local" ]; then
    echo "❌ Error: apps/web/.env.local file not found!"
    echo "Please create it using the template provided."
    exit 1
fi

# Start infrastructure
echo "🐳 Starting Docker services..."
docker-compose up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 10

# Setup database
./scripts/setup-database.sh

# Build applications
echo "🔨 Building applications..."
npm run build

# Start API in production mode
echo "🚀 Starting API server..."
cd apps/api
npm run start:prod &
API_PID=$!

cd ../..

# Start Web app in production mode
echo "🚀 Starting Web application..."
cd apps/web
npm run start &
WEB_PID=$!

echo "✅ Platform is running!"
echo "📱 Web App: http://localhost:3001"
echo "🔌 API: http://localhost:3000"
echo "📚 API Docs: http://localhost:3000/api/docs"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap "echo '🛑 Shutting down...'; kill $API_PID $WEB_PID; docker-compose down; exit" INT
wait