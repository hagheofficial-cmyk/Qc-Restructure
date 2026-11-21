/* =========================================================================
 * callWatcher.js — اتصال پوشه‌ی دیتای تماس به سامانه (تنها سمت سرور)
 *   هر WATCH_INTERVAL_MS ثانیه پوشه data/calls را بازبینی می‌کند:
 *   - qc_recovery.json      → مسیر /api/calls (recovery)
 *   - qc_<type>_form_*.xlsx → parseQc.parseRows → ستون به callFeedbacks
 *   چاپگونه‌ی ذخیره: db.callRaw + db.callFeedbacks (ادغام‌شده از همه‌ی تیم‌ها)
 *   فایل‌هایی که مرتبه‌ی mtimeشان تغییر نکند دوباره‌واره پارس نمی‌شوند.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./shared/parseQc.js');
const C = require('./shared/calc.js');
const ImportData = require('./shared/importData.js');

const DIR = process.env.CRM_QC_CALLS_DIR || path.join(__dirname, 'data', 'calls');
const INTERVAL_MS = 15000;

let XLSX = null;
function lazyXLSX() {
  if (XLSX == null) {
    try { XLSX = require('xlsx'); } catch (e) { console.warn('[calls] xlsx قابل بارگذاری نیست — فرم‌های xlsx متوقف می‌ماند. npm install را اجرا کنید.'); XLSX = false; }
  }
  return XLSX || null;
}

/* ---------- نرمال‌سازی نام: فاصله‌ی نیم‌فاصه‌ی فارسی و گوذر ---------- */
function normName(s) { return P.normName(s); }

/* ---------- ادغام دیتاهای پارس‌شده در store ---------- */
/* xx باید آبجکتهایی به شکل { expertName, score, redline, redlineReason, leadName, leadPhone,
   listeningTime, qcComment, reviewDate, formType, elements } را در db.callFeedbacks ذخیره کند.
   نرمال‌سازی برای گزارش‌ها: expertName با نام کارشناسی agents هماهنگ می‌شود (trim). */
function mergeCallRows(db, rows) {
  if (!db.callFeedbacks) db.callFeedbacks = [];
  // ردیف‌های برخاسته از هر فایل که این مرتبه خوانده‌ایم را بر اساس نام‌فایل جایگزین می‌کنیم؟
  // دانین‌گ: مرجع db.callFeedbacks جامدتر است — ردیف‌های هم‌اسم را حذف و دوباره اضافه کنیم
  // تا مسیرهای تکراری فایل دیگر مشکلی پیش نیاید. همچنین تگ sourceFile بگذاریم.
  db.callFeedbacks = ImportData.mergeRows(db.callFeedbacks, rows, 'call').rows;
}

function dedupeCallRows(db) {
  // ردیف‌های تکراری بر اساس **تاریخ بررسی** + هویت + محتوای کامل ریت (ریتِ یک‌تای مستقل از
  // فایل مبدأ): اگر یک ریت همزمان در فایل این هفته و هفته بعدی باشد، یک‌بار نگه می‌شود.
  // دو ریتِ مستقلِ یک‌محتوا از یک فایلِ مبدأ هر دو نگه می‌شوند.
  const seen = new Map();
  const out = [];
  for (const r of (db.callFeedbacks || [])) {
    const key = P.ritKey(r, 'call') || P.callRowKey(r);
    if (!key) { out.push(r); continue; }
    const file = String(r.sourceFile || '');
    if (seen.has(key)) {
      const firstFile = seen.get(key);
      /* فقط تکرارِ هفتگی (مبدأِ متفاوت) حذف می‌شود */
      if (firstFile && file && firstFile !== file) continue;
    } else { seen.set(key, file || ''); }
    out.push(r);
  }
  db.callFeedbacks = out;
}

