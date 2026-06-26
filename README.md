# Xray-Panel (Clash Subscription Controller)

这是一个极度轻量、基于 Node.js 与 React 构建的分布式代理集群中央控制面板。
本项目支持通过 JWT 身份认证，并通过 WebSocket（双 Token 验证机制）与分散在各地的 Xray-core 守护进程进行实时双向通信、配置热重载和状态回传。

## 功能特性

- **轻量级全栈架构**：React (Vite) 前端 + Express.js 后端。
- **动态用户热注入**：添加/踢出用户只需通过 Xray API 动态注入内存，无需重启 Xray 进程，实现流量零损耗。
- **分布式节点管控**：通过 WebSocket 实现 `Controller <-> Daemon` 的实时通信，自动配置并下发防火墙（UFW）策略。
- **智能化定时重启**：各节点支持自定义凌晨时间进行统一配置固化与彻底重启，清空内存泄漏。

## 主控端部署指南

为了方便不同基础的用户，我们提供了以下三种部署方式（推荐使用方式一）。无论哪种部署方式，系统均自带 **OTA 极速升级** 机制。首次安装后，未来的版本更新均可在面板网页上点击一键热更新完成！

### 方式一：官方极速一键部署脚本（首选推荐）

此脚本将直接拉取预编译好的 Release 生产包，生成纯净的轻量级 Docker 容器。**无需本地编译**，部署仅需 5~10 秒，完美支持 512MB 小内存机器。

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/acdc-awa/Clash-subscription/main/deploy-docker.sh)
```

> **注意：**
> 1. 脚本执行完毕后，可通过 `http://<您的VPS_IP>:3000` 访问后台。
> 2. 如果之前部署过老版本，该脚本会自动将您的老数据库 `data.db` 迁移到新环境！
> 3. 初次部署或忘记密码时，可进入容器执行命令重置管理员密码：`docker exec -it clash-panel node reset-admin.js`

### 方式二：Docker Compose 手动部署（适合进阶玩家）

如果你希望完全掌控目录结构或加入反向代理配置，可以手动配置。首先前往 GitHub Releases 下载并解压最新的 `clash-panel-release.tar.gz`。

```bash
# 假设你解压出的源码在当前目录的 app/ 文件夹下，且数据保存在 data/
# 在该目录下创建 docker-compose.yml 文件：

version: '3.8'
services:
  clash-panel:
    image: node:24-slim
    container_name: clash-panel
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./app/backend:/app/backend
      - ./data:/app/backend/data
    working_dir: /app/backend
    environment:
      - PORT=3000
      - DB_PATH=/app/backend/data/data.db
      - NODE_ENV=production
    command: sh -c "apt-get update && apt-get install -y curl tar python3 make g++ gcc && npm install --omit=dev && node server.js"

# 启动容器
docker compose up -d
```

### 方式三：纯 Docker 原生单条指令部署 (Docker Run)

如果不喜欢用 compose，也可以在下载解压了包之后，直接在包的**根目录**下运行单条 `docker run` 命令：

```bash
docker run -d \
  --name clash-panel \
  --restart always \
  -p 3000:3000 \
  -v $(pwd)/app/backend:/app/backend \
  -v $(pwd)/data:/app/backend/data \
  -w /app/backend \
  node:20-slim \
  sh -c "apt-get update && apt-get install -y curl tar python3 make g++ gcc && npm install --omit=dev && node server.js"
```

## 节点端一键部署

在主控端添加节点后，面板会生成节点独占的配置与密钥。在**节点服务器**上运行以下一键安装命令：

```bash
bash -c "$(curl -sS -L http://<您的主控端IP>:3000/install.sh)" @ --url ws://<您的主控端IP>:3000 --node <节点ID> --token <节点密钥>
```

> 节点安装完成后，会自动在系统内创建交互式控制面板。可以在节点服务器上直接敲击 `daemon-xray` 呼出管理菜单。

## 目录结构

- `/backend/`: Express.js 主控后端服务
- `/front/`: React 前端源码
- `deploy-docker.sh`: Docker 环境一键部署脚本
- `deploy.sh`: 传统环境热部署脚本

## 许可证

MIT License
