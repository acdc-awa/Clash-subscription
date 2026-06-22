require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// X-Proxy-Secret Verification Middleware
app.use((req, res, next) => {
  const expectedSecret = process.env.PROXY_SECRET;
  if (expectedSecret) {
    const clientSecret = req.headers['x-proxy-secret'];
    if (clientSecret !== expectedSecret) {
      return res.status(403).json({ error: '禁止访问：无效的代理密钥 (X-Proxy-Secret mismatch)' });
    }
  }
  next();
});

// API Authentication Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权：缺少 Authorization 头' });
  }
  const token = authHeader.slice(7);
  if (token !== process.env.API_TOKEN) {
    return res.status(403).json({ error: '禁止访问：Token 无效' });
  }
  next();
};

// Write operation log to database
const writeLog = (action, target, detail, req) => {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const time = new Date().toISOString();
  try {
    db.prepare('INSERT INTO logs (id, time, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, time, action, target, detail, ip);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
};

// ============================================================
// Node Endpoints
// ============================================================

app.get('/api/nodes', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM nodes').all();
    const nodes = rows.map(r => {
      try {
        return { id: r.id, ...JSON.parse(r.config) };
      } catch {
        return { id: r.id, name: r.name, type: r.type, server: r.server, port: r.port };
      }
    });
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/nodes/:id', authenticate, (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '节点不存在' });
    try {
      res.json({ id: row.id, ...JSON.parse(row.config) });
    } catch {
      res.json({ id: row.id, name: row.name, type: row.type, server: row.server, port: row.port });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nodes', authenticate, (req, res) => {
  try {
    const { id, isClone, ...nodeData } = req.body;
    if (!id) return res.status(400).json({ error: '缺少节点 ID' });

    const existing = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id);
    if (existing) return res.status(409).json({ error: `节点 "${id}" 已存在` });

    db.prepare('INSERT INTO nodes (id, name, type, server, port, config) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, nodeData.name || id, nodeData.type, nodeData.server, nodeData.port ? Number(nodeData.port) : null, JSON.stringify(nodeData));

    if (isClone) {
      writeLog('CLONE_NODE', id, `克隆节点 ${id}`, req);
    } else {
      writeLog('CREATE_NODE', id, `新增节点 ${id}`, req);
    }
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/nodes/:id', authenticate, (req, res) => {
  try {
    const id = req.params.id;
    const { id: _id, ...nodeData } = req.body;

    const existing = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '节点不存在' });

    db.prepare('UPDATE nodes SET name = ?, type = ?, server = ?, port = ?, config = ? WHERE id = ?')
      .run(nodeData.name || id, nodeData.type, nodeData.server, nodeData.port ? Number(nodeData.port) : null, JSON.stringify(nodeData), id);

    writeLog('UPDATE_NODE', id, `修改节点 ${id}`, req);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/nodes/:id', authenticate, (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '节点不存在' });

    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    writeLog('DELETE_NODE', id, `删除节点 ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// User Endpoints
// ============================================================

app.get('/api/users', authenticate, (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    for (const u of users) {
      const nodes = db.prepare('SELECT node_id FROM user_nodes WHERE user_uuid = ?').all(u.uuid);
      u.allowed_nodes = nodes.map(n => n.node_id);
    }
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:uuid', authenticate, (req, res) => {
  try {
    const uuid = req.params.uuid;
    const u = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const nodes = db.prepare('SELECT node_id FROM user_nodes WHERE user_uuid = ?').all(uuid);
    u.allowed_nodes = nodes.map(n => n.node_id);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticate, (req, res) => {
  try {
    const { uuid, remark, allowed_nodes, rule_template } = req.body;
    if (!uuid) return res.status(400).json({ error: '缺少 UUID' });

    const existing = db.prepare('SELECT 1 FROM users WHERE uuid = ?').get(uuid);
    if (existing) return res.status(409).json({ error: `用户 "${uuid}" 已存在` });

    db.transaction(() => {
      db.prepare('INSERT INTO users (uuid, remark, rule_template) VALUES (?, ?, ?)')
        .run(uuid, remark || '', rule_template || 'default');

      if (Array.isArray(allowed_nodes)) {
        const existingNodes = new Set(db.prepare('SELECT id FROM nodes').all().map(n => n.id));
        const insertStmt = db.prepare('INSERT INTO user_nodes (user_uuid, node_id) VALUES (?, ?)');
        for (const nodeId of allowed_nodes) {
          if (existingNodes.has(nodeId)) {
            insertStmt.run(uuid, nodeId);
          }
        }
      }
    })();

    writeLog('CREATE_USER', uuid, `新增用户 ${remark || uuid}`, req);
    res.status(201).json({ success: true, uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:uuid', authenticate, (req, res) => {
  try {
    const uuid = req.params.uuid;
    const { remark, allowed_nodes, rule_template } = req.body;

    const existing = db.prepare('SELECT 1 FROM users WHERE uuid = ?').get(uuid);
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    db.transaction(() => {
      db.prepare('UPDATE users SET remark = ?, rule_template = ? WHERE uuid = ?')
        .run(remark || '', rule_template || 'default', uuid);

      db.prepare('DELETE FROM user_nodes WHERE user_uuid = ?').run(uuid);

      if (Array.isArray(allowed_nodes)) {
        const existingNodes = new Set(db.prepare('SELECT id FROM nodes').all().map(n => n.id));
        const insertStmt = db.prepare('INSERT INTO user_nodes (user_uuid, node_id) VALUES (?, ?)');
        for (const nodeId of allowed_nodes) {
          if (existingNodes.has(nodeId)) {
            insertStmt.run(uuid, nodeId);
          }
        }
      }
    })();

    writeLog('UPDATE_USER', uuid, `修改用户 ${remark || uuid}`, req);
    res.json({ success: true, uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:uuid', authenticate, (req, res) => {
  try {
    const uuid = req.params.uuid;
    const existing = db.prepare('SELECT 1 FROM users WHERE uuid = ?').get(uuid);
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    db.prepare('DELETE FROM users WHERE uuid = ?').run(uuid);
    writeLog('DELETE_USER', uuid, `删除用户 ${uuid}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Rule Endpoints
// ============================================================

app.get('/api/rules', authenticate, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM rules').all();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rules/:name', authenticate, (req, res) => {
  try {
    const name = req.params.name;
    const rule = db.prepare('SELECT * FROM rules WHERE name = ?').get(name);
    if (!rule) return res.status(404).json({ error: '规则不存在' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules', authenticate, (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name) return res.status(400).json({ error: '缺少规则名称' });

    const existing = db.prepare('SELECT 1 FROM rules WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: `规则 "${name}" 已存在` });

    db.prepare('INSERT INTO rules (name, content) VALUES (?, ?)')
      .run(name, content || '');

    writeLog('CREATE_RULE', name, `新增规则 ${name}`, req);
    res.status(201).json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rules/:name', authenticate, (req, res) => {
  try {
    const name = req.params.name;
    const { content } = req.body;

    const existing = db.prepare('SELECT 1 FROM rules WHERE name = ?').get(name);
    if (!existing) return res.status(404).json({ error: '规则不存在' });

    db.prepare('UPDATE rules SET content = ? WHERE name = ?')
      .run(content || '', name);

    writeLog('UPDATE_RULE', name, `修改规则 ${name}`, req);
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rules/:name', authenticate, (req, res) => {
  try {
    const name = req.params.name;
    const existing = db.prepare('SELECT 1 FROM rules WHERE name = ?').get(name);
    if (!existing) return res.status(404).json({ error: '规则不存在' });

    db.prepare('DELETE FROM rules WHERE name = ?').run(name);
    writeLog('DELETE_RULE', name, `删除规则 ${name}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Log Endpoints
// ============================================================

app.get('/api/logs', authenticate, (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM logs ORDER BY time DESC LIMIT 200').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/logs', authenticate, (req, res) => {
  try {
    db.prepare('DELETE FROM logs').run();
    writeLog('CLEAR_LOGS', '-', '清空操作日志', req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Clash Subscription Endpoint
// ============================================================

app.get('/:uuid', async (req, res) => {
  const { uuid } = req.params;
  if (!uuid || uuid.includes("/") || uuid === 'favicon.ico') {
    return res.status(404).send("Not Found");
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
    if (!user) {
      return res.status(404).send("Config not found");
    }

    const ruleTemplateName = user.rule_template || "default";
    const ruleRow = db.prepare('SELECT content FROM rules WHERE name = ?').get(ruleTemplateName);
    if (!ruleRow) {
      return res.status(404).send(`Rule template "${ruleTemplateName}" not found`);
    }
    const ruleTemplate = ruleRow.content;

    // Get nodes allowed for this user
    const allowedNodeRows = db.prepare(`
      SELECT n.* FROM nodes n
      JOIN user_nodes un ON n.id = un.node_id
      WHERE un.user_uuid = ?
    `).all(uuid);

    const nodes = allowedNodeRows.map(row => {
      try {
        const nodeObj = JSON.parse(row.config);
        nodeObj.uuid = uuid;
        nodeObj.id = row.id;
        return nodeObj;
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Get all node IDs to determine unallowed ones
    const allNodeRows = db.prepare('SELECT id FROM nodes').all();
    const allNodeIds = allNodeRows.map(row => row.id);
    const allowedNodeIds = nodes.map(n => n.id);
    const unallowedNodeIds = allNodeIds.filter(id => !allowedNodeIds.includes(id));

    const finalYaml = injectProxies(ruleTemplate, nodes, unallowedNodeIds);

    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${uuid}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.send(finalYaml);

  } catch (err) {
    console.error(err);
    return res.status(500).send(`Internal Server Error: ${err.message}`);
  }
});

// ============================================================
// YAML Serialization & Injection Helpers
// ============================================================

function serializeNodeToYaml(node, indentSize = 2) {
  const indent = " ".repeat(indentSize);
  let yaml = `${indent}- name: ${formatYamlValue(node.name)}\n`;
  
  const keys = Object.keys(node).filter(k => k !== "name" && k !== "id");
  for (const key of keys) {
    const val = node[key];
    if (typeof val === "object" && val !== null) {
      yaml += `${indent}  ${key}:\n`;
      for (const [subKey, subVal] of Object.entries(val)) {
        yaml += `${indent}    ${subKey}: ${formatYamlValue(subVal)}\n`;
      }
    } else {
      yaml += `${indent}  ${key}: ${formatYamlValue(val)}\n`;
    }
  }
  return yaml;
}

function formatYamlValue(val) {
  if (typeof val === "string") {
    if (
      val === "" || 
      /[:#\s,\[\]{}&*!|>]/.test(val) || 
      val.toLowerCase() === "true" || 
      val.toLowerCase() === "false"
    ) {
      return JSON.stringify(val);
    }
    return val;
  }
  return JSON.stringify(val);
}

function injectProxies(template, allowedNodes, unallowedNodeIds) {
  let result = template;

  const hasProxiesPlaceholder = /=[Pp][Rr][Oo][Xx][Ii][Ee][Ss]=/i.test(template);
  if (hasProxiesPlaceholder) {
    result = result.replace(/([ \t]*)#?\s*=[Pp][Rr][Oo][Xx][Ii][Ee][Ss]=\s*/g, (match, spaces) => {
      if (allowedNodes.length === 0) {
        return "proxies: []\n";
      }
      const formattedProxies = allowedNodes.map(node => serializeNodeToYaml(node, spaces.length)).join("");
      return `proxies:\n${formattedProxies}`;
    });
  } else {
    if (allowedNodes.length === 0) {
      result = "proxies: []\n" + result;
    } else {
      const formattedProxies = allowedNodes.map(node => serializeNodeToYaml(node, 0)).join("");
      result = `proxies:\n${formattedProxies}${result}`;
    }
  }

  result = result.replace(/([ \t]*)-[ \t]*(?:"all"|'all'|all)[ \t]*(?:#.*)?(\r?\n|$)/gi, (match, spaces, newline) => {
    if (allowedNodes.length === 0) {
      return "";
    }
    const suffix = newline || "";
    return allowedNodes.map(node => `${spaces}- ${JSON.stringify(node.name)}`).join("\n") + suffix;
  });

  for (const node of allowedNodes) {
    const id = node.id;
    const escapedId = escapeRegExp(id);
    const name = node.name;
    const quotedName = JSON.stringify(name);

    const listItemRegex = new RegExp(`-[ \\t]*(?:"${escapedId}"|'${escapedId}'|\\b${escapedId}\\b)`, "g");
    result = result.replace(listItemRegex, `- ${quotedName}`);

    const ruleRegex = new RegExp(`,[ \\t]*(?:"${escapedId}"|'${escapedId}'|\\b${escapedId}\\b)`, "g");
    result = result.replace(ruleRegex, `,${quotedName}`);

    const valueRegex = new RegExp(`:[ \\t]*(?:"${escapedId}"|'${escapedId}'|\\b${escapedId}\\b)`, "g");
    result = result.replace(valueRegex, `: ${quotedName}`);
  }

  for (const id of unallowedNodeIds) {
    const escapedId = escapeRegExp(id);
    const regex = new RegExp(`^[ \\t]*-[ \\t]*(?:[^\\n]*?,[ \\t]*)?(?:"${escapedId}"|'${escapedId}'|\\b${escapedId}\\b)[ \\t]*(?:#.*)?$\\n?`, "gm");
    result = result.replace(regex, "");
  }

  return result;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.listen(PORT, () => {
  console.log(`VPS Clash Sub Backend service listening on port ${PORT}`);
});
