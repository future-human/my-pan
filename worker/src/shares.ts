import { generatePresignedUrl, signRequest, rfc3986 } from './s3-auth';
import { json, escHtml, safeJsString, parseListXml } from './utils';
import { checkRateLimit, recordAuthFailure, recordAuthSuccess } from './rate-limit';
import type { Env, StorageConfig } from './index';
import { getStorage } from './index';

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let pw = '';
  for (let i = 0; i < bytes.length && pw.length < 6; i++) {
    if (bytes[i] < 252) pw += chars[bytes[i] % chars.length];
  }
  if (pw.length < 6) return generatePassword();
  return pw;
}

export const TEXT_EXTS = new Set([
  'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'csv', 'log',
  'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css',
  'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'go', 'rs', 'php', 'sql', 'swift', 'kt',
  'r', 'm', 'mm', 'scala', 'lua', 'pl', 'pm', 'dart', 'ex', 'exs',
  'toml', 'ini', 'cfg', 'conf', 'env', 'editorconfig', 'gitignore', 'properties',
  'bat', 'cmd', 'ps1', 'tex', 'bib', 'makefile', 'dockerfile',
  'vue', 'svelte', 'astro',
]);

const MEDIA_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  'mp4', 'webm', 'ogg',
  'mp3', 'wav', 'flac',
  'pdf',
]);

const OFFICE_EXTS = new Set(['docx', 'xlsx', 'pptx', 'xls']);

function isPreviewable(key: string): boolean {
  const ext = (key.split('.').pop() || '').toLowerCase();
  return TEXT_EXTS.has(ext) || MEDIA_EXTS.has(ext) || OFFICE_EXTS.has(ext);
}

export function isTextFile(key: string): boolean {
  const ext = (key.split('.').pop() || '').toLowerCase();
  return TEXT_EXTS.has(ext);
}

// =============================================================================
// HTML 模板
// =============================================================================

