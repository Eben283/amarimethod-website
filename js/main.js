/* =============================================
   AMARI METHOD - MAIN JAVASCRIPT
   ============================================= */

// Disable browser scroll restoration so pages always start at top
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

// Mobile Menu Toggle
document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      navMenu.classList.toggle('active');
    });

    // Close menu when clicking on a link
    const navLinks = navMenu.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        navMenu.classList.remove('active');
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(event) {
      if (!event.target.closest('nav') && navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
      }
    });
  }
});

// Hide/Show Nav on Scroll
document.addEventListener('DOMContentLoaded', function() {
  let lastScrollTop = 0;
  let ticking = false;
  const nav = document.querySelector('nav');
  const scrollThreshold = 100;

  if (nav) {
    function handleScroll() {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const navMenu = document.querySelector('.nav-menu');
      const isMobileMenuOpen = navMenu && navMenu.classList.contains('active');

      // Don't hide nav when mobile menu is open
      if (isMobileMenuOpen) {
        ticking = false;
        return;
      }

      if (scrollTop > scrollThreshold) {
        if (scrollTop > lastScrollTop) {
          // Scrolling down - hide nav
          nav.style.transform = 'translateY(-100%)';
        } else {
          // Scrolling up - show nav
          nav.style.transform = 'translateY(0)';
        }
      } else {
        // At top of page - always show nav
        nav.style.transform = 'translateY(0)';
      }

      lastScrollTop = scrollTop;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(handleScroll);
        ticking = true;
      }
    }, { passive: true });
  }
});

// FAQ Toggle (legacy .faq-question/.open pattern)
function toggleFAQ(element) {
  const faqItem = element.closest('.faq-item');

  // Close other open FAQs
  const allFaqItems = document.querySelectorAll('.faq-item');
  allFaqItems.forEach(item => {
    if (item !== faqItem) {
      item.classList.remove('open');
    }
  });

  // Toggle current FAQ
  faqItem.classList.toggle('open');
}

// FAQ Accordion (.faq-header/.active pattern — matches homepage)
document.addEventListener('DOMContentLoaded', function() {
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const header = item.querySelector('.faq-header');
    if (!header) return;
    header.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      faqItems.forEach(otherItem => {
        otherItem.classList.remove('active');
      });
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
});

// Counter Animation (homepage about highlights)
document.addEventListener('DOMContentLoaded', function() {
  const highlightNumbers = document.querySelectorAll('.highlight-number');
  if (!highlightNumbers.length) return;

  let hasAnimated = false;

  function animateCounter(element, finalValue) {
    var suffix = '';
    var numericTarget;

    if (finalValue.includes('+')) {
      suffix = '+';
      numericTarget = parseFloat(finalValue.replace('+', ''));
    } else {
      numericTarget = parseFloat(finalValue);
    }

    var isDecimal = finalValue.includes('.');
    var duration = 1800;
    var startTime = Date.now();

    function update() {
      var elapsed = Date.now() - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var easeOutQuart = 1 - Math.pow(1 - progress, 4);
      var currentValue = easeOutQuart * numericTarget;

      if (isDecimal) {
        element.textContent = currentValue.toFixed(1) + suffix;
      } else {
        element.textContent = Math.round(currentValue) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = finalValue;
      }
    }
    update();
  }

  const highlightsSection = document.querySelector('.about-highlights');
  if (highlightsSection) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasAnimated) {
          hasAnimated = true;
          highlightNumbers.forEach(el => {
            animateCounter(el, el.textContent);
          });
        }
      });
    }, { threshold: 0.3 });
    observer.observe(highlightsSection);
  }
});

// Scroll-triggered fade-in animations removed — content is always visible.
// The JS-driven approach of hiding elements with opacity:0 and relying on
// IntersectionObserver to reveal them is fragile and can leave content
// invisible if the observer doesn't fire. CSS animations can be added back
// via CSS-only @media (prefers-reduced-motion: no-preference) if desired.

// Form Handling (if needed for contact forms)
document.addEventListener('DOMContentLoaded', function() {
  const forms = document.querySelectorAll('form');

  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      // Check if form has required fields
      const requiredFields = form.querySelectorAll('[required]');
      let isValid = true;

      requiredFields.forEach(field => {
        if (!field.value.trim()) {
          isValid = false;
          field.classList.add('error');
        } else {
          field.classList.remove('error');
        }
      });

      if (!isValid) {
        e.preventDefault();
        alert('Please fill in all required fields');
      }
    });
  });
});

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// ===== GOOGLE ANALYTICS 4 EVENT TRACKING =====

