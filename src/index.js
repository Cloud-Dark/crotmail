/**
 * CrotMail Worker (lightweight)
 * - In-memory mailbox (no mandatory DB)
 * - Optional D1 for UI cache migration
 * - SSE stream endpoint: /stream_ready_use?token=...
 */

import { SignJWT, jwtVerify } from './jwt.js';

const mailboxById = new Map();
const mailboxIdByAddress = new Map();
const mailboxIdByResumeCode = new Map();
const attachmentById = new Map();
const streamSubscribersByMailboxId = new Map();

const runtimeConfig = {
  accessKey: null,
  mailDomains: null,
  expireMinutes: null,
  messageRetentionDays: null,
};

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

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function getActiveAccessKey(env) {
  return runtimeConfig.accessKey ?? env.ACCESS_KEY ?? '';
}

function getAvailableDomains(env) {
  const value = runtimeConfig.mailDomains ?? env.MAIL_DOMAINS ?? '';
  return value
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
}

function getDefaultExpireMinutes(env) {
  if (runtimeConfig.expireMinutes) {
    return runtimeConfig.expireMinutes;
  }

  const expireDays = parseInt(env.EXPIRE_DAYS || '', 10);
  if (!Number.isNaN(expireDays) && expireDays > 0) {
    return expireDays * 24 * 60;
  }

  const expireMinutes = parseInt(env.EXPIRE_MINUTES || '43200', 10);
  return Number.isNaN(expireMinutes) || expireMinutes <= 0 ? 43200 : expireMinutes;
}

function getMessageRetentionDays(env) {
  if (runtimeConfig.messageRetentionDays) {
    return runtimeConfig.messageRetentionDays;
  }
  const retentionDays = parseInt(env.MESSAGE_RETENTION_DAYS || '1', 10);
  return Number.isNaN(retentionDays) || retentionDays <= 0 ? 1 : retentionDays;
}

function getResumeUrl(request, code) {
  const origin = new URL(request.url).origin;
  return `${origin}/r/${code}`;
}

function hashPassword(password) {
  return btoa(password);
}

async function getJwtSecret(env) {
  return env.JWT_SECRET || getActiveAccessKey(env) || 'crotmail-lightweight-secret';
}

async function getToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  return queryToken || null;
}

