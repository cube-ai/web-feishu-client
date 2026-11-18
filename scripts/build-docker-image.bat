@echo off
setlocal
cd /d "%~dp0\.."

where docker >nul 2>nul
if errorlevel 1 (
  echo 错误：未找到 docker 命令
  exit /b 1
)

if "%NPM_REGISTRY%"=="" for /f "delims=" %%r in ('npm config get registry') do set "NPM_REGISTRY=%%r"
if "%NPM_REGISTRY%"=="" set "NPM_REGISTRY=https://registry.npmjs.org/"

call pnpm build
if errorlevel 1 exit /b 1
call node scripts/package-release.mjs
if errorlevel 1 exit /b 1

if "%IMAGE_NAME%"=="" set "IMAGE_NAME=web-feishu-client"
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"
if "%VERSION%"=="" (
  echo 错误：需要 Node.js 读取版本号
  exit /b 1
)

docker build --build-arg "APP_VERSION=%VERSION%" --build-arg "NPM_REGISTRY=%NPM_REGISTRY%" -t "%IMAGE_NAME%:latest" -f Dockerfile .
if errorlevel 1 exit /b 1

echo.
echo 镜像已生成：
echo   %IMAGE_NAME%:latest
echo.
echo 运行示例：
echo   docker run --rm -p 8731:8731 -v web-feishu-data:/app/data --name web-feishu-client %IMAGE_NAME%:latest
