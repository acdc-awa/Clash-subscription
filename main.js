// ============================================================
// Cloudflare Worker — Clash 订阅管理系统 (反向代理版)
// 功能：WebUI 静态托管 + API & 订阅请求反向代理
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // WebUI 入口
    if (path === "/admin" || path === "/admin/") {
      return serveWebUI();
    }

    // 后端 VPS 服务配置
    const vpsUrl = env.VPS_BACKEND_URL; // 例如 "https://subdomain.domain"
    const proxySecret = env.PROXY_SECRET; // 与 VPS 约定的验证密钥

    if (!vpsUrl) {
      return new Response("Configuration Error: VPS_BACKEND_URL is not defined in Worker environment.", { status: 500 });
    }

    // 区分 API 请求与订阅请求
    const isApi = path.startsWith("/api/");
    const uuid = path.slice(1);
    const isValidUuid = uuid && !uuid.includes("/") && uuid !== "favicon.ico";

    if (isApi || isValidUuid) {
      const targetUrl = `${vpsUrl}${path}${url.search}`;
      
      // 复制并构造 Header，注入 X-Proxy-Secret
      const headers = new Headers(request.headers);
      if (proxySecret) {
        headers.set("X-Proxy-Secret", proxySecret);
      }

      try {
        const vpsResponse = await fetch(targetUrl, {
          method: request.method,
          headers: headers,
          body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
          redirect: "manual"
        });

        // 构造返回给客户端的 Headers
        const clientHeaders = new Headers(vpsResponse.headers);
        if (isApi) {
          // 确保 WebUI 跨域或者本源调用能顺利接收数据
          clientHeaders.set("Access-Control-Allow-Origin", "*");
          clientHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
          clientHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }

        return new Response(vpsResponse.body, {
          status: vpsResponse.status,
          statusText: vpsResponse.statusText,
          headers: clientHeaders
        });
      } catch (err) {
        return new Response(`Bad Gateway: Failed to connect to VPS. Error: ${err.message}`, { status: 502 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

// ============================================================
// WebUI — 内嵌 HTML 页面
// ============================================================
function serveWebUI() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clash 订阅管理面板</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
/* ====== Reset & Base ====== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #06060f;
  color: #e2e8f0;
  min-height: 100vh;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: radial-gradient(ellipse at 20% 50%, rgba(88, 60, 180, 0.12) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 20%, rgba(60, 100, 200, 0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 80%, rgba(120, 40, 160, 0.06) 0%, transparent 50%);
  z-index: 0;
  pointer-events: none;
}

/* ====== Variables ====== */
:root {
  --bg-card: rgba(255,255,255,0.04);
  --bg-card-hover: rgba(255,255,255,0.07);
  --border-color: rgba(255,255,255,0.08);
  --border-focus: rgba(120,100,255,0.5);
  --text-primary: #e2e8f0;
  --text-secondary: #8892a8;
  --text-dim: #555e70;
  --accent: #7c6cf0;
  --accent-hover: #9180ff;
  --success: #34d399;
  --success-bg: rgba(52,211,153,0.12);
  --warning: #fbbf24;
  --warning-bg: rgba(251,191,36,0.12);
  --danger: #f87171;
  --danger-bg: rgba(248,113,113,0.12);
  --info: #60a5fa;
  --radius: 12px;
  --radius-sm: 8px;
  --radius-lg: 16px;
  --shadow: 0 8px 32px rgba(0,0,0,0.3);
  --transition: 0.2s cubic-bezier(0.4,0,0.2,1);
}

/* ====== Utility ====== */
.hidden { display: none !important; }
.flex { display: flex; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.w-full { width: 100%; }
.relative { position: relative; }
.z-10 { position: relative; z-index: 10; }

/* ====== Glass Card ====== */
.glass {
  background: var(--bg-card);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}

/* ====== Buttons ====== */
button, .btn {
  font-family: inherit;
  cursor: pointer;
  border: none;
  outline: none;
  font-weight: 500;
  transition: all var(--transition);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  letter-spacing: 0.01em;
}
.btn-primary {
  background: linear-gradient(135deg, #7c6cf0, #6366f1);
  color: #fff;
  box-shadow: 0 2px 12px rgba(124,108,240,0.25);
}
.btn-primary:hover { background: linear-gradient(135deg, #9180ff, #818cf8); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(124,108,240,0.35); }
.btn-success {
  background: linear-gradient(135deg, #34d399, #10b981);
  color: #fff;
  box-shadow: 0 2px 12px rgba(52,211,153,0.2);
}
.btn-success:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(52,211,153,0.3); }
.btn-danger {
  background: rgba(248,113,113,0.15);
  color: var(--danger);
  border: 1px solid rgba(248,113,113,0.2);
}
.btn-danger:hover { background: rgba(248,113,113,0.25); }
.btn-ghost {
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
.btn-ghost:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }
.btn-sm { padding: 0.35rem 0.7rem; font-size: 0.78rem; }
.btn-icon {
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.05);
  color: var(--text-secondary);
  border: 1px solid transparent;
  font-size: 1rem;
}
.btn-icon:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }
.btn-icon.danger:hover { background: var(--danger-bg); color: var(--danger); }
.btn:disabled, .btn-icon:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }

/* ====== Inputs ====== */
input[type="text"], input[type="number"], input[type="password"], select, textarea {
  font-family: inherit;
  width: 100%;
  padding: 0.55rem 0.8rem;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.85rem;
  transition: border-color var(--transition);
  outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--border-focus); }
textarea { resize: vertical; font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace; line-height: 1.6; }
select { cursor: pointer; }
label { font-size: 0.8rem; color: var(--text-secondary); font-weight: 500; margin-bottom: 0.2rem; display: block; }

/* ====== Checkbox ====== */
.checkbox-item {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm); cursor: pointer; transition: background var(--transition);
  font-size: 0.84rem;
}
.checkbox-item:hover { background: rgba(255,255,255,0.05); }
.checkbox-item input[type="checkbox"] {
  width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer;
}

/* ====== Login Screen ====== */
#login-screen {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 1.5rem;
}
.login-card {
  width: 100%; max-width: 380px; padding: 2.5rem;
  text-align: center;
  animation: fadeInUp 0.5s ease-out;
}
.login-logo {
  width: 56px; height: 56px;
  background: linear-gradient(135deg, #7c6cf0, #6366f1);
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem;
  margin: 0 auto 1.2rem;
  box-shadow: 0 4px 24px rgba(124,108,240,0.3);
}
.login-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.3rem; }
.login-subtitle { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.8rem; }
.login-card .form-group { text-align: left; margin-bottom: 1.2rem; }
.login-card .btn { width: 100%; justify-content: center; padding: 0.65rem; font-size: 0.9rem; margin-top: 0.5rem; }
.login-error { color: var(--danger); font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }

/* ====== App Layout ====== */
#app-screen { display: none; min-height: 100vh; }
.app-header {
  padding: 0.8rem 1.5rem;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  background: rgba(6,6,15,0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  position: sticky; top: 0; z-index: 100;
}
.app-brand { display: flex; align-items: center; gap: 0.6rem; }
.app-brand-icon {
  width: 32px; height: 32px;
  background: linear-gradient(135deg, #7c6cf0, #6366f1);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.95rem;
}
.app-brand-text { font-weight: 600; font-size: 0.95rem; }
.app-nav { display: flex; gap: 0.25rem; }
.nav-btn {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.84rem;
  font-weight: 500;
  border: 1px solid transparent;
  display: flex; align-items: center; gap: 0.4rem;
}
.nav-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
.nav-btn.active { color: var(--accent); background: rgba(124,108,240,0.1); border-color: rgba(124,108,240,0.2); }
.app-content { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }

/* ====== Toolbar ====== */
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1rem; gap: 0.75rem; flex-wrap: wrap;
}
.search-box {
  position: relative; flex: 1; min-width: 200px; max-width: 360px;
}
.search-box input {
  padding-left: 2.2rem;
}
.search-box::before {
  content: '🔍';
  position: absolute; left: 0.7rem; top: 50%; transform: translateY(-50%);
  font-size: 0.85rem; pointer-events: none; opacity: 0.5;
}
.toolbar-actions { display: flex; gap: 0.5rem; }

/* ====== Data Table ====== */
.table-wrapper {
  overflow-x: auto;
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
}
table {
  width: 100%;
  border-collapse: collapse;
}
thead th {
  padding: 0.7rem 0.9rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
tbody td {
  padding: 0.65rem 0.9rem;
  font-size: 0.84rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  vertical-align: middle;
}
tbody tr { transition: background var(--transition); }
tbody tr:hover { background: rgba(255,255,255,0.03); }
tbody tr:last-child td { border-bottom: none; }
.cell-id { font-family: 'Cascadia Code','Fira Code',monospace; font-size: 0.8rem; color: var(--accent); }
.cell-dim { color: var(--text-secondary); font-size: 0.8rem; }
.cell-actions { display: flex; gap: 0.35rem; white-space: nowrap; }
.badge {
  display: inline-flex; align-items: center; padding: 0.15rem 0.55rem;
  border-radius: 99px; font-size: 0.72rem; font-weight: 600;
}
.badge-info { background: rgba(96,165,250,0.12); color: var(--info); }
.badge-success { background: var(--success-bg); color: var(--success); }
.badge-warning { background: var(--warning-bg); color: var(--warning); }
.empty-state {
  text-align: center; padding: 3rem 1rem;
  color: var(--text-dim); font-size: 0.9rem;
}
.empty-state .empty-icon { font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.5; }

/* ====== Modal ====== */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 1rem;
  animation: fadeIn 0.15s ease-out;
}
.modal-content {
  width: 100%; max-width: 560px; max-height: 90vh;
  overflow-y: auto;
  padding: 1.5rem;
  animation: fadeInUp 0.2s ease-out;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1.2rem;
}
.modal-title { font-size: 1.1rem; font-weight: 600; }
.modal-close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px; background: transparent; color: var(--text-dim);
  font-size: 1.2rem;
}
.modal-close:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }
.form-group { margin-bottom: 0.9rem; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.form-section {
  margin: 1rem 0 0.6rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.form-hint { font-size: 0.75rem; color: var(--text-dim); margin-top: 0.2rem; }
.modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color); }
.node-checkboxes {
  max-height: 220px; overflow-y: auto;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  padding: 0.4rem;
}
.sub-link-box {
  display: flex; gap: 0.5rem; align-items: center;
}
.sub-link-box input { flex: 1; font-family: monospace; font-size: 0.78rem; }

/* ====== Toast ====== */
#toast-container {
  position: fixed; top: 1rem; right: 1rem;
  z-index: 2000; display: flex; flex-direction: column; gap: 0.5rem;
  pointer-events: none;
}
.toast {
  padding: 0.7rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
  font-weight: 500;
  pointer-events: auto;
  animation: slideInRight 0.25s ease-out;
  display: flex; align-items: center; gap: 0.5rem;
  max-width: 360px;
  box-shadow: var(--shadow);
}
.toast-success { background: rgba(6,78,50,0.95); color: var(--success); border: 1px solid rgba(52,211,153,0.2); }
.toast-error { background: rgba(80,20,20,0.95); color: var(--danger); border: 1px solid rgba(248,113,113,0.2); }
.toast-info { background: rgba(20,40,80,0.95); color: var(--info); border: 1px solid rgba(96,165,250,0.2); }
.toast.fade-out { animation: fadeOutRight 0.3s ease-in forwards; }

