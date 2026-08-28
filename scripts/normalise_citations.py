#!/usr/bin/env python3
"""Make one DOI read identically everywhere it is cited across the batch.

Independently-written posts converge on the same papers — which is the point of
the shared-research design — but they format the citation slightly differently:
one uses <em> around the journal, another plain text; one lists nine authors,
another truncates to "et al.". The facts agree; only the presentation drifts.
That looks careless in a sources block and, per research/geo.md, cross-page
inconsistency is one of the few things with measured citation cost (OR 1.74-4.09).

The rule here is strictly information-preserving: for each DOI, adopt the variant
with the MOST complete author list (longest text), and apply it everywhere. It
never invents, shortens or merges — it only promotes the fullest existing version.
Anything it would change is printed, so the edit is reviewable rather than silent.

Usage:
    python3 scripts/normalise_citations.py --dry-run
    python3 scripts/normalise_citations.py
"""
import argparse, collections, glob, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'blog-source')


def norm_space(s):
    return re.sub(r'\s+', ' ', s).strip()



def title_key(text):
    """The quoted article title, stripped to comparable form (accents, case, punctuation)."""
    t = re.sub(r'</?em>', '', text)
    m = re.search(r'["\u201c]([^"\u201d]{10,400})["\u201d]', t)
    if not m:
        return re.sub(r'[^a-z0-9]', '', t.lower())
    s = unicodedata.normalize('NFKD', m.group(1))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', s.lower())


def facts(text):
    """Strip formatting so two variants can be compared on content alone."""
    t = re.sub(r'</?em>', '', text)
    t = t.replace('—', '-').replace('–', '-')
    t = re.sub(r'\s+', ' ', t)
    return t.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    posts = {}
    variants = collections.defaultdict(list)   # url -> [(text, slug)]
    for p in sorted(glob.glob(os.path.join(SRC, '*.json'))):
        try:
            d = json.load(open(p, encoding='utf-8'))
        except ValueError:
            continue
        slug = d.get('slug') or os.path.basename(p)[:-5]
        posts[slug] = (p, d)
        for s in d.get('sources', []):
            if s.get('url'):
                variants[s['url']].append((norm_space(s.get('text', '')), slug))

    changes = collections.defaultdict(list)
    conflicts = []
    for url, vs in variants.items():
        texts = {t for t, _ in vs}
        if len(texts) <= 1:
            continue
        # Longest = most complete author list. Prefer one that keeps <em> markup.
        best = max(texts, key=lambda t: (len(facts(t)), '<em>' in t))
        # Only the QUOTED TITLE decides whether two variants are the same citation.
        # Everything else -- curly vs straight quotes, <em> markup, abbreviated vs
        # full journal name, "et al." vs the full author list, Turkish diacritics --
        # is presentation, and promoting the fullest variant is information-preserving.
        # An earlier tail-of-string heuristic flagged all of those as conflicts, which
        # would have meant hand-reviewing 16 non-problems.
        titles = {title_key(t) for t in texts}
        if len(titles) > 1:
            # Still safe if one title is simply a fuller version of the other
            # (a dropped subtitle); the longest is then the right one to adopt.
            longest = max(titles, key=len)
            if not all(longest.startswith(t) for t in titles):
                conflicts.append((url, sorted(texts, key=len)))
        for t, slug in vs:
            if t != best:
                changes[slug].append((url, t, best))

    print('=== citation normalisation ===')
    print('  distinct DOIs/URLs cited : %d' % len(variants))
    print('  with >1 text variant     : %d' % sum(1 for v in variants.values()
                                                  if len({t for t, _ in v}) > 1))
    print('  posts needing an edit    : %d' % len(changes))
    print('  edits in total           : %d' % sum(len(v) for v in changes.values()))

    if conflicts:
        print()
        print('  *** these differ by more than formatting — review by hand, NOT auto-fixed ***')
        for url, texts in conflicts:
            print('    %s' % url)
            for t in texts:
                print('        - %s' % t[:160])

    conflict_urls = {u for u, _ in conflicts}
    applied = 0
    for slug, items in sorted(changes.items()):
        show = [(u, o, n) for u, o, n in items if u not in conflict_urls]
        if not show:
            continue
        print()
        print('  %s' % slug)
        for url, old, new in show:
            print('     %s' % url)
            print('       - %s' % old[:130])
            print('       + %s' % new[:130])
        if not a.dry_run:
            path, d = posts[slug]
            fix = {u: n for u, _, n in show}
            for s in d.get('sources', []):
                if s.get('url') in fix:
                    s['text'] = fix[s['url']]; applied += 1
            json.dump(d, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
            open(path, 'a', encoding='utf-8').write('\n')

    print()
    print('[dry-run] nothing written.' if a.dry_run else 'applied %d citation edits.' % applied)
    return 0


if __name__ == '__main__':
    sys.exit(main())
