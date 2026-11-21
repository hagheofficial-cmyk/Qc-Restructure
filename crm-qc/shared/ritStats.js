/* ritStats.js — آمار ریت کارشناسان کیوسی از فایل‌های آپلودشده + معیار تارگت ماهانه تیم‌ها
 *
 * مدل داده:
 *  - callFeedbacks: هر ردیف = یک ریت تماس؛ qcAgent = نام کارشناس کیوسی، expertName = کارشناس فروش،
 *    reviewDate = تاریخ بررسی، formType = tele|account|mlm، team، sourceFile.
 *  - tickets / socials: هر ردیف = یک ارزیابی (ریت تیکت/سوشال)؛ qcAgent، agentName، reviewDate، team.
 *  - monthlyScores: ردیف‌های ماهانه تیکت/سوشال؛ خودشان کارشناس کیوسی ندارند — فقط در جمع تیم‌ها لحاظ می‌شوند.
 *
 * ماه مالی: هر «ماه مالی X» بازه‌ی ۲۰ ماه (X-1) → ۱۹ ماه X است و مقدار/کد آن = ۲۱ ماه (X-1)
 * به صورت YYYYMMDD (مثل ۱۴۰۵۰۵۲۱ برای «ماه مالی شهریور»).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./parseQc.js'), require('./fiscal.js'));
  else root.QCRitStats = factory(root.QCCalc, root.QCParse, root.QCFiscal);
})(typeof self !== 'undefined' ? self : this, function (C, P, Fiscal) {
  'use strict';

  function norm(v) { return P.normName(v); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(jy, jm, jd) { return String(jy) + pad2(jm) + pad2(jd); }
  function text(v) { return v == null ? '' : String(v).trim(); }

  function inRange(date, from, to) {
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  /* ----------------------------------------------------------- ماه مالی */
  /* اگر فهرست ماه‌های مالی خالی باشد، ۱۲ ماه «ماه مالی X» برای سال جلالی امروز ساخته می‌شود
   * (۲۰ → ۱۹). مقدار هر ماه = YYYYMMDDِ ۲۱ ماه شروع (مثل ۱۴۰۵۰۵۲۱ برای شهریور). */
  function ensureFiscalMonths(db, today) {
    if (Array.isArray(db.fiscalMonths) && db.fiscalMonths.length) return { changed: false, months: db.fiscalMonths };
    const t = C.parseDate(today || C.formatJalali(C.todayJalali()));
    if (!t) return { changed: false, months: db.fiscalMonths || [] };
    const months = [];
    for (let x = 1; x <= 12; x++) {
      const startMonth = C.jalaliMonthAdd(t.jy, x, -1);
      const from = { jy: startMonth.jy, jm: startMonth.jm, jd: 20 };
      const to = { jy: t.jy, jm: x, jd: 19 };
      months.push({
        id: ymd(startMonth.jy, startMonth.jm, 21),
        name: 'ماه مالی ' + (C.MONTHS_FA[x - 1] || ''),
        from: C.formatJalali(from),
        to: C.formatJalali(to),
        note: ''
      });
    }
    db.fiscalMonths = Fiscal.normalizeMonths(months);
    return { changed: true, months: db.fiscalMonths };
  }

  function monthById(db, id) {
    return Fiscal.monthById(Fiscal.normalizeMonths(db.fiscalMonths), text(id));
  }

  /* ----------------------------------------------------------- منابع ریت */
  /* همه‌ی ردیف‌های دارای کارشناس کیوسی را به شکلی یکسان نماینده‌سازی می‌کند. */
  function ritRows(db) {
    const out = [];
    const push = (r, agent, qc, date, form, team, file, row, count) => {
      if (!agent && !qc) return;
      out.push({
        agent: norm(agent), agentRaw: text(agent),
        qc: norm(qc), qcRaw: text(qc),
        date: text(date), form: text(form), team: text(team),
        file: text(file), row: row == null ? 0 : row, count: count || 1
      });
    };
    (db.callFeedbacks || []).forEach((r) => push(r, r.expertName, r.qcAgent, r.reviewDate, r.formType, r.team, r.sourceFile, r.sourceRow, 1));
    (db.tickets || []).forEach((r) => push(r, r.agentName, r.qcAgent, r.reviewDate, 'ticket', r.team, r.sourceFile || '', 0, 1));
    (db.socials || []).forEach((r) => push(r, r.agentName, r.qcAgent, r.reviewDate, 'social', r.team, r.sourceFile || '', 0, 1));
    /* پيورگ ریت: هر سلول = تعداد ریت یک کارشناس کیوسی برای یک کارشناس فروش */
    (db.ritPivots || []).forEach((r) => push(r, r.expertName, r.qcAgent, r.periodFrom, 'pivot', r.team, r.sourceFile, r.sourceRow, r.count || 1));
    /* ردیف‌های ماهانه (بدون کارشناس کیوسی) فقط در جمع تیم‌ها لحاظ می‌شوند */
    (db.monthlyScores || []).forEach((r) => push(r, r.expertName, '', r.periodFrom, r.channel, r.team, r.sourceFile, r.sourceRow, r.evalCount || 1));
    return out;
  }

  function teamList(rows) {
    const set = new Set();
    rows.forEach((r) => { if (r.team) set.add(r.team); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fa'));
  }

  function matchTeam(rowTeam, wanted) {
    if (!wanted) return true;
    const list = Array.isArray(wanted) ? wanted : String(wanted).split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return true;
    return list.indexOf(rowTeam) >= 0;
  }

  /* ----------------------------------------------------------- آمار ریت */
  function stats(db, opts) {
    opts = opts || {};
    const from = text(opts.from), to = text(opts.to);
    const rows = ritRows(db).filter((r) => inRange(r.date, from, to)
      && matchTeam(r.team, opts.team) && matchTeam(r.qc, opts.qcAgent));

    const experts = new Map();
    const agents = new Map();
    const teams = new Map();
    const totals = { all: 0, calls: 0, tickets: 0, socials: 0, pivot: 0, withQc: 0 };

    rows.forEach((r) => {
      totals.all += r.count;
      if (r.qc) totals.withQc += r.count;
      if (r.form === 'tele' || r.form === 'account' || r.form === 'mlm') totals.calls += r.count;
      else if (r.form === 'ticket') totals.tickets += r.count;
      else if (r.form === 'social') totals.socials += r.count;
      else if (r.form === 'pivot') totals.pivot += r.count;

      if (r.team) teams.set(r.team, (teams.get(r.team) || 0) + r.count);

      if (!r.qc) return; // ردیف‌های ماهانه در تفکیک کارشناس کیوسی ندیده می‌شوند
      let ex = experts.get(r.qc);
      if (!ex) { ex = { qc: r.qc, total: 0, byAgent: new Map() }; experts.set(r.qc, ex); }
      ex.total += r.count;

      let ag = ex.byAgent.get(r.agent);
      if (!ag) { ag = { agent: r.agent, team: r.team, total: 0, forms: {}, files: new Map() }; ex.byAgent.set(r.agent, ag); }
      ag.total += r.count;
      ag.forms[r.form] = (ag.forms[r.form] || 0) + r.count;
      if (r.file) ag.files.set(r.file, (ag.files.get(r.file) || 0) + 1);

      if (!agents.has(r.agent)) agents.set(r.agent, r.team);
    });

    const agentList = Array.from(agents.entries())
      .map(([agent, team]) => ({ agent: agent, team: team }))
      .sort((a, b) => a.agent.localeCompare(b.agent, 'fa'));

    const expertList = Array.from(experts.values()).map((ex) => ({
      qc: ex.qc,
      total: ex.total,
      byAgent: Array.from(ex.byAgent.values())
        .map((ag) => ({
          agent: ag.agent, team: ag.team, total: ag.total, forms: ag.forms,
          files: Array.from(ag.files.entries()).map(([file, count]) => ({ file: file, count: count }))
        }))
        .sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent, 'fa'))
    })).sort((a, b) => b.total - a.total || a.qc.localeCompare(b.qc, 'fa'));

    return {
      range: { from: from, to: to },
      totals: Object.assign({ experts: expertList.length }, totals),
      experts: expertList,
      agents: agentList,
      teams: Array.from(teams.entries()).map(([team, total]) => ({ team: team, total: total })).sort((a, b) => b.total - a.total)
    };
  }

  /* ----------------------------------------------------------- مرکز دیتا (فایل‌های آپلودشده) */
  function files(db, opts) {
    opts = opts || {};
    const from = text(opts.from), to = text(opts.to), q = norm(opts.q);
    const map = new Map();
    const ensure = (name, kind, type) => {
      if (!map.has(name)) map.set(name, { name: name, kind: kind, type: type, rows: 0, from: '', to: '', teams: new Set(), qcAgents: new Set(), agents: new Set() });
      return map.get(name);
    };
    const touch = (rec, r) => {
      rec.rows += (r.count || 1);
      if (r.date) {
        if (!rec.from || r.date < rec.from) rec.from = r.date;
        if (!rec.to || r.date > rec.to) rec.to = r.date;
      }
      if (r.team) rec.teams.add(r.team);
      if (r.qc) rec.qcAgents.add(r.qc);
      if (r.agent) rec.agents.add(r.agent);
    };
    ritRows(db).forEach((r) => {
      if (!r.file) return;
      let kind = 'form', type = r.form;
      if (r.form === 'ticket' || r.form === 'social') { kind = r.form === 'ticket' ? 'ticket' : 'social'; type = r.form; }
      else if (r.form === 'tele' || r.form === 'account' || r.form === 'mlm') { kind = 'form'; }
      else if (r.form === 'pivot') { kind = 'pivot'; }
      else { kind = 'monthly'; }
      touch(ensure(r.file, kind, type), r);
    });

    let list = Array.from(map.values()).map((rec) => ({
      name: rec.name, kind: rec.kind, type: rec.type, rows: rec.rows,
      from: rec.from, to: rec.to,
      teams: Array.from(rec.teams).sort((a, b) => a.localeCompare(b, 'fa')),
      qcAgents: Array.from(rec.qcAgents).sort((a, b) => a.localeCompare(b, 'fa')),
      agents: Array.from(rec.agents).sort((a, b) => a.localeCompare(b, 'fa'))
    }));

    if (from || to) {
      list = list.filter((f) => {
        if (from && f.to && f.to < from) return false;
        if (to && f.from && f.from > to) return false;
        if (from && to && (!f.from && !f.to)) return false;
        return true;
      });
    }
    if (opts.team) {
      const wanted = String(opts.team).split(',').map((s) => s.trim()).filter(Boolean);
      if (wanted.length) list = list.filter((f) => wanted.some((t) => f.teams.indexOf(t) >= 0));
    }
    if (q) list = list.filter((f) => norm(f.name).indexOf(q) >= 0);

    const sortKey = text(opts.sort) || 'mtime';
    const dir = opts.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va, vb;
      if (sortKey === 'rows') { va = a.rows; vb = b.rows; }
      else if (sortKey === 'from') { va = a.from || ''; vb = b.from || ''; }
      else if (sortKey === 'to') { va = a.to || ''; vb = b.to || ''; }
      else if (sortKey === 'team') { va = a.teams.join('،') || ''; vb = b.teams.join('،') || ''; }
      else { va = a.name; vb = b.name; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return { files: list, total: list.length };
  }

  /* ----------------------------------------------------------- ردیف‌های خام اکسل (دقیقاً همان‌طور که آپلود شده‌اند) */
  const QC_COLS = ['qc_expert_name', 'qc_agent', 'qcagent', 'کارشناس کیوسی', 'کارشناس qc', 'کنترل کیفیت', 'carscholar kiosi'];
  const AGENT_COLS = ['expert_name', 'expertname', 'tele_expert_name', 'account_expert_name', 'account expert name', 'acc_expert_name', 'کارشناس', 'نام کارشناس', 'کارشناس فروش'];
  const DATE_COLS = ['review_date', 'reviewdate', 'تاریخ بررسی', 'form_created_date', 'form created date', 'action_date', 'action date'];
  const TEAM_COLS = ['team', 'team_name', 'تیم'];

  function findCol(headers, candidates) {
    const keys = headers || [];
    for (const cand of candidates) {
      const hit = keys.find((k) => norm(k) === norm(cand));
      if (hit) return hit;
    }
    return '';
  }

  function rawRows(db, opts) {
    opts = opts || {};
    const raw = db.ritRaw || {};
    let entries = [];
    if (opts.file) {
      if (raw[opts.file]) entries.push([opts.file, raw[opts.file]]);
    } else {
      entries = Object.keys(raw).map((k) => [k, raw[k]]);
    }
    const from = text(opts.from), to = text(opts.to);
    const qcWant = norm(opts.qc), agentWant = norm(opts.agent), teamWant = text(opts.team);
    const allowed = (opts.allowedAgents && opts.allowedAgents.length) ? opts.allowedAgents.map(norm) : null;
    const limit = Math.max(1, Math.min(2000, Number(opts.limit) || 500));

    const out = [];
    let total = 0;
    entries.forEach(([name, entry]) => {
      const headers = entry.headers || [];
      const qcCol = findCol(headers, QC_COLS);
      const agentCol = findCol(headers, AGENT_COLS);
      const dateCol = findCol(headers, DATE_COLS);
      const teamCol = findCol(headers, TEAM_COLS);
      /* فایل پيورگ: کارشناس کیوسی ستونِ داده است (نه سلول) — در صورت درخواست
       * کارشناس کیوسی، فقط ردیف‌هایی که مقدار غیرنخوده برای آن ستون دارند برمی‌گردند. */
      const pivotMode = !qcCol && !!agentCol && !!qcWant && headers.some((h) => norm(h) === qcWant);
      const qcColIdx = pivotMode ? headers.findIndex((h) => norm(h) === qcWant) : (qcCol ? headers.indexOf(qcCol) : -1);
      const qcKey = qcColIdx >= 0 ? headers[qcColIdx] : qcCol;
      (entry.rows || []).forEach((cells, i) => {
        total++;
        if (qcWant && !pivotMode && !(qcCol && norm(cells[qcCol]) === qcWant)) return;
        if (pivotMode && (P.normalizeCount(cells[qcKey]) <= 0
          || /^مجموع$|^جمع|^میانگین|^total$|^average$/i.test(norm(agentCol ? cells[agentCol] : '')))) return;
        if (agentWant && !(agentCol && norm(cells[agentCol]) === agentWant)) return;
        if (allowed && agentCol && !allowed.some((a) => norm(cells[agentCol]) === a)) return;
        if (teamWant && !(teamCol && norm(cells[teamCol]) === norm(teamWant))) return;
        if (from || to) {
          const d = dateCol ? P.cleanQcDate(cells[dateCol]) : '';
          if (!inRange(d, from, to)) return;
        }
        if (out.length >= limit) return;
        out.push({ row: (i + 1), file: name, cells: cells, pivot: pivotMode });
      });
    });
    const headers = out.length ? Object.keys(out[0].cells) : (entries[0] ? (entries[0][1].headers || []) : []);
    return { headers: headers, rows: out, total: total, limit: limit };
  }

  /* ----------------------------------------------------------- معیار تارگت ماهانه تیم‌ها */
  function targets(db) {
    return (db.ritTargets || []).map((t) => Object.assign({}, t));
  }

  function saveTarget(db, row) {
    const team = text(row.team), month = text(row.month);
    const target = Math.max(0, Math.floor(Number(row.target) || 0));
    if (!team || !month) return { error: 'تیم و ماه مالی الزامی هستند' };
    const list = db.ritTargets || (db.ritTargets = []);
    const hit = list.find((t) => t.team === team && t.month === month);
    if (hit) {
      hit.target = target;
      hit.note = text(row.note);
      hit.updatedAt = new Date().toISOString();
    } else {
      list.push({
        id: 'rt' + (list.length + 1) + '_' + Math.random().toString(36).slice(2, 8),
        team: team, month: month, target: target,
        note: text(row.note), updatedAt: new Date().toISOString()
      });
    }
    return { ok: true, targets: targets(db) };
  }

  function removeTarget(db, id) {
    db.ritTargets = (db.ritTargets || []).filter((t) => t.id !== id);
    return { ok: true, targets: targets(db) };
  }

  /* جمع ریت‌های انجام‌شده در یک ماه مالی برای یک تیم (تماس + سوشال + تیکت) */
  function monthTeamTotal(db, monthId, team) {
    const month = monthById(db, monthId);
    if (!month) return 0;
    const rows = ritRows(db).filter((r) => inRange(r.date, month.from, month.to) && (!team || r.team === team));
    return rows.reduce((sum, r) => sum + (r.count || 1), 0);
  }

  function targetsWithProgress(db) {
    return targets(db).map((t) => {
      const actual = monthTeamTotal(db, t.month, t.team);
      return Object.assign({}, t, { actual: actual, pct: t.target > 0 ? Math.min(100, Math.round((actual / t.target) * 100)) : (actual > 0 ? 100 : 0) });
    });
  }

  return {
    ensureFiscalMonths: ensureFiscalMonths,
    monthById: monthById,
    ritRows: ritRows,
    stats: stats,
    files: files,
    rawRows: rawRows,
    targets: targets,
    saveTarget: saveTarget,
    removeTarget: removeTarget,
    monthTeamTotal: monthTeamTotal,
    targetsWithProgress: targetsWithProgress,
    QC_COLS: QC_COLS, AGENT_COLS: AGENT_COLS, DATE_COLS: DATE_COLS, TEAM_COLS: TEAM_COLS
  };
});
