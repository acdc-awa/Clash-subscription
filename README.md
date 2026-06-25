# Xray-Panel (Clash Subscription Controller)

这是一个极度轻量、基于 Node.js 与 React 构建的分布式代理集群中央控制面板。
本项目支持通过 JWT 身份认证，并通过 WebSocket（双 Token 验证机制）与分散在各地的 Xray-core 守护进程进行实时双向通信、配置热重载和状态回传。

## 功能特性

- **轻量级全栈架构**：React (Vite) 前端 + Express.js 后端。
- **动态用户热注入**：添加/踢出用户只需通过 Xray API 动态注入内存，无需重启 Xray 进程，实现流量零损耗。
- **分布式节点管控**：通过 WebSocket 实现 `Controller <-> Daemon` 的实时通信，自动配置并下发防火墙（UFW）策略。
- **智能化定时重启**：各节点支持自定义凌晨时间进行统一配置固化与彻底重启，清空内存泄漏。

## 主控端一键部署 (Docker)

在你的主控端（必须安装 Docker 和 Docker Compose）运行以下一键部署脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/acdc-awa/Clash-subscription/main/deploy-docker.sh -o deploy.sh && bash deploy.sh
```

> **注意：**
> 1. 主控端会自动拉取代码，并在后台构建 Docker 镜像并映射 3000 端口。
> 2. 部署完成后，可通过 `http://<您的VPS_IP>:3000` 访问后台。
> 3. 初次部署或忘记密码时，可进入容器执行命令重置管理员密码：`docker exec -it clash-sub-backend node reset-admin.js`

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
