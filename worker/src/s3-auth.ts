/**
 * AWS Signature V4 签名实现 — 适用于任意 S3 兼容对象存储
 *
 * 不引入 AWS SDK（数百 KB），手写 ~180 行 SigV4 核心逻辑，零外部依赖。
 * 所有加密操作使用 Web Crypto API（CloudFlare Workers 原生支持）。
 *
 * 两种使用模式：
 * 1. Authorization Header — Worker 代理请求 S3（list / delete）
 * 2. Presigned URL — 浏览器直连 S3（upload / download / preview）
 */

// =============================================================================
// 加密原语（Web Crypto API）
// =============================================================================

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: string | Uint8Array): Promise<string> {
  const buf: Uint8Array = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return bytesToHex(hash);
}

async function hmacSha256(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

/**
 * AWS SigV4 签名密钥派生链：
 *   kDate    = HMAC("AWS4" + secretKey,  dateStamp)
 *   kRegion  = HMAC(kDate,              region)
 *   kService = HMAC(kRegion,            service)
 *   kSigning = HMAC(kService,           "aws4_request")
 *
 * 逐层 HMAC 的目的是将签名绑定到特定日期、区域和服务，防止跨上下文重放。
 */
async function deriveSigningKey(
  secretKey: string,
  dateStamp: string,    // YYYYMMDD
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * RFC 3986 编码 — 对预签名 URL 中的查询参数值做更严格的百分号编码。
 * JavaScript 的 encodeURIComponent 不编码 !'()*，而 S3 规范要求编码这些字符。
 */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

// =============================================================================
// 模式一：Authorization Header 签名（Worker → S3 代理请求）
// =============================================================================

/**
 * 对 Worker→S3 的 S3 API 请求签名，返回可直接用于 fetch headers 的对象。
 * 适用于 list、delete、copy 等需要 Worker 代理的场景。
 *
 * 签名流程：
 * 1. 构建规范请求（Canonical Request）
 * 2. 构建待签字符串（String to Sign）
 * 3. 派生签名密钥 + HMAC 生成签名
 * 4. 组装 Authorization header
 */
export async function signRequest(
  method: string,
  bucket: string,
  key: string,
  region: string,
  accessKeyId: string,
  secretKey: string,
  endpoint: string,
  contentType?: string,
  body?: Uint8Array,
  extraHeaders?: Record<string, string>,
  queryString?: string,
): Promise<Record<string, string>> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');  // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);                           // YYYYMMDD
  const service = 's3';
  const hostname = new URL(endpoint).hostname;

  // 请求体哈希 — 空体的 SHA-256 不是 "UNSIGNED-PAYLOAD"，只有预签名 URL 才用
  const payloadHash = await sha256(body || new Uint8Array(0));

  // S3 S3 的路径格式为 /{bucket}/ 或 /{bucket}/{key}
  const resource = key ? `/${bucket}/${rfc3986(key).replace(/%2F/g, '/')}` : `/${bucket}/`;

  // 收集所有签名头并按字母序排列
  const sigHeaders: Record<string, string> = {
    'host': hostname,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) sigHeaders['content-type'] = contentType;
  if (extraHeaders) Object.assign(sigHeaders, extraHeaders);

  const signedNames = Object.keys(sigHeaders).sort();
  const signedHeaders = signedNames.join(';');
  const canonicalHeaders = signedNames.map(n => `${n}:${sigHeaders[n]}`).join('\n') + '\n';

  // 规范请求 = METHOD\npath\nquery\ncanonicalHeaders\nsignedHeaders\npayloadHash
  const canonicalRequest = [
    method.toUpperCase(),
    resource,
    queryString || '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(secretKey, dateStamp, region, service);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  const result: Record<string, string> = {
    'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (contentType) result['content-type'] = contentType;
  if (extraHeaders) Object.assign(result, extraHeaders);
  return result;
}

// =============================================================================
// 模式二：预签名 URL（浏览器直连 S3，签名放在 query string 中）
// =============================================================================

export interface PresignedUrlParams {
  method: 'GET' | 'PUT';
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;     // e.g. https://<bucket>.s3.<region>.amazonaws.com
  expires: number;       // 有效期（秒）
  contentType?: string;  // PUT 时必须，签入 URL 确保 S3 存储正确的 Content-Type
  disposition?: 'inline' | 'attachment';  // GET 可选 — inline 预览，attachment 触发下载
  responseContentType?: string;            // GET 可选 — 覆盖 S3 返回的 Content-Type（预览文本文件时解决编码和渲染问题）
}

/**
 * 生成预签名 URL — 浏览器拿到后直接向 S3 发送 GET/PUT 请求，不经过 Worker。
 *
 * 与 Authorization Header 模式的核心区别：
 * - 签名信息嵌入到 query string（X-Amz-Algorithm, X-Amz-Credential 等参数）
 * - 请求体哈希固定为 UNSIGNED-PAYLOAD（因为签名时还不知道实际文件内容）
 * - 签名包含过期时间（X-Amz-Expires），过期后 URL 自动失效
 * - response-content-disposition 参数允许 Worker 控制浏览器是预览还是下载
 */
export async function generatePresignedUrl(p: PresignedUrlParams): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const credentialScope = `${dateStamp}/${p.region}/${service}/aws4_request`;
  const hostname = new URL(p.endpoint).hostname;

  // 路径中的 / 不编码，保留目录结构
  const resource = `/${p.bucket}/${rfc3986(p.key).replace(/%2F/g, '/')}`;

  const signedHeadersList = p.contentType ? 'content-type;host' : 'host';

  // 预签名 URL 的查询参数（按字母序签名）
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${p.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(p.expires),
    'X-Amz-SignedHeaders': signedHeadersList,
  };

  // Content-Disposition 覆盖 — 这是 Worker 能控制浏览器行为的唯一方式
  if (p.method === 'GET' && p.disposition) {
    queryParams['response-content-disposition'] =
      `${p.disposition}; filename*=UTF-8''${rfc3986(p.key.split('/').pop() || p.key)}`;
  }

  // Content-Type 覆盖 — 文本类文件强制指定 charset 解决编码问题，同时让 .md 等类型可内联渲染
  if (p.method === 'GET' && p.responseContentType) {
    queryParams['response-content-type'] = p.responseContentType;
  }

  // SigV4 要求 query string 按参数名字典序排列
  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys.map(k => `${rfc3986(k)}=${rfc3986(queryParams[k])}`).join('&');

  const canonicalHeaders = [
    p.contentType ? `content-type:${p.contentType}` : null,
    `host:${hostname}`,
  ].filter(Boolean).join('\n') + '\n';

  const canonicalRequest = [
    p.method.toUpperCase(),
    resource,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    'UNSIGNED-PAYLOAD',             // 关键：预签名场景使用此字面量，与实际 payload 无关
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(p.secretAccessKey, dateStamp, p.region, service);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  // 签名追加到最后（不计入 canonical query string）
  const finalQuery = canonicalQueryString + '&X-Amz-Signature=' + signature;
  return `${p.endpoint}/${p.bucket}/${rfc3986(p.key).replace(/%2F/g, '/')}?${finalQuery}`;
}
