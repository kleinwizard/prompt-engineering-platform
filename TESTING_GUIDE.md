# Testing Guide - Prompt Engineering Platform

## Prerequisites

### Required Software
- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 6+
- Git

### Optional (for full features)
- Docker & Docker Compose
- OpenAI API Key
- Anthropic API Key
- SendGrid/AWS SES credentials (for email)

## Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/kleinwizard/prompt-engineering-platform.git
cd prompt-engineering-platform

# Install dependencies
npm install

# Install package dependencies
cd packages/shared && npm install && cd ../..
cd packages/prompt-engine && npm install && cd ../..
cd packages/llm-client && npm install && cd ../..
cd apps/api && npm install && cd ../..
cd apps/web && npm install && cd ../..
```

## Step 2: Database Setup

### Option A: Using Docker (Recommended)
```bash
# Start PostgreSQL and Redis with Docker
cd infrastructure/docker
docker-compose up -d postgres redis
```

### Option B: Manual Setup
```bash
# PostgreSQL (assuming it's installed)
createdb prompt_platform_dev

# Redis (assuming it's installed)
redis-server
```

## Step 3: Environment Configuration

Create `.env` files in both `apps/api` and `apps/web`:

### apps/api/.env
```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prompt_platform_dev"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT Secrets (generate secure random strings)
JWT_SECRET="your-super-secret-jwt-key-min-32-chars-long"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-min-32-chars"

# Encryption
ENCRYPTION_KEY="64-character-hex-string-for-encryption-key-here"

# API Keys (optional but recommended for full features)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_AI_API_KEY="..."

# Email (optional)
EMAIL_PROVIDER="smtp"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
EMAIL_FROM="noreply@yourapp.com"

# Application
APP_URL="http://localhost:3000"
API_URL="http://localhost:3001"
PORT=3001
```

### apps/web/.env.local
```env
NEXT_PUBLIC_API_URL="http://localhost:3001"
NEXT_PUBLIC_WS_URL="ws://localhost:3001"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Step 4: Database Setup

```bash
cd apps/api

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database with sample data
npx prisma db seed
```

## Step 5: Start the Application

### Terminal 1: Start Backend API
```bash
cd apps/api
npm run start:dev
# API will run on http://localhost:3001
```

### Terminal 2: Start Frontend
```bash
cd apps/web
npm run dev
# Web app will run on http://localhost:3000
```

## Step 6: Test User Journey

### 1. Registration & Login
1. Open http://localhost:3000
2. Click "Sign Up" 
3. Create account with:
   - Email: test@example.com
   - Password: TestPassword123!
   - Username: testuser
4. Verify you can log in

### 2. Test Prompt Creation
1. Navigate to Dashboard
2. Click "New Prompt"
3. Enter a basic prompt: "Write a summary of climate change"
4. Click "Improve" to see AI enhancement
5. Save the prompt

### 3. Test Template Library
1. Go to Templates section
2. Browse existing templates
3. Use a template to create a new prompt
4. Fork and modify a template

### 4. Test Collaboration
1. Open two browser windows (one incognito)
2. Create accounts for both
3. Share a prompt between users
4. Test real-time editing

### 5. Test Search & Discovery
1. Use the search bar to find prompts
2. Filter by categories and tags
3. Check faceted search results

### 6. Test Analytics
1. View your profile dashboard
2. Check improvement metrics
3. Review usage statistics

### 7. Test Challenges
1. Browse available challenges
2. Submit a prompt to a challenge
3. View leaderboard

## Step 7: API Testing

### Using curl or Postman:

#### Register User
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "api@test.com",
    "password": "SecurePass123!",
    "username": "apiuser"
  }'
```

#### Login
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "api@test.com",
    "password": "SecurePass123!"
  }'
```

#### Create Prompt (use token from login)
```bash
curl -X POST http://localhost:3001/prompts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Test Prompt",
    "originalPrompt": "Explain quantum computing",
    "category": "education",
    "isPublic": true
  }'
```

#### Improve Prompt
```bash
curl -X POST http://localhost:3001/prompts/improve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "prompt": "Explain quantum computing",
    "model": "gpt-4"
  }'
```

## Step 8: Docker Testing (Full Stack)

```bash
# Build and run everything with Docker
cd infrastructure/docker
docker-compose up --build

# Access at:
# - Web: http://localhost:3000
# - API: http://localhost:3001
# - Postgres: localhost:5432
# - Redis: localhost:6379
```

## Common Issues & Solutions

### Issue: Database connection failed
**Solution**: Ensure PostgreSQL is running and DATABASE_URL is correct

### Issue: Redis connection failed
**Solution**: Start Redis server or check REDIS_URL

### Issue: API keys not working
**Solution**: Verify API keys are valid and have proper permissions

### Issue: Email not sending
**Solution**: Check email provider settings and credentials

### Issue: WebSocket not connecting
**Solution**: Ensure CORS is configured and WS_URL is correct

### Issue: Build errors
**Solution**: 
```bash
# Clean and rebuild
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Testing Checklist

- [ ] User registration works
- [ ] User login works
- [ ] JWT tokens are issued
- [ ] Prompt creation works
- [ ] Prompt improvement works (if API keys configured)
- [ ] Search functionality works
- [ ] Real-time updates work (WebSocket)
- [ ] File upload works
- [ ] Templates can be created and used
- [ ] Challenges can be viewed
- [ ] Profile updates work
- [ ] Logout works properly

## Performance Testing

### Load Testing with Artillery
```bash
npm install -g artillery

# Create load test file
artillery quick --count 10 --num 100 http://localhost:3001/health
```

### Monitor Resources
- Check API logs: `docker logs prompt-platform-api`
- Monitor database: `docker exec -it prompt-platform-postgres psql -U postgres`
- Check Redis: `docker exec -it prompt-platform-redis redis-cli`

## Security Testing

1. Test rate limiting by making rapid requests
2. Try SQL injection in search fields
3. Test JWT expiration
4. Verify password requirements
5. Check CORS configuration
6. Test input validation

## Next Steps

After successful testing:
1. Configure production environment variables
2. Set up SSL certificates
3. Configure domain names
4. Set up monitoring (Prometheus/Grafana)
5. Configure backup strategies
6. Deploy to production environment