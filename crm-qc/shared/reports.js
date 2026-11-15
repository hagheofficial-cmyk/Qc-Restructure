/* =========================================================================
 * reports.js — موتور گزارش‌سازی مشترک (داشبورد، گزارش کارشناس/تیم)
 * معادل شیت‌های Agent Report و Team Report فایل اکسل.
 * هم در Node (سرور) و هم در مرورگر (نسخه standalone) قابل استفاده است.
 *
 * ورودی توابع: data = { tickets: [], socials: [], agents: [] }
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./parseQc.js'));
  else root.QCReports = factory(root.QCCalc, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function (C, P) {
  'use strict';

  /* ----------------------------------------------------------- ابزارها */
  function validateRange(q) {
    q = q || {};
    var from = q.from ? C.parseDate(q.from) : null, to = q.to ? C.parseDate(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) return 'تاریخ نامعتبر است؛ تاریخ معتبر مثل 1405/06/20 وارد کنید';
    if (from && to && C.jalaliCmp(from, to) > 0) return 'تاریخ شروع نباید بعد از تاریخ پایان باشد';
    return '';
  }

  function inRange(dateStr, from, to) {
    if (!from && !to) return true;
    if (validateRange({ from: from, to: to })) return false;
    var j = C.parseDate(dateStr);
    return !!j && C.jalaliInRange(j, from ? C.parseDate(from) : null, to ? C.parseDate(to) : null);
  }

  function valueSet(value) {
    if (!value) return null;
    var list = (Array.isArray(value) ? value : String(value).split(',')).map(String).filter(Boolean);
    return list.length ? new Set(list) : null;
  }
  function teamOf(agents, name) {
    var a = P.resolveExpert(agents || [], name).agent;
    return a ? a.team : '';
  }
  /* تیم ردیف: معمولاً تیم فعلی کارشناس (انتقال تیم در رجیستری منعکس می‌شود).
   * استثنا: فرم اکانت هر کارشناسی (حتی کارشناس تیم Tele) روی تیم Account حساب می‌شود،
   * و ردیف‌های Telesales کارشناسان ثبت‌نشده بدون «تیم مقصد» روی تیم Telesales قرار می‌گیرند. */
  function rowTeam(data, row) {
    var agentTeam = teamOf(data && data.agents, row.expertName || row.agentName) || row.team || '';
    if (row.formType === 'account' && row.expertName !== undefined && P.teamForm(agentTeam) !== 'account') {
      return (P.defaultTeamForForm ? P.defaultTeamForForm('account', data && data.agents) : '') || 'Account';
    }
    if (!agentTeam && row.formType === 'tele' && row.expertName !== undefined) {
      return (P.defaultTeamForForm ? P.defaultTeamForForm('tele', data && data.agents) : '') || 'Tele sales';
    }
    return agentTeam;
  }

  /** یک فیلتر مشترک برای همه‌ی گزارش‌ها؛ انتقال تیم در رجیستری هم منعکس می‌شود. */
  function filterRows(rows, q, data) {
    q = q || {};
    var teamSet = valueSet(q.team), agentSet = valueSet(q.agent);
    if (teamSet) teamSet = new Set(Array.from(teamSet).map(P.teamKey));
    return (rows || []).map(function (r) {
      if (!data || !data.agents || !data.agents.length) return r;
      var field = r.expertName !== undefined ? 'expertName' : 'agentName';
      var match = P.resolveExpert(data.agents, r[field]).agent;
      return match && match.name !== r[field] ? Object.assign({}, r, { [field]: match.name }) : r;
    }).filter(function (r) {
      if ((q.from || q.to) && !inRange(r.reviewDate, q.from, q.to)) return false;
      if (teamSet && !teamSet.has(P.teamKey(data ? rowTeam(data, r) : r.team))) return false;
      if (agentSet && !agentSet.has(r.agentName || r.expertName)) return false;
      if (q.qc && r.qcAgent !== q.qc) return false;
      return true;
    });
  }
  function filterCalls(data, q) {
    q = q || {};
    return filterRows(data.callFeedbacks || [], q, data).filter(function (r) { return !q.form || r.formType === q.form; });
  }

  /* تطبیق بازه‌ی زمانی رکورد موقعیتی [periodFrom, periodTo] با فیلتر تاریخ [from, to] */
  function periodOverlaps(periodFrom, periodTo, from, to) {
    if (!from && !to) return true;
    if (validateRange({ from: from, to: to })) return false;
    var pStart = C.parseDate(periodFrom) || C.parseDate(periodTo);
    var pEnd = C.parseDate(periodTo) || pStart;
    if (!pStart || !pEnd) return false;
    var fJ = from ? C.parseDate(from) : null;
    var tJ = to ? C.parseDate(to) : null;
    if (fJ && C.jalaliCmp(pEnd, fJ) < 0) return false;
    if (tJ && C.jalaliCmp(pStart, tJ) > 0) return false;
    return true;
  }

  function filterSituational(data, q) {
    q = q || {};
    var teamSet = valueSet(q.team), agentSet = valueSet(q.agent);
    if (teamSet) teamSet = new Set(Array.from(teamSet).map(P.teamKey));
    return (data && data.callSituational || []).map(function (r) {
      if (!data || !data.agents || !data.agents.length) return r;
      var match = P.resolveExpert(data.agents, r.expertName).agent;
      return match && match.name !== r.expertName ? Object.assign({}, r, { expertName: match.name }) : r;
    }).filter(function (r) {
      if ((q.from || q.to) && !periodOverlaps(r.periodFrom, r.periodTo, q.from, q.to)) return false;
      if (q.form && r.formType !== q.form) return false;
      if (teamSet && !teamSet.has(P.teamKey(rowTeam(data, r)))) return false;
      if (agentSet && !agentSet.has(r.expertName)) return false;
      return true;
    });
  }

  /* میانگین نمره‌ی موقعیتی منحصراً بر پایه‌ی ستون calc_situational_score:
   * - برای یک رکورد: دقیقاً همان عدد calc_situational_score (بدون گردکردن اضافی).
   * - برای چند رکورد/دوره یا تجمیع تیمی: میانگین وزن‌دار بر اساس formsCount. */
  var DEFAULT_SCORE_WEIGHTS = { callFixed: 45, situational: 25, social: 15, ticket: 15 };

  function filterMonthlyScores(data, q, channel) {
    q = q || {};
    var teamSet = valueSet(q.team);
    if (teamSet) teamSet = new Set(Array.from(teamSet).map(P.teamKey));
    var agentSet = valueSet(q.agent);
    return (data && data.monthlyScores || []).filter(function (r) {
      if (channel && r.channel !== channel) return false;
      if (!periodOverlaps(r.periodFrom, r.periodTo, q.from, q.to)) return false;
      if (teamSet && !teamSet.has(P.teamKey(rowTeam(data, r)))) return false;
      if (agentSet && !agentSet.has(r.expertName)) return false;
      return true;
    });
  }

  function monthlyChannelSummary(rows) {
    var scored = (rows || []).filter(function (r) { return C.normalizeScore(r.score) !== null; });
    if (!scored.length) return { avg: '', count: 0, recordsCount: 0 };
    var totalCount = scored.reduce(function (s, r) { return s + (Number(r.evalCount) > 0 ? Number(r.evalCount) : 1); }, 0);
    if (scored.length === 1) {
      return { avg: C.round2(C.normalizeScore(scored[0].score)), count: totalCount, recordsCount: 1 };
    }
    var wSum = 0, sSum = 0;
    scored.forEach(function (r) {
      var w = Number(r.evalCount) > 0 ? Number(r.evalCount) : 1;
      sSum += C.normalizeScore(r.score) * w;
      wSum += w;
    });
    return { avg: wSum > 0 ? C.round2(sSum / wSum) : '', count: totalCount, recordsCount: scored.length };
  }

  function effectiveChannelScore(individualRows, monthlyRows) {
    var ind = individualRows || [];
    var indAvg = avgScore(ind);
    var mon = monthlyChannelSummary(monthlyRows);
    if (mon.recordsCount > 0 && mon.avg !== '') {
      return {
        avg: mon.avg,
        count: mon.count,
        scoredCount: mon.count,
        source: 'monthly_excel',
        monthlyRecords: mon.recordsCount,
        individualCount: ind.length,
        individualAvg: indAvg
      };
    }
    return {
      avg: indAvg,
      count: ind.length,
      scoredCount: scoredRows(ind).length,
      source: ind.length ? 'individual' : '',
      monthlyRecords: 0,
      individualCount: ind.length,
      individualAvg: indAvg
    };
  }

  /* محاسبه‌ی نمره کل وزن‌دار کارشناس بر اساس سهم رسمی ۴گانه:
   * - المان‌های ثابت تماس: ۴۵٪
   * - معیارهای موقعیتی: ۲۵٪
   * - پیام‌رسان (سوشال): ۱۵٪
   * - تیکت‌ها: ۱۵٪
   * در صورت نبود داده برای هر بخش، نمره کل روی مجموع وزن بخش‌های دارای داده نرمال‌سازی می‌شود
   * و همزمان سهم واقعی کسب‌شده و وزن فعال برای نمایش در کارنامه برگردانده می‌شود. */
  function computeWeightedScore(scores, customWeights) {
    scores = scores || {};
    var w = Object.assign({}, DEFAULT_SCORE_WEIGHTS, customWeights || {});
    var defs = [
      { key: 'callFixed',   label: 'المان‌های ثابت تماس', weight: Number(w.callFixed) || 0,   raw: scores.callAvg },
      { key: 'situational', label: 'معیارهای موقعیتی',    weight: Number(w.situational) || 0, raw: scores.situationalAvg },
      { key: 'social',      label: 'پیام‌رسان (سوشال)',   weight: Number(w.social) || 0,      raw: scores.socialAvg },
      { key: 'ticket',      label: 'تیکت‌ها',             weight: Number(w.ticket) || 0,      raw: scores.ticketAvg }
    ];
    var totalWeight = defs.reduce(function (s, d) { return s + d.weight; }, 0);
    var activeWeight = 0, weightedNum = 0;
    var pillars = defs.map(function (d) {
      var val = C.normalizeScore(d.raw);
      var active = val !== null && d.weight > 0;
      var earned = active ? C.round2(val * d.weight / 100) : 0;
      if (active) {
        activeWeight += d.weight;
        weightedNum += val * d.weight;
      }
      return {
        key: d.key,
        label: d.label,
        weight: d.weight,
        score: val === null ? '' : C.round2(val),
        earned: earned,
        active: active
      };
    });
    var rawWeightedSum = activeWeight > 0 ? C.round2(weightedNum / 100) : '';
    var score = activeWeight > 0 ? C.round2(weightedNum / activeWeight) : '';
    return {
      score: score,
      rawWeightedSum: rawWeightedSum,
      activeWeight: activeWeight,
      totalWeight: totalWeight,
      weights: { callFixed: defs[0].weight, situational: defs[1].weight, social: defs[2].weight, ticket: defs[3].weight },
      pillars: pillars
    };
  }

  function situationalAvgOf(rows) {
    var scored = (rows || []).filter(function (r) { return C.normalizeScore(r.situationalScore) !== null; });
    if (!scored.length) return '';
    if (scored.length === 1) return C.round2(C.normalizeScore(scored[0].situationalScore));
    var wSum = 0, sSum = 0;
    scored.forEach(function (r) {
      var w = (Number(r.formsCount) > 0) ? Number(r.formsCount) : 1;
      sSum += C.normalizeScore(r.situationalScore) * w;
      wSum += w;
    });
    return wSum > 0 ? C.round2(sSum / wSum) : '';
  }

  function aggregateSituational(rows) {
    var list = rows || [];
    var experts = new Set();
    var periodMap = new Map();
    var totalForms = 0;
    list.forEach(function (r) {
      if (r.expertName) experts.add(r.expertName);
      totalForms += Number(r.formsCount) || 0;
      var pKey = [r.formType || '', r.periodFrom || '', r.periodTo || '', r.sourceFile || ''].join('|');
      if (!periodMap.has(pKey)) {
        periodMap.set(pKey, {
          formType: r.formType || '',
          from: r.periodFrom || '',
          to: r.periodTo || '',
          sourceFile: r.sourceFile || '',
          pairedFixedFile: r.pairedFixedFile || ''
        });
      }
    });
    function formSummary(ft) {
      var sub = list.filter(function (r) { return r.formType === ft; });
      var sp = new Set(sub.map(function (r) { return r.expertName; }).filter(Boolean));
      return {
        recordsCount: sub.length,
        specialistsCount: sp.size,
        formsCount: sub.reduce(function (s, r) { return s + (Number(r.formsCount) || 0); }, 0),
        avgScore: situationalAvgOf(sub)
      };
    }
    var elements = [];
    ['tele', 'account'].forEach(function (ft) {
      var sub = list.filter(function (r) { return r.formType === ft; });
      if (!sub.length) return;
      var defs = P.situationalDefaults ? P.situationalDefaults(ft) : [];
      defs.forEach(function (def) {
        var totalN = 0, weightedOk = 0, contribRows = 0, lastSingleAvg = null;
        sub.forEach(function (r) {
          var el = (r.elements || {})[def.key];
          if (!el) return;
          var n = Number(el.n) || 0;
          if (n > 0 && el.avg != null && Number.isFinite(Number(el.avg))) {
            totalN += n;
            weightedOk += Number(el.avg) * n;
            contribRows++;
            lastSingleAvg = Number(el.avg);
          }
        });
        var rate = totalN > 0
          ? C.round2((contribRows === 1 ? lastSingleAvg : (weightedOk / totalN)) * 100)
          : '';
        var errorRate = rate === '' ? '' : C.round2(100 - rate);
        elements.push({
          form: ft,
          key: def.key,
          label: def.label,
          n: totalN,
          rate: rate,
          errorRate: errorRate
        });
      });
    });
    return {
      hasData: list.length > 0,
      recordsCount: list.length,
      specialistsCount: experts.size,
      formsCount: totalForms,
      avgScore: situationalAvgOf(list),
      periods: Array.from(periodMap.values()),
      byForm: { tele: formSummary('tele'), account: formSummary('account') },
      elements: elements
    };
  }

  function scoredRows(rows) {
    return (rows || []).filter(function (r) { return C.normalizeScore(r.score) !== null; })
      .map(function (r) { return Object.assign({}, r, { score: C.normalizeScore(r.score) }); });
  }
  function avgScore(rows) { return C.avg(scoredRows(rows).map(function (r) { return r.score; })); }
  function rateAll(rows, key) { return C.elementRate(rows.map(function (r) { return r[key]; })); }
  function hasRedline(row, type) {
    // در فرم تیکت ۰ ردلاین است؛ در تماس (و سوشال دارای پرچم صریح) ۱.
    return C.normalizeTri(row.redline) === (type === 'ticket' ? 0 : 1);
  }
  function redlineCount(rows, type) { return (rows || []).filter(function (r) { return hasRedline(r, type); }).length; }

  function criteriaKeys(rows, type, crit) {
    var present = new Set();
    (rows || []).filter(function (r) { return !type || r.formType === type; })
      .forEach(function (r) { Object.keys(r.elements || {}).forEach(function (k) { present.add(k); }); });
    var ordered = crit && crit.criteriaFor ? crit.criteriaFor(type) : [];
    var configured = false, active = new Set();
    if (crit && crit.definitionsFor) (rows || []).forEach(function(r) {
      var team = r.criteriaTeam || r.team || (crit.rowTeam ? crit.rowTeam(r) : '');
      var custom = crit.configured ? crit.configured(type, team) : P.hasConfiguration(type, team);
      if (custom) { configured = true; crit.definitionsFor(type, team).filter(d => d.active !== false).forEach(d => active.add(d.key)); }
      else Object.keys(r.elements || {}).forEach(k => active.add(k));
    });
    if (configured) return Array.from(active);
    return (ordered || []).filter(function (k) { return present.has(k); })
      .concat(Array.from(present).filter(function (k) { return (ordered || []).indexOf(k) === -1; }));
  }
  function configuredCriteria(data, supplied) {
    const base = P.resolver((data.settings || {}).callCriteria);
    const memo = new Map();
    const cached = (key, make) => { if (memo.has(key)) return memo.get(key); const value = make(); memo.set(key, value); return value; };
    const wrapped = {
      config: base.config,
      definitionsFor: (type, team) => cached('d|' + type + '|' + (team || ''), () => base.definitionsFor(type, team)),
      criteriaFor: (type, team) => cached('c|' + type + '|' + (team || ''), () => base.criteriaFor(type, team)),
      configured: (type, team) => cached('g|' + type + '|' + (team || ''), () => base.configured(type, team)),
      labelOf: (type, key, team) => cached('l|' + type + '|' + (team || '') + '|' + key, () => base.labelOf(type, key, team)),
      elementValue: base.elementValue
    };
    return Object.assign(wrapped, supplied || {}, {
      rowTeam: r => rowTeam(data, r),
      elementValue: (r, k) => P.elementValue(Object.assign({}, r, { team: r.criteriaTeam || r.team || rowTeam(data, r) }), k, (data.settings || {}).callCriteria || null)
    });
  }
  function criterionLabel(rows, type, key, crit) {
    const team = rows.length ? rows[0].criteriaTeam || rows[0].team || (crit.rowTeam ? crit.rowTeam(rows[0]) : '') : '';
    return crit.labelOf ? crit.labelOf(type, key, team) : key;
  }

  function criterionStats(rows, key, crit) {
    var ok = 0, bad = 0, na = 0, missing = 0;
    rows.forEach(function (r) {
      var value = crit && crit.elementValue ? crit.elementValue(r,key) : C.normalizeTri((r.elements || {})[key]);
      if (crit && crit.configured && crit.configured(r.formType, r.team || (crit.rowTeam ? crit.rowTeam(r) : '')) && !crit.criteriaFor(r.formType, r.team || (crit.rowTeam ? crit.rowTeam(r) : '')).includes(key)) value = '';
      if (value === 1) ok++; else if (value === 0) bad++; else if (value === '-') na++; else missing++;
    });
    var applicable = ok + bad;
    return { key: key, ok: ok, bad: bad, na: na, missing: missing, total: ok + bad + na, applicable: applicable,
      successRate: applicable ? C.round2(100 * ok / applicable) : '', errorRate: applicable ? C.round2(100 * bad / applicable) : '' };
  }

  /* --------------------------------------------------- گزارش تیکت‌ها */
  function ticketReport(data, level, q) {
    var rows = filterRows(data.tickets, q, data);
    var group = level === 'team' ? function (r) { return rowTeam(data, r); } : function (r) { return r.agentName; };
    var names = Array.from(new Set(rows.map(group).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'fa'); });
    return names.map(function (name) {
      var rs = rows.filter(function (r) { return group(r) === name; });
      var agents = new Set(rs.map(function (r) { return r.agentName; })).size;
      var out = {
        name: name,
        team: level === 'team' ? name : teamOf(data.agents, name),
        count: scoredRows(rs).length,
        avgScore: avgScore(rs),
        q1Rate: rateAll(rs, 'q1'), q2Rate: rateAll(rs, 'q2'),
        q3Rate: rateAll(rs, 'q3'), q4Rate: rateAll(rs, 'q4'),
        redlineZero: redlineCount(rs, 'ticket'),
        total: rs.length
      };
      if (level === 'team') out.agentsEvaluated = agents;
      return out;
    });
  }

  /* --------------------------------------------------- گزارش سوشال‌ها */
  function socialReport(data, level, q) {
    var rows = filterRows(data.socials, q, data);
    var group = level === 'team' ? function (r) { return rowTeam(data, r); } : function (r) { return r.agentName; };
    var names = Array.from(new Set(rows.map(group).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'fa'); });
    var sla = function (rs, v) { return rs.filter(function (r) { return r.slaStatus === v; }).length; };
    return names.map(function (name) {
      var rs = rows.filter(function (r) { return group(r) === name; });
      var okS = sla(rs, 'رعایت شده'), badS = sla(rs, 'رعایت نشده');
      var agents = new Set(rs.map(function (r) { return r.agentName; })).size;
      var out = {
        name: name,
        team: level === 'team' ? name : teamOf(data.agents, name),
        count: scoredRows(rs).length,
        avgScore: avgScore(rs),
        answered: rs.filter(function (r) { return r.responseStatus === 'پاسخ داده شده'; }).length,
        slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
        qSlaRate: rateAll(rs, 'qSla'), qFollowRate: rateAll(rs, 'qFollow'),
        qClosingRate: rateAll(rs, 'qClosing'), qToneRate: rateAll(rs, 'qTone'),
        unanswered: rs.filter(function (r) { return r.responseStatus === 'عدم پاسخ'; }).length,
        slaMissed: badS,
        avgDurationMin: C.avg(rs.filter(function (r) { return r.durationMin != null; }).map(function (r) { return r.durationMin; })),
        total: rs.length
      };
      if (level === 'team') out.agentsEvaluated = agents;
      return out;
    });
  }

  /* ------------------------------------------- تفکیک ماهانه (ماه مالی) */
  /** rows → گروه‌بندی بر اساس سال/ماه شمسیِ ستون تاریخ، خروجی مرتب‌شده از قدیم به جدید */
  /* تفکیک به‌ازای هر تاریخ: تیکت + سوشال + تماس در یک ردیف */
  function dailyBreakdown(tickets, socials, calls) {
    var map = {};
    function mk(k) {
      if (!map[k]) map[k] = { date: k, ticketCount: 0, ticketSum: 0, socialCount: 0, socialSum: 0, callCount: 0, callSum: 0, callTele: 0, callAccount: 0, callMlm: 0, redlines: 0 };
      return map[k];
    }
    (tickets || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.ticketCount++;
      if (typeof r.score === 'number') d.ticketSum += r.score;
      if (String(r.redline) === '1') d.redlines++;
    });
    (socials || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.socialCount++;
      if (typeof r.score === 'number') d.socialSum += r.score;
    });
    (calls || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.callCount++;
      if (typeof r.score === 'number') d.callSum += r.score;
      if (r.formType === 'tele') d.callTele++; else if (r.formType === 'account') d.callAccount++; else if (r.formType === 'mlm') d.callMlm++;
      if (r.redline === 1 || r.redline === '1') d.redlines++;
    });
    var arr = Object.keys(map).map(function (k) {
      var d = map[k];
      return {
        date: k,
        ticketCount: d.ticketCount, ticketAvg: d.ticketCount ? Math.round((d.ticketSum / d.ticketCount) * 100) / 100 : '',
        socialCount: d.socialCount, socialAvg: d.socialCount ? Math.round((d.socialSum / d.socialCount) * 100) / 100 : '',
        callCount: d.callCount, callAvg: d.callCount ? Math.round((d.callSum / d.callCount) * 100) / 100 : '',
        byType: { tele: d.callTele, account: d.callAccount, mlm: d.callMlm },
        redlines: d.redlines
      };
    });
    arr.sort(function (a, b) {
      if (a.date === 'بدون تاریخ') return 1;
      if (b.date === 'بدون تاریخ') return -1;
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
    });
    return arr;
  }

  function monthlyBreakdown(rows, dateKey) {
    dateKey = dateKey || 'reviewDate';
    var byMonth = {};
    rows.forEach(function (r) {
      var j = C.parseDate(r[dateKey]);
      if (!j) return;
      var key = j.jy + '-' + (j.jm < 10 ? '0' : '') + j.jm;
      if (!byMonth[key]) byMonth[key] = { jy: j.jy, jm: j.jm, rows: [] };
      byMonth[key].rows.push(r);
    });
    return Object.keys(byMonth).sort().map(function (key) {
      var m = byMonth[key];
      return {
        key: key, jy: m.jy, jm: m.jm,
        monthFa: C.MONTHS_FA[m.jm - 1] + ' ' + C.toFaDigits(String(m.jy)),
        count: scoredRows(m.rows).length,
        avgScore: avgScore(m.rows),
        slaReal: m.rows.some(function (x) { return x.slaStatus; }) ? rateSla(m.rows) : '',
        redlineZero: m.rows.filter(function (x) { return x.score === 0 && String(x.redline) === '0'; }).length
      };
    });
  }
  function rateSla(rows) {
    var ok = rows.filter(function (r) { return r.slaStatus === 'رعایت واقعی SLA' || r.slaStatus === 'رعایت شده'; }).length;
    var bad = rows.filter(function (r) { return r.slaStatus === 'رعایت نشده'; }).length;
    return ok + bad === 0 ? '' : C.round2(100 * ok / (ok + bad));
  }

  /* -------------------------------- گزارش تجمیعی کارشناس (تیکت+سوشال+تماس+موقعیتی) */
  /** هر کارشناس → نمره هر بخش + نمره کل وزن‌دار (۴۵/۲۵/۱۵/۱۵) */
  function combinedAgentReport(data, q) {
    q = q || {};
    var map = Object.create(null), teamSet = valueSet(q.team), agentSet = valueSet(q.agent);
    var teamKeySet = teamSet ? new Set(Array.from(teamSet).map(P.teamKey)) : null;
    function ensure(name, team) {
      if (!map[name]) map[name] = { name: name, team: teamOf(data.agents, name) || team || '', tickets: [], socials: [], calls: [], situational: [], monthlyTickets: [], monthlySocials: [] };
      return map[name];
    }
    if (q.includeEmpty) (data.agents || []).forEach(function (a) {
      if ((!teamKeySet || teamKeySet.has(P.teamKey(a.team))) && (!agentSet || agentSet.has(a.name))) ensure(a.name, a.team);
    });
    filterRows(data.tickets, q, data).forEach(function (r) { ensure(r.agentName, r.team).tickets.push(r); });
    filterRows(data.socials, q, data).forEach(function (r) { ensure(r.agentName, r.team).socials.push(r); });
    filterCalls(data, q).forEach(function (r) { ensure(r.expertName, rowTeam(data, r)).calls.push(r); });
    filterSituational(data, q).forEach(function (r) { ensure(r.expertName, rowTeam(data, r)).situational.push(r); });
    filterMonthlyScores(data, q, 'ticket').forEach(function (r) { ensure(r.expertName, rowTeam(data, r)).monthlyTickets.push(r); });
    filterMonthlyScores(data, q, 'social').forEach(function (r) { ensure(r.expertName, rowTeam(data, r)).monthlySocials.push(r); });

    var weightsCfg = data && data.settings && data.settings.scoreWeights;
    return Object.keys(map).map(function (key) {
      var m = map[key], T = m.tickets, S = m.socials, Ph = m.calls, Sit = m.situational;
      var effT = effectiveChannelScore(T, m.monthlyTickets);
      var effS = effectiveChannelScore(S, m.monthlySocials);
      var callAvgVal = avgScore(Ph);
      var sitAvgVal = situationalAvgOf(Sit);
      var weighted = computeWeightedScore({
        callAvg: callAvgVal,
        situationalAvg: sitAvgVal,
        socialAvg: effS.avg,
        ticketAvg: effT.avg
      }, weightsCfg);
      var agent = (data.agents || []).find(function (a) { return a.name === key; });
      return {
        name: m.name, team: m.team, ext: agent ? agent.ext : null, active: agent ? agent.active !== false : true,
        registered: !!agent,
        ticketCount: effT.count, ticketAvg: effT.avg, ticketSource: effT.source, ticketRedline: redlineCount(T, 'ticket'),
        socialCount: effS.count, socialAvg: effS.avg, socialSource: effS.source, socialRedline: redlineCount(S, 'social'), socialSlaReal: rateSla(S),
        socialUnanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        callCount: Ph.length, callAvg: callAvgVal, callRedline: redlineCount(Ph, 'call'),
        situationalCount: Sit.length,
        situationalForms: Sit.reduce(function (s, r) { return s + (Number(r.formsCount) || 0); }, 0),
        situationalAvg: sitAvgVal,
        totalCount: effT.count + effS.count + Ph.length,
        scoredCount: effT.scoredCount + effS.scoredCount + scoredRows(Ph).length,
        avgScore: weighted.score,
        weightedScore: weighted.score,
        activeWeight: weighted.activeWeight,
        rawWeightedSum: weighted.rawWeightedSum,
        weightedBreakdown: weighted
      };
    }).filter(function (x) { return q.includeEmpty || x.totalCount > 0 || x.situationalCount > 0; })
      .sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore) || a.name.localeCompare(b.name, 'fa'); });
  }

  function portfolioAgents(data, q) { return combinedAgentReport(data, Object.assign({}, q, { includeEmpty: true })); }

  /* ----------------------------------------------------- پرونده کارشناس */
  /** کارشناس با نام یا داخلی (ext) → جزئیات کامل */
  /* ---------------------------- گزارش تماس (ردیفی) + نمرهی اقلام کلی ---------------------------- */
  function callReport(data, level, q, crit) {
    q = q || {}; crit = configuredCriteria(data, crit);
    var criteriaFor = crit.criteriaFor || function () { return []; };
    var labelOf = crit.labelOf || function (t, k) { return k; };
    var agentSet = valueSet(q.agent);
    function teamN(rr) { return rowTeam(data, rr) || 'بدون تیم'; }
    var rowsFB = filterCalls(data, q);
    var sitRows = filterSituational(data, q);
    var group = level === 'team' ? teamN : function (r) { return r.expertName; };
    var seen = Object.create(null), names = [];
    rowsFB.forEach(function (r) { var g = group(r); if (g && !seen[g]) { seen[g] = 1; names.push(g); } });
    sitRows.forEach(function (r) { var g = group(r); if (g && !seen[g]) { seen[g] = 1; names.push(g); } });
    function avgOf(rr) { return avgScore(rr); }
    var rows = names.map(function (name) {
      var rs = rowsFB.filter(function (r) { return group(r) === name; });
      var srs = sitRows.filter(function (r) { return group(r) === name; });
      var tele = rs.filter(function (r) { return r.formType === 'tele'; });
      var acc = rs.filter(function (r) { return r.formType === 'account'; });
      var mlm = rs.filter(function (r) { return r.formType === 'mlm'; });
      return {
        name: name,
        team: level === 'team' ? name : (rowTeam(data, rs[0] || srs[0]) || ''),
        count: scoredRows(rs).length,
        avgScore: avgOf(rs),
        situationalAvg: situationalAvgOf(srs),
        situationalForms: srs.reduce(function (s, r) { return s + (Number(r.formsCount) || 0); }, 0),
        redlines: redlineCount(rs, 'call'),
        teleCount: tele.length, teleAvg: avgOf(tele),
        accCount: acc.length, accAvg: avgOf(acc),
        mlmCount: mlm.length, mlmAvg: avgOf(mlm),
        total: rs.length
      };
    });
    function rates(type) {
      var subset = rowsFB.filter(function (r) { return r.formType === type; });
      return criteriaKeys(subset, type, crit).map(function (key) {
        return Object.assign(criterionStats(subset, key, crit), { label: criterionLabel(subset, type, key, crit), form: type });
      });
    }
    var elements = [].concat(rates('tele'), rates('account'), rates('mlm'))
      .filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return (b.errorRate === '' ? -1 : b.errorRate) - (a.errorRate === '' ? -1 : a.errorRate); });
    // جزئیات تماس فقط برای انتخاب دقیق یک کارشناس؛ فرم‌ها در UI جدا جدول‌بندی می‌شوند.
    var calls = agentSet && agentSet.size === 1 ? rowsFB.slice().sort(function (a, b) {
      var aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
      return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
    }) : [];
    var redlineRows = rowsFB.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return Object.assign({}, r, { currentTeam: teamN(r) });
    });
    var situational = aggregateSituational(sitRows);
    var situationalRows = names.map(function (name) {
      var srs = sitRows.filter(function (r) { return group(r) === name; });
      if (!srs.length) return null;
      var agg = aggregateSituational(srs);
      return {
        name: name,
        team: level === 'team' ? name : (rowTeam(data, srs[0]) || ''),
        formTypes: Array.from(new Set(srs.map(function (r) { return r.formType; }))),
        formsCount: agg.formsCount,
        situationalScore: agg.avgScore,
        periods: agg.periods,
        elements: agg.elements
      };
    }).filter(Boolean).sort(function (a, b) {
      return (b.situationalScore === '' ? -1 : b.situationalScore) - (a.situationalScore === '' ? -1 : a.situationalScore);
    });
    return { rows: rows, elements: elements, calls: calls, redlineRows: redlineRows, situational: situational, situationalRows: situationalRows };
  }

  /* ---------------------------- نرخ اقلام نسبت به کل دیتا (وزن‌دار) ----------------------------
   * به‌جای میانگین نرخ تک‌به‌تک کارشناس‌ها، رعایت/عدم‌رعایت را روی کل ردیف‌های
   * فیلترشده جمع می‌زند — دقیقاً معادل اینکه کل گروه یک شیت واحد باشد. */
  function elementRates(data, q) {
    q = q || {};
    function ratesFor(rows, keys) {
      return keys.map(function (k) {
        var ok = 0, bad = 0;
        rows.forEach(function (r) {
          var v = C.normalizeTri(r[k[0]]);
          if (v === 1) ok++;
          else if (v === 0) bad++;
        });
        var tot = ok + bad;
        return {
          key: k[0], label: k[1], form: k[2], ok: ok, bad: bad, total: tot,
          successRate: tot ? C.round2(100 * ok / tot) : '',
          errorRate: tot ? C.round2(100 * bad / tot) : ''
        };
      });
    }
    var T = scoredRows(filterRows(data.tickets, q, data));
    var S = scoredRows(filterRows(data.socials, q, data));
    return {
      ticket: ratesFor(T, [
        ['q1', 'پیگیری', 'ticket'], ['q2', 'یادداشت', 'ticket'], ['q3', 'دلیل بستن', 'ticket'], ['q4', 'اکشن CRM', 'ticket']
      ]),
      social: ratesFor(S, [
        ['qSla', 'المان SLA', 'social'], ['qFollow', 'پیگیری', 'social'], ['qClosing', 'پایان‌بندی', 'social'], ['qTone', 'لحن', 'social']
      ])
    };
  }

  function agentByIdent(agents, ident) {
    ident = C.faToEn(String(ident == null ? '' : ident)).trim().toLowerCase();
    if (!ident) return null;
    const resolved = P.resolveExpert(agents, ident).agent; if (resolved) return resolved;
    var exact = agents.find(function (a) { return a.name && String(a.name).toLowerCase().trim() === ident; })
      || agents.find(function (a) { return a.ext != null && String(a.ext).toLowerCase() === ident; });
    if (exact) return exact;
    const possible = agents.filter(a => a.name && String(a.name).toLowerCase().includes(ident));
    return possible.length === 1 ? possible[0] : null;
  }
  function agentProfile(data, ident, q) {
    q = q || {};
    var a = agentByIdent(data.agents, ident);
    var name;
    if (a) {
      name = a.name;
    } else {
      // کارشناسی که فقط در دیتای تماس دیده شده (هنوز در رجیستری نیست)
      var nm = String(ident || '').trim();
      var hit = (data.callFeedbacks || []).filter(r=>r.expertName===nm)
        .concat((data.callSituational || []).filter(r=>r.expertName===nm), (data.monthlyScores || []).filter(r=>r.expertName===nm), (data.tickets||[]).filter(r=>r.agentName===nm), (data.socials||[]).filter(r=>r.agentName===nm));
      if (!hit.length) return null;
      a = { id:0,name:nm,team:rowTeam(data, hit[0])||hit[0].team||'بدون تیم',active:true,ext:null,role:'کارشناس از داده‌های واردشده' };
      name = nm;
    }
    var T = filterRows(data.tickets, q, data).filter(function (r) { return r.agentName === name; });
    var S = filterRows(data.socials, q, data).filter(function (r) { return r.agentName === name; });
    var mT = filterMonthlyScores(data, Object.assign({}, q, { agent: name }), 'ticket');
    var mS = filterMonthlyScores(data, Object.assign({}, q, { agent: name }), 'social');
    var effT = effectiveChannelScore(T, mT);
    var effS = effectiveChannelScore(S, mS);
    var Ph = filterCalls(data, Object.assign({}, q, { agent: name }));
    var allPh = (q && (q.from || q.to))
      ? filterCalls(data, Object.assign({}, q, { agent: name, from: '', to: '' }))
      : Ph;
    var allCallRange = P.dateRangeOfCalls ? P.dateRangeOfCalls(allPh) : { from: '', to: '' };
    var Sit = filterSituational(data, Object.assign({}, q, { agent: name }));
    var sitAgg = aggregateSituational(Sit);
    var callAvgVal = avgScore(Ph);
    var weighted = computeWeightedScore({
      callAvg: callAvgVal,
      situationalAvg: sitAgg.avgScore,
      socialAvg: effS.avg,
      ticketAvg: effT.avg
    }, data.settings && data.settings.scoreWeights);
    var store = data.callImport || {};
    /* اقدامات اصلاحی: آن‌هایی که پنل در recovery ذخیره کرده + ثبت‌های بومی سامانه */
    var panelActions = ((store.storedActions && store.storedActions[name]) || []).map(function (x) {
      return { title: String(x.title || x.titleFa || x.text || ''), date: String(x.date || ''), status: String(x.status || 'انجام نشده'), source: 'panel', note: String(x.note || '') };
    });
    var nativeActions = ((data.agentActions || {})[name] || []).map(function (x) {
      return { id: x.id, title: String(x.title || ''), date: String(x.date || ''), status: String(x.status || 'انجام نشده'), source: 'system', note: String(x.note || '') };
    });
    var actions = nativeActions.concat(panelActions);
    var vRaw = (store.voiceMeta && store.voiceMeta[name]) || [];
    var voices = Array.isArray(vRaw) ? vRaw : (vRaw && typeof vRaw === 'object' && typeof vRaw.count === 'number' ? { count: vRaw.count } : []);

    /* نرخ موفقیت معیارهای تماس برای این کارشناس — طبق نمونه پنل (بازیگر معیارها از روی خود ردیف‌ها، چون دیکشنری نمی‌خواهیم سرور وابسته شود) */
    var profileCriteria = configuredCriteria(data);
    var callsByForm = { tele: [], account: [], mlm: [] };
    Ph.forEach(function (r) { if (callsByForm[r.formType]) callsByForm[r.formType].push(r); });
    var byTypeRates = ['tele', 'account', 'mlm'].map(function (ft) {
      var rs = callsByForm[ft];
      if (!rs.length) return null;
      var criteria = profileCriteria;
      var keys = criteriaKeys(rs, ft, criteria);
      var list = keys.map(function (k) {
        var stats = criterionStats(rs, k, criteria);
        return Object.assign({}, stats, { total: stats.applicable, observations: stats.total, label: criterionLabel(rs, ft, k, criteria) });
      }).sort(function (x, y) {
        return (x.successRate === '' ? 101 : x.successRate) - (y.successRate === '' ? 101 : y.successRate);
      });
      var weak = list.filter(function (x) { return x.successRate !== '' && x.successRate < 100; });
      return { form: ft, count: rs.length, rates: list, weak: weak.length };
    }).filter(Boolean);

    /* ردلاین‌های کارشناس با علت */
    var redlineRows = Ph.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return { score: r.score, reason: r.redlineReason || '', date: r.reviewDate,
               formType: r.formType, leadName: r.leadName, leadPhone: r.leadPhone, qcComment: r.qcComment || '' };
    }).sort(function (x, y) { return (y.date || '').localeCompare(x.date || ''); });

    return {
      agent: a,
      scope: { from: q && q.from ? C.formatJalali(C.parseDate(q.from)) : '', to: q && q.to ? C.formatJalali(C.parseDate(q.to)) : '' },
      weighted: weighted,
      tickets: {
        rows: T, count: effT.count, scoredCount: effT.scoredCount, avgScore: effT.avg,
        source: effT.source, individualCount: T.length, individualAvg: avgScore(T), monthlyRecords: mT,
        q1Rate: rateAll(T, 'q1'), q2Rate: rateAll(T, 'q2'), q3Rate: rateAll(T, 'q3'), q4Rate: rateAll(T, 'q4'),
        redlineZero: redlineCount(T, 'ticket')
      },
      socials: {
        rows: S, count: effS.count, scoredCount: effS.scoredCount, avgScore: effS.avg,
        source: effS.source, individualCount: S.length, individualAvg: avgScore(S), monthlyRecords: mS,
        slaReal: rateSla(S),
        unanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        avgDurationMin: C.avg(S.map(function (x) { return x.durationMin; }).filter(function (v) { return typeof v === 'number'; }))
      },
      calls: {
        rows: Ph, count: Ph.length,
        allCount: allPh.length,
        allDateRange: allCallRange,
        byType: ['tele', 'account', 'mlm'].map(function (t) {
          var rs = callsByForm[t];
          return { type: t, count: rs.length, avg: avgScore(rs) };
        }).filter(function (x) { return x.count > 0; }),
        redlineCount: redlineCount(Ph, 'call'), scoredCount: scoredRows(Ph).length,
        avgScore: callAvgVal,
        byTypeRates: byTypeRates,
        redlineRows: redlineRows
      },
      situational: Object.assign({}, sitAgg, { records: Sit }),
      actions: actions, voiceCount: Array.isArray(voices) ? voices.length : (voices.count || 0),
      monthly: {
        tickets: monthlyBreakdown(T),
        socials: monthlyBreakdown(S),
        calls: monthlyBreakdown(Ph)
      },
      daily: dailyBreakdown(T, S, Ph)
    };
  }

  /* ================================================= تحلیل بومی تماس (پنل بومی سامانه)
   * همه‌ی خروجی‌های داشبورد پنل دستیار روی دیتای ادغام‌شده‌ی سامانه:
   * KPI، نرخ هر معیار، هیت‌مپ خطای کارشناس×معیار، رتبه‌بندی، ردلاین‌ها، کامنت‌ها، ماهانه.
   * crit: آبجکت تشکیل‌شده از توابع parseQc (criteriaFor/labelOf) — تمرین: از سرور یا window.QCParse.
   */
  function callAnalysis(data, q, crit) {
    q = q || {};
    crit = configuredCriteria(data, crit);
    var criteriaFor = crit.criteriaFor || function () { return []; };
    var labelOf = crit.labelOf || function (t, k) { return k; };

    var Ph = filterCalls(data, q);
    var Sit = filterSituational(data, q);
    var sitAgg = aggregateSituational(Sit);
    var scored = scoredRows(Ph);
    var expertSet = Object.create(null);
    Ph.forEach(function (r) { expertSet[r.expertName] = 1; });

    /* KPI */
    var kpis = {
      totalCalls: Ph.length,
      scoredCalls: scored.length,
      avgScore: avgScore(Ph),
      situationalAvg: sitAgg.avgScore,
      situationalCount: sitAgg.recordsCount,
      situationalRecords: sitAgg.recordsCount,
      situationalSpecialists: sitAgg.specialistsCount,
      redlineCount: redlineCount(Ph, 'call'),
      expertsWithData: Object.keys(expertSet).length,
      withComment: Ph.filter(function (r) { return (r.qcComment || '').trim(); }).length,
      listeningCalls: Ph.filter(function (r) { return (r.listeningTime || '') !== '' && r.listeningTime !== '-'; }).length
    };

    /* تفکیک نوع فرم */
    var byForm = ['tele', 'account', 'mlm'].map(function (ft) {
      var rs = Ph.filter(function (r) { return r.formType === ft; });
      if (!rs.length) return null;
      return { form: ft, count: rs.length, avgScore: avgScore(rs), redlines: redlineCount(rs, 'call') };
    }).filter(Boolean);

    /* گروه‌بندی کارشناسان یک‌بار انجام می‌شود؛ هیت‌مپ و رتبه‌بندی از همین
     * گروه‌ها ساخته می‌شوند تا O(کارشناس × ردیف) به O(ردیف) برسد. */
    var byExpert = Object.create(null);
    Ph.forEach(function (r) {
      var name = r.expertName;
      if (!byExpert[name]) byExpert[name] = [];
      byExpert[name].push(r);
    });
    var byExpertNames = Object.keys(byExpert);

    /* نرخ هر معیار — جدا برای هر نوع فرم به ترتیب پنل */
    function ratesOf(rows, type) {
      return criteriaKeys(rows, type, crit).map(function (key) {
        var stats = criterionStats(rows, key, crit);
        return Object.assign({}, stats, { label: criterionLabel(rows,type,key,crit), total: stats.applicable, observations: stats.total });
      });
    }
    /* سنگین‌ترین بخش تحلیل فقط وقتی ساخته می‌شود که صریحاً خواسته شده باشد
     * (خروجی اکسل)؛ نمای معمول صفحه به آن نیاز ندارد. */
    var wantFull = q.full === true || q.full === '1' || q.full === 1;
    var elementRates = !wantFull ? null : {
      tele: ratesOf(Ph.filter(function (r) { return r.formType === 'tele'; }), 'tele'),
      account: ratesOf(Ph.filter(function (r) { return r.formType === 'account'; }), 'account'),
      mlm: ratesOf(Ph.filter(function (r) { return r.formType === 'mlm'; }), 'mlm')
    };

    /* هیت‌مپ خطا: کارشناس × معیار (فقط کارشناسان دارای دیتای همان فرم) */
    function heatmapOf(type) {
      var rows = Ph.filter(function (r) { return r.formType === type; });
      var keys = criteriaKeys(rows, type, crit);
      var present = Object.create(null);
      rows.forEach(function (r) { present[r.expertName] = 1; });
      var names = Object.keys(present);
      var out = names.map(function (name) {
        var ers = byExpert[name] || [];
        var counters = keys.map(function () { return { ok: 0, bad: 0 }; });
        ers.forEach(function (r) {
          if (r.formType !== type) return;
          keys.forEach(function (k, i) {
            var v = crit.elementValue ? crit.elementValue(r, k) : C.normalizeTri((r.elements || {})[k]);
            if (v === 1) counters[i].ok++; else if (v === 0) counters[i].bad++;
          });
        });
        var cells = counters.map(function (c) {
          var tot = c.ok + c.bad;
          return tot === 0 ? null : { ok: c.ok, bad: c.bad, total: tot, errorRate: C.round2(100 * c.bad / tot) };
        });
        return { name: name, team: teamOf(data.agents, name) || '', count: ers.length, avg: avgScore(ers), cells: cells };
      });
      /* کم‌دیتاترین خطاها اول؟ نه — بالاترین میانگین خطا در ستون‌ها اول */
      out.sort(function (a, b) {
        var ea = a.cells.filter(Boolean).reduce(function (s, x) { return s + x.errorRate; }, 0) / Math.max(1, a.cells.filter(Boolean).length);
        var eb = b.cells.filter(Boolean).reduce(function (s, x) { return s + x.errorRate; }, 0) / Math.max(1, b.cells.filter(Boolean).length);
        return eb - ea;
      });
      return { labels: keys.map(function (k) { return criterionLabel(rows, type, k, crit); }), keys: keys, agents: out };
    }
    var heatmaps = { tele: heatmapOf('tele'), account: heatmapOf('account'), mlm: heatmapOf('mlm') };

    /* ماتریس المان‌های موقعیتی: کارشناس × المان موقعیتی (نرخ رعایت + n) */
    var sitByExpert = Object.create(null);
    Sit.forEach(function (r) {
      if (!sitByExpert[r.expertName]) sitByExpert[r.expertName] = [];
      sitByExpert[r.expertName].push(r);
    });
    function sitHeatmapOf(type) {
      var rows = Sit.filter(function (r) { return r.formType === type; });
      var defs = P.situationalDefaults ? P.situationalDefaults(type) : [];
      var byName = Object.create(null);
      rows.forEach(function (r) {
        if (!byName[r.expertName]) byName[r.expertName] = [];
        byName[r.expertName].push(r);
      });
      var agents = Object.keys(byName).map(function (name) {
        var rs = byName[name];
        var agg = aggregateSituational(rs);
        var cells = defs.map(function (def) {
          var el = agg.elements.find(function (e) { return e.key === def.key; });
          if (!el || !el.n) return { n: 0, rate: '', errorRate: '' };
          return { n: el.n, rate: el.rate, errorRate: el.errorRate };
        });
        return {
          name: name,
          team: rowTeam(data, rs[0]) || '',
          formsCount: agg.formsCount,
          situationalScore: agg.avgScore,
          cells: cells
        };
      }).sort(function (a, b) {
        return (a.situationalScore === '' ? 101 : a.situationalScore) - (b.situationalScore === '' ? 101 : b.situationalScore);
      });
      return {
        labels: defs.map(function (d) { return d.label; }),
        keys: defs.map(function (d) { return d.key; }),
        agents: agents
      };
    }
    var situationalHeatmaps = { tele: sitHeatmapOf('tele'), account: sitHeatmapOf('account') };

    /* رتبه‌بندی کارشناسان (رتبه‌بندی بر پایه‌ی نمره ثابت تماس + نمایش جداگانه‌ی نمره موقعیتی) */
    var leaderboard = byExpertNames.map(function (name) {
      var rs = byExpert[name];
      var srs = sitByExpert[name] || [];
      return {
        name: name, team: rowTeam(data, rs[0]) || '',
        count: rs.length, avgScore: avgScore(rs),
        situationalAvg: situationalAvgOf(srs),
        redlines: redlineCount(rs, 'call'),
        worst: null /* برای UI: با elementRates قابل کراس است */
      };
    }).sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore); });

    /* ردلاین‌ها */
    var redlines = Ph.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
        score: r.score, reason: r.redlineReason || '', date: r.reviewDate, sourceFile: r.sourceFile };
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    /* Keep each weakness tied to the same evaluation as its QC comment. A
     * zero is a weakness; missing and not-applicable marks are not. */
    var comments = Ph.slice().sort(function (a, b) { return (b.reviewDate || '').localeCompare(a.reviewDate || ''); })
      .map(function (r) {
        var snapshot = Array.isArray(r.criteriaSnapshot) ? r.criteriaSnapshot : [];
        var keys = snapshot.length ? snapshot.filter(function (d) { return d.active !== false; }).map(function (d) { return d.key; }) : criteriaKeys([r], r.formType, crit);
        var weaknesses = Array.from(new Set(keys)).filter(function (key) {
          return crit.elementValue ? crit.elementValue(r, key) === 0 : C.normalizeTri((r.elements || {})[key]) === 0;
        }).map(function (key) {
          var old = snapshot.find(function (d) { return d.key === key; });
          return { key: key, label: old && old.label || criterionLabel([r], r.formType, key, crit) };
        });
        return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
          score: r.score, comment: r.qcComment || '', date: r.reviewDate, weaknesses: weaknesses };
      }).filter(function (r) { return r.comment.trim() || r.weaknesses.length; }).slice(0, 60);

    /* روند ماهانه — فقط در درخواست کامل (خروجی اکسل) */
    var byMonth = {};
    if (!wantFull) {
      return { kpis: kpis, byForm: byForm, elementRates: null, heatmaps: heatmaps,
        situational: sitAgg, situationalHeatmaps: situationalHeatmaps,
        leaderboard: leaderboard, redlines: redlines, comments: comments, monthly: [] };
    }
    Ph.forEach(function (r) {
      var j = C.parseDate(r.reviewDate); if (!j) return;
      var d = C.formatJalali(j).slice(0, 7);
      if (!byMonth[d]) byMonth[d] = { month: d, count: 0, scoreSum: 0, scoreN: 0, redlines: 0, forms: { tele: 0, account: 0, mlm: 0 } };
      byMonth[d].count++;
      var score = C.normalizeScore(r.score);
      if (score !== null) { byMonth[d].scoreSum += score; byMonth[d].scoreN++; }
      if (hasRedline(r, 'call')) byMonth[d].redlines++;
      if (byMonth[d].forms[r.formType] != null) byMonth[d].forms[r.formType]++;
    });
    var monthly = Object.keys(byMonth).sort().map(function (k) {
      var m = byMonth[k];
      return { month: k, count: m.count, avgScore: m.scoreN ? C.round2(m.scoreSum / m.scoreN) : '', redlines: m.redlines, forms: m.forms };
    });

    return { kpis: kpis, byForm: byForm, elementRates: elementRates, heatmaps: heatmaps,
             situational: sitAgg, situationalHeatmaps: situationalHeatmaps,
             leaderboard: leaderboard, redlines: redlines, comments: comments, monthly: monthly };
  }

  /* -------------------------------------------------------- داشبورد */
  function dashboard(data, q) {
    q = q || {};
    var T = filterRows(data.tickets, q, data);
    var S = filterRows(data.socials, q, data);
    var Ph = filterCalls(data, q), Tsc = scoredRows(T), Ssc = scoredRows(S), Psc = scoredRows(Ph);
    var Sit = filterSituational(data, q);
    var sitAgg = aggregateSituational(Sit);
    var mT = filterMonthlyScores(data, q, 'ticket');
    var mS = filterMonthlyScores(data, q, 'social');
    var monT = monthlyChannelSummary(mT);
    var monS = monthlyChannelSummary(mS);
    var effTicketAvg = monT.recordsCount > 0 ? monT.avg : C.avg(Tsc.map(function (r) { return r.score; }));
    var effSocialAvg = monS.recordsCount > 0 ? monS.avg : C.avg(Ssc.map(function (r) { return r.score; }));
    var callAvgVal = avgScore(Ph);
    var weighted = computeWeightedScore({
      callAvg: callAvgVal,
      situationalAvg: sitAgg.avgScore,
      socialAvg: effSocialAvg,
      ticketAvg: effTicketAvg
    }, data.settings && data.settings.scoreWeights);
    var all = Tsc.concat(Ssc, Psc).map(function (r) { return r.score; });
    var okS = S.filter(function (r) { return r.slaStatus === 'رعایت شده'; }).length;
    var badS = S.filter(function (r) { return r.slaStatus === 'رعایت نشده'; }).length;
    var bucket = function (arr, lo, hi) { return arr.filter(function (x) { return x >= lo && (hi == null || x < hi); }).length; };
    return {
      ticketCount: T.length, ticketScored: Tsc.length,
      monthlyTicketCount: monT.recordsCount, monthlyTicketEvalCount: monT.count, monthlyTicketAvg: monT.avg,
      socialCount: S.length, socialScored: Ssc.length,
      monthlySocialCount: monS.recordsCount, monthlySocialEvalCount: monS.count, monthlySocialAvg: monS.avg,
      callCount: Ph.length, callScored: Psc.length, avgCall: callAvgVal, callRedlines: redlineCount(Ph, 'call'),
      situationalCount: sitAgg.recordsCount, situationalAvg: sitAgg.avgScore,
      situational: sitAgg,
      avgTicket: effTicketAvg,
      avgSocial: effSocialAvg,
      avgAll: C.avg(all),
      weightedAvg: weighted.score,
      weighted: weighted,
      slaOk: okS, slaMissed: badS,
      slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
      unanswered: S.filter(function (r) { return r.responseStatus === 'عدم پاسخ'; }).length,
      redlineZero: redlineCount(T, 'ticket'),
      dist: [bucket(all, 90, null), bucket(all, 75, 90), bucket(all, 50, 75), bucket(all, 0, 50)],
      latestTickets: T.slice(-6).reverse(), latestSocials: S.slice(-6).reverse(), latestCalls: Ph.slice().sort(function (a, b) {
        var aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
        return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
      }).slice(0, 6)
    };
  }

  /** شمارش زنده‌ی مرکز داده، مستقل از متای آخرین آپلود و شامل تیم‌های بدون دیتا. */
  function dataStatus(data, q) {
    q = q || {};
    var T = filterRows(data.tickets, q, data), S = filterRows(data.socials, q, data), Ph = filterCalls(data, q);
    var Sit = filterSituational(data, q);
    var mT = filterMonthlyScores(data, q, 'ticket'), mS = filterMonthlyScores(data, q, 'social');
    var teams = Object.create(null);
    function ensure(team) {
      team = team || 'بدون تیم';
      if (!teams[team]) teams[team] = { team: team, ticketCount: 0, socialCount: 0, callCount: 0, totalCount: 0 };
      return teams[team];
    }
    (data.agents || []).forEach(function (a) { ensure(a.team); });
    [[T, 'ticketCount'], [S, 'socialCount'], [Ph, 'callCount']].forEach(function (entry) {
      entry[0].forEach(function (r) { var team = ensure(rowTeam(data, r)); team[entry[1]]++; team.totalCount++; });
    });
    return {
      tickets: T.length, socials: S.length, calls: Ph.length, situational: Sit.length,
      monthlyTicketScores: mT.length, monthlySocialScores: mS.length,
      diagnostics: P.importDiagnostics(Ph, data.agents || []),
      byForm: { tele: Ph.filter(function (r) { return r.formType === 'tele'; }).length,
        account: Ph.filter(function (r) { return r.formType === 'account'; }).length,
        mlm: Ph.filter(function (r) { return r.formType === 'mlm'; }).length },
      situationalByForm: {
        tele: Sit.filter(function (r) { return r.formType === 'tele'; }).length,
        account: Sit.filter(function (r) { return r.formType === 'account'; }).length
      },
      byTeam: Object.keys(teams).sort(function (a, b) { return a.localeCompare(b, 'fa'); }).map(function (t) { return teams[t]; }),
      undated: { tickets: (data.tickets || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length,
        socials: (data.socials || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length,
        calls: (data.callFeedbacks || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length,
        situational: (data.callSituational || []).filter(function (r) { return !C.parseDate(r.periodFrom) && !C.parseDate(r.periodTo); }).length }
    };
  }

  return {
    DEFAULT_SCORE_WEIGHTS: DEFAULT_SCORE_WEIGHTS,
    inRange: inRange, periodOverlaps: periodOverlaps, validateRange: validateRange,
    filterRows: filterRows, filterCalls: filterCalls, filterSituational: filterSituational,
    filterMonthlyScores: filterMonthlyScores, monthlyChannelSummary: monthlyChannelSummary,
    effectiveChannelScore: effectiveChannelScore, computeWeightedScore: computeWeightedScore,
    situationalAvgOf: situationalAvgOf, aggregateSituational: aggregateSituational,
    scoredRows: scoredRows,
    avgScore: avgScore, hasRedline: hasRedline, criteriaKeys: criteriaKeys, criterionStats: criterionStats, dataStatus: dataStatus, portfolioAgents: portfolioAgents,
    monthlyBreakdown: monthlyBreakdown, combinedAgentReport: combinedAgentReport, agentByIdent: agentByIdent, agentProfile: agentProfile,
    ticketReport: ticketReport, socialReport: socialReport, callReport: callReport, elementRates: elementRates, dashboard: dashboard,
    callAnalysis: callAnalysis,
    configuredCriteria: configuredCriteria, criterionLabel: criterionLabel
  };
});
