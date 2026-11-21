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
