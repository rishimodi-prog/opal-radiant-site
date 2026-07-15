#!/usr/bin/env python3
"""
Deterministic daily publish step for the 30-post content batch.

No LLM calls happen here — every post's HTML, images, sources, and internal
links were already generated ahead of time (see blog-source/*.json and
blog/*.html) and just sit dormant, unlinked from blog/index.html and
sitemap.xml, until their scheduled day. This script's only job each day is:

  1. Read data/blog-queue.json (the publish ledger).
  2. Find any entries whose publish_date has arrived and aren't marked
     published yet (usually exactly one, but this catches up gracefully if a
     run was ever missed).
  3. For each: add its card to blog/index.html, add it to sitemap.xml,
     resolve any `data-pending-link` placeholders in already-published posts
     that were waiting on this slug to go live (smart interlinking), and
     mark it published in the ledger.
  4. Run build.py, commit, and (unless --no-deploy) deploy via wrangler.

Usage:
    python3 scripts/publish_next.py                # publish whatever's due today
    python3 scripts/publish_next.py --date 2026-07-20   # simulate a specific date
    python3 scripts/publish_next.py --dry-run       # show what would happen, change nothing
    python3 scripts/publish_next.py --no-deploy     # commit but skip the wrangler deploy
"""
import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER_PATH = os.path.join(ROOT, 'data', 'blog-queue.json')
INDEX_PATH = os.path.join(ROOT, 'blog', 'index.html')
SITEMAP_PATH = os.path.join(ROOT, 'sitemap.xml')

GRID_START = '<!-- BLOG_INDEX_GRID:START -->'
SITEMAP_MARKER = '<!-- Blog posts — batch 1 -->'


def load_ledger():
    with open(LEDGER_PATH) as f:
        return json.load(f)


def save_ledger(ledger):
    with open(LEDGER_PATH, 'w') as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
        f.write('\n')


def make_card_html(post):
    slug = post['slug']
    title = post['title']
    excerpt = post['meta_description']
    category = post['category']
    month_year = datetime.datetime.strptime(post['publish_date'], '%Y-%m-%d').strftime('%B %Y')
    return f'''          <article class="blog-card">
            <a href="/blog/{slug}" class="blog-card__image">
              <img src="/images/blog/{slug}.jpg" alt="{post['image_alt']}" width="400" height="250" loading="lazy" style="object-fit:cover;">
            </a>
            <div class="blog-card__body">
              <span class="blog-card__category">{category}</span>
              <h2 class="blog-card__title"><a href="/blog/{slug}">{title}</a></h2>
              <p class="blog-card__excerpt">{excerpt}</p>
              <p class="blog-card__meta">Dr. Punit Sakhare &middot; {month_year}</p>
            </div>
          </article>
'''


def insert_card(post, dry_run):
    with open(INDEX_PATH) as f:
        content = f.read()
    if f'/blog/{post["slug"]}"' in content:
        return False  # already inserted (idempotent re-run safety)
    card = make_card_html(post)
    marker = GRID_START + '\n        <div class="grid grid--3">\n'
    idx = content.find(marker)
    if idx == -1:
        raise SystemExit(f'Could not find BLOG_INDEX_GRID marker in {INDEX_PATH}')
    insert_at = idx + len(marker)
    new_content = content[:insert_at] + card + content[insert_at:]
    if not dry_run:
        with open(INDEX_PATH, 'w') as f:
            f.write(new_content)
    return True


def insert_sitemap(post, dry_run):
    with open(SITEMAP_PATH) as f:
        content = f.read()
    slug = post['slug']
    if f'/blog/{slug}<' in content:
        return False
    url_line = (f'  <url><loc>https://opalradiant.com/blog/{slug}</loc>'
                f'<lastmod>{post["publish_date"]}</lastmod><changefreq>monthly</changefreq>'
                f'<priority>0.75</priority></url>\n')
    if SITEMAP_MARKER in content:
        idx = content.find(SITEMAP_MARKER) + len(SITEMAP_MARKER) + 1
        new_content = content[:idx] + url_line + content[idx:]
    else:
        # first run: create the section right after the existing blog/ index line
        anchor = '<url><loc>https://opalradiant.com/blog/</loc>'
        idx = content.find(anchor)
        if idx == -1:
            # fall back to right before </urlset>
            idx = content.find('</urlset>')
            new_content = content[:idx] + f'{SITEMAP_MARKER}\n' + url_line + content[idx:]
        else:
            line_end = content.find('\n', idx) + 1
            new_content = content[:line_end] + f'{SITEMAP_MARKER}\n' + url_line + content[line_end:]
    if not dry_run:
        with open(SITEMAP_PATH, 'w') as f:
            f.write(new_content)
    return True


