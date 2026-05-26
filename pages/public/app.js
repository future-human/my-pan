// ===== State =====
let password = '';
let files = [];
let selectedKeys = new Set();
let selectedFolders = new Set();
let sortBy = 'name';
let sortAsc = true;
let currentPrefix = '';
let searchQuery = '';
let apiBase = document.currentScript?.dataset.apiBase || '';
let sharingEnabled = false;
let fileTableResizer = null;
let storages = [];
let currentStorage = (() => { try { return localStorage.getItem('my-pan_storage'); } catch { return null; } })();

// Helper: add ?storage= param for file API calls (shares CRUD calls use apiBase directly)
function fileApi(path) {
  if (!currentStorage) return apiBase + path;
  const sep = path.includes('?') ? '&' : '?';
  return apiBase + path + sep + 'storage=' + encodeURIComponent(currentStorage);
}

// ===== Init =====
async function init() {
  // 先尝试已保存的密码
  const savedPw = getCookie('my-pan_pw');
  if (savedPw) {
    password = savedPw;
    const ok = await tryAuth();
    if (ok) {
      console.log('[my-pan] 已保存密码有效，直接进入');
      hideLogin();
      await loadStorages();
      checkSharing();
      loadFiles();
      return;
    }
    console.log('[my-pan] 已保存密码失效');
    setCookie('my-pan_pw', '', -1);
    password = '';
  }

  // 已保存密码失效或无保存密码 → 尝试空密码（服务端未配置密码时直接进入）
  const ok = await tryAuth();
  if (ok) {
    console.log('[my-pan] 无密码模式，直接进入');
    document.getElementById('logout-btn').style.display = 'none';
    hideLogin();
    await loadStorages();
    checkSharing();
    loadFiles();
    toast('当前未设置访问密码，建议配置 AUTH_PASSWORD 以保护数据安全', 'warning', 5000);
    return;
  }

  showLogin();
  document.getElementById('password-input').value = '';
}

async function loadStorages() {
  try {
    const resp = await fetch(apiBase + '/api/storages', {
      headers: { 'X-Auth-Password': password },
    });
    if (resp.ok) {
      storages = await resp.json();
      if (!storages.length) storages = [{ id: 'default', name: 'Default' }];
    }
  } catch {
    storages = [{ id: 'default', name: 'Default' }];
  }

  // Validate saved storage id
  if (currentStorage && !storages.find(s => s.id === currentStorage)) {
    currentStorage = null;
  }
  if (!currentStorage) {
    currentStorage = storages[0].id;
  }

  const container = document.getElementById('storage-select');
  const label = document.getElementById('storage-select-label');
  const dropdown = document.getElementById('storage-select-dropdown');

  // 仅多存储时显示选择器
  container.style.display = storages.length > 1 ? '' : 'none';

  // 渲染当前选中标签 + 下拉选项
  const renderSelect = () => {
    const cur = storages.find(s => s.id === currentStorage) || storages[0];
    label.textContent = cur ? cur.name : '';
    dropdown.innerHTML = storages.map(s =>
      `<button class="storage-option${s.id === currentStorage ? ' active' : ''}" data-id="${escAttr(s.id)}">${esc(s.name)}</button>`
    ).join('');
  };
  renderSelect();

  // 切换存储逻辑（复用）
  const switchStorage = async (id) => {
    if (id === currentStorage) return;
    currentStorage = id;
    try { localStorage.setItem('my-pan_storage', currentStorage); } catch { /* ignore */ }
    selectedKeys.clear(); selectedFolders.clear(); currentPrefix = ''; searchQuery = '';
    document.getElementById('search-input').value = '';
    files = [];
    renderFiles();
    document.getElementById('usage-text').textContent = '加载中...';
    document.getElementById('usage-bar-fill').style.width = '0%';
    renderSelect();
    container.classList.remove('open');
    await loadFiles();
  };

  // 事件监听仅绑定一次，避免 logout 后重新 login 时重复绑定
  if (!loadStorages._bound) {
    loadStorages._bound = true;
    document.getElementById('storage-select-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.toggle('open');
    });
    dropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('.storage-option');
      if (!btn) return;
      switchStorage(btn.dataset.id);
    });
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) container.classList.remove('open');
    });
  }
}

async function checkSharing() {
  try {
    const resp = await fetch(apiBase + '/api/shares/status', {
      headers: { 'X-Auth-Password': password },
    });
    if (resp.ok) {
      const data = await resp.json();
      sharingEnabled = data.available;
      console.log('[my-pan] 分享功能:', sharingEnabled ? '可用' : '未配置');
    }
  } catch {
    sharingEnabled = false;
  }
  // 控制工具栏按钮显隐
  document.getElementById('manage-shares-btn').style.display = sharingEnabled ? '' : 'none';
}

async function tryAuth() {
  const resp = await fetch(fileApi('/api/files'), {
    headers: { 'X-Auth-Password': password },
  });
  return resp.status !== 401;
}

function showLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
}

function hideLogin() {
  document.getElementById('login-overlay').style.display = 'none';
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  const input = document.getElementById('password-input');
  const errEl = document.getElementById('login-error');
  password = input.value;
  if (!password) { input.classList.add('shake'); input.focus(); return; }

  // 进入加载状态
  btn.disabled = true;
  btn.textContent = '验证中...';
  errEl.style.display = 'none';
  input.classList.remove('shake');

  let ok;
  try {
    ok = await tryAuth();
  } catch (err) {
    console.error('[my-pan] 登录: 网络错误', err);
    errEl.textContent = '网络错误，请检查连接';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '进入';
    return;
  }
  if (ok) {
    document.getElementById('logout-btn').style.display = '';
    hideLogin();
    setCookie('my-pan_pw', password, 30);
    await loadStorages();
    checkSharing();
    loadFiles();
  } else {
    errEl.textContent = '密码错误，请重试';
    errEl.style.display = 'block';
    input.classList.add('shake');
    input.focus();
    btn.disabled = false;
    btn.textContent = '进入';
  }
});

// 输入时清除错误状态
document.getElementById('password-input').addEventListener('input', () => {
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('password-input').classList.remove('shake');
});

document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('login-btn').click();
  }
});

// ===== File operations =====
async function loadFiles() {
  // 有容量配置的存储显示加载状态
  const cur = storages.find(s => s.id === currentStorage);
  if (cur?.capacity) {
    document.getElementById('usage').style.display = '';
    document.getElementById('usage-text').textContent = '加载中...';
    document.getElementById('usage-bar-fill').style.width = '0%';
  }
  try {
    const resp = await fetch(fileApi('/api/files'), {
      headers: { 'X-Auth-Password': password },
    });
    if (resp.status === 401) { showLogin(); return false; }
    if (!resp.ok) throw new Error('API error: ' + resp.status);
    files = await resp.json();
    const fileKeys = new Set(files.map(f => f.key));
    for (const k of selectedKeys) { if (!fileKeys.has(k)) selectedKeys.delete(k); }
    for (const k of selectedFolders) { if (!files.some(f => f.key.startsWith(k))) selectedFolders.delete(k); }
    console.log('[my-pan] 加载到', countFiles(files), '个文件 (共', files.length, '个对象)');
    renderFiles();
    return true;
  } catch (err) {
    console.error('[my-pan] loadFiles: 加载失败', err);
    const ut = document.getElementById('usage-text');
    ut.textContent = '加载失败';
    ut.classList.add('error');
    document.getElementById('usage').style.display = '';
    document.getElementById('usage-bar-fill').style.width = '0%';
    toast('加载文件列表失败: ' + err.message, 'error');
    return false;
  }
}

