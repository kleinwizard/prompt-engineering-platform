@echo off
echo ========================================
echo PROMPT ENGINEERING PLATFORM - AUTO LAUNCH
echo ========================================
echo.

REM Check Node.js version
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

REM Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed!
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo [1/8] Installing dependencies...
call npm install --silent

echo [2/8] Installing package dependencies...
cd packages\shared && call npm install --silent && cd ..\..
cd packages\prompt-engine && call npm install --silent && cd ..\..
cd packages\llm-client && call npm install --silent && cd ..\..

echo [3/8] Generating secure keys...
REM Generate random keys using Node.js
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" > temp_keys.txt
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" >> temp_keys.txt
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> temp_keys.txt

echo [4/8] Updating environment configuration...
REM Read generated keys and update .env
for /f "tokens=1,2 delims==" %%a in (temp_keys.txt) do (
    echo %%a=%%b
)

echo.
echo ========================================
echo SECURE KEYS GENERATED (Save these!):
echo ========================================
type temp_keys.txt
echo ========================================
echo.

REM Update the .env file with generated keys
powershell -Command "(Get-Content apps\api\.env) -replace 'JWT_SECRET=\".*\"', (Get-Content temp_keys.txt | Select-String 'JWT_SECRET').Line | Set-Content apps\api\.env"
powershell -Command "(Get-Content apps\api\.env) -replace 'JWT_REFRESH_SECRET=\".*\"', (Get-Content temp_keys.txt | Select-String 'JWT_REFRESH_SECRET').Line | Set-Content apps\api\.env"
powershell -Command "(Get-Content apps\api\.env) -replace 'ENCRYPTION_KEY=\".*\"', (Get-Content temp_keys.txt | Select-String 'ENCRYPTION_KEY').Line | Set-Content apps\api\.env"

del temp_keys.txt

echo [5/8] Starting Docker services...
docker-compose up -d

echo [6/8] Waiting for services to start...
timeout /t 10 /nobreak >nul

echo [7/8] Setting up database...
cd apps\api
call npx prisma generate
call npx prisma migrate deploy
call npx prisma db seed
cd ..\..

echo [8/8] Building applications...
call npm run build

echo.
echo ========================================
echo PLATFORM READY TO START!
echo ========================================
echo.
echo Starting services...
echo.

REM Start API server
start "API Server" cmd /k "cd apps\api && npm run start:prod"

REM Wait a moment for API to start
timeout /t 5 /nobreak >nul

REM Start Web application
start "Web Application" cmd /k "cd apps\web && npm run start"

echo.
echo ========================================
echo PLATFORM IS STARTING!
echo ========================================
echo.
echo Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo.
echo ========================================
echo LAUNCH COMPLETE!
echo ========================================
echo.
echo Platform Access Points:
echo - Web App: http://localhost:3001
echo - API: http://localhost:3000
echo - API Docs: http://localhost:3000/api/docs
echo - Health: http://localhost:3000/health
echo.
echo Default Admin Login:
echo - Email: admin@prompt-platform.com
echo - Password: admin123
echo.
echo ========================================
echo IMPORTANT: You still need to add an AI API key!
echo ========================================
echo.
echo Press any key to open the web app...
pause >nul
start http://localhost:3001