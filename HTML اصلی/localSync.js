/* =========================================================================
 * localSync.js — موتور Local-First و صف ضدتداخل (Anti-Collision Outbox)
 *
 * هدف:
 *   ۱) تمام خواندن‌ها، تغییر بازه تاریخ، گزارش‌ها و پرونده کارشناس در چند میلی‌ثانیه
 *      مستقیماً روی حافظه محلی مرورگر (LocalApi) انجام شوند (بدون رفت‌وبرگشت ۵ ثانیه‌ای).
 *   ۲) تمام ثبت‌ها و اکشن‌های روزمره (تیکت، سوشال، اقدام، یادآور، ویرایش کارشناس)
 *      فوراً روی صفحه و RAM اعمال و از طریق یک صف FIFO ضدتداخل به گوگل شیت ذخیره شوند:
 *        - ادغام هوشمند قبل از ارسال (POST+PUT → یک POST، POST+DELETE → لغو کامل، PUT+PUT → یک PUT)
 *        - نگاشت خودکار شناسه موقت به شناسه واقعی سرور (tempId → serverId + updatedAt)
 *        - ارسال بسته‌ای زیر یک قفل سرور (POST /api/batch-sync)
 *        - کلید یکتاپذیری (opId) برای جلوگیری قطعی از ثبت تکراری یا لاگ اشتباه
 *        - مدیریت شفاف تعارض همزمانی (409 Conflict) بدون بازنویسی بی‌صدا
 *
 * این فایل عمداً بدون template literal (backtick) و بدون کامنت تک‌خطی نوشته شده
 * تا در برابر sanitizer سرور HtmlService گوگل Apps Script صددرصد ایمن باشد.
 * ========================================================================= */
