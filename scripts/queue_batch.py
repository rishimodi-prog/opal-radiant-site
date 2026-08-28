#!/usr/bin/env python3
"""Validate, render and queue a batch of drafted posts for daily publication.

The daily publisher (publish_next.py) does no LLM work and no rendering — it
only moves an already-rendered post from dormant to linked. So everything has
to be correct and on disk BEFORE the first publish date arrives. This script
is that gate.

It refuses to queue anything that would render a broken card on the blog
index: a missing hero image, an unrenderable source file, a slug collision, a
meta_description that would be truncated in the SERP.

Usage:
    python3 scripts/queue_batch.py --plan data/content-plan-60.json --start 2026-08-25 --dry-run
    python3 scripts/queue_batch.py --plan data/content-plan-60.json --start 2026-08-25
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'blog-source')
BLOG = os.path.join(ROOT, 'blog')
IMG = os.path.join(ROOT, 'images', 'blog')
LEDGER = os.path.join(ROOT, 'data', 'blog-queue.json')
RENDERER = os.path.join(ROOT, 'scripts', 'render_blog_post_v2.py')

REQUIRED = ['slug', 'title', 'meta_description', 'category', 'read_time',
            'primary_keyword', 'image_alt', 'quick_facts', 'intro',
            'sections', 'sources', 'faqs', 'related_services', 'see_also']


def check_one(slug, ledger_slugs, require_image):
    """Return (post_dict_or_None, [problems])."""
    problems = []
    path = os.path.join(SRC, slug + '.json')
    if not os.path.exists(path):
        return None, ['no source file: blog-source/%s.json' % slug]
    try:
        with open(path, encoding='utf-8') as f:
            post = json.load(f)
    except (ValueError, UnicodeDecodeError) as e:
        return None, ['invalid JSON: %s' % e]

    for k in REQUIRED:
        if k not in post or post[k] in (None, '', [], {}):
            problems.append('missing/empty field: %s' % k)

    if post.get('slug') != slug:
        problems.append('slug mismatch: file says %r' % post.get('slug'))

    md = post.get('meta_description', '')
    if len(md) > 160:
        problems.append('meta_description %d chars (>160, will truncate)' % len(md))

    # Word count on the body — the house style contracts 2000-2600.
    import re
    body = post.get('intro', '') + ' '.join(
        s.get('html', '') for s in post.get('sections', []) if isinstance(s, dict))
    words = len(re.sub(r'<[^>]+>', ' ', body).split())
    if words < 1700:
        problems.append('body only ~%d words (contract is 2000-2600)' % words)
    post['_words'] = words

    # read_time is shown to the reader, so a wrong one is a small lie on the page.
    # The drafts consistently understate it (11 min claimed for 3,509 words). Recompute
    # deterministically at 225 wpm rather than trusting what the writer guessed.
    correct = '%d min read' % max(1, round(words / 225))
    if post.get('read_time') != correct:
        post['_read_time_fix'] = correct

    if not post.get('sources'):
        problems.append('no sources cited')

    if slug in ledger_slugs:
        problems.append('already in the publish ledger')

    if require_image and not os.path.exists(os.path.join(IMG, slug + '.jpg')):
        problems.append('no hero image: images/blog/%s.jpg' % slug)

    return post, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True, help='content plan JSON with a "topics" array')
    ap.add_argument('--start', required=True, help='first publish date, YYYY-MM-DD')
    ap.add_argument('--batch', type=int, default=2, help='batch number recorded in the ledger')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-image-check', action='store_true',
                    help='queue even without hero images (they must exist before the publish date)')
    ap.add_argument('--only-valid', action='store_true',
                    help='queue the posts that pass and report the rest, instead of refusing entirely')
    a = ap.parse_args()

    with open(a.plan, encoding='utf-8') as f:
        topics = json.load(f)['topics']

    with open(LEDGER, encoding='utf-8') as f:
        ledger = json.load(f)
    ledger_slugs = {p['slug'] for p in ledger['posts']}

    start = datetime.date.fromisoformat(a.start)

    ok, bad = [], []
    for t in topics:
        post, problems = check_one(t['slug'], ledger_slugs, not a.skip_image_check)
        (bad if problems else ok).append((t, post, problems))

    print('=== validation ===')
    print('  pass: %d    fail: %d    of %d planned' % (len(ok), len(bad), len(topics)))
    for t, _post, problems in bad:
        print('  FAIL %s' % t['slug'])
        for p in problems:
            print('        - %s' % p)

    if bad and not a.only_valid:
        print('\nRefusing to queue. Fix the above, or re-run with --only-valid.')
        return 1

    print()
    print('=== render + queue ===')
    queued = []
    for i, (t, post, _problems) in enumerate(ok):
        slug = t['slug']
        date = (start + datetime.timedelta(days=i)).isoformat()
        post['publish_date'] = date
        fixed = post.pop('_read_time_fix', None)
        words = post.pop('_words', 0)
        if fixed:
            post['read_time'] = fixed
        if words > 2600:
            print('  note: %s is %d words, over the 2000-2600 contract' % (slug, words))

        if not a.dry_run:
            with open(os.path.join(SRC, slug + '.json'), 'w', encoding='utf-8') as f:
                json.dump(post, f, indent=2, ensure_ascii=False)
                f.write('\n')
            r = subprocess.run(
                [sys.executable, RENDERER, os.path.join(SRC, slug + '.json'),
                 '--out', os.path.join(BLOG, slug + '.html')],
                capture_output=True, text=True)
            if r.returncode != 0:
                print('  RENDER FAILED %s: %s' % (slug, r.stderr.strip()[-400:]))
                continue

        queued.append({
            'slug': slug,
            'publish_date': date,
            'title': post['title'],
            'category': post['category'],
            'meta_description': post['meta_description'],
            'image_alt': post['image_alt'],
            'published': False,
        })
        print('  %s  %s' % (date, slug))

    if a.dry_run:
        print('\n[dry-run] nothing written. %d posts would be queued, '
              '%s through %s.' % (len(queued), queued[0]['publish_date'] if queued else '-',
                                  queued[-1]['publish_date'] if queued else '-'))
        return 0

    ledger['posts'].extend(queued)
    ledger['batch_%d_generated' % a.batch] = datetime.date.today().isoformat()
    with open(LEDGER, 'w', encoding='utf-8') as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print('\nQueued %d posts, %s through %s.'
          % (len(queued), queued[0]['publish_date'], queued[-1]['publish_date']))
    print('Ledger now holds %d posts total.' % len(ledger['posts']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
