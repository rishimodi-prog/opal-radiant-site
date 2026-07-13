/* ============================================================
   OPAL RADIANT — Main JavaScript
   Navigation, FAQ accordion, form handling, scroll effects
   ============================================================ */

/* ============================================================
   Enhanced Conversions — SHA-256 hashing for Google Ads
   Exposes window.__opalBuildEnhancedUserData(email, phone, name)
   → Promise<{sha256_email_address?, sha256_phone_number?, address?}|null>
   Falls back to null when crypto.subtle is unavailable (very old browsers).
   ============================================================ */
(function () {
  function sha256Hex(str) {
    if (!str || !window.crypto || !window.crypto.subtle) return Promise.resolve(null);
    var buf = new TextEncoder().encode(str);
    return window.crypto.subtle.digest('SHA-256', buf).then(function (hashBuf) {
      var bytes = new Uint8Array(hashBuf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    });
  }

  function normEmail(v) {
    return String(v || '').trim().toLowerCase();
  }

  // Force Indian phones to E.164 (+91XXXXXXXXXX). Ads matches best on E.164.
  function normPhone(v) {
    var digits = String(v || '').replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.length === 10) return '+91' + digits;                     // 10-digit Indian mobile
    if (digits.length === 11 && digits.charAt(0) === '0') return '+91' + digits.substr(1);
    if (digits.length === 12 && digits.substr(0, 2) === '91') return '+' + digits;
    if (digits.length > 10) return '+' + digits;
    return digits;
  }

  function normName(v) {
    return String(v || '').trim().toLowerCase();
  }

  function splitName(fullName) {
    var parts = normName(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  window.__opalBuildEnhancedUserData = function (email, phone, name) {
    var e = normEmail(email);
    var p = normPhone(phone);
    var n = splitName(name);
    return Promise.all([
      sha256Hex(e),
      sha256Hex(p),
      sha256Hex(n.first),
      sha256Hex(n.last),
    ]).then(function (hashes) {
      var emailHash = hashes[0], phoneHash = hashes[1];
      var firstHash = hashes[2], lastHash = hashes[3];
      // If crypto.subtle isn't available at all we can't do Enhanced Conversions.
      if (!emailHash && !phoneHash && !firstHash && !lastHash) return null;
      var out = {};
      if (emailHash) out.sha256_email_address = emailHash;
      if (phoneHash) out.sha256_phone_number = phoneHash;
      var addr = {};
      if (firstHash) addr.sha256_first_name = firstHash;
      if (lastHash)  addr.sha256_last_name  = lastHash;
      if (firstHash || lastHash) out.address = addr;
      return Object.keys(out).length ? out : null;
    }).catch(function () { return null; });
  };
})();

/* ============================================================
   First-touch attribution
   Keeps campaign and ad click identifiers available when a visitor
   moves from a landing page to the booking form.
   ============================================================ */
(function () {
  var storageKey = 'opal-attribution-v1';
  var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid'];
  var stored = {};

  try {
    stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {};
  } catch (e) {
    stored = {};
  }

  var params = new URLSearchParams(window.location.search);
  keys.forEach(function (key) {
    var value = params.get(key);
    if (value && !stored[key]) stored[key] = value.slice(0, 500);
  });

  if (!stored.landing_page && keys.some(function (key) { return Boolean(stored[key]); })) {
    stored.landing_page = window.location.pathname;
  }

  try {
    sessionStorage.setItem(storageKey, JSON.stringify(stored));
  } catch (e) { /* private mode etc. */ }

  window.__opalAttribution = stored;
})();


document.addEventListener('DOMContentLoaded', () => {

  // --- Mobile Navigation ---
  const toggle = document.querySelector('.nav__toggle');
  const nav = document.querySelector('.nav');
  const overlay = document.querySelector('.nav__overlay');

  if (toggle && nav) {
    const drawerQuery = window.matchMedia('(max-width: 1120px)');
    let closeBtn;

    const setMenuState = (isOpen, returnFocus = false) => {
      const drawerMode = drawerQuery.matches;
      const shouldOpen = drawerMode && isOpen;

      toggle.classList.toggle('active', shouldOpen);
      toggle.setAttribute('aria-expanded', String(shouldOpen));
      nav.classList.toggle('open', shouldOpen);
      if (overlay) overlay.classList.toggle('active', shouldOpen);
      document.body.classList.toggle('drawer-open', shouldOpen);
      document.body.style.overflow = shouldOpen ? 'hidden' : '';

      if (drawerMode) {
        nav.setAttribute('aria-hidden', String(!shouldOpen));
        nav.toggleAttribute('inert', !shouldOpen);
      } else {
        nav.removeAttribute('aria-hidden');
        nav.removeAttribute('inert');
      }

      if (shouldOpen && closeBtn) closeBtn.focus();
      if (!shouldOpen && returnFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => {
      setMenuState(!nav.classList.contains('open'));
    });

    if (overlay) overlay.addEventListener('click', () => setMenuState(false, true));

    // Inject a close button + Book CTA into the mobile drawer once
    if (!nav.querySelector('.nav__close')) {
      closeBtn = document.createElement('button');
      closeBtn.className = 'nav__close';
      closeBtn.setAttribute('aria-label', 'Close menu');
      closeBtn.addEventListener('click', () => setMenuState(false, true));
      nav.prepend(closeBtn);
    } else {
      closeBtn = nav.querySelector('.nav__close');
    }
    if (!nav.querySelector('.nav__cta')) {
      const cta = document.createElement('a');
      cta.href = '/book-appointment.html';
      cta.className = 'btn btn--primary btn--block nav__cta';
      cta.textContent = 'Book Free Appointment';
      cta.style.marginTop = '1rem';
      nav.appendChild(cta);
    }

    // Mobile dropdown toggles
    document.querySelectorAll('.nav__item--has-dropdown > .nav__link').forEach(link => {
      link.addEventListener('click', (e) => {
        if (drawerQuery.matches) {
          e.preventDefault();
          link.parentElement.classList.toggle('open');
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setMenuState(false, true);
      }
    });
    drawerQuery.addEventListener('change', () => setMenuState(false));
    setMenuState(false);
  }


  // --- Header Scroll Effect ---
  const header = document.querySelector('.header');
  if (header) {
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;
      header.classList.toggle('header--scrolled', currentScroll > 50);
      lastScroll = currentScroll;
    }, { passive: true });
  }


  // --- FAQ Accordion ---
  document.querySelectorAll('.faq__question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq__item');
      const isActive = item.classList.contains('active');

      // Close all others in the same section
      const parent = item.closest('.faq') || item.parentElement;
      parent.querySelectorAll('.faq__item').forEach(i => {
        i.classList.remove('active');
      });

      // Toggle current
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });


  // --- Auto-generated site-wide breadcrumb bar ---
  // Removes any hardcoded per-page breadcrumbs, then injects a single sticky
  // bar directly below the header with crumbs derived from the URL path.
  (function initBreadcrumb() {
    const path = window.location.pathname.replace(/\/$/, '');
    // Skip on the home page — no crumbs there.
    if (path === '' || path === '/index.html') return;

    const header = document.querySelector('header.header');
    if (!header) return;

    // Retire any hard-coded breadcrumbs already on the page (nav.breadcrumb).
    document.querySelectorAll('nav.breadcrumb').forEach(el => el.remove());

    // Human-readable label for a URL slug.
    const humanize = (slug) => {
      if (!slug) return '';
      // Strip trailing extension and index.html
      slug = slug.replace(/\.html?$/i, '').replace(/^index$/i, '');
      // Special-case known abbreviations and slugs so casing is correct
      const overrides = {
        'services': 'Treatments',
        'opal-blog': 'Blog',
        'blog': 'Blog',
        'about': 'About',
        'contact': 'Contact',
        'pricing': 'Pricing',
        'faq': 'FAQ',
        'locations': 'Locations',
        'care': 'Pre & Post Care',
        'book-appointment': 'Book Appointment',
        'privacy-policy': 'Privacy Policy',
        'terms': 'Terms of Service',
        'laser-hair-removal-mumbai': 'Laser Hair Removal',
        'hair-prp': 'Hair PRP',
        'hair-fillers': 'Hair Fillers',
        'hifu-face-lift': 'HIFU Face Lift',
        'hifem-body-toning': 'HIFEM Body Toning',
        'jordi-shape': 'Jordi Shape',
        'mnrf': 'MNRF',
        'carbon-laser-facial': 'Carbon Laser Facial',
        'hydra-facial': 'Hydra Facial',
        'chemical-peel': 'Chemical Peel',
        'fat-freeze': 'Fat Freeze',
        'tattoo-removal': 'Tattoo Removal',
      };
      if (overrides[slug]) return overrides[slug];
      // Otherwise Title Case with dashes → spaces
      return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    // Split the URL into crumbs.
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return;

    // Build up crumbs — Home is always first, then progressively-longer paths.
    const crumbs = [{ label: 'Home', href: '/' }];
    let cumulative = '';
    parts.forEach((part, i) => {
      cumulative += '/' + part;
      const label = humanize(part);
      if (!label) return; // skip 'index.html' etc.
      // Last crumb is not a link
      const isLast = i === parts.length - 1;
      crumbs.push({ label, href: isLast ? null : cumulative + '/' });
    });

    if (crumbs.length < 2) return; // nothing to render

    // Build the DOM.
    const bar = document.createElement('nav');
    bar.className = 'breadcrumb-bar';
    bar.setAttribute('aria-label', 'Breadcrumb');
    const inner = document.createElement('div');
    inner.className = 'breadcrumb-bar__inner container';
    const ol = document.createElement('ol');
    ol.className = 'breadcrumb-bar__list';

    crumbs.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'breadcrumb-bar__item';
      if (c.href) {
        const a = document.createElement('a');
        a.href = c.href;
        a.textContent = c.label;
        li.appendChild(a);
      } else {
        li.setAttribute('aria-current', 'page');
        li.textContent = c.label;
      }
      ol.appendChild(li);
    });

    inner.appendChild(ol);
    bar.appendChild(inner);

    // Insert directly after the header.
    header.parentNode.insertBefore(bar, header.nextSibling);

    // Emit BreadcrumbList JSON-LD for SEO.
    const itemList = crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: c.href
        ? (new URL(c.href, location.origin)).toString()
        : (location.origin + path),
    }));
    const jsonld = document.createElement('script');
    jsonld.type = 'application/ld+json';
    jsonld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: itemList,
    });
    document.head.appendChild(jsonld);
  })();


  // --- Smooth Scroll for Anchor Links ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const headerHeight = document.querySelector('.header')?.offsetHeight || 0;
        const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
        window.scrollTo({ top, behavior: 'smooth' });

        // Close mobile nav if open
        if (nav && nav.classList.contains('open')) {
          toggle.classList.remove('active');
          nav.classList.remove('open');
          if (overlay) overlay.classList.remove('active');
          document.body.style.overflow = '';
        }
      }
    });
  });


  // --- Lazy Intersection Observer for Animations ---
  const animateOnScroll = () => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.animate([
            { opacity: 0.35, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], {
            duration: 450,
            easing: 'ease-out',
            fill: 'none'
          });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.card, .feature-card, .testimonial, .step, .location-card, .pricing-card, .blog-card').forEach(el => {
      observer.observe(el);
    });
  };

  animateOnScroll();


  // --- Phone Number Click Tracking (for analytics) ---
  document.querySelectorAll('a[href^="tel:"]').forEach(link => {
    link.addEventListener('click', () => {
      if (typeof gtag !== 'undefined') {
        gtag('event', 'phone_call', {
          event_category: 'contact',
          event_label: link.href.replace('tel:', '')
        });
      }
    });
  });

});

