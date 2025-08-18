# 🚀 Prompt Engineering Platform - Launch Instructions

## Prerequisites

### System Requirements
- **Node.js 18+** (required)
- **Docker & Docker Compose** (for PostgreSQL and Redis)
- **Git** (for version control)
- **OpenSSL** (for generating secure keys)

### Required API Keys
You **MUST** have at least ONE of these AI provider API keys:
- OpenAI API Key (recommended) - Get from: https://platform.openai.com/api-keys
- Anthropic API Key - Get from: https://console.anthropic.com/
- Google AI API Key - Get from: https://makersuite.google.com/

## Quick Start

### 1. Clone and Setup
```bash
git clone https://github.com/kleinwizard/prompt-engineering-platform.git
cd prompt-engineering-platform
./setup.sh
```

### 2. Generate Secure Keys
```bash
# Generate secure keys and update your .env file:
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)" 
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

### 3. Configure Environment
Edit `apps/api/.env` and add your API keys:
```env
# Add at least ONE of these:
OPENAI_API_KEY="your-openai-api-key-here"
ANTHROPIC_API_KEY="your-anthropic-api-key-here"
GOOGLE_AI_API_KEY="your-google-ai-api-key-here"

# Update the generated secure keys:
JWT_SECRET="your-generated-jwt-secret"
JWT_REFRESH_SECRET="your-generated-refresh-secret"
ENCRYPTION_KEY="your-generated-encryption-key"
```

### 4. Launch Platform
```bash
./scripts/start-production.sh
```

## Access Points

Once running, you can access:

- **📱 Web Application**: http://localhost:3001
- **🔌 API Server**: http://localhost:3000  
- **📚 API Documentation**: http://localhost:3000/api/docs
- **🔍 Health Check**: http://localhost:3000/health

## Default Login

**Admin Account:**
- Email: `admin@prompt-platform.com`
- Password: `admin123`

⚠️ **Change this password immediately in production!**

## Success Verification

Verify the platform is working by checking:

1. ✅ Health endpoint returns 200: `curl http://localhost:3000/health`
2. ✅ Web app loads at: http://localhost:3001
3. ✅ API docs available at: http://localhost:3000/api/docs
4. ✅ Can login with admin credentials
5. ✅ Can create a new prompt

## Email Configuration (Optional)

For user registration and notifications, configure email in `apps/api/.env`:

```env
# Gmail example:
EMAIL_PROVIDER="smtp"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-specific-password"
```

## Production Deployment

### Environment Variables to Change
```env
NODE_ENV="production"
APP_URL="https://your-domain.com"
API_URL="https://api.your-domain.com"
CORS_ORIGIN="https://your-domain.com"
```

### Security Checklist
- [ ] Change admin password
- [ ] Generate new secure keys
- [ ] Configure proper CORS origins
- [ ] Set up SSL certificates
- [ ] Configure email provider
- [ ] Set up proper backup strategy
- [ ] Configure monitoring and logging

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Kill processes on ports
npx kill-port 3000 3001
# Or change ports in .env files
```

**Docker services not starting:**
```bash
# Restart Docker services
docker-compose down
docker-compose up -d
```

**Database connection errors:**
```bash
# Check PostgreSQL is running
docker ps | grep postgres
# Check connection
docker exec -it $(docker ps -qf "name=postgres") psql -U postgres -d prompt_platform
```

**Missing API keys:**
- Add at least one AI provider API key to `apps/api/.env`
- Restart the API server after adding keys

### Logs and Debugging

**API Server Logs:**
```bash
cd apps/api
npm run start:dev  # Development mode with detailed logs
```

**Database Logs:**
```bash
docker logs $(docker ps -qf "name=postgres")
```

**Redis Logs:**
```bash
docker logs $(docker ps -qf "name=redis")
```

## Support

For issues:
1. Check this troubleshooting section
2. Review the logs for error messages
3. Verify all environment variables are set correctly
4. Ensure all required services are running

## Features Included

✅ **Complete Enterprise Platform:**
- AI Coach Personality System (5 distinct coaches)
- Prompt Certification System (5-level certification)
- Visual Prompt Builder (drag-and-drop interface)
- Prompt DNA System (genetic analysis)
- Prompt Git Version Control (branching/merging)
- Prompt Marketplace (commerce features)
- Enterprise SSO Integration (SAML, OIDC, LDAP)
- Audit Logging & Compliance (GDPR, HIPAA, SOX, ISO27001)
- Data Residency & Multi-Region Support
- Performance Monitoring Dashboard
- Prompt Security Scanner
- Custom Model Integration & Management

✅ **Production Ready:**
- No mocking or simulations
- Comprehensive error handling
- Enterprise-grade security
- Real-time collaboration
- Multi-LLM support
- Docker containerization
- TypeScript throughout
- Complete API documentation

🎉 **The platform is now ready for launch!**