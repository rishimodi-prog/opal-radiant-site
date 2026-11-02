#!/usr/bin/env python3
"""Ingest drafted blog posts from content-intake/ into the daily publish queue.

This is the automated counterpart to queue_batch.py. Instead of you running a
script locally with a --plan file and a --start date and then pushing, you just
drop finished post JSON files into the `content-intake/` folder and push. The
GitHub Actions workflow (.github/workflows/ingest-batch.yml) then runs THIS
script, which does everything queue_batch.py did — validate, render, date,
queue — and commits the result, with no local scripts and no manual
date-wrangling.

What it does, for every *.json in content-intake/:

  1. Validates it against the same house contract queue_batch.py enforces:
     required fields, slug matches the field, meta_description <= 160 chars,
     body >= 1700 words, sources cited, and the hero image (image_source if the
     post reuses a pool photo, otherwise the slug) exists in images/blog/.
  2. Recomputes read_time deterministically at 225 wpm (drafts understate it).
  3. Assigns gap-free, one-per-day publish dates starting from
     max(last queued date + 1, today) — so freshly ingested posts always start
     publishing from today forward, never back-dated, never colliding with a
     date already in the queue.
  4. Renders blog/<slug>.html with render_blog_post_v2.py.
  5. Appends a ledger entry (published: false) to data/blog-queue.json.
  6. Moves the source JSON from content-intake/ into blog-source/.

Then publish_next.py (the existing daily workflow) un-hides one post per day as
each date arrives, exactly as before.

Safety properties:
  * All-or-nothing on validation. If ANY intake file fails validation, nothing
    is written and the script exits non-zero (so the CI job goes red and no
    commit happens). Fix the file and push again.
  * All-or-nothing on render. Every post is rendered to a temp file first; only
    once all renders succeed are files moved into place and the ledger updated.
  * Idempotent. A slug that is already in the queue is treated as already
    ingested: its intake file is removed and it is skipped, so an accidental
    re-drop or a re-run never double-queues or disturbs published state.
  * No git. This script only touches files; the workflow does the commit/push.
    That keeps it safe to run locally for a dry-run or a test.

Usage:
    python3 scripts/ingest_batch.py            # ingest everything in content-intake/
    python3 scripts/ingest_batch.py --dry-run  # validate + show the plan, write nothing
    python3 scripts/ingest_batch.py --date 2026-11-01   # pretend today is this date
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTAKE = os.path.join(ROOT, 'content-intake')
SRC = os.path.join(ROOT, 'blog-source')
BLOG = os.path.join(ROOT, 'blog')
IMG = os.path.join(ROOT, 'images', 'blog')
LEDGER = os.path.join(ROOT, 'data', 'blog-queue.json')
RENDERER = os.path.join(ROOT, 'scripts', 'render_blog_post_v2.py')

REQUIRED = ['slug', 'title', 'meta_description', 'category', 'read_time',
            'primary_keyword', 'image_alt', 'quick_facts', 'intro',
            'sections', 'sources', 'faqs', 'related_services', 'see_also']

MIN_WORDS = 1700          # house contract is 2000-2600; hard floor matches queue_batch.py
META_MAX = 160            # SERP truncation threshold
WPM = 225                 # read-time basis


def body_word_count(post):
    body = post.get('intro', '') + ' '.join(
        s.get('html', '') for s in post.get('sections', []) if isinstance(s, dict))
    return len(re.sub(r'<[^>]+>', ' ', body).split())


def image_basename(post):
    """The image file the renderer will point at: image_source if the post
    reuses a pool photograph, otherwise the slug."""
    return post.get('image_source') or post.get('slug')


def validate(path, ledger_slugs):
    """Return (status, post, problems).

    status is 'ok'   -> ready to ingest (post carries _date-less fields + fixes)
             'skip'  -> already queued; drop the intake file, don't fail
             'fail'  -> problems is a non-empty list; abort the whole run
    """
    name = os.path.basename(path)
    if not name.endswith('.json'):
        return 'skip', None, []
    try:
        with open(path, encoding='utf-8') as f:
            post = json.load(f)
    except (ValueError, UnicodeDecodeError) as e:
        return 'fail', None, ['%s: invalid JSON: %s' % (name, e)]

    slug = post.get('slug')
    problems = []

    # Already in the queue? Treat as already-ingested (idempotent), not an error.
    if slug and slug in ledger_slugs:
        return 'skip', post, []

    for k in REQUIRED:
        if k not in post or post[k] in (None, '', [], {}):
            problems.append('missing/empty field: %s' % k)

    expected_slug = name[:-len('.json')]
    if slug != expected_slug:
        problems.append('slug %r does not match filename %r' % (slug, expected_slug))

    md = post.get('meta_description', '')
    if len(md) > META_MAX:
        problems.append('meta_description %d chars (>%d, will truncate in SERP)'
                        % (len(md), META_MAX))

    words = body_word_count(post)
    if words < MIN_WORDS:
        problems.append('body only ~%d words (contract is 2000-2600, floor %d)'
                        % (words, MIN_WORDS))

    if not post.get('sources'):
        problems.append('no sources cited')

    img = image_basename(post)
    if img and not os.path.exists(os.path.join(IMG, img + '.jpg')):
        problems.append('hero image missing: images/blog/%s.jpg' % img)

    if problems:
        return 'fail', post, ['%s: %s' % (name, p) for p in problems]

    # Deterministic read-time correction (drafts routinely understate it).
    post['read_time'] = '%d min read' % max(1, round(words / WPM))
    post['_words'] = words
    return 'ok', post, []


def last_queue_date(ledger):
    dates = [p['publish_date'] for p in ledger['posts'] if p.get('publish_date')]
    if not dates:
        return None
    return datetime.date.fromisoformat(max(dates))


def render(src_json_path, out_html_path):
    r = subprocess.run(
        [sys.executable, RENDERER, src_json_path, '--out', out_html_path],
        capture_output=True, text=True)
    return r.returncode, (r.stderr or r.stdout).strip()[-600:]


def emit_github_output(key, value):
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a', encoding='utf-8') as f:
            f.write('%s=%s\n' % (key, value))


def emit_step_summary(md):
    gh = os.environ.get('GITHUB_STEP_SUMMARY')
    if gh:
        with open(gh, 'a', encoding='utf-8') as f:
            f.write(md + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='Validate and show the plan; write nothing.')
    ap.add_argument('--date', help='Pretend today is this date (YYYY-MM-DD), for testing.')
    a = ap.parse_args()

    today = datetime.date.fromisoformat(a.date) if a.date else datetime.date.today()

    if not os.path.isdir(INTAKE):
        print('No content-intake/ directory — nothing to ingest.')
        emit_github_output('ingested', '0')
        return 0

    intake_files = sorted(
        os.path.join(INTAKE, n) for n in os.listdir(INTAKE)
        if n.endswith('.json'))
    if not intake_files:
        print('content-intake/ is empty — nothing to ingest.')
        emit_github_output('ingested', '0')
        return 0

    with open(LEDGER, encoding='utf-8') as f:
        ledger = json.load(f)
    ledger_slugs = {p['slug'] for p in ledger['posts']}

    # --- Phase 1: validate everything (no writes) ----------------------------
    to_ingest = []   # (path, post)
    to_skip = []     # (path, post)  already-queued
    failures = []
    for path in intake_files:
        status, post, problems = validate(path, ledger_slugs)
        if status == 'fail':
            failures.extend(problems)
        elif status == 'skip':
            to_skip.append((path, post))
        else:
            to_ingest.append((path, post))

    print('=== ingest: validation ===')
    print('  intake files: %d   ready: %d   already-queued: %d   failed: %d'
          % (len(intake_files), len(to_ingest), len(to_skip), 0 if not failures else len(set(
              f.split(':', 1)[0] for f in failures))))
    for path, _ in to_skip:
        print('  skip (already queued): %s' % os.path.basename(path))

    if failures:
        print('\n=== VALIDATION FAILED — nothing was written ===')
        for f in failures:
            print('  FAIL %s' % f)
        print('\nFix the file(s) above in content-intake/ and push again.')
        emit_step_summary('### Ingest failed\n\nNothing was queued. Problems:\n'
                          + '\n'.join('- `%s`' % f for f in failures))
        return 1

    # Order ingest deterministically: by any existing publish_date, then slug.
    to_ingest.sort(key=lambda pp: (pp[1].get('publish_date') or '', pp[1]['slug']))

    # --- Dating: start from max(last queued date + 1, today) -----------------
    tail = last_queue_date(ledger)
    start = today if tail is None else max(tail + datetime.timedelta(days=1), today)
    plan = []
    for i, (path, post) in enumerate(to_ingest):
        date = (start + datetime.timedelta(days=i)).isoformat()
        plan.append((path, post, date))

    print('\n=== ingest: plan ===')
    if plan:
        print('  dating from %s (queue tail %s, today %s)'
              % (start.isoformat(), tail.isoformat() if tail else '-', today.isoformat()))
    for _path, post, date in plan:
        w = post.get('_words', 0)
        over = '  [%d words — over 2600 contract]' % w if w > 2600 else ''
        print('  %s  %s%s' % (date, post['slug'], over))

    if a.dry_run:
        for path, _ in to_skip:
            print('  [dry-run] would remove already-queued intake file: %s'
                  % os.path.basename(path))
        print('\n[dry-run] %d post(s) would be queued%s. Nothing written.'
              % (len(plan), (', %s through %s' % (plan[0][2], plan[-1][2])) if plan else ''))
        return 0

    # --- Phase 2: render every post to a temp file (all-or-nothing) ----------
    os.makedirs(BLOG, exist_ok=True)
    os.makedirs(SRC, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix='ingest-render-')
    rendered = []  # (path, post, date, src_tmp, html_tmp)
    try:
        for path, post, date in plan:
            slug = post['slug']
            clean = {k: v for k, v in post.items() if not k.startswith('_')}
            clean['publish_date'] = date
            src_tmp = os.path.join(tmpdir, slug + '.json')
            html_tmp = os.path.join(tmpdir, slug + '.html')
            with open(src_tmp, 'w', encoding='utf-8') as f:
                json.dump(clean, f, indent=2, ensure_ascii=False)
                f.write('\n')
            rc, err = render(src_tmp, html_tmp)
            if rc != 0 or not os.path.exists(html_tmp):
                print('\n=== RENDER FAILED for %s — nothing was written ===' % slug)
                print(err)
                emit_step_summary('### Ingest failed\n\nRender failed for `%s`. '
                                  'Nothing was queued.' % slug)
                return 1
            rendered.append((path, clean, date, src_tmp, html_tmp))
    finally:
        pass  # tmpdir cleaned at the end

    # --- Phase 3: commit to disk (local moves only, won't fail) --------------
    queued = []
    for path, post, date, src_tmp, html_tmp in rendered:
        slug = post['slug']
        shutil.move(html_tmp, os.path.join(BLOG, slug + '.html'))
        shutil.copyfile(src_tmp, os.path.join(SRC, slug + '.json'))
        os.remove(path)  # remove from content-intake (its home is now blog-source)
        queued.append({
            'slug': slug,
            'publish_date': date,
            'title': post['title'],
            'category': post['category'],
            'meta_description': post['meta_description'],
            'image_alt': post['image_alt'],
            'published': False,
        })
        print('  queued %s  %s' % (date, slug))

    # Already-queued intake files: clear them so they don't linger.
    for path, _ in to_skip:
        os.remove(path)

    ledger['posts'].extend(queued)
    ledger['last_ingest'] = today.isoformat()
    with open(LEDGER, 'w', encoding='utf-8') as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
        f.write('\n')

    shutil.rmtree(tmpdir, ignore_errors=True)

    slugs = [q['slug'] for q in queued]
    print('\n=== ingest: done ===')
    if queued:
        print('Queued %d post(s), %s through %s. Ledger now holds %d posts.'
              % (len(queued), queued[0]['publish_date'], queued[-1]['publish_date'],
                 len(ledger['posts'])))
    else:
        print('Nothing new to queue (all intake files were already queued).')

    emit_github_output('ingested', str(len(queued)))
    emit_github_output('slugs', ', '.join(slugs))
    if queued:
        emit_step_summary(
            '### Ingested %d post(s)\n\nDating %s → %s.\n\n%s'
            % (len(queued), queued[0]['publish_date'], queued[-1]['publish_date'],
               '\n'.join('- `%s` — %s' % (q['publish_date'], q['slug']) for q in queued)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
