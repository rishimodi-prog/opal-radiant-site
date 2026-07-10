-- Opal CRM — Cloudflare D1 Schema
-- Run: wrangler d1 execute opal-crm --file=./crm/schema.sql

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  location TEXT NOT NULL,           -- powai | wadala | borivali | thane
  treatment TEXT,                   -- laser-hair-removal | fat-freeze | carbon-facial | hifu | tattoo-removal | chemical-peel | hydra-facial | mnrf | other
  preferred_date TEXT,
  message TEXT,
  source_page TEXT,                 -- URL path of the page form was on
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  status TEXT DEFAULT 'new',        -- new | contacted | booked | completed | lost
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_location ON leads(location);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
