# 🚀 Prompt Engineering Platform

A comprehensive, production-ready platform for prompt engineering, optimization, and learning. Built with enterprise-grade architecture and security.

## ✨ Features

### 🎯 Core Functionality
- **Advanced Prompt Improvement Engine** - AI-powered prompt optimization with rule-based enhancement
- **Multi-LLM Support** - Integration with OpenAI, Anthropic, Google, Azure OpenAI, and Ollama
- **Real-time Collaboration** - WebSocket-powered live editing and sharing
- **Professional Workspace** - Three-column layout with coaching, metrics, and history

### 🎮 Gamification System
- **Points & Levels** - Comprehensive scoring system with experience tracking
- **Badges & Achievements** - Over 20 badges with rarity system (common to legendary)
- **Streaks & Challenges** - Daily/weekly challenges with leaderboards
- **Social Features** - Follow users, share prompts, community engagement

### 📚 Learning Hub
- **Structured Learning Paths** - Beginner to expert curriculum
- **Interactive Lessons** - Hands-on learning with quizzes and exercises
- **Skill Assessment** - Multi-dimensional skill tracking and improvement
- **Spaced Repetition** - Optimized learning schedule

### 🏢 Enterprise Features
- **Team Management** - Multi-user workspaces and collaboration
- **Analytics Dashboard** - Comprehensive usage and performance metrics
- **Template Library** - Versioned template system with community sharing
- **API Access** - Full REST API with rate limiting and quotas

## 🏗️ Architecture

### Frontend (Next.js 14)
- **React 18** with Server Components
- **TypeScript** for type safety
- **Tailwind CSS** + Shadcn/ui components
- **Zustand** state management
- **TanStack Query** for server state
- **Socket.io** for real-time features

### Backend (NestJS)
- **TypeScript** with decorators
- **Prisma ORM** with PostgreSQL
- **Redis** for caching and sessions
- **Bull** for background jobs
- **Elasticsearch** for search
- **WebSocket** gateway for real-time

### Infrastructure
- **Docker** containerization
- **PostgreSQL** primary database
- **Redis** caching and pub/sub
- **Elasticsearch** search engine
- **Prometheus** + **Grafana** monitoring
- **MinIO** S3-compatible storage

## 🚀 Quick Start

### Prerequisites
- **Node.js 20+**
- **Docker & Docker Compose**
- **Git**

### 1. Clone and Install
```bash
git clone <repository-url>
cd prompt-engineering-platform
npm install
```

### 2. Environment Setup
```bash
# Copy environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Edit with your API keys
nano apps/api/.env
```

### 3. Start Infrastructure
```bash
# Start databases and services
cd infrastructure/docker
docker-compose up -d

# Wait for services to be ready (30 seconds)
```

### 4. Database Setup
```bash
# Generate Prisma client
cd apps/api
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed initial data
npx prisma db seed
```

### 5. Start Development
```bash
# Start both frontend and backend
npm run dev
```

Visit:
- **Web App**: http://localhost:3001
- **API**: http://localhost:3000
- **API Docs**: http://localhost:3000/api/docs
- **Grafana**: http://localhost:3030 (admin/admin)

## 📝 Environment Configuration

### Required API Keys
At least one LLM provider is required:

```env
# OpenAI (Recommended)
OPENAI_API_KEY=sk-...

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Google AI
GOOGLE_API_KEY=...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
```

### Security Configuration
```env
# Generate secure keys
JWT_SECRET=your-super-secure-jwt-secret-32-chars+
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-32-chars+
ENCRYPTION_KEY=64-character-hex-key-for-data-encryption
```

### Optional Services
```env
# Email (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Analytics (PostHog)
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

## 🗂️ Project Structure

```
prompt-engineering-platform/
├── apps/
│   ├── web/                    # Next.js frontend
│   ├── api/                    # NestJS backend
│   └── extension/              # Browser extension
├── packages/
│   ├── shared/                 # Shared types/utilities
│   ├── prompt-engine/          # Core prompt logic
│   ├── llm-client/            # LLM integrations
│   └── ui-kit/                # Shared UI components
├── infrastructure/
│   ├── docker/                # Docker configurations
│   └── scripts/               # Setup scripts
└── docs/                      # Documentation
```

## 🔒 Security Features

- **JWT Authentication** with refresh tokens
- **Rate Limiting** with Redis-based sliding window
- **Input Validation** with Zod schemas
- **SQL Injection** prevention with Prisma
- **XSS Protection** with sanitization
- **CSRF Protection** with secure headers
- **Data Encryption** for sensitive data
- **Audit Logging** for all actions

## 📊 Monitoring & Analytics

### Built-in Dashboards
- **User Analytics** - Registration, engagement, retention
- **Prompt Metrics** - Usage, improvement scores, model performance
- **System Health** - API response times, error rates, resource usage
- **Business Metrics** - Active users, revenue, feature adoption

### Alerting
- **Uptime Monitoring** with health checks
- **Error Rate Thresholds** with automatic alerts
- **Performance Degradation** detection
- **Security Incident** notifications

## 🧪 Testing

### Run Tests
```bash
# All tests
npm run test

# Coverage report
npm run test:coverage

# E2E tests
npm run test:e2e
```

### Test Coverage Targets
- **Unit Tests**: 80%+ coverage
- **Integration Tests**: All API endpoints
- **E2E Tests**: Critical user journeys

## 🚢 Deployment

### Production Build
```bash
# Build all applications
npm run build

# Run production containers
docker-compose -f docker-compose.prod.yml up -d
```

### Environment-Specific Configs
- **Development**: Hot reload, detailed logging
- **Staging**: Production-like with debug info
- **Production**: Optimized, minimal logging, security headers

## 📈 Performance

### Optimization Features
- **Next.js App Router** with streaming
- **Database Connection Pooling**
- **Redis Caching** for frequent queries
- **CDN Integration** for static assets
- **Image Optimization** with Next.js
- **Code Splitting** for faster loads

### Scaling Capabilities
- **Horizontal Scaling** with load balancers
- **Database Read Replicas** for high-traffic
- **Redis Clustering** for session management
- **Background Job Processing** with Bull
- **Microservice Architecture** ready

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Push** to branch (`git push origin feature/amazing-feature`)
5. **Open** Pull Request

### Development Guidelines
- **TypeScript** for all code
- **ESLint + Prettier** for formatting
- **Conventional Commits** for messages
- **Tests Required** for new features
- **Documentation** for public APIs

## 📄 API Documentation

Interactive API documentation available at `/api/docs` when running locally.

### Key Endpoints
```
POST /api/v1/auth/login          # User authentication
POST /api/v1/prompts/improve     # Improve prompts
POST /api/v1/prompts/execute     # Execute prompts
GET  /api/v1/templates           # Get templates
POST /api/v1/challenges/join     # Join challenges
```

## 🆘 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Security**: security@promptplatform.com

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with modern technologies and best practices:
- **Next.js** for the frontend framework
- **NestJS** for the backend architecture  
- **Prisma** for database management
- **Docker** for containerization
- **TypeScript** for type safety
- **Tailwind CSS** for styling

---

**Made with ❤️ for the AI community**