(function () {
'use strict';

var IDB_NAME = 'crmqc_local_sync_v1';
var IDB_STORE = 'snapshots';
var MAX_RETRY_MS = 12000;

var state = {
  ready: false,
  hydrating: null,
  token: '',
  userKey: '',
  revision: '',
  outbox: [],
  inFlight: [],
  conflicts: [],
  idMap: {},
  lastError: '',
  drainTimer: null,
  retryTimer: null,
  retryCount: 0,
  opSeq: 0,
  flushWaiters: [],
  rawRequest: null
};

function isEnabled() {
  return !!(window.APP_SCRIPT_MODE || window.QC_LOCAL_SYNC_FORCE);
}

function isActive() {
  if (!isEnabled()) return false;
  if (!window.LocalApi || typeof window.LocalApi.run !== 'function') return false;
  var token = currentToken();
  return !!token;
}

function currentToken() {
  return (window.QCAuth && window.QCAuth.token) ? String(window.QCAuth.token) : '';
}

function currentUserKey() {
  var u = window.QCAuth && window.QCAuth.user;
  if (!u || !u.name) return '';
  try { return JSON.stringify(u); } catch (e) { return String(u.name); }
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function genOpId() {
  state.opSeq++;
  return 'op_' + Date.now().toString(36) + '_' + state.opSeq.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function splitUrl(url) {
  var s = String(url || '/');
  var idx = s.indexOf('?');
  return { path: idx >= 0 ? s.slice(0, idx) : s, qs: idx >= 0 ? s.slice(idx) : '' };
}

function parseEntity(pathOnly) {
  var m = String(pathOnly || '').match(/^\/api\/(tickets|socials|actions|reminders|agents)(?:\/([^/?#]+))?$/);
  if (!m) return null;
  var rawId = m[2] != null ? decodeURIComponent(m[2]) : null;
  if (rawId === 'bulk') return null;
  return { kind: m[1], id: rawId };
}

/* کدام مسیرهای خواندنی از RAM سرو می‌شوند */
function isLocalRead(url) {
  var parts = splitUrl(url);
  var p = parts.path;
  if (p.indexOf('/api/') !== 0) return false;
  if (p.indexOf('/api/auth/') === 0) return false;
  if (p === '/api/revision' || p === '/api/local-sync' || p === '/api/batch-sync' || p === '/api/backup') return false;
  if (p === '/api/calls' && parts.qs.indexOf('full=1') >= 0) return false;
  return true;
}

/* کدام مسیرهای نوشتنی به‌صورت آنی (Optimistic + Outbox) اجرا می‌شوند */
function isOptimisticWrite(method, url) {
  var m = String(method || '').toUpperCase();
  var p = splitUrl(url).path;
  if (m === 'GET') return false;
  if (p === '/api/tickets' && m === 'POST') return true;
  if (/^\/api\/tickets\/[^/]+$/.test(p) && (m === 'PUT' || m === 'DELETE')) return true;
  if (p === '/api/socials' && m === 'POST') return true;
  if (/^\/api\/socials\/[^/]+$/.test(p) && (m === 'PUT' || m === 'DELETE')) return true;
  if (p === '/api/actions' && m === 'POST') return true;
  if (/^\/api\/actions\/[^/]+$/.test(p) && (m === 'PUT' || m === 'DELETE')) return true;
  if (p === '/api/reminders' && m === 'POST') return true;
  if (/^\/api\/reminders\/[^/]+$/.test(p) && (m === 'PUT' || m === 'DELETE')) return true;
  if (p === '/api/action-types' && (m === 'POST' || m === 'DELETE')) return true;
  if (p === '/api/agents' && m === 'POST') return true;
  if (/^\/api\/agents\/[^/]+$/.test(p) && p !== '/api/agents/bulk' && (m === 'PUT' || m === 'DELETE')) return true;
  if (p === '/api/qc-agents' && m === 'POST') return true;
  if (/^\/api\/qc-agents\/[^/]+$/.test(p) && m === 'DELETE') return true;
  if ((p === '/api/settings' || p === '/api/criteria' || p === '/api/fiscal-months') && m === 'PUT') return true;
  if (/^\/api\/fiscal-months\/[^/]+$/.test(p) && m === 'DELETE') return true;
  return false;
}

/* ----------------------------------------------------------- لایه IndexedDB */
function openIdb() {
  return new Promise(function (resolve) {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
}

function idbGet(key) {
  return openIdb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  });
}

function idbPut(record) {
  return openIdb().then(function (db) {
    if (!db) return;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  });
}

function idbClearAll() {
  return openIdb().then(function (db) {
    if (!db) return;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  });
}

function persistSnapshotAsync() {
  if (!state.ready || !state.token || !state.userKey) return;
  try {
    var live = window.LocalApi && window.LocalApi.liveDb ? window.LocalApi.liveDb() : null;
    if (!live) return;
    idbPut({
      key: state.token,
      userKey: state.userKey,
      revision: state.revision,
      at: Date.now(),
      db: live
    });
  } catch (e) {}
}

/* ------------------------------------------- نگاشت شناسه‌های موقت و به‌روزرسانی RAM/DOM */
function resolveUrlAndBody(method, url, body) {
  var parts = splitUrl(url);
  var parsed = parseEntity(parts.path);
  var outUrl = url;
  var outBody = body && typeof body === 'object' ? clone(body) : body;
  if (parsed && parsed.id != null) {
    var mapped = state.idMap[parsed.kind + ':' + parsed.id];
    if (mapped && mapped.id != null) {
      outUrl = '/api/' + parsed.kind + '/' + encodeURIComponent(String(mapped.id)) + parts.qs;
      if (String(method || '').toUpperCase() === 'PUT' && outBody && typeof outBody === 'object' && mapped.updatedAt) {
        if (!outBody.baseUpdatedAt || outBody.baseUpdatedAt === mapped.localUpdatedAt) {
          outBody.baseUpdatedAt = mapped.updatedAt;
        }
      }
    }
  }
  return { url: outUrl, body: outBody };
}

function patchDomIds(kind, oldId, newId) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  var o = String(oldId);
  var n = String(newId);
  if (!o || o === n) return;
  try {
    var sels = [
      ['[data-id="' + o + '"]', 'data-id'],
      ['[data-aid="' + o + '"]', 'data-aid'],
      ['[data-result-id="' + o + '"]', 'data-result-id'],
      ['[data-status-id="' + o + '"]', 'data-status-id'],
      ['[data-del-action="' + o + '"]', 'data-del-action'],
      ['[data-rem-toggle="' + o + '"]', 'data-rem-toggle'],
      ['[data-rem-del="' + o + '"]', 'data-rem-del']
    ];
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i][0]);
      for (var j = 0; j < nodes.length; j++) {
        nodes[j].setAttribute(sels[i][1], n);
      }
    }
    var recKind = kind === 'tickets' ? 'ticket' : kind === 'socials' ? 'social' : '';
    if (recKind) {
      var recNodes = document.querySelectorAll('[data-rec="' + recKind + ':' + o + '"]');
      for (var k = 0; k < recNodes.length; k++) {
        recNodes[k].setAttribute('data-rec', recKind + ':' + n);
      }
    }
  } catch (e) {}
}

function reconcileLocalRecord(kind, tempId, serverRow, localUpdatedAt) {
  if (!kind || !serverRow || serverRow.id == null) return;
  var live = window.LocalApi && window.LocalApi.liveDb ? window.LocalApi.liveDb() : null;
  if (!live) return;
  var oldNum = Number(tempId);
  var newNum = Number(serverRow.id);
  var serverUpdatedAt = serverRow.updatedAt ? String(serverRow.updatedAt) : '';

  if (tempId != null && tempId !== '') {
    state.idMap[kind + ':' + String(tempId)] = {
      id: serverRow.id,
      updatedAt: serverUpdatedAt,
      localUpdatedAt: localUpdatedAt || ''
    };
  }
  state.idMap[kind + ':' + String(serverRow.id)] = {
    id: serverRow.id,
    updatedAt: serverUpdatedAt,
    localUpdatedAt: localUpdatedAt || ''
  };
  var aliasPrefix = kind + ':';
  var mapKeys = Object.keys(state.idMap);
  for (var m = 0; m < mapKeys.length; m++) {
    var mk = mapKeys[m];
    if (mk.indexOf(aliasPrefix) === 0 && state.idMap[mk] && String(state.idMap[mk].id) === String(serverRow.id)) {
      state.idMap[mk].updatedAt = serverUpdatedAt;
      if (localUpdatedAt) state.idMap[mk].localUpdatedAt = localUpdatedAt;
    }
  }

  /* به‌روزرسانی رکورد در RAM محلی فقط اگر تغییر جدیدتری در صف برای همین رکورد نباشد */
  var hasQueuedEdit = state.outbox.some(function (op) {
    var p = parseEntity(splitUrl(op.url).path);
    return p && p.kind === kind && (String(p.id) === String(tempId) || String(p.id) === String(serverRow.id));
  });

  if (kind === 'tickets' || kind === 'socials' || kind === 'reminders' || kind === 'agents') {
    var arr = live[kind];
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].id) === String(tempId) || (tempId == null && String(arr[i].id) === String(serverRow.id))) {
          arr[i].id = isNaN(newNum) ? serverRow.id : newNum;
          if (!hasQueuedEdit && serverUpdatedAt) arr[i].updatedAt = serverUpdatedAt;
          if (!hasQueuedEdit && serverRow.createdAt) arr[i].createdAt = serverRow.createdAt;
          break;
        }
      }
    }
    var seqKey = kind === 'tickets' ? 'ticket' : kind === 'socials' ? 'social' : kind === 'reminders' ? 'reminder' : 'agent';
    if (live.seq && !isNaN(newNum)) live.seq[seqKey] = Math.max(Number(live.seq[seqKey]) || 1, newNum + 1);
  } else if (kind === 'actions' && live.agentActions) {
    var agentNames = Object.keys(live.agentActions);
    for (var a = 0; a < agentNames.length; a++) {
      var list = live.agentActions[agentNames[a]] || [];
      for (var j = 0; j < list.length; j++) {
        if (String(list[j].id) === String(tempId) || (tempId == null && String(list[j].id) === String(serverRow.id))) {
          list[j].id = isNaN(newNum) ? serverRow.id : newNum;
          if (!hasQueuedEdit && serverUpdatedAt) list[j].updatedAt = serverUpdatedAt;
          break;
        }
      }
    }
    if (live.seq && !isNaN(newNum)) live.seq.action = Math.max(Number(live.seq.action) || 1, newNum + 1);
  }

  /* بازنویسی عملیات منتظر در صف (outbox):
   * - اگر رکورد جدید با tempId بود، هم URL به شناسه‌ی واقعی سرور و هم baseUpdatedAt اصلاح می‌شود.
   * - اگر ویرایش پیاپی روی رکورد موجود در زمان in-flight بود، baseUpdatedAt به زمان واقعی سرور ارتقا می‌یابد. */
  var matchId = (tempId != null && tempId !== '') ? String(tempId) : String(serverRow.id);
  for (var q = 0; q < state.outbox.length; q++) {
    var queued = state.outbox[q];
    var qParts = splitUrl(queued.url);
    var qEnt = parseEntity(qParts.path);
    if (qEnt && qEnt.kind === kind && (String(qEnt.id) === matchId || String(qEnt.id) === String(serverRow.id))) {
      if (tempId != null && tempId !== '' && String(qEnt.id) === String(tempId)) {
        queued.url = '/api/' + kind + '/' + encodeURIComponent(String(serverRow.id)) + qParts.qs;
      }
      if (queued.method === 'PUT' && queued.body && serverUpdatedAt) {
        if (!queued.body.baseUpdatedAt || queued.body.baseUpdatedAt === localUpdatedAt) {
          queued.body.baseUpdatedAt = serverUpdatedAt;
        }
      }
    }
  }
  if (tempId != null && tempId !== '' && String(oldNum) !== String(newNum)) {
    patchDomIds(kind, tempId, serverRow.id);
  }
}

