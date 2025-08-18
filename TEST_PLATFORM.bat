@echo off
echo ========================================
echo PLATFORM HEALTH CHECK
echo ========================================
echo.

echo Checking Docker services...
docker ps | findstr prompt
echo.

echo Testing database connection...
docker exec prompt-engineering-platform-postgres-1 psql -U postgres -d prompt_platform -c "SELECT COUNT(*) FROM users;"
echo.

echo Testing Redis connection...
docker exec prompt-engineering-platform-redis-1 redis-cli ping
echo.

echo ========================================
echo READY TO START SERVICES
echo ========================================
echo.
echo To start the platform:
echo 1. API Server: cd apps\api ^&^& npm run start:dev
echo 2. Web App: cd apps\web ^&^& npm run dev
echo.
pause