/* =========================================================================
 * parseQc.js — پارسر مشترک فرم‌های QC تماس (tele/account/mlm)
 * منطق دقیقاً منطبق بر parseRows پنل دستیار ریت QC است؛
 * کوتیشن‌های اضافی پاک می‌شوند، تاریخ‌های Excel/ISO/شمسی همه به شمسی تبدیل می‌شوند.
 * UMD: مرورگر (window.QCParse) و Node (require) هر دو.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.QCParse = factory(root.QCCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

/* ---------- دیکشنری المان‌های ثابت (Fixed) و موقعیتی (Situational) ---------- */
/* تیم‌های اکانت و تله‌سلز طبق ساختار جدید به دو دسته‌ی «المان‌های ثابت» و «المان‌های موقعیتی»
 * تفکیک شده‌اند؛ تیم MLM / BNPL بدون تغییر باقی مانده است. */
const TELE_CRITERIA = [
  'call_opening_quality', 'proper_introduction', 'active_engagement_and_listening',
  'needs_assessment', 'value_communication_and_tailored_offer', 'appropriate_tone_and_language',
  'cta_and_follow_up', 'proper_call_closure', 'correctly_record_action', 'complete_note_recording'
];
const ACCOUNT_CRITERIA = [
  'call_opening_quality', 'proper_introduction', 'call_topic_mastery',
  'active_engagement_and_listening', 'needs_assessment', 'value_communication_and_tailored_offer',
  'appropriate_tone_and_language', 'cta_and_follow_up', 'proper_call_closure',
  'correctly_record_action', 'complete_note_recording'
];
const MLM_CRITERIA = [
  'Call_opening_quality', 'agent_introduction_and_role', 'user_identify_verification',
  'pre_offer_needs_assessment', 'professional_concern_handling', 'effective_negotiation',
  'link_establishment', 'professional_tone', 'courteous_closure', 'call_action_logging', 'note'
];

/* المان‌های موقعیتی (استخراج از فایل اکسل دوم: new_*_form___score_calc_*.xlsx)
 * نمره‌ی نهایی المان‌های موقعیتی منحصراً از ستون calc_situational_score خوانده می‌شود. */
const SITUATIONAL_CRITERIA = {
  account: [
    {
      key: 'objection_and_concern_handling',
      label: 'مدیریت اعتراض و نگرانی',
      avgKeys: ['avg_objection_and_concern_handling'],
      countKeys: ['n_objection_and_concern_handling']
    },
    {
      key: 'campaign_announcement',
      label: 'اعلام جشنواره',
      avgKeys: ['avg_campaign_announcement'],
      countKeys: ['n_campaign_announcement']
    },
    {
      key: 'mandatory_fields_recording',
      label: 'ثبت موارد الزامی',
      avgKeys: ['avg_mandatory_fields_recording'],
      countKeys: ['n_mandatory_fields_recording']
    },
    {
      key: 'previous_commitment_followup',
      label: 'پیگیری تعهد قبلی',
      /* در خروجی فعلی متابیس اکانت ستون previous_commitment_followup با avg_cta_and_follow_up آمده است؛
       * اولویت با ستون اختصاصی است و در صورت نبود، از ستون فعلی متابیس خوانده می‌شود. */
      avgKeys: ['avg_previous_commitment_followup', 'avg_previous_commitment_follow_up', 'avg_cta_and_follow_up'],
      countKeys: ['n_previous_commitment_followup', 'n_previous_commitment_follow_up', 'n_cta_and_follow_up']
    }
  ],
  tele: [
    {
      key: 'objection_and_concern_handling',
      label: 'مدیریت اعتراض و نگرانی',
      avgKeys: ['avg_objection_and_concern_handling'],
      countKeys: ['n_objection_and_concern_handling']
    },
    {
      key: 'commission_presentation',
      label: 'اعلام صحیح و جذاب کارمزد',
      avgKeys: ['avg_commission_presentation'],
      countKeys: ['n_commission_presentation']
    },
    {
      key: 'panel_introduction',
      label: 'معرفی پنل',
      avgKeys: ['avg_panel_introduction'],
      countKeys: ['n_panel_introduction']
    },
    {
      key: 'mandatory_fields_recording',
      label: 'ثبت موارد الزامی',
      avgKeys: ['avg_mandatory_fields_recording'],
      countKeys: ['n_mandatory_fields_recording']
    },
    {
      key: 'previous_commitment_follow_up',
      label: 'پیگیری تعهد قبلی',
      avgKeys: ['avg_previous_commitment_follow_up', 'avg_previous_commitment_followup'],
      countKeys: ['n_previous_commitment_follow_up', 'n_previous_commitment_followup']
    },
    {
      key: 'new_panel_opportunity_identification',
      label: 'شناسایی فرصت ایجاد پنل جدید',
      avgKeys: ['avg_new_panel_opportunity_identification'],
      countKeys: ['n_new_panel_opportunity_identification']
    },
    {
      key: 'parallel_campaign_presentation',
      label: 'اعلام جشنواره موازی',
      avgKeys: ['avg_parallel_campaign_presentation'],
      countKeys: ['n_parallel_campaign_presentation']
    }
  ],
  mlm: []
};

/* برچسب فارسی هر معیار ثابت (برای نمایش در UI و خروجی اکسل) */
const CRITERIA_LABELS = {
  tele: {
    call_opening_quality: 'شروع مناسب مکالمه',
    proper_introduction: 'معرفی صحیح',
    active_engagement_and_listening: 'تعامل فعال و گوش‌دادن مؤثر',
    needs_assessment: 'نیازسنجی قبل از ارائه پیشنهاد',
    value_communication_and_tailored_offer: 'انتقال ارزش و ارائه پیشنهاد متناسب',
    appropriate_tone_and_language: 'لحن و ادبیات متناسب',
    cta_and_follow_up: 'CTA | پیگیری مشخص',
    proper_call_closure: 'پایان‌بندی مناسب مکالمه',
    correctly_record_action: 'ثبت صحیح اکشن',
    complete_note_recording: 'ثبت یادداشت کامل'
  },
  account: {
    call_opening_quality: 'شروع به‌موقع مکالمه',
    proper_introduction: 'معرفی صحیح',
    call_topic_mastery: 'تسلط به موضوع تماس',
    active_engagement_and_listening: 'تعامل فعال',
    needs_assessment: 'نیازسنجی قبل از ارائه پیشنهاد',
    value_communication_and_tailored_offer: 'انتقال ارزش و ارائه پیشنهاد متناسب',
    appropriate_tone_and_language: 'لحن و ادبیات متناسب',
    cta_and_follow_up: 'CTA / پیگیری مشخص',
    proper_call_closure: 'پایان‌بندی مناسب مکالمه',
    correctly_record_action: 'ثبت صحیح اکشن',
    complete_note_recording: 'ثبت یادداشت'
  },
  mlm: {
    Call_opening_quality: 'شروع مناسب مکالمه', agent_introduction_and_role: 'معرفی خود و اعلام واحد',
    user_identify_verification: 'احراز هویت نماینده', pre_offer_needs_assessment: 'نیازسنجی قبل از ارائه پیشنهاد',
    professional_concern_handling: 'مدیریت حرفه‌ای نگرانی‌ها و اعتراضات', effective_negotiation: 'تعامل و مذاکره مؤثر',
    link_establishment: 'ایجاد یا تثبیت راه ارتباطی', professional_tone: 'ادبیات حرفه‌ای',
    courteous_closure: 'پایان‌بندی محترمانه تماس', call_action_logging: 'ثبت درست اکشن تماس',
    note: 'یادداشت کامل'
  }
};

