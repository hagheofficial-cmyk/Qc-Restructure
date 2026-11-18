'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers');

test('PDF renders full profile as a single continuous unpaginated page in bounded strips and cleans up on error', async (t) => {
  const { w, dom } = browser(); t.after(() => dom.window.close());
  const source = w.document.createElement('div');
  source.innerHTML = '<table><tbody><tr><td>row</td></tr></tbody></table>';
  w.document.body.appendChild(source);
  source.getBoundingClientRect = () => ({ width: 1200, height: 300 });
  let mockHeight = 9600;
  const proto = w.HTMLElement.prototype;
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return this.className === 'capture-host' ? 1500 : 0; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return this.className === 'capture-host' ? (parseFloat(this.style.width) || 0) : 0; } });
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return this.className === 'capture-host' ? mockHeight : 0; } });

  const tiles = [], images = [], saved = [], pdfOptions = [], addedPages = [];
  w.html2canvas = async (host, opts) => {
    assert.equal(host.style.padding, '0px'); assert.equal(host.firstChild.style.width, '100%');
    tiles.push(opts); return { width: 100, height: 100, toDataURL: () => 'data:image/jpeg;base64,abc' };
  };
  w.jspdf = { jsPDF: class {
    constructor(opts) {
      pdfOptions.push(opts);
      const [fw, fh] = Array.isArray(opts.format) ? opts.format : [842, 595];
      this.internal = { pageSize: { getWidth: () => fw, getHeight: () => fh } };
    }
    setFillColor() {}
    rect() {}
    addPage(...args) { addedPages.push(args); }
    addImage(...args) { images.push(args); }
    save(name) { saved.push(name); }
  } };

  // 1) Normal/long profile (9,600 px tall): single continuous unpaginated PDF page (0 addPage calls)
  const single = await w.QCCapture.downloadPdf(source, 'profile');
  assert.equal(single.width, 1500);
  assert.equal(single.height, 9600);
  assert.equal(single.pages, 1, 'full profile must fit on a single continuous page with no pagination');
  assert.equal(addedPages.length, 0, 'no page breaks for continuous single-page PDF');
  assert.equal(pdfOptions[0].format[0], 842);
  assert.equal(pdfOptions[0].format[1], Math.ceil(9600 * (806 / 1500) + 36));
  assert.equal(pdfOptions[0].orientation, 'portrait', 'tall continuous page must pass portrait orientation so jsPDF preserves [w, h]');
  assert.equal(tiles.length, 2, '9,600 px height is captured in two bounded <=6000 px strips');
  assert.equal(tiles[0].y, 0); assert.equal(tiles[0].height, 6000);
  assert.equal(tiles[1].y, 6000); assert.equal(tiles[1].height, 3600);
  assert.equal(images.length, 2, 'both strips are stitched seamlessly onto the single continuous page');
  assert.ok(Math.abs(images[1][3] - (18 + 6000 * 806 / 1500)) < 0.01, 'second strip aligns flush below first strip');
  assert.deepEqual(saved, ['profile.pdf']);
  assert.equal(w.document.querySelector('.capture-host'), null);

  // 2) Extreme 52,000 px document exceeding PDF 1.7 14,000pt cap: splits cleanly at block boundary, bounded tiles
  tiles.length = 0; images.length = 0; addedPages.length = 0; pdfOptions.length = 0;
  mockHeight = 52000;
  const maxSlicePx = Math.floor((14000 - 36) / (806 / 1500));
  w.HTMLTableRowElement.prototype.getBoundingClientRect = () => ({ top: maxSlicePx - 120, bottom: maxSlicePx + 80 });
  const huge = await w.QCCapture.downloadPdf(source, 'huge');
  assert.equal(huge.height, 52000);
  assert.equal(huge.pages, 3, '52,000 px splits only at PDF 14,000pt ceiling, not dozens of A4 pages');
  assert.equal(addedPages.length, 2);
  assert.ok(pdfOptions[0].format[1] <= 14000, 'each page respects PDF 1.7 14,000pt maximum');
  let covered = 0;
  for (const tile of tiles) {
    assert.equal(tile.width, 1500);
    assert.equal(tile.y, covered);
    assert.ok(tile.height * tile.scale <= 6000);
    covered += tile.height;
  }
  assert.equal(covered, 52000);
  assert.equal(w.document.querySelector('.capture-host'), null);

  // 3) Error cleanup
  w.html2canvas = async () => { throw new Error('render failed'); };
  await assert.rejects(w.QCCapture.downloadPdf(source, 'profile'), /render failed/);
  assert.equal(w.document.querySelector('.capture-host'), null);
});
