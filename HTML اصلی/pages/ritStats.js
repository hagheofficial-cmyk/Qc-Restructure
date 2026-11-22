/* ritStats.js — داشبورد آمار ریت کارشناسان کیوسی بر اساس فایل‌های آپلودشده
 *
 * تركیب صفحه:
 *  - فیلترها + بازه‌ی تاریخ در بالای صفحه
 *  - جدول پيورگ «تفکیک ریت — روبردار»: ردیف‌ها = کارشناسان فروش (عمودی)،
 *    ستون‌ها = کارشناسان کیوسی (افقی)، هر سلول = تعداد ریت (تماس/تیکت/سوشال)
 *    که از هر کارشناس فروش توسط هر کارشناس کیوسی در بازه انتخاب‌شده داده شده.
 *    کلیک بر روی هر نام یا عدد، پاپ‌اپ دیتای اکسل با تمام ستون‌ها (با فرمت‌بندی
 *    درست تاریخ و اعداد) را باز می‌کند.
 *  - نمودار: هر تیم را به کارشناسانش تفکیک کرده و فقط کارشناسانی که ریت کرده‌اند
 *    و تعداد ریت هر کارشناس را نشان می‌دهد.
 *  - جدول «فهرست تمام کارشناسان»: همه‌ی کارشناسان فروش به‌همراه آن‌هایی که در
 *    بازه ریت نکرده‌اند (ریت صفر) برای بررسی.
 *  - دکمه «تارگت ماهانه تیم‌ها» در بالای صفحه → پاپ‌اپ معیار تارگت.
 *  - بخش «مرکز دیتا — فایل‌های آپلودشده» از این صفحه حذف شده (در تب مرکز داده قرار دارد).
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, toast, emptyState } = UI;

/* فيلد تاريخ (از/تا) در یک بلوک می‌گذارد و بر اساس تغییر آن callback می‌دهد */
function datePair(onChange) {
  const fromF = UI.dateField({ label: 'از تاریخ', name: 'from', value: '' });
  const toF = UI.dateField({ label: 'تا تاریخ', name: 'to', value: '' });
  const wrap = document.createElement('div');
  wrap.className = 'rt-date-pair';
  wrap.appendChild(fromF);
  wrap.appendChild(toF);
  const inputs = $$('input', wrap);
  inputs.forEach((inp) => inp.addEventListener('change', onChange));
  wrap.getFrom = () => $('input', fromF).value.trim();
  wrap.getTo = () => $('input', toF).value.trim();
  wrap.setRange = (from, to) => {
    $('input', fromF).value = from || '';
    $('input', toF).value = to || '';
  };
  return wrap;
}

/* رنگ‌های لبه‌ی نمودار (تکراری) */
const CHART_COLORS = ['#4f9d69', '#5b8def', '#b06fd6', '#e08a3c', '#d9534f', '#3bb4b4',
  '#7b68ee', '#f0ad4e', '#5cb85c', '#6fa8dc', '#cc7a9b', '#8e7cc3', '#5dade2', '#af7aa5'];

