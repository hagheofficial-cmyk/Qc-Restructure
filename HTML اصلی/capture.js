/* capture.js — خروجی تصویر و PDF از یک بخش از صفحه (پرونده‌ی کارشناس)
 *
 * نکته‌ی مهم: نسخه‌ای که عکس گرفته می‌شود با «همان عرض» عنصر اصلی ساخته
 * می‌شود. اگر عرض عوض شود، جدول‌ها دوباره می‌چینند و ستون‌ها جابه‌جا به نظر
 * می‌رسند (باگ گزارش‌شده). ارتفاع عکس‌جای‌گرفته هم دقیقاً به اندازه‌ی خود
 * canvas اصلی است، نه یک عدد ثابت.
 */
(function () {
'use strict';

const CSS_VARS = ['bg', 'bg-2', 'panel', 'panel-2', 'panel-soft', 'soft', 'line', 'line-soft', 'border',
  'ink', 'ink-2', 'muted', 'brand', 'brand-soft', 'violet', 'violet-soft', 'good', 'good-soft', 'bad',
  'bad-soft', 'warn', 'warn-soft'];

function themeBackground() {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
}

/* جای canvasها تصویر ثابت می‌گذاریم؛ ابعاد از خود canvas گرفته می‌شود تا
 * نسبت تصویر با چیزی که کاربر می‌بیند یکی بماند. */
function freezeCanvases(source, copy) {
  const originals = [...source.querySelectorAll('canvas')];
  const copies = [...copy.querySelectorAll('canvas')];
  originals.forEach((canvas, index) => {
    const target = copies[index];
    if (!target) return;
    let url = '';
    try { url = canvas.toDataURL('image/png'); } catch (e) { url = ''; }
    if (!url) return;
    const rect = canvas.getBoundingClientRect();
    const image = document.createElement('img');
    image.src = url;
    /* Reserve the chart's aspect ratio before its data URL has loaded. */
    if (rect.width && rect.height) { image.width = Math.round(rect.width); image.height = Math.round(rect.height); }
    image.style.cssText = 'display:block;max-width:100%;height:auto;' +
      (rect.width ? 'width:' + Math.round(rect.width) + 'px;' : 'width:100%;');
    target.replaceWith(image);
  });
}

/* عنصر کلون‌شده با عرض ثابت، تا چیدمان جدول‌ها دقیقاً مثل صفحه بماند. */
function buildHost(source, prepare) {
  const host = document.createElement('div');
  host.className = 'capture-host';
  host.dataset.theme = document.documentElement.dataset.theme || 'dark';
  const css = getComputedStyle(document.documentElement);
  CSS_VARS.forEach((key) => host.style.setProperty('--' + key, css.getPropertyValue('--' + key)));
  const copy = source.cloneNode(true);
  host.appendChild(copy);
  freezeCanvases(source, copy);
  if (prepare) prepare(copy);
  const rect = source.getBoundingClientRect();
  /* عرض عکس = عرض واقعی کارت‌ها (حداقل ۱۲۰۰ برای خوانایی جدول‌ها)؛ ثابت‌بودن
   * همین عرض است که از جابه‌جایی ستون‌ها در خروجی جلوگیری می‌کند. */
  const width = Math.min(1600, Math.max(1200, Math.round(rect.width || source.scrollWidth || 1200)));
  host.style.width = width + 'px';
  host.style.boxSizing = 'border-box';
  host.style.padding = '0';
  copy.style.width = '100%';
  document.body.appendChild(host);
  return { host, copy, width };
}

async function toCanvas(source, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای خروجی وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const { host } = buildHost(source, prepare);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const width = Math.ceil(Math.max(host.clientWidth, host.scrollWidth, parseFloat(host.style.width) || 0));
    host.style.width = width + 'px';
    const height = Math.max(host.scrollHeight, 200);
    const scale = Math.min(1.6, 30000 / height, 4000 / width, Math.sqrt(24000000 / (width * height)));
    if (scale < 0.45) UI.toast.info('این بازه سوابق زیادی دارد؛ تصویر کامل طولانی است. برای بررسی ریز مقادیر، خروجی اکسل هم قابل دانلود است.', 6000);
    return await html2canvas(host, {
      backgroundColor: themeBackground(), scale, useCORS: true, logging: false,
      width, height, windowWidth: window.innerWidth, windowHeight: window.innerHeight
    });
  } finally { host.remove(); }
}

function fileName(name, extension) {
  const safe = String(name || 'کارنامه').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return (safe || 'کارنامه') + (extension ? '.' + extension : '');
}

function downloadBlob(blob, fullName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fullName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function download(source, filename, prepare) {
  const canvas = await toCanvas(source, prepare);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('ساخت فایل عکس ممکن نشد')), 'image/png'));
  downloadBlob(blob, fileName(filename, 'png'));
  return { width: canvas.width, height: canvas.height };
}

