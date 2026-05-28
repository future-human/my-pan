// i18n.js — Simple key-value internationalization
(function () {
  const map = {
    // === HTML static ===
    '我的网盘': 'My Pan',
    '加载中...': 'Loading...',
    '请输入访问密码': 'Please enter password',
    '密码': 'Password',
    '进入': 'Enter',
    '密码错误，请重试': 'Incorrect password',
    '网络错误，请检查连接': 'Network error, check connection',
    '验证中...': 'Verifying...',
    '退出': 'Logout',
    '退出登录': 'Logout',
    '📁 释放上传': '📁 Drop to upload',
    '上传': 'Upload',
    '新建文件夹': 'New Folder',
    '刷新': 'Refresh',
    '管理分享': 'Manage Shares',
    '搜索文件...': 'Search files...',
    '根目录': 'Root',
    '文件名': 'Name',
    '大小': 'Size',
    '修改时间': 'Modified',
    '操作': 'Actions',
    '存储桶中没有文件': 'No files in bucket',
    '编码': 'Encoding',

    // === File rows ===
    '下载': 'Download',
    '重命名': 'Rename',
    '删除': 'Delete',
    '分享': 'Share',
    '预览': 'Preview',

    // === Batch ===
    '已选': 'Selected',
    '个': '',
    '批量下载': 'Batch Download',
    '批量删除': 'Batch Delete',
    '清空选择': 'Clear',

    // === Counts (template) ===
    '共 {0} 项': '{0} items',
    '已选 {0} 个': '{0} selected',
    '已选 {0} 项（共 {1} 个文件）': '{0} items selected ({1} files)',
    '搜索 "{0}" — {1} 个文件': 'Search "{0}" — {1} files',
    '没有匹配的文件': 'No matching files',
    '刷新完成，共 {0} 个文件': 'Refreshed, {0} files',

    // === Toasts ===
    '删除中...': 'Deleting...',
    '刷新中...': 'Refreshing...',
    '删除成功': 'Deleted',
    '下载失败': 'Download failed',
    '预览失败': 'Preview failed',
    '获取下载链接失败': 'Failed to get download link',
    '获取下载链接': 'Get download links',
    '获取预览链接失败': 'Failed to get preview link',
    '加载文件列表失败': 'Failed to load file list',
    '下载中 {0}/{1}': 'Downloading {0}/{1}',
    '移动中 {0}/{1}': 'Moving {0}/{1}',
    '移动完成，共 {0} 个文件': 'Moved {0} files',
    '没有可移动的文件（目标位置已存在同名文件）': 'No files to move (duplicate names at destination)',
    '文件夹为空': 'Folder is empty',
    '下载完成，共 {0} 个文件': 'Download complete, {0} files',
    '下载完成，已下载 {0} 个文件': 'Download complete, {0} files',
    '创建中...': 'Creating...',
    '文件夹已创建': 'Folder created',
    '创建文件夹失败': 'Failed to create folder',
    '重命名中...': 'Renaming...',
    '重命名中 {0}/{1}': 'Renaming {0}/{1}',
    '重命名成功': 'Renamed',
    '重命名成功，已移动 {0} 个文件': 'Renamed, {0} files moved',
    '重命名失败': 'Rename failed',
    '同名文件已存在': 'File with same name exists',
    '同名文件夹已存在': 'Folder with same name exists',
    '链接已复制': 'Link copied',
    '请手动复制链接': 'Please copy manually',
    '二维码已保存': 'QR code saved',
    '创建分享失败': 'Failed to create share',
    '创建': 'Create',
    '保存二维码': 'Save QR Code',
    '暂无分享记录': 'No share records',
    '加载失败': 'Load failed',
    '获取分享列表失败': 'Failed to get share list',
    '已删除 {0} 分享': 'Deleted {0} share(s)',
    '批量删除失败': 'Batch delete failed',
    '删除失败': 'Delete failed',
    '删除文件夹失败': 'Failed to delete folder',
    '删除分享失败': 'Failed to delete share',
    '分享已删除': 'Share deleted',
    '上传中 {0}/{1}': 'Uploading {0}/{1}',
    '上传失败，成功 {0} 个，失败 {1} 个': 'Upload failed, {0} ok, {1} failed',
    '上传成功，成功 {0} 个': 'Uploaded {0} files',
    '获取上传链接失败': 'Failed to get upload URL',
    '移动失败': 'Move failed',
    '删除成功，已删除 {0} 个文件': 'Deleted {0} files',
    '已删除文件夹，共 {0} 个文件': 'Folder deleted, {0} files',
    '当前未设置访问密码，建议配置 AUTH_PASSWORD 以保护数据安全': 'No access password configured. Set AUTH_PASSWORD to secure your data',
    '选中的文件夹中没有可下载的文件': 'No downloadable files in selected folders',

    // === Dialogs ===
    '确认删除': 'Confirm Delete',
    '确定要删除': 'Are you sure you want to delete',
    '？此操作不可撤销。': '? This cannot be undone.',
    '取消': 'Cancel',
    '确定': 'OK',
    '关闭': 'Close',

    // === Confirm dialogs (composed) ===
    '确认删除文件夹': 'Confirm Delete Folder',
    '将删除': 'Will delete',
    '文件夹中的': '',
    '个文件': 'files',
    '空文件夹': 'empty folder',
    '，此操作不可撤销。': ', this cannot be undone.',
    '已删除文件夹，共': 'Folder deleted, ',
    '确定要删除选中的': 'Are you sure you want to delete the selected',
    '确定要删除此分享吗？': 'Delete this share?',
    '确定要删除选中的 {0} 分享吗？此操作不可撤销。': 'Delete the selected {0} share(s)? This cannot be undone.',

    // === Share dialog ===
    '创建分享': 'Create Share',
    '分享密码（6位字母或数字）': 'Password (6 alphanumeric chars)',
    '留空自动生成': 'Empty = auto-generate',
    '随机生成': 'Generate',
    '过期时间': 'Expiration',
    '1 小时': '1 hour',
    '1 天': '1 day',
    '7 天': '7 days',
    '30 天': '30 days',
    '永不过期': 'Never',
    '链接携带密码（方便直接访问）': 'Include password in link',
    '分享链接已生成': 'Share link created',
    '复制': 'Copy',
    '分享地址': 'Share Link',
    '分享链接': 'Share URL',
    '创建时间': 'Created',
    '访问次数': 'Views',
    '共 {0} 条': '{0} total',
    '已选 {0} 项': '{0} selected',

    // === Confirm dialog template ===
    '确定要删除 <strong>{0}</strong> 吗？此操作不可撤销。': 'Delete <strong>{0}</strong>? This cannot be undone.',

    // === Rename ===
    '请输入文件夹名称：': 'Enter folder name:',
    '重命名文件：': 'Rename file:',
    '重命名文件夹：': 'Rename folder:',

    // === Upload conflict ===
    '文件已存在': 'File exists',
    '已存在，请选择操作：': 'already exists. Choose:',
    '自动编号上传': 'Auto-rename',
    '覆盖': 'Overwrite',

    // === Capacity ===
    '剩余容量不足': 'Insufficient capacity',
    '需要容量': 'Required',
    '剩余容量': 'Remaining',
    '超出': 'Exceeded',
    '容量超限弹窗关闭': '',

    // === Misc labels ===
    '可用': 'free',
    '共': 'total',
    '加载中': 'Loading',
    '存储桶中没有文件。': 'No files in bucket.',

    // === Preview ===
    'PDF 加载失败': 'PDF load failed',
    'PDF 预览库未加载': 'PDF preview library not loaded',
    'PPTX 预览暂不支持，请下载后查看': 'PPTX preview not supported, please download',
    '不支持的文档格式': 'Unsupported document format',
    '文档加载失败': 'Document load failed',
    '网络错误': 'Network error',

    // === Share management ===
    '已删除': 'Deleted',
    '分享管理加载失败': 'Share management load failed',

    // === Misc ===
    '全部': 'All',
    '全选': 'Select All',

    // === Language button labels ===
    'English': '中文',
  };

  let lang = 'zh';
  try { lang = localStorage.getItem('my-pan_lang') || 'zh'; } catch (e) { /* ignore */ }

  window.t = function (text) {
    if (lang === 'zh') return text;
    const translated = map[text];
    if (translated === undefined) return text;
    let result = translated;
    for (let i = 1; i < arguments.length; i++) {
      result = result.replace('{' + (i - 1) + '}', arguments[i]);
    }
    return result;
  };

  window.getLang = function () { return lang; };
  window.toggleLang = function () {
    const next = lang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('my-pan_lang', next); } catch (e) { /* ignore */ }
    window.location.reload();
  };

  // Apply language to static HTML elements on load
  function applyStatic() {
    if (lang === 'zh') return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (map[key]) {
        if (el.placeholder !== undefined && el.tagName === 'INPUT') {
          el.placeholder = map[key];
        } else if (el.tagName === 'TITLE') {
          // handled below
        } else {
          el.textContent = map[key];
        }
      }
    });
    document.title = map['我的网盘'] || 'My Pan';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStatic);
  } else {
    applyStatic();
  }
})();
