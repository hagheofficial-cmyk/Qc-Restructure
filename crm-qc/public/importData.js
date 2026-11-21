/* ادغام امن آرشیوهای ماهانه؛ حفظ ریت‌های مستقل و یکسان در هر دو محیط. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc'), require('./parseQc'));
  else root.QCImport = factory(root.QCCalc, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function(C, P) {
'use strict';
const clone = x => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
function fail(message) { const e = new Error(message); e.status = 400; throw e; }
function requireMode(mode) { if (!['append', 'replace'].includes(mode)) fail('روش ورود را مشخص کنید: افزودن یا جایگزینی'); return mode; }
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
function day(v) { const j = C.parseDate(v); return j ? C.formatJalali(j) : String(v || ''); }
function semantic(row, kind) {
  const result = Object.create(null);
  const ignored = new Set(['id','createdAt','updatedAt','importedAt','sourceFile','datasetId','evaluationId','team','sourceAgentName','sourceExpertName','criteriaVersion','criteriaSnapshot']);
  Object.keys(row).forEach(k => {
    if (ignored.has(k)) return;
    if (/Date$/.test(k)) result[k] = day(row[k]);
    else if (k === 'score') result[k] = C.normalizeScore(row[k]);
    else if (k === 'agentName' || k === 'expertName') result[k] = P.nameKey(row[k]);
    else result[k] = row[k];
  });
  return kind + ':' + stable(result);
}
function strongKey(row, kind, namespace) {
  if (kind === 'situational') return P.situationalRowKey ? P.situationalRowKey(row) : null;
  if (kind === 'pivot') {
    // پيورگ: هر سلول (کارشناس فروش × کارشناس کیوسی × ماه) یک ریت واحد است
    return row.expertName && row.qcAgent && row.periodFrom
      ? 'pivot:' + P.nameKey(row.expertName) + '|' + P.normName(row.qcAgent) + '|' + row.periodFrom : null;
  }
  if (row.evaluationId) return kind + ':evaluation:' + (row.formType || '') + ':' + String(row.evaluationId) + ':' + (row.datasetId || namespace || '');
  if (kind === 'call' && row.sourceRow != null && row.sourceFile) return P.callRowKey(row);
  if (namespace && row.id != null) return kind + ':id:' + namespace + ':' + row.id;
  return null;
}
function mergeRows(existing, incoming, kind, namespace) {
  const result = existing.slice(); const strong = new Set(); const available = new Map();
  result.forEach(row => {
    const key = strongKey(row, kind, namespace && namespace.current);
    if (key) strong.add(key);
    const sig = semantic(row, kind); available.set(sig, (available.get(sig) || 0) + 1);
  });
  const counts = { added: 0, duplicates: 0 };
  incoming.forEach(raw => {
    const row = clone(raw), key = strongKey(row, kind, namespace && namespace.incoming), sig = semantic(row, kind);
    // فقط وقتی هر دو آرشیو از یک مخزنند، id ترتیبی هویت مشترک است.
    if (key && strong.has(key)) { counts.duplicates++; return; }
    if (!key && (available.get(sig) || 0) > 0) {
      available.set(sig, available.get(sig) - 1); counts.duplicates++; return;
    }
    if (key) strong.add(key);
    result.push(row); counts.added++;
  });
  return { rows: result, counts };
}
function resequence(rows, minimum) {
  const seen = new Set(); let next = Math.max(minimum || 1, Math.max(0, ...rows.map(r => Number(r.id) || 0)) + 1);
  rows.forEach(row => {
    if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || seen.has(Number(row.id))) row.id = next++;
    else row.id = Number(row.id);
    seen.add(row.id);
  });
  return Math.max(next, Math.max(0, ...rows.map(r => r.id)) + 1);
}
function validateBackup(b) {
  if (!b || b.schema !== 'crm-qc-backup') fail('ساختار فایل بک‌اپ شناسایی نشد');
  ['agents', 'tickets', 'socials', 'callFeedbacks'].forEach(k => {
    if (!Array.isArray(b[k])) fail('بک‌اپ باید آرایه ' + k + ' داشته باشد');
    b[k].forEach(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('ردیف نامعتبر در ' + k);
      const name = k === 'agents' ? row.name : k === 'callFeedbacks' ? row.expertName : row.agentName;
      if (!P.normName(name)) fail('نام کارشناس در ' + k + ' خالی است');
    });
  });
  if (b.callSituational !== undefined) {
    if (!Array.isArray(b.callSituational)) fail('بک‌اپ باید آرایه callSituational داشته باشد');
    b.callSituational.forEach(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('ردیف نامعتبر در callSituational');
      if (!P.normName(row.expertName)) fail('نام کارشناس در callSituational خالی است');
    });
  }
  if (b.monthlyScores !== undefined) {
    if (!Array.isArray(b.monthlyScores)) fail('بک‌اپ باید آرایه monthlyScores داشته باشد');
    b.monthlyScores.forEach(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('ردیف نامعتبر در monthlyScores');
      if (!P.normName(row.expertName)) fail('نام کارشناس در monthlyScores خالی است');
    });
  }
  if (b.settings && b.settings.callCriteria) P.validateConfig(b.settings.callCriteria);
}
function mergeSituational(existing, incoming) {
  const result = (existing || []).slice();
  const byKey = new Map();
  result.forEach((row, idx) => {
    const key = strongKey(row, 'situational');
    if (key) byKey.set(key, idx);
  });
  const counts = { added: 0, updated: 0, duplicates: 0 };
  (incoming || []).forEach(raw => {
    const row = clone(raw);
    const key = strongKey(row, 'situational');
    if (key && byKey.has(key)) {
      const idx = byKey.get(key);
      if (semantic(result[idx], 'situational') === semantic(row, 'situational')) {
        counts.duplicates++;
      } else {
        result[idx] = row;
        counts.updated++;
      }
      return;
    }
    if (key) byKey.set(key, result.length);
    result.push(row);
    counts.added++;
  });
  return { rows: result, counts };
}
function mergeMonthlyScores(existing, incoming) {
  const result = (existing || []).map(clone);
  const byKey = new Map();
  result.forEach((r, idx) => {
    const k = P.monthlyScoreRowKey ? P.monthlyScoreRowKey(r) : null;
    if (k) byKey.set(k, idx);
  });
  const counts = { added: 0, updated: 0, duplicates: 0 };
  (incoming || []).forEach(raw => {
    const row = clone(raw);
    const key = P.monthlyScoreRowKey ? P.monthlyScoreRowKey(row) : null;
    if (key && byKey.has(key)) {
      const idx = byKey.get(key);
      const prev = result[idx];
      const same = prev.score === row.score && prev.evalCount === row.evalCount && (prev.note || '') === (row.note || '');
      if (same) { counts.duplicates++; return; }
      result[idx] = Object.assign({}, prev, row);
      counts.updated++;
      return;
    }
    if (key) byKey.set(key, result.length);
    result.push(row);
    counts.added++;
  });
  return { rows: result, counts };
}
function restore(db, backup, mode) {
  requireMode(mode); validateBackup(backup);
  const b = clone(backup), counts = {}; const currentId = db.datasetId;
  const sameOrigin = !!currentId && currentId === b.datasetId;
  if (mode === 'replace') {
    if (b.settings) { db.settings = Object.assign({}, db.settings, b.settings); if(!own(b.settings,'callCriteria')) delete db.settings.callCriteria; }
    if (b.lists && typeof b.lists === 'object' && !Array.isArray(b.lists)) db.lists = clone(b.lists);
    db.agents = b.agents; db.tickets = b.tickets; db.socials = b.socials; db.callFeedbacks = b.callFeedbacks;
    db.callSituational = Array.isArray(b.callSituational) ? b.callSituational : [];
    db.monthlyScores = Array.isArray(b.monthlyScores) ? b.monthlyScores : [];
    if (b.datasetId) db.datasetId = b.datasetId;
    db.qcAgents = Array.isArray(b.qcAgents) ? b.qcAgents : db.qcAgents;
    db.agentActions = b.agentActions || {};
    db.actionTypes = Array.isArray(b.actionTypes) ? b.actionTypes.slice() : null; // null ⇒ پیش‌فرض‌ها در ensure
    db.reminders = Array.isArray(b.reminders) ? b.reminders : [];
    if (Array.isArray(b.fiscalMonths)) db.fiscalMonths = clone(b.fiscalMonths);
    if (Array.isArray(b.elements)) db.elements = clone(b.elements);
    // حفظ ایمنی: فقط وقتی بک‌اپ فهرست غیرخالی و دارای مدیر دارد جایگزین شود تا ورود Apps Script قفل نشود
    if (Array.isArray(b.qcUsers) && b.qcUsers.length) {
      const hasAdmin = b.qcUsers.some(u => u && u.role === 'admin' && u.active !== false);
      if (hasAdmin || !Array.isArray(db.qcUsers) || !db.qcUsers.length) db.qcUsers = clone(b.qcUsers);
    }
    db.callImport = b.callImport || null; db.callRaw = null;
  } else {
    ['tickets','socials','callFeedbacks'].forEach(field=>b[field].forEach(row=>{const nameField=field==='callFeedbacks'?'expertName':'agentName';const person=P.resolveExpert(db.agents||[],row[nameField]).agent;if(person&&person.name!==row[nameField]){row[field==='callFeedbacks'?'sourceExpertName':'sourceAgentName']=row[nameField];row[nameField]=person.name;}}));
    [['tickets','ticket'], ['socials','social'], ['callFeedbacks','call']].forEach(([field, kind]) => {
      const merged = mergeRows(db[field] || [], b[field], kind, sameOrigin ? { current: currentId, incoming: currentId } : null);
      db[field] = merged.rows; counts[field] = merged.counts;
    });
    if (Array.isArray(b.callSituational) && b.callSituational.length) {
      b.callSituational.forEach(row => {
        const person = P.resolveExpert(db.agents || [], row.expertName).agent;
        if (person && person.name !== row.expertName) { row.sourceExpertName = row.expertName; row.expertName = person.name; }
      });
      const sitMerged = mergeSituational(db.callSituational || [], b.callSituational);
      db.callSituational = sitMerged.rows; counts.callSituational = sitMerged.counts;
    } else if (!Array.isArray(db.callSituational)) {
      db.callSituational = [];
    }
    if (Array.isArray(b.monthlyScores) && b.monthlyScores.length) {
      b.monthlyScores.forEach(row => {
        const person = P.resolveExpert(db.agents || [], row.expertName).agent;
        if (person && person.name !== row.expertName) { row.sourceExpertName = row.expertName; row.expertName = person.name; }
      });
      const msMerged = mergeMonthlyScores(db.monthlyScores || [], b.monthlyScores);
      db.monthlyScores = msMerged.rows; counts.monthlyScores = msMerged.counts;
    } else if (!Array.isArray(db.monthlyScores)) {
      db.monthlyScores = [];
    }
    const names = new Set((db.agents || []).flatMap(a => [a.name].concat(a.aliases||[])).map(P.nameKey));
    b.agents.forEach(a => {
      if (names.has(P.nameKey(a.name))) return;
      if (a.ext != null && (db.agents || []).some(old => old.ext != null && C.faToEn(String(old.ext)) === C.faToEn(String(a.ext)))) a.ext = null;
      db.agents.push(a); names.add(P.nameKey(a.name));
    });
    db.qcAgents = Array.from(new Set((db.qcAgents || []).concat(b.qcAgents || [])));
    db.agentActions = db.agentActions || {};
    Object.keys(b.agentActions || {}).forEach(name => {
      if (['__proto__','prototype','constructor'].includes(name)) return;
      const old = db.agentActions[name] || [], seen = new Set(old.map(x => stable([x.title, x.date, x.note, x.status])));
      db.agentActions[name] = old.concat((b.agentActions[name] || []).filter(x => {
        const sig = stable([x.title,x.date,x.note,x.status]); if (seen.has(sig)) return false; seen.add(sig); return true;
      }));
    });
    // نوع اقدام‌ها: اجتماع فهرست فعلی و بک‌اپ؛ یادآورها بدون تکرار (نشانه: کارشناس+تاریخ+متن+زمان ثبت).
    if (Array.isArray(b.actionTypes)) db.actionTypes = Array.from(new Set((db.actionTypes || []).concat(b.actionTypes.map(String))));
    const remSig = (x) => stable([x.agent, x.date, x.text, x.createdAt]);
    const remSeen = new Set((db.reminders || []).map(remSig));
    db.reminders = (db.reminders || []).concat((Array.isArray(b.reminders) ? b.reminders : []).filter((x) => {
      const sig = remSig(x); if (remSeen.has(sig)) return false; remSeen.add(sig); return true;
    }));
    // ماه‌های مالی: افزودن بازه‌های جدید بدون تکرار
    if (Array.isArray(b.fiscalMonths) && b.fiscalMonths.length) {
      db.fiscalMonths = Array.isArray(db.fiscalMonths) ? db.fiscalMonths : [];
      const fmSeen = new Set(db.fiscalMonths.map(x => stable([x.name, x.from, x.to])));
      b.fiscalMonths.forEach(x => {
        const sig = stable([x.name, x.from, x.to]);
        if (!fmSeen.has(sig)) { db.fiscalMonths.push(clone(x)); fmSeen.add(sig); }
      });
    }
    // فهرست‌های پایه: ادغام بدون حذف مقادیر موجود
    if (b.lists && typeof b.lists === 'object' && !Array.isArray(b.lists)) {
      db.lists = db.lists || {};
      Object.keys(b.lists).forEach(k => {
        if (['__proto__','prototype','constructor'].includes(k)) return;
        if (Array.isArray(b.lists[k])) db.lists[k] = Array.from(new Set((db.lists[k] || []).concat(b.lists[k])));
      });
    }
    // ادغام ماهانه تنظیمات و تیم/داخلی موجود را تغییر نمی‌دهد.
  }
  db.seq = db.seq || {};
  db.seq.ticket = resequence(db.tickets, db.seq.ticket);
  db.seq.social = resequence(db.socials, db.seq.social);
  db.seq.agent = resequence(db.agents, db.seq.agent);
  const actions = Object.values(db.agentActions || {}).flat(); db.seq.action = resequence(actions, db.seq.action);
  db.reminders = db.reminders || [];
  db.seq.reminder = resequence(db.reminders, db.seq.reminder);
  db.registryCleared = db.agents.length === 0;
  return {
    ok: true, mode, changes: counts,
    restored: {
      agents: db.agents.length,
      tickets: db.tickets.length,
      socials: db.socials.length,
      calls: db.callFeedbacks.length,
      callSituational: (db.callSituational || []).length,
      monthlyScores: (db.monthlyScores || []).length,
      actions: actions.length,
      reminders: db.reminders.length,
      fiscalMonths: (db.fiscalMonths || []).length,
      qcUsers: (db.qcUsers || []).length
    }
  };
}
function calls(db, incoming, mode, sourceFile) {
  requireMode(mode);
  if (mode === 'replace') db.callFeedbacks = (db.callFeedbacks || []).filter(r => r.sourceFile !== sourceFile);
  const merged = mergeRows(db.callFeedbacks || [], incoming, 'call');
  db.callFeedbacks = merged.rows;
  return merged.counts;
}
function situational(db, incoming, mode, sourceFile) {
  requireMode(mode);
  db.callSituational = Array.isArray(db.callSituational) ? db.callSituational : [];
  if (mode === 'replace' && sourceFile) {
    db.callSituational = db.callSituational.filter(r => r.sourceFile !== sourceFile);
  }
  const merged = mergeSituational(db.callSituational, incoming);
  db.callSituational = merged.rows;
  return merged.counts;
}
function pivots(db, incoming, mode, sourceFile) {
  requireMode(mode);
  db.ritPivots = Array.isArray(db.ritPivots) ? db.ritPivots : [];
  if (mode === 'replace' && sourceFile) {
    db.ritPivots = db.ritPivots.filter(r => r.sourceFile !== sourceFile);
  }
  const merged = mergeRows(db.ritPivots, incoming, 'pivot');
  db.ritPivots = merged.rows;
  return merged.counts;
}

function monthlyScores(db, incoming, mode, sourceFile, channel) {
  requireMode(mode);
  db.monthlyScores = Array.isArray(db.monthlyScores) ? db.monthlyScores : [];
  if (mode === 'replace') {
    db.monthlyScores = db.monthlyScores.filter(r => {
      if (channel && r.channel !== channel) return true;
      if (sourceFile && r.sourceFile !== sourceFile) return true;
      return false;
    });
  }
  const merged = mergeMonthlyScores(db.monthlyScores, incoming);
  db.monthlyScores = merged.rows;
  return merged.counts;
}
function monthlyScoreFiles(db, files, options) {
  options = options || {};
  const mode = options.mode || 'append';
  requireMode(mode);
  db.monthlyScores = Array.isArray(db.monthlyScores) ? db.monthlyScores : [];
  const forcedChannel = (options.channel === 'ticket' || options.channel === 'social') ? options.channel : '';
  const explicitFrom = options.periodFrom ? (P.cleanQcDate ? P.cleanQcDate(options.periodFrom) : String(options.periodFrom)) : '';
  const explicitTo = options.periodTo ? (P.cleanQcDate ? P.cleanQcDate(options.periodTo) : String(options.periodTo)) : '';
  let fallbackFrom = explicitFrom, fallbackTo = explicitTo;
  if (!fallbackFrom && !fallbackTo && (db.callFeedbacks || []).length) {
    const r = P.dateRangeOfCalls(db.callFeedbacks);
    fallbackFrom = r.from; fallbackTo = r.to;
  }
  const results = [];
  for (const f of (Array.isArray(files) ? files : []).slice(0, 50)) {
    const name = String((f && f.name) || '').trim() || 'monthly-scores.xlsx';
    const rows = Array.isArray(f && f.rows) ? f.rows : [];
    const ch = (f && (f.channel === 'ticket' || f.channel === 'social') ? f.channel : '')
      || forcedChannel
      || (P.classifyMonthlyScoreFile ? P.classifyMonthlyScoreFile(name, rows) : null);
    if (!ch) {
      results.push({ name, ok: false, kind: 'monthly_score', reason: 'نوع فایل (تیکت یا پیام‌رسان) تشخیص داده نشد' });
      continue;
    }
    const fFrom = f && f.periodFrom ? P.cleanQcDate(f.periodFrom) : fallbackFrom;
    const fTo = f && f.periodTo ? P.cleanQcDate(f.periodTo) : fallbackTo;
    const parsed = P.parseMonthlyScoreRows(rows, ch, {
      agents: db.agents,
      team: String((f && f.team) || options.team || ''),
      periodFrom: fFrom,
      periodTo: fTo,
      sourceFile: name
    });
    if (!parsed.length) {
      results.push({ name, ok: false, kind: 'monthly_score', channel: ch, type: ch, reason: 'هیچ ردیف نمره‌داری (۰ تا ۱۰۰) یافت نشد' });
      continue;
    }
    const nowIso = new Date().toISOString();
    parsed.forEach(r => { r.importedAt = nowIso; });
    const changes = monthlyScores(db, parsed, mode, name, ch);
    storeRawRows(db, name, rows);
    const dates = parsed.flatMap(r => [r.periodFrom, r.periodTo]).filter(Boolean).sort();
    results.push({
      name, ok: true, kind: ch === 'ticket' ? 'ticket_monthly' : 'social_monthly',
      channel: ch, type: ch, count: parsed.length,
      periodFrom: dates[0] || fFrom || '', periodTo: dates[dates.length - 1] || fTo || '',
      changes
    });
  }
  const ms = db.monthlyScores || [];
  return {
    ok: true,
    results,
    counts: {
      total: ms.length,
      ticket: ms.filter(r => r.channel === 'ticket').length,
      social: ms.filter(r => r.channel === 'social').length
    }
  };
}
/* ذخیره‌ی ردیف‌های خام اکسل (همان‌طور که آپلود شده‌اند) برای بازکردن دقیق در داشبورد آمار ریت.
 * key = نام فایل منبع. از ذخیره‌ی بیش از حد بزرگ جلوگیری می‌کند. */