/* ------------------------------------------- ادغام هوشمند عملیات صف (Coalescing) */
function enqueueOp(method, url, body, localResult) {
  var m = String(method || '').toUpperCase();
  var parts = splitUrl(url);
  var ent = parseEntity(parts.path);
  var cleanBody = body && typeof body === 'object' ? clone(body) : {};
  var localUpdatedAt = (localResult && localResult.updatedAt) ? String(localResult.updatedAt) : '';

  /* حالت ۱: ویرایش رکوردی که هنوز POST ایجادش در صف (ارسال‌نشده) است → ادغام در همان POST */
  if (ent && ent.id != null && m === 'PUT') {
    for (var i = state.outbox.length - 1; i >= 0; i--) {
      var prev = state.outbox[i];
      if (prev.method === 'POST' && prev.kind === ent.kind && String(prev.tempId) === String(ent.id)) {
        var merged = clone(cleanBody);
        delete merged.baseUpdatedAt;
        delete merged.overwrite;
        prev.body = Object.assign({}, prev.body, merged);
        prev.localUpdatedAt = localUpdatedAt || prev.localUpdatedAt;
        updateSyncUi();
        scheduleDrain();
        return;
      }
      /* حالت ۲: دو ویرایش پیاپی روی یک رکورد در صف → یکی شدن با حفظ baseUpdatedAt اولیه */
      var prevEnt = parseEntity(splitUrl(prev.url).path);
      if (prev.method === 'PUT' && prevEnt && prevEnt.kind === ent.kind && String(prevEnt.id) === String(ent.id)) {
        var origBase = prev.body && prev.body.baseUpdatedAt;
        var nextBody = Object.assign({}, prev.body, cleanBody);
        if (origBase && !cleanBody.overwrite) nextBody.baseUpdatedAt = origBase;
        prev.body = nextBody;
        prev.localUpdatedAt = localUpdatedAt || prev.localUpdatedAt;
        updateSyncUi();
        scheduleDrain();
        return;
      }
    }
  }

  /* حالت ۳: حذف رکوردی که هنوز POST ایجادش ارسال نشده → حذف هر دو (صفر درخواست به شیت!) */
  if (ent && ent.id != null && m === 'DELETE') {
    for (var d = state.outbox.length - 1; d >= 0; d--) {
      var prevD = state.outbox[d];
      if (prevD.method === 'POST' && prevD.kind === ent.kind && String(prevD.tempId) === String(ent.id)) {
        state.outbox.splice(d, 1);
        updateSyncUi();
        notifyFlushWaiters();
        return;
      }
      /* اگر PUT ارسال‌نشده برای همین رکورد در صف بود، قبل از DELETE پاک شود */
      var prevDEnt = parseEntity(splitUrl(prevD.url).path);
      if (prevD.method === 'PUT' && prevDEnt && prevDEnt.kind === ent.kind && String(prevDEnt.id) === String(ent.id)) {
        state.outbox.splice(d, 1);
      }
    }
  }

  /* حالت ۴: تنظیمات/ماه‌های مالی/معیارها (PUT جایگزین کامل) → آخرین مقدار در صف بماند */
  if (m === 'PUT' && (parts.path === '/api/settings' || parts.path === '/api/fiscal-months')) {
    for (var s = state.outbox.length - 1; s >= 0; s--) {
      if (state.outbox[s].method === 'PUT' && splitUrl(state.outbox[s].url).path === parts.path) {
        state.outbox[s].body = Object.assign({}, state.outbox[s].body, cleanBody);
        updateSyncUi();
        scheduleDrain();
        return;
      }
    }
  }

  var op = {
    opId: genOpId(),
    method: m,
    url: url,
    body: cleanBody,
    kind: ent ? ent.kind : null,
    tempId: (m === 'POST' && ent && ent.id == null && localResult && localResult.id != null) ? String(localResult.id) : null,
    localUpdatedAt: localUpdatedAt,
    createdAt: Date.now()
  };
  state.outbox.push(op);
  state.lastError = '';
  updateSyncUi();
  scheduleDrain();
}

