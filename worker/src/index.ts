import { signRequest, generatePresignedUrl, rfc3986 } from './s3-auth';
import { handleCreateShare, handleListShares, handleDeleteShare, handleBatchDeleteShares, handleShareAccess, handleSharePreviewUrl, handleShareDownloadUrl, isTextFile } from './shares';
import { CORS_HEADERS, json, escHtml, parseListXml, validateKey } from './utils';
import { checkRateLimit, recordAuthFailure, recordAuthSuccess } from './rate-limit';

export interface StorageInfo {
  id: string;
  name: string;
  bucket: string;
  region: string;
  endpoint: string;
  capacity?: number;     // bytes
  capacityUnit?: string; // B | KB | MB | GB | TB
}

export interface StorageConfig extends StorageInfo {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Env {
  // 单一 secret，包含完整 JSON 数组（含密钥）。每元素字段：
  // 每元素字段：id, name, bucket, region, endpoint, accessKeyId, secretAccessKey
  S3_LIST_JSON?: string;
  AUTH_PASSWORD?: string;
  DB?: D1Database;
}

function parseJson(json: string): unknown | null {
  try { return JSON.parse(json); } catch { return null; }
}

/**
 * 从 S3_LIST_JSON secret 解析存储列表。
 * 单存储时用一个单元素 JSON 数组即可。
 * 未配置或为空时直接报错，Worker 无法启动。
 */
function parseCapacity(v: unknown): { bytes: number; unit?: string } | undefined {
  if (typeof v === 'number' && v > 0) return { bytes: v };
  if (typeof v === 'string') {
    const m = v.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i);
    if (m) {
      const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
      const unit = m[2].toUpperCase();
      return { bytes: parseFloat(m[1]) * (units[unit] || 1), unit };
    }
  }
  return undefined;
}

export function getStorages(env: Env): StorageConfig[] {
  if (!env.S3_LIST_JSON) throw new Error('S3_LIST_JSON is not configured');
  const parsed = parseJson(env.S3_LIST_JSON);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('S3_LIST_JSON is empty or invalid');

  return parsed.map((item: Record<string, unknown>) => {
    const cap = parseCapacity(item.capacity);
    return {
      id: String(item.id || 'default'),
      name: String(item.name || item.id || 'Default'),
      bucket: String(item.bucket || ''),
      region: String(item.region || ''),
      endpoint: String(item.endpoint || ''),
      accessKeyId: String(item.accessKeyId || item.access_key || ''),
      secretAccessKey: String(item.secretAccessKey || ''),
      capacity: cap?.bytes,
      capacityUnit: cap?.unit,
    };
  });
}

export function getStorage(env: Env, id?: string | null): StorageConfig {
  const storages = getStorages(env);
  if (id) {
    const found = storages.find(s => s.id === id);
    if (found) return found;
    throw new Error(`Storage "${id}" not found. Available: ${storages.map(s => s.id).join(', ')}`);
  }
  return storages[0];
}

async function checkAuth(request: Request, password?: string): Promise<Response | true> {
  if (!password) return true;

  const rate = checkRateLimit(request);
  if (!rate.allowed) {
    return json({ error: rate.error }, 429, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {});
  }

  if (rate.delayMs > 0) {
    await new Promise(r => setTimeout(r, rate.delayMs));
  }

  if (request.headers.get('X-Auth-Password') === password) {
    recordAuthSuccess(request);
    return true;
  }

  recordAuthFailure(request);
  return json({ error: 'Unauthorized' }, 401);
}

