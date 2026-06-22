#!/bin/bash
set -e

REPO_SSH="git@github.com:acdc-awa/Clash-subscription.git"
REPO_HTTPS="https://github.com/acdc-awa/Clash-subscription.git"

echo "================================================="
echo "  Clash Subscription VPS Backend Deployer (Root) "
echo "================================================="
echo "说明: 本脚本将把 backend 文件夹下的【内容】直接拉取并释放到【当前所在目录】。"
echo "-------------------------------------------------"

# Attempt 1: Git clone (SSH first, then HTTPS)
if command -v git &> /dev/null; then
    echo "[1/2] 检测到系统已安装 Git，尝试通过 Git 克隆..."
    
    # Try SSH
    if git clone --depth 1 "$REPO_SSH" temp_repo_ssh &> /dev/null; then
        echo "正在将 backend 内容释放到当前目录..."
        # 复制所有内容（包含隐藏文件，如 .env / .gitignore）到当前目录
        cp -r temp_repo_ssh/backend/. ./
        rm -rf temp_repo_ssh
        echo "✅ 成功使用 SSH 拉取并释放 backend 内容！"
        exit 0
    fi

    # Try HTTPS (in case SSH is not authorized on this server)
    if git clone --depth 1 "$REPO_HTTPS" temp_repo_https &> /dev/null; then
        echo "正在将 backend 内容释放到当前目录..."
        cp -r temp_repo_https/backend/. ./
        rm -rf temp_repo_https
        echo "✅ 成功使用 HTTPS 拉取并释放 backend 内容！"
        exit 0
    fi
fi

# Attempt 2: Curl Zip file (for environment without git or SSH setup)
echo "[2/2] Git 克隆失败或未安装 Git，尝试通过 curl 下载 Zip 归档..."
curl -L -o temp_repo.zip https://github.com/acdc-awa/Clash-subscription/archive/refs/heads/main.zip

if [ -f temp_repo.zip ]; then
    if ! command -v unzip &> /dev/null; then
        echo "❌ 错误: 解压 zip 需要安装 'unzip' 工具。请先运行: apt-get install unzip 或 yum install unzip"
        rm -f temp_repo.zip
        exit 1
    fi

    echo "正在解压并释放 backend 内容到当前目录..."
    unzip -q temp_repo.zip "Clash-subscription-main/backend/*"
    cp -r Clash-subscription-main/backend/. ./
    rm -rf Clash-subscription-main temp_repo.zip
    echo "✅ 成功使用 curl/Zip 拉取并释放 backend 内容！"
    exit 0
else
    echo "❌ 错误: 无法下载 Zip 归档。请检查你的网络连接以及仓库是否为私有仓库。"
    exit 1
fi