function renderFiles() {
  const tbody = document.getElementById('file-tbody');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('file-count');

  updateBreadcrumb();

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const curStorage = storages.find(s => s.id === currentStorage);
  const capacity = curStorage?.capacity;
  const usageEl = document.getElementById('usage');
  const barFill = document.getElementById('usage-bar-fill');

  if (capacity) {
    usageEl.style.display = '';
    const freeSize = Math.max(0, capacity - totalSize);
    const pct = totalSize / capacity * 100;
    const unit = curStorage?.capacityUnit;
    document.getElementById('usage-text').textContent = unit
      ? `${formatSizeFixed(freeSize, unit)} 可用，共 ${formatSizeFixed(capacity, unit)}`
      : `${formatSize(freeSize)} 可用，共 ${formatSize(capacity)}`;
    document.getElementById('usage-text').classList.remove('error');
    barFill.style.width = pct.toFixed(1) + '%';
    barFill.className = 'usage-bar-fill' + (pct > 90 ? ' danger' : pct > 80 ? ' warn' : '');
  } else {
    usageEl.style.display = 'none';
  }

  // Search mode: flat list of matching files
  if (searchQuery) {
    const matched = files.filter(f => !f.key.endsWith('/') && f.key.startsWith(currentPrefix) && f.key.toLowerCase().includes(searchQuery));
    countEl.textContent = `搜索 "${searchQuery}" — ${matched.length} 个文件`;
    if (matched.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      document.getElementById('empty-text').textContent = '没有匹配的文件';
      selectedKeys.clear(); selectedFolders.clear();
      updateBatchToolbar();
      return;
    }
    empty.style.display = 'none';
    let html = '';
    for (const f of matched) {
      html += `
    <tr>
      <td><input type="checkbox" class="file-checkbox" data-key="${escAttr(f.key)}"></td>
      <td class="file-name" title="${esc(f.key)}"><span class="file-icon">${getFileIcon(f.key)}</span> ${highlightText(f.key, searchQuery)}</td>
      <td class="file-size">${formatSize(f.size)}</td>
      <td class="file-date">${formatDate(f.lastModified)}</td>
      <td class="actions">
        <button class="download" data-key="${escAttr(f.key)}">下载</button>
        <button class="rename" data-key="${escAttr(f.key)}">重命名</button>
        <button class="delete" data-key="${escAttr(f.key)}">删除</button>
        ${sharingEnabled ? `<button class="share" data-key="${escAttr(f.key)}">分享</button>` : ''}
        <button class="preview${isPreviewable(f.key) ? '' : ' btn-hidden'}" data-key="${escAttr(f.key)}">预览</button>
      </td>
    </tr>`;
    }
    tbody.innerHTML = html;
    bindFileRowEvents();
    setupColumnResize();
    return;
  }

  const { folders, files: directFiles } = parseEntries();

  // 构建文件夹数据（预先计算统计值用于排序和渲染）
  const folderData = folders.map(folder => {
    const prefix = currentPrefix + folder + '/';
    const items = files.filter(f => f.key.startsWith(prefix));
    const totalSize = items.reduce((s, f) => s + f.size, 0);
    const latestDate = items.length > 0
        ? items.reduce((max, f) => f.lastModified > max ? f.lastModified : max, items[0].lastModified)
        : '';
    return { folder, prefix, items, totalSize, latestDate };
  });

  // 文件夹按当前排序列排序
  folderData.sort((a, b) => {
    let va, vb;
    if (sortBy === 'size') { va = a.totalSize; vb = b.totalSize; }
    else if (sortBy === 'date') { va = a.latestDate || ''; vb = b.latestDate || ''; }
    else { va = a.folder.toLowerCase(); vb = b.folder.toLowerCase(); }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  const totalEntries = folderData.length + directFiles.length;
  countEl.textContent = `共 ${totalEntries} 项`;

  empty.style.display = 'none';

  // Parent directory link
  let html = '';

  if (totalEntries === 0 && !currentPrefix) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('empty-text').textContent = '存储桶中没有文件';
    selectedKeys.clear(); selectedFolders.clear();
    updateBatchToolbar();
    setupColumnResize();
    return;
  }
  if (currentPrefix) {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length > 0 ? parts.join('/') + '/' : '';
    html += `
    <tr class="folder-row" data-prefix="${escAttr(parent)}">
      <td></td>
      <td class="folder-name"><span class="file-icon">📂</span> ..</td>
      <td class="file-size"></td>
      <td class="file-date"></td>
      <td class="actions">
        <button class="download btn-hidden" tabindex="-1">下载</button>
        <button class="rename btn-hidden" tabindex="-1">重命名</button>
        <button class="delete btn-hidden" tabindex="-1">删除</button>
        ${sharingEnabled ? '<button class="share btn-hidden" tabindex="-1">分享</button>' : ''}
        <button class="preview btn-hidden" tabindex="-1">预览</button>
      </td>
    </tr>`;
  }

  // Folders
  for (const fd of folderData) {
    html += `
    <tr class="folder-row" data-folder="${escAttr(fd.folder)}" data-prefix="${escAttr(fd.prefix)}">
      <td><input type="checkbox" class="folder-checkbox" data-prefix="${escAttr(fd.prefix)}"></td>
      <td><span class="file-icon">📁</span> <span class="folder-name" data-prefix="${escAttr(fd.prefix)}">${esc(fd.folder)}</span></td>
      <td class="file-size">${formatSize(fd.totalSize)}</td>
      <td class="file-date">${fd.latestDate ? formatDate(fd.latestDate) : '—'}</td>
      <td class="actions">
        <button class="download" data-prefix="${escAttr(fd.prefix)}">下载</button>
        <button class="rename" data-prefix="${escAttr(fd.prefix)}">重命名</button>
        <button class="delete" data-prefix="${escAttr(fd.prefix)}">删除</button>
        ${sharingEnabled ? `<button class="share" data-prefix="${escAttr(fd.prefix)}">分享</button>` : ''}
        <button class="preview btn-hidden" tabindex="-1">预览</button>
      </td>
    </tr>`;
  }

  // Files — sort by current criteria, display short key, full key for operations
  const sorted = [...directFiles].sort((a, b) => {
    let va, vb;
    if (sortBy === 'size') { va = a.size; vb = b.size; }
    else if (sortBy === 'date') { va = new Date(a.lastModified).getTime(); vb = new Date(b.lastModified).getTime(); }
    else { va = (a.key || '').toLowerCase(); vb = (b.key || '').toLowerCase(); }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  for (const f of sorted) {
    const fullKey = currentPrefix + f.key;
    html += `
    <tr>
      <td><input type="checkbox" class="file-checkbox" data-key="${escAttr(fullKey)}"></td>
      <td class="file-name" title="${esc(fullKey)}"><span class="file-icon">${getFileIcon(fullKey)}</span> ${esc(f.key)}</td>
      <td class="file-size">${formatSize(f.size)}</td>
      <td class="file-date">${formatDate(f.lastModified)}</td>
      <td class="actions">
        <button class="download" data-key="${escAttr(fullKey)}">下载</button>
        <button class="rename" data-key="${escAttr(fullKey)}">重命名</button>
        <button class="delete" data-key="${escAttr(fullKey)}">删除</button>
        ${sharingEnabled ? `<button class="share" data-key="${escAttr(fullKey)}">分享</button>` : ''}
        <button class="preview${isPreviewable(fullKey) ? '' : ' btn-hidden'}" data-key="${escAttr(fullKey)}">预览</button>
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;

  // Parent dir ".." click → navigate (whole cell, no checkbox to conflict)
  tbody.querySelectorAll('td.folder-name').forEach(td => {
    td.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo(td.closest('tr').dataset.prefix);
    });
    td.style.cursor = 'pointer';
  });
  // Folder name click → navigate
  tbody.querySelectorAll('span.folder-name').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo(span.dataset.prefix);
    });
    span.style.cursor = 'pointer';
  });
  // Folder row click toggles checkbox (except name & buttons)
  tbody.querySelectorAll('.folder-row').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      if (e.target.closest('.folder-name')) return;
      const cb = tr.querySelector('input.folder-checkbox');
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
    tr.style.cursor = 'pointer';
  });
  // Folder checkboxes: cascade to files and sub-folders
  tbody.querySelectorAll('input.folder-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const prefix = cb.dataset.prefix;
      // Cascade to sub-folder checkboxes in DOM
      tbody.querySelectorAll('input.folder-checkbox').forEach(subCb => {
        if (subCb !== cb && subCb.dataset.prefix.startsWith(prefix)) {
          subCb.checked = cb.checked;
        }
      });
      // Cascade to rendered file checkboxes
      tbody.querySelectorAll('input.file-checkbox').forEach(fcb => {
        if (fcb.dataset.key.startsWith(prefix)) {
          fcb.checked = cb.checked;
        }
      });
      // Add/remove ALL files under prefix (including unrendered ones in sub-folders)
      for (const f of getFilesUnderPrefix(prefix)) {
        if (cb.checked) selectedKeys.add(f.key);
        else selectedKeys.delete(f.key);
      }
      // Track folder itself (even if empty) + all sub-folders in files array
      const folderSet = new Set();
      for (const f of files) {
        if (!f.key.startsWith(prefix)) continue;
        const rest = f.key.slice(prefix.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx > 0) folderSet.add(prefix + rest.slice(0, slashIdx) + '/');
      }
      if (cb.checked) {
        selectedFolders.add(prefix);
        folderSet.forEach(p => selectedFolders.add(p));
      } else {
        selectedFolders.delete(prefix);
        folderSet.forEach(p => selectedFolders.delete(p));
      }
      updateBatchToolbar();
    });
  });
  // Folder download button
  tbody.querySelectorAll('.folder-row button.download').forEach(btn => {
    btn.addEventListener('click', () => downloadFolder(btn.dataset.prefix));
  });
  // Folder delete button
  tbody.querySelectorAll('.folder-row button.delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteFolder(btn.dataset.prefix));
  });
  // Folder rename button
  tbody.querySelectorAll('.folder-row button.rename').forEach(btn => {
    btn.addEventListener('click', () => renameFolder(btn.dataset.prefix));
  });
  // Folder share button
  tbody.querySelectorAll('.folder-row button.share').forEach(btn => {
    btn.addEventListener('click', () => createShare(btn.dataset.prefix));
  });

  bindFileRowEvents();

  syncFolderCheckboxes(tbody.querySelectorAll('input.folder-checkbox'));

  setupColumnResize();
}

function setupColumnResize() {
  const table = document.getElementById('file-table');
  const tbody = document.getElementById('file-tbody');

  if (!tbody.children.length) {
    if (fileTableResizer) {
      fileTableResizer.reset({ disable: true });
      fileTableResizer = null;
    }
    return;
  }

  // Count visible header columns (exclude hidden ones like date column on mobile)
  const visibleThs = table.querySelectorAll('thead th:not([style*="display: none"])');
  const visibleCount = Array.from(visibleThs).filter(th => {
    const style = window.getComputedStyle(th);
    return style.display !== 'none';
  }).length;

  let savedWidths = [];
  if (fileTableResizer) {
    const opt = fileTableResizer.reset({ disable: true });
    savedWidths = opt.currentWidths || [];
    fileTableResizer = null;
  }

  // Discard saved widths if column count changed (e.g. desktop→mobile)
  if (savedWidths.length !== visibleCount) {
    savedWidths = [];
  }

  fileTableResizer = new ColumnResizer.default(table, {
    liveDrag: true,
    minWidth: 50,
    headerOnly: true,
    removePadding: false,
    resizeMode: 'fit',
    widths: savedWidths,
  });
}

function setupShareColumnResize(container) {
  const table = document.getElementById('share-mgmt-table');
  const tbody = document.getElementById('share-mgmt-tbody');
  if (!table || !tbody || !tbody.children.length) return;

  let savedWidths = [];
  try { savedWidths = JSON.parse(container.dataset.colWidths || '[]'); } catch { /* ignore */ }

  if (container._shareResizer) {
    const opt = container._shareResizer.reset({ disable: true });
    savedWidths = opt.currentWidths || savedWidths;
    container.dataset.colWidths = JSON.stringify(savedWidths);
    container._shareResizer = null;
  }

  container._shareResizer = new ColumnResizer.default(table, {
    liveDrag: true,
    minWidth: 50,
    headerOnly: true,
    removePadding: false,
    resizeMode: 'fit',
    widths: savedWidths,
  });
}

function bindFileRowEvents() {
  const tbody = document.getElementById('file-tbody');
  // Restore checkbox states
  tbody.querySelectorAll('input.file-checkbox').forEach(cb => {
    if (selectedKeys.has(cb.dataset.key)) cb.checked = true;
  });
  // File row click toggles checkbox
  tbody.querySelectorAll('tr:not(.folder-row)').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      const cb = tr.querySelector('input.file-checkbox');
      if (!cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) selectedKeys.add(cb.dataset.key);
      else selectedKeys.delete(cb.dataset.key);
      updateBatchToolbar();
    });
    tr.style.cursor = 'pointer';
  });
  // File actions
  tbody.querySelectorAll('tr:not(.folder-row) button.preview').forEach(btn => {
    btn.addEventListener('click', () => previewFile(btn.dataset.key));
  });
  tbody.querySelectorAll('tr:not(.folder-row) button.download').forEach(btn => {
    btn.addEventListener('click', () => downloadFile(btn.dataset.key));
  });
  tbody.querySelectorAll('tr:not(.folder-row) button.delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.key));
  });
  tbody.querySelectorAll('tr:not(.folder-row) button.rename').forEach(btn => {
    btn.addEventListener('click', () => renameFile(btn.dataset.key));
  });
  tbody.querySelectorAll('tr:not(.folder-row) button.share').forEach(btn => {
    btn.addEventListener('click', () => createShare(btn.dataset.key));
  });
  tbody.querySelectorAll('input.file-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedKeys.add(cb.dataset.key);
      else selectedKeys.delete(cb.dataset.key);
      updateBatchToolbar();
    });
  });
  updateBatchToolbar();
}

function updateBatchToolbar() {
  const allFiles = document.querySelectorAll('input.file-checkbox');
  const allFolders = document.querySelectorAll('input.folder-checkbox');
  syncFolderCheckboxes(allFolders);
  const itemCount = countSelectedItems();
  const fileCount = countSelectedFiles();
  document.getElementById('file-count').style.display = itemCount > 0 ? 'none' : '';
  document.getElementById('batch-info').style.display = itemCount > 0 ? 'flex' : 'none';
  const text = selectedFolders.size > 0
      ? `已选 <span id="selected-count">${itemCount}</span> 项（共 ${fileCount} 个文件）`
      : `已选 <span id="selected-count">${fileCount}</span> 个文件`;
  document.getElementById('selected-text').innerHTML = text;
  const allChecked = itemCount > 0 && [...allFiles].every(cb => cb.checked) && [...allFolders].every(cb => cb.checked);
  document.getElementById('select-all').checked = allChecked;
}

function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

// iframe 方式触发下载，不受浏览器对程序化 a.click() 的限制，适用于批量下载
function downloadViaIframe(url) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      iframe.remove();
      resolve();
    }, 2000);
  });
}

async function downloadFile(key) {
  try {
    const resp = await fetch(fileApi('/api/files/' + encodeURIComponent(key)), {
      headers: { 'X-Auth-Password': password },
    });
    if (!resp.ok) throw new Error('获取下载链接失败: ' + resp.status);
    const { url } = await resp.json();
    triggerDownload(url);
  } catch (err) {
    console.error('[my-pan] downloadFile: 失败', err);
    toast('下载失败: ' + err.message, 'error');
  }
}

let previewKey = '';

async function previewFile(key) {
  try {
    const charset = document.getElementById('preview-charset').value;
    const resp = await fetch(fileApi('/api/preview/' + encodeURIComponent(key) + '?charset=' + charset), {
      headers: { 'X-Auth-Password': password },
    });
    if (!resp.ok) throw new Error('获取预览链接失败: ' + resp.status);
    const { url, text } = await resp.json();
    showPreview(key, url, text);
  } catch (err) {
    console.error('[my-pan] previewFile: 失败', err);
    toast('预览失败: ' + err.message, 'error');
  }
}

function showPreview(key, url, isText) {
  previewKey = key;
  document.getElementById('preview-charset').value = 'utf-8';
  document.getElementById('preview-charset-group').style.display = isText ? 'flex' : 'none';
  document.getElementById('preview-title').textContent = key;
  const iframe = document.getElementById('preview-iframe');
  iframe.src = url;
  document.getElementById('preview-overlay').classList.add('visible');
}

function closePreview() {
  previewKey = '';
  document.getElementById('preview-overlay').classList.remove('visible');
  document.getElementById('preview-iframe').src = '';
}

document.getElementById('preview-charset').addEventListener('change', () => {
  if (previewKey) previewFile(previewKey);
});

document.getElementById('preview-close').addEventListener('click', closePreview);
document.getElementById('preview-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('preview-overlay').classList.contains('visible')) {
    closePreview();
  }
});

function promptDialog(title, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay';
    overlay.innerHTML = `
    <div class="prompt-box">
      <h3>${esc(title)}</h3>
      <input type="text" class="prompt-input" value="${esc(defaultValue)}" autofocus>
      <div class="prompt-buttons">
        <button class="btn-cancel">取消</button>
        <button class="btn-confirm">确定</button>
      </div>
    </div>
  `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.prompt-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { overlay.remove(); resolve(input.value); }
      if (e.key === 'Escape') { overlay.remove(); resolve(null); }
    });
    overlay.querySelector('.btn-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.querySelector('.btn-confirm').addEventListener('click', () => { overlay.remove(); resolve(input.value); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    setTimeout(() => input.focus(), 50);
  });
}

function showConfirmDialog(title, messageHtml, confirmLabel, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <h3>${title}</h3>
      <p>${messageHtml}</p>
      <div class="dialog-buttons">
        <button class="btn-cancel">取消</button>
        <button class="btn-confirm">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.btn-confirm').addEventListener('click', async function() {
    this.disabled = true;
    overlay.remove();
    await onConfirm();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function confirmDelete(key) {
  showConfirmDialog('确认删除', `确定要删除 <strong>${esc(key)}</strong> 吗？此操作不可撤销。`, '删除', () => deleteFile(key));
}

function showConflictDialog(filename) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <h3>文件已存在</h3>
        <p><strong>${esc(filename)}</strong> 已存在，请选择操作：</p>
        <div class="dialog-buttons">
          <button class="btn-rename">自动编号上传</button>
          <button class="btn-overwrite">覆盖</button>
          <button class="btn-cancel">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', () => { overlay.remove(); resolve('cancel'); });
    overlay.querySelector('.btn-rename').addEventListener('click', () => { overlay.remove(); resolve('rename'); });
    overlay.querySelector('.btn-overwrite').addEventListener('click', () => { overlay.remove(); resolve('overwrite'); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve('cancel'); } });
  });
}

async function deleteFile(key) {
  toast(`删除中...`, 'warning', 0);
  try {
    const resp = await fetch(fileApi('/api/files/' + encodeURIComponent(key)), {
      method: 'DELETE',
      headers: { 'X-Auth-Password': password },
    });
    if (!resp.ok) throw new Error('删除失败: ' + resp.status);
    console.log('[my-pan] 已删除:', key);
    await preserveAncestorDirs(key);
    toast('刷新中...', 'info', 0);
    await loadFiles();
    toast('删除成功', 'success');
  } catch (err) {
    console.error('[my-pan] deleteFile: 失败', err);
    toast('删除失败: ' + err.message, 'error');
  }
}

// 上传零字节对象（目录标记），返回预签名 URL 并 PUT 空内容
async function uploadZeroByte(key) {
  const resp = await fetch(fileApi('/api/upload-url'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
    body: JSON.stringify({ key, contentType: 'application/octet-stream' }),
  });
  if (!resp.ok) throw new Error('获取上传链接失败');
  const { url } = await resp.json();
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(new Uint8Array(0));
  });
}

// 确保目录标记存在（零字节对象），防止 S3 中因文件被删导致层级消失
async function ensureDirMarker(prefix) {
  try { await uploadZeroByte(prefix); } catch { /* 尽力而为，静默忽略 */ }
}

// 删除文件后保留祖先目录：检查 key 的每级父目录，若无其他文件则创建目录标记
async function preserveAncestorDirs(key, excludeKeys = new Set()) {
  const parts = key.split('/');
  // key 本身是目录（以 / 结尾）时只保留祖先，不复原自身
  const depth = key.endsWith('/') ? parts.length - 2 : parts.length - 1;
  let p = '';
  for (let i = 0; i < depth; i++) {
    p += parts[i] + '/';
    if (excludeKeys.has(p)) continue; // 该祖先目录本身已被显式删除，不复原
    const hasOther = files.some(f => f.key.startsWith(p) && f.key !== key && !excludeKeys.has(f.key));
    if (!hasOther) await ensureDirMarker(p);
  }
}

// ===== Upload =====
const fileInput = document.getElementById('file-input');

document.getElementById('upload-btn').addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); });

// ===== Global drag-and-drop =====
let dragCounter = 0;
const dragOverlay = document.getElementById('drag-overlay');

function hasFiles(e) {
  return e.dataTransfer.types && Array.from(e.dataTransfer.types).indexOf('Files') !== -1;
}

document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) dragOverlay.classList.add('visible');
});

document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragCounter--;
  if (dragCounter === 0) dragOverlay.classList.remove('visible');
});

document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragCounter = 0;
  dragOverlay.classList.remove('visible');
  const items = await getFilesFromDrop(e.dataTransfer);
  if (items.length > 0) uploadItems(items);
});

document.addEventListener('dragend', () => {
  dragCounter = 0;
  dragOverlay.classList.remove('visible');
});

async function uploadFiles(fileList) {
  const items = [];
  for (const file of fileList) {
    items.push({ file, name: file.webkitRelativePath || file.name });
  }
  uploadItems(items);
  fileInput.value = '';
}

async function uploadItems(items) {
  const progressBar = document.getElementById('progress-bar');
  const total = items.length;
  const uploaded = [];
  const failed = [];
  let cancelled = 0;
  progressBar.style.display = 'block';
  progressBar.style.width = '0%';

  // Phase 0: 容量检查
  const cur = storages.find(s => s.id === currentStorage);
  if (cur?.capacity) {
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    const remain = cur.capacity - totalSize;
    const uploadSize = items.reduce((s, it) => s + it.file.size, 0);
    if (uploadSize > remain) {
      progressBar.style.display = 'none';
      await new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
          <div class="dialog-box">
            <h3>剩余容量不足</h3>
            <div class="capacity-exceed-info">
              <div class="capacity-row"><span class="capacity-label">需要容量</span><span class="capacity-value">${formatSize(uploadSize)}</span></div>
              <div class="capacity-row"><span class="capacity-label">剩余容量</span><span class="capacity-value">${formatSize(remain)}</span></div>
              <div class="capacity-row exceed"><span class="capacity-label">超出</span><span class="capacity-value">${formatSize(uploadSize - remain)}</span></div>
            </div>
            <div class="dialog-buttons">
              <button class="btn-cancel">关闭</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        const close = () => { overlay.remove(); resolve(); };
        overlay.querySelector('.btn-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      });
      return;
    }
  }

  // Phase 1: 冲突检测（顺序执行，弹窗不能并行）
  const pendingItems = [];
  for (const item of items) {
    const file = item.file;
    let key = currentPrefix + item.name;
    if (files.some(f => f.key === key) || pendingItems.some(p => p.key === key)) {
      const choice = await showConflictDialog(key);
      if (choice === 'cancel') { cancelled++; continue; }
      if (choice === 'rename') { key = autoRename(key); }
    }
    pendingItems.push({ file, key });
  }

  // Phase 2: 并发上传
  const pendingTotal = pendingItems.length;
  let completed = 0;
  let started = 0;
  const partialProgress = new Array(pendingTotal).fill(0);
  let statusToast = null;

  function updateProgress() {
    const sum = completed + partialProgress.reduce((a, b) => a + b, 0);
    progressBar.style.width = pendingTotal > 0 ? (sum / pendingTotal * 100) + '%' : '100%';
    const shown = Math.max(completed, started);
    if (statusToast) statusToast.textContent = `上传中 ${shown}/${pendingTotal}`;
  }

  await runPool(pendingItems.map((item, i) => async () => {
    const { file, key } = item;
    try {
      let lastErr;
      started++;
      for (let attempt = 0; attempt < 2; attempt++) {
        const presignResp = await fetch(fileApi('/api/upload-url'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
          body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream' }),
        });
        if (!presignResp.ok) {
          const err = await presignResp.json().catch(() => ({}));
          throw new Error(`获取上传链接失败: ${err.error || presignResp.status}`);
        }
        const { url } = await presignResp.json();

        if (!statusToast) {
          statusToast = toast(`上传中 ${started}/${pendingTotal}`, 'info', 0);
        }

        try {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                partialProgress[i] = e.loaded / e.total;
                updateProgress();
              }
            });
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                partialProgress[i] = 1;
                resolve();
              } else {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            });
            xhr.addEventListener('error', () => reject(new Error('网络错误')));
            xhr.open('PUT', url);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });
          console.log('[my-pan] 上传成功:', key);
          uploaded.push(key);
          partialProgress[i] = 1;
          break;
        } catch (xhrErr) {
          lastErr = xhrErr;
          if (attempt === 0) console.warn('[my-pan] 上传失败，重试中:', key, xhrErr.message);
        }
      }
      if (lastErr) throw lastErr;
    } catch (err) {
      console.error('[my-pan] uploadFiles: 上传失败', key, err);
      failed.push(key);
    }
    completed++;
    updateProgress();
  }), 4);

  const handled = total - cancelled;
  setTimeout(() => { progressBar.style.display = 'none'; }, 500);
  // 确保上传文件的父级目录标记存在，防止文件被删后目录层级消失
  const dirs = new Set();
  for (const key of uploaded) {
    const parts = key.split('/');
    let p = '';
    for (let i = 0; i < parts.length - 1; i++) {
      p += parts[i] + '/';
      dirs.add(p);
    }
  }
  for (const dir of dirs) {
    if (!files.some(f => f.key === dir)) await ensureDirMarker(dir);
  }
  toast('刷新中...', 'info', 0);
  await loadFiles();
  if (handled > 0) {
    if (failed.length > 0) {
      toast(`上传失败，成功 ${handled - failed.length} 个，失败 ${failed.length} 个`, 'error');
    } else {
      toast(`上传成功，成功 ${handled} 个`, 'success');
    }
  }
}

async function getFilesFromDrop(dataTransfer) {
  const droppedFiles = dataTransfer.files;
  if (!droppedFiles || droppedFiles.length === 0) return [];

  const items = dataTransfer.items;
  // 阶段 0：同步捕获所有 Entry 对象，避免后续 await 导致 DataTransfer 变 stale
  const entries = [];
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
  }

  // 阶段 1：用 Entry API 递归遍历目录树，只产出真实文件
  if (entries.length > 0) {
    const result = [];

    async function traverse(entry, path) {
      if (entry.isFile) {
        const file = await new Promise(resolve => entry.file(resolve));
        result.push({ file, name: path + entry.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = await readAllEntries(reader);
        for (const child of entries) {
          await traverse(child, path + entry.name + '/');
        }
      }
    }

    for (const entry of entries) {
      await traverse(entry, '');
    }

    if (result.length > 0) return result;
  }

  // 阶段 2：兜底 — Entry API 不可用时，用 FileList 扁平处理
  return Array.from(droppedFiles).map(file => ({
    file,
    name: (file.webkitRelativePath || file.name).replace(/\\/g, '/'),
  }));
}

async function readAllEntries(reader) {
  const entries = [];
  let batch;
  do {
    batch = await new Promise(resolve => reader.readEntries(resolve));
    entries.push(...batch);
  } while (batch.length > 0);
  return entries;
}

// ===== Sorting =====
document.querySelectorAll('.file-list th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortBy === col) { sortAsc = !sortAsc; }
    else { sortBy = col; sortAsc = true; }
    document.querySelectorAll('.file-list th').forEach(h => { h.classList.remove('sorted'); h.removeAttribute('data-dir'); });
    th.classList.add('sorted');
    th.dataset.dir = sortAsc ? 'asc' : 'desc';
    renderFiles();
  });
});

// ===== Select All =====
document.getElementById('select-all').addEventListener('click', () => {
  const checked = document.getElementById('select-all').checked;
  document.querySelectorAll('input.folder-checkbox').forEach(cb => { cb.checked = checked; });
  document.querySelectorAll('input.file-checkbox').forEach(cb => { cb.checked = checked; });
  if (checked) {
    if (searchQuery) {
      // 搜索模式下：仅选中当前可见的搜索结果
      document.querySelectorAll('input.file-checkbox').forEach(cb => {
        const key = cb.dataset.key;
        if (key) selectedKeys.add(key);
      });
    } else {
      for (const f of getFilesUnderPrefix(currentPrefix)) selectedKeys.add(f.key);
      // 收集所有文件夹前缀（目录标记 + 从文件路径推导的子目录）
      document.querySelectorAll('input.folder-checkbox').forEach(cb => {
        const prefix = cb.dataset.prefix;
        if (!prefix) return;
        selectedFolders.add(prefix);
        // 发现该文件夹下的所有子文件夹（与 folder-checkbox change handler 逻辑一致）
        for (const f of files) {
          if (!f.key.startsWith(prefix)) continue;
          const rest = f.key.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx > 0) selectedFolders.add(prefix + rest.slice(0, slashIdx) + '/');
        }
      });
    }
  } else {
    selectedKeys.clear();
    selectedFolders.clear();
  }
  updateBatchToolbar();
});

// ===== Refresh =====
document.getElementById('new-folder-btn').addEventListener('click', async () => {
  const name = await promptDialog('请输入文件夹名称：');
  if (!name || !name.trim()) return;
  const key = currentPrefix + name.trim() + '/';
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.display = 'block';
  progressBar.style.width = '0%';
  toast('创建中...', 'info', 0);
  try {
    await uploadZeroByte(key);
    progressBar.style.width = '100%';
    setTimeout(() => { progressBar.style.display = 'none'; }, 300);
    toast('刷新中...', 'info', 0);
    await loadFiles();
    toast('文件夹已创建', 'success');
  } catch (err) {
    progressBar.style.display = 'none';
    toast('创建文件夹失败: ' + err.message, 'error');
  }
});

document.getElementById('search-input').addEventListener('input', () => {
  searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
  selectedKeys.clear(); selectedFolders.clear();
  renderFiles();
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  selectedKeys.clear(); selectedFolders.clear(); currentPrefix = ''; searchQuery = '';
  document.getElementById('search-input').value = '';
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '刷新中...';
  const ok = await loadFiles();
  if (ok) toast(`刷新完成，共 ${countFiles(files)} 个文件`, 'success');
  btn.disabled = false;
  btn.textContent = '刷新';
});

// ===== Logout =====
document.getElementById('logout-btn').addEventListener('click', () => {
  setCookie('my-pan_pw', '', -1);
  password = '';
  files = [];
  currentPrefix = '';
  selectedKeys.clear(); selectedFolders.clear();
  showLogin();
  const loginBtn = document.getElementById('login-btn');
  loginBtn.disabled = false;
  loginBtn.textContent = '进入';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('password-input').value = '';
  document.getElementById('password-input').focus();
});

// ===== Batch Operations =====
document.getElementById('clear-select-btn').addEventListener('click', () => {
  selectedKeys.clear(); selectedFolders.clear();
  document.querySelectorAll('input.file-checkbox').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('input.folder-checkbox').forEach(cb => { cb.checked = false; });
  updateBatchToolbar();
});

document.getElementById('batch-delete-btn').addEventListener('click', () => {
  const itemCount = countSelectedItems();
  const fileCount = countSelectedFiles();
  if (fileCount === 0 && selectedFolders.size === 0) return;
  // 收集所有待删除的对象（含目录标记）
  const allKeys = new Set(selectedKeys);
  for (const prefix of selectedFolders) {
    for (const f of files) {
      if (f.key.startsWith(prefix)) allKeys.add(f.key);
    }
    // 显式加入文件夹前缀本身，确保目录标记被删除（即使它在 files 中不存在）
    allKeys.add(prefix);
  }
  const desc = selectedFolders.size > 0
      ? `<strong>${itemCount}</strong> 个项目（共 <strong>${fileCount}</strong> 个文件）`
      : `<strong>${fileCount}</strong> 个文件`;
  showConfirmDialog('确认批量删除', `确定要删除选中的 ${desc} 吗？此操作不可撤销。`, '删除', async () => {
    toast('删除中...', 'warning', 0);
    try {
      const resp = await fetch(fileApi('/api/batch-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
        body: JSON.stringify({ keys: [...allKeys] }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
    } catch (err) {
      toast('批量删除失败: ' + err.message, 'error');
      return;
    }
    for (const key of allKeys) {
      // 跳过目录标记本身：调用者已显式删除它们，不应重建
      if (key.endsWith('/') && selectedFolders.has(key)) continue;
      await preserveAncestorDirs(key, allKeys);
    }
    selectedKeys.clear(); selectedFolders.clear();
    toast('刷新中...', 'info', 0);
    await loadFiles();
    toast(`删除成功，已删除 ${fileCount} 个文件`, 'success');
  });
});

document.getElementById('batch-download-btn').addEventListener('click', async () => {
  const fileKeys = new Set(selectedKeys);
  // Collect all files under selected folders
  for (const prefix of selectedFolders) {
    for (const f of getFilesUnderPrefix(prefix)) {
      fileKeys.add(f.key);
    }
  }
  if (fileKeys.size === 0) {
    toast('选中的文件夹中没有可下载的文件', 'warning');
    return;
  }

  // 阶段一：从 Worker 获取所有预签名下载链接
  const statusToast = toast('获取下载链接...', 'info', 0);
  const tasks = [];
  for (const key of fileKeys) {
    try {
      const resp = await fetch(fileApi('/api/files/' + encodeURIComponent(key)), {
        headers: { 'X-Auth-Password': password },
      });
      if (resp.ok) {
        const { url } = await resp.json();
        tasks.push({ key, url });
      } else {
        console.error('[my-pan] 获取下载链接失败', key, resp.status);
      }
    } catch (err) {
      console.error('[my-pan] 获取下载链接失败', key, err);
    }
  }

  if (tasks.length === 0) {
    toast('获取下载链接失败', 'error');
    return;
  }

  // 阶段二：逐个触发浏览器下载（iframe 方式，不受用户手势限制）
  let done = 0;
  for (const { url } of tasks) {
    await downloadViaIframe(url);
    done++;
    statusToast.textContent = `下载中 ${done}/${tasks.length}`;
  }
  toast(`下载完成，已下载 ${tasks.length} 个文件`, 'success');
});

async function deleteFileSilent(key) {
  try {
    const resp = await fetch(fileApi('/api/files/' + encodeURIComponent(key)), {
      method: 'DELETE',
      headers: { 'X-Auth-Password': password },
    });
    if (!resp.ok) throw new Error('删除失败: ' + resp.status);
  } catch (err) {
    console.error('[my-pan] 批量删除失败', key, err);
  }
}

// ===== Toast =====
function toast(msg, type, duration = 3000) {
  document.querySelectorAll('.toast').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  if (duration > 0) setTimeout(() => { el.remove(); }, duration);
  return el;
}

// ===== Folder helpers =====
function parseEntries() {
  const folderSet = new Set();
  const directFiles = [];
  for (const f of files) {
    if (!f.key.startsWith(currentPrefix)) continue;
    const rest = f.key.slice(currentPrefix.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx > 0) {
      folderSet.add(rest.slice(0, slashIdx));
    } else if (rest) {
      directFiles.push({ ...f, key: rest });
    }
  }
  return { folders: [...folderSet].sort(), files: directFiles };
}

function navigateTo(prefix) {
  currentPrefix = prefix;
  searchQuery = '';
  document.getElementById('search-input').value = '';
  selectedKeys.clear(); selectedFolders.clear();
  renderFiles();
}

function countSelectedItems() {
  // 只统计顶层选中的文件夹：父目录也在选中集合里的子目录不重复计数
  const topFolders = [...selectedFolders].filter(p =>
      ![...selectedFolders].some(other => other !== p && p.startsWith(other))
  );
  let count = topFolders.length;
  for (const key of selectedKeys) {
    if (![...selectedFolders].some(p => key.startsWith(p))) count++;
  }
  return count;
}

function countSelectedFiles() {
  const all = new Set(selectedKeys);
  for (const prefix of selectedFolders) {
    for (const f of getFilesUnderPrefix(prefix)) all.add(f.key);
  }
  return all.size;
}

function syncFolderCheckboxes(checkboxes) {
  checkboxes.forEach(cb => {
    const prefix = cb.dataset.prefix;
    const filesUnder = getFilesUnderPrefix(prefix);
    if (filesUnder.length > 0) {
      cb.checked = filesUnder.every(f => selectedKeys.has(f.key));
    }
  });
}

function countFiles(list) {
  return list.filter(f => !f.key.endsWith('/')).length;
}

function getFilesUnderPrefix(prefix) {
  return files.filter(f => f.key.startsWith(prefix) && !f.key.endsWith('/'));
}

function confirmDeleteFolder(prefix) {
  const allItems = files.filter(f => f.key.startsWith(prefix));
  const subFiles = allItems.filter(f => !f.key.endsWith('/'));
  if (allItems.length === 0) return;

  const info = subFiles.length > 0 ? `文件夹中的 <strong>${subFiles.length}</strong> 个文件` : '空文件夹';
  showConfirmDialog('确认删除文件夹', `将删除${info}，此操作不可撤销。`, '删除', async () => {
    toast('删除中...', 'warning', 0);
    try {
      const resp = await fetch(fileApi('/api/batch-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
        body: JSON.stringify({ keys: allItems.map(f => f.key) }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
    } catch (err) {
      toast('删除文件夹失败: ' + err.message, 'error');
      return;
    }
    const deletedKeys = new Set(allItems.map(f => f.key));
    // 遍历所有被删除的条目保留祖先目录，跳过文件夹自身的标记
    for (const key of allItems.map(f => f.key)) {
      if (key.endsWith('/') && deletedKeys.has(key)) continue;
      await preserveAncestorDirs(key, deletedKeys);
    }
    toast('刷新中...', 'info', 0);
    await loadFiles();
    toast(`已删除文件夹，共 ${subFiles.length} 个文件`, 'success');
  });
}

async function renameFile(key) {
  const dir = key.substring(0, key.lastIndexOf('/') + 1);
  const oldName = key.substring(dir.length);
  const newName = await promptDialog('重命名文件：', oldName);
  if (!newName || !newName.trim() || newName === oldName) return;
  const newKey = dir + newName.trim();
  if (files.some(f => f.key === newKey)) { toast('同名文件已存在', 'error'); return; }
  toast('重命名中...', 'info', 0);
  try {
    const resp = await fetch(fileApi('/api/rename'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
      body: JSON.stringify({ sourceKey: key, destinationKey: newKey }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
    toast('刷新中...', 'info', 0);
    await loadFiles();
    toast('重命名成功', 'success');
  } catch (err) {
    toast('重命名失败: ' + err.message, 'error');
  }
}

async function renameFolder(prefix) {
  const parent = prefix.substring(0, prefix.lastIndexOf('/', prefix.length - 2) + 1);
  const oldName = prefix.substring(parent.length, prefix.length - 1);
  const newName = await promptDialog('重命名文件夹：', oldName);
  if (!newName || !newName.trim() || newName === oldName) return;
  const newPrefix = parent + newName.trim() + '/';
  if (files.some(f => f.key === newPrefix)) { toast('同名文件夹已存在', 'error'); return; }

  const allItems = files.filter(f => f.key.startsWith(prefix));
  const fileItems = allItems.filter(f => !f.key.endsWith('/'));
  const total = fileItems.length;
  const statusToast = toast(`重命名中 0/${total || 1}`, 'info', 0);
  let fileDone = 0;
  await runPool(allItems.map(f => async () => {
    const newKey = newPrefix + f.key.slice(prefix.length);
    try {
      const resp = await fetch(fileApi('/api/rename'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
        body: JSON.stringify({ sourceKey: f.key, destinationKey: newKey }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
    } catch (err) {
      console.error('[my-pan] 重命名失败', f.key, err);
    }
    if (!f.key.endsWith('/')) {
      fileDone++;
      statusToast.textContent = `重命名中 ${fileDone}/${total}`;
    }
  }), 5);
  // 清理因重命名产生的空祖先目录标记（a/b/ → c/d/ 后 a/ 可能变空）
  const renamedKeys = new Set(allItems.map(f => f.key));
  let p = prefix;
  while (p) {
    const hasOther = files.some(f =>
        f.key.startsWith(p) && !renamedKeys.has(f.key) && f.key !== p
    );
    if (!hasOther) {
      try { await deleteFileSilent(p); } catch { /* 尽力而为 */ }
    }
    p = p.substring(0, p.lastIndexOf('/', p.length - 2) + 1);
  }
  toast('刷新中...', 'info', 0);
  await loadFiles();
  toast(`重命名成功，已移动 ${total} 个文件`, 'success');
}

async function downloadFolder(prefix) {
  const items = getFilesUnderPrefix(prefix);
  if (items.length === 0) { toast('文件夹为空', 'warning'); return; }
  const statusToast = toast('下载中 0/' + items.length, 'info', 0);
  let done = 0;
  for (const f of items) {
    try {
      const resp = await fetch(fileApi('/api/files/' + encodeURIComponent(f.key)), {
        headers: { 'X-Auth-Password': password },
      });
      if (resp.ok) {
        const { url } = await resp.json();
        await downloadViaIframe(url);
      }
    } catch (err) {
      console.error('[my-pan] 下载文件夹文件失败', f.key, err);
    }
    done++;
    statusToast.textContent = `下载中 ${done}/${items.length}`;
  }
  toast(`下载完成，共 ${items.length} 个文件`, 'success');
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  const parts = currentPrefix.split('/').filter(Boolean);
  let html = '<span class="breadcrumb-item" data-prefix="">根目录</span>';
  let path = '';
  for (let i = 0; i < parts.length; i++) {
    path += parts[i] + '/';
    html += '<span class="breadcrumb-sep">/</span>';
    html += `<span class="breadcrumb-item" data-prefix="${path}">${esc(parts[i])}</span>`;
  }
  bc.innerHTML = html;
  bc.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.prefix));
  });
}

// ===== Helpers =====
const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const unitNames = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unitNames.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + unitNames[i];
}

function formatSizeFixed(bytes, unit) {
  const div = SIZE_UNITS[unit] || 1;
  return (bytes / div).toFixed(1) + ' ' + unit;
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Mirrors worker/src/shares.ts TEXT_EXTS + MEDIA_EXTS
const TEXT_EXTS = new Set([
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

function isPreviewable(key) {
  const ext = (key.split('.').pop() || '').toLowerCase();
  return TEXT_EXTS.has(ext) || MEDIA_EXTS.has(ext);
}

function getFileIcon(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    // Images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️',
    // Documents
    pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📄', csv: '📊', json: '📄', xml: '📄', yaml: '📄', yml: '📄',
    // Archives
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦', bz2: '📦', xz: '📦',
    // Video
    mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',
    // Audio
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', wma: '🎵', m4a: '🎵',
    // Code
    js: '💻', ts: '💻', jsx: '💻', tsx: '💻', py: '💻', java: '💻', c: '💻', cpp: '💻', h: '💻', rb: '💻', go: '💻', rs: '💻', php: '💻', html: '💻', css: '💻', sh: '💻', sql: '💻',
    // Office
    xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️',
    // Fonts
    woff: '🔤', woff2: '🔤', ttf: '🔤', eot: '🔤',
  };
  return map[ext] || '📎';
}

function autoRename(filename) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let n = 1;
  let newName;
  do {
    newName = `${base} (${n})${ext}`;
    n++;
  } while (files.some(f => f.key === newName));
  return newName;
}

// 有界并发执行器：最多 limit 个任务同时运行
async function runPool(tasks, limit) {
  if (tasks.length === 0) return;
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function highlightText(text, query) {
  if (!query) return esc(text);
  // 在原始文本中搜索，记录匹配位置，然后在转义文本中恢复高亮
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(pattern, 'gi');
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    parts.push(esc(text.slice(last, m.index)));
    parts.push('<span class="highlight">' + esc(m[0]) + '</span>');
    last = m.index + m[0].length;
  }
  parts.push(esc(text.slice(last)));
  return parts.join('');
}

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

function setCookie(name, value, days) {
  const d = new Date(); d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Strict;Secure`;
}
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// ===== Context Menu =====
let contextTarget = null; // { type: 'file' | 'folder', key: string }

const contextMenu = document.getElementById('context-menu');
const contextPreview = contextMenu.querySelector('[data-action="preview"]');
const contextShare = contextMenu.querySelector('[data-action="share"]');

function getRowTarget(tr) {
  if (!tr) return null;
  if (tr.classList.contains('folder-row')) {
    const prefix = tr.dataset.prefix;
    if (!prefix || !tr.querySelector('input.folder-checkbox')) return null; // skip ".." row
    return { type: 'folder', key: prefix };
  }
  const cb = tr.querySelector('input.file-checkbox');
  if (!cb || !cb.dataset.key) return null;
  return { type: 'file', key: cb.dataset.key };
}

function showContextMenu(x, y) {
  contextPreview.style.display = (contextTarget.type === 'folder' || !isPreviewable(contextTarget.key)) ? 'none' : '';
  if (contextShare) contextShare.style.display = sharingEnabled ? '' : 'none';
  contextMenu.style.display = 'block';
  // Let browser layout first, then clamp to viewport
  requestAnimationFrame(() => {
    let left = x, top = y;
    if (x + contextMenu.offsetWidth > window.innerWidth) left = x - contextMenu.offsetWidth;
    if (y + contextMenu.offsetHeight > window.innerHeight) top = y - contextMenu.offsetHeight;
    contextMenu.style.left = Math.max(0, left) + 'px';
    contextMenu.style.top = Math.max(0, top) + 'px';
  });
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
  contextTarget = null;
}

document.getElementById('file-tbody').addEventListener('contextmenu', (e) => {
  const target = getRowTarget(e.target.closest('tr'));
  if (!target) return;
  e.preventDefault();
  contextTarget = target;
  showContextMenu(e.clientX, e.clientY);
});

// Long-press for mobile
let longPressTimer = null;
document.getElementById('file-tbody').addEventListener('touchstart', (e) => {
  const tr = e.target.closest('tr');
  const target = getRowTarget(tr);
  if (!target) return;
  const touch = e.touches[0];
  longPressTimer = setTimeout(() => {
    contextTarget = target;
    showContextMenu(touch.clientX, touch.clientY);
  }, 500);
}, { passive: true });

document.getElementById('file-tbody').addEventListener('touchend', () => clearTimeout(longPressTimer));
document.getElementById('file-tbody').addEventListener('touchmove', () => clearTimeout(longPressTimer));

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

contextMenu.querySelectorAll('.context-item').forEach(item => {
  item.addEventListener('click', () => {
    if (!contextTarget) return;
    const { type, key } = contextTarget;
    const action = item.dataset.action;
    if (action === 'preview') previewFile(key);
    else if (action === 'share') createShare(key);
    else if (action === 'download') type === 'folder' ? downloadFolder(key) : downloadFile(key);
    else if (action === 'rename') type === 'folder' ? renameFolder(key) : renameFile(key);
    else if (action === 'delete') type === 'folder' ? confirmDeleteFolder(key) : confirmDelete(key);
    hideContextMenu();
  });
});

// ===== Share =====
async function createShare(key) {
  const fileName = key.endsWith('/')
    ? key.split('/').filter(Boolean).pop() || key
    : key.split('/').pop();
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box" style="max-width:440px">
      <button class="dialog-close" title="关闭">&times;</button>
      <h3>创建分享</h3>
      <p style="font-size:13px;color:#888;margin-bottom:16px">${esc(key)}</p>
      <div class="share-pw-row">
        <div class="share-field">
          <label>分享密码（6位字母或数字）</label>
          <input type="text" class="share-pw-input" maxlength="6" placeholder="留空自动生成" autofocus>
        </div>
        <button class="share-gen-btn">随机生成</button>
      </div>
      <div class="share-field">
        <label>过期时间</label>
        <select class="share-expire-select">
          <option value="1">1 小时</option>
          <option value="24">1 天</option>
          <option value="168" selected>7 天</option>
          <option value="720">30 天</option>
          <option value="">永不过期</option>
        </select>
      </div>
      <div class="share-field" style="margin-bottom:0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" class="share-link-pw-toggle" checked style="width:auto;cursor:pointer">
          链接携带密码（方便直接访问）
        </label>
      </div>
      <div class="share-result" style="display:none" id="share-result-box">
        <div class="label">分享链接已生成</div>
        <div class="share-link-row">
          <input type="text" id="share-link-input" readonly>
          <button id="share-copy-btn">复制</button>
        </div>
        <div style="color:#888;font-size:12px;margin-top:4px">密码：<strong id="share-pw-display"></strong></div>
        <div class="share-qrcode" id="share-qrcode-box">
          <canvas id="share-qrcode-canvas" style="width:180px;height:180px;display:block;margin:12px auto 0;border-radius:8px;border:1px solid #eee"></canvas>
          <button class="share-save-qr-btn" id="share-save-qr-btn">保存二维码</button>
        </div>
      </div>
      <div class="dialog-buttons" id="share-buttons">
        <button class="btn-cancel">取消</button>
        <button class="btn-confirm" id="share-create-btn" style="background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff;border-color:transparent">创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const pwInput = overlay.querySelector('.share-pw-input');
  const expireSelect = overlay.querySelector('.share-expire-select');
  const resultBox = overlay.querySelector('#share-result-box');
  const buttonsBox = overlay.querySelector('#share-buttons');
  const linkInput = overlay.querySelector('#share-link-input');
  const pwDisplay = overlay.querySelector('#share-pw-display');

  // 随机生成密码
  function genPw() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let pw = '';
    for (let i = 0; i < 6; i++) pw += chars[bytes[i] % chars.length];
    pwInput.value = pw;
  }
  overlay.querySelector('.share-gen-btn').addEventListener('click', genPw);

  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.dialog-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#share-create-btn').addEventListener('click', async () => {
    const sharePw = pwInput.value.trim() || '';
    const expiresInHours = expireSelect.value ? parseInt(expireSelect.value) : null;
    try {
      const resp = await fetch(fileApi('/api/shares'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
        body: JSON.stringify({ fileKey: key, fileName, password: sharePw || undefined, expiresInHours }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
      const data = await resp.json();
      const withPw = overlay.querySelector('.share-link-pw-toggle').checked;
      const shareUrl = (apiBase || location.origin) + data.url + (withPw ? '?p=' + data.password : '');
      linkInput.value = shareUrl;
      pwDisplay.textContent = data.password;
      const qrCanvas = overlay.querySelector('#share-qrcode-canvas');
      drawQRCode(qrCanvas, shareUrl);
      pwInput.disabled = true;
      expireSelect.disabled = true;
      overlay.querySelector('.share-link-pw-toggle').disabled = true;
      overlay.querySelector('.share-gen-btn').disabled = true;
      resultBox.style.display = 'block';
      buttonsBox.style.display = 'none';
    } catch (err) {
      toast('创建分享失败: ' + err.message, 'error');
    }
  });

  // Copy button
  overlay.querySelector('#share-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(linkInput.value).then(() => toast('链接已复制', 'success')).catch(() => {
      linkInput.select();
      toast('请手动复制链接', 'info');
    });
  });

  // Save QR code button
  overlay.querySelector('#share-save-qr-btn').addEventListener('click', () => {
    const canvas = overlay.querySelector('#share-qrcode-canvas');
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode.png';
      a.click();
      URL.revokeObjectURL(url);
      toast('二维码已保存', 'success');
    });
  });

  // Keyboard: Enter to create
  pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#share-create-btn').click();
  });
}

