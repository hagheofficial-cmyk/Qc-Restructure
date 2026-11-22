'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/calc');
const P = require('../shared/parseQc');
const I = require('../shared/importData');
const Rit = require('../shared/ritStats');
const { fixture } = require('./helpers');

/* ------------------------------------------------------------- ماه مالی (۲۰ → ۱۹) */
test('آمار ریت: ۱۲ ماه «ماه مالی X» با بازه‌ی ۲۰ → ۱۹ و مقدار YYYYMMDDِ ۲۱ ماه شروع ساخته می‌شود', () => {
  const db = { fiscalMonths: [] };
  const out = Rit.ensureFiscalMonths(db, '1405/08/23');
  assert.equal(out.changed, true);
  assert.equal(db.fiscalMonths.length, 12);
  const byName = {};
  db.fiscalMonths.forEach((m) => { byName[m.name] = m; });
  assert.equal(byName['ماه مالی شهریور'].from, '1405/05/20');
  assert.equal(byName['ماه مالی شهریور'].to, '1405/06/19');
  assert.equal(byName['ماه مالی شهریور'].id, '14050521');
  assert.equal(byName['ماه مالی مهر'].from, '1405/06/20');
  assert.equal(byName['ماه مالی مهر'].to, '1405/07/19');
  assert.equal(byName['ماه مالی مهر'].id, '14050621');
  assert.equal(byName['ماه مالی آبان'].from, '1405/07/20');
  assert.equal(byName['ماه مالی آبان'].to, '1405/08/19');
  assert.equal(byName['ماه مالی آبان'].id, '14050721');
  assert.equal(byName['ماه مالی اسفند'].from, '1405/11/20');
  assert.equal(byName['ماه مالی اسفند'].to, '1405/12/19');
  assert.equal(byName['ماه مالی اسفند'].id, '14051121');
  /* همهٔ مقادیر YYYYMMDD و ماه‌ها پشت‌سرهم و به‌ترتیب هستند */
  db.fiscalMonths.forEach((m) => assert.match(m.id, /^\d{8}$/));
  for (let i = 1; i < db.fiscalMonths.length; i++) {
    assert.ok(C.jalaliCmp(C.parseDate(db.fiscalMonths[i - 1].to), C.parseDate(db.fiscalMonths[i].from)) < 0);
  }
  /* اجرای دوباره بی‌تغییر می‌ماند */
  assert.equal(Rit.ensureFiscalMonths(db, '1405/08/23').changed, false);
  /* ماه مالی آبان، بازه‌ی فعلی (۱405/08/23) را در بر می‌گیرد */
  assert.equal(Rit.monthById(db, '14050721').name, 'ماه مالی آبان');
});

