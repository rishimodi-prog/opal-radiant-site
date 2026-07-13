import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, 'dist'));
const publicDirectories = [
  'blog',
  'care',
  'compare',
  'concerns',
  'css',
  'fonts',
  'for',
  'images',
  'js',
  'locations',
  'opal-blog',
  'services',
];
const publicFiles = new Set([
  '_headers',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  const include = (entry.isFile() && (extname(entry.name) === '.html' || publicFiles.has(entry.name)))
    || (entry.isDirectory() && publicDirectories.includes(entry.name));
  if (!include) continue;
  await cp(join(root, entry.name), join(output, entry.name), { recursive: true });
}

console.log(`Built Cloudflare Pages output at ${output}`);
console.log(`Excluded private/development paths such as crm/, scripts/, artifacts/, and recovery-report.json.`);