function showShareAddrDialog(shareUrl, password) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box" style="max-width:480px">
      <button class="dialog-close" title="关闭">&times;</button>
      <h3>分享地址</h3>
      <div class="share-result" style="display:block">
        <div class="label">分享链接</div>
        <div class="share-link-row">
          <input type="text" id="share-addr-input" readonly value="${escAttr(shareUrl)}">
          <button id="share-addr-copy-btn">复制</button>
        </div>
        <div style="color:#888;font-size:12px;margin-top:4px">密码：<strong id="share-addr-pw-display">${esc(password)}</strong></div>
        <div class="share-qrcode" style="margin-top:12px">
          <canvas id="share-addr-qr-canvas" style="width:180px;height:180px;display:block;margin:12px auto 0;border-radius:8px;border:1px solid #eee"></canvas>
          <button class="share-save-qr-btn" id="share-addr-save-qr-btn">保存二维码</button>
        </div>
      </div>
      <div class="dialog-buttons" style="margin-top:16px">
        <button class="btn-cancel">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.dialog-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const linkInput = overlay.querySelector('#share-addr-input');
  overlay.querySelector('#share-addr-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(linkInput.value).then(() => toast('链接已复制', 'success')).catch(() => {
      linkInput.select();
      toast('请手动复制链接', 'info');
    });
  });

  drawQRCode(overlay.querySelector('#share-addr-qr-canvas'), shareUrl);

  overlay.querySelector('#share-addr-save-qr-btn').addEventListener('click', () => {
    const canvas = overlay.querySelector('#share-addr-qr-canvas');
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode.png';
      a.click();
      URL.revokeObjectURL(url);
      toast('二维码已保存', 'success');
    });
  });
}