function scheduleDrain(immediate) {
  clearTimeout(state.drainTimer);
  if (state.inFlight.length) return;
  if (!state.outbox.length) { notifyFlushWaiters(); return; }
  var delay = immediate ? 0 : (typeof QCLocalSync.debounceMs === 'number' ? QCLocalSync.debounceMs : 350);
  state.drainTimer = setTimeout(function () {
    state.drainTimer = null;
    drainOutbox();
  }, delay);
}

function notifyFlushWaiters() {
  if (state.outbox.length || state.inFlight.length) return;
  var waiters = state.flushWaiters.slice();
  state.flushWaiters = [];
  for (var i = 0; i < waiters.length; i++) {
    try { waiters[i](); } catch (e) {}
  }
}

async function drainOutbox() {
  if (state.inFlight.length || !state.outbox.length) {
    notifyFlushWaiters();
    return;
  }
  if (!state.rawRequest || !currentToken()) return;
  clearTimeout(state.retryTimer);
  state.retryTimer = null;

  var batch = state.outbox.splice(0, 25);
  state.inFlight = batch;
  state.lastError = '';
  updateSyncUi();

  try {
    var payload = {
      ops: batch.map(function (op) {
        return {
          opId: op.opId,
          method: op.method,
          url: op.url,
          body: op.body,
          tempId: op.tempId || undefined,
          localUpdatedAt: op.localUpdatedAt || undefined
        };
      })
    };
    var resp = await state.rawRequest('POST', '/api/batch-sync', payload);
    var results = (resp && Array.isArray(resp.results)) ? resp.results : [];
    var rev = resp && resp.revision ? String(resp.revision) : '';
    if (rev) {
      state.revision = rev;
      if (window.App && typeof window.App.noteRevision === 'function') window.App.noteRevision(rev);
    }

    var hadConflict = false;
    for (var i = 0; i < batch.length; i++) {
      var op = batch[i];
      var res = results[i] || { ok: false, status: 500, error: 'پاسخ سرور برای این عملیات دریافت نشد.' };
      if (res.ok) {
        if (op.method === 'POST' && op.kind && op.tempId && res.data && res.data.id != null) {
          reconcileLocalRecord(op.kind, op.tempId, res.data, op.localUpdatedAt);
        } else if (op.method === 'PUT' && op.kind && res.data && res.data.id != null) {
          reconcileLocalRecord(op.kind, null, res.data, op.localUpdatedAt);
        }
      } else {
        hadConflict = true;
        state.conflicts.push({
          op: op,
          status: res.status || 500,
          error: res.error || 'خطا در همگام‌سازی با شیت',
          conflict: res.conflict || null,
          at: Date.now()
        });
      }
    }

    state.inFlight = [];
    state.retryCount = 0;
    persistSnapshotAsync();
    updateSyncUi();

    if (hadConflict) {
      notifyConflictUser();
    }
    if (state.outbox.length) {
      scheduleDrain(true);
    } else {
      notifyFlushWaiters();
    }
  } catch (err) {
    state.inFlight = [];
    if (err && err.status === 401) {
      state.outbox = [];
      reset();
      notifyFlushWaiters();
      return;
    }
    /* خطای موقت شبکه/سرور: عملیات با همان opId به ابتدای صف برمی‌گردد (بدون ثبت تکراری) */
    state.outbox = batch.concat(state.outbox);
    state.lastError = (err && err.message) ? err.message : 'خطا در اتصال به گوگل شیت';
    state.retryCount++;
    updateSyncUi();
    if (state.retryCount <= 4) {
      var waitMs = Math.min(MAX_RETRY_MS, 1500 * Math.pow(2, state.retryCount - 1));
      state.retryTimer = setTimeout(function () {
        state.retryTimer = null;
        drainOutbox();
      }, waitMs);
    } else {
      if (window.UI && window.UI.toast) {
        window.UI.toast.error('ذخیره در شیت با خطا مواجه شد؛ روی نشانگر همگام‌سازی بالا کلیک کنید.', 6000);
      }
      notifyFlushWaiters();
    }
  }
}

