import { generatePresignedUrl, signRequest, rfc3986 } from './s3-auth';
import { json, escHtml, safeJsString, parseListXml } from './utils';
import { checkRateLimit, recordAuthFailure, recordAuthSuccess } from './rate-limit';
import type { Env } from './index';
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

// Mirrors pages/public/app.js TEXT_EXTS — keep in sync
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
// HTML templates — single-file share pages
// =============================================================================

const BASE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title data-i18n="我的网盘 - 分享">我的网盘 - 分享</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%234285f4'/><stop offset='1' stop-color='%231a73e8'/></linearGradient></defs><ellipse cx='38' cy='52' rx='28' ry='22' fill='url(%23g)'/><ellipse cx='62' cy='42' rx='28' ry='28' fill='url(%23g)'/><ellipse cx='50' cy='34' rx='26' ry='24' fill='url(%23g)'/></svg>">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/preview.css">
<style>
  body {
    background: linear-gradient(135deg, #0f1729 0%, #1a2744 30%, #1e3a5f 60%, #1a2744 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  .card {
    position: relative; text-align: center; padding: 48px 40px; background: #fff;
    border-radius: 20px; border: 1px solid rgba(0,0,0,.08);
    box-shadow: 0 20px 60px rgba(0,0,0,.2); max-width: 420px; width: 90%;
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
</style>
</head>
<body>
<button class="btn-lang btn-lang-fixed" title="Switch to English"><svg class="lang-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="#1677FF" d="M310.656 64h-64.64l0.128 91.008H64v292.224h182.144l-0.064 136.64h64.576V447.296H492.8V154.88l-182.08 0.064V64zM246.144 219.52v163.2H128.512V219.52h117.632z m182.08 0v163.2H310.656V219.52h117.568z"/><path fill="#8C8C8C" d="M770.24 492.224h-73.024L507.52 959.744h69.376l51.392-121.408 3.328-8.32h204.16l3.328 8.32 51.264 121.408H960L770.24 492.16z m-36.48 82.432l12.288 30.784 56.704 141.824 7.232 18.176H657.28l7.296-18.176 56.832-141.824 12.352-30.72z"/><path fill="#8C8C8C" d="M174.08 733.76l-0.064-77.824H109.44v77.824a168.832 168.832 0 0 0 157.76 168.512l11.072 0.32h123.328v-64.576H277.952l-7.36-0.192a104.384 104.384 0 0 1-96.512-104.064z m436.288-559.68h123.392c57.6 0 104.32 46.72 104.32 104.32v77.824h64.448l0.064-77.824a168.832 168.832 0 0 0-157.76-168.448l-11.072-0.384H610.368V174.08z"/></svg></button>
<div class="card">
  __EXPIRED_BLOCK__
  <div class="file-icon">__FILE_ICON__</div>
  <h1 data-i18n="分享文件">分享文件</h1>
  <p class="filename">__FILE_NAME__</p>
  <form method="get" action="" style="display:__FORM_DISPLAY__;">
    <input type="password" name="p" data-i18n="请输入分享密码" placeholder="请输入分享密码" autofocus autocomplete="off">
    <button type="submit" data-i18n="查看文件">查看文件</button>
  </form>
  <div class="actions">
    __ACTION_BUTTONS__
  </div>
  <div class="error" data-i18n="__ERROR_KEY__">__ERROR_MSG__</div>
  <div class="notice">__NOTICE_TEXT__</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js"></script>
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
<script src="/i18n.js"></script>
<script src="/share.js"></script>
__INIT_SCRIPT__
</body>
</html>`;

// Mirrors pages/public/app.js getFileIcon — keep in sync
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

function sharePageHtml(fileName: string, errorMsg: string, expired: boolean, formDisabled: boolean = false): string {
  if (expired) {
    return BASE_HTML
      .replace('__EXPIRED_BLOCK__', '<div class="expired"><div class="icon">⏰</div><p data-i18n="此分享链接已过期">此分享链接已过期</p></div>')
      .replace('__FILE_ICON__', '')
      .replace('__FILE_NAME__', '')
      .replace('__FORM_DISPLAY__', 'none')
      .replace('__ACTIONS_DISPLAY__', 'none')
      .replace('__ACTION_BUTTONS__', '')
      .replace('__ERROR_DISPLAY__', 'none')
      .replace('__ERROR_KEY__', '')
      .replace('__ERROR_MSG__', '')
      .replace('__NOTICE_DISPLAY__', 'none')
      .replace('__NOTICE_TEXT__', '')
      .replace('__INIT_SCRIPT__', '');
  }
  // When the error is unrecoverable (e.g. file deleted, share not found), disable the
  // password form — entering a password is pointless and re-submitting just re-triggers
  // the same failure.
  const formDisplay = formDisabled ? 'none' : 'block';
  return BASE_HTML
    .replace('__EXPIRED_BLOCK__', '')
    .replace('__FILE_ICON__', getFileIcon(fileName))
    .replace('__FILE_NAME__', escHtml(fileName))
    .replace('__FORM_DISPLAY__', formDisplay)
    .replace('__ACTIONS_DISPLAY__', 'none')
    .replace('__ACTION_BUTTONS__', '')
    .replace('__ERROR_DISPLAY__', errorMsg ? 'block' : 'none')
    .replace('__ERROR_KEY__', escHtml(errorMsg))
    .replace('__ERROR_MSG__', escHtml(errorMsg))
    .replace('__NOTICE_DISPLAY__', 'none')
    .replace('__NOTICE_TEXT__', '')
    .replace('__INIT_SCRIPT__', '');
}

function accessPageHtml(
  fileKey: string, fileName: string, shareToken: string,
  previewable: boolean, isText: boolean,
): string {
  const fileKeyJs = safeJsString(fileKey);
  let buttons = '';
  let initJs = `SharePreview.init({shareToken:${safeJsString(shareToken)}});`;
  if (previewable) {
    buttons += `<button class="btn-preview" id="btn-preview-action" data-i18n="预览">预览</button>`;
    initJs += `document.getElementById('btn-preview-action').addEventListener('click',function(){SharePreview.preview(${fileKeyJs});});`;
  }
  buttons += `<button class="btn-download" id="btn-download-action" data-i18n="下载">下载</button>`;
  initJs += `document.getElementById('btn-download-action').addEventListener('click',function(){SharePreview.download(${fileKeyJs});});`;

  return BASE_HTML
    .replace('__EXPIRED_BLOCK__', '')
    .replace('__FILE_ICON__', getFileIcon(fileName))
    .replace('__FILE_NAME__', escHtml(fileName))
    .replace('__FORM_DISPLAY__', 'none')
    .replace('__ACTIONS_DISPLAY__', 'flex')
    .replace('__ACTION_BUTTONS__', buttons)
    .replace('__ERROR_DISPLAY__', 'none')
    .replace('__ERROR_MSG__', '')
    .replace('__NOTICE_DISPLAY__', 'block')
    .replace('__NOTICE_TEXT__', '')
    .replace('__INIT_SCRIPT__', `<script>${initJs}<\/script>`);
}

// =============================================================================
// Folder share page — reuses app.js by providing the exact same DOM structure
// =============================================================================

function folderSharePageHtml(
  folderName: string, shareToken: string, basePrefix: string,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title data-i18n="我的网盘">我的网盘</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%234285f4'/><stop offset='1' stop-color='%231a73e8'/></linearGradient></defs><ellipse cx='38' cy='52' rx='28' ry='22' fill='url(%23g)'/><ellipse cx='62' cy='42' rx='28' ry='28' fill='url(%23g)'/><ellipse cx='50' cy='34' rx='26' ry='24' fill='url(%23g)'/></svg>">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/preview.css">
<style>
  .share-hide{display:none!important}
  .share-header-left{display:flex;align-items:center;gap:12px}
  .share-header-left .share-badge{background:linear-gradient(135deg,#4d9fff,#0066ff);color:#fff;font-size:11px;padding:2px 10px;border-radius:10px;font-weight:500}
</style>
</head>
<body>

<div id="login-overlay" style="display:none">
  <button class="btn-lang btn-lang-fixed" id="lang-btn-login" title="Switch to English"><svg class="lang-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="#1677FF" d="M310.656 64h-64.64l0.128 91.008H64v292.224h182.144l-0.064 136.64h64.576V447.296H492.8V154.88l-182.08 0.064V64zM246.144 219.52v163.2H128.512V219.52h117.632z m182.08 0v163.2H310.656V219.52h117.568z"/><path fill="#8C8C8C" d="M770.24 492.224h-73.024L507.52 959.744h69.376l51.392-121.408 3.328-8.32h204.16l3.328 8.32 51.264 121.408H960L770.24 492.16z m-36.48 82.432l12.288 30.784 56.704 141.824 7.232 18.176H657.28l7.296-18.176 56.832-141.824 12.352-30.72z"/><path fill="#8C8C8C" d="M174.08 733.76l-0.064-77.824H109.44v77.824a168.832 168.832 0 0 0 157.76 168.512l11.072 0.32h123.328v-64.576H277.952l-7.36-0.192a104.384 104.384 0 0 1-96.512-104.064z m436.288-559.68h123.392c57.6 0 104.32 46.72 104.32 104.32v77.824h64.448l0.064-77.824a168.832 168.832 0 0 0-157.76-168.448l-11.072-0.384H610.368V174.08z"/></svg></button>
  <div class="login-box" id="login-box">
    <h1 data-i18n="我的网盘">我的网盘</h1>
    <div id="login-loading" data-i18n="加载中...">加载中...</div>
    <div id="login-form" style="display:none">
      <p data-i18n="请输入访问密码">请输入访问密码</p>
      <input type="password" id="password-input" data-i18n="密码" placeholder="密码" autofocus autocomplete="off">
      <button type="button" id="login-btn" data-i18n="进入">进入</button>
      <div class="login-error" id="login-error" data-i18n="密码错误，请重试">密码错误，请重试</div>
    </div>
  </div>
</div>

<div class="progress-bar" id="progress-bar"></div>

<div class="drag-overlay" id="drag-overlay">
  <div class="drag-overlay-content" data-i18n="📁 释放上传">📁 释放上传</div>
</div>

<header>
  <div class="share-header-left">
    <h1 data-i18n="我的网盘">我的网盘</h1>
    <span class="share-badge">分享</span>
  </div>
  <div class="header-right">
    <button class="btn-logout" id="logout-btn" title="退出登录" data-i18n="退出" style="display:none">退出</button>
    <button class="btn-lang" id="lang-btn" title="Switch to English"><svg class="lang-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="#1677FF" d="M310.656 64h-64.64l0.128 91.008H64v292.224h182.144l-0.064 136.64h64.576V447.296H492.8V154.88l-182.08 0.064V64zM246.144 219.52v163.2H128.512V219.52h117.632z m182.08 0v163.2H310.656V219.52h117.568z"/><path fill="#8C8C8C" d="M770.24 492.224h-73.024L507.52 959.744h69.376l51.392-121.408 3.328-8.32h204.16l3.328 8.32 51.264 121.408H960L770.24 492.16z m-36.48 82.432l12.288 30.784 56.704 141.824 7.232 18.176H657.28l7.296-18.176 56.832-141.824 12.352-30.72z"/><path fill="#8C8C8C" d="M174.08 733.76l-0.064-77.824H109.44v77.824a168.832 168.832 0 0 0 157.76 168.512l11.072 0.32h123.328v-64.576H277.952l-7.36-0.192a104.384 104.384 0 0 1-96.512-104.064z m436.288-559.68h123.392c57.6 0 104.32 46.72 104.32 104.32v77.824h64.448l0.064-77.824a168.832 168.832 0 0 0-157.76-168.448l-11.072-0.384H610.368V174.08z"/></svg></button>
  </div>
</header>

<input type="file" id="file-input" multiple style="display:none">

<div class="toolbar">
  <button class="btn btn-upload share-hide" id="upload-btn" data-i18n="上传">上传</button>
  <button class="btn btn-primary share-hide" id="new-folder-btn" data-i18n="新建文件夹">新建文件夹</button>
  <button class="btn btn-refresh share-hide" id="refresh-btn" data-i18n="刷新">刷新</button>
  <button class="btn btn-shares share-hide" id="manage-shares-btn" data-i18n="管理分享">管理分享</button>
  <input type="text" class="search-input share-hide" id="search-input" data-i18n="搜索文件..." placeholder="搜索文件...">
  <span class="spacer"></span>
  <span class="count" id="file-count"></span>
  <span class="batch-info" id="batch-info">
    <span id="selected-text">已选 <span id="selected-count">0</span> 个</span>
    <button class="btn batch-dl" id="batch-download-btn" data-i18n="批量下载">批量下载</button>
    <button class="btn batch-del share-hide" id="batch-delete-btn" data-i18n="批量删除">批量删除</button>
    <button class="btn btn-clear" id="clear-select-btn" data-i18n="清空选择">清空选择</button>
  </span>
</div>

<div class="breadcrumb" id="breadcrumb">
  <span class="breadcrumb-item" data-prefix="" data-i18n="根目录">根目录</span>
</div>

<div class="file-list">
  <table id="file-table">
    <thead>
      <tr>
        <th><input type="checkbox" id="select-all" title="全选" data-i18n="全选"></th>
        <th data-sort="name" class="sorted" data-dir="asc" data-i18n="文件名">文件名</th>
        <th data-sort="size" data-i18n="大小">大小</th>
        <th data-sort="date" data-i18n="修改时间">修改时间</th>
        <th data-i18n="操作">操作</th>
      </tr>
    </thead>
    <tbody id="file-tbody"></tbody>
  </table>
  <div class="skeleton" id="skeleton-loading">
    <div class="sk-row"><div class="sk-bar w50"></div><div class="sk-bar w30"></div><div class="sk-bar w20"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w60"></div><div class="sk-bar w25"></div><div class="sk-bar w10"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w40"></div><div class="sk-bar w35"></div><div class="sk-bar w15"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w55"></div><div class="sk-bar w20"></div><div class="sk-bar w25"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w45"></div><div class="sk-bar w30"></div><div class="sk-bar w10"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w65"></div><div class="sk-bar w15"></div><div class="sk-bar w20"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w35"></div><div class="sk-bar w40"></div><div class="sk-bar w10"></div><div class="sk-bar w15"></div></div>
    <div class="sk-row"><div class="sk-bar w70"></div><div class="sk-bar w10"></div><div class="sk-bar w20"></div><div class="sk-bar w15"></div></div>
  </div>
  <div class="empty" id="empty-state" style="display:none">
    <div class="icon">📭</div>
    <p id="empty-text" data-i18n="存储桶中没有文件">存储桶中没有文件</p>
  </div>
</div>

<div class="preview-overlay" id="preview-overlay">
  <div class="preview-container">
    <div class="preview-header">
      <span class="preview-title" id="preview-title"></span>
      <div class="preview-header-right">
        <span class="preview-charset-group" id="preview-charset-group">
          <span data-i18n="编码">编码</span>
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
    </div>
    <div class="preview-body">
      <div class="preview-loading" id="preview-loading"></div>
      <iframe id="preview-iframe" allow="fullscreen; autoplay" sandbox="allow-scripts allow-same-origin" style="display:none"></iframe>
      <div id="preview-pdf" class="preview-pdf-container" style="display:none"></div>
      <div id="preview-office" class="preview-office-container" style="display:none"></div>
    </div>
  </div>
</div>

<div class="context-menu" id="context-menu">
  <div class="context-item" data-action="download" data-i18n="下载">下载</div>
  <div class="context-item" data-action="preview" data-i18n="预览">预览</div>
</div>

<div class="storage-select share-hide" id="storage-select">
  <span class="storage-select-trigger" id="storage-select-trigger">
    <span id="storage-select-label"></span>
    <span class="storage-select-arrow"></span>
  </span>
  <div class="storage-select-dropdown" id="storage-select-dropdown"></div>
</div>
<div class="usage share-hide" id="usage">
  <div class="usage-bar-wrap"><div class="usage-bar-fill" id="usage-bar-fill"></div></div>
  <span class="usage-text" id="usage-text"></span>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js"></script>
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/column-resizer@1.4.0/dist/column-resizer.min.js"></script>
<script>window.ColumnResizer||document.write('<script src="/column-resizer.js"><\\/script>')</script>
<script src="/i18n.js"></script>
<script src="/share.js"></script>
<script>
window.SHARE_CONFIG={shareToken:${safeJsString(shareToken)},basePrefix:${safeJsString(basePrefix)},folderName:${safeJsString(folderName)}};
window.SHARE_FOLDER_CONFIG=window.SHARE_CONFIG;
SharePreview.init({shareToken:window.SHARE_CONFIG.shareToken});
<\/script>
<script src="/app.js"></script>
</body>
</html>`;
}

// =============================================================================
// Share session tokens — same pattern as main auth: password → token → API calls
// =============================================================================

export async function createShareSession(env: Env, shareId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.DB!.prepare('INSERT INTO share_sessions (token, share_id) VALUES (?, ?)').bind(token, shareId).run();
  // Clean up sessions older than 7 days
  await env.DB!.prepare("DELETE FROM share_sessions WHERE created_at < datetime('now', '-7 days')").run();
  return token;
}

export async function validateShareToken(env: Env, token: string): Promise<{
  file_key: string; password: string; expires_at: string | null; storage_id: string;
} | null> {
  const session = await env.DB!.prepare('SELECT share_id FROM share_sessions WHERE token = ?').bind(token).first<{ share_id: string }>();
  if (!session) return null;

  const row = await env.DB!.prepare('SELECT file_key, password, expires_at, storage_id FROM shares WHERE id = ?').bind(session.share_id).first<{
    file_key: string; password: string; expires_at: string | null; storage_id: string;
  }>();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row;
}

// =============================================================================
// Handlers
// =============================================================================

export async function handleShareDownloadUrl(env: Env, key: string, shareToken: string, request: Request): Promise<Response> {
  const row = await validateShareToken(env, shareToken);
  if (!row) return json({ error: 'Unauthorized' }, 401);

  if (env.KV_BINDING) {
    const rate = await checkRateLimit(env.KV_BINDING, request);
    if (!rate.allowed) {
      return json({ error: rate.error }, 429, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {});
    }
    if (rate.delayMs > 0) {
      await new Promise(r => setTimeout(r, rate.delayMs));
    }
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return json({ error: 'Share expired' }, 410);
  }

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
    return new Response(sharePageHtml('', '分享链接不存在', false, true), {
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

      const shareToken = await createShareSession(env, shareId);
      const s = getStorage(env, row.storage_id);

      if (row.file_key.endsWith('/')) {
        return new Response(
          folderSharePageHtml(row.file_name, shareToken, row.file_key),
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }

      // Verify S3 object exists before showing share page.
      // Only treat HTTP 404 as truly "not found" — 403 (clock-skewed signature),
      // 5xx (transient server error), etc. should not block access; the download
      // or preview will fail naturally if the file is genuinely missing.
      try {
        const headSigned = await signRequest('HEAD', s.bucket, row.file_key, s.region, s.accessKeyId, s.secretAccessKey, s.endpoint);
        const headResp = await fetch(`${s.endpoint}/${s.bucket}/${rfc3986(row.file_key).replace(/%2F/g, '/')}`, { method: 'HEAD', headers: headSigned });
        if (!headResp.ok) {
          console.warn('[my-pan] handleShareAccess: S3 HEAD returned', headResp.status, 'for share', shareId, row.file_key);
          if (headResp.status === 404) {
            return new Response(sharePageHtml(row.file_name, '分享文件不存在或已被删除', false, true), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          // Non-404 errors (403, 500, 503, etc.) are transient — log and proceed.
          // If the file is truly gone, download/preview will fail on the next request.
        }
      } catch (headErr) {
        console.warn('[my-pan] handleShareAccess: S3 HEAD failed', shareId, row.file_key, headErr);
        // Network-level errors are also transient — proceed.
      }

      const previewable = isPreviewable(row.file_key);
      const text = isTextFile(row.file_key);

      return new Response(
        accessPageHtml(row.file_key, row.file_name, shareToken, previewable, text),
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

export async function handleSharePreviewUrl(
  env: Env, key: string, shareToken: string, charset: string | undefined, request: Request,
): Promise<Response> {
  const row = await validateShareToken(env, shareToken);
  if (!row) return json({ error: 'Unauthorized' }, 401);
  const isFolder = row.file_key.endsWith('/');
  if (isFolder ? !key.startsWith(row.file_key) : key !== row.file_key) {
    return json({ error: 'Not Found' }, 404);
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

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return json({ error: 'Share expired' }, 410);
  }

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

export async function handleShareListFiles(
  env: Env, prefix: string, shareToken: string, request: Request,
): Promise<Response> {
  const row = await validateShareToken(env, shareToken);
  if (!row) return json({ error: 'Unauthorized' }, 401);

  if (env.KV_BINDING) {
    const rate = await checkRateLimit(env.KV_BINDING, request);
    if (!rate.allowed) {
      return json({ error: rate.error }, 429, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {});
    }
    if (rate.delayMs > 0) {
      await new Promise(r => setTimeout(r, rate.delayMs));
    }
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return json({ error: 'Share expired' }, 410);
  }

  if (!prefix.startsWith(row.file_key)) {
    return json({ error: 'Not Found' }, 404);
  }

  const s = getStorage(env, row.storage_id);
  const allFiles: Array<{ key: string; size: number; lastModified: string }> = [];
  let marker: string | undefined;

  // Flat listing: no delimiter, return all files under the shared prefix at once.
  // The frontend caches the full list and filters client-side, same as the main page.
  for (let page = 0; page < 20; page++) {
    const qs = [`prefix=${rfc3986(row.file_key)}`];
    if (marker) qs.push(`marker=${encodeURIComponent(marker)}`);
    const queryString = qs.join('&');
    const signed = await signRequest('GET', s.bucket, '', s.region, s.accessKeyId, s.secretAccessKey, s.endpoint, undefined, undefined, undefined, queryString);
    const resp = await fetch(`${s.endpoint}/${s.bucket}/?${queryString}`, { headers: signed });
    if (!resp.ok) {
      console.warn('[my-pan] handleShareListFiles: S3 list error', resp.status);
      break;
    }
    const result = parseListXml(await resp.text());
    for (const f of result.files) {
      allFiles.push({ key: f.key, size: f.size, lastModified: f.lastModified });
    }
    if (!result.isTruncated || !result.nextMarker) break;
    marker = result.nextMarker;
  }

  return json(allFiles);
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

  try {
    await env.DB!.prepare(
      'INSERT INTO shares (id, file_key, file_name, password, expires_at, storage_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, body.fileKey, fileName, password, expiresAt, storageId).run();
  } catch (err) {
    console.error('[my-pan] handleCreateShare: D1 error', err);
    return json({ error: 'Failed to create share: ' + (err instanceof Error ? err.message : String(err)) }, 500);
  }

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
  await env.DB!.prepare('DELETE FROM share_sessions WHERE share_id = ?').bind(shareId).run();
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
    await env.DB!.prepare('DELETE FROM share_sessions').run();
    return json({ ok: true });
  }

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return json({ error: 'Missing or empty ids array' }, 400);
  }

  const stmt = env.DB!.prepare('DELETE FROM shares WHERE id = ?');
  const sessStmt = env.DB!.prepare('DELETE FROM share_sessions WHERE share_id = ?');
  await env.DB!.batch([
    ...body.ids.map(id => stmt.bind(id)),
    ...body.ids.map(id => sessStmt.bind(id)),
  ]);

  return json({ ok: true, count: body.ids.length });
}
