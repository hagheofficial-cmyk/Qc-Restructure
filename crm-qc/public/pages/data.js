/* data.js — مرکز داده: آپلود فایل‌های QC، وضعیت داده‌ها، بک‌اپ/بازیابی، پاک‌سازی
 *
 * یک صفحه برای همه چیز که با دیتا سر و کار دارد:
 *   ۱) نمای کلی: چقدر تیکت/سوشال/تماس روی سیستم است؟
 *   ۲) آپلود اکسل QC تیم‌ها (Telesales/اکانت/MLM) — تشخیص خودکار نوع فرم
 *   ۳) بک‌اپ کامل (همه دیتا یا بازه‌دار) → فایل JSON
 *   ۴) بازیابی از فایل بک‌اپ JSON
 *   ۵) پاک‌سازی دیتای تماس کامل یا بازه‌دار
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, toast, emptyState, debounce, confirmDlg } = UI;

const STANDALONE = location.protocol === 'file:';

function fmtSize(n) {
  if (n < 1024) return n + ' بایت';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

async function render(root) {
  const canonicalTeams = [];
  const seenTeamKeys = new Set();
  for (const t of [...(App.state.teams || []), 'Tele sales', 'Account', 'MLM', 'BNPL']) {
    const clean = String(t || '').trim();
    if (!clean) continue;
    const tk = window.QCParse ? QCParse.teamKey(clean) : clean.toLowerCase();
    if (seenTeamKeys.has(tk)) continue;
    seenTeamKeys.add(tk);
    canonicalTeams.push(clean);
  }
  const importTeamLabel = (t) => {
    const f = window.QCParse ? QCParse.teamForm(t) : null;
    if (f === 'tele') return 'Telesales (تلفنی)';
    if (f === 'account') return 'Account (اکانت)';
    if (/^bnpl$/i.test(String(t || '').trim())) return 'BNPL';
    if (f === 'mlm') return 'MLM';
    return window.QCParse ? QCParse.displayTeam(t) : t;
  };

  root.innerHTML = `
  <div class="page-head">
    <div class="ph-ic"><i class="fa-solid fa-database"></i></div>
    <div>
      <h2>مرکز داده</h2>
      <p>آپلود اکسل‌های QC، وضعیت داده‌های سیستم، بک‌اپ و بازیابی — همه در یک صفحه</p>
    </div>
    <div class="spacer"></div>
    <button class="btn brand" id="btnRescan"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button>
  </div>

  <!-- وضعیت فعلی داده‌ها -->
  <div class="card" style="margin-bottom:16px" id="statusCard">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(56,189,248,.12);color:#38bdf8"><i class="fa-solid fa-chart-column"></i></div>
      <div><h3>وضعیت فعلی داده‌ها</h3><div class="sub" id="statusRange">رکوردهای بازه‌ی انتخاب‌شده، به تفکیک تیم</div></div>
    </div>
    <div class="card-pad">
      <div id="statusRangeAlert" style="display:none;margin-bottom:12px"></div>
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:11px" id="statusGrid">
        <div class="loading-page" style="grid-column:1/-1"><div class="spinner"></div></div>
      </div>
      <div id="statusUndated"></div><div id="statusDiagnostics"></div>
    </div>
    <div class="table-wrap" id="statusTeams"></div>
  </div>

  <!-- آپلود اکسل ریت تماس -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(167,139,250,.12);color:#a78bfa"><i class="fa-solid fa-cloud-arrow-up"></i></div>
      <div>
        <h3>آپلود اکسل‌های ریت تماس (ثابت + موقعیتی)</h3>
        <div class="sub">برای تیم‌های اکانت و تله‌سلز هر دو اکسل (ریز نمرات ثابت + Score Calc موقعیتی) را هم‌زمان بارگذاری کنید تا بازه‌ی زمانی فایل موقعیتی به‌صورت خودکار به فایل ثابت متصل شود.</div>
      </div>
    </div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="field" style="margin:0">
        <label for="importTeam"><i class="fa-solid fa-users-rectangle" style="color:#a78bfa;margin-left:5px"></i>تیم مقصد برای نام‌های ثبت‌نشده (اختیاری)</label>
        <select class="input" id="importTeam">
          <option value="">تشخیص خودکار (از مدیریت کارشناسان و نوع فرم؛ برای MLM/BNPL بدون انتساب حدسی)</option>
          ${canonicalTeams.map(team => `<option value="${esc(team)}">${esc(importTeamLabel(team))}</option>`).join('')}
        </select>
        <small style="color:var(--muted)">تیم کارشناسان ثبت‌شده همیشه از «مدیریت کارشناسان» خوانده می‌شود. فرم‌های <b>Telesales</b> و <b>Account</b> برای نام‌های ثبت‌نشده خودکار به تیم مربوطه منتسب می‌شوند؛ این منو به‌ویژه برای تفکیک <b>MLM / BNPL</b> یا فایل‌های بدون ستون تیم کاربرد دارد.</small>
      </div>
      <!-- جفت‌سازی اختصاصی دو فایل (ثابت + موقعیتی) -->
      <div id="pairBox" style="background:var(--panel-soft);border:1px solid var(--line-soft);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:11px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge blue"><i class="fa-solid fa-link"></i> آپلود جفتی (ثابت + موقعیتی)</span>
          <span style="font-size:12px;color:var(--muted)">بازه زمانی فایل موقعیتی خودکار از تاریخ‌های فایل ثابت استخراج و متصل می‌شود.</span>
        </div>
        <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
          <div style="border:1px dashed var(--line);border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:12px;font-weight:700"><i class="fa-solid fa-table-list" style="color:#38bdf8"></i> ۱) فایل ریز نمرات ثابت</div>
            <div style="font-size:11px;color:var(--muted)" id="pairFixedLabel">نمونه: <code dir="ltr">qc_acc_new_form_*.xlsx</code> یا <code dir="ltr">qc_tele_new_form_*.xlsx</code></div>
            <button type="button" class="btn soft sm" id="pairFixedBtn"><i class="fa-solid fa-file-excel"></i> انتخاب فایل ثابت…</button>
            <input type="file" id="pairFixedInp" accept=".xlsx,.xls,.csv" hidden>
          </div>
          <div style="border:1px dashed var(--line);border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:12px;font-weight:700"><i class="fa-solid fa-sliders" style="color:#a78bfa"></i> ۲) فایل المان‌های موقعیتی (Score Calc)</div>
            <div style="font-size:11px;color:var(--muted)" id="pairSitLabel">نمونه: <code dir="ltr">new_acc_form___score_calc_*.xlsx</code> یا <code dir="ltr">new_tele_form___score_calc_*.xlsx</code></div>
            <button type="button" class="btn soft sm" id="pairSitBtn"><i class="fa-solid fa-file-excel"></i> انتخاب فایل موقعیتی…</button>
            <input type="file" id="pairSitInp" accept=".xlsx,.xls,.csv" hidden>
          </div>
        </div>
        <div id="pairPreview" style="display:none;font-size:12px;padding:8px 11px;border-radius:8px;background:rgba(56,189,248,.08);color:#38bdf8"></div>
        <div id="pairManualPeriod" style="display:none;grid-template-columns:1fr 1fr;gap:10px" class="form-grid">
          <div class="field"><label>از تاریخ بازه موقعیتی (وقتی فایل ثابت انتخاب نشده)</label>
            <input class="input" id="pairPeriodFrom" dir="ltr" style="text-align:right" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۲۵">
          </div>
          <div class="field"><label>تا تاریخ بازه موقعیتی</label>
            <input class="input" id="pairPeriodTo" dir="ltr" style="text-align:right" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۲۰">
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn brand" id="btnPairUpload" disabled><i class="fa-solid fa-cloud-arrow-up"></i> ورود فایل‌های انتخاب‌شده</button>
          <button type="button" class="btn ghost sm" id="btnPairClear" style="display:none"><i class="fa-solid fa-xmark"></i> پاک کردن انتخاب</button>
        </div>
      </div>

      <div id="dropZone" style="border:2px dashed rgba(167,139,250,.35);border-radius:12px;padding:24px;text-align:center;color:var(--muted);font-size:13px;transition:.2s;cursor:pointer">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:28px;color:#a78bfa;display:block;margin-bottom:8px"></i>
        یا همه فایل‌های اکسل QC (ثابت، موقعیتی، MLM) را یکجا اینجا رها کن / <b style="color:#a78bfa">کلیک کن برای انتخاب</b>
        <div style="font-size:11px;margin-top:6px;color:var(--muted)">در انتخاب چندتایی (مثلاً هر ۴ فایل اکانت و تله‌سلز با هم)، هر فایل موقعیتی خودکار به فایل ثابت هم‌تیم متصل می‌شود.</div>
      </div>
      <input type="file" id="qInp" accept=".xlsx,.xls,.csv" multiple hidden>
      <div id="upResult" style="display:none;font-size:12px;padding:9px 12px;border-radius:9px"></div>
      ${!STANDALONE ? `
      <div class="note" style="margin:0">
        <i class="fa-solid fa-circle-info"></i>
        <span><b>روش دوم (بدون آپلود):</b> فایل‌های ثابت و موقعیتی را مستقیم در پوشه‌ی <code style="direction:ltr">crm-qc/data/calls/</code> بگذار — سرور هر ۱۵ ثانیه خودکار جارو و جفت‌سازی می‌کند.</span>
      </div>` : ''}
      <div id="rangeMismatchAlert" style="display:none"></div>
      <div id="filesList" style="font-size:12px"></div>
    </div>
  </div>

  <!-- آپلود اکسل نمرات ماهانه تیکت و پیام‌رسان (دو اکسل جداگانه) -->
  <div class="card" style="margin-bottom:16px" id="monthlyScoresCard">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(52,211,153,.12);color:#34d399"><i class="fa-solid fa-scale-balanced"></i></div>
      <div>
        <h3>نمرات ماهانه تیکت و پیام‌رسان (دو اکسل جداگانه)</h3>
        <div class="sub">وزن رسمی کارنامه کارشناس: <b>المان‌های ثابت تماس ۴۵٪</b> · <b>موقعیتی ۲۵٪</b> · <b>پیام‌رسان ۱۵٪</b> · <b>تیکت ۱۵٪</b></div>
      </div>
    </div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        <!-- اکسل تیکت -->
        <div style="background:var(--panel-soft);border:1px solid var(--line-soft);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px">
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap">
            <span style="font-weight:700;font-size:13px"><i class="fa-solid fa-ticket" style="color:#38bdf8"></i> ۱) اکسل نمرات ماهانه تیکت</span>
            <span class="badge blue" id="msTicketCountBadge">سهم ۱۵٪</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted)">ستون‌ها: <code>نام کارشناس</code>، <code>تیم</code>، <code>از تاریخ</code>، <code>تا تاریخ</code>، <code>نمره تیکت</code> (۰ تا ۱۰۰)، <code>تعداد ارزیابی</code>، <code>توضیحات</code></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn soft sm" id="btnDlTicketSample"><i class="fa-solid fa-download"></i> دانلود نمونه اکسل تیکت</button>
            <button type="button" class="btn brand sm" id="btnUpTicketMonthly"><i class="fa-solid fa-file-arrow-up"></i> آپلود اکسل تیکت…</button>
            <button type="button" class="btn ghost sm" id="btnClrTicketMonthly" style="display:none;color:#f87171"><i class="fa-solid fa-trash-can"></i> پاک‌سازی</button>
            <input type="file" id="monthlyTicketInp" accept=".xlsx,.xls,.csv" hidden>
          </div>
        </div>
        <!-- اکسل پیام‌رسان -->
        <div style="background:var(--panel-soft);border:1px solid var(--line-soft);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px">
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap">
            <span style="font-weight:700;font-size:13px"><i class="fa-solid fa-comments" style="color:#a78bfa"></i> ۲) اکسل نمرات ماهانه پیام‌رسان (سوشال)</span>
            <span class="badge blue" id="msSocialCountBadge">سهم ۱۵٪</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted)">ستون‌ها: <code>نام کارشناس</code>، <code>تیم</code>، <code>از تاریخ</code>، <code>تا تاریخ</code>، <code>نمره پیام‌رسان</code> (۰ تا ۱۰۰)، <code>تعداد ارزیابی</code>، <code>توضیحات</code></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn soft sm" id="btnDlSocialSample"><i class="fa-solid fa-download"></i> دانلود نمونه اکسل پیام‌رسان</button>
            <button type="button" class="btn brand sm" id="btnUpSocialMonthly"><i class="fa-solid fa-file-arrow-up"></i> آپلود اکسل پیام‌رسان…</button>
            <button type="button" class="btn ghost sm" id="btnClrSocialMonthly" style="display:none;color:#f87171"><i class="fa-solid fa-trash-can"></i> پاک‌سازی</button>
            <input type="file" id="monthlySocialInp" accept=".xlsx,.xls,.csv" hidden>
          </div>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>بازه پیش‌فرض از تاریخ (اگر داخل اکسل خالی بود)</label>
          <input class="input" id="msPeriodFrom" dir="ltr" style="text-align:right" inputmode="numeric" placeholder="خودکار از اکسل یا بازه تماس‌ها">
        </div>
        <div class="field"><label>بازه پیش‌فرض تا تاریخ (اگر داخل اکسل خالی بود)</label>
          <input class="input" id="msPeriodTo" dir="ltr" style="text-align:right" inputmode="numeric" placeholder="خودکار از اکسل یا بازه تماس‌ها">
        </div>
      </div>
      <div id="monthlyUpResult" style="display:none;font-size:12px;padding:9px 12px;border-radius:9px"></div>
    </div>
  </div>

  <!-- بک‌اپ و بازیابی -->
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));margin-bottom:16px">
    <div class="card">
      <div class="card-head">
        <div class="head-icon" style="background:var(--good-soft);color:var(--good)"><i class="fa-solid fa-file-import"></i></div>
        <div><h3>بک‌اپ کامل سامانه (انتقال به نسخه جدید)</h3><div class="sub">دانلود یکجای همه دیتا (تیکت، سوشال، تماس ثابت و موقعیتی، نمرات ماهانه، کارشناسان، اقدامات، ماه‌های مالی، کاربران و تنظیمات)</div></div>
      </div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn primary" id="btnBackupAll"><i class="fa-solid fa-cloud-arrow-down"></i> دانلود فوری بکاپ کامل همه داده‌ها (یک کلیک)</button>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="field"><label>از تاریخ (اختیاری)</label>
            <div class="date-f"><input class="input" id="bupFrom" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۱/۰۱">
              <button type="button" class="cal-btn" id="bupFromBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
          <div class="field"><label>تا تاریخ (اختیاری)</label>
            <div class="date-f"><input class="input" id="bupTo" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۱۲/۲۹">
              <button type="button" class="cal-btn" id="bupToBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="input" id="backupYear" inputmode="numeric" dir="ltr" style="width:90px" value="${C.todayJalali().jy}" aria-label="سال بک اپ">
          <select class="input" id="backupMonth" style="width:125px" aria-label="ماه بک اپ">${C.MONTHS_FA.map((name,index)=>`<option value="${index+1}" ${index+1===C.todayJalali().jm?'selected':''}>${name}</option>`).join('')}</select>
          <button class="btn soft" id="backupMonthSet">انتخاب کل ماه</button><button class="btn ghost" id="backupUseGlobal">استفاده از بازه گزارش</button></div>
        <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> برای انتقال به نسخه جدید کد، دکمه آبی «دانلود فوری بکاپ کامل» را بزنید تا کل داده‌های سامانه یکجا ذخیره شوند.</div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn success-soft" id="btnBackup"><i class="fa-solid fa-floppy-disk"></i> دانلود فایل بک‌اپ (با فیلتر تاریخ بالا)</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="head-icon" style="background:var(--warn-soft);color:var(--warn)"><i class="fa-solid fa-file-export"></i></div>
        <div><h3>بازیابی / آپلود روی نسخه جدید</h3><div class="sub">فایل بک‌اپ JSON که از نسخه قبلی دانلود کرده‌اید را اینجا آپلود کنید</div></div>
      </div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="note" style="margin:0">
          <i class="fa-solid fa-circle-info"></i>
          <span>فایل <b>بک‌اپ کامل</b> سامانه را انتخاب کنید — همه داده‌ها (تیکت، سوشال، ریت تماس ثابت و موقعیتی، نمرات ماهانه، کارشناسان، اقدامات، یادآورها، ماه‌های مالی، کاربران QC و تنظیمات) یکجا بازیابی یا ادغام می‌شوند.</span>
        </div>
        <button class="btn soft" id="btnRestoreSel"><i class="fa-solid fa-file-arrow-up"></i> انتخاب و آپلود فایل بکاپ…</button>
        <input type="file" id="restoreInp" accept=".json,application/json" hidden>
        <div id="restoreResult" style="display:none;font-size:12px;padding:9px 12px;border-radius:9px"></div>
      </div>
    </div>
  </div>

  <!-- پاک‌سازی داده‌ها -->
  <div class="card" style="margin-bottom:0">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(248,113,113,.12);color:#f87171"><i class="fa-solid fa-trash-can"></i></div>
      <div><h3>پاک‌سازی داده‌ها</h3><div class="sub">پاک کردن فایل‌های آپلودی (تماس) — بر اساس بازه یا کامل</div></div>
    </div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>از تاریخ (اختیاری)</label>
          <div class="date-f"><input class="input" id="clrFrom" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۰۱">
            <button type="button" class="cal-btn" id="clrFromBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field"><label>تا تاریخ (اختیاری)</label>
          <div class="date-f"><input class="input" id="clrTo" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۳۰">
            <button type="button" class="cal-btn" id="clrToBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
      </div>
      <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> اگر تاریخ نزنی، کل دیتای تماس پاک می‌شود.</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button class="btn danger-soft" id="btnClearCalls"><i class="fa-solid fa-trash-can"></i> پاک کردن تاریخی دیتای تماس</button>
        <button class="btn danger-soft" id="btnClearCallsAll"><i class="fa-solid fa-ban"></i> پاک کردن کامل دیتای تماس</button>
      </div>
    </div>
  </div>
  `;

  /* ------- وضعیت کلی داده‌ها ------- */
  const grid = $('#statusGrid', root), teamTable = $('#statusTeams', root);
  let statusId = 0;
  let lastVisibleStatus = { calls: 0, situational: 0 };
  async function loadStatus() {
    const request = ++statusId;
    if (!grid.isConnected) return;
    try {
      const [b, cm] = await Promise.all([api.get('/api/bootstrap'), api.get('/api/data/status')]);
      if (request !== statusId || !grid.isConnected) return;
      const callCounts = cm.byForm;
      $('#statusRange').textContent = App.dateRangeLabel() + ' · مبنا: تاریخ بررسی فرم';
      grid.innerHTML = `
        ${stat('تیکت‌های ارزیابی', fa(cm.tickets) + (cm.monthlyTicketScores ? ` <small style="font-size:11px;color:var(--muted)">(+${fa(cm.monthlyTicketScores)} ماهانه)</small>` : ''), '#38bdf8')}
        ${stat('سوشال‌های ارزیابی', fa(cm.socials) + (cm.monthlySocialScores ? ` <small style="font-size:11px;color:var(--muted)">(+${fa(cm.monthlySocialScores)} ماهانه)</small>` : ''), '#a78bfa')}
        ${stat('کارشناسان فعال', fa(b.agents.length), '#34d399')}
        ${stat('کارشناسان QC', fa(b.qcAgents.length), '#fbbf24')}
        ${stat('ریت‌های تماس', fa(cm.calls), 'var(--ink)')}
        ${stat('تیم‌ها', fa(cm.byTeam.length), '#ff7a59')}
      ` + (callCounts ? `
        <div style="grid-column:1/-1;background:var(--panel-soft);border-radius:10px;padding:10px 14px;display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
          <span style="color:var(--muted)">تماس‌ها به تفکیک فرم:</span>
          <span>Telesales <b>${fa(callCounts.tele || 0)}</b></span>
          <span>اکانت <b>${fa(callCounts.account || 0)}</b></span>
          <span>MLM <b>${fa(callCounts.mlm || 0)}</b></span>
          ${cm.situational ? `<span style="color:var(--muted);margin-right:8px">| موقعیتی (Score Calc):</span>
            <span>Telesales <b>${fa((cm.situationalByForm && cm.situationalByForm.tele) || 0)}</b></span>
            <span>اکانت <b>${fa((cm.situationalByForm && cm.situationalByForm.account) || 0)}</b></span>` : ''}
          ${(cm.monthlyTicketScores || cm.monthlySocialScores) ? `<span style="color:var(--muted);margin-right:8px">| اکسل ماهانه:</span>
            <span>تیکت <b>${fa(cm.monthlyTicketScores || 0)}</b></span>
            <span>پیام‌رسان <b>${fa(cm.monthlySocialScores || 0)}</b></span>` : ''}
        </div>` : '');
      teamTable.innerHTML = `<table class="tbl"><thead><tr><th>تیم</th><th>تعداد ریت تیکت</th><th>تعداد ریت سوشال</th><th>تعداد ریت تماس</th><th>مجموع داده</th></tr></thead>
        <tbody>${cm.byTeam.map((t) => `<tr><td><span class="tag-team">${esc(t.team)}</span></td>
          <td>${fa(t.ticketCount)}</td><td>${fa(t.socialCount)}</td><td>${fa(t.callCount)}</td><td><b>${fa(t.totalCount)}</b></td></tr>`).join('')}</tbody></table>`;
      $('#statusDiagnostics',root).innerHTML = diagnosticsHTML(cm.diagnostics);
      const undatedSit = (cm.undated && cm.undated.situational) || 0;
      const undated = cm.undated.tickets + cm.undated.socials + cm.undated.calls;
      const undatedParts = [];
      if (undated) undatedParts.push(`${fa(undated)} رکورد بدون تاریخ بررسی معتبر در سامانه وجود دارد (تیکت: ${fa(cm.undated.tickets)}، سوشال: ${fa(cm.undated.socials)}، تماس: ${fa(cm.undated.calls)}).`);
      if (undatedSit) undatedParts.push(`${fa(undatedSit)} رکورد موقعیتی (Score Calc) بدون بازه تاریخ است؛ تا زمان آپلود فایل ثابت هم‌تیم یا ثبت بازه دستی، فقط در «همه تاریخ‌ها» دیده می‌شود.`);
      $('#statusUndated').innerHTML = undatedParts.length ? `<div class="note" style="margin:12px 0 0"><i class="fa-solid fa-circle-info"></i>
        ${undatedParts.join(' ')}
        این رکوردها در «همه تاریخ‌ها» دیده می‌شوند؛ به روز دلخواه نسبت داده نمی‌شوند.</div>` : '';
      lastVisibleStatus = { calls: cm.calls || 0, situational: cm.situational || 0 };
    } catch (e) {
      if (request !== statusId || !grid.isConnected) return;
      teamTable.innerHTML = '';
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fa-solid fa-triangle-exclamation"></i> خطا: ${esc(e.message)}</div>`;
    }
  }
  function diagnosticsHTML(d) {
    if(!d || !(d.unknownExperts.length||d.teamConflicts.length||d.ambiguous))return '';
    const hasMlmUnknown = d.unknownExperts.some(x => (x.forms || []).includes('mlm'));
    const hasAutoUnknown = d.unknownExperts.some(x => (x.forms || []).some(f => f === 'tele' || f === 'account'));
    const unkHint = hasAutoUnknown && !hasMlmUnknown
      ? 'این کارشناسان بر اساس نوع فرم خودکار به تیم Telesales / Account منتسب شده‌اند؛ برای ثبت شماره داخلی و اطلاعات تکمیلی می‌توانید آن‌ها را به مدیریت کارشناسان اضافه کنید.'
      : 'فرم‌های Telesales و Account خودکار به تیم مربوطه منتسب می‌شوند؛ اما نوع فرم MLM به‌تنهایی تیم قطعیِ شخص نیست و اگر «تیم مقصد» مشخص نشده باشد «بدون تیم» می‌ماند.';
    return `<div class="diagnostics"><h4><i class="fa-solid fa-triangle-exclamation"></i> بررسی انتساب کارشناسان به تیم</h4>
      ${d.unknownExperts.length?`<p>${fa(d.unknownExperts.reduce((n,x)=>n+x.count,0))} ریت متعلق به نام‌هایی است که در مدیریت کارشناسان ثبت نشده‌اند. ${unkHint}</p><ul>${d.unknownExperts.map(x=>`<li>${esc(x.name)} — ${fa(x.count)} ریت (${x.forms.map(f=>({tele:'Telesales',account:'Account',mlm:'MLM / BNPL'})[f]||f).join(' / ')})</li>`).join('')}</ul>`:''}
      ${d.teamConflicts.length?`<p>نوع فرم با تیم فعلی این کارشناسان متفاوت است؛ تیم مدیریت بدون تأیید شما عوض نمی‌شود:</p><ul>${d.teamConflicts.map(x=>`<li>${esc(x.name)} — تیم فعلی ${esc(QCParse.displayTeam(x.team))}، فرم ${esc(x.form)}؛ ${fa(x.count)} ریت</li>`).join('')}</ul>`:''}
      ${d.ambiguous?`<p>${fa(d.ambiguous)} تطبیق نام مبهم است و به شخص حدسی منتسب نشده.</p>`:''}<a class="btn soft sm" href="#/agents">بررسی و اصلاح مدیریت کارشناسان</a></div>`;
  }
  function stat(label, val, color) {
    return `<div style="background:var(--panel-soft);border:1px solid var(--line-soft);border-radius:10px;padding:13px 15px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:5px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color}">${val}</div></div>`;
  }

  /* ------- آپلود اکسل QC (ثابت + موقعیتی / جفتی و چندتایی) ------- */
  async function readExcelFile(f) {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    if (!rows.length) throw new Error('فایل خالی است');
    return { name: f.name, rows };
  }

  async function submitCallPayload(payload, errs, extraOpts) {
    const resEl = $('#upResult');
    if (!payload.length) {
      resEl.style.display = '';
      resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = 'var(--bad)';
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> هیچ فایلی خوانده نشد — ${esc((errs || []).join('، '))}`;
      return false;
    }
    if (!root.isConnected) return false;
    const summaryText = payload.map(f => {
      const cls = window.QCParse ? QCParse.classifyCallFile(f.name, f.rows, null, $('#importTeam', root).value) : { kind: 'fixed' };
      return `${f.name} (${cls.kind === 'situational' ? 'موقعیتی' : 'ثابت'} · ${f.rows.length} ردیف)`;
    }).join(' | ');
    const mode = await UI.confirmImport('ورود اکسل ریت', summaryText, 'فقط دیتای فایل‌های هم‌نام انتخاب‌شده جایگزین می‌شود؛ سایر فایل‌ها و تیکت/سوشال محفوظ‌اند.');
    if (!mode) { resEl.style.display = ''; resEl.innerHTML = 'ورود فایل لغو شد؛ داده‌ای تغییر نکرد.'; return false; }
    try {
      const reqBody = Object.assign({ files: payload, mode, team: $('#importTeam', root).value }, extraOpts || {});
      const r = await api.post('/api/calls/files', reqBody);
      if (!root.isConnected) return false;
      const okF = (r.results || []).filter((x) => x.ok);
      const badF = (r.results || []).filter((x) => !x.ok);
      const formFa = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM', ticket: 'تیکت', social: 'پیام‌رسان' };
      const kindFa = (k) => k === 'situational' ? 'موقعیتی' : (k === 'ticket_monthly' ? 'ماهانه تیکت' : (k === 'social_monthly' ? 'ماهانه پیام‌رسان' : 'ثابت'));
      resEl.style.display = '';
      if (okF.length) {
        resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = 'var(--ok)';
        resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> آپلود موفق: ` +
          okF.map((x) => {
            const rangeTxt = (x.periodFrom || x.periodTo) ? ` · بازه: ${fa(x.periodFrom || '—')} تا ${fa(x.periodTo || '—')}` : '';
            return `${esc(x.name)} → ${fa(x.count)} ردیف ${kindFa(x.kind)} (${formFa[x.type] || x.type}${rangeTxt})`;
          }).join(' | ');
      } else {
        resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = 'var(--bad)';
        resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> هیچ ردیف معتبری وارد نشد.`;
      }
      if (badF.length || (errs && errs.length)) {
        resEl.innerHTML += `<div style="margin-top:7px;color:var(--warn);font-size:11px"><i class="fa-solid fa-triangle-exclamation"></i> نادیده‌گرفته: ${esc([...badF.map((x) => x.name + ' (' + (x.reason || 'نامعتبر') + ')'), ...(errs || [])].join('، '))}</div>`;
      }
      const unlinkedSit = okF.filter((x) => x.kind === 'situational' && !x.periodFrom && !x.periodTo);
      if (unlinkedSit.length) {
        resEl.innerHTML += `<div style="margin-top:7px;color:var(--warn);font-size:11.5px"><i class="fa-solid fa-circle-info"></i> فایل موقعیتی بدون بازه تاریخ ثبت شد؛ برای نمایش در بازه‌ی ماهانه، فایل ثابت هم‌تیم را هم آپلود کنید یا بازه‌ی گزارش را روی «همه تاریخ‌ها» بگذارید.</div>`;
      }
      const added = okF.reduce((n, x) => n + (x.changes ? (x.changes.added || 0) : x.count), 0);
      const updated = okF.reduce((n, x) => n + (x.changes ? (x.changes.updated || 0) : 0), 0);
      const duplicates = okF.reduce((n, x) => n + (x.changes ? (x.changes.duplicates || 0) : 0), 0);
      if (App.state && App.state.counts && r.counts) App.state.counts.calls = r.counts.total;

      /* بررسی همخوانی بازه‌ی فایل تازه آپلودشده با بازه‌ی فعال گزارش */
      const batchFroms = okF.map((x) => x.periodFrom).filter(Boolean).sort();
      const batchTos = okF.map((x) => x.periodTo).filter(Boolean).sort();
      const bFrom = batchFroms[0] || '', bTo = batchTos[batchTos.length - 1] || bFrom;
      const ar = App.dateRange || {};
      const completelyOutside = !!(bFrom && bTo && ((ar.from && bTo < ar.from) || (ar.to && bFrom > ar.to)));
      const partiallyClipped = !completelyOutside && !!(bFrom && bTo && ((ar.from && bFrom < ar.from) || (ar.to && bTo > ar.to)));
      if (completelyOutside) {
        await App.setDateRange({ preset: 'custom', from: bFrom, to: bTo });
        toast.success(`${fa(added)} ردیف وارد شد — بازه گزارش خودکار به ${fa(bFrom)} تا ${fa(bTo)} تنظیم شد تا داده‌های جدید نمایش داده شوند`);
      } else {
        toast.success(`${fa(added)} ردیف جدید${updated ? '، ' + fa(updated) + ' بروزرسانی' : ''} وارد شد؛ ${fa(duplicates)} تکراری`);
        if (partiallyClipped) {
          resEl.innerHTML += `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(251,191,36,.25);color:#fbbf24;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span><i class="fa-solid fa-calendar-week"></i> بازه فایل جدید <b>${fa(bFrom)} تا ${fa(bTo)}</b> است ولی بازه فعلی گزارش (<b>${esc(App.dateRangeLabel())}</b>) بخشی از ردیف‌ها را پنهان می‌کند.</span>
            <button type="button" class="btn soft sm" id="btnAlignBatchRange"><i class="fa-solid fa-arrows-left-right"></i> تنظیم بازه روی ${fa(bFrom)} تا ${fa(bTo)}</button>
          </div>`;
          const alignBtn = $('#btnAlignBatchRange', resEl);
          if (alignBtn) alignBtn.addEventListener('click', () => {
            App.setDateRange({ preset: 'custom', from: bFrom, to: bTo });
            toast.success(`بازه گزارش روی ${fa(bFrom)} تا ${fa(bTo)} تنظیم شد`);
          });
        }
        await loadStatus();
        App.refreshCounts(true);
        await loadFiles();
      }
      return true;
    } catch (e) {
      resEl.style.display = '';
      resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> خطا در آپلود: ${esc(e.message)}`;
      return false;
    }
  }

  async function ingest(files) {
    const arr = [...files].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!arr.length) { toast.info('فقط فایل‌های .xlsx / .xls / .csv پذیرفته می‌شود'); return; }
    if (typeof XLSX === 'undefined') { toast.error('کتابخانه‌ی اکسل بارگذاری نشده — از سرور استفاده کنید'); return; }

    const resEl = $('#upResult');
    resEl.style.display = '';
    resEl.style.background = 'rgba(56,189,248,.08)'; resEl.style.color = '#38bdf8';
    resEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> در حال خواندن ${fa(arr.length)} فایل…`;

    const payload = [], errs = [];
    for (const f of arr) {
      try { payload.push(await readExcelFile(f)); }
      catch (e) { errs.push(f.name + ' (' + e.message + ')'); }
    }
    await submitCallPayload(payload, errs);
  }

  /* ------- جفت‌ساز اختصاصی دو فایل (ثابت + موقعیتی) ------- */
  const pairState = { fixed: null, sit: null, fixedRange: null };
  function updatePairUi() {
    const fixedLbl = $('#pairFixedLabel', root), sitLbl = $('#pairSitLabel', root);
    const prevEl = $('#pairPreview', root), manualEl = $('#pairManualPeriod', root);
    const upBtn = $('#btnPairUpload', root), clrBtn = $('#btnPairClear', root);
    const formFa = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM' };
    if (pairState.fixed) {
      fixedLbl.innerHTML = `<b style="color:#34d399"><i class="fa-solid fa-check"></i> ${esc(pairState.fixed.name)}</b> (${fa(pairState.fixed.rows.length)} ردیف${pairState.fixed.formType ? ' · ' + (formFa[pairState.fixed.formType] || pairState.fixed.formType) : ''})`;
    } else {
      fixedLbl.innerHTML = 'نمونه: <code dir="ltr">qc_acc_new_form_*.xlsx</code> یا <code dir="ltr">qc_tele_new_form_*.xlsx</code>';
    }
    if (pairState.sit) {
      sitLbl.innerHTML = `<b style="color:#a78bfa"><i class="fa-solid fa-check"></i> ${esc(pairState.sit.name)}</b> (${fa(pairState.sit.rows.length)} کارشناس${pairState.sit.formType ? ' · ' + (formFa[pairState.sit.formType] || pairState.sit.formType) : ''})`;
    } else {
      sitLbl.innerHTML = 'نمونه: <code dir="ltr">new_acc_form___score_calc_*.xlsx</code> یا <code dir="ltr">new_tele_form___score_calc_*.xlsx</code>';
    }
    const hasAny = !!(pairState.fixed || pairState.sit);
    upBtn.disabled = !hasAny;
    if (pairState.fixed && pairState.sit) {
      upBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ورود جفت فایل انتخاب‌شده (${fa(pairState.fixed.rows.length)} ثابت + ${fa(pairState.sit.rows.length)} موقعیتی)`;
    } else if (pairState.fixed) {
      upBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ورود فایل ثابت انتخاب‌شده (${fa(pairState.fixed.rows.length)} ردیف)`;
    } else if (pairState.sit) {
      upBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ورود فایل موقعیتی انتخاب‌شده (${fa(pairState.sit.rows.length)} کارشناس)`;
    } else {
      upBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ورود فایل‌های انتخاب‌شده`;
    }
    clrBtn.style.display = hasAny ? '' : 'none';
    manualEl.style.display = (!pairState.fixed && pairState.sit) ? 'grid' : 'none';
    if (pairState.fixed && pairState.sit) {
      const r = pairState.fixedRange || {};
      const mismatch = pairState.fixed.formType && pairState.sit.formType && pairState.fixed.formType !== pairState.sit.formType;
      prevEl.style.display = '';
      prevEl.style.background = mismatch ? 'rgba(251,191,36,.12)' : 'rgba(52,211,153,.1)';
      prevEl.style.color = mismatch ? '#fbbf24' : '#34d399';
      prevEl.innerHTML = mismatch
        ? `<i class="fa-solid fa-triangle-exclamation"></i> هشدار: نوع تیم دو فایل یکسان نیست (ثابت: ${formFa[pairState.fixed.formType] || pairState.fixed.formType}، موقعیتی: ${formFa[pairState.sit.formType] || pairState.sit.formType}).`
        : `<i class="fa-solid fa-link"></i> <b>جفت آماده ورود:</b> بازه‌ی فایل موقعیتی خودکار به <b>${fa(r.from || '—')}</b> تا <b>${fa(r.to || '—')}</b> (${formFa[pairState.fixed.formType] || ''}) متصل می‌شود.`;
    } else if (pairState.fixed) {
      const r = pairState.fixedRange || {};
      prevEl.style.display = '';
      prevEl.style.background = 'rgba(56,189,248,.08)'; prevEl.style.color = '#38bdf8';
      prevEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> بازه‌ی شناسایی‌شده از فایل ثابت: <b>${fa(r.from || '—')}</b> تا <b>${fa(r.to || '—')}</b> — می‌توانید فایل موقعیتی متناظر را هم انتخاب کنید.`;
    } else if (pairState.sit) {
      prevEl.style.display = '';
      prevEl.style.background = 'rgba(251,191,36,.1)'; prevEl.style.color = '#fbbf24';
      prevEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> فایل موقعیتی تاریخ ندارد؛ یا فایل ثابت متناظرش را انتخاب کنید، یا بازه‌ی تاریخ را دستی وارد کنید (در غیر این صورت به بازه‌ی آخرین تماس‌های ثبت‌شده‌ی همین تیم متصل می‌شود).`;
    } else {
      prevEl.style.display = 'none';
    }
  }
  async function pickPairFile(slot, file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') { toast.error('کتابخانه‌ی اکسل بارگذاری نشده'); return; }
    try {
      const item = await readExcelFile(file);
      const cls = window.QCParse ? QCParse.classifyCallFile(item.name, item.rows, null, $('#importTeam', root).value) : { kind: slot, formType: null };
      item.formType = cls.formType;
      item.kind = cls.kind;
      if (slot === 'fixed') {
        pairState.fixed = item;
        const parsed = window.QCParse && cls.formType ? QCParse.parseRows(item.rows, cls.formType, {}) : [];
        pairState.fixedRange = window.QCParse ? QCParse.dateRangeOfCalls(parsed) : { from: '', to: '' };
      } else {
        pairState.sit = item;
      }
      updatePairUi();
    } catch (e) { toast.error('خطا در خواندن فایل: ' + e.message); }
  }
  $('#pairFixedBtn', root).addEventListener('click', () => $('#pairFixedInp', root).click());
  $('#pairSitBtn', root).addEventListener('click', () => $('#pairSitInp', root).click());
  $('#pairFixedInp', root).addEventListener('change', (e) => { if (e.target.files[0]) pickPairFile('fixed', e.target.files[0]); e.target.value = ''; });
  $('#pairSitInp', root).addEventListener('change', (e) => { if (e.target.files[0]) pickPairFile('sit', e.target.files[0]); e.target.value = ''; });
  $('#btnPairClear', root).addEventListener('click', () => {
    pairState.fixed = null; pairState.sit = null; pairState.fixedRange = null;
    $('#pairPeriodFrom', root).value = ''; $('#pairPeriodTo', root).value = '';
    updatePairUi();
  });
  $('#btnPairUpload', root).addEventListener('click', async () => {
    const payload = [];
    if (pairState.fixed) payload.push({ name: pairState.fixed.name, rows: pairState.fixed.rows });
    if (pairState.sit) payload.push({ name: pairState.sit.name, rows: pairState.sit.rows });
    const extra = {};
    if (!pairState.fixed && pairState.sit) {
      extra.periodFrom = $('#pairPeriodFrom', root).value.trim();
      extra.periodTo = $('#pairPeriodTo', root).value.trim();
    }
    const ok = await submitCallPayload(payload, [], extra);
    if (ok) {
      pairState.fixed = null; pairState.sit = null; pairState.fixedRange = null;
      $('#pairPeriodFrom', root).value = ''; $('#pairPeriodTo', root).value = '';
      updatePairUi();
    }
  });

  const drop = $('#dropZone');
  const inp = $('#qInp');
  drop.addEventListener('click', () => inp.click());
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.style.borderColor = '#a78bfa'; drop.style.background = 'rgba(167,139,250,.06)';
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.style.borderColor = 'rgba(167,139,250,.35)'; drop.style.background = '';
  }));
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) ingest(e.dataTransfer.files);
  });
  inp.addEventListener('change', () => {
    if (inp.files && inp.files.length) ingest(inp.files);
    inp.value = '';
  });

  /* ------- دانلود نمونه اکسل و آپلود نمرات ماهانه تیکت و پیام‌رسان ------- */
  let lastDataRange = { from: '', to: '' };
  function downloadMonthlyTemplate(channel) {
    if (typeof XLSX === 'undefined') { toast.error('کتابخانه‌ی اکسل بارگذاری نشده'); return; }
    const isSocial = channel === 'social';
    const scoreCol = isSocial ? 'نمره پیام‌رسان' : 'نمره تیکت';
    const defFrom = $('#msPeriodFrom', root).value.trim() || lastDataRange.from || App.dateRange.from || '1405/07/25';
    const defTo = $('#msPeriodTo', root).value.trim() || lastDataRange.to || App.dateRange.to || '1405/08/21';
    const agents = (App.state.agents || []).filter((a) => a.active !== false);
    const sampleRows = (agents.length ? agents : [
      { name: 'کارشناس نمونه ۱', team: 'تله‌سلز' },
      { name: 'کارشناس نمونه ۲', team: 'اکانت' }
    ]).map((a) => ({
      'نام کارشناس': a.name,
      'تیم': a.team || '',
      'از تاریخ': defFrom,
      'تا تاریخ': defTo,
      [scoreCol]: '',
      'تعداد ارزیابی': '',
      'توضیحات': ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 14 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, isSocial ? 'نمرات_پیامرسان' : 'نمرات_تیکت');
    const guide = [
      { 'ستون': 'نام کارشناس', 'توضیح': 'نام دقیق کارشناس مطابق لیست سامانه (اجباری)' },
      { 'ستون': 'تیم', 'توضیح': 'اختیاری — از مدیریت کارشناسان تکمیل می‌شود' },
      { 'ستون': 'از تاریخ / تا تاریخ', 'توضیح': 'بازه دوره مالی به فرمت جلالی مانند 1405/07/25 تا 1405/08/21' },
      { 'ستون': scoreCol, 'توضیح': 'نمره ماهانه بین ۰ تا ۱۰۰ (ردیف‌های خالی هنگام آپلود نادیده گرفته می‌شوند)' },
      { 'ستون': 'تعداد ارزیابی', 'توضیح': 'اختیاری — تعداد تیکت یا مکالمه بررسی‌شده در ماه' },
      { 'ستون': 'سهم در نمره کل', 'توضیح': 'المان‌های ثابت تماس ۴۵٪ · موقعیتی ۲۵٪ · پیام‌رسان ۱۵٪ · تیکت ۱۵٪' }
    ];
    const wsGuide = XLSX.utils.json_to_sheet(guide);
    wsGuide['!cols'] = [{ wch: 22 }, { wch: 68 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'راهنما');
    XLSX.writeFile(wb, isSocial ? 'نمونه_اکسل_نمرات_پیامرسان.xlsx' : 'نمونه_اکسل_نمرات_تیکت.xlsx');
    toast.success(`فایل نمونه ${isSocial ? 'پیام‌رسان' : 'تیکت'} با ${fa(sampleRows.length)} کارشناس دانلود شد`);
  }

  async function ingestMonthly(channel, file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') { toast.error('کتابخانه‌ی اکسل بارگذاری نشده'); return; }
    const resEl = $('#monthlyUpResult', root);
    const chFa = channel === 'social' ? 'پیام‌رسان (سوشال)' : 'تیکت';
    resEl.style.display = '';
    resEl.style.background = 'rgba(56,189,248,.08)'; resEl.style.color = '#38bdf8';
    resEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> در حال خواندن فایل ${esc(file.name)}…`;
    try {
      const item = await readExcelFile(file);
      const mode = await UI.confirmImport(`ورود اکسل نمرات ماهانه ${chFa}`, `${item.name} (${item.rows.length} ردیف)`, `فقط نمرات ماهانه ${chFa} با فایل جدید جایگزین/ادغام می‌شود؛ ریت‌های تماس و سایر کانال‌ها محفوظ‌اند.`);
      if (!mode) { resEl.textContent = 'عملیات لغو شد؛ داده‌ای تغییر نکرد.'; return; }
      const r = await api.post('/api/monthly-scores/files', {
        files: [item], mode, channel,
        periodFrom: $('#msPeriodFrom', root).value.trim(),
        periodTo: $('#msPeriodTo', root).value.trim()
      });
      const first = (r.results || [])[0];
      if (!first || !first.ok) {
        resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
        resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${esc((first && first.reason) || 'هیچ ردیف نمره‌داری یافت نشد')}`;
        return;
      }
      resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = '#34d399';
      const rangeTxt = (first.periodFrom || first.periodTo) ? ` · بازه: ${fa(first.periodFrom || '—')} تا ${fa(first.periodTo || '—')}` : '';
      resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ورود موفق <b>${esc(first.name)}</b> → ${fa(first.count)} کارشناس (${chFa}${rangeTxt})`;
      toast.success(`نمرات ماهانه ${chFa} (${fa(first.count)} کارشناس) ثبت شد`);
      await loadStatus(); App.refreshCounts(true); await loadFiles();
    } catch (e) {
      resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> خطا: ${esc(e.message)}`;
    }
  }

  $('#btnDlTicketSample', root).addEventListener('click', () => downloadMonthlyTemplate('ticket'));
  $('#btnDlSocialSample', root).addEventListener('click', () => downloadMonthlyTemplate('social'));
  $('#btnUpTicketMonthly', root).addEventListener('click', () => $('#monthlyTicketInp', root).click());
  $('#btnUpSocialMonthly', root).addEventListener('click', () => $('#monthlySocialInp', root).click());
  $('#monthlyTicketInp', root).addEventListener('change', (e) => { if (e.target.files[0]) ingestMonthly('ticket', e.target.files[0]); e.target.value = ''; });
  $('#monthlySocialInp', root).addEventListener('change', (e) => { if (e.target.files[0]) ingestMonthly('social', e.target.files[0]); e.target.value = ''; });
  $('#btnClrTicketMonthly', root).addEventListener('click', () => confirmDlg('پاک‌سازی نمرات ماهانه تیکت', 'همه‌ی نمرات ماهانه واردشده از اکسل تیکت حذف شود؟', async () => {
    const r = await api.del('/api/monthly-scores?channel=ticket');
    toast.success(`${fa(r.removed || 0)} ردیف تیکت ماهانه پاک شد`);
    loadStatus(); App.refreshCounts(true); loadFiles();
  }, 'بله، پاک شود'));
  $('#btnClrSocialMonthly', root).addEventListener('click', () => confirmDlg('پاک‌سازی نمرات ماهانه پیام‌رسان', 'همه‌ی نمرات ماهانه واردشده از اکسل پیام‌رسان حذف شود؟', async () => {
    const r = await api.del('/api/monthly-scores?channel=social');
    toast.success(`${fa(r.removed || 0)} ردیف پیام‌رسان ماهانه پاک شد`);
    loadStatus(); App.refreshCounts(true); loadFiles();
  }, 'بله، پاک شود'));

  /* ------- فایل‌های منبع (تمام فایل‌های آپلودی و پوشه‌ای) ------- */
  async function loadFiles() {
    const fl = $('#filesList', root);
    const alertEl = $('#rangeMismatchAlert', root);
    const topAlertEl = $('#statusRangeAlert', root);
    if (!fl) return;
    try {
      const st = await api.get('/api/calls/dirstatus');
      lastDataRange = (st && st.dataRange) || { from: '', to: '' };
      const cnt = (st && st.counts) || {};
      const tBadge = $('#msTicketCountBadge', root), sBadge = $('#msSocialCountBadge', root);
      const tClr = $('#btnClrTicketMonthly', root), sClr = $('#btnClrSocialMonthly', root);
      if (tBadge) tBadge.textContent = cnt.monthlyTicket ? `${fa(cnt.monthlyTicket)} کارشناس · سهم ۱۵٪` : 'سهم ۱۵٪';
      if (sBadge) sBadge.textContent = cnt.monthlySocial ? `${fa(cnt.monthlySocial)} کارشناس · سهم ۱۵٪` : 'سهم ۱۵٪';
      if (tClr) tClr.style.display = cnt.monthlyTicket ? '' : 'none';
      if (sClr) sClr.style.display = cnt.monthlySocial ? '' : 'none';

      /* بررسی همخوانی بازه‌ی داده‌های بارگذاری‌شده با بازه‌ی فعال گزارش */
      const dr = lastDataRange;
      const ar = App.dateRange || {};
      const totalCalls = cnt.total || 0;
      const totalSit = cnt.situational || 0;
      const visCalls = lastVisibleStatus.calls || 0;
      const visSit = lastVisibleStatus.situational || 0;
      const hasAnyStored = totalCalls > 0 || totalSit > 0;
      const hiddenAll = hasAnyStored && visCalls === 0 && visSit === 0 && !!(ar.from || ar.to);
      const clipped = hasAnyStored && ((dr.from && ar.from && dr.from < ar.from) || (dr.to && ar.to && dr.to > ar.to) || (totalCalls > visCalls));
      const renderRangeAlert = (target, idPrefix) => {
        if (!target) return;
        if (hiddenAll || clipped) {
          target.style.display = '';
          const bg = hiddenAll ? 'rgba(248,113,113,.1)' : 'rgba(251,191,36,.1)';
          const bd = hiddenAll ? 'rgba(248,113,113,.38)' : 'rgba(251,191,36,.35)';
          const icColor = hiddenAll ? '#f87171' : '#fbbf24';
          const rangeSpan = (dr.from || dr.to) ? `<b>${fa(dr.from || '—')} تا ${fa(dr.to || '—')}</b>` : 'بدون بازه تاریخ مشخص';
          const msg = hiddenAll
            ? `در بازه‌ی فعال فعلی (<b>${esc(App.dateRangeLabel())}</b>) هیچ ردیفی نمایش داده نمی‌شود، در حالی که <b>${fa(totalCalls)}</b> ردیف تماس${totalSit ? ` و <b>${fa(totalSit)}</b> رکورد موقعیتی` : ''} در بازه‌ی ${rangeSpan} ذخیره شده است.`
            : `بازه فایل‌های بارگذاری‌شده ${rangeSpan} است، اما بازه‌ی فعال فعلی (<b>${esc(App.dateRangeLabel())}</b>) بخشی از ردیف‌ها را فیلتر می‌کند (نمایش <b>${fa(visCalls)}</b> از <b>${fa(totalCalls)}</b> ریت تماس).`;
          target.innerHTML = `<div class="note" style="margin:0;background:${bg};border-color:${bd};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <i class="fa-solid ${hiddenAll ? 'fa-triangle-exclamation' : 'fa-calendar-week'}" style="color:${icColor}"></i>
            <span style="flex:1">${msg}</span>
            ${(dr.from && dr.to) ? `<button type="button" class="btn soft sm" id="${idPrefix}Align"><i class="fa-solid fa-arrows-left-right"></i> تنظیم بازه روی کل فایل‌ها</button>` : ''}
            <button type="button" class="btn ghost sm" id="${idPrefix}All"><i class="fa-solid fa-infinity"></i> همه تاریخ‌ها</button>
          </div>`;
          const btnA = $('#' + idPrefix + 'Align', target);
          if (btnA) btnA.addEventListener('click', () => {
            App.setDateRange({ preset: 'custom', from: dr.from, to: dr.to });
            toast.success(`بازه گزارش روی ${fa(dr.from)} تا ${fa(dr.to)} تنظیم شد`);
          });
          const btnAll = $('#' + idPrefix + 'All', target);
          if (btnAll) btnAll.addEventListener('click', () => {
            App.setDateRange({ preset: 'all', from: '', to: '' });
            toast.success('بازه گزارش روی «همه تاریخ‌ها» تنظیم شد');
          });
        } else {
          target.style.display = 'none';
          target.innerHTML = '';
        }
      };
      renderRangeAlert(topAlertEl, 'btnTopRange');
      renderRangeAlert(alertEl, 'btnAlignDataRange');

      const files = (st.files || []).filter((f) => !f.skipped && f.rows > 0);
      if (!files.length) {
        fl.innerHTML = `<div style="color:var(--muted);text-align:center;padding:8px 0"><i class="fa-solid fa-inbox"></i> هنوز فایلی در سیستم بارگذاری نشده است</div>`;
        return;
      }
      const formFa = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM', ticket: 'تیکت', social: 'پیام‌رسان' };
      const kindMeta = {
        form: { label: 'ثابت تماس', cls: 'good', color: '#34d399', icon: 'fa-file-excel' },
        situational: { label: 'موقعیتی (Score Calc)', cls: 'blue', color: '#a78bfa', icon: 'fa-sliders' },
        ticket_monthly: { label: 'ماهانه تیکت', cls: 'blue', color: '#38bdf8', icon: 'fa-ticket' },
        social_monthly: { label: 'ماهانه پیام‌رسان', cls: 'blue', color: '#f472b6', icon: 'fa-comments' },
        recovery: { label: 'بک‌اپ پنل', cls: 'good', color: '#fbbf24', icon: 'fa-file-code' }
      };
      fl.innerHTML = `<div style="border-top:1px solid var(--line-soft);padding-top:10px;margin-top:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:7px">فایل‌های منبع بارگذاری‌شده (${fa(files.length)} فایل — تعداد ردیف کل فایل، مستقل از بازه‌ی گزارش):</div>
        <div class="table-wrap"><table class="tbl" style="font-size:12px;margin:0">
          <thead><tr><th>نام دقیق فایل</th><th>دسته</th><th>تیم / کانال</th><th>بازه زمانی</th><th>ردیف‌ها</th><th>منبع</th><th>عملیات</th></tr></thead>
          <tbody>${files.map((f) => {
            const km = kindMeta[f.kind] || kindMeta.form;
            const rangeTxt = (f.periodFrom || f.periodTo) ? `${fa(f.periodFrom || '—')} تا ${fa(f.periodTo || '—')}` : '—';
            const srcTxt = f.origin === 'disk' ? (f.size != null ? `پوشه سرور (${fmtSize(f.size)})` : 'پوشه سرور') : 'آپلود مرورگر';
            return `<tr>
              <td dir="ltr" title="${esc(f.name)}" style="text-align:left;word-break:break-all;font-family:monospace;font-size:11.5px"><i class="fa-solid ${km.icon}" style="color:${km.color};margin-left:5px"></i>${esc(f.name)}</td>
              <td><span class="badge ${km.cls}">${km.label}</span></td>
              <td>${esc(formFa[f.type] || f.detected || f.type || '—')}</td>
              <td style="white-space:nowrap">${rangeTxt}</td>
              <td><b>${fa(f.rows)}</b></td>
              <td style="color:var(--muted);white-space:nowrap">${srcTxt}</td>
              <td style="white-space:nowrap">
                <button type="button" class="btn danger-soft sm btn-del-file" data-file="${esc(f.name)}" data-kind="${esc(f.kind)}" data-rows="${f.rows}" data-label="${esc(km.label)}" title="حذف این فایل و تمام ردیف‌های آن">
                  <i class="fa-solid fa-trash-can"></i> حذف
                </button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
      $$('.btn-del-file', fl).forEach((btn) => {
        btn.addEventListener('click', () => {
          const fileName = btn.dataset.file || '';
          const kind = btn.dataset.kind || '';
          const rowsCount = Number(btn.dataset.rows || 0);
          const lbl = btn.dataset.label || 'فایل';
          confirmDlg(
            'حذف فایل منبع',
            `فایل «${fileName}» (${lbl} · ${fa(rowsCount)} ردیف) از سامانه حذف شود؟ سایر فایل‌ها و داده‌ها بدون تغییر باقی می‌مانند.`,
            async () => {
              btn.disabled = true;
              try {
                const qs = '?name=' + encodeURIComponent(fileName) + (kind ? '&kind=' + encodeURIComponent(kind) : '');
                const r = await api.del('/api/calls/files' + qs);
                if (App.state && App.state.counts && r.counts) App.state.counts.calls = r.counts.total;
                toast.success(`فایل «${fileName}» حذف شد (${fa(r.totalRemoved || 0)} ردیف)`);
                await loadStatus();
                App.refreshCounts(true);
                await loadFiles();
              } catch (e) {
                btn.disabled = false;
                toast.error(e.message);
              }
            },
            'بله، فایل حذف شود'
          );
        });
      });
    } catch (e) { fl.innerHTML = ''; }
  }

  /* ------- تقویم‌های بک‌اپ / پاک‌سازی ------- */
  JCal.attach($('#bupFromBtn'), { input:$('#bupFrom'), onPick(j) { $('#bupFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#bupToBtn'), { input:$('#bupTo'), onPick(j) { $('#bupTo').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrFromBtn'), { input:$('#clrFrom'), onPick(j) { $('#clrFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrToBtn'), { input:$('#clrTo'), onPick(j) { $('#clrTo').value = j ? C.formatJalali(j) : ''; } });

  $('#backupMonthSet',root).addEventListener('click',()=>{
    const range=C.jalaliMonthRange(Number(C.faToEn($('#backupYear',root).value)),Number($('#backupMonth',root).value));
    if(!range){toast.error('سال یا ماه نامعتبر است');return;} $('#bupFrom').value=C.formatJalali(range.from);$('#bupTo').value=C.formatJalali(range.to);
  });
  $('#backupUseGlobal',root).addEventListener('click',()=>{$('#bupFrom').value=App.dateRange.from;$('#bupTo').value=App.dateRange.to;});

  /* ------- بک‌اپ کامل ------- */
  $('#btnBackupAll').addEventListener('click', async () => {
    const b = $('#btnBackupAll'); b.disabled = true;
    try {
      const data = await App.downloadFullBackup();
      toast.success(`بکاپ کامل دانلود شد — ${fa((data.agents || []).length)} کارشناس / ${fa((data.tickets || []).length)} تیکت / ${fa((data.socials || []).length)} سوشال / ${fa((data.callFeedbacks || []).length)} تماس ثابت / ${fa((data.callSituational || []).length)} موقعیتی / ${fa((data.monthlyScores || []).length)} نمره ماهانه`);
    } catch (e) { toast.error(e.message); }
    b.disabled = false;
  });

  $('#btnBackup').addEventListener('click', async () => {
    const b = $('#btnBackup'); b.disabled = true;
    try {
      const rawRange={from:$('#bupFrom').value.trim(),to:$('#bupTo').value.trim()};
      const error=QCReports.validateRange(rawRange);if(error)throw new Error(error);
      const fromJ=C.parseDate(rawRange.from),toJ=C.parseDate(rawRange.to);
      const from = fromJ ? C.formatJalali(fromJ) : '';
      const to = toJ ? C.formatJalali(toJ) : '';
      const data = await App.downloadFullBackup({ from, to });
      toast.success(`بک‌اپ دانلود شد — ${fa(data.agents.length)} کارشناس / ${fa(data.tickets.length)} تیکت / ${fa(data.socials.length)} سوشال / ${fa((data.callFeedbacks || []).length)} تماس`);
    } catch (e) { toast.error(e.message); }
    b.disabled = false;
  });

  /* ------- بازیابی ------- */
  $('#btnRestoreSel').addEventListener('click', () => $('#restoreInp').click());
  $('#restoreInp').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const obj = JSON.parse(rd.result);
        const isBackup = obj.schema === 'crm-qc-backup';
        const isRecovery = obj.teleRawData || obj.accRawData || obj.mlmRawData;
        if (!isBackup && !isRecovery) throw new Error('این فایل بک‌اپ سامانه یا فایل بازیابی پنل ریت نیست');
        const resEl = $('#restoreResult');
        resEl.style.display = '';
        const summary=isBackup ? `${(obj.agents||[]).length} کارشناس، ${(obj.tickets||[]).length} تیکت، ${(obj.socials||[]).length} سوشال، ${(obj.callFeedbacks||[]).length} تماس ثابت، ${(obj.callSituational||[]).length} موقعیتی، ${(obj.monthlyScores||[]).length} نمره ماهانه · بازه ${obj.range&&obj.range.from||'ابتدا'} تا ${obj.range&&obj.range.to||'انتها'}` : `${(obj.teleRawData||[]).length+(obj.accRawData||[]).length+(obj.mlmRawData||[]).length} ریت تماس`;
        const mode=await UI.confirmImport(isBackup?'ورود آرشیو / بک‌اپ کامل':'ورود فایل ریت',summary,isBackup?'تمام دیتای فعلی سامانه (تیکت، سوشال، تماس ثابت و موقعیتی، نمرات ماهانه، کارشناسان، اقدامات، ماه‌های مالی و تنظیمات) با محتویات این بک‌اپ جایگزین می‌شود.':'فقط ریت‌های منبع qc_recovery.json جایگزین می‌شوند؛ سایر منابع محفوظ‌اند.');
        if(!mode){resEl.textContent='عملیات لغو شد؛ دیتای فعلی تغییر نکرد.';return;}
        try {
          const r=isBackup?await api.post('/api/backup',{backup:obj,mode}):await api.post('/api/calls',{recovery:obj,mode});
          if (isBackup && obj.callReportStorage && App.applyBrowserCallReportStorage) App.applyBrowserCallReportStorage(obj.callReportStorage);
          if(!root.isConnected)return;
          resEl.style.background='var(--good-soft)';resEl.style.color='var(--good)';
          resEl.textContent=isBackup?`${mode==='append'?'ادغام':'جایگزینی'} موفق — اکنون ${r.restored.tickets} تیکت، ${r.restored.socials} سوشال، ${r.restored.calls} تماس ثابت، ${r.restored.callSituational || 0} موقعیتی، ${r.restored.monthlyScores || 0} نمره ماهانه و ${r.restored.agents} کارشناس موجود است.`:'ورود ریت با روش انتخاب‌شده انجام شد.';
          toast.success(mode==='append'?'داده اضافه شد؛ آرشیو قبلی محفوظ است':'داده با تأیید شما جایگزین شد');
          await App.boot();await loadStatus();loadFiles();
        } catch(error){resEl.style.color='var(--bad)';resEl.textContent='خطا: '+error.message;}

      } catch (ex) { toast.error(ex.message || 'فایل نامعتبر'); }
      e.target.value = '';
    };
    rd.readAsText(f, 'utf-8');
  });

  /* ------- پاک‌سازی تاریخی / کامل ------- */
  $('#btnClearCalls').addEventListener('click', () => {
    const rawRange={from:$('#clrFrom').value.trim(),to:$('#clrTo').value.trim()};
    const error=QCReports.validateRange(rawRange);if(error){toast.error(error);return;}
    const fromJ=C.parseDate(rawRange.from),toJ=C.parseDate(rawRange.to);
    if (!fromJ && !toJ) { toast.info('حداقل یک تاریخ را انتخاب کنید، یا دکمه «پاک کردن کامل» را بزنید'); return; }
    const from = fromJ ? C.formatJalali(fromJ) : '';
    const to = toJ ? C.formatJalali(toJ) : '';
    confirmDlg('پاک‌سازی بازه‌دار دیتای تماس',
      `ردیف‌هایی که تاریخ بررسی آنان بین ${from ? esc(fa(from)) : 'شروع'} و ${to ? esc(fa(to)) : 'پایان'} است پاک می‌شود. فایل‌های آپلودی در پوشه باقی می‌مانند و سرور دوباره جارو می‌کند.`,
      async () => {
        try {
          const qs = '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
          const r = await api.del('/api/calls' + qs);
          toast.success(`${fa(r.removed || 0)} ردیف پاک شد`);
          await loadStatus();
          App.refreshCounts(true);
          await loadFiles();
        } catch (e) { toast.error(e.message); }
      },
      'بله، پاک شود'
    );
  });

  $('#btnClearCallsAll').addEventListener('click', () => {
    confirmDlg('پاک‌سازی کامل دیتای تماس',
      'همه ردیف‌های ریت تماس (ثابت و موقعیتی برای Telesales، اکانت و MLM) پاک می‌شوند و تا زمان آپلود مجدد یا تغییر فایل جدید دوباره وارد نخواهند شد.',
      async () => {
        try {
          const r = await api.del('/api/calls');
          if (App.state && App.state.counts) App.state.counts.calls = 0;
          toast.success(`پاک شد — ${fa((r.removed || 0) + (r.removedSituational || 0))} ردیف`);
          await loadStatus();
          App.refreshCounts(true);
          await loadFiles();
        } catch (e) { toast.error(e.message); }
      },
      'بله، پاک شود'
    );
  });

  $('#importTeam', root).addEventListener('change', () => {
    if (pairState.fixed && window.QCParse) {
      const cls = QCParse.classifyCallFile(pairState.fixed.name, pairState.fixed.rows, null, $('#importTeam', root).value);
      pairState.fixed.formType = cls.formType;
    }
    if (pairState.sit && window.QCParse) {
      const cls = QCParse.classifyCallFile(pairState.sit.name, pairState.sit.rows, null, $('#importTeam', root).value);
      pairState.sit.formType = cls.formType;
    }
    updatePairUi();
  });

  $('#btnRescan').addEventListener('click', async () => { await loadStatus(); await loadFiles(); toast.info('تازه‌سازی شد'); });

  App.onDateRangeChange(async () => { await loadStatus(); await loadFiles(); });
  await loadStatus();
  await loadFiles();
}

App.register('data', { title: 'مرکز داده', render });
})();
