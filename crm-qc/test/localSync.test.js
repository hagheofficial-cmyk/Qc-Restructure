'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { browser } = require('./helpers');

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.ensureCell(this.row - 1 + r, this.col - 1 + c);
        this.sheet.data[this.row - 1 + r][this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const actual = this.sheet.data[this.row - 1 + r] || [];
        line.push(actual[this.col - 1 + c] == null ? '' : actual[this.col - 1 + c]);
      }
      out.push(line);
    }
    return out;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.frozen = 0; this.calls = 0; }
  getName() { return this.name; }
  ensureCell(row, col) {
    while (this.data.length <= row) this.data.push([]);
    while (this.data[row].length <= col) this.data[row].push('');
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(r => r.reduce((l, v, i) => v !== '' && v != null ? i + 1 : l, 0))); }
  getRange(row, col, rows = 1, cols = 1) { this.calls++; return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { this.calls++; return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  clearContents() { this.calls++; this.data = []; return this; }
  deleteRows(row, count) { this.calls++; this.data.splice(row - 1, count); return this; }
  setFrozenRows(rows) { this.frozen = rows; return this; }
}

class FakeSpreadsheet {
  constructor() { this.id = 'ss-local-sync-test'; this.sheets = new Map(); this.getSheetsCalls = 0; }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { this.getSheetsCalls++; return [...this.sheets.values()]; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.set(name, s); return s; }
}

class FakeCache {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  getAll(keys) {
    const out = {};
    keys.forEach(k => { if (this.values.has(k)) out[k] = this.values.get(k); });
    return out;
  }
  put(key, value) { this.values.set(key, String(value)); }
  putAll(map) { Object.keys(map).forEach(k => this.put(k, map[k])); }
  remove(key) { this.values.delete(key); }
}

function createServer() {
  const spreadsheet = new FakeSpreadsheet();
  const properties = new Map();
  const cache = new FakeCache();
  let openByIdCalls = 0;
  let uuid = 0;
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: id => { openByIdCalls++; assert.equal(id, spreadsheet.id); return spreadsheet; },
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) })
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => properties.get(k) || null,
      setProperty: (k, v) => { properties.set(k, String(v)); return this; }
    }) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `b1c2d3e4-f5a6-4b7c-8d9e-${String(++uuid).padStart(12, '0')}`,
      base64Encode: v => Buffer.from(v).toString('base64'),
      newBlob: v => ({ getBytes: () => Buffer.from(v) }),
      formatDate: d => d.toISOString(),
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, val) => Array.from(
        crypto.createHash(String(alg).includes('MD5') ? 'md5' : 'sha256').update(String(val), 'utf8').digest(),
        b => (b > 127 ? b - 256 : b))
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }),
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => ({ forSpreadsheet: () => ({ onChange: () => ({ create() {} }), onEdit: () => ({ create() {} }) }) })
    },
    HtmlService: {
      createHtmlOutput: v => ({ content: v, setTitle() { return this; }, addMetaTag() { return this; }, setFaviconUrl() { return this; } }),
      createHtmlOutputFromFile: n => ({ getContent: () => `<html data-file="${n}"></html>` })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  ctx.setupStandaloneApp_();
  ctx.createFirstAdmin_('مدیر', 'strong-admin-pass-123');
  const adminLogin = ctx.crmqcApi('POST', '/api/auth/login', { name: 'مدیر', password: 'strong-admin-pass-123' });
  assert.equal(adminLogin.status, 200);
  return {
    ctx,
    spreadsheet,
    adminToken: adminLogin.data.token,
    adminUser: adminLogin.data.user,
    getOpenByIdCalls: () => openByIdCalls,
    resetCounters: () => { openByIdCalls = 0; spreadsheet.getSheetsCalls = 0; }
  };
}

function makeTicketPayload(agentName, code, overrides = {}) {
  return Object.assign({
    qcAgent: 'مدیر',
    reviewDate: '1405/06/20',
    ticketDate: '1405/06/19',
    agentName,
    ticketCode: code,
    q1: '1', q2: '1', q3: '1', q4: '1',
    redline: '1',
    comment: 'تست اولیه'
  }, overrides);
}

