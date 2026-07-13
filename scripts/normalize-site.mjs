import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = process.argv[2] || process.cwd();
const routeMap = new Map([
  ['/locations/', '/contact'],
  ['/services-opal-radiant', '/services/'],
  ['/treatment-services', '/services/'],
  ['/laser-hair-removal-mumbai-1', '/services/laser-hair-removal-mumbai'],
  ['/services/laser-hair-removal', '/services/laser-hair-removal-mumbai'],
  ['/services/pigmentation-melasma', '/concerns/pigmentation-melasma'],
  ['/services/pcos-hair-growth', '/concerns/pcos-hair-growth'],
  ['/services/pre-wedding', '/for/pre-wedding'],
  ['/services/anti-ageing', '/concerns/anti-ageing'],
  ['/services/post-pregnancy-body', '/concerns/post-pregnancy-body'],
  ['/hydra-facial', '/services/hydra-facial'],
  ['/peel', '/services/chemical-peel'],
  ['/hair-prp', '/services/hair-prp'],
  ['/laser-hair-removal-mumbai', '/services/laser-hair-removal-mumbai'],
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.wrangler') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (extname(entry.name) === '.html' || entry.name === 'sitemap.xml') files.push(path);
  }
  return files;
}

function normalizeRoute(route) {
  const match = route.match(/^([^?#]*)([?#].*)?$/);
  let path = match[1];
  const suffix = match[2] || '';
  if (path.endsWith('.html')) path = path.slice(0, -5);
  path = routeMap.get(path) || path;
  return path + suffix;
}

function normalizeDocument(source, isHtml) {
  let output = source;

  const preferredImages = new Map([
    ['/images/hero-laser-treatment.jpg', '/images/hero-laser-treatment.webp'],
    ['/images/laser-hair-removal-hero.jpg', '/images/laser-hair-removal-hero.webp'],
    ['/images/service-mnrf.jpg', '/images/service-mnrf.webp'],
    ['/images/service-hifem.jpg', '/images/service-hifem.webp'],
    ['/images/service-jordi-shape.jpg', '/images/service-jordi-shape.webp'],
    ['/images/about/founders.jpg', '/images/about/founders.webp'],
    ['/images/about/our-promise.png', '/images/about/our-promise.webp'],
    ['/images/about/opal-logo-badge.png', '/images/about/opal-logo-badge.webp'],
    ['/images/ff-area-abdomen.jpg', '/images/ff-area-abdomen.webp'],
    ['/images/ff-area-thighs.jpg', '/images/ff-area-thighs.webp'],
    ['/images/opal-logo.png', '/images/opal-logo.webp'],
    ['/images/dr-punit-sakhare.jpg', '/images/dr-punit-sakhare.webp'],
    ['/images/service-laser-hair-removal.jpg', '/images/service-laser-hair-removal.webp'],
    ['/images/service-fat-freeze.jpg', '/images/service-fat-freeze.webp'],
    ['/images/service-carbon-facial.jpg', '/images/service-carbon-facial.webp'],
    ['/images/service-hifu.jpg', '/images/service-hifu.webp'],
    ['/images/service-tattoo-removal.jpg', '/images/service-tattoo-removal.webp'],
    ['/images/service-chemical-peel.jpg', '/images/service-chemical-peel.webp'],
    ['/images/service-hydra-facial.jpg', '/images/service-hydra-facial.webp'],
    ['/images/service-hair-prp.jpg', '/images/service-hair-prp.webp'],
    ['/images/service-hair-fillers.jpg', '/images/service-hair-fillers.webp'],
  ]);
  for (const [original, optimized] of preferredImages) {
    output = output.replaceAll(original, optimized);
  }

  output = output.replace(/^\s*<link rel="preconnect" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"(?: crossorigin)?>\s*$/gm, '');
  output = output.replace(
    /^\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^\"]+" rel="stylesheet">\s*$/gm,
    '  <link rel="preload" href="/fonts/arimo-latin.woff2" as="font" type="font/woff2" crossorigin>\n  <link rel="preload" href="/fonts/oswald-latin.woff2" as="font" type="font/woff2" crossorigin>',
  );

  output = output.replace(/<img([^>]*?)loading="eager"([^>]*?)>/g, (full, before, after) => {
    if (/fetchpriority=/.test(full)) return full;
    return `<img${before}loading="eager" fetchpriority="high"${after}>`;
  });

  output = output.replace(
    /  <!-- Microsoft Clarity -->\s*<script type="text\/javascript">[\s\S]*?<\/script>/,
    `  <!-- Microsoft Clarity: deferred until after the page is usable -->
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "uk6elnx25m");
      }, 1500);
    }, { once: true });
  </script>`,
  );
  output = output.replace(
    /  <script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-S2T33WR4TY"><\/script>/,
    `  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        var tag = document.createElement('script');
        tag.async = true;
        tag.src = 'https://www.googletagmanager.com/gtag/js?id=G-S2T33WR4TY';
        document.head.appendChild(tag);
      }, 1500);
    }, { once: true });
  </script>`,
  );

  output = output.replace(/https:\/\/opalradiant\.com(\/[^\s"'<>]*)/g, (full, route) => {
    return `https://opalradiant.com${normalizeRoute(route)}`;
  });
  output = output.replace(/href="(\/[^"\s]*)"/g, (full, route) => {
    return `href="${normalizeRoute(route)}"`;
  });

  if (!isHtml) return output;

  output = output.replace(
    /<a href="\/cdn-cgi\/l\/email-protection#[^"]+"><span class="__cf_email__" data-cfemail="[^"]+">\[email&#160;protected\]<\/span><\/a>/g,
    '<a href="mailto:info@opalradiant.com">info@opalradiant.com</a>',
  );
  output = output.replace(
    /<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]+"><\/script>/g,
    '',
  );

  output = output.replace(
    /<a href="([^"]+)" class="footer__branch">([\s\S]*?<h5 class="footer__branch-name">)([^<]+)(<\/h5>[\s\S]*?<div class="footer__branch-actions">[\s\S]*?<\/div>\s*)<\/a>/g,
    (_full, href, beforeName, name, afterName) => (
      `<article class="footer__branch">${beforeName}<a href="${href}">${name}</a>${afterName}</article>`
    ),
  );

  return output;
}

const files = await walk(root);
let changed = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const output = normalizeDocument(source, extname(file) === '.html');
  if (output !== source) {
    await writeFile(file, output);
    changed += 1;
  }
}

console.log(`Normalized ${changed} of ${files.length} documents.`);
