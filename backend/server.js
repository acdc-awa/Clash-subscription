require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
let JWT_SECRET = process.env.JWT_SECRET;
let JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  if (!JWT_SECRET) JWT_SECRET = crypto.randomBytes(32).toString('hex');
  if (!JWT_REFRESH_SECRET) JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
  
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}
    
    let toAppend = '';
    if (!envContent.includes('JWT_SECRET=')) toAppend += `\nJWT_SECRET=${JWT_SECRET}\n`;
    if (!envContent.includes('JWT_REFRESH_SECRET=')) toAppend += `\nJWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}\n`;
    
    if (toAppend) {
      fs.appendFileSync(envPath, toAppend);
      console.warn('[Security] JWT_SECRET/JWT_REFRESH_SECRET 未配置，已自动生成并持久化到 .env 文件。');
    }
  } catch (e) {
    console.warn('[Security] JWT 密钥自动生成（仅本次运行有效，无法写入 .env）。');
  }
}

app.use(cors());
app.use(express.json());

// Map to store active node WebSocket connections (nodeId -> WebSocket)
const activeNodes = new Map();

// Helper to push user modification event to active nodes
function pushUserEventToAllowedNodes(userUuid, email, eventType) {
  try {
    const allowedNodeRows = db.prepare(`
      SELECT DISTINCT i.node_id FROM package_inbounds pi
      JOIN inbounds i ON pi.inbound_id = i.id
      JOIN users u ON u.package_id = pi.package_id
      WHERE u.uuid = ?
    `).all(userUuid);
    const nodeIds = allowedNodeRows.map(r => r.node_id);
    
    for (const nodeId of nodeIds) {
      const ws = activeNodes.get(nodeId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Fetch inbound details for the user on this node
        const inbounds = db.prepare(`
          SELECT i.port, i.network, i.security FROM inbounds i
          JOIN package_inbounds pi ON i.id = pi.inbound_id
          JOIN users u ON u.package_id = pi.package_id
          WHERE i.node_id = ? AND u.uuid = ?
        `).all(nodeId, userUuid);
        const inboundDetails = inbounds.map(inb => ({
          tag: `${nodeId}_${inb.port}`,
          port: inb.port,
          protocol: 'vless',
          flow: inb.network === 'tcp' && inb.security === 'reality' ? 'xtls-rprx-vision' : ''
        }));

        if (eventType === 'USER_ADD') {
          ws.send(JSON.stringify({ event: 'USER_ADD', data: { email, uuid: userUuid, inbounds: inboundDetails } }));
        } else if (eventType === 'USER_DEL') {
          ws.send(JSON.stringify({ event: 'USER_DEL', data: { email, inbounds: inboundDetails } }));
        }
      }
    }
  } catch (err) {
    console.error('Failed to push user event to nodes:', err);
  }
}

// Helper to push user addition to specific node
function pushUserAddtoNode(nodeId, email, userUuid) {
  const ws = activeNodes.get(nodeId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    const inbounds = db.prepare(`
      SELECT i.port, i.network, i.security FROM inbounds i
      JOIN package_inbounds pi ON i.id = pi.inbound_id
      JOIN users u ON u.package_id = pi.package_id
      WHERE i.node_id = ? AND u.uuid = ?
    `).all(nodeId, userUuid);
    const inboundDetails = inbounds.map(inb => ({
      tag: `${nodeId}_${inb.port}`,
      flow: inb.network === 'tcp' && inb.security === 'reality' ? 'xtls-rprx-vision' : ''
    }));
    ws.send(JSON.stringify({ event: 'USER_ADD', data: { email, uuid: userUuid, inbounds: inboundDetails } }));
  }
}

// Helper to push user deletion to specific node
function pushUserDelFromNode(nodeId, email) {
  const ws = activeNodes.get(nodeId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'USER_DEL', data: { email } }));
  }
}

// Helper to trigger config reload on a node
function triggerNodeConfigReload(nodeId) {
  const ws = activeNodes.get(nodeId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'FORCE_RELOAD' }));
  }
}

// ------------------------------------------------------------
// Middlewares
// ------------------------------------------------------------

// X-Proxy-Secret Verification Middleware (Only for API and uuid-sub routes)
app.use((req, res, next) => {
  const requestPath = req.path;
  const isApi = requestPath.startsWith('/api/');
  const isSubscribe = requestPath.startsWith('/subscribe/');
  
  if (isApi || isSubscribe) {
    const expectedSecret = process.env.PROXY_SECRET;
    if (expectedSecret) {
      const clientSecret = req.headers['x-proxy-secret'];
      if (clientSecret !== expectedSecret) {
        return res.status(403).json({ error: '禁止访问：无效的代理密钥 (X-Proxy-Secret mismatch)' });
      }
    }
  }
  next();
});

// JWT Authentication Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权：缺少 Authorization 头部' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Contains { uuid, email, role }
    next();
  } catch (err) {
    return res.status(403).json({ error: '禁止访问：Token 无效或已过期' });
  }
};

// Admin Authorization Middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '禁止访问：需要管理员权限' });
  }
  next();
};