/* ------------------------------------------------------------- شمارش ریت */
test('آمار ریت: شمارش ریت بر اساس کارشناس کیوسی و کارشناس فروش در بازه و فیلتر تیم', () => {
  const db = {
    callFeedbacks: [
      { expertName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/21', team: 'اکانت', formType: 'account', sourceFile: 'f1.xlsx' },
      { expertName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/22', team: 'اکانت', formType: 'tele', sourceFile: 'f1.xlsx' },
      { expertName: 'ب', qcAgent: 'کیوسی ۲', reviewDate: '1405/07/23', team: 'تیکت', formType: 'mlm', sourceFile: 'f2.xlsx' },
      { expertName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/06/10', team: 'اکانت', formType: 'tele', sourceFile: 'f0.xlsx' }
    ],
    tickets: [
      { agentName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/25', team: 'اکانت' }
    ],
    socials: [
      { agentName: 'ب', qcAgent: 'کیوسی ۲', reviewDate: '1405/07/26', team: 'تیکت' }
    ],
    monthlyScores: [
      { expertName: 'الف', channel: 'ticket', periodFrom: '1405/07/20', periodTo: '1405/08/19', team: 'اکانت', evalCount: 3 }
    ]
  };
  const out = Rit.stats(db, { from: '1405/07/20', to: '1405/08/19' });
  assert.equal(out.totals.all, 8); // ۳ تماس + ۱ تیکت + ۱ سوشال + ۳ ماهانه
  assert.equal(out.totals.withQc, 5);
  assert.equal(out.totals.calls, 3);
  assert.equal(out.totals.tickets, 4); // ۱ ارزیابی تیکت + ۳ ماهانه تیکت
  assert.equal(out.totals.socials, 1);
  const ex1 = out.experts.find((e) => e.qc === 'کیوسی ۱');
  assert.equal(ex1.total, 3);
  const ag1 = ex1.byAgent.find((a) => a.agent === 'الف');
  assert.equal(ag1.total, 3);
  assert.equal(ag1.forms.tele, 1);
  assert.equal(ag1.forms.account, 1);
  assert.equal(ag1.forms.ticket, 1);
  assert.equal(ag1.files.length, 1);
  assert.equal(ag1.files[0].file, 'f1.xlsx');
  const ex2 = out.experts.find((e) => e.qc === 'کیوسی ۲');
  assert.equal(ex2.total, 2);
  /* ردیف خارج از بازه ندید می‌شود */
  assert.ok(!out.experts.some((e) => e.qc === 'کیوسی ۱' && e.byAgent.some((a) => a.files.some((f) => f.file === 'f0.xlsx'))));
  /* فیلتر تیم */
  const outTeam = Rit.stats(db, { from: '1405/07/20', to: '1405/08/19', team: 'اکانت' });
  assert.equal(outTeam.totals.all, 6);
  const outQc = Rit.stats(db, { from: '1405/07/20', to: '1405/08/19', qcAgent: 'کیوسی ۲' });
  assert.equal(outQc.totals.withQc, 2);
  /* جمع تیم‌ها ماهانه‌ها را هم دارد: ۲ تماس + ۱ تیکت + ۳ ماهانه */
  const aban = out.teams.find((t) => t.team === 'اکانت');
  assert.equal(aban.total, 6);
});

/* ------------------------------------------------------------- مرکز دیتا */
test('آمار ریت: مرکز دیتا — فیلتر بر اساس بازه و تیم و مرتب‌سازی', () => {
  const db = {
    callFeedbacks: [
      { expertName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/21', team: 'اکانت', formType: 'tele', sourceFile: 'آ.xlsx' },
      { expertName: 'ب', qcAgent: 'کیوسی ۲', reviewDate: '1405/08/01', team: 'تیکت', formType: 'tele', sourceFile: 'ب.xlsx' }
    ],
    tickets: [{ agentName: 'ج', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/22', team: 'اکانت', sourceFile: 'آ.xlsx' }]
  };
  const all = Rit.files(db, {});
  assert.equal(all.total, 2);
  const sorted = all.files.map((f) => f.name);
  assert.deepEqual(sorted.sort(), ['آ.xlsx', 'ب.xlsx']);
  const byRows = Rit.files(db, { sort: 'rows', dir: 'desc' });
  assert.equal(byRows.files[0].name, 'آ.xlsx');
  const inRange = Rit.files(db, { from: '1405/08/01', to: '1405/08/19' });
  assert.equal(inRange.total, 1);
  assert.equal(inRange.files[0].name, 'ب.xlsx');
  const byTeam = Rit.files(db, { team: 'اکانت' });
  assert.equal(byTeam.total, 1);
  assert.equal(byTeam.files[0].name, 'آ.xlsx');
  const search = Rit.files(db, { q: 'ب' });
  assert.equal(search.total, 1);
});

/* ------------------------------------------------------------- ردیف‌های خام */
test('آمار ریت: ردیف‌های خام اکسل بر اساس کارشناس کیوسی، کارشناس فروش، تاریخ و تیم فیلتر می‌شوند', () => {
  const db = {
    ritRaw: {
      'f1.xlsx': {
        headers: ['expert_name', 'score', 'review_date', 'qc_expert_name', 'team'],
        rows: [
          { expert_name: 'الف', score: 90, review_date: '1405/07/21', qc_expert_name: 'کیوسی ۱', team: 'اکانت' },
          { expert_name: 'ب', score: 80, review_date: '1405/07/22', qc_expert_name: 'کیوسی ۱', team: 'تیکت' },
          { expert_name: 'الف', score: 70, review_date: '1405/07/23', qc_expert_name: 'کیوسی ۲', team: 'اکانت' }
        ]
      }
    }
  };
  const all = Rit.rawRows(db, { file: 'f1.xlsx' });
  assert.equal(all.total, 3);
  assert.equal(all.headers.length, 5);
  const byQc = Rit.rawRows(db, { file: 'f1.xlsx', qc: 'کیوسی ۱' });
  assert.equal(byQc.rows.length, 2);
  const byQcAgent = Rit.rawRows(db, { file: 'f1.xlsx', qc: 'کیوسی ۱', agent: 'الف' });
  assert.equal(byQcAgent.rows.length, 1);
  assert.equal(byQcAgent.rows[0].cells.score, 90);
  const byDate = Rit.rawRows(db, { file: 'f1.xlsx', from: '1405/07/22', to: '1405/07/23' });
  assert.equal(byDate.rows.length, 2);
  const byTeam = Rit.rawRows(db, { file: 'f1.xlsx', team: 'اکانت' });
  assert.equal(byTeam.rows.length, 2);
  /* نام فایل واقعی — با qc/agent سية‌سازی می‌شود */
  const allFiles = Rit.rawRows(db, {});
  assert.equal(allFiles.total, 3);
  /* محدودیت خروجی */
  const limited = Rit.rawRows(db, { file: 'f1.xlsx', limit: 2 });
  assert.equal(limited.rows.length, 2);
  assert.equal(limited.total, 3);
});

test('آمار ریت: فیلتر تیم روی فایل بدون ستون تیم ردیف‌ها را حذف نمی‌کند', () => {
  /* فایل اکسل خام تماس ستون تیم ندارد؛ در پاپ‌آپ دیتای خام فیلتر تیم
   * نباید باعث خالی شدن خروجی شود. */
  const db = {
    ritRaw: {
      'calls.xlsx': {
        headers: ['expert_name', 'qc_expert_name', 'review_date'],
        rows: [
          { expert_name: 'الف', qc_expert_name: 'کیوسی ۱', review_date: '1405/07/21' },
          { expert_name: 'ب', qc_expert_name: 'کیوسی ۱', review_date: '1405/07/22' }
        ]
      }
    }
  };
  const byTeamNoCol = Rit.rawRows(db, { file: 'calls.xlsx', team: 'Tele sales' });
  assert.equal(byTeamNoCol.rows.length, 2);
  /* فیلتر qc/agent با وجود فقدان ستون تیم باز هم کار می‌کند */
  const byQcTeam = Rit.rawRows(db, { file: 'calls.xlsx', qc: 'کیوسی ۱', team: 'Tele sales' });
  assert.equal(byQcTeam.rows.length, 2);
  const byAgent = Rit.rawRows(db, { file: 'calls.xlsx', agent: 'الف', team: 'Tele sales' });
  assert.equal(byAgent.rows.length, 1);
  /* فایل دارنده ستون تیم: فیلتر همچنان بر اساس مقدار اعمال می‌شود */
  const db2 = {
    ritRaw: {
      'withTeam.xlsx': {
        headers: ['expert_name', 'team'],
        rows: [
          { expert_name: 'الف', team: 'Tele sales' },
          { expert_name: 'ب', team: 'اکانت' }
        ]
      }
    }
  };
  const filtered = Rit.rawRows(db2, { file: 'withTeam.xlsx', team: 'Tele sales' });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].cells.expert_name, 'الف');
});

/* ------------------------------------------------------------- تارگت */
test('آمار ریت: ذخیره، بازسازی و حذف تارگت ماهانه با پیش‌رفت واقعی', () => {
  const db = {
    fiscalMonths: [],
    callFeedbacks: [
      { expertName: 'الف', qcAgent: 'کیوسی ۱', reviewDate: '1405/07/21', team: 'اکانت', formType: 'tele' },
      { expertName: 'ب', qcAgent: 'کیوسی ۲', reviewDate: '1405/08/01', team: 'اکانت', formType: 'account' }
    ]
  };
  Rit.ensureFiscalMonths(db, '1405/08/23');
  const out = Rit.saveTarget(db, { team: 'اکانت', month: '14050721', target: 20, note: 'تماس+سوشال+تیکت' });
  assert.equal(out.ok, true);
  assert.equal(db.ritTargets.length, 1);
  /* بازسازی همان تیم+ماه تغییر می‌دهد نه کپی می‌سازد */
  Rit.saveTarget(db, { team: 'اکانت', month: '14050721', target: 25 });
  assert.equal(db.ritTargets.length, 1);
  assert.equal(db.ritTargets[0].target, 25);
  /* پیش‌رفت: ۲ ریت از ۲۰ = ۱۰٪ */
  const withProgress = Rit.targetsWithProgress(db);
  assert.equal(withProgress.length, 1);
  assert.equal(withProgress[0].actual, 2);
  assert.equal(withProgress[0].pct, 8);
  /* حذف */
  const removed = Rit.removeTarget(db, db.ritTargets[0].id);
  assert.equal(removed.ok, true);
  assert.equal(db.ritTargets.length, 0);
});

/* ------------------------------------------------------------- ذخیره‌ی ردیف‌های خام هنگام آپلود */
test('آمار ریت: آپلود اکسل ردیف‌های خام را ذخیره می‌کند و حذف فایل آن‌ها را پاک می‌کند', () => {
  const db = fixture();
  const rows = [
    { expert_name: 'کارشناس الف', score: 90, review_date: '1405/07/21', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ۱' },
    { expert_name: 'کارشناس ب', score: 80, review_date: '1405/07/22', qc_expert_name: 'کیوسی ب', lead_name: 'شریک ۲' }
  ];
  const res = I.callFiles(db, [{ name: 'rit-test-tele.xlsx', rows: rows }], { mode: 'append' });
  assert.equal(res.ok, true);
  assert.ok(db.ritRaw['rit-test-tele.xlsx'], 'ritRaw برای فایل آپلودشده ساخته می‌شود');
  assert.deepEqual(db.ritRaw['rit-test-tele.xlsx'].headers, ['expert_name', 'score', 'review_date', 'qc_expert_name', 'lead_name']);
  assert.equal(db.ritRaw['rit-test-tele.xlsx'].rows.length, 2);
  /* ردیف‌های ذخیره‌شده دقیقاً همان چیزی هستند که آپلود شد */
  assert.equal(db.ritRaw['rit-test-tele.xlsx'].rows[0].qc_expert_name, 'کیوسی الف');
  /* حذف فایل، ردیف‌های خام را هم پاک می‌کند */
  I.deleteSourceFile(db, 'rit-test-tele.xlsx', 'form');
  assert.equal(db.ritRaw['rit-test-tele.xlsx'], undefined);
});

/* ------------------------------------------------------------- فایل پيورگ ریت */
test('آمار ریت: فایل پيورگ (ستون‌های کارشناس کیوسی + مقادیر عددی) شناسایی و هر سلول به‌عنوان ریت ثبت می‌شود', () => {
  /* ساخت مدل یک فایل پيورگ: ردیف‌ها کارشناسان فروش، ستون‌ها کارشناسان کیوسی */
  const pivotRows = [
    { expert_name: 'Total', Hadi_Aghaee: 36, Sheyda_Faraz: 57, Arash_Hadipour: 154 },
    { expert_name: 'الف خمسه', internal_code: '3140', Hadi_Aghaee: 2, Sheyda_Faraz: 3, Arash_Hadipour: 5 },
    { expert_name: 'ب عباسی', internal_code: '3136', Hadi_Aghaee: 0, Sheyda_Faraz: 4, Arash_Hadipour: 1 }
  ];
  assert.equal(P.isPivotFile(pivotRows), true, 'پيورگ شناسایی می‌شود');
  /* فایلی با ستون نمره پيورگ نیست */
  assert.equal(P.isPivotFile([{ expert_name: 'الف', score: 90, qc_expert_name: 'کیوسی' }]), false);
  /* کلاسیفیکاسیون: kind = pivot، formType null */
  const cls = P.classifyCallFile('qc_army_pivote_2026-11-21T17_24_56.xlsx', pivotRows);
  assert.equal(cls.kind, 'pivot');
  assert.equal(cls.formType, null);

  const db = fixture();
  const res = I.callFiles(db, [{ name: 'qc_army_pivote_2026-11-21T17_24_56.xlsx', rows: pivotRows }], { mode: 'append' });
  assert.equal(res.ok, true);
  const out = res.results[0];
  assert.equal(out.ok, true);
  assert.equal(out.kind, 'pivot');
  assert.equal(out.count, 5, 'دو ردیف غیرترکیبی × ستون‌های دارای مقدار = ۵ سلول');

  /* هر سلول با تعداد خود در آمار ریت محاسبه می‌شود.
   * تاریخ fallback از نام فایل (2026-11-21 = 1405/08/30) → ماه مالی آذر (1405/08/20→1405/09/19) */
  Rit.ensureFiscalMonths(db, '1405/11/21');
  const stats = Rit.stats(db, { from: '1405/08/20', to: '1405/09/19' });
  const ex = stats.experts.find((q) => q.qc === 'Hadi_Aghaee');
  assert.ok(ex, 'Hadi_Aghaee در لیست کارشناسان کیوسی است');
  assert.equal(ex.total, 2, '۲ ریت برای Hadi_Aghaee (الف خمسه ۲ + ب عباسی ۰)');
  const agent = ex.byAgent.find((a) => a.agent === 'الف خمسه');
  assert.equal(agent.total, 2);
  const sx = stats.experts.find((q) => q.qc === 'Sheyda_Faraz');
  assert.equal(sx.total, 7, '۳ + ۴ = ۷');
  assert.equal(stats.totals.pivot, 15, 'جمع مقادیر سلول‌ها (۲+۳+۵+۴+۱) در شمارش پيورگ');

  /* ردیف خام ذخیره می‌شود و drill-down کارشناس کیوسی بر اساس ستون doing می‌شود */
  assert.ok(db.ritRaw['qc_army_pivote_2026-11-21T17_24_56.xlsx']);
  const raw = Rit.rawRows(db, { file: 'qc_army_pivote_2026-11-21T17_24_56.xlsx', qc: 'Sheyda_Faraz' });
  assert.equal(raw.total, 3, 'سه ردیف خام بررسی می‌شود (ردیف مجموع هم افزوده می‌شود)');
  assert.equal(raw.rows.length, 2, 'دو ردیف کارشناس فروش برای Sheyda_Faraz');
  assert.equal(raw.rows[0].pivot, true, 'نشان‌دهنده‌ی پيورگ برای UI');

  /* حذف فایل پيورگ، ریت‌های آن و ردیف‌های خام را پاک می‌کند */
  const del = I.deleteSourceFile(db, 'qc_army_pivote_2026-11-21T17_24_56.xlsx', 'pivot');
  assert.equal(del.ok, true);
  assert.equal(del.removedPivots, 5);
  assert.equal((db.ritPivots || []).length, 0);
  assert.equal(db.ritRaw['qc_army_pivote_2026-11-21T17_24_56.xlsx'], undefined);
});

/* ------------------------------------------------------------- دتپلیکت بر اساس تاریخ بررسی */
test('آمار ریت: ریت‌های تکراری در فایل‌های هفته‌ی مختلف بر اساس تاریخ بررسی یک‌بار محاسبه می‌شوند', () => {
  /* یک ریت با تاریخ بررسی ۱۴۰۵/۰۷/۲۱ در هر دو فایل این هفته و هفته بعدی می‌آید */
  const week1Rows = [
    { expert_name: 'کارشناس الف', score: 90, review_date: '1405/07/21', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ۱', lead_phone: '09120000001' },
    { expert_name: 'کارشناس الف', score: 70, review_date: '1405/07/22', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ۲', lead_phone: '09120000002' }
  ];
  const week2Rows = [
    { expert_name: 'کارشناس الف', score: 90, review_date: '1405/07/21', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ۱', lead_phone: '09120000001' },
    { expert_name: 'کارشناس الف', score: 85, review_date: '1405/07/28', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ۳', lead_phone: '09120000003' }
  ];
  const db = fixture();
  db.callFeedbacks = [];
  /* آپلود فایل هفته اول (نام فایل نوع فرم را نشان می‌دهد) */
  const r1 = I.callFiles(db, [{ name: 'week1-tele.xlsx', rows: week1Rows }], { mode: 'append' });
  assert.equal(r1.ok, true);
  assert.equal(db.callFeedbacks.length, 2, 'دو ریت در هفته اول');
  /* آپلود فایل هفته دوم — ریت ۱۴۰۵/۰۷/۲۱ تکراری است */
  const r2 = I.callFiles(db, [{ name: 'week2-tele.xlsx', rows: week2Rows }], { mode: 'append' });
  assert.equal(r2.ok, true);
  /* دتپلیکت در سطح کل اسtore انجام می‌شود (فایل مبدأ در هویت احتساب نمی‌شود):
     ریتِ تکراری (تاریخ بررسی ۱۴۰۵/۰۷/۲۱) یک‌بار نگه می‌شود — مجموع ۳ ریت (۲ + ۱ جدید). */
  assert.equal(db.callFeedbacks.length, 3, 'ریت تکراری در store ذخیره نمی‌شود');
  /* آمار ریت هم همان تعداد را می‌بیند */
  const stats = Rit.stats(db, { from: '1405/07/20', to: '1405/08/19' });
  const ex = stats.experts.find((q) => q.qc === 'کیوسی الف');
  assert.equal(ex.total, 3, 'آمار ریت فقط ریت‌های یک‌تای با تاریخ بررسی مختلف را می‌شمارند');
  /* ریت‌های مستقلِ هم‌تاریخ (محتوای متفاوت — نمره متفاوت) با هم تلفیق نمی‌شوند */
  const db2 = fixture(); db2.callFeedbacks = [];
  I.callFiles(db2, [{ name: 'same-day-tele.xlsx', rows: [
    { expert_name: 'کارشناس الف', score: 100, review_date: '1405/07/21', qc_expert_name: 'کیوسی الف', lead_name: 'شریک الف', lead_phone: '09120000010' },
    { expert_name: 'کارشناس الف', score: 40, review_date: '1405/07/21', qc_expert_name: 'کیوسی الف', lead_name: 'شریک ب', lead_phone: '09120000011' }
  ] }], { mode: 'append' });
  assert.equal(db2.callFeedbacks.length, 2, 'دو ریت مستقل با تاریخ بررسی یکسان و محتوای متفاوت هر دو نگه می‌شوند');
});

/* ------------------------------------------------------------- گزارش تیمی */
test('آمار ریت: گزارش تجمیعی تیمی — نمره و تعداد ریت تیکت/سوشال/تماس هر تیم در هفته', () => {
  const R = require('../shared/reports');
  const db = fixture();
  db.tickets = [
    { id: 1, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/21', score: 80, qcAgent: 'کیوسی الف', ticketCode: 'T-1' },
    { id: 2, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/22', score: 60, qcAgent: 'کیوسی الف', ticketCode: 'T-2' },
    { id: 3, agentName: 'کارشناس ب', team: 'Account', reviewDate: '1405/07/23', score: 90, qcAgent: 'کیوسی ب', ticketCode: 'T-3' }
  ];
  db.socials = [
    { id: 1, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/21', score: 70, qcAgent: 'کیوسی الف', responseStatus: 'پاسخ‌داده‌شده' }
  ];
  db.callFeedbacks = [
    { expertName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/20', formType: 'tele', score: 75, qcAgent: 'کیوسی الف' },
    { expertName: 'کارشناس ب', team: 'Account', reviewDate: '1405/07/24', formType: 'account', score: 85, qcAgent: 'کیوسی ب' }
  ];
  const rows = R.combinedTeamReport(db, { from: '1405/07/20', to: '1405/08/19' });
  assert.equal(rows.length, 2, 'دو تیم در گزارش تیمی');
  const tele = rows.find((r) => r.name === 'Tele Sales');
  assert.equal(tele.ticketCount, 2, '۲ ریت تیکت برای تیم Tele Sales');
  assert.equal(tele.socialCount, 1, '۱ ریت سوشال برای تیم Tele Sales');
  assert.equal(tele.callCount, 1, '۱ ریت تماس برای تیم Tele Sales');
  assert.equal(tele.totalCount, 4, 'مجموع ریت تیم Tele Sales');
  assert.ok(tele.avgScore !== '' && tele.avgScore > 0, 'نمره کل وزن‌دار تیم محاسبه می‌شود');
  const acc = rows.find((r) => r.name === 'Account');
  assert.equal(acc.ticketCount, 1);
  assert.equal(acc.callCount, 1);
  assert.equal(acc.totalCount, 2);
  assert.equal(acc.agentsEvaluated, 1, 'یک کارشناس در تیم Account ارزیابی شده');
});

/* ------------------------------------------------------------- برچسب ماه مالی برای بازه */
test('آمار ریت: fiscalLabelForRange ماه مالی‌ی با بیشترین هم‌پوشانی بازه را برمی‌گرداند', () => {
  const db = fixture();
  Rit.ensureFiscalMonths(db, '1405/11/21');
  const label = Rit.fiscalLabelForRange(db, '1405/07/20', '1405/08/19');
  assert.equal(label, 'ماه مالی آبان', 'بازه ۱۴۰۵/۰۷/۲۰–۱۴۰۵/۰۸/۱۹ در ماه مالی آبان است');
  const label2 = Rit.fiscalLabelForRange(db, '1405/08/20', '1405/09/19');
  assert.equal(label2, 'ماه مالی آذر');
  assert.equal(Rit.fiscalLabelForRange(db, '', ''), '');
});

/* ------------------------------------------------------------- totals کارشناس فروش */
test('آمار ریت: agentTotals برای هر کارشناس فروش در بازه محاسبه می‌شود', () => {
  const db = fixture();
  db.callFeedbacks = [
    { expertName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/20', formType: 'tele', score: 80, qcAgent: 'کیوسی الف' },
    { expertName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/21', formType: 'account', score: 70, qcAgent: 'کیوسی ب' },
    { expertName: 'کارشناس ب', team: 'Account', reviewDate: '1405/07/22', formType: 'tele', score: 90, qcAgent: 'کیوسی الف' }
  ];
  db.tickets = [{ id: 1, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/07/20', score: 60, qcAgent: 'کیوسی الف', ticketCode: 'T-1' }];
  const d = Rit.stats(db, { from: '1405/07/20', to: '1405/08/19' });
  const a1 = d.agentTotals.find((a) => a.agent === 'کارشناس الف');
  assert.equal(a1.total, 3, 'کارشناس الف: ۲ تماس + ۱ تیکت = ۳ ریت');
  assert.equal(a1.team, 'Tele Sales');
  const a2 = d.agentTotals.find((a) => a.agent === 'کارشناس ب');
  assert.equal(a2.total, 1);
  assert.equal(a2.team, 'Account');
});
