/* ritStats.js — داشبورد آمار ریت کارشناسان کیوسی بر اساس فایل‌های آپلودشده
 *
 * تركیب صفحه:
 *  - فیلترها + بازه‌ی تاریخ در بالای صفحه (فیلتر تاریخ در سطر فیلترها، در ترتیب از→تا)
 *  - جدول پيورگ «تفکیک ریت»: ردیف‌ها = کارشناسان فروش (عمودی)،
 *    ستون‌ها = کارشناسان کیوسی (افقی)، هر سلول = تعداد ریت (تماس/تیکت/سوشال/پيورگ)
 *    که از هر کارشناس فروش توسط هر کارشناس کیوسی در بازه انتخاب‌شده داده شده.
 *    بالای جدول فیلتر کارشناس کیوسی قرار دارد.
 *    کلیک بر روی هر نام یا عدد، پاپ‌اپ دیتای اکسل با تمام ستون‌ها (با فرمت‌بندی
 *    درست تاریخ و اعداد و fallback در صورت عدم تطبیق فیلترها) را باز می‌کند.
 *  - نمودارها: تفکیک ریت بر اساس کارشناس (تنها کارشناسان ریت‌ده) بر اساس كانال،
 *    و جمع ریت بر اساس تیم.
 *  - جدول «فهرست تمام کارشناسان»: همه‌ی کارشناسان فروش به‌همراه آن‌هایی که در
 *    بازه ریت نکرده‌اند (ریت صفر)، با ستون‌های تماس/تیکت/سوشال/پيورگ و فیلتر تیم
 *    برای بررسی.
 *  - دکمه «تارگت ماهانه تیم‌ها» در بالای صفحه → پاپ‌اپ معیار تارگت.
 *  - بخش «مرکز دیتا — فایل‌های آپلودشده» از این صفحه حذف شده (در تب مرکز داده قرار دارد).
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, toast, emptyState } = UI;

/* فيلد تاريخ (از/تا) را مستقیم در container قرار می‌دهد؛ container معمولاً
 * یک slot با display:contents است تا دو infield در سطر فیلترها و در ترتیب از→تا
 * کنار فیلترهای دیگر قرار گیرند. */
function datePair(container, onChange) {
  const fromF = UI.dateField({ label: 'از تاریخ', name: 'from', value: '' });
  const toF = UI.dateField({ label: 'تا تاریخ', name: 'to', value: '' });
  container.appendChild(fromF);
  container.appendChild(toF);
  const inputs = $$('input', container);
  inputs.forEach((inp) => inp.addEventListener('change', onChange));
  const wrap = {
    getFrom: () => $('input[name="from"]', container).value.trim(),
    getTo: () => $('input[name="to"]', container).value.trim(),
    setRange: (from, to) => {
      $('input[name="from"]', container).value = from || '';
      $('input[name="to"]', container).value = to || '';
    }
  };
  return wrap;
}

/* رنگ‌های لبه‌ی نمودار (تکراری) */
const CHART_COLORS = ['#4f9d69', '#5b8def', '#b06fd6', '#e08a3c', '#d9534f', '#3bb4b4',
  '#7b68ee', '#f0ad4e', '#5cb85c', '#6fa8dc', '#cc7a9b', '#8e7cc3', '#5dade2', '#af7aa5'];

/* یک كانال ریت (آیکون + عدد) در قالب یک دانه‌ی رنگی */
function chanSpan(ch, icon, n) {
  return `<span class="rt-pill" data-ch="${ch}" title="${ch === 'tel' ? 'تماس' : ch === 'tic' ? 'تیکت' : ch === 'soc' ? 'سوشال' : 'پيورگ'}"><i class="fa-solid ${icon}"></i>${fa(n)}</span>`;
}

/* نشان‌دهنده‌ی جزئیات ریت (تماس/تیکت/سوشال/پيورگ) در یک سلول */
function channelBreakdown(forms) {
  const parts = [];
  const call = (forms.tele || 0) + (forms.account || 0) + (forms.mlm || 0);
  if (call) parts.push(chanSpan('tel', 'fa-phone', call));
  if (forms.ticket) parts.push(chanSpan('tic', 'fa-ticket', forms.ticket));
  if (forms.social) parts.push(chanSpan('soc', 'fa-comments', forms.social));
  if (forms.pivot) parts.push(chanSpan('piv', 'fa-table', forms.pivot));
  return parts.length ? `<div class="rt-ch">${parts.join('<span class="rt-sep">·</span>')}</div>` : '';
}

/* فرمت‌بندی مقدار یک سلول از دیتای خام اکسل:
 * - تاریخ‌ها (ستون‌های date/تاریخ/review/action/created یا سریال اکسل) → تاریخ جلالی
 * - اعداد → اعداد فارسی
 * - رشته‌های کونتخوش‌دار (مثل "1") → حذف کونتخوش
 */
