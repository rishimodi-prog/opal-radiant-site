# Auto-ingest pipeline — one-time setup

This package adds a GitHub Actions system so new blog posts reach the site
**without you running any local script or pushing on a schedule**. You drop
finished post JSON into `content-intake/` and push; a workflow validates,
renders, dates and queues them automatically, and the existing daily workflow
publishes one per day.

It also comes pre-loaded with **the 30 Batch-3 posts** (Oct–Nov seasonal set)
in `content-intake/`, so the single push below both installs the system *and*
refills your queue — which is currently empty (the last post went live
2026-10-26, so nothing new has published since).

## What's in this archive (paths are relative to the repo root)

- `scripts/ingest_batch.py` — the ingest engine (validate → render → date →
  queue). Pure stdlib; no secrets of yours.
- `.github/workflows/ingest-batch.yml` — runs it on every push to
  `content-intake/`, on demand, and once a day as a safety sweep.
- `content-intake/README.md` — how to add posts + the schema/validation rules.
- `content-intake/*.json` — the 30 Batch-3 posts, ready to ingest.
- `CONTENT-PIPELINE.md` — how the whole thing fits together (a diagram + the
  two workflows + the one manual step that remains).

It does **not** touch `publish-daily.yml`, `data/blog-queue.json`, or any
existing post. Nothing here overwrites anything.

## Install (from an up-to-date checkout of `main`)

```bash
cd /path/to/opal-radiant-site     # your working clone, pulled to latest main
tar xzf opal-ingest-pipeline.tar.gz
git add -A
git commit -m "Add auto-ingest content pipeline + queue Batch 3 (30 posts)"
git push
```

On that push, the **Ingest content-intake** workflow runs, queues all 30 posts
(dating them from today forward, one per day, in the intended seasonal order),
renders their HTML, moves the JSON into `blog-source/`, and commits. From the
next daily run, one goes live per day.

> If the workflow doesn't start on its own (GitHub occasionally doesn't
> auto-run a workflow that was added in the very same push), just open the
> **Actions** tab → **Ingest content-intake** → **Run workflow** once. Every
> push after this one triggers it normally.

## From now on, to publish more posts

1. Put finished `<slug>.json` files in `content-intake/`.
2. `git push` (or upload them in the GitHub web UI and click *Run workflow*).

That's the only manual step left — writing the posts and getting them into the
repo. Everything after that is automatic.

## A note on what could *not* be automated from here

The cloud session that built this cannot push to your GitHub repo (it has no
write credentials for it), and post **writing** needs an LLM, which can't run
inside GitHub Actions. So this package moves the manual work down to a single
`git push`; it can't remove that last step. If you draft future batches in a
Claude session with this repo's folder connected, Claude can write the JSON
straight into `content-intake/` for you, leaving just the push.