function flush() {
  if (!state.outbox.length && !state.inFlight.length) return Promise.resolve();
  return new Promise(function (resolve) {
    state.flushWaiters.push(resolve);
    if (!state.inFlight.length) scheduleDrain(true);
  });
}

/* --------------------------------------------------- بارگذاری اولیه (Hydration) */
async function hydrate(forceServer) {
  if (!isActive() || !state.rawRequest) return false;
  var token = currentToken();
  var uKey = currentUserKey();
  if (!token) return false;

  if (state.token !== token || state.userKey !== uKey) {
    resetInternal(false);
    state.token = token;
    state.userKey = uKey;
  }

  if (!forceServer && state.ready) return true;
  if (state.hydrating) return state.hydrating;

  var work = (async function () {
    /* گام ۱: اگر اسنپ‌شات همین نشست در IndexedDB هست، فوری بالا بیاور و revision چک کن */
    if (!forceServer) {
      var cached = await idbGet(token);
      if (cached && cached.db && cached.userKey === uKey && currentToken() === token) {
        try {
          window.LocalApi.adoptSnapshot(cached.db);
          if (window.QCAuth && window.QCAuth.user) window.LocalApi.setSession(window.QCAuth.user);
          state.revision = String(cached.revision || '');
          state.ready = true;
          updateSyncUi();
          /* بررسی بی‌صدا در پس‌زمینه: فقط اگر نسخه شیت تغییر کرده بود دوباره دانلود کن */
          verifyRevisionInBackground();
          return true;
        } catch (e) {}
      }
    }

    /* گام ۲: دانلود یک‌باره اسنپ‌شات احرازشده و محدودشده از سرور */
    updateSyncUi('loading');
    var snap = await state.rawRequest('GET', '/api/local-sync');
    if (currentToken() !== token) return false;
    if (!snap || !snap.db) return false;
    window.LocalApi.adoptSnapshot(snap.db);
    if (window.QCAuth && window.QCAuth.user) window.LocalApi.setSession(window.QCAuth.user);
    state.revision = String(snap.revision || '');
    state.idMap = {};
    state.ready = true;
    if (window.App && state.revision && typeof window.App.noteRevision === 'function') {
      window.App.noteRevision(state.revision);
    }
    persistSnapshotAsync();
    updateSyncUi();
    return true;
  })();

  state.hydrating = work;
  try { return await work; }
  catch (e) {
    updateSyncUi();
    return false;
  }
  finally {
    if (state.hydrating === work) state.hydrating = null;
  }
}