function mountLocalSyncClient(server, token, user, hookFetch) {
  const networkLog = [];
  const { dom, w } = browser('public', undefined, async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const tok = (opts.headers && opts.headers['x-qc-token']) || token;
    networkLog.push({ method, url, body });
    if (hookFetch) {
      const intercepted = await hookFetch({ method, url, body, tok, run: () => server.ctx.crmqcApi(method, url, body, tok) });
      if (intercepted) {
        return {
          ok: intercepted.status >= 200 && intercepted.status < 300,
          status: intercepted.status,
          revision: intercepted.revision || '',
          headers: { get: k => String(k).toLowerCase() === 'x-qc-revision' ? (intercepted.revision || null) : null },
          json: async () => intercepted.data
        };
      }
    }
    const packet = server.ctx.crmqcApi(method, url, body, tok);
    return {
      ok: packet.status >= 200 && packet.status < 300,
      status: packet.status,
      revision: packet.revision || '',
      headers: { get: k => String(k).toLowerCase() === 'x-qc-revision' ? (packet.revision || null) : null },
      json: async () => packet.data
    };
  });
  w.APP_SCRIPT_MODE = true;
  w.QCAuth.token = token;
  w.QCAuth.user = user;
  w.QCAuth.required = true;
  w.QCLocalSync.debounceMs = 15;
  return { dom, w, networkLog };
}

test('Server.gs lazy openById makes ZERO spreadsheet opens on warm cache hits and /api/local-sync enforces scoping & masks passwords', () => {
  const srv = createServer();
  const agentList = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data;
  const agA = agentList[0], agB = agentList[1];

  /* ثبت ۲ تیکت برای ۲ کارشناس مختلف */
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', makeTicketPayload(agA.name, 'TK-A'), srv.adminToken).status, 200);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', makeTicketPayload(agB.name, 'TK-B'), srv.adminToken).status, 200);

  /* ساخت کاربر QC محدود به فقط کارشناس اول */
  const qcRes = srv.ctx.crmqcApi('POST', '/api/qc-users', {
    name: 'کارشناس محدود', role: 'qc', password: 'strong-qc-pass-1234', agents: [agA.name]
  }, srv.adminToken);
  assert.equal(qcRes.status, 200);
  const qcLogin = srv.ctx.crmqcApi('POST', '/api/auth/login', { name: 'کارشناس محدود', password: 'strong-qc-pass-1234' });
  assert.equal(qcLogin.status, 200);

  /* بدون توکن → 401 */
  assert.equal(srv.ctx.crmqcApi('GET', '/api/local-sync', {}, '').status, 401);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [] }, '').status, 401);

  /* اسنپ‌شات کاربر محدود: فقط کارشناس اول، بدون هیچ هش رمزی */
  const qcSnap = srv.ctx.crmqcApi('GET', '/api/local-sync', {}, qcLogin.data.token);
  assert.equal(qcSnap.status, 200);
  assert.equal(qcSnap.data.db.tickets.length, 1);
  assert.equal(qcSnap.data.db.tickets[0].ticketCode, 'TK-A');
  assert.equal(qcSnap.data.db.qcUsers.length, 0);
  assert.ok(!JSON.stringify(qcSnap.data).includes('sha256$'), 'password hashes must never leak');

  /* اسنپ‌شات مدیر: کامل، ولی هش رمزها ماسک شده */
  const adminSnap = srv.ctx.crmqcApi('GET', '/api/local-sync', {}, srv.adminToken);
  assert.equal(adminSnap.status, 200);
  assert.equal(adminSnap.data.db.tickets.length, 2);
  assert.ok(!JSON.stringify(adminSnap.data).includes('sha256$'), 'admin snapshot must not expose password hashes');

  /* کش گرم: درخواست‌های GET نباید حتی یک‌بار SpreadsheetApp.openById یا getSheets صدا بزنند */
  srv.ctx.crmqcApi('GET', '/api/dashboard', {}, srv.adminToken);
  srv.resetCounters();
  const warmDash = srv.ctx.crmqcApi('GET', '/api/dashboard', {}, srv.adminToken);
  assert.equal(warmDash.status, 200);
  assert.equal(warmDash.cached, true);
  assert.equal(srv.getOpenByIdCalls(), 0, 'warm analysis cache hit must make 0 openById calls');
  assert.equal(srv.spreadsheet.getSheetsCalls, 0, 'warm analysis cache hit must make 0 getSheets calls');

  const warmSnap = srv.ctx.crmqcApi('GET', '/api/local-sync', {}, srv.adminToken);
  assert.equal(warmSnap.status, 200);
  assert.equal(srv.getOpenByIdCalls(), 0, 'warm /api/local-sync must make 0 openById calls');
  assert.equal(srv.spreadsheet.getSheetsCalls, 0, 'warm /api/local-sync must make 0 getSheets calls');
});