/* برچسب‌های سوابق قدیمی (فقط برای نمایش رکوردهای تاریخی پیش از تغییر فرم) */
const LEGACY_LABELS = {
  tele: {
    Call_opening_quality: 'شروع مناسب مکالمه', outbound_call_targeting: 'هدف گذاری تماس',
    customer_language_alignment: 'زبان مشتری', applied_product_knowledge: 'دانش کاربردی محصول',
    active_engagement: 'تعامل فعال', partner_objection_management: 'مدیریت اعتراض یا مقاومت شریک',
    attractive_payout_announcement: 'اعلام صحیح و جذاب کارمزد', tone_politeness: 'لحن و ادب',
    campaign_reference: 'پرزنت صحیح جشنواره', final_call_review: 'بازبینی نهایی تماس',
    lead_retention: 'حفظ لید', Correctly_record_action: 'ثبت درست اکشن تماس',
    mandatory_check: 'ثبت موارد الزامی در CRM', sla_compliance: 'رعایت SLA', note: 'درج یادداشت'
  },
  account: {
    Call_opening_quality: 'شروع به‌موقع مکالمه', outbound_call_targeting: 'هدف گذاری تماس',
    partner_objection_identification: 'شناسایی دغدغه شریک', need_based_value_articulation: 'انتقال ارزش محصول',
    partner_objection_management: 'مدیریت اعتراض شریک', partner_tailored_presentation: 'پرزنت جشنواره متناسب',
    stakeholder_intent_evaluation: 'ارزیابی آمادگی شریک', applied_product_knowledge: 'دانش کاربردی محصول',
    cta_guidance: 'هدایت به CTA مشخص', human_linkage: 'روابط انسانی موثر',
    Correctly_record_action: 'ثبت درست اکشن', sales_impediment: 'ثبت مانع کلیدی فروش',
    mandatory_check: 'ثبت موارد الزامی CRM', Final_call_analysis: 'تحلیل نهایی در CRM'
  }
};

/* ---------- پاک‌سازی ارزش (معادل cleanAndParseValue پنل) ---------- */
/* ---------------------- اصلاح: ترجمه‌ی هم‌منطق پنل
   مقدار خام با کوتیشن‌های اضافی '"'1'"' را به عدد/رشته درمی‌آورد */
