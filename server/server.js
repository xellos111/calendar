process.env.TZ = 'Asia/Seoul';

const http = require('http');
const { URL } = require('url');
const {
  ensureLogDir,
  appendLog,
  loadRecords,
  aggregateDaily,
  aggregateOverall,
  VISIT_LOG,
  DOWNLOAD_LOG,
} = require('./metrics');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 5174);
const MAX_BODY_SIZE = 512 * 1024; // 512 KB safety limit
const METRICS_TZ = process.env.METRICS_TZ || 'Asia/Seoul';

ensureLogDir();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/healthz') {
    respond(res, 200, { ok: true });
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/api/visit') {
      await handleVisit(req, res, url);
    } else if (req.method === 'POST' && url.pathname === '/api/download') {
      await handleDownload(req, res, url);
    } else if (req.method === 'GET' && url.pathname === '/api/stats') {
      await handleStats(req, res, url);
    } else {
      // Try to serve static file
      await handleStatic(req, res, url);
    }
  } catch (err) {
    console.error('API error', err);
    if (!res.headersSent) {
      respond(res, err.statusCode || 500, { error: err.message || 'Internal Server Error' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Metrics API listening on http://${HOST}:${PORT}`);
});

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.removeHeader('Access-Control-Allow-Origin');
  }

  const reqHeaders = req.headers['access-control-request-headers'];
  const allowHeaders = reqHeaders ? reqHeaders : 'Content-Type, Accept';

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
}

async function handleVisit(req, res, url) {
  const body = await readJsonBody(req);
  const now = new Date();
  const ip = normalizeIp(getClientIp(req));
  const sessionId = sanitizeSessionId(body.sessionId);
  const record = {
    type: 'visit',
    timestamp: now.toISOString(),
    localDate: formatLocalDate(now),
    date: formatDate(now),
    ip,
    sessionId,
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers['referer'] || '',
    path: body && typeof body.path === 'string' ? body.path : url.searchParams.get('path') || '/',
    meta: body && typeof body.meta === 'object' ? body.meta : null,
  };

  await appendLog(VISIT_LOG, record);
  respond(res, 201, { ok: true, received: { timestamp: record.timestamp, ip: record.ip } });
}

async function handleDownload(req, res, url) {
  const body = await readJsonBody(req);
  const now = new Date();
  const ip = normalizeIp(getClientIp(req));
  const days = Array.isArray(body?.days) ? body.days.map(String) : [];
  const sessionId = sanitizeSessionId(body?.sessionId);
  const record = {
    type: 'download',
    timestamp: now.toISOString(),
    localDate: formatLocalDate(now),
    date: formatDate(now),
    ip,
    sessionId,
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers['referer'] || '',
    days,
    filename: typeof body?.filename === 'string' ? body.filename : null,
    meta: body && typeof body.meta === 'object' ? body.meta : null,
  };

  await appendLog(DOWNLOAD_LOG, record);
  respond(res, 201, { ok: true, received: { timestamp: record.timestamp, ip: record.ip, days } });
}

async function handleStats(req, res, url) {
  const dateParam = url.searchParams.get('date');
  const scopeParam = url.searchParams.get('scope');

  let summary;
  if (scopeParam === 'overall' || dateParam === 'all') {
    summary = await aggregateOverall();
  } else {
    if (!dateParam) {
      throw createHttpError(400, 'Query parameter "date" (YYYY-MM-DD) is required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      throw createHttpError(400, 'Invalid date format; expected YYYY-MM-DD');
    }
    summary = await aggregateDaily(dateParam);
  }

  respond(res, 200, summary);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_SIZE) {
        reject(createHttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (err) {
        reject(createHttpError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', (err) => {
      reject(createHttpError(400, err.message || 'Request error'));
    });
  });
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    if (parts.length) {
      return parts[0].trim();
    }
  }
  return req.socket?.remoteAddress || '';
}

function normalizeIp(value) {
  if (!value) return 'unknown';
  if (value.startsWith('::ffff:')) return value.slice(7);
  if (value === '::1') return '127.0.0.1';
  return value;
}

function formatDate(date) {
  return formatLocalDate(date);
}

function formatLocalDate(date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: METRICS_TZ }).format(date);
  } catch (err) {
    console.warn('Failed to format date with timeZone', METRICS_TZ, err.message);
    return date.toISOString().slice(0, 10);
  }
}

function sanitizeSessionId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function respond(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Simple static file server
const fs = require('fs');
const path = require('path');
const MIMES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

async function handleStatic(req, res, url) {
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';

  // Security: prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const rootDir = path.resolve(__dirname, '..'); // c:\calendar
  const filePath = path.join(rootDir, safePath);

  // Ensure file is within rootDir
  if (!filePath.startsWith(rootDir)) {
    respond(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      respond(res, 404, { error: 'Not Found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIMES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      respond(res, 404, { error: 'Not Found' });
    } else {
      console.error('Static serve error', err);
      respond(res, 500, { error: 'Internal Server Error' });
    }
  }
}