/* Choose breaks before a row or compact block when possible, so that a
 * page boundary does not cut text in half. A block taller than one page is
 * split as a last resort rather than hiding any of its content. */
function pageBreaks(host) {
  const top = host.getBoundingClientRect().top;
  return [...host.querySelectorAll('tr, .card-head, .summary-block, .action-row, .chart-box, .profile-system-brand')]
    .map(node => { const r = node.getBoundingClientRect(); return { top: Math.floor(r.top - top), bottom: Math.ceil(r.bottom - top) }; })
    .filter(r => r.bottom > r.top).sort((a, b) => b.top - a.top);
}
function tileEnd(offset, proposed, pageSize, blocks) {
  let end = proposed;
  const min = offset + Math.max(1, Math.floor(pageSize * 0.2));
  blocks.forEach(block => {
    if (block.bottom - block.top <= pageSize && block.top >= min && block.top < end && block.bottom > end) end = block.top;
  });
  return end;
}

/* هسته‌ی مشترک ساخت یا الحاق صفحه به PDF یکپارچه و بدون صفحه‌بندی (تک‌صفحه پیوسته):
 * اگر existingPdf پاس داده شود، کارنامه جدید به‌عنوان صفحه‌ی مستقل بعدی به همان
 * PDF اضافه می‌شود (برای خروجی تجمیعی کل تیم)؛ وگرنه یک سند PDF جدید ساخته می‌شود. */
async function captureToPdf(existingPdf, source, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای خروجی وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const lib = window.jspdf && (window.jspdf.jsPDF || window.jspdf);
  if (!lib) throw new Error('کتابخانه‌ی PDF بارگذاری نشده است');
  const { host } = buildHost(source, prepare);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    /* Include any remaining overflow in the capture, rather than cutting it off. */
    const width = Math.ceil(Math.max(host.clientWidth, host.scrollWidth, parseFloat(host.style.width) || 0));
    host.style.width = width + 'px';
    const height = Math.ceil(Math.max(host.scrollHeight, host.getBoundingClientRect().height));
    if (!width || !height) throw new Error('ابعاد محتوای PDF قابل محاسبه نیست');

    const bg = themeBackground();
    const pageWidth = 842; /* عرض استاندارد A4 افقی برای خوانایی کامل جدول‌ها */
    const margin = 18;
    const imageWidth = pageWidth - margin * 2;
    const ptPerPx = imageWidth / width;
    const MAX_PDF_PAGE_PT = 14000; /* سقف استاندارد PDF 1.7 (حداکثر ۱۴۴۰۰ پوینت) */
    const maxSlicePx = Math.max(1, Math.floor((MAX_PDF_PAGE_PT - margin * 2) / ptPerPx));

    const pages = [];
    if (height <= maxSlicePx) {
      pages.push({ y: 0, height });
    } else {
      const blocks = pageBreaks(host);
      let offset = 0;
      while (offset < height) {
        const proposed = Math.min(offset + maxSlicePx, height);
        const end = proposed < height ? tileEnd(offset, proposed, maxSlicePx, blocks) : proposed;
        pages.push({ y: offset, height: Math.max(1, end - offset) });
        offset = end;
      }
    }

    const orientFor = (w, h) => (w >= h ? 'landscape' : 'portrait');
    const pageHeightOf = (slicePx) => Math.max(100, Math.ceil(slicePx * ptPerPx + margin * 2));
    const paintBg = (doc, w, h) => {
      if (typeof doc.setFillColor === 'function' && typeof doc.rect === 'function') {
        try { doc.setFillColor(bg); doc.rect(0, 0, w, h, 'F'); } catch (e) {}
      }
    };

    const firstH = pageHeightOf(pages[0].height);
    let pdf = existingPdf;
    if (!pdf) {
      pdf = new lib({ unit: 'pt', format: [pageWidth, firstH], orientation: orientFor(pageWidth, firstH), compress: true });
      paintBg(pdf, pageWidth, firstH);
    } else {
      pdf.addPage([pageWidth, firstH], orientFor(pageWidth, firstH));
      paintBg(pdf, pageWidth, firstH);
    }

    /* نوارهای رندر محدود تا سقف canvas مرورگر هیچ‌گاه سرریز نشود. */
    const stripLimit = 6000;
    for (let pIndex = 0; pIndex < pages.length; pIndex++) {
      const page = pages[pIndex];
      const curPageH = pageHeightOf(page.height);
      if (pIndex > 0) {
        pdf.addPage([pageWidth, curPageH], orientFor(pageWidth, curPageH));
        paintBg(pdf, pageWidth, curPageH);
      }
      let stripOffset = 0;
      while (stripOffset < page.height) {
        const stripH = Math.min(stripLimit, page.height - stripOffset);
        const y = page.y + stripOffset;
        const scale = Math.min(1.5, 3200 / width, 6000 / stripH, Math.sqrt(14000000 / (width * stripH)));
        const canvas = await window.html2canvas(host, {
          backgroundColor: bg, scale, useCORS: true, logging: false,
          width, height: stripH, x: 0, y,
          windowWidth: window.innerWidth, windowHeight: window.innerHeight, scrollX: 0, scrollY: 0,
          onclone: (doc, clonedHost) => {
            if (clonedHost && clonedHost.parentNode === doc.body) {
              [...doc.body.children].forEach(node => { if (node !== clonedHost && node.tagName !== 'STYLE') node.remove(); });
            }
          }
        });
        if (!canvas.width || !canvas.height) throw new Error('تصویر فایل PDF ساخته نشد');
        const pdfY = margin + stripOffset * ptPerPx;
        const pdfH = stripH * ptPerPx;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, pdfY, imageWidth, pdfH);
        canvas.width = canvas.height = 0;
        stripOffset += stripH;
      }
    }
    return { pdf, pages: pages.length, width, height };
  } finally { host.remove(); }
}