/* ===== Google Reviews ratings (homepage + location pages) ===== */
(function () {
  var gridEl = document.getElementById('ratings-grid');
  var badges = document.querySelectorAll('[data-google-rating]'); // per-location
  if (!gridEl && badges.length === 0) return;

  function starMarkup(rating) {
    if (typeof rating !== 'number') return '';
    var full = Math.floor(rating);
    var half = (rating - full) >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    var out = '';
    for (var i = 0; i < full; i++) out += '★';
    if (half) out += '★'; // treat half as full visually to stay simple
    for (var j = 0; j < empty; j++) out += '<span class="star--empty">★</span>';
    return out;
  }

  function googleG() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
  }

  function render(data) {
    if (!data || !data.branches) return;

    // Homepage grid
    if (gridEl) {
      gridEl.dataset.loading = 'false';
      gridEl.innerHTML = data.branches.map(function (b) {
        if (typeof b.rating !== 'number') {
          return '<div class="rating-card"><div class="rating-card__name">' + b.name + '</div><div class="rating-card__meta">Rating unavailable</div></div>';
        }
        return '<a class="rating-card" href="' + b.mapsUrl + '" target="_blank" rel="noopener noreferrer" aria-label="Read ' + b.reviewCount + ' Google reviews for ' + b.name + ' branch">'
          + '<div class="rating-card__name">' + b.name + '</div>'
          + '<div class="rating-card__score">' + b.rating.toFixed(1) + '</div>'
          + '<div class="rating-card__stars" aria-hidden="true">' + starMarkup(b.rating) + '</div>'
          + '<div class="rating-card__meta">' + b.reviewCount.toLocaleString('en-IN') + ' Google reviews</div>'
          + '<div class="rating-card__google-badge">' + googleG() + ' Google</div>'
          + '<div class="rating-card__cta">Read reviews →</div>'
          + '</a>';
      }).join('');

      // Summary line
      var summaryEl = document.getElementById('ratings-summary');
      if (summaryEl && data.summary && data.summary.averageRating) {
        summaryEl.textContent = data.summary.averageRating.toFixed(1) + ' ★ average across '
          + data.summary.totalReviews.toLocaleString('en-IN') + ' verified reviews on Google';
      }
    }

    // Per-location badges
    if (badges.length > 0) {
      var byKey = {};
      data.branches.forEach(function (b) { byKey[b.key] = b; });
      badges.forEach(function (el) {
        var key = el.getAttribute('data-google-rating');
        var b = byKey[key];
        if (!b || typeof b.rating !== 'number') { el.style.display = 'none'; return; }
        el.setAttribute('href', b.mapsUrl);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
        el.innerHTML = googleG()
          + '<span class="google-rating-badge__score">' + b.rating.toFixed(1) + '</span>'
          + '<span class="google-rating-badge__stars" aria-hidden="true">' + starMarkup(b.rating) + '</span>'
          + '<span class="google-rating-badge__count">(' + b.reviewCount.toLocaleString('en-IN') + ' reviews)</span>';
      });
    }

    // Compact aggregate summary badges (reusable, any page): [data-google-rating-summary]
    var summaryBadges = document.querySelectorAll('[data-google-rating-summary]');
    if (summaryBadges.length && data.summary && data.summary.averageRating) {
      var avg = data.summary.averageRating;
      var total = data.summary.totalReviews;
      // Best-rated branch link as the destination
      var best = data.branches.filter(function (b) { return typeof b.rating === 'number'; })
        .sort(function (a, c) { return c.rating - a.rating; })[0];
      summaryBadges.forEach(function (el) {
        el.style.display = '';
        if (best) {
          el.setAttribute('href', best.mapsUrl);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
        el.innerHTML = googleG()
          + '<span class="rating-summary__stars" aria-hidden="true">' + starMarkup(avg) + '</span>'
          + '<span class="rating-summary__text"><strong>' + avg.toFixed(1) + '</strong> from '
          + total.toLocaleString('en-IN') + '+ Google reviews</span>';
      });
    }
  }

  try {
    var cached = sessionStorage.getItem('opal-reviews-v1');
    if (cached) render(JSON.parse(cached));
  } catch (e) { /* private mode etc. */ }

  var reviewsEndpoint = window.location.hostname.endsWith('.pages.dev')
    ? 'https://opalradiant.com/api/reviews'
    : '/api/reviews';

  fetch(reviewsEndpoint)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      try { sessionStorage.setItem('opal-reviews-v1', JSON.stringify(data)); } catch (e) {}
      render(data);
    })
    .catch(function () { /* leave skeleton */ });
})();