SPAN_RE_TMPL = r'<span data-pending-link="{slug}">(.*?)</span>'
LI_RE_TMPL = r'<li data-pending-link="{slug}">(.*?)</li>'


def backfill_links(slug, dry_run):
    """Resolve any data-pending-link placeholders across already-live blog
    posts that were waiting on `slug` to go live."""
    span_re = re.compile(SPAN_RE_TMPL.format(slug=re.escape(slug)), re.DOTALL)
    li_re = re.compile(LI_RE_TMPL.format(slug=re.escape(slug)), re.DOTALL)
    touched = []
    for filepath in glob.glob(os.path.join(ROOT, 'blog', '*.html')):
        with open(filepath) as f:
            content = f.read()
        original = content
        content = span_re.sub(rf'<a href="/blog/{slug}">\1</a>', content)
        content = li_re.sub(rf'<li><a href="/blog/{slug}">\1</a></li>', content)
        if content != original:
            touched.append(os.path.basename(filepath))
            if not dry_run:
                with open(filepath, 'w') as f:
                    f.write(content)
    return touched


def run(cmd, check=True):
    print('  $', ' '.join(cmd))
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip()[-2000:])
    if result.returncode != 0:
        print(result.stderr.strip()[-2000:], file=sys.stderr)
        if check:
            raise SystemExit(f'Command failed: {" ".join(cmd)}')
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', help='Simulate this date (YYYY-MM-DD) instead of today (UTC).')
    ap.add_argument('--dry-run', action='store_true', help="Show what's due, change nothing.")
    ap.add_argument('--no-deploy', action='store_true', help='Commit changes but skip wrangler deploy.')
    ap.add_argument('--no-commit', action='store_true', help='Skip git commit/push (implies --no-deploy).')
    args = ap.parse_args()

    today = args.date or datetime.date.today().isoformat()
    ledger = load_ledger()
    due = [p for p in ledger['posts'] if not p['published'] and p['publish_date'] <= today]
    due.sort(key=lambda p: p['publish_date'])

    if not due:
        print(f'[{today}] Nothing due. Next unpublished post: '
              f'{next((p["slug"] + " on " + p["publish_date"] for p in ledger["posts"] if not p["published"]), "— batch complete —")}')
        return

    print(f'[{today}] Publishing {len(due)} post(s): {", ".join(p["slug"] for p in due)}')

    for post in due:
        slug = post['slug']
        if not os.path.exists(os.path.join(ROOT, 'blog', f'{slug}.html')):
            print(f'  ! WARNING: blog/{slug}.html missing on disk — skipping, will retry next run.')
            continue
        card_added = insert_card(post, args.dry_run)
        sitemap_added = insert_sitemap(post, args.dry_run)
        touched = backfill_links(slug, args.dry_run)
        print(f'  - {slug}: index_card={card_added} sitemap={sitemap_added} backfilled_in={touched or "none"}')
        if not args.dry_run:
            post['published'] = True
            post['published_at'] = today

    if args.dry_run:
        print('[dry-run] No files were written.')
        return

    save_ledger(ledger)

    # Note: the real repo's pages are fully self-contained HTML (header/footer
    # baked in per file) — there is no separate build/partial-injection step
    # to run here, unlike the earlier version of this script.

    if args.no_commit:
        print('Skipping git commit/push (--no-commit).')
        return

    slugs = ', '.join(p['slug'] for p in due)
    run(['git', 'add', '-A'])
    commit_result = run(['git', 'commit', '-m', f'Publish blog post(s): {slugs}'], check=False)
    if commit_result.returncode != 0 and 'nothing to commit' not in commit_result.stdout:
        raise SystemExit('git commit failed unexpectedly')
    run(['git', 'push'])

    if args.no_deploy:
        print('Skipping wrangler deploy (--no-deploy).')
        return

    cf_token = os.environ.get('CLOUDFLARE_API_TOKEN')
    cf_account = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    cf_project = os.environ.get('CF_PAGES_PROJECT', 'opal-radiant-site')
    if not (cf_token and cf_account):
        raise SystemExit('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — cannot deploy.')
    run(['wrangler', 'pages', 'deploy', '.',
         '--project-name', cf_project, '--branch', 'main',
         '--commit-message', f'Publish blog post(s): {slugs}', '--commit-dirty=true'])
    print('Deployed.')


if __name__ == '__main__':
    main()