/* redline به شکل‌های مختلف: 1 | '1' | '\"1\"' | '1.0' | true */
function isRedline(v) { return C.normalizeTri(v) === 1; }
function cleanText(val) {
  if (val === undefined || val === null) return '';
  return String(val).replace(/["']/g, '').trim();
}
function cleanOptionalText(val) {
  if (val === undefined || val === null) return '';
  let s = String(val).trim();
  while (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s || /^(-|—|–|null|none|n\/a|nan)$/i.test(s)) return '';
  return s;
}
function normHeader(k) {
  return String(k == null ? '' : k)
    .replace(/[\u200c\u200b\u00a0]/g, ' ')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .trim().toLowerCase()
    .replace(/[\s_.\-]+/g, ' ');
}

/* ---------- تبدیل هر نوع تاریخ به اجزای جلالی ---------- */
/* ورودی: عدد اکسل (میلادی، مثل 46259.49)، رشته ISO/میلادی، رشته شمسی '1405/06/03'
 * خروجی: {jy,jm,jd} یا null */
function anyToJalali(v) { return C.parseDate(v); }
function cleanQcDate(v) { const j = anyToJalali(v); return j ? C.formatJalali(j) : ''; }

/* ---------- تشخیص کلیدها (case-insensitive, بدون فاصله) ---------- */
function findKey(row, candidates) {
  const keys = Object.keys(row);
  const norm = (k) => k.trim().toLowerCase();
  // ترتیب candidates مهم است؛ ترتیب ستون‌های فایل نباید تاریخ بررسی را عوض کند.
  for (const candidate of candidates) {
    const key = keys.find((k) => norm(k) === candidate);
    if (key != null) return key;
  }
  return null;
}

/* پیدا کردن ستون‌های علت ردلاین با هر سبک نام‌گذاری در اکسل‌های متابیس/دستی
 * (مثل redline_reason، Red_line_Reason، redline reason، RED LINE REASON، علت ردلاین، redline_reason_1 و ...) */
function findRedlineReason(row) {
  const keys = Object.keys(row || {});
  const exact = [
    'redline reason', 'red line reason', 'redline reasons', 'red line reasons',
    'redline text', 'red line text', 'redline comment', 'red line comment',
    'redline description', 'red line description', 'redline detail', 'red line detail',
    'علت ردلاین', 'دلیل ردلاین', 'توضیحات ردلاین', 'توضیح ردلاین', 'شرح ردلاین', 'متن ردلاین', 'علت خط قرمز'
  ];
  const matched = [];
  const pushKey = (k) => { if (k != null && !matched.includes(k)) matched.push(k); };
  for (const cand of exact) {
    for (const k of keys) {
      if (normHeader(k) === cand) pushKey(k);
    }
  }
  for (const k of keys) {
    const nh = normHeader(k);
    const isRedlineCol = /(?:red ?line|ردلاین|خط قرمز)/.test(nh);
    const hasReasonWord = /(?:reason|desc|detail|text|comment|note|علت|دلیل|شرح|توضیح|متن)/.test(nh);
    if (isRedlineCol && hasReasonWord) pushKey(k);
  }
  const values = [];
  for (const k of matched) {
    const v = cleanOptionalText(row[k]);
    if (v && !values.includes(v)) values.push(v);
  }
  return values.join(' — ');
}

function findQcComment(row) {
  const keys = Object.keys(row || {});
  const exact = [
    'qc comment', 'qc comments', 'کامنت qc', 'توضیحات qc', 'توضیح qc', 'یادداشت qc',
    'کامنت', 'توضیحات کارشناس qc', 'comment', 'comments'
  ];
  const matched = [];
  const pushKey = (k) => { if (k != null && !matched.includes(k)) matched.push(k); };
  for (const cand of exact) {
    for (const k of keys) {
      const nh = normHeader(k);
      if (nh === cand || nh.replace(/\s+\d+$/, '') === cand) pushKey(k);
    }
  }
  const values = [];
  for (const k of matched) {
    const v = cleanOptionalText(row[k]);
    if (v && !values.includes(v)) values.push(v);
  }
  return values.join(' — ');
}

/* ---------- پارس ردیف‌های یک فرم (دقیقاً منطق پنل به‌علاوه‌ی تبدیل تاریخ) ---------- */
/* rows: آرایه‌ی آبجکت‌های JSON از SheetJS (sheet_to_json)
 * type: 'tele' | 'account' | 'mlm'
 * خروجی: [{expertName, score, redline, redlineReason, leadName, leadPhone,
 *          listeningTime, qcComment, reviewDate, formType, elements}] */
function parseRows(rows, type, options) {
  options = options || {};
  const dt = ['review_date', 'reviewdate', 'تاریخ بررسی', 'form_created_date', 'form created date', 'action_date', 'action date'];
  const list = [];
  for (const [index, r] of (rows || []).entries()) {
    const nameKey = findKey(r, ['tele_expert_name', 'account_expert_name', 'account expert name', 'acc_expert_name', 'expert_name', 'expertname']);
    const rawName = nameKey ? normName(String(r[nameKey] == null ? '' : r[nameKey]).trim().replace(/^(["'])(.*)\1$/, '$2')) : '';
    const resolved = resolveExpert(options.agents || [], rawName);
    const expertName = resolved.agent ? resolved.agent.name : rawName;
    if (!expertName) continue;

    /* نمره تماس منحصراً از ستون score خوانده می‌شود (نه score1 و نه score2). */
    const scoreKey = findKey(r, ['score']);
    const redlineKey = ['redline', 'red_line', 'red line']
      .map((cand) => findKey(r, [cand]))
      .find((k) => k != null && cleanText(r[k]) !== '') || findKey(r, ['redline', 'red_line', 'red line']);
    const lsKey = findKey(r, ['listening_duration', 'listening duration', 'listening time (second)', 'listening_time_(second)', 'listening_time_second', 'listening_time']);
    // تاریخ بررسیِ غیرخالی ولی نامعتبر را با تاریخ تماس جایگزین نکنیم.
    const reviewKey = dt.slice(0, -2).map((key) => findKey(r, [key])).find((key) => key != null && cleanText(r[key]) !== '');
    const dateKey = reviewKey != null ? reviewKey : findKey(r, ['action_date', 'action date']);
    const actionDateKey = findKey(r, ['action_date', 'action date']);
    const qcKey = findKey(r, ['qc_expert_name', 'qc_agent', 'qcagent']);
    const leadKey = findKey(r, ['lead_name', 'lead name']);
    const phoneKey = findKey(r, ['lead_phone', 'lead phone']);
    const durationKey = findKey(r, ['call_duration', 'call duration', 'call_duration_second', 'call_duration (second)', 'conversation_time', 'talk_time', 'مدت مکالمه', 'تایم مکالمه']);
    const idKey = findKey(r, ['evaluation_id', 'form_id', 'call_id']);

    const score = C.normalizeScore(scoreKey ? r[scoreKey] : null);
    const redline = isRedline(redlineKey ? r[redlineKey] : null) ? 1 : 0;
    const redlineReason = findRedlineReason(r);
    const qcComment = findQcComment(r);

    const teamColumn = findKey(r, ['team', 'team_name', 'تیم']);
    const colTeam = teamColumn ? cleanText(r[teamColumn]) : '';
    const team = resolved.agent ? resolved.agent.team : (colTeam || options.team || defaultTeamForForm(type, options.agents));
    const defs = definitionsFor(type, team, options.criteria);
    const configured = hasConfiguration(type, team, options.criteria);
    const elements = {};
    for (const definition of defs) {
      const elKey = definition.key;
      let cell = undefined;
      for (const column of [definition.excelKey].concat(definition.aliases || [])) {
        const actual = Object.keys(r).find(k => columnKey(k) === columnKey(column));
        if (actual != null) { cell = r[actual]; break; }
      }
      // ستون غایب را به فرم اضافه نکن؛ سلول خالی با «-» صریح فرق دارد.
      if (cell !== undefined) elements[elKey] = C.normalizeTri(cell);
    }

    const parsed = {
      expertName,
      score,
      redline: (redline === 1 || redline === 0) ? redline : 0,
      redlineReason,
      leadName: leadKey ? cleanText(r[leadKey]) : '',
      leadPhone: phoneKey ? cleanText(r[phoneKey]) : '',
      listeningTime: lsKey ? cleanText(r[lsKey]) || '-' : '-',
      callDuration: durationKey ? cleanText(r[durationKey]) : '',
      qcAgent: qcKey ? normName(cleanText(r[qcKey])) : '',
      qcComment,
      reviewDate: dateKey ? cleanQcDate(r[dateKey]) : '',
      callDate: actionDateKey ? cleanQcDate(r[actionDateKey]) : '',
      sourceRow: index + 2,
      evaluationId: idKey ? cleanText(r[idKey]) : '',
      formType: type,
      elements
    };
    if (team) parsed.team = team;
    if (rawName !== expertName) parsed.sourceExpertName = rawName;
    if (configured) { parsed.criteriaVersion = Number((options.criteria || {}).version) || 1; parsed.criteriaSnapshot = defs.map(d => ({ key: d.key, label: d.label, excelKey: d.excelKey, active: d.active !== false })); }
    list.push(parsed);
  }
  return list;
}

/* ---------- پارس فایل المان‌های موقعیتی (new_*_form___score_calc_*.xlsx) ---------- */
function normalizeRatio(val) {
  if (val == null || val === '' || typeof val === 'boolean') return null;
  const s = C.faToEn(String(val)).replace(/["'%]/g, '').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

function normalizeCount(val) {
  if (val == null || val === '' || typeof val === 'boolean') return 0;
  const s = C.faToEn(String(val)).replace(/["']/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return 0;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function dateRangeOfCalls(rows) {
  const dates = (rows || [])
    .map(r => cleanQcDate(r && r.reviewDate))
    .filter(Boolean)
    .sort();
  return { from: dates[0] || '', to: dates[dates.length - 1] || '' };
}

function isSituationalFile(name, rows) {
  if (Array.isArray(rows) && rows.length) {
    const keys = new Set();
    for (const r of rows.slice(0, 12)) {
      if (r && typeof r === 'object') Object.keys(r).forEach(k => keys.add(String(k).trim().toLowerCase()));
    }
    if (keys.has('calc_situational_score')) return true;
    const hasPerCall = keys.has('form_created_date') || keys.has('action_date') || keys.has('review_date') || keys.has('score');
    const hasAgg = keys.has('forms_count') && Array.from(keys).some(k => k.startsWith('n_') || k.startsWith('avg_'));
    if (!hasPerCall && hasAgg) return true;
    return false;
  }
  const n = String(name || '').toLowerCase();
  return n.includes('score_calc') || n.includes('situational') || n.includes('موقعیت');
}

function classifyMonthlyScoreFile(name, rows) {
  const n = normName(name || '').toLowerCase();
  const keyList = [];
  if (Array.isArray(rows) && rows.length) {
    const seen = new Set();
    for (const r of rows.slice(0, 12)) {
      if (r && typeof r === 'object') Object.keys(r).forEach(k => {
        const ck = normName(k).toLowerCase();
        if (!seen.has(ck)) { seen.add(ck); keyList.push(ck); }
      });
    }
  }
  // Never misclassify call workbooks (fixed or score_calc)
  if (keyList.some(k => k === 'calc_situational_score' || k === 'tele_expert_name' || k === 'account_expert_name' || k === 'form_created_date' || k === 'lead_phone')) {
    return null;
  }
  const hasTicketCol = keyList.some(k => k.includes('نمره تیکت') || k === 'ticket_score' || k === 'ticketscore');
  const hasSocialCol = keyList.some(k => k.includes('نمره پیام') || k.includes('نمره سوشال') || k === 'social_score' || k === 'socialscore');
  if (hasTicketCol && !hasSocialCol) return 'ticket';
  if (hasSocialCol && !hasTicketCol) return 'social';
  // Generic score column + filename indicator
  const hasGenericScore = keyList.some(k => k === 'score' || k.startsWith('نمره'));
  const hasExpertCol = keyList.some(k => k.includes('کارشناس') || k === 'expert_name' || k === 'agent_name' || k === 'name');
  if ((hasGenericScore && hasExpertCol) || !keyList.length) {
    if (n.includes('تیکت') || n.includes('ticket')) return 'ticket';
    if (n.includes('پیام') || n.includes('سوشال') || n.includes('social')) return 'social';
  }
  return null;
}

/* پيورگ ریت: ردیف‌ها کارشناسان فروش (ستون expert_name) و ستون‌های دیگر نام
 * کارشناسان کیوسی با مقادیر عددی (تعداد ریت) هستند. هیچ ستون نمره‌ای ندارد. */
function isPivotFile(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const head = Object.keys(rows[0] || {});
  const expertKey = head.find((k) => columnKey(k) === 'expert_name' || columnKey(k) === 'expertname'
    || columnKey(k) === 'کارشناس' || columnKey(k) === 'نام کارشناس' || columnKey(k) === 'کارشناس فروش');
  if (!expertKey) return false;
  const scoreish = head.find((k) => /^(score|نمره)/i.test(columnKey(k)));
  if (scoreish) return false;
  const valueCols = head.filter((k) => k !== expertKey
    && !/internal_code|code|phone|شماره|کد|تلفن/i.test(columnKey(k)));
  if (valueCols.length < 2) return false;
  return rows.some((r) => valueCols.some((k) => normalizeCount(r[k]) > 0));
}

/* تبدیل پيورگ → ردیف‌های (کارشناس فروش، کارشناس کیوسی، تعداد). ردیف‌های
 * «مجموع/Total/میانگین» نادیده گرفته می‌شوند. */
function parsePivotRows(rows, options) {
  options = options || {};
  const list = [];
  for (const [index, r] of (rows || []).entries()) {
    const expertKey = findKey(r, ['expert_name', 'expertname', 'کارشناس', 'نام کارشناس', 'کارشناس فروش']);
    const rawName = expertKey ? normName(String(r[expertKey] == null ? '' : r[expertKey]).trim().replace(/^([\"'])(.*)\1$/, '$2')) : '';
    if (!rawName || /^مجموع$|^جمع|^میانگین|^total$|^average$/i.test(rawName)) continue;
    const cols = Object.keys(r).filter((k) => k !== expertKey
      && !/internal_code|code|phone|شماره|کد|تلفن/i.test(columnKey(k)));
    for (const col of cols) {
      const n = normalizeCount(r[col]);
      if (n > 0) {
        list.push({
          expertName: rawName,
          qcAgent: normName(col),
          count: n,
          sourceFile: options.sourceFile ? String(options.sourceFile) : '',
          sourceRow: index + 2
        });
      }
    }
  }
  return list;
}

function classifyCallFile(name, rows, config, team) {
  const monthlyChan = classifyMonthlyScoreFile(name, rows);
  if (monthlyChan) return { kind: 'monthly_score', channel: monthlyChan, formType: monthlyChan };
  if (isSituationalFile(name, rows)) return { kind: 'situational', formType: formTypeOfFileName(name) || sniffFormType(rows, config) || teamForm(team) };
  if (isPivotFile(rows)) return { kind: 'pivot', formType: null };
  const formType = formTypeOfFileName(name) || sniffFormType(rows, config) || teamForm(team);
  return { kind: 'fixed', formType: formType };
}

function monthlyScoreRowKey(row) {
  if (!row) return null;
  const channel = String(row.channel || '').trim().toLowerCase();
  const expert = nameKeyOf(row.expertName || '');
  const from = cleanQcDate(row.periodFrom) || String(row.periodFrom || '').trim();
  const to = cleanQcDate(row.periodTo) || String(row.periodTo || '').trim();
  if ((channel !== 'ticket' && channel !== 'social') || !expert) return null;
  return JSON.stringify([channel, expert, from, to]);
}

function findFlexKey(row, exactList, containsList) {
  const keys = Object.keys(row || {});
  const norms = keys.map(k => ({ raw: k, norm: normName(k).toLowerCase() }));
  for (const cand of (exactList || [])) {
    const cn = normName(cand).toLowerCase();
    const hit = norms.find(x => x.norm === cn);
    if (hit) return hit.raw;
  }
  for (const sub of (containsList || [])) {
    const sn = normName(sub).toLowerCase();
    const hit = norms.find(x => x.norm.includes(sn));
    if (hit) return hit.raw;
  }
  return null;
}

function parseMonthlyScoreRows(rows, channel, options) {
  options = options || {};
  const ch = String(channel || '').trim().toLowerCase();
  if (ch !== 'ticket' && ch !== 'social') return [];
  const agents = options.agents || [];
  const fallbackFrom = cleanQcDate(options.periodFrom || options.from || '');
  const fallbackTo = cleanQcDate(options.periodTo || options.to || '');
  const list = [];

  for (let index = 0; index < (rows || []).length; index++) {
    const r = rows[index];
    if (!r || typeof r !== 'object') continue;
    const nameKey = findFlexKey(r,
      ['نام کارشناس', 'کارشناس', 'expert_name', 'agent_name', 'expert', 'agent', 'name'],
      ['نام کارشناس', 'کارشناس']
    );
    const rawName = nameKey ? normName(r[nameKey]) : '';
    if (!rawName || /^مجموع$|^جمع|^میانگین|^total$|^average$/i.test(rawName)) continue;

    const scoreKey = ch === 'ticket'
      ? findFlexKey(r,
          ['نمره تیکت (۰ تا ۱۰۰)', 'نمره تیکت (0 تا 100)', 'نمره تیکت', 'ticket_score', 'ticketscore', 'score', 'نمره'],
          ['نمره تیکت', 'ticket_score', 'نمره'])
      : findFlexKey(r,
          ['نمره پیام‌رسان (۰ تا ۱۰۰)', 'نمره پیام‌رسان (0 تا 100)', 'نمره پیامرسان (۰ تا ۱۰۰)', 'نمره پیامرسان (0 تا 100)',
           'نمره پیام‌رسان', 'نمره پیامرسان', 'نمره سوشال', 'social_score', 'socialscore', 'score', 'نمره'],
          ['نمره پیام', 'نمره سوشال', 'social_score', 'نمره']);
    const score = scoreKey ? C.normalizeScore(r[scoreKey]) : null;
    // Empty score rows in a pre-filled template are ignored gracefully (never treated as 0)
    if (score === null) continue;

    const countKey = ch === 'ticket'
      ? findFlexKey(r, ['تعداد تیکت (اختیاری)', 'تعداد تیکت', 'ticket_count', 'eval_count', 'count', 'تعداد'], ['تعداد تیکت', 'تعداد'])
      : findFlexKey(r, ['تعداد پیام‌رسان (اختیاری)', 'تعداد پیامرسان (اختیاری)', 'تعداد پیام‌رسان', 'تعداد پیامرسان', 'تعداد سوشال', 'social_count', 'eval_count', 'count', 'تعداد'], ['تعداد پیام', 'تعداد سوشال', 'تعداد']);
    const teamKeyCol = findFlexKey(r, ['تیم', 'team'], ['تیم']);
    const fromKey = findFlexKey(r, ['از تاریخ (شمسی)', 'از تاریخ', 'period_from', 'from', 'start_date'], ['از تاریخ']);
    const toKey = findFlexKey(r, ['تا تاریخ (شمسی)', 'تا تاریخ', 'period_to', 'to', 'end_date'], ['تا تاریخ']);
    const noteKey = findFlexKey(r, ['توضیحات (اختیاری)', 'توضیحات', 'note', 'comment'], ['توضیح']);

    const resolved = resolveExpert(agents, rawName);
    const expertName = resolved.agent ? resolved.agent.name : rawName;
    const colTeam = teamKeyCol ? cleanText(r[teamKeyCol]) : '';
    const team = resolved.agent ? resolved.agent.team : (colTeam || options.team || '');
    const periodFrom = (fromKey && cleanQcDate(r[fromKey])) || fallbackFrom || '';
    const periodTo = (toKey && cleanQcDate(r[toKey])) || fallbackTo || periodFrom || '';
    const rawCount = countKey != null ? normalizeCount(r[countKey]) : 0;
    const evalCount = rawCount > 0 ? rawCount : 1;
    const note = noteKey ? cleanText(r[noteKey]) : '';

    const parsed = {
      channel: ch,
      expertName,
      team,
      periodFrom,
      periodTo,
      score,
      evalCount,
      note,
      sourceFile: options.sourceFile ? String(options.sourceFile) : '',
      sourceRow: index + 2
    };
    if (rawName !== expertName) parsed.sourceExpertName = rawName;
    parsed.syncId = 'ms:' + [ch, nameKeyOf(expertName), periodFrom || 'all', periodTo || 'all'].join('|');
    list.push(parsed);
  }
  return list;
}

function situationalRowKey(row) {
  if (!row) return null;
  const form = String(row.formType || '').trim().toLowerCase();
  const expert = nameKeyOf(row.expertName || '');
  const from = cleanQcDate(row.periodFrom) || String(row.periodFrom || '').trim();
  const to = cleanQcDate(row.periodTo) || String(row.periodTo || '').trim();
  if (!form || !expert) return null;
  return JSON.stringify([form, expert, from, to]);
}

function parseSituationalRows(rows, type, options) {
  options = options || {};
  const defs = situationalDefinitionsFor(type, options.team, options.criteria);
  const periodFrom = cleanQcDate(options.periodFrom) || String(options.periodFrom || '').trim();
  const periodTo = cleanQcDate(options.periodTo) || String(options.periodTo || '').trim();
  const list = [];
  for (const [index, r] of (rows || []).entries()) {
    const nameKey = findKey(r, ['tele_expert_name', 'account_expert_name', 'account expert name', 'acc_expert_name', 'expert_name', 'expertname']);
    const rawName = nameKey ? normName(String(r[nameKey] == null ? '' : r[nameKey]).trim().replace(/^(["'])(.*)\1$/, '$2')) : '';
    const resolved = resolveExpert(options.agents || [], rawName);
    const expertName = resolved.agent ? resolved.agent.name : rawName;
    if (!expertName) continue;

    /* نمره المان‌های موقعیتی منحصراً از ستون calc_situational_score خوانده می‌شود. */
    const sitScoreKey = findKey(r, ['calc_situational_score']);
    const formsCountKey = findKey(r, ['forms_count', 'form_count']);
    const teamColumn = findKey(r, ['team', 'team_name', 'تیم']);
    const colTeam = teamColumn ? cleanText(r[teamColumn]) : '';
    const team = resolved.agent ? resolved.agent.team : (colTeam || options.team || defaultTeamForForm(type, options.agents));

    const situationalScore = C.normalizeScore(sitScoreKey ? r[sitScoreKey] : null);
    const formsCount = formsCountKey ? normalizeCount(r[formsCountKey]) : 0;

    const elements = {};
    for (const def of defs) {
      const avgCol = (def.avgKeys || []).map(c => Object.keys(r).find(k => columnKey(k) === columnKey(c))).find(Boolean);
      const cntCol = (def.countKeys || []).map(c => Object.keys(r).find(k => columnKey(k) === columnKey(c))).find(Boolean);
      const avgVal = avgCol != null ? normalizeRatio(r[avgCol]) : null;
      const nVal = cntCol != null ? normalizeCount(r[cntCol]) : 0;
      if (avgCol != null || cntCol != null) {
        elements[def.key] = { avg: avgVal, n: nVal };
      }
    }

    const parsed = {
      expertName,
      formType: type,
      periodFrom,
      periodTo,
      formsCount,
      situationalScore,
      elements,
      sourceFile: options.sourceFile ? String(options.sourceFile) : '',
      pairedFixedFile: options.pairedFixedFile ? String(options.pairedFixedFile) : '',
      sourceRow: index + 2
    };
    if (team) parsed.team = team;
    if (rawName !== expertName) parsed.sourceExpertName = rawName;
    parsed.syncId = 'sit:' + [type, nameKeyOf(expertName), periodFrom || 'all', periodTo || 'all'].join('|');
    list.push(parsed);
  }
  return list;
}

/* هویت ردیف از فایل، نه ترکیب کارشناس/تلفن/روز: دو تماس یک روز حذف نشوند.
 * رکورد قدیمی بدون شناسه را نمی‌توان با اطمینان تکراری اعلام کرد. */
function callRowKey(row) {
  if (!row.sourceFile) return null;
  const identity = row.sourceRow != null ? 'row:' + row.sourceRow : (row.evaluationId ? 'id:' + row.evaluationId : '');
  return identity ? JSON.stringify([row.sourceFile, row.formType, identity, cleanQcDate(row.reviewDate) || String(row.reviewDate || ''), nameKeyOf(row.expertName), String(row.leadPhone || ''), cleanQcDate(row.callDate) || String(row.callDate || '')]) : null;
}

/* ریتِ یک فرم: هویت ریتِ مستقل از فایل مبدأ — بر اساس **تاریخ بررسی** (مهمی‌ترین
 * بخش) + کارشناس + کارشناس کیوسی + فرم + هویت پیشنهادی (شماره شریک برای تماس،
 * کد تیکت برای تیکت). همین ریت اگر همزمان در فایل این هفته و هفته بعدی باشد
 * یک‌بار محاسبه می‌شود. */
function ritKey(row, kind) {
  kind = kind || 'call';
  const date = cleanQcDate(row.reviewDate) || String(row.reviewDate || '');
  if (!date) return null;
  const agent = kind === 'call' ? nameKeyOf(row.expertName) : nameKeyOf(row.agentName || row.expertName);
  const qc = normName(row.qcAgent || '');
  const form = kind === 'call' ? (row.formType || '') : (kind === 'ticket' ? 'ticket' : (kind === 'social' ? 'social' : ''));
  let identity = '';
  if (kind === 'call') identity = String(row.leadPhone || '');
  else if (kind === 'ticket') identity = String(row.ticketCode || '');
  else identity = String(row.messenger || '') + '|' + String(row.ticketCode || row.messageId || '');
  /* محتوای کامل ریت (به‌جز متاتای بامِ一行ی): ریت‌های مستقلِ هم‌تاریخ/هم‌هویت (محتوای
   * متفاوت) با هم تلفیق نمی‌شوند؛ ریت تکراریِ هفته‌ی Different (محتوای یک‌سان) یک‌بار نگه می‌شود. */
  return JSON.stringify([kind, form, date, agent, qc, identity, ritContent(row)]);
}

/* فیلتها‌ی متاتای که در هویتِ ریت محاسبه نمی‌شوند (فایل مبدأ/ردیف/شناسه بامی). */
const RIT_META_IGNORE = new Set(['sourceFile', 'sourceRow', 'id', 'evaluationId', 'datasetId',
  'importedAt', 'createdAt', 'updatedAt', 'team', 'sourceAgentName', 'sourceExpertName']);
function ritContent(row) {
  if (!row || typeof row !== 'object') return '';
  const parts = [];
  Object.keys(row).sort().forEach((k) => {
    if (RIT_META_IGNORE.has(k)) return;
    let v = row[k];
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v = v.map(String).join(',');
      else v = '{' + Object.keys(v).sort().map((x) => x + '=' + String(v[x])).join(';') + '}';
    }
    parts.push(k + '=' + String(v == null ? '' : v));
  });
  return parts.join('|');
}

/* ---------- تشخیص نوع فایل اکسل از روی نام ---------- */
function formTypeOfFileName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('mlm') || n.includes('bnpl')) return 'mlm';
  if (n.includes('account') || n.includes('acc') || n.includes('اکانت')) return 'account';
  if (n.includes('tele') || n.includes('telesales') || n.includes('تلفن')) return 'tele';
  return null;
}

/* ---------- تشخیص نوع فرم از روی محتوای ستون‌ها (وقتی نام فایل گویا نیست) ---------- */
/* rows: خروجی sheet_to_json. با شمردن تطابق ستون‌های معیار هر تیم، بهترین نوع برگردانده می‌شود.
 * حداقل ۲ تطابق لازم است تا نتیجه معتبر باشد. */
function sniffFormType(rows, config) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = new Set();
  for (const r of rows.slice(0, 12)) {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(String(k).trim().toLowerCase()));
  }
  /* ستون‌های اختصاصی فرم‌های جدید (ثابت و موقعیتی) */
  if (keys.has('account_expert_name') || keys.has('account expert name')) return 'account';
  if (keys.has('avg_commission_presentation') || keys.has('avg_panel_introduction') ||
      keys.has('avg_parallel_campaign_presentation') || keys.has('avg_new_panel_opportunity_identification')) return 'tele';
  if (keys.has('avg_campaign_announcement')) return 'account';
  if (keys.has('calc_situational_score') && keys.has('tele_expert_name')) return 'tele';
  if (keys.has('tele_expert_name')) {
    const teleNewCols = ['proper_introduction', 'needs_assessment', 'cta_and_follow_up', 'complete_note_recording'];
    if (teleNewCols.filter(k => keys.has(k)).length >= 3) return 'tele';
  }
  function columns(type) {
    let definitions = defaults(type);
    if (config && config.forms && config.forms[type]) definitions = definitions.concat(config.forms[type]);
    Object.values(config && config.teams || {}).filter(e => e.form === type).forEach(e => { definitions = definitions.concat(e.elements); });
    return [...new Set(definitions.flatMap(d => [d.excelKey].concat(d.aliases || [])).map(k => columnKey(k)))];
  }
  const cnt = list => list.filter(k => keys.has(columnKey(k))).length;
  const scores = [
    ['tele', cnt(columns('tele'))],
    ['account', cnt(columns('account'))],
    ['mlm', cnt(columns('mlm'))]
  ].sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : null;
}

/* ---------- نرمال‌سازی نام برای تطبیق کارشناس (فاصله‌ها یکدست) ---------- */
function normName(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\s‌‍]+/g, ' ').trim(); }

/* تعریف المان‌ها با شناسه‌ی پایدار: تغییر نام/ستون هیچ نمره‌ی تاریخی را بازنویسی نمی‌کند. */
let browserConfig = null;
function nameKeyOf(s) { return normName(s).toLowerCase().replace(/\s/g, ''); }
function teamKey(s) { return normName(s).toLowerCase().replace(/[\s_/-]/g, ''); }
function columnKey(s) { return normName(s).toLowerCase(); }
function teamForm(s) {
  const t = teamKey(s);
  if (/^tele(?:sales)?$|تلهسلز|تلفن|تلفنی/.test(t)) return 'tele';
  if (/^(?:account|acc|اکانت)$/.test(t)) return 'account';
  if (/^(?:mlm|امالام|bnpl|mlmbnpl)$/.test(t)) return 'mlm';
  return null;
}
function displayTeam(s) { return teamForm(s) === 'tele' ? 'Telesales' : String(s || ''); }
/* تیم پیش‌فرض قطعی از نوع فرم برای کارشناسان ثبت‌نشده:
 * فرم Telesales منحصراً به تیم Tele sales و فرم Account منحصراً به تیم Account تعلق دارد؛
 * اما فرم MLM بین MLM و BNPL مشترک است پس بدون انتخاب «تیم مقصد» انتساب حدسی انجام نمی‌شود. */
function defaultTeamForForm(formType, agents) {
  if (formType !== 'tele' && formType !== 'account') return '';
  const hit = (agents || []).find(a => a && a.team && teamForm(a.team) === formType);
  if (hit && hit.team) return hit.team;
  return formType === 'tele' ? 'Tele sales' : 'Account';
}
/* تطبیق نام کارشناس با کش: گزارش‌ها برای هر ردیف نام را resolve می‌کنند و
 * بدون کش، فیلتر یک کارشناس روی چند هزار ردیف × ده‌ها نام، چند ثانیه طول می‌کشید.
 * کش به «همان آرایه‌ی agents» گره خورده و با تغییر تعداد عضو یا صریحاً با
 * clearResolveCache() پاک می‌شود. */
let resolveCacheAgents = null, resolveCacheSize = -1, resolveCache = new Map();
function clearResolveCache() { resolveCacheAgents = null; resolveCacheSize = -1; resolveCache = new Map(); }
function resolveExpert(agents, rawName) {
  const name = normName(rawName);
  if (!name) return { agent: null, ambiguous: false };
  const list = agents || [];
  if (resolveCacheAgents !== list || resolveCacheSize !== list.length) {
    resolveCacheAgents = list; resolveCacheSize = list.length; resolveCache = new Map();
  }
  const key = nameKeyOf(name);
  const hit = resolveCache.get(key);
  if (hit) return hit;
  const exact = list.filter(a => a.name === String(rawName).trim());
  let result;
  if (exact.length === 1) {
    result = { agent: exact[0], ambiguous: false };
  } else {
    const matches = list.filter(a => [a.name].concat(a.aliases || []).some(n => nameKeyOf(n) === key));
    result = { agent: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  }
  resolveCache.set(key, result);
  return result;
}
const DEFAULT_COLUMN_ALIASES = {
  appropriate_tone_and_language: ['appropriate_tone_and_language:'],
  complete_note_recording: ['note']
};
function defaults(type) {
  const keys = type === 'tele' ? TELE_CRITERIA : type === 'mlm' ? MLM_CRITERIA : ACCOUNT_CRITERIA;
  return keys.map(key => {
    const def = { key, label: (CRITERIA_LABELS[type] || {})[key] || key, excelKey: key, active: true, category: 'fixed' };
    if (type !== 'mlm' && DEFAULT_COLUMN_ALIASES[key]) def.aliases = DEFAULT_COLUMN_ALIASES[key].slice();
    return def;
  });
}
function situationalDefaults(type) {
  const list = SITUATIONAL_CRITERIA[type] || [];
  return list.map(d => ({
    key: d.key,
    label: d.label,
    avgCol: d.avgKeys[0] || ('avg_' + d.key),
    nCol: d.countKeys[0] || ('n_' + d.key),
    avgKeys: d.avgKeys.slice(),
    countKeys: d.countKeys.slice(),
    excelKey: d.avgKeys[0] || d.key,
    active: true,
    category: 'situational'
  }));
}
function situationalDefinitionsFor(type) {
  return situationalDefaults(type);
}
function situationalLabelOf(type, key) {
  const def = situationalDefaults(type).find(d => d.key === key);
  return def ? def.label : key;
}
function hasConfiguration(type, team, cfg) {
  cfg = cfg === undefined ? browserConfig : cfg;
  const entry = cfg && cfg.teams && cfg.teams[teamKey(team)];
  return !!(entry && entry.form === type || cfg && cfg.forms && Array.isArray(cfg.forms[type]));
}
function definitionsFor(type, team, cfg) {
  cfg = cfg === undefined ? browserConfig : cfg;
  const entry = cfg && cfg.teams && cfg.teams[teamKey(team)];
  if (entry && entry.form === type && Array.isArray(entry.elements)) return entry.elements;
  if (cfg && cfg.forms && Array.isArray(cfg.forms[type])) return cfg.forms[type];
  return defaults(type);
}
function criteriaFor(type, team, cfg) { return definitionsFor(type, team, cfg).filter(d => d.active !== false).map(d => d.key); }
function criteriaLabelsFor(type, team, cfg) { return Object.fromEntries(definitionsFor(type, team, cfg).map(d => [d.key, d.label])); }
function labelOf(type, key, team, cfg) {
  const def = definitionsFor(type, team, cfg).find(d => d.key === key);
  if (def) return def.label;
  return (CRITERIA_LABELS[type] || {})[key] || (LEGACY_LABELS[type] || {})[key] || situationalLabelOf(type, key) || key;
}
function validateConfig(cfg) {
  function invalid(m) { const e = new Error(m); e.status = 400; throw e; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) invalid('تنظیمات المان‌ها نامعتبر است');
  function check(defs) {
    if (!Array.isArray(defs) || defs.length > 100) invalid('هر تیم حداکثر ۱۰۰ المان دارد');
    const ids = new Set(), columns = new Set();
    defs.forEach(d => {
      if (!d || !/^[A-Za-z0-9_-]{1,96}$/.test(d.key || '') || ['__proto__','constructor','prototype'].includes(d.key)) invalid('شناسه‌ی المان نامعتبر است');
      if (ids.has(d.key)) invalid('شناسه‌ی المان تکراری است'); ids.add(d.key);
      if (!String(d.label || '').trim() || !String(d.excelKey || '').trim() || String(d.label).length > 180 || String(d.excelKey).length > 180) invalid('نام المان و ستون اکسل را کامل وارد کنید');
      if (d.active !== false) {
        const field = columnKey(d.excelKey);
        if (columns.has(field)) invalid('نام ستون اکسل تکراری است'); columns.add(field);
      }
      if (d.aliases && (!Array.isArray(d.aliases) || d.aliases.some(a => typeof a !== 'string'))) invalid('نام قبلی ستون نامعتبر است');
    });

  }
  Object.keys(cfg.forms || {}).forEach(form => { if (!['tele','account','mlm'].includes(form)) invalid('نوع فرم نامعتبر است'); check(cfg.forms[form]); });
  if (Object.keys(cfg.teams || {}).length > 200) invalid('تعداد تیم‌ها بیش از حد است');
  Object.keys(cfg.teams || {}).forEach(key => {
    if (['__proto__','constructor','prototype'].includes(key)) invalid('کلید تیم نامعتبر است');
    const entry = cfg.teams[key];
    if (!entry || !['tele','account','mlm'].includes(entry.form)) invalid('نوع فرم تیم را مشخص کنید'); check(entry.elements);
  });
  return cfg;
}
function saveTeamConfig(current, body) {
  const cfg = JSON.parse(JSON.stringify(current || { version: 0, forms: {}, teams: {} }));
  if (body.version !== undefined && Number(body.version) !== Number(cfg.version || 0)) { const e = new Error('تنظیمات هم‌زمان تغییر کرده است؛ تازه‌سازی کنید'); e.status = 409; throw e; }
  const isForm = !body.team;
  const old = definitionsFor(body.form, body.team, cfg);
  if(!Array.isArray(body.elements)){const e=new Error('لیست المان‌ها نامعتبر است');e.status=400;throw e;}
  const incoming = body.elements.map(d => {
    const previous = old.find(x => x.key === d.key);
    const aliases = new Set((previous && previous.aliases || []).concat(d.aliases || []));
    if (previous && previous.excelKey !== d.excelKey) aliases.add(previous.excelKey);
    aliases.delete(d.excelKey);
    return { key: String(d.key || ''), label: String(d.label || '').trim(), excelKey: String(d.excelKey || '').trim(), active: d.active !== false, aliases: Array.from(aliases) };
  });
  const nextIds = new Set(incoming.map(d => d.key));
  old.filter(d => !nextIds.has(d.key)).forEach(d => incoming.push(Object.assign({}, d, { active: false })));
  cfg.forms = cfg.forms || {}; cfg.teams = cfg.teams || {};
  if (isForm) cfg.forms[body.form] = incoming;
  else cfg.teams[teamKey(body.team)] = { team: String(body.team).trim(), form: body.form, elements: incoming };
  validateConfig(cfg); cfg.version = Number(cfg.version || 0) + 1;
  return cfg;
}
function resolver(config) {
  return { config: config || null,
    criteriaFor: (type, team) => criteriaFor(type, team, config || null),
    definitionsFor: (type, team) => definitionsFor(type, team, config || null),
    situationalDefinitionsFor: (type, team) => situationalDefinitionsFor(type, team, config || null),
    situationalLabelOf: (type, key) => situationalLabelOf(type, key),
    configured: (type, team) => hasConfiguration(type, team, config || null),
    elementValue: (row,key) => elementValue(row,key,config || null),
    labelOf: (type, key, team) => labelOf(type, key, team, config || null) };
}
function elementValue(row, key, cfg) {
  const elements = row.elements || {};
  if (Object.prototype.hasOwnProperty.call(elements, key)) return C.normalizeTri(elements[key]);
  const def = definitionsFor(row.formType, row.criteriaTeam || row.team, cfg).find(d => d.key === key);
  if (!def) return '';
  for (const column of [def.excelKey].concat(def.aliases || [])) {
    const found = Object.keys(elements).find(k => columnKey(k) === columnKey(column));
    if (found != null) return C.normalizeTri(elements[found]);
  }
  return '';
}
function importDiagnostics(rows, agents) {
  const missing = new Map(), conflicts = new Map(); let ambiguous = 0;
  (rows || []).forEach(row => {
    const found = resolveExpert(agents, row.expertName);
    if (found.ambiguous) ambiguous++;
    if (!found.agent) {
      const entry = missing.get(row.expertName) || { name: row.expertName, count: 0, forms: [] };
      entry.count++; if (!entry.forms.includes(row.formType)) entry.forms.push(row.formType); missing.set(row.expertName, entry);
    } else if (teamForm(found.agent.team) && teamForm(found.agent.team) !== row.formType) {
      const key = found.agent.name + ':' + row.formType;
      const entry = conflicts.get(key) || { name: found.agent.name, team: found.agent.team, form: row.formType, count: 0 };
      entry.count++; conflicts.set(key, entry);
    }
  });
  return { unknownExperts: Array.from(missing.values()), teamConflicts: Array.from(conflicts.values()), ambiguous };
}

return {
  clearResolveCache: clearResolveCache,
  PARSER_VERSION: 4, anyToJalali, cleanQcDate, parseRows, parseSituationalRows,
  findRedlineReason, findQcComment,
  isSituationalFile, isPivotFile, parsePivotRows, classifyCallFile, situationalRowKey, dateRangeOfCalls,
  classifyMonthlyScoreFile, parseMonthlyScoreRows, monthlyScoreRowKey,
  formTypeOfFileName, sniffFormType, normName, isRedline, callRowKey, ritKey, normalizeCount,
  criteriaFor, criteriaLabelsFor, labelOf, definitionsFor, defaults,
  situationalDefaults, situationalDefinitionsFor, situationalLabelOf,
  resolver, validateConfig, saveTeamConfig, hasConfiguration,
  elementValue, teamKey, teamForm, displayTeam, defaultTeamForForm, nameKey: nameKeyOf, resolveExpert, importDiagnostics,
  setConfig: cfg => { browserConfig = cfg || null; },
  TELE_CRITERIA, ACCOUNT_CRITERIA, MLM_CRITERIA, SITUATIONAL_CRITERIA, CRITERIA_LABELS
};
});
