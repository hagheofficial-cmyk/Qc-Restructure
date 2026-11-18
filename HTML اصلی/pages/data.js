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

  <!-- اتصال به گوگل درایو و بکاپ خودکار ابری -->
  <div class="card" id="driveBackupCard" style="margin-bottom:16px">
    <div class="card-head">
      <div class="head-icon" style="background:var(--brand-soft);color:var(--brand)"><i class="fa-brands fa-google-drive"></i></div>
      <div style="flex:1">
        <h3>اتصال به گوگل درایو و بکاپ خودکار ابری</h3>
        <div class="sub">اتصال مستقیم به پوشه گوگل درایو، زمان‌بندی خودکار پشتیبان‌گیری، مشاهده و مقایسه محتوای بکاپ‌ها روی سامانه و بازگردانی ایمن</div>
      </div>
      <span class="badge soft" id="drvStatusBadge">در حال بررسی…</span>
    </div>
    <div class="card-pad" id="drvBody" style="display:flex;flex-direction:column;gap:12px">
      <div class="note" style="margin:0"><i class="fa-solid fa-spinner fa-spin"></i> در حال خواندن وضعیت اتصال گوگل درایو…</div>
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

  /* ------- اتصال به گوگل درایو، زمان‌بندی بکاپ خودکار، مشاهده و بازگردانی ------- */
  const DRV_SCHED_LABELS = {
    off: 'فقط دستی (بدون زمان‌بندی)',
    '6h': 'هر ۶ ساعت یک‌بار',
    '12h': 'هر ۱۲ ساعت یک‌بار',
    daily: 'روزانه',
    weekly: 'هفتگی'
  };
  const DRV_WEEK_LABELS = { 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنج‌شنبه', 5: 'جمعه', 6: 'شنبه', 7: 'یک‌شنبه' };
  const DRV_TRIG_META = {
    auto: { label: 'خودکار', cls: 'good', icon: 'fa-clock-rotate-left' },
    manual: { label: 'دستی', cls: 'info', icon: 'fa-hand' },
    connect: { label: 'اتصال اولیه', cls: 'info', icon: 'fa-plug-circle-check' },
    'pre-restore': { label: 'ایمنی پیش از بازگردانی', cls: 'warn', icon: 'fa-shield-halved' }
  };
  let driveState = null;
  let driveCfgOpen = false;

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return fa((v / (1024 * 1024)).toFixed(2)) + ' مگابایت';
    if (v >= 1024) return fa(Math.round(v / 1024)) + ' کیلوبایت';
    return fa(v) + ' بایت';
  }
  function fmtIsoJalali(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return esc(String(iso));
    const j = C.gregorianToJalali ? C.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()) : null;
    const pad = (x) => String(x).padStart(2, '0');
    const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return j ? (fa(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`) + ' · ' + fa(time)) : fa(iso.slice(0, 16).replace('T', ' '));
  }
  function schedSummary(cfg) {
    if (!cfg || !cfg.schedule || cfg.schedule === 'off') return 'فقط دستی (زمان‌بندی خاموش)';
    const pad = (x) => String(x).padStart(2, '0');
    if (cfg.schedule === 'daily') return `روزانه ساعت ${fa(pad(cfg.hour || 0) + ':00')}`;
    if (cfg.schedule === 'weekly') return `هفتگی (${DRV_WEEK_LABELS[cfg.dayOfWeek] || 'جمعه'} ساعت ${fa(pad(cfg.hour || 0) + ':00')})`;
    return DRV_SCHED_LABELS[cfg.schedule] || cfg.schedule;
  }
  function hourOptionsHtml(sel) {
    let out = '';
    for (let h = 0; h < 24; h++) {
      const lbl = fa(String(h).padStart(2, '0') + ':00');
      out += `<option value="${h}" ${Number(sel) === h ? 'selected' : ''}>${lbl}</option>`;
    }
    return out;
  }
  function scheduleFormHtml(cfg, isConnect) {
    const c = cfg || { schedule: 'daily', hour: 2, dayOfWeek: 5, maxKeep: 30, folderName: 'پشتیبان‌گیری سامانه QC' };
    const showHour = c.schedule === 'daily' || c.schedule === 'weekly';
    const showDay = c.schedule === 'weekly';
    return `
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div class="field" style="grid-column:1 / -1">
          <label>پوشه مقصد در گوگل درایو (اختیاری)</label>
          <input class="input" id="drvFolderInput" value="${esc(c.folderUrl || '')}" placeholder="لینک یا شناسه پوشه موجود در درایو (خالی = پوشه خودکار «${esc(c.folderName || 'پشتیبان‌گیری سامانه QC')}»)">
        </div>
        <div class="field">
          <label>بازه زمان‌بندی بکاپ خودکار</label>
          <select class="input" id="drvSchedule">
            <option value="6h" ${c.schedule === '6h' ? 'selected' : ''}>هر ۶ ساعت یک‌بار</option>
            <option value="12h" ${c.schedule === '12h' ? 'selected' : ''}>هر ۱۲ ساعت یک‌بار</option>
            <option value="daily" ${c.schedule === 'daily' ? 'selected' : ''}>روزانه (پیشنهادی)</option>
            <option value="weekly" ${c.schedule === 'weekly' ? 'selected' : ''}>هفتگی</option>
            <option value="off" ${c.schedule === 'off' ? 'selected' : ''}>فقط دستی (بدون زمان‌بندی)</option>
          </select>
        </div>
        <div class="field" id="drvHourWrap" style="${showHour ? '' : 'display:none'}">
          <label>ساعت اجرای بکاپ خودکار</label>
          <select class="input" id="drvHour">${hourOptionsHtml(c.hour == null ? 2 : c.hour)}</select>
        </div>
        <div class="field" id="drvDayWrap" style="${showDay ? '' : 'display:none'}">
          <label>روز هفته</label>
          <select class="input" id="drvDay">
            ${[6, 7, 1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${Number(c.dayOfWeek || 5) === d ? 'selected' : ''}>${DRV_WEEK_LABELS[d]}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>سقف نگهداری نسخه‌ها (پاک‌سازی قدیمی‌ترها)</label>
          <input class="input" id="drvMaxKeep" type="number" min="5" max="200" value="${Number(c.maxKeep) || 30}">
        </div>
      </div>
      ${isConnect ? `<label style="display:flex;align-items:center;gap:8px;font-size:12.6px;cursor:pointer">
        <input type="checkbox" id="drvInitSnap" checked>
        <span>بلافاصله پس از اتصال، اولین بکاپ کامل روی گوگل درایو ذخیره شود</span>
      </label>` : ''}
    `;
  }
  function bindScheduleVisibility(scope) {
    const sel = $('#drvSchedule', scope);
    if (!sel) return;
    const sync = () => {
      const v = sel.value;
      const hw = $('#drvHourWrap', scope);
      const dw = $('#drvDayWrap', scope);
      if (hw) hw.style.display = (v === 'daily' || v === 'weekly') ? '' : 'none';
      if (dw) dw.style.display = v === 'weekly' ? '' : 'none';
    };
    sel.addEventListener('change', sync);
    sync();
  }
  function readScheduleForm(scope) {
    const rawFolder = ($('#drvFolderInput', scope) && $('#drvFolderInput', scope).value || '').trim();
    const looksLikeIdOrUrl = /folders\/|[?&]id=|^[a-zA-Z0-9_-]{15,}$/.test(rawFolder);
    return {
      folderInput: looksLikeIdOrUrl ? rawFolder : '',
      folderName: (!looksLikeIdOrUrl && rawFolder) ? rawFolder : '',
      schedule: ($('#drvSchedule', scope) && $('#drvSchedule', scope).value) || 'daily',
      hour: Number($('#drvHour', scope) && $('#drvHour', scope).value || 2),
      dayOfWeek: Number($('#drvDay', scope) && $('#drvDay', scope).value || 5),
      maxKeep: Math.max(5, Math.min(200, Number($('#drvMaxKeep', scope) && $('#drvMaxKeep', scope).value || 30)))
    };
  }
  function countChipsHtml(c) {
    if (!c) return '<span class="muted">—</span>';
    const parts = [
      ['تیکت', c.tickets],
      ['سوشال', c.socials],
      ['تماس', c.calls],
      ['موقعیتی', c.callSituational],
      ['کارشناس', c.agents],
      ['اقدام', c.actions]
    ].filter((p) => Number(p[1]) > 0);
    if (!parts.length) return '<span class="drv-chip">خالی</span>';
    return '<div class="drv-chips">' + parts.map((p) => `<span class="drv-chip">${p[0]}: ${fa(p[1])}</span>`).join('') + '</div>';
  }

  async function downloadDriveBackup(item) {
    if (!item || !item.id) return;
    try {
      toast.info('در حال دریافت فایل بکاپ…');
      const r = await api.get('/api/drive-backups/' + encodeURIComponent(item.id) + '/download');
      if (r && r.backup) {
        const blob = new Blob([JSON.stringify(r.backup, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.filename || item.name || 'qc-backup.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast.success('فایل بکاپ دانلود شد');
      } else if (item.downloadUrl) {
        window.open(item.downloadUrl, '_blank', 'noopener');
      }
    } catch (e) {
      if (item.downloadUrl) {
        window.open(item.downloadUrl, '_blank', 'noopener');
      } else {
        toast.error(e.message || 'خطا در دانلود بکاپ');
      }
    }
  }

  function openDriveRestoreModal(item) {
    if (!item || !item.id) return;
    const m = UI.modal(`
      ${UI.modalHead('بازگردانی سامانه از بکاپ درایو', 'fa-rotate-left')}
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div class="drv-bar">
          <div class="drv-meta">
            <span class="drv-meta-item"><i class="fa-solid fa-file-code"></i> <b dir="ltr">${esc(item.name)}</b></span>
            <span class="drv-meta-item"><i class="fa-regular fa-clock"></i> ${fmtIsoJalali(item.createdAt)}</span>
            <span class="drv-meta-item"><i class="fa-solid fa-database"></i> ${fmtBytes(item.size)}</span>
          </div>
          ${countChipsHtml(item.counts)}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="drv-restore-opt">
            <input type="radio" name="drvRestMode" value="replace" checked>
            <div>
              <div style="font-weight:800;font-size:13px">جایگزینی کامل (بازگشت دقیق به زمان این بکاپ)</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">تمام تیکت‌ها، سوشال، تماس‌ها، کارشناسان، اقدامات، یادآورها، ماه‌های مالی، کاربران و تنظیمات به وضعیت این نسخه برمی‌گردند.</div>
            </div>
          </label>
          <label class="drv-restore-opt">
            <input type="radio" name="drvRestMode" value="append">
            <div>
              <div style="font-weight:800;font-size:13px">ادغام بدون حذف (افزودن رکوردهای مفقود)</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">رکوردهای جدیدتر فعلی دست‌نخورده می‌مانند و فقط رکوردهایی که در این بکاپ بوده و اکنون وجود ندارند اضافه می‌شوند.</div>
            </div>
          </label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12.6px;padding:8px 10px;border-radius:9px;background:var(--good-soft);color:var(--good);cursor:pointer">
          <input type="checkbox" id="drvAutoSafety" checked>
          <span><b>محافظت ایمنی:</b> پیش از بازگردانی، یک بکاپ خودکار از وضعیت فعلی سامانه روی درایو ذخیره شود (پیشنهادی)</span>
        </label>
        <div id="drvRestoreStatus" style="display:none;font-size:12.4px;padding:9px 12px;border-radius:9px"></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>انصراف</button>
        <button class="btn primary" id="drvConfirmRestoreBtn"><i class="fa-solid fa-rotate-left"></i> اجرای بازگردانی</button>
      </div>
    `);
    $('#drvConfirmRestoreBtn', m).addEventListener('click', async () => {
      const btn = $('#drvConfirmRestoreBtn', m);
      const st = $('#drvRestoreStatus', m);
      const modeEl = $('input[name="drvRestMode"]:checked', m);
      const mode = modeEl ? modeEl.value : 'replace';
      const autoSafetyBackup = !!($('#drvAutoSafety', m) && $('#drvAutoSafety', m).checked);
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> در حال بازگردانی…';
      st.style.display = 'block';
      st.style.background = 'var(--soft)';
      st.style.color = 'var(--ink-2)';
      st.textContent = autoSafetyBackup ? 'در حال ذخیره بکاپ ایمنی و بازگردانی داده‌ها…' : 'در حال بازگردانی داده‌ها…';
      try {
        const r = await api.post('/api/drive-backups/' + encodeURIComponent(item.id) + '/restore', { mode, autoSafetyBackup });
        toast.success(mode === 'append' ? 'ادغام از بکاپ درایو با موفقیت انجام شد' : 'بازگردانی کامل از بکاپ درایو با موفقیت انجام شد');
        m.close();
        await App.boot();
        await loadStatus();
        await loadFiles();
        await loadDriveBackups();
      } catch (e) {
        st.style.background = 'var(--bad-soft)';
        st.style.color = 'var(--bad)';
        st.textContent = 'خطا در بازگردانی: ' + (e.message || 'خطای نامشخص');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> تلاش مجدد';
      }
    });
  }

  async function openDriveInspectModal(item) {
    if (!item || !item.id) return;
    const m = UI.modal(`
      ${UI.modalHead('مشاهده و بررسی محتوای بکاپ', 'fa-magnifying-glass-chart')}
      <div class="modal-body" id="drvInspectRoot" style="display:flex;flex-direction:column;gap:12px">
        <div class="note" style="margin:0"><i class="fa-solid fa-spinner fa-spin"></i> در حال خواندن فایل بکاپ از درایو و مقایسه با وضعیت فعلی سامانه…</div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>بستن</button>
        ${item.url ? `<a class="btn soft" href="${esc(item.url)}" target="_blank" rel="noopener"><i class="fa-brands fa-google-drive"></i> مشاهده در درایو</a>` : ''}
        <button class="btn soft" id="drvInspDlBtn"><i class="fa-solid fa-download"></i> دانلود JSON</button>
        <button class="btn primary" id="drvInspRestoreBtn"><i class="fa-solid fa-rotate-left"></i> بازگردانی از این بکاپ</button>
      </div>
    `, { lg: true });
    $('#drvInspDlBtn', m).addEventListener('click', () => downloadDriveBackup(item));
    $('#drvInspRestoreBtn', m).addEventListener('click', () => { m.close(); openDriveRestoreModal(item); });

    try {
      const data = await api.get('/api/drive-backups/' + encodeURIComponent(item.id));
      if (!m.isConnected) return;
      const box = $('#drvInspectRoot', m);
      const diffDefs = [
        ['agents', 'کارشناسان'],
        ['tickets', 'تیکت‌ها'],
        ['socials', 'سوشال'],
        ['calls', 'تماس ثابت'],
        ['callSituational', 'تماس موقعیتی'],
        ['monthlyScores', 'نمرات ماهانه'],
        ['actions', 'اقدامات'],
        ['reminders', 'یادآورها']
      ];
      const diffHtml = diffDefs.map(([k, lbl]) => {
        const d = (data.diff && data.diff[k]) || { backup: 0, live: 0, delta: 0 };
        const dCls = d.delta > 0 ? 'drv-delta-pos' : d.delta < 0 ? 'drv-delta-neg' : 'drv-delta-eq';
        const dTxt = d.delta > 0 ? ('+' + fa(d.delta)) : d.delta < 0 ? ('−' + fa(Math.abs(d.delta))) : 'یکسان';
        return `<div class="drv-diff-tile">
          <div class="t-lbl">${lbl}</div>
          <div class="t-val"><span>${fa(d.backup)}</span><span class="${dCls}">${dTxt}</span></div>
          <div class="t-sub"><span>فعلی: ${fa(d.live)}</span></div>
        </div>`;
      }).join('');

      const trig = DRV_TRIG_META[item.trigger] || DRV_TRIG_META.manual;
      const periodTxt = (data.period && (data.period.from || data.period.to))
        ? `${fa(data.period.from || '—')} تا ${fa(data.period.to || '—')}` : 'بدون تاریخ ثبت‌شده';

      box.innerHTML = `
        <div class="drv-bar">
          <div class="drv-meta">
            <span class="drv-meta-item"><i class="fa-solid fa-file-code"></i> <b dir="ltr">${esc(item.name)}</b></span>
            <span class="badge ${trig.cls}"><i class="fa-solid ${trig.icon}"></i> ${trig.label}</span>
            <span class="drv-meta-item"><i class="fa-regular fa-clock"></i> ${fmtIsoJalali(data.exportedAt || item.createdAt)}</span>
            <span class="drv-meta-item"><i class="fa-regular fa-calendar"></i> بازه داده: ${periodTxt}</span>
            <span class="drv-meta-item"><i class="fa-solid fa-weight-hanging"></i> ${fmtBytes(item.size)}</span>
          </div>
          ${item.note ? `<div style="font-size:12px;color:var(--ink-2)">یادداشت: ${esc(item.note)}</div>` : ''}
        </div>
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px">مقایسه تعداد رکوردهای این بکاپ با وضعیت فعلی سامانه</div>
          <div class="drv-diff-grid">${diffHtml}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
          <div class="drv-inspect-tabs" id="drvInspTabs">
            <button type="button" class="drv-inspect-tab active" data-tab="summary">خلاصه و تنظیمات</button>
            <button type="button" class="drv-inspect-tab" data-tab="tickets">تیکت‌ها (${fa(data.counts.tickets)})</button>
            <button type="button" class="drv-inspect-tab" data-tab="socials">سوشال (${fa(data.counts.socials)})</button>
            <button type="button" class="drv-inspect-tab" data-tab="calls">تماس‌ها (${fa(data.counts.calls)})</button>
            <button type="button" class="drv-inspect-tab" data-tab="agents">کارشناسان (${fa(data.counts.agents)})</button>
            <button type="button" class="drv-inspect-tab" data-tab="actions">اقدامات و یادآورها (${fa(data.counts.actions + data.counts.reminders)})</button>
          </div>
          <input class="input sm" id="drvInspSearch" style="width:210px" placeholder="جستجو در محتوای بکاپ…">
        </div>
        <div class="drv-inspect-body" id="drvInspContent"></div>
      `;

      let activeTab = 'summary';
      const pv = data.preview || {};
      const renderTab = () => {
        const q = String($('#drvInspSearch', box).value || '').trim().toLowerCase();
        const hit = (vals) => !q || vals.some((v) => String(v == null ? '' : v).toLowerCase().includes(q));
        const host = $('#drvInspContent', box);

        if (activeTab === 'summary') {
          const st = pv.settings || {};
          const fmRows = (pv.fiscalMonths || []).map((fm) => `<tr><td>${esc(fm.name)}</td><td dir="ltr">${fa(fm.from)}</td><td dir="ltr">${fa(fm.to)}</td><td>${esc(fm.note || '—')}</td></tr>`).join('');
          const uRows = (pv.qcUsers || []).map((u) => `<tr><td>${esc(u.name)}</td><td><span class="badge ${u.role === 'admin' ? 'info' : 'soft'}">${u.role === 'admin' ? 'مدیر' : 'کارشناس QC'}</span></td><td>${u.active ? 'فعال' : 'غیرفعال'}</td><td>${esc((u.teams || []).join('، ') || (u.agents || []).join('، ') || (u.exts || []).join('، ') || 'همه')}</td></tr>`).join('');
          host.innerHTML = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px">
            <div class="drv-meta">
              <span class="drv-meta-item"><i class="fa-solid fa-building"></i> سازمان: <b>${esc(st.orgName || '—')}</b></span>
              <span class="drv-meta-item"><i class="fa-solid fa-stopwatch"></i> SLA سوشال: <b>${fa(st.slaMinutes || 60)} دقیقه</b></span>
              <span class="drv-meta-item"><i class="fa-solid fa-scale-balanced"></i> وزن تیکت: <b>${fa((st.ticketWeights || []).join(' / ') || '—')}</b></span>
              <span class="drv-meta-item"><i class="fa-solid fa-scale-balanced"></i> وزن سوشال: <b>${fa((st.socialWeights || []).join(' / ') || '—')}</b></span>
            </div>
            <div>
              <div style="font-weight:700;font-size:12.5px;margin-bottom:6px">ماه‌های مالی ذخیره‌شده (${fa((pv.fiscalMonths || []).length)})</div>
              ${fmRows ? `<table class="tbl"><thead><tr><th>نام</th><th>از</th><th>تا</th><th>یادداشت</th></tr></thead><tbody>${fmRows}</tbody></table>` : '<div class="muted" style="font-size:12px">ماه مالی ثبت نشده است.</div>'}
            </div>
            <div>
              <div style="font-weight:700;font-size:12.5px;margin-bottom:6px">کاربران سامانه در این بکاپ (${fa((pv.qcUsers || []).length)} · رمزها ایمن و پنهان‌اند)</div>
              ${uRows ? `<table class="tbl"><thead><tr><th>نام</th><th>نقش</th><th>وضعیت</th><th>دامنه دسترسی</th></tr></thead><tbody>${uRows}</tbody></table>` : '<div class="muted" style="font-size:12px">کاربری ثبت نشده است.</div>'}
            </div>
          </div>`;
          return;
        }
        if (activeTab === 'tickets') {
          const rows = (pv.tickets || []).filter((r) => hit([r.reviewDate, r.agentName, r.team, r.ticketCode, r.qcAgent, r.comment]));
          const trunc = data.truncated && data.truncated.tickets ? `<div class="note" style="margin:8px">نمایش ${fa((pv.tickets || []).length)} تیکت اخیر از مجموع ${fa(data.counts.tickets)} تیکت (هنگام بازگردانی همه رکوردها برمی‌گردند).</div>` : '';
          host.innerHTML = trunc + (rows.length
            ? `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>کارشناس</th><th>کد تیکت</th><th>نمره</th><th>ردلاین</th><th>کارشناس QC</th><th>توضیح</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fa(r.reviewDate || '—')}</td><td>${esc(r.agentName)}</td><td dir="ltr">${esc(r.ticketCode || '—')}</td><td><b>${r.score == null ? '—' : fa(r.score)}</b></td><td>${String(r.redline) === '0' ? '<span class="badge bad">دارد</span>' : '<span class="badge good">خیر</span>'}</td><td>${esc(r.qcAgent || '—')}</td><td>${esc(r.comment || '—')}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty-state" style="padding:20px">تیکتی یافت نشد.</div>');
          return;
        }
        if (activeTab === 'socials') {
          const rows = (pv.socials || []).filter((r) => hit([r.reviewDate, r.agentName, r.messenger, r.responseStatus, r.slaStatus, r.comment]));
          const trunc = data.truncated && data.truncated.socials ? `<div class="note" style="margin:8px">نمایش ${fa((pv.socials || []).length)} رکورد سوشال اخیر از مجموع ${fa(data.counts.socials)}.</div>` : '';
          host.innerHTML = trunc + (rows.length
            ? `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>کارشناس</th><th>پیام‌رسان</th><th>وضعیت پاسخ</th><th>SLA</th><th>نمره</th><th>توضیح</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fa(r.reviewDate || '—')}</td><td>${esc(r.agentName)}</td><td>${esc(r.messenger || '—')}</td><td>${esc(r.responseStatus || '—')}</td><td>${esc(r.slaStatus || '—')}</td><td><b>${r.score == null ? '—' : fa(r.score)}</b></td><td>${esc(r.comment || '—')}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty-state" style="padding:20px">رکورد سوشالی یافت نشد.</div>');
          return;
        }
        if (activeTab === 'calls') {
          const rows = (pv.calls || []).filter((r) => hit([r.reviewDate, r.expertName, r.team, r.formType, r.redlineReason, r.qcComment, r.sourceFile]));
          const trunc = data.truncated && data.truncated.calls ? `<div class="note" style="margin:8px">نمایش ${fa((pv.calls || []).length)} تماس اخیر از مجموع ${fa(data.counts.calls)} تماس ثابت (و ${fa(data.counts.callSituational)} موقعیتی).</div>` : '';
          host.innerHTML = trunc + (rows.length
            ? `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>کارشناس</th><th>فرم</th><th>نمره</th><th>ردلاین</th><th>توضیحات / علت ردلاین</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fa(r.reviewDate || '—')}</td><td>${esc(r.expertName)}</td><td>${esc(r.formType || '—')}</td><td><b>${r.score == null ? '—' : fa(r.score)}</b></td><td>${r.redline ? '<span class="badge bad">دارد</span>' : '<span class="badge good">خیر</span>'}</td><td>${esc(r.redlineReason || r.qcComment || '—')}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty-state" style="padding:20px">رکورد تماسی یافت نشد.</div>');
          return;
        }
        if (activeTab === 'agents') {
          const rows = (pv.agents || []).filter((a) => hit([a.name, a.ext, a.team, a.subgroup, (a.qcAgents || []).join(' ')]));
          host.innerHTML = rows.length
            ? `<table class="tbl"><thead><tr><th>نام کارشناس</th><th>داخلی</th><th>تیم</th><th>زیرگروه</th><th>وضعیت</th><th>کارشناس QC</th></tr></thead><tbody>${rows.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td dir="ltr">${fa(a.ext || '—')}</td><td>${esc(a.team || '—')}</td><td>${esc(a.subgroup || '—')}</td><td>${a.active !== false ? '<span class="badge good">فعال</span>' : '<span class="badge soft">غیرفعال</span>'}</td><td>${esc((a.qcAgents || []).join('، ') || '—')}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty-state" style="padding:20px">کارشناسی یافت نشد.</div>';
          return;
        }
        if (activeTab === 'actions') {
          const acts = (pv.actions || []).filter((a) => hit([a.agent, a.title, a.date, a.status, a.result, a.note]));
          const rems = (pv.reminders || []).filter((r) => hit([r.agent, r.date, r.text]));
          host.innerHTML = `<div style="padding:10px;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-weight:700;font-size:12.5px;margin-bottom:6px">اقدامات (${fa(acts.length)})</div>
              ${acts.length ? `<table class="tbl"><thead><tr><th>تاریخ</th><th>کارشناس</th><th>عنوان اقدام</th><th>وضعیت</th><th>نتیجه</th></tr></thead><tbody>${acts.map((a) => `<tr><td>${fa(a.date || '—')}</td><td>${esc(a.agent)}</td><td>${esc(a.title || '—')}</td><td>${esc(a.status || '—')}</td><td>${esc(a.result || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="muted" style="font-size:12px">اقدامی یافت نشد.</div>'}
            </div>
            <div>
              <div style="font-weight:700;font-size:12.5px;margin-bottom:6px">یادآورها (${fa(rems.length)})</div>
              ${rems.length ? `<table class="tbl"><thead><tr><th>تاریخ</th><th>کارشناس</th><th>متن یادآور</th><th>وضعیت</th></tr></thead><tbody>${rems.map((r) => `<tr><td>${fa(r.date || '—')}</td><td>${esc(r.agent || '—')}</td><td>${esc(r.text || '—')}</td><td>${r.done ? '<span class="badge good">انجام‌شده</span>' : '<span class="badge warn">در انتظار</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="muted" style="font-size:12px">یادآوری یافت نشد.</div>'}
            </div>
          </div>`;
        }
      };

      $$('.drv-inspect-tab', box).forEach((btn) => btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        $$('.drv-inspect-tab', box).forEach((b) => b.classList.toggle('active', b === btn));
        renderTab();
      }));
      $('#drvInspSearch', box).addEventListener('input', renderTab);
      renderTab();
    } catch (e) {
      if (!m.isConnected) return;
      $('#drvInspectRoot', m).innerHTML = `<div class="note" style="background:var(--bad-soft);color:var(--bad);margin:0"><i class="fa-solid fa-triangle-exclamation"></i> خطا در خواندن محتوای بکاپ: ${esc(e.message || 'خطای نامشخص')}</div>`;
    }
  }

  function renderDriveBackups(st) {
    driveState = st;
    const badge = $('#drvStatusBadge', root);
    const body = $('#drvBody', root);
    if (!badge || !body) return;

    if (!st || !st.supported) {
      badge.className = 'badge soft';
      badge.textContent = 'در حالت آفلاین غیرفعال';
      body.innerHTML = `<div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> اتصال مستقیم به گوگل درایو و بکاپ خودکار زمان‌بندی‌شده در نسخه <b>Google Apps Script</b> (یا سرور آنلاین) فعال است. در حالت فایل آفلاین می‌توانید از دکمه‌های بکاپ و بازیابی دستی زیر استفاده کنید.</div>`;
      return;
    }

    if (st.needsAuthorization) {
      const manifestSnippet = JSON.stringify({
        timeZone: 'Asia/Tehran',
        dependencies: {},
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8',
        webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
        oauthScopes: [
          'https://www.googleapis.com/auth/spreadsheets.currentonly',
          'https://www.googleapis.com/auth/script.container.ui',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/script.scriptapp'
        ]
      }, null, 2);
      badge.className = 'badge warn';
      badge.textContent = st.needsManifestScope ? 'مجوز درایو در appsscript.json کم است' : 'نیاز به تأیید دسترسی درایو';
      body.innerHTML = `
        <div class="drv-auth-box">
          <h4><i class="fa-solid fa-key"></i> ${st.needsManifestScope ? 'چرا پنجره تأیید روی شیت باز نشد؟ (مجوز درایو در appsscript.json ثبت نشده)' : 'درخواست مجوز دسترسی به گوگل درایو'}</h4>
          <div style="font-size:12.5px;color:var(--ink-2)">
            ${st.needsManifestScope
              ? 'در پروژه Apps Script شما هنوز مجوز <b>Google Drive</b> به فایل <code>appsscript.json</code> اضافه نشده است؛ تا زمانی که این فایل به‌روز نشود گوگل هیچ پنجره‌ی تأییدی روی شیت نمایش نمی‌دهد.'
              : 'وب‌اپ به‌تنهایی نمی‌تواند روی تب شیت پنجره باز کند؛ مالک شیت باید یک‌بار از طریق دکمه تأیید زیر یا منوی شیت/ادیتور Apps Script دسترسی گوگل درایو را تأیید کند.'}
          </div>
          ${st.authorizationUrl ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn primary" href="${esc(st.authorizationUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> باز کردن پنجره رسمی تأیید گوگل درایو (۱ کلیک)</a>
          </div>` : ''}
          <ol class="drv-auth-steps">
            <li>در گوگل شیت به مسیر <b>Extensions ← Apps Script</b> بروید و از <b>Project Settings (⚙️)</b> تیک <code>Show "appsscript.json" manifest file in editor</code> را بزنید.</li>
            <li>فایل <code>appsscript.json</code> را باز کرده، متن زیر را جایگزین و ذخیره (<code>Ctrl+S</code>) کنید (اگر روی دسترسی سازمانی هستید، <code>access</code> را طبق تنظیم خودتان نگه دارید).</li>
            <li>از نوار بالای ادیتور Apps Script، تابع <b><code>connectDriveBackupFromSheet</code></b> را انتخاب کرده و روی <b>Run</b> کلیک کنید (یا صفحه گوگل شیت را <b>F5</b> رفرش کنید و منوی <b>سامانه QC مستقل ← اتصال و صدور مجوز گوگل درایو</b> را بزنید) ← پنجره رسمی <b>Review Permissions / Allow</b> گوگل همان لحظه باز می‌شود.</li>
            <li>در پایان از <b>Deploy ← Manage deployments ← Edit (✏️) ← New version</b> نسخه جدید را منتشر کنید و سپس دکمه <b>«بررسی مجدد اتصال»</b> زیر را بزنید.</li>
          </ol>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span style="font-size:11.5px;font-weight:700;color:var(--ink-2)">محتوای آماده فایل <code>appsscript.json</code>:</span>
            <button type="button" class="btn soft sm" id="drvCopyManifestBtn"><i class="fa-regular fa-copy"></i> کپی appsscript.json</button>
          </div>
          <pre class="drv-code-box" id="drvManifestCode">${esc(manifestSnippet)}</pre>
          ${st.authError ? `<div style="font-size:11.5px;color:var(--muted)" dir="ltr">Google message: ${esc(st.authError)}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="drvRecheckBtn"><i class="fa-solid fa-rotate"></i> بررسی مجدد اتصال</button>
          </div>
        </div>
      `;
      $('#drvCopyManifestBtn', body).addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(manifestSnippet);
          else {
            const ta = document.createElement('textarea');
            ta.value = manifestSnippet; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
          }
          toast.success('محتوای appsscript.json کپی شد');
        } catch (e) { toast.info('متن کادر بالا را انتخاب و کپی کنید'); }
      });
      $('#drvRecheckBtn', body).addEventListener('click', () => loadDriveBackups(true));
      return;
    }

    const cfg = st.config || {};
    const isGoogle = st.provider === 'google-drive';

    if (!st.connected) {
      badge.className = 'badge soft';
      badge.textContent = 'متصل نیست';
      body.innerHTML = `
        <div class="note" style="margin:0"><i class="fa-solid fa-cloud-arrow-up"></i>
          <span>${isGoogle
            ? 'با فعال‌سازی این بخش، سامانه به پوشه‌ی اختصاصی شما در <b>گوگل درایو</b> متصل می‌شود، به‌صورت دوره‌ای بکاپ کامل (نسخه ۴) ذخیره می‌کند و می‌توانید هر نسخه را همین‌جا بررسی یا بازگردانی کنید.'
            : 'در این محیط سرور محلی، بکاپ‌های خودکار در پوشه‌ی آرشیو سرور ذخیره می‌شوند و در نسخه <b>Google Apps Script</b> دقیقاً با همین رابط کاربری به <b>گوگل درایو</b> متصل خواهد شد.'}</span>
        </div>
        <div class="drv-cfg-panel">
          ${scheduleFormHtml(cfg, true)}
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="btn primary" id="drvConnectBtn"><i class="fa-brands fa-google-drive"></i> ${isGoogle ? 'درخواست اتصال به گوگل درایو و فعال‌سازی بکاپ خودکار' : 'اتصال و فعال‌سازی بکاپ خودکار'}</button>
          </div>
        </div>
      `;
      bindScheduleVisibility(body);
      $('#drvConnectBtn', body).addEventListener('click', async () => {
        const btn = $('#drvConnectBtn', body);
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> در حال برقراری اتصال…';
        try {
          const payload = Object.assign(readScheduleForm(body), {
            takeInitialBackup: !!($('#drvInitSnap', body) && $('#drvInitSnap', body).checked)
          });
          const res = await api.post('/api/drive-backups/connect', payload);
          if (!root.isConnected) return;
          if (res && res.needsAuthorization) {
            renderDriveBackups(res);
            toast.info('لطفاً مجوز گوگل درایو را از منوی شیت تأیید کنید');
            return;
          }
          toast.success(isGoogle ? 'اتصال به گوگل درایو با موفقیت برقرار شد' : 'آرشیو بکاپ خودکار فعال شد');
          driveCfgOpen = false;
          renderDriveBackups(res);
        } catch (e) {
          toast.error(e.message || 'خطا در اتصال');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-brands fa-google-drive"></i> تلاش مجدد اتصال';
        }
      });
      return;
    }

    badge.className = 'badge good';
    badge.textContent = isGoogle ? 'متصل به گوگل درایو' : 'بکاپ خودکار سرور فعال';
    const backups = Array.isArray(st.backups) ? st.backups : [];

    const tableRows = backups.map((b) => {
      const trig = DRV_TRIG_META[b.trigger] || DRV_TRIG_META.manual;
      return `<tr>
        <td>
          <div style="font-weight:700">${fmtIsoJalali(b.createdAt)}</div>
          <span class="badge ${trig.cls}" style="margin-top:3px"><i class="fa-solid ${trig.icon}"></i> ${trig.label}</span>
        </td>
        <td>
          <div dir="ltr" style="font-family:monospace;font-size:11.5px;text-align:right">${esc(b.name)}</div>
          ${b.note ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px">${esc(b.note)}</div>` : ''}
          <div style="font-size:11px;color:var(--muted);margin-top:2px">حجم: ${fmtBytes(b.size)}</div>
        </td>
        <td>${countChipsHtml(b.counts)}</td>
        <td>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button type="button" class="btn soft sm" data-drv-inspect="${esc(b.id)}" title="مشاهده و مقایسه محتوا"><i class="fa-solid fa-eye"></i> مشاهده</button>
            <button type="button" class="btn primary sm" data-drv-restore="${esc(b.id)}" title="بازگردانی از این بکاپ"><i class="fa-solid fa-rotate-left"></i> بازگردانی</button>
            <button type="button" class="btn ghost sm" data-drv-dl="${esc(b.id)}" title="دانلود JSON"><i class="fa-solid fa-download"></i></button>
            <button type="button" class="btn danger-soft sm" data-drv-del="${esc(b.id)}" title="حذف از درایو"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="drv-bar">
        <div class="drv-meta">
          <span class="drv-meta-item"><i class="fa-solid fa-folder-open"></i> پوشه: <b>${esc(cfg.folderName || 'پشتیبان‌گیری سامانه QC')}</b>
            ${cfg.folderUrl ? `<a href="${esc(cfg.folderUrl)}" target="_blank" rel="noopener" class="badge info" style="text-decoration:none;margin-inline-start:4px"><i class="fa-solid fa-arrow-up-right-from-square"></i> بازکردن در درایو</a>` : ''}
          </span>
          <span class="drv-meta-item"><i class="fa-solid fa-clock"></i> زمان‌بندی: <b>${schedSummary(cfg)}</b>${st.triggerActive ? ' <span class="badge good">فعال</span>' : ''}</span>
          <span class="drv-meta-item"><i class="fa-solid fa-layer-group"></i> نگهداری: <b>${fa(cfg.maxKeep || 30)} نسخه آخر</b></span>
          <span class="drv-meta-item"><i class="fa-solid fa-check-double"></i> آخرین بکاپ: <b>${fmtIsoJalali(cfg.lastBackupAt)}</b></span>
        </div>
      </div>
      ${cfg.lastError ? `<div class="note" style="margin:0;background:var(--bad-soft);color:var(--bad)"><i class="fa-solid fa-triangle-exclamation"></i> خطای آخرین اجرای خودکار: ${esc(cfg.lastError)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="input" id="drvNoteInp" style="flex:1;min-width:190px;max-width:340px" placeholder="یادداشت اختیاری برای بکاپ فوری (مثلاً: پیش از بستن ماه)…">
        <button class="btn primary" id="drvNowBtn"><i class="fa-solid fa-cloud-arrow-up"></i> بکاپ فوری الان</button>
        <button class="btn soft" id="drvToggleCfgBtn"><i class="fa-solid fa-sliders"></i> تنظیمات زمان‌بندی</button>
        <button class="btn ghost" id="drvRefreshBtn"><i class="fa-solid fa-arrows-rotate"></i> بروزرسانی لیست</button>
        <button class="btn danger-soft" id="drvDisconnectBtn"><i class="fa-solid fa-link-slash"></i> قطع اتصال</button>
      </div>
      <div class="drv-cfg-panel" id="drvCfgPanel" style="${driveCfgOpen ? '' : 'display:none'}">
        ${scheduleFormHtml(cfg, false)}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="drvSaveCfgBtn"><i class="fa-solid fa-floppy-disk"></i> ذخیره تنظیمات زمان‌بندی</button>
          <button class="btn ghost" id="drvCloseCfgBtn">بستن</button>
        </div>
      </div>
      <div id="drvListWrap">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:700;font-size:13px">آرشیو بکاپ‌های ذخیره‌شده (${fa(backups.length)} نسخه)</div>
          <div style="font-size:11.5px;color:var(--muted)">برای بررسی رکوردها و مقایسه با دیتای فعلی روی «مشاهده» کلیک کنید</div>
        </div>
        ${backups.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th style="width:175px">زمان و نوع</th><th>فایل و توضیحات</th><th>محتوای بکاپ</th><th style="width:240px">عملیات</th></tr></thead><tbody>${tableRows}</tbody></table></div>`
          : '<div class="empty-state" style="padding:20px">هنوز بکاپی در این پوشه ذخیره نشده است. روی «بکاپ فوری الان» کلیک کنید.</div>'}
      </div>
    `;

    bindScheduleVisibility(body);

    $('#drvNowBtn', body).addEventListener('click', async () => {
      const btn = $('#drvNowBtn', body);
      const note = ($('#drvNoteInp', body).value || '').trim();
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> در حال ذخیره بکاپ…';
      try {
        const res = await api.post('/api/drive-backups/now', { note, trigger: 'manual' });
        if (!root.isConnected) return;
        if (res && res.needsAuthorization) { renderDriveBackups(res); return; }
        toast.success('بکاپ کامل با موفقیت ذخیره شد' + (res.pruned ? ` (${fa(res.pruned)} نسخه قدیمی پاک‌سازی شد)` : ''));
        if (res.status) renderDriveBackups(res.status); else await loadDriveBackups();
      } catch (e) {
        toast.error(e.message || 'خطا در ثبت بکاپ');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> بکاپ فوری الان';
      }
    });

    $('#drvToggleCfgBtn', body).addEventListener('click', () => {
      driveCfgOpen = !driveCfgOpen;
      const p = $('#drvCfgPanel', body);
      if (p) p.style.display = driveCfgOpen ? '' : 'none';
    });
    $('#drvCloseCfgBtn', body).addEventListener('click', () => {
      driveCfgOpen = false;
      const p = $('#drvCfgPanel', body);
      if (p) p.style.display = 'none';
    });
    $('#drvSaveCfgBtn', body).addEventListener('click', async () => {
      const btn = $('#drvSaveCfgBtn', body);
      btn.disabled = true;
      try {
        const res = await api.put('/api/drive-backups/config', readScheduleForm(body));
        if (!root.isConnected) return;
        driveCfgOpen = false;
        toast.success('تنظیمات زمان‌بندی ذخیره شد');
        renderDriveBackups(res);
      } catch (e) {
        toast.error(e.message || 'خطا در ذخیره تنظیمات');
        btn.disabled = false;
      }
    });
    $('#drvRefreshBtn', body).addEventListener('click', () => loadDriveBackups(true));
    $('#drvDisconnectBtn', body).addEventListener('click', () => {
      confirmDlg('قطع اتصال بکاپ درایو',
        'زمان‌بندی بکاپ خودکار متوقف می‌شود. فایل‌های بکاپی که تاکنون در گوگل درایو ذخیره شده‌اند پاک نخواهند شد.',
        async () => {
          try {
            const res = await api.post('/api/drive-backups/disconnect', {});
            if (!root.isConnected) return;
            driveCfgOpen = false;
            toast.info('اتصال بکاپ خودکار قطع شد');
            renderDriveBackups(res);
          } catch (e) { toast.error(e.message); }
        },
        'قطع اتصال'
      );
    });

    const byId = new Map(backups.map((b) => [b.id, b]));
    $$('[data-drv-inspect]', body).forEach((el) => el.addEventListener('click', () => openDriveInspectModal(byId.get(el.dataset.drvInspect))));
    $$('[data-drv-restore]', body).forEach((el) => el.addEventListener('click', () => openDriveRestoreModal(byId.get(el.dataset.drvRestore))));
    $$('[data-drv-dl]', body).forEach((el) => el.addEventListener('click', () => downloadDriveBackup(byId.get(el.dataset.drvDl))));
    $$('[data-drv-del]', body).forEach((el) => el.addEventListener('click', () => {
      const item = byId.get(el.dataset.drvDel);
      if (!item) return;
      confirmDlg('حذف فایل بکاپ',
        `فایل «${esc(item.name)}» به سطل زباله منتقل شود؟`,
        async () => {
          try {
            const res = await api.del('/api/drive-backups/' + encodeURIComponent(item.id));
            if (!root.isConnected) return;
            toast.success('بکاپ حذف شد');
            if (res && res.status) renderDriveBackups(res.status); else await loadDriveBackups();
          } catch (e) { toast.error(e.message); }
        },
        'بله، حذف شود'
      );
    }));
  }

  async function loadDriveBackups(showToast) {
    try {
      const st = await api.get('/api/drive-backups');
      if (!root.isConnected) return;
      renderDriveBackups(st);
      if (showToast) toast.info('فهرست بکاپ‌ها بروزرسانی شد');
    } catch (e) {
      if (!root.isConnected) return;
      const badge = $('#drvStatusBadge', root);
      const body = $('#drvBody', root);
      if (badge) { badge.className = 'badge bad'; badge.textContent = 'خطا'; }
      if (body) body.innerHTML = `<div class="note" style="margin:0;color:var(--bad)">${esc(e.message || 'خطا در دریافت وضعیت بکاپ درایو')}</div>`;
    }
  }

  App.onDateRangeChange(async () => { await loadStatus(); await loadFiles(); });
  await loadStatus();
  await loadFiles();
  loadDriveBackups();
}

App.register('data', { title: 'مرکز داده', render });
})();