// Operation Logger
const writeLog = (action, target, detail, req) => {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ip = req ? (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown') : 'system';
  const time = new Date().toISOString();
  try {
    db.prepare('INSERT INTO logs (id, time, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, time, action, target, detail, ip);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
};

// ------------------------------------------------------------
// Authentication Endpoints
// ------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: '请输入邮箱和密码' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: `该账户已停用或已过期 (Status: ${user.status})` });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { uuid: user.uuid, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { uuid: user.uuid },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Save refresh token to db
    db.prepare('UPDATE users SET refresh_token = ? WHERE uuid = ?').run(refreshToken, user.uuid);

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        uuid: user.uuid,
        email: user.email,
        role: user.role,
        token: user.token,
        need_password_change: user.need_password_change === 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/change-password', authenticate, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: '新密码长度至少为 6 位' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(req.user.uuid);
    if (!user) {
      return res.status(404).json({ error: '用户未找到' });
    }

    if (user.need_password_change === 0) {
      if (!old_password) return res.status(400).json({ error: '请输入旧密码' });
      const match = bcrypt.compareSync(old_password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: '旧密码输入错误' });
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(new_password, salt);

    db.prepare('UPDATE users SET password_hash = ?, need_password_change = 0, refresh_token = NULL WHERE uuid = ?')
      .run(hash, req.user.uuid);

    writeLog('CHANGE_PASSWORD', req.user.email, '修改了个人账户密码', req);
    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: '未提供 Refresh Token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(decoded.uuid);

    if (!user || user.status !== 'active' || user.refresh_token !== refreshToken) {
      return res.status(403).json({ error: '无效的 Refresh Token 或账户状态异常' });
    }

    const token = jwt.sign(
      { uuid: user.uuid, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ success: true, token });
  } catch (err) {
    res.status(403).json({ error: 'Refresh Token 已过期或无效' });
  }
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  try {
    db.prepare('UPDATE users SET refresh_token = NULL WHERE uuid = ?').run(req.user.uuid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// User Panel Endpoints (For Regular Users)
// ------------------------------------------------------------

app.get('/api/user/profile', authenticate, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT u.uuid, u.email, u.role, u.used_traffic, u.expiry_time, u.activation_time, u.status, u.token, p.name as package_name, p.traffic as total_traffic 
      FROM users u
      LEFT JOIN packages p ON u.package_id = p.id
      WHERE u.uuid = ?
    `).get(req.user.uuid);

    if (!user) return res.status(404).json({ error: '用户不存在' });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/nodes', authenticate, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT n.id, n.name, n.server FROM nodes n
      JOIN inbounds i ON n.id = i.node_id
      JOIN package_inbounds pi ON i.id = pi.inbound_id
      JOIN users u ON u.package_id = pi.package_id
      WHERE u.uuid = ?
    `).all(req.user.uuid);

    const nodes = rows.map(node => {
      const stats = db.prepare('SELECT cpu_usage, mem_usage, online_users FROM node_stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1').get(node.id);
      const inboundsCount = db.prepare('SELECT COUNT(*) as count FROM inbounds WHERE node_id = ?').get(node.id).count;
      
      return {
        ...node,
        inbounds_count: inboundsCount,
        online: activeNodes.has(node.id),
        cpu_usage: stats ? stats.cpu_usage : 0,
        mem_usage: stats ? stats.mem_usage : 0,
        online_users: stats ? stats.online_users : 0
      };
    });

    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Admin Panel: Node Management (Role == 'admin')
// ------------------------------------------------------------

app.get('/api/nodes', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM nodes').all();
    const nodes = rows.map(r => {
      const stats = db.prepare('SELECT cpu_usage, mem_usage, online_users, network_rx, network_tx FROM node_stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1').get(r.id);
      const inboundsCount = db.prepare('SELECT COUNT(*) as count FROM inbounds WHERE node_id = ?').get(r.id).count;

      return {
        id: r.id,
        name: r.name,
        server: r.server,
        secret: r.secret,
        multiplier: r.multiplier || 1.0,
        advanced_config: r.advanced_config ? JSON.parse(r.advanced_config) : {},
        inbounds_count: inboundsCount,
        online: activeNodes.has(r.id),
        cpu_usage: stats ? stats.cpu_usage : 0,
        mem_usage: stats ? stats.mem_usage : 0,
        online_users: stats ? stats.online_users : 0,
        network_rx: stats ? stats.network_rx : 0,
        network_tx: stats ? stats.network_tx : 0
      };
    });
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nodes', authenticate, requireAdmin, (req, res) => {
  try {
    const { id, name, server, multiplier, advanced_config } = req.body;
    if (!id || !name || !server) {
      return res.status(400).json({ error: '请填齐节点服务器基础信息' });
    }

    const existing = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id);
    if (existing) return res.status(409).json({ error: `节点 ID "${id}" 已存在` });

    // Generate random secret for the node connection
    const nodeSecret = crypto.randomBytes(16).toString('hex');
    const mult = multiplier !== undefined ? Number(multiplier) : 1.0;
    const advConfStr = advanced_config ? JSON.stringify(advanced_config) : '{}';

    db.prepare('INSERT INTO nodes (id, name, server, secret, multiplier, advanced_config) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, server, nodeSecret, mult, advConfStr);

    writeLog('CREATE_NODE', id, `新增服务器节点 ${name} (${id})，倍率 ${mult}`, req);
    res.status(201).json({ success: true, id, secret: nodeSecret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/nodes/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const oldId = req.params.id;
    const { id: newId, name, server, multiplier, advanced_config } = req.body;
    if (!newId || !name || !server) {
      return res.status(400).json({ error: '请填齐服务器信息' });
    }

    const node = db.prepare('SELECT secret FROM nodes WHERE id = ?').get(oldId);
    if (!node) return res.status(404).json({ error: '节点不存在' });

    if (newId !== oldId) {
      const conflict = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(newId);
      if (conflict) return res.status(409).json({ error: `节点 ID "${newId}" 已存在` });
    }

    const mult = multiplier !== undefined ? Number(multiplier) : 1.0;
    const advConfStr = advanced_config ? JSON.stringify(advanced_config) : '{}';

    db.transaction(() => {
      db.prepare('UPDATE nodes SET id = ?, name = ?, server = ?, multiplier = ?, advanced_config = ? WHERE id = ?')
        .run(newId, name, server, mult, advConfStr, oldId);

      // 修复 inbound 主键：node_id 通过级联更新了，但 id 前缀仍是旧 node_id
      if (newId !== oldId) {
        const inbs = db.prepare('SELECT id, port FROM inbounds WHERE node_id = ?').all(newId);
        const updateInbStmt = db.prepare('UPDATE inbounds SET id = ? WHERE id = ?');
        for (const inb of inbs) {
          const newInbId = `${newId}_${inb.port}`;
          if (inb.id !== newInbId) {
            updateInbStmt.run(newInbId, inb.id);
          }
        }
      }
    })();

    // Disconnect old WebSocket to force daemon reconnect and reload config
    const ws = activeNodes.get(oldId);
    if (ws) {
      ws.close(4000, '节点信息更改，强制重连');
      activeNodes.delete(oldId);
    }

    writeLog('UPDATE_NODE', newId, `修改了服务器节点 ${oldId} -> ${newId}，倍率 ${mult}`, req);
    res.json({ success: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/nodes/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '节点不存在' });

    // Disconnect daemon
    const ws = activeNodes.get(id);
    if (ws) {
      ws.close(4000, '节点已被删除');
      activeNodes.delete(id);
    }

    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    writeLog('DELETE_NODE', id, `删除了服务器节点 ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Admin Panel: Inbound Management (Role == 'admin')
// ------------------------------------------------------------

app.get('/api/inbounds', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM inbounds').all();
    const inbounds = rows.map(r => ({ ...r, config: JSON.parse(r.config) }));
    res.json(inbounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/nodes/:nodeId/inbounds', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM inbounds WHERE node_id = ?').all(req.params.nodeId);
    const inbounds = rows.map(r => ({ ...r, config: JSON.parse(r.config) }));
    res.json(inbounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inbounds', authenticate, requireAdmin, (req, res) => {
  try {
    const { node_id, port, protocol, network, security, config } = req.body;
    if (!node_id || !port || !protocol || !network || !security) {
      return res.status(400).json({ error: '请填齐入站配置的核心字段' });
    }

    // Check if port conflict on the same node
    const conflict = db.prepare('SELECT 1 FROM inbounds WHERE node_id = ? AND port = ?').get(node_id, Number(port));
    if (conflict) {
      return res.status(409).json({ error: `该节点端口 ${port} 已经被占用` });
    }

    const id = `${node_id}_${port}`;
    db.prepare('INSERT INTO inbounds (id, node_id, port, protocol, network, security, config) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, node_id, Number(port), protocol, network, security, JSON.stringify(config || {}));

    // Trigger config reload for the node
    triggerNodeConfigReload(node_id);

    writeLog('CREATE_INBOUND', id, `为节点 ${node_id} 新增了入站规则: 端口 ${port} (${protocol}/${network}/${security})`, req);
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inbounds/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const { port, protocol, network, security, config } = req.body;
    if (!port || !protocol || !network || !security) {
      return res.status(400).json({ error: '请填齐入站配置的核心字段' });
    }

    const inbound = db.prepare('SELECT node_id, port FROM inbounds WHERE id = ?').get(id);
    if (!inbound) return res.status(404).json({ error: '入站配置不存在' });

    if (Number(port) !== inbound.port) {
      const conflict = db.prepare('SELECT 1 FROM inbounds WHERE node_id = ? AND port = ?').get(inbound.node_id, Number(port));
      if (conflict) return res.status(409).json({ error: `该节点端口 ${port} 已经被占用` });
    }

    const newId = `${inbound.node_id}_${port}`;
    db.transaction(() => {
      db.prepare('UPDATE inbounds SET id = ?, port = ?, protocol = ?, network = ?, security = ?, config = ? WHERE id = ?')
        .run(newId, Number(port), protocol, network, security, JSON.stringify(config || {}), id);
    })();

    // Trigger config reload for the node
    triggerNodeConfigReload(inbound.node_id);

    writeLog('UPDATE_INBOUND', newId, `修改了入站规则 ${id} -> 端口 ${port}`, req);
    res.json({ success: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inbounds/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const inbound = db.prepare('SELECT node_id FROM inbounds WHERE id = ?').get(id);
    if (!inbound) return res.status(404).json({ error: '入站配置不存在' });

    db.prepare('DELETE FROM inbounds WHERE id = ?').run(id);
    
    // Trigger config reload for the node
    triggerNodeConfigReload(inbound.node_id);

    writeLog('DELETE_INBOUND', id, `删除了入站规则 ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Admin Panel: User Management (Role == 'admin')
// ------------------------------------------------------------

app.get('/api/users', authenticate, requireAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT uuid, email, role, package_id, used_traffic, expiry_time, activation_time, status, need_password_change, token FROM users').all();
    for (const u of users) {
      const pkg = u.package_id ? db.prepare('SELECT traffic FROM packages WHERE id = ?').get(u.package_id) : null;
      u.total_traffic = pkg ? pkg.traffic : 0;
      
      const nodes = u.package_id ? db.prepare(`
        SELECT DISTINCT i.node_id FROM package_inbounds pi
        JOIN inbounds i ON pi.inbound_id = i.id
        WHERE pi.package_id = ?
      `).all(u.package_id) : [];
      u.allowed_nodes = nodes.map(n => n.node_id);
    }
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticate, requireAdmin, (req, res) => {
  try {
    const { email, password, role, package_id, expiry_time } = req.body;
    if (!email) return res.status(400).json({ error: '请输入用户邮箱' });

    const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: `用户邮箱 "${email}" 已存在` });

    const userUuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const userPassword = password || userUuid;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(userPassword, salt);
    const token = crypto.createHash('sha256').update(userUuid).digest('hex');

    let calculatedExpiry = expiry_time || null;
    let calculatedActivation = null;

    if (package_id) {
      const pkg = db.prepare('SELECT duration_days, expiration_policy FROM packages WHERE id = ?').get(package_id);
      if (pkg) {
        if (pkg.expiration_policy === 'immediate') {
          const exp = new Date();
          exp.setDate(exp.getDate() + pkg.duration_days);
          calculatedExpiry = exp.toISOString().split('T')[0];
          calculatedActivation = new Date().toISOString();
        } else {
          // 'first_use' policy
          calculatedExpiry = null;
          calculatedActivation = null;
        }
      }
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (uuid, email, password_hash, role, package_id, expiry_time, activation_time, status, need_password_change, token) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userUuid,
        email,
        hash,
        role || 'user',
        package_id || null,
        calculatedExpiry,
        calculatedActivation,
        'active',
        password ? 0 : 1,
        token
      );
    })();

    // Push addition event to allowed nodes if they are online
    pushUserEventToAllowedNodes(userUuid, email, 'USER_ADD');

    writeLog('CREATE_USER', email, `新增用户 ${email} (${role})`, req);
    res.status(201).json({ success: true, uuid: userUuid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ error: '该邮箱地址已被注册，请更换！' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:uuid', authenticate, requireAdmin, (req, res) => {
  try {
    const userUuid = req.params.uuid;
    const { email, password, role, package_id, expiry_time, activation_time, status } = req.body;

    const oldUser = db.prepare('SELECT email, status, package_id, expiry_time, activation_time FROM users WHERE uuid = ?').get(userUuid);
    if (!oldUser) return res.status(404).json({ error: '用户不存在' });

    // Calculate old allowed nodes
    const oldAllowedNodeRows = oldUser.package_id ? db.prepare(`
      SELECT DISTINCT i.node_id FROM package_inbounds pi
      JOIN inbounds i ON pi.inbound_id = i.id
      WHERE pi.package_id = ?
    `).all(oldUser.package_id) : [];
    const oldAllowedNodes = oldAllowedNodeRows.map(r => r.node_id);

    let finalExpiry = expiry_time !== undefined ? expiry_time : oldUser.expiry_time;
    let finalActivation = activation_time !== undefined ? activation_time : oldUser.activation_time;

    // Reset expiry if package is updated
    if (package_id !== undefined && package_id !== oldUser.package_id) {
      if (package_id) {
        const pkg = db.prepare('SELECT duration_days, expiration_policy FROM packages WHERE id = ?').get(package_id);
        if (pkg) {
          if (pkg.expiration_policy === 'immediate') {
            const exp = new Date();
            exp.setDate(exp.getDate() + pkg.duration_days);
            finalExpiry = exp.toISOString().split('T')[0];
            finalActivation = new Date().toISOString();
          } else {
            finalExpiry = null;
            finalActivation = null;
          }
        }
      } else {
        finalExpiry = null;
        finalActivation = null;
      }
    }

    db.transaction(() => {
      if (password) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);
        db.prepare('UPDATE users SET email = ?, password_hash = ?, role = ?, package_id = ?, expiry_time = ?, activation_time = ?, status = ?, need_password_change = 0 WHERE uuid = ?')
          .run(email, hash, role, package_id || null, finalExpiry, finalActivation, status || 'active', userUuid);
      } else {
        db.prepare('UPDATE users SET email = ?, role = ?, package_id = ?, expiry_time = ?, activation_time = ?, status = ? WHERE uuid = ?')
          .run(email, role, package_id || null, finalExpiry, finalActivation, status || 'active', userUuid);
      }
    })();

    // Calculate new allowed nodes
    const newUser = db.prepare('SELECT email, status, package_id FROM users WHERE uuid = ?').get(userUuid);
    const newAllowedNodeRows = newUser.package_id ? db.prepare(`
      SELECT DISTINCT i.node_id FROM package_inbounds pi
      JOIN inbounds i ON pi.inbound_id = i.id
      WHERE pi.package_id = ?
    `).all(newUser.package_id) : [];
    const newAllowedNodes = newAllowedNodeRows.map(r => r.node_id);

    const isNowActive = (status || newUser.status) === 'active';

    if (!isNowActive) {
      for (const nId of oldAllowedNodes) {
        pushUserDelFromNode(nId, oldUser.email);
      }
    } else {
      const removedNodes = oldAllowedNodes.filter(x => !newAllowedNodes.includes(x));
      for (const nId of removedNodes) {
        pushUserDelFromNode(nId, oldUser.email);
      }

      const addedNodes = newAllowedNodes.filter(x => !oldAllowedNodes.includes(x));
      for (const nId of addedNodes) {
        pushUserAddtoNode(nId, email || oldUser.email, userUuid);
      }

      // If email changed, handle update on overlapping nodes
      if (email && email !== oldUser.email) {
        const intersectNodes = oldAllowedNodes.filter(x => newAllowedNodes.includes(x));
        for (const nId of intersectNodes) {
          pushUserDelFromNode(nId, oldUser.email);
          pushUserAddtoNode(nId, email, userUuid);
        }
      }
    }

    writeLog('UPDATE_USER', email || oldUser.email, `更新用户资料`, req);
    res.json({ success: true, uuid: userUuid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ error: '该邮箱地址已被注册，请更换！' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:uuid', authenticate, requireAdmin, (req, res) => {
  try {
    const userUuid = req.params.uuid;
    const user = db.prepare('SELECT email FROM users WHERE uuid = ?').get(userUuid);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    // Kick user from nodes dynamically first
    pushUserEventToAllowedNodes(userUuid, user.email, 'USER_DEL');

    db.prepare('DELETE FROM users WHERE uuid = ?').run(userUuid);

    writeLog('DELETE_USER', user.email, `删除了用户账户 ${user.email}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Admin Panel: Package/Plans Management
// ------------------------------------------------------------

app.get('/api/packages', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM packages').all();
    const packages = rows.map(p => {
      const allowedInboundRows = db.prepare('SELECT inbound_id FROM package_inbounds WHERE package_id = ?').all(p.id);
      return {
        ...p,
        allowed_inbounds: allowedInboundRows.map(r => r.inbound_id)
      };
    });
    res.json(packages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/packages', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, traffic, duration_days, price, rule_template, expiration_policy, allowed_inbounds } = req.body;
    if (!name || !traffic || !duration_days || price == null) {
      return res.status(400).json({ error: '套餐数据未填完整' });
    }
    const id = `${Date.now()}_pkg`;
    const rt = rule_template || 'default';
    const ep = expiration_policy || 'immediate';

    db.transaction(() => {
      db.prepare('INSERT INTO packages (id, name, traffic, duration_days, price, rule_template, expiration_policy) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, Number(traffic), Number(duration_days), Number(price), rt, ep);

      if (Array.isArray(allowed_inbounds)) {
        const stmt = db.prepare('INSERT INTO package_inbounds (package_id, inbound_id) VALUES (?, ?)');
        for (const inbId of allowed_inbounds) {
          stmt.run(id, inbId);
        }
      }
    })();

    writeLog('CREATE_PACKAGE', name, `创建了套餐规格: ${name} (${rt}/${ep})`, req);
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/packages/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const { name, traffic, duration_days, price, rule_template, expiration_policy, allowed_inbounds } = req.body;
    if (!name || !traffic || !duration_days || price == null) {
      return res.status(400).json({ error: '套餐数据未填完整' });
    }

    const rt = rule_template || 'default';
    const ep = expiration_policy || 'immediate';

    const oldAllowedInboundRows = db.prepare(`
      SELECT pi.inbound_id, i.node_id FROM package_inbounds pi
      JOIN inbounds i ON pi.inbound_id = i.id
      WHERE pi.package_id = ?
    `).all(id);

    db.transaction(() => {
      db.prepare('UPDATE packages SET name = ?, traffic = ?, duration_days = ?, price = ?, rule_template = ?, expiration_policy = ? WHERE id = ?')
        .run(name, Number(traffic), Number(duration_days), Number(price), rt, ep, id);

      if (Array.isArray(allowed_inbounds)) {
        db.prepare('DELETE FROM package_inbounds WHERE package_id = ?').run(id);
        const stmt = db.prepare('INSERT INTO package_inbounds (package_id, inbound_id) VALUES (?, ?)');
        for (const inbId of allowed_inbounds) {
          stmt.run(id, inbId);
        }
      }
    })();

    // Push updates to nodes for all active users of this package
    if (Array.isArray(allowed_inbounds)) {
      const activeUsers = db.prepare("SELECT uuid, email FROM users WHERE package_id = ? AND status = 'active'").all(id);
      
      const newAllowedInboundRows = allowed_inbounds.length > 0 ? db.prepare(`
        SELECT id, node_id FROM inbounds WHERE id IN (${allowed_inbounds.map(() => '?').join(',')})
      `).all(...allowed_inbounds) : [];

      const oldNodes = [...new Set(oldAllowedInboundRows.map(r => r.node_id))];
      const newNodes = [...new Set(newAllowedInboundRows.map(r => r.node_id))];

      const removedNodes = oldNodes.filter(x => !newNodes.includes(x));
      for (const nId of removedNodes) {
        for (const u of activeUsers) {
          pushUserDelFromNode(nId, u.email);
        }
      }

      const addedNodes = newNodes.filter(x => !oldNodes.includes(x));
      for (const nId of addedNodes) {
        for (const u of activeUsers) {
          pushUserAddtoNode(nId, u.email, u.uuid);
        }
      }

      const keptNodes = newNodes.filter(x => oldNodes.includes(x));
      for (const nId of keptNodes) {
        triggerNodeConfigReload(nId);
      }
    }

    writeLog('UPDATE_PACKAGE', name, `更新了套餐规格 ${name} 及入站规则绑定`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/packages/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const pkg = db.prepare('SELECT name FROM packages WHERE id = ?').get(id);
    if (!pkg) return res.status(404).json({ error: '套餐不存在' });

    // 删除前先踢出所有使用该套餐的活跃用户（删除后外键 SET NULL 会丢失关联）
    const affectedUsers = db.prepare(
      "SELECT uuid, email FROM users WHERE package_id = ? AND status = 'active'"
    ).all(id);
    for (const u of affectedUsers) {
      pushUserEventToAllowedNodes(u.uuid, u.email, 'USER_DEL');
    }

    // Clean up package_inbounds handles automatically by Cascade
    db.prepare('DELETE FROM packages WHERE id = ?').run(id);
    writeLog('DELETE_PACKAGE', pkg.name, `删除了套餐 ${pkg.name}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Admin Panel: Audit Logs & Dashboard
// ------------------------------------------------------------

app.get('/api/logs', authenticate, requireAdmin, (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM logs ORDER BY time DESC LIMIT 200').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/logs', authenticate, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM logs').run();
    writeLog('CLEAR_LOGS', '-', '清空了全局操作日志', req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rules', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT name, content FROM rules').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: '规则名称和内容不能为空' });
    }
    const conflict = db.prepare('SELECT 1 FROM rules WHERE name = ?').get(name);
    if (conflict) {
      return res.status(409).json({ error: '规则模板名称已存在' });
    }
    db.prepare('INSERT INTO rules (name, content) VALUES (?, ?)').run(name, content);
    writeLog('CREATE_RULE', name, `创建了规则配置模板: ${name}`, req);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rules/:name', authenticate, requireAdmin, (req, res) => {
  try {
    const oldName = req.params.name;
    const { name, content } = req.body;
    if (!content) {
      return res.status(400).json({ error: '规则内容不能为空' });
    }

    db.transaction(() => {
      if (name && name !== oldName) {
        // Renaming a rule
        const conflict = db.prepare('SELECT 1 FROM rules WHERE name = ?').get(name);
        if (conflict) {
          throw new Error('新规则模板名称已存在');
        }
        // Update packages using this rule template
        db.prepare('UPDATE packages SET rule_template = ? WHERE rule_template = ?').run(name, oldName);
        db.prepare('UPDATE rules SET name = ?, content = ? WHERE name = ?').run(name, content, oldName);
      } else {
        db.prepare('UPDATE rules SET content = ? WHERE name = ?').run(content, oldName);
      }
    })();

    writeLog('UPDATE_RULE', name || oldName, `更新了规则配置模板: ${name || oldName}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rules/:name', authenticate, requireAdmin, (req, res) => {
  try {
    const name = req.params.name;
    if (name === 'default') {
      return res.status(400).json({ error: '默认规则模板不能被删除' });
    }
    const inUse = db.prepare('SELECT 1 FROM packages WHERE rule_template = ?').get(name);
    if (inUse) {
      return res.status(400).json({ error: '该规则模板正在被计费套餐使用，无法删除' });
    }
    db.prepare('DELETE FROM rules WHERE name = ?').run(name);
    writeLog('DELETE_RULE', name, `删除了规则配置模板: ${name}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit/dashboard', authenticate, requireAdmin, (req, res) => {
  try {
    // 1. General User stats
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count;
    const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user' AND status = 'active'").get().count;
    
    // 2. Global Traffic stats
    const trafficStats = db.prepare(`
      SELECT SUM(u.used_traffic) as total_used, SUM(p.traffic) as total_limit FROM users u
      LEFT JOIN packages p ON u.package_id = p.id
      WHERE u.role = 'user'
    `).get();
    
    // 3. Online node counts
    const onlineNodesCount = activeNodes.size;
    const totalNodesCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;

    res.json({
      total_users: totalUsers,
      active_users: activeUsers,
      total_used_traffic: trafficStats.total_used || 0,
      total_limit_traffic: trafficStats.total_limit || 0,
      online_nodes: onlineNodesCount,
      total_nodes: totalNodesCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/utils/generate-keys', authenticate, requireAdmin, (req, res) => {
  try {
    const { generateKeyPairSync, randomBytes } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    
    // Export raw key bytes as base64url representation (JWK format)
    const pubBase64 = publicKey.export({ format: 'jwk' }).x;
    const privBase64 = privateKey.export({ format: 'jwk' }).d;
    
    const shortId = randomBytes(8).toString('hex');
    
    res.json({
      publicKey: pubBase64,
      privateKey: privBase64,
      shortId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Clash Subscription Endpoint
// ------------------------------------------------------------

app.get('/subscribe/:token', async (req, res) => {
  const { token } = req.params;
  if (!token || token.includes("/") || token === 'favicon.ico') {
    return res.status(404).send("Not Found");
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
    if (!user) {
      return res.status(404).send("Config not found");
    }

    if (user.status !== 'active') {
      return res.status(403).send(`Subscription inactive or expired (Status: ${user.status})`);
    }

    // Retrieve package details to get rule template and allowed inbounds
    let ruleTemplateName = "default";
    let allowedInboundRows = [];
    
    if (user.package_id) {
      const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(user.package_id);
      if (pkg) {
        ruleTemplateName = pkg.rule_template || "default";
        allowedInboundRows = db.prepare(`
          SELECT i.*, n.name as node_name, n.server as node_server FROM inbounds i
          JOIN nodes n ON i.node_id = n.id
          JOIN package_inbounds pi ON i.id = pi.inbound_id
          WHERE pi.package_id = ?
        `).all(user.package_id);
      }
    }

    const ruleRow = db.prepare('SELECT content FROM rules WHERE name = ?').get(ruleTemplateName);
    if (!ruleRow) {
      return res.status(404).send(`Rule template "${ruleTemplateName}" not found`);
    }
    const ruleTemplate = ruleRow.content;

    // Collect all inbounds profiles
    const nodes = [];
    const unallowedNodeIds = [];

    // Retrieve all inbounds to see which are unallowed
    const allInbounds = db.prepare('SELECT id FROM inbounds').all();
    const allowedInboundIds = allowedInboundRows.map(i => i.id);

    for (const inb of allowedInboundRows) {
      let inbConfig = {};
      try { inbConfig = JSON.parse(inb.config); } catch {}
      
      // Assemble Clash node profile using the secret user UUID
      const nodeProfile = {
        id: inb.id,
        name: `${inb.node_name} - ${inb.network.toUpperCase()} (${inb.port})`,
        type: inb.protocol,
        server: inb.node_server,
        port: inb.port,
        uuid: user.uuid,
        tls: inb.security !== 'none',
        flow: inb.network === 'tcp' && inb.security === 'reality' ? 'xtls-rprx-vision' : '',
        network: inb.network,
        servername: inb.security === 'reality' ? (inbConfig.serverNames ? inbConfig.serverNames[0] : '') : ''
      };

      if (inb.security === 'reality') {
        nodeProfile['reality-opts'] = {
          'public-key': inbConfig['reality-opts'] ? inbConfig['reality-opts']['public-key'] : '',
          'short-id': inbConfig['reality-opts'] ? inbConfig['reality-opts']['short-id'] : ''
        };
        nodeProfile['client-fingerprint'] = inbConfig.fingerprint || 'chrome';
      }

      if (inb.network === 'grpc') {
        nodeProfile['grpc-opts'] = {
          'grpc-service-name': inbConfig.serviceName || 'grpc-service'
        };
      } else if (inb.network === 'xhttp') {
        nodeProfile['xhttp-opts'] = {
          path: inbConfig.path || '/xh',
          mode: inbConfig.mode || 'stream-one'
        };
      }

      nodes.push(nodeProfile);
    }

    // Unallowed inbounds should include all inbounds not explicitly in package_inbounds
    for (const inb of allInbounds) {
      if (!allowedInboundIds.includes(inb.id)) {
        unallowedNodeIds.push(inb.id);
      }
    }

    const finalYaml = injectProxies(ruleTemplate, nodes, unallowedNodeIds);

    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="subscription.yaml"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.send(finalYaml);

  } catch (err) {
    console.error(err);
    return res.status(500).send(`Internal Server Error: ${err.message}`);
  }
});

// ------------------------------------------------------------
// YAML Serialization & Injection Helpers (Original Logic)
// ------------------------------------------------------------

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

  result = result.replace(/([ \t]*)-[ \t]*(?:"all"|'all'|\ball\b)[ \t]*(?:#.*)?(\r?\n|$)/gi, (match, spaces, newline) => {
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

// ------------------------------------------------------------
// Static File Hosting (React Build)
// ------------------------------------------------------------

app.use(express.static(path.join(__dirname, '../front/dist')));

// Fallback to Index.html for React Router HTML5 History
app.get('*', (req, res) => {
  const requestPath = req.path;
  if (requestPath.startsWith('/api/') || requestPath.startsWith('/subscribe/')) {
    return res.status(404).send("Not Found");
  }
  res.sendFile(path.join(__dirname, '../front/dist/index.html'));
});

// ------------------------------------------------------------
// HTTP Server & WebSocket Server Initialization
// ------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Upgrade HTTP request to WebSocket for Xray node daemons
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/api/node/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request) => {
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  const nodeId = urlObj.searchParams.get('node_id');
  const timestamp = urlObj.searchParams.get('timestamp');
  const signature = urlObj.searchParams.get('signature');

  if (!nodeId || !timestamp || !signature) {
    ws.close(4001, '认证失败：缺少签名安全参数');
    return;
  }

  // Check timestamp offset (strict 30-second window)
  const timeDiff = Math.abs(Date.now() - parseInt(timestamp));
  if (isNaN(timeDiff) || timeDiff > 30000) {
    ws.close(4002, '认证失败：请求超时 (Out of sync)');
    return;
  }

  // Retrieve node to obtain secret
  const nodeRow = db.prepare('SELECT secret, multiplier FROM nodes WHERE id = ?').get(nodeId);
  if (!nodeRow) {
    ws.close(4003, '认证失败：节点未在主控注册');
    return;
  }

  const nodeSecret = nodeRow.secret;
  if (!nodeSecret) {
    ws.close(4005, '认证失败：节点密钥未配置');
    return;
  }
  const nodeMultiplier = nodeRow.multiplier !== undefined ? nodeRow.multiplier : 1.0;

  // Verify HMAC signature
  const expectedSig = crypto.createHmac('sha256', nodeSecret)
    .update(nodeId + timestamp)
    .digest('hex');

  if (signature !== expectedSig) {
    ws.close(4004, '认证失败：HMAC 签名不匹配');
    return;
  }

  // Connection Approved!
  console.log(`[WebSocket] Node Daemon "${nodeId}" connected and authenticated.`);

  // 如果存在旧连接，主动关闭避免竞态
  const oldWs = activeNodes.get(nodeId);
  if (oldWs && oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
    oldWs.close(4000, '新的守护进程连接已建立');
  }
  activeNodes.set(nodeId, ws);
  ws._isAlive = true;
  ws.on('pong', () => { ws._isAlive = true; });

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);
      
      if (payload.type === 'report') {
        const { system_stats, user_traffic } = payload;
        
        // 1. Process system logs
        if (system_stats) {
          const statsId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          db.prepare(`
            INSERT INTO node_stats (id, node_id, timestamp, cpu_usage, mem_usage, network_rx, network_tx, online_users)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            statsId,
            nodeId,
            Math.floor(Date.now() / 1000),
            system_stats.cpu_usage || 0,
            system_stats.mem_usage || 0,
            system_stats.network ? system_stats.network.rx_speed || 0 : 0,
            system_stats.network ? system_stats.network.tx_speed || 0 : 0,
            user_traffic ? user_traffic.length : 0
          );
          
          // Truncate historic logs to keep only last 100 items per node
          db.prepare(`
            DELETE FROM node_stats 
            WHERE node_id = ? AND timestamp < (
              SELECT timestamp FROM node_stats WHERE node_id = ? ORDER BY timestamp DESC LIMIT 1 OFFSET 100
            )
          `).run(nodeId, nodeId);
        }
        
        // 2. Aggregate user traffic delta and check quota limits
        if (Array.isArray(user_traffic)) {
          db.transaction(() => {
            for (const tLog of user_traffic) {
              const { email, uplink, downlink } = tLog;
              const rawDelta = (uplink || 0) + (downlink || 0);
              
              if (rawDelta > 0) {
                // Apply node traffic multiplier
                const delta = Math.round(rawDelta * nodeMultiplier);

                const user = db.prepare(`
                  SELECT u.uuid, u.package_id, u.expiry_time, u.activation_time, u.used_traffic, u.status, p.traffic as total_traffic, p.duration_days, p.expiration_policy
                  FROM users u
                  LEFT JOIN packages p ON u.package_id = p.id
                  WHERE u.email = ?
                `).get(email);

                if (user) {
                  // 检查用户是否已过期（时间维度）
                  if (user.expiry_time && user.expiry_time <= new Date().toISOString().split('T')[0]) {
                    if (user.status === 'active') {
                      db.prepare("UPDATE users SET status = 'expired' WHERE email = ?").run(email);
                      console.log(`[WebSocket] User ${email} expired (past expiry_time). Status set to expired.`);
                    }
                    continue;
                  }

                  let finalExpiry = user.expiry_time;
                  let finalActivation = user.activation_time;

                  // Handle 'first_use' activation logic
                  if (user.package_id && user.expiration_policy === 'first_use' && !user.activation_time) {
                    const now = new Date();
                    finalActivation = now.toISOString();
                    now.setDate(now.getDate() + user.duration_days);
                    finalExpiry = now.toISOString().split('T')[0];

                    db.prepare('UPDATE users SET activation_time = ?, expiry_time = ? WHERE email = ?')
                      .run(finalActivation, finalExpiry, email);
                    console.log(`[WebSocket] First use activation for user ${email}. Expiry set to ${finalExpiry}`);
                  }

                  db.prepare('UPDATE users SET used_traffic = used_traffic + ? WHERE email = ?')
                    .run(delta, email);

                  const updatedUsed = user.used_traffic + delta;
                  const limit = user.total_traffic || 0;

                  if (user.status === 'active' && limit > 0 && updatedUsed >= limit) {
                    console.log(`[WebSocket] User ${email} has run out of traffic (${updatedUsed} >= ${limit}). Revoking access dynamically...`);
                    db.prepare("UPDATE users SET status = 'expired' WHERE email = ?").run(email);
                    
                    // 向用户有权访问的节点推送踢出事件
                    pushUserEventToAllowedNodes(user.uuid, email, 'USER_DEL');
                  }
                }
              }
            }
          })();
        }
      } else if (payload.type === 'sync_request') {
        // Fetch node advanced config
        const nodeRecord = db.prepare('SELECT advanced_config FROM nodes WHERE id = ?').get(nodeId);
        let advConfig = {};
        if (nodeRecord && nodeRecord.advanced_config) {
          try { advConfig = JSON.parse(nodeRecord.advanced_config); } catch {}
        }

        const inbounds = db.prepare('SELECT * FROM inbounds WHERE node_id = ?').all(nodeId);
        
        // Render Xray config.json compatible structure
        const xrayInbounds = inbounds.map(inb => {
          let inbConfig = {};
          try { inbConfig = JSON.parse(inb.config); } catch {}
          
          const inboundUsers = db.prepare(`
            SELECT u.email, u.uuid FROM users u
            JOIN package_inbounds pi ON u.package_id = pi.package_id
            WHERE pi.inbound_id = ? AND u.status = 'active'
          `).all(inb.id);
          
          const clientList = inboundUsers.map(u => ({
            id: u.uuid,
            flow: inb.network === 'tcp' && inb.security === 'reality' ? 'xtls-rprx-vision' : '',
            email: u.email
          }));

          const xrayInb = {
            port: inb.port,
            protocol: inb.protocol,
            tag: `${inb.node_id}_${inb.port}`,
            settings: {
              clients: clientList,
              decryption: "none"
            },
            streamSettings: {
              network: inb.network,
              security: inb.security
            }
          };

          if (inb.security === 'reality') {
            xrayInb.streamSettings.realitySettings = {
              show: false,
              dest: inbConfig.dest || "www.microsoft.com:443",
              serverNames: inbConfig.serverNames || ["www.microsoft.com"],
              privateKey: inbConfig.privateKey || "",
              shortIds: inbConfig.shortIds || [""]
            };
          } else if (inb.security === 'tls') {
            xrayInb.streamSettings.tlsSettings = {
              certificates: inbConfig.certificates || []
            };
          }

          if (inb.network === 'grpc') {
            xrayInb.streamSettings.grpcSettings = {
              serviceName: inbConfig.serviceName || "grpc-service"
            };
          } else if (inb.network === 'xhttp') {
            xrayInb.streamSettings.xhttpSettings = {
              path: inbConfig.path || "/xh",
              host: inbConfig.host || "",
              mode: inbConfig.mode || "stream-one"
            };
          }

          return xrayInb;
        });

        // Add API inbound for daemon communication
        const apiInbound = {
          listen: "127.0.0.1",
          port: 10085,
          protocol: "dokodemo-door",
          settings: { address: "127.0.0.1" },
          tag: "api-in"
        };

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
          inbounds: [...xrayInbounds, apiInbound],
          outbounds: [
            { protocol: "freedom", tag: "direct" },
            { protocol: "blackhole", tag: "blocked" }
          ],
          routing: {
            rules: [
              { inboundTag: ["api-in"], outboundTag: "api", type: "field" }
            ]
          }
        };

        // Apply advanced configurations
        if (advConfig.enable_sniffing) {
          fullConfig.inbounds.forEach(inb => {
            if (inb.tag !== "api-in") {
              inb.sniffing = {
                enabled: true,
                destOverride: ["http", "tls", "quic", "fakedns"]
              };
            }
          });
        }
        if (advConfig.block_bittorrent) {
          fullConfig.routing.rules.push({
            protocol: ["bittorrent"],
            outboundTag: "blocked",
            type: "field"
          });
        }
        if (advConfig.block_private) {
          fullConfig.routing.rules.push({
            ip: ["geoip:private"],
            outboundTag: "blocked",
            type: "field"
          });
        }

        ws.send(JSON.stringify({
          event: 'SYNC_RESPONSE',
          data: {
            inbounds: xrayInbounds, // For daemon UFW processing
            config: fullConfig,     // Complete ready-to-write JSON config
            restart: payload.restart !== false // default to true if not strictly false
          }
        }));
      }
    } catch (e) {
      console.error(`[WebSocket] Failed to parse message from node "${nodeId}":`, e);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Node Daemon "${nodeId}" disconnected.`);
    // 只有当 Map 中存的仍然是当前 ws 时才删除，避免误删重连后的新连接
    if (activeNodes.get(nodeId) === ws) {
      activeNodes.delete(nodeId);
    }
  });
  
  ws.on('error', (err) => {
    console.error(`[WebSocket] Error in node "${nodeId}":`, err);
    if (activeNodes.get(nodeId) === ws) {
      activeNodes.delete(nodeId);
    }
  });
});


server.listen(PORT, () => {
  console.log(`VPS Clash Subscription Controller backend listening on port ${PORT}`);
});

// WebSocket 心跳检测（每 30 秒 ping 一次，超时则强制断开僵尸连接）
const heartbeatInterval = setInterval(() => {
  for (const [hbNodeId, clientWs] of activeNodes.entries()) {
    if (clientWs._isAlive === false) {
      console.log(`[Heartbeat] Node "${hbNodeId}" heartbeat timeout, terminating connection.`);
      clientWs.terminate();
      continue;
    }
    clientWs._isAlive = false;
    clientWs.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

// 定时检查用户过期状态（每 60 秒）
setInterval(() => {
  try {
    const now = new Date().toISOString().split('T')[0];
    const expiredUsers = db.prepare(`
      SELECT uuid, email FROM users
      WHERE status = 'active' AND expiry_time IS NOT NULL AND expiry_time <= ?
    `).all(now);

    if (expiredUsers.length > 0) {
      db.transaction(() => {
        const stmt = db.prepare("UPDATE users SET status = 'expired' WHERE uuid = ?");
        for (const u of expiredUsers) {
          stmt.run(u.uuid);
        }
      })();
      for (const u of expiredUsers) {
        pushUserEventToAllowedNodes(u.uuid, u.email, 'USER_DEL');
        console.log(`[Expiry Check] User ${u.email} has expired. Access revoked.`);
      }
    }
  } catch (err) {
    console.error('[Expiry Check] Error:', err);
  }
}, 60 * 1000);

// ------------------------------------------------------------
// Scheduled Restart Cron
// ------------------------------------------------------------
setInterval(() => {
  try {
    const now = new Date();
    // Use local time for standard hour:minute comparison
    const currentHourStr = now.getHours().toString().padStart(2, '0');
    const currentMinStr = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${currentHourStr}:${currentMinStr}`;

    const nodes = db.prepare('SELECT id, advanced_config FROM nodes').all();
    for (const node of nodes) {
      if (!activeNodes.has(node.id)) continue;

      let advConfig = {};
      if (node.advanced_config) {
        try { advConfig = JSON.parse(node.advanced_config); } catch {}
      }

      const restartTime = advConfig.restart_time || "04:00";
      if (timeStr === restartTime) {
        console.log(`[Cron] Triggering daily RESTART_XRAY for node ${node.id} at ${timeStr}`);
        const ws = activeNodes.get(node.id);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'RESTART_XRAY' }));
        }
      }
    }
  } catch (err) {
    console.error('[Cron] Error checking scheduled restarts:', err);
  }
}, 60 * 1000);