test('LocalSync serves all reads in milliseconds from RAM (0 extra server calls) and coalesces create+edit & create+delete before dispatch', async () => {
  const srv = createServer();
  const agentName = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data[0].name;
  const { dom, w, networkLog } = mountLocalSyncClient(srv, srv.adminToken, srv.adminUser);
  try {
    /* ۱) هیدراته شدن یک‌باره و سپس چندین GET بدون هیچ درخواست شبکه‌ی اضافه */
    await w.UI.api.get('/api/dashboard');
    await w.UI.api.get('/api/reports?type=ticket&level=agent');
    await w.UI.api.get('/api/portfolio/agents');
    await w.UI.api.get('/api/tickets');
    await w.UI.api.get('/api/expert-ref');
    assert.equal(networkLog.length, 1, 'only 1 /api/local-sync call for all reads');
    assert.equal(networkLog[0].url, '/api/local-sync');

    /* ۲) ثبت تیکت اشتباه + ویرایش فوری قبل از ارسال → فقط یک POST تمیز با مقدار نهایی به شیت برود */
    const created = await w.UI.api.post('/api/tickets', makeTicketPayload(agentName, 'TK-FIX', { q1: '0', comment: 'اشتباه بود' }));
    assert.equal(created.score, 60);
    const edited = await w.UI.api.put('/api/tickets/' + created.id, makeTicketPayload(agentName, 'TK-FIX', {
      q1: '1', comment: 'اصلاح فوری شد', baseUpdatedAt: created.updatedAt
    }));
    assert.equal(edited.score, 100);

    /* ۳) ثبت تیکت اشتباه + حذف فوری قبل از ارسال → صفر درخواست به شیت */
    const mistake = await w.UI.api.post('/api/tickets', makeTicketPayload(agentName, 'TK-CANCEL'));
    await w.UI.api.del('/api/tickets/' + mistake.id);

    /* تخلیه صف به شیت */
    await w.QCLocalSync.flush();

    const batchCalls = networkLog.filter(x => x.url === '/api/batch-sync');
    assert.equal(batchCalls.length, 1, 'should send a single coalesced batch');
    assert.equal(batchCalls[0].body.ops.length, 1, 'create+edit coalesced into 1 POST and create+delete cancelled out');
    assert.equal(batchCalls[0].body.ops[0].method, 'POST');
    assert.equal(batchCalls[0].body.ops[0].body.q1, '1');
    assert.equal(batchCalls[0].body.ops[0].body.comment, 'اصلاح فوری شد');

    /* بررسی روی شیت واقعی: فقط ۱ تیکت با نمره ۱۰۰ و بدون هیچ لاگ اشتباه */
    const serverTickets = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
    assert.equal(serverTickets.length, 1);
    assert.equal(serverTickets[0].ticketCode, 'TK-FIX');
    assert.equal(serverTickets[0].score, 100);
    assert.equal(serverTickets[0].comment, 'اصلاح فوری شد');
  } finally { dom.window.close(); }
});

test('Anti-collision race: edit while POST is in-flight AND concurrent user steals same ID → tempId remaps cleanly without touching other user row', async () => {
  const srv = createServer();
  const agents = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data;
  const agentA = agents[0].name;
  const agentB = agents[1].name;

  let releaseFirstBatch;
  let firstBatchStarted;
  const firstBatchGate = new Promise(r => { firstBatchStarted = r; });
  let batchSeq = 0;

  const { dom, w, networkLog } = mountLocalSyncClient(srv, srv.adminToken, srv.adminUser, async (req) => {
    if (req.url === '/api/batch-sync') {
      batchSeq++;
      if (batchSeq === 1) {
        firstBatchStarted();
        await new Promise(r => { releaseFirstBatch = r; });
        /* دقیقاً قبل از رسیدن POST کاربر A به شیت، کاربر B یک تیکت ثبت می‌کند و ID=1 را می‌گیرد! */
        const other = srv.ctx.crmqcApi('POST', '/api/tickets', makeTicketPayload(agentB, 'OTHER-USER-ROW', { comment: 'تیکت همکار دیگر' }), srv.adminToken);
        assert.equal(other.status, 200);
        assert.equal(other.data.id, 1);
      }
    }
    return null;
  });

  try {
    await w.UI.api.get('/api/tickets');

    /* کاربر A تیکتی ثبت می‌کند (به صورت محلی tempId=1 می‌گیرد) */
    const localCreated = await w.UI.api.post('/api/tickets', makeTicketPayload(agentA, 'USER-A-TK', { q1: '0', comment: 'مقدار اول' }));
    assert.equal(localCreated.id, 1);

    /* صبر می‌کنیم تا POST کاربر A وارد حالت in-flight شود */
    await firstBatchGate;

    /* دقیقاً در حالی که POST در حال ارسال است، کاربر A اشتباه را می‌بیند و فوراً ویرایش می‌زند! */
    const localEdited = await w.UI.api.put('/api/tickets/' + localCreated.id, makeTicketPayload(agentA, 'USER-A-TK', {
      q1: '1', comment: 'اصلاح‌شده در حین ارسال', baseUpdatedAt: localCreated.updatedAt
    }));
    assert.equal(localEdited.score, 100);

    /* همچنین فرض کنید کاربر فرم ویرایش دیگری با همان ID قدیمی 1 باز کرده و قبل از بازگشت پاسخ نگه داشته */
    const staleFormBaseUpdatedAt = localEdited.updatedAt;

    /* حالا POST اول آزاد می‌شود: روی شیت ID=2 می‌گیرد چون همکار B قبلاً ID=1 را گرفته بود! */
    releaseFirstBatch();
    await w.QCLocalSync.flush();

    /* بررسی: تیکت همکار دیگر (ID=1) دست‌نخورده و تیکت کاربر A (ID=2) دقیقاً با ویرایش جدید ثبت شده */
    assert.equal(w.QCLocalSync.conflictCount(), 0, 'no false 409 conflict');
    let serverRows = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
    assert.equal(serverRows.length, 2);
    const rowOther = serverRows.find(r => r.ticketCode === 'OTHER-USER-ROW');
    const rowUserA = serverRows.find(r => r.ticketCode === 'USER-A-TK');
    assert.equal(rowOther.id, 1);
    assert.equal(rowOther.comment, 'تیکت همکار دیگر', 'other user row must never be overwritten');
    assert.equal(rowUserA.id, 2);
    assert.equal(rowUserA.score, 100);
    assert.equal(rowUserA.comment, 'اصلاح‌شده در حین ارسال');

    /* سناریوی Timing 3: اگر یک فرم باز هنوز ID قدیمی 1 و updatedAt قدیمی را بفرستد، خودکار به ID=2 نگاشت می‌شود */
    await w.UI.api.put('/api/tickets/1', makeTicketPayload(agentA, 'USER-A-TK', {
      q1: '1', q2: '0', comment: 'ویرایش سوم از فرم باز با ID قدیم', baseUpdatedAt: staleFormBaseUpdatedAt
    }));
    await w.QCLocalSync.flush();
    assert.equal(w.QCLocalSync.conflictCount(), 0);
    serverRows = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
    assert.equal(serverRows.find(r => r.id === 1).comment, 'تیکت همکار دیگر');
    assert.equal(serverRows.find(r => r.id === 2).comment, 'ویرایش سوم از فرم باز با ID قدیم');
    assert.ok(networkLog.some(x => x.url === '/api/batch-sync'));
  } finally { dom.window.close(); }
});

test('Idempotency (opId) prevents duplicate rows on retry, and real 409 Conflict is caught cleanly without silent overwrite', async () => {
  const srv = createServer();
  const agentName = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data[0].name;

  /* ۱) تست Idempotency در batch-sync: ارسال مجدد همان opId بعد از قطع ظاهری شبکه ردیف تکراری نمی‌سازد */
  const op = { opId: 'op_retry_same_1', method: 'POST', url: '/api/tickets', body: makeTicketPayload(agentName, 'TK-IDEMP') };
  const r1 = srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [op] }, srv.adminToken);
  const r2 = srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [op] }, srv.adminToken);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r1.data.results[0].data.id, r2.data.results[0].data.id);
  const allAfterRetry = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
  assert.equal(allAfterRetry.length, 1, 'duplicate opId must never create a second row');
  const existing = allAfterRetry[0];

  /* ۲) تست تعارض واقعی همزمانی (409 Conflict): دو نفر همزمان یک تیکت را ویرایش کنند */
  const { dom, w } = mountLocalSyncClient(srv, srv.adminToken, srv.adminUser);
  try {
    await w.UI.api.get('/api/tickets');

    /* کاربر B مستقیم روی سرور همان تیکت را ویرایش می‌کند (updatedAt جدید می‌گیرد) */
    await new Promise(r => setTimeout(r, 15));
    const userBEdit = srv.ctx.crmqcApi('PUT', '/api/tickets/' + existing.id, makeTicketPayload(agentName, 'TK-IDEMP', {
      comment: 'ویرایش همکار B روی سرور', baseUpdatedAt: existing.updatedAt
    }), srv.adminToken);
    assert.equal(userBEdit.status, 200);

    /* حالا کاربر A (که هنوز نسخه قبلی updatedAt را در RAM دارد) همان تیکت را ویرایش می‌کند */
    await w.UI.api.put('/api/tickets/' + existing.id, makeTicketPayload(agentName, 'TK-IDEMP', {
      comment: 'ویرایش کاربر A', baseUpdatedAt: existing.updatedAt
    }));
    await w.QCLocalSync.flush();

    /* باید 409 بگیرد، در لیست conflicts ثبت شود و ویرایش همکار B بازنویسی نشده باشد */
    assert.equal(w.QCLocalSync.conflictCount(), 1);
    const c = w.QCLocalSync.getState().conflicts[0];
    assert.equal(c.status, 409);
    assert.equal(c.conflict.current.comment, 'ویرایش همکار B روی سرور');
    const sheetRow = srv.ctx.crmqcApi('GET', '/api/tickets/' + existing.id, {}, srv.adminToken).data;
    assert.equal(sheetRow.comment, 'ویرایش همکار B روی سرور', 'server must not silently overwrite colleague edit');
  } finally { dom.window.close(); }
});

