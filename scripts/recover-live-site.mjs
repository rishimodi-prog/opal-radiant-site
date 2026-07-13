#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve(process.argv[2] || '/tmp/opal-radiant-live-snapshot');
const baseUrl = new URL(process.argv[3] || 'https://opalradiant.com/');
const concurrency = 12;

const pageQueue = [];
const queuedPages = new Set();
const fetchedPages = new Map();
const assetRefs = new Map();
const fetchedAssets = new Set();
const failures = [];

function normalizeUrl(value, parentUrl) {
  try {
    const url = new URL(value, parentUrl);
    if (url.origin !== baseUrl.origin) return null;
    if (url.pathname.startsWith('/cdn-cgi/')) return null;
    url.hash = '';
    url.search = '';
    return url;
  } catch {
    return null;
  }
}

function enqueuePage(value, parentUrl = baseUrl) {
  const url = normalizeUrl(value, parentUrl);
  if (!url || queuedPages.has(url.href)) return;
  queuedPages.add(url.href);
  pageQueue.push(url.href);
}

function addAsset(value, parentUrl) {
  const url = normalizeUrl(value, parentUrl);
  if (!url) return;
  const extension = path.posix.extname(url.pathname).toLowerCase();
  const assetExtensions = new Set([
    '.avif', '.css', '.gif', '.ico', '.jpeg', '.jpg', '.js', '.json',
    '.mp4', '.pdf', '.png', '.svg', '.webp', '.woff', '.woff2', '.xml',
  ]);
  if (!assetExtensions.has(extension)) return;
  if (!assetRefs.has(url.href)) assetRefs.set(url.href, new Set());
  assetRefs.get(url.href).add(parentUrl);
}

function extractReferences(html, pageUrl) {
  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)) {
    const url = normalizeUrl(match[1], pageUrl);
    if (url) enqueuePage(url.href);
  }

  const attributePattern = /<(?:img|script|link|source|video)\b[^>]+(?:src|href|poster|srcset)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    for (const candidate of match[1].split(',').map((item) => item.trim().split(/\s+/)[0])) {
      addAsset(candidate, pageUrl);
    }
  }

  for (const match of html.matchAll(/<meta\b[^>]+content=["']([^"']+)["']/gi)) {
    addAsset(match[1], pageUrl);
  }
}

function pageOutputPath(pageUrl) {
  const url = new URL(pageUrl);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') return path.join(outputRoot, 'index.html');
  if (pathname.endsWith('/')) return path.join(outputRoot, pathname, 'index.html');
  if (path.posix.extname(pathname)) return path.join(outputRoot, pathname);
  return path.join(outputRoot, `${pathname}.html`);
}

function assetOutputPath(assetUrl) {
  const url = new URL(assetUrl);
  return path.join(outputRoot, decodeURIComponent(url.pathname));
}

async function save(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      failures.push({ type: 'page', url, status: response.status, contentType });
      return;
    }

    const html = await response.text();
    const finalUrl = new URL(response.url);
    finalUrl.hash = '';
    finalUrl.search = '';
    if (fetchedPages.has(finalUrl.href)) return;

    fetchedPages.set(finalUrl.href, { requestedUrl: url, bytes: Buffer.byteLength(html) });
    await save(pageOutputPath(finalUrl.href), html);
    extractReferences(html, finalUrl.href);
  } catch (error) {
    failures.push({ type: 'page', url, error: error.message });
  }
}

async function pageWorker() {
  while (pageQueue.length) {
    const url = pageQueue.shift();
    await fetchPage(url);
  }
}

async function fetchAsset(url) {
  if (fetchedAssets.has(url)) return;
  fetchedAssets.add(url);
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      failures.push({ type: 'asset', url, status: response.status });
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await save(assetOutputPath(url), buffer);

    if ((response.headers.get('content-type') || '').includes('text/css')) {
      const css = buffer.toString('utf8');
      for (const match of css.matchAll(/url\((?:["']?)([^"')]+)(?:["']?)\)/gi)) {
        if (!match[1].startsWith('data:')) addAsset(match[1], response.url);
      }
    }
  } catch (error) {
    failures.push({ type: 'asset', url, error: error.message });
  }
}

async function assetWorker(queue) {
  while (queue.length) {
    const url = queue.shift();
    await fetchAsset(url);
  }
}

const sitemapResponse = await fetch(new URL('/sitemap.xml', baseUrl));
if (!sitemapResponse.ok) throw new Error(`Unable to fetch sitemap: ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
await save(path.join(outputRoot, 'sitemap.xml'), sitemap);

for (const match of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) enqueuePage(match[1]);
enqueuePage(baseUrl.href);

while (pageQueue.length) {
  await Promise.all(Array.from({ length: concurrency }, () => pageWorker()));
}

while ([...assetRefs.keys()].some((url) => !fetchedAssets.has(url))) {
  const queue = [...assetRefs.keys()].filter((url) => !fetchedAssets.has(url));
  await Promise.all(Array.from({ length: concurrency }, () => assetWorker(queue)));
}

for (const file of ['robots.txt']) {
  const response = await fetch(new URL(`/${file}`, baseUrl));
  if (response.ok) await save(path.join(outputRoot, file), await response.text());
}

const report = {
  source: baseUrl.href,
  recoveredAt: new Date().toISOString(),
  pages: fetchedPages.size,
  assets: assetRefs.size,
  failures,
};
await save(path.join(outputRoot, 'recovery-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