/* ====== Confirm Dialog ====== */
.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1500; padding: 1rem;
  animation: fadeIn 0.15s ease-out;
}
.confirm-box {
  width: 100%; max-width: 380px; padding: 1.5rem;
  text-align: center;
  animation: fadeInUp 0.2s ease-out;
}
.confirm-icon { font-size: 2.5rem; margin-bottom: 0.8rem; }
.confirm-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.4rem; }
.confirm-msg { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.2rem; line-height: 1.5; }
.confirm-actions { display: flex; gap: 0.6rem; justify-content: center; }
.confirm-actions .btn { min-width: 90px; justify-content: center; }

/* ====== Animations ====== */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideInRight { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: translateX(0); } }
@keyframes fadeOutRight { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(60px); } }

/* ====== Scrollbar ====== */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

/* ====== Responsive ====== */
@media (max-width: 768px) {
  .app-header { flex-wrap: wrap; gap: 0.5rem; }
  .app-nav { width: 100%; overflow-x: auto; padding-bottom: 0.3rem; }
  .nav-btn { white-space: nowrap; font-size: 0.78rem; padding: 0.4rem 0.7rem; }
  .app-content { padding: 1rem; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .search-box { max-width: 100%; }
  .form-row { grid-template-columns: 1fr; }
  .modal-content { max-width: 100%; }
}
@media (max-width: 480px) {
  html { font-size: 13px; }
  .login-card { padding: 1.5rem; }
}
</style>
</head>
<body>

<!-- ====== Login Screen ====== -->
<div id="login-screen" class="z-10">
  <div class="login-card glass">
    <div class="login-logo">⚡</div>
    <div class="login-title">Clash 管理面板</div>
    <div class="login-subtitle">输入 API Token 以继续</div>
    <div class="form-group">
      <label for="token-input">API Token</label>
      <input type="password" id="token-input" placeholder="Bearer Token..." onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <div class="login-error" id="login-error"></div>
    <button class="btn btn-primary" onclick="doLogin()" id="login-btn">登 录</button>
  </div>
</div>

<!-- ====== App Screen ====== -->
<div id="app-screen" class="z-10">
  <!-- Header -->
  <header class="app-header">
    <div class="app-brand">
      <div class="app-brand-icon">⚡</div>
      <div class="app-brand-text">Clash 管理面板</div>
    </div>
    <nav class="app-nav" id="app-nav">
      <button class="nav-btn active" data-tab="nodes" onclick="switchTab('nodes')">📡 节点</button>
      <button class="nav-btn" data-tab="users" onclick="switchTab('users')">👤 用户</button>
      <button class="nav-btn" data-tab="rules" onclick="switchTab('rules')">📋 规则</button>
      <button class="nav-btn" data-tab="logs" onclick="switchTab('logs')">📜 日志</button>
    </nav>
    <button class="btn btn-ghost btn-sm" onclick="doLogout()">退出</button>
  </header>

  <!-- Content -->
  <main class="app-content">
    <!-- Nodes Panel -->
    <div id="panel-nodes" class="panel">
      <div class="toolbar">
        <div class="search-box"><input type="text" placeholder="搜索节点 ID 或名称..." oninput="renderNodes()" id="search-nodes"></div>
        <div class="toolbar-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadNodes()">🔄 刷新</button>
          <button class="btn btn-success btn-sm" onclick="showNodeModal()">+ 新增节点</button>
        </div>
      </div>
      <div class="table-wrapper glass" id="nodes-table"></div>
    </div>

    <!-- Users Panel -->
    <div id="panel-users" class="panel hidden">
      <div class="toolbar">
        <div class="search-box"><input type="text" placeholder="搜索备注或 UUID..." oninput="renderUsers()" id="search-users"></div>
        <div class="toolbar-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadUsers()">🔄 刷新</button>
          <button class="btn btn-success btn-sm" onclick="showUserModal()">+ 新增用户</button>
        </div>
      </div>
      <div class="table-wrapper glass" id="users-table"></div>
    </div>

    <!-- Rules Panel -->
    <div id="panel-rules" class="panel hidden">
      <div class="toolbar">
        <div class="search-box"><input type="text" placeholder="搜索规则名称..." oninput="renderRules()" id="search-rules"></div>
        <div class="toolbar-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadRules()">🔄 刷新</button>
          <button class="btn btn-success btn-sm" onclick="showRuleModal()">+ 新增规则</button>
        </div>
      </div>
      <div class="table-wrapper glass" id="rules-table"></div>
    </div>

    <!-- Logs Panel -->
    <div id="panel-logs" class="panel hidden">
      <div class="toolbar">
        <div class="search-box"><input type="text" placeholder="搜索日志..." oninput="renderLogs()" id="search-logs"></div>
        <div class="toolbar-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadLogs()">🔄 刷新</button>
          <button class="btn btn-danger btn-sm" onclick="confirmClearLogs()">🗑 清空日志</button>
        </div>
      </div>
      <div class="table-wrapper glass" id="logs-table"></div>
    </div>
  </main>
</div>

<!-- ====== Modal Container ====== -->
<div id="modal-container" class="hidden"></div>

<!-- ====== Toast Container ====== -->
<div id="toast-container"></div>

<!-- ====== Confirm Container ====== -->
<div id="confirm-container" class="hidden"></div>

<script>
// ==================== State ====================
let token = localStorage.getItem('clash_admin_token') || '';
let currentTab = 'nodes';
let nodesData = [];
let usersData = [];
let rulesData = [];
let logsData = [];

// ==================== Init ====================
(function init() {
  if (token) {
    api('GET', '/nodes').then(res => {
      if (res.ok) { showApp(); loadAllData(); }
      else { token = ''; localStorage.removeItem('clash_admin_token'); }
    }).catch(() => {});
  }
})();

// ==================== API Helper ====================
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch('/api' + path, opts);
}

