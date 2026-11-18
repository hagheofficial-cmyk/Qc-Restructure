/* portfolio.js — پرونده‌ی همه‌ی کارشناسان رجیستری، حتی بدون ارزیابی؛ تیم + بازه‌ی سراسری. */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, scorePill, rateCell, emptyState, debounce, scoreColorHex, triValue, callRedlineBadge, bindCallRedlines, callTimeCell } = UI;

const FORM_TYPE_FA = { tele: 'Telesales', account: 'تیم اکانت', mlm: 'MLM/BNPL' };

async function render(root, arg) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-id-card-clip"></i></div>
      <div><h2>پرونده کارشناس</h2><p>همه‌ی کارشناسان مدیریت کارشناسان — کلیک روی هر سطر برای نمره‌ها، معیارها و جزئیات هر تماس</p></div>
      <div class="spacer"></div>
      <button class="btn primary" id="pBatchPdf" type="button"><i class="fa-solid fa-file-pdf"></i> دانلود تمام کارنامه‌ها (PDF)</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters plain">
        <div class="field" style="flex:1.4;min-width:220px"><label>جستجوی کارشناس (نام یا داخلی)</label>
          <div style="position:relative">
            <input class="input" id="pSearch" placeholder="مثلاً: الهه عسگری یا ۳۰۱۲ یا 3012" dir="auto" autocomplete="off">
            <div id="pSugg" style="position:absolute;top:100%;left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:0 0 10px 10px;max-height:230px;overflow-y:auto;z-index:50;display:none"></div>
          </div>
        </div>
        <div id="pTeamSlot"></div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="pReset"><i class="fa-solid fa-rotate-right"></i> بازنشانی</button></div>

      </div>
    </div>

    <div class="card" id="pAll" style="margin-bottom:16px"><div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست کارشناسان…</p></div></div>