/* ===== Lead form submission → /api/lead (reusable across all forms) =====
   Handles the full booking form (#booking-form) AND any inline lead form
   with class .opal-lead-form on any page. */
(function () {
  var forms = [];
  var mainForm = document.getElementById('booking-form');
  if (mainForm) forms.push(mainForm);
  Array.prototype.forEach.call(document.querySelectorAll('.opal-lead-form'), function (f) {
    if (forms.indexOf(f) === -1) forms.push(f);
  });
  if (!forms.length) return;

  function wire(form) {
    var banner = document.createElement('div');
    banner.className = 'form-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'display:none; padding:1rem 1.25rem; border-radius:8px; margin-bottom:1rem; font-weight:500;';
    form.parentNode.insertBefore(banner, form);

    function showBanner(kind, text) {
      banner.style.display = 'block';
      banner.textContent = text;
      if (kind === 'success') {
        banner.style.background = '#e8f5e9';
        banner.style.color = '#1b5e20';
        banner.style.border = '1px solid #a5d6a7';
      } else {
        banner.style.background = '#ffebee';
        banner.style.color = '#b71c1c';
        banner.style.border = '1px solid #ef9a9a';
      }
      banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var submitBtn = form.querySelector('button[type="submit"]');
      var originalLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
      banner.style.display = 'none';

      var fd = new FormData(form);
      // Treatment/source can come from form fields OR data-attributes (inline forms)
      var treatment = (fd.get('treatment') || form.getAttribute('data-treatment') || '').trim();
      var source = form.getAttribute('data-source')
        || (form.id === 'booking-form' ? 'book-appointment.html' : 'inline-form');

      var payload = {
        name: (fd.get('name') || '').trim(),
        phone: (fd.get('phone') || '').trim(),
        email: (fd.get('email') || '').trim(),
        location: (fd.get('location') || '').trim(),
        treatment: treatment,
        preferred_date: (fd.get('preferred_date') || '').trim(),
        message: (fd.get('message') || '').trim(),
        source: source,
        source_page: window.location.pathname,
        page_url: window.location.href
      };

      var attribution = window.__opalAttribution || {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'landing_page'].forEach(function (key) {
        if (attribution[key]) payload[key] = attribution[key];
      });

      var gaMatch = document.cookie.match(/(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/);
      if (gaMatch) payload.ga_client_id = gaMatch[1];

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; }); })
        .then(function (result) {
          if (result.ok) {
            showBanner('success', 'Thank you! We’ve received your request. Our team will call you within 24 hours to confirm your free consultation.');
            window.__opalLeadSubmitted = true;

            // Snapshot the user data BEFORE we reset() the form so Enhanced
            // Conversions can hash it.
            var rawEmail = (form.querySelector('[name="email"]') || {}).value || '';
            var rawPhone = (form.querySelector('[name="phone"]') || {}).value || '';
            var rawName  = (form.querySelector('[name="name"]')  || {}).value || '';
            form.reset();

            if (typeof gtag !== 'undefined') {
              // The stored CRM lead ID provides stable cross-system deduplication.
              var leadId = result.body && result.body.id;
              var txnId = leadId ? ('lead-' + leadId)
                        : ((window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
                        : ('lead-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)));
              var formId = form.id || form.getAttribute('data-source') || 'inline-lead-form';
              var leadTreatment = payload.treatment || 'general';

              gtag('event', 'generate_lead', {
                form_id: formId,
                treatment: leadTreatment,
                location: payload.location || 'unknown',
                source_page: payload.source_page,
                transaction_id: txnId,
                value: 1,
                currency: 'INR'
              });

              // Google Ads: form-submit conversion, WITH Enhanced Conversions
              // (SHA-256 hashed email/phone/name). Fire after hashing settles;
              // fall back to a raw-value conversion if the browser lacks crypto.subtle.
              window.__opalBuildEnhancedUserData(rawEmail, rawPhone, rawName).then(function (userData) {
                var payload = {
                  send_to: 'AW-18204959421/pDb3CKiOw7ccEL3F5uhD',
                  transaction_id: txnId,
                  value: 1.0,
                  currency: 'INR'
                };
                if (userData) payload.user_data = userData;
                gtag('event', 'conversion', payload);
              });
            }
          } else {
            var msg = (result.body && result.body.error) || 'Something went wrong. Please call us at +91 77030 37070 or WhatsApp us.';
            showBanner('error', msg);
          }
        })
        .catch(function () {
          showBanner('error', 'Network error. Please try again, or reach us on WhatsApp at +91 77030 37070.');
        })
        .then(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
        });
    });
  }

  forms.forEach(wire);
})();

