# Opal Radiant — automated content pipeline

How a finished blog post gets from a JSON file to live on opalradiant.com,
one per day, without anyone running a script or pushing on a schedule.

```
  write posts            drop + push                 automatic in GitHub Actions
 ┌────────────┐      ┌────────────────────┐      ┌───────────────┐   ┌────────────────┐
 │  generate  │ ───▶ │  content-intake/   │ ───▶ │  ingest-batch │─▶ │ publish-daily  │ ─▶ live
 │  <slug>.json│      │  (push to main)    │      │  (validate,   │   │ (1 post/day as │
 └────────────┘      └────────────────────┘      │ render, date, │   │ its date hits) │
                                                   │   queue)      │   └────────────────┘
                                                   └───────────────┘
```

## The two workflows

**`.github/workflows/ingest-batch.yml` — turns dropped files into queued posts.**
Runs `scripts/ingest_batch.py` whenever JSON is pushed into `content-intake/`
(also on demand from the Actions tab, and once a day at 01:00 UTC as a safety
sweep). It validates each post against the house contract, renders its HTML,
assigns the next free publish date, appends it to `data/blog-queue.json` as
`published: false`, moves the JSON into `blog-source/`, and commits — all with
`GITHUB_TOKEN`, no secrets of yours involved.

**`.github/workflows/publish-daily.yml` — puts one queued post live per day.**
Unchanged. Runs `scripts/publish_next.py` at 02:00 UTC (07:30 IST): it un-hides
whatever post is due (adds its card to the blog index + sitemap, backfills
internal links), marks it published, commits, and deploys to Cloudflare Pages.

The two share a concurrency group so they never touch the queue at the same
time.

## The one manual step that remains

Content still has to be **written** (that needs an LLM, which cannot run inside
GitHub Actions) and the finished JSON has to **get into the repo** — a `git
push`, or uploading the files in the GitHub web UI. That is the only manual
touchpoint. Everything after the files land in `content-intake/` on `main` is
automatic: no local scripts, no editing the queue, no manual dates, no
scheduled pushing.

If you draft posts in a Claude session with this repo's folder connected,
Claude can write the JSON straight into `content-intake/` and the push is the
only thing left to do.

## Adding posts (the short version)

1. Put finished `<slug>.json` files in `content-intake/`.
2. Push to `main`.
3. Done — they publish one per day. Watch progress in the Actions tab.

See `content-intake/README.md` for the schema and the validation rules ingest
enforces.

## Quick checks

- **Did a drop get queued?** Actions tab → latest *Ingest content-intake* run;
  its summary lists what it queued. Or look at the tail of
  `data/blog-queue.json`.
- **Is daily publishing healthy?** Actions tab → *Publish daily blog post*
  should have a green run each day, and `data/blog-queue.json` should show the
  most recent dates flipping to `"published": true`.
- **Queue empty?** If every entry in `data/blog-queue.json` is
  `"published": true`, nothing new will go live until more posts are ingested —
  that is the signal to generate and drop the next batch.
