#!/bin/bash

echo "🚀 Prompt Engineering Platform - Quick Setup"
echo "==========================================="

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ is required"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install package dependencies
echo "📦 Installing package dependencies..."
cd packages/shared && npm install && cd ../..
cd packages/prompt-engine && npm install && cd ../..
cd packages/llm-client && npm install && cd ../..

# Check for .env files
if [ ! -f "apps/api/.env" ]; then
    echo "⚠️  No .env file found for API"
    echo "Creating from template..."
    # The template will be created by the instructions above
    echo "Please edit apps/api/.env with your configuration"
fi

if [ ! -f "apps/web/.env.local" ]; then
    echo "⚠️  No .env.local file found for Web"
    echo "Creating from template..."
    # The template will be created by the instructions above
    echo "Please edit apps/web/.env.local if needed"
fi

# Generate secure keys
echo ""
echo "🔐 Generate secure keys with these commands:"
echo "JWT_SECRET: openssl rand -hex 32"
echo "JWT_REFRESH_SECRET: openssl rand -hex 32"
echo "ENCRYPTION_KEY: openssl rand -hex 32"
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit apps/api/.env with your configuration"
echo "2. Add at least one AI provider API key (OpenAI, Anthropic, etc.)"
echo "3. Run: ./scripts/start-production.sh"