test('Consecutive in-flight PUTs upgrade baseUpdatedAt cleanly, QCAuth.clear() wipes local sync cache, and batch-sync rejects forbidden ops', async () => {
  const srv = createServer();
  const agentName = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data[0].name;

  /* ۱) امنیت batch-sync در برابر مسیرهای ممنوعه و خاموش‌کردن ورود */
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [{ method: 'POST', url: '/api/auth/login', body: {} }] }, srv.adminToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [{ method: 'POST', url: '/api/session-snapshot', body: {} }] }, srv.adminToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [{ method: 'GET', url: '/api/tickets', body: {} }] }, srv.adminToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [{ method: 'PUT', url: '/api/settings', body: { authMode: 'off' } }] }, srv.adminToken).status, 403);

  /* ۲) ساخت یک تیکت اولیه روی سرور */
  const created = srv.ctx.crmqcApi('POST', '/api/tickets', makeTicketPayload(agentName, 'TK-PUT-CHAIN', { comment: 'نسخه ۱' }), srv.adminToken).data;

  let releaseEdit1;
  let edit1InFlight;
  const edit1Gate = new Promise(r => { edit1InFlight = r; });
  let batchNo = 0;

  const { dom, w } = mountLocalSyncClient(srv, srv.adminToken, srv.adminUser, async (req) => {
    if (req.url === '/api/batch-sync') {
      batchNo++;
      if (batchNo === 1) {
        edit1InFlight();
        await new Promise(r => { releaseEdit1 = r; });
        await new Promise(r => setTimeout(r, 12));
      }
    }
    return null;
  });

  try {
    await w.UI.api.get('/api/tickets');

    /* ویرایش اول روی رکورد موجود */
    const e1 = await w.UI.api.put('/api/tickets/' + created.id, makeTicketPayload(agentName, 'TK-PUT-CHAIN', {
      comment: 'نسخه ۲ (در حین ارسال)', baseUpdatedAt: created.updatedAt
    }));

    /* صبر می‌کنیم تا ویرایش اول وارد حالت in-flight شود */
    await edit1Gate;

    /* دقیقاً در حین ارسال ویرایش اول، کاربر ویرایش دوم را می‌زند! */
    await w.UI.api.put('/api/tickets/' + created.id, makeTicketPayload(agentName, 'TK-PUT-CHAIN', {
      comment: 'نسخه ۳ (فوری بعد از نسخه ۲)', baseUpdatedAt: e1.updatedAt
    }));

    /* آزادسازی ویرایش اول و تخلیه کل صف */
    releaseEdit1();
    await w.QCLocalSync.flush();

    /* باید صفر تعارض داشته باشیم و سرور دقیقاً نسخه ۳ را ذخیره کرده باشد */
    assert.equal(w.QCLocalSync.conflictCount(), 0, 'consecutive in-flight PUTs must not trigger false 409');
    const latest = srv.ctx.crmqcApi('GET', '/api/tickets/' + created.id, {}, srv.adminToken).data;
    assert.equal(latest.comment, 'نسخه ۳ (فوری بعد از نسخه ۲)');

    /* ۳) پاک‌سازی کامل حافظه هنگام خروج (QCAuth.clear) */
    assert.equal(w.QCLocalSync.isReady(), true);
    w.QCAuth.clear();
    assert.equal(w.QCLocalSync.isReady(), false, 'QCAuth.clear() must immediately wipe QCLocalSync hydrated state');
    assert.equal(w.QCLocalSync.pendingCount(), 0);
    assert.equal(w.QCLocalSync.conflictCount(), 0);
  } finally { dom.window.close(); }
});