/* ===== Sticky mobile action bar (global, mobile-only) ===== */
(function () {
  // Don't show on the dashboard or the dedicated booking page
  var path = window.location.pathname;
  if (path.indexOf('/dashboard') === 0 || path.indexOf('book-appointment') !== -1) {
    var existingWhatsApp = document.querySelector('.whatsapp-float');
    if (existingWhatsApp && path.indexOf('book-appointment') !== -1) existingWhatsApp.remove();
    return;
  }
  if (document.querySelector('.sticky-cta')) return;

  var bar = document.createElement('div');
  bar.className = 'sticky-cta';
  bar.innerHTML =
    '<a class="sticky-cta__btn sticky-cta__btn--call sticky-cta__btn--icon" href="tel:+917703037070" aria-label="Call Opal Radiant">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
      + '</a>'
    + '<a class="sticky-cta__btn sticky-cta__btn--wa sticky-cta__btn--icon" href="https://wa.me/917703037070?text=Hi%2C%20I%27d%20like%20to%20book%20a%20free%20consultation" target="_blank" rel="noopener" aria-label="WhatsApp Opal Radiant">'
      + '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z"/></svg>'
      + '</a>'
    + '<a class="sticky-cta__btn sticky-cta__btn--book" href="/book-appointment.html">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
      + '<span>Book Free Dr. Appointment</span></a>';
  document.body.appendChild(bar);
  document.body.classList.add('has-sticky-cta');
})();

