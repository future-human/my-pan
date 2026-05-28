import express from 'express';
import { getStorages, getStorage, handleList, handleDownloadUrl, handlePreviewUrl, handleUploadUrl, handleDelete, handleRename, handleBatchDelete, Env } from '../worker/src/index';
import { handleCreateShare, handleListShares, handleDeleteShare, handleBatchDeleteShares, handleShareAccess, handleSharePreviewUrl, handleShareDownloadUrl } from '../worker/src/shares';
import { CORS_HEADERS, validateKey } from '../worker/src/utils';
import { checkRateLimit, recordAuthFailure, recordAuthSuccess } from '../worker/src/rate-limit';
import { DBAdapter } from './db';
import { FileKV } from './file-kv';

async function bootstrap() {
  const PORT = parseInt(process.env.PORT || '8787', 10);
  const dbPath = process.env.DATABASE_PATH || './data/my-pan.db';
  const rateLimitPath = process.env.RATE_LIMIT_PATH || './data/rate-limits.json';
  const db = await DBAdapter.create(dbPath);
  const kv = new FileKV(rateLimitPath);

  const env: Env = {
    S3_LIST_JSON: process.env.S3_LIST_JSON,
    AUTH_PASSWORD: process.env.AUTH_PASSWORD,
    DB: db as unknown as Env['DB'],
    KV_BINDING: kv as unknown as Env['KV_BINDING'],
  };

// ---- Adapters ----

/** Wrap an Express req as a minimal Request-like object for handler/rate-limit compatibility. */
function adaptRequest(req: express.Request) {
  return {
    method: req.method,
    url: `http://${req.headers.host || 'localhost'}${req.originalUrl}`,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'cf-connecting-ip') {
          return req.ip || req.socket.remoteAddress || 'unknown';
        }
        const v = req.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : (v ?? null);
      },
    },
    json: async () => req.body || {},
  };
}

/** Send a Web Response object via Express res. */
async function sendResponse(res: express.Response, response: Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (lk !== 'content-encoding' && lk !== 'transfer-encoding') {
      res.set(key, value);
    }
  });
  // Redirect
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get('location');
    if (loc) {
      response.headers.forEach((v, k) => { if (k.toLowerCase() !== 'location') res.set(k, v); });
      return res.redirect(response.status, loc);
    }
  }
  const text = await response.text();
  res.send(text);
}

function notFound(_req: express.Request, res: express.Response) {
  res.status(404).json({ error: 'Not Found' });
}

// ---- App ----
const app = express();

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// CORS
app.use((_req, res, next) => {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.set(k, v));
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));
app.get('/favicon.ico', (_req, res) => res.sendStatus(204));

// Body parsing
app.use(express.json());

// ---- Public routes (before auth) ----

