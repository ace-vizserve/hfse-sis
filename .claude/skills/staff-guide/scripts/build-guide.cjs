// Builds a staff guide PDF: front page, contents page, then one page per step.
//
//   node .claude/skills/staff-guide/scripts/build-guide.cjs <guide.json> <shots-dir> <out.pdf> [preview-dir]
//
// Run from the repo root, because Playwright is loaded from its node_modules.
// preview-dir, when given, gets one PNG per page so the result can be looked at.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.cwd(), 'node_modules', 'playwright'));

const [guidePath, shotsDir, outFile, previewDir] = process.argv.slice(2);
if (!guidePath || !shotsDir || !outFile) {
  console.error('Usage: build-guide.cjs <guide.json> <shots-dir> <out.pdf> [preview-dir]');
  process.exit(1);
}

const guide = JSON.parse(fs.readFileSync(guidePath, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

const steps = guide.groups.flatMap((g) => g.steps);
const missing = steps.map((s) => s.shot).filter((f) => !fs.existsSync(path.join(shotsDir, f)));
if (missing.length) {
  console.error(`Missing screenshots in ${shotsDir}: ${missing.join(', ')}`);
  process.exit(1);
}

const date =
  guide.date || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
const logo = dataUri(path.join(__dirname, '..', 'assets', 'hfse-logo.png'));

// .step, .eyebrow, h2 and p are the sizes the guides have always used. The step
// pages were approved as they are, so change these only if he asks.
const css = `
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; }
.page { page-break-after: always; height: 268mm; display: flex; flex-direction: column; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.eyebrow { font: 600 10px/1 Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; color: #64748b; }
h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; margin: 6px 0 4px; }
p { margin: 0; font-size: 13px; line-height: 1.5; color: #334155; }
.step { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.step img { display: block; max-width: 100%; max-height: 228mm; margin: 10px auto 0; border: 1px solid #e2e8f0; border-radius: 6px; }

.front, .contents { padding: 7mm; }
.front .logo { display: block; height: 76px; width: auto; align-self: flex-start; }
.front .title { margin-top: 85mm; }
.front h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 60px; line-height: 1.05; letter-spacing: -0.01em; }
.front .rule { width: 56px; height: 3px; margin: 26px 0; background: #213098; }
.front .summary { max-width: 470px; font-size: 16px; line-height: 1.6; }
.front .foot { margin-top: auto; display: flex; justify-content: space-between; }

.contents h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 34px; line-height: 1.1; }
.group { margin-top: 26px; }
.row { display: flex; gap: 14px; padding: 5px 0; font-size: 14px; line-height: 1.4; }
.row .n { flex: none; width: 20px; color: #64748b; }
.row .t { flex: 1; }
.row .pg { color: #64748b; }
.group .eyebrow, .notes .eyebrow { margin-bottom: 8px; }
.notes { margin-top: 34px; padding-top: 26px; border-top: 1px solid #e2e8f0; }
.note { display: grid; grid-template-columns: 190px 1fr; gap: 20px; margin-top: 12px; font-size: 13px; line-height: 1.5; color: #334155; }
.note strong { font-weight: 600; color: #0f172a; }
`;

const front = `
<section class="page front">
  <img class="logo" src="${logo}" alt="HFSE International School">
  <div class="title">
    <h1>${esc(guide.title)}</h1>
    <div class="rule"></div>
    <p class="summary">${esc(guide.summary)}</p>
  </div>
  <div class="foot">
    <div class="eyebrow">SIS staff guide</div>
    <div class="eyebrow">${esc(date)}</div>
  </div>
</section>`;

// The contents page is page 2, so step n is on page n + 2.
let n = 0;
const groups = guide.groups
  .map((g) => {
    const rows = g.steps
      .map((s) => {
        n += 1;
        return `<div class="row"><span class="n">${n}</span><span class="t">${esc(s.title)}</span><span class="pg">${n + 2}</span></div>`;
      })
      .join('');
    return `<div class="group"><div class="eyebrow">${esc(g.name)}</div>${rows}</div>`;
  })
  .join('');
const notes = (guide.notes || [])
  .map((x) => `<div class="note"><strong>${esc(x.label)}</strong><span>${esc(x.text)}</span></div>`)
  .join('');

const contents = `
<section class="page contents">
  <h1>Contents</h1>
  ${groups}
  ${notes ? `<div class="notes"><div class="eyebrow">Good to know</div>${notes}</div>` : ''}
</section>`;

const stepPages = steps
  .map(
    (s, i) => `
<section class="page">
  <div class="step">
    <div class="eyebrow">Step ${i + 1} of ${steps.length}</div>
    <h2>${esc(s.title)}</h2>
    <p>${esc(s.body)}</p>
    <img src="${dataUri(path.join(shotsDir, s.shot))}">
  </div>
</section>`
  )
  .join('');

(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(guide.title)}</title><style>${css}</style></head><body>${front}${contents}${stepPages}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 703, height: 1013 } });
  await page.setContent(html, { waitUntil: 'load' });

  // Anything taller than its page would be cut off without an error.
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('.page')]
      .map((el, i) => (el.scrollHeight > el.clientHeight + 1 ? i + 1 : null))
      .filter(Boolean)
  );
  if (cut.length) console.error(`WARNING: content is cut off on page(s) ${cut.join(', ')}`);

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  await page.pdf({
    path: outFile,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
  });

  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    const sections = await page.$$('.page');
    for (let i = 0; i < sections.length; i += 1) {
      await sections[i].screenshot({ path: path.join(previewDir, `page-${String(i + 1).padStart(2, '0')}.png`) });
    }
  }
  await browser.close();
  console.log(`Wrote ${outFile}: ${steps.length + 2} pages expected, ${fs.statSync(outFile).size} bytes`);
  if (cut.length) process.exit(2);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