/* ---------- خواندن یک فایل QC recovery (JSON) ---------- */
function readRecoveryFile(recPath) {
  const txt = fs.readFileSync(recPath, 'utf8');
  const obj = JSON.parse(txt);
  const tele = Array.isArray(obj.teleRawData) ? obj.teleRawData : [];
  const acc = Array.isArray(obj.accRawData) ? obj.accRawData : [];
  const mlm = Array.isArray(obj.mlmRawData) ? obj.mlmRawData : [];

  const norm = (r, formType, sourceFile) => ({
    expertName: normName(r.expertName),
    score: C.normalizeScore(r.score),
    redline: P.isRedline(r.redline) ? 1 : 0,
    redlineReason: String(r.redlineReason || '').trim(),
    leadName: String(r.leadName || 'نامشخص').trim(),
    leadPhone: String(r.leadPhone || '').trim(),
    listeningTime: String(r.listeningTime || '-').replace(/["']/g, '').trim() || '-',
    callDuration: String(r.callDuration == null ? '' : r.callDuration).trim(),
    qcAgent: String(r.qcAgent == null ? '' : r.qcAgent).trim(),
    qcComment: String(r.qcComment || '').trim(),
    reviewDate: P.anyToJalali(r.reviewDate || r.registrationDateRaw || r.dateRaw) ? (function () { const j = P.anyToJalali(r.reviewDate || r.registrationDateRaw || r.dateRaw); return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0'); })() : '',
    formType,
    elements: r.elements || {},
    actions: '',
    sourceFile
  });

  const all = [
    ...tele.map((r) => norm(r, 'tele', sourceFileObj())),
    ...acc.map((r) => norm(r, 'account', sourceFileObj())),
    ...mlm.map((r) => norm(r, 'mlm', sourceFileObj()))
  ];
  function sourceFileObj() { return 'qc_recovery.json'; }
  return { rows: all, storedActions: obj.storedActions || {}, voiceMeta: obj.voiceMeta || {}, monthlyNotices: obj.monthlyNotices || {} };
}

/* ---------- خواندن یک فرم QC اکسل (ثابت یا موقعیتی) ---------- */
function readSpreadsheetRows(filePath) {
  const x = lazyXLSX();
  if (!x) return null;
  const wb = x.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = x.utils.sheet_to_json(sheet);
  return rows && rows.length ? rows : null;
}

function readFormFile(filePath, db) {
  const rows = readSpreadsheetRows(filePath);
  if (!rows) return null;
  const baseName = path.basename(filePath);
  const cls = P.classifyCallFile(baseName, rows, db && db.settings.callCriteria);
  if (!cls.formType) return null;
  if (cls.kind === 'situational') {
    return { kind: 'situational', rawRows: rows, type: cls.formType, base: baseName };
  }
  if (cls.kind === 'monthly_score') {
    return { kind: 'monthly_score', rawRows: rows, type: cls.formType, base: baseName };
  }
  const parsed = P.parseRows(rows, cls.formType, { agents: db && db.agents, criteria: db && db.settings.callCriteria });
  if (!parsed.length) return null;
  const range = P.dateRangeOfCalls(parsed);
  return {
    kind: 'fixed',
    rows: parsed.map((r) => Object.assign({ sourceFile: baseName }, r)),
    rawRows: rows,
    type: cls.formType,
    count: parsed.length,
    periodFrom: range.from,
    periodTo: range.to,
    base: baseName
  };
}

/* ---------- امضای فایل دیسکی و مدیریت فایل‌های حذف‌شده توسط کاربر ---------- */
function diskFileSig(fileName) {
  try {
    const full = path.join(DIR, fileName);
    if (!fs.existsSync(full)) return null;
    const st = fs.statSync(full);
    return 'v' + P.PARSER_VERSION + ':' + st.mtimeMs + ':' + st.size;
  } catch (e) { return null; }
}

function dismissFile(db, fileName) {
  const name = String(fileName || '').trim();
  if (!name) return;
  const sig = diskFileSig(name);
  if (!sig) return;
  db.callSync = db.callSync || {};
  db.callSync.files = db.callSync.files || {};
  db.callSync.dismissed = db.callSync.dismissed || {};
  db.callSync.dismissed[name] = sig;
  db.callSync.files[name] = sig;
}

function undismissFile(db, fileName) {
  const name = String(fileName || '').trim();
  if (!name || !db.callSync || !db.callSync.dismissed) return;
  delete db.callSync.dismissed[name];
}

function dismissAllDiskFiles(db) {
  try {
    if (!fs.existsSync(DIR)) return;
    const files = fs.readdirSync(DIR).filter((f) => f !== '.gitkeep' && !f.endsWith('.md'));
    for (const f of files) dismissFile(db, f);
  } catch (e) { /* نادیده */ }
}

/* ---------- اسکن یک‌باره‌ی پوشه ---------- */
function scanOnce(db, saveCallback, log) {
  let changed = false;
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    if (!Array.isArray(db.callSituational)) db.callSituational = [];
    const files = fs.readdirSync(DIR).filter((f) => f !== '.gitkeep' && !f.endsWith('.md'));
    const clicks = (db.callSync && db.callSync.files) || {};
    const dismissed = (db.callSync && db.callSync.dismissed) || {};

    const newFiles = {};
    const nextDismissed = {};
    let delta = { added: 0, updated: 0, recovered: 0 };

    // خوانایی موجود برای همه‌ی قسمت‌ها؟ بررسی به ترتیب — ابتدا recovery (تک‌منبع)
    const recFile = files.find((f) => f === 'qc_recovery.json');
    if (recFile) {
      const st = fs.statSync(path.join(DIR, recFile));
      const sig = 'v' + P.PARSER_VERSION + ':' + st.mtimeMs + ':' + st.size;
      if (dismissed[recFile] && dismissed[recFile] === sig) {
        newFiles[recFile] = sig;
        nextDismissed[recFile] = sig;
      } else if (clicks[recFile] !== sig) {
        try {
          const rec = readRecoveryFile(path.join(DIR, recFile));
          mergeCallRows(db, rec.rows);
          db.callRaw = {
            teleRawData: rec.rows.filter((r) => r.formType === 'tele'),
            accRawData: rec.rows.filter((r) => r.formType === 'account'),
            mlmRawData: rec.rows.filter((r) => r.formType === 'mlm'),
            storedActions: rec.storedActions,
            voiceMeta_hash: undefined,
            monthlyNotices: rec.monthlyNotices
          };
          db.callImport = db.callImport || {};
          db.callImport.importedAt = new Date().toISOString();
          db.callImport.recovery = true;
          changed = true; delta.recovered = rec.rows.length;
          newFiles[recFile] = sig;
          log && log('qc_recovery.json →', rec.rows.length, 'ردیف');
        } catch (e) { console.warn('[calls] recovery نامعتبر:', e.message); }
      } else newFiles[recFile] = sig;
    }

    // پاس ۱: فایل‌های ثابت (ریز نمرات) — استخراج بازه تاریخ برای اتصال خودکار به فایل موقعیتی
    const pendingSituational = [];
    const pendingMonthly = [];
    const pendingPivot = [];
    const batchRanges = Object.create(null);

    for (const f of files) {
      if (f === recFile) continue;
      const lower = f.toLowerCase();
      if (!/\.(xlsx|xls|csv)$/.test(lower)) continue;
      const st = fs.statSync(path.join(DIR, f));
      const sig = 'v' + P.PARSER_VERSION + ':' + st.mtimeMs + ':' + st.size;
      if (dismissed[f] && dismissed[f] === sig) {
        newFiles[f] = sig;
        nextDismissed[f] = sig;
        continue;
      }
      if (clicks[f] !== sig) {
        try {
          const fx = readFormFile(path.join(DIR, f), db);
          if (!fx) continue;
          if (fx.kind === 'situational') {
            pendingSituational.push({ f, sig, fx });
            continue;
          }
          if (fx.kind === 'monthly_score') {
            pendingMonthly.push({ f, sig, fx });
            continue;
          }
          if (fx.kind === 'pivot') {
            pendingPivot.push({ f, sig, fx });
            continue;
          }
          if (fx.rows) {
            mergeCallRows(db, fx.rows);
            if (fx.periodFrom || fx.periodTo) {
              const prev = batchRanges[fx.type];
              batchRanges[fx.type] = {
                from: prev && prev.from && (!fx.periodFrom || prev.from < fx.periodFrom) ? prev.from : fx.periodFrom,
                to: prev && prev.to && (!fx.periodTo || prev.to > fx.periodTo) ? prev.to : fx.periodTo,
                fileName: f
              };
            }
            if (db.callRaw) {
              const fresh = fx.rows.map((r) => { const { sourceFile, ...rest } = r; return rest; });
              if (fx.type === 'tele') db.callRaw.teleRawData = fresh;
              else if (fx.type === 'account') db.callRaw.accRawData = fresh;
              else db.callRaw.mlmRawData = fresh;
            }
            /* ردیف‌های خام اکسل برای بازکردن دقیق در داشبورد آمار ریت */
            if (fx.rawRows && fx.rawRows.length) {
              db.ritRaw = db.ritRaw || {};
              if (!db.ritRaw[f]) db.ritRaw[f] = { headers: Object.keys(fx.rawRows[0] || {}), rows: fx.rawRows.slice(0, 20000) };
            }
            changed = true; delta[fx.type] = (delta[fx.type] || 0) + fx.count;
            newFiles[f] = sig;
            log && log(base(f), fx.count + ' ردیف ثابت (' + fx.type + ')');
          }
        } catch (e) { console.warn('[calls] خطا در', f, '→', e.message); }
      } else newFiles[f] = sig;
    }

    // پاس ۲: فایل‌های موقعیتی (score_calc) — اتصال خودکار به بازه‌ی فایل ثابت هم‌تیم
    for (const item of pendingSituational) {
      try {
        const fx = item.fx;
        const paired = batchRanges[fx.type] || null;
        let pFrom = (paired && paired.from) || '';
        let pTo = (paired && paired.to) || '';
        let pairedFile = (paired && paired.fileName) || '';
        if (!pFrom && !pTo) {
          const existingOfForm = (db.callFeedbacks || []).filter((r) => r.formType === fx.type && r.reviewDate);
          if (existingOfForm.length) {
            const fbRange = P.dateRangeOfCalls(existingOfForm);
            pFrom = fbRange.from; pTo = fbRange.to;
            pairedFile = existingOfForm[existingOfForm.length - 1].sourceFile || '';
          }
        }
        const parsed = P.parseSituationalRows(fx.rawRows, fx.type, {
          agents: db && db.agents,
          criteria: db && db.settings.callCriteria,
          periodFrom: pFrom,
          periodTo: pTo,
          sourceFile: item.f,
          pairedFixedFile: pairedFile
        });
        if (parsed.length) {
          ImportData.situational(db, parsed, 'append', item.f);
          if (fx.rawRows && fx.rawRows.length) {
            db.ritRaw = db.ritRaw || {};
            if (!db.ritRaw[item.f]) db.ritRaw[item.f] = { headers: Object.keys(fx.rawRows[0] || {}), rows: fx.rawRows.slice(0, 20000) };
          }
          changed = true;
          delta['situational_' + fx.type] = (delta['situational_' + fx.type] || 0) + parsed.length;
          newFiles[item.f] = item.sig;
          log && log(base(item.f), parsed.length + ' ردیف موقعیتی (' + fx.type + ', ' + (pFrom || '—') + '..' + (pTo || '—') + ')');
        }
      } catch (e) { console.warn('[calls] خطا در فایل موقعیتی', item.f, '→', e.message); }
    }

    // پاس ۳: فایل‌های نمره‌ی ماهانه تیکت و پیام‌رسان
    for (const item of pendingMonthly) {
      try {
        const fx = item.fx;
        const fbRange = P.dateRangeOfCalls(db.callFeedbacks || []);
        const parsed = P.parseMonthlyScoreRows(fx.rawRows, fx.type, {
          agents: db && db.agents,
          periodFrom: fbRange.from,
          periodTo: fbRange.to,
          sourceFile: item.f
        });
        if (parsed.length) {
          const nowIso = new Date().toISOString();
          parsed.forEach((r) => { r.importedAt = nowIso; });
          ImportData.monthlyScores(db, parsed, 'append', item.f, fx.type);
          if (fx.rawRows && fx.rawRows.length) {
            db.ritRaw = db.ritRaw || {};
            if (!db.ritRaw[item.f]) db.ritRaw[item.f] = { headers: Object.keys(fx.rawRows[0] || {}), rows: fx.rawRows.slice(0, 20000) };
          }
          changed = true;
          delta['monthly_' + fx.type] = (delta['monthly_' + fx.type] || 0) + parsed.length;
          newFiles[item.f] = item.sig;
          log && log(base(item.f), parsed.length + ' ردیف نمره ماهانه (' + fx.type + ')');
        }
      } catch (e) { console.warn('[calls] خطا در فایل نمره ماهانه', item.f, '→', e.message); }
    }

    // پاس ۴: فایل‌های پيورگ ریت
    for (const item of pendingPivot) {
      try {
        const fx = item.fx;
        const parsed = P.parsePivotRows(fx.rawRows, { sourceFile: item.f });
        if (parsed.length) {
          const fallback = ImportData.pivotDateFromName(item.f);
          const nowIso = new Date().toISOString();
          parsed.forEach((r) => {
            r.team = '';
            r.periodFrom = fallback;
            r.periodTo = fallback;
            r.importedAt = nowIso;
          });
          const counts = ImportData.pivots(db, parsed, 'append', item.f);
          if (fx.rawRows && fx.rawRows.length) {
            db.ritRaw = db.ritRaw || {};
            if (!db.ritRaw[item.f]) db.ritRaw[item.f] = { headers: Object.keys(fx.rawRows[0] || {}), rows: fx.rawRows.slice(0, 20000) };
          }
          changed = true;
          delta.pivot = (delta.pivot || 0) + (counts.added || parsed.length);
          newFiles[item.f] = item.sig;
          log && log(base(item.f), parsed.length + ' سلول پيورگ');
        }
      } catch (e) { console.warn('[calls] خطا در فایل پيورگ', item.f, '→', e.message); }
    }

    if (changed) {
      dedupeCallRows(db);
      db.callSync = db.callSync || {};
      db.callSync.files = newFiles;
      db.callSync.dismissed = nextDismissed;
      db.callSync.syncedAt = new Date().toISOString();
      db.callImport = db.callImport || {};
      db.callImport.importedAt = db.callImport.importedAt || db.callSync.syncedAt;
      db.callImport.counts = db.callImport.counts || {};
      db.callImport.counts.total = (db.callFeedbacks || []).length;
      db.callImport.counts.tele = (db.callFeedbacks || []).filter((r) => r.formType === 'tele').length;
      db.callImport.counts.account = (db.callFeedbacks || []).filter((r) => r.formType === 'account').length;
      db.callImport.counts.mlm = (db.callFeedbacks || []).filter((r) => r.formType === 'mlm').length;
      db.callImport.counts.situational = (db.callSituational || []).length;
      db.callImport.counts.situationalTele = (db.callSituational || []).filter((r) => r.formType === 'tele').length;
      db.callImport.counts.situationalAccount = (db.callSituational || []).filter((r) => r.formType === 'account').length;
      db.callImport.counts.monthlyTicket = (db.monthlyScores || []).filter((r) => r.channel === 'ticket').length;
      db.callImport.counts.monthlySocial = (db.monthlyScores || []).filter((r) => r.channel === 'social').length;
      if (saveCallback) saveCallback();
    }
    return { changed, delta };
  } catch (e) {
    console.warn('[calls] بازبینی پوشه با خطا مواجه شد:', e.message);
    return { changed: false, delta: {} };
  }
}

function base(f) { return path.basename(f); }

/* ---------- راه‌اندازی واچر (تاژو) ---------- */
let timer = null;
function start(db, saveCallback, intervalMs) {
  stop();
  // یکبار اکنون + هر INTERVAL_MS
  scanOnce(db, saveCallback, (m) => console.log('[calls]', m));
  const ms = Math.max(3000, intervalMs || INTERVAL_MS);
  timer = setInterval(() => { scanOnce(db, saveCallback); }, ms);
  timer.unref && timer.unref();
  console.log('[calls] پوشه‌ی دیتا:', DIR, '| هر', ms / 1000, 'ثانیه');
}

function stop() { if (timer) clearInterval(timer); timer = null; }

/* ---------- وضعیت فایل‌های منبع برای نمایش در UI ---------- */
/* اتحاد کامل فایل‌های پوشه‌ی data/calls و همه‌ی فایل‌های آپلودشده از مرورگر
 * (ثابت، موقعیتی، نمره ماهانه تیکت و پیام‌رسان) با نام دقیق فایل، بازه تاریخ و شمارش ردیف. */
function dirStatus(db) {
  let diskFiles = [];
  try {
    if (fs.existsSync(DIR)) diskFiles = fs.readdirSync(DIR);
  } catch (e) { /* نادیده */ }
  diskFiles = diskFiles.filter((f) => f !== '.gitkeep' && !f.endsWith('.md'));
  const diskSet = new Set(diskFiles);
  const synced = (db.callSync && db.callSync.files) || {};
  const dismissed = (db.callSync && db.callSync.dismissed) || {};

  const fixedByFile = Object.create(null);
  const sitByFile = Object.create(null);
  const monthlyByFile = Object.create(null);
  const pivotByFile = Object.create(null);
  const allDates = [];

  for (const r of (db.callFeedbacks || [])) {
    if (r.reviewDate) allDates.push(r.reviewDate);
    if (!r.sourceFile) continue;
    const rec = fixedByFile[r.sourceFile] || (fixedByFile[r.sourceFile] = { rows: 0, forms: new Set(), from: '', to: '', mtime: 0 });
    rec.rows++;
    if (r.formType) rec.forms.add(r.formType);
    if (r.reviewDate) {
      if (!rec.from || r.reviewDate < rec.from) rec.from = r.reviewDate;
      if (!rec.to || r.reviewDate > rec.to) rec.to = r.reviewDate;
    }
    if (r.importedAt) { const t = Date.parse(r.importedAt); if (t && t > rec.mtime) rec.mtime = t; }
  }
  for (const r of (db.callSituational || [])) {
    if (r.periodFrom) allDates.push(r.periodFrom);
    if (r.periodTo) allDates.push(r.periodTo);
    if (!r.sourceFile) continue;
    const rec = sitByFile[r.sourceFile] || (sitByFile[r.sourceFile] = { rows: 0, forms: new Set(), from: '', to: '', pairedFixedFile: '', mtime: 0 });
    rec.rows++;
    if (r.formType) rec.forms.add(r.formType);
    if (r.periodFrom && (!rec.from || r.periodFrom < rec.from)) rec.from = r.periodFrom;
    if (r.periodTo && (!rec.to || r.periodTo > rec.to)) rec.to = r.periodTo;
    if (r.pairedFixedFile && !rec.pairedFixedFile) rec.pairedFixedFile = r.pairedFixedFile;
    if (r.importedAt) { const t = Date.parse(r.importedAt); if (t && t > rec.mtime) rec.mtime = t; }
  }
  for (const r of (db.monthlyScores || [])) {
    if (r.periodFrom) allDates.push(r.periodFrom);
    if (r.periodTo) allDates.push(r.periodTo);
    if (!r.sourceFile) continue;
    const rec = monthlyByFile[r.sourceFile] || (monthlyByFile[r.sourceFile] = { rows: 0, channel: r.channel || '', from: '', to: '', mtime: 0 });
    rec.rows++;
    if (r.channel && !rec.channel) rec.channel = r.channel;
    if (r.periodFrom && (!rec.from || r.periodFrom < rec.from)) rec.from = r.periodFrom;
    if (r.periodTo && (!rec.to || r.periodTo > rec.to)) rec.to = r.periodTo;
    if (r.importedAt) { const t = Date.parse(r.importedAt); if (t && t > rec.mtime) rec.mtime = t; }
  }
  for (const r of (db.ritPivots || [])) {
    if (r.periodFrom) allDates.push(r.periodFrom);
    if (!r.sourceFile) continue;
    const rec = pivotByFile[r.sourceFile] || (pivotByFile[r.sourceFile] = { rows: 0, from: '', to: '', mtime: 0 });
    rec.rows += (r.count || 1);
    if (r.periodFrom && (!rec.from || r.periodFrom < rec.from)) rec.from = r.periodFrom;
    if (r.periodTo && (!rec.to || r.periodTo > rec.to)) rec.to = r.periodTo;
    if (r.importedAt) { const t = Date.parse(r.importedAt); if (t && t > rec.mtime) rec.mtime = t; }
  }

  const allNames = new Set([
    ...diskFiles,
    ...Object.keys(fixedByFile),
    ...Object.keys(sitByFile),
    ...Object.keys(monthlyByFile),
    ...Object.keys(pivotByFile)
  ]);

  const out = Array.from(allNames).map((f) => {
    const onDisk = diskSet.has(f);
    let size = null, mtime = null, sig = null;
    if (onDisk) {
      try {
        const st = fs.statSync(path.join(DIR, f));
        size = st.size; mtime = st.mtimeMs;
        sig = 'v' + P.PARSER_VERSION + ':' + st.mtimeMs + ':' + st.size;
      } catch (e) {}
    }
    const fx = fixedByFile[f] || null;
    const sx = sitByFile[f] || null;
    const mx = monthlyByFile[f] || null;
    const px = pivotByFile[f] || null;
    const lower = f.toLowerCase();

    let kind = 'other', type = null, detected = 'unknown', rows = 0, periodFrom = '', periodTo = '', pairedFixedFile = '';
    if (f === 'qc_recovery.json') {
      kind = 'recovery'; detected = 'tele+account+mlm'; rows = fx ? fx.rows : 0;
      if (fx) { periodFrom = fx.from; periodTo = fx.to; }
    } else if (mx) {
      kind = mx.channel === 'social' ? 'social_monthly' : 'ticket_monthly';
      type = mx.channel || null;
      detected = mx.channel === 'social' ? 'social' : 'ticket';
      rows = mx.rows; periodFrom = mx.from; periodTo = mx.to;
      if (!mtime && mx.mtime) mtime = mx.mtime;
    } else if (sx || (onDisk && /\.(xlsx|xls|csv)$/.test(lower) && P.isSituationalFile(f))) {
      kind = 'situational';
      type = (sx && Array.from(sx.forms)[0]) || P.formTypeOfFileName(f) || null;
      detected = type || '(تشخیص از محتوا)';
      rows = sx ? sx.rows : 0;
      if (sx) { periodFrom = sx.from; periodTo = sx.to; pairedFixedFile = sx.pairedFixedFile; if (!mtime && sx.mtime) mtime = sx.mtime; }
    } else if (px) {
      kind = 'pivot';
      detected = 'پيورگ ریت';
      rows = px ? px.rows : 0;
      if (px) { periodFrom = px.from; periodTo = px.to; if (!mtime && px.mtime) mtime = px.mtime; }
    } else if (fx || (onDisk && /\.(xlsx|xls|csv)$/.test(lower))) {
      kind = 'form';
      const forms = fx ? Array.from(fx.forms) : [];
      type = forms.length === 1 ? forms[0] : (P.formTypeOfFileName(f) || null);
      detected = forms.length ? forms.join('+') : (P.formTypeOfFileName(f) || '(تشخیص از محتوا)');
      rows = fx ? fx.rows : 0;
      if (fx) { periodFrom = fx.from; periodTo = fx.to; if (!mtime && fx.mtime) mtime = fx.mtime; }
    }

    const isDismissed = !!(onDisk && sig && dismissed[f] === sig && rows === 0);
    const syncedState = isDismissed
      ? 'dismissed'
      : (onDisk
        ? (synced[f] === sig ? 'synced' : (synced[f] ? 'stale' : (rows ? 'synced' : 'pending')))
        : 'synced');

    return {
      name: f, kind, type, detected,
      origin: onDisk ? 'disk' : 'upload',
      size, mtime, rows,
      periodFrom, periodTo, pairedFixedFile,
      state: syncedState, skipped: kind === 'other' || isDismissed
    };
  });

  /* شمارش زنده از خود دیتا (نه روی متای ذخیره‌شده) تا دمو/ایمپورت دستی هم منعکس شود */
  const fb = db.callFeedbacks || [];
  const sit = db.callSituational || [];
  const ms = db.monthlyScores || [];
  const sortedDates = allDates.filter(Boolean).sort();
  const liveCounts = {
    total: fb.length,
    tele: fb.filter((r) => r.formType === 'tele').length,
    account: fb.filter((r) => r.formType === 'account').length,
    mlm: fb.filter((r) => r.formType === 'mlm').length,
    situational: sit.length,
    situationalTele: sit.filter((r) => r.formType === 'tele').length,
    situationalAccount: sit.filter((r) => r.formType === 'account').length,
    monthlyTicket: ms.filter((r) => r.channel === 'ticket').length,
    monthlySocial: ms.filter((r) => r.channel === 'social').length,
    demo: fb.filter((r) => r.demo).length
  };
  return {
    dir: DIR,
    intervalSec: 15,
    syncedAt: (db.callSync && db.callSync.syncedAt) || (db.callImport && db.callImport.importedAt) || null,
    dataRange: sortedDates.length ? { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] } : { from: '', to: '' },
    counts: liveCounts,
    files: out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name, 'fa'))
  };
}

/* ---------- اسکن فوری (برای دکمه‌ی «به‌روزرسانی دستی» در UI) ---------- */
function rescanNow(db, saveCallback) {
  return scanOnce(db, saveCallback, (m) => console.log('[calls]', m));
}

module.exports = { start, stop, scanOnce, rescanNow, dirStatus, dismissFile, undismissFile, dismissAllDiskFiles, DIR, normName };