// ==================== Auth ====================
async function doLogin() {
  const input = document.getElementById('token-input');
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  token = input.value.trim();
  if (!token) { errEl.textContent = '请输入 Token'; return; }
  btn.disabled = true; btn.textContent = '验证中...';
  errEl.textContent = '';
  try {
    const res = await api('GET', '/nodes');
    if (res.ok) {
      localStorage.setItem('clash_admin_token', token);
      showApp();
      loadAllData();
    } else if (res.status === 401 || res.status === 403) {
      errEl.textContent = 'Token 无效，请重试';
      token = '';
    } else {
      errEl.textContent = '连接失败: ' + res.status;
      token = '';
    }
  } catch (e) {
    errEl.textContent = '网络错误';
    token = '';
  }
  btn.disabled = false; btn.textContent = '登 录';
}

function doLogout() {
  token = '';
  localStorage.removeItem('clash_admin_token');
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('token-input').value = '';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
}

// ==================== Tab Switching ====================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + tab).classList.remove('hidden');
  // Load data for the tab
  if (tab === 'nodes') { if (nodesData.length === 0) loadNodes(); else renderNodes(); }
  else if (tab === 'users') { if (usersData.length === 0) loadUsers(); else renderUsers(); }
  else if (tab === 'rules') { if (rulesData.length === 0) loadRules(); else renderRules(); }
  else if (tab === 'logs') loadLogs();
}

