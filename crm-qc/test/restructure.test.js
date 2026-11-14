'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const XLSX = require('xlsx');

const P = require('../shared/parseQc');
const R = require('../shared/reports');
const I = require('../shared/importData');
const E = require('../shared/expertRef');
const F = require('../shared/fiscal');
const Sheets = require('../googleSheets');
const Watcher = require('../callWatcher');
const { ROOT, browser, clone, settle, go } = require('./helpers');

const SAMPLES_DIR = path.resolve(ROOT, '..', 'نمونه اکسل ها');
function findSample(prefix) {
  const match = fs.readdirSync(SAMPLES_DIR).find(f => f.startsWith(prefix) && f.endsWith('.xlsx'));
  assert.ok(match, `Missing sample workbook starting with ${prefix} in ${SAMPLES_DIR}`);
  return match;
}
const FILES = {
  accFixed: findSample('qc_acc_new_form'),
  accSit: findSample('new_acc_form___score_calc'),
  teleFixed: findSample('qc_tele_new_form'),
  teleSit: findSample('new_tele_form___score_calc')
};

function readSampleRows(key) {
  const wb = XLSX.readFile(path.join(SAMPLES_DIR, FILES[key]), { raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

function makeSeedDb() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'));
  return {
    ...seed,
    tickets: [],
    socials: [],
    callFeedbacks: [],
    callSituational: [],
    callImport: null,
    callRaw: null,
    callSync: { files: {}, syncedAt: null },
    agentActions: {},
    reminders: [],
    fiscalMonths: [],
    qcUsers: [],
    settings: { ...seed.settings, defaultPreset: 'all' }
  };
}

test('restructure: exact fixed + situational criteria counts and labels match guide', () => {
  assert.equal(P.ACCOUNT_CRITERIA.length, 11);
  assert.equal(P.TELE_CRITERIA.length, 10);
  assert.equal(P.MLM_CRITERIA.length, 11);
  assert.equal(P.situationalDefaults('account').length, 4);
  assert.equal(P.situationalDefaults('tele').length, 7);
  assert.equal(P.situationalDefaults('mlm').length, 0);

  assert.ok(P.ACCOUNT_CRITERIA.includes('call_topic_mastery'));
  assert.ok(!P.TELE_CRITERIA.includes('call_topic_mastery'));
  assert.equal(P.labelOf('account', 'call_opening_quality'), 'شروع به‌موقع مکالمه');
  assert.equal(P.labelOf('tele', 'call_opening_quality'), 'شروع مناسب مکالمه');
  assert.equal(P.labelOf('tele', 'value_communication_and_tailored_offer'), 'انتقال ارزش و ارائه پیشنهاد متناسب');
  assert.equal(P.situationalLabelOf('account', 'campaign_announcement'), 'اعلام جشنواره');
  assert.equal(P.situationalLabelOf('tele', 'parallel_campaign_presentation'), 'اعلام جشنواره موازی');
});

test('restructure: all 4 real Metabase Excels parse, classify without filenames, and pair periods accurately', () => {
  const accFixedRows = readSampleRows('accFixed');
  const accSitRows = readSampleRows('accSit');
  const teleFixedRows = readSampleRows('teleFixed');
  const teleSitRows = readSampleRows('teleSit');

  // Filename-less classification
  assert.deepEqual(P.classifyCallFile('file1.xlsx', accFixedRows), { kind: 'fixed', formType: 'account' });
  assert.deepEqual(P.classifyCallFile('file2.xlsx', accSitRows), { kind: 'situational', formType: 'account' });
  assert.deepEqual(P.classifyCallFile('file3.xlsx', teleFixedRows), { kind: 'fixed', formType: 'tele' });
  assert.deepEqual(P.classifyCallFile('file4.xlsx', teleSitRows), { kind: 'situational', formType: 'tele' });

  const db = makeSeedDb();
  // Upload situational BEFORE fixed to verify two-pass period auto-linking!
  const res = I.callFiles(db, [
    { name: FILES.accSit, rows: accSitRows },
    { name: FILES.teleSit, rows: teleSitRows },
    { name: FILES.accFixed, rows: accFixedRows },
    { name: FILES.teleFixed, rows: teleFixedRows }
  ]);

  assert.equal(res.ok, true);
  assert.equal(res.counts.total, 323 + 693);
  assert.equal(res.counts.situational, 23 + 42);
  assert.equal(db.callFeedbacks.length, 1016);
  assert.equal(db.callSituational.length, 65);

  const accCalls = db.callFeedbacks.filter(r => r.formType === 'account');
  const teleCalls = db.callFeedbacks.filter(r => r.formType === 'tele');
  assert.equal(accCalls.length, 323);
  assert.equal(teleCalls.length, 693);
  assert.equal(accCalls.filter(r => r.redline === 1).length, 3);
  assert.equal(teleCalls.filter(r => r.redline === 1).length, 16);

  // Every Account situational row linked to Account fixed date range (1405/07/25..1405/08/20)
  const accSit = db.callSituational.filter(r => r.formType === 'account');
  assert.equal(accSit.length, 23);
  assert.ok(accSit.every(r => r.periodFrom === '1405/07/25' && r.periodTo === '1405/08/20'));
  assert.ok(accSit.every(r => r.pairedFixedFile === FILES.accFixed));

  // Every Tele situational row linked to Tele fixed date range (1405/07/25..1405/08/21)
  const teleSit = db.callSituational.filter(r => r.formType === 'tele');
  assert.equal(teleSit.length, 42);
  assert.ok(teleSit.every(r => r.periodFrom === '1405/07/25' && r.periodTo === '1405/08/21'));
  assert.ok(teleSit.every(r => r.pairedFixedFile === FILES.teleFixed));

  // Idempotent re-upload
  const again = I.callFiles(db, [
    { name: FILES.accFixed, rows: accFixedRows },
    { name: FILES.accSit, rows: accSitRows },
    { name: FILES.teleFixed, rows: teleFixedRows },
    { name: FILES.teleSit, rows: teleSitRows }
  ]);
  assert.equal(again.results.reduce((s, r) => s + (r.added || 0), 0), 0);
  assert.equal(db.callFeedbacks.length, 1016);
  assert.equal(db.callSituational.length, 65);
});

test('restructure: fixed vs situational scores stay strictly separate and match Score Calc math', () => {
  const db = makeSeedDb();
  I.callFiles(db, [
    { name: FILES.accFixed, rows: readSampleRows('accFixed') },
    { name: FILES.accSit, rows: readSampleRows('accSit') },
    { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
    { name: FILES.teleSit, rows: readSampleRows('teleSit') }
  ]);

  const inRange = { from: '1405/07/25', to: '1405/08/21' };
  const outRange = { from: '1405/01/01', to: '1405/02/01' };

  // Weighted team situational averages match independent Python verification (Account: 74.20, Tele: 71.27)
  const accRep = R.callReport(db, 'team', { ...inRange, form: 'account' }, P.resolver(db.settings.callCriteria));
  assert.equal(accRep.situational.hasData, true);
  assert.equal(accRep.situational.avgScore, 74.2);
  assert.equal(accRep.situational.elements.length, 4);
  assert.equal(accRep.elements.length, 11);

  const teleRep = R.callReport(db, 'team', { ...inRange, form: 'tele' }, P.resolver(db.settings.callCriteria));
  assert.equal(teleRep.situational.hasData, true);
  assert.equal(teleRep.situational.avgScore, 71.27);
  assert.equal(teleRep.situational.elements.length, 7);
  assert.equal(teleRep.elements.length, 10);

  // Verify individual specialist report card keeps fixed score and calc_situational_score exact & separate
  const diffAccRaw = readSampleRows('accSit').find(r => Math.abs(Number(r.avg_score) - Number(r.calc_situational_score)) > 5);
  assert.ok(diffAccRaw, 'Account specialist with distinct fixed vs situational scores');
  const accProf = R.agentProfile(db, diffAccRaw.account_expert_name, inRange);
  assert.ok(accProf, 'Account specialist profile resolved');
  assert.equal(accProf.calls.count, Number(diffAccRaw.forms_count));
  assert.equal(accProf.calls.avgScore, Math.round(Number(diffAccRaw.avg_score) * 100) / 100);
  assert.equal(accProf.situational.hasData, true);
  assert.equal(accProf.situational.avgScore, Math.round(Number(diffAccRaw.calc_situational_score) * 100) / 100);
  assert.equal(accProf.situational.elements.length, 4);
  // Fixed call avg is NOT polluted by situational score
  assert.notEqual(accProf.calls.avgScore, accProf.situational.avgScore);

  const diffTeleRaw = readSampleRows('teleSit').find(r => Math.abs(Number(r.avg_score) - Number(r.calc_situational_score)) > 5);
  assert.ok(diffTeleRaw, 'Tele specialist with distinct fixed vs situational scores');
  const teleProf = R.agentProfile(db, diffTeleRaw.tele_expert_name, inRange);
  assert.ok(teleProf, 'Tele specialist profile resolved');
  assert.equal(teleProf.calls.count, Number(diffTeleRaw.forms_count));
  assert.equal(teleProf.calls.avgScore, Math.round(Number(diffTeleRaw.avg_score) * 100) / 100);
  assert.equal(teleProf.situational.hasData, true);
  assert.equal(teleProf.situational.avgScore, Math.round(Number(diffTeleRaw.calc_situational_score) * 100) / 100);
  assert.equal(teleProf.situational.elements.length, 7);

  // Outside date range excludes situational rows cleanly
  const outsideProf = R.agentProfile(db, diffAccRaw.account_expert_name, outRange);
  assert.equal(outsideProf.situational.hasData, false);
  assert.equal(outsideProf.situational.avgScore, '');

  // Call analysis exposes situational KPIs + situationalHeatmaps
  const an = R.callAnalysis(db, inRange, P.resolver(db.settings.callCriteria));
  assert.equal(an.kpis.totalCalls, 1016);
  assert.equal(an.kpis.situationalCount, 65);
  assert.equal(an.situationalHeatmaps.account.agents.length, 23);
  assert.equal(an.situationalHeatmaps.account.keys.length, 4);
  assert.equal(an.situationalHeatmaps.tele.agents.length, 42);
  assert.equal(an.situationalHeatmaps.tele.keys.length, 7);

  // Expert ref and fiscal summary carry situational averages separately
  const erCards = E.overview(db);
  assert.ok(erCards.cards.some(c => c.situationalAvg !== ''));
  db.fiscalMonths = [{ id: 'm1', label: 'آبان ۱۴۰۵', from: '1405/07/25', to: '1405/08/21' }];
  const fm = F.monthlySummary(db, inRange);
  assert.ok(fm.rows.some(r => r.situationalCount > 0 && r.situationalAvg !== ''));
});

test('restructure: callWatcher two-pass scan and Google Sheets Call_Situational round-trip', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-restructure-watch-'));
  try {
    const callsDir = path.join(tmpDir, 'data', 'calls');
    fs.mkdirSync(callsDir, { recursive: true });
    fs.cpSync(path.join(ROOT, 'shared'), path.join(tmpDir, 'shared'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'callWatcher.js'), path.join(tmpDir, 'callWatcher.js'));
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmpDir, 'node_modules'), 'dir');
    for (const fname of Object.values(FILES)) {
      fs.copyFileSync(path.join(SAMPLES_DIR, fname), path.join(callsDir, fname));
    }
    const IsolatedWatcher = require(path.join(tmpDir, 'callWatcher.js'));
    const db = makeSeedDb();
    let saved = 0;
    const out = IsolatedWatcher.scanOnce(db, () => { saved++; }, () => {});
    assert.equal(out.changed, true);
    assert.equal(saved, 1);
    assert.equal(db.callFeedbacks.length, 1016);
    assert.equal(db.callSituational.length, 65);

    const status = IsolatedWatcher.dirStatus(db);
    assert.equal(status.counts.situational, 65);
    assert.equal(status.counts.total, 1016);
    assert.equal(status.files.filter(f => f.kind === 'situational').length, 2);
    assert.equal(status.files.filter(f => f.kind === 'form').length, 2);

    // Google Sheets round-trip for Call_Situational
    const sheetData = Sheets.dbToSheetRows(db);
    assert.equal(sheetData.callSituational.length, 65);
    const restored = Sheets.sheetRowsToDb(sheetData);
    assert.equal(restored.callSituational.length, 65);
    assert.equal(restored.callSituational[0].situationalScore, db.callSituational[0].situationalScore);
    assert.deepEqual(restored.callSituational[0].elements, db.callSituational[0].elements);
    assert.equal(restored.callSituational[0].periodFrom, db.callSituational[0].periodFrom);
    assert.equal(restored.callSituational[0].periodTo, db.callSituational[0].periodTo);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('restructure: HTTP server and offline LocalApi produce identical results for paired real uploads', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-restructure-srv-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.cpSync(path.join(ROOT, 'shared'), path.join(dir, 'shared'), { recursive: true });
  for (const file of ['server.js', 'callWatcher.js', 'googleSheets.js']) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'data/seed.json'), JSON.stringify(makeSeedDb()));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(dir, 'public'), 'dir');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Server timeout: ' + log)); }, 10000);
    child.stdout.on('data', (chunk) => {
      log += chunk;
      const m = log.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Server exited ' + code + '\n' + log)); });
  });

  const payload = {
    files: [
      { name: FILES.accFixed, rows: readSampleRows('accFixed') },
      { name: FILES.accSit, rows: readSampleRows('accSit') },
      { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
      { name: FILES.teleSit, rows: readSampleRows('teleSit') }
    ]
  };
  const upRes = await fetch(baseUrl + '/api/calls/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(r => r.json());
  assert.equal(upRes.ok, true);
  assert.equal(upRes.counts.total, 1016);
  assert.equal(upRes.counts.situational, 65);

  const rangeQ = 'from=1405%2F07%2F25&to=1405%2F08%2F21';
  const [srvDash, srvRep, srvAn] = await Promise.all([
    fetch(`${baseUrl}/api/dashboard?${rangeQ}`).then(r => r.json()),
    fetch(`${baseUrl}/api/reports?type=call&level=team&${rangeQ}`).then(r => r.json()),
    fetch(`${baseUrl}/api/calls/analysis?${rangeQ}`).then(r => r.json())
  ]);

  // Same upload into offline browser LocalApi
  const env = browser('offline', makeSeedDb());
  t.after(() => env.dom.window.close());
  const locUp = await env.w.LocalApi.post('/api/calls/files', payload);
  assert.equal(locUp.ok, true);
  assert.equal(locUp.counts.total, 1016);
  assert.equal(locUp.counts.situational, 65);
  const [locDash, locRep, locAn] = await Promise.all([
    env.w.LocalApi.get(`/api/dashboard?${rangeQ}`),
    env.w.LocalApi.get(`/api/reports?type=call&level=team&${rangeQ}`),
    env.w.LocalApi.get(`/api/calls/analysis?${rangeQ}`)
  ]);

  assert.equal(srvDash.callCount, locDash.callCount);
  assert.equal(srvDash.situationalCount, locDash.situationalCount);
  assert.equal(srvDash.situationalAvg, locDash.situationalAvg);
  assert.equal(srvRep.situational.avgScore, locRep.situational.avgScore);
  assert.equal(srvAn.kpis.situationalAvg, locAn.kpis.situationalAvg);
  assert.equal(srvAn.kpis.avgScore, locAn.kpis.avgScore);
});

for (const build of ['public', 'offline']) {
  test(`${build}: UI displays paired uploader, specialist situational card, reports situational table, and 0-chart situational heatmap`, async (t) => {
    const db = makeSeedDb();
    I.callFiles(db, [
      { name: FILES.accFixed, rows: readSampleRows('accFixed') },
      { name: FILES.accSit, rows: readSampleRows('accSit') },
      { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
      { name: FILES.teleSit, rows: readSampleRows('teleSit') }
    ]);
    const env = browser(build, db);
    const { w, dom, errors } = env;
    t.after(() => dom.window.close());
    await w.App.boot();
    w.App.bindDateRangeUI();
    await w.App.setDateRange({ from: '1405/07/25', to: '1405/08/21' });
    const $ = (s) => w.document.querySelector(s);
    const $$ = (s) => [...w.document.querySelectorAll(s)];

    // 0. Dashboard shows situational KPI tile & weighted score
    await go(w, 'dashboard');
    assert.ok($('#dContent').textContent.includes('المان‌های موقعیتی'));
    assert.ok($('#dContent').textContent.includes('نمره کل وزن‌دار'));

    // 1. Data Center has paired upload UI, monthly templates card, and exact source filenames
    await go(w, 'data');
    assert.ok($('#pairBox'), 'Paired upload box exists');
    assert.ok($('#pairFixedInp') && $('#pairSitInp') && $('#btnPairUpload'));
    assert.ok($('#monthlyScoresCard') && $('#btnDlTicketSample') && $('#btnDlSocialSample'));
    assert.ok($('#statusGrid').textContent.includes('موقعیتی'));
    assert.equal($$('#statusTeams thead th').length, 5);
    assert.ok($('#filesList').textContent.includes(FILES.accFixed), 'Exact Account fixed filename shown');
    assert.ok($('#filesList').textContent.includes(FILES.teleSit), 'Exact Tele situational filename shown');

    // 2. Portfolio master table shows situational column & specialist modal renders #pWeightedCard + #pSituationalCard
    await go(w, 'portfolio');
    assert.ok($$('#pAll thead th').some(th => th.textContent.includes('نمره موقعیتی')));
    assert.ok($$('#pAll thead th').some(th => th.textContent.includes('نمره کل وزن‌دار')));
    const firstAccName = readSampleRows('accSit')[0].account_expert_name;
    const row = $$('#pAll tbody tr').find(tr => tr.dataset.name === firstAccName);
    assert.ok(row, 'Account specialist present in portfolio table');
    row.click();
    await settle(); await settle();
    assert.ok($('#pWeightedCard'), 'Weighted 4-pillar breakdown card rendered');
    assert.ok($('#pWeightedCard').textContent.includes('۴۵٪'));
    assert.ok($('#pWeightedCard').textContent.includes('۲۵٪'));
    assert.ok($('#pSituationalCard'), 'Situational card rendered inside specialist report card');
    assert.ok($('#pSituationalCard').textContent.includes('اعلام جشنواره'));
    assert.equal($$('#pSituationalCard tbody tr').length, 4);
    $('.profile-modal .x').click();

    // 3. Reports (Call tab) keeps 7-col fixed #elemCardWrap AND renders separate #sitCardWrap
    await go(w, 'reports');
    $('#typeTabs button[data-t="call"]').click();
    await settle(); await settle();
    assert.equal($$('#elemCardWrap table thead th').length, 7);
    assert.ok($('#sitCardWrap').textContent.includes('المان‌های موقعیتی'));
    assert.equal($$('#sitCardWrap tbody tr').length, 11); // 4 account + 7 tele

    // 4. Call Analysis renders situational heatmaps & keeps 0 charts
    await go(w, 'call-analysis');
    assert.equal(w.App.charts.length, 0);
    assert.ok($('#anBody').textContent.includes('ماتریس خطای المان‌های موقعیتی'));
    assert.ok($('#anBody').textContent.includes('میانگین نمره موقعیتی'));

    // 5. Criteria page shows 11 fixed + 4 situational for Account, 10 fixed + 7 situational for Tele
    await go(w, 'criteria');
    assert.equal($$('#criteriaRows tr').length, 11);
    assert.equal($$('#criteriaSituational tbody tr').length, 4);
    $$('#criteriaTeams button').find(b => b.textContent.includes('تله')).click();
    await settle();
    assert.equal($$('#criteriaRows tr').length, 10);
    assert.equal($$('#criteriaSituational tbody tr').length, 7);

    assert.deepEqual(errors, []);
  });
}

test('restructure: built standalone apps-script-full/Code.gs persists Call_Situational & Monthly_Scores cleanly', () => {
  const code = fs.readFileSync(path.join(ROOT, 'apps-script-full/Code.gs'), 'utf8');
  assert.ok(code.includes("callSituational: 'Call_Situational'"));
  assert.ok(code.includes("monthlyScores: 'Monthly_Scores'"));
  assert.ok(code.includes('calc_situational_score'));
  assert.ok(code.includes('parseSituationalRows'));
  assert.ok(code.includes('parseMonthlyScoreRows'));
  assert.ok(code.includes('computeWeightedScore'));
  assert.ok(code.includes('deleteSourceFile'));
  assert.ok(code.includes('defaultTeamForForm'));

  // Execute the built Apps Script Code.gs in a mock Google Sheets sandbox (including auto-creating missing tabs!)
  function makeMockSheet(name) {
    let grid = [];
    return {
      getName: () => name,
      getLastRow: () => grid.length,
      getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
      getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
      clearContents: () => { grid = []; },
      setFrozenRows: () => {},
      deleteRows: (row, count) => { grid.splice(row - 1, count); },
      getRange: (r, c, nr, nc) => ({
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = grid[r - 1 + i] || [];
            const slice = [];
            for (let j = 0; j < nc; j++) slice.push(row[c - 1 + j] ?? '');
            out.push(slice);
          }
          return out;
        },
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            if (!grid[r - 1 + i]) grid[r - 1 + i] = [];
            for (let j = 0; j < vals[i].length; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; },
        setFontColor: function () { return this; },
        setDataValidation: function () { return this; }
      })
    };
  }
  const sheetStore = new Map();
  const ss = {
    getId: () => 'mock-ss-1',
    getSheets: () => Array.from(sheetStore.values()),
    getSheetByName: (n) => sheetStore.get(n) || null,
    insertSheet: (n) => { const s = makeMockSheet(n); sheetStore.set(n, s); return s; }
  };
  const propsMap = {};
  const cacheMap = {};
  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Set, Map,
    encodeURIComponent, decodeURIComponent, isNaN, isFinite, parseInt, parseFloat,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => propsMap[k] ?? null, setProperty: (k, v) => { propsMap[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => cacheMap[k] ?? null, put: (k, v) => { cacheMap[k] = String(v); }, getAll: ks => Object.fromEntries(ks.filter(k => k in cacheMap).map(k => [k, cacheMap[k]])), putAll: obj => Object.assign(cacheMap, obj), remove: k => { delete cacheMap[k]; } }) },
    Utilities: { getUuid: () => 'uuid-test-1234', computeDigest: () => [1, 2, 3, 4], DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' } },
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });

  // Pre-create only legacy tabs (intentionally omit Call_Situational & Monthly_Scores to test seamless existing-sheet upgrade!)
  ['Agents', 'Tickets', 'Socials', 'Calls', 'QC_Agents', 'Actions', 'Reminders', 'Action_Types', 'Settings', 'Lists', 'Criteria', 'Meta', 'Call_Metadata', 'Fiscal_Months', 'QC_Users', 'Elements', 'Monthly_Summary']
    .forEach(n => ss.insertSheet(n));

  const db = sandbox.normalizeDatabase_(sandbox.makeSeedDatabase_());
  sandbox.writeDatabaseDiff_(ss, {}, db, true);
  // Remove new tabs to simulate a pre-restructure Google Sheet upgraded in-place!
  sheetStore.delete('Call_Situational');
  sheetStore.delete('Monthly_Scores');
  assert.equal(sheetStore.has('Call_Situational'), false, 'Legacy sheet starts without Call_Situational');
  assert.equal(sheetStore.has('Monthly_Scores'), false, 'Legacy sheet starts without Monthly_Scores');

  // Upload Tele Fixed + Tele Situational + Ticket Monthly via LocalApi inside Code.gs
  const beforeFp = sandbox.diffFingerprints_(db);
  sandbox.window.LocalApi.adoptSnapshot(db);
  sandbox.window.LocalApi.setSession({ name: 'admin', role: 'admin', active: true, unrestricted: true });
  sandbox.window.LocalApi.run('POST', '/api/calls/files', {
    mode: 'append',
    files: [
      { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
      { name: FILES.teleSit, rows: readSampleRows('teleSit') }
    ]
  });
  sandbox.window.LocalApi.run('POST', '/api/monthly-scores/files', {
    mode: 'append',
    files: [{ name: 't.xlsx', rows: [{ 'نام کارشناس': 'هلیا هنرکار', 'نمره تیکت': 90, 'تعداد ارزیابی': 10, 'از تاریخ': '1405/07/25', 'تا تاریخ': '1405/08/21' }] }]
  });
  const written = sandbox.writeDatabaseDiffFp_(ss, beforeFp, sandbox.window.LocalApi.liveDb(), false, null);
  assert.ok(written.includes('callFeedbacks') && written.includes('callSituational') && written.includes('monthlyScores'));
  assert.equal(sheetStore.has('Call_Situational'), true, 'Call_Situational tab auto-created on legacy sheet');
  assert.equal(sheetStore.has('Monthly_Scores'), true, 'Monthly_Scores tab auto-created on legacy sheet');

  // Re-read fresh from mock Google Sheet and verify evalCount + Tele teams + per-file delete
  sandbox.invalidateTabCache_();
  const reloaded = sandbox.normalizeDatabase_(sandbox.readDatabase_(ss));
  assert.equal(reloaded.callFeedbacks.length, 693);
  assert.equal(reloaded.callSituational.length, 42);
  assert.equal(reloaded.monthlyScores.length, 1);
  assert.equal(reloaded.monthlyScores[0].evalCount, 10, 'evalCount decoded cleanly as number');
  assert.equal(reloaded.callFeedbacks.every(r => sandbox.window.QCParse.teamForm(r.team) === 'tele'), true);

  // Per-file deletion inside Code.gs removes ONLY situational file while keeping 693 fixed calls + monthly score intact
  const delFp = sandbox.diffFingerprints_(reloaded);
  sandbox.window.LocalApi.adoptSnapshot(reloaded);
  const delRes = sandbox.window.LocalApi.run('DELETE', '/api/calls/files?name=' + encodeURIComponent(FILES.teleSit) + '&kind=situational', {});
  assert.equal(delRes.ok, true);
  assert.equal(delRes.removedSituational, 42);
  assert.equal(delRes.removedCalls, 0);
  sandbox.writeDatabaseDiffFp_(ss, delFp, sandbox.window.LocalApi.liveDb(), false, null);
  sandbox.invalidateTabCache_();
  const afterDel = sandbox.normalizeDatabase_(sandbox.readDatabase_(ss));
  assert.equal(afterDel.callSituational.length, 0);
  assert.equal(afterDel.callFeedbacks.length, 693, 'Fixed calls stay intact on sheet after deleting situational file');
  assert.equal(afterDel.monthlyScores.length, 1, 'Monthly scores stay intact on sheet after deleting situational file');
});

