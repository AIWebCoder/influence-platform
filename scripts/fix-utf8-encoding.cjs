const fs = require("fs");
const path = require("path");

function isUtf16Le(buf) {
  if (buf.length < 4) return false;
  // UTF-16 LE BOM (common on Windows saves)
  if (buf[0] === 0xff && buf[1] === 0xfe) return true;
  // UTF-16 LE without BOM: ASCII char + null byte pattern
  return buf[1] === 0 && buf[3] === 0;
}

function fixFile(p) {
  const b = fs.readFileSync(p);
  if (!isUtf16Le(b)) return false;
  const text = Buffer.from(b).toString("utf16le").replace(/^\uFEFF/, "");
  fs.writeFileSync(p, text, { encoding: "utf8" });
  return true;
}

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.name === "node_modules" || e.name === ".next") continue;
    if (e.isDirectory()) walk(p, o);
    else if (/\.(js|mjs|cjs|py|tsx?)$/.test(e.name)) o.push(p);
  }
  return o;
}

const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "distribution-engine/src",
      "dashboard/src",
      "content-factory/src",
      "content-factory/alembic/versions",
    ].map((r) => path.join(process.cwd(), r));

let n = 0;
for (const r of roots) {
  if (!fs.existsSync(r)) continue;
  for (const f of (fs.statSync(r).isDirectory() ? walk(r) : [r])) {
    if (fixFile(f)) {
      console.log("fixed", f);
      n++;
    }
  }
}
console.log("done", n);