async function verifyRevisionInBackground() {
  if (!state.ready || !state.rawRequest || state.outbox.length || state.inFlight.length) return;
  try {
    var r = await state.rawRequest('GET', '/api/revision');
    var serverRev = r && r.revision != null ? String(r.revision) : '';
    if (serverRev && state.revision && serverRev !== state.revision && !state.outbox.length && !state.inFlight.length) {
      await hydrate(true);
      if (window.App && typeof window.App.markStale === 'function') {
        window.App.markStale(Number(serverRev.split('-')[0]) || Date.now());
      }
    }
  } catch (e) {}
}

/* ------------------------------------------- نقطه ورودی یکپارچه از app.js */
async function intercept(method, url, body, rawRequestFn) {
  state.rawRequest = rawRequestFn;
  var m = String(method || 'GET').toUpperCase();
  var token = currentToken();
  var uKey = currentUserKey();

  if (!isActive()) return rawRequestFn(m, url, body);
  if (state.token && (state.token !== token || state.userKey !== uKey)) {
    resetInternal(true);
  }

  /* مسیرهای همیشه مستقیم (احراز هویت، نسخه، اسنپ‌شات، بک‌اپ) */
  if (m === 'GET' && !isLocalRead(url)) {
    return rawRequestFn(m, url, body);
  }

  /* اگر اسنپ‌شات محلی هنوز آماده نشده، یک‌بار هیدراته کن */
  if (!state.ready) {
    var ok = await hydrate(false);
    if (!ok) return rawRequestFn(m, url, body);
  }

  /* تمام خواندن‌ها → مستقیم روی حافظه محلی (چند میلی‌ثانیه!) */
  if (m === 'GET') {
    var resolvedGet = resolveUrlAndBody('GET', url, null);
    if (window.QCAuth && window.QCAuth.user) window.LocalApi.setSession(window.QCAuth.user);
    return window.LocalApi.run('GET', resolvedGet.url);
  }

  /* نوشتن‌های روزمره (تیکت، سوشال، اقدام، یادآور، کارشناس تکی، تنظیمات) → آنی + صف ضدتداخل */
  if (isOptimisticWrite(m, url)) {
    var resolved = resolveUrlAndBody(m, url, body);
    if (window.QCAuth && window.QCAuth.user) window.LocalApi.setSession(window.QCAuth.user);
    /* اعتبارسنجی و اجرای فوری روی RAM؛ اگر خطا داشت (مثلاً فیلد ناقص یا ۴۰۳) اصلاً در صف نمی‌رود */
    var localRes = window.LocalApi.run(m, resolved.url, resolved.body);
    enqueueOp(m, resolved.url, resolved.body, localRes);
    persistSnapshotAsync();
    return localRes;
  }

  /* نوشتن‌های سنگین/مدیریتی (ایمپورت اکسل، بک‌اپ، دمو، کاربران QC، حذف گروهی):
   * ابتدا صف فعلی تخلیه می‌شود تا ترتیب زمانی حفظ شود، سپس مستقیم روی شیت و تازه‌سازی RAM. */
  await flush();
  var serverRes = await rawRequestFn(m, url, body);
  if (splitUrl(url).path.indexOf('/api/auth/') !== 0) {
    await hydrate(true);
  }
  return serverRes;
}

