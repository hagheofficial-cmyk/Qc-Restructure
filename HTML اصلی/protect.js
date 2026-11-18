/* =========================================================================\n * protect.js — حفاظت سمت مرورگر، جلوگیری از ذخیره/مشاهده سورس
 * کاملاً سازگار با Google Apps Script HtmlService.
 * ========================================================================= */
(function () {
'use strict';

var state = {
  blockInspect: false,
  listenersInstalled: false,
  lastToastAt: 0
};

function defaultProtection() {
  var isGas = !!window.APP_SCRIPT_MODE;
  return {
    blockInspect: isGas
  };
}

function normalizeProtection(settings) {
  var def = defaultProtection();
  var p = (settings && settings.protection && typeof settings.protection === 'object') ? settings.protection : null;
  if (!p) return def;
  return {
    blockInspect: p.blockInspect === undefined ? def.blockInspect : !!p.blockInspect
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
  installListeners();
  hardenRuntimeGlobals(user);
}

function clear() {
  /* در خروج از نشست: nothing to repaint؛ روند محافظت فقط با apply دوباره تنظیم می‌شود. */
}

function getStatus() {
  return {
    blockInspect: !!state.blockInspect,
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
  installListeners();
}
})();
