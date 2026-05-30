// Share page preview/download module — mirrors pages/public/app.js preview logic
// Loaded by Worker-generated share pages (single-file & folder views)
(function () {
  // File type detection — mirrors app.js
  var TEXT_EXTS = new Set([
    'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'csv', 'log',
    'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css',
    'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'go', 'rs', 'php', 'sql', 'swift', 'kt',
    'r', 'm', 'mm', 'scala', 'lua', 'pl', 'pm', 'dart', 'ex', 'exs',
    'toml', 'ini', 'cfg', 'conf', 'env', 'editorconfig', 'gitignore', 'properties',
    'bat', 'cmd', 'ps1', 'tex', 'bib', 'makefile', 'dockerfile',
    'vue', 'svelte', 'astro',
  ]);

  var MEDIA_EXTS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
    'mp4', 'webm', 'ogg',
    'mp3', 'wav', 'flac',
  ]);

  var PDF_EXTS = new Set(['pdf']);

  var OFFICE_EXTS = new Set(['docx', 'xlsx', 'pptx', 'xls']);

  function getPreviewType(key) {
    var ext = (key.split('.').pop() || '').toLowerCase();
    if (TEXT_EXTS.has(ext)) return 'text';
    if (MEDIA_EXTS.has(ext)) return 'media';
    if (PDF_EXTS.has(ext)) return 'pdf';
    if (OFFICE_EXTS.has(ext)) return 'office';
    return null;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function xhrGetBuffer(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error('HTTP ' + xhr.status));
      });
      xhr.addEventListener('error', function () { reject(new Error('Network error')); });
      xhr.send();
    });
  }

  // Config set by init()
  var stok = '';

  var previewKey = '';
  var overlayEl, iframeEl, pdfEl, officeEl, titleEl, charsetGroupEl, charsetEl, loadingEl;

  function ensureOverlay() {
    if (overlayEl) return;
    var div = document.createElement('div');
    div.innerHTML =
      '<div class="preview-overlay" id="preview-overlay">' +
      '  <div class="preview-container">' +
      '    <div class="preview-header">' +
      '      <span class="preview-title" id="preview-title"></span>' +
      '      <div class="preview-header-right">' +
      '        <span class="preview-charset-group" id="preview-charset-group">' +
      '          <span data-i18n="编码">' + t('编码') + '</span>' +
      '          <select class="preview-charset" id="preview-charset">' +
      '            <option value="utf-8">UTF-8</option>' +
      '            <option value="gbk">GBK</option>' +
      '            <option value="gb2312">GB2312</option>' +
      '            <option value="gb18030">GB18030</option>' +
      '            <option value="big5">Big5</option>' +
      '            <option value="shift_jis">Shift_JIS</option>' +
      '            <option value="euc-jp">EUC-JP</option>' +
      '            <option value="euc-kr">EUC-KR</option>' +
      '            <option value="iso-8859-1">Latin-1</option>' +
      '            <option value="windows-1252">Windows-1252</option>' +
      '          </select>' +
      '        </span>' +
      '        <button class="preview-close" id="preview-close">&times;</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="preview-body">' +
      '      <div class="preview-loading" id="preview-loading"></div>' +
      '      <iframe id="preview-iframe" allow="fullscreen; autoplay" sandbox="allow-scripts allow-same-origin" style="display:none"></iframe>' +
      '      <div id="preview-pdf" class="preview-pdf-container" style="display:none"></div>' +
      '      <div id="preview-office" class="preview-office-container" style="display:none"></div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(div.firstElementChild);
    overlayEl = document.getElementById('preview-overlay');
    iframeEl = document.getElementById('preview-iframe');
    pdfEl = document.getElementById('preview-pdf');
    officeEl = document.getElementById('preview-office');
    titleEl = document.getElementById('preview-title');
    charsetGroupEl = document.getElementById('preview-charset-group');
    charsetEl = document.getElementById('preview-charset');
    loadingEl = document.getElementById('preview-loading');

    iframeEl.addEventListener('load', function () {
      loadingEl.style.display = 'none';
      iframeEl.style.display = '';
    });

    // Event listeners (mirrors app.js)
    charsetEl.addEventListener('change', function () {
      if (previewKey) doPreview(previewKey);
    });
    document.getElementById('preview-close').addEventListener('click', closePreview);
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closePreview();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlayEl.classList.contains('visible')) closePreview();
    });
  }

  function showPreview(key, url, isText) {
    previewKey = key;
    ensureOverlay();
    charsetGroupEl.style.display = isText ? 'flex' : 'none';
    titleEl.textContent = key;

    loadingEl.style.display = '';
    iframeEl.style.display = 'none';
    pdfEl.style.display = 'none';
    officeEl.style.display = 'none';

    var ptype = getPreviewType(key);
    if (ptype === 'text' || ptype === 'media') {
      iframeEl.src = url;
    } else if (ptype === 'pdf') {
      loadingEl.style.display = 'none';
      renderPdf(url, key);
    } else if (ptype === 'office') {
      loadingEl.style.display = 'none';
      renderOffice(url, key);
    }

    overlayEl.classList.add('visible');
  }

  function closePreview() {
    previewKey = '';
    if (overlayEl) {
      overlayEl.classList.remove('visible');
    }
    if (loadingEl) { loadingEl.style.display = ''; }
    if (iframeEl) { iframeEl.src = ''; iframeEl.style.display = 'none'; }
    if (pdfEl) { pdfEl.style.display = 'none'; pdfEl.innerHTML = ''; }
    if (officeEl) { officeEl.style.display = 'none'; officeEl.innerHTML = ''; }
  }

  function doPreview(key) {
    var charset = charsetEl ? charsetEl.value : 'utf-8';
    var u = '/api/preview/' + encodeURIComponent(key) + '?share_token=' + encodeURIComponent(stok) + '&charset=' + charset;
    fetch(u)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { showPreview(key, d.url, d.text); })
      .catch(function (e) {
        ensureOverlay();
        overlayEl.classList.add('visible');
        iframeEl.style.display = '';
        iframeEl.src = 'data:text/html,<h2 style=padding:20px;color:red>' + esc(e.message) + '</h2>';
      });
  }

  function doDownload(key) {
    fetch('/api/files/' + encodeURIComponent(key) + '?share_token=' + encodeURIComponent(stok))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { triggerDownload(d.url); })
      .catch(function (e) { console.error('[my-pan] share download error:', e); });
  }

  function triggerDownload(url) {
    var a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // PDF rendering (mirrors app.js renderPdf)
  function renderPdf(url, key) {
    var container = pdfEl;
    container.style.display = '';
    container.innerHTML = '<div class="preview-loading">' + t('加载中...') + '</div>';
    if (typeof pdfjsLib === 'undefined') {
      container.innerHTML = '<div class="preview-error">' + t('PDF 预览库未加载') + '</div>';
      return;
    }
    xhrGetBuffer(url).then(function (arrayBuffer) {
      return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }).then(function (pdf) {
      container.innerHTML = '';
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
      return pages.reduce(function (chain, pageNum) {
        return chain.then(function () {
          return pdf.getPage(pageNum).then(function (page) {
            var viewport = page.getViewport({ scale: 1.5 });
            var canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            var ctx = canvas.getContext('2d');
            return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
              container.appendChild(canvas);
            });
          });
        });
      }, Promise.resolve());
    }).catch(function (err) {
      console.error('[my-pan] renderPdf:', err);
      container.innerHTML = '<div class="preview-error">' + t('PDF 加载失败') + ': ' + esc(err.message) + '</div>';
    });
  }

  // Office rendering (mirrors app.js renderOffice)
  function renderOffice(url, key) {
    var container = officeEl;
    container.style.display = '';
    container.innerHTML = '<div class="preview-loading">' + t('加载中...') + '</div>';
    var ext = (key.split('.').pop() || '').toLowerCase();
    xhrGetBuffer(url).then(function (arrayBuffer) {
      if (ext === 'docx') {
        if (typeof mammoth === 'undefined') throw new Error(t('mammoth.js 未加载'));
        return mammoth.convertToHtml({ arrayBuffer: arrayBuffer }).then(function (result) {
          container.innerHTML = result.value;
        });
      } else if (ext === 'xlsx' || ext === 'xls') {
        if (typeof XLSX === 'undefined') throw new Error(t('SheetJS 未加载'));
        var workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        var html = '';
        workbook.SheetNames.forEach(function (name) {
          html += '<div class="xlsx-sheet"><h3>' + esc(name) + '</h3>' +
            XLSX.utils.sheet_to_html(workbook.Sheets[name]) + '</div>';
        });
        container.innerHTML = html;
      } else if (ext === 'pptx') {
        container.innerHTML = '<div class="preview-error">' + t('PPTX 预览暂不支持，请下载后查看') + '</div>';
      } else {
        container.innerHTML = '<div class="preview-error">' + t('不支持的文档格式') + '</div>';
      }
    }).catch(function (err) {
      console.error('[my-pan] renderOffice:', err);
      container.innerHTML = '<div class="preview-error">' + t('文档加载失败') + ': ' + esc(err.message) + '</div>';
    });
  }

  window.SharePreview = {
    init: function (opts) {
      stok = opts.shareToken || '';
    },
    preview: function (key) { if (charsetEl) charsetEl.value = 'utf-8'; doPreview(key); },
    download: function (key) { doDownload(key); },
    close: closePreview,
    getPreviewType: getPreviewType,
  };
})();