/* ------------------------------------------- نشانگر وضعیت همگام‌سازی و مودال تعارض */
function faDigits(n) {
  return window.QCCalc && window.QCCalc.toFaDigits ? window.QCCalc.toFaDigits(n) : String(n);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function updateSyncUi(overrideState) {
  if (typeof document === 'undefined') return;
  var pill = document.getElementById('syncStatusPill');
  if (!pill) return;
  if (!isActive()) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  var pending = state.outbox.length + state.inFlight.length;
  var conflicts = state.conflicts.length;

  pill.classList.remove('ok', 'busy', 'warn', 'bad');
  if (overrideState === 'loading') {
    pill.classList.add('busy');
    pill.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i><span>همگام‌سازی اولیه…</span>';
    pill.title = 'در حال بارگذاری داده برای اجرای آنی';
  } else if (conflicts > 0) {
    pill.classList.add('bad');
    pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span>تعارض / خطای ذخیره (' + faDigits(conflicts) + ')</span>';
    pill.title = 'کلیک کنید تا تعارض یا خطای ذخیره در شیت بررسی شود';
  } else if (state.lastError) {
    pill.classList.add('warn');
    pill.innerHTML = '<i class="fa-solid fa-rotate"></i><span>در انتظار ذخیره (' + faDigits(pending) + ')</span>';
    pill.title = 'خطای موقت: ' + state.lastError + ' — کلیک برای تلاش مجدد';
  } else if (pending > 0) {
    pill.classList.add('busy');
    pill.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>در حال ذخیره (' + faDigits(pending) + ')…</span>';
    pill.title = 'تغییرات روی صفحه اعمال شده‌اند و در پس‌زمینه روی گوگل شیت ذخیره می‌شوند';
  } else if (state.ready) {
    pill.classList.add('ok');
    pill.innerHTML = '<i class="fa-solid fa-bolt"></i><span>حالت آنی · همگام ✓</span>';
    pill.title = 'تمام داده‌ها با گوگل شیت همگام هستند (کلیک برای بررسی یا تازه‌سازی)';
  } else {
    pill.classList.add('busy');
    pill.innerHTML = '<i class="fa-solid fa-database"></i><span>آماده‌سازی…</span>';
  }
}

function opLabel(op) {
  var m = op.method;
  var p = splitUrl(op.url).path;
  var mFa = m === 'POST' ? 'ثبت' : m === 'PUT' ? 'ویرایش' : 'حذف';
  if (p.indexOf('/api/tickets') === 0) return mFa + ' تیکت';
  if (p.indexOf('/api/socials') === 0) return mFa + ' سوشال';
  if (p.indexOf('/api/actions') === 0) return mFa + ' اقدام';
  if (p.indexOf('/api/reminders') === 0) return mFa + ' یادآور';
  if (p.indexOf('/api/agents') === 0) return mFa + ' کارشناس';
  return mFa + ' (' + p + ')';
}

function notifyConflictUser() {
  if (window.UI && window.UI.toast) {
    window.UI.toast.error('یک یا چند تغییر هنگام ثبت در شیت با تعارض/خطا مواجه شد — روی دکمه قرمز بالا کلیک کنید.', 7000);
  }
}

function openSyncModal() {
  if (!window.UI || !window.UI.modal) return;
  var pending = state.outbox.length + state.inFlight.length;
  var conflictHtml = state.conflicts.length
    ? state.conflicts.map(function (c, idx) {
      var canForce = c.status === 409 && c.op && c.op.method === 'PUT';
      return '<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--bad);background:var(--bad-soft);display:flex;flex-direction:column;gap:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>' + escapeHtml(opLabel(c.op)) + '</b><span class="badge bad">کد ' + faDigits(c.status) + '</span></div>' +
        '<div style="font-size:12.5px">' + escapeHtml(c.error) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        (canForce ? '<button type="button" class="btn primary sm" data-ls-force="' + idx + '"><i class="fa-solid fa-check"></i> اعمال اجباری تغییر من روی شیت</button>' : '') +
        '<button type="button" class="btn ghost sm" data-ls-drop="' + idx + '"><i class="fa-solid fa-rotate-left"></i> لغو این تغییر و بازخوانی شیت</button>' +
        '</div></div>';
    }).join('')
    : '<div style="padding:10px 12px;border-radius:10px;background:var(--panel-soft);font-size:12.5px;color:var(--good)"><i class="fa-solid fa-circle-check"></i> هیچ تعارض یا خطای ذخیره‌سازی وجود ندارد.</div>';

  var dlg = window.UI.modal([
    window.UI.modalHead('وضعیت همگام‌سازی آنی با گوگل شیت', 'fa-bolt'),
    '<div class="modal-body" style="display:flex;flex-direction:column;gap:12px">',
    '  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">',
    '    <div style="padding:10px;border-radius:10px;background:var(--panel-soft);text-align:center"><div style="font-size:11px;color:var(--muted)">در صف ذخیره</div><b style="font-size:18px">' + faDigits(pending) + '</b></div>',
    '    <div style="padding:10px;border-radius:10px;background:var(--panel-soft);text-align:center"><div style="font-size:11px;color:var(--muted)">تعارض / خطا</div><b style="font-size:18px;color:' + (state.conflicts.length ? 'var(--bad)' : 'var(--good)') + '">' + faDigits(state.conflicts.length) + '</b></div>',
    '    <div style="padding:10px;border-radius:10px;background:var(--panel-soft);text-align:center"><div style="font-size:11px;color:var(--muted)">نسخه شیت</div><b style="font-size:13px" dir="ltr">' + escapeHtml(state.revision ? state.revision.slice(-6) : '—') + '</b></div>',
    '  </div>',
    state.lastError ? ('<div class="note bad"><i class="fa-solid fa-wifi"></i> آخرین خطای شبکه: ' + escapeHtml(state.lastError) + '</div>') : '',
    conflictHtml,
    '</div>',
    '<div class="modal-foot">',
    '  <button type="button" class="btn ghost" data-close>بستن</button>',
    pending ? '  <button type="button" class="btn primary" id="lsRetryNow"><i class="fa-solid fa-cloud-arrow-up"></i> ارسال فوری صف</button>' : '',
    '  <button type="button" class="btn soft" id="lsRefreshSheet"><i class="fa-solid fa-arrows-rotate"></i> بازخوانی کامل از شیت</button>',
    '</div>'
  ].join('\n'));

  var retryBtn = dlg.querySelector('#lsRetryNow');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      state.retryCount = 0;
      scheduleDrain(true);
      dlg.close();
    });
  }
  var refreshBtn = dlg.querySelector('#lsRefreshSheet');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function () {
      refreshBtn.disabled = true;
      try {
        await flush();
        await hydrate(true);
        if (window.App && typeof window.App.boot === 'function') {
          await window.App.boot();
          await window.App.route();
        }
        if (window.UI && window.UI.toast) window.UI.toast.success('داده‌ها کامل از گوگل شیت تازه شدند');
        dlg.close();
      } catch (e) {
        if (window.UI && window.UI.toast) window.UI.toast.error((e && e.message) || 'تازه‌سازی ناموفق بود');
        refreshBtn.disabled = false;
      }
    });
  }

  var forceBtns = dlg.querySelectorAll('[data-ls-force]');
  for (var f = 0; f < forceBtns.length; f++) {
    forceBtns[f].addEventListener('click', function () {
      var idx = Number(this.getAttribute('data-ls-force'));
      var item = state.conflicts.splice(idx, 1)[0];
      if (item && item.op) {
        item.op.opId = genOpId();
        item.op.body = Object.assign({}, item.op.body, { overwrite: true });
        state.outbox.unshift(item.op);
        updateSyncUi();
        scheduleDrain(true);
      }
      dlg.close();
    });
  }
  var dropBtns = dlg.querySelectorAll('[data-ls-drop]');
  for (var d = 0; d < dropBtns.length; d++) {
    dropBtns[d].addEventListener('click', async function () {
      var idx = Number(this.getAttribute('data-ls-drop'));
      state.conflicts.splice(idx, 1);
      updateSyncUi();
      dlg.close();
      await hydrate(true);
      if (window.App && typeof window.App.route === 'function') await window.App.route();
    });
  }
}

