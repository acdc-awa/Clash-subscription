const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const WebSocket = require('ws');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load environment variables
const CONTROLLER_URL = process.env.CONTROLLER_URL; // wss://host
const NODE_ID = process.env.NODE_ID;
const NODE_SECRET = process.env.NODE_SECRET;
const XRAY_CONFIG_PATH = process.env.XRAY_CONFIG_PATH || '/usr/local/etc/xray/config.json';
const XRAY_SERVICE_NAME = process.env.XRAY_SERVICE_NAME || 'xray';
const XRAY_API_ADDRESS = process.env.XRAY_API_ADDRESS || '127.0.0.1:10085';
const PROTO_PATH = path.join(__dirname, 'xray.proto');
const STATE_PATH = '/etc/xray-daemon/state.json';

if (!CONTROLLER_URL || !NODE_ID || !NODE_SECRET) {
  console.error("[-] Missing required environment variables (CONTROLLER_URL, NODE_ID, NODE_SECRET)");
  process.exit(1);
}

// Global state variables
let ws = null;
let reconnectDelay = 2000;
let reportInterval = null;
let statsClient = null;

// System metrics tracking
let lastCpuMetrics = { total: 0, idle: 0 };
let lastNetMetrics = { rx: 0, tx: 0, time: Date.now() };

// Initialize gRPC client
try {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  const xrayProto = grpc.loadPackageDefinition(packageDefinition).xray;
  statsClient = new xrayProto.app.stats.command.StatsService(
    XRAY_API_ADDRESS,
    grpc.credentials.createInsecure()
  );
  console.log(`[+] Initialized gRPC client targeting Xray API at ${XRAY_API_ADDRESS}`);
} catch (e) {
  console.error("[-] Failed to initialize Xray gRPC client:", e.message);
}

// Helper to run shell commands
function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ------------------------------------------------------------
// Linux /proc Metrics Parsers
// ------------------------------------------------------------

function getCpuUsage() {
  try {
    const data = fs.readFileSync('/proc/stat', 'utf8');
    const firstLine = data.split('\n')[0];
    const parts = firstLine.split(/\s+/).slice(1).map(Number);
    // user nice system idle iowait irq softirq steal
    const idle = parts[3] + parts[4];
    const total = parts.reduce((a, b) => a + b, 0);

    const deltaTotal = total - lastCpuMetrics.total;
    const deltaIdle = idle - lastCpuMetrics.idle;
    lastCpuMetrics = { total, idle };

    if (deltaTotal === 0) return 0;
    return Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100);
  } catch (e) {
    return 0;
  }
}

function getMemUsage() {
  try {
    const data = fs.readFileSync('/proc/meminfo', 'utf8');
    let memTotal = 0;
    let memAvailable = 0;

    data.split('\n').forEach(line => {
      if (line.startsWith('MemTotal:')) {
        memTotal = Number(line.replace(/\D/g, ''));
      } else if (line.startsWith('MemAvailable:')) {
        memAvailable = Number(line.replace(/\D/g, ''));
      }
    });

    if (memTotal === 0) return 0;
    return Math.round(((memTotal - memAvailable) / memTotal) * 100);
  } catch (e) {
    return 0;
  }
}

function getDiskUsage() {
  try {
    const stdout = require('child_process').execSync('df /').toString();
    const lines = stdout.split('\n');
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      const usePercentStr = parts[4]; // e.g. "45%"
      return parseFloat(usePercentStr) || 0;
    }
  } catch(e) {}
  return 0;
}

function getUptime() {
  try {
    const data = fs.readFileSync('/proc/uptime', 'utf8');
    const uptimeSeconds = parseFloat(data.split(' ')[0]);
    return Math.floor(uptimeSeconds);
  } catch(e) {
    return 0;
  }
}

function getOsType() {
  try {
    if (fs.existsSync('/etc/os-release')) {
      const data = fs.readFileSync('/etc/os-release', 'utf8');
      const prettyNameMatch = data.match(/PRETTY_NAME="([^"]+)"/);
      if (prettyNameMatch) return prettyNameMatch[1];
      const nameMatch = data.match(/NAME="([^"]+)"/);
      if (nameMatch) return nameMatch[1];
    }
  } catch(e) {}
  return 'Linux';
}

function getNetworkSpeeds() {
  try {
    const data = fs.readFileSync('/proc/net/dev', 'utf8');
    let totalRx = 0;
    let totalTx = 0;

    data.split('\n').forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 8 && parts[0].includes(':')) {
        const iface = parts[0].split(':')[0];
        if (iface !== 'lo') {
          totalRx += Number(parts[1]);
          totalTx += Number(parts[9]);
        }
      }
    });

    const now = Date.now();
    const duration = (now - lastNetMetrics.time) / 1000;
    const rxSpeed = duration > 0 ? Math.round((totalRx - lastNetMetrics.rx) / duration) : 0;
    const txSpeed = duration > 0 ? Math.round((totalTx - lastNetMetrics.tx) / duration) : 0;

    lastNetMetrics = { rx: totalRx, tx: totalTx, time: now };
    return { rxSpeed, txSpeed, rxTotal: totalRx, txTotal: totalTx };
  } catch (e) {
    return { rxSpeed: 0, txSpeed: 0, rxTotal: 0, txTotal: 0 };
  }
}

