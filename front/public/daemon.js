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

function renderXrayConfig(inbounds) {
  // Wrap incoming proxy inbounds with API and routing layers
  const fullConfig = {
    log: {
      loglevel: "warning"
    },
    api: {
      tag: "api",
      services: [
        "HandlerService",
        "StatsService"
      ]
    },
    stats: {},
    policy: {
      levels: {
        "0": {
          "statsUserUplink": true,
          "statsUserDownlink": true
        }
      },
      system: {
        "statsInboundUplink": true,
        "statsInboundDownlink": true
      }
    },
    inbounds: [
      ...inbounds,
      {
        listen: "127.0.0.1",
        port: 10085,
        protocol: "dokodemo-door",
        settings: {
          address: "127.0.0.1"
        },
        tag: "api-in"
      }
    ],
    outbounds: [
      {
        protocol: "freedom",
        tag: "direct"
      },
      {
        protocol: "blackhole",
        tag: "blocked"
      }
    ],
    routing: {
      rules: [
        {
          inboundTag: ["api-in"],
          outboundTag: "api",
          type: "field"
        },
        {
          outboundTag: "blocked",
          ip: ["geoip:private"],
          type: "field"
        }
      ]
    }
  };

  fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(fullConfig, null, 2), 'utf8');
  console.log(`[Config] Successfully wrote Xray config to ${XRAY_CONFIG_PATH}`);
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
          // Format: user>>>email>>>direction
          const parts = item.name.split('>>>');
          if (parts.length >= 3) {
            const email = parts[1];
            const direction = parts[2]; // uplink or downlink
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

    // Start periodic reporting (every 30 seconds)
    if (reportInterval) clearInterval(reportInterval);
    reportInterval = setInterval(reportCycle, 30000);
  });

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      
      if (payload.event === 'SYNC_RESPONSE') {
        const inbounds = payload.data.inbounds || [];
        console.log(`[WebSocket] Received SYNC_RESPONSE containing ${inbounds.length} inbounds.`);
        
        // Extract ports to configure firewall rules
        const ports = inbounds.map(inb => inb.port);
        await applyUfwRules(ports);
        
        // Write config and restart Xray
        renderXrayConfig(inbounds);
        await restartXray();
      } else if (payload.event === 'FORCE_RELOAD' || payload.event === 'USER_ADD' || payload.event === 'USER_DEL') {
        console.log(`[WebSocket] Received event [${payload.event}]. Triggering reload...`);
        // Report latest stats first to prevent count loss
        await reportCycle();
        // Request fresh configuration
        ws.send(JSON.stringify({ type: 'sync_request' }));
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