async function verifyToken(token, env) {
  try {
    const secret = await getJwtSecret(env);
    return await jwtVerify(token, secret);
  } catch {
    return null;
  }
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

function verifyAccessKey(request, env) {
  const activeKey = getActiveAccessKey(env);
  if (!activeKey) {
    return true;
  }

  const headerKey = request.headers.get('X-Access-Key');
  const queryKey = new URL(request.url).searchParams.get('access_key');
  const key = headerKey || queryKey;
  return key === activeKey;
}

function isMailboxExpired(mailbox) {
  return !mailbox || new Date(mailbox.expiresAt).getTime() <= Date.now();
}

function isLimitedSession(user) {
  return user?.auth_scope === 'limited';
}

function sanitizeMailbox(mailbox) {
  return {
    id: mailbox.id,
    address: mailbox.address,
    authType: 'email',
    mode: mailbox.mode || 'full',
    expiresAt: mailbox.expiresAt,
    createdAt: mailbox.createdAt,
    resumeCode: mailbox.resumeCode,
    resumeUrl: mailbox.resumeUrl,
  };
}

function mapMessageSummary(message) {
  return {
    id: message.id,
    msgid: message.msgid,
    from: { name: message.fromName, address: message.fromAddress },
    to: [{ name: '', address: message.toAddress }],
    subject: message.subject,
    seen: !!message.seen,
    hasAttachments: !!message.hasAttachments,
    size: message.size,
    createdAt: message.createdAt,
  };
}

function mapMessageDetail(message) {
  return {
    ...mapMessageSummary(message),
    text: message.text,
    html: message.html ? [message.html] : [],
    attachments: (message.attachments || []).map(att => ({
      id: att.id,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
    })),
  };
}

function cleanupMailbox(mailboxId) {
  const mailbox = mailboxById.get(mailboxId);
  if (!mailbox) return;

  for (const message of mailbox.messages) {
    for (const attachment of message.attachments || []) {
      attachmentById.delete(attachment.id);
    }
  }

  closeAllSubscribers(mailboxId, 'Mailbox deleted');

  mailboxById.delete(mailboxId);
  mailboxIdByAddress.delete(mailbox.address);
  mailboxIdByResumeCode.delete(mailbox.resumeCode);
}

function createMailbox({ address, passwordHash, expiresAt, createdAt, resumeCode, resumeUrl }) {
  const mailbox = {
    id: generateId(),
    address,
    passwordHash,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
    token: '',
    resumeCode,
    resumeUrl,
    mode: 'full',
    messages: [],
  };

  mailboxById.set(mailbox.id, mailbox);
  mailboxIdByAddress.set(address, mailbox.id);
  mailboxIdByResumeCode.set(resumeCode, mailbox.id);
  return mailbox;
}

async function getAuthUser(request, env) {
  const token = await getToken(request);
  if (!token) return null;

  const payload = await verifyToken(token, env);
  if (!payload?.id) return null;

  const mailbox = mailboxById.get(payload.id);
  if (!mailbox || isMailboxExpired(mailbox)) {
    if (mailbox) cleanupMailbox(mailbox.id);
    return null;
  }

  return {
    ...mailbox,
    auth_scope: payload.scope || 'full',
  };
}

async function createMailboxResponse(request, env, address, passwordHash = null, plainPassword = null) {
  if (mailboxIdByAddress.has(address)) {
    return error('Address already exists', 409);
  }

  const expireMinutes = getDefaultExpireMinutes(env);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();

  let resumeCode = generateResumeCode(8);
  while (mailboxIdByResumeCode.has(resumeCode)) {
    resumeCode = generateResumeCode(8);
  }

  const mailbox = createMailbox({
    address,
    passwordHash,
    expiresAt,
    createdAt,
    resumeCode,
    resumeUrl: getResumeUrl(request, resumeCode),
  });

  const token = await issueAuthToken(env, {
    address,
    id: mailbox.id,
    scope: 'full',
    expiresInMinutes: expireMinutes,
  });

  mailbox.token = token;

  return json({
    ...sanitizeMailbox(mailbox),
    token,
    password: plainPassword || undefined,
  }, 201);
}

function sendSse(writer, encoder, event, payload) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  return writer.write(encoder.encode(chunk));
}

function closeSubscriber(mailboxId, subscriberId, reason = 'closed') {
  const subs = streamSubscribersByMailboxId.get(mailboxId);
  if (!subs) return;
  const sub = subs.get(subscriberId);
  if (!sub) return;

  clearTimeout(sub.expireTimer);
  clearInterval(sub.pingTimer);

  try {
    sendSse(sub.writer, sub.encoder, 'end', { reason }).catch(() => {});
  } catch {}

  try {
    sub.writer.close();
  } catch {}

  subs.delete(subscriberId);
  if (subs.size === 0) {
    streamSubscribersByMailboxId.delete(mailboxId);
  }
}

function closeAllSubscribers(mailboxId, reason = 'closed') {
  const subs = streamSubscribersByMailboxId.get(mailboxId);
  if (!subs) return;
  for (const subId of subs.keys()) {
    closeSubscriber(mailboxId, subId, reason);
  }
}

function broadcastMessage(mailboxId, message) {
  const subs = streamSubscribersByMailboxId.get(mailboxId);
  if (!subs || subs.size === 0) return;

  const payload = mapMessageSummary(message);
  for (const [subId, sub] of subs.entries()) {
    sendSse(sub.writer, sub.encoder, 'message', payload).catch(() => {
      closeSubscriber(mailboxId, subId, 'stream write failed');
    });
  }
}