// 1. Track all CTA button clicks (Book Session, Book Now, etc.)
document.addEventListener('click', function(e) {
  const button = e.target.closest('.btn-primary, .btn-secondary, a[href*="booking"], a[href*="discoverycall"]');
  if (button && typeof gtag !== 'undefined') {
    const buttonText = button.textContent.trim();
    const buttonHref = button.getAttribute('href') || 'internal-link';
    const pageLocation = window.location.pathname;

    const params = {
      'event_category': 'engagement',
      'event_label': buttonText,
      'button_text': buttonText,
      'button_url': buttonHref,
      'page_location': pageLocation,
      'value': 1
    };

    gtag('event', 'cta_button_click', params);

    // Fire named conversion events so they can be marked as Key events in GA4.
    const href = (buttonHref || '').toLowerCase();
    const text = (buttonText || '').toLowerCase();
    if (href.includes('discoverycall') || text.includes('discovery call')) {
      gtag('event', 'click_discovery_call', params);
    } else if (href.includes('booking') || text.includes('book session') || text.includes('book now')) {
      gtag('event', 'click_book_session', params);
    }
  }
});

// 2. Track scroll depth (throttled with rAF to reduce main thread blocking)
let scrollDepthTracked = {
  '25': false,
  '50': false,
  '75': false,
  '100': false
};
let scrollDepthTicking = false;

function checkScrollDepth() {
  if (typeof gtag === 'undefined') return;

  const windowHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const scrollTop = window.scrollY;
  const scrollPercent = Math.round(((scrollTop + windowHeight) / documentHeight) * 100);

  const milestones = [25, 50, 75, 100];
  milestones.forEach(milestone => {
    if (scrollPercent >= milestone && !scrollDepthTracked[String(milestone)]) {
      scrollDepthTracked[String(milestone)] = true;
      gtag('event', 'scroll_depth', {
        'event_category': 'engagement',
        'event_label': milestone + '%',
        'scroll_depth': milestone + '%'
      });
    }
  });

  // Stop listening once all milestones tracked
  if (scrollDepthTracked['100']) {
    window.removeEventListener('scroll', onScrollDepth);
  }
  scrollDepthTicking = false;
}

function onScrollDepth() {
  if (!scrollDepthTicking) {
    scrollDepthTicking = true;
    requestAnimationFrame(checkScrollDepth);
  }
}

window.addEventListener('scroll', onScrollDepth, { passive: true });

// 3. Track time on page (every 30 seconds)
let pageStartTime = Date.now();
setInterval(function() {
  if (typeof gtag !== 'undefined') {
    const timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);

    // Only track significant time milestones (30s, 60s, 120s, 300s)
    if ([30, 60, 120, 300].includes(timeOnPage)) {
      gtag('event', 'page_engagement', {
        'event_category': 'engagement',
        'event_label': `${timeOnPage}s on page`,
        'engagement_time_msec': timeOnPage * 1000
      });
    }
  }
}, 30000);

// 4. Track form interactions
document.addEventListener('focusin', function(e) {
  const form = e.target.closest('form');
  const inputField = e.target.closest('input, textarea, select');

  if (form && inputField && typeof gtag !== 'undefined') {
    gtag('event', 'form_interaction', {
      'event_category': 'engagement',
      'event_label': inputField.name || inputField.type,
      'form_id': form.id || 'unknown'
    });
  }
});

// 5. Track external link clicks
document.addEventListener('click', function(e) {
  const link = e.target.closest('a[target="_blank"], a[href^="http"]');
  if (link && typeof gtag !== 'undefined') {
    // Only track if it's truly external (not amarimethod.com)
    if (!link.href.includes('amarimethod.com')) {
      gtag('event', 'external_link_click', {
        'event_category': 'engagement',
        'event_label': link.href,
        'link_text': link.textContent.trim()
      });
    }
  }
});

// Note: GA4 initialization is in each page's HTML (gtag script loaded there)

