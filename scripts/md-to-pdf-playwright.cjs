/**
 * Convert a markdown file to PDF using Playwright (no md-to-pdf download).
 * Usage: node scripts/md-to-pdf-playwright.cjs <input.md> <output.pdf>
 */
const fs = require('fs');
const path = require('path');

const input = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || input.replace(/\.md$/i, '.pdf'));

if (!input || !fs.existsSync(input)) {
  console.error('Usage: node md-to-pdf-playwright.cjs <input.md> <output.pdf>');
  process.exit(1);
}

const md = fs.readFileSync(input, 'utf8');

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mdToHtml(text) {
  const lines = text.split(/\r?\n/);
  let html = '';
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (!inTable || !tableRows.length) return;
    html += '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin:12px 0;font-size:11px;">';
    tableRows.forEach((row, i) => {
      const tag = i === 1 && row.every((c) => /^-+$/.test(c.replace(/\|/g, '').trim()))
        ? null
        : i === 0
          ? 'th'
          : 'td';
      if (!tag) return;
      html += '<tr>';
      row.forEach((cell) => {
        const inner = cell.trim();
        html += `<${tag}>${inlineFormat(escapeHtml(inner))}</${tag}>`;
      });
      html += '</tr>';
    });
    html += '</table>';
    tableRows = [];
    inTable = false;
  }

  function inlineFormat(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  for (const line of lines) {
    if (line.startsWith('|')) {
      if (!inTable) inTable = true;
      const cells = line.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    }
    flushTable();

    if (/^---+$/.test(line.trim())) {
      html += '<hr/>';
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html += `<h${level}>${inlineFormat(escapeHtml(h[2]))}</h${level}>`;
      continue;
    }
    if (line.startsWith('> ')) {
      html += `<blockquote>${inlineFormat(escapeHtml(line.slice(2)))}</blockquote>`;
      continue;
    }
    if (line.startsWith('- [ ] ')) {
      html += `<p>☐ ${inlineFormat(escapeHtml(line.slice(6)))}</p>`;
      continue;
    }
    if (line.startsWith('- ')) {
      html += `<li>${inlineFormat(escapeHtml(line.slice(2)))}</li>`;
      continue;
    }
    if (!line.trim()) {
      html += '<br/>';
      continue;
    }
    html += `<p>${inlineFormat(escapeHtml(line))}</p>`;
  }
  flushTable();
  return html;
}

const body = mdToHtml(md);
const fullHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>Rapport pré-release Influence Platform</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12px; line-height: 1.45; color: #111; margin: 40px; }
    h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 24px; color: #222; }
    h3 { font-size: 13px; margin-top: 16px; }
    h4 { font-size: 12px; }
    blockquote { border-left: 4px solid #ccc; margin: 12px 0; padding: 8px 16px; background: #f6f6f6; }
    code { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    table th { background: #f0f0f0; text-align: left; }
    li { margin: 4px 0; }
    p { margin: 6px 0; }
    hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  </style>
</head>
<body>${body}</body>
</html>`;

const tmpHtml = path.join(path.dirname(output), '_rapport-pre-release-tmp.html');
fs.writeFileSync(tmpHtml, fullHtml, 'utf8');

(async () => {
  const deRoot = path.join(__dirname, '..', 'distribution-engine');
  let playwright;
  try {
    playwright = require(path.join(deRoot, 'node_modules', 'playwright'));
  } catch {
    playwright = require('playwright');
  }
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file:///${tmpHtml.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  await page.pdf({
    path: output,
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    printBackground: true,
  });
  await browser.close();
  try {
    fs.unlinkSync(tmpHtml);
  } catch {
    /* ignore */
  }
  console.log('Wrote', output);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