async function createStream(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return error('Unauthorized', 401);
  }

  const mailbox = mailboxById.get(user.id);
  if (!mailbox || isMailboxExpired(mailbox)) {
    return error('Mailbox expired', 401);
  }

  const transform = new TransformStream();
  const writer = transform.writable.getWriter();
  const encoder = new TextEncoder();
  const subscriberId = generateId();

  let subs = streamSubscribersByMailboxId.get(user.id);
  if (!subs) {
    subs = new Map();
    streamSubscribersByMailboxId.set(user.id, subs);
  }

  const expireTimer = setTimeout(() => {
    closeSubscriber(user.id, subscriberId, 'Stream expired after 1 hour');
  }, 60 * 60 * 1000);

  const pingTimer = setInterval(() => {
    sendSse(writer, encoder, 'ping', { ts: new Date().toISOString() }).catch(() => {
      closeSubscriber(user.id, subscriberId, 'ping failed');
    });
  }, 25000);

  subs.set(subscriberId, {
    writer,
    encoder,
    createdAt: Date.now(),
    expireTimer,
    pingTimer,
  });

  request.signal?.addEventListener('abort', () => {
    closeSubscriber(user.id, subscriberId, 'client disconnected');
  });

  await sendSse(writer, encoder, 'ready', {
    mailbox: mailbox.address,
    streamTtlSeconds: 3600,
    message: 'Stream aktif. Email baru akan dikirim realtime.',
  });

  return new Response(transform.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function ensureD1CacheSchema(env) {
  if (!env.DB) {
    throw new Error('D1 binding DB not available');
  }

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ui_mail_cache (
      address TEXT PRIMARY KEY,
      messages_json TEXT NOT NULL,
      current_mail_json TEXT,
      updated_at TEXT NOT NULL
    )`
  ).run();
}

async function d1SaveCache(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  if (!env.DB) return error('D1 storage is not configured', 501);

  await ensureD1CacheSchema(env);

  const body = await request.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const currentMail = body.currentMail || null;
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO ui_mail_cache (address, messages_json, current_mail_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       messages_json = excluded.messages_json,
       current_mail_json = excluded.current_mail_json,
       updated_at = excluded.updated_at`
  ).bind(
    user.address,
    JSON.stringify(messages),
    currentMail ? JSON.stringify(currentMail) : null,
    updatedAt
  ).run();

  return json({ success: true, provider: 'd1', updatedAt });
}

async function d1LoadCache(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  if (!env.DB) return error('D1 storage is not configured', 501);

  await ensureD1CacheSchema(env);

  const { results } = await env.DB.prepare(
    'SELECT messages_json, current_mail_json, updated_at FROM ui_mail_cache WHERE address = ? LIMIT 1'
  ).bind(user.address).all();

  if (!results.length) {
    return json({
      provider: 'd1',
      messages: [],
      currentMail: null,
      updatedAt: null,
    });
  }

  const row = results[0];
  return json({
    provider: 'd1',
    messages: JSON.parse(row.messages_json || '[]'),
    currentMail: row.current_mail_json ? JSON.parse(row.current_mail_json) : null,
    updatedAt: row.updated_at,
  });
}

function getRuntimeConfigState(env) {
  return {
    ACCESS_KEY: getActiveAccessKey(env) || '',
    MAIL_DOMAINS: (runtimeConfig.mailDomains ?? env.MAIL_DOMAINS ?? '').trim(),
    EXPIRE_MINUTES: String(getDefaultExpireMinutes(env)),
    MESSAGE_RETENTION_DAYS: String(getMessageRetentionDays(env)),
  };
}

async function getRuntimeConfigHandler(request, env) {
  const user = await getAuthUser(request, env);
  if (!user || isLimitedSession(user)) {
    return error('Unauthorized', 401);
  }

  return json({
    config: getRuntimeConfigState(env),
    note: 'Runtime config disimpan sementara di memory Worker.',
  });
}

async function patchRuntimeConfigHandler(request, env) {
  const user = await getAuthUser(request, env);
  if (!user || isLimitedSession(user)) {
    return error('Unauthorized', 401);
  }

  const body = await request.json().catch(() => ({}));

  if (typeof body.ACCESS_KEY === 'string') {
    runtimeConfig.accessKey = body.ACCESS_KEY.trim() || null;
  }
  if (typeof body.MAIL_DOMAINS === 'string') {
    runtimeConfig.mailDomains = body.MAIL_DOMAINS.trim() || null;
  }
  if (body.EXPIRE_MINUTES !== undefined) {
    const value = parseInt(body.EXPIRE_MINUTES, 10);
    if (!Number.isNaN(value) && value > 0) {
      runtimeConfig.expireMinutes = value;
    }
  }
  if (body.MESSAGE_RETENTION_DAYS !== undefined) {
    const value = parseInt(body.MESSAGE_RETENTION_DAYS, 10);
    if (!Number.isNaN(value) && value > 0) {
      runtimeConfig.messageRetentionDays = value;
    }
  }

  return json({
    success: true,
    config: getRuntimeConfigState(env),
    note: 'Config runtime berhasil diperbarui (sementara, reset saat Worker restart).',
  });
}