`;

  const agents = await api.get('/api/agents');
  const master = $('#pAll', root), sugg = $('#pSugg', root);
  let profileBody = null, profileModal = null;
  if (!master) return;
  let curAgent = null, curData = null, lastCombined = [], historyCalls = [];
  let masterId = 0, profileId = 0;
  const teams = [...new Set(agents.map((a) => a.team).filter(Boolean))];
  const msTeams = UI.multiSelect({ label: 'تیم کارشناس', allLabel: 'همه تیم‌ها',
    items: teams.map((t) => ({ value: t, label: QCParse.displayTeam(t) })), onChange: () => {
      const selected = msTeams.getValues().map((t) => QCParse.teamKey(t));
      if (curAgent && selected.length && !selected.includes(QCParse.teamKey((agents.find((a) => a.name === curAgent) || {}).team))) {
        clearProfile();
      }
      refresh();
    } });
  $('#pTeamSlot').replaceWith(msTeams);

  /* ------------------------- فهرست اصلی کارشناسان با دیتا ------------------------- */
  function periodQ() {
    const q = new URLSearchParams();
    const selected = msTeams.getValues();
    if (selected.length) q.set('team', selected.join(','));
    return q;
  }

  async function renderMaster() {
    const wrap = master, request = ++masterId;
    if (!wrap.isConnected) return;
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست…</p></div>`;
    try {
      const q = periodQ();
      const d = await api.get('/api/portfolio/agents?' + q.toString());
      if (request !== masterId || !wrap.isConnected) return;
      const rows = (d.rows || []).slice().sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));
      lastCombined = rows;
      if (!rows.length) { wrap.innerHTML = `<div class="card-pad">${emptyState('fa-users', 'کارشناسی در این تیم نیست', 'کارشناس را در مدیریت کارشناسان اضافه کنید یا فیلتر تیم را تغییر دهید.')}</div>`; return; }
      const hasSit = rows.some(r => r.situationalAvg !== '' && r.situationalAvg != null);
      const hasMonthly = rows.some(r => r.ticketSource === 'monthly_excel' || r.socialSource === 'monthly_excel');
      wrap.innerHTML = `
        <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>کارشناس ها</h3><div class="sub">${fa(rows.length)} کارشناس · کلیک روی سطر = پرونده کامل؛ نمره‌ی خالی در میانگین صفر حساب نمی‌شود.</div></div></div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="tbl">
            <thead><tr>
              <th>کارشناس</th><th>تیم</th>
              <th>تعداد ریت تیکت</th><th>میانگین نمره تیکت</th>
              <th>تعداد ریت سوشال</th><th>میانگین نمره سوشال</th>
              <th>تعداد ریت تماس</th><th>میانگین نمره تماس</th>
              ${hasSit ? '<th>نمره موقعیتی</th>' : ''}
              <th>ردلاین</th><th>${(hasSit || hasMonthly) ? 'نمره کل وزن‌دار <small style="font-weight:400;opacity:.75">(۴۵/۲۵/۱۵/۱۵)</small>' : 'میانگین کل نمرات کارشناس'}</th>
            </tr></thead>
            <tbody>${rows.map(r => `<tr style="cursor:pointer" data-name="${esc(r.name)}" title="جزئیات ${esc(r.name)}">
              <td class="cell-main">${esc(r.name)}${r.active === false ? ' <span class="badge gray">بایگانی</span>' : ''}${!r.registered ? '<div class="cell-sub">در فایل‌های واردشده؛ در مدیریت کارشناسان ثبت نشده</div>' : ''}</td>
              <td><span class="tag-team">${esc(QCParse.displayTeam(r.team || '—'))}</span></td>
              <td>${fa(r.ticketCount || 0)}</td><td>${r.ticketAvg === '' ? '—' : scorePill(r.ticketAvg) + (r.ticketSource === 'monthly_excel' ? ' <span class="badge blue" style="font-size:10px">ماهانه</span>' : '')}</td>
              <td>${fa(r.socialCount || 0)}</td><td>${r.socialAvg === '' ? '—' : scorePill(r.socialAvg) + (r.socialSource === 'monthly_excel' ? ' <span class="badge blue" style="font-size:10px">ماهانه</span>' : '')}</td>
              <td>${fa(r.callCount || 0)}</td><td>${r.callAvg === '' ? '—' : scorePill(r.callAvg)}</td>
              ${hasSit ? `<td>${r.situationalAvg === '' || r.situationalAvg == null ? '—' : scorePill(r.situationalAvg)}</td>` : ''}
              <td>${redlinesCell(r)}</td>
              <td>${r.avgScore === '' ? '—' : scorePill(r.avgScore) + (r.activeWeight != null && r.activeWeight > 0 && r.activeWeight < 100 ? ` <small style="font-size:10px;color:var(--muted)">(${fa(r.activeWeight)}٪)</small>` : '')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      $$('tbody tr', wrap).forEach(tr => tr.addEventListener('click', () => pickAgent(tr.dataset.name)));
    } catch (e) {
      if (request !== masterId || !wrap.isConnected) return;
      wrap.innerHTML = `<div class="card-pad">${emptyState('fa-triangle-exclamation', 'خطای بارگذاری', e.message)}</div>`;
    }
  }

  function redlinesCell(row) {
    return [['تیکت', row.ticketRedline], ['سوشال', row.socialRedline], ['تماس', row.callRedline]]
      .filter((x) => x[1] > 0).map((x) => `<span class="badge bad">${x[0]}: ${fa(x[1])}</span>`).join(' ') || '-';
  }
  function clearProfile() {
    profileId++; curAgent = null; curData = null; $('#pSearch').value = '';
    if(profileModal && profileModal.isConnected) profileModal.close();
    profileModal=null;profileBody=null;historyCalls=[];App.clearCharts();
  }
  async function refresh() {
    const name = curAgent;
    await Promise.all([renderMaster(), name ? load(name) : Promise.resolve()]);
  }

  /* ------------------------- جستجوی نام ------------------------- */
  function matchAgents(q) {
    q = C.faToEn(String(q || '')).trim().toLowerCase();
    if (!q) return [];
    const dig = q.replace(/[^0-9]/g, '');
    const selectedTeams = msTeams.getValues();
    const fromAgents = agents.filter(a => (!selectedTeams.length || selectedTeams.includes(a.team)) &&
      (a.name.toLowerCase().includes(q) || (dig.length >= 2 && String(a.ext).includes(dig))));
    // + کارشناسان دیتای تماس که درگانسی نیستند
    const agentNames = new Set(agents.map(a => a.name));
    const callOnly = (lastCombined || [])
      .filter(r => !agentNames.has(r.name) && r.name && r.name.toLowerCase().includes(q))
      .map(r => ({ name: r.name, team: r.team || '(دیتای تماس)', ext: null, active: true }));
    return [...fromAgents, ...callOnly];
  }

  function renderSugg() {
    const list = matchAgents($('#pSearch').value).slice(0, 12);
    if (!list.length) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
    sugg.innerHTML = list.map(a => `
      <button class="btn ghost" style="display:flex;justify-content:space-between;width:100%;border-radius:0;border-bottom:1px solid var(--border)" data-name="${esc(a.name)}">
        <span>${esc(a.name)}</span>
        <span style="color:var(--muted);font-size:11px">${a.ext != null ? 'داخلی ' + fa(a.ext) : ''} · ${esc(QCParse.displayTeam(a.team))}</span>
      </button>`).join('');
    sugg.style.display = 'block';
    $$('button', sugg).forEach(b => b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickAgent(b.dataset.name);
      sugg.style.display = 'none';
    }));
  }

  $('#pSearch').addEventListener('input', debounce(renderSugg, 150));
  $('#pSearch').addEventListener('focus', renderSugg);
  $('#pSearch').addEventListener('blur', () => setTimeout(() => { sugg.style.display = 'none'; }, 180));
  $('#pSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const list = matchAgents($('#pSearch').value);
      if (list.length) { pickAgent(list[0].name); $('#pSugg').style.display = 'none'; }
    }
  });

  function ensurePopup() {
    if(profileModal && profileModal.isConnected)return;
    profileModal=UI.modal(`${UI.modalHead('پروفایل عملکرد کارشناس','fa-id-card')}<div class="profile-toolbar">
      <div class="field"><label>از تاریخ بررسی</label><div class="date-f"><input class="input" id="pFrom" dir="ltr" value="${esc(App.dateRange.from)}"><button class="cal-btn" id="pFromCal" type="button" aria-label="تقویم شروع"><i class="fa-regular fa-calendar"></i></button></div></div>
      <div class="field"><label>تا تاریخ بررسی</label><div class="date-f"><input class="input" id="pTo" dir="ltr" value="${esc(App.dateRange.to)}"><button class="cal-btn" id="pToCal" type="button" aria-label="تقویم پایان"><i class="fa-regular fa-calendar"></i></button></div></div>
      <button class="btn soft" id="pRangeApply">اعمال بازه</button><span class="profile-period" id="pLoadedPeriod"></span>
      <div class="toolbar-actions"><button class="btn success-soft" id="pXls" disabled><i class="fa-solid fa-file-excel"></i> اکسل</button><button class="btn soft" id="pPdf" disabled><i class="fa-solid fa-file-pdf"></i> PDF</button><button class="btn primary" id="pImage" disabled><i class="fa-solid fa-image"></i> تصویر</button></div></div>
      <div class="profile-content" id="pBody"></div>`,{className:'profile-modal',lg:true,onClose(){profileId++;curAgent=null;curData=null;profileBody=null;profileModal=null;historyCalls=[];App.clearCharts();}});
    profileBody=$('#pBody',profileModal);
    const apply=()=>App.setDateRange({from:$('#pFrom').value.trim(),to:$('#pTo').value.trim()});
    $('#pRangeApply').addEventListener('click',apply);
    JCal.attach($('#pFromCal'),{input:$('#pFrom'),onPick:apply});JCal.attach($('#pToCal'),{input:$('#pTo'),onPick:apply});
    $('#pXls').addEventListener('click',exportExcel);
    $('#pPdf').addEventListener('click',exportPdf);
    const captureName=()=>`${curData.agent.name} — ${curData.scope.from||'ابتدا'} تا ${curData.scope.to||'انتها'}`;
    const beforeCapture=()=>{App.charts.forEach(chart=>{if(chart.update)chart.update('none');});};
    $('#pImage').addEventListener('click',async()=>{
      if(!curData || !profileBody)return;
      const button=$('#pImage');button.disabled=true;
      try{
        beforeCapture();
        await QCCapture.download(profileBody,captureName(),revealAll);
        toast.success('عکس کامل پرونده در بازه‌ی نمایش‌داده‌شده آماده شد');
      }catch(e){toast.error(e.message);}finally{if(button.isConnected)button.disabled=!curData;}
    });
  }
  async function pickAgent(name) {
    $('#pSearch').value=name;ensurePopup();curAgent=name;await load(name);
  }

  $('#pReset').addEventListener('click', () => {
    msTeams.setValues([]); clearProfile(); renderMaster();
  });

  async function load(name) {
    const body = profileBody, request = ++profileId;
    if (!body || !body.isConnected) return;
    curData = null; $('#pXls').disabled = true; $('#pImage').disabled=true; if($('#pPdf'))$('#pPdf').disabled=true;
    body.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    const q = periodQ(); q.set('ident', name);
    try {
      const data = await api.get('/api/portfolio?' + q.toString());
      if (request !== profileId || !body.isConnected) return;
      App.clearCharts();
      curAgent = name; curData = data; $('.modal-head h3',profileModal).textContent='پروفایل عملکرد — '+data.agent.name; $('#pXls').disabled = false;$('#pImage').disabled=false;if($('#pPdf'))$('#pPdf').disabled=false;
      const scope=data.scope || {from:App.dateRange.from,to:App.dateRange.to};data.scope=scope;
      $('#pFrom').value=scope.from;$('#pTo').value=scope.to;
      const periodOr=scope.from||scope.to?'از '+fa(scope.from||'ابتدا')+' تا '+fa(scope.to||'انتها'):'همه تاریخ‌ها';
      $('#pLoadedPeriod').textContent='بازه‌ی داده‌ی نمایش‌داده‌شده: '+periodOr;
      renderProfile(body, data, periodOr);
    } catch (e) {
      if (request !== profileId || !body.isConnected) return;
      curData = null;
      body.innerHTML = `<div class="card">${emptyState('fa-circle-exclamation', 'خطا', e.message)}</div>`;
    }
  }

  /* ------------------------------ رندر ------------------------------ */
  /* در نسخه‌ی عکس/PDF هیچ جزئیاتی پنهان نماند */
  const revealAll = (copy) => { copy.querySelectorAll('.call-detail-row,.rating-detail-row,[hidden]').forEach((node) => { node.hidden = false; }); };

  const kpi = (icon, label, val, sub, cls) => `
    <div class="kpi ${cls || ''}">
      <div class="kpi-ic"><i class="fa-solid ${icon}"></i></div>
      <div><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}</div>${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${sub}</div>` : ''}</div>
    </div>`;

  function monthlyRecordsTable(records, channelLabel) {
    return `<table class="tbl history-tbl"><thead><tr><th>بازه دوره</th><th>نمره ماهانه ${channelLabel}</th><th>تعداد ارزیابی</th><th>فایل منبع</th><th>توضیحات</th></tr></thead>
      <tbody>${records.map(r => `<tr>
        <td dir="ltr">${fa(r.periodFrom || '—')} تا ${fa(r.periodTo || '—')}</td>
        <td>${scorePill(r.score)} <span class="badge blue" style="font-size:10px">اکسل ماهانه</span></td>
        <td>${r.evalCount != null ? fa(r.evalCount) : '—'}</td>
        <td dir="ltr" style="font-size:11px;color:var(--muted)">${esc(r.sourceFile || '—')}</td>
        <td>${esc(r.note || '—')}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  /* سوابق تیکت/سوشال: جزئیات هر ردیف همان‌جا باز است؛ دکمه‌ی اضافه لازم نیست. */
  function ticketTable(rows, monthlyRecords) {
    const monHtml = Array.isArray(monthlyRecords) && monthlyRecords.length ? monthlyRecordsTable(monthlyRecords, 'تیکت') : '';
    if (!rows.length) return monHtml || emptyState('fa-ticket', 'بدون سوابق تیکت', '');
    return monHtml + `<table class="tbl history-tbl"><thead><tr><th>کد تیکت</th><th>تاریخ بررسی</th><th>نمره</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr class="history-main">
        <td>${esc(r.ticketCode)}</td><td dir="ltr">${fa(r.reviewDate)}</td><td>${scorePill(r.score)}</td></tr>
        <tr class="rating-detail-row"><td colspan="3">${ticketDetail(r)}</td></tr>`).join('')}</tbody></table>`;
  }
  function socialTable(rows, monthlyRecords) {
    const monHtml = Array.isArray(monthlyRecords) && monthlyRecords.length ? monthlyRecordsTable(monthlyRecords, 'پیام‌رسان') : '';
    if (!rows.length) return monHtml || emptyState('fa-comments', 'بدون سوابق سوشال', '');
    const slaTxt = (s) => s.slaStatus === 'رعایت شده' ? '<span class="badge ok">رعایت</span>' : s.slaStatus === 'رعایت نشده' ? '<span class="badge bad">رد شده</span>' : '—';
    return monHtml + `<table class="tbl history-tbl"><thead><tr><th>تاریخ بررسی</th><th>SLA</th><th>نمره</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr class="history-main">
        <td dir="ltr">${fa(r.reviewDate)}</td><td>${slaTxt(r)}</td><td>${scorePill(r.score)}</td></tr>
        <tr class="rating-detail-row"><td colspan="3">${socialDetail(r)}</td></tr>`).join('')}</tbody></table>`;
  }
  function ticketDetail(r){return `<div class="detail-row">QC: ${esc(r.qcAgent||'—')} · تاریخ ایجاد: ${fa(r.ticketDate)} · ردلاین: ${QCReports.hasRedline(r,'ticket')?'۱':'-'}<br>
      پیگیری: ${triValue(r.q1)} · یادداشت: ${triValue(r.q2)} · دلیل بستن: ${triValue(r.q3)} · اکشن CRM: ${triValue(r.q4)}<div style="white-space:pre-wrap">${esc(r.comment||'')}</div></div>`;}
  function socialDetail(r){return `<div class="detail-row">QC: ${esc(r.qcAgent||'—')} · پیام‌رسان: ${esc(r.messenger||'—')} · وضعیت: ${esc(r.responseStatus||'—')}<br>
      دریافت: ${fa(r.receiveDate)} ${fa(r.receiveTime)} · پاسخ: ${fa(r.replyDate)} ${fa(r.replyTime)} · دقیقه کاری: ${fa(r.durationMin)}<br>
      SLA: ${triValue(r.qSla)} · پیگیری: ${triValue(r.qFollow)} · پایان‌بندی: ${triValue(r.qClosing)} · لحن: ${triValue(r.qTone)}<div style="white-space:pre-wrap">${esc(r.delayReason||'')} ${esc(r.reasonVerdict||'')} ${esc(r.comment||'')}</div></div>`;}
  function callTable(rows, dataObj, isBatch) {
    if (!rows.length) return emptyState('fa-headset', 'بدون دیتای ریت تماس', 'بازه‌ی تاریخ را تغییر دهید یا از مرکز داده فایل QC وارد کنید.');
    const sortedCalls = rows.slice().sort((a, b) => {
      const aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
      return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
    });
    if (!isBatch) historyCalls = sortedCalls;
    const activeData = dataObj || curData;
    // Build a single matrix, preserving form/team and historical labels. Two
    // different versions of the same key must never be silently conflated.
    const columns = [], positions = new Map();
    const matrix = sortedCalls.map(row => {
      const team = row.criteriaTeam || row.team || (activeData && activeData.agent.team) || '';
      const definitions = QCParse.definitionsFor(row.formType, team);
      const snapshot = Array.isArray(row.criteriaSnapshot) ? row.criteriaSnapshot : [];
      const snapshotKeys = snapshot.filter(d => d.active !== false).map(d => d.key);
      const keys = [...new Set((snapshotKeys.length ? snapshotKeys : QCReports.criteriaKeys([row], row.formType, QCParse)).concat(Object.keys(row.elements || {})))];
      const values = new Map();
      keys.forEach(key => {
        const old = snapshot.find(d => d.key === key), def = definitions.find(d => d.key === key);
        const label = (old && old.label) || (def && def.label) || QCParse.labelOf(row.formType, key, team);
        const identity = JSON.stringify([row.formType || '', team, key, label]);
        if (!positions.has(identity)) {
          positions.set(identity, columns.length);
          columns.push({ identity, label, form: FORM_TYPE_FA[row.formType] || row.formType || '—', team });
        }
        values.set(identity, QCParse.elementValue(Object.assign({}, row, { team }), key));
      });
      return values;
    });
    // Use proportional widths instead of a hard minimum: all columns remain
    // within the profile viewport, including when a form has many criteria.
    const weights = [3, 5, 3, 2].concat(columns.map(() => 1), [3, 3, 7]);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const multipleGroups = new Set(columns.map(c => c.form + '|' + c.team)).size > 1;
    return `<table class="tbl profile-call-table" id="pCallHistory">
      <colgroup>${weights.map(w => `<col style="width:${w * 100 / totalWeight}%">`).join('')}</colgroup>
      <thead>${columns.length ? `<tr><th class="profile-legend-head" colspan="${weights.length}"><div class="profile-criterion-legend">${columns.map((col, i) => `<span class="profile-legend-item"><b>${fa(i + 1)}</b> ${esc(col.label)}${multipleGroups ? ` <small>(${esc(col.form)}${col.team ? ' · ' + esc(QCParse.displayTeam(col.team)) : ''})</small>` : ''}</span>`).join('')}</div></th></tr>` : ''}
      <tr><th>تاریخ بررسی</th><th>لید و شماره تماس</th><th>فرم</th><th>نمره</th>${columns.map((col, i) => `<th class="profile-criterion-head" title="${esc(col.label)} — ${esc(col.form)}${col.team ? ' · ' + esc(QCParse.displayTeam(col.team)) : ''}"><span aria-hidden="true">${fa(i + 1)}</span><span class="profile-visually-hidden"> ${esc(col.label)} (${esc(col.form)}${col.team ? ' · ' + esc(QCParse.displayTeam(col.team)) : ''})</span></th>`).join('')}<th>ردلاین</th><th>زمان تماس</th><th>کامنت QC</th></tr></thead>
      <tbody>${sortedCalls.map((row, index) => `<tr id="pCallDetails-${index}" class="profile-call-row">
          <td dir="ltr">${esc(fa(row.reviewDate || '—'))}</td>
          <td class="cell-main">${esc(row.leadName || '—')}<div class="cell-sub" dir="ltr">${esc(row.leadPhone || '—')}</div></td>
          <td>${esc(FORM_TYPE_FA[row.formType] || row.formType || '—')}</td>
          <td>${scorePill(row.score)}</td>
          ${columns.map(col => `<td class="profile-criterion-value">${matrix[index].has(col.identity) ? triValue(matrix[index].get(col.identity)) : '<span title="این المان برای این فرم نیست">·</span>'}</td>`).join('')}
          <td>${callRedlineBadge(row, index)}${QCReports.hasRedline(row, 'call') ? UI.redlineInlineHtml(row) : ''}</td>
          <td>${callTimeCell(row)}</td>
          <td class="profile-call-comment">${esc(row.qcComment || '—')}</td>
        </tr>`).join('')}</tbody></table>`;
  }

  /* ---------- کارت نرخ موفقیت معیارهای تماس (پرتفوی) ---------- */
  function criteriaCard(byTypeRates, dataObj) {
    if (!Array.isArray(byTypeRates) || !byTypeRates.length) return '';
    const activeData = dataObj || curData;
    const FORM__LABEL = { tele: 'Telesales', account: 'تیم اکانت', mlm: 'MLM/BNPL' };
    const ids = [];
    const cards = byTypeRates.map((bt, bi) => {
      if (!bt.rates || !bt.rates.length) return '';
      const rows = bt.rates.map((r, ri) => {
        const lbl = r.label || window.QCParse.labelOf(bt.form, r.key, activeData && activeData.agent.team);
        const cid = 'cr-' + bi + '-' + ri;
        ids.push(cid);
        const st = r.successRate === '' ? null : r.successRate;
        const bar = st == null ? 'width:0%' : `width:${st}%;background:${scoreColorHex(st)}`;
        return `<tr>
          <td style="font-size:12px">${esc(lbl)} <span style="color:var(--muted);font-size:10px">(${fa(r.ok)}/${fa(r.total)})</span></td>
          <td style="width:1%;white-space:nowrap;text-align:center">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;height:7px;background:var(--soft);border-radius:999px;overflow:hidden;min-width:120px"><div style="${bar};height:100%;border-radius:999px"></div></div>
              <span style="flex-shrink:0;font-weight:600;font-size:12px;width:44px;text-align:left">${st == null ? '—' : fa(st) + '٪'}</span>
            </div>
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="card" style="margin-bottom:0">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
            <div><h3>نرخ موفقیت معیار‌ها — ${FORM__LABEL[bt.form] || bt.form}</h3>
            <div class="sub">${fa(bt.count)} تماس ارزیابی‌شده${bt.weak ? ` · ${fa(bt.weak)} معیار ضعیف (<100٪)` : ''}</div></div></div>
          <div class="table-wrap"><table class="tbl"><tbody>${rows}</tbody></table></div>
        </div>`;
    }).filter(Boolean).join('');

    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:14px;margin-bottom:16px">${cards}</div>`;
  }

  /* ---------- کارت المان‌های موقعیتی (Score Calc) در کارنامه کارشناس ---------- */
  function situationalCard(sit) {
    if (!sit || !sit.hasData) return '';
    const FORM_LBL = { tele: 'Telesales', account: 'تیم اکانت' };
    const periodsTxt = (sit.periods || [])
      .map((p) => (p.from || p.to) ? `${fa(p.from || '—')} تا ${fa(p.to || '—')}` : 'بدون بازه')
      .filter(Boolean).join(' · ');
    const byForm = ['tele', 'account'].map((ft) => {
      const els = (sit.elements || []).filter((e) => e.form === ft);
      if (!els.length) return '';
      const fMeta = (sit.byForm && sit.byForm[ft]) || {};
      const rows = els.map((el) => {
        const rate = el.rate === '' || el.rate == null ? null : el.rate;
        const bar = rate == null ? 'width:0%' : `width:${rate}%;background:${scoreColorHex(rate)}`;
        const countLabel = el.n > 0 ? `${fa(el.n)} مورد` : '۰ مورد — موضوعیت نداشته';
        return `<tr>
          <td style="font-size:12px">${esc(el.label)} <span style="color:var(--muted);font-size:10px">(${countLabel})</span></td>
          <td style="width:1%;white-space:nowrap;text-align:center">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;height:7px;background:var(--soft);border-radius:999px;overflow:hidden;min-width:120px"><div style="${bar};height:100%;border-radius:999px"></div></div>
              <span style="flex-shrink:0;font-weight:600;font-size:12px;width:48px;text-align:left">${rate == null ? '—' : fa(rate) + '٪'}</span>
            </div>
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="card" id="pSituationalCard" style="margin-bottom:0">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-sliders"></i></div>
            <div>
              <h3>المان‌های موقعیتی — ${FORM_LBL[ft] || ft}</h3>
              <div class="sub">${fa(fMeta.formsCount || sit.formsCount || 0)} فرم بررسی‌شده${periodsTxt ? ' · دوره: ' + periodsTxt : ''}</div>
            </div>
            <div class="spacer"></div>
            <div>${(fMeta.avgScore !== '' && fMeta.avgScore != null) ? scorePill(fMeta.avgScore) : (sit.avgScore !== '' ? scorePill(sit.avgScore) : '—')}</div>
          </div>
          <div class="table-wrap"><table class="tbl"><tbody>${rows}</tbody></table></div>
        </div>`;
    }).filter(Boolean).join('');
    if (!byForm) return '';
    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:14px;margin-bottom:16px">${byForm}</div>`;
  }

  /* ---------- کارنامه: نقاط قوت / ضعف / بهبود ----------
   * همه‌چیز از همان داده‌ی پرونده و با قاعده‌ی ساده و قابل توضیح ساخته می‌شود:
   * نرخ موفقیت هر معیار (با حداقل ۳ ریت)، ردلاین، SLA، میانگین نمره‌ها و
   * روند ماه‌های آخر. هیچ متن دلبخواهی تولید نمی‌شود.
   */
  /* ---------- کارت تفکیک نمره کل وزن‌دار (۴۵٪ ثابت · ۲۵٪ موقعیتی · ۱۵٪ پیام‌رسان · ۱۵٪ تیکت) ---------- */
  function weightedCard(d) {
    const w = d.weighted || QCReports.computeWeightedScore({
      callAvg: d.calls.avgScore,
      situationalAvg: d.situational && d.situational.avgScore,
      socialAvg: d.socials.avgScore,
      ticketAvg: d.tickets.avgScore
    });
    if (!w || !w.activeWeight) return '';
    const srcBadge = (key) => {
      if (key === 'ticket' && d.tickets.source === 'monthly_excel') return ' <span class="badge blue" style="font-size:10px">اکسل ماهانه</span>';
      if (key === 'social' && d.socials.source === 'monthly_excel') return ' <span class="badge blue" style="font-size:10px">اکسل ماهانه</span>';
      return '';
    };
    const isPartial = w.activeWeight < w.totalWeight;
    const activePillars = (w.pillars || []).filter(p => p.active);
    const activeNames = activePillars.map(p => p.label).join('، ');
    return `<div class="card" id="pWeightedCard" style="margin-bottom:16px">
      <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-scale-balanced"></i></div>
        <div>
          <h3>ترکیب نمره کل کارشناس</h3>
          <div class="sub">وزن رسمی ۴گانه: ثابت تماس ۴۵٪ · موقعیتی ۲۵٪ · پیام‌رسان ۱۵٪ · تیکت ۱۵٪${isPartial ? ` — <b>بخش‌های بدون دیتا از محاسبه حذف شده‌اند</b> و نمره کل فقط از بخش‌های دارای دیتا (${esc(activeNames)}) محاسبه شده است` : ' — هر ۴ بخش دارای دیتا هستند'}</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:left">
          <div style="font-size:11px;color:var(--muted)">نمره کل نهایی (از ۱۰۰)</div>
          <div style="margin-top:2px">${scorePill(w.score)}</div>
        </div>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>بخش ارزیابی</th><th>وزن رسمی</th><th>نمره بخش (از ۱۰۰)</th><th>سهم در این کارنامه</th><th>وضعیت</th></tr></thead>
        <tbody>${(w.pillars || []).map(p => {
          const effShare = p.active && w.activeWeight > 0 ? C.round2(p.weight * 100 / w.activeWeight) : 0;
          return `<tr style="${p.active ? '' : 'opacity:.65'}">
          <td><b>${esc(p.label)}</b>${srcBadge(p.key)}</td>
          <td>${fa(p.weight)}٪</td>
          <td>${p.active ? scorePill(p.score) : '<span style="color:var(--muted)">—</span>'}</td>
          <td>${p.active ? `<b>${fa(effShare)}٪</b> <small style="color:var(--muted)">(سهم مؤثر در نمره کل)</small>` : '<span style="color:var(--muted)">از محاسبه حذف شد</span>'}</td>
          <td>${p.active ? '<span class="badge ok">لحاظ شده در محاسبه</span>' : '<span class="badge gray">دیتایی موجود نیست</span>'}</td>
        </tr>`;
        }).join('')}
        <tr style="background:var(--panel-soft);font-weight:700">
          <td>نمره کل نهایی کارشناس</td>
          <td>${fa(activePillars.length)} از ۴ بخش</td>
          <td>${scorePill(w.score)}</td>
          <td><b>۱۰۰٪</b> <small style="font-weight:400;color:var(--muted)">از بخش‌های دارای دیتا</small></td>
          <td><span class="badge ${isPartial ? 'info' : 'ok'}">${isPartial ? 'محاسبه از بخش‌های موجود' : 'هر ۴ بخش کامل'}</span></td>
        </tr></tbody>
      </table></div>
    </div>`;
  }

  function scorecard(d) {
    const T = d.tickets, S = d.socials, Ph = d.calls;
    const bands = UI.scoreBands ? UI.scoreBands() : [90, 75, 60];
    const criteria = [];
    (Ph.byTypeRates || []).forEach((bt) => {
      (bt.rates || []).forEach((r) => {
        if (!r || r.total < 3 || r.successRate === '' || r.successRate == null) return;
        criteria.push({ form: bt.form, label: r.label || QCParse.labelOf(bt.form, r.key), rate: r.successRate, ok: r.ok, total: r.total });
      });
    });
    const strong = criteria.filter((c) => c.rate >= 90).sort((a, b) => b.rate - a.rate);
    const weak = criteria.filter((c) => c.rate < 75).sort((a, b) => a.rate - b.rate);
    /* اگر معیاری به ۹۰٪ نرسید، بهترین معیارهای بالای ۸۰٪ را به‌عنوان قوت نشان بده */
    const goodish = criteria.filter((c) => c.rate >= 80 && c.rate < 90).sort((a, b) => b.rate - a.rate).slice(0, 2);

    const overall = d.weighted && d.weighted.score !== '' ? d.weighted.score : QCReports.avgScore(T.rows.concat(S.rows, Ph.rows));
    const monthScores = (d.monthly && d.monthly.calls || []).filter((m) => m.avgScore !== '' && m.count >= 3)
      .slice(-4).map((m) => ({ month: m.monthFa || m.key, score: m.avgScore }));
    const trend = monthScores.length >= 2
      ? monthScores[monthScores.length - 1].score - monthScores[0].score : null;

    const goods = [], bads = [], fixes = [];
    const add = (list, text) => { if (list.length < 6) list.push(text); };

    /* --- قوت --- */
    if (overall !== '' && overall >= bands[1]) add(goods, `میانگین کل نمرات ${fa(overall)} از ۱۰۰ — بالاتر از حد انتظار (${fa(bands[1])}).`);
    strong.slice(0, 4).forEach((c) => add(goods, `«${esc(c.label)}» با ${fa(c.rate)}٪ رعایت در ${fa(c.total)} ریت — نقطه‌ی قوت پایدار.`));
    if (trend != null && trend >= 5) add(goods, `روند نمره‌ی تماس در ${fa(monthScores.length)} ماه اخیر ${fa(Math.round(trend))} واحد رشد داشته است.`);
    if (!Ph.redlineCount && Ph.count >= 3) add(goods, `هیچ ردلاینی در ${fa(Ph.count)} ریت تماس ثبت نشده است.`);
    if (!T.redlineZero && T.count >= 3) add(goods, `تیکت‌ها بدون ردلاین ارزیابی شده‌اند (${fa(T.count)} ریت).`);
    if (S.slaReal !== '' && S.slaReal >= 85) add(goods, `SLA سوشال ${fa(S.slaReal)}٪ — پاسخ‌گویی به‌موقع.`);
    if (!goods.length && goodish.length) goodish.forEach((c) => add(goods, `«${esc(c.label)}» با ${fa(c.rate)}٪ رعایت — قابل تقویت تا سطح عالی.`));
    if (!goods.length && T.avgScore !== '' && T.avgScore >= bands[1]) add(goods, `میانگین نمره‌ی تیکت ${fa(T.avgScore)} — بالاتر از حد انتظار.`);
    if (!goods.length && S.avgScore !== '' && S.avgScore >= bands[1]) add(goods, `میانگین نمره‌ی سوشال ${fa(S.avgScore)} — بالاتر از حد انتظار.`);
    if (!goods.length && Ph.avgScore !== '' && Ph.avgScore >= bands[1]) add(goods, `میانگین نمره‌ی تماس ${fa(Ph.avgScore)} — بالاتر از حد انتظار.`);
    if (!goods.length && S.unanswered === 0 && S.count >= 3) add(goods, `همه‌ی ${fa(S.count)} پیام سوشال پاسخ داده شده‌اند.`);
    if (!goods.length) add(goods, 'هنوز داده‌ی کافی برای معرفی نقطه‌ی قوت در این بازه نیست؛ بازه را گسترده‌تر کنید.');

    /* --- ضعف --- */
    weak.slice(0, 4).forEach((c) => add(bads, `«${esc(c.label)}» فقط ${fa(c.rate)}٪ رعایت (${fa(c.ok)} از ${fa(c.total)}) — ضعیف‌ترین معیار این بازه.`));
    if (Ph.redlineCount) add(bads, `${fa(Ph.redlineCount)} ردلاین در ریت تماس؛ هر ردلاین یعنی نمره‌ی صفر روی همان تماس.`);
    if (T.redlineZero) add(bads, `${fa(T.redlineZero)} تیکت با ردلاین — نیاز به بازبینی روند بستن و پیگیری.`);
    if (S.slaReal !== '' && S.slaReal < 75) add(bads, `SLA سوشال ${fa(S.slaReal)}٪ — بخش قابل توجهی از پاسخ‌ها خارج از زمان مجاز.`);
    if (S.unanswered) add(bads, `${fa(S.unanswered)} سوشال بی‌پاسخ مانده است.`);
    if (trend != null && trend <= -5) add(bads, `روند نمره‌ی تماس در ماه‌های اخیر ${fa(Math.abs(Math.round(trend)))} واحد افت کرده است.`);
    if (overall !== '' && overall < bands[2]) add(bads, `میانگین کل ${fa(overall)} پایین‌تر از حد مطلوب (${fa(bands[2])}) است.`);
    if (!bads.length) add(bads, 'در این بازه ضعف شاخصی دیده نمی‌شود؛ همان معیارهای بالای ۹۰٪ را حفظ کنید.');

    /* --- بهبود --- */
    weak.slice(0, 3).forEach((c) => add(fixes, `تمرین و بازبینی تماس روی «${esc(c.label)}»؛ هدف: رساندن رعایت به بالای ۸۵٪ در دوره‌ی بعد.`));
    if (Ph.redlineCount) add(fixes, 'بازخوانی علت هر ردلاین با کارشناس QC و ثبت اقدام اصلاحی برای همان لید.');
    if (T.redlineZero) add(fixes, 'قبل از بستن تیکت، چک‌لیست پیگیری و دلیل بستن را کامل کنید تا ردلاین تکرار نشود.');
    if (S.slaReal !== '' && S.slaReal < 85) add(fixes, 'کاهش زمان پاسخ سوشال؛ اولویت با پیام‌های نزدیک به مرز SLA.');
    if (monthScores.length >= 2 && trend != null && trend < 0) add(fixes, 'بررسی ماهانه‌ی نمره‌ها با تمرکز روی ماه‌های کاهشی و ثبت دلیل افت.');
    add(fixes, 'هدف دوره‌ی بعد: حفظ معیارهای بالای ۹۰٪ و رساندن ضعیف‌ترین معیار به حداقل ۸۰٪.');

    const grade = overall === '' ? { label: 'بدون نمره', cls: 'gray' }
      : overall >= bands[0] ? { label: 'عالی', cls: 'ok' }
        : overall >= bands[1] ? { label: 'خوب', cls: 'info' }
          : overall >= bands[2] ? { label: 'نیاز به بهبود', cls: 'warn' } : { label: 'ضعیف', cls: 'bad' };

    const col = (icon, title, items, cls) => `
      <div class="sc-col ${cls}">
        <div class="sc-col-head"><i class="fa-solid ${icon}"></i><b>${title}</b></div>
        <ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>`;

    return `<div class="card scorecard">
      <div class="card-head"><div class="head-icon"><i class="fa-solid fa-award"></i></div>
        <div><h3>کارنامه‌ی عملکرد</h3><div class="sub">جمع‌بندی ${fa(T.count + S.count + Ph.count)} ریت — ${fa(criteria.length)} معیار با داده‌ی کافی</div></div>
        <div class="spacer"></div>
        <span class="badge ${grade.cls} sc-grade">${grade.label}${overall === '' ? '' : ' · ' + fa(overall)}</span>
      </div>
      <div class="sc-grid">
        ${col('fa-thumbs-up', 'نقاط قوت', goods, 'good')}
        ${col('fa-triangle-exclamation', 'نقاط ضعف', bads, 'bad')}
        ${col('fa-lightbulb', 'پیشنهاد بهبود', fixes, 'info')}
      </div>
    </div>`;
  }

  /* ---------- کارت ردلاین‌های کارشناس با علت ---------- */
  function redlineCard(redlineRows) {
    if (!Array.isArray(redlineRows) || !redlineRows.length) return '';
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head" style="border-color:rgba(248,113,113,.3)">
        <div class="head-icon" style="background:var(--bad-soft);color:var(--bad)"><i class="fa-solid fa-ban"></i></div>
        <div><h3>ردلاین‌ها (${fa(redlineRows.length)} مورد)</h3><div class="sub">علت و جزئیات هر ردلاین — کلیک روی لید = جستجو</div></div></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>تاریخ</th><th>لید</th><th>نوع</th><th>نمره</th><th>علت ردلاین و کامنت QC</th></tr></thead>
        <tbody>${redlineRows.map((r) => `<tr>
          <td dir="ltr">${fa(r.date || '—')}</td>
          <td>${esc(r.leadName || '—')}<div style="font-size:10px;color:var(--muted)" dir="ltr">${esc(r.leadPhone || '')}</div></td>
          <td><span class="tag-team">${FORM_TYPE_FA[r.formType] || r.formType}</span></td>
          <td>${r.score != null ? scorePill(r.score) : '—'}</td>
          <td style="font-size:12px;max-width:340px;white-space:pre-wrap">${UI.redlineDetailHtml(r)}</td>
        </tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderProfile(body, d, periodLabel, opts) {
    const isBatch = !!(opts && opts.batch);
    const a = d.agent;
    const monthLine = periodLabel && periodLabel !== 'همه دوره‌ها' ? `<span class="tag-team" style="background:var(--violet-soft);color:var(--violet)"><i class="fa-regular fa-calendar"></i> ${esc(periodLabel)}</span>` : '<span class="tag-team">همه دوره‌ها</span>';
    const T = d.tickets, S = d.socials, Ph = d.calls, Sit = d.situational || { hasData: false };

    const allKeys = [...new Set([
      ...d.monthly.tickets.map(m => m.key),
      ...d.monthly.socials.map(m => m.key),
      ...d.monthly.calls.map(m => m.key)
    ])].sort();
    const mIdx = (arr, k) => arr.find(m => m.key === k);
    const labels = allKeys.map(k => {
      const m = mIdx(d.monthly.tickets, k) || mIdx(d.monthly.socials, k) || mIdx(d.monthly.calls, k);
      return m.monthFa;
    });

    const typeRows = Ph.byType.length
      ? Ph.byType.map(t => `<span class="tag-team">${FORM_TYPE_FA[t.type] || t.type}: ${fa(t.count)} تماس · میانگین ${t.avg === '' ? '—' : scorePill(t.avg)}</span>`).join(' ')
      : '<span class="tag-team" style="opacity:.5">دیتای ریت تماس برای این کارشناس یافت نشد</span>';

    const socialRedlines = S.rows.filter(r => QCReports.hasRedline(r, 'social')).length;
    const totalRedlines = (T.redlineZero || 0) + socialRedlines + (Ph.redlineCount || 0);
    const hiddenCalls = (Ph.allCount || 0) > (Ph.count || 0) ? (Ph.allCount - Ph.count) : 0;
    const allRange = Ph.allDateRange || { from: '', to: '' };
    const dateCoverageHtml = hiddenCalls > 0 ? `
      <div class="alert warn" id="pDateCoverageAlert" style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <i class="fa-solid fa-calendar-exclamation"></i>
        <span style="flex:1;min-width:220px">از مجموع <b>${fa(Ph.allCount)}</b> ریت تماس این کارشناس${allRange.from || allRange.to ? ` (بازه <b>${fa(allRange.from || '—')}</b> تا <b>${fa(allRange.to || '—')}</b>)` : ''}، در بازه فیلتر فعلی <b>${fa(Ph.count)}</b> تماس نمایش داده می‌شود (<b>${fa(hiddenCalls)}</b> تماس خارج از این بازه است).</span>
        ${(allRange.from || allRange.to) ? `<button type="button" class="btn soft" id="pFitAgentRange" style="padding:5px 10px;font-size:11px"><i class="fa-solid fa-expand"></i> تنظیم روی بازه کامل کارشناس</button>` : ''}
      </div>` : '';

    const fmtVal = (v) => (v === '' || v == null ? '—' : fa(v));
    const sitPeriodTxt = (Sit.periods && Sit.periods[0] && (Sit.periods[0].from || Sit.periods[0].to))
      ? ` · ${fa(Sit.periods[0].from || '—')} تا ${fa(Sit.periods[0].to || '—')}` : '';

    body.innerHTML = `
      <div class="capture-title no-capture"></div>
      <div class="profile-system-brand"><img src="${esc(window.APP_SCRIPT_MODE && window.APP_SCRIPT_LOGO_DATA ? window.APP_SCRIPT_LOGO_DATA : 'logo.png')}" width="30" height="30" alt="لوگوی سامانه"><span>سامانه کنترل کیفیت CRM · گزارش عملکرد</span></div>
      <!-- شناسنامه -->
      <div class="card profile-identity" style="margin-bottom:16px">
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
          <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,var(--brand),var(--violet));display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;flex-shrink:0">
            <i class="fa-solid fa-user"></i>
          </div>
          <div style="flex:1;min-width:180px">
            <div style="font-size:19px;font-weight:800">${esc(a.name)}</div>
            <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:7px">
              <span class="tag-team">${esc(QCParse.displayTeam(a.team))}</span>
              ${a.id === 0 ? '<span class="badge warn">در فایل‌های واردشده؛ در مدیریت کارشناسان ثبت نشده</span>' : ''}
              ${a.ext != null ? `<span class="badge gray"><i class="fa-solid fa-hashtag"></i> داخلی ${fa(a.ext)}</span>` : ''}
              <span class="badge ${a.active ? 'ok' : 'bad'}">${a.active ? 'فعال' : 'بایگانی'}</span>
              <span class="badge gray"><i class="fa-solid fa-layer-group"></i> کل ریت‌ها: ${fa(T.count + S.count + Ph.count)}</span>
              <span class="badge ${totalRedlines > 0 ? 'bad' : 'gray'}"><i class="fa-solid fa-ban"></i> ردلاین: ${fa(T.redlineZero)} / ${fa(socialRedlines)} / ${fa(Ph.redlineCount)}</span>
              ${monthLine}
            </div>
          </div>
        </div>
      </div>

      ${dateCoverageHtml}

      <!-- ۵ باکس اصلی نمره کنار هم در ابتدای پروفایل کارشناس به ترتیب رسمی -->
      <div class="profile-summary" id="pTopKpis">
        <div class="summary-block kpi-primary" data-kpi="overall">
          <div class="summary-head"><i class="fa-solid fa-scale-balanced"></i><span>نمره کل</span></div>
          <strong>${fmtVal(d.weighted && d.weighted.score)}</strong>
          <small class="summary-sub">${(() => {
            const act = d.weighted && d.weighted.pillars ? d.weighted.pillars.filter(p => p.active).length : 0;
            if (!act) return 'دیتایی موجود نیست';
            return act < 4
              ? `مجموع ضریب تیکت، سوشال، تماس و المان‌های موقعیتی · فقط ${fa(act)} بخش دارای دیتا (بقیه حذف شدند)`
              : 'مجموع ضریب تیکت، سوشال، تماس و المان‌های موقعیتی';
          })()}</small>
        </div>
        <div class="summary-block ${Ph.redlineCount > 0 ? 'kpi-danger' : ''}" data-kpi="fixed">
          <div class="summary-head"><i class="fa-solid fa-headset"></i><span>نمره المان‌های ثابت</span></div>
          <strong>${fmtVal(Ph.avgScore)}</strong>
          <small class="summary-sub">${Ph.count ? `ضریب ۴۵٪ · ${fa(Ph.count)} تماس${Ph.redlineCount ? ` · ردلاین ${fa(Ph.redlineCount)}` : ''}` : 'ضریب ۴۵٪ · دیتایی موجود نیست'}</small>
        </div>
        <div class="summary-block" data-kpi="situational">
          <div class="summary-head"><i class="fa-solid fa-sliders"></i><span>نمره المان‌های موقعیتی</span></div>
          <strong>${Sit.hasData ? fmtVal(Sit.avgScore) : '—'}</strong>
          <small class="summary-sub">ضریب ۲۵٪ · ${Sit.hasData ? `${fa(Sit.formsCount || 0)} فرم${sitPeriodTxt}` : 'دیتایی موجود نیست'}</small>
        </div>
        <div class="summary-block ${T.redlineZero > 0 ? 'kpi-warn' : ''}" data-kpi="ticket">
          <div class="summary-head"><i class="fa-solid fa-ticket"></i><span>نمره تیکت</span></div>
          <strong>${fmtVal(T.avgScore)}</strong>
          <small class="summary-sub">${T.avgScore !== '' && T.avgScore != null ? `ضریب ۱۵٪ · ${fa(T.count)} ارزیابی${T.source === 'monthly_excel' ? ' · اکسل ماهانه' : ''}${T.redlineZero ? ` · ردلاین ${fa(T.redlineZero)}` : ''}` : 'ضریب ۱۵٪ · دیتایی موجود نیست'}</small>
        </div>
        <div class="summary-block ${S.slaReal !== '' && S.slaReal < 70 ? 'kpi-warn' : ''}" data-kpi="social">
          <div class="summary-head"><i class="fa-solid fa-comments"></i><span>نمره سوشال</span></div>
          <strong>${fmtVal(S.avgScore)}</strong>
          <small class="summary-sub">${S.avgScore !== '' && S.avgScore != null ? `ضریب ۱۵٪ · ${fa(S.count)} ارزیابی${S.source === 'monthly_excel' ? ' · اکسل ماهانه' : ''}${S.slaReal === '' ? '' : ` · SLA ${fa(S.slaReal)}٪`}${S.unanswered ? ` · عدم پاسخ ${fa(S.unanswered)}` : ''}` : 'ضریب ۱۵٪ · دیتایی موجود نیست'}</small>
        </div>
      </div>

      ${weightedCard(d)}
      ${scorecard(d)}

      ${criteriaCard(Ph.byTypeRates, d)}
      ${situationalCard(Sit)}
      ${redlineCard(Ph.redlineRows)}

      ${allKeys.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-line"></i></div>
          <div><h3>روند ماهانه نمره‌ها</h3><div class="sub">میانگین هر ماه شمسی به تفکیک منبع</div></div></div>
        <div class="chart-box" style="height:190px"><canvas id="pmChart"></canvas></div>
      </div>` : ''}

      <div class="history-stack">
        <div class="card full-row">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-ticket"></i></div>
            <div><h3>سوابق تیکت (${fa(T.count)})</h3><div class="sub">جزئیات هر ریت همان‌جا باز است</div></div></div>
          <div class="table-wrap history-wrap">${ticketTable(T.rows, T.monthlyRecords)}</div>
        </div>
        <div class="card full-row">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-comments"></i></div>
            <div><h3>سوابق سوشال (${fa(S.count)})</h3><div class="sub">SLA، زمان پاسخ و جزئیات هر بررسی</div></div></div>
          <div class="table-wrap history-wrap">${socialTable(S.rows, S.monthlyRecords)}</div>
        </div>
        <div class="card full-row">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-headset"></i></div>
            <div><h3>سوابق ریت تماس (${fa(Ph.count)})</h3><div class="sub">همهٔ تماس‌ها در یک جدول؛ شمارهٔ هر ستون با نام المان بالای جدول مطابقت دارد. نقطه یعنی آن المان برای این ریت نیست.</div></div></div>
          <div class="card-pad history-types">${typeRows}</div>
          <div class="table-wrap history-wrap profile-call-wrap">${callTable(Ph.rows, d, isBatch)}</div>
        </div>
      </div>

      ${(d.actions.length || true) ? `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-clipboard-list"></i></div>
          <div><h3>اقدامات اصلاحی و توافقات؛ همه تاریخ‌ها (${fa(d.actions.length)})</h3>
          <div class="sub">${d.voiceCount ? `فایل‌های ویس: ${fa(d.voiceCount)} · ` : ''}فقط اقدامات ثبت‌شده در همین سامانه قابل تغییر وضعیت‌اند</div>
          </div>
          <div class="spacer"></div>
          ${isBatch ? '' : '<button class="btn success-soft" id="pAddAction"><i class="fa-solid fa-plus"></i> ثبت اقدام جدید</button>'}
        </div>
        <div id="pActionsWrap" class="card-pad" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto">
          ${d.actions.length ? d.actions.map(x => `
            <div class="action-row" style="display:flex;gap:10px;align-items:center;padding:9px;background:var(--panel-soft);border-radius:9px" data-id="${x.id || ''}" data-src="${esc(x.source)}">
              <span class="badge ${x.status === 'انجام شده' ? 'ok' : 'warn'} pStatus" style="cursor:${x.source === 'system' ? 'pointer' : 'default'}" title="${x.source === 'system' ? 'کلیک = تغییر وضعیت' : 'از پنل است — وضعیت را آن‌جا عوض کنید'}">${esc(x.status)}</span>
              <span style="flex:1">${esc(x.title)}</span>
              ${x.source === 'system' ? `<button class="btn ghost pDel" style="padding:4px 8px" title="حذف"><i class="fa-solid fa-trash"></i></button>` : `<span class="badge gray" style="font-size:10px">پنل</span>`}
              <span style="color:var(--muted);font-size:11px">${esc(x.date)}</span>
            </div>`).join('')
          : '<div style="color:var(--muted);text-align:center;padding:16px;font-size:12px">هنوز اقدامی ثبت نشده — تیکت‌گذر یا ریت اول را با «ثبت اقدام جدید» یادداشت کنید</div>'}
        </div>
      </div>` : ''}`;

    body.insertAdjacentHTML('beforeend', `<div class="profile-image-note">گزارش عملکرد ${esc(a.name)} · ${esc(periodLabel)}<br>مبنا: تاریخ بررسی هر ریت. نمره‌ی خالی صفر نیست؛ میانگین بر نمره‌های معتبر وزن‌دار است. 1 = رعایت، 0 = عدم رعایت، - = موضوعیت نداشته و خارج از مخرج نرخ؛ — = ثبت‌نشده. اقدام‌ها جدا از بازه‌ی ارزیابی‌اند.</div>`);
    if (!isBatch) {
      const fitBtn = $('#pFitAgentRange', body);
      if (fitBtn && (allRange.from || allRange.to)) {
        fitBtn.addEventListener('click', () => App.setDateRange({ from: allRange.from || '', to: allRange.to || '' }));
      }
      bindCallRedlines($('#pCallHistory', body) || body, historyCalls);
      if (d.actions.length || true) {
        const wrap = $('#pActionsWrap', body);
        const addBtn = $('#pAddAction', body);
        if (addBtn) addBtn.addEventListener('click', () => {
          const title = prompt('عنوان اقدام اصلاحی را وارد کنید:');
          if (!title || !title.trim()) return;
          api.post('/api/actions', { agent: curAgent, title: title.trim() })
            .then((it) => {
              if (!wrap.querySelector('.action-row')) wrap.innerHTML = '';
              const div = document.createElement('div');
              div.className = 'action-row';
              div.style.cssText = 'display:flex;gap:10px;align-items:center;padding:9px;background:var(--panel-soft);border-radius:9px';
              div.dataset.id = it.id;
              div.dataset.src = 'system';
              div.innerHTML = `<span class="badge warn pStatus" style="cursor:pointer">انجام نشده</span>
                <span style="flex:1">${esc(it.title)}</span>
                <button class="btn ghost pDel" style="padding:4px 8px"><i class="fa-solid fa-trash"></i></button>
                <span style="color:var(--muted);font-size:11px">${esc(it.date)}</span>`;
              wrap.prepend(div);
              attachRowHandlers(div);
              toast.success('اقدام ثبت شد');
            })
            .catch((e) => toast.error(e.message));
        });

        function attachRowHandlers(row) {
          const id = +row.dataset.id, src = row.dataset.src;
          const badge = row.querySelector('.pStatus');
          const del = row.querySelector('.pDel');
          if (src !== 'system') return;
          if (badge) badge.addEventListener('click', () => {
            const next = badge.classList.contains('ok') ? 'انجام نشده' : 'انجام شده';
            api.put('/api/actions/' + id, { status: next })
              .then((it) => {
                badge.className = 'badge ' + (it.status === 'انجام شده' ? 'ok' : 'warn') + ' pStatus';
                badge.textContent = it.status;
                toast.success('وضعیت به "' + next + '" تغییر یافت');
              })
              .catch((e) => toast.error(e.message));
          });
          if (del) del.addEventListener('click', () => {
            if (!confirm('این اقدام برای همیشه حذف شود؟')) return;
            api.del('/api/actions/' + id)
              .then(() => { row.remove(); toast.success('حذف شد'); })
              .catch((e) => toast.error(e.message));
          });
        }

        $$('.action-row', wrap).forEach(attachRowHandlers);
      }
    }

    if (allKeys.length) {
      const mkLine = (arr, color) => ({
        label: '', borderColor: color, backgroundColor: color + '33', tension: .35, pointRadius: 3,
        data: allKeys.map(k => { const m = mIdx(arr, k); return m && m.avgScore !== '' ? m.avgScore : null; })
      });
      const chartCanvas = $('#pmChart', body);
      const chartCfg = {
        type: 'line',
        data: {
          labels,
          datasets: [
            Object.assign(mkLine(d.monthly.tickets, '#38bdf8'), { label: 'تیکت' }),
            Object.assign(mkLine(d.monthly.socials, '#a78bfa'), { label: 'سوشال' }),
            Object.assign(mkLine(d.monthly.calls, '#34d399'), { label: 'تماس' })
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, spanGaps: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { min: 0, max: 100 } } }
      };
      if (isBatch) {
        if (chartCanvas && typeof Chart === 'function') {
          try {
            Chart.defaults.font.family = 'Vazirmatn';
            Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
            chartCfg.options.animation = false;
            if (App.styleChart) App.styleChart(chartCfg.options);
            const ch = new Chart(chartCanvas, chartCfg);
            if (opts && Array.isArray(opts.charts)) opts.charts.push(ch);
          } catch (e) {}
        }
      } else {
        App.chart(chartCanvas, chartCfg);
      }
    }
  }

  /* ------------------------------ اکسل ------------------------------ */
  function exportExcel() {
    if (!curData) return;
    const a = curData.agent;
    const rowsT = [['کد تیکت', 'تاریخ بررسی', 'تاریخ تیکت', 'q1', 'q2', 'q3', 'q4', 'ردلاین', 'نمره'], ...curData.tickets.rows.map(r => [r.ticketCode, r.reviewDate, r.ticketDate, r.q1, r.q2, r.q3, r.q4, r.redline, r.score])];
    const rowsS = [['تاریخ بررسی', 'وضعیت', 'شروع', 'پایان', 'دقیقه کاری', 'SLA', 'نمره'], ...curData.socials.rows.map(r => [r.reviewDate, r.responseStatus, r.receiveDate + ' ' + r.receiveTime, r.replyDate + ' ' + r.replyTime, r.durationMin, r.slaStatus, r.score])];
    const callSheets = ['tele', 'account', 'mlm'].map((form) => {
      const calls = curData.calls.rows.filter((r) => r.formType === form);
      const keys = QCReports.criteriaKeys(calls, form, QCParse);
      return { name: FORM_TYPE_FA[form], rows: [
        ['لید', 'شماره تماس', 'نمره', ...keys.map((key) => QCParse.labelOf(form, key)), 'ردلاین', 'علت ردلاین', 'کامنت QC', 'تایم مکالمه', 'زمان شنود', 'تاریخ بررسی'],
        ...calls.map((r) => {
          const d = QCReports.redlineDetails(r);
          return [r.leadName, r.leadPhone, C.normalizeScore(r.score), ...keys.map((key) => C.normalizeTri((r.elements || {})[key])),
            QCReports.hasRedline(r, 'call') ? 1 : '-', QCReports.hasRedline(r, 'call') ? d.text : (d.reason || ''), r.qcComment || '', r.callDuration || '', r.listeningTime || '', r.reviewDate];
        })
      ] };
    }).filter((sheet) => sheet.rows.length > 1);
    const sitSheets = (curData.situational && curData.situational.hasData) ? [{
      name: 'المان‌های موقعیتی',
      rows: [
        ['نمره موقعیتی (calc_situational_score)', curData.situational.avgScore, 'تعداد فرم', curData.situational.formsCount || 0],
        ['المان موقعیتی', 'فرم', 'تعداد موارد (n)', 'نرخ رعایت ٪', 'نرخ عدم رعایت ٪'],
        ...(curData.situational.elements || []).map(el => [el.label, FORM_TYPE_FA[el.form] || el.form, el.n, el.rate, el.errorRate])
      ]
    }] : [];
    const w = curData.weighted;
    const weightedSheet = w && w.activeWeight ? [{
      name: 'نمره کل کارشناس',
      rows: [
        ['بخش ارزیابی', 'وزن رسمی (٪)', 'نمره بخش', 'سهم مؤثر در این کارنامه (٪)', 'وضعیت'],
        ...(w.pillars || []).map(p => [p.label, p.weight, p.active ? p.score : '', p.active ? C.round2(p.weight * 100 / w.activeWeight) : 0, p.active ? 'لحاظ شده در محاسبه' : 'دیتایی موجود نیست']),
        ['نمره کل نهایی', w.activeWeight, w.score, 100, w.activeWeight < w.totalWeight ? 'محاسبه از بخش‌های دارای دیتا' : 'هر ۴ بخش کامل']
      ]
    }] : [];
    window.QCExport.sheets(`${a.name} — پرونده`, [
      ...weightedSheet, { name: 'تیکت', rows: rowsT }, { name: 'سوشال', rows: rowsS }, ...callSheets, ...sitSheets
    ]);
  }

  /* ------------------------------ PDF ------------------------------
   * PDF به‌صورت یکپارچه و بدون صفحه‌بندی (تک‌صفحه پیوسته) ساخته می‌شود تا هیچ
   * جدولی وسط صفحه دو نیم نشود و متن فارسی دقیقاً مطابق تصویر بماند.
   */
  async function exportPdf() {
    if (!curData || !profileBody) return;
    const button = $('#pPdf');
    const label = button ? button.innerHTML : '';
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> ساخت PDF…'; }
    try {
      App.charts.forEach((chart) => { if (chart.update) chart.update('none'); });
      const name = `${curData.agent.name} — کارنامه ${curData.scope.from || 'ابتدا'} تا ${curData.scope.to || 'انتها'}`;
      const out = await QCCapture.downloadPdf(profileBody, name, revealAll);
      toast.success(out.pages === 1 ? 'فایل PDF یکپارچه و بدون صفحه‌بندی آماده شد' : `فایل PDF آماده شد (${fa(out.pages)} صفحه)`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      if (button && button.isConnected) { button.disabled = !curData; button.innerHTML = label; }
    }
  }

  /* ------------------------------ دانلود گروهی کارنامه‌های PDF به تفکیک تیم ------------------------------ */
  async function openBatchPdfModal() {
    if (!window.QCCapture || typeof QCCapture.toPdfBytes !== 'function' || typeof QCCapture.buildZip !== 'function') {
      toast.error('بخش capture.js به‌روزرسانی نشده است؛ ابتدا کد capture.js را جای‌گذاری کنید');
      return;
    }
    let allRows = [];
    try {
      const res = await api.get('/api/portfolio/agents');
      allRows = Array.isArray(res && res.rows) ? res.rows.slice() : [];
    } catch (e) {
      allRows = (lastCombined || []).slice();
    }
    const allTeams = [...new Set(
      teams.concat(allRows.map((r) => r.team).filter(Boolean))
    )].sort();
    const currentSelected = msTeams.getValues();
    const defaultTeam = currentSelected.length === 1 ? currentSelected[0] : '__ALL__';

    let running = false;
    let cancelled = false;

    const teamOptionsHtml = [
      '<option value="__ALL__">همه تیم‌ها</option>'
    ].concat(allTeams.map((t) => {
      const cnt = allRows.filter((r) => QCParse.teamKey(r.team) === QCParse.teamKey(t)).length;
      const sel = defaultTeam === t ? ' selected' : '';
      return '<option value="' + esc(t) + '"' + sel + '>' + esc(QCParse.displayTeam(t)) + ' (' + fa(cnt) + ' کارشناس)</option>';
    })).join('');

    const periodText = App.dateRangeLabel ? App.dateRangeLabel() : ((App.dateRange.from || App.dateRange.to)
      ? ('از ' + fa(App.dateRange.from || 'ابتدا') + ' تا ' + fa(App.dateRange.to || 'انتها'))
      : 'همه تاریخ‌ها');

    const dlg = UI.modal([
      UI.modalHead('دانلود تمام کارنامه‌ها (PDF)', 'fa-file-pdf'),
      '<div class="modal-body" style="display:flex;flex-direction:column;gap:14px">',
      '  <div class="alert info" style="margin:0;display:flex;align-items:center;gap:8px">',
      '    <i class="fa-regular fa-calendar"></i>',
      '    <span>بازه‌ی کارنامه‌ها: <b>' + esc(periodText) + '</b> (مطابق فیلتر تاریخ بالای صفحه)</span>',
      '  </div>',
      '  <div class="field">',
      '    <label for="bpTeam">انتخاب تیم</label>',
      '    <select class="input" id="bpTeam">' + teamOptionsHtml + '</select>',
      '  </div>',
      '  <div style="display:flex;flex-wrap:wrap;gap:14px">',
      '    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="bpActiveOnly" checked> فقط کارشناسان فعال (بدون بایگانی)</label>',
      '    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="bpRatedOnly"> فقط کارشناسان دارای ارزیابی در این بازه</label>',
      '  </div>',
      '  <div class="field">',
      '    <label>فرمت خروجی</label>',
      '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">',
      '      <label style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);cursor:pointer">',
      '        <input type="radio" name="bpMode" value="zip" checked style="margin-top:3px">',
      '        <span><b>فایل ZIP (PDF مجزای هر کارشناس)</b><small style="display:block;color:var(--muted);margin-top:2px">هر کارشناس فایل PDF مستقل با نام خودش داخل یک فایل زیپ</small></span>',
      '      </label>',
      '      <label style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);cursor:pointer">',
      '        <input type="radio" name="bpMode" value="merged" style="margin-top:3px">',
      '        <span><b>یک فایل PDF یکپارچه (کل تیم)</b><small style="display:block;color:var(--muted);margin-top:2px">کارنامه‌ی همه کارشناسان تیم پشت‌سرهم در یک فایل PDF</small></span>',
      '      </label>',
      '    </div>',
      '  </div>',
      '  <div id="bpSummary" style="padding:10px 12px;border-radius:10px;background:var(--panel-soft);font-size:12.5px;line-height:1.8"></div>',
      '  <div id="bpProgressWrap" style="display:none;flex-direction:column;gap:8px">',
      '    <div style="display:flex;justify-content:space-between;font-size:12.5px"><span id="bpProgressText">در حال آماده‌سازی…</span><b id="bpProgressCount">۰٪</b></div>',
      '    <div style="height:10px;background:var(--soft);border-radius:999px;overflow:hidden"><div id="bpProgressFill" style="height:100%;width:0%;background:linear-gradient(90deg,var(--brand),var(--good));transition:width .2s ease"></div></div>',
      '  </div>',
      '</div>',
      '<div class="modal-foot">',
      '  <button type="button" class="btn ghost" id="bpClose">بستن</button>',
      '  <button type="button" class="btn primary" id="bpStart"><i class="fa-solid fa-download"></i> شروع دانلود کارنامه‌ها</button>',
      '</div>'
    ].join('\n'), {
      onClose() { cancelled = true; }
    });

    const teamSel = $('#bpTeam', dlg);
    const activeChk = $('#bpActiveOnly', dlg);
    const ratedChk = $('#bpRatedOnly', dlg);
    const summaryEl = $('#bpSummary', dlg);
    const progWrap = $('#bpProgressWrap', dlg);
    const progText = $('#bpProgressText', dlg);
    const progCount = $('#bpProgressCount', dlg);
    const progFill = $('#bpProgressFill', dlg);
    const startBtn = $('#bpStart', dlg);
    const closeBtn = $('#bpClose', dlg);

    function getTargetRows() {
      const sel = teamSel.value;
      const activeOnly = activeChk.checked;
      const ratedOnly = ratedChk.checked;
      return allRows.filter((r) => {
        if (sel !== '__ALL__' && QCParse.teamKey(r.team) !== QCParse.teamKey(sel)) return false;
        if (activeOnly && r.active === false) return false;
        if (ratedOnly && !(Number(r.totalCount || 0) > 0 || (r.situationalAvg !== '' && r.situationalAvg != null) || r.ticketAvg !== '' || r.socialAvg !== '')) return false;
        return !!r.name;
      }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));
    }

    function updateSummary() {
      const list = getTargetRows();
      const teamName = teamSel.value === '__ALL__' ? 'همه تیم‌ها' : QCParse.displayTeam(teamSel.value);
      if (!list.length) {
        summaryEl.innerHTML = '<span style="color:var(--bad)">هیچ کارشناسی با این فیلتر یافت نشد.</span>';
        startBtn.disabled = true;
        return;
      }
      const preview = list.slice(0, 8).map((r) => esc(r.name)).join('، ') + (list.length > 8 ? ' و ' + fa(list.length - 8) + ' نفر دیگر' : '');
      summaryEl.innerHTML = '<div><b>' + fa(list.length) + ' کارشناس</b> از <b>' + esc(teamName) + '</b> برای ساخت کارنامه PDF انتخاب شده‌اند:</div>' +
        '<div style="color:var(--muted);font-size:11.5px;margin-top:4px">' + preview + '</div>';
      startBtn.disabled = running;
    }

    teamSel.addEventListener('change', updateSummary);
    activeChk.addEventListener('change', updateSummary);
    ratedChk.addEventListener('change', updateSummary);
    updateSummary();

    closeBtn.addEventListener('click', () => {
      if (running) {
        cancelled = true;
        progText.textContent = 'در حال توقف عملیات…';
        closeBtn.disabled = true;
      } else {
        dlg.close();
      }
    });

    const nextFrame = () => new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(resolve));
      else setTimeout(resolve, 16);
    });

    startBtn.addEventListener('click', async () => {
      const targets = getTargetRows();
      if (!targets.length || running) return;
      const modeEl = dlg.querySelector('input[name="bpMode"]:checked');
      const mode = modeEl ? modeEl.value : 'zip';
      const teamLabel = teamSel.value === '__ALL__' ? 'همه تیم‌ها' : QCParse.displayTeam(teamSel.value);
      const periodSlug = (App.dateRange.from || App.dateRange.to)
        ? ((App.dateRange.from || 'ابتدا') + ' تا ' + (App.dateRange.to || 'انتها'))
        : 'همه تاریخ‌ها';

      running = true;
      cancelled = false;
      teamSel.disabled = true;
      activeChk.disabled = true;
      ratedChk.disabled = true;
      $$('input[name="bpMode"]', dlg).forEach((el) => { el.disabled = true; });
      startBtn.disabled = true;
      closeBtn.textContent = 'توقف';
      progWrap.style.display = 'flex';
      progFill.style.width = '2%';

      const stageWrap = document.createElement('div');
      stageWrap.style.cssText = 'position:fixed;left:-100000px;top:0;width:1240px;pointer-events:none;z-index:-1;';
      const stage = document.createElement('div');
      stage.className = 'profile-content';
      stageWrap.appendChild(stage);
      document.body.appendChild(stageWrap);

      const entries = [];
      let mergedPdf = null;
      const failed = [];
      const fetchPortfolio = (name) => api.get('/api/portfolio?ident=' + encodeURIComponent(name));
      let nextPromise = fetchPortfolio(targets[0].name);

      try {
        for (let i = 0; i < targets.length; i++) {
          if (cancelled) break;
          const row = targets[i];
          const pct = Math.round((i / targets.length) * 100);
          progText.textContent = 'در حال ساخت کارنامه ' + fa(i + 1) + ' از ' + fa(targets.length) + ' — ' + row.name + '…';
          progCount.textContent = fa(pct) + '٪';
          progFill.style.width = Math.max(3, pct) + '%';

          const curPromise = nextPromise;
          nextPromise = (i + 1 < targets.length) ? fetchPortfolio(targets[i + 1].name) : null;

          const batchCharts = [];
          try {
            const data = await curPromise;
            if (cancelled) break;
            const scope = data.scope || { from: App.dateRange.from, to: App.dateRange.to };
            data.scope = scope;
            const periodOr = (scope.from || scope.to)
              ? ('از ' + fa(scope.from || 'ابتدا') + ' تا ' + fa(scope.to || 'انتها'))
              : 'همه تاریخ‌ها';
            stage.innerHTML = '';
            renderProfile(stage, data, periodOr, { batch: true, charts: batchCharts });
            await nextFrame();
            batchCharts.forEach((ch) => { try { if (ch && ch.update) ch.update('none'); } catch (e) {} });
            await nextFrame();
            if (cancelled) break;

            if (mode === 'merged') {
              const out = await QCCapture.appendPdf(mergedPdf, stage, revealAll);
              mergedPdf = out.pdf;
            } else {
              const out = await QCCapture.toPdfBytes(stage, revealAll);
              const pdfFile = QCCapture.fileName(data.agent.name + ' — کارنامه ' + periodSlug, 'pdf');
              entries.push({ name: pdfFile, bytes: out.bytes });
            }
          } catch (err) {
            failed.push(row.name + (err && err.message ? ' (' + err.message + ')' : ''));
          } finally {
            batchCharts.forEach((ch) => { try { if (ch && ch.destroy) ch.destroy(); } catch (e) {} });
            stage.innerHTML = '';
          }
        }

        if (cancelled) {
          toast.info('دانلود گروهی کارنامه‌ها متوقف شد');
          return;
        }

        progFill.style.width = '100%';
        progCount.textContent = '۱۰۰٪';
        progText.textContent = 'در حال آماده‌سازی فایل نهایی برای دانلود…';

        const okCount = mode === 'merged' ? (targets.length - failed.length) : entries.length;
        if (!okCount) {
          toast.error('هیچ کارنامه‌ای ساخته نشد' + (failed.length ? ': ' + failed[0] : ''));
          return;
        }

        if (mode === 'merged' && mergedPdf) {
          QCCapture.savePdfDoc(mergedPdf, 'کارنامه‌ها — ' + teamLabel + ' — ' + periodSlug);
        } else {
          const zipBlob = QCCapture.buildZip(entries);
          const zipName = QCCapture.fileName('کارنامه‌ها — ' + teamLabel + ' — ' + periodSlug, 'zip');
          QCCapture.downloadBlob(zipBlob, zipName);
        }

        if (failed.length) {
          toast.info('کارنامه ' + fa(okCount) + ' کارشناس دانلود شد (' + fa(failed.length) + ' خطا: ' + failed.slice(0, 3).join('، ') + ')', 7000);
        } else {
          toast.success(mode === 'merged'
            ? ('فایل PDF یکپارچه شامل ' + fa(okCount) + ' کارنامه از ' + teamLabel + ' دانلود شد')
            : ('فایل ZIP شامل ' + fa(okCount) + ' کارنامه PDF مجزا از ' + teamLabel + ' دانلود شد'));
        }
        dlg.close();
      } finally {
        if (nextPromise) nextPromise.catch(() => {});
        stageWrap.remove();
        running = false;
        if (dlg.isConnected) {
          teamSel.disabled = false;
          activeChk.disabled = false;
          ratedChk.disabled = false;
          $$('input[name="bpMode"]', dlg).forEach((el) => { el.disabled = false; });
          startBtn.disabled = false;
          closeBtn.disabled = false;
          closeBtn.textContent = 'بستن';
        }
      }
    });
  }

  const batchBtn = $('#pBatchPdf', root);
  if (batchBtn) batchBtn.addEventListener('click', openBatchPdfModal);

  App.onDateRangeChange(refresh);
  await renderMaster();
  if (arg && master.isConnected) await pickAgent(decodeURIComponent(arg));
}

App.register('portfolio', { title: 'پرونده کارشناس', render });
})();