// ==================== Data Loading ====================
async function loadAllData() {
  await Promise.all([loadNodes(), loadUsers(), loadRules()]);
}

async function loadNodes() {
  try {
    const res = await api('GET', '/nodes');
    if (res.ok) { nodesData = await res.json(); renderNodes(); }
    else toast('加载节点失败', 'error');
  } catch(e) { toast('网络错误', 'error'); }
}

async function loadUsers() {
  try {
    const res = await api('GET', '/users');
    if (res.ok) { usersData = await res.json(); renderUsers(); }
    else toast('加载用户失败', 'error');
  } catch(e) { toast('网络错误', 'error'); }
}

async function loadRules() {
  try {
    const res = await api('GET', '/rules');
    if (res.ok) { rulesData = await res.json(); renderRules(); }
    else toast('加载规则失败', 'error');
  } catch(e) { toast('网络错误', 'error'); }
}

async function loadLogs() {
  try {
    const res = await api('GET', '/logs');
    if (res.ok) { logsData = await res.json(); renderLogs(); }
    else toast('加载日志失败', 'error');
  } catch(e) { toast('网络错误', 'error'); }
}

// ==================== Render: Nodes ====================
function renderNodes() {
  const q = (document.getElementById('search-nodes').value || '').toLowerCase();
  const filtered = nodesData.filter(n =>
    (n.id||'').toLowerCase().includes(q) || (n.name||'').toLowerCase().includes(q)
  );
  const el = document.getElementById('nodes-table');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div>' + (nodesData.length === 0 ? '暂无节点，点击上方「+ 新增节点」添加' : '无匹配结果') + '</div>';
    return;
  }
  let html = '<table><thead><tr><th>ID</th><th>名称</th><th>服务器</th><th>端口</th><th>协议</th><th>操作</th></tr></thead><tbody>';
  for (const n of filtered) {
    html += '<tr>'
      + '<td class="cell-id">' + esc(n.id) + '</td>'
      + '<td>' + esc(n.name||'') + '</td>'
      + '<td class="cell-dim">' + esc(n.server||'') + '</td>'
      + '<td class="cell-dim">' + esc(n.port!=null?n.port:'') + '</td>'
      + '<td><span class="badge badge-info">' + esc(n.type||'') + '</span></td>'
      + '<td class="cell-actions">'
        + '<button class="btn-icon" title="克隆" onclick="cloneNode(' + qattr(n.id) + ')">📋</button>'
        + '<button class="btn-icon" title="编辑" onclick="showNodeModal(' + qattr(n.id) + ')">✏️</button>'
        + '<button class="btn-icon danger" title="删除" onclick="confirmDeleteNode(' + qattr(n.id) + ')">🗑</button>'
      + '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ==================== Render: Users ====================
function renderUsers() {
  const q = (document.getElementById('search-users').value || '').toLowerCase();
  const filtered = usersData.filter(u =>
    (u.uuid||'').toLowerCase().includes(q) || (u.remark||'').toLowerCase().includes(q)
  );
  const el = document.getElementById('users-table');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div>' + (usersData.length === 0 ? '暂无用户，点击上方「+ 新增用户」添加' : '无匹配结果') + '</div>';
    return;
  }
  let html = '<table><thead><tr><th>备注</th><th>UUID</th><th>节点数</th><th>规则</th><th>操作</th></tr></thead><tbody>';
  for (const u of filtered) {
    const shortUuid = (u.uuid||'').length > 12 ? u.uuid.slice(0,12) + '...' : u.uuid;
    const nodeCount = (u.allowed_nodes||[]).length;
    html += '<tr>'
      + '<td>' + esc(u.remark||'无备注') + '</td>'
      + '<td class="cell-id" title="' + escAttr(u.uuid) + '">' + esc(shortUuid) + '</td>'
      + '<td><span class="badge badge-success">' + nodeCount + '</span></td>'
      + '<td><span class="badge badge-warning">' + esc(u.rule_template||'') + '</span></td>'
      + '<td class="cell-actions">'
        + '<button class="btn-icon" title="复制订阅链接" onclick="copySubLink(' + qattr(u.uuid) + ')">📋</button>'
        + '<button class="btn-icon" title="编辑" onclick="showUserModal(' + qattr(u.uuid) + ')">✏️</button>'
        + '<button class="btn-icon danger" title="删除" onclick="confirmDeleteUser(' + qattr(u.uuid) + ')">🗑</button>'
      + '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ==================== Render: Rules ====================
function renderRules() {
  const q = (document.getElementById('search-rules').value || '').toLowerCase();
  const filtered = rulesData.filter(r => (r.name||'').toLowerCase().includes(q));
  const el = document.getElementById('rules-table');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>' + (rulesData.length === 0 ? '暂无规则，点击上方「+ 新增规则」添加' : '无匹配结果') + '</div>';
    return;
  }
  let html = '<table><thead><tr><th>名称</th><th>内容预览</th><th>引用数</th><th>操作</th></tr></thead><tbody>';
  for (const r of filtered) {
    const preview = (r.content||'').replace(/\\n/g,' ').slice(0,60) + ((r.content||'').length>60?'...':'');
    const refCount = usersData.filter(u => u.rule_template === r.name).length;
    html += '<tr>'
      + '<td class="cell-id">' + esc(r.name) + '</td>'
      + '<td class="cell-dim">' + esc(preview) + '</td>'
      + '<td><span class="badge badge-info">' + refCount + '</span></td>'
      + '<td class="cell-actions">'
        + '<button class="btn-icon" title="编辑" onclick="showRuleModal(' + qattr(r.name) + ')">✏️</button>'
        + '<button class="btn-icon danger" title="删除" onclick="confirmDeleteRule(' + qattr(r.name) + ')">🗑</button>'
      + '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ==================== Render: Logs ====================
function renderLogs() {
  const q = (document.getElementById('search-logs').value || '').toLowerCase();
  const filtered = logsData.filter(l =>
    (l.action||'').toLowerCase().includes(q) || (l.target||'').toLowerCase().includes(q) || (l.detail||'').toLowerCase().includes(q)
  );
  const el = document.getElementById('logs-table');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📜</div>' + (logsData.length === 0 ? '暂无操作日志' : '无匹配结果') + '</div>';
    return;
  }
  let html = '<table><thead><tr><th>时间</th><th>操作</th><th>目标</th><th>详情</th><th>IP</th></tr></thead><tbody>';
  for (const l of filtered) {
    const t = l.time ? new Date(l.time).toLocaleString('zh-CN') : '';
    const actionBadge = getActionBadge(l.action);
    html += '<tr>'
      + '<td class="cell-dim" style="white-space:nowrap">' + esc(t) + '</td>'
      + '<td>' + actionBadge + '</td>'
      + '<td class="cell-id">' + esc(l.target||'') + '</td>'
      + '<td>' + esc(l.detail||'') + '</td>'
      + '<td class="cell-dim">' + esc(l.ip||'') + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function getActionBadge(action) {
  const map = {
    'CREATE_NODE': ['badge-success','新增节点'], 'UPDATE_NODE': ['badge-info','修改节点'], 'DELETE_NODE': ['badge-warning','删除节点'], 'CLONE_NODE': ['badge-success','克隆节点'],
    'CREATE_USER': ['badge-success','新增用户'], 'UPDATE_USER': ['badge-info','修改用户'], 'DELETE_USER': ['badge-warning','删除用户'],
    'CREATE_RULE': ['badge-success','新增规则'], 'UPDATE_RULE': ['badge-info','修改规则'], 'DELETE_RULE': ['badge-warning','删除规则'],
    'CLEAR_LOGS':  ['badge-warning','清空日志']
  };
  const [cls, label] = map[action] || ['badge-info', action||''];
  return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
}

// ==================== Modal: Node ====================
function showNodeModal(editId) {
  const isEdit = !!editId;
  const node = isEdit ? nodesData.find(n => n.id === editId) : {};
  const title = isEdit ? '编辑节点' : '新增节点';

  let html = '<div class="form-group"><label>节点 ID</label><input type="text" id="m-node-id" value="' + escAttr(node.id||'') + '"' + (isEdit?' readonly style="opacity:0.6"':'') + ' placeholder="如 HK1、JP1v6"></div>';
  html += '<div class="form-group"><label>显示名称</label><input type="text" id="m-node-name" value="' + escAttr(node.name||'') + '" placeholder="如 🇭🇰 香港01 | x0.1"></div>';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>协议类型</label><select id="m-node-type"><option value="vless"' + (node.type==='vless'?' selected':'') + '>vless</option><option value="vmess"' + (node.type==='vmess'?' selected':'') + '>vmess</option><option value="trojan"' + (node.type==='trojan'?' selected':'') + '>trojan</option><option value="ss"' + (node.type==='ss'?' selected':'') + '>ss</option><option value="hysteria2"' + (node.type==='hysteria2'?' selected':'') + '>hysteria2</option></select></div>';
  html += '<div class="form-group"><label>传输协议</label><select id="m-node-network"><option value="tcp"' + (node.network==='tcp'?' selected':'') + '>tcp</option><option value="ws"' + (node.network==='ws'?' selected':'') + '>ws</option><option value="grpc"' + (node.network==='grpc'?' selected':'') + '>grpc</option><option value="h2"' + (node.network==='h2'?' selected':'') + '>h2</option></select></div>';
  html += '</div>';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>服务器地址</label><input type="text" id="m-node-server" value="' + escAttr(node.server||'') + '" placeholder="example.com"></div>';
  html += '<div class="form-group"><label>端口</label><input type="number" id="m-node-port" value="' + (node.port||'') + '" placeholder="443"></div>';
  html += '</div>';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>UDP</label><select id="m-node-udp"><option value="true"' + (node.udp!==false?' selected':'') + '>是</option><option value="false"' + (node.udp===false?' selected':'') + '>否</option></select></div>';
  html += '<div class="form-group"><label>TLS</label><select id="m-node-tls"><option value="true"' + (node.tls!==false?' selected':'') + '>是</option><option value="false"' + (node.tls===false?' selected':'') + '>否</option></select></div>';
  html += '</div>';
  html += '<div class="form-group"><label>Flow</label><input type="text" id="m-node-flow" value="' + escAttr(node.flow||'') + '" placeholder="xtls-rprx-vision（可留空）"></div>';
  html += '<div class="form-section">Reality 设置（可选）</div>';
  const ro = node['reality-opts'] || {};
  html += '<div class="form-group"><label>Public Key</label><input type="text" id="m-node-rpk" value="' + escAttr(ro['public-key']||'') + '" placeholder="留空则不启用 Reality"></div>';
  html += '<div class="form-group"><label>Short ID</label><input type="text" id="m-node-rsid" value="' + escAttr(ro['short-id']||'') + '"></div>';
  html += '<div class="form-section">其他设置</div>';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>Client Fingerprint</label><select id="m-node-fp"><option value="">无</option><option value="chrome"' + (node['client-fingerprint']==='chrome'?' selected':'') + '>chrome</option><option value="firefox"' + (node['client-fingerprint']==='firefox'?' selected':'') + '>firefox</option><option value="safari"' + (node['client-fingerprint']==='safari'?' selected':'') + '>safari</option><option value="random"' + (node['client-fingerprint']==='random'?' selected':'') + '>random</option></select></div>';
  html += '<div class="form-group"><label>Server Name (SNI)</label><input type="text" id="m-node-sni" value="' + escAttr(node.servername||'') + '" placeholder="如 updates.cdn-apple.com"></div>';
  html += '</div>';

  // JSON 模式切换
  html += '<div class="form-section" style="cursor:pointer;user-select:none" onclick="toggleJsonMode()">📝 JSON 模式 <span id="json-toggle-arrow">▶</span></div>';
  const jsonStr = isEdit ? JSON.stringify((() => { const {id,...rest} = node; return rest; })(), null, 2) : '';
  html += '<div class="form-group hidden" id="json-mode-group"><textarea id="m-node-json" rows="12" placeholder="直接粘贴节点 JSON...">' + esc(jsonStr) + '</textarea><div class="form-hint">启用 JSON 模式后将忽略上方表单字段，直接使用 JSON 内容</div></div>';

  openModal(title, html, () => saveNode(isEdit, editId));
}

let jsonModeActive = false;
function toggleJsonMode() {
  jsonModeActive = !jsonModeActive;
  document.getElementById('json-mode-group').classList.toggle('hidden', !jsonModeActive);
  document.getElementById('json-toggle-arrow').textContent = jsonModeActive ? '▼' : '▶';
}

async function saveNode(isEdit, editId) {
  let nodeData;
  const nodeId = document.getElementById('m-node-id').value.trim();
  if (!nodeId) { toast('请填写节点 ID', 'error'); return; }

  if (jsonModeActive) {
    try {
      nodeData = JSON.parse(document.getElementById('m-node-json').value);
    } catch(e) { toast('JSON 格式错误: ' + e.message, 'error'); return; }
  } else {
    nodeData = {
      name: document.getElementById('m-node-name').value.trim(),
      type: document.getElementById('m-node-type').value,
      server: document.getElementById('m-node-server').value.trim(),
      port: parseInt(document.getElementById('m-node-port').value) || 443,
      network: document.getElementById('m-node-network').value,
      udp: document.getElementById('m-node-udp').value === 'true',
      tls: document.getElementById('m-node-tls').value === 'true'
    };
    const flow = document.getElementById('m-node-flow').value.trim();
    if (flow) nodeData.flow = flow;
    const rpk = document.getElementById('m-node-rpk').value.trim();
    const rsid = document.getElementById('m-node-rsid').value.trim();
    if (rpk) nodeData['reality-opts'] = { 'public-key': rpk, 'short-id': rsid };
    const fp = document.getElementById('m-node-fp').value;
    if (fp) nodeData['client-fingerprint'] = fp;
    const sni = document.getElementById('m-node-sni').value.trim();
    if (sni) nodeData.servername = sni;
  }

  try {
    let res;
    if (isEdit) {
      res = await api('PUT', '/nodes/' + encodeURIComponent(editId), nodeData);
    } else {
      res = await api('POST', '/nodes', { id: nodeId, ...nodeData });
    }
    const data = await res.json();
    if (res.ok) {
      toast(isEdit ? '节点已更新' : '节点已创建', 'success');
      closeModal();
      if (isEdit) {
        const idx = nodesData.findIndex(n => n.id === editId);
        if (idx !== -1) nodesData[idx] = { id: editId, ...nodeData };
      } else {
        nodesData.push({ id: nodeId, ...nodeData });
      }
      renderNodes();
    } else {
      toast(data.error || '操作失败', 'error');
    }
  } catch(e) { toast('网络错误', 'error'); }
}

function confirmDeleteNode(id) {
  const refs = usersData.filter(u => (u.allowed_nodes||[]).includes(id));
  let msg = '确定要删除节点「' + id + '」吗？';
  if (refs.length > 0) msg += '\\n\\n⚠️ 该节点被 ' + refs.length + ' 个用户引用，删除后这些用户将无法使用此节点。';
  showConfirm('删除节点', msg, async () => {
    try {
      const res = await api('DELETE', '/nodes/' + encodeURIComponent(id));
      if (res.ok) { 
        toast('节点已删除', 'success'); 
        nodesData = nodesData.filter(n => n.id !== id);
        usersData.forEach(u => {
          if (u.allowed_nodes && u.allowed_nodes.includes(id)) {
            u.allowed_nodes = u.allowed_nodes.filter(nId => nId !== id);
          }
        });
        renderNodes();
        if (currentTab === 'users') renderUsers();
      }
      else { const d = await res.json(); toast(d.error||'删除失败', 'error'); }
    } catch(e) { toast('网络错误', 'error'); }
  });
}

async function cloneNode(id) {
  const node = nodesData.find(n => n.id === id);
  if (!node) return;
  
  let newId = id + 'clone';
  let counter = 1;
  while (nodesData.some(n => n.id === newId)) {
    newId = id + 'clone' + counter;
    counter++;
  }

  const { id: _, ...nodeData } = node;
  
  try {
    const res = await api('POST', '/nodes', { id: newId, isClone: true, ...nodeData });
    const data = await res.json();
    if (res.ok) {
      toast('节点已克隆', 'success');
      nodesData.push({ id: newId, ...nodeData });
      renderNodes();
    } else {
      toast(data.error || '克隆失败', 'error');
    }
  } catch(e) {
    toast('网络错误', 'error');
  }
}

// ==================== Modal: User ====================
function showUserModal(editUuid) {
  const isEdit = !!editUuid;
  const user = isEdit ? usersData.find(u => u.uuid === editUuid) : {};
  const title = isEdit ? '编辑用户' : '新增用户';
  const allowedSet = new Set(user.allowed_nodes || []);

  let html = '<div class="form-group"><label>UUID</label><input type="text" id="m-user-uuid" value="' + escAttr(user.uuid||'') + '"' + (isEdit?' readonly style="opacity:0.6"':'') + ' placeholder="手动输入 UUID"></div>';
  html += '<div class="form-group"><label>备注</label><input type="text" id="m-user-remark" value="' + escAttr(user.remark||'') + '" placeholder="如 xxx的订阅"></div>';

  // 订阅链接（编辑模式）
  if (isEdit) {
    const link = location.origin + '/' + user.uuid;
    html += '<div class="form-group"><label>订阅链接</label><div class="sub-link-box"><input type="text" value="' + escAttr(link) + '" readonly id="m-sub-link"><button class="btn btn-ghost btn-sm" onclick="copySubLink(' + qattr(user.uuid) + ')">📋 复制</button></div></div>';
  }

  html += '<div class="form-section">可用节点</div>';
  html += '<div style="display:flex;gap:0.5rem;margin-bottom:0.4rem"><button class="btn btn-ghost btn-sm" onclick="toggleAllNodes(true)">全选</button><button class="btn btn-ghost btn-sm" onclick="toggleAllNodes(false)">全不选</button></div>';
  html += '<div class="node-checkboxes" id="m-node-checks">';
  if (nodesData.length === 0) {
    html += '<div class="empty-state" style="padding:1rem">暂无节点</div>';
  } else {
    for (const n of nodesData) {
      const checked = allowedSet.has(n.id) ? ' checked' : '';
      html += '<label class="checkbox-item"><input type="checkbox" value="' + escAttr(n.id) + '"' + checked + '><span class="cell-id">' + esc(n.id) + '</span> <span>' + esc(n.name||'') + '</span></label>';
    }
  }
  html += '</div>';

  html += '<div class="form-section">规则模板</div>';
  html += '<div class="form-group"><select id="m-user-rule">';
  if (rulesData.length === 0) {
    html += '<option value="">暂无规则</option>';
  } else {
    for (const r of rulesData) {
      const selected = r.name === (user.rule_template||'') ? ' selected' : '';
      html += '<option value="' + escAttr(r.name) + '"' + selected + '>' + esc(r.name) + '</option>';
    }
  }
  html += '</select></div>';

  openModal(title, html, () => saveUser(isEdit, editUuid));
}

function toggleAllNodes(selectAll) {
  document.querySelectorAll('#m-node-checks input[type=checkbox]').forEach(cb => cb.checked = selectAll);
}

async function saveUser(isEdit, editUuid) {
  const uuid = document.getElementById('m-user-uuid').value.trim();
  if (!uuid) { toast('请填写 UUID', 'error'); return; }
  const remark = document.getElementById('m-user-remark').value.trim();
  const allowedNodes = Array.from(document.querySelectorAll('#m-node-checks input[type=checkbox]:checked')).map(cb => cb.value);
  const ruleTemplate = document.getElementById('m-user-rule').value;
  const body = { uuid, remark, allowed_nodes: allowedNodes, rule_template: ruleTemplate };

  try {
    let res;
    if (isEdit) {
      res = await api('PUT', '/users/' + encodeURIComponent(editUuid), body);
    } else {
      res = await api('POST', '/users', body);
    }
    const data = await res.json();
    if (res.ok) {
      toast(isEdit ? '用户已更新' : '用户已创建', 'success');
      closeModal();
      if (isEdit) {
        const idx = usersData.findIndex(u => u.uuid === editUuid);
        if (idx !== -1) usersData[idx] = body;
      } else {
        usersData.push(body);
      }
      renderUsers();
    } else {
      toast(data.error || '操作失败', 'error');
    }
  } catch(e) { toast('网络错误', 'error'); }
}

function confirmDeleteUser(uuid) {
  const user = usersData.find(u => u.uuid === uuid);
  const name = user ? (user.remark || uuid) : uuid;
  showConfirm('删除用户', '确定要删除用户「' + name + '」吗？\\n\\n此操作不可恢复。', async () => {
    try {
      const res = await api('DELETE', '/users/' + encodeURIComponent(uuid));
      if (res.ok) { 
        toast('用户已删除', 'success'); 
        usersData = usersData.filter(u => u.uuid !== uuid);
        renderUsers();
      }
      else { const d = await res.json(); toast(d.error||'删除失败', 'error'); }
    } catch(e) { toast('网络错误', 'error'); }
  });
}

function copySubLink(uuid) {
  const link = location.origin + '/' + uuid;
  navigator.clipboard.writeText(link).then(() => toast('订阅链接已复制', 'success')).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast('订阅链接已复制', 'success');
  });
}

// ==================== Modal: Rule ====================
function showRuleModal(editName) {
  const isEdit = !!editName;
  const rule = isEdit ? rulesData.find(r => r.name === editName) : {};
  const title = isEdit ? '编辑规则' : '新增规则';

  let html = '<div class="form-group"><label>规则名称</label><input type="text" id="m-rule-name" value="' + escAttr(rule.name||'') + '"' + (isEdit?' readonly style="opacity:0.6"':'') + ' placeholder="如 rule1、default"></div>';
  html += '<div class="form-group"><label>规则内容 (YAML)</label><textarea id="m-rule-content" rows="18" placeholder="mode: rule\\nipv6: true\\n# =PROXIES=\\nproxy-groups:\\n  ...">' + esc(rule.content||'') + '</textarea>';
  html += '<div class="form-hint">使用 <code>=PROXIES=</code> 作为节点注入占位符 · 使用 <code>"all"</code> 表示用户的全部节点</div></div>';

  openModal(title, html, () => saveRule(isEdit, editName), 640);
}

async function saveRule(isEdit, editName) {
  const name = document.getElementById('m-rule-name').value.trim();
  if (!name) { toast('请填写规则名称', 'error'); return; }
  const content = document.getElementById('m-rule-content').value;

  try {
    let res;
    if (isEdit) {
      res = await api('PUT', '/rules/' + encodeURIComponent(editName), { content });
    } else {
      res = await api('POST', '/rules', { name, content });
    }
    const data = await res.json();
    if (res.ok) {
      toast(isEdit ? '规则已更新' : '规则已创建', 'success');
      closeModal();
      if (isEdit) {
        const idx = rulesData.findIndex(r => r.name === editName);
        if (idx !== -1) rulesData[idx] = { name: editName, content };
      } else {
        rulesData.push({ name, content });
      }
      renderRules();
    } else {
      toast(data.error || '操作失败', 'error');
    }
  } catch(e) { toast('网络错误', 'error'); }
}

function confirmDeleteRule(name) {
  const refs = usersData.filter(u => u.rule_template === name);
  let msg = '确定要删除规则「' + name + '」吗？';
  if (refs.length > 0) msg += '\\n\\n⚠️ 该规则被 ' + refs.length + ' 个用户引用。';
  showConfirm('删除规则', msg, async () => {
    try {
      const res = await api('DELETE', '/rules/' + encodeURIComponent(name));
      if (res.ok) { 
        toast('规则已删除', 'success'); 
        rulesData = rulesData.filter(r => r.name !== name);
        renderRules();
      }
      else { const d = await res.json(); toast(d.error||'删除失败', 'error'); }
    } catch(e) { toast('网络错误', 'error'); }
  });
}

// ==================== Logs Actions ====================
function confirmClearLogs() {
  showConfirm('清空日志', '确定要清空所有操作日志吗？此操作不可恢复。', async () => {
    try {
      const res = await api('DELETE', '/logs');
      if (res.ok) { toast('日志已清空', 'success'); await loadLogs(); }
      else toast('清空失败', 'error');
    } catch(e) { toast('网络错误', 'error'); }
  });
}

// ==================== Modal System ====================
function openModal(title, bodyHtml, onSave, maxWidth) {
  jsonModeActive = false;
  const mw = maxWidth || 560;
  const container = document.getElementById('modal-container');
  container.innerHTML = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">'
    + '<div class="modal-content glass" style="max-width:' + mw + 'px">'
    + '<div class="modal-header"><div class="modal-title">' + title + '</div><button class="modal-close" onclick="closeModal()">✕</button></div>'
    + '<div class="modal-body">' + bodyHtml + '</div>'
    + '<div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" id="modal-save-btn">💾 保存</button></div>'
    + '</div></div>';
  container.classList.remove('hidden');
  document.getElementById('modal-save-btn').onclick = onSave;
}

function closeModal() {
  const container = document.getElementById('modal-container');
  container.classList.add('hidden');
  container.innerHTML = '';
}

// ==================== Toast ====================
function toast(message, type) {
  type = type || 'info';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span>' + icon + '</span><span>' + esc(message) + '</span>';
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3000);
}

// ==================== Confirm Dialog ====================
function showConfirm(title, message, onConfirm) {
  const container = document.getElementById('confirm-container');
  container.innerHTML = '<div class="confirm-overlay" onclick="if(event.target===this)closeConfirm()">'
    + '<div class="confirm-box glass">'
    + '<div class="confirm-icon">⚠️</div>'
    + '<div class="confirm-title">' + esc(title) + '</div>'
    + '<div class="confirm-msg">' + esc(message).replace(/\\n/g, '<br>') + '</div>'
    + '<div class="confirm-actions">'
    + '<button class="btn btn-ghost" onclick="closeConfirm()">取消</button>'
    + '<button class="btn btn-danger" id="confirm-ok-btn">确认删除</button>'
    + '</div></div></div>';
  container.classList.remove('hidden');
  document.getElementById('confirm-ok-btn').onclick = () => { closeConfirm(); onConfirm(); };
}

function closeConfirm() {
  const container = document.getElementById('confirm-container');
  container.classList.add('hidden');
  container.innerHTML = '';
}

// ==================== Helpers ====================
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function qattr(s) { return "'" + escAttr(s) + "'"; }
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}