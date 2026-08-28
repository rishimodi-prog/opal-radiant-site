#!/usr/bin/env python3
"""Pre-queue gate for a batch of drafted posts.

This exists because the ad-hoc checks written during the first batch produced a
false positive on almost every "finding". Two lessons are baked in here:

  1. A compliance keyword is not a compliance breach. These posts quote marketing
     claims in order to demolish them, so "guarantee", "permanent hair removal"
     and "completely safe" all appear legitimately. This script therefore does NOT
     classify — it prints the surrounding sentence and asks a human to adjudicate.
     Pretending to judge automatically is how you end up crying wolf six times.

  2. Exact substring matching is too strict for keyword placement. "pigmentation
     around mouth" does appear in a title reading "Pigmentation Around the Mouth".
     Articles and inflection are normalised away before comparing.

What it checks mechanically (these are reliable):
  - required fields present, JSON valid
  - body word count, and whether read_time matches it
  - meta_description length
  - a "what the evidence does not support" section exists
  - primary keyword in title / meta / intro / a heading, normalised
  - hero image assigned and on disk
  - internal links point only at allowed URLs

What it surfaces for human judgement (unreliable to automate):
  - compliance-term hits, with context
  - posts over the word-count contract

Citation verification is NOT done here — it needs PubMed. See scripts/ and the
DOI-to-PubMed sweep; run that separately and treat it as a hard gate.

Usage:
    python3 scripts/verify_batch.py --plan data/content-plan-60.json
    python3 scripts/verify_batch.py --plan data/content-plan-60.json --compliance
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'blog-source')
IMG  = os.path.join(ROOT, 'images', 'blog')

REQUIRED = ['slug','title','meta_description','category','read_time','primary_keyword',
            'image_prompt','image_alt','quick_facts','intro','sections','sources','faqs',
            'related_services','see_also']

ALLOWED_PREFIXES = ('/services/', '/concerns/', '/locations/', '/blog/',
                    '/pricing', '/book-appointment', '/care/', '/about')

# Terms that are legitimate when quoted-to-refute and a breach when asserted.
# Never auto-judged — printed with context.
ADJUDICATE = [
    (r'\bguarantee\w*', 'guarantee'),
    (r'permanent(?:ly)? (?:hair )?remov\w*', 'permanent removal'),
    (r'completely safe|totally safe|100% safe|no side effects|entirely safe|zero risk', 'absolute safety'),
    (r'\bno downtime\b', 'no downtime'),
    (r'\bcures?\b|\bcured\b', 'cure'),
    (r'from as low as|starting at just', 'ASCI price framing'),
    (r'weight loss|lose weight|obesity', 'obesity / weight-loss framing'),
    (r'\bsafest\b|\bbest in\b|\bno\.? ?1\b|most experienced', 'superiority'),
    (r'HydraFacial', 'unlicensed trademark'),
]

# Function words a writer will naturally insert into a keyword phrase. Ignoring them
# is the difference between flagging a real omission and flagging "collagen loss age"
# rendered, correctly, as "Collagen Loss by Age".
STOPWORDS = {'the','a','an','of','for','in','on','and','to','is','it','its','your',
             'by','with','from','at','after','about','that','what','are','does','do'}


def norm_words(s):
    s = re.sub(r'<[^>]+>', ' ', s or '').lower()
    return [w for w in re.findall(r'[a-z0-9]+', s) if w not in STOPWORDS]


def contains_keyword(haystack, keyword):
    """Keyword present allowing for dropped articles and word-order gaps."""
    hay, kw = norm_words(haystack), norm_words(keyword)
    if not kw:
        return False
    n = len(kw)
    return any(hay[i:i+n] == kw for i in range(len(hay) - n + 1))


def flatten(d, include_faq=True):
    parts = [d.get('intro', '')]
    parts += [s.get('html', '') for s in d.get('sections', []) if isinstance(s, dict)]
    if include_faq:
        parts += [f.get('a', '') for f in d.get('faqs', []) if isinstance(f, dict)]
        parts += [q.get('value', '') for q in d.get('quick_facts', []) if isinstance(q, dict)]
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', ' '.join(parts)))


def check(slug, want_compliance):
    path = os.path.join(SRC, slug + '.json')
    hard, soft, notes = [], [], []
    if not os.path.exists(path):
        return ['not written yet'], [], []
    try:
        d = json.load(open(path, encoding='utf-8'))
    except ValueError as e:
        return ['invalid JSON: %s' % e], [], []

    for k in REQUIRED:
        if not d.get(k):
            hard.append('missing field: %s' % k)
    if d.get('slug') != slug:
        hard.append('slug mismatch: file says %r' % d.get('slug'))

    md = d.get('meta_description', '')
    if len(md) > 160:
        hard.append('meta_description %d chars' % len(md))

    body = (d.get('intro','') + ' ' +
            ' '.join(s.get('html','') for s in d.get('sections',[]) if isinstance(s, dict)))
    words = len(re.sub(r'<[^>]+>', ' ', body).split())
    if words < 1700:
        hard.append('only %d words' % words)
    elif words > 2600:
        notes.append('%d words, over the 2000-2600 contract' % words)

    want_rt = '%d min read' % max(1, round(words / 225))
    if d.get('read_time') != want_rt:
        soft.append('read_time says %r, %d words implies %r' % (d.get('read_time'), words, want_rt))

    headings = [s.get('heading','') for s in d.get('sections',[]) if isinstance(s, dict)]
    # The Hindi posts carry this section too, headed e.g.
    # "जो दावे मार्केटिंग में मिलते हैं लेकिन सबूत उनका साथ नहीं देते".
    # An English-only pattern flags all six as missing it, which they are not.
    NEG = (r'evidence does ?n.?o?t support|not supported|does not support'
           r'|सबूत .{0,20}साथ नहीं|सबूत से साबित नहीं|सबूत नहीं देते|दावे जिनका सबूत'
           r'|समर्थन नहीं करता|सबूत उनका साथ नहीं|साबित नहीं होते')
    if not any(re.search(NEG, h, re.I) for h in headings):
        if not re.search(NEG, flatten(d), re.I):
            hard.append('no "what the evidence does not support" material')

    kw = d.get('primary_keyword', '')
    where = {'title': contains_keyword(d.get('title',''), kw),
             'meta': contains_keyword(md, kw),
             'intro': contains_keyword(d.get('intro',''), kw),
             'heading': any(contains_keyword(h, kw) for h in headings)}
    for k, v in where.items():
        if not v:
            soft.append('primary keyword not in %s' % k)

    # A post that reuses an existing photograph records `image_source` and does not
    # get its own copy of the file, so check the file the page will actually request.
    img = d.get('image_source') or slug
    for ext in ('jpg', 'webp'):
        if not os.path.exists(os.path.join(IMG, '%s.%s' % (img, ext))):
            hard.append('hero image missing: images/blog/%s.%s' % (img, ext))

    for m in re.finditer(r'href="(/[^"]*)"', body):
        u = m.group(1)
        if not u.startswith(ALLOWED_PREFIXES):
            hard.append('internal link not on the allowed list: %s' % u)

    if want_compliance:
        flat = flatten(d)
        for pat, label in ADJUDICATE:
            for m in re.finditer(pat, flat, re.I):
                a, b = max(0, m.start()-130), min(len(flat), m.end()+130)
                notes.append('[%s] ...%s...' % (label, flat[a:b]))
    return hard, soft, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True)
    ap.add_argument('--compliance', action='store_true',
                    help='also print compliance-term hits with context, for human adjudication')
    a = ap.parse_args()

    topics = json.load(open(a.plan, encoding='utf-8'))['topics']
    n_ok = n_pending = 0
    blocking = {}
    for t in topics:
        hard, soft, notes = check(t['slug'], a.compliance)
        if hard == ['not written yet']:
            n_pending += 1
            continue
        if hard:
            blocking[t['slug']] = hard
        if not hard and not soft:
            n_ok += 1
        if hard or soft or (a.compliance and notes):
            print(t['slug'])
            for h in hard:  print('   BLOCK  %s' % h)
            for s in soft:  print('   warn   %s' % s)
            for n in notes: print('   adjud  %s' % n[:300])
            print()

    total = len(topics)
    print('=' * 70)
    print('written %d / %d   clean %d   blocking %d   not yet written %d'
          % (total - n_pending, total, n_ok, len(blocking), n_pending))
    if blocking:
        print()
        print('CANNOT QUEUE until these are fixed:')
        for s, hs in blocking.items():
            print('  %-50s %s' % (s[:50], '; '.join(hs)[:90]))
    return 1 if blocking else 0


if __name__ == '__main__':
    sys.exit(main())