// ===== PAIN POINT PARAMETER FORWARDING =====
// Reads ?pain=<type> from current URL and appends it to all outbound booking links.
// This enables GA4 audience segmentation by pain point (e.g., Near-Bookers - Neck Pain).
// Usage: link to amarimethod.com/booking?pain=neck from Instagram, ads, etc.
(function () {
  var params = new URLSearchParams(window.location.search);
  var painType = params.get('pain');
  if (!painType) return;

  // Sanitize: only allow lowercase letters and hyphens
  painType = painType.toLowerCase().replace(/[^a-z\-]/g, '');
  if (!painType) return;

  // Store in sessionStorage so it persists across page navigations on the site
  sessionStorage.setItem('amari_pain_type', painType);

  function appendPainParam() {
    var stored = sessionStorage.getItem('amari_pain_type');
    if (!stored) return;

    // Target all external booking links (GHL funnels and subdomains)
    var bookingLinks = document.querySelectorAll(
      'a[href*="amarimethodbooking.amarimethod.com"],' +
      'a[href*="introsessionvirtual.amarimethod.com"],' +
      'a[href*="discoverycall.amarimethod.com"],' +
      'a[href*="amarimethodfollowup.amarimethod.com"],' +
      'a[href^="/book/discovery-call"],' +
      'a[href^="/book/initial-in-person"],' +
      'a[href^="/book/initial-virtual"],' +
      'a[href^="/book-discovery-call"],' +
      'a[href^="/book-initial-in-person"],' +
      'a[href^="/book-initial-virtual"],' +
      'a[href^="/book-follow-up"]'
    );

    bookingLinks.forEach(function (link) {
      var url = new URL(link.href);
      if (!url.searchParams.has('pain')) {
        url.searchParams.set('pain', stored);
        link.href = url.toString();
      }
    });
  }

  // Run on DOMContentLoaded and also on any dynamic content changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appendPainParam);
  } else {
    appendPainParam();
  }
})();

// On pages without ?pain= param, check sessionStorage from a previous page
(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get('pain')) return; // Already handled above

  var stored = sessionStorage.getItem('amari_pain_type');
  if (!stored) return;

  function appendPainParam() {
    var bookingLinks = document.querySelectorAll(
      'a[href*="amarimethodbooking.amarimethod.com"],' +
      'a[href*="introsessionvirtual.amarimethod.com"],' +
      'a[href*="discoverycall.amarimethod.com"],' +
      'a[href*="amarimethodfollowup.amarimethod.com"],' +
      'a[href^="/book/discovery-call"],' +
      'a[href^="/book/initial-in-person"],' +
      'a[href^="/book/initial-virtual"],' +
      'a[href^="/book-discovery-call"],' +
      'a[href^="/book-initial-in-person"],' +
      'a[href^="/book-initial-virtual"],' +
      'a[href^="/book-follow-up"]'
    );

    bookingLinks.forEach(function (link) {
      var url = new URL(link.href);
      if (!url.searchParams.has('pain')) {
        url.searchParams.set('pain', stored);
        link.href = url.toString();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appendPainParam);
  } else {
    appendPainParam();
  }
})();

