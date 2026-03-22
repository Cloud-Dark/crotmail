/**
 * Temporary Email Service - Main Worker
 * API compatible with DuckMail
 */

import { SignJWT, jwtVerify } from './jwt.js';

// ============ JWT Secret Management ============

async function getJwtSecret(env) {
  if (!env.MAIL_KV) {
    throw new Error('MAIL_KV not bound. Please bind KV namespace in Dashboard.');
  }
  
  // Prefer environment variable first
  if (env.JWT_SECRET) return env.JWT_SECRET;
  
  // Load from KV
  let secret = await env.MAIL_KV.get('jwt_secret');
  if (secret) return secret;
  
  // Auto-generate and persist
  secret = crypto.randomUUID() + crypto.randomUUID();
  await env.MAIL_KV.put('jwt_secret', secret);
  return secret;
}

// ============ Database Initialization ============

async function initDatabase(env) {
  if (!env.MAIL_KV || !env.DB) {
    throw new Error('Missing bindings: MAIL_KV=' + !!env.MAIL_KV + ', DB=' + !!env.DB);
  }
  
  // Check whether initialization already ran
  const initialized = await env.MAIL_KV.get('db_initialized');
  if (initialized) {
    await migrateDatabase(env);
    console.log('Database already initialized');
    return;
  }

  console.log('Starting database initialization...');
  
  // Create tables in steps
  const tables = [
    `CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      domain TEXT UNIQUE NOT NULL,
      is_verified INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      address TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT,
      resume_code_hash TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      msgid TEXT,
      account_id TEXT NOT NULL,
      from_name TEXT,
      from_address TEXT,
      to_address TEXT,
      subject TEXT,
      text TEXT,
      html TEXT,
      seen INTEGER DEFAULT 0,
      has_attachments INTEGER DEFAULT 0,
      size INTEGER DEFAULT 0,
      raw_source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT,
      content_type TEXT,
      size INTEGER,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )`
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_accounts_expires_at ON accounts(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_address ON accounts(address)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_resume_code_hash ON accounts(resume_code_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_account_id ON messages(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`
  ];

  try {
    // Create tables
    for (const sql of tables) {
      await env.DB.prepare(sql).run();
    }
    console.log('Tables created');
    
    // Create indexes
    for (const sql of indexes) {
      await env.DB.prepare(sql).run();
    }
    console.log('Indexes created');

    await migrateDatabase(env);

    // Mark initialization complete
    await env.MAIL_KV.put('db_initialized', 'true');
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function migrateDatabase(env) {
  try {
    await env.DB.prepare('ALTER TABLE accounts ADD COLUMN resume_code_hash TEXT').run();
  } catch {
    // Ignore migration if the column already exists.
  }

  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_resume_code_hash ON accounts(resume_code_hash)'
  ).run();
}

// ============ Utilities ============

function generateId() {
  return crypto.randomUUID();
}

function generateRandomString(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateResumeCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getDefaultExpireMinutes(env) {
  const expireDays = parseInt(env.EXPIRE_DAYS || '', 10);
  if (!Number.isNaN(expireDays) && expireDays > 0) {
    return expireDays * 24 * 60;
  }

  const expireMinutes = parseInt(env.EXPIRE_MINUTES || '43200', 10);
  return Number.isNaN(expireMinutes) || expireMinutes <= 0 ? 43200 : expireMinutes;
}

function getMessageRetentionDays(env) {
  const retentionDays = parseInt(env.MESSAGE_RETENTION_DAYS || '1', 10);
  return Number.isNaN(retentionDays) || retentionDays <= 0 ? 1 : retentionDays;
}

async function issueAuthToken(env, { address, id, scope = 'full', expiresInMinutes }) {
  const secret = await getJwtSecret(env);
  const ttlMinutes = Math.max(1, Math.floor(expiresInMinutes));

  return new SignJWT({ address, id, scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(new TextEncoder().encode(secret));
}

async function generateUniqueResumeCode(env) {
  for (let i = 0; i < 10; i++) {
    const code = generateResumeCode(8);
    const codeHash = await sha256Hex(code);
    const { results } = await env.DB.prepare(
      'SELECT id FROM accounts WHERE resume_code_hash = ? LIMIT 1'
    ).bind(codeHash).all();

    if (results.length === 0) {
      return { code, codeHash };
    }
  }

  throw new Error('Failed to generate unique resume code');
}

function getResumeUrl(request, code) {
  const origin = new URL(request.url).origin;
  return `${origin}/r/${code}`;
}

function hashPassword(password) {
  // Simple hash; production should use stronger encryption
  return btoa(password);
}

// Decode Quoted-Printable (charset-aware)
function decodeQP(str, charset = 'utf-8') {
  const decoded = str
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  // If not UTF-8, attempt charset conversion
  if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'utf8') {
    try {
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return decoded;
    }
  }
  return decoded;
}

// Decode Base64 (UTF-8 safe)
function decodeBase64(str, charset = 'utf-8') {
  try {
    const binary = atob(str.replace(/\s/g, ''));
    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // Decode using TextDecoder
    const decoder = new TextDecoder(charset);
    return decoder.decode(bytes);
  } catch {
    return str;
  }
}

// Decode content based on Content-Transfer-Encoding
function decodeContent(content, encoding, charset = 'utf-8') {
  if (!content) return '';
  const enc = (encoding || '').toLowerCase();
  
  if (enc === 'base64') {
    return decodeBase64(content.replace(/\s/g, ''), charset);
  } else if (enc === 'quoted-printable') {
    return decodeQP(content, charset);
  }
  
  // For 7bit/8bit, charset conversion may still be needed
  if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'utf8') {
    try {
      const bytes = new Uint8Array(content.length);
      for (let i = 0; i < content.length; i++) {
        bytes[i] = content.charCodeAt(i);
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return content;
    }
  }
  
  return content;
}

// Parse email headers
function parseHeaders(headerStr) {
  const headers = {};
  const lines = headerStr.split(/\r?\n/);
  let currentHeader = '';
  
  for (const line of lines) {
    if (/^\s/.test(line) && currentHeader) {
      headers[currentHeader] += ' ' + line.trim();
    } else {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentHeader = match[1].toLowerCase();
        headers[currentHeader] = match[2];
      }
    }
  }
  return headers;
}

// Parse Content-Type parameters
function parseContentType(ct) {
  if (!ct) return { type: 'text/plain', charset: 'utf-8', boundary: null };
  
  const parts = ct.split(';').map(p => p.trim());
  const type = parts[0].toLowerCase();
  let charset = 'utf-8';
  let boundary = null;
  
  for (const part of parts.slice(1)) {
    if (part.startsWith('charset=')) {
      charset = part.substring(8).replace(/"/g, '');
    } else if (part.startsWith('boundary=')) {
      boundary = part.substring(9).replace(/"/g, '');
    }
  }
  
  return { type, charset, boundary };
}

// Parse one MIME part
function parseMimePart(partStr) {
  const headerEnd = partStr.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  
  const headerStr = partStr.substring(0, headerEnd);
  const content = partStr.substring(headerEnd + 4);
  const headers = parseHeaders(headerStr);
  const ct = parseContentType(headers['content-type']);
  const encoding = headers['content-transfer-encoding'] || '7bit';
  
  return { headers, content, contentType: ct, encoding };
}

// Recursively parse email body
function parseEmailContent(rawEmail) {
  let text = '';
  let html = '';
  const attachments = [];
  
  const headerEnd = rawEmail.indexOf('\r\n\r\n');
  const headerStr = headerEnd > 0 ? rawEmail.substring(0, headerEnd) : '';
  const bodyStr = headerEnd > 0 ? rawEmail.substring(headerEnd + 4) : rawEmail;
  const mainHeaders = parseHeaders(headerStr);
  const mainCT = parseContentType(mainHeaders['content-type']);
  
  if (mainCT.type.startsWith('multipart/') && mainCT.boundary) {
    const boundaryEscaped = mainCT.boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = bodyStr.split(new RegExp(`--${boundaryEscaped}`));
    
    for (const partStr of parts) {
      if (partStr.trim() === '' || partStr.trim() === '--') continue;
      
      const part = parseMimePart(partStr);
      if (!part) continue;
      
      if (part.contentType.type === 'text/plain' && !text) {
        text = decodeContent(part.content, part.encoding, part.contentType.charset);
      } else if (part.contentType.type === 'text/html' && !html) {
        html = decodeContent(part.content, part.encoding, part.contentType.charset);
      } else if (part.contentType.type.startsWith('multipart/') && part.contentType.boundary) {
        // Nested multipart
        const nested = parseEmailContent(partStr);
        if (!text && nested.text) text = nested.text;
        if (!html && nested.html) html = nested.html;
        attachments.push(...nested.attachments);
      } else if (!part.contentType.type.startsWith('text/')) {
        // Attachment
        const filename = part.headers['content-disposition']?.match(/filename="?([^";\n]+)"?/i)?.[1] 
          || part.headers['content-type']?.match(/name="?([^";\n]+)"?/i)?.[1]
          || 'attachment';
        attachments.push({
          filename,
          contentType: part.contentType.type,
          content: part.content.trim(),
          encoding: part.encoding
        });
      }
    }
  } else if (mainCT.type === 'text/plain') {
    const encoding = mainHeaders['content-transfer-encoding'] || '7bit';
    text = decodeContent(bodyStr, encoding, mainCT.charset);
  } else if (mainCT.type === 'text/html') {
    const encoding = mainHeaders['content-transfer-encoding'] || '7bit';
    html = decodeContent(bodyStr, encoding, mainCT.charset);
  } else {
    text = bodyStr;
  }
  
  return { text, html, attachments };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Key',
    },
  });
}

function error(message, status = 400) {
  return json({ error: 'Error', message }, status);
}

async function getToken(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.substring(7);
}

async function verifyToken(token, env) {
  try {
    const secret = await getJwtSecret(env);
    const payload = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

async function getAuthUser(request, env) {
  const token = await getToken(request, env);
  if (!token) return null;

  const payload = await verifyToken(token, env);
  if (!payload) return null;

  // Ensure token exists in DB and is not expired
  const { results } = await env.DB.prepare(
    'SELECT * FROM accounts WHERE token = ? AND expires_at > datetime("now")'
  ).bind(token).all();

  if (results.length === 0) return null;

  return {
    ...results[0],
    auth_scope: payload.scope || 'full',
  };
}

function isLimitedSession(user) {
  return user?.auth_scope === 'limited';
}

// Validate ACCESS_KEY
function verifyAccessKey(request, env) {
  const headerKey = request.headers.get('X-Access-Key');
  const queryKey = new URL(request.url).searchParams.get('access_key');
  const key = headerKey || queryKey;
  if (!key || key !== env.ACCESS_KEY) {
    return false;
  }
  return true;
}

// ============ Domain Sync ============

async function syncDomains(env) {
  if (!env.MAIL_DOMAINS) return;
  if (!env.DB) return;

  const domains = env.MAIL_DOMAINS.split(',').map(d => d.trim()).filter(Boolean);
  if (domains.length === 0) return;

  try {
    // Load current domains
    const { results: existing } = await env.DB.prepare('SELECT domain FROM domains').all();
    const existingDomains = new Set(existing.map(d => d.domain));

    // Remove domains no longer listed in env
    for (const d of existing) {
      if (!domains.includes(d.domain)) {
        await env.DB.prepare('DELETE FROM domains WHERE domain = ?').bind(d.domain).run();
      }
    }

    // Add new domains (INSERT OR IGNORE avoids duplicates)
    for (const domain of domains) {
      if (!existingDomains.has(domain)) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO domains (id, domain, is_verified, created_at) VALUES (?, ?, 1, datetime("now"))'
        ).bind(generateId(), domain).run();
      }
    }
  } catch (error) {
    console.error('syncDomains error:', error);
  }
}

// ============ API Routes ============

// GET /domains - list domains
async function getDomains(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, domain, is_verified, created_at FROM domains WHERE is_verified = 1'
  ).all();

  return json({
    'hydra:member': results.map(d => ({
      id: d.id,
      domain: d.domain,
      isVerified: !!d.is_verified,
      createdAt: d.created_at,
    })),
    'hydra:totalItems': results.length,
  });
}

// POST /accounts - create account
async function createAccount(request, env) {
  const body = await request.json();
  const { address, password } = body;

  if (!address || !address.includes('@')) {
    return error('Invalid email address format');
  }

  const [username, domain] = address.split('@');
  if (username.length < 3) {
    return error('Username must be at least 3 characters');
  }
  if (!password || password.length < 6) {
    return error('Password must be at least 6 characters');
  }

  // Validate domain
  const { results: domains } = await env.DB.prepare(
    'SELECT * FROM domains WHERE domain = ? AND is_verified = 1'
  ).bind(domain).all();

  if (domains.length === 0) {
    return error('Domain not available', 422);
  }

  // Calculate expiration
  const expireMinutes = getDefaultExpireMinutes(env);
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();

  try {
    const id = generateId();
    const { code, codeHash } = await generateUniqueResumeCode(env);
    const token = await issueAuthToken(env, {
      address,
      id,
      scope: 'full',
      expiresInMinutes: expireMinutes,
    });

    await env.DB.prepare(
      `INSERT INTO accounts (id, address, password_hash, token, resume_code_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, address, hashPassword(password), token, codeHash, expiresAt).run();

    return json({
      id,
      address,
      authType: 'email',
      mode: 'full',
      expiresAt,
      resumeCode: code,
      resumeUrl: getResumeUrl(request, code),
      createdAt: new Date().toISOString(),
    }, 201);
  } catch (e) {
    if (e.message.includes('UNIQUE constraint')) {
      return error('Address already exists', 409);
    }
    return error('Failed to create account', 500);
  }
}

// POST /token - issue auth token
async function getTokenHandler(request, env) {
  const body = await request.json();
  const { address, password } = body;

  if (!address || !password) {
    return error('Address and password required');
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM accounts WHERE address = ? AND password_hash = ? AND expires_at > datetime("now")'
  ).bind(address, hashPassword(password)).all();

  if (results.length === 0) {
    return error('Invalid credentials', 401);
  }

  const account = results[0];

  // Refresh token expiration
  const expireMinutes = getDefaultExpireMinutes(env);
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();
  const token = await issueAuthToken(env, {
    address,
    id: account.id,
    scope: 'full',
    expiresInMinutes: expireMinutes,
  });

  await env.DB.prepare(
    'UPDATE accounts SET token = ?, expires_at = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(token, expiresAt, account.id).run();

  return json({
    id: account.id,
    token,
    mode: 'full',
    expiresAt,
  });
}

// GET /me - current account info
async function getMe(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  return json({
    id: user.id,
    address: user.address,
    authType: 'email',
    mode: user.auth_scope || 'full',
    expiresAt: user.expires_at,
    createdAt: user.created_at,
  });
}

// PATCH /me/extend - extend expiration
async function extendExpiry(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  if (isLimitedSession(user)) {
    return error('Forbidden', 403);
  }

  const body = await request.json().catch(() => ({}));
  const minutes = body.minutes || 30;

  const newExpiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  await env.DB.prepare(
    'UPDATE accounts SET expires_at = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(newExpiresAt, user.id).run();

  return json({
    success: true,
    expiresAt: newExpiresAt,
  });
}

// DELETE /accounts/{id} - delete account
async function deleteAccount(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  if (isLimitedSession(user)) {
    return error('Forbidden', 403);
  }

  if (user.id !== id) {
    return error('Forbidden', 403);
  }

  // Delete attachments
  await env.DB.prepare(`
    DELETE FROM attachments WHERE message_id IN (
      SELECT id FROM messages WHERE account_id = ?
    )
  `).bind(id).run();
  // Delete messages
  await env.DB.prepare('DELETE FROM messages WHERE account_id = ?').bind(id).run();
  // Delete account
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  return new Response(null, { status: 204 });
}

// POST /admin/delete-account - admin delete account by address
async function adminDeleteAccountByAddress(request, env) {
  const body = await request.json().catch(() => ({}));
  const address = String(body.address || '').trim().toLowerCase();

  if (!address || !address.includes('@')) {
    return error('Invalid email address format');
  }

  const [username, domain] = address.split('@');
  if (!username || !domain) {
    return error('Invalid email address format');
  }

  const { results: accounts } = await env.DB.prepare(
    'SELECT id, address FROM accounts WHERE address = ? COLLATE NOCASE LIMIT 1'
  ).bind(address).all();

  if (accounts.length === 0) {
    return error('Account not found', 404);
  }

  const account = accounts[0];

  await env.DB.prepare(`
    DELETE FROM attachments WHERE message_id IN (
      SELECT id FROM messages WHERE account_id = ?
    )
  `).bind(account.id).run();

  await env.DB.prepare('DELETE FROM messages WHERE account_id = ?').bind(account.id).run();
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id).run();

  return json({
    success: true,
    deleted: true,
    id: account.id,
    address: account.address,
  });
}

// GET /messages - list messages
async function getMessages(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 30;
  const offset = (page - 1) * limit;

  const { results } = await env.DB.prepare(
    `SELECT id, msgid, subject, from_name, from_address, to_address, seen, has_attachments, size, created_at
     FROM messages WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();

  const { results: countResult } = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM messages WHERE account_id = ?'
  ).bind(user.id).all();

  return json({
    'hydra:member': results.map(m => ({
      id: m.id,
      msgid: m.msgid,
      from: { name: m.from_name, address: m.from_address },
      to: [{ name: '', address: m.to_address }],
      subject: m.subject,
      seen: !!m.seen,
      hasAttachments: !!m.has_attachments,
      size: m.size,
      createdAt: m.created_at,
    })),
    'hydra:totalItems': countResult[0]?.total || 0,
  });
}

// GET /messages/{id} - message details
async function getMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM messages WHERE id = ? AND account_id = ?'
  ).bind(id, user.id).all();

  if (results.length === 0) {
    return error('Message not found', 404);
  }

  const msg = results[0];

  // Load attachments
  const { results: attachments } = await env.DB.prepare(
    'SELECT id, filename, content_type, size FROM attachments WHERE message_id = ?'
  ).bind(id).all();

  return json({
    id: msg.id,
    msgid: msg.msgid,
    from: { name: msg.from_name, address: msg.from_address },
    to: [{ name: '', address: msg.to_address }],
    subject: msg.subject,
    text: msg.text,
    html: msg.html ? [msg.html] : [],
    seen: !!msg.seen,
    hasAttachments: !!msg.has_attachments,
    size: msg.size,
    attachments: attachments.map(a => ({
      id: a.id,
      filename: a.filename,
      contentType: a.content_type,
      size: a.size,
    })),
    createdAt: msg.created_at,
  });
}

// PATCH /messages/{id} - mark read
async function patchMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  if (isLimitedSession(user)) {
    return error('Forbidden', 403);
  }

  await env.DB.prepare(
    'UPDATE messages SET seen = 1 WHERE id = ? AND account_id = ?'
  ).bind(id, user.id).run();

  return json({ seen: true });
}

// DELETE /messages/{id} - delete message
async function deleteMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  // Delete attachments
  await env.DB.prepare('DELETE FROM attachments WHERE message_id = ?').bind(id).run();
  // Delete message
  await env.DB.prepare(
    'DELETE FROM messages WHERE id = ? AND account_id = ?'
  ).bind(id, user.id).run();

  return new Response(null, { status: 204 });
}

// GET /sources/{id} - raw source
async function getSource(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  const { results } = await env.DB.prepare(
    'SELECT raw_source FROM messages WHERE id = ? AND account_id = ?'
  ).bind(id, user.id).all();

  if (results.length === 0) {
    return error('Message not found', 404);
  }

  return json({
    id,
    data: results[0].raw_source,
  });
}

// GET /attachments/{id} - download attachment
async function getAttachment(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  const { results } = await env.DB.prepare(
    'SELECT a.* FROM attachments a JOIN messages m ON a.message_id = m.id WHERE a.id = ? AND m.account_id = ?'
  ).bind(id, user.id).all();

  if (results.length === 0) {
    return error('Attachment not found', 404);
  }

  const att = results[0];
  const binary = Uint8Array.from(atob(att.content), c => c.charCodeAt(0));

  return new Response(binary, {
    headers: {
      'Content-Type': att.content_type,
      'Content-Disposition': `attachment; filename="${att.filename}"`,
    },
  });
}

// ============ Scheduled Cleanup ============

async function cleanupExpired(env) {
  const retentionDays = getMessageRetentionDays(env);

  await env.DB.prepare(
    `DELETE FROM attachments WHERE message_id IN (
      SELECT id FROM messages WHERE created_at < datetime('now', ?)
    )`
  ).bind(`-${retentionDays} day`).run();

  await env.DB.prepare(
    `DELETE FROM messages WHERE created_at < datetime('now', ?)`
  ).bind(`-${retentionDays} day`).run();

  const { results: expiredAccounts } = await env.DB.prepare(
    'SELECT id FROM accounts WHERE expires_at < datetime("now")'
  ).all();

  for (const account of expiredAccounts) {
    // Delete attachments
    await env.DB.prepare(`
      DELETE FROM attachments WHERE message_id IN (
        SELECT id FROM messages WHERE account_id = ?
      )
    `).bind(account.id).run();
    // Delete messages
    await env.DB.prepare('DELETE FROM messages WHERE account_id = ?').bind(account.id).run();
    // Delete account
    await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id).run();
  }

  console.log(`Cleaned up ${expiredAccounts.length} expired accounts`);
}

// ============ Random Mailbox Generation ============

async function generateRandomEmail(request, env) {
  let domain = null;
  try {
    const body = await request.json();
    domain = body.domain;
  } catch {}

  if (!domain) {
    const { results: domains } = await env.DB.prepare(
      'SELECT domain FROM domains WHERE is_verified = 1 ORDER BY RANDOM() LIMIT 1'
    ).all();

    if (domains.length === 0) {
      return error('No domains available', 500);
    }

    domain = domains[0].domain;
  } else {
    const { results: validDomains } = await env.DB.prepare(
      'SELECT domain FROM domains WHERE domain = ? AND is_verified = 1'
    ).bind(domain).all();

    if (validDomains.length === 0) {
      return error('Invalid domain', 400);
    }
  }

  const username = generateRandomString(10);
  const address = `${username}@${domain}`;
  const password = generateRandomString(12);
  const expireMinutes = getDefaultExpireMinutes(env);
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();

  try {
    const id = generateId();
    const { code, codeHash } = await generateUniqueResumeCode(env);
    const token = await issueAuthToken(env, {
      address,
      id,
      scope: 'full',
      expiresInMinutes: expireMinutes,
    });

    await env.DB.prepare(
      `INSERT INTO accounts (id, address, password_hash, token, resume_code_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, address, hashPassword(password), token, codeHash, expiresAt).run();

    return json({
      id,
      address,
      password,
      token,
      mode: 'full',
      expiresAt,
      resumeCode: code,
      resumeUrl: getResumeUrl(request, code),
    }, 201);
  } catch {
    return error('Failed to generate email', 500);
  }
}



// POST /custom - create custom mailbox

async function createCustomEmail(request, env) {
  let address = null;
  try {
    const body = await request.json();
    address = body.address;
  } catch {}

  if (!address || !address.includes('@')) {
    return error('Invalid email address format');
  }

  const [username, domain] = address.split('@');

  if (username.length < 3) {
    return error('Username must be at least 3 characters');
  }

  if (username.length > 30) {
    return error('Username must be at most 30 characters');
  }

  const { results: domains } = await env.DB.prepare(
    'SELECT domain FROM domains WHERE domain = ? AND is_verified = 1'
  ).bind(domain).all();
  if (domains.length === 0) {
    return error('Domain not available', 422);
  }

  const { results: existing } = await env.DB.prepare(
    'SELECT id FROM accounts WHERE address = ?'
  ).bind(address).all();
  if (existing.length > 0) {
    return error('Address already exists', 409);
  }

  const password = generateRandomString(12);
  const expireMinutes = getDefaultExpireMinutes(env);
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();

  try {
    const id = generateId();
    const { code, codeHash } = await generateUniqueResumeCode(env);
    const token = await issueAuthToken(env, {
      address,
      id,
      scope: 'full',
      expiresInMinutes: expireMinutes,
    });

    await env.DB.prepare(
      `INSERT INTO accounts (id, address, password_hash, token, resume_code_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, address, hashPassword(password), token, codeHash, expiresAt).run();

    return json({
      id,
      address,
      password,
      token,
      mode: 'full',
      expiresAt,
      resumeCode: code,
      resumeUrl: getResumeUrl(request, code),
    }, 201);
  } catch {
    return error('Failed to create email', 500);
  }
}

// POST /resume - resume access via unique 8-char code
async function resumeByCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const code = (body.code || '').trim();

  if (!/^[A-Za-z0-9]{8}$/.test(code)) {
    return error('Invalid code', 400);
  }

  const codeHash = await sha256Hex(code);
  const { results } = await env.DB.prepare(
    'SELECT * FROM accounts WHERE resume_code_hash = ? AND expires_at > datetime("now")'
  ).bind(codeHash).all();

  if (results.length === 0) {
    return error('Invalid or expired code', 401);
  }

  const account = results[0];
  const expiresAtMs = new Date(account.expires_at).getTime();
  const remainingMinutes = Number.isNaN(expiresAtMs)
    ? 1
    : Math.max(1, Math.floor((expiresAtMs - Date.now()) / 60000));

  const token = await issueAuthToken(env, {
    address: account.address,
    id: account.id,
    scope: 'limited',
    expiresInMinutes: remainingMinutes,
  });

  await env.DB.prepare(
    'UPDATE accounts SET token = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(token, account.id).run();

  return json({
    id: account.id,
    address: account.address,
    token,
    expiresAt: account.expires_at,
    mode: 'limited',
  });
}



// ============ Main Router ============

async function handleRequest(request, env) {
  // Sync domains
  await syncDomains(env);

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Key',
      },
    });
  }

  // API routes
  const routes = [
    ['GET', '/api/domains', () => {
      if (!verifyAccessKey(request, env)) return error('Unauthorized', 401);
      return getDomains(request, env);
    }],
    ['POST', '/api/accounts', () => {
      if (!verifyAccessKey(request, env)) return error('Unauthorized', 401);
      return createAccount(request, env);
    }],
    ['POST', '/api/token', () => getTokenHandler(request, env)],
    ['POST', '/api/resume', () => resumeByCode(request, env)],
    ['GET', '/api/me', () => getMe(request, env)],
    ['PATCH', '/api/me/extend', () => extendExpiry(request, env)],
    ['GET', '/api/messages', () => getMessages(request, env)],
    ['POST', '/api/generate', () => {
      if (!verifyAccessKey(request, env)) return error('Unauthorized', 401);
      return generateRandomEmail(request, env);
    }],
    ['POST', '/api/custom', () => {
      if (!verifyAccessKey(request, env)) return error('Unauthorized', 401);
      return createCustomEmail(request, env);
    }],
    ['POST', '/api/admin/delete-account', () => {
      if (!verifyAccessKey(request, env)) return error('Unauthorized', 401);
      return adminDeleteAccountByAddress(request, env);
    }],
  ];

  // Match routes with path IDs
  const messageIdMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  const sourceMatch = path.match(/^\/api\/sources\/([^/]+)$/);
  const attachmentMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/);

  if (messageIdMatch) {
    const id = messageIdMatch[1];
    if (method === 'GET') return getMessage(request, env, id);
    if (method === 'PATCH') return patchMessage(request, env, id);
    if (method === 'DELETE') return deleteMessage(request, env, id);
  }

  if (sourceMatch && method === 'GET') {
    return getSource(request, env, sourceMatch[1]);
  }

  if (attachmentMatch && method === 'GET') {
    return getAttachment(request, env, attachmentMatch[1]);
  }

  if (accountMatch && method === 'DELETE') {
    return deleteAccount(request, env, accountMatch[1]);
  }

  // Match static routes
  for (const [rMethod, rPath, handler] of routes) {
    if (method === rMethod && path === rPath) {
      return handler();
    }
  }

  // Frontend static assets
  if (!path.startsWith('/api/')) {
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);

      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // SPA fallback: return index.html for frontend routes like /r/:code
      if ((method === 'GET' || method === 'HEAD') && !path.includes('.')) {
        const appUrl = new URL('/', request.url);
        return env.ASSETS.fetch(new Request(appUrl.toString(), request));
      }

      return assetResponse;
    }
    // Return an error when ASSETS binding is missing
    return new Response('Frontend not available. Please bind ASSETS in wrangler.toml', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return error('Not Found', 404);
}

// ============ Exports ============

export default {
  async fetch(request, env, ctx) {
    // Auto-initialize database
    await initDatabase(env);
    return handleRequest(request, env);
  },

  async scheduled(event, env, ctx) {
    await cleanupExpired(env);
  },

  // Email receive handler
  async email(message, env, ctx) {
    const to = message.to;
    const [username, domain] = to.split('@');

    // Find account
    const { results } = await env.DB.prepare(
      'SELECT * FROM accounts WHERE address = ? AND expires_at > datetime("now")'
    ).bind(to).all();

    if (results.length === 0) {
      message.setReject('Address not found or expired');
      return;
    }

    const account = results[0];

    // Read raw email content
    const rawEmail = await new Response(message.raw).text();

    // Parse sender
    let from = message.from || '';
    let fromName = '';
    let fromAddress = from;
    const fromMatch = from.match(/(?:"?([^"]*)"?\s)?<?([^\s>]+@[^\s>]+)>?/);
    if (fromMatch) {
      fromName = fromMatch[1] || '';
      fromAddress = fromMatch[2];
    }

    // Parse content with MIME parser
    const parsed = parseEmailContent(rawEmail);
    const textContent = parsed.text;
    const htmlContent = parsed.html;
    const hasAttachments = parsed.attachments.length > 0;

    // Store message
    const id = generateId();
    await env.DB.prepare(
      `INSERT INTO messages (id, account_id, from_name, from_address, to_address, subject, text, html, has_attachments, size, raw_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, account.id, fromName, fromAddress, to, message.headers.get('subject') || '(No Subject)', textContent, htmlContent || null, hasAttachments ? 1 : 0, rawEmail.length, rawEmail).run();

    // Store attachments
    for (const att of parsed.attachments) {
      const attId = generateId();
      // Store decoded content in base64
      const contentBase64 = att.encoding === 'base64' ? att.content.replace(/\s/g, '') : btoa(unescape(encodeURIComponent(att.content)));
      await env.DB.prepare(
        `INSERT INTO attachments (id, message_id, filename, content_type, size, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(attId, id, att.filename, att.contentType, att.content.length, contentBase64).run();
    }
  },
};
