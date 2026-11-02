# content-intake/

**Drop finished blog-post JSON files here, push, and they publish themselves.**

This folder is the inbox for the automated publish pipeline. Anything you put
here (a `*.json` post in the same schema as `blog-source/`) is picked up by the
**Ingest content-intake** GitHub Action, which validates it, renders its HTML,
gives it the next free publish date, and adds it to the queue. The existing
**Publish daily blog post** Action then puts one post live per day as its date
arrives. You never run a script or edit `data/blog-queue.json` by hand.

## How to add posts

1. Generate the post JSON(s) — same structure as any file in `blog-source/`
   (see the schema reminder below). Name each file `<slug>.json`, where
   `<slug>` matches the `"slug"` field inside it.
2. Put the file(s) in this folder.
3. Commit and push to `main` (or upload them here via the GitHub web UI and
   then run the **Ingest content-intake** workflow from the Actions tab).

That's it. Within a minute the ingest workflow commits the rendered posts into
the queue; from then on they publish one per day. After ingest runs, this
folder is emptied automatically (each post's permanent home is `blog-source/`).

## What ingest checks (and will reject)

A push that fails any of these turns the Action red and queues **nothing** —
fix the file and push again:

- all required fields present (see below),
- `slug` matches the filename,
- `meta_description` ≤ 160 characters (or Google truncates it),
- body ≥ 1700 words (house contract is 2000–2600),
- at least one cited source,
- the hero image exists in `images/blog/` — either `<image_source>.jpg` if the
  post reuses a pool photo via `"image_source"`, or `<slug>.jpg` otherwise.

`read_time` is recomputed for you at 225 wpm, so you don't need to get it right.

## Dates are assigned for you

You don't need to set `publish_date`. Ingest assigns gap-free, one-per-day
dates starting from the later of *(last queued date + 1)* and *today* — so
posts always begin publishing from today forward, never back-dated, never
colliding with a date already in the queue. Drop 30 files and they'll publish
over the next 30 days automatically.

If you *do* include a `publish_date` in a file, it is treated only as an
**ordering hint**: ingest publishes posts in `publish_date` order (then slug
order for any without one), but still reassigns the real calendar dates from
today forward. That's useful when a batch has an intended sequence — e.g. a
seasonal run where the festive-glow posts should go out first. The dates you
write are never used verbatim; only their relative order is.

## Schema reminder (required fields)

```
slug, title, meta_description, category, read_time, primary_keyword,
image_alt, quick_facts (5), intro (HTML), sections [{heading, html}],
sources [{text, url}], faqs [{q, a}], related_services, see_also
```

Optional: `image_source` (reuse an existing `images/blog/` photo by basename),
`lang`. Copy any file from `blog-source/` as a template.
