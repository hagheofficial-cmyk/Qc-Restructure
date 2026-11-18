/* =========================================================================
 * protect.js — حفاظت سمت مرورگر، جلوگیری از ذخیره/مشاهده سورس و واترمارک نشست
 * کاملاً سازگار با Google Apps Script HtmlService.
 * ========================================================================= */
(function () {
'use strict';

var state = {
  blockInspect: false,
  watermark: false,
  watermarkText: '',
  userLabel: '',
  orgName: '',
  listenersInstalled: false,
  observer: null,
  lastToastAt: 0
};

function defaultProtection() {
  var isGas = !!window.APP_SCRIPT_MODE;
  return {
    blockInspect: isGas,
    watermark: isGas,
    watermarkText: ''
  };
}

function normalizeProtection(settings) {
  var def = defaultProtection();
  var p = (settings && settings.protection && typeof settings.protection === 'object') ? settings.protection : null;
  if (!p) return def;
  return {
    blockInspect: p.blockInspect === undefined ? def.blockInspect : !!p.blockInspect,
    watermark: p.watermark === undefined ? def.watermark : !!p.watermark,
    watermarkText: p.watermarkText == null ? '' : String(p.watermarkText).trim().slice(0, 80)
  };
}

function isEditableTarget(target) {
  if (!target || !target.tagName) return false;
  var tag = String(target.tagName).toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function notifyBlocked() {
  var now = Date.now();
  if (now - state.lastToastAt < 2500) return;
  state.lastToastAt = now;
  try {
    if (window.UI && window.UI.toast && typeof window.UI.toast.info === 'function') {
      window.UI.toast.info('این سامانه محافظت‌شده است؛ ذخیره صفحه و مشاهده سورس غیرفعال شده است.');
    }
  } catch (e) {}
}

function onKeyDown(e) {
  if (!state.blockInspect) return;
  var key = String(e.key || '').toLowerCase();
  var mod = !!(e.ctrlKey || e.metaKey);
  var shift = !!e.shiftKey;
  var alt = !!e.altKey;
  var blocked = false;
  if (key === 'f12') blocked = true;
  else if (mod && key === 'u') blocked = true;
  else if (mod && key === 's') blocked = true;
  else if (mod && shift && (key === 'i' || key === 'j' || key === 'c')) blocked = true;
  else if (e.metaKey && alt && (key === 'i' || key === 'j' || key === 'c' || key === 'u')) blocked = true;
  if (blocked) {
    e.preventDefault();
    e.stopPropagation();
    notifyBlocked();
  }
}

function onContextMenu(e) {
  if (!state.blockInspect) return;
  if (isEditableTarget(e.target)) return;
  e.preventDefault();
}

function installListeners() {
  if (state.listenersInstalled || typeof document === 'undefined') return;
  state.listenersInstalled = true;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
}

function todayLabel() {
  try {
    if (window.QCCalc && window.QCCalc.todayJalali && window.QCCalc.formatJalali) {
      var d = window.QCCalc.formatJalali(window.QCCalc.todayJalali());
      return window.QCCalc.toFaDigits ? window.QCCalc.toFaDigits(d) : d;
    }
  } catch (e) {}
  return '';
}

function buildWatermarkText() {
  var parts = [];
  if (state.watermarkText) parts.push(state.watermarkText);
  else if (state.orgName) parts.push(state.orgName);
  else parts.push('سامانه اختصاصی QC');
  if (state.userLabel) parts.push(state.userLabel);
  var dt = todayLabel();
  if (dt) parts.push(dt);
  return parts.join(' · ');
}

function removeWatermark() {
  if (state.observer) {
    try { state.observer.disconnect(); } catch (e) {}
    state.observer = null;
  }
  if (typeof document === 'undefined') return;
  var el = document.getElementById('qcWatermarkLayer');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function renderWatermark() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!state.watermark || !state.userLabel) {
    removeWatermark();
    return;
  }
  var label = buildWatermarkText();
  var existing = document.getElementById('qcWatermarkLayer');
  if (existing && existing.getAttribute('data-wm-text') === label) return;
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  var layer = document.createElement('div');
  layer.id = 'qcWatermarkLayer';
  layer.className = 'qc-watermark-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('data-wm-text', label);
  for (var i = 0; i < 6; i++) {
    var span = document.createElement('span');
    span.className = 'qc-watermark-item';
    span.textContent = label;
    layer.appendChild(span);
  }
  document.body.appendChild(layer);

  if (!state.observer && typeof MutationObserver !== 'undefined') {
    state.observer = new MutationObserver(function () {
      if (!state.watermark || !state.userLabel) return;
      var cur = document.getElementById('qcWatermarkLayer');
      if (!cur || cur.style.display === 'none' || cur.style.visibility === 'hidden') {
        renderWatermark();
      }
    });
    try {
      state.observer.observe(document.body, { childList: true, attributes: true, subtree: false });
    } catch (e) {}
  }
}

function hardenRuntimeGlobals(user) {
  if (!window.APP_SCRIPT_MODE) return;
  try { window.QC_SEED = null; } catch (e) {}
  if (window.LocalApi && !window.LocalApi.__qcHardened) {
    var origBackup = window.LocalApi.backup;
    var origRestore = window.LocalApi.restore;
    window.LocalApi.backup = function () {
      var u = window.QCAuth && window.QCAuth.user;
      if (!u || u.role !== 'admin') throw new Error('دسترسی غیرمجاز به نسخه خام داده');
      return origBackup ? origBackup.apply(this, arguments) : null;
    };
    window.LocalApi.restore = function () {
      var u = window.QCAuth && window.QCAuth.user;
      if (!u || u.role !== 'admin') throw new Error('دسترسی غیرمجاز');
      return origRestore ? origRestore.apply(this, arguments) : null;
    };
    window.LocalApi.__qcHardened = true;
  }
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('qc-protected-ui', !!state.blockInspect);
  }
}

function apply(settings, user) {
  var cfg = normalizeProtection(settings);
  state.blockInspect = cfg.blockInspect;
  state.watermark = cfg.watermark;
  state.watermarkText = cfg.watermarkText;
  state.orgName = (settings && settings.orgName) ? String(settings.orgName).trim() : '';
  state.userLabel = (user && user.name) ? ('کاربر: ' + String(user.name).trim()) : '';
  installListeners();
  hardenRuntimeGlobals(user);
  renderWatermark();
}

function clear() {
  state.userLabel = '';
  removeWatermark();
}

function getStatus() {
  return {
    blockInspect: !!state.blockInspect,
    watermark: !!state.watermark,
    watermarkText: state.watermarkText || '',
    originLocked: !!window.__QC_ORIGIN_LOCKED__,
    buildProtected: !!window.__QC_BUILD_PROTECTED__,
    appScriptMode: !!window.APP_SCRIPT_MODE
  };
}

window.QCProtect = {
  apply: apply,
  clear: clear,
  getStatus: getStatus,
  normalize: normalizeProtection
};

if (window.APP_SCRIPT_MODE) {
  state.blockInspect = true;
  state.watermark = true;
  installListeners();
}
})();