// POST /api/login — token-based auth (public, rate-limited)
app.post('/api/login', async (req, res) => {
  const pw = env.AUTH_PASSWORD;
  if (!pw) {
    if (env.KV_BINDING) {
      const token = await createSessionToken(env.KV_BINDING as unknown as KVNamespace);
      return res.json({ token });
    }
    return res.json({ token: '' });
  }
  const providedPw = (req.body?.password as string) || '';
  if (env.KV_BINDING) {
    const r = adaptRequest(req);
    const kv = env.KV_BINDING as unknown as KVNamespace;
    const rate = await checkRateLimit(kv, r as unknown as Request);
    if (!rate.allowed) {
      return res.status(429)
        .set(rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {})
        .json({ error: rate.error });
    }
    if (rate.delayMs > 0) {
      await new Promise(rs => setTimeout(rs, rate.delayMs));
    }
  }
  if (providedPw === pw) {
    if (env.KV_BINDING) {
      const kv = env.KV_BINDING as unknown as KVNamespace;
      const r = adaptRequest(req);
      await recordAuthSuccess(kv, r as unknown as Request);
      const token = await createSessionToken(kv);
      return res.json({ token });
    }
    return res.json({ token: '' });
  }
  if (env.KV_BINDING) {
    const r = adaptRequest(req);
    await recordAuthFailure(env.KV_BINDING as unknown as KVNamespace, r as unknown as Request);
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

// GET|POST /s/:id — share access page
app.all('/s/:id', async (req, res, next) => {
  if (!env.DB) return next();
  try {
    const r = adaptRequest(req);
    const response = await handleShareAccess(env, req.params.id, r as unknown as Request);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] share access error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Share download (public, ?share_id=xxx)
app.get('/api/files/:key(*)', async (req, res, next) => {
  if (!req.query.share_id) return next();
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const key = decodeURIComponent(req.params.key);
    const err = validateKey(key);
    if (err) return res.status(400).json({ error: err });
    const r = adaptRequest(req);
    const response = await handleShareDownloadUrl(env, key, String(req.query.share_id), String(req.query.share_pw || ''), r as unknown as Request);
    await sendResponse(res, response);
  } catch {
    res.status(400).json({ error: 'Invalid key encoding' });
  }
});

// Share preview (public, ?share_id=xxx)
app.get('/api/preview/:key(*)', async (req, res, next) => {
  if (!req.query.share_id) return next();
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const key = decodeURIComponent(req.params.key);
    const err = validateKey(key);
    if (err) return res.status(400).json({ error: err });
    const r = adaptRequest(req);
    const response = await handleSharePreviewUrl(env, key, String(req.query.share_id), String(req.query.share_pw || ''), req.query.charset ? String(req.query.charset) : undefined, r as unknown as Request);
    await sendResponse(res, response);
  } catch {
    res.status(400).json({ error: 'Invalid key encoding' });
  }
});

// ---- Static files (before auth) ----
app.use(express.static('../pages/public'));

const TOKEN_PREFIX = 'token:';
const TOKEN_TTL = 7 * 24 * 3600; // 7 days

async function createSessionToken(kv: KVNamespace): Promise<string> {
  const token = crypto.randomUUID();
  await kv.put(TOKEN_PREFIX + token, '1', { expirationTtl: TOKEN_TTL });
  return token;
}

async function validateToken(kv: KVNamespace, token: string): Promise<boolean> {
  const val = await kv.get(TOKEN_PREFIX + token);
  if (!val) return false;
  await kv.put(TOKEN_PREFIX + token, '1', { expirationTtl: TOKEN_TTL });
  return true;
}

async function revokeToken(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(TOKEN_PREFIX + token);
}

// ---- Auth middleware ----

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const password = env.AUTH_PASSWORD;
  if (!password) return next();

  const token = req.headers['x-auth-token'] as string | undefined;
  if (token && env.KV_BINDING) {
    const valid = await validateToken(env.KV_BINDING as unknown as KVNamespace, token);
    return valid ? next() : res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

app.use(authMiddleware);

// ---- Auth-required routes ----

// GET /api/storages
app.get('/api/storages', (_req, res) => {
  const list = getStorages(env).map(s => ({ id: s.id, name: s.name, capacity: s.capacity, capacityUnit: s.capacityUnit }));
  res.json(list);
});

// GET /api/files (list)
app.get('/api/files', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const response = await handleList(storage);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] list error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/upload-url
app.post('/api/upload-url', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const r = adaptRequest(req);
    const response = await handleUploadUrl(r as unknown as Request, storage);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] upload-url error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/preview/:key (auth)
app.get('/api/preview/:key(*)', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const key = decodeURIComponent(req.params.key);
    const err = validateKey(key);
    if (err) return res.status(400).json({ error: err });
    const charset = req.query.charset ? String(req.query.charset) : undefined;
    const response = await handlePreviewUrl(storage, key, charset);
    await sendResponse(res, response);
  } catch {
    res.status(400).json({ error: 'Invalid key encoding' });
  }
});

// POST /api/batch-delete
app.post('/api/batch-delete', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const r = adaptRequest(req);
    const response = await handleBatchDelete(r as unknown as Request, storage);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] batch-delete error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT /api/rename
app.put('/api/rename', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const r = adaptRequest(req);
    const response = await handleRename(r as unknown as Request, storage);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] rename error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/files/:key (download, auth)
app.get('/api/files/:key(*)', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const key = decodeURIComponent(req.params.key);
    const err = validateKey(key);
    if (err) return res.status(400).json({ error: err });
    const response = await handleDownloadUrl(storage, key);
    await sendResponse(res, response);
  } catch {
    res.status(400).json({ error: 'Invalid key encoding' });
  }
});

// DELETE /api/files/:key
app.delete('/api/files/:key(*)', async (req, res) => {
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const key = decodeURIComponent(req.params.key);
    const err = validateKey(key);
    if (err) return res.status(400).json({ error: err });
    const response = await handleDelete(storage, key);
    await sendResponse(res, response);
  } catch {
    res.status(400).json({ error: 'Invalid key encoding' });
  }
});

// Share management (auth, D1 required)
app.post('/api/shares', async (req, res) => {
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const storage = getStorage(env, req.query.storage ? String(req.query.storage) : null);
    const r = adaptRequest(req);
    const response = await handleCreateShare(r as unknown as Request, env, storage.id);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] create-share error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/shares/status', async (_req, res) => {
  if (!env.DB) return res.json({ available: false });
  try {
    await env.DB.prepare('SELECT 1 FROM shares LIMIT 1').first();
    res.json({ available: true });
  } catch {
    res.json({ available: false });
  }
});

app.get('/api/shares', async (req, res) => {
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const r = adaptRequest(req);
    const response = await handleListShares(env, r as unknown as Request);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] list-shares error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/shares/:id', async (req, res) => {
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const response = await handleDeleteShare(env, req.params.id);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] delete-share error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/shares/batch-delete', async (req, res) => {
  if (!env.DB) return res.status(503).json({ error: 'Sharing not configured' });
  try {
    const r = adaptRequest(req);
    const response = await handleBatchDeleteShares(r as unknown as Request, env);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[my-pan] batch-delete-shares error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/logout — revoke token
app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-auth-token'] as string | undefined;
  if (token && env.KV_BINDING) {
    await revokeToken(env.KV_BINDING as unknown as KVNamespace, token);
  }
  res.json({ ok: true });
});

// ---- 404 ----
app.use(notFound);

// ---- Start ----
  app.listen(PORT, () => {
    console.log(`[my-pan] server running at http://localhost:${PORT}`);
  });
}

bootstrap().catch(err => {
  console.error('[my-pan] Failed to start:', err);
  process.exit(1);
});
