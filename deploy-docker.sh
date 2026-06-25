#!/bin/bash
set -e

echo "================================================="
echo "  Clash Subscription VPS Docker Deployer         "
echo "================================================="

REPO_URL="https://github.com/acdc-awa/Clash-subscription.git"
DIR_NAME="Clash-subscription"

# 1. Clone repository
if [ -d "$DIR_NAME" ]; then
    echo "发现已存在的目录 $DIR_NAME，正在更新代码..."
    cd "$DIR_NAME"
    git fetch --all
    git reset --hard origin/main
else
    echo "正在克隆中控端仓库..."
    git clone --depth 1 "$REPO_URL" "$DIR_NAME"
    cd "$DIR_NAME"
fi

# 2. Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未检测到 Docker，请先安装 Docker 后重试。"
    echo "你可以运行以下命令快速安装 Docker:"
    echo "curl -fsSL https://get.docker.com | bash"
    exit 1
fi

# 3. Build & Run
echo "正在使用 Docker Compose 构建并启动主控服务..."
cd backend
touch .env
docker compose up -d --build

echo "================================================="
echo "✅ 主控端部署成功！"
echo "主控服务已在后台运行，端口为 3000"
echo "你现在可以通过 http://<VPS_IP>:3000 访问控制面板"
echo "================================================="
