#!/bin/bash
set -e

echo "================================================="
echo "  Clash Subscription Panel 极速安装脚本         "
echo "================================================="

DIR_NAME="clash-panel"

# 1. 检查 Docker 环境
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未检测到 Docker，请先安装 Docker 后重试。"
    echo "你可以运行以下命令快速安装 Docker:"
    echo "curl -fsSL https://get.docker.com | bash"
    exit 1
fi

# 2. 获取最新 Release 下载链接
echo "正在获取最新发版信息..."
DOWNLOAD_URL=$(curl -sL https://api.github.com/repos/acdc-awa/Clash-subscription/releases/latest | grep "browser_download_url" | grep "clash-panel-release.tar.gz" | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ 错误: 无法获取最新版本下载链接。请确保 GitHub 仓库存在 Release 发布。"
    exit 1
fi

echo "下载最新发行包: $DOWNLOAD_URL"
mkdir -p "$DIR_NAME"
cd "$DIR_NAME"

curl -sL "$DOWNLOAD_URL" -o release.tar.gz

echo "解压发行包..."
tar -xzf release.tar.gz
rm release.tar.gz

echo "配置数据目录与环境..."
mkdir -p data
touch .env

# 3. 数据迁移逻辑（兼容老版本）
if [ -f "../Clash-subscription/backend/data/data.db" ]; then
    echo "检测到老版本数据 (Clash-subscription/backend/data/data.db)，正在自动迁移..."
    cp "../Clash-subscription/backend/data/data.db" "./data/data.db"
    echo "数据迁移成功！"
elif [ -f "../Clash-subscription/data/data.db" ]; then
    echo "检测到老版本数据 (Clash-subscription/data/data.db)，正在自动迁移..."
    cp "../Clash-subscription/data/data.db" "./data/data.db"
    echo "数据迁移成功！"
fi

# 4. 生成容器配置
cat << 'INNER_EOF' > Dockerfile
FROM node:24-slim
RUN apt-get update && apt-get install -y curl tar python3 make g++ gcc && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
CMD ["sh", "-c", "npm install --omit=dev && node server.js"]
INNER_EOF

cat << 'INNER_EOF' > docker-compose.yml
version: '3.8'
services:
  clash-panel:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: clash-panel
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./app/backend:/app/backend
      - ./data:/app/backend/data
      - ./.env:/app/backend/.env
    working_dir: /app/backend
    environment:
      - PORT=3000
      - DB_PATH=/app/backend/data/data.db
      - NODE_ENV=production
      - TZ=Asia/Shanghai
INNER_EOF

# 5. 启动服务
echo "正在启动面板..."
docker compose up -d --build

echo "================================================="
echo "✅ 主控端极速部署成功！"
echo "主控服务已在后台运行，端口为 3000"
echo "你现在可以通过 http://<VPS_IP>:3000 访问控制面板"
echo "未来可在面板【数据维护】页直接一键 OTA 升级！"
echo "================================================="
