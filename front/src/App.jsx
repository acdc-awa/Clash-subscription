import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import { Sun, Moon, Monitor, HardDrive, Cpu, MemoryStick, Activity, Server, ActivitySquare, ClipboardCopy, Edit2, Trash2, Menu, Eye, EyeOff, Database, Download, Upload, Terminal, CloudDownload } from 'lucide-react';
import './App.css';

// ------------------------------------------------------------
// Password Input Component
// ------------------------------------------------------------
export function PasswordInput({ value, onChange, placeholder, disabled, onKeyDown, required }) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={onKeyDown}
        required={required}
        style={{ width: '100%', paddingRight: '40px' }}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}
      >
        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

// ------------------------------------------------------------
// Global Contexts for Toast & State
// ------------------------------------------------------------
const ToastContext = createContext(null);
export const ThemeContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function useThemeContext() {
  return useContext(ThemeContext);
}

export function ThemeToggleButton({ style }) {
  const { cycleTheme, renderThemeIcon } = useThemeContext();
  return (
    <button onClick={cycleTheme} className="theme-toggle-btn active" style={{ width: '40px', height: '40px', ...style }} title="切换主题">
      {renderThemeIcon()}
    </button>
  );
}

// ------------------------------------------------------------
// Main App Component & Router
// ------------------------------------------------------------
export default function App() {
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(localStorage.getItem('clash_theme') || 'system');

  useEffect(() => {
    const applyTheme = (t) => {
      if (t === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', t);
      }
    };
    applyTheme(theme);
    localStorage.setItem('clash_theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      };
      // Modern browsers use addEventListener
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      } else if (mediaQuery.addListener) {
        // Fallback for older Safari
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    }
  }, [theme]);

  // Proactively check token expiration
  useEffect(() => {
    const checkToken = () => {
      const token = localStorage.getItem('clash_token');
      if (token) {
        try {
          const payloadBase64 = token.split('.')[1];
          const decoded = JSON.parse(atob(payloadBase64));
          if (decoded.exp && Date.now() >= decoded.exp * 1000) {
            // Token expired, check for refresh token
            const refreshToken = localStorage.getItem('clash_refresh_token');
            if (refreshToken) {
              fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
              }).then(res => {
                if (res.ok) {
                  return res.json().then(data => {
                    localStorage.setItem('clash_token', data.token);
                  });
                } else {
                  throw new Error('Refresh failed');
                }
              }).catch(() => {
                localStorage.clear();
                window.location.href = '/login';
              });
            } else {
              localStorage.clear();
              window.location.href = '/login';
            }
          }
        } catch (e) {
          // Invalid token format
        }
      }
    };
    
    checkToken();
    const intervalId = setInterval(checkToken, 10000); // Check every 10 seconds
    return () => clearInterval(intervalId);
  }, []);

  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substring(2, 5);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.map(t => t.id === id ? { ...t, fadeOut: true } : t));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 3000);
  };

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  const renderThemeIcon = () => {
    if (theme === 'light') return <Sun size={18} />;
    if (theme === 'dark') return <Moon size={18} />;
    return <Monitor size={18} />;
  };

  return (
    <ThemeContext.Provider value={{ theme, cycleTheme, renderThemeIcon }}>
      <ToastContext.Provider value={{ showToast }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard/:token" element={<ProtectedRoute allowedRoles={['user', 'admin']}><UserDashboard /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>

      {/* Toast Portal */}
      <div id="toast-portal">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type} ${t.fadeOut ? 'fade-out' : ''}`}>
            <span>{t.type === 'success' ? '' : t.type === 'error' ? '' : ''}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}

// ------------------------------------------------------------
// Protected Route guard
// ------------------------------------------------------------
function ProtectedRoute({ children, allowedRoles }) {
  const token = localStorage.getItem('clash_token');
  const role = localStorage.getItem('clash_role');

  if (!token || !role) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    const userToken = localStorage.getItem('clash_user_token') || 'default';
    return <Navigate to={role === 'admin' ? '/admin' : `/dashboard/${userToken}`} replace />;
  }

  return children;
}

// ------------------------------------------------------------
// API Fetch Wrapper
// ------------------------------------------------------------
async function apiFetch(method, urlPath, body = null) {
  const token = localStorage.getItem('clash_token');
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  let response = await fetch(urlPath, options);

  if (response.status === 401) {
    if (urlPath === '/api/auth/login') {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || '用户名或密码错误');
    }
    if (localStorage.getItem('clash_refresh_token') && urlPath !== '/api/auth/refresh') {
      try {
        const refreshResp = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: localStorage.getItem('clash_refresh_token') })
        });
        
        if (refreshResp.ok) {
          const refreshData = await refreshResp.json();
          localStorage.setItem('clash_token', refreshData.token);
          headers['Authorization'] = `Bearer ${refreshData.token}`;
          options.headers = headers;
          response = await fetch(urlPath, options); // Retry original request
        } else {
          throw new Error('Refresh failed');
        }
      } catch (err) {
        localStorage.clear();
        window.location.href = '/login';
        throw new Error('会话已过期，请重新登录');
      }
    } else {
      // No refresh token or refresh endpoint returned 401
      localStorage.clear();
      window.location.href = '/login';
      throw new Error('会话已失效，请重新登录');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `请求失败 (${response.status})`);
  }
  return response.json();
}

// Helper to format Bytes to Human Readable (GB, MB)
function formatTraffic(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

const generatePieChartGradient = (nodesData) => {
  if (!nodesData || nodesData.length === 0) return 'transparent';
  const total = nodesData.reduce((sum, n) => sum + n.traffic, 0);
  if (total === 0) return '#333';
  
  const colors = ['#00ff88', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
  let currentAngle = 0;
  const gradientStops = nodesData.map((n, i) => {
    const percentage = (n.traffic / total) * 100;
    const color = colors[i % colors.length];
    const stop = `${color} ${currentAngle}% ${currentAngle + percentage}%`;
    currentAngle += percentage;
    return stop;
  });
  
  return `conic-gradient(${gradientStops.join(', ')})`;
};

// ------------------------------------------------------------
// 1. Login View Component
// ------------------------------------------------------------
function Login() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Force Change Password State
  const [forceChangePwd, setForceChangePwd] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    // Redirect if already logged in
    const token = localStorage.getItem('clash_token');
    const role = localStorage.getItem('clash_role');
    if (token && role) {
      const userToken = localStorage.getItem('clash_user_token') || 'default';
      navigate(role === 'admin' ? '/admin' : `/dashboard/${userToken}`, { replace: true });
    }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return showToast('请填齐邮箱和密码', 'error');
    setLoading(true);

    try {
      const data = await apiFetch('POST', '/api/auth/login', { email, password });
      showToast('登录验证成功', 'success');

      if (data.user.need_password_change) {
        // Intercept and force password modification
        setTempToken(data.token);
        localStorage.setItem('clash_token', data.token); // Save temporarily to authorize password change
        if (data.refreshToken) localStorage.setItem('clash_refresh_token', data.refreshToken);
        setForceChangePwd(true);
      } else {
        localStorage.setItem('clash_token', data.token);
        if (data.refreshToken) localStorage.setItem('clash_refresh_token', data.refreshToken);
        localStorage.setItem('clash_role', data.user.role);
        localStorage.setItem('clash_email', data.user.email);
        localStorage.setItem('clash_uuid', data.user.uuid);
        localStorage.setItem('clash_user_token', data.user.token);
        navigate(data.user.role === 'admin' ? '/admin' : `/dashboard/${data.user.token}`, { replace: true });
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleForceChangePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      return showToast('新密码长度不能少于 6 位', 'error');
    }
    if (newPassword !== confirmPassword) {
      return showToast('两次输入的密码不一致', 'error');
    }

    try {
      setLoading(true);
      await apiFetch('POST', '/api/auth/change-password', { new_password: newPassword });
      showToast('初始密码已成功修改，请使用新密码重新登录', 'success');
      
      // Clean temporary authentication and reset state
      localStorage.removeItem('clash_token');
      setForceChangePwd(false);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div style={{ position: 'fixed', top: '20px', right: '30px', zIndex: 1000, background: 'var(--bg-card)', padding: '6px', borderRadius: '24px', backdropFilter: 'blur(10px)', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <ThemeToggleButton />
      </div>
      {!forceChangePwd ? (
        <form className="login-card glass" onSubmit={handleLogin}>
          <div className="login-logo"></div>
          <h2>ACDC Subscription Manager</h2>
          <p className="ACDClogin-subtitle">用户登录</p>
          
          <div className="form-group">
            <label>账号邮箱</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>登录密码</label>
            <PasswordInput 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin(e)}
            />
          </div>

          <button className="btn btn-primary w-full" type="submit" disabled={loading}>
            {loading ? '正在验证...' : '登 录'}
          </button>
        </form>
      ) : (
        <form className="login-card glass" onSubmit={handleForceChangePassword}>
          <div className="login-logo"></div>
          <h2>修改初始密码</h2>
          <p className="login-subtitle">为了您的账户安全，首次登录必须修改初始随机密码</p>
          
          <div className="form-group">
            <label>新密码 (最少6位)</label>
            <PasswordInput 
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>确认新密码</label>
            <PasswordInput 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <button className="btn btn-primary w-full" type="submit" disabled={loading}>
            {loading ? '修改中...' : '确认修改并登录'}
          </button>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// 2. User Dashboard View Component (C-Side)
// ------------------------------------------------------------
// ------------------------------------------------------------
// NodeCard Component for Dashboard rendering
// ------------------------------------------------------------
function NodeCard({ node, formatTraffic, actions }) {
  const isOnline = node.online;
  const statusColor = isOnline ? '#10b981' : '#ef4444'; // success vs danger

  const ProgressCircle = ({ value, text, IconComponent, color }) => (
    <div style={{ width: '60px', height: '60px', position: 'relative' }}>
      <CircularProgressbar
        value={value}
        styles={buildStyles({
          pathColor: color,
          trailColor: 'var(--border-color)',
          strokeLinecap: 'round'
        })}
      />
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <IconComponent size={14} color={color} style={{ marginBottom: '2px' }} />
        <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{text}</span>
      </div>
    </div>
  );

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
      
      {/* Upper: Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{node.region || '🏳️'}</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{node.name}</h4>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '4px 8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: statusColor, fontWeight: 'bold' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}` }}></span>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              <span>• {node.os_type || 'Linux'}</span>
              <span>• Uptime: {Math.floor((node.uptime || 0) / 86400)}d</span>
              {node.last_sync && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: node.last_sync.status === 'success' ? '#10b981' : '#ef4444', marginLeft: 'auto', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                  {node.last_sync.status === 'success' ? '✅' : '❌'} {new Date(node.last_sync.timestamp * 1000).toLocaleTimeString('zh-CN')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {actions && (
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {actions}
            </div>
          )}
          <div style={{ background: 'var(--bg-card-hover)', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ActivitySquare size={12} color="var(--accent)" />
            <span>x{node.multiplier || 1.0}</span>
          </div>
        </div>
      </div>

      {/* Middle: Gauges */}
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', background: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <ProgressCircle value={node.cpu_usage || 0} text={`${Math.round(node.cpu_usage || 0)}%`} IconComponent={Cpu} color="#3b82f6" />
        <ProgressCircle value={node.mem_usage || 0} text={`${Math.round(node.mem_usage || 0)}%`} IconComponent={MemoryStick} color="#8b5cf6" />
        <ProgressCircle value={node.disk_usage || 0} text={`${Math.round(node.disk_usage || 0)}%`} IconComponent={HardDrive} color="#ec4899" />
      </div>

      {/* Lower: Network & Traffic Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={12} color="#10b981" /> Tx: {formatTraffic(node.network_tx || 0)}/s</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={12} color="#3b82f6" /> Rx: {formatTraffic(node.network_rx || 0)}/s</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'right' }}>
          <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
            <Server size={12} /> Users: {node.online_users || 0}
          </span>
          <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
            Traffic: {formatTraffic(node.total_traffic || 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

function UserDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { token } = useParams();
  
  const [profile, setProfile] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Change Password State
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const fetchUserData = async () => {
    try {
      const [profData, nodesData] = await Promise.all([
        apiFetch('GET', '/api/user/profile'),
        apiFetch('GET', '/api/user/nodes')
      ]);
      
      if (profData.token !== token) {
        navigate(`/dashboard/${profData.token}`, { replace: true });
        return;
      }

      setProfile(profData);
      setNodes(nodesData);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, [token]);

  const handleLogout = async () => {
    try {
      await apiFetch('POST', '/api/auth/logout');
    } catch (e) {}
    localStorage.clear();
    showToast('已退出登录', 'info');
    navigate('/login', { replace: true });
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return showToast('两次密码输入不一致', 'error');
    if (newPassword.length < 6) return showToast('新密码至少6位', 'error');

    try {
      await apiFetch('POST', '/api/auth/change-password', { old_password: oldPassword, new_password: newPassword });
      showToast('密码修改成功，请重新登录', 'success');
      handleLogout();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const copySubLink = () => {
    if (!profile) return;
    const link = `${window.location.origin}/subscribe/${profile.token}`;
    navigator.clipboard.writeText(link)
      .then(() => showToast('Clash 订阅链接已成功复制到剪贴板', 'success'))
      .catch(() => showToast('复制失败，请手动选择复制', 'error'));
  };

  if (loading) {
    return <div className="loader-container"><div className="loader"></div></div>;
  }

  // Calculate traffic usage percentage
  const trafficPercent = profile && profile.total_traffic > 0 
    ? Math.min(100, Math.max(0, (profile.used_traffic / profile.total_traffic) * 100))
    : 0;

  return (
    <div className="app-container">
      {/* Mobile Drawer Overlay */}
      <div className={`sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)}></div>
      
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="brand" style={{ margin: 0, fontSize: '1.6rem', background: 'linear-gradient(135deg, #a78bfa, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800 }}>Clash Panel</h1>
          <ThemeToggleButton />
        </div>
        <nav className="sidebar-nav">
          <button className="tab-btn active" onClick={() => setMobileMenuOpen(false)}>我的订阅</button>
        </nav>
        <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span className="email-badge admin-badge" style={{ fontSize: '0.8rem', textAlign: 'center', opacity: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '34px', boxSizing: 'border-box' }}>{profile?.email}</span>
          {profile?.role === 'admin' && (
            <button className="btn btn-ghost btn-sm" style={{ height: '34px', boxSizing: 'border-box' }} onClick={() => navigate('/admin')}>后台管理</button>
          )}
          <button className="btn btn-ghost btn-sm" style={{ height: '34px', boxSizing: 'border-box' }} onClick={() => setShowChangePwd(true)}>修改密码</button>
          <button className="btn btn-danger btn-sm" style={{ height: '34px', boxSizing: 'border-box' }} onClick={handleLogout}><Trash2 size={14} style={{ marginRight: '6px' }} />安全退出</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h2>订阅控制台</h2>
        </div>

      {/* Change Password Modal */}
      {showChangePwd && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>修改密码</h3>
              <button className="btn-icon" onClick={() => setShowChangePwd(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>旧密码</label>
                <PasswordInput required value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
              </div>
              <div className="form-group">
                <label>新密码</label>
                <PasswordInput required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </div>
              <div className="form-group">
                <label>确认新密码</label>
                <PasswordInput required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowChangePwd(false)}>取消</button>
                <button type="submit" className="btn btn-primary">确认修改</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="summary-wrapper" style={{ padding: '1.5rem' }}>
        {/* Row 1: Profile & Traffic Card */}
        <section className="grid-2">
          {/* Card A: Traffic details */}
          <div className="glass-card flex-col justify-between">
            <div>
              <h3>流量消耗与额度</h3>
              <p className="card-desc">用量每分钟更新一次，超额后订阅将自动失效</p>
            </div>
            
            <div className="progress-ring-section">
              <div className="traffic-numbers">
                <span className="traffic-used">{formatTraffic(profile?.used_traffic)}</span>
                <span className="traffic-divider">/</span>
                <span className="traffic-total">
                  {profile?.total_traffic > 0 ? formatTraffic(profile.total_traffic) : '无上限'}
                </span>
              </div>
              <div className="progress-bar-wrapper">
                <div className="progress-bar-fill" style={{ width: `${profile?.total_traffic > 0 ? trafficPercent : 100}%` }}></div>
              </div>
              <div className="traffic-percentage">已使用 {trafficPercent.toFixed(1)}%</div>
            </div>

            <button className="btn btn-primary w-full" onClick={copySubLink}>
              复制 Clash 订阅链接
            </button>
          </div>

          {/* Card B: Package details */}
          <div className="glass-card flex-col justify-between">
            <div>
              <h3>账户详情与服务</h3>
              <p className="card-desc">您的当前可用套餐及账期属性</p>
            </div>

            <div className="user-details-list">
              <div className="detail-item">
                <span className="detail-label">当前套餐</span>
                <span className="badge badge-info">{profile?.package_name || '自定义套餐'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">套餐到期时间</span>
                <span className="detail-val">
                  {profile?.expiry_time 
                    ? new Date(profile.expiry_time).toLocaleDateString('zh-CN') 
                    : (profile?.package_name ? '未激活 (首次使用计时)' : '永久有效')}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">账户状态</span>
                <span className={`badge ${profile?.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                  {profile?.status === 'active' ? '正常运行' : profile?.status === 'expired' ? '超额/过期' : '已禁用'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">我的订阅 UUID</span>
                <span className="detail-uuid" title={profile?.uuid}>{profile?.uuid?.substring(0, 18)}...</span>
              </div>
            </div>

            <a className="btn btn-ghost w-full" href={`clash://install-config?url=${encodeURIComponent(window.location.origin + '/subscribe/' + profile?.token)}`}>
              一键导入 Clash 客户端
            </a>
          </div>
        </section>

        {/* Row 2: Nodes Table */}
        <section className="nodes-section">
          <h3>节点资源可用列表</h3>
          <p className="section-subtitle">仅展示当前您有权连接的加速节点</p>
          
          {nodes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>暂无可用节点，请联系管理员分配。</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
              {nodes.map(node => (
                <NodeCard key={node.id} node={node} formatTraffic={formatTraffic} />
              ))}
            </div>
          )}
        </section>
      </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------
// 3. Admin Dashboard View Component (B-Side)
// ------------------------------------------------------------
function AdminDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  const [activeTab, setActiveTab] = useState('summary');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dashboardStats, setDashboardStats] = useState(null);
  
  // Data lists
  const [users, setUsers] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [rules, setRules] = useState([]);

  // Inbounds management state
  const [selectedNodeForInbounds, setSelectedNodeForInbounds] = useState(null);
  const [inbounds, setInbounds] = useState([]);
  const [allInbounds, setAllInbounds] = useState([]);
  const [inboundModalOpen, setInboundModalOpen] = useState(false);
  const [currentInbound, setCurrentInbound] = useState(null);

  // Rules management state
  const [currentRule, setCurrentRule] = useState(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);

  // Modals state
  const [currentUser, setCurrentUser] = useState(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [currentNode, setCurrentNode] = useState(null);
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [nodeLogsModalOpen, setNodeLogsModalOpen] = useState(false);
  const [currentNodeLogs, setCurrentNodeLogs] = useState([]);
  const [currentPackage, setCurrentPackage] = useState(null);
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [reportIntervalModalOpen, setReportIntervalModalOpen] = useState(false);
  const [intervalSecs, setIntervalSecs] = useState("30");
  const [otaInfo, setOtaInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  const fetchAdminData = async () => {
    try {
      if (activeTab === 'summary') {
        const stats = await apiFetch('GET', '/api/audit/dashboard');
        setDashboardStats(stats);
      } else if (activeTab === 'users') {
        const usersList = await apiFetch('GET', '/api/users');
        const pkgsList = await apiFetch('GET', '/api/packages');
        const nodesList = await apiFetch('GET', '/api/nodes');
        setUsers(usersList);
        setPackages(pkgsList);
        setNodes(nodesList);
      } else if (activeTab === 'nodes') {
        const nodesList = await apiFetch('GET', '/api/nodes');
        setNodes(nodesList);
      } else if (activeTab === 'inbounds') {
        const [inboundsList, nodesList] = await Promise.all([
          apiFetch('GET', '/api/inbounds'),
          apiFetch('GET', '/api/nodes')
        ]);
        setInbounds(inboundsList);
        setNodes(nodesList);
      } else if (activeTab === 'packages') {
        const [pkgsList, nodesList, rulesList, inboundsList] = await Promise.all([
          apiFetch('GET', '/api/packages'),
          apiFetch('GET', '/api/nodes'),
          apiFetch('GET', '/api/rules'),
          apiFetch('GET', '/api/inbounds')
        ]);
        setPackages(pkgsList);
        setNodes(nodesList);
        setRules(rulesList);
        setAllInbounds(inboundsList);
      } else if (activeTab === 'rules') {
        const rulesList = await apiFetch('GET', '/api/rules');
        setRules(rulesList);
      } else if (activeTab === 'logs') {
        const logsList = await apiFetch('GET', '/api/logs');
        setLogs(logsList);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const fetchInbounds = async (nodeId) => {
    try {
      const data = await apiFetch('GET', `/api/nodes/${nodeId}/inbounds`);
      setInbounds(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleOpenInboundsList = (node) => {
    setSelectedNodeForInbounds(node);
    fetchInbounds(node.id);
  };

  useEffect(() => {
    fetchAdminData();
    setSelectedNodeForInbounds(null); // Reset when tab changes
  }, [activeTab]);

  const handleLogout = async () => {
    try {
      await apiFetch('POST', '/api/auth/logout');
    } catch (e) {}
    localStorage.clear();
    showToast('已退出登录', 'info');
    navigate('/login', { replace: true });
  };

  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return showToast('两次密码输入不一致', 'error');
    if (newPassword.length < 6) return showToast('新密码至少6位', 'error');

    try {
      await apiFetch('POST', '/api/auth/change-password', { old_password: oldPassword, new_password: newPassword });
      showToast('密码修改成功，请重新登录', 'success');
      handleLogout();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // --------------------------------------------------------
  // User Actions
  // --------------------------------------------------------
  const handleOpenUserModal = (user = null) => {
    if (user) {
      setCurrentUser({
        ...user,
        password: '' // do not display hash
      });
    } else {
      setCurrentUser({
        uuid: '',
        email: '',
        password: '',
        role: 'user',
        package_id: '',
        expiry_time: '',
        status: 'active'
      });
    }
    setUserModalOpen(true);
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!currentUser.email) return showToast('请输入邮箱', 'error');

    try {
      if (currentUser.uuid) {
        // Edit User
        await apiFetch('PUT', `/api/users/${currentUser.uuid}`, currentUser);
        showToast('用户信息已成功更新', 'success');
      } else {
        // Create User
        await apiFetch('POST', '/api/users', currentUser);
        showToast('新用户账户已创建', 'success');
      }
      setUserModalOpen(false);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteUser = async (uuid, email) => {
    if (!window.confirm(`确定要删除用户账户 "${email}" 吗？此操作不可逆！`)) return;
    try {
      await apiFetch('DELETE', `/api/users/${uuid}`);
      showToast('用户已删除', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleResetUserTraffic = async (user) => {
    if (!window.confirm(`确认重置用户 "${user.email}" 的累计已用流量吗？`)) return;
    try {
      await apiFetch('PUT', `/api/users/${user.uuid}`, { ...user, used_traffic: 0, status: 'active' });
      showToast('已重置该用户的流量计数器', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // --------------------------------------------------------
  // Node Actions
  // --------------------------------------------------------
  const handleOpenNodeLogsModal = async (node) => {
    setCurrentNode(node);
    try {
      const data = await apiFetch('GET', `/api/nodes/${node.id}/logs`);
      setCurrentNodeLogs(data);
      setNodeLogsModalOpen(true);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleOpenNodeModal = (node = null) => {
    if (node) {
      setCurrentNode({ ...node });
    } else {
      setCurrentNode({
        id: '',
        name: '',
        server: '',
        region: '🏳️',
        multiplier: 1.0,
        advanced_config: {
          enable_sniffing: false,
          block_bittorrent: false,
          block_private: false,
          restart_time: "04:00"
        }
      });
    }
    setNodeModalOpen(true);
  };

  const handleSaveNode = async (e) => {
    e.preventDefault();
    if (!currentNode.id || !currentNode.name || !currentNode.server) {
      return showToast('请填齐节点核心字段', 'error');
    }

    try {
      const payload = {
        id: currentNode.id,
        name: currentNode.name,
        server: currentNode.server,
        region: currentNode.region,
        multiplier: Number(currentNode.multiplier || 1.0)
      };

      const isEdit = nodes.some(n => n.id === currentNode.id);
      if (isEdit) {
        await apiFetch('PUT', `/api/nodes/${currentNode.id}`, payload);
        showToast('节点服务器配置已更新', 'success');
      } else {
        await apiFetch('POST', '/api/nodes', payload);
        showToast('新节点服务器已注册，请使用命令进行部署', 'success');
      }
      setNodeModalOpen(false);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleForceReportAll = async () => {
    try {
      const res = await apiFetch('POST', '/api/nodes/force-report');
      showToast(`成功向 ${res.count || 0} 个在线节点下发强制汇报指令`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateReportInterval = async (e) => {
    e.preventDefault();
    try {
      await apiFetch('POST', '/api/nodes/report-interval', { interval: intervalSecs });
      showToast('全局刷新时间已更新，所有在线节点将自动重新加载配置', 'success');
      setReportIntervalModalOpen(false);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteNode = async (id) => {
    if (!window.confirm(`确定要彻底删除节点 "${id}" 并阻断其Daemon长连接吗？`)) return;
    try {
      await apiFetch('DELETE', `/api/nodes/${id}`);
      showToast('节点已删除', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // --------------------------------------------------------
  // Inbound Actions
  // --------------------------------------------------------
  const handleOpenInboundModal = (inbound = null) => {
    if (inbound) {
      // Ensure nested fields are present
      const config = {
        dest: inbound.config?.dest || 'www.microsoft.com:443',
        serverNames: inbound.config?.serverNames || ['www.microsoft.com'],
        privateKey: inbound.config?.privateKey || '',
        'reality-opts': {
          'public-key': inbound.config?.['reality-opts']?.['public-key'] || '',
          'short-id': inbound.config?.['reality-opts']?.['short-id'] || ''
        },
        shortIds: inbound.config?.shortIds || [''],
        serviceName: inbound.config?.serviceName || 'grpc-service',
        path: inbound.config?.path || '/xh',
        host: inbound.config?.host || '',
        mode: inbound.config?.mode || 'stream-one',
        displayName: inbound.config?.displayName || '',
        aliases: inbound.config?.aliases || []
      };
      setCurrentInbound({ ...inbound, config });
    } else {
      setCurrentInbound({
        node_id: nodes.length > 0 ? nodes[0].id : '',
        port: 443,
        protocol: 'vless',
        network: 'tcp',
        security: 'reality',
        config: {
          dest: 'www.microsoft.com:443',
          serverNames: ['www.microsoft.com'],
          privateKey: '',
          'reality-opts': {
            'public-key': '',
            'short-id': ''
          },
          shortIds: [''],
          serviceName: 'grpc-service',
          path: '/xh',
          host: '',
          mode: 'stream-one',
          displayName: '',
          aliases: []
        }
      });
    }
    setInboundModalOpen(true);
  };

  const handleSaveInbound = async (e) => {
    e.preventDefault();
    if (!currentInbound.port || !currentInbound.protocol) {
      return showToast('请填齐核心字段', 'error');
    }
    try {
      const payload = {
        node_id: currentInbound.node_id,
        port: Number(currentInbound.port),
        protocol: currentInbound.protocol,
        network: currentInbound.network,
        security: currentInbound.security,
        config: currentInbound.config
      };

      if (currentInbound.id) {
        await apiFetch('PUT', `/api/inbounds/${currentInbound.id}`, payload);
        showToast('入站规则配置已更新', 'success');
      } else {
        await apiFetch('POST', '/api/inbounds', payload);
        showToast('新入站规则已注册，已同步下发至节点', 'success');
      }
      setInboundModalOpen(false);
      fetchInbounds(selectedNodeForInbounds?.id || null);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteInbound = async (id) => {
    if (!window.confirm('确认要删除该入站配置吗？节点代理端口将关闭。')) return;
    try {
      await apiFetch('DELETE', `/api/inbounds/${id}`);
      showToast('入站配置已成功下线', 'success');
      fetchInbounds(selectedNodeForInbounds?.id || null);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleGenerateInboundKeys = async () => {
    try {
      const data = await apiFetch('GET', '/api/utils/generate-keys');
      setCurrentInbound(prev => ({
        ...prev,
        config: {
          ...prev.config,
          dest: prev.config.dest || 'www.microsoft.com:443',
          serverNames: prev.config.serverNames || ['www.microsoft.com'],
          privateKey: data.privateKey,
          'reality-opts': {
            ...prev.config['reality-opts'],
            'public-key': data.publicKey,
            'short-id': data.shortId
          },
          shortIds: [data.shortId]
        }
      }));
      showToast('密钥对生成成功，公私钥及 ShortID 已自动填入表单', 'success');
    } catch (err) {
      showToast('自动生成密钥失败: ' + err.message, 'error');
    }
  };


  // --------------------------------------------------------
  // Package Actions
  // --------------------------------------------------------
  const handleOpenPkgModal = (pkg = null) => {
    if (pkg) {
      setCurrentPackage({ 
        ...pkg,
        traffic_gb: pkg.traffic ? Number((pkg.traffic / 1073741824).toFixed(2)) : 0,
        allowed_inbounds: pkg.allowed_inbounds ? [...pkg.allowed_inbounds] : []
      });
    } else {
      setCurrentPackage({
        id: '',
        name: '',
        traffic_gb: 100, // 100GB
        duration_days: 30,
        price: 19.9,
        rule_template: 'default',
        expiration_policy: 'immediate',
        allowed_inbounds: []
      });
    }
    setPkgModalOpen(true);
  };

  const handleSavePkg = async (e) => {
    e.preventDefault();
    if (!currentPackage.name || currentPackage.price == null) {
      return showToast('请填写完整的套餐字段', 'error');
    }

    try {
      const payload = {
        name: currentPackage.name,
        traffic: Math.floor(Number(currentPackage.traffic_gb) * 1073741824),
        duration_days: Number(currentPackage.duration_days),
        price: Number(currentPackage.price),
        rule_template: currentPackage.rule_template || 'default',
        expiration_policy: currentPackage.expiration_policy || 'immediate',
        allowed_inbounds: currentPackage.allowed_inbounds || []
      };

      if (currentPackage.id) {
        await apiFetch('PUT', `/api/packages/${currentPackage.id}`, payload);
        showToast('套餐规格及关联入站规则已更新', 'success');
      } else {
        await apiFetch('POST', '/api/packages', payload);
        showToast('新计费套餐已创建', 'success');
      }
      setPkgModalOpen(false);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeletePkg = async (id, name) => {
    if (!window.confirm(`确定要删除套餐 "${name}" 吗？关联用户的配置将被设为自定义套餐。`)) return;
    try {
      await apiFetch('DELETE', `/api/packages/${id}`);
      showToast('套餐已成功下线', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // --------------------------------------------------------
  // Rule Actions
  // --------------------------------------------------------
  const handleOpenRuleModal = (rule = null) => {
    if (rule) {
      setCurrentRule({ ...rule, isEdit: true });
    } else {
      setCurrentRule({
        name: '',
        content: '# New Clash Config Template\nmode: rule\n# =PROXIES=\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies:\n      - all\nrules:\n  - MATCH,PROXY',
        isEdit: false
      });
    }
    setRuleModalOpen(true);
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!currentRule.name || !currentRule.content) {
      return showToast('请填写完整的规则模板字段', 'error');
    }

    try {
      const payload = {
        name: currentRule.name,
        content: currentRule.content
      };

      if (currentRule.isEdit) {
        await apiFetch('PUT', `/api/rules/${currentRule.name}`, payload);
        showToast('规则配置模板已更新', 'success');
      } else {
        await apiFetch('POST', '/api/rules', payload);
        showToast('新规则配置模板已创建', 'success');
      }
      setRuleModalOpen(false);
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteRule = async (name) => {
    if (!window.confirm(`确定删除规则模板 "${name}" 吗？`)) return;
    try {
      await apiFetch('DELETE', `/api/rules/${name}`);
      showToast('规则配置模板已删除', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Clear Logs
  const handleClearLogs = async () => {
    if (!window.confirm('确认清空系统运行中的所有管理日志吗？此操作不可逆！')) return;
    try {
      await apiFetch('DELETE', '/api/logs');
      showToast('全局审计日志已清空', 'success');
      fetchAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  // OTA Update
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await apiFetch('GET', '/api/system/update/check');
      setOtaInfo(res);
      if (res.has_update) {
        showToast(`发现新版本: ${res.latest_version}`, 'success');
      } else {
        showToast('当前已是最新版本', 'info');
      }
    } catch (err) {
      showToast('检查更新失败: ' + err.message, 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!otaInfo?.download_url) return;
    if (!window.confirm(`确定要升级到 ${otaInfo.latest_version} 吗？这会覆盖现有文件并重启面板。`)) return;
    
    setApplyingUpdate(true);
    try {
      const res = await apiFetch('POST', '/api/system/update/apply', { download_url: otaInfo.download_url });
      showToast(res.message, 'success');
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err) {
      showToast('升级失败: ' + err.message, 'error');
      setApplyingUpdate(false);
    }
  };


  return (
    <div className="app-container">
      {/* Mobile Drawer Overlay */}
      <div className={`sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)}></div>
      
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="brand" style={{ margin: 0, fontSize: '1.6rem', background: 'linear-gradient(135deg, #a78bfa, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800 }}>Clash Panel</h1>
          <ThemeToggleButton />
        </div>
        <nav className="sidebar-nav">
          <button className={activeTab === 'summary' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('summary'); setMobileMenuOpen(false); }}>看板总览</button>
          <button className={activeTab === 'users' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('users'); setMobileMenuOpen(false); }}>用户管理</button>
          <button className={activeTab === 'nodes' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('nodes'); setMobileMenuOpen(false); }}>节点配置</button>
          <button className={activeTab === 'inbounds' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('inbounds'); setMobileMenuOpen(false); }}>入站规则</button>
          <button className={activeTab === 'packages' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('packages'); setMobileMenuOpen(false); }}>套餐定义</button>
          <button className={activeTab === 'logs' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('logs'); setMobileMenuOpen(false); }}>安全审计</button>
          <button className={activeTab === 'rules' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('rules'); setMobileMenuOpen(false); }}>规则模板</button>
          <button className={activeTab === 'maintenance' ? 'tab-btn active' : 'tab-btn'} onClick={() => { setActiveTab('maintenance'); setMobileMenuOpen(false); }}>数据维护</button>
        </nav>
        <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span className="email-badge admin-badge" style={{ fontSize: '0.8rem', textAlign: 'center', opacity: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '34px', boxSizing: 'border-box' }}>{localStorage.getItem('clash_email')}</span>
          <button className="btn btn-ghost btn-sm" style={{ height: '34px', boxSizing: 'border-box' }} onClick={() => setShowChangePwd(true)}>修改密码</button>
          <button className="btn btn-danger btn-sm" style={{ height: '34px', boxSizing: 'border-box' }} onClick={handleLogout}>安全退出</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
          <h2>
            {activeTab === 'summary' && '仪表盘总览'}
            {activeTab === 'users' && '用户管理中心'}
            {activeTab === 'nodes' && '分布式节点集群'}
            {activeTab === 'inbounds' && '全局入站规则'}
            {activeTab === 'packages' && '套餐与计费策略'}
            {activeTab === 'logs' && '系统安全审计'}
            {activeTab === 'rules' && '路由规则模板'}
          </h2>
        </div>
        
        {/* TAB 1: SUMMARY */}
        {activeTab === 'summary' && dashboardStats && (
          <div className="summary-wrapper">
            <section className="grid-4">
              <div className="glass-card stat-box">
                <span className="stat-label">注册用户数</span>
                <span className="stat-value">{dashboardStats.total_users} 人</span>
                <span className="stat-sub">正常激活: {dashboardStats.active_users} 人</span>
              </div>
              <div className="glass-card stat-box">
                <span className="stat-label">运行节点数</span>
                <span className="stat-value">{dashboardStats.online_nodes} / {dashboardStats.total_nodes}</span>
                <span className="stat-sub">在线率: {((dashboardStats.online_nodes / (dashboardStats.total_nodes || 1)) * 100).toFixed(0)}%</span>
              </div>
              <div className="glass-card stat-box">
                <span className="stat-label">已审计总流量</span>
                <span className="stat-value">{formatTraffic(dashboardStats.total_used_traffic)}</span>
                <span className="stat-sub">总流量额度: {formatTraffic(dashboardStats.total_limit_traffic)}</span>
              </div>
              <div className="glass-card stat-box">
                <span className="stat-label">整体流量使用率</span>
                <span className="stat-value">
                  {((dashboardStats.total_used_traffic / (dashboardStats.total_limit_traffic || 1)) * 100).toFixed(1)}%
                </span>
                <div className="progress-bar-wrapper" style={{ marginTop: '0.5rem' }}>
                  <div className="progress-bar-fill" style={{ width: `${(dashboardStats.total_used_traffic / (dashboardStats.total_limit_traffic || 1)) * 100}%` }}></div>
                </div>
              </div>
            </section>

            <section className="grid-2" style={{ marginTop: '1.5rem' }}>
              <div className="glass-card stat-box">
                <span className="stat-label">集群总带宽实时上行 (Tx)</span>
                <span className="stat-value" style={{ color: '#00d2ff' }}>
                  {dashboardStats.cluster_network?.tx_sec > 0 ? formatTraffic(dashboardStats.cluster_network.tx_sec) + '/s' : '0.00 B/s'}
                </span>
                <span className="stat-sub">聚合所有在线节点实时负载</span>
              </div>
              <div className="glass-card stat-box">
                <span className="stat-label">集群总带宽实时下行 (Rx)</span>
                <span className="stat-value" style={{ color: '#00ffcc' }}>
                  {dashboardStats.cluster_network?.rx_sec > 0 ? formatTraffic(dashboardStats.cluster_network.rx_sec) + '/s' : '0.00 B/s'}
                </span>
                <span className="stat-sub">聚合所有在线节点实时负载</span>
              </div>
            </section>
            
            <section className="grid-2" style={{ marginTop: '1.5rem' }}>
              <div className="glass-card stat-box" style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="stat-label">今日总流量消耗</span>
                <span className="stat-value" style={{ color: '#00ff88', margin: '0.5rem 0' }}>
                  {formatTraffic(dashboardStats.today_traffic || 0)}
                </span>
                <div style={{ marginTop: '1rem', flex: 1 }}>
                  <span className="stat-label" style={{ display: 'block', marginBottom: '0.5rem' }}>用户消耗排行 (Top 5)</span>
                  <table style={{ width: '100%', fontSize: '0.9rem' }}>
                    <tbody>
                      {dashboardStats.top_users_today?.length > 0 ? (
                        dashboardStats.top_users_today.map((u, i) => (
                          <tr key={u.email}>
                            <td style={{ padding: '4px 0' }}>{i + 1}. {u.email}</td>
                            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatTraffic(u.traffic)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan="2" className="cell-dim" style={{ padding: '4px 0' }}>今日暂无流量消耗</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              
              <div className="glass-card stat-box" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="stat-label" style={{ alignSelf: 'flex-start' }}>今日节点流量占比</span>
                {dashboardStats.node_traffic_today?.length > 0 ? (
                  <div style={{ display: 'flex', gap: '2rem', width: '100%', alignItems: 'center', marginTop: '1rem', flex: 1 }}>
                    <div 
                      style={{ 
                        width: '120px', 
                        height: '120px', 
                        borderRadius: '50%',
                        background: generatePieChartGradient(dashboardStats.node_traffic_today),
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        flexShrink: 0
                      }}
                    ></div>
                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: '150px' }}>
                      {dashboardStats.node_traffic_today.map((n, i) => {
                        const colors = ['#00ff88', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
                        const color = colors[i % colors.length];
                        return (
                          <div key={n.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 2 }}></span>
                              {n.name}
                            </span>
                            <span style={{ fontWeight: 'bold' }}>{formatTraffic(n.traffic)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                   <div className="cell-dim" style={{ marginTop: '2rem', flex: 1, display: 'flex', alignItems: 'center' }}>今日暂无节点流量数据</div>
                )}
              </div>
            </section>
            
            <div className="glass-card welcome-admin" style={{ marginTop: '1.5rem' }}>
              <h3>欢迎使用分布式中控系统</h3>
              <p>当前面板为中控节点，负责向分部在全球的被控端 Xray 实例发送同步命令，并通过 WSS 网关保持实时长连接以进行实时审计与规则防御。</p>
            </div>
          </div>
        )}

        {/* TAB 2: USERS */}
        {activeTab === 'users' && (
          <div className="users-tab">
            <div className="action-row">
              <h3>用户管理控制台</h3>
              <button className="btn btn-primary btn-sm" onClick={() => handleOpenUserModal()}>+ 新增用户</button>
            </div>
            
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>账号邮箱</th>
                    <th>UUID</th>
                    <th>套餐属性</th>
                    <th>累计用量 / 额度上限</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>暂无注册用户，点击“新增用户”添加。</td></tr>
                  ) : (
                    users.map((u) => {
                      const userTrafficPercent = u.total_traffic > 0 
                        ? Math.min(100, (u.used_traffic / u.total_traffic) * 100)
                        : 0;
                      return (
                        <tr key={u.uuid}>
                          <td style={{ fontWeight: 600 }}>{u.email} {u.role === 'admin' && <span className="badge badge-info">管理员</span>}</td>
                          <td className="cell-uuid" title={u.uuid}>{u.uuid.substring(0, 14)}...</td>
                          <td>
                            <span className="badge badge-info">
                              {packages.find(p => p.id === u.package_id)?.name || '自定义/无'}
                            </span>
                          </td>
                          <td>
                            <div className="cell-traffic-col">
                              <span>{formatTraffic(u.used_traffic)} / {u.total_traffic > 0 ? formatTraffic(u.total_traffic) : '无上限'}</span>
                              {u.total_traffic > 0 && (
                                <div className="progress-bar-wrapper mini">
                                  <div className="progress-bar-fill" style={{ width: `${userTrafficPercent}%` }}></div>
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${u.status === 'active' ? 'badge-success' : u.status === 'expired' ? 'badge-warning' : 'badge-danger'}`}>
                              {u.status === 'active' ? '正常' : u.status === 'expired' ? '已过期' : '封禁'}
                            </span>
                          </td>
                          <td className="cell-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleOpenUserModal(u)}>编辑</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleResetUserTraffic(u)}>清零</button>
                            {u.email !== 'admin@clash.sub' && (
                              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteUser(u.uuid, u.email)}>删除</button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: NODES */}
        {activeTab === 'nodes' && (
          <div className="nodes-tab">
            <div className="action-row">
              <h3>节点控制集群</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-warning btn-sm" onClick={() => setReportIntervalModalOpen(true)}>刷新时间设置</button>
                <button className="btn btn-primary btn-sm" onClick={handleForceReportAll}>一键强制刷新</button>
                <button className="btn btn-primary btn-sm" onClick={() => handleOpenNodeModal()}>+ 新增节点</button>
              </div>
            </div>
            
            {nodes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>暂无注册节点。</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                {nodes.map(n => {
                  const installCmd = `curl -sS https://${window.location.host}/install.sh | sudo bash -s -- --url wss://${window.location.host} --node ${n.id} --token ${n.secret || 'node-secret'}`;
                  return (
                    <div key={n.id}>
                      <NodeCard 
                        node={n} 
                        formatTraffic={formatTraffic} 
                        actions={
                          <>
                            <button className="btn-icon" title="复制部署命令" onClick={() => {
                              navigator.clipboard.writeText(installCmd);
                              showToast('一键部署命令已复制', 'success');
                            }}><ClipboardCopy size={16} /></button>
                            <button className="btn-icon" title="查看推送日志" onClick={() => handleOpenNodeLogsModal(n)}><Terminal size={16} /></button>
                            <button className="btn-icon" title="编辑" onClick={() => handleOpenNodeModal(n)}><Edit2 size={16} /></button>
                            <button className="btn-icon danger" title="删除" onClick={() => handleDeleteNode(n.id)}><Trash2 size={16} /></button>
                          </>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* TAB 3.5: INBOUNDS */}
        {activeTab === 'inbounds' && (
          <div className="inbounds-tab">
            <div className="action-row">
              <h3>全局入站规则管理</h3>
              <button className="btn btn-primary btn-sm" onClick={() => handleOpenInboundModal()}>+ 新增入站规则</button>
            </div>
            
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>所属节点</th>
                    <th>端口</th>
                    <th>代理协议</th>
                    <th>传输网络</th>
                    <th>安全机制</th>
                    <th>核心参数摘要</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {inbounds.length === 0 ? (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>暂无任何入站配置，请点击“新增入站规则”进行配置。</td></tr>
                  ) : (
                    inbounds.map((inb) => {
                      let summary = '-';
                      if (inb.security === 'reality') {
                        summary = `目标: ${inb.config?.dest || 'www.microsoft.com:443'} | SNI: ${inb.config?.serverNames?.[0] || 'www.microsoft.com'}`;
                      } else if (inb.network === 'grpc') {
                        summary = `Service: ${inb.config?.serviceName || 'grpc-service'}`;
                      } else if (inb.network === 'xhttp') {
                        summary = `Path: ${inb.config?.path || '/xh'} | Mode: ${inb.config?.mode || 'stream-one'}`;
                      }
                      const parentNode = nodes.find(n => n.id === inb.node_id);
                      const displayName = inb.config?.displayName ? `${inb.config.displayName} (自定义)` : (parentNode ? parentNode.name : inb.node_id);
                      return (
                        <tr key={inb.id}>
                          <td style={{ fontWeight: 600 }}>{displayName}</td>
                          <td style={{ fontWeight: 600, color: 'var(--success)' }}>{inb.port}</td>
                          <td><span className="badge badge-info">{inb.protocol.toUpperCase()}</span></td>
                          <td><span className="badge badge-info">{inb.network.toUpperCase()}</span></td>
                          <td>
                            <span className={`badge ${inb.security === 'reality' ? 'badge-success' : 'badge-warning'}`}>
                              {inb.security.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{summary}</td>
                          <td className="cell-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleOpenInboundModal(inb)}>编辑</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteInbound(inb.id)}>删除</button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: PACKAGES */}
        {activeTab === 'packages' && (
          <div className="packages-tab">
            <div className="action-row">
              <h3>套餐计划与计费标准</h3>
              <button className="btn btn-primary btn-sm" onClick={() => handleOpenPkgModal()}>+ 创建套餐</button>
            </div>
            
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>套餐名称</th>
                    <th>包含流量上限</th>
                    <th>有效时长 (天)</th>
                    <th>资费标准</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>暂无套餐，请“创建套餐”添加。</td></tr>
                  ) : (
                    packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td style={{ fontWeight: 600 }}>{pkg.name}</td>
                        <td>{formatTraffic(pkg.traffic)}</td>
                        <td className="cell-dim">{pkg.duration_days} 天</td>
                        <td style={{ fontWeight: 700, color: 'var(--success)' }}>¥ {pkg.price}</td>
                        <td className="cell-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleOpenPkgModal(pkg)}>编辑</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeletePkg(pkg.id, pkg.name)}>删除</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: LOGS */}
        {activeTab === 'logs' && (
          <div className="logs-tab">
            <div className="action-row">
              <h3>安全审计与日志</h3>
              <button className="btn btn-danger btn-sm" onClick={handleClearLogs}>清空审计日志</button>
            </div>
            
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作类型</th>
                    <th>操作目标</th>
                    <th>详情</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>暂无操作审计日志。</td></tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.id}>
                        <td className="cell-dim">{new Date(l.time).toLocaleString('zh-CN')}</td>
                        <td><span className="badge badge-info">{l.action}</span></td>
                        <td style={{ fontWeight: 600 }}>{l.target}</td>
                        <td>{l.detail}</td>
                        <td className="cell-dim">{l.ip}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: RULES */}
        {activeTab === 'rules' && (
          <div className="rules-tab">
            <div className="action-row">
              <h3>Clash 规则配置模板</h3>
              <button className="btn btn-primary btn-sm" onClick={() => handleOpenRuleModal()}>+ 新增规则模板</button>
            </div>
            
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>模板名称</th>
                    <th>规则内容预览 (前 3 行)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr><td colSpan="3" style={{ textAlign: 'center', padding: '2rem' }}>暂无规则模板。</td></tr>
                  ) : (
                    rules.map((rule) => {
                      const previewLines = (rule.content || '').split('\n').slice(0, 3).join('\n');
                      return (
                        <tr key={rule.name}>
                          <td style={{ fontWeight: 600 }}>{rule.name} {rule.name === 'default' && <span className="badge badge-info">默认</span>}</td>
                          <td className="cell-dim" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>{previewLines}...</td>
                          <td className="cell-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleOpenRuleModal(rule)}>编辑</button>
                            {rule.name !== 'default' && (
                              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(rule.name)}>删除</button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 7: MAINTENANCE */}
        {activeTab === 'maintenance' && (
          <div className="maintenance-tab">
            <div className="action-row">
              <h3>数据维护与安全</h3>
            </div>
            
            <div className="card glass" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--primary)' }}>
                <CloudDownload size={20} /> 系统 OTA 在线升级
              </h4>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
                当前部署模式支持免重新编译的极速一键升级。点击下方按钮检查并应用主控端代码更新，无需登录 SSH 终端！
              </p>
              
              {otaInfo && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                    当前版本：<code style={{ color: 'var(--text-dim)' }}>{otaInfo.current_version}</code>
                  </p>
                  <p style={{ margin: '0', fontSize: '0.9rem' }}>
                    最新版本：<code style={{ color: otaInfo.has_update ? 'var(--warning)' : 'var(--success)' }}>{otaInfo.latest_version}</code>
                  </p>
                  {otaInfo.has_update && (
                    <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>更新日志：</strong>
                      <pre style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                        {otaInfo.changelog}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                  className="btn btn-ghost" 
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate || applyingUpdate}
                >
                  {checkingUpdate ? '正在检查...' : '检查更新'}
                </button>
                {otaInfo?.has_update && (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleApplyUpdate}
                    disabled={applyingUpdate}
                  >
                    {applyingUpdate ? '正在应用并重启...' : '一键极速升级'}
                  </button>
                )}
              </div>
            </div>

            <div className="card glass" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--primary)' }}>
                <Database size={20} /> 备份当前数据
              </h4>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
                该操作将下载当前系统所有数据（节点、用户、订阅配置等）的 SQLite 数据库文件。
                导出的文件将携带系统专属时间戳及防伪签名，用于在未来的灾难恢复或系统迁移时验证备份合法性。
              </p>
              <button className="btn btn-primary" onClick={async () => {
                const token = localStorage.getItem('clash_admin_token');
                if (!token) return showToast("未找到有效的管理员令牌", 'error');
                try {
                  const res = await fetch('/api/system/backup', {
                    headers: { 'Authorization': `Bearer ${token}` }
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(()=>({}));
                    throw new Error(err.error || '导出失败');
                  }
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const disposition = res.headers.get('Content-Disposition');
                  let filename = 'clash_backup.db';
                  if (disposition && disposition.includes('filename=')) {
                    filename = disposition.split('filename=')[1].replace(/"/g, '');
                  }
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                  showToast("备份已成功导出", 'success');
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }}>
                <Download size={16} /> 导出安全备份
              </button>
            </div>

            <div className="card glass" style={{ padding: '1.5rem', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, transparent 100%)' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--danger)' }}>
                <Upload size={20} /> 从备份恢复数据
              </h4>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
                上传带有防伪签名的数据库备份文件。
                <strong style={{ color: 'var(--danger)' }}>注意：恢复成功后，当前的所有数据将被完全覆盖！系统将触发重启，所有节点和用户将被强制断开，请谨慎操作。</strong>
              </p>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const fileInput = document.getElementById('restore-file');
                if (!fileInput.files || fileInput.files.length === 0) {
                  return showToast("请先选择数据库备份文件", 'error');
                }
                const confirmMsg = "确定要恢复数据吗？此操作不可逆！\n系统会在恢复后自动重启。";
                if (!window.confirm(confirmMsg)) return;
                
                const formData = new FormData();
                formData.append('dbfile', fileInput.files[0]);
                
                try {
                  const res = await fetch('/api/system/restore', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('clash_admin_token')}` },
                    body: formData
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || '恢复失败');
                  
                  showToast(data.message || '恢复成功，系统正在重启...', 'success');
                  setTimeout(() => {
                    localStorage.removeItem('clash_admin_token');
                    localStorage.removeItem('clash_token');
                    window.location.href = '/login';
                  }, 2000);
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <input type="file" id="restore-file" accept=".db,.sqlite,.sqlite3" className="input" style={{ padding: '0.5rem', flex: 1 }} required />
                  <button type="submit" className="btn btn-danger"><Upload size={16} /> 验证并恢复</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </main>

      {/* ========================================================
          NODE LOGS MODAL
      ======================================================== */}
      {nodeLogsModalOpen && currentNode && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="modal-header">
              <h3>节点推送日志: {currentNode.name}</h3>
              <button className="btn-icon" onClick={() => setNodeLogsModalOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {currentNodeLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>暂无推送日志记录。</div>
              ) : (
                <div style={{ background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  {currentNodeLogs.map((log, index) => (
                    <div key={log.id || index} style={{ marginBottom: '0.5rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
                      <span style={{ color: '#569cd6' }}>[{new Date(log.timestamp * 1000).toLocaleString('zh-CN')}]</span>{' '}
                      <span style={{ color: '#4ec9b0' }}>{log.action}</span>{' '}
                      <span style={{ color: log.status === 'success' ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>[{log.status.toUpperCase()}]</span>{' '}
                      <span style={{ color: '#ce9178' }}>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setNodeLogsModalOpen(false)}>关闭</button>
              <button type="button" className="btn btn-primary" onClick={() => handleOpenNodeLogsModal(currentNode)}>刷新</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          USER MODAL
      ======================================================== */}
      {userModalOpen && currentUser && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3>{currentUser.uuid ? '编辑用户属性' : '新增用户账号'}</h3>
              <button className="btn-icon" onClick={() => setUserModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveUser}>
              <div className="form-group">
                <label>登录邮箱 / 唯一标识 (必填)</label>
                <input 
                  type="text" 
                  value={currentUser.email} 
                  onChange={(e) => setCurrentUser({ ...currentUser, email: e.target.value })} 
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>{currentUser.uuid ? '重置密码' : '登录密码 (留空默认使用生成的 UUID)'}</label>
                {currentUser.uuid ? (
                  <div>
                    {!currentUser.password ? (
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={() => {
                          const randomPwd = Math.random().toString(36).slice(-8);
                          setCurrentUser({ ...currentUser, password: randomPwd });
                        }}
                      >
                        生成并重置 8 位随机密码
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--primary)', background: 'var(--bg-secondary)', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                          {currentUser.password}
                        </span>
                        <button 
                          type="button" 
                          className="btn btn-ghost btn-sm" 
                          onClick={() => setCurrentUser({ ...currentUser, password: '' })}
                        >
                          取消重置
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <PasswordInput 
                    value={currentUser.password} 
                    onChange={(e) => setCurrentUser({ ...currentUser, password: e.target.value })} 
                    placeholder="密码至少6位"
                  />
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>账号角色</label>
                  <select 
                    value={currentUser.role} 
                    onChange={(e) => setCurrentUser({ ...currentUser, role: e.target.value })}
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>状态</label>
                  <select 
                    value={currentUser.status} 
                    onChange={(e) => setCurrentUser({ ...currentUser, status: e.target.value })}
                  >
                    <option value="active">正常运行</option>
                    <option value="disabled">手动封禁</option>
                    <option value="expired">过期/超额</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>分配套餐 (可选)</label>
                  <select 
                    value={currentUser.package_id || ''} 
                    onChange={(e) => {
                      const pkgId = e.target.value;
                      const selectedPkg = packages.find(p => p.id === pkgId);
                      if (selectedPkg) {
                        const expiry = new Date();
                        expiry.setDate(expiry.getDate() + selectedPkg.duration_days);
                        setCurrentUser({ 
                          ...currentUser, 
                          package_id: pkgId, 
                          expiry_time: expiry.toISOString().split('T')[0]
                        });
                      } else {
                        setCurrentUser({ ...currentUser, package_id: '', expiry_time: '' });
                      }
                    }}
                  >
                    <option value="">自定义套餐</option>
                    {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>过期日期</label>
                  <input 
                    type="text" 
                    value={currentUser.expiry_time || ''} 
                    onChange={(e) => setCurrentUser({ ...currentUser, expiry_time: e.target.value })} 
                    placeholder="YYYY-MM-DD"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setUserModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存用户信息</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          NODE MODAL
      ======================================================== */}
      {nodeModalOpen && currentNode && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <h3>{nodes.some(n => n.id === currentNode.id) ? '编辑节点参数' : '录入新加速节点'}</h3>
              <button className="btn-icon" onClick={() => setNodeModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveNode}>
              <div className="form-row">
                <div className="form-group">
                  <label>节点 ID / Tag (不可修改)</label>
                  <input 
                    type="text" 
                    value={currentNode.id} 
                    onChange={(e) => setCurrentNode({ ...currentNode, id: e.target.value })} 
                    placeholder="例如: HK-01"
                    disabled={nodes.some(n => n.id === currentNode.id)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>节点显示名称 (必填)</label>
                  <input 
                    type="text" 
                    value={currentNode.name} 
                    onChange={(e) => setCurrentNode({ ...currentNode, name: e.target.value })} 
                    placeholder="例如: 🇭🇰 香港 Reality 01"
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>节点服务器 IP / 域名 (必填)</label>
                  <input 
                    type="text" 
                    value={currentNode.server} 
                    onChange={(e) => setCurrentNode({ ...currentNode, server: e.target.value })}
                    placeholder="hk1.example.com"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>节点所属地区 (Emoji)</label>
                  <select 
                    value={currentNode.region || '🏳️'} 
                    onChange={(e) => setCurrentNode({ ...currentNode, region: e.target.value })}
                  >
                    <option value="🏳️">🏳️ 未知/通用</option>
                    <option value="🇭🇰">🇭🇰 香港</option>
                    <option value="🇹🇼">🇹🇼 台湾</option>
                    <option value="🇯🇵">🇯🇵 日本</option>
                    <option value="🇸🇬">🇸🇬 新加坡</option>
                    <option value="🇺🇸">🇺🇸 美国</option>
                    <option value="🇰🇷">🇰🇷 韩国</option>
                    <option value="🇬🇧">🇬🇧 英国</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>流量结算倍率 (必填)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    value={currentNode.multiplier != null ? currentNode.multiplier : 1.0} 
                    onChange={(e) => setCurrentNode({ ...currentNode, multiplier: Number(e.target.value) })} 
                    placeholder="1.0"
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Xray 底层全局控制 (Xray Advanced Config)</h4>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input 
                    type="checkbox" 
                    checked={currentNode.advanced_config?.enable_sniffing || false}
                    onChange={(e) => setCurrentNode({ 
                      ...currentNode, 
                      advanced_config: { ...currentNode.advanced_config, enable_sniffing: e.target.checked }
                    })} 
                  />
                  <span style={{color: 'var(--text-primary)'}}>开启全协议流量嗅探 (Enable Sniffing: HTTP/TLS/QUIC)</span>
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input 
                    type="checkbox" 
                    checked={currentNode.advanced_config?.block_bittorrent || false}
                    onChange={(e) => setCurrentNode({ 
                      ...currentNode, 
                      advanced_config: { ...currentNode.advanced_config, block_bittorrent: e.target.checked }
                    })} 
                  />
                  <span style={{color: 'var(--text-primary)'}}>强制拦截 BT 下载 (Block BitTorrent)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={currentNode.advanced_config?.block_private || false}
                    onChange={(e) => setCurrentNode({ 
                      ...currentNode, 
                      advanced_config: { ...currentNode.advanced_config, block_private: e.target.checked }
                    })} 
                  />
                  <span style={{color: 'var(--text-primary)'}}>屏蔽局域网 IP (Block Private LAN / geoip:private)</span>
                </label>

                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>每日自动固化配置与重载时间:</label>
                  <input 
                    type="time" 
                    value={currentNode.advanced_config?.restart_time || "04:00"}
                    onChange={(e) => setCurrentNode({ 
                      ...currentNode, 
                      advanced_config: { ...currentNode.advanced_config, restart_time: e.target.value }
                    })} 
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px' }}
                  />
                </div>

                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>心跳与上报间隔 (秒):</label>
                  <input 
                    type="number" 
                    min="5"
                    max="300"
                    value={currentNode.advanced_config?.report_interval || "30"}
                    onChange={(e) => setCurrentNode({ 
                      ...currentNode, 
                      advanced_config: { ...currentNode.advanced_config, report_interval: e.target.value }
                    })} 
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setNodeModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">发布上线</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          PACKAGE MODAL
      ======================================================== */}
      {pkgModalOpen && currentPackage && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>{currentPackage.id ? '编辑套餐规格' : '定制新计费套餐'}</h3>
              <button className="btn-icon" onClick={() => setPkgModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSavePkg}>
              <div className="form-group">
                <label>套餐名称 (必填)</label>
                <input 
                  type="text" 
                  value={currentPackage.name} 
                  onChange={(e) => setCurrentPackage({ ...currentPackage, name: e.target.value })} 
                  placeholder="如 standard-plan"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>有效天数 (天)</label>
                  <input 
                    type="number" 
                    value={currentPackage.duration_days} 
                    onChange={(e) => setCurrentPackage({ ...currentPackage, duration_days: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>资费标准 (元)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={currentPackage.price} 
                    onChange={(e) => setCurrentPackage({ ...currentPackage, price: Number(e.target.value) })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>包含限额流量 (GB)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={currentPackage.traffic_gb} 
                  onChange={(e) => setCurrentPackage({ ...currentPackage, traffic_gb: Number(e.target.value) })}
                  required
                />
                <span className="form-hint">当前输入相当于: {formatTraffic(currentPackage.traffic_gb * 1073741824)}</span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>订阅分流规则模板</label>
                  <select 
                    value={currentPackage.rule_template || 'default'} 
                    onChange={(e) => setCurrentPackage({ ...currentPackage, rule_template: e.target.value })}
                  >
                    {rules.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>到期计费策略</label>
                  <select 
                    value={currentPackage.expiration_policy || 'immediate'} 
                    onChange={(e) => setCurrentPackage({ ...currentPackage, expiration_policy: e.target.value })}
                  >
                    <option value="immediate">立即激活 (自指派起开始计时)</option>
                    <option value="first_use">首次使用激活 (用户首次产生流量起计时)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>指派允许使用的入站规则</label>
                <div className="nodes-checkbox-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {nodes.map(node => {
                    const nodeInbounds = allInbounds.filter(inb => inb.node_id === node.id);
                    if (nodeInbounds.length === 0) return null;
                    return (
                      <div key={node.id} style={{ marginBottom: '10px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          {node.name} ({node.id})
                        </div>
                        <div style={{ paddingLeft: '10px' }}>
                          {nodeInbounds.map(inb => {
                            let aliases = [];
                            if (inb.config && inb.config.aliases && Array.isArray(inb.config.aliases)) {
                              aliases = inb.config.aliases;
                            }
                            return (
                              <div key={inb.id} style={{ marginBottom: '8px' }}>
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                                  <input 
                                    type="checkbox" 
                                    value={inb.id}
                                    checked={(currentPackage.allowed_inbounds || []).includes(inb.id)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const inbVal = e.target.value;
                                      setCurrentPackage(prev => {
                                        const currentList = prev.allowed_inbounds || [];
                                        const newList = checked 
                                          ? [...currentList, inbVal]
                                          : currentList.filter(x => x !== inbVal);
                                        return { ...prev, allowed_inbounds: newList };
                                      });
                                    }}
                                  />
                                  <span style={{ marginLeft: '6px', fontWeight: aliases.length ? 'bold' : 'normal' }}>
                                    主入口: 端口 {inb.port} ({inb.protocol.toUpperCase()}/{inb.network.toUpperCase()})
                                  </span>
                                </label>
                                {aliases.map((alias, idx) => {
                                  const aliasId = `${inb.id}_alias_${idx}`;
                                  return (
                                    <label key={aliasId} className="checkbox-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', paddingLeft: '24px' }}>
                                      <input 
                                        type="checkbox" 
                                        value={aliasId}
                                        checked={(currentPackage.allowed_inbounds || []).includes(aliasId)}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          const inbVal = e.target.value;
                                          setCurrentPackage(prev => {
                                            const currentList = prev.allowed_inbounds || [];
                                            const newList = checked 
                                              ? [...currentList, inbVal]
                                              : currentList.filter(x => x !== inbVal);
                                            return { ...prev, allowed_inbounds: newList };
                                          });
                                        }}
                                      />
                                      <span style={{ marginLeft: '6px', color: 'var(--text-secondary)' }}>
                                        别名入口: {alias.name} ({alias.server}:{alias.port})
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setPkgModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">创建/发布套餐</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          INBOUND MODAL
      ======================================================== */}
      {inboundModalOpen && currentInbound && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h3>{currentInbound.id ? '编辑入站规则配置' : '配置新增入站规则'}</h3>
              <button className="btn-icon" onClick={() => setInboundModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveInbound}>
              <div className="form-row">
                <div className="form-group">
                  <label>所属节点 (必填)</label>
                  <select 
                    value={currentInbound.node_id} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, node_id: e.target.value })}
                    required
                  >
                    <option value="" disabled>请选择一个节点</option>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.server})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>自定义显示名称 (可选)</label>
                  <input 
                    type="text" 
                    value={currentInbound.config?.displayName || ''} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, config: { ...currentInbound.config, displayName: e.target.value } })}
                    placeholder="客户端中显示的节点名称"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>监听端口 (必填)</label>
                  <input 
                    type="number" 
                    value={currentInbound.port} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, port: Number(e.target.value) })}
                    placeholder="443"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>代理协议</label>
                  <select 
                    value={currentInbound.protocol} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, protocol: e.target.value })}
                  >
                    <option value="vless">VLESS</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>传输网络协议 (Network)</label>
                  <select 
                    value={currentInbound.network} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, network: e.target.value })}
                  >
                    <option value="tcp">TCP</option>
                    <option value="grpc">gRPC</option>
                    <option value="xhttp">xhttp (XHTTP)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>安全机制 (Security)</label>
                  <select 
                    value={currentInbound.security} 
                    onChange={(e) => setCurrentInbound({ ...currentInbound, security: e.target.value })}
                  >
                    <option value="reality">REALITY (混淆)</option>
                    <option value="none">NONE (明文)</option>
                  </select>
                </div>
              </div>

              {/* REALITY OPTIONS */}
              {currentInbound.security === 'reality' && (
                <div className="reality-section-box glass" style={{ padding: '1.5rem', marginTop: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="reality-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>Reality 混淆安全参数</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleGenerateInboundKeys}>智能生成密钥对</button>
                  </div>
                  
                  <div className="form-group">
                    <label>Reality 目标网站 (dest)</label>
                    <input 
                      type="text" 
                      value={currentInbound.config?.dest || ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentInbound(prev => ({
                          ...prev,
                          config: { ...prev.config, dest: val }
                        }));
                      }}
                      placeholder="www.microsoft.com:443"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>SNI 域名范围 (多个以英文逗号分隔)</label>
                    <input 
                      type="text" 
                      value={currentInbound.config?.serverNames ? currentInbound.config.serverNames.join(',') : ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentInbound(prev => ({
                          ...prev,
                          config: { ...prev.config, serverNames: val.split(',').map(x => x.trim()) }
                        }));
                      }}
                      placeholder="www.microsoft.com,microsoft.com"
                      required
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>私钥 (privateKey - 保留在服务端)</label>
                      <input 
                        type="text" 
                        value={currentInbound.config?.privateKey || ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setCurrentInbound(prev => ({
                            ...prev,
                            config: { ...prev.config, privateKey: val }
                          }));
                        }}
                        placeholder="Reality 守护私钥"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Short ID (十六进制)</label>
                      <input 
                        type="text" 
                        value={currentInbound.config?.shortIds ? currentInbound.config.shortIds[0] : ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setCurrentInbound(prev => ({
                            ...prev,
                            config: { 
                              ...prev.config, 
                              shortIds: [val],
                              'reality-opts': {
                                ...prev.config?.['reality-opts'],
                                'short-id': val
                              }
                            }
                          }));
                        }}
                        placeholder="8b28ae09"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>公钥 (PublicKey - 下发至客户端)</label>
                    <input 
                      type="text" 
                      value={currentInbound.config?.['reality-opts']?.['public-key'] || ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentInbound(prev => ({
                          ...prev,
                          config: {
                            ...prev.config,
                            'reality-opts': {
                              ...prev.config?.['reality-opts'],
                              'public-key': val
                            }
                          }
                        }));
                      }}
                      placeholder="Reality 公钥"
                      required
                    />
                  </div>
                </div>
              )}

              {/* gRPC OPTIONS */}
              {currentInbound.network === 'grpc' && (
                <div className="grpc-section-box glass" style={{ padding: '1.5rem', marginTop: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--info)' }}>gRPC 传输协议参数</span>
                  <div className="form-group" style={{ marginTop: '0.8rem' }}>
                    <label>gRPC 服务名称 (serviceName)</label>
                    <input 
                      type="text" 
                      value={currentInbound.config?.serviceName || ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentInbound(prev => ({
                          ...prev,
                          config: { ...prev.config, serviceName: val }
                        }));
                      }}
                      placeholder="grpc-service"
                      required
                    />
                  </div>
                </div>
              )}

              {/* xhttp OPTIONS */}
              {currentInbound.network === 'xhttp' && (
                <div className="xhttp-section-box glass" style={{ padding: '1.5rem', marginTop: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--info)' }}>xhttp 传输协议参数</span>
                  <div className="form-row" style={{ marginTop: '0.8rem' }}>
                    <div className="form-group">
                      <label>请求路径 (path)</label>
                      <input 
                        type="text" 
                        value={currentInbound.config?.path || ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setCurrentInbound(prev => ({
                            ...prev,
                            config: { ...prev.config, path: val }
                          }));
                        }}
                        placeholder="/xh"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>传输模式 (mode)</label>
                      <select 
                        value={currentInbound.config?.mode || 'stream-one'} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setCurrentInbound(prev => ({
                            ...prev,
                            config: { ...prev.config, mode: val }
                          }));
                        }}
                      >
                        <option value="stream-one">stream-one (单向流)</option>
                        <option value="stream-multi">stream-multi (多路流)</option>
                        <option value="packet-up">packet-up (数据包)</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>虚拟主机域名 (host - 可留空)</label>
                    <input 
                      type="text" 
                      value={currentInbound.config?.host || ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentInbound(prev => ({
                          ...prev,
                          config: { ...prev.config, host: val }
                        }));
                      }}
                      placeholder="host.example.com"
                    />
                  </div>
                </div>
              )}

              {/* ALIASES MANAGEMENT */}
              <div className="aliases-section-box glass" style={{ padding: '1.5rem', marginTop: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>多入口别名配置 (可选)</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                    const newAliases = [...(currentInbound.config?.aliases || []), { name: '', server: '', port: 443 }];
                    setCurrentInbound(prev => ({
                      ...prev,
                      config: { ...prev.config, aliases: newAliases }
                    }));
                  }}>+ 添加别名入口</button>
                </div>
                {currentInbound.config?.aliases?.length > 0 ? (
                  currentInbound.config.aliases.map((alias, idx) => (
                    <div key={idx} className="form-row" style={{ alignItems: 'flex-end', marginBottom: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '0.8rem', borderRadius: '6px' }}>
                      <div className="form-group" style={{ flex: 1.5, marginBottom: 0 }}>
                        <label>别名展示名称</label>
                        <input 
                          type="text" 
                          value={alias.name} 
                          placeholder="例如：HK-专线"
                          required
                          onChange={(e) => {
                            const newAliases = [...currentInbound.config.aliases];
                            newAliases[idx].name = e.target.value;
                            setCurrentInbound(prev => ({ ...prev, config: { ...prev.config, aliases: newAliases } }));
                          }}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                        <label>连接地址 (覆盖主IP/域名)</label>
                        <input 
                          type="text" 
                          value={alias.server} 
                          placeholder="中转IP / IPv6地址"
                          required
                          onChange={(e) => {
                            const newAliases = [...currentInbound.config.aliases];
                            newAliases[idx].server = e.target.value;
                            setCurrentInbound(prev => ({ ...prev, config: { ...prev.config, aliases: newAliases } }));
                          }}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label>连接端口</label>
                        <input 
                          type="number" 
                          value={alias.port} 
                          required
                          onChange={(e) => {
                            const newAliases = [...currentInbound.config.aliases];
                            newAliases[idx].port = Number(e.target.value);
                            setCurrentInbound(prev => ({ ...prev, config: { ...prev.config, aliases: newAliases } }));
                          }}
                        />
                      </div>
                      <button type="button" className="btn-icon danger" title="删除别名" onClick={() => {
                        const newAliases = [...currentInbound.config.aliases];
                        newAliases.splice(idx, 1);
                        setCurrentInbound(prev => ({ ...prev, config: { ...prev.config, aliases: newAliases } }));
                      }} style={{ padding: '0.5rem', marginBottom: '2px' }}><Trash2 size={16} /></button>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#888' }}>
                    通过添加别名，可以在不新建实际物理监听端口的情况下，给订阅下发专线IP、IPv6入口等额外节点配置。所有别名的流量均汇聚合并计算。
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setInboundModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存入站规则</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          RULE MODAL
      ======================================================== */}
      {ruleModalOpen && currentRule && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <h3>{currentRule.isEdit ? '编辑 Clash 规则模板' : '新增 Clash 规则模板'}</h3>
              <button className="btn-icon" onClick={() => setRuleModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveRule}>
              <div className="form-group">
                <label>模板名称 (必填，仅限字母数字/下划线/中划线)</label>
                <input 
                  type="text" 
                  value={currentRule.name} 
                  onChange={(e) => setCurrentRule({ ...currentRule, name: e.target.value })}
                  placeholder="e.g. game_rules"
                  disabled={currentRule.isEdit}
                  required
                />
              </div>

              <div className="form-group">
                <label>规则 YAML 内容 (必须包含 proxies 注入位置，如 # =PROXIES= 或 =PROXIES=)</label>
                <textarea 
                  value={currentRule.content} 
                  onChange={(e) => setCurrentRule({ ...currentRule, content: e.target.value })}
                  style={{ height: '350px', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.4', width: '100%', boxSizing: 'border-box', background: '#111', color: '#fff', border: '1px solid #444', padding: '10px', borderRadius: '6px' }}
                  placeholder="# Clash Config Template..."
                  required
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setRuleModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存规则模板</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChangePwd && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>修改管理员密码</h3>
              <button className="btn-icon" onClick={() => setShowChangePwd(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>旧密码</label>
                <PasswordInput required value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
              </div>
              <div className="form-group">
                <label>新密码</label>
                <PasswordInput required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </div>
              <div className="form-group">
                <label>确认新密码</label>
                <PasswordInput required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowChangePwd(false)}>取消</button>
                <button type="submit" className="btn btn-primary">确认修改</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Report Interval Modal */}
      {reportIntervalModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>全局刷新时间设置</h3>
              <button className="btn-icon" onClick={() => setReportIntervalModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleUpdateReportInterval}>
              <div className="form-group">
                <label>节点汇报间隔时间 (秒)</label>
                <input 
                  type="number" 
                  min="5" 
                  required 
                  value={intervalSecs} 
                  onChange={e => setIntervalSecs(e.target.value)} 
                  placeholder="例如：30"
                />
                <small className="help-text">设置后，所有节点将以此间隔向中控汇报流量和负载信息。建议不低于 15 秒。</small>
              </div>
              <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setReportIntervalModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存设置</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
