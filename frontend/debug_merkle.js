const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BLOCK_SIZE = 128 * 1024;

function md5(b) {
  return crypto.createHash('md5').update(b).digest('hex');
}

function walkDir(dir, fn) {
  try {
    const items = fs.readdirSync(dir);
    for (const i of items) {
      if (i.startsWith('.')) continue;
      const abs = path.join(dir, i);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walkDir(abs, fn);
      else if (stat.isFile()) fn(abs);
    }
  } catch (e) {
    console.error("walkDir error", e);
  }
}

function md5File(fp) {
  try {
    const hash = crypto.createHash('md5');
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(BLOCK_SIZE);
    while (true) {
      const br = fs.readSync(fd, buf, 0, BLOCK_SIZE, null);
      if (br === 0) break;
      hash.update(buf.slice(0, br));
    }
    fs.closeSync(fd);
    return hash.digest('hex');
  } catch (e) {
    console.error("md5File error on", fp, e);
    return '';
  }
}

function build(s) {
  const tree = {};
  if (!fs.existsSync(s)) {
    tree['__root__'] = md5(Buffer.from(''));
    return tree;
  }
  walkDir(s, (abs) => {
    const rel = path.relative(s, abs).replace(/\\/g, '/');
    if (rel.startsWith('.') || rel.endsWith('.tmp')) return;
    tree[rel] = md5File(abs);
  });
  const e = Object.entries(tree).sort((a, b) => a[0].localeCompare(b[0]));
  const c = e.map(([k, v]) => `${k}:${v}`).join('');
  tree['__root__'] = md5(Buffer.from(c));
  return tree;
}

console.log(build('d:/Projects/Intellifile/sync/intellifil_files'));
