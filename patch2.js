const fs = require('fs');

let code = fs.readFileSync('./backend/server.js', 'utf8').replace(/\r\n/g, '\n');

const s1 = `    const ws = activeNodes.get(nodeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return res.status(400).json({ error: \`节点 \${nodeId} 目前不在线，无法下发更新指令。\` });
    }
    
    // Push update command to daemon
    ws.send(JSON.stringify({ event: 'UPDATE_DAEMON' }));`;

const r1 = `    const fullUrl = req.protocol + '://' + req.get('host');
    syncNodeToDaemon(nodeId, 'UPDATE_DAEMON', { download_url: fullUrl });`;


const s2 = `    const ws = activeNodes.get(oldId);
    if (ws) {
      ws.close(4000, '节点信息更改，强制重连');
      activeNodes.delete(oldId);
    }`;

const r2 = `    triggerNodeConfigReload(newId);`;


const s3 = `    const ws = activeNodes.get(id);
    if (ws) {
      ws.close(4000, '节点已被删除');
      activeNodes.delete(id);
    }`;

const r3 = ``;

const s4 = `    const onlineNodesCount = activeNodes.size;
    const totalNodesCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    
    let totalRxSec = 0;
    let totalTxSec = 0;
    for (const [nodeId, ws] of activeNodes.entries()) {
      const stats = db.prepare('SELECT network_rx, network_tx FROM node_stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1').get(nodeId);
      if (stats) {
        totalRxSec += stats.network_rx;
        totalTxSec += stats.network_tx;
      }
    }`;

const r4 = `    const onlineNodesCount = db.prepare('SELECT COUNT(*) as count FROM node_sync_logs WHERE status = ? AND timestamp > ?').get('SYNC_OK', Math.floor(Date.now() / 1000) - 120).count;
    const totalNodesCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    
    let totalRxSec = 0;
    let totalTxSec = 0;
    const onlineNodes = db.prepare('SELECT node_id FROM node_sync_logs WHERE status = ? AND timestamp > ?').all('SYNC_OK', Math.floor(Date.now() / 1000) - 120);
    
    for (const node of onlineNodes) {
      const stats = db.prepare('SELECT network_rx, network_tx FROM node_stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1').get(node.node_id);
      if (stats) {
        totalRxSec += stats.network_rx;
        totalTxSec += stats.network_tx;
      }
    }`;

code = code.replace(s1, r1);
code = code.replace(s2, r2);
code = code.replace(s3, r3);
code = code.replace(s4, r4);

fs.writeFileSync('./backend/server.js', code);
console.log('Fixed activeNodes usages! (Normalized LF)');