// MIME parser helpers
function decodeQP(str, charset = 'utf-8') {
  const decoded = str
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'utf8') {
    try {
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function decodeBase64(str, charset = 'utf-8') {
  try {
    const binary = atob(str.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return str;
  }
}

function decodeContent(content, encoding, charset = 'utf-8') {
  if (!content) return '';
  const enc = (encoding || '').toLowerCase();
  if (enc === 'base64') return decodeBase64(content.replace(/\s/g, ''), charset);
  if (enc === 'quoted-printable') return decodeQP(content, charset);
  return content;
}

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

function parseContentType(ct) {
  if (!ct) return { type: 'text/plain', charset: 'utf-8', boundary: null };
  const parts = ct.split(';').map(p => p.trim());
  const type = parts[0].toLowerCase();
  let charset = 'utf-8';
  let boundary = null;

  for (const part of parts.slice(1)) {
    if (part.startsWith('charset=')) charset = part.substring(8).replace(/"/g, '');
    else if (part.startsWith('boundary=')) boundary = part.substring(9).replace(/"/g, '');
  }

  return { type, charset, boundary };
}

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
      } else if (!part.contentType.type.startsWith('text/')) {
        const filename =
          part.headers['content-disposition']?.match(/filename="?([^";\n]+)"?/i)?.[1] ||
          part.headers['content-type']?.match(/name="?([^";\n]+)"?/i)?.[1] ||
          'attachment';
        attachments.push({
          filename,
          contentType: part.contentType.type,
          content: part.content.trim(),
          encoding: part.encoding,
        });
      }
    }
  } else if (mainCT.type === 'text/plain') {
    text = decodeContent(bodyStr, mainHeaders['content-transfer-encoding'] || '7bit', mainCT.charset);
  } else if (mainCT.type === 'text/html') {
    html = decodeContent(bodyStr, mainHeaders['content-transfer-encoding'] || '7bit', mainCT.charset);
  } else {
    text = bodyStr;
  }

  return { text, html, attachments };
}

// API handlers
async function getDomains(request, env) {
  const domains = getAvailableDomains(env);
  return json({
    'hydra:member': domains.map(domain => ({
      id: domain,
      domain,
      isVerified: true,
      createdAt: new Date().toISOString(),
    })),
    'hydra:totalItems': domains.length,
  });
}

async function createAccount(request, env) {
  const body = await request.json().catch(() => ({}));
  const address = normalizeAddress(body.address);
  const password = String(body.password || '');

  if (!address || !address.includes('@')) return error('Invalid email address format');

  const [username, domain] = address.split('@');
  if (username.length < 3) return error('Username must be at least 3 characters');
  if (!password || password.length < 6) return error('Password must be at least 6 characters');
  if (!getAvailableDomains(env).includes(domain)) return error('Domain not available', 422);

  return createMailboxResponse(request, env, address, hashPassword(password));
}

async function generateRandomEmail(request, env) {
  const body = await request.json().catch(() => ({}));
  const domains = getAvailableDomains(env);
  let domain = String(body.domain || '').trim().toLowerCase();

  if (!domains.length) return error('No domains available', 500);
  if (!domain) domain = domains[Math.floor(Math.random() * domains.length)];
  if (!domains.includes(domain)) return error('Invalid domain', 400);

  const address = `${generateRandomString(10)}@${domain}`;
  const password = generateRandomString(12);
  return createMailboxResponse(request, env, address, hashPassword(password), password);
}

async function createCustomEmail(request, env) {
  const body = await request.json().catch(() => ({}));
  const address = normalizeAddress(body.address);
  if (!address || !address.includes('@')) return error('Invalid email address format');

  const [username, domain] = address.split('@');
  if (username.length < 3) return error('Username must be at least 3 characters');
  if (username.length > 30) return error('Username must be at most 30 characters');
  if (!/^[a-z0-9._-]+$/i.test(username)) return error('Username contains invalid characters');
  if (!getAvailableDomains(env).includes(domain)) return error('Domain not available', 422);

  const password = generateRandomString(12);
  return createMailboxResponse(request, env, address, hashPassword(password), password);
}