async function downloadPdf(source, filename, prepare) {
  const out = await captureToPdf(null, source, prepare);
  out.pdf.save(fileName(filename, 'pdf'));
  return { pages: out.pages, width: out.width, height: out.height };
}

async function toPdfBytes(source, prepare) {
  const out = await captureToPdf(null, source, prepare);
  const raw = out.pdf.output('arraybuffer');
  return { bytes: new Uint8Array(raw), pages: out.pages, width: out.width, height: out.height };
}

async function appendPdf(existingPdf, source, prepare) {
  return await captureToPdf(existingPdf, source, prepare);
}

function savePdfDoc(pdf, filename) {
  pdf.save(fileName(filename, 'pdf'));
}

/* ---------------------------------------------------------------------------
 * سازنده‌ی سبک و استاندارد فایل ZIP (بدون وابستگی خارجی، با پشتیبانی UTF-8
 * برای نام فارسی کارشناسان و CRC-32 استاندارد). چون PDFهای ساخته‌شده با jsPDF
 * از قبل فشرده هستند، روش STORE (بدون فشرده‌سازی مجدد) سریع و بدون افت کیفیت است.
 * ------------------------------------------------------------------------- */
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const bin = unescape(encodeURIComponent(str));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const yr = Math.max(1980, d.getFullYear()) - 1980;
  const dosDate = ((yr & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  return { dosDate, dosTime };
}

function buildZip(entries) {
  const now = dosDateTime(new Date());
  const used = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    let cleanName = String(entry.name || ('report-' + (i + 1) + '.pdf')).replace(/[\\:*?"<>|]/g, '-');
    if (used.has(cleanName.toLowerCase())) {
      const dot = cleanName.lastIndexOf('.');
      const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
      const ext = dot > 0 ? cleanName.slice(dot) : '';
      let n = 2;
      while (used.has((stem + ' (' + n + ')' + ext).toLowerCase())) n++;
      cleanName = stem + ' (' + n + ')' + ext;
    }
    used.add(cleanName.toLowerCase());

    const nameBytes = encodeUtf8(cleanName);
    const crc = crc32(data);
    const size = data.length;

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); /* UTF-8 filename flag */
    lv.setUint16(8, 0, true);      /* STORE */
    lv.setUint16(10, now.dosTime, true);
    lv.setUint16(12, now.dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    localParts.push(lfh, data);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true); /* Unix + v2.0 for cross-OS UTF-8 support */
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); /* UTF-8 filename flag */
    cv.setUint16(10, 0, true);     /* STORE */
    cv.setUint16(12, now.dosTime, true);
    cv.setUint16(14, now.dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0x81a40000, true); /* -rw-r--r-- */
    cv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);
    centralParts.push(cdh);

    offset += lfh.length + size;
  }

  let cdSize = 0;
  centralParts.forEach((p) => { cdSize += p.length; });
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

window.QCCapture = { download, downloadPdf, toPdfBytes, appendPdf, savePdfDoc, buildZip, downloadBlob, fileName, toCanvas };
})();