/* ===== Contact and booking click tracking, site-wide ===== */
(function () {
  var CALL_SEND_TO = 'AW-18204959421/FXBZCL2uwrccEL3F5uhD';
  var WA_SEND_TO   = 'AW-18204959421/-p03CLquwrccEL3F5uhD';

  function placement(a) {
    if (a.classList.contains('sticky-cta__btn')) return 'mobile_sticky_bar';
    if (a.classList.contains('whatsapp-float')) return 'floating_button';
    if (a.closest('.footer')) return 'footer';
    if (a.closest('.header')) return 'header';
    return 'page_content';
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || typeof gtag === 'undefined') return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      gtag('event', 'conversion', { send_to: CALL_SEND_TO });
    } else if (href.indexOf('wa.me') !== -1 || href.indexOf('whatsapp.com') !== -1) {
      gtag('event', 'whatsapp_click', {
        cta_placement: placement(a),
        page_path: window.location.pathname,
        link_url: href
      });
      gtag('event', 'conversion', { send_to: WA_SEND_TO });
    } else if (href.indexOf('book-appointment') !== -1) {
      gtag('event', 'book_appointment_click', {
        cta_placement: placement(a),
        page_path: window.location.pathname,
        link_url: href
      });
    }
  }, true);
})();

/* ===== Enhanced GA4 events — scroll depth, form-abandon signals, sticky-CTA taps =====
   All events are guarded on gtag being present, so they no-op when GA4 isn't loaded. */
