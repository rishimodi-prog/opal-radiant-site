/* ============================================================
   OPAL RADIANT — Main JavaScript
   Navigation, FAQ accordion, form handling, scroll effects
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // --- Mobile Navigation ---
  const toggle = document.querySelector('.nav__toggle');
  const nav = document.querySelector('.nav');
  const overlay = document.querySelector('.nav__overlay');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      nav.classList.toggle('open');
      if (overlay) overlay.classList.toggle('active');
      document.body.style.overflow = nav.classList.contains('open') ? 'hidden' : '';
    });

    if (overlay) {
      overlay.addEventListener('click', () => {
        toggle.classList.remove('active');
        nav.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      });
    }

    // Mobile dropdown toggles
    document.querySelectorAll('.nav__item--has-dropdown > .nav__link').forEach(link => {
      link.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024) {
          e.preventDefault();
          link.parentElement.classList.toggle('open');
        }
      });
    });
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


  // --- Form Handling ---
  document.querySelectorAll('.contact-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';
      submitBtn.disabled = true;

      // Collect form data
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      // Add source page and UTM params
      data.source_page = window.location.pathname;
      const urlParams = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => {
        if (urlParams.get(k)) data[k] = urlParams.get(k);
      });

      try {
        const CRM_ENDPOINT = 'https://opal-crm.opalradiant.workers.dev/api/lead';
        const response = await fetch(form.action || CRM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (response.ok) {
          // Show success message
          const successDiv = document.createElement('div');
          successDiv.className = 'form-success';
          successDiv.innerHTML = '<strong>Thank you!</strong> We\'ve received your enquiry and will get back to you shortly.';
          form.replaceWith(successDiv);
        } else {
          throw new Error('Submission failed');
        }
      } catch (err) {
        // Show inline error
        let errorEl = form.querySelector('.form-submit-error');
        if (!errorEl) {
          errorEl = document.createElement('div');
          errorEl.className = 'form-error form-submit-error';
          submitBtn.parentElement.appendChild(errorEl);
        }
        errorEl.textContent = 'Something went wrong. Please call us at 7703037070 or try again.';
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  });


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
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.card, .feature-card, .testimonial, .step, .location-card, .pricing-card, .blog-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  };

  // Add CSS for animated elements
  const style = document.createElement('style');
  style.textContent = '.animate-in { opacity: 1 !important; transform: translateY(0) !important; }';
  document.head.appendChild(style);
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