const RIT_RAW_MAX_ROWS = 20000;
function storeRawRows(db, name, rows) {
  if (!name || !Array.isArray(rows) || !rows.length) return;
  db.ritRaw = db.ritRaw || {};
  if (db.ritRaw[name]) return; // به‌روزرسانی‌های بعدی همان فایل همان منبع می‌ماند
  db.ritRaw[name] = {
    headers: Object.keys(rows[0] || {}),
    rows: rows.slice(0, RIT_RAW_MAX_ROWS)
  };
}

/* تاریخ از نام فایل پيورگ (مثل qc_army_pivote_2026-11-21T17_24_56…) استخراج می‌شود
 * تا ریت‌های بدون ستون تاریخ در ماه مالی درست قرار گیرند. */
function pivotDateFromName(name) {
  const m = String(name || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  const j = C.parseDate(m[1] + '/' + m[2] + '/' + m[3]);
  return j ? C.formatJalali(j) : '';
}

function callFiles(db, files, options) {
  options = options || {};
  const mode = options.mode || 'append';
  requireMode(mode);
  const teamOpt = String(options.team || '').trim();
  const explicitFrom = options.periodFrom ? (P.cleanQcDate ? P.cleanQcDate(options.periodFrom) : String(options.periodFrom)) : '';
  const explicitTo = options.periodTo ? (P.cleanQcDate ? P.cleanQcDate(options.periodTo) : String(options.periodTo)) : '';
  db.callFeedbacks = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
  db.callSituational = Array.isArray(db.callSituational) ? db.callSituational : [];

  const list = (Array.isArray(files) ? files : []).slice(0, 200);
  const prepared = list.map((f, idx) => {
    const name = String((f && f.name) || '').trim() || 'unnamed.xlsx';
    const rows = Array.isArray(f && f.rows) ? f.rows : [];
    const cls = P.classifyCallFile(name, rows, db.settings && db.settings.callCriteria, (f && f.team) || teamOpt);
    return { idx, f, name, rows, kind: cls.kind, formType: cls.formType };
  });

  const resultsByIdx = new Array(prepared.length);
  const batchRanges = Object.create(null);

  for (const item of prepared) {
    if (item.kind !== 'fixed') continue;
    if (!item.formType) {
      resultsByIdx[item.idx] = { name: item.name, ok: false, kind: 'fixed', reason: 'نوع فرم تشخیص داده نشد' };
      continue;
    }
    const parsed = P.parseRows(item.rows, item.formType, {
      agents: db.agents,
      criteria: db.settings && db.settings.callCriteria,
      team: String((item.f && item.f.team) || teamOpt || '')
    });
    if (!parsed.length) {
      resultsByIdx[item.idx] = { name: item.name, ok: false, kind: 'fixed', reason: 'ردیفی یافت نشد', type: item.formType };
      continue;
    }
    const range = P.dateRangeOfCalls(parsed);
    if (range.from || range.to) {
      const prev = batchRanges[item.formType];
      batchRanges[item.formType] = {
        from: prev && prev.from && (!range.from || prev.from < range.from) ? prev.from : range.from,
        to: prev && prev.to && (!range.to || prev.to > range.to) ? prev.to : range.to,
        fileName: item.name
      };
    }
    const changes = calls(db, parsed.map(r => Object.assign({ sourceFile: item.name }, r)), mode, item.name);
    storeRawRows(db, item.name, item.rows);
    resultsByIdx[item.idx] = {
      name: item.name, ok: true, kind: 'fixed', type: item.formType,
      count: parsed.length, periodFrom: range.from, periodTo: range.to,
      changes, diagnostics: P.importDiagnostics(parsed, db.agents)
    };
  }

  /* دتپلیکت بر اساس **تاریخ بررسی** + هویت + محتوای ریت — ریت‌های تکراری که در
   * فایل‌های هفته‌ی مختلف (مبدأِ متفاوت) تکرار می‌شوند، یک‌بار نگه می‌شود. دو ریتِ
   * مستقلِ یک‌محتوا از یک فایلِ مبدأ هر دو نگه می‌شوند (محتوای متفاوت هم وهویتِ متفاوت
   * در کلید است). */
  const seen = new Map(); const out = [];
  for (const r of db.callFeedbacks) {
    const key = P.ritKey(r, 'call') || P.callRowKey(r);
    const file = String(r.sourceFile || '');
    if (key && seen.has(key)) {
      /* فقط اگر از فایلی غیر از مبدأِ قبلی است، تکرارِ هفتگی است */
      const firstFile = seen.get(key);
      if (firstFile && file && firstFile !== file) continue;
    }
    if (key && !seen.has(key)) seen.set(key, file || '');
    out.push(r);
  }
  db.callFeedbacks = out;

  for (const item of prepared) {
    if (item.kind !== 'situational') continue;
    if (!item.formType) {
      resultsByIdx[item.idx] = { name: item.name, ok: false, kind: 'situational', reason: 'نوع فرم فایل موقعیتی تشخیص داده نشد' };
      continue;
    }
    const fFrom = item.f && item.f.periodFrom ? P.cleanQcDate(item.f.periodFrom) : '';
    const fTo = item.f && item.f.periodTo ? P.cleanQcDate(item.f.periodTo) : '';
    const paired = batchRanges[item.formType] || null;
    let pFrom = fFrom || explicitFrom || (paired && paired.from) || '';
    let pTo = fTo || explicitTo || (paired && paired.to) || '';
    let pairedFile = (item.f && item.f.pairedFixedFile) || (paired && paired.fileName) || '';
    if (!pFrom && !pTo) {
      const existingOfForm = db.callFeedbacks.filter(r => r.formType === item.formType && r.reviewDate);
      if (existingOfForm.length) {
        const fbRange = P.dateRangeOfCalls(existingOfForm);
        pFrom = fbRange.from;
        pTo = fbRange.to;
        if (!pairedFile) pairedFile = existingOfForm[existingOfForm.length - 1].sourceFile || '';
      }
    }
    const parsed = P.parseSituationalRows(item.rows, item.formType, {
      agents: db.agents,
      criteria: db.settings && db.settings.callCriteria,
      team: String((item.f && item.f.team) || teamOpt || ''),
      periodFrom: pFrom,
      periodTo: pTo,
      sourceFile: item.name,
      pairedFixedFile: pairedFile
    });
    if (!parsed.length) {
      resultsByIdx[item.idx] = { name: item.name, ok: false, kind: 'situational', reason: 'ردیفی یافت نشد', type: item.formType };
      continue;
    }
    const changes = situational(db, parsed, mode, item.name);
    storeRawRows(db, item.name, item.rows);
    resultsByIdx[item.idx] = {
      name: item.name, ok: true, kind: 'situational', type: item.formType,
      count: parsed.length, periodFrom: pFrom, periodTo: pTo, pairedFixedFile: pairedFile,
      changes, diagnostics: P.importDiagnostics(parsed, db.agents)
    };
  }

  for (const item of prepared) {
    if (item.kind !== 'monthly_score') continue;
    const msOut = monthlyScoreFiles(db, [Object.assign({}, item.f, { name: item.name, rows: item.rows, channel: item.formType })], {
      mode, team: teamOpt, periodFrom: explicitFrom, periodTo: explicitTo
    });
    resultsByIdx[item.idx] = (msOut.results && msOut.results[0]) || { name: item.name, ok: false, kind: 'monthly_score', reason: 'خطا در ورود فایل نمره ماهانه' };
  }

  /* پيورگ ریت: هر سلول = تعداد ریتِ یک کارشناس کیوسی (ستون) برای یک کارشناس فروش (ردیف) */
  for (const item of prepared) {
    if (item.kind !== 'pivot') continue;
    const parsed = P.parsePivotRows(item.rows, { sourceFile: item.name });
    if (!parsed.length) {
      resultsByIdx[item.idx] = { name: item.name, ok: false, kind: 'pivot', reason: 'ردیفی یافت نشد' };
      continue;
    }
    const team = String((item.f && item.f.team) || teamOpt || '');
    const fallbackDate = pivotDateFromName(item.name);
    parsed.forEach((r) => {
      r.team = team;
      r.periodFrom = explicitFrom || fallbackDate;
      r.periodTo = explicitTo || r.periodFrom;
    });
    const merged = pivots(db, parsed, mode, item.name);
    storeRawRows(db, item.name, item.rows);
    resultsByIdx[item.idx] = {
      name: item.name, ok: true, kind: 'pivot',
      count: parsed.length, periodFrom: parsed[0].periodFrom, periodTo: parsed[0].periodTo,
      changes: merged
    };
  }

  /* اگر قبلاً فایل موقعیتی بدون بازه تاریخ آپلود شده بود و اکنون فایل ثابت هم‌تیم آمد،
   * بازه و اتصال آن رکوردهای موقعیتی به‌صورت خودکار تکمیل می‌شود. */
  for (const ft of Object.keys(batchRanges)) {
    const br = batchRanges[ft];
    if (!br || (!br.from && !br.to)) continue;
    for (const sr of db.callSituational) {
      if (sr.formType === ft && !sr.periodFrom && !sr.periodTo) {
        sr.periodFrom = br.from || '';
        sr.periodTo = br.to || '';
        if (!sr.pairedFixedFile && br.fileName) sr.pairedFixedFile = br.fileName;
        sr.syncId = 'sit:' + [ft, P.nameKey(sr.expertName), sr.periodFrom || 'all', sr.periodTo || 'all'].join('|');
      }
    }
  }

  const counts = recomputeCallImportCounts(db, true);
  return { ok: true, results: resultsByIdx.filter(Boolean), counts };
}

function recomputeCallImportCounts(db, stampNow) {
  const fb = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
  const sit = Array.isArray(db.callSituational) ? db.callSituational : [];
  const msAll = Array.isArray(db.monthlyScores) ? db.monthlyScores : [];
  const counts = {
    total: fb.length,
    tele: fb.filter(r => r.formType === 'tele').length,
    account: fb.filter(r => r.formType === 'account').length,
    mlm: fb.filter(r => r.formType === 'mlm').length,
    situational: sit.length,
    situationalTele: sit.filter(r => r.formType === 'tele').length,
    situationalAccount: sit.filter(r => r.formType === 'account').length,
    monthlyTicket: msAll.filter(r => r.channel === 'ticket').length,
    monthlySocial: msAll.filter(r => r.channel === 'social').length
  };
  if (!fb.length && !sit.length && !msAll.length) {
    db.callImport = null;
  } else {
    db.callImport = db.callImport || {};
    if (stampNow) db.callImport.importedAt = new Date().toISOString();
    db.callImport.counts = counts;
  }
  return counts;
}

function deleteSourceFile(db, fileName, kind) {
  const name = String(fileName || '').trim();
  if (!name) {
    const e = new Error('نام فایل برای حذف مشخص نشده است');
    e.status = 400;
    throw e;
  }
  const k = String(kind || '').trim().toLowerCase();
  if (db.ritRaw) delete db.ritRaw[name];
  db.callFeedbacks = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
  db.callSituational = Array.isArray(db.callSituational) ? db.callSituational : [];
  db.monthlyScores = Array.isArray(db.monthlyScores) ? db.monthlyScores : [];

  let removedCalls = 0, removedSituational = 0, removedMonthly = 0, removedPivots = 0;

  if (!k || k === 'form' || k === 'fixed' || k === 'recovery') {
    const before = db.callFeedbacks.length;
    db.callFeedbacks = db.callFeedbacks.filter(r => String(r && r.sourceFile || '').trim() !== name);
    removedCalls = before - db.callFeedbacks.length;
    if (name === 'qc_recovery.json' || !db.callFeedbacks.length) {
      db.callRaw = null;
    } else if (db.callRaw) {
      if (!db.callFeedbacks.some(r => r.formType === 'tele')) db.callRaw.teleRawData = [];
      if (!db.callFeedbacks.some(r => r.formType === 'account')) db.callRaw.accRawData = [];
      if (!db.callFeedbacks.some(r => r.formType === 'mlm')) db.callRaw.mlmRawData = [];
    }
  }

  if (!k || k === 'situational') {
    const before = db.callSituational.length;
    db.callSituational = db.callSituational.filter(r => String(r && r.sourceFile || '').trim() !== name);
    removedSituational = before - db.callSituational.length;
  }

  if (!k || k === 'ticket_monthly' || k === 'social_monthly' || k === 'monthly_score') {
    const before = db.monthlyScores.length;
    db.monthlyScores = db.monthlyScores.filter(r => {
      if (String(r && r.sourceFile || '').trim() !== name) return true;
      if (k === 'ticket_monthly' && r.channel !== 'ticket') return true;
      if (k === 'social_monthly' && r.channel !== 'social') return true;
      return false;
    });
    removedMonthly = before - db.monthlyScores.length;
  }

  if (!k || k === 'pivot') {
    const before = (db.ritPivots || []).length;
    db.ritPivots = (db.ritPivots || []).filter((r) => String(r && r.sourceFile || '').trim() !== name);
    removedPivots = before - db.ritPivots.length;
  }

  const counts = recomputeCallImportCounts(db, false);
  const totalRemoved = removedCalls + removedSituational + removedMonthly + removedPivots;
  return {
    ok: true,
    name,
    kind: k,
    removedCalls,
    removedSituational,
    removedMonthly,
    removedPivots,
    totalRemoved,
    counts
  };
}

return { requireMode, restore, calls, situational, pivots, monthlyScores, monthlyScoreFiles, callFiles, deleteSourceFile, mergeRows, mergeSituational, mergeMonthlyScores, validateBackup, semantic, stable, pivotDateFromName, storeRawRows };
});
