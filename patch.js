const fs = require('fs');

let code = fs.readFileSync('./backend/server.js', 'utf8');

// 1. Fix /api/nodes/:id/update_daemon
code = code.replace(/const ws = activeNodes\.get\(nodeId\);[\s\S]*?ws\.send\(JSON\.stringify\(\{ event: 'UPDATE_DAEMON' \}\)\);/, 
  `const fullUrl = req.protocol + '://' + req.get('host');
    syncNodeToDaemon(nodeId, 'UPDATE_DAEMON', { download_url: fullUrl });`);


// 2. Fix /api/nodes/:id (PUT)
code = code.replace(/const ws = activeNodes\.get\(oldId\);[\s\S]*?activeNodes\.delete\(oldId\);\n\s*\}/, 
  `triggerNodeConfigReload(newId);`);


// 3. Fix /api/nodes/:id (DELETE)
code = code.replace(/const ws = activeNodes\.get\(id\);[\s\S]*?activeNodes\.delete\(id\);\n\s*\}/, 
  `// Node deleted.`);


// 4. Fix dashboard stats
code = code.replace(/const onlineNodesCount = activeNodes\.size;\n\s*const totalNodesCount = db\.prepare\('SELECT COUNT\(\*\) as count FROM nodes'\)\.get\(\)\.count;\n\s*let totalRxSec = 0;\n\s*let totalTxSec = 0;\n\s*for \(const \[nodeId, ws\] of activeNodes\.entries\(\)\) \{[\s\S]*?\}/, 
  `const onlineNodesCount = db.prepare('SELECT COUNT(*) as count FROM node_sync_logs WHERE status = ? AND timestamp > ?').get('SYNC_OK', Math.floor(Date.now() / 1000) - 120).count;
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
    }`);

fs.writeFileSync('./backend/server.js', code);
console.log('Fixed activeNodes usages!');