test('restructure: 4-pillar weighted scoring (45/25/15/15), active normalization, and separate Ticket/Social monthly Excels', async (t) => {
  const db = makeSeedDb();
  I.callFiles(db, [
    { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
    { name: FILES.teleSit, rows: readSampleRows('teleSit') }
  ]);
  const fullRange = { from: '1405/07/25', to: '1405/08/21' };

  // 1) Before Ticket/Social upload: Helia Honarkar has 20/20 fixed calls (78.3) + situational (83.08 from calc_situational_score)
  // Active weight = 45 + 25 = 70%; rawWeightedSum = 56.01; normalized = (45*78.3 + 25*83.08) / 70 = 80.01
  const heliaBefore = R.agentProfile(db, 'هلیا هنرکار', fullRange);
  assert.equal(heliaBefore.calls.count, 20);
  assert.equal(heliaBefore.calls.avgScore, 78.3);
  assert.equal(heliaBefore.situational.avgScore, 83.08);
  assert.equal(heliaBefore.weighted.activeWeight, 70);
  assert.equal(heliaBefore.weighted.rawWeightedSum, 56.01);
  assert.equal(heliaBefore.weighted.score, 80.01);

  // 2) Verify ready-to-use templates in نمونه اکسل ها/ parse cleanly & skip blank scores
  const ticketTplName = 'نمونه_اکسل_نمرات_تیکت.xlsx';
  const socialTplName = 'نمونه_اکسل_نمرات_پیامرسان.xlsx';
  const ticketRaw = XLSX.utils.sheet_to_json(XLSX.readFile(path.join(SAMPLES_DIR, ticketTplName)).Sheets['نمرات_تیکت'], { defval: '' });
  const socialRaw = XLSX.utils.sheet_to_json(XLSX.readFile(path.join(SAMPLES_DIR, socialTplName)).Sheets['نمرات_پیامرسان'], { defval: '' });
  assert.equal(P.classifyMonthlyScoreFile(ticketTplName, ticketRaw), 'ticket');
  assert.equal(P.classifyMonthlyScoreFile(socialTplName, socialRaw), 'social');
  assert.equal(P.parseMonthlyScoreRows(ticketRaw, 'ticket', { agents: db.agents }).length, 0, 'Blank template rows skipped');

  // Fill Helia's Ticket (90) and Social (80) scores
  const hTicketRow = ticketRaw.find(r => P.normName(r['نام کارشناس']) === 'هلیا هنرکار');
  const hSocialRow = socialRaw.find(r => P.normName(r['نام کارشناس']) === 'هلیا هنرکار');
  assert.ok(hTicketRow && hSocialRow, 'Helia present in both ready-to-use templates');
  hTicketRow['نمره تیکت'] = 90; hTicketRow['تعداد ارزیابی'] = 10;
  hSocialRow['نمره پیام‌رسان'] = 80; hSocialRow['تعداد ارزیابی'] = 15;

  const tImp = I.monthlyScoreFiles(db, [{ name: ticketTplName, rows: ticketRaw }]);
  const sImp = I.monthlyScoreFiles(db, [{ name: socialTplName, rows: socialRaw }]);
  assert.equal(tImp.results[0].ok, true); assert.equal(tImp.results[0].channel, 'ticket'); assert.equal(tImp.results[0].count, 1);
  assert.equal(sImp.results[0].ok, true); assert.equal(sImp.results[0].channel, 'social'); assert.equal(sImp.results[0].count, 1);

  // 3) Full 4/4 pillars active: 45%*78.3 + 25%*83.08 + 15%*80 + 15%*90 = 81.505 -> 81.51
  const heliaAfter = R.agentProfile(db, 'هلیا هنرکار', fullRange);
  assert.equal(heliaAfter.tickets.avgScore, 90);
  assert.equal(heliaAfter.tickets.source, 'monthly_excel');
  assert.equal(heliaAfter.socials.avgScore, 80);
  assert.equal(heliaAfter.socials.source, 'monthly_excel');
  assert.equal(heliaAfter.weighted.activeWeight, 100);
  assert.equal(heliaAfter.weighted.rawWeightedSum, 81.51);
  assert.equal(heliaAfter.weighted.score, 81.51);

  // 4) Combined report & Fiscal monthlySummary stay in lockstep
  const comb = R.combinedAgentReport(db, fullRange).find(r => r.name === 'هلیا هنرکار');
  assert.equal(comb.avgScore, 81.51);
  assert.equal(comb.ticketSource, 'monthly_excel');
  assert.equal(comb.socialSource, 'monthly_excel');

  // 5) Google Sheets Monthly_Scores round-trip
  const exported = Sheets.dbToSheetRows(db);
  assert.equal(exported.monthlyScores.length, 2);
  const pulled = Sheets.sheetRowsToDb(exported);
  assert.equal(pulled.monthlyScores.length, 2);
  const fresh = makeSeedDb();
  Sheets.mergePullIntoDb(fresh, pulled, 'merge');
  assert.equal(fresh.monthlyScores.length, 2);

  // 6) Server HTTP UTF-8 multi-chunk upload integrity & exact uploaded filenames in /api/calls/dirstatus
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-http-utf8-'));
  fs.mkdirSync(path.join(dir, 'data/calls'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'shared'), path.join(dir, 'shared'), { recursive: true });
  for (const file of ['server.js', 'callWatcher.js', 'googleSheets.js']) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'data/seed.json'), JSON.stringify(makeSeedDb()));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(dir, 'public'), 'dir');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Server timeout: ' + log)); }, 10000);
    child.stdout.on('data', (chunk) => {
      log += chunk;
      const m = log.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Server exited ' + code + '\n' + log)); });
  });

  await fetch(baseUrl + '/api/calls/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'append',
      files: [
        { name: FILES.teleFixed, rows: readSampleRows('teleFixed') },
        { name: FILES.teleSit, rows: readSampleRows('teleSit') },
        { name: FILES.accFixed, rows: readSampleRows('accFixed') },
        { name: FILES.accSit, rows: readSampleRows('accSit') }
      ]
    })
  });
  await fetch(baseUrl + '/api/monthly-scores/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'append', files: [{ name: ticketTplName, rows: ticketRaw }] })
  });
  await fetch(baseUrl + '/api/monthly-scores/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'append', files: [{ name: socialTplName, rows: socialRaw }] })
  });

  // Verify zero UTF-8 replacement corruption on large Persian POST body & exact 20/20 Helia Honarkar rows!
  const httpHelia = await fetch(`${baseUrl}/api/portfolio?ident=${encodeURIComponent('هلیا هنرکار')}&from=1405/07/25&to=1405/08/21`).then(r => r.json());
  assert.equal(httpHelia.calls.count, 20, 'No UTF-8 chunk corruption dropping row 363!');
  assert.equal(httpHelia.calls.avgScore, 78.3);
  assert.equal(httpHelia.weighted.score, 81.51);

  // Verify /api/calls/dirstatus lists ALL 6 exact uploaded filenames (not just disk files)
  const ds = await fetch(`${baseUrl}/api/calls/dirstatus`).then(r => r.json());
  const names = (ds.files || []).map(f => f.name);
  for (const expectedName of [FILES.teleFixed, FILES.teleSit, FILES.accFixed, FILES.accSit, ticketTplName, socialTplName]) {
    assert.ok(names.includes(expectedName), `dirstatus must include exact uploaded filename: ${expectedName}`);
  }
  assert.equal(ds.counts.monthlyTicket, 1);
  assert.equal(ds.counts.monthlySocial, 1);

  // 7) Per-file deletion on HTTP server removes ONLY the targeted source file (fixed, situational, monthly)
  const delSit = await fetch(`${baseUrl}/api/calls/files?name=${encodeURIComponent(FILES.accSit)}&kind=situational`, { method: 'DELETE' }).then(r => r.json());
  assert.equal(delSit.ok, true);
  assert.equal(delSit.removedSituational, 23);
  assert.equal(delSit.counts.situationalAccount, 0);
  assert.equal(delSit.counts.situationalTele, 42);
  assert.equal(delSit.counts.total, 1016); // Fixed calls untouched!
  assert.equal(delSit.status.files.some(f => f.name === FILES.accSit), false);

  const delTicket = await fetch(`${baseUrl}/api/calls/files?name=${encodeURIComponent(ticketTplName)}&kind=ticket_monthly`, { method: 'DELETE' }).then(r => r.json());
  assert.equal(delTicket.ok, true);
  assert.equal(delTicket.removedMonthly, 1);
  assert.equal(delTicket.counts.monthlyTicket, 0);
  assert.equal(delTicket.counts.monthlySocial, 1); // Social monthly untouched!

  const delTeleFixed = await fetch(`${baseUrl}/api/calls/files?name=${encodeURIComponent(FILES.teleFixed)}&kind=form`, { method: 'DELETE' }).then(r => r.json());
  assert.equal(delTeleFixed.ok, true);
  assert.equal(delTeleFixed.removedCalls, 693);
  assert.equal(delTeleFixed.counts.tele, 0);
  assert.equal(delTeleFixed.counts.account, 323); // Account fixed untouched!
});

