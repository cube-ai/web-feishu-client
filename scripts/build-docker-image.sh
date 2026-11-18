#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未找到 docker 命令" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：需要 Node.js 读取版本号" >&2
  exit 1
fi

NPM_REGISTRY="${NPM_REGISTRY:-$(npm config get registry 2>/dev/null || echo https://registry.npmjs.org/)}"
echo "准备编译产物..."
pnpm build
node scripts/package-release.mjs

IMAGE_NAME="${IMAGE_NAME:-web-feishu-client}"
VERSION="$(node -p "require('./package.json').version")"

docker build \
  --build-arg "APP_VERSION=$VERSION" \
  --build-arg "NPM_REGISTRY=$NPM_REGISTRY" \
  -t "$IMAGE_NAME:latest" \
  -f Dockerfile \
  .

echo
echo "镜像已生成："
echo "  $IMAGE_NAME:latest"
echo
echo "运行示例："
echo "  docker run --rm -p 8731:8731 -v web-feishu-data:/app/data --name web-feishu-client $IMAGE_NAME:latest"
