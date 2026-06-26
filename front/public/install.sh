#!/bin/bash
# =========================================================================
#  Xray Daemon Agent One-Key Installer (Root Required)
# =========================================================================

set -e

# Make sure we run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Error: Please run this script as root (sudo)."
  exit 1
fi

# Usage Help
usage() {
  echo "Usage: $0 --url <wss_or_ws_controller_url> --node <node_id> --token <node_token>"
  echo "Example: $0 --url wss://controller.example.com --node SG-01 --token 5f8c6e2d9b..."
  exit 1
}

# Parse Arguments
CONTROLLER_URL=""
NODE_ID=""
NODE_SECRET=""

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --url) CONTROLLER_URL="$2"; shift ;;
    --node) NODE_ID="$2"; shift ;;
    --token) NODE_SECRET="$2"; shift ;;
    *) echo "[-] Unknown parameter: $1"; usage ;;
  esac
  shift
done

if [ -z "$CONTROLLER_URL" ] || [ -z "$NODE_ID" ] || [ -z "$NODE_SECRET" ]; then
  echo "[-] Error: Missing required arguments."
  usage
fi

echo "========================================================="
echo " Starting Xray Daemon Agent Setup on Node: $NODE_ID"
echo "========================================================="

# 0. Check for existing installation (Fast Update)
if [ -d "/etc/xray-daemon" ] && systemctl list-unit-files | grep -q "xray-daemon.service"; then
  echo "[+] Detected existing installation."
  echo "[+] Performing FAST UPDATE (replacing daemon.js and restarting)..."
  
  HTTP_URL=$(echo "$CONTROLLER_URL" | sed 's/wss:\/\//https:\/\//g' | sed 's/ws:\/\//http:\/\//g')
  
  systemctl stop xray-daemon 2>/dev/null || true
  curl -sS -L -o /etc/xray-daemon/daemon.js "$HTTP_URL/daemon.js"
  curl -sS -L -o /etc/xray-daemon/xray.proto "$HTTP_URL/xray.proto"
  
  # Update environment variables
  cat <<EOF > /etc/xray-daemon/config.env
CONTROLLER_URL=$CONTROLLER_URL
NODE_ID=$NODE_ID
NODE_SECRET=$NODE_SECRET
EOF
  chmod 600 /etc/xray-daemon/config.env
  
  systemctl start xray-daemon
  echo "========================================================="
  echo " Update Completed Successfully!"
  echo " Daemon is restarted with the new version."
  echo "========================================================="
  exit 0
fi

# 1. Update package list and install basic dependencies
echo "[1/7] Checking basic dependencies (curl, unzip, fail2ban, ufw, xz-utils)..."
MISSING_PKGS=""
if ! command -v curl &> /dev/null; then MISSING_PKGS="$MISSING_PKGS curl"; fi
if ! command -v unzip &> /dev/null; then MISSING_PKGS="$MISSING_PKGS unzip"; fi
if ! command -v fail2ban-server &> /dev/null; then MISSING_PKGS="$MISSING_PKGS fail2ban"; fi
if ! command -v ufw &> /dev/null; then MISSING_PKGS="$MISSING_PKGS ufw"; fi
if ! command -v xz &> /dev/null; then MISSING_PKGS="$MISSING_PKGS xz-utils"; fi

if [ -n "$MISSING_PKGS" ]; then
  echo "[+] Missing packages: $MISSING_PKGS. Installing now..."
  if command -v apt-get &> /dev/null; then
    apt-get update -y
    apt-get install -y $MISSING_PKGS
  elif command -v yum &> /dev/null; then
    yum install -y $MISSING_PKGS
  else
    echo "[-] Warning: Unsupported package manager. Make sure these are installed manually: $MISSING_PKGS"
  fi
else
  echo "[+] All basic dependencies are already installed. Skipping package update."
fi

# Start and enable fail2ban
if systemctl list-unit-files | grep -q "fail2ban.service"; then
  echo "[+] Enabling and starting fail2ban service..."
  systemctl enable fail2ban
  systemctl restart fail2ban
fi