// ------------------------------------------------------------
// UFW Firewall Rule Manager
// ------------------------------------------------------------

async function applyUfwRules(newPorts) {
  let oldPorts = [];
  try {
    if (fs.existsSync(STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      oldPorts = state.ports || [];
    }
  } catch (e) {
    console.error("[-] Failed to read state.json for UFW:", e.message);
  }

  // Open new ports
  for (const port of newPorts) {
    if (!oldPorts.includes(port)) {
      try {
        console.log(`[UFW] Opening port ${port}/tcp...`);
        await runCmd(`sudo ufw allow ${port}/tcp comment 'xray-inbound: ${NODE_ID}_${port}'`);
      } catch (err) {
        console.error(`[UFW] Failed to open port ${port}:`, err.message);
      }
    }
  }

  // Close deleted ports
  for (const port of oldPorts) {
    if (!newPorts.includes(port)) {
      try {
        console.log(`[UFW] Closing port ${port}/tcp...`);
        await runCmd(`sudo ufw delete allow ${port}/tcp`);
      } catch (err) {
        console.error(`[UFW] Failed to close port ${port}:`, err.message);
      }
    }
  }

  // Save new state
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ports: newPorts }), 'utf8');
  } catch (e) {
    console.error("[-] Failed to save state.json for UFW:", e.message);
  }
}

// ------------------------------------------------------------
// Xray Configuration Renderer
// ------------------------------------------------------------

function renderXrayConfig(inbounds, configObj) {
  // If the backend provided a complete config, just write it
  if (configObj) {
    fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(configObj, null, 2), 'utf8');
    console.log(`[Config] Successfully wrote complete Xray config to ${XRAY_CONFIG_PATH}`);
    return;
  }

  // Fallback for older versions
  const fullConfig = {
    log: { loglevel: "warning" },
    api: {
      tag: "api",
      services: ["HandlerService", "StatsService"]
    },
    stats: {},
    policy: {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true }
    },
    inbounds: [
      ...inbounds,
      {
        listen: "127.0.0.1",
        port: 10085,
        protocol: "dokodemo-door",
        settings: { address: "127.0.0.1" },
        tag: "api-in"
      }
    ],
    outbounds: [
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "blocked" }
    ],
    routing: {
      rules: [
        { inboundTag: ["api-in"], outboundTag: "api", type: "field" },
        { outboundTag: "blocked", ip: ["geoip:private"], type: "field" }
      ]
    }
  };

  fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(fullConfig, null, 2), 'utf8');
  console.log(`[Config] Successfully wrote legacy Xray config to ${XRAY_CONFIG_PATH}`);
}

async function restartXray() {
  try {
    console.log(`[Service] Restarting Xray service (${XRAY_SERVICE_NAME})...`);
    await runCmd(`sudo systemctl restart ${XRAY_SERVICE_NAME}`);
    console.log(`[Service] Xray service restarted successfully.`);
  } catch (err) {
    console.error("[-] Failed to restart Xray service:", err.message);
  }
}

// ------------------------------------------------------------
// Stats Query & Reporting
// ------------------------------------------------------------

function fetchXrayStats(reset = true) {
  return new Promise((resolve) => {
    if (!statsClient) {
      return resolve([]);
    }
    statsClient.QueryStats({ pattern: "user>>>", reset }, (err, response) => {
      if (err) {
        console.error("[-] gRPC QueryStats failed:", err.message);
        return resolve([]);
      }

      const trafficMap = {};
      if (response && response.stat) {
        response.stat.forEach(item => {
          // Format: user>>>email>>>traffic>>>direction
          const parts = item.name.split('>>>');
          if (parts.length >= 4) {
            const email = parts[1];
            const direction = parts[3]; // uplink or downlink
            if (!trafficMap[email]) {
              trafficMap[email] = { email, uplink: 0, downlink: 0 };
            }
            trafficMap[email][direction] = Number(item.value);
          }
        });
      }

      resolve(Object.values(trafficMap));
    });
  });
}

async function reportCycle() {
  try {
    const userTraffic = await fetchXrayStats(true);
    const systemStats = {
      cpu_usage: getCpuUsage(),
      mem_usage: getMemUsage(),
      disk_usage: getDiskUsage(),
      uptime: getUptime(),
      os_type: getOsType(),
      network: getNetworkSpeeds()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'report',
        system_stats: systemStats,
        user_traffic: userTraffic
      }));
    }
  } catch (e) {
    console.error("[-] Error in report cycle:", e.message);
  }
}

const INTERVAL_PATH = '/etc/xray-daemon/interval.json';

function startReportCycle(intervalSeconds) {
  if (reportInterval) clearInterval(reportInterval);
  const ms = intervalSeconds * 1000;
  reportInterval = setInterval(reportCycle, ms);
  console.log(`[Config] Heartbeat and report interval set to ${intervalSeconds} seconds.`);
}

