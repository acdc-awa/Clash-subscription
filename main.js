// ============================================================
// Cloudflare Worker — Clash 订阅管理系统 (反向代理版)
// 功能：API 请求、订阅请求以及 React 前端静态资源全量反向代理
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 后端 VPS 服务配置
    const vpsUrl = env.VPS_BACKEND_URL; // 例如 "https://subdomain.domain"
    const proxySecret = env.PROXY_SECRET; // 与 VPS 约定的验证密钥

    if (!vpsUrl) {
      return new Response("Configuration Error: VPS_BACKEND_URL is not defined in Worker environment.", { status: 500 });
    }

    // 构造请求目标 URL，转发所有路径
    const targetUrl = `${vpsUrl}${path}${url.search}`;
    
    // 复制并构造 Header，注入 X-Proxy-Secret 用于后端校验
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
      if (path.startsWith("/api/")) {
        // 确保跨域请求正常接收数据
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
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}