/* اتصال محدود گزارش تماس مستقل به بازه‌ی سراسری؛ دیتای ابزار با دیتای QC ادغام نمی‌شود. */
(function () {
'use strict';
const C = window.QCCalc;
let range = { from: null, to: null };
let sourceRange = { from: '', to: '' }, blocked = false, previousDisplay = '';

function matches(value) {
  if (!range.from && !range.to) return true;
  // «عمومی» تاریخ فرضیِ ابزار قدیمی است، نه تاریخ واقعی تماس.
  if (String(value).includes('(عمومی)')) return false;
  const date = C.parseDate(value);
  return !!date && C.jalaliInRange(date, range.from, range.to);
}
function checkLegacySummary() {
  const section = document.getElementById('resultSection');
  if (!section) return;
  const cannotFilter = !!(range.from || range.to) && !allRawCallLogs.length && allResults.length > 0;
  let notice = document.getElementById('qcRangeWarning');
  if (cannotFilter) {
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'qcRangeWarning'; notice.setAttribute('role', 'status');
      notice.style.cssText = 'padding:16px;margin:16px;border:1px solid #fbbf24;border-radius:10px;color:#fbbf24;';
      notice.textContent = 'این فایل فقط آمار تجمیعی دارد و تاریخ تک‌تک تماس‌ها موجود نیست. برای گزارش بازه‌ی تاریخ، فایل ریز تماس‌ها را دوباره وارد کنید.';
      section.before(notice);
    }
    if (!blocked) previousDisplay = section.style.display;
    section.style.display = 'none'; notice.hidden = false; blocked = true;
  } else if (blocked) {
    section.style.display = allRawCallLogs.length ? 'block' : previousDisplay;
    if (notice) notice.hidden = true;
    blocked = false;
  }
  return cannotFilter;
}
function apply(value) {
  const from = value.from ? C.parseDate(value.from) : null;
  const to = value.to ? C.parseDate(value.to) : null;
  if ((value.from && !from) || (value.to && !to) || (from && to && C.jalaliCmp(from, to) > 0)) return;
  range = { from, to }; sourceRange = value;
  if (allRawCallLogs.length) {
    const dates = [...new Set(allRawCallLogs.map((row) => row.dateStr).filter(Boolean))].sort();
    selectedDatesSet = new Set(dates.filter(matches));
    buildDateCheckboxes(dates);
    recomputeResultsFromRawLogs();
  } else if (!checkLegacySummary() && allResults.length && typeof applyFilters === 'function') {
    applyFilters();
  }
  checkLegacySummary();
}
window.QCReportRange = { matches, afterRecompute: checkLegacySummary };

/* ---------------- پل دریافت کارشناسان ثبت‌شده در مدیریت کارشناسان ---------------- */
let cachedSystemAgents = Array.isArray(window.__QC_SYSTEM_AGENTS__) ? window.__QC_SYSTEM_AGENTS__ : null;
const pendingAgentRequests = new Map();
let agentReqSeq = 0;

function readStoredAuthToken() {
  for (const store of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const raw = store().getItem('crmqc.auth.v1');
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.token) return String(parsed.token);
    } catch (e) {}
  }
  return '';
}

function requestAgentsFromParent() {
  return new Promise((resolve) => {
    if (!window.parent || window.parent === window) { resolve(null); return; }
    const requestId = 'sa_' + (++agentReqSeq) + '_' + Date.now();
    const timer = setTimeout(() => {
      pendingAgentRequests.delete(requestId);
      resolve(null);
    }, 2500);
    pendingAgentRequests.set(requestId, (agents) => {
      clearTimeout(timer);
      pendingAgentRequests.delete(requestId);
      resolve(Array.isArray(agents) ? agents : null);
    });
    try {
      const target = (location.origin && location.origin !== 'null' && location.protocol !== 'file:') ? location.origin : '*';
      window.parent.postMessage({ type: 'qc:request-system-agents', requestId }, target);
    } catch (e) {
      clearTimeout(timer);
      pendingAgentRequests.delete(requestId);
      resolve(null);
    }
  });
}