// ------------------------------------------------------------
// WebSocket Connection & Handshake
// ------------------------------------------------------------

function connectWS() {
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', NODE_SECRET)
    .update(NODE_ID + timestamp)
    .digest('hex');

  const wsUrl = `${CONTROLLER_URL}/api/node/ws?node_id=${encodeURIComponent(NODE_ID)}&timestamp=${timestamp}&signature=${signature}`;
  console.log(`[WebSocket] Connecting to central controller at: ${CONTROLLER_URL}`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log("[WebSocket] Connection established and authenticated successfully.");
    reconnectDelay = 2000;
    
    // Request initial config sync
    ws.send(JSON.stringify({ type: 'sync_request' }));

    // Report stats immediately upon connection
    reportCycle();

    // Start periodic reporting
    let interval = 30;
    try {
      if (fs.existsSync(INTERVAL_PATH)) {
        interval = JSON.parse(fs.readFileSync(INTERVAL_PATH, 'utf8')).interval || 30;
      }
    } catch (e) {}
    startReportCycle(interval);
  });

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      
      if (payload.event === 'SYNC_RESPONSE') {
        const inbounds = payload.data.inbounds || [];
        const report_interval = payload.data.report_interval || 30;
        console.log(`[WebSocket] Received SYNC_RESPONSE containing ${inbounds.length} inbounds.`);
        
        try {
          fs.writeFileSync(INTERVAL_PATH, JSON.stringify({ interval: report_interval }), 'utf8');
        } catch (e) {
          console.error("[-] Failed to save interval.json:", e.message);
        }
        startReportCycle(report_interval);
        
        // 1. Process UFW rules for the new inbounds
        const ports = inbounds.map(inb => inb.port);
        await applyUfwRules(ports);
        
        // Write config
        renderXrayConfig(inbounds, payload.data.config);
        
        if (payload.data.restart) {
          await restartXray();
        } else {
          console.log(`[Config] Skipped restart as requested by backend (silent sync).`);
        }
      } else if (payload.event === 'USER_ADD') {
        const { email, uuid, inbounds } = payload.data;
        console.log(`[WebSocket] Received USER_ADD for ${email}. Dynamically adding to ${inbounds?.length || 0} inbounds...`);
        for (const inb of (inbounds || [])) {
          try {
            const tmpFile = `/tmp/xray-adu-${uuid}-${inb.tag}.json`;
            const apiPayload = {
              inbounds: [
                {
                  port: inb.port || 443,
                  tag: inb.tag,
                  protocol: inb.protocol || "vless",
                  settings: {
                    decryption: "none",
                    clients: [
                      {
                        id: uuid,
                        email: email,
                        level: 0,
                        flow: inb.flow || ""
                      }
                    ]
                  }
                }
              ]
            };
            fs.writeFileSync(tmpFile, JSON.stringify(apiPayload));
            await runCmd(`xray api adu -server=${XRAY_API_ADDRESS} ${tmpFile}`);
            fs.unlinkSync(tmpFile);
            console.log(`[Xray API] Successfully added user ${email} to inbound ${inb.tag}`);
          } catch (e) {
            console.error(`[Xray API] Failed to add user ${email} to ${inb.tag}:`, e.message);
          }
        }
        // Request silent configuration sync to persist changes
        ws.send(JSON.stringify({ type: 'sync_request', restart: false }));

      } else if (payload.event === 'USER_DEL') {
        const { email, inbounds } = payload.data;
        console.log(`[WebSocket] Received USER_DEL for ${email}. Triggering sync and restart.`);
        // Report stats before losing the user's data completely
        await reportCycle();
        // For deletion, to ensure clean state and since it is rare, we request a full sync with restart
        ws.send(JSON.stringify({ type: 'sync_request', restart: true }));
      } else if (payload.event === 'FORCE_RELOAD') {
        console.log(`[WebSocket] Received FORCE_RELOAD. Triggering hard reload...`);
        await reportCycle();
        ws.send(JSON.stringify({ type: 'sync_request', restart: true }));
      } else if (payload.event === 'FORCE_REPORT') {
        console.log(`[WebSocket] Received FORCE_REPORT. Triggering immediate report cycle.`);
        await reportCycle();
      } else if (payload.event === 'RESTART_XRAY') {
        console.log(`[WebSocket] Received RESTART_XRAY. Executing restart...`);
        await restartXray();
      }
    } catch (e) {
      console.error("[-] Failed to process WS message:", e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WebSocket] Connection closed (code: ${code}, reason: ${reason || 'no reason'}). Reconnecting...`);
    handleReconnect();
  });

  ws.on('error', (err) => {
    console.error("[WebSocket] Socket error:", err.message);
  });
}

function handleReconnect() {
  if (reportInterval) clearInterval(reportInterval);
  ws = null;
  setTimeout(() => {
    connectWS();
    // Exponential backoff up to 60s
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  }, reconnectDelay);
}

// Start connection
connectWS();