// ===== GHL CALENDAR MODAL =====
// Shared modal used by booking.html, virtual-sessions.html, in-person-sessions.html
// Usage: openCalendarModal('CALENDAR_ID', 'Modal Title')
(function () {
  var _modal = null;

  function _build() {
    _modal = document.createElement('div');
    _modal.id = 'cal-modal';
    _modal.style.cssText =
      'display:none;position:fixed;inset:0;z-index:9999;' +
      'background:rgba(0,0,0,0.5);overflow-y:auto;' +
      'padding:2rem 1rem 1rem;box-sizing:border-box;';
    _modal.innerHTML =
      '<div style="background:#fff;border-radius:16px;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.3);' +
        'width:100%;max-width:640px;margin:0 auto;' +
        'overflow-y:auto;max-height:calc(100vh - 3rem);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
          'padding:1rem 1.25rem;border-bottom:1px solid #f0f0f0;' +
          'position:sticky;top:0;background:#fff;z-index:1;">' +
          '<h2 id="cal-modal-title" style="margin:0;' +
            'font-family:var(--font-sans-primary,\'DM Sans\',sans-serif);' +
            'font-size:1rem;font-weight:600;' +
            'color:var(--amari-charcoal,#252525);"></h2>' +
          '<button id="cal-modal-close" aria-label="Close" ' +
            'style="width:32px;height:32px;display:flex;align-items:center;' +
            'justify-content:center;background:none;border:none;cursor:pointer;' +
            'border-radius:8px;font-size:1.1rem;color:#888;line-height:1;">✕</button>' +
        '</div>' +
        '<div id="cal-modal-body"></div>' +
      '</div>';
    document.body.appendChild(_modal);
    _modal.addEventListener('click', function (e) {
      if (e.target === _modal) closeCalendarModal();
    });
    document.getElementById('cal-modal-close').addEventListener('click', closeCalendarModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') closeCalendarModal();
    });
  }

  // Valid GHL calendar IDs (allowlist)
  var VALID_CALENDAR_IDS = [
    'amari-method-initial-session',
    'booking-single-amari-method-followup-session',
    'amari-method-discovery-call',
    'amari-method-free-15-min-discovery-call'
  ];

  window.openCalendarModal = function (calendarId, title) {
    // Validate calendarId against allowlist (alphanumeric + hyphens only as fallback)
    if (!VALID_CALENDAR_IDS.includes(calendarId) && !/^[a-zA-Z0-9\-]+$/.test(calendarId)) {
      console.error('[calendar] Invalid calendar ID:', calendarId);
      return;
    }
    if (!_modal) _build();
    var modalBody = document.getElementById('cal-modal-body');
    document.getElementById('cal-modal-title').textContent = title;
    modalBody.textContent = '';
    var iframe = document.createElement('iframe');
    iframe.src = 'https://link.amarimethod.com/widget/booking/' + encodeURIComponent(calendarId);
    iframe.id = calendarId + '_modal';
    iframe.style.cssText = 'width:100%;border:none;overflow:hidden;min-height:750px;display:block;';
    iframe.scrolling = 'no';
    iframe.title = title;
    modalBody.appendChild(iframe);
    _modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (!document.getElementById('ghl-embed-script')) {
      var s = document.createElement('script');
      s.id = 'ghl-embed-script';
      s.src = 'https://link.amarimethod.com/js/form_embed.js';
      s.type = 'text/javascript';
      document.body.appendChild(s);
    }
  };

  window.closeCalendarModal = function () {
    if (!_modal) return;
    _modal.style.display = 'none';
    document.body.style.overflow = '';
    document.getElementById('cal-modal-body').innerHTML = '';
  };
})();

// Editorial marquee: pause on mobile touch (touchstart/touchend)
(function() {
  var wrapper = document.querySelector('.t-scroll');
  var track = document.querySelector('.t-track');
  if (!wrapper || !track) return;
  var resumeTimer = null;

  wrapper.addEventListener('touchstart', function() {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    track.classList.add('paused');
  }, { passive: true });

  function resumeScroll() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function() {
      track.classList.remove('paused');
    }, 50);
  }

  wrapper.addEventListener('touchend', resumeScroll, { passive: true });
  wrapper.addEventListener('touchcancel', resumeScroll, { passive: true });
})();

// Elbow Reset Study announcement banner — sitewide, dismissible, skips its own pages
(function() {
  var SKIP_PATHS = ['/elbow-study', '/elbow-study.html', '/elbow-study-updates', '/elbow-study-updates.html'];
  var DISMISS_KEY = 'elbowStudyBannerDismissed';

  var path = window.location.pathname.replace(/\/$/, '');
  if (SKIP_PATHS.indexOf(path) !== -1) return;
  if (localStorage.getItem(DISMISS_KEY) === '1') return;

  document.addEventListener('DOMContentLoaded', function() {
    var banner = document.createElement('div');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Elbow Reset Study announcement');
    banner.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:16px',
      'flex-wrap:wrap',
      'padding:10px 44px 10px 16px',
      'position:relative',
      'background:var(--bg-secondary, #F6F3E9)',
      'color:var(--color-text, #252525)',
      'font-family:var(--font-sans-primary, sans-serif)',
      'font-size:14px',
      'text-align:center',
      'border-bottom:1px solid var(--color-border, #F0EADC)'
    ].join(';');

    var text = document.createElement('span');
    text.textContent = 'Tennis elbow? Amari Method is running a free 3-session study for SF players.';

    var link = document.createElement('a');
    link.href = '/elbow-study';
    link.textContent = 'Learn more';
    link.style.cssText = 'color:var(--color-accent-warm, #C56B4E);font-weight:600;text-decoration:underline;white-space:nowrap;';

    var close = document.createElement('button');
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:var(--color-text-muted, #666);padding:4px 8px;';
    close.addEventListener('click', function() {
      banner.remove();
      localStorage.setItem(DISMISS_KEY, '1');
    });

    banner.appendChild(text);
    banner.appendChild(link);
    banner.appendChild(close);
    document.body.insertBefore(banner, document.body.firstChild);
  });
})();