/* نشان‌دهنده‌ی جزئیات ریت (تماس/تیکت/سوشال/پيورگ) در یک سلول */
function channelBreakdown(forms) {
  const parts = [];
  const call = (forms.tele || 0) + (forms.account || 0) + (forms.mlm || 0);
  if (call) parts.push(`<i class="fa-solid fa-phone" data-ch="tel" title="تماس (${fa(call)})">${fa(call)}</i>`);
  if (forms.ticket) parts.push(`<i class="fa-solid fa-ticket" data-ch="tic" title="تیکت (${fa(forms.ticket)})">${fa(forms.ticket)}</i>`);
  if (forms.social) parts.push(`<i class="fa-solid fa-comments" data-ch="soc" title="سوشال (${fa(forms.social)})">${fa(forms.social)}</i>`);
  if (forms.pivot) parts.push(`<i class="fa-solid fa-table" data-ch="piv" title="پيورگ (${fa(forms.pivot)})">${fa(forms.pivot)}</i>`);
  return parts.length ? `<div class="rt-ch">${parts.join('')}</div>` : '';
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

    const rangePair = datePair(load);
    $('#rtRangeSlot', root).replaceWith(rangePair);

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

      /* نمودار پیشین را پیش از رندر جدید نابود کن */
      if (teamChart) { try { teamChart.destroy(); } catch (e) {} teamChart = null; }

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

      const qcHeader = qcCols.length
        ? qcCols.map((qc) => {
          const ex = d.experts.find((x) => x.qc === qc);
          return `<th class="rt-qc-th" title="${esc(qc)} — ریت کل: ${fa(ex ? ex.total : 0)}">
            <div class="rt-qc-name">${esc(qc)}</div>
            <div class="rt-col-tot">${fa(ex ? ex.total : 0)}</div></th>`;
        }).join('')
        : '';

      const bodyRows = agentRows.map((ag) => {
        const cells = qcCols.map((qc) => {
          const cell = matrix[ag.agent] && matrix[ag.agent][qc];
          const n = cell ? cell.total : 0;
          if (!n) return '<td><span class="rt-na">—</span></td>';
          return `<td><button type="button" class="rt-cell" data-qc="${esc(qc)}" data-agent="${esc(ag.agent)}" title="ریت‌های دقیق — ${esc(qc)} → ${esc(ag.agent)}"><span class="rt-n">${fa(n)}</span>${channelBreakdown(cell.forms)}</button></td>`;
        }).join('');
        return `<tr>
          <td class="cell-main"><button type="button" class="rt-agent" data-agent="${esc(ag.agent)}" title="ریت‌های این کارشناس فروش"><b>${esc(ag.agent)}</b></button></td>
          <td><span class="rt-team-badge">${esc(ag.team || teamOf(ag.agent) || '—')}</span></td>
          ${cells}
          <td class="rt-row-tot"><b>${fa(ag.total)}</b></td>
        </tr>`;
      }).join('');

      const totalRow = qcCols.length ? `<tr>
          <td class="cell-main"><b>جمع</b></td>
          <td></td>
          ${qcCols.map((qc) => {
            const ex = d.experts.find((x) => x.qc === qc);
            return `<td><b>${fa(ex ? ex.total : 0)}</b></td>`;
          }).join('')}
          <td class="rt-row-tot"><b>${fa(d.totals.all)}</b></td>
        </tr>` : '';

      const pivot = qcCols.length
        ? `<div class="table-wrap rt-scroll" style="max-height:60vh"><table class="tbl rt-matrix" style="font-size:12.5px">
            <thead><tr><th style="min-width:150px">کارشناس فروش</th><th style="min-width:90px">تیم</th>${qcHeader}<th style="min-width:70px">جمع</th></tr></thead>
            <tbody>${bodyRows}</tbody>
            ${totalRow ? `<tfoot>${totalRow}</tfoot>` : ''}
          </table></div>`
        : emptyState('fa-users', 'بدون کارشناس کیوسی', 'در این بازه هیچ کارشناس کیوسی‌ای ریت نکرده است.');

      /* ------- جدول تمام کارشناسان (با ریت‌های صفر) ------- */
      const allCard = renderAgentsCard(d, agentRows, agentForms, teamSel, r);

      /* ------- نمودار: هر تیم به کارشناسانش تفکیک می‌شود ------- */
      const chartCard = renderTeamChart(d, ritsOnly);

      cont.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-table-cells"></i></div>
            <div><h3>تفکیک ریت — روبردار</h3>
            <div class="sub">رفتن روی هر نام یا شمارش، دیتای اکسل ریت‌های دقیق آن کارشناس فروش × کارشناس کیوسی را باز می‌کند</div></div>
          </div>
          ${pivot}
        </div>
        ${chartCard}
        ${allCard}`;

      $$('.rt-cell, .rt-agent', cont).forEach((btn) => {
        btn.addEventListener('click', () => openDrill(btn.dataset.qc || '', btn.dataset.agent || '', r));
      });

      /* ساخت نمودار روی canvas که در DOM قرار گرفته */
      const canvas = $('#rtTeamChart', cont);
      if (canvas && typeof Chart === 'function' && ritsOnly.length) {
        teamChart = buildTeamChart(canvas, d, ritsOnly);
      }
    }

    /* ------- کارت جدول تمام کارشناسان (به‌همراه ریت‌های صفر) ------- */
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
      /* در صورت فیلتر تیم، فقط تیم‌های انتخاب‌شده نمایش داده می‌شود */
      const wantTeams = teamSel && teamSel.length ? teamSel : null;
      const rows = all.filter((a) => !wantTeams || wantTeams.indexOf(a.team) >= 0)
        .map((a) => {
          const hit = (agentRows || []).find((x) => x.agent === a.agent);
          return { agent: a.agent, team: a.team || (hit ? hit.team : ''), total: hit ? hit.total : 0, forms: agentForms[a.agent] || {} };
        })
        .sort((x, y) => y.total - x.total || x.agent.localeCompare(y.agent, 'fa'));

      const body = rows.map((ag) => {
        const zero = !(ag.total > 0);
        return `<tr>
          <td class="cell-main"><button type="button" class="rt-agent" data-agent="${esc(ag.agent)}" title="ریت‌های این کارشناس فروش"><b>${esc(ag.agent)}</b></button>${zero ? '<span class="rt-zero">بدون ریت</span>' : ''}</td>
          <td><span class="rt-team-badge">${esc(ag.team || '—')}</span></td>
          <td class="rt-row-tot"><b>${fa(ag.total)}</b></td>
          <td>${channelBreakdown(ag.forms)}</td>
        </tr>`;
      }).join('');

      return `<div class="card" style="margin-top:16px">
        <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>فهرست تمام کارشناسان</h3>
          <div class="sub">همه‌ی کارشناسان فروش در این بازه — آن‌هایی که ریت نکرده‌اند هم نمایش داده می‌شوند؛ کلیک بر نام، دیتای اکسل را باز می‌کند</div></div>
        </div>
        <div class="table-wrap rt-scroll" style="max-height:46vh"><table class="tbl rt-agents" style="font-size:12.5px">
          <thead><tr><th style="min-width:200px">کارشناس فروش</th><th style="min-width:110px">تیم</th><th style="min-width:80px">ریت کل</th><th>جزئیات</th></tr></thead>
          <tbody>${body || `<tr><td colspan="4">${esc(emptyState('fa-users', 'بدون کارشناس', 'فهرست کارشناسان خالی است.'))}</td></tr>`}</tbody>
        </table></div>
        <div class="note" style="margin:8px 0 0"><i class="fa-regular fa-calendar-days"></i> بازه: <b>${esc(rangeText())}</b> — گره‌های «بدون ریت» در این بازه ریت ثبت نکرده‌اند</div>
      </div>`;
    }

    /* رندر کارت نمودار (HTML فقط؛ canvas ساخته می‌شود) */
    function renderTeamChart(d, ritsOnly) {
      const teams = (d.teams || []).map((t) => t.team);
      const hasTeam = teams.length > 1 || (teams.length === 1 && ritsOnly.length > 0);
      const head = `<div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div>
          <div><h3>تفکیک ریت بر اساس تیم و کارشناس</h3>
          <div class="sub">هر تیم به کارشناسانش تفکیک شده و تعداد ریت هر کارشناس نمایش داده می‌شود (فقط کارشناسان ریت‌ده نمایش داده می‌شوند)</div></div>`;
      if (!ritsOnly.length || !hasTeam) {
        return `<div class="card" style="margin-top:16px">${head}
          ${emptyState('fa-chart-column', 'نمودار آماده نیست', 'برای مشاهده نمودار، بازه‌ی زمانی را گسترده‌تر کنید یا داده‌ی بیشتری آپلود کنید.')}</div>`;
      }
      return `<div class="card" style="margin-top:16px">${head}
        <div class="chart-box" style="height:340px"><canvas id="rtTeamChart"></canvas></div>
      </div>`;
    }

    /* ساخت Chart.js روی canvas */
    function buildTeamChart(canvas, d, ritsOnly) {
      const teamOrder = (d.teams || []).map((t) => t.team);
      const experts = Array.from(new Set(ritsOnly.map((a) => a.agent)));
      const datasets = experts.map((agent, i) => ({
        label: agent,
        data: teamOrder.map((team) => {
          const a = ritsOnly.find((x) => x.agent === agent && x.team === team);
          return a ? a.total : 0;
        }),
        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        borderRadius: 3,
        stack: 'rt'
      }));
      const cfg = {
        type: 'bar',
        data: { labels: teamOrder, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fa(c.parsed.y) } }
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
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
              <select class="input" id="drTeam"><option value="">همه تیم‌ها</option>${(App.state.teams || []).map((t) => `<option value="${esc(t)}" ${teamOf(agent) === t ? 'selected' : ''}>${esc(QCParse.displayTeam(t))}</option>`).join('')}</select>
            </div>
            <button type="button" class="btn primary" id="drGo"><i class="fa-solid fa-magnifying-glass"></i> فیلتر</button>
          </div>
          <div id="drOut"><div class="loading-page"><div class="spinner"></div></div></div>
        </div>`, { lg: true });

      await fetchRawRows(m, { file: '' });
      $('#drGo', m).addEventListener('click', () => fetchRawRows(m, { file: '' }));
    }

    /* بارگذاری و رندر ردیف‌های خام در یک مودال */
    async function fetchRawRows(m, extra) {
      const out = $('#drOut', m);
      const qcv = $('#drQc', m).value.trim();
      const agv = $('#drAgent', m).value.trim();
      const frv = $('#drFrom', m).value.trim();
      const tov = $('#drTo', m).value.trim();
      const tv = $('#drTeam', m).value;
      const qs = [];
      if (extra.file) qs.push('file=' + encodeURIComponent(extra.file));
      if (qcv) qs.push('qc=' + encodeURIComponent(qcv));
      if (agv) qs.push('agent=' + encodeURIComponent(agv));
      if (frv) qs.push('from=' + encodeURIComponent(frv));
      if (tov) qs.push('to=' + encodeURIComponent(tov));
      if (tv) qs.push('team=' + encodeURIComponent(tv));
      try {
        const r = await api.get('/api/rit/rows' + (qs.length ? '?' + qs.join('&') : ''));
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
