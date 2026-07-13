import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || process.cwd());
const outputPath = resolve(process.argv[3] || join(root, 'site-audit.json'));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', '.wrangler', 'artifacts', 'dist'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function routeToFile(route) {
  const pathname = decodeURIComponent(route.split(/[?#]/)[0]);
  if (pathname === '/') return [join(root, 'index.html')];
  const clean = pathname.replace(/^\//, '').replace(/\/$/, '');
  if (extname(clean)) return [join(root, clean)];
  return [join(root, `${clean}.html`), join(root, clean, 'index.html')];
}

const files = await walk(root);
const htmlFiles = files.filter((file) => extname(file) === '.html');
const issues = {
  brokenLinks: [],
  brokenAssets: [],
  invalidJsonLd: [],
  duplicateIds: [],
  missingMain: [],
  headingIssues: [],
  metadataIssues: [],
};

for (const file of htmlFiles) {
  const source = await readFile(file, 'utf8');
  const label = relative(root, file);
  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) issues.duplicateIds.push({ file: label, ids: duplicates });

  const h1Count = (source.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) issues.headingIssues.push({ file: label, h1Count });
  if (!/<main\b/i.test(source)) issues.missingMain.push(label);
  if (label !== '404.html' && (!/<title>[^<]+<\/title>/i.test(source) || !/rel="canonical"/i.test(source))) {
    issues.metadataIssues.push(label);
  }

  for (const match of source.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]); }
    catch (error) { issues.invalidJsonLd.push({ file: label, error: error.message }); }
  }

  for (const match of source.matchAll(/\shref="([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) continue;
    const targets = routeToFile(href);
    const targetChecks = await Promise.all(targets.map(exists));
    if (!targetChecks.some(Boolean)) issues.brokenLinks.push({ file: label, href });
  }

  const assetRefs = [];
  for (const match of source.matchAll(/\s(?:src|poster)="(\/[^"?#]+)"/g)) assetRefs.push(match[1]);
  for (const match of source.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) {
      const path = candidate.trim().split(/\s+/)[0];
      if (path.startsWith('/')) assetRefs.push(path);
    }
  }
  for (const asset of assetRefs) {
    if (asset.startsWith('/api/') || asset.startsWith('/cdn-cgi/')) continue;
    if (!(await exists(join(root, asset.replace(/^\//, ''))))) {
      issues.brokenAssets.push({ file: label, asset });
    }
  }
}

for (const key of Object.keys(issues)) {
  const seen = new Set();
  issues[key] = issues[key].filter((item) => {
    const value = JSON.stringify(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const counts = Object.fromEntries(Object.entries(issues).map(([key, value]) => [key, value.length]));
const report = { root, htmlFiles: htmlFiles.length, counts, issues };
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ htmlFiles: htmlFiles.length, counts, outputPath }, null, 2));