function resetInternal(wipeIdb) {
  clearTimeout(state.drainTimer);
  clearTimeout(state.retryTimer);
  state.drainTimer = null;
  state.retryTimer = null;
  state.ready = false;
  state.hydrating = null;
  state.token = '';
  state.userKey = '';
  state.revision = '';
  state.outbox = [];
  state.inFlight = [];
  state.conflicts = [];
  state.idMap = {};
  state.lastError = '';
  state.retryCount = 0;
  notifyFlushWaiters();
  updateSyncUi();
  if (wipeIdb) idbClearAll();
}

function reset() {
  resetInternal(true);
}

function bindEvents() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('beforeunload', function (e) {
    if (state.outbox.length > 0 || state.inFlight.length > 0) {
      e.preventDefault();
      e.returnValue = 'تغییرات در حال ذخیره روی گوگل شیت هستند؛ چند لحظه صبر کنید.';
      return e.returnValue;
    }
  });
  document.addEventListener('click', function (e) {
    var pill = e.target && e.target.closest ? e.target.closest('#syncStatusPill') : null;
    if (pill) openSyncModal();
  });
}
bindEvents();

var QCLocalSync = {
  debounceMs: 350,
  isEnabled: isEnabled,
  isActive: isActive,
  isReady: function () { return state.ready; },
  hasPending: function () { return state.outbox.length > 0 || state.inFlight.length > 0; },
  pendingCount: function () { return state.outbox.length + state.inFlight.length; },
  conflictCount: function () { return state.conflicts.length; },
  getState: function () {
    return {
      ready: state.ready,
      revision: state.revision,
      outbox: clone(state.outbox),
      inFlight: clone(state.inFlight),
      conflicts: clone(state.conflicts),
      idMap: clone(state.idMap),
      lastError: state.lastError
    };
  },
  setRawRequest: function (fn) { state.rawRequest = fn; },
  hydrate: hydrate,
  intercept: intercept,
  flush: flush,
  reset: reset,
  openSyncModal: openSyncModal,
  updateSyncUi: updateSyncUi
};

window.QCLocalSync = QCLocalSync;
})();
