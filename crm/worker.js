/**
 * Opal CRM — Cloudflare Worker
 * Handles form submissions + CRM dashboard API
 *
 * Deploy: wrangler deploy --config crm/wrangler.toml
 * Env vars needed: DASHBOARD_PASSWORD (for CRM access)
 * D1 binding: DB (opal-crm database)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://opalradiant.com',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      // Public endpoint: form submission
      if (url.pathname === '/api/lead' && request.method === 'POST') {
        return handleLeadSubmission(request, env);
      }

      // Dashboard endpoints (password-protected)
      if (url.pathname.startsWith('/api/dashboard')) {
        const authOk = await checkAuth(request, env);
        if (!authOk) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        if (url.pathname === '/api/dashboard/leads' && request.method === 'GET') {
          return getLeads(url, env);
        }
        if (url.pathname === '/api/dashboard/lead' && request.method === 'POST') {
          return updateLead(request, env);
        }
        if (url.pathname === '/api/dashboard/stats' && request.method === 'GET') {
          return getStats(env);
        }
      }

      // Serve dashboard HTML
      if (url.pathname === '/dashboard' || url.pathname === '/dashboard/') {
        return new Response(DASHBOARD_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};

// ─── Lead Submission ────────────────────────────────────────────

async function handleLeadSubmission(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Validate required fields (location optional — captured on callback if omitted)
  if (!data.name || !data.phone) {
    return jsonResponse({ error: 'Name and phone are required' }, 400);
  }

  // Basic phone validation (Indian)
  const phone = data.phone.replace(/[\s\-\+]/g, '');
  if (!/^(91)?[6-9]\d{9}$/.test(phone)) {
    return jsonResponse({ error: 'Please enter a valid Indian phone number' }, 400);
  }

  // Sanitize
  const clean = (s) => s ? String(s).trim().slice(0, 500) : null;

  const result = await env.DB.prepare(`
    INSERT INTO leads (
      name, phone, email, location, treatment, preferred_date, message, source_page,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      gclid, gbraid, wbraid, ga_client_id, landing_page
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    clean(data.name),
    phone,
    clean(data.email),
    clean(data.location) || 'Not specified',
    clean(data.treatment),
    clean(data.preferred_date),
    clean(data.message),
    clean(data.source_page),
    clean(data.utm_source),
    clean(data.utm_medium),
    clean(data.utm_campaign),
    clean(data.utm_term),
    clean(data.utm_content),
    clean(data.gclid),
    clean(data.gbraid),
    clean(data.wbraid),
    clean(data.ga_client_id),
    clean(data.landing_page)
  ).run();

  // Fire an email notification. Wrapped so a failure NEVER breaks lead capture —
  // the lead is already safely saved in D1 by this point.
  try {
    await sendLeadNotification(env, {
      id: result.meta.last_row_id,
      name: clean(data.name),
      phone,
      email: clean(data.email),
      location: clean(data.location) || 'Not specified',
      treatment: clean(data.treatment),
      message: clean(data.message),
      source_page: clean(data.source_page),
      utm_source: clean(data.utm_source),
      utm_medium: clean(data.utm_medium),
      utm_campaign: clean(data.utm_campaign),
    });
  } catch (err) {
    console.error('Lead email notification failed (lead still saved):', err);
  }

  return jsonResponse({ success: true, id: result.meta.last_row_id }, 201);
}

// ─── Lead Email Notification (Cloudflare Email Service REST API) ─
// Sends via Cloudflare's Email Service REST API. The send_email BINDING is NOT
// supported on Pages Functions (only Workers), and opalradiant.com runs as a
// Pages project — so we call the REST API with a scoped API token instead.
// Setup (all on the Pages project → Settings → Variables and Secrets):
//   CF_ACCOUNT_ID     — your Cloudflare account ID (from any dashboard URL)
//   CF_EMAIL_TOKEN    — secret: API token with "Send Email" permission
//   LEAD_NOTIFY_TO    — recipient(s), comma-separated (e.g. "info@opalradiant.com,rishi@…")
//   LEAD_NOTIFY_FROM  — optional, sender on the onboarded domain
//                       (defaults to "leads@opalradiant.com")
// Domain opalradiant.com must be onboarded in Email Service → Email Sending.
// If any of CF_ACCOUNT_ID / CF_EMAIL_TOKEN / LEAD_NOTIFY_TO is unset, this
// no-ops and the lead is still saved.

async function sendLeadNotification(env, lead) {
  const token = env.CF_EMAIL_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  const to = env.LEAD_NOTIFY_TO;
  if (!token || !account || !to) return; // not configured yet — skip silently

  const from = env.LEAD_NOTIFY_FROM || 'leads@opalradiant.com';
  const recipients = String(to).split(',').map((s) => s.trim()).filter(Boolean);

  const waPhone = /^\d{10}$/.test(lead.phone) ? '91' + lead.phone : lead.phone;
  const branch = lead.location && lead.location !== 'Not specified' ? ` · ${lead.location}` : '';
  const subject = `New lead: ${lead.name} — ${lead.treatment || 'general'}${branch}`;

  const utm = [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ');
  const rows = [
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Treatment', lead.treatment],
    ['Branch', lead.location],
    ['Message', lead.message],
    ['Page', lead.source_page],
    ['Campaign', utm],
  ].filter(([, v]) => v);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tableRows = rows.map(([k, v]) => `<tr><td style="padding:6px 12px;color:#574C3F;font-weight:600;white-space:nowrap">${k}</td><td style="padding:6px 12px;color:#36302A">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px">
    <h2 style="color:#36302A;margin:0 0 12px">New Opal Radiant lead #${lead.id}</h2>
    <table style="border-collapse:collapse;background:#F6F3EC;border-radius:8px;width:100%">${tableRows}</table>
    <p style="margin:16px 0 0">
      <a href="tel:+${esc(waPhone)}" style="background:#36302A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;margin-right:8px">Call ${esc(lead.phone)}</a>
      <a href="https://wa.me/${esc(waPhone)}" style="background:#25D366;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">WhatsApp</a>
    </p>
    <p style="color:#9E8E7E;font-size:12px;margin-top:16px">View all leads at opalradiant.com/dashboard</p>
  </div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nCall: ${lead.phone}  |  WhatsApp: https://wa.me/${waPhone}`;

  // POST to the Cloudflare Email Service REST API. The caller wraps this whole
  // call in try/catch, so any failure here never blocks lead capture.
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: recipients, from, subject, html, text }),
    }
  );
  if (!res.ok) {
    console.error('Cloudflare Email Service send failed:', res.status, await res.text());
  }
}

// ─── Dashboard Auth ─────────────────────────────────────────────

async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  return token === env.DASHBOARD_PASSWORD;
}

// ─── Dashboard: Get Leads ───────────────────────────────────────

async function getLeads(url, env) {
  const status = url.searchParams.get('status') || null;
  const location = url.searchParams.get('location') || null;
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (location) {
    query += ' AND location = ?';
    params.push(location);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  // Count total
  let countQuery = 'SELECT COUNT(*) as total FROM leads WHERE 1=1';
  const countParams = [];
  if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
  if (location) { countQuery += ' AND location = ?'; countParams.push(location); }
  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

  return jsonResponse({
    leads: results.results,
    total: countResult.total,
    page,
    pages: Math.ceil(countResult.total / limit),
  });
}

// ─── Dashboard: Update Lead ────────────────────────────────────

async function updateLead(request, env) {
  const data = await request.json();
  if (!data.id) return jsonResponse({ error: 'Lead ID required' }, 400);

  const fields = [];
  const params = [];

  if (data.status) { fields.push('status = ?'); params.push(data.status); }
  if (data.notes !== undefined) { fields.push('notes = ?'); params.push(data.notes); }

  if (fields.length === 0) return jsonResponse({ error: 'Nothing to update' }, 400);

  fields.push("updated_at = datetime('now')");
  params.push(data.id);

  await env.DB.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).bind(...params).run();
  return jsonResponse({ success: true });
}

// ─── Dashboard: Stats ──────────────────────────────────────────

async function getStats(env) {
  const total = await env.DB.prepare('SELECT COUNT(*) as c FROM leads').first();
  const byStatus = await env.DB.prepare('SELECT status, COUNT(*) as c FROM leads GROUP BY status').all();
  const byLocation = await env.DB.prepare('SELECT location, COUNT(*) as c FROM leads GROUP BY location').all();
  const byTreatment = await env.DB.prepare('SELECT treatment, COUNT(*) as c FROM leads GROUP BY treatment ORDER BY c DESC').all();
  const today = await env.DB.prepare("SELECT COUNT(*) as c FROM leads WHERE date(created_at) = date('now')").first();
  const thisWeek = await env.DB.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-7 days')").first();

  return jsonResponse({
    total: total.c,
    today: today.c,
    this_week: thisWeek.c,
    by_status: byStatus.results,
    by_location: byLocation.results,
    by_treatment: byTreatment.results,
  });
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ─── Dashboard HTML (self-contained) ────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Opal CRM Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Arimo',system-ui,sans-serif;background:#ECE4DA;color:#36302A;min-height:100vh}
.login{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.login__box{background:#F6F3EC;padding:2.5rem;border-radius:12px;box-shadow:0 4px 20px rgba(54,48,42,.1);max-width:400px;width:100%}
.login__box h1{font-family:'Oswald',sans-serif;font-size:1.5rem;margin-bottom:1.5rem;text-align:center}
.login__box input{width:100%;padding:.75rem 1rem;border:1px solid #D4CBC0;border-radius:8px;font-size:1rem;margin-bottom:1rem;background:#fff}
.login__box button{width:100%;padding:.75rem;background:#36302A;color:#F6F3EC;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-family:'Oswald',sans-serif}
.login__box button:hover{background:#574C3F}
.dash{display:none}
.topbar{background:#36302A;color:#F6F3EC;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-family:'Oswald',sans-serif;font-size:1.25rem}
.topbar button{background:none;border:1px solid #B9A590;color:#F6F3EC;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-size:.85rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;padding:1.5rem 2rem}
.stat{background:#F6F3EC;padding:1.25rem;border-radius:10px;text-align:center;box-shadow:0 2px 8px rgba(54,48,42,.06)}
.stat__num{font-family:'Oswald',sans-serif;font-size:2rem;color:#36302A}
.stat__label{font-size:.85rem;color:#574C3F;margin-top:.25rem}
.filters{padding:0 2rem 1rem;display:flex;gap:.75rem;flex-wrap:wrap}
.filters select{padding:.5rem .75rem;border:1px solid #D4CBC0;border-radius:6px;background:#F6F3EC;font-size:.9rem}
.table-wrap{padding:0 2rem 2rem;overflow-x:auto}
table{width:100%;border-collapse:collapse;background:#F6F3EC;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(54,48,42,.06)}
th{background:#36302A;color:#F6F3EC;padding:.75rem 1rem;text-align:left;font-family:'Oswald',sans-serif;font-weight:500;font-size:.85rem;white-space:nowrap}
td{padding:.65rem 1rem;border-bottom:1px solid #E8DFD4;font-size:.85rem;vertical-align:top}
tr:hover td{background:#ECE4DA}
.badge{display:inline-block;padding:.2rem .6rem;border-radius:4px;font-size:.75rem;font-weight:600;text-transform:uppercase}
.badge--new{background:#B9A590;color:#36302A}
.badge--contacted{background:#D4CBC0;color:#36302A}
.badge--booked{background:#36302A;color:#F6F3EC}
.badge--completed{background:#574C3F;color:#F6F3EC}
.badge--lost{background:#9E8E7E;color:#F6F3EC}
.actions select{padding:.3rem .5rem;border:1px solid #D4CBC0;border-radius:4px;font-size:.8rem;background:#fff}
.pagination{padding:1rem 2rem;display:flex;gap:.5rem;justify-content:center}
.pagination button{padding:.4rem .8rem;border:1px solid #D4CBC0;border-radius:6px;background:#F6F3EC;cursor:pointer;font-size:.85rem}
.pagination button.active{background:#36302A;color:#F6F3EC;border-color:#36302A}
.notes-input{width:100%;min-width:120px;padding:.3rem .5rem;border:1px solid #D4CBC0;border-radius:4px;font-size:.8rem}
@media(max-width:768px){.stats{grid-template-columns:repeat(2,1fr);padding:1rem}.table-wrap{padding:0 .5rem 1rem}.filters{padding:0 .5rem 1rem}}
</style>
</head>
<body>

<!-- Login -->
<div class="login" id="loginView">
  <div class="login__box">
    <h1>Opal CRM</h1>
    <input type="password" id="pwd" placeholder="Enter dashboard password" autofocus>
    <button onclick="login()">Sign In</button>
    <p id="loginErr" style="color:#c44;text-align:center;margin-top:.75rem;font-size:.85rem"></p>
  </div>
</div>

<!-- Dashboard -->
<div class="dash" id="dashView">
  <div class="topbar">
    <h1>Opal CRM Dashboard</h1>
    <button onclick="logout()">Sign Out</button>
  </div>

  <div class="stats" id="statsRow"></div>

  <div class="filters">
    <select id="filterStatus" onchange="loadLeads()">
      <option value="">All Status</option>
      <option value="new">New</option>
      <option value="contacted">Contacted</option>
      <option value="booked">Booked</option>
      <option value="completed">Completed</option>
      <option value="lost">Lost</option>
    </select>
    <select id="filterLocation" onchange="loadLeads()">
      <option value="">All Locations</option>
      <option value="powai">Powai</option>
      <option value="wadala">Wadala</option>
      <option value="borivali">Borivali</option>
      <option value="thane">Thane</option>
    </select>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th><th>Date</th><th>Name</th><th>Phone</th><th>Email</th><th>Location</th><th>Treatment</th><th>Page</th><th>Status</th><th>Notes</th>
        </tr>
      </thead>
      <tbody id="leadsBody"></tbody>
    </table>
  </div>
  <div class="pagination" id="pagination"></div>
</div>

<script>
let token = '';
let currentPage = 1;

function api(path, opts = {}) {
  return fetch('/api/dashboard' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) }
  }).then(r => r.json());
}

async function login() {
  token = document.getElementById('pwd').value;
  try {
    const res = await api('/stats');
    if (res.error) throw new Error(res.error);
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('dashView').style.display = 'block';
    renderStats(res);
    loadLeads();
  } catch (e) {
    document.getElementById('loginErr').textContent = 'Invalid password';
    token = '';
  }
}

function logout() {
  token = '';
  document.getElementById('dashView').style.display = 'none';
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('pwd').value = '';
}

document.getElementById('pwd').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });

function renderStats(s) {
  const row = document.getElementById('statsRow');
  const statusMap = {};
  (s.by_status || []).forEach(x => statusMap[x.status] = x.c);
  row.innerHTML = [
    ['Total Leads', s.total],
    ['Today', s.today],
    ['This Week', s.this_week],
    ['New', statusMap.new || 0],
    ['Contacted', statusMap.contacted || 0],
    ['Booked', statusMap.booked || 0],
  ].map(([l, n]) => '<div class="stat"><div class="stat__num">' + n + '</div><div class="stat__label">' + l + '</div></div>').join('');
}

async function loadLeads() {
  const status = document.getElementById('filterStatus').value;
  const location = document.getElementById('filterLocation').value;
  let qs = '?page=' + currentPage;
  if (status) qs += '&status=' + status;
  if (location) qs += '&location=' + location;
  const res = await api('/leads' + qs);
  renderLeads(res.leads || []);
  renderPagination(res.pages || 1);
}

function renderLeads(leads) {
  const body = document.getElementById('leadsBody');
  if (!leads.length) { body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:#574C3F">No leads found</td></tr>'; return; }
  body.innerHTML = leads.map(l => '<tr>' +
    '<td>' + l.id + '</td>' +
    '<td style="white-space:nowrap">' + (l.created_at || '').slice(0, 10) + '</td>' +
    '<td><strong>' + esc(l.name) + '</strong></td>' +
    '<td><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a></td>' +
    '<td>' + esc(l.email || '—') + '</td>' +
    '<td>' + esc(l.location) + '</td>' +
    '<td>' + esc(l.treatment || '—') + '</td>' +
    '<td style="font-size:.78rem;color:#574C3F;max-width:180px;word-break:break-word">' + esc(l.source_page || '—') + '</td>' +
    '<td class="actions"><select onchange="updateStatus(' + l.id + ',this.value)">' +
      ['new','contacted','booked','completed','lost'].map(s => '<option value="' + s + '"' + (s === l.status ? ' selected' : '') + '>' + s + '</option>').join('') +
    '</select></td>' +
    '<td><input class="notes-input" value="' + esc(l.notes || '') + '" onblur="updateNotes(' + l.id + ',this.value)" placeholder="Add note..."></td>' +
  '</tr>').join('');
}

function renderPagination(pages) {
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += '<button class="' + (i === currentPage ? 'active' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
  }
  el.innerHTML = html;
}

function goPage(p) { currentPage = p; loadLeads(); }

async function updateStatus(id, status) {
  await api('/lead', { method: 'POST', body: JSON.stringify({ id, status }) });
  api('/stats').then(renderStats);
}

async function updateNotes(id, notes) {
  await api('/lead', { method: 'POST', body: JSON.stringify({ id, notes }) });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body>
</html>`;