// =============================================================================
// Route dispatcher
// =============================================================================
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    try {
      // GET/POST /s/:id — share access page (public, no main password)
      const shareMatch = path.match(/^\/s\/([a-f0-9-]+)$/);
      if (shareMatch && (request.method === 'GET' || request.method === 'POST')) {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        return await handleShareAccess(env, shareMatch[1], request);
      }

      // GET /api/preview/:key?share_id=... — share preview (public)
      const sharePreviewMatch = path.match(/^\/api\/preview\/(.+)$/);
      if (sharePreviewMatch && request.method === 'GET' && url.searchParams.has('share_id')) {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        try {
          const key = decodeURIComponent(sharePreviewMatch[1]);
          const shareId = url.searchParams.get('share_id') || '';
          const sharePw = url.searchParams.get('share_pw') || '';
          const charset = url.searchParams.get('charset') || undefined;
          return await handleSharePreviewUrl(env, key, shareId, sharePw, charset, request);
        } catch { return json({ error: 'Invalid key encoding' }, 400); }
      }

      // GET /api/files/:key?share_id=... — share download (public)
      const shareDownloadMatch = path.match(/^\/api\/files\/(.+)$/);
      if (shareDownloadMatch && request.method === 'GET' && url.searchParams.has('share_id')) {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        try {
          const key = decodeURIComponent(shareDownloadMatch[1]);
          const shareId = url.searchParams.get('share_id') || '';
          const sharePw = url.searchParams.get('share_pw') || '';
          return await handleShareDownloadUrl(env, key, shareId, sharePw, request);
        } catch { return json({ error: 'Invalid key encoding' }, 400); }
      }

      const authResult = await checkAuth(request, env.AUTH_PASSWORD);
      if (authResult !== true) return authResult;

      // GET /api/storages — list available storages (no credentials in response)
      if (path === '/api/storages' && request.method === 'GET') {
        return json(getStorages(env).map(s => ({ id: s.id, name: s.name, capacity: s.capacity, capacityUnit: s.capacityUnit })));
      }

      const storage = getStorage(env, url.searchParams.get('storage'));

      // GET /api/files — proxy S3 ListObjects, parse XML → JSON
      if (path === '/api/files' && request.method === 'GET') {
        return await handleList(storage);
      }

      // POST /api/upload-url — presigned PUT URL
      if (path === '/api/upload-url' && request.method === 'POST') {
        return await handleUploadUrl(request, storage);
      }

      // GET /api/preview/:key — presigned GET URL (inline preview)
      const previewMatch = path.match(/^\/api\/preview\/(.+)$/);
      if (previewMatch && request.method === 'GET') {
        try {
          const key = decodeURIComponent(previewMatch[1]);
          const keyErr = validateKey(key);
          if (keyErr) return json({ error: keyErr }, 400);
          const charset = url.searchParams.get('charset') || undefined;
          return await handlePreviewUrl(storage, key, charset);
        } catch { return json({ error: 'Invalid key encoding' }, 400); }
      }

      // POST /api/batch-delete — S3 DeleteObjects
      if (path === '/api/batch-delete' && request.method === 'POST') {
        return await handleBatchDelete(request, storage);
      }

      // PUT /api/rename — Copy + Delete
      if (path === '/api/rename' && request.method === 'PUT') {
        return await handleRename(request, storage);
      }

      // GET/DELETE /api/files/:key
      const fileMatch = path.match(/^\/api\/files\/(.+)$/);
      if (fileMatch) {
        if (!fileMatch[1]) return json({ error: 'Missing key' }, 400);
        let key: string;
        try {
          key = decodeURIComponent(fileMatch[1]);
        } catch { return json({ error: 'Invalid key encoding' }, 400); }
        const keyErr = validateKey(key);
        if (keyErr) return json({ error: keyErr }, 400);
        switch (request.method) {
          case 'GET':
            return await handleDownloadUrl(storage, key);
          case 'DELETE':
            return await handleDelete(storage, key);
        }
      }

      // Share management (authenticated, D1 only)
      if (path === '/api/shares' && request.method === 'POST') {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        return await handleCreateShare(request, env, storage.id);
      }
      if (path === '/api/shares' && request.method === 'GET') {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        return await handleListShares(env, request);
      }
      if (path === '/api/shares/status' && request.method === 'GET') {
        if (!env.DB) return json({ available: false });
        try {
          await env.DB.prepare('SELECT 1 FROM shares LIMIT 1').run();
          return json({ available: true });
        } catch {
          return json({ available: false });
        }
      }
      const shareDelMatch = path.match(/^\/api\/shares\/([a-f0-9-]+)$/);
      if (shareDelMatch && request.method === 'DELETE') {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        return await handleDeleteShare(env, shareDelMatch[1]);
      }
      if (path === '/api/shares/batch-delete' && request.method === 'POST') {
        if (!env.DB) return json({ error: 'Sharing not configured' }, 503);
        return await handleBatchDeleteShares(request, env);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (err) {
      console.error('[my-pan] Unhandled error:', err);
      return json({ error: 'Internal Server Error' }, 500);
    }
  },
};

// =============================================================================
// File operation handlers — all take StorageConfig instead of Env
// =============================================================================

export async function handleList(s: StorageConfig): Promise<Response> {
  const allFiles: Array<{ key: string; size: number; lastModified: string }> = [];
  let marker: string | undefined;

  for (let page = 0; page < 20; page++) {
    const qs = marker ? `?marker=${encodeURIComponent(marker)}` : '';
    const signed = await signRequest('GET', s.bucket, '', s.region, s.accessKeyId, s.secretAccessKey, s.endpoint, undefined, undefined, undefined, qs || undefined);
    const resp = await fetch(`${s.endpoint}/${s.bucket}/${qs}`, { headers: signed });
    if (!resp.ok) {
      return json({ error: `List failed: ${resp.status}`, detail: await resp.text() }, resp.status);
    }
    const result = parseListXml(await resp.text());
    allFiles.push(...result.files);
    if (!result.isTruncated || !result.nextMarker) break;
    marker = result.nextMarker;
  }

  return json(allFiles);
}

export async function handleDownloadUrl(s: StorageConfig, key: string): Promise<Response> {
  const url = await generatePresignedUrl({
    method: 'GET',
    bucket: s.bucket, key,
    region: s.region, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey,
    endpoint: s.endpoint,
    expires: 300,
    disposition: 'attachment',
  });
  return json({ url });
}