# 2. Install Xray-core if not present
echo "[2/7] Checking Xray-core installation..."
if [ ! -f "/usr/local/bin/xray" ]; then
  echo "[+] Installing Xray-core via official script..."
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
else
  echo "[+] Xray-core is already installed at /usr/local/bin/xray"
fi
systemctl enable xray

# 3. Install Node.js if not present
echo "[3/7] Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  ARCH=$(uname -m)
  NODE_VER="v20.12.2"
  echo "[+] Downloading precompiled Node.js $NODE_VER for $ARCH..."
  
  if [ "$ARCH" = "x86_64" ]; then
    NODE_URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
    TAR_DIR="node-$NODE_VER-linux-x64"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    NODE_URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-arm64.tar.xz"
    TAR_DIR="node-$NODE_VER-linux-arm64"
  else
    echo "[-] Error: Unsupported architecture $ARCH. Please install Node.js manually."
    exit 1
  fi

  curl -L -o /tmp/node.tar.xz "$NODE_URL"
  tar -xf /tmp/node.tar.xz -C /tmp
  
  echo "[+] Merging Node.js files into /usr/local..."
  cp -r /tmp/$TAR_DIR/{bin,include,lib,share} /usr/local/ 2>/dev/null || true
  rm -rf /tmp/node.tar.xz /tmp/$TAR_DIR
else
  echo "[+] Node.js is already installed: $(node -v)"
fi

# 4. Create directory structure and package.json
echo "[4/7] Setting up daemon directory /etc/xray-daemon..."
mkdir -p /etc/xray-daemon

cat <<EOF > /etc/xray-daemon/package.json
{
  "name": "xray-daemon",
  "version": "1.0.0",
  "main": "daemon.js",
  "dependencies": {
    "ws": "^8.16.0",
    "@grpc/grpc-js": "^1.10.6",
    "@grpc/proto-loader": "^0.7.12"
  }
}
EOF

# 5. Install Daemon Dependencies
echo "[5/7] Installing daemon node modules (this may take a few seconds)..."
cd /etc/xray-daemon
/usr/local/bin/npm install --no-audit --no-fund

# 6. Fetch Daemon Files from Controller
echo "[6/7] Fetching daemon files from controller..."
HTTP_URL=$(echo "$CONTROLLER_URL" | sed 's/wss:\/\//https:\/\//g' | sed 's/ws:\/\//http:\/\//g')

curl -sS -L -o /etc/xray-daemon/daemon.js "$HTTP_URL/daemon.js"
curl -sS -L -o /etc/xray-daemon/xray.proto "$HTTP_URL/xray.proto"

# Create environment configuration file
cat <<EOF > /etc/xray-daemon/config.env
CONTROLLER_URL=$CONTROLLER_URL
NODE_ID=$NODE_ID
NODE_SECRET=$NODE_SECRET
EOF

chmod 600 /etc/xray-daemon/config.env

# 7. Create Systemd Service
echo "[7/7] Creating systemd service xray-daemon.service..."
cat <<EOF > /etc/systemd/system/xray-daemon.service
[Unit]
Description=Xray Daemon Agent
After=network.target xray.service

[Service]
Type=simple
User=root
WorkingDirectory=/etc/xray-daemon
EnvironmentFile=/etc/xray-daemon/config.env
ExecStart=/usr/local/bin/node /etc/xray-daemon/daemon.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable UFW if not enabled, and allow SSH to prevent lock out
if command -v ufw &> /dev/null; then
  echo "[+] Configuring UFW defaults..."
  # Try to detect active SSH port dynamically, fallback to 22
  ssh_port="22"
  if command -v ss &> /dev/null; then
    ssh_port=$(ss -tlnp 2>/dev/null | grep -i sshd | grep -oE ':[0-9]+' | grep -oE '[0-9]+' | head -n1 || echo "22")
  elif command -v netstat &> /dev/null; then
    ssh_port=$(netstat -tlnp 2>/dev/null | grep -i sshd | grep -oE ':[0-9]+' | grep -oE '[0-9]+' | head -n1 || echo "22")
  fi
  echo "[+] Allowing detected SSH port: $ssh_port/tcp"
  ufw allow "$ssh_port"/tcp comment 'SSH' || true
  ufw --force enable || true
