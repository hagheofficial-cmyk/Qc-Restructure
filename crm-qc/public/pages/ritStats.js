/* ritStats.js — داشبورد آمار ریت کارشناسان کیوسی بر اساس فایل‌های آپلودشده */
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

App.register('ritstats', {
  title: 'آمار ریت',

  async render(root) {
    const isAdmin = !!(window.QCAuth && window.QCAuth.isAdmin);

    root.innerHTML = `
      <div class="page-head">
        <div class="ph-ic"><i class="fa-solid fa-chart-column"></i></div>
        <div>
          <h2>آمار ریت</h2>
          <p>شمارنده‌ی ریت‌های انجام‌شده بر اساس کارشناس کیوسی از فایل‌های آپلودشده + معیار تارگت ماهانه تیم‌ها</p>
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
        </div>
        <div class="note" id="rtRangeNote" style="margin-top:10px;display:none"></div>
      </div>

      <div id="rtContent"><div class="loading-page"><div class="spinner"></div><p>در حال دریافت آمار…</p></div></div>

      <div class="card" style="margin-top:16px">
        <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-bullseye"></i></div>
          <div><h3>معیار تارگت ماهانه تیم‌ها</h3><div class="sub">تماس + سوشال + تیکت ترکیب‌شده؛ هر ماه مالی قابل تنظیم است</div></div>
        </div>
        <div id="rtTargets"><div class="loading-page"><div class="spinner"></div></div></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><div class="head-icon" style="background:var(--blue-soft);color:var(--blue)"><i class="fa-solid fa-database"></i></div>
          <div><h3>مرکز دیتا — فایل‌های آپلودشده</h3><div class="sub">فیلتر و مرتب‌سازی بر اساس بازه‌ی تاریخ، تیم و نام فایل</div></div>
        </div>
        <div class="filters plain" style="margin-bottom:12px">
          <div class="field grow-0" id="rtFileRangeSlot"></div>
          <div id="rtFileTeamSlot"></div>
          <div class="field grow-1">
            <label for="rtFileQ">جستجو در نام فایل</label>
            <input class="input" id="rtFileQ" placeholder="نام فایل…" autocomplete="off">
          </div>
        </div>
        <div id="rtFiles"><div class="loading-page"><div class="spinner"></div></div></div>
      </div>
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

    const fileTeamMs = UI.multiSelect({
      label: 'تیم (مرکز دیتا)', allLabel: 'همه تیم‌ها',
      items: (App.state.teams || []).slice().sort().map((t) => ({ value: t, label: QCParse.displayTeam(t) })),
      onChange: () => loadFiles()
    });
    $('#rtFileTeamSlot', root).replaceWith(fileTeamMs);

    const fileRangePair = datePair(loadFiles);
    $('#rtFileRangeSlot', root).replaceWith(fileRangePair);

    fiscalSel.addEventListener('change', () => {
      const m = months.find((x) => x.id === fiscalSel.value);
      if (m) rangePair.setRange(m.from, m.to);
      load();
    });
    $('#rtApply', root).addEventListener('click', load);
    const qDebounced = UI.debounce(() => loadFiles(), 350);
    $('#rtFileQ', root).addEventListener('input', qDebounced);

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

      if (!d.totals.all) {
        cont.innerHTML = `<div class="card">${emptyState('fa-inbox', 'بدون ریت در این بازه',
          'در بازه‌ی انتخابی هیچ ریت‌ی ثبت نشده است. بازه‌ی زمانی را تغییر دهید یا فایل‌های اکسل را آپلود کنید.')}</div>`;
        return;
      }

      const agents = d.agents || [];
      const teamOf = (name) => {
        const a = (App.state.agents || []).find((x) => x.name === name);
        return a ? a.team : '';
      };

      /* پيورگ: کارشناسان کیوسی × کارشناسان فروش */
      const pivot = agents.length
        ? `<div class="table-wrap"><table class="tbl" style="font-size:12.5px">
            <thead><tr><th style="min-width:150px">کارشناس کیوسی</th>${agents.map((a) =>
              `<th style="min-width:64px;text-align:center" title="${esc(a.agent)} — ${esc(a.team || teamOf(a.agent) || '')}">${esc(a.agent)}</th>`).join('')}<th style="min-width:70px">جمع</th></tr></thead>
            <tbody>${d.experts.map((ex) => {
              const byAgent = new Map();
              (ex.byAgent || []).forEach((ag) => byAgent.set(ag.agent, ag));
              return `<tr>
                <td class="cell-main"><b>${esc(ex.qc)}</b><br><small style="color:var(--muted)">ریت کل: ${fa(ex.total)}</small></td>
                ${agents.map((a) => {
                  const ag = byAgent.get(a.agent);
                  const n = ag ? ag.total : 0;
                  return `<td style="text-align:center">${n ? `<button type="button" class="rt-cell" data-qc="${esc(ex.qc)}" data-agent="${esc(a.agent)}" title="بازکردن ریت‌های دقیق"><b>${fa(n)}</b></button>` : '<span style="color:var(--muted)">—</span>'}</td>`;
                }).join('')}
                <td style="text-align:center"><b>${fa(ex.total)}</b></td>
              </tr>`;
            }).join('')}</tbody></table></div>`
        : emptyState('fa-users', 'بدون کارشناس فروش', '');

      /* جدول تفکیک‌شده برای کارشناس کیوسی انتخاب‌شده */
      let detail = '';
      const selQc = qcSel[0] || (d.experts[0] && d.experts[0].qc) || '';
      const ex = d.experts.find((x) => x.qc === selQc);
      if (ex) {
        detail = `
          <div class="card" style="margin-top:16px">
            <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
              <div><h3>تفکیک ریت — ${esc(ex.qc)}</h3><div class="sub">تعداد فرم هر کارشناس فروش و فایل‌های منبع</div></div>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>کارشناس فروش</th><th>تیم</th><th>ریت کل</th><th>تماس</th><th>اکانت</th><th>MLM</th><th>تیکت</th><th>سوشال</th><th>فایل‌های منبع</th><th></th></tr></thead>
                <tbody>${ex.byAgent.map((ag) => `<tr>
                  <td class="cell-main">${esc(ag.agent)}</td>
                  <td>${esc(ag.team || teamOf(ag.agent) || '—')}</td>
                  <td><b>${fa(ag.total)}</b></td>
                  <td>${ag.forms.tele || 0}</td>
                  <td>${ag.forms.account || 0}</td>
                  <td>${ag.forms.mlm || 0}</td>
                  <td>${ag.forms.ticket || 0}</td>
                  <td>${ag.forms.social || 0}</td>
                  <td style="font-size:11.5px;color:var(--muted)">${(ag.files || []).map((f) => esc(f.file) + ' (' + fa(f.count) + ')').join('، ') || '—'}</td>
                  <td><button type="button" class="btn soft sm rt-open" data-qc="${esc(ex.qc)}" data-agent="${esc(ag.agent)}"><i class="fa-solid fa-table"></i> بازکردن</button></td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>`;
      }

      cont.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-table-cells"></i></div>
            <div><h3>ریت بر اساس کارشناس کیوسی و کارشناس فروش</h3>
            <div class="sub">رفتن روی هر شمارش، ریت‌های دقیق آن کارشناس کیوسی و کارشناس فروش را باز می‌کند</div></div>
          </div>
          ${pivot}
        </div>
        ${detail}`;

      $$('.rt-cell, .rt-open', cont).forEach((btn) => {
        btn.addEventListener('click', () => openDrill(btn.dataset.qc, btn.dataset.agent || '', r));
      });
    }

    /* ---------------- بازکردن دیتای خام اکسل (دقیقاً همان‌طور که آپلود شده) ---------------- */
    async function openDrill(qc, agent, range) {
      const m = UI.modal(`${UI.modalHead('ریت‌های دقیق — ' + qc + (agent ? ' / ' + agent : ''), 'fa-file-excel')}
        <div class="modal-body">
          <div class="filters plain" style="margin-bottom:12px">
            <div class="field grow-0"><label>کارشناس کیوسی</label><input class="input" id="drQc" value="${esc(qc)}" autocomplete="off"></div>
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
              ? 'فقط ' + fa(r.total) + ' ردیف با این فیلترها مطابق است؛ فیلترهای دیگری اعمال کنید.'
              : 'ردیفی با این فیلترها در دیتای خام یافت نشد.');
          return;
        }
        const head = (r.headers || []).map((h) => `<th>${esc(h)}</th>`).join('');
        out.innerHTML = `
          <div class="note" style="margin:0 0 8px"><i class="fa-solid fa-table"></i> <b>${fa(r.rows.length)}</b> ردیف نمایش‌داده‌شده از <b>${fa(r.total)}</b> ردیف مطابق — تمام ستون‌ها به‌شکلِ اصلیِ اکسل آپلودشده</div>
          <div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="tbl" style="font-size:12px">
            <thead><tr><th>#</th>${head}</tr></thead>
            <tbody>${r.rows.map((row) => `<tr><td style="color:var(--muted)">${row.row}</td>${(r.headers || []).map((h) => `<td>${esc(row.cells[h] == null ? '' : row.cells[h])}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>`;
      } catch (e) {
        if (out.isConnected) out.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
      }
    }

    /* ---------------- تارگت‌های ماهانه تیم‌ها ---------------- */
    const targetsEl = $('#rtTargets', root);

    function targetsTable(list) {
      return `
        <div class="table-wrap">
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
        </div>
        ${isAdmin ? targetsForm() : ''}`;
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

    function bindTargets() {
      if (!isAdmin) return;
      $('#tgSave', targetsEl).addEventListener('click', async () => {
        const team = $('#tgTeam', targetsEl).value;
        const month = $('#tgMonth', targetsEl).value;
        const target = $('#tgTarget', targetsEl).value.trim();
        if (!team || !month) return toast.error('تیم و ماه مالی را انتخاب کنید');
        if (!/^\d+$/.test(target)) return toast.error('تارگت باید یک عدد باشد');
        try {
          const out = await api.put('/api/rit/targets', {
            team: team, month: month, target: Number(target),
            note: $('#tgNote', targetsEl).value.trim()
          });
          toast.success('تارگت ذخیره شد');
          renderTargets(out.targets);
        } catch (e) {
          toast.error('خطا در ذخیره‌ی تارگت: ' + e.message);
        }
      });
      $$('[data-del-target]', targetsEl).forEach((b) => b.addEventListener('click', async () => {
        try {
          const out = await api.del('/api/rit/targets/' + encodeURIComponent(b.dataset.delTarget));
          toast.success('تارگت حذف شد');
          renderTargets(out.targets);
        } catch (e) {
          toast.error('خطا: ' + e.message);
        }
      }));
    }

    function renderTargets(list) {
      targetsEl.innerHTML = list.length
        ? targetsTable(list)
        : emptyState('fa-bullseye', 'هنوز تارگت تعریف نشده',
            'برای هر تیم و هر ماه مالی، تعداد ریت هدف را تعیین کنید.');
      bindTargets();
    }

    async function loadTargets() {
      try {
        const t = await api.get('/api/rit/targets');
        renderTargets((t && t.targets) || []);
      } catch (e) {
        targetsEl.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
      }
    }

    /* ---------------- مرکز دیتا ---------------- */
    const filesEl = $('#rtFiles', root);
    let fileSort = { key: 'name', dir: 'asc' };

    async function loadFiles() {
      const qs = [];
      const fFrom = fileRangePair.getFrom();
      const fTo = fileRangePair.getTo();
      if (fFrom) qs.push('from=' + encodeURIComponent(fFrom));
      if (fTo) qs.push('to=' + encodeURIComponent(fTo));
      const teamSel = fileTeamMs.getValues();
      if (teamSel.length) qs.push('team=' + encodeURIComponent(teamSel.join(',')));
      const q = $('#rtFileQ', root).value.trim();
      if (q) qs.push('q=' + encodeURIComponent(q));
      qs.push('sort=' + encodeURIComponent(fileSort.key));
      qs.push('dir=' + encodeURIComponent(fileSort.dir));
      try {
        const out = await api.get('/api/rit/files?' + qs.join('&'));
        const files = (out && out.files) || [];
        if (!files.length) {
          filesEl.innerHTML = emptyState('fa-inbox', 'فایلی یافت نشد',
            'با این فیلترها هیچ فایلی وجود ندارد. فیلترها را تغییر دهید یا فایل‌های اکسل را آپلود کنید.');
          return;
        }
        const kindMeta = {
          form: { label: 'فرم تماس', cls: 'good' },
          situational: { label: 'موقعیتی', cls: 'blue' },
          monthly: { label: 'ماهانه', cls: 'blue' },
          ticket: { label: 'تیکت', cls: 'violet' },
          social: { label: 'سوشال', cls: 'violet' }
        };
        const arrow = (k) => (fileSort.key === k ? (fileSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        const th = (k, label) => `<th class="rt-sort" data-sort="${k}" style="cursor:pointer">${label}${arrow(k)}</th>`;
        filesEl.innerHTML = `
          <div class="note" style="margin:0 0 8px"><i class="fa-solid fa-database"></i> <b>${fa(out.total)}</b> فایل منبع — کلیک بر روی هر فایل، دیتای خامِ اکسل را باز می‌کند</div>
          <div class="table-wrap">
            <table class="tbl" style="font-size:12.5px">
              <thead><tr>${th('name', 'نام فایل')}${th('team', 'تیم')}${th('from', 'از')}${th('to', 'تا')}${th('rows', 'ردیف‌ها')}<th>دسته</th><th>کارشناسان کیوسی</th></tr></thead>
              <tbody>${files.map((f) => {
                const km = kindMeta[f.kind] || kindMeta.form;
                return `<tr>
                  <td><button type="button" class="rt-file" data-file="${esc(f.name)}" style="text-align:left;font-family:monospace;font-size:11.5px;word-break:break-all"><i class="fa-solid fa-file-excel" style="color:var(--good);margin-left:4px"></i>${esc(f.name)}</button></td>
                  <td style="font-size:12px">${(f.teams || []).map(esc).join('، ') || '—'}</td>
                  <td dir="ltr" style="white-space:nowrap">${esc(f.from || '—')}</td>
                  <td dir="ltr" style="white-space:nowrap">${esc(f.to || '—')}</td>
                  <td><b>${fa(f.rows)}</b></td>
                  <td><span class="badge ${km.cls}">${km.label}</span></td>
                  <td style="font-size:11.5px;color:var(--muted)">${(f.qcAgents || []).slice(0, 4).map(esc).join('، ') || '—'}${(f.qcAgents || []).length > 4 ? ' +' : ''}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>`;
        $$('.rt-sort', filesEl).forEach((thEl) => thEl.addEventListener('click', () => {
          const k = thEl.dataset.sort;
          if (fileSort.key === k) fileSort.dir = fileSort.dir === 'asc' ? 'desc' : 'asc';
          else { fileSort.key = k; fileSort.dir = 'asc'; }
          loadFiles();
        }));
        $$('.rt-file', filesEl).forEach((btn) => btn.addEventListener('click', () => openFileModal(btn.dataset.file)));
      } catch (e) {
        filesEl.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
      }
    }

    async function openFileModal(name) {
      const m = UI.modal(`${UI.modalHead('دیتای خام اکسل — ' + name, 'fa-file-excel')}
        <div class="modal-body">
          <div class="filters plain" style="margin-bottom:12px">
            <div class="field grow-0"><label>کارشناس کیوسی</label><input class="input" id="flQc" placeholder="اختیاری…" autocomplete="off"></div>
            <div class="field grow-0"><label>کارشناس فروش</label><input class="input" id="flAgent" placeholder="اختیاری…" autocomplete="off"></div>
            <div class="field grow-0"><label>از تاریخ</label><input class="input" id="flFrom" autocomplete="off" placeholder="1405/07/20"></div>
            <div class="field grow-0"><label>تا تاریخ</label><input class="input" id="flTo" autocomplete="off" placeholder="1405/08/19"></div>
            <div class="field grow-0"><label>تیم</label>
              <select class="input" id="flTeam"><option value="">همه تیم‌ها</option>${(App.state.teams || []).map((t) => `<option value="${esc(t)}">${esc(QCParse.displayTeam(t))}</option>`).join('')}</select>
            </div>
            <button type="button" class="btn primary" id="flGo"><i class="fa-solid fa-magnifying-glass"></i> فیلتر</button>
          </div>
          <div id="flOut"><div class="loading-page"><div class="spinner"></div></div></div>
        </div>`, { lg: true });

      async function fetchRows() {
        const out = $('#flOut', m);
        const qs = ['file=' + encodeURIComponent(name)];
        const qcv = $('#flQc', m).value.trim();
        const agv = $('#flAgent', m).value.trim();
        const frv = $('#flFrom', m).value.trim();
        const tov = $('#flTo', m).value.trim();
        const tv = $('#flTeam', m).value;
        if (qcv) qs.push('qc=' + encodeURIComponent(qcv));
        if (agv) qs.push('agent=' + encodeURIComponent(agv));
        if (frv) qs.push('from=' + encodeURIComponent(frv));
        if (tov) qs.push('to=' + encodeURIComponent(tov));
        if (tv) qs.push('team=' + encodeURIComponent(tv));
        try {
          const r = await api.get('/api/rit/rows?' + qs.join('&'));
          if (!out.isConnected) return;
          if (!r.rows.length) {
            out.innerHTML = emptyState('fa-file-circle-x', 'بدون ردیف',
              r.total
                ? 'فقط ' + fa(r.total) + ' ردیف با این فیلترها matching است؛ فیلترهای دیگری اعمال کنید.'
                : 'دیتای خام برای این فایل ذخیره نشده است (ممکن است فایل قبل از این قابلیت آپلود شده باشد).');
            return;
          }
          const head = (r.headers || []).map((h) => `<th>${esc(h)}</th>`).join('');
          out.innerHTML = `
            <div class="note" style="margin:0 0 8px"><i class="fa-solid fa-table"></i> <b>${fa(r.rows.length)}</b> ردیف نمایش‌داده‌شده از <b>${fa(r.total)}</b> ردیف فایل — تمام ستون‌ها به‌شکلِ اصلیِ اکسل آپلودشده</div>
            <div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="tbl" style="font-size:12px">
              <thead><tr><th>#</th>${head}</tr></thead>
              <tbody>${r.rows.map((row) => `<tr><td style="color:var(--muted)">${row.row}</td>${(r.headers || []).map((h) => `<td>${esc(row.cells[h] == null ? '' : row.cells[h])}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>`;
        } catch (e) {
          if (out.isConnected) out.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message);
        }
      }
      $('#flGo', m).addEventListener('click', fetchRows);
      await fetchRows();
    }

    /* ---------------- شروع ---------------- */
    await load();
    await loadTargets();
    await loadFiles();
  }
});
})();
