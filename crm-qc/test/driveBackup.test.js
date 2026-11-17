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
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.frozen = 0; }
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
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  clearContents() { this.data = []; return this; }
  deleteRows(row, count) { this.data.splice(row - 1, count); return this; }
  setFrozenRows(rows) { this.frozen = rows; return this; }
}

class FakeSpreadsheet {
  constructor() { this.id = 'ss-drive-backup-test'; this.sheets = new Map(); }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return [...this.sheets.values()]; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.set(name, s); return s; }
}

class FakeIter {
  constructor(items) { this.items = items.slice(); this.idx = 0; }
  hasNext() { return this.idx < this.items.length; }
  next() { return this.items[this.idx++]; }
}

class FakeDriveFile {
  constructor(id, name, content, parent) {
    this.id = id; this.name = name; this.content = String(content);
    this.parents = parent ? [parent] : [];
    this.description = '';
    this.trashed = false;
    this.createdAt = new Date();
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  getSize() { return Buffer.byteLength(this.content, 'utf8'); }
  getDateCreated() { return this.createdAt; }
  getDescription() { return this.description; }
  setDescription(d) { this.description = String(d); return this; }
  isTrashed() { return this.trashed; }
  setTrashed(v) { this.trashed = !!v; return this; }
  getParents() { return new FakeIter(this.parents); }
  getBlob() { return { getDataAsString: () => this.content }; }
}

class FakeDriveFolder {
  constructor(id, name, drive) {
    this.id = id; this.name = name; this.drive = drive;
    this.files = []; this.trashed = false;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  isTrashed() { return this.trashed; }
  createFile(name, content) {
    const id = 'file_' + (++this.drive.seq);
    const f = new FakeDriveFile(id, name, content, this);
    this.files.push(f);
    this.drive.files.set(id, f);
    return f;
  }
  getFiles() { return new FakeIter(this.files.filter(f => !f.trashed)); }
}

class FakeDriveApp {
  constructor() {
    this.seq = 0;
    this.authorized = true;
    this.folders = new Map();
    this.files = new Map();
    this.root = new FakeDriveFolder('root_folder', 'My Drive', this);
  }
  checkAuth() {
    if (!this.authorized) throw new Error('You do not have permission to call DriveApp.getRootFolder');
  }
  getRootFolder() { this.checkAuth(); return this.root; }
  createFolder(name) {
    this.checkAuth();
    const id = 'folder_' + (++this.seq) + '_abcdefghijklmno';
    const f = new FakeDriveFolder(id, name, this);
    this.folders.set(id, f);
    return f;
  }
  getFolderById(id) {
    this.checkAuth();
    const f = this.folders.get(id);
    if (!f) throw new Error('Folder not found: ' + id);
    return f;
  }
  getFoldersByName(name) {
    this.checkAuth();
    return new FakeIter([...this.folders.values()].filter(f => !f.trashed && f.name === name));
  }
  getFileById(id) {
    this.checkAuth();
    const f = this.files.get(id);
    if (!f) throw new Error('File not found: ' + id);
    return f;
  }
}

function createDriveServer() {
  const spreadsheet = new FakeSpreadsheet();
  const drive = new FakeDriveApp();
  const properties = new Map();
  const cacheMap = new Map();
  const triggers = [];
  let uuid = 0;
  let activeSpreadsheet = spreadsheet;

  const ctx = {
    console,
    DriveApp: drive,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSpreadsheet,
      openById: id => { assert.equal(id, spreadsheet.id); return spreadsheet; },
      getUi: () => ({
        alert() {},
        createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} })
      })
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => properties.get(k) || null,
      setProperty: (k, v) => { properties.set(k, String(v)); return this; }
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => cacheMap.has(k) ? cacheMap.get(k) : null,
      getAll: keys => Object.fromEntries(keys.filter(k => cacheMap.has(k)).map(k => [k, cacheMap.get(k)])),
      put: (k, v) => { cacheMap.set(k, String(v)); },
      putAll: m => Object.keys(m).forEach(k => cacheMap.set(k, String(m[k]))),
      remove: k => cacheMap.delete(k)
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `c1d2e3f4-a5b6-4c7d-8e9f-${String(++uuid).padStart(12, '0')}`,
      base64Encode: v => Buffer.from(v).toString('base64'),
      newBlob: v => ({ getBytes: () => Buffer.from(v) }),
      formatDate: d => d.toISOString(),
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, val) => Array.from(
        crypto.createHash(String(alg).includes('MD5') ? 'md5' : 'sha256').update(String(val), 'utf8').digest(),
        b => (b > 127 ? b - 256 : b))
    },
    Session: { getScriptTimeZone: () => 'Asia/Tehran' },
    ScriptApp: {
      WeekDay: { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const at = triggers.indexOf(t); if (at >= 0) triggers.splice(at, 1); },
      newTrigger: handler => {
        const make = (spec) => ({
          create: () => {
            const uid = 'trig_' + (++uuid);
            const t = { handler, spec, uid, getHandlerFunction: () => handler, getUniqueId: () => uid };
            triggers.push(t);
            return t;
          }
        });
        return {
          forSpreadsheet: () => ({
            onChange: () => make({ type: 'onChange' }),
            onEdit: () => make({ type: 'onEdit' })
          }),
          timeBased: () => ({
            everyHours: h => make({ type: 'everyHours', h }),
            everyDays: d => ({ atHour: h => make({ type: 'everyDays', d, h }) }),
            everyWeeks: w => ({ onWeekDay: wd => ({ atHour: h => make({ type: 'everyWeeks', w, wd, h }) }) })
          })
        };
      }
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
    ctx, drive, properties, triggers,
    adminToken: adminLogin.data.token,
    adminUser: adminLogin.data.user,
    setWebContext: (isWeb) => { activeSpreadsheet = isWeb ? null : spreadsheet; }
  };
}