fi

# Reload systemd, enable and start service
echo "[+] Starting xray-daemon service..."
systemctl daemon-reload
systemctl enable xray-daemon
systemctl restart xray-daemon

# 8. Create Management Script (daemon.sh)
echo "[8/8] Creating management script /etc/xray-daemon/daemon.sh..."
cat <<'EOF' > /etc/xray-daemon/daemon.sh
#!/bin/bash

function show_menu() {
    clear
    echo "========================================================="
    echo "             Xray Daemon 节点管理控制台"
    echo "========================================================="
    echo "  1. 查看运行状态 (Status)"
    echo "  2. 启动服务 (Start)"
    echo "  3. 停止服务 (Stop)"
    echo "  4. 重启服务 (Restart)"
    echo "  5. 完全卸载节点及代理面板 (Uninstall)"
    echo "  0. 退出菜单 (Exit)"
    echo "========================================================="
    read -p "请输入序号 [0-5]: " choice

    case $choice in
        1)
            systemctl status xray-daemon --no-pager
            echo ""
            systemctl status xray --no-pager
            read -p "按回车键继续..."
            show_menu
            ;;
        2)
            echo "启动 Xray 及其守护进程..."
            systemctl start xray
            systemctl start xray-daemon
            echo "已启动。"
            read -p "按回车键继续..."
            show_menu
            ;;
        3)
            echo "停止 Xray 及其守护进程..."
            systemctl stop xray-daemon
            systemctl stop xray
            echo "已停止。所有连接已断开。"
            read -p "按回车键继续..."
            show_menu
            ;;
        4)
            echo "重启 Xray 及其守护进程..."
            systemctl restart xray
            systemctl restart xray-daemon
            echo "已重启。新的配置和状态已经同步。"
            read -p "按回车键继续..."
            show_menu
            ;;
        5)
            echo "警告: 这将彻底清除本节点上的 Daemon 守护进程和 Xray 服务！"
            read -p "确认卸载? [y/N]: " confirm
            if [[ "$confirm" =~ ^[Yy]$ ]]; then
                echo "正在卸载..."
                systemctl stop xray-daemon
                systemctl disable xray-daemon
                rm -f /etc/systemd/system/xray-daemon.service
                systemctl daemon-reload
                rm -rf /etc/xray-daemon
                rm -f /usr/local/bin/daemon-xray
                bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ remove --purge
                echo "卸载彻底完成！该节点已与中控解除绑定并清理本地依赖。"
                exit 0
            else
                echo "取消卸载。"
                sleep 1
                show_menu
            fi
            ;;
        0)
            exit 0
            ;;
        *)
            echo "无效的输入，请重新选择！"
            sleep 2
            show_menu
            ;;
    esac
}

# If arguments are passed, use CLI mode, otherwise show interactive menu
if [ -n "$1" ]; then
    case "$1" in
        stop) systemctl stop xray-daemon; systemctl stop xray ;;
        start) systemctl start xray; systemctl start xray-daemon ;;
        restart) systemctl restart xray; systemctl restart xray-daemon ;;
        status) systemctl status xray-daemon --no-pager; systemctl status xray --no-pager ;;
        uninstall)
            systemctl stop xray-daemon; systemctl disable xray-daemon
            rm -f /etc/systemd/system/xray-daemon.service; systemctl daemon-reload
            rm -rf /etc/xray-daemon
            rm -f /usr/local/bin/daemon-xray
            bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ remove --purge
            ;;
        *) echo "Usage: $0 {start|stop|restart|status|uninstall} (or run without arguments for menu)" ;;
    esac
else
    show_menu
fi
EOF
chmod +x /etc/xray-daemon/daemon.sh
ln -sf /etc/xray-daemon/daemon.sh /usr/local/bin/daemon-xray

echo "========================================================="
echo " Xray Daemon Setup Completed Successfully!"
echo " Daemon service is now running in the background."
echo " Check status using: systemctl status xray-daemon"
echo "========================================================="