test('Target team categorization, unlinked situational backfill, and UI per-file deletion', async (t) => {
  // 1) Unregistered Tele & Account experts auto-assign to Telesales / Account; MLM stays unset without importTeam
  const db = makeSeedDb();
  const teleRows = readSampleRows('teleFixed');
  const teleSitRows = readSampleRows('teleSit');
  const accRows = readSampleRows('accFixed');
  const accSitRows = readSampleRows('accSit');

  // Column sniffing overrides accidental wrong #importTeam on renamed file
  const clsRenamed = P.classifyCallFile('گزارش_آبان.xlsx', teleRows, null, 'Account');
  assert.equal(clsRenamed.kind, 'fixed');
  assert.equal(clsRenamed.formType, 'tele', 'tele_expert_name column must win over accidental Account importTeam');

  // Upload situational BEFORE fixed — verify period backfill when fixed arrives later!
  const firstSit = I.callFiles(db, [{ name: FILES.teleSit, rows: teleSitRows }], { mode: 'append' });
  assert.equal(firstSit.results[0].ok, true);
  assert.equal(db.callSituational[0].periodFrom, '');
  assert.equal(db.callSituational.every(r => P.teamForm(r.team) === 'tele'), true, 'All 42 Tele situational experts must have Tele team');

  const thenFixed = I.callFiles(db, [
    { name: FILES.teleFixed, rows: teleRows },
    { name: FILES.accFixed, rows: accRows },
    { name: FILES.accSit, rows: accSitRows }
  ], { mode: 'append' });
  assert.equal(thenFixed.ok, true);
  assert.equal(db.callSituational.filter(r => r.formType === 'tele').every(r => r.periodFrom === '1405/07/25' && r.periodTo === '1405/08/21'), true,
    'Previously unlinked Tele situational rows must auto-backfill period when Tele fixed file is uploaded');

  // Zero Tele or Account rows should fall into «بدون تیم»!
  const ds = R.dataStatus(db, {});
  assert.equal(ds.byTeam.some(x => x.team === 'بدون تیم'), false, 'No Tele or Account rows should be dumped into بدون تیم');
  assert.equal(ds.byTeam.find(x => x.team === 'Tele sales').callCount, 693);
  assert.equal(ds.byTeam.find(x => x.team === 'Account').callCount, 323);

  // Filtering callAnalysis by team Tele sales must include ALL 42 Tele specialists (not only the 26 in seed.json)
  const anTele = R.callAnalysis(db, { form: 'tele', team: 'Tele sales' }, P.resolver(db.settings.callCriteria));
  assert.equal(anTele.kpis.totalCalls, 693);
  assert.equal(anTele.kpis.expertsWithData, 42);
  assert.equal(anTele.kpis.situationalCount, 42);

  // Filtering monthlyScores by "Telesales" matches agents whose team is "Tele sales"
  db.monthlyScores = [{ channel: 'ticket', expertName: 'هلیا هنرکار', team: 'Tele sales', periodFrom: '1405/07/25', periodTo: '1405/08/21', score: 90, evalCount: 5, sourceFile: 't.xlsx' }];
  assert.equal(R.filterMonthlyScores(db, { team: 'Telesales', from: '1405/07/25', to: '1405/08/21' }, 'ticket').length, 1);

  // 2) Disk watcher respects dismissed files after per-file deletion and does not re-import on rescan
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-dismiss-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const origCallsDir = process.env.CRM_QC_CALLS_DIR;
  process.env.CRM_QC_CALLS_DIR = tmpDir;
  t.after(() => {
    if (origCallsDir === undefined) delete process.env.CRM_QC_CALLS_DIR;
    else process.env.CRM_QC_CALLS_DIR = origCallsDir;
  });
  fs.copyFileSync(path.join(SAMPLES_DIR, FILES.accFixed), path.join(tmpDir, FILES.accFixed));
  delete require.cache[require.resolve('../callWatcher')];
  const CW = require('../callWatcher');
  const wdb = makeSeedDb();
  CW.scanOnce(wdb);
  assert.equal(wdb.callFeedbacks.length, 323);
  I.deleteSourceFile(wdb, FILES.accFixed, 'form');
  CW.dismissFile(wdb, FILES.accFixed);
  assert.equal(wdb.callFeedbacks.length, 0);
  const rescan = CW.scanOnce(wdb);
  assert.equal(rescan.changed, false);
  assert.equal(wdb.callFeedbacks.length, 0, 'Dismissed disk file must NOT be silently re-imported');
  assert.equal(CW.dirStatus(wdb).files.filter(f => !f.skipped && f.rows > 0).length, 0);

  // 3) Browser UI: Data Center per-file delete button, range alert, and Reports default tab for call-only data
  const env = browser('public', db);
  t.after(() => env.dom.window.close());
  const { w } = env;
  await w.App.boot();
  w.App.bindDateRangeUI();
  await w.App.setDateRange({ preset: 'custom', from: '1405/06/01', to: '1405/06/31' });
  await go(w, 'data');
  await settle();

  // Top statusRangeAlert warns that 0 calls are visible in 1405/06 while 1016 calls exist in 1405/07/25..1405/08/21
  const topAlert = w.document.querySelector('#statusRangeAlert');
  assert.ok(topAlert && topAlert.style.display !== 'none', 'Top statusRangeAlert must be visible when date range hides all uploaded calls');
  assert.ok(topAlert.textContent.includes('۱۴۰۵/۰۷/۲۵'));

  // Per-file delete buttons exist in #filesList for all loaded files
  const delBtns = [...w.document.querySelectorAll('#filesList .btn-del-file')];
  assert.ok(delBtns.length >= 4, 'Each source file row must have a per-file delete button');
  const accSitBtn = delBtns.find(b => b.dataset.file === FILES.accSit);
  assert.ok(accSitBtn, 'Delete button must exist for Account situational file');
  accSitBtn.click();
  await settle();
  const cfYes = w.document.querySelector('#cfYes');
  assert.ok(cfYes, 'Confirmation dialog must open before deleting a source file');
  cfYes.click();
  await settle();
  const remainingBtns = [...w.document.querySelectorAll('#filesList .btn-del-file')];
  assert.equal(remainingBtns.some(b => b.dataset.file === FILES.accSit), false, 'Deleted file must disappear from #filesList');
  assert.equal(remainingBtns.some(b => b.dataset.file === FILES.teleFixed), true, 'Other source files must remain untouched');

  // Clicking Reports with call-only data (0 tickets, 0 socials) auto-opens on Call tab instead of empty Social
  await w.App.setDateRange({ preset: 'custom', from: '1405/07/25', to: '1405/08/21' });
  await go(w, 'reports');
  await settle();
  assert.ok(w.document.querySelector('#typeTabs button[data-t="call"]').classList.contains('active'),
    'Reports page must auto-open on Call tab when only call data exists');
  assert.ok(w.document.querySelectorAll('#tblWrap tbody tr').length >= 42, 'Call report must immediately display all uploaded specialists');
  assert.equal(env.errors.length, 0);
});