async function getTokenHandler(request, env) {
  const body = await request.json().catch(() => ({}));
  const address = normalizeAddress(body.address);
  const password = String(body.password || '');

  const mailboxId = mailboxIdByAddress.get(address);
  const mailbox = mailboxId ? mailboxById.get(mailboxId) : null;
  if (!mailbox || mailbox.passwordHash !== hashPassword(password) || isMailboxExpired(mailbox)) {
    return error('Invalid credentials', 401);
  }

  const expireMinutes = getDefaultExpireMinutes(env);
  mailbox.expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();
  mailbox.updatedAt = new Date().toISOString();
  mailbox.token = await issueAuthToken(env, {
    address: mailbox.address,
    id: mailbox.id,
    scope: 'full',
    expiresInMinutes: expireMinutes,
  });

  return json({
    ...sanitizeMailbox(mailbox),
    token: mailbox.token,
  });
}

async function resumeByCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  if (!/^[A-Za-z0-9]{8}$/.test(code)) return error('Invalid code', 400);

  const mailboxId = mailboxIdByResumeCode.get(code);
  const mailbox = mailboxId ? mailboxById.get(mailboxId) : null;
  if (!mailbox || isMailboxExpired(mailbox)) {
    if (mailbox) cleanupMailbox(mailbox.id);
    return error('Invalid or expired code', 401);
  }

  const remainingMinutes = Math.max(
    1,
    Math.floor((new Date(mailbox.expiresAt).getTime() - Date.now()) / 60000)
  );

  const token = await issueAuthToken(env, {
    address: mailbox.address,
    id: mailbox.id,
    scope: 'limited',
    expiresInMinutes: remainingMinutes,
  });

  return json({
    id: mailbox.id,
    address: mailbox.address,
    token,
    expiresAt: mailbox.expiresAt,
    mode: 'limited',
    resumeCode: mailbox.resumeCode,
    resumeUrl: mailbox.resumeUrl,
  });
}

async function getMe(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  return json(sanitizeMailbox(user));
}

async function extendExpiry(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  if (isLimitedSession(user)) return error('Forbidden', 403);

  const body = await request.json().catch(() => ({}));
  const minutes = Math.max(1, parseInt(body.minutes || '30', 10));
  const mailbox = mailboxById.get(user.id);
  mailbox.expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  mailbox.updatedAt = new Date().toISOString();
  return json({ success: true, expiresAt: mailbox.expiresAt });
}

async function deleteAccount(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  if (isLimitedSession(user)) return error('Forbidden', 403);
  if (user.id !== id) return error('Forbidden', 403);

  cleanupMailbox(id);
  if (env.DB) {
    await ensureD1CacheSchema(env);
    await env.DB.prepare('DELETE FROM ui_mail_cache WHERE address = ?').bind(user.address).run();
  }
  return new Response(null, { status: 204 });
}

async function adminDeleteAccountByAddress(request, env) {
  const body = await request.json().catch(() => ({}));
  const address = normalizeAddress(body.address);
  if (!address || !address.includes('@')) return error('Invalid email address format');

  const mailboxId = mailboxIdByAddress.get(address);
  if (!mailboxId) return error('Account not found', 404);
  cleanupMailbox(mailboxId);
  if (env.DB) {
    await ensureD1CacheSchema(env);
    await env.DB.prepare('DELETE FROM ui_mail_cache WHERE address = ?').bind(address).run();
  }
  return json({ success: true, deleted: true, address, id: mailboxId });
}

async function getMessages(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);

  const mailbox = mailboxById.get(user.id);
  const messages = [...mailbox.messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return json({
    'hydra:member': messages.map(mapMessageSummary),
    'hydra:totalItems': messages.length,
  });
}

async function getMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);

  const mailbox = mailboxById.get(user.id);
  const message = mailbox.messages.find(item => item.id === id);
  if (!message) return error('Message not found', 404);
  return json(mapMessageDetail(message));
}

async function patchMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);
  if (isLimitedSession(user)) return error('Forbidden', 403);

  const mailbox = mailboxById.get(user.id);
  const message = mailbox.messages.find(item => item.id === id);
  if (!message) return error('Message not found', 404);
  message.seen = true;
  return json({ seen: true });
}

async function deleteMessage(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);

  const mailbox = mailboxById.get(user.id);
  const index = mailbox.messages.findIndex(item => item.id === id);
  if (index === -1) return error('Message not found', 404);

  const [message] = mailbox.messages.splice(index, 1);
  for (const attachment of message.attachments || []) {
    attachmentById.delete(attachment.id);
  }
  return new Response(null, { status: 204 });
}