const BASE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>我的网盘 - 分享</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: linear-gradient(135deg, #0f1729 0%, #1a2744 30%, #1e3a5f 60%, #1a2744 100%);
    color: #333; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  .card {
    text-align: center; padding: 48px 40px; background: #fff; border-radius: 20px;
    border: 1px solid rgba(0,0,0,.08); box-shadow: 0 20px 60px rgba(0,0,0,.2);
    max-width: 420px; width: 90%;
  }
  .card h1 { font-size: 24px; margin-bottom: 4px; color: #1a2744; font-weight: 700; }
  .card .filename { color: #888; font-size: 14px; margin-bottom: 24px; word-break: break-all; }
  .card .file-icon { font-size: 48px; margin-bottom: 12px; }
  .card input {
    width: 100%; padding: 10px 14px; border: 1px solid #d0d5dd; border-radius: 8px;
    font-size: 15px; outline: none; background: #f9fafb; color: #333;
    transition: border-color .2s, box-shadow .2s;
  }
  .card input:focus { border-color: #4d9fff; box-shadow: 0 0 0 3px rgba(77,159,255,.2); }
  .card button {
    display: block; margin: 16px auto 0; padding: 10px 40px;
    background: linear-gradient(135deg, #4d9fff, #0066ff); color: #fff; border: none;
    border-radius: 8px; font-size: 15px; cursor: pointer; transition: transform .15s, box-shadow .15s;
  }
  .card button:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,102,255,.4); }
  .error { color: #e00; font-size: 14px; margin-top: 12px; display: __ERROR_DISPLAY__; }
  .expired { text-align: center; }
  .expired .icon { font-size: 48px; margin-bottom: 16px; }
  .expired p { color: #888; font-size: 14px; }
  .actions { display: __ACTIONS_DISPLAY__; flex-direction: column; gap: 12px; }
  .actions button {
    display: inline-block; padding: 10px 32px; margin: 0;
    font-size: 14px; border-radius: 8px; cursor: pointer; border: none;
    transition: transform .15s, box-shadow .15s;
  }
  .actions button:hover { transform: translateY(-1px); }
  .btn-preview { background: linear-gradient(135deg, #4d9fff, #0066ff); color: #fff; }
  .btn-preview:hover { box-shadow: 0 4px 16px rgba(0,102,255,.4); }
  .btn-download { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; }
  .btn-download:hover { box-shadow: 0 4px 16px rgba(124,58,237,.4); }
  .notice { font-size: 12px; color: #aaa; margin-top: 16px; display: __NOTICE_DISPLAY__; }
  __OVERLAY_CSS__
</style>
</head>
<body>
<div class="card">
  __EXPIRED_BLOCK__
  <div class="file-icon">__FILE_ICON__</div>
  <h1>分享文件</h1>
  <p class="filename">__FILE_NAME__</p>
  <form method="get" action="" style="display:__FORM_DISPLAY__;">
    <input type="password" name="p" placeholder="请输入分享密码" autofocus autocomplete="off">
    <button type="submit">查看文件</button>
  </form>
  <div class="actions">
    __ACTION_BUTTONS__
  </div>
  <div class="error">__ERROR_MSG__</div>
  <div class="notice">__NOTICE_TEXT__</div>
</div>
__OVERLAY_HTML__
__OVERLAY_JS__
</body>
</html>`;

// 复用主站 .preview-overlay 样式，保持视觉一致
const OVERLAY_CSS = `
  .preview-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.65); z-index: 1000; align-items: center; justify-content: center; }
  .preview-overlay.visible { display: flex; }
  .preview-container { background: #fff; border-radius: 12px; width: 90vw; max-width: 960px; height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .preview-header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; gap: 12px; flex-shrink: 0; }
  .preview-title { font-size: 14px; color: #333; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .preview-charset-group { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #666; white-space: nowrap; }
  .preview-charset { padding: 4px 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 13px; background: #f9fafb; cursor: pointer; }
  .preview-close { background: none; border: none; font-size: 24px; color: #888; cursor: pointer; padding: 0 4px; line-height: 1; margin: 0 !important; }
  .preview-close:hover { color: #333; }
  .preview-body { flex: 1; overflow: hidden; }
  .preview-body iframe { width: 100%; height: 100%; border: none; }`;

const OVERLAY_HTML = `
<div class="preview-overlay" id="preview-overlay">
  <div class="preview-container">
    <div class="preview-header">
      <span class="preview-title" id="preview-title"></span>
      <span class="preview-charset-group" id="preview-charset-group" style="display:none">
        <span>编码</span>
        <select class="preview-charset" id="preview-charset">
          <option value="utf-8">UTF-8</option>
          <option value="gbk">GBK</option>
          <option value="gb2312">GB2312</option>
          <option value="gb18030">GB18030</option>
          <option value="big5">Big5</option>
          <option value="shift_jis">Shift_JIS</option>
          <option value="euc-jp">EUC-JP</option>
          <option value="euc-kr">EUC-KR</option>
          <option value="iso-8859-1">Latin-1</option>
          <option value="windows-1252">Windows-1252</option>
        </select>
      </span>
      <button class="preview-close" id="preview-close">&times;</button>
    </div>
    <div class="preview-body">
      <iframe id="preview-iframe" allow="fullscreen; autoplay"></iframe>
    </div>
  </div>
</div>`;

// JS：调用现有的 /api/preview/:key 端点，在 Worker 同域名下无跨域问题
const OVERLAY_JS = `<script>
(function() {
  var previewApiBase = __PREVIEW_API_BASE__;
  var isText = __IS_TEXT__;
  var downloadUrl = __DOWNLOAD_URL__;
  var charsetSelect = document.getElementById('preview-charset');
  var iframe = document.getElementById('preview-iframe');

  function loadPreview(charset) {
    var url = previewApiBase;
    if (isText) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'charset=' + encodeURIComponent(charset || 'utf-8');
    fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data) {
      iframe.src = data.url;
    }).catch(function(err) {
      iframe.src = 'data:text/html,<h2 style="padding:20px;color:red">加载失败: ' + err.message + '</h2>';
    });
  }

  window.openPreview = function() {
    document.getElementById('preview-title').textContent = __FILE_NAME_JS__;
    document.getElementById('preview-charset-group').style.display = isText ? 'flex' : 'none';
    document.getElementById('preview-overlay').classList.add('visible');
    if (isText) charsetSelect.value = 'utf-8';
    loadPreview('utf-8');
  };

  window.closePreview = function() {
    document.getElementById('preview-overlay').classList.remove('visible');
    iframe.src = '';
  };

  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-overlay').addEventListener('click', function(e) {
    if (e.target === this) closePreview();
  });

  charsetSelect.addEventListener('change', function() {
    loadPreview(this.value);
  });

  window.doDownload = function() {
    window.location.href = downloadUrl;
  };
})();
<\/script>`;

function getFileIcon(key: string): string {
  const ext = (key.split('.').pop() || '').toLowerCase();
  const iconMap: Record<string, string> = {
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️', ico: '🖼️',
    mp4: '🎬', webm: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵', ogg: '🎵',
    pdf: '📄',
    txt: '📝', md: '📝', json: '📝', xml: '📝', csv: '📝', log: '📝',
    js: '💻', ts: '💻', jsx: '💻', tsx: '💻', py: '💻', java: '💻', go: '💻', rs: '💻',
    html: '🌐', htm: '🌐', css: '🎨',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  };
  return iconMap[ext] || '📎';
}

function sharePageHtml(fileName: string, errorMsg: string, expired: boolean): string {
  if (expired) {
    return BASE_HTML
      .replace('__OVERLAY_CSS__', '')
      .replace('__OVERLAY_HTML__', '')
      .replace('__OVERLAY_JS__', '')
      .replace('__EXPIRED_BLOCK__', '<div class="expired"><div class="icon">⏰</div><p>此分享链接已过期</p></div>')
      .replace('__FILE_ICON__', '')
      .replace('__FILE_NAME__', '')
      .replace('__FORM_DISPLAY__', 'none')
      .replace('__ACTIONS_DISPLAY__', 'none')
      .replace('__ACTION_BUTTONS__', '')
      .replace('__ERROR_DISPLAY__', 'none')
      .replace('__ERROR_MSG__', '')
      .replace('__NOTICE_DISPLAY__', 'none')
      .replace('__NOTICE_TEXT__', '');
  }
  return BASE_HTML
    .replace('__OVERLAY_CSS__', '')
    .replace('__OVERLAY_HTML__', '')
    .replace('__OVERLAY_JS__', '')
    .replace('__EXPIRED_BLOCK__', '')
    .replace('__FILE_ICON__', getFileIcon(fileName))
    .replace('__FILE_NAME__', escHtml(fileName))
    .replace('__FORM_DISPLAY__', 'block')
    .replace('__ACTIONS_DISPLAY__', 'none')
    .replace('__ACTION_BUTTONS__', '')
    .replace('__ERROR_DISPLAY__', errorMsg ? 'block' : 'none')
    .replace('__ERROR_MSG__', escHtml(errorMsg))
    .replace('__NOTICE_DISPLAY__', 'none')
    .replace('__NOTICE_TEXT__', '');
}

function accessPageHtml(
  fileKey: string, shareId: string, fileName: string, password: string,
  previewable: boolean, isText: boolean, downloadUrl: string,
): string {
  const previewApiBase = `/api/preview/${encodeURIComponent(fileKey)}?share_id=${shareId}&share_pw=${encodeURIComponent(password)}`;

  let buttons = '';
  if (previewable) {
    buttons += `<button class="btn-preview" onclick="openPreview()">预览</button>`;
  }
  buttons += `<button class="btn-download" onclick="doDownload()">下载</button>`;

  return BASE_HTML
    .replace('__OVERLAY_CSS__', OVERLAY_CSS)
    .replace('__OVERLAY_HTML__', OVERLAY_HTML)
    .replace('__OVERLAY_JS__', OVERLAY_JS
      .replace('__PREVIEW_API_BASE__', safeJsString(previewApiBase))
      .replace('__IS_TEXT__', isText ? 'true' : 'false')
      .replace('__FILE_NAME_JS__', safeJsString(fileName))
      .replace('__DOWNLOAD_URL__', safeJsString(downloadUrl)),
    )
    .replace('__EXPIRED_BLOCK__', '')
    .replace('__FILE_ICON__', getFileIcon(fileName))
    .replace('__FILE_NAME__', escHtml(fileName))
    .replace('__FORM_DISPLAY__', 'none')
    .replace('__ACTIONS_DISPLAY__', 'flex')
    .replace('__ACTION_BUTTONS__', buttons)
    .replace('__ERROR_DISPLAY__', 'none')
    .replace('__ERROR_MSG__', '')
    .replace('__NOTICE_DISPLAY__', 'block')
    .replace('__NOTICE_TEXT__', '');
}

// =============================================================================
// 分享文件夹列表页 — 复用主站预览弹窗样式
// =============================================================================

function shareFormatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function shareFormatDate(d: string): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function listShareFolderFiles(s: StorageConfig, prefix: string): Promise<Array<{ key: string; size: number; lastModified: string }>> {
  const allFiles: Array<{ key: string; size: number; lastModified: string }> = [];
  let marker: string | undefined;

  for (let page = 0; page < 20; page++) {
    const qs = [`prefix=${rfc3986(prefix)}`];
    if (marker) qs.push(`marker=${encodeURIComponent(marker)}`);
    const queryString = qs.join('&');
    const signed = await signRequest('GET', s.bucket, '', s.region, s.accessKeyId, s.secretAccessKey, s.endpoint, undefined, undefined, undefined, queryString);
    const resp = await fetch(`${s.endpoint}/${s.bucket}/?${queryString}`, { headers: signed });
    if (!resp.ok) break;
    const result = parseListXml(await resp.text());
    for (const f of result.files) {
      if (!f.key.endsWith('/')) allFiles.push(f);
    }
    if (!result.isTruncated || !result.nextMarker) break;
    marker = result.nextMarker;
  }

  return allFiles;
}

function folderSharePageHtml(
  folderName: string, files: Array<{ key: string; size: number; lastModified: string }>,
  shareId: string, password: string,
): string {
  let rows = '';
  for (const f of files) {
    const displayKey = f.key.startsWith(folderName) ? f.key.slice(folderName.length) : f.key;
    const icon = getFileIcon(f.key);
    const isText = isTextFile(f.key);
    const previewable = isPreviewable(f.key);
    const encKey = safeJsString(f.key);
    rows += `<tr>
      <td class="share-fn" title="${escHtml(f.key)}"><span class="sf-icon">${icon}</span> ${escHtml(displayKey)}</td>
      <td class="share-fs">${shareFormatSize(f.size)}</td>
      <td class="share-fd">${shareFormatDate(f.lastModified)}</td>
      <td class="share-fa">
        ${previewable ? `<button class="btn-sm btn-preview" onclick="previewItem(${encKey},${isText})">预览</button>` : ''}
        <button class="btn-sm btn-dl" onclick="downloadItem(${encKey})">下载</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>分享文件夹 - ${escHtml(folderName)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#0f1729 0%,#1a2744 30%,#1e3a5f 60%,#1a2744 100%);color:#333;min-height:100vh;padding:24px}
  .card{max-width:860px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid rgba(0,0,0,.08);box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden}
  .card-hd{text-align:center;padding:32px 24px 16px}
  .card-hd h1{font-size:22px;color:#1a2744;font-weight:700}
  .card-hd .count{color:#888;font-size:14px;margin-top:4px}
  .share-files-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}
  .share-files-table th{text-align:left;padding:10px 16px;font-size:14px;font-weight:600;color:#333;border-bottom:2px solid #d0d5dd;border-right:1px solid #e5e7eb;white-space:nowrap}
  .share-files-table th:last-child{text-align:center;border-right:none}
  .share-files-table td{padding:10px 16px;font-size:14px;border-bottom:1px solid #e0e0e0;border-right:1px solid #f0f0f0;white-space:nowrap}
  .share-files-table td:last-child{border-right:none}
  .share-files-table tr:last-child td{border-bottom:none}
  .share-files-table tr:hover td{background:#f5f7fa}
  .share-fn{overflow:hidden;text-overflow:ellipsis}
  .sf-icon{margin-right:6px}
  .share-fs,.share-fd{color:#666}
  .share-fa{text-align:center}
  .btn-sm{padding:4px 14px;border:none;border-radius:6px;font-size:13px;cursor:pointer;color:#fff;transition:all .15s;margin:0 3px}
  .btn-preview{background:linear-gradient(135deg,#5cadff,#3083e0)}
  .btn-preview:hover{box-shadow:0 4px 12px rgba(64,158,255,.35)}
  .btn-dl{background:linear-gradient(135deg,#a78bfa,#7c3aed)}
  .btn-dl:hover{box-shadow:0 4px 12px rgba(124,58,237,.35)}
  .notice{text-align:center;font-size:12px;color:#aaa;padding:16px 24px}
  .share-empty{text-align:center;padding:40px 20px;color:#aaa;font-size:14px}
  ${OVERLAY_CSS}
</style>
</head>
<body>
<div class="card">
  <div class="card-hd">
    <h1>📁 ${escHtml(folderName)}</h1>
    <p class="count">${files.length} 个文件</p>
  </div>
  ${files.length > 0 ? `<table class="share-files-table"><thead><tr><th style="width:45%">文件名</th><th style="width:15%">大小</th><th style="width:20%">修改时间</th><th style="width:20%">操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="share-empty">此文件夹为空</div>'}
  <div class="notice">此分享由 我的网盘 生成</div>
</div>
${OVERLAY_HTML}
<script>
(function() {
  var sid=${safeJsString(shareId)},spw=${safeJsString(password)};
  var iframe=document.getElementById('preview-iframe');
  var title=document.getElementById('preview-title');
  var charsetGroup=document.getElementById('preview-charset-group');
  var charset=document.getElementById('preview-charset');
  var overlay=document.getElementById('preview-overlay');
  var curKey='',curIsText=false;

  function loadPreview(charsetVal) {
    var u='/api/preview/'+encodeURIComponent(curKey)+'?share_id='+sid+'&share_pw='+encodeURIComponent(spw);
    if(curIsText) u+='&charset='+encodeURIComponent(charsetVal||'utf-8');
    fetch(u).then(function(r){return r.json();}).then(function(d){iframe.src=d.url;}).catch(function(e){iframe.src='data:text/html,<h2 style=padding:20px;color:red>加载失败: '+e.message+'</h2>';});
  }

  window.previewItem=function(key,isText) {
    curKey=key;curIsText=isText;
    title.textContent=key.split('/').pop();
    charsetGroup.style.display=isText?'flex':'none';
    if(isText)charset.value='utf-8';
    overlay.classList.add('visible');
    loadPreview('utf-8');
  };

  window.downloadItem=function(key) {
    fetch('/api/files/'+encodeURIComponent(key)+'?share_id='+sid+'&share_pw='+encodeURIComponent(spw))
      .then(function(r){return r.json();})
      .then(function(d){window.location.href=d.url;});
  };

  document.getElementById('preview-close').addEventListener('click',function(){overlay.classList.remove('visible');iframe.src='';});
  overlay.addEventListener('click',function(e){if(e.target===this){overlay.classList.remove('visible');iframe.src='';}});
  charset.addEventListener('change',function(){loadPreview(this.value);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&overlay.classList.contains('visible')){overlay.classList.remove('visible');iframe.src='';}});
})();
<\/script>
</body>
</html>`;
}

// =============================================================================
// Handlers
// =============================================================================

export async function handleShareDownloadUrl(env: Env, key: string, shareId: string, sharePw: string, request: Request): Promise<Response> {
  const row = await env.DB!.prepare('SELECT file_key, password, expires_at, storage_id FROM shares WHERE id = ?').bind(shareId).first<{
    file_key: string; password: string; expires_at: string | null; storage_id: string;
  }>();
  if (!row) return json({ error: 'Not Found' }, 404);
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await env.DB!.prepare('DELETE FROM shares WHERE id = ?').bind(shareId).run();
    return json({ error: 'Share expired' }, 410);
  }

  if (env.KV_BINDING) {
    const rate = await checkRateLimit(env.KV_BINDING, request);
    if (!rate.allowed) {
      return json({ error: rate.error }, 429, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {});
    }
    if (rate.delayMs > 0) {
      await new Promise(r => setTimeout(r, rate.delayMs));
    }
  }

  if (sharePw !== row.password) {
    if (env.KV_BINDING) await recordAuthFailure(env.KV_BINDING, request);
    return json({ error: 'Unauthorized' }, 401);
  }
  if (env.KV_BINDING) await recordAuthSuccess(env.KV_BINDING, request);

  // 验证目标文件在分享范围内：文件夹分享允许前缀内所有文件，单文件分享严格匹配
  const isFolder = row.file_key.endsWith('/');
  if (isFolder ? !key.startsWith(row.file_key) : key !== row.file_key) {
    return json({ error: 'Not Found' }, 404);
  }

  const s = getStorage(env, row.storage_id);
  const url = await generatePresignedUrl({
    method: 'GET',
    bucket: s.bucket,
    key,
    region: s.region,
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    endpoint: s.endpoint,
    expires: 600,
    disposition: 'attachment',
  });
  return json({ url });
}

export async function handleShareAccess(env: Env, shareId: string, request: Request): Promise<Response> {
  const row = await env.DB!.prepare('SELECT * FROM shares WHERE id = ?').bind(shareId).first<{
    id: string; file_key: string; file_name: string;
    password: string; expires_at: string | null; storage_id: string;
  }>();

  if (!row) {
    return new Response(sharePageHtml('', '分享链接不存在', false), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await env.DB!.prepare('DELETE FROM shares WHERE id = ?').bind(shareId).run();
    return new Response(sharePageHtml('', '', true), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  let providedPw = '';
  if (request.method === 'POST') {
    try {
      const formData = await request.formData();
      providedPw = (formData.get('p') || formData.get('password') || '').toString();
    } catch { /* ignore */ }
  } else {
    providedPw = new URL(request.url).searchParams.get('p') || '';
  }

  if (providedPw) {
    if (env.KV_BINDING) {
      const rate = await checkRateLimit(env.KV_BINDING, request);
      if (!rate.allowed) {
        return new Response(sharePageHtml(row.file_name, rate.error || 'Too many attempts', false), {
          status: 429,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': String(rate.retryAfter || 900) },
        });
      }
    }

    if (providedPw === row.password) {
      if (env.KV_BINDING) await recordAuthSuccess(env.KV_BINDING, request);
      await env.DB!.prepare('UPDATE shares SET access_count = access_count + 1 WHERE id = ?').bind(shareId).run();

      const s = getStorage(env, row.storage_id);

      // 文件夹分享：列表页
      if (row.file_key.endsWith('/')) {
        const files = await listShareFolderFiles(s, row.file_key);
        return new Response(
          folderSharePageHtml(row.file_name, files, shareId, row.password),
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }

      // 单文件分享：卡片页
      const previewable = isPreviewable(row.file_key);
      const text = isTextFile(row.file_key);

      const downloadUrl = await generatePresignedUrl({
        method: 'GET',
        bucket: s.bucket,
        key: row.file_key,
        region: s.region,
        accessKeyId: s.accessKeyId,
        secretAccessKey: s.secretAccessKey,
        endpoint: s.endpoint,
        expires: 600,
        disposition: 'attachment',
      });

      return new Response(
        accessPageHtml(row.file_key, shareId, row.file_name, row.password, previewable, text, downloadUrl),
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    if (env.KV_BINDING) await recordAuthFailure(env.KV_BINDING, request);
    return new Response(sharePageHtml(row.file_name, '密码错误，请重试', false), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(sharePageHtml(row.file_name, '', false), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// 复用 handlePreviewUrl 的预览 URL 生成逻辑，仅认证方式不同（通过 share_id + share_pw）
export async function handleSharePreviewUrl(
  env: Env, key: string, shareId: string, sharePw: string, charset: string | undefined, request: Request,
): Promise<Response> {
  const row = await env.DB!.prepare('SELECT file_key, password, expires_at, storage_id FROM shares WHERE id = ?').bind(shareId).first<{
    file_key: string; password: string; expires_at: string | null; storage_id: string;
  }>();
  if (!row) return json({ error: 'Not Found' }, 404);
  // 验证目标文件在分享范围内：文件夹分享允许前缀内所有文件，单文件分享严格匹配
  const isFolder = row.file_key.endsWith('/');
  if (isFolder ? !key.startsWith(row.file_key) : key !== row.file_key) {
    return json({ error: 'Not Found' }, 404);
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await env.DB!.prepare('DELETE FROM shares WHERE id = ?').bind(shareId).run();
    return json({ error: 'Share expired' }, 410);
  }

  if (env.KV_BINDING) {
    const rate = await checkRateLimit(env.KV_BINDING, request);
    if (!rate.allowed) {
      return json({ error: rate.error }, 429, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {});
    }
    if (rate.delayMs > 0) {
      await new Promise(r => setTimeout(r, rate.delayMs));
    }
  }

  if (sharePw !== row.password) {
    if (env.KV_BINDING) await recordAuthFailure(env.KV_BINDING, request);
    return json({ error: 'Unauthorized' }, 401);
  }
  if (env.KV_BINDING) await recordAuthSuccess(env.KV_BINDING, request);

  const s = getStorage(env, row.storage_id);
  const isText = isTextFile(key);
  const url = await generatePresignedUrl({
    method: 'GET',
    bucket: s.bucket,
    key,
    region: s.region,
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    endpoint: s.endpoint,
    expires: 600,
    disposition: isText ? 'inline' : undefined,
    responseContentType: isText ? `text/plain; charset=${charset || 'utf-8'}` : undefined,
  });

  return json({ url, text: isText });
}

export async function handleCreateShare(request: Request, env: Env, storageId: string): Promise<Response> {
  let body: { fileKey?: string; fileName?: string; password?: string; expiresInHours?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.fileKey) {
    return json({ error: 'Missing fileKey' }, 400);
  }

  const id = crypto.randomUUID();
  const password = body.password || generatePassword();
  const expiresAt = body.expiresInHours
    ? new Date(Date.now() + body.expiresInHours * 3600000).toISOString()
    : null;
  const fileName = body.fileName || body.fileKey.split('/').pop() || body.fileKey;

  await env.DB!.prepare(
    'INSERT INTO shares (id, file_key, file_name, password, expires_at, storage_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, body.fileKey, fileName, password, expiresAt, storageId).run();

  return json({ id, url: '/s/' + id, fileName, password, expiresAt }, 201);
}

export async function handleListShares(env: Env, request: Request): Promise<Response> {
  await env.DB!.prepare("DELETE FROM shares WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')").run();

  const url = new URL(request.url);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
  const offset = (page - 1) * pageSize;

  const totalResult = await env.DB!.prepare('SELECT COUNT(*) as count FROM shares').first<{ count: number }>();
  const total = totalResult?.count || 0;

  const result = await env.DB!.prepare(
    'SELECT id, file_key, file_name, password, expires_at, created_at, access_count FROM shares ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(pageSize, offset).all();

  return json({ items: result.results, total, page, pageSize });
}

export async function handleDeleteShare(env: Env, shareId: string): Promise<Response> {
  await env.DB!.prepare('DELETE FROM shares WHERE id = ?').bind(shareId).run();
  return json({ ok: true });
}

export async function handleBatchDeleteShares(request: Request, env: Env): Promise<Response> {
  let body: { ids?: string[]; delete_all?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.delete_all) {
    await env.DB!.prepare('DELETE FROM shares').run();
    return json({ ok: true });
  }

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return json({ error: 'Missing or empty ids array' }, 400);
  }

  const stmt = env.DB!.prepare('DELETE FROM shares WHERE id = ?');
  await env.DB!.batch(body.ids.map(id => stmt.bind(id)));

  return json({ ok: true, count: body.ids.length });
}