export async function handlePreviewUrl(s: StorageConfig, key: string, charset?: string): Promise<Response> {
  const url = await generatePresignedUrl({
    method: 'GET',
    bucket: s.bucket, key,
    region: s.region, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey,
    endpoint: s.endpoint,
    expires: 300,
    disposition: 'inline',
    responseContentType: isTextFile(key) ? `text/plain; charset=${charset || 'utf-8'}` : undefined,
  });
  return json({ url, text: isTextFile(key) });
}

export async function handleUploadUrl(request: Request, s: StorageConfig): Promise<Response> {
  let body: { key?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.key) {
    return json({ error: 'Missing "key" field' }, 400);
  }
  const err = validateKey(body.key);
  if (err) return json({ error: err }, 400);

  const url = await generatePresignedUrl({
    method: 'PUT',
    bucket: s.bucket, key: body.key,
    region: s.region, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey,
    endpoint: s.endpoint,
    expires: 600,
    contentType: body.contentType || 'application/octet-stream',
  });
  return json({ url, key: body.key, method: 'PUT' });
}

export async function handleDelete(s: StorageConfig, key: string): Promise<Response> {
  const signed = await signRequest('DELETE', s.bucket, key, s.region, s.accessKeyId, s.secretAccessKey, s.endpoint);
  const resp = await fetch(`${s.endpoint}/${s.bucket}/${rfc3986(key).replace(/%2F/g, '/')}`, {
    method: 'DELETE',
    headers: signed,
  });
  if (!resp.ok) {
    return json({ error: `Delete failed: ${resp.status}`, detail: await resp.text() }, resp.status);
  }
  return json({ ok: true });
}

export async function handleRename(request: Request, s: StorageConfig): Promise<Response> {
  let body: { sourceKey?: string; destinationKey?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.sourceKey || !body.destinationKey) {
    return json({ error: 'Missing sourceKey or destinationKey' }, 400);
  }
  const srcErr = validateKey(body.sourceKey);
  if (srcErr) return json({ error: `sourceKey: ${srcErr}` }, 400);
  const dstErr = validateKey(body.destinationKey);
  if (dstErr) return json({ error: `destinationKey: ${dstErr}` }, 400);

  const source = `/${s.bucket}/${rfc3986(body.sourceKey).replace(/%2F/g, '/')}`;

  const signed = await signRequest(
    'PUT', s.bucket, body.destinationKey,
    s.region, s.accessKeyId, s.secretAccessKey,
    s.endpoint,
    undefined, undefined,
    { 'x-amz-copy-source': source },
  );
  const copyResp = await fetch(
    `${s.endpoint}/${s.bucket}/${rfc3986(body.destinationKey).replace(/%2F/g, '/')}`,
    { method: 'PUT', headers: signed },
  );
  if (!copyResp.ok) {
    return json({ error: `Copy failed: ${copyResp.status}`, detail: await copyResp.text() }, copyResp.status);
  }

  const delSigned = await signRequest(
    'DELETE', s.bucket, body.sourceKey,
    s.region, s.accessKeyId, s.secretAccessKey,
    s.endpoint,
  );
  const delResp = await fetch(
    `${s.endpoint}/${s.bucket}/${rfc3986(body.sourceKey).replace(/%2F/g, '/')}`,
    { method: 'DELETE', headers: delSigned },
  );
  if (!delResp.ok) {
    console.warn(`[my-pan] Rename: copy succeeded but source delete failed (${delResp.status}), source key: ${body.sourceKey}`);
    return json({ error: `Rename partially completed: file copied but original could not be deleted (${delResp.status})`, sourceKey: body.sourceKey, destinationKey: body.destinationKey }, 409);
  }

  return json({ ok: true });
}

export async function handleBatchDelete(request: Request, s: StorageConfig): Promise<Response> {
  let body: { keys?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
    return json({ error: 'Missing or empty keys array' }, 400);
  }
  if (body.keys.length > 1000) {
    return json({ error: 'Cannot delete more than 1000 objects at once' }, 400);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${body.keys.map(k => `<Object><Key>${escHtml(k)}</Key></Object>`).join('')}</Delete>`;
  const encoded = new TextEncoder().encode(xml);

  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const checksum = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

  const signed = await signRequest(
    'POST', s.bucket, '',
    s.region, s.accessKeyId, s.secretAccessKey,
    s.endpoint,
    'application/xml', encoded,
    { 'x-amz-checksum-sha256': checksum },
    'delete=',
  );

  const resp = await fetch(
    `${s.endpoint}/${s.bucket}/?delete`,
    { method: 'POST', headers: signed, body: encoded },
  );

  if (!resp.ok) {
    return json({ error: `Batch delete failed: ${resp.status}`, detail: await resp.text() }, resp.status);
  }

  return json({ ok: true, count: body.keys.length });
}