async function getSource(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);

  const mailbox = mailboxById.get(user.id);
  const message = mailbox.messages.find(item => item.id === id);
  if (!message) return error('Message not found', 404);
  return json({ id, data: message.rawSource });
}

async function getAttachment(request, env, id) {
  const user = await getAuthUser(request, env);
  if (!user) return error('Unauthorized', 401);

  const attachment = attachmentById.get(id);
  if (!attachment || attachment.mailboxId !== user.id) return error('Attachment not found', 404);

  const binary = Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': `attachment; filename="${attachment.filename}"`,
    },
  });
}

async function cleanupExpired(env) {
  const retentionMs = getMessageRetentionDays(env) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const mailbox of mailboxById.values()) {
    mailbox.messages = mailbox.messages.filter(message => {
      const expired = now - new Date(message.createdAt).getTime() > retentionMs;
      if (expired) {
        for (const attachment of message.attachments || []) {
          attachmentById.delete(attachment.id);
        }
      }
      return !expired;
    });

    if (isMailboxExpired(mailbox)) {
      cleanupMailbox(mailbox.id);
    }
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Key',
      },
    });
  }

  if (method === 'GET' && path === '/stream_ready_use') {
    return createStream(request, env);
  }

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
    ['GET', '/api/runtime-config', () => getRuntimeConfigHandler(request, env)],
    ['PATCH', '/api/runtime-config', () => patchRuntimeConfigHandler(request, env)],
    ['GET', '/api/storage/d1/load', () => d1LoadCache(request, env)],
    ['POST', '/api/storage/d1/migrate', () => d1SaveCache(request, env)],
  ];

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

  if (sourceMatch && method === 'GET') return getSource(request, env, sourceMatch[1]);
  if (attachmentMatch && method === 'GET') return getAttachment(request, env, attachmentMatch[1]);
  if (accountMatch && method === 'DELETE') return deleteAccount(request, env, accountMatch[1]);

  for (const [routeMethod, routePath, handler] of routes) {
    if (method === routeMethod && path === routePath) {
      return handler();
    }
  }

  if (!path.startsWith('/api/')) {
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;

      if ((method === 'GET' || method === 'HEAD') && !path.includes('.')) {
        const appUrl = new URL('/', request.url);
        return env.ASSETS.fetch(new Request(appUrl.toString(), request));
      }
      return assetResponse;
    }

    return new Response('Frontend not available. Please bind ASSETS in wrangler.toml', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return error('Not Found', 404);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },

  async scheduled(event, env) {
    await cleanupExpired(env);
  },

  async email(message, env) {
    const to = normalizeAddress(message.to);
    const mailboxId = mailboxIdByAddress.get(to);
    const mailbox = mailboxId ? mailboxById.get(mailboxId) : null;

    if (!mailbox || isMailboxExpired(mailbox)) {
      if (mailbox) cleanupMailbox(mailbox.id);
      message.setReject('Address not found or expired');
      return;
    }

    const rawEmail = await new Response(message.raw).text();
    let from = message.from || '';
    let fromName = '';
    let fromAddress = from;
    const fromMatch = from.match(/(?:"?([^"]*)"?\s)?<?([^\s>]+@[^\s>]+)>?/);
    if (fromMatch) {
      fromName = fromMatch[1] || '';
      fromAddress = fromMatch[2];
    }

    const parsed = parseEmailContent(rawEmail);
    const createdAt = new Date().toISOString();
    const entry = {
      id: generateId(),
      msgid: message.headers.get('message-id') || '',
      fromName,
      fromAddress,
      toAddress: to,
      subject: message.headers.get('subject') || '(No Subject)',
      text: parsed.text,
      html: parsed.html || null,
      seen: false,
      hasAttachments: parsed.attachments.length > 0,
      size: rawEmail.length,
      rawSource: rawEmail,
      createdAt,
      attachments: parsed.attachments.map(att => {
        const id = generateId();
        const content =
          att.encoding === 'base64'
            ? att.content.replace(/\s/g, '')
            : btoa(unescape(encodeURIComponent(att.content)));

        const attachment = {
          id,
          mailboxId: mailbox.id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.content.length,
          content,
        };
        attachmentById.set(id, attachment);
        return attachment;
      }),
    };

    mailbox.messages.unshift(entry);
    mailbox.updatedAt = createdAt;
    broadcastMessage(mailbox.id, entry);
  },
};
