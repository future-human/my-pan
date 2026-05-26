export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Password',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function parseListXml(xml: string): { files: Array<{ key: string; size: number; lastModified: string }>; isTruncated: boolean; nextMarker: string | null } {
  const files: Array<{ key: string; size: number; lastModified: string }> = [];
  for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = decodeXml((block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || '');
    const size = parseInt((block.match(/<Size>(\d+)<\/Size>/) || [])[1] || '0', 10);
    const lastModified = (block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || '';
    if (key) files.push({ key, size, lastModified });
  }
  const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
  const nextMarker = (xml.match(/<NextMarker>([\s\S]*?)<\/NextMarker>/) || [])[1] || null;
  return { files, isTruncated, nextMarker: nextMarker ? decodeXml(nextMarker) : null };
}

const MAX_KEY_LENGTH = 1024;

export function validateKey(k: string): string | null {
  if (!k || k.length > MAX_KEY_LENGTH) return 'Invalid key';
  if (k.includes('\x00')) return 'Invalid key';
  if (k.split('/').some(seg => seg === '..' || seg === '.')) return 'Invalid key';
  return null;
}

/** Encode a string for safe embedding in a &lt;script&gt; block as a JS string literal (quoted). */
export function safeJsString(s: string): string {
  return JSON.stringify(s).replace(/<\//g, '<\\/');
}
