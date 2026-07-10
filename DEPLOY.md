# Opal Radiant — Deployment Guide

## Step 1: Push to GitHub

```bash
# Create a new repo on GitHub (github.com/new) named "opal-radiant-site"
# Then from this folder:

git remote add origin https://github.com/YOUR_USERNAME/opal-radiant-site.git
git push -u origin main
```

## Step 2: Deploy to Cloudflare Pages

1. Go to **dash.cloudflare.com** → Workers & Pages → Create → Pages
2. Connect your GitHub account
3. Select the **opal-radiant-site** repository
4. Build settings:
   - **Build command:** (leave empty — it's a static site)
   - **Build output directory:** `/` (root)
5. Click **Save and Deploy**
6. Set custom domain: `opalradiant.com` in the Pages project settings

## Step 3: Deploy the CRM Worker

```bash
# Install Wrangler (Cloudflare CLI)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create the D1 database
wrangler d1 create opal-crm

# Copy the database_id from the output and paste it in crm/wrangler.toml

# Run the schema
wrangler d1 execute opal-crm --file=crm/schema.sql

# Set the dashboard password
cd crm
wrangler secret put DASHBOARD_PASSWORD
# Enter your chosen password when prompted

# Deploy the worker
wrangler deploy
```

The CRM will be at: `https://opal-crm.opalradiant.workers.dev`
- Form submissions: POST to `/api/lead`
- Dashboard: `/dashboard`

## Step 4: Custom Domain for CRM (Optional)

In Cloudflare dashboard → Workers & Pages → opal-crm → Settings → Domains & Routes
Add: `crm.opalradiant.com`

Then update `js/main.js` CRM_ENDPOINT to `https://crm.opalradiant.com/api/lead`

## Auto-Deploy

After setup, every `git push` to `main` will automatically redeploy the site.
To publish a new blog post or page, I'll create the HTML file and push — it goes live in ~30 seconds.