function fmtCell(h, v) {
  if (v == null || v === '') return '<span class="rt-na">—</span>';
  const isDate = /date|تاریخ|action|review|created/i.test(String(h));
  if (typeof v === 'number') {
    if (isDate) { const j = C.parseDate(v); if (j) return fa(C.formatJalali(j)); }
    return '<span class="rt-num">' + fa(v) + '</span>';
  }
  const s = String(v).trim();
  if (isDate) { const j = C.parseDate(s); if (j) return fa(C.formatJalali(j)); }
  const out = s.replace(/^"+|"+$/g, '').trim();
  if (/^-?\d+(\.\d+)?$/.test(out)) return '<span class="rt-num">' + fa(out) + '</span>';
  return esc(out);
}

App.register('ritstats', {
  title: 'آمار ریت',

  async render(root) {
    const isAdmin = !!(window.QCAuth && window.QCAuth.isAdmin);

    root.innerHTML = `
      <div class="page-head">
        <div class="ph-ic"><i class="fa-solid fa-chart-column"></i></div>
        <div>
          <h2>آمار ریت</h2>
          <p>تفکیک ریت‌های انجام‌شده بر اساس کارشناس فروش × کارشناس کیوسی در بازه انتخاب‌شده</p>
        </div>
        <div class="spacer"></div>
        <div class="stat-strip">
          <span class="ss"><i class="fa-solid fa-phone" style="color:var(--good)"></i><b id="rtCntAll">—</b> کل ریت</span>
          <span class="ss"><i class="fa-solid fa-phone-square" style="color:var(--brand)"></i><b id="rtCntCalls">—</b> ریت تماس</span>
          <span class="ss"><i class="fa-solid fa-ticket" style="color:var(--violet)"></i><b id="rtCntTickets">—</b> ریت تیکت</span>
          <span class="ss"><i class="fa-solid fa-comments" style="color:var(--blue)"></i><b id="rtCntSocials">—</b> ریت سوشال</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="filters plain">
          <div class="field grow-0">
            <label for="rtFiscal">ماه مالی</label>
            <select class="input" id="rtFiscal"><option value="">همه دوره</option></select>
          </div>
          <div class="field grow-0" id="rtRangeSlot"></div>
          <div id="rtTeamSlot"></div>
          <div id="rtQcSlot"></div>
          <button type="button" class="btn primary" id="rtApply"><i class="fa-solid fa-magnifying-glass"></i> اعمال فیلتر</button>
          <button type="button" class="btn soft" id="rtTargetsBtn"><i class="fa-solid fa-bullseye"></i> تارگت ماهانه تیم‌ها</button>
        </div>
        <div class="note" id="rtRangeNote" style="margin-top:10px;display:none"></div>
      </div>

      <div id="rtContent"><div class="loading-page"><div class="spinner"></div><p>در حال دریافت آمار…</p></div></div>
    `;

    /* ---------------- فیلترها ---------------- */
    let months = [];
    const fiscalSel = $('#rtFiscal', root);

    /* فیلتر تاریخ در همان سطر فیلترها و در ترتیب از→تا قرار می‌گیرد */
    const rangePair = datePair($('#rtRangeSlot', root), load);

    const teamMs = UI.multiSelect({
      label: 'تیم', allLabel: 'همه تیم‌ها',
      items: (App.state.teams || []).slice().sort().map((t) => ({ value: t, label: QCParse.displayTeam(t) })),
      onChange: () => load()
    });
    $('#rtTeamSlot', root).replaceWith(teamMs);

    const qcMs = UI.multiSelect({
      label: 'کارشناس کیوسی', allLabel: 'همه کارشناسان',
      items: (App.state.qcAgents || []).slice().sort((a, b) => a.localeCompare(b, 'fa')).map((n) => ({ value: n, label: n })),
      onChange: () => load()
    });
    $('#rtQcSlot', root).replaceWith(qcMs);

    fiscalSel.addEventListener('change', () => {
      const m = months.find((x) => x.id === fiscalSel.value);
      if (m) rangePair.setRange(m.from, m.to);
      load();
    });
    $('#rtApply', root).addEventListener('click', load);
    $('#rtTargetsBtn', root).addEventListener('click', () => openTargetsModal());

    /* ---------------- ماه‌های مالی (۲۰ → ۱۹) ---------------- */
    try {
      const fm = await api.get('/api/rit/fiscal');
      months = (fm && fm.months) || [];
      fiscalSel.innerHTML = `<option value="">همه دوره</option>` + months.map((m) =>
        `<option value="${esc(m.id)}">${esc(m.name)} — ${esc(m.from)} تا ${esc(m.to)}</option>`).join('');
    } catch (e) {
      toast.error('خطا در بارگذاری ماه‌های مالی: ' + e.message);
    }

    /* ---------------- آمار ریت ---------------- */
    const cont = $('#rtContent', root);
    let loadId = 0;
    let teamChart = null;
    let agentChart = null;

    function currentRange() {
      return { from: rangePair.getFrom(), to: rangePair.getTo() };
    }

    function rangeText() {
      const r = currentRange();
      if (r.from && r.to) return fa(r.from) + ' تا ' + fa(r.to);
      if (r.from) return fa(r.from) + ' تا …';
      if (r.to) return '… تا ' + fa(r.to);
      return 'همه تاریخ‌ها';
    }

    function teamOf(name) {
      const a = (App.state.agents || []).find((x) => x.name === name);
      return a ? a.team : '';
    }

    async function load() {
      const request = ++loadId;
      const r = currentRange();
      const noteEl = $('#rtRangeNote', root);
      noteEl.style.display = '';
      noteEl.innerHTML = `<i class="fa-regular fa-calendar-days"></i> بازه‌ی قابل‌احتساب: <b>${esc(rangeText())}</b>`;
      const teamSel = teamMs.getValues();
      const qcSel = qcMs.getValues();
      let d;
      try {
        const qs = [];
        if (r.from) qs.push('from=' + encodeURIComponent(r.from));
        if (r.to) qs.push('to=' + encodeURIComponent(r.to));
        if (teamSel.length) qs.push('team=' + encodeURIComponent(teamSel.join(',')));
        if (qcSel.length) qs.push('qc=' + encodeURIComponent(qcSel.join(',')));
        d = await api.get('/api/rit/stats' + (qs.length ? '?' + qs.join('&') : ''));
        if (request !== loadId || !cont.isConnected) return;
      } catch (e) {
        if (request !== loadId || !cont.isConnected) return;
        cont.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا', e.message)}</div>`;
        return;
      }

      $('#rtCntAll').textContent = fa(d.totals.all);
      $('#rtCntCalls').textContent = fa(d.totals.calls);
      $('#rtCntTickets').textContent = fa(d.totals.tickets);
      $('#rtCntSocials').textContent = fa(d.totals.socials);

      /* نمودارهای پیشین را پیش از رندر جدید نابود کن */
      if (teamChart) { try { teamChart.destroy(); } catch (e) {} teamChart = null; }
      if (agentChart) { try { agentChart.destroy(); } catch (e) {} agentChart = null; }

      if (!d.totals.all) {
        cont.innerHTML = `<div class="card">${emptyState('fa-inbox', 'بدون ریت در این بازه',
          'در بازه‌ی انتخابی هیچ ریت‌ی ثبت نشده است. بازه‌ی زمانی را تغییر دهید یا فایل‌های اکسل را آپلود کنید.')}</div>`;
        return;
      }

      /* ------- matrix پيورگ: کارشناس فروش × کارشناس کیوسی ------- */
      const qcCols = (d.experts || []).map((ex) => ex.qc);
      const agentRows = (d.agentTotals || []).slice();
      const matrix = {};
      (d.experts || []).forEach((ex) => {
        (ex.byAgent || []).forEach((ag) => {
          matrix[ag.agent] = matrix[ag.agent] || {};
          matrix[ag.agent][ex.qc] = { total: ag.total, forms: ag.forms };
        });
      });

      /* درزه‌های ریت هر کارشناس فروش (برابر مجموعِ تمام کارشناسان کیوسی) */
      const agentForms = {};
      (d.experts || []).forEach((ex) => {
        (ex.byAgent || []).forEach((ag) => {
          agentForms[ag.agent] = agentForms[ag.agent] || {};
          Object.keys(ag.forms || {}).forEach((f) => {
            agentForms[ag.agent][f] = (agentForms[ag.agent][f] || 0) + (ag.forms[f] || 0);
          });
        });
      });

      /* کارشناسانی که ریت کرده‌اند (تنها برای نمودار) */
      const ritsOnly = agentRows.filter((a) => (a.total || 0) > 0);

      /* ------- کارت جدول پيورگ با فیلتر کارشناس کیوسی ------- */
      const pivotCard = `
        <div class="card">
          <div class="card-head">
            <div class="head-icon"><i class="fa-solid fa-table-cells"></i></div>
            <div><h3>تفکیک ریت</h3>
            <div class="sub">ردیف‌ها = کارشناسان فروش، ستون‌ها = کارشناسان کیوسی؛ کلیک بر هر نام یا عدد، دیتای اکسل ریت‌های دقیق را باز می‌کند</div></div>
            <div class="spacer"></div>
            <div class="field grow-0">
              <label for="rtQcFilter">فیلتر کارشناس کیوسی</label>
              <select class="input" id="rtQcFilter"><option value="">همه کارشناسان کیوسی</option>${qcCols.map((qc) => {
                const ex = d.experts.find((x) => x.qc === qc);
                return `<option value="${esc(qc)}">${esc(qc)} — ${fa(ex ? ex.total : 0)}</option>`;
              }).join('')}</select>
            </div>
          </div>
          ${renderPivot(d, agentRows, matrix, qcCols)}
        </div>`;

      /* ------- نمودارها ------- */
      const chartCard = renderCharts(d, ritsOnly);

      /* ------- جدول تمام کارشناسان ------- */
      const allCard = renderAgentsCard(d, agentRows, agentForms, teamSel, r);

      cont.innerHTML = pivotCard + chartCard + allCard;

      /* فیلتر کارشناس کیوسی روی جدول پيورگ (بدون بازبارگذاری کل صفحه) */
      $('#rtQcFilter', cont).addEventListener('change', () => {
        const qc = $('#rtQcFilter', cont).value;
        const slot = $('#rtPivotSlot', cont);
        if (slot) {
          slot.innerHTML = renderPivot(d, agentRows, matrix, qc ? [qc] : qcCols);
          /* بازهم bind کلیک‌ها روی سلول‌ها و نام‌های جدید */
          $$('.rt-cell, .rt-agent', slot).forEach((btn) => {
            btn.addEventListener('click', () => openDrill(btn.dataset.qc || '', btn.dataset.agent || '', r));
          });
        }
      });

      /* فیلتر تیم روی جدول تمام کارشناسان */
      $('#rtAgentsTeam', cont).addEventListener('change', () => {
        const tm = $('#rtAgentsTeam', cont).value;
        const body = $('#rtAgentsBody', cont);
        if (body) {
          $$('tr[data-team]', body).forEach((tr) => {
            tr.style.display = (!tm || tr.dataset.team === tm) ? '' : 'none';
          });
        }
      });

      /* کلیک‌ها روی سلول‌ها و نام‌ها → پاپ‌آپ دیتای اکسل */
      $$('.rt-cell, .rt-agent', cont).forEach((btn) => {
        btn.addEventListener('click', () => openDrill(btn.dataset.qc || '', btn.dataset.agent || '', r));
      });

      /* ساخت نمودارها روی canvas که در DOM قرار گرفته */
      const canvasAgent = $('#rtAgentChart', cont);
      const canvasTeam = $('#rtTeamChart', cont);
      if (canvasAgent && typeof Chart === 'function' && ritsOnly.length) {
        agentChart = buildAgentChart(canvasAgent, d, ritsOnly);
      }
      if (canvasTeam && typeof Chart === 'function') {
        teamChart = buildTeamChart(canvasTeam, d);
      }
    }

    /* ------- رندر جدول پيورگ (با فیلتر workشناس کیوسی) ------- */
    function renderPivot(d, agentRows, matrix, qcCols) {
      if (!qcCols.length) {
        return `<div id="rtPivotSlot">${emptyState('fa-users', 'بدون کارشناس کیوسی', 'در این بازه هیچ کارشناس کیوسی‌ای ریت نکرده است.')}</div>`;
      }
      const qcHeader = qcCols.map((qc) => {
        const ex = d.experts.find((x) => x.qc === qc);
        return `<th class="rt-qc-th" title="${esc(qc)} — ریت کل: ${fa(ex ? ex.total : 0)}">
          <div class="rt-qc-name">${esc(qc)}</div>
          <div class="rt-col-tot">${fa(ex ? ex.total : 0)}</div></th>`;
      }).join('');

      const bodyRows = agentRows.map((ag) => {
        const cells = qcCols.map((qc) => {
          const cell = matrix[ag.agent] && matrix[ag.agent][qc];
          const n = cell ? cell.total : 0;
          if (!n) return '<td><span class="rt-na">—</span></td>';
          return `<td><button type="button" class="rt-cell" data-qc="${esc(qc)}" data-agent="${esc(ag.agent)}" title="ریت‌های دقیق — ${esc(qc)} → ${esc(ag.agent)}"><span class="rt-n">${fa(n)}</span>${channelBreakdown(cell.forms)}</button></td>`;
        }).join('');
        const rowTot = qcCols.length === 1
          ? (matrix[ag.agent] && matrix[ag.agent][qcCols[0]] ? matrix[ag.agent][qcCols[0]].total : 0)
          : ag.total;
        return `<tr>
          <td class="cell-main"><button type="button" class="rt-agent" data-agent="${esc(ag.agent)}" title="ریت‌های این کارشناس فروش"><b>${esc(ag.agent)}</b></button></td>
          <td><span class="rt-team-badge">${esc(ag.team || teamOf(ag.agent) || '—')}</span></td>
          ${cells}
          <td class="rt-row-tot"><b>${fa(rowTot)}</b></td>
        </tr>`;
      }).join('');

      const totalRow = `<tr>
          <td class="cell-main"><b>جمع</b></td>
          <td></td>
          ${qcCols.map((qc) => {
            const ex = d.experts.find((x) => x.qc === qc);
            return `<td><b>${fa(ex ? ex.total : 0)}</b></td>`;
          }).join('')}
          <td class="rt-row-tot"><b>${fa(qcCols.length === 1 ? (d.experts.find((x) => x.qc === qcCols[0]) || {}).total || 0 : d.totals.all)}</b></td>
        </tr>`;

      return `<div id="rtPivotSlot">
        <div class="table-wrap rt-scroll" style="max-height:60vh"><table class="tbl rt-matrix" style="font-size:12.5px">
          <thead><tr><th style="min-width:150px">کارشناس فروش</th><th style="min-width:90px">تیم</th>${qcHeader}<th style="min-width:70px">جمع</th></tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>${totalRow}</tfoot>
        </table></div>
      </div>`;
    }

    /* ------- کارت نمودارها ------- */
    function renderCharts(d, ritsOnly) {
      const head = `<div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div>
          <div><h3>نمودار‌های آمار ریت</h3>
          <div class="sub">تنها کارشناسان ریت‌ده نمایش داده می‌شوند؛ ریت‌ها بر اساس كانال تفکیک شده‌اند</div></div>`;
      if (!ritsOnly.length) {
        return `<div class="card" style="margin-top:16px">${head}
          ${emptyState('fa-chart-column', 'نمودار آماده نیست', 'برای مشاهده نمودار، بازه‌ی زمانی را گسترده‌تر کنید یا داده‌ی بیشتری آپلود کنید.')}</div>`;
      }
      return `<div class="card" style="margin-top:16px">${head}
        <div style="display:grid;gap:14px">
          <div class="chart-box" style="height:300px"><canvas id="rtAgentChart"></canvas></div>
          <div class="chart-box" style="height:260px"><canvas id="rtTeamChart"></canvas></div>
        </div>
      </div>`;
    }

    /* نمودار تفکیک ریت بر اساس کارشناس (تنها ریت‌ده‌ها) و بر اساس كانال */
    function buildAgentChart(canvas, d, ritsOnly) {
      const sorted = ritsOnly.slice().sort((a, b) => b.total - a.total);
      const channels = [
        { key: 'calls', label: 'تماس', icon: 'fa-phone', color: '#4f9d69',
          pick: (f) => (f.tele || 0) + (f.account || 0) + (f.mlm || 0) },
        { key: 'ticket', label: 'تیکت', icon: 'fa-ticket', color: '#a78bfa',
          pick: (f) => (f.ticket || 0) },
        { key: 'social', label: 'سوشال', icon: 'fa-comments', color: '#60a5fa',
          pick: (f) => (f.social || 0) },
        { key: 'pivot', label: 'پيورگ', icon: 'fa-table', color: '#f59e0b',
          pick: (f) => (f.pivot || 0) }
      ];
      const datasets = channels.map((ch) => ({
        label: ch.label,
        data: sorted.map((a) => {
          const f = (agentFormsOf(d, a.agent)) || {};
          return ch.pick(f);
        }),
        backgroundColor: ch.color,
        borderRadius: 3,
        stack: 'rt'
      }));
      const cfg = {
        type: 'bar',
        data: { labels: sorted.map((a) => a.agent), datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fa(c.parsed.y) } }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 60, minRotation: 35, autoSkip: true, maxTicksLimit: 24 } },
            y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fa(v) } }
          }
        }
      };
      try {
        Chart.defaults.font.family = 'Vazirmatn';
        Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
        if (App.styleChart) App.styleChart(cfg.options);
        return new Chart(canvas, cfg);
      } catch (e) {
        return null;
      }
    }

    /* forms مخزن ریت هر کارشناس فروش برای نمودارها */
    function agentFormsOf(d, agent) {
      const out = {};
      (d.experts || []).forEach((ex) => {
        const ag = (ex.byAgent || []).find((x) => x.agent === agent);
        if (ag) Object.keys(ag.forms || {}).forEach((f) => { out[f] = (out[f] || 0) + (ag.forms[f] || 0); });
      });
      return out;
    }

    /* نمودار جمع ریت بر اساس تیم */
    function buildTeamChart(canvas, d) {
      const teams = (d.teams || []).slice().sort((a, b) => b.total - a.total);
      const cfg = {
        type: 'bar',
        data: {
          labels: teams.map((t) => QCParse.displayTeam(t.team)),
          datasets: [{
            label: 'ریت کل',
            data: teams.map((t) => t.total),
            backgroundColor: CHART_COLORS[0],
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => fa(c.parsed.y) + ' ریت' } }
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: (v) => fa(v) } }
          }
        }
      };
      try {
        Chart.defaults.font.family = 'Vazirmatn';
        Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
        if (App.styleChart) App.styleChart(cfg.options);
        return new Chart(canvas, cfg);
      } catch (e) {
        return null;
      }
    }

    /* ------- کارت جدول تمام کارشناسان (با ریت‌های صفر) ------- */
    function renderAgentsCard(d, agentRows, agentForms, teamSel, range) {
      const seen = new Set();
      const all = [];
      const push = (name, team) => {
        const nm = String(name || '').trim();
        if (!nm || seen.has(nm)) return;
        seen.add(nm);
        all.push({ agent: nm, team: team || '' });
      };
      (App.state.agents || []).forEach((a) => push(a.name, a.team));
      (agentRows || []).forEach((a) => push(a.agent, a.team || teamOf(a.agent)));
      /* در صورت فیلتر تیم در فیلترهای بالای صفحه، فقط تیم‌های انتخاب‌شده نمایش داده می‌شود */
      const wantTeams = teamSel && teamSel.length ? teamSel : null;
      const rows = all.filter((a) => !wantTeams || wantTeams.indexOf(a.team) >= 0)
        .map((a) => {
          const hit = (agentRows || []).find((x) => x.agent === a.agent);
          return {
            agent: a.agent, team: a.team || (hit ? hit.team : ''),
            total: hit ? hit.total : 0,
            forms: agentForms[a.agent] || {}
          };
        })
        .sort((x, y) => y.total - x.total || x.agent.localeCompare(y.agent, 'fa'));

      const callN = (f) => (f.tele || 0) + (f.account || 0) + (f.mlm || 0);
      const cell = (n) => n ? `<td class="rt-num-cell"><b>${fa(n)}</b></td>` : '<td class="rt-num-cell"><span class="rt-na">—</span></td>';

      const body = rows.map((ag) => {
        const zero = !(ag.total > 0);
        const f = ag.forms;
        return `<tr data-team="${esc(ag.team || '')}">
          <td class="cell-main"><button type="button" class="rt-agent" data-agent="${esc(ag.agent)}" title="ریت‌های این کارشناس فروش"><b>${esc(ag.agent)}</b></button>${zero ? '<span class="rt-zero">بدون ریت</span>' : ''}</td>
          <td><span class="rt-team-badge">${esc(ag.team || '—')}</span></td>
          ${cell(callN(f))}
          ${cell(f.ticket || 0)}
          ${cell(f.social || 0)}
          ${cell(f.pivot || 0)}
          <td class="rt-row-tot"><b>${fa(ag.total)}</b></td>
        </tr>`;
      }).join('');

      return `<div class="card" style="margin-top:16px">
        <div class="card-head violet">
          <div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>فهرست تمام کارشناسان</h3>
          <div class="sub">همه‌ی کارشناسان فروش در این بازه — آن‌هایی که ریت نکرده‌اند هم نمایش داده می‌شوند؛ کلیک بر نام، دیتای اکسل را باز می‌کند</div></div>
          <div class="spacer"></div>
          <div class="field grow-0">
            <label for="rtAgentsTeam">فیلتر تیم</label>
            <select class="input" id="rtAgentsTeam"><option value="">همه تیم‌ها</option>${(App.state.teams || []).slice().sort().map((t) => `<option value="${esc(t)}">${esc(QCParse.displayTeam(t))}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap rt-scroll" style="max-height:46vh"><table class="tbl rt-agents" style="font-size:12.5px">
          <thead><tr>
            <th style="min-width:200px">کارشناس فروش</th><th style="min-width:110px">تیم</th>
            <th style="min-width:80px">ریت تماس</th><th style="min-width:80px">ریت تیکت</th>
            <th style="min-width:80px">ریت سوشال</th><th style="min-width:80px">ریت پيورگ</th>
            <th style="min-width:80px">ریت کل</th>
          </tr></thead>
          <tbody id="rtAgentsBody">${body || `<tr><td colspan="7">${esc(emptyState('fa-users', 'بدون کارشناس', 'فهرست کارشناسان خالی است.'))}</td></tr>`}</tbody>
        </table></div>
        <div class="note" style="margin:8px 0 0"><i class="fa-regular fa-calendar-days"></i> بازه: <b>${esc(rangeText())}</b> — گره‌های «بدون ریت» در این بازه ریت ثبت نکرده‌اند</div>
      </div>`;
    }

    /* ---------------- بازکردن دیتای خام اکسل (دقیقاً همان‌طور که آپلود شده) ---------------- */
    async function openDrill(qc, agent, range) {
      const m = UI.modal(`${UI.modalHead('ریت‌های دقیق — ' + (agent || qc || ''), 'fa-file-excel')}
        <div class="modal-body">
          <div class="filters plain" style="margin-bottom:12px">
            <div class="field grow-0"><label>کارشناس کیوسی</label><input class="input" id="drQc" value="${esc(qc)}" placeholder="اختیاری…" autocomplete="off"></div>
            <div class="field grow-0"><label>کارشناس فروش</label><input class="input" id="drAgent" value="${esc(agent)}" placeholder="نام کارشناس فروش…" autocomplete="off"></div>
            <div class="field grow-0"><label>از تاریخ</label><input class="input" id="drFrom" value="${esc(range && range.from || '')}" autocomplete="off" placeholder="1405/07/20"></div>
            <div class="field grow-0"><label>تا تاریخ</label><input class="input" id="drTo" value="${esc(range && range.to || '')}" autocomplete="off" placeholder="1405/08/19"></div>
            <div class="field grow-0"><label>تیم</label>
              <select class="input" id="drTeam"><option value="">همه تیم‌ها</option>${(App.state.teams || []).map((t) => `<option value="${esc(t)}">${esc(QCParse.displayTeam(t))}</option>`).join('')}</select>
            </div>
            <button type="button" class="btn primary" id="drGo"><i class="fa-solid fa-magnifying-glass"></i> فیلتر</button>
          </div>
          <div id="drOut"><div class="loading-page"><div class="spinner"></div></div></div>
        </div>`, { lg: true });

      await fetchRawRows(m, { file: '' });
      $('#drGo', m).addEventListener('click', () => fetchRawRows(m, { file: '' }));
    }

    /* بارگذاری و رندر ردیف‌های خام در یک مودال
     * در صورت خالی‌شدن خروجی، fallback: حذف فیلتر تیم، و در صورت همچنان خالی،
     * حذف فیلترهای کارشناس (فقط بازه‌ی تاریخ) تا دیتای خام همیشه نمایش داده شود. */
    async function fetchRawRows(m, extra) {
      const out = $('#drOut', m);
      const qcv = $('#drQc', m).value.trim();
      const agv = $('#drAgent', m).value.trim();
      const frv = $('#drFrom', m).value.trim();
      const tov = $('#drTo', m).value.trim();
      const tv = $('#drTeam', m).value;
      const mkUrl = (withTeam, withNames) => {
        const qs = [];
        if (extra.file) qs.push('file=' + encodeURIComponent(extra.file));
        if (withNames && qcv) qs.push('qc=' + encodeURIComponent(qcv));
        if (withNames && agv) qs.push('agent=' + encodeURIComponent(agv));
        if (frv) qs.push('from=' + encodeURIComponent(frv));
        if (tov) qs.push('to=' + encodeURIComponent(tov));
        if (withTeam && tv) qs.push('team=' + encodeURIComponent(tv));
        return '/api/rit/rows' + (qs.length ? '?' + qs.join('&') : '');
      };
      try {
        let r = await api.get(mkUrl(true, true));
        let note = '';
        if (!r.rows.length && r.total > 0) {
          /* fallback ۱: بدون فیلتر تیم (مقادیر تیم در اکسل خام ممکن است با سیستم متفاوت باشد) */
          r = await api.get(mkUrl(false, true));
          if (!r.rows.length) {
            /* fallback ۲: فقط بازه‌ی تاریخ */
            r = await api.get(mkUrl(false, false));
            note = 'فیلترِ کارشناس/تیم تطبیق نیافت — همه‌ی ردیف‌های بازه نمایش داده می‌شود';
          } else {
            note = 'فیلتر تیم تطبیق نیافت — نمایش بدون فیلتر تیم';
          }
        }
        if (!out.isConnected) return;
        if (!r.rows.length) {
          out.innerHTML = emptyState('fa-file-circle-x', 'بدون ردیف',
            r.total
              ? 'در مجموع ' + fa(r.total) + ' ردیف اکسل بررسی‌شد؛ فیلترهای دیگری اعمال کنید.'
              : 'ردیفی با این فیلترها در دیتای خام یافت نشد.');
          return;
        }
        const head = (r.headers || []).map((h) => `<th title="${esc(h)}">${esc(h)}</th>`).join('');
        out.innerHTML = `
          ${note ? `<div class="note" style="margin:0 0 8px;color:var(--amber,#f59e0b)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(note)}</div>` : ''}
          <div class="note" style="margin:0 0 8px"><i class="fa-solid fa-table"></i> <b>${fa(r.rows.length)}</b> ردیف نمایش‌داده‌شده از <b>${fa(r.total)}</b> ردیف بررسی‌شده — تمام ستون‌های اکسل اصلی (تاریخ‌ها و اعداد فرمت‌بندی‌شده)</div>
          <div class="table-wrap rt-scroll" style="max-height:52vh"><table class="tbl rt-raw" style="font-size:12px">
            <thead><tr><th style="min-width:50px">ردیف</th><th style="min-width:150px">فایل</th>${head}</tr></thead>
            <tbody>${r.rows.map((row) => `<tr>
              <td style="color:var(--muted)">${row.row}</td>
              <td style="color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(row.file)}">${esc(row.file)}</td>
              ${(r.headers || []).map((h) => `<td>${fmtCell(h, row.cells[h])}</td>`).join('')}
            </tr>`).join('')}</tbody>
          </table></div>`;
      } catch (e) {
        if (out.isConnected) out.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
      }
    }

    /* ---------------- تارگت‌های ماهانه تیم‌ها (در پاپ‌اپ) ---------------- */
    function targetsTable(list) {
      return `
        <div class="table-wrap rt-scroll" style="max-height:44vh">
          <table class="tbl">
            <thead><tr><th>تیم</th><th>ماه مالی</th><th>تارگت (ریت)</th><th>انجام‌شده</th><th style="width:200px">پیشرفت</th><th>توضیح</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>${list.map((row) => {
              const done = row.actual != null ? row.actual : 0;
              const pct = row.pct != null ? row.pct : 0;
              const cls = pct >= 100 ? 'good' : (pct >= 60 ? 'amber' : 'bad');
              return `<tr>
                <td class="cell-main">${esc(row.team)}</td>
                <td>${esc(row.month)}</td>
                <td>${fa(row.target)}</td>
                <td><b>${fa(done)}</b></td>
                <td><div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div><small>${pct}٪</small></div></td>
                <td style="color:var(--muted);font-size:12px">${esc(row.note || '—')}</td>
                ${isAdmin ? `<td><button type="button" class="btn danger-soft sm" data-del-target="${esc(row.id)}" title="حذف تارگت"><i class="fa-solid fa-trash-can"></i></button></td>` : ''}
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
    }

    function targetsForm() {
      return `
        <div class="filters plain" style="margin-top:14px;align-items:flex-end">
          <div class="field grow-0"><label for="tgTeam">تیم</label>
            <select class="input" id="tgTeam"><option value="">انتخاب تیم…</option>${(App.state.teams || []).map((tm) => `<option value="${esc(tm)}">${esc(QCParse.displayTeam(tm))}</option>`).join('')}</select>
          </div>
          <div class="field grow-0"><label for="tgMonth">ماه مالی</label>
            <select class="input" id="tgMonth"><option value="">انتخاب ماه…</option>${months.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>
          </div>
          <div class="field grow-0"><label for="tgTarget">تارگت (تعداد ریت)</label>
            <input class="input" id="tgTarget" inputmode="numeric" placeholder="مثلاً 20" autocomplete="off">
          </div>
          <div class="field grow-1"><label for="tgNote">توضیح (اختیاری)</label>
            <input class="input" id="tgNote" placeholder="مثلاً: تمأكله باید تا پایان ماه ۲۰ ریت داشته باشد" autocomplete="off">
          </div>
          <button type="button" class="btn primary" id="tgSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره تارگت</button>
        </div>`;
    }

    function bindTargets(el) {
      if (!isAdmin) return;
      const save = $('#tgSave', el);
      if (save) {
        save.addEventListener('click', async () => {
          const team = $('#tgTeam', el).value;
          const month = $('#tgMonth', el).value;
          const target = $('#tgTarget', el).value.trim();
          if (!team || !month) return toast.error('تیم و ماه مالی را انتخاب کنید');
          if (!/^\d+$/.test(target)) return toast.error('تارگت باید یک عدد باشد');
          try {
            const out = await api.put('/api/rit/targets', {
              team: team, month: month, target: Number(target),
              note: $('#tgNote', el).value.trim()
            });
            toast.success('تارگت ذخیره شد');
            renderTargetsInto(el, out.targets);
          } catch (e) {
            toast.error('خطا در ذخیره‌ی تارگت: ' + e.message);
          }
        });
      }
      $$('[data-del-target]', el).forEach((b) => b.addEventListener('click', async () => {
        try {
          const out = await api.del('/api/rit/targets/' + encodeURIComponent(b.dataset.delTarget));
          toast.success('تارگت حذف شد');
          renderTargetsInto(el, out.targets);
        } catch (e) {
          toast.error('خطا: ' + e.message);
        }
      }));
    }

    function renderTargetsInto(el, list) {
      /* برای admin: فرم اول، سپس جدول (تا بتوان تارگت جدید افزود بدون اسکرول) */
      el.innerHTML = (isAdmin ? targetsForm() : '') +
        (list.length
          ? targetsTable(list)
          : emptyState('fa-bullseye', 'هنوز تارگت تعریف نشده',
              'برای هر تیم و هر ماه مالی، تعداد ریت هدف را تعیین کنید.'));
      bindTargets(el);
    }

    async function openTargetsModal() {
      const m = UI.modal(`${UI.modalHead('معیار تارگت ماهانه تیم‌ها', 'fa-bullseye')}
        <div class="modal-body">
          <div class="sub" style="margin:0 0 12px">تماس + سوشال + تیکت ترکیب‌شده؛ هر ماه مالی قابل تنظیم است</div>
          <div id="rtTargetsM"><div class="loading-page"><div class="spinner"></div></div></div>
        </div>`, { lg: true });
      await loadTargetsInto($('#rtTargetsM', m));
    }

    async function loadTargetsInto(el) {
      try {
        const t = await api.get('/api/rit/targets');
        renderTargetsInto(el, (t && t.targets) || []);
      } catch (e) {
        el.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
      }
    }

    /* ---------------- شروع ---------------- */
    await load();
  }
});
})();