async function loadSystemAgents() {
  // ۱) درخواست زنده از سامانه والد (هم در Node/Offline و هم در Google Apps Script)
  const fromParent = await requestAgentsFromParent();
  if (Array.isArray(fromParent) && fromParent.length) {
    cachedSystemAgents = fromParent;
    return fromParent;
  }
  // ۲) خواندن مستقیم از والد هم‌دامنه (در صورت باز بودن داخل iframe هم‌ریشه)
  try {
    if (window.parent && window.parent !== window && window.parent.App && window.parent.App.state && Array.isArray(window.parent.App.state.agents)) {
      if (window.parent.App.state.agents.length) {
        cachedSystemAgents = window.parent.App.state.agents;
        return cachedSystemAgents;
      }
    }
  } catch (e) {}
  // ۳) درخواست مستقیم به /api/agents (وقتی گزارش تماس در تب جدید سرور Node باز شده باشد)
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const token = readStoredAuthToken();
      const headers = token ? { 'x-qc-token': token } : undefined;
      const res = await fetch('/api/agents', { headers });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          cachedSystemAgents = list;
          return list;
        }
      }
    } catch (e) {}
  }
  // ۴) کش دریافتی از والد یا تزریق اولیه Apps Script
  if (Array.isArray(cachedSystemAgents)) return cachedSystemAgents;
  if (Array.isArray(window.__QC_SYSTEM_AGENTS__)) return window.__QC_SYSTEM_AGENTS__;
  if (Array.isArray(fromParent)) return fromParent;
  return null;
}

window.QCSystemAgents = {
  load: loadSystemAgents,
  getCached: () => cachedSystemAgents
};

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data) return;
  if (location.protocol !== 'file:' && location.origin !== 'null' && event.origin !== location.origin) return;
  if (event.data.type === 'crmqc:theme') {
    const isLight = event.data.theme === 'light';
    document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
    const ink = isLight ? '#1c2c42' : '#ffffff';
    const grid = isLight ? '#dce6f1' : '#334155';
    const border = isLight ? '#ffffff' : '#1e2937';
    if (typeof avgDurationChart !== 'undefined' && avgDurationChart && avgDurationChart.options) {
      if (avgDurationChart.data && avgDurationChart.data.datasets && avgDurationChart.data.datasets[0]) avgDurationChart.data.datasets[0].borderColor = border;
      if (avgDurationChart.options.plugins && avgDurationChart.options.plugins.legend && avgDurationChart.options.plugins.legend.labels) avgDurationChart.options.plugins.legend.labels.color = ink;
      avgDurationChart.update('none');
    }
    if (typeof lineChart !== 'undefined' && lineChart && lineChart.options) {
      const sc = lineChart.options.scales || {};
      if (sc.x && sc.x.ticks) sc.x.ticks.color = ink;
      if (sc.x && sc.x.grid) sc.x.grid.color = grid;
      if (sc.y && sc.y.ticks) sc.y.ticks.color = ink;
      if (sc.y && sc.y.grid) sc.y.grid.color = grid;
      if (lineChart.options.plugins && lineChart.options.plugins.legend && lineChart.options.plugins.legend.labels) lineChart.options.plugins.legend.labels.color = ink;
      lineChart.update('none');
    }
    return;
  }
  if (event.data.type === 'crmqc:date-range') { apply(event.data.range || {}); return; }
  if (event.data.type === 'crmqc:system-agents' && Array.isArray(event.data.agents)) {
    cachedSystemAgents = event.data.agents;
    const reqId = event.data.requestId;
    if (reqId && pendingAgentRequests.has(reqId)) {
      pendingAgentRequests.get(reqId)(event.data.agents);
    } else if (pendingAgentRequests.size) {
      pendingAgentRequests.forEach((fn) => fn(event.data.agents));
    }
  }
});
window.addEventListener('DOMContentLoaded', () => apply(sourceRange));
/* در حالت جاسازی‌شده (iframe داخلی سامانه) نشانی، search ندارد؛ پارامترها از
 * همین متغیر خوانده می‌شوند تا بازه/تم اولیه هم منتقل شود. */
const query = new URLSearchParams(window.__QC_CALL_REPORT_PARAMS__ || location.search);
document.documentElement.dataset.theme=query.get('qcTheme') === 'light' ? 'light' : 'dark';
apply({ from: query.get('qcFrom') || '', to: query.get('qcTo') || '' });
})();
