/**
 * Markdown-ish to PDF via pdfkit (no browser).
 * Usage: node scripts/md-to-pdf-pdfkit.cjs <input.md> <output.pdf>
 */
const fs = require('fs');
const path = require('path');

const input = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || input.replace(/\.md$/i, '.pdf'));

let PDFDocument;
try {
  PDFDocument = require(path.join(__dirname, '../distribution-engine/node_modules/pdfkit'));
} catch {
  try {
    PDFDocument = require('pdfkit');
  } catch {
    console.error('Run: npm install pdfkit --prefix distribution-engine');
    process.exit(1);
  }
}

const md = fs.readFileSync(input, 'utf8');
const doc = new PDFDocument({ margin: 50, size: 'A4' });
const stream = fs.createWriteStream(output);
doc.pipe(stream);

const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

function stripMd(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\\/g, '');
}

function writeBlock(text, opts = {}) {
  const size = opts.size || 11;
  const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(size).fillColor('#111');
  doc.text(stripMd(text), { width: pageWidth, align: opts.align || 'left' });
  if (opts.gap !== false) doc.moveDown(opts.gap === undefined ? 0.4 : opts.gap);
}

const lines = md.split(/\r?\n/);
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith('|') && lines[i + 1] && /^\|[-| :]+\|$/.test(lines[i + 1])) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      if (!/^\|[-| :]+\|$/.test(lines[i])) {
        rows.push(
          lines[i]
            .split('|')
            .slice(1, -1)
            .map((c) => stripMd(c.trim()))
        );
      }
      i += 1;
    }
    rows.forEach((row, ri) => {
      writeBlock(row.join('  |  '), { size: ri === 0 ? 10 : 9, bold: ri === 0, gap: 0.2 });
    });
    doc.moveDown(0.3);
    continue;
  }
  if (/^---+$/.test(line.trim())) {
    doc.moveDown(0.3);
    const y = doc.y;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#ccc');
    doc.moveDown(0.5);
    i += 1;
    continue;
  }
  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    const sizes = { 1: 20, 2: 14, 3: 12, 4: 11 };
    writeBlock(h[2], { size: sizes[level] || 11, bold: true, gap: 0.5 });
    i += 1;
    continue;
  }
  if (line.startsWith('> ')) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#444');
    doc.text(stripMd(line.slice(2)), { width: pageWidth });
    doc.moveDown(0.4);
    i += 1;
    continue;
  }
  if (line.startsWith('- ')) {
    writeBlock('• ' + line.slice(2), { size: 10, gap: 0.15 });
    i += 1;
    continue;
  }
  if (!line.trim()) {
    doc.moveDown(0.3);
    i += 1;
    continue;
  }
  writeBlock(line, { size: 10, gap: 0.25 });
  i += 1;
}

doc.end();
stream.on('finish', () => console.log('Wrote', output));
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
