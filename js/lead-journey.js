/* Opal Radiant — lead journey capture.
 *
 * Records which pages a visitor looked at before submitting a form, so the
 * team can see intent ("came from the laser page, Thane") instead of just
 * "/book-appointment". Purely additive: it records to sessionStorage on every
 * page load and injects the result into the existing /api/lead POST by
 * wrapping fetch, so no existing form or handler code needs to change.
 *
 * Nothing here can block a submission — every step is wrapped, and on any
 * failure the original request goes through untouched.
 */
(function () {
  'use strict';

  var KEY = 'opal-journey-v1';
  var REF_KEY = 'opal-ext-ref-v1';
  var MAX = 8;

  // Longest stems first so "laser-hair-removal" wins before any shorter prefix.
  var SERVICES = [
    ['hifem-body-toning', 'HIFEM Body Toning'],
    ['carbon-laser-facial', 'Carbon Laser Facial'],
    ['laser-hair-removal', 'Laser Hair Removal'],
    ['hifu-face-lift', 'HIFU Face Lift'],
    ['tattoo-removal', 'Tattoo Removal'],
    ['chemical-peel', 'Chemical Peel'],
    ['hydra-facial', 'Hydra Facial'],
    ['jordi-shape', 'Jordi Shape'],
    ['hair-fillers', 'Hair Fillers'],
    ['fat-freeze', 'Fat Freeze'],
    ['hair-prp', 'Hair PRP'],
    ['mnrf', 'MNRF']
  ];

  var BRANCHES = [
    ['borivali', 'Borivali'],
    ['wadala', 'Wadala'],
    ['powai', 'Powai'],
    ['thane', 'Thane']
  ];

  function readJourney() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; }
    catch (e) { return []; }
  }

  function writeJourney(arr) {
    try { sessionStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function currentPath() {
    var p = window.location.pathname || '/';
    p = p.replace(/\.html$/i, '');
    if (p.length > 1) p = p.replace(/\/$/, '');
    return p || '/';
  }

  // Pages that are the form itself — never the answer to "where did they come from".
  function isFormPage(p) {
    return p.indexOf('book-appointment') !== -1 || p === '/contact';
  }

  function record() {
    var path = currentPath();
    var j = readJourney();
    if (!j.length || j[j.length - 1].p !== path) {
      j.push({ p: path, t: String(document.title || '').split('|')[0].trim().slice(0, 90) });
      if (j.length > MAX) j = j.slice(-MAX);
      writeJourney(j);
    }
    try {
      if (!sessionStorage.getItem(REF_KEY)) {
        var r = document.referrer || '';
        if (r && r.indexOf('//' + window.location.hostname) === -1) {
          sessionStorage.setItem(REF_KEY, r.slice(0, 300));
        }
      }
    } catch (e) {}
  }

  // Derive treatment + branch from a /services/... path.
  function parseServicePath(path) {
    if (path.indexOf('/services/') !== 0) return null;
    var slug = path.slice('/services/'.length);
    var out = { treatment: null, branch: null };
    for (var i = 0; i < SERVICES.length; i++) {
      if (slug.indexOf(SERVICES[i][0]) === 0) { out.treatment = SERVICES[i][1]; break; }
    }
    if (!out.treatment) return null;
    for (var k = 0; k < BRANCHES.length; k++) {
      if (slug.indexOf(BRANCHES[k][0]) !== -1) { out.branch = BRANCHES[k][1]; break; }
    }
    return out;
  }

  function parseLocationPath(path) {
    if (path.indexOf('/locations/') !== 0) return null;
    var slug = path.slice('/locations/'.length);
    for (var k = 0; k < BRANCHES.length; k++) {
      if (slug.indexOf(BRANCHES[k][0]) === 0) return { treatment: null, branch: BRANCHES[k][1] };
    }
    return null;
  }

  function context() {
    var j = readJourney();
    var ctx = {
      previous_page: null, previous_title: null, page_journey: null,
      referrer: null, intent_treatment: null, intent_branch: null
    };
    if (!j.length) return ctx;

    // Most recent page that isn't the form itself.
    for (var i = j.length - 1; i >= 0; i--) {
      if (!isFormPage(j[i].p)) { ctx.previous_page = j[i].p; ctx.previous_title = j[i].t || null; break; }
    }

    // Most recent page that reveals a treatment; branch may come from a
    // location page even when the treatment came from elsewhere.
    for (var s = j.length - 1; s >= 0; s--) {
      var hit = parseServicePath(j[s].p);
      if (hit && hit.treatment) {
        ctx.intent_treatment = hit.treatment;
        if (hit.branch) ctx.intent_branch = hit.branch;
        break;
      }
    }
    if (!ctx.intent_branch) {
      for (var b = j.length - 1; b >= 0; b--) {
        var lh = parseLocationPath(j[b].p) || parseServicePath(j[b].p);
        if (lh && lh.branch) { ctx.intent_branch = lh.branch; break; }
      }
    }

    ctx.page_journey = j.map(function (e) { return e.p; }).join(' > ').slice(0, 500);
    try { ctx.referrer = sessionStorage.getItem(REF_KEY) || null; } catch (e) {}
    return ctx;
  }

  // Expose for debugging and for anything else that wants it.
  window.__opalJourney = { read: readJourney, context: context };

  // Inject into the existing lead POST without touching the form handler.
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (url.indexOf('/api/lead') !== -1 && method === 'POST' && init && typeof init.body === 'string') {
          var body = JSON.parse(init.body);
          var ctx = context();
          for (var k in ctx) {
            if (Object.prototype.hasOwnProperty.call(ctx, k) && ctx[k] && !body[k]) body[k] = ctx[k];
          }
          // Only fill treatment/branch on a fresh submission, and only when the
          // visitor did not choose them — never overwrite an explicit answer.
          if (!body.enrich_phone) {
            if (!body.treatment && ctx.intent_treatment) body.treatment = ctx.intent_treatment;
            if (!body.location && ctx.intent_branch) body.location = ctx.intent_branch;
          }
          init = Object.assign({}, init, { body: JSON.stringify(body) });
        }
      } catch (e) { /* never block a submission */ }
      return nativeFetch.call(this, input, init);
    };
  }

  record();
})();