async function manageShares() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box" style="max-width:900px">
      <button class="dialog-close" title="关闭">&times;</button>
      <h3>管理分享</h3>
      <div class="share-mgmt-toolbar" id="share-mgmt-toolbar" style="display:none">
        <span class="share-batch-info" id="share-batch-info"></span>
        <button class="btn share-batch-del-btn" id="share-batch-del-btn" style="display:none">批量删除</button>
      </div>
      <div id="share-mgmt-body"><p style="color:#888;font-size:14px;text-align:center;padding:20px">加载中...</p></div>
      <div class="dialog-buttons" style="margin-top:16px">
        <button class="btn-cancel">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.dialog-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const body = overlay.querySelector('#share-mgmt-body');
  const toolbar = overlay.querySelector('#share-mgmt-toolbar');
  await loadShareList(body, toolbar);
}

async function loadShareList(container, toolbar, page) {
  if (!page) page = parseInt(container.dataset.page) || 1;
  const pageSize = 10;
  try {
    const resp = await fetch(apiBase + '/api/shares?page=' + page + '&pageSize=' + pageSize, {
      headers: { 'X-Auth-Password': password },
    });
    if (!resp.ok) throw new Error('获取分享列表失败: ' + resp.status);
    const data = await resp.json();
    const shares = data.items;
    const total = data.total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (shares.length === 0) {
      container.innerHTML = '<div class="share-empty">暂无分享记录</div>';
      if (toolbar) toolbar.style.display = 'none';
      return;
    }

    container.dataset.page = page;
    if (toolbar) toolbar.style.display = 'flex';

    // 客户端排序：从 container.dataset 读取排序状态，对当前页结果排序
    const shSortBy = container.dataset.shSortBy || 'created_at';
    const shSortAsc = container.dataset.shSortAsc === '1';
    if (shSortBy) {
      shares.sort((a, b) => {
        let va, vb;
        switch (shSortBy) {
          case 'access_count': va = a.access_count; vb = b.access_count; break;
          case 'password': va = a.password; vb = b.password; break;
          case 'expires_at': va = a.expires_at || ''; vb = b.expires_at || ''; break;
          case 'created_at': va = a.created_at; vb = b.created_at; break;
          default: va = (a.file_name || '').toLowerCase(); vb = (b.file_name || '').toLowerCase(); break;
        }
        if (va < vb) return shSortAsc ? -1 : 1;
        if (va > vb) return shSortAsc ? 1 : -1;
        return 0;
      });
    }

    let html = `<table class="share-mgmt-table" id="share-mgmt-table"><thead><tr>
      <th style="width:5%"><input type="checkbox" class="share-row-checkbox" id="share-select-all-cb" title="全选"></th>
      <th style="width:25%" data-sort="file_name">文件名</th><th style="width:10%" data-sort="password">密码</th><th style="width:15%" data-sort="created_at">创建时间</th><th style="width:15%" data-sort="expires_at">过期时间</th><th style="width:10%" data-sort="access_count">访问次数</th><th style="width:20%">操作</th>
    </tr></thead><tbody id="share-mgmt-tbody">`;
    for (const s of shares) {
      const url = (apiBase || location.origin) + '/s/' + s.id + '?p=' + s.password;
      html += `<tr>
        <td><input type="checkbox" class="share-row-checkbox" data-share-id="${escAttr(s.id)}"></td>
        <td class="name-col" title="${esc(s.file_key)}">${esc(s.file_name)}</td>
        <td>${esc(s.password)}</td>
        <td>${formatDate(s.created_at)}</td>
        <td>${s.expires_at ? formatDate(s.expires_at) : '永不过期'}</td>
        <td>${s.access_count}</td>
        <td>
          <button class="btn-sm btn-share-addr" data-url="${escAttr(url)}" data-pw="${escAttr(s.password)}">分享地址</button>
          <button class="btn-sm btn-del" data-id="${escAttr(s.id)}">删除</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';

    // Pagination
    html += '<div class="share-pagination">';
    html += '<button class="share-page-btn" ' + (page <= 1 ? 'disabled' : '') + ' data-page="1" title="首页">&laquo;</button>';
    html += '<button class="share-page-btn" ' + (page <= 1 ? 'disabled' : '') + ' data-page="' + (page - 1) + '" title="上一页">&lsaquo;</button>';
    for (const p of getPageNumbers(page, totalPages)) {
      if (p === '...') {
        html += '<span class="share-page-ellipsis">&hellip;</span>';
      } else {
        html += '<button class="share-page-num' + (p === page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }
    }
    html += '<button class="share-page-btn" ' + (page >= totalPages ? 'disabled' : '') + ' data-page="' + (page + 1) + '" title="下一页">&rsaquo;</button>';
    html += '<button class="share-page-btn" ' + (page >= totalPages ? 'disabled' : '') + ' data-page="' + totalPages + '" title="尾页">&raquo;</button>';
    html += '<span class="share-page-info">共 ' + total + ' 条</span>';
    html += '</div>';

    container.innerHTML = html;

    // 跨页全选状态下，新页面渲染后恢复所有行复选框的勾选
    if (container.dataset.selectAll) {
      container.querySelectorAll('.share-row-checkbox[data-share-id]').forEach(cb => { cb.checked = true; });
    }

    // 表头排序标记
    const sortableThs = container.querySelectorAll('#share-mgmt-table th[data-sort]');
    sortableThs.forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (container.dataset.shSortBy === col) {
          container.dataset.shSortAsc = container.dataset.shSortAsc === '1' ? '0' : '1';
        } else {
          container.dataset.shSortBy = col;
          container.dataset.shSortAsc = '1';
        }
        loadShareList(container, toolbar, page);
      });
    });
    // 给当前排序列加 sorted 样式和箭头
    if (container.dataset.shSortBy) {
      const activeTh = container.querySelector(`#share-mgmt-table th[data-sort="${container.dataset.shSortBy}"]`);
      if (activeTh) {
        activeTh.classList.add('sorted');
        activeTh.dataset.dir = container.dataset.shSortAsc === '1' ? 'asc' : 'desc';
      }
    }

    setupShareColumnResize(container);

    // Pagination buttons
    container.querySelectorAll('.share-page-btn, .share-page-num').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) loadShareList(container, toolbar, parseInt(btn.dataset.page));
      });
    });

    function reloadAfterDelete() {
      clearSelectAll();
      const newPage = (shares.length === 1 && page > 1) ? page - 1 : page;
      return loadShareList(container, toolbar, newPage);
    }

    const selectAllCb = container.querySelector('#share-select-all-cb');
    const batchDelBtn = toolbar ? toolbar.querySelector('#share-batch-del-btn') : null;
    const batchInfo = toolbar ? toolbar.querySelector('#share-batch-info') : null;

    function getSelectedIds() {
      if (container.dataset.selectAll === '1') return [];
      const ids = [];
      container.querySelectorAll('.share-row-checkbox[data-share-id]:checked').forEach(cb => {
        ids.push(cb.dataset.shareId);
      });
      return ids;
    }

    function clearSelectAll() { delete container.dataset.selectAll; }

    function updateBatchUI() {
      const selectAll = container.dataset.selectAll === '1';
      const count = selectAll ? total : getSelectedIds().length;
      if (batchInfo) batchInfo.textContent = count > 0 ? '已选 ' + count + ' 项' : '';
      if (batchDelBtn) batchDelBtn.style.display = count > 0 ? '' : 'none';
      if (selectAllCb) {
        if (selectAll) {
          selectAllCb.checked = true;
          selectAllCb.indeterminate = false;
        } else {
          const rowCbs = container.querySelectorAll('.share-row-checkbox[data-share-id]');
          const checkedIds = getSelectedIds();
          selectAllCb.checked = rowCbs.length > 0 && checkedIds.length === rowCbs.length;
          selectAllCb.indeterminate = checkedIds.length > 0 && checkedIds.length < rowCbs.length;
        }
      }
    }

    // Header checkbox: cross-page select all（纯前端标志位，无网络请求）
    if (selectAllCb) {
      selectAllCb.addEventListener('change', () => {
        if (selectAllCb.checked) {
          container.dataset.selectAll = '1';
          container.querySelectorAll('.share-row-checkbox[data-share-id]').forEach(cb => { cb.checked = true; });
        } else {
          clearSelectAll();
          container.querySelectorAll('.share-row-checkbox[data-share-id]').forEach(cb => { cb.checked = false; });
        }
        updateBatchUI();
      });
    }

    // Row checkboxes — clear cross-page selectAll on manual uncheck
    container.querySelectorAll('.share-row-checkbox[data-share-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (!cb.checked) clearSelectAll();
        updateBatchUI();
      });
    });

    // Batch delete — 用 onclick 而非 addEventListener，避免翻页时重复绑定
    if (batchDelBtn) {
      batchDelBtn.onclick = async () => {
        const selectAll = container.dataset.selectAll === '1';
        const ids = selectAll ? [] : getSelectedIds();
        if (!selectAll && ids.length === 0) return;
        const label = selectAll ? '全部 ' + total + ' 个' : ids.length + ' 个';
        showConfirmDialog('确认批量删除', '确定要删除选中的 <strong>' + label + '</strong> 分享吗？此操作不可撤销。', '删除', async () => {
          try {
            const body = selectAll ? { delete_all: true } : { ids };
            const resp = await fetch(apiBase + '/api/shares/batch-delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Auth-Password': password },
              body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error('批量删除失败');
            toast('已删除 ' + label + ' 分享', 'success');
            reloadAfterDelete();
          } catch (err) {
            toast('批量删除失败: ' + err.message, 'error');
          }
        });
      };
    }

    // Bind share address buttons
    container.querySelectorAll('.btn-share-addr').forEach(btn => {
      btn.addEventListener('click', () => {
        showShareAddrDialog(btn.dataset.url, btn.dataset.pw);
      });
    });
    // Bind delete buttons
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        showConfirmDialog('确认删除', '确定要删除此分享吗？', '删除', async () => {
          try {
            const resp = await fetch(apiBase + '/api/shares/' + id, {
              method: 'DELETE',
              headers: { 'X-Auth-Password': password },
            });
            if (!resp.ok) throw new Error('删除失败');
            toast('分享已删除', 'success');
            reloadAfterDelete();
          } catch (err) {
            toast('删除分享失败: ' + err.message, 'error');
          }
        });
      });
    });

    updateBatchUI();
  } catch (err) {
    container.innerHTML = '<div class="share-empty">加载失败: ' + esc(err.message) + '</div>';
    if (toolbar) toolbar.style.display = 'none';
  }
}

document.getElementById('manage-shares-btn').addEventListener('click', manageShares);

// ===== QR Code — 基于 qrcode-generator 库（pages/public/qrcode.js）=====
function drawQRCode(canvas, text) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const scale = 4;
  const quiet = 4 * scale;
  canvas.width = size * scale + quiet * 2;
  canvas.height = size * scale + quiet * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(quiet + c * scale, quiet + r * scale, scale, scale);
      }
    }
  }
}
// ---- end QR Code ----
// ===== Boot =====
(function () {
  var hash = window.location.hash.slice(1);
  if (hash.startsWith('api=')) {
    var url = hash.slice(4);
    try {
      var u = new URL(url);
      if (u.origin === location.origin || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
        apiBase = url;
      } else {
        console.warn('[my-pan] #api= 仅允许同源或 localhost，已忽略:', url);
      }
    } catch (_) {
      console.warn('[my-pan] #api= 无效的 URL，已忽略:', url);
    }
  }
  console.log('[my-pan] 启动, apiBase=', apiBase || '(同源)');
  init();
})();