(function () {
  if (typeof gtag === 'undefined') {
    // Wait for gtag to be defined by the injected snippet; if it never arrives, do nothing
    var tries = 0;
    var iv = setInterval(function () {
      if (typeof gtag !== 'undefined' || tries++ > 20) { clearInterval(iv); if (typeof gtag !== 'undefined') init(); }
    }, 250);
  } else {
    init();
  }

  function init() {
    /* ---- Scroll depth: fire each milestone once per page ---- */
    var hit = { 25: false, 50: false, 75: false, 90: false };
    function onScroll() {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight
      );
      var winHeight = window.innerHeight || document.documentElement.clientHeight;
      var pct = ((scrollTop + winHeight) / docHeight) * 100;
      [25, 50, 75, 90].forEach(function (m) {
        if (!hit[m] && pct >= m) {
          hit[m] = true;
          gtag('event', 'scroll_depth', {
            percent_scrolled: m,
            page_path: window.location.pathname
          });
        }
      });
    }
    window.addEventListener('scroll', throttle(onScroll, 500), { passive: true });

    /* ---- Form-field focus + abandon: measure where forms lose people ---- */
    var seenFocus = new WeakSet();
    var lastFocused = null;
    var formStarted = false;
    var abandonSent = false;

    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el || !(el.matches('.opal-lead-form input, .opal-lead-form select, .opal-lead-form textarea, #booking-form input, #booking-form select, #booking-form textarea'))) return;
      var form = el.closest('form');
      var formId = form ? (form.id || form.getAttribute('data-source') || 'inline-lead-form') : 'unknown';
      lastFocused = el.name || el.id || 'unknown';

      if (!formStarted) {
        formStarted = true;
        gtag('event', 'form_engaged', { form_id: formId, first_field: lastFocused });
      }
      if (!seenFocus.has(el)) {
        seenFocus.add(el);
        gtag('event', 'form_field_focus', { form_id: formId, field_name: lastFocused });
      }
    });

    // Only fire "abandon" if the user opened a form field, didn't submit, and is leaving
    window.addEventListener('beforeunload', function () {
      if (formStarted && !window.__opalLeadSubmitted && !abandonSent && lastFocused) {
        abandonSent = true;
        gtag('event', 'form_abandon', {
          last_field: lastFocused,
          page_path: window.location.pathname,
          transport_type: 'beacon'
        });
      }
    });

    /* ---- Sticky-CTA click tracking: measure whether the mobile bar earns its keep ---- */
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('.sticky-cta__btn') : null;
      if (!a) return;
      var which = a.classList.contains('sticky-cta__btn--call') ? 'call'
                : a.classList.contains('sticky-cta__btn--wa') ? 'whatsapp'
                : a.classList.contains('sticky-cta__btn--book') ? 'book' : 'unknown';
      gtag('event', 'sticky_cta_click', {
        cta: which,
        page_path: window.location.pathname
      });
    });
  }

  function throttle(fn, wait) {
    var last = 0, timer;
    return function () {
      var now = Date.now();
      var remain = wait - (now - last);
      if (remain <= 0) {
        clearTimeout(timer);
        timer = null;
        last = now;
        fn();
      } else if (!timer) {
        timer = setTimeout(function () { last = Date.now(); timer = null; fn(); }, remain);
      }
    };
  }
})();
