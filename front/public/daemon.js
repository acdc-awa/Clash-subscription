const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const http = require('http');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load environment variables
const NODE_ID = process.env.NODE_ID;
const NODE_SECRET = process.env.NODE_SECRET;
const DAEMON_PORT = process.env.DAEMON_PORT || 3000;
const XRAY_CONFIG_PATH = process.env.XRAY_CONFIG_PATH || '/usr/local/etc/xray/config.json';
const XRAY_SERVICE_NAME = process.env.XRAY_SERVICE_NAME || 'xray';
const XRAY_API_ADDRESS = process.env.XRAY_API_ADDRESS || '127.0.0.1:10085';
const PROTO_PATH = path.join(__dirname, 'xray.proto');
const STATE_PATH = '/etc/xray-daemon/state.json';
const DAEMON_VERSION = 'v1.0.0'; // Updated to Server Mode

if (!NODE_ID || !NODE_SECRET) {
  console.error("[-] Missing required environment variables (NODE_ID, NODE_SECRET)");
  process.exit(1);
}

// Global state variables
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
      const usePercentStr = parts[4];
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
    const rx_speed = duration > 0 ? Math.round((totalRx - lastNetMetrics.rx) / duration) : 0;
    const tx_speed = duration > 0 ? Math.round((totalTx - lastNetMetrics.tx) / duration) : 0;

    lastNetMetrics = { rx: totalRx, tx: totalTx, time: now };
    return { rx_speed, tx_speed, rx_total: totalRx, tx_total: totalTx };
  } catch (e) {
    return { rx_speed: 0, tx_speed: 0, rx_total: 0, tx_total: 0 };
  }
}

function getSystemStats() {
  return {
    cpu_usage: getCpuUsage(),
    mem_usage: getMemUsage(),
    disk_usage: getDiskUsage(),
    uptime: getUptime(),
    os_type: getOsType(),
    network: getNetworkSpeeds(),
    version: DAEMON_VERSION
  };
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
    fs.ensureDirSync(path.dirname(STATE_PATH)); // Usually exists
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ports: newPorts }), 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(STATE_PATH, JSON.stringify({ ports: newPorts }), 'utf8');
    } catch(err){}
  }
}

// ------------------------------------------------------------
// Xray Configuration Renderer
// ------------------------------------------------------------

function renderXrayConfig(inbounds, configObj) {
  if (configObj) {
    fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(configObj, null, 2), 'utf8');
    console.log(`[Config] Successfully wrote complete Xray config to ${XRAY_CONFIG_PATH}`);
    return;
  }
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
          const parts = item.name.split('>>>');
          if (parts.length >= 4) {
            const email = parts[1];
            const direction = parts[3]; 
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

// ------------------------------------------------------------
// Crypto Utils
// ------------------------------------------------------------

function encryptPayload(payload, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const payloadStr = JSON.stringify({ ...payload, _ts: Date.now() });
  let encrypted = cipher.update(payloadStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return { encryptedData: encrypted, iv: iv.toString('hex'), authTag: authTag };
}

function decryptPayload(data, secret) {
  try {
    const { encryptedData, iv, authTag } = data;
    if (!encryptedData || !iv || !authTag) return null;

    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    const payload = JSON.parse(decrypted);
    if (Math.abs(Date.now() - payload._ts) > 60000) {
      console.warn('[-] Payload timestamp expired');
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------
// HTTP Server (Passive Node Mode)
// ------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/sync') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const encryptedReq = JSON.parse(body);
        const payload = decryptPayload(encryptedReq, NODE_SECRET);
        
        if (!payload || payload.node_id !== String(NODE_ID)) {
          console.warn('[-] Unauthorized request or malformed payload');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }

        // We fetch stats FIRST before making any changes, so we don't lose pre-restart traffic
        const userTraffic = await fetchXrayStats(true);
        const systemStats = getSystemStats();

        // Process Action
        if (payload.action === 'SYNC') {
          console.log(`[API] Received SYNC command`);
          const { inbounds, config, restart } = payload;
          if (inbounds) {
             const ports = inbounds.map(inb => inb.port);
             await applyUfwRules(ports);
             renderXrayConfig(inbounds, config);
             if (restart) {
               await restartXray();
             }
          }
        } else if (payload.action === 'USER_ADD') {
          const { email, uuid, inbounds } = payload;
          console.log(`[API] Received USER_ADD for ${email}`);
          for (const inb of (inbounds || [])) {
            try {
              const tmpFile = `/tmp/xray-adu-${uuid}-${inb.tag}.json`;
              const apiPayload = {
                inbounds: [{
                  port: inb.port || 443, tag: inb.tag, protocol: inb.protocol || "vless",
                  settings: { decryption: "none", clients: [{ id: uuid, email: email, level: 0, flow: inb.flow || "" }] }
                }]
              };
              fs.writeFileSync(tmpFile, JSON.stringify(apiPayload));
              await runCmd(`xray api adu -server=${XRAY_API_ADDRESS} ${tmpFile}`);
              fs.unlinkSync(tmpFile);
              console.log(`[Xray API] Added user ${email} to ${inb.tag}`);
            } catch (e) {
              console.error(`[-] Failed to add user ${email}:`, e.message);
            }
          }
        } else if (payload.action === 'RESTART_XRAY') {
          console.log(`[API] Received RESTART_XRAY command`);
          await restartXray();
        } else if (payload.action === 'UPDATE_DAEMON') {
          const { download_url } = payload;
          console.log(`[API] Received UPDATE_DAEMON from ${download_url}`);
          try {
            await runCmd(`curl -sS -L -o /etc/xray-daemon/daemon.js ${download_url}/daemon.js`);
            await runCmd(`curl -sS -L -o /etc/xray-daemon/xray.proto ${download_url}/xray.proto`);
            console.log(`[Update] Daemon files updated successfully. Initiating self-restart...`);
            
            const responsePayload = { status: 'ok', message: 'Daemon updated successfully. Restarting...', system_stats: systemStats, user_traffic: userTraffic };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(encryptPayload(responsePayload, NODE_SECRET)));
            setTimeout(() => process.exit(0), 1000);
            return;
          } catch (e) {
             console.error(`[-] Update failed:`, e.message);
          }
        }

        // Return current stats as ACK
        const responsePayload = {
           status: 'ok',
           system_stats: systemStats,
           user_traffic: userTraffic
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(encryptPayload(responsePayload, NODE_SECRET)));

      } catch (err) {
        console.error('[-] Error processing request:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request' }));
      }
    });
  } else {
    // Silent drop
    res.writeHead(404);
    res.end();
  }
});

server.listen(DAEMON_PORT, '0.0.0.0', () => {
  console.log(`[+] Xray Daemon Server started on 0.0.0.0:${DAEMON_PORT} in passive mode.`);
});