function sampleTicket(agentName, code, comment) {
  return {
    qcAgent: 'مدیر', reviewDate: '1405/08/20', ticketDate: '1405/08/19',
    agentName, ticketCode: code, q1: '1', q2: '1', q3: '1', q4: '1', redline: '1', comment
  };
}

test('Google Drive backup enforces admin-only auth, folder boundary, password masking, and OAuth permission guidance', () => {
  const srv = createDriveServer();
  const agents = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data;

  /* ساخت کاربر QC غیرادمین */
  assert.equal(srv.ctx.crmqcApi('POST', '/api/qc-users', {
    name: 'کارشناس QC', role: 'qc', password: 'strong-qc-pass-1234', agents: [agents[0].name]
  }, srv.adminToken).status, 200);
  const qcToken = srv.ctx.crmqcApi('POST', '/api/auth/login', { name: 'کارشناس QC', password: 'strong-qc-pass-1234' }).data.token;

  /* بدون توکن → 401؛ کاربر QC غیرادمین → 403؛ batch-sync → 403 */
  assert.equal(srv.ctx.crmqcApi('GET', '/api/drive-backups', {}, '').status, 401);
  assert.equal(srv.ctx.crmqcApi('GET', '/api/drive-backups', {}, qcToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/drive-backups/connect', {}, qcToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/batch-sync', { ops: [{ method: 'POST', url: '/api/drive-backups/now', body: {} }] }, srv.adminToken).status, 403);

  /* اگر مجوز Drive هنوز صادر نشده باشد، خطای 500 نمی‌دهد بلکه needsAuthorization=true برمی‌گرداند */
  srv.drive.authorized = false;
  const needAuth = srv.ctx.crmqcApi('POST', '/api/drive-backups/connect', { schedule: 'daily', hour: 2 }, srv.adminToken);
  assert.equal(needAuth.status, 200);
  assert.equal(needAuth.data.connected, false);
  assert.equal(needAuth.data.needsAuthorization, true);

  /* صدور مجوز و اتصال */
  srv.drive.authorized = true;
  const connected = srv.ctx.crmqcApi('POST', '/api/drive-backups/connect', { schedule: 'daily', hour: 3, maxKeep: 10 }, srv.adminToken);
  assert.equal(connected.status, 200);
  assert.equal(connected.data.connected, true);
  assert.equal(connected.data.triggerActive, true);
  assert.equal(connected.data.backups.length, 1);

  /* فایل خارج از پوشه بکاپ نباید قابل مشاهده، بازیابی یا حذف باشد */
  const foreignFolder = srv.drive.createFolder('Private Secret Folder');
  const foreignFile = foreignFolder.createFile('qc-backup-foreign.json', JSON.stringify({ schema: 'crm-qc-backup', version: 4 }));
  assert.equal(srv.ctx.crmqcApi('GET', '/api/drive-backups/' + foreignFile.getId(), {}, srv.adminToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('DELETE', '/api/drive-backups/' + foreignFile.getId(), {}, srv.adminToken).status, 403);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/drive-backups/' + foreignFile.getId() + '/restore', { mode: 'replace' }, srv.adminToken).status, 403);

  /* مشاهده بکاپ هرگز هش رمزها را برنمی‌گرداند */
  const insp = srv.ctx.crmqcApi('GET', '/api/drive-backups/' + connected.data.backups[0].id, {}, srv.adminToken);
  assert.equal(insp.status, 200);
  assert.ok(!JSON.stringify(insp.data).includes('sha256$'), 'inspect preview must never expose password hashes');
});

test('Google Drive scheduled trigger, retention pruning, live-diff inspect, and safe restore with pre-restore backup', () => {
  const srv = createDriveServer();
  const agentName = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data[0].name;

  /* ثبت تیکت اولیه #1 و اتصال از منوی شیت */
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', sampleTicket(agentName, 'TK-OLD-1', 'تیکت قبل از بکاپ اول'), srv.adminToken).status, 200);
  const sheetConn = srv.ctx.connectDriveBackupFromSheet();
  assert.equal(sheetConn.ok, true);
  const firstBackupId = sheetConn.initialBackup.id;

  /* اجرای زمان‌بندی‌شده: در محیط وب بدون triggerUid معتبر خطا می‌دهد؛ با triggerUid واقعی کار می‌کند */
  srv.setWebContext(true);
  assert.throws(() => srv.ctx.crmqcScheduledDriveBackup({}));
  assert.throws(() => srv.ctx.crmqcScheduledDriveBackup({ triggerUid: 'fake-uid' }));
  const realUid = srv.properties.get('QC_GAS_DRIVE_TRIGGER_UID');
  assert.ok(realUid);

  /* ثبت ۲ تیکت جدیدتر روی سامانه زنده */
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', sampleTicket(agentName, 'TK-NEW-2', 'تیکت جدید ۲'), srv.adminToken).status, 200);
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', sampleTicket(agentName, 'TK-NEW-3', 'تیکت جدید ۳'), srv.adminToken).status, 200);

  /* اجرای بکاپ خودکار از طریق تریگر واقعی گوگل */
  const autoRun = srv.ctx.crmqcScheduledDriveBackup({ triggerUid: realUid });
  assert.equal(autoRun.ok, true);
  assert.equal(autoRun.backup.trigger, 'auto');
  assert.equal(autoRun.backup.counts.tickets, 3);

  /* مشاهده و مقایسه بکاپ اول (۱ تیکت) در برابر سامانه فعلی (۳ تیکت) → delta = -2 */
  const insp = srv.ctx.crmqcApi('GET', '/api/drive-backups/' + firstBackupId, {}, srv.adminToken);
  assert.equal(insp.status, 200);
  assert.equal(insp.data.counts.tickets, 1);
  assert.equal(insp.data.liveCounts.tickets, 3);
  assert.equal(insp.data.diff.tickets.delta, -2);
  assert.equal(insp.data.preview.tickets[0].ticketCode, 'TK-OLD-1');

  /* بازگردانی از بکاپ اول با محافظت ایمنی خودکار (autoSafetyBackup=true) */
  const restored = srv.ctx.crmqcApi('POST', '/api/drive-backups/' + firstBackupId + '/restore', {
    mode: 'replace', autoSafetyBackup: true
  }, srv.adminToken);
  assert.equal(restored.status, 200);
  assert.ok(restored.data.safetyBackup, 'must automatically create pre-restore safety backup');
  assert.equal(restored.data.safetyBackup.trigger, 'pre-restore');
  assert.equal(restored.data.safetyBackup.counts.tickets, 3);

  /* بررسی سامانه زنده: باید دقیقاً به ۱ تیکت قدیمی برگشته باشد */
  const liveAfter = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
  assert.equal(liveAfter.length, 1);
  assert.equal(liveAfter[0].ticketCode, 'TK-OLD-1');

  /* تست سقف نگهداری (maxKeep=5): ایجاد ۶ بکاپ جدید → فقط ۵ نسخه جدید نگه داشته می‌شوند */
  assert.equal(srv.ctx.crmqcApi('PUT', '/api/drive-backups/config', { schedule: '6h', maxKeep: 5 }, srv.adminToken).status, 200);
  for (let i = 0; i < 6; i++) {
    const r = srv.ctx.crmqcApi('POST', '/api/drive-backups/now', { note: 'تست #' + i }, srv.adminToken);
    assert.equal(r.status, 200);
  }
  const listAfterPrune = srv.ctx.crmqcApi('GET', '/api/drive-backups', {}, srv.adminToken).data;
  assert.equal(listAfterPrune.backups.length, 5, 'must prune oldest backups down to maxKeep=5');

  /* قطع اتصال: تریگر زمان‌بندی حذف می‌شود ولی فایل‌ها روی درایو محفوظ می‌مانند */
  const disc = srv.ctx.crmqcApi('POST', '/api/drive-backups/disconnect', {}, srv.adminToken);
  assert.equal(disc.status, 200);
  assert.equal(disc.data.connected, false);
  assert.equal(disc.data.triggerActive, false);
  assert.equal(srv.triggers.filter(t => t.handler === 'crmqcScheduledDriveBackup').length, 0);
});

test('Data Center UI connects Drive, opens interactive Backup Inspector modal, and restores safely', async () => {
  const srv = createDriveServer();
  const agentName = srv.ctx.crmqcApi('GET', '/api/agents', {}, srv.adminToken).data[0].name;
  assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', sampleTicket(agentName, 'TK-UI-1', 'تیکت تست رابط کاربری'), srv.adminToken).status, 200);

  const { dom, w } = browser('public', undefined, async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const packet = srv.ctx.crmqcApi(method, url, body, srv.adminToken);
    return {
      ok: packet.status >= 200 && packet.status < 300,
      status: packet.status,
      revision: packet.revision || '',
      headers: { get: k => String(k).toLowerCase() === 'x-qc-revision' ? (packet.revision || null) : null },
      json: async () => packet.data
    };
  });
  try {
    w.APP_SCRIPT_MODE = true;
    w.sessionStorage.setItem('crmqc.auth.v1', JSON.stringify({ token: srv.adminToken, user: srv.adminUser }));
    w.QCAuth.token = srv.adminToken;
    w.QCAuth.user = srv.adminUser;
    w.QCAuth.required = true;
    w.QCLocalSync.debounceMs = 10;

    await w.App.boot();
    w.location.hash = '#/data';
    await w.App.route();
    await new Promise(r => setTimeout(r, 150));

    /* ابتدا وضعیت «متصل نیست» و دکمه درخواست اتصال نمایش داده می‌شود */
    assert.ok(w.document.querySelector('#drvConnectBtn'), 'connect button must be visible');
    w.document.querySelector('#drvConnectBtn').click();
    await new Promise(r => setTimeout(r, 180));

    /* پس از اتصال: جدول آرشیو بکاپ و دکمه‌های مشاهده/بازگردانی ظاهر می‌شوند */
    assert.match(w.document.querySelector('#drvStatusBadge').textContent, /متصل/);
    const inspBtn = w.document.querySelector('[data-drv-inspect]');
    assert.ok(inspBtn, 'inspect button must appear for created backup');

    /* کلیک روی «مشاهده» → باز شدن مودال بازرسی بکاپ با مقایسه و تب تیکت‌ها */
    inspBtn.click();
    await new Promise(r => setTimeout(r, 150));
    const ticketsTab = w.document.querySelector('.drv-inspect-tab[data-tab="tickets"]');
    assert.ok(ticketsTab, 'inspector modal must render tickets tab');
    ticketsTab.click();
    assert.match(w.document.querySelector('#drvInspContent').textContent, /TK-UI-1/);

    /* ثبت یک تیکت اضافی روی سرور، سپس بازگردانی از داخل همان مودال بازرسی */
    assert.equal(srv.ctx.crmqcApi('POST', '/api/tickets', sampleTicket(agentName, 'TK-EXTRA', 'اضافی'), srv.adminToken).status, 200);
    assert.equal(srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows.length, 2);

    w.document.querySelector('#drvInspRestoreBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const confirmBtn = w.document.querySelector('#drvConfirmRestoreBtn');
    assert.ok(confirmBtn, 'safe restore modal must open');
    confirmBtn.click();
    await new Promise(r => setTimeout(r, 200));

    /* بعد از بازگردانی، تیکت اضافی برگشته به ۱ تیکت و بکاپ ایمنی پیش از بازگردانی ساخته شده */
    const afterRows = srv.ctx.crmqcApi('GET', '/api/tickets', {}, srv.adminToken).data.rows;
    assert.equal(afterRows.length, 1);
    assert.equal(afterRows[0].ticketCode, 'TK-UI-1');
    const finalStatus = srv.ctx.crmqcApi('GET', '/api/drive-backups', {}, srv.adminToken).data;
    assert.ok(finalStatus.backups.some(b => b.trigger === 'pre-restore'), 'pre-restore safety backup must be saved');
  } finally { dom.window.close(); }
});
