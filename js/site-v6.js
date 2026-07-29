/* ============================================================
   Amari site v6 — shared header + footer + behaviors
   Ported from ops/docs/amari-mockup.js (mockup filenames → real
   URLs) with three additions: working newsletter form, a site
   search overlay behind the header icon, and a mobile menu
   (the mockup hid the nav under 640px with no replacement).
   Usage, at the end of <body>:
     <script src="js/site-v6.js" data-nav="method"></script>
   data-nav marks the current nav item: method | firstvisit |
   sessions | stories | about (omit on the homepage).
   ============================================================ */
(function () {
  var script = document.currentScript;
  var currentNav = (script && script.getAttribute('data-nav')) || '';
  var noShell = !!(script && script.hasAttribute('data-no-shell'));

  var LOGOMARK = '/images/v6/logo-icon.png';

  var NAV_ITEMS = [
    { key: 'method',     label: 'Our Method',  href: '/how-it-works' },
    { key: 'firstvisit', label: 'First Visit', href: '/first-visit' },
    { key: 'stories',    label: 'Stories',     href: '/stories' },
    { key: 'about',      label: 'About',       href: '/about' },
    { key: 'journal',    label: 'Journal',     href: '/blog' }
  ];

  var BOOK_URL = '/#book-assessment';

  /* Search index: every public page. Titles (t) are shown in results.
     Optional aliases (a) catch what visitors actually type — portal,
     buy, HSA, insurance, receipts — without polluting the label. */
  var PAGES = [
    { t: 'Home', u: '/' },
    { t: 'Our Method: How It Works', u: '/how-it-works', a: ['method', 'how it works', 'what is amari'] },
    { t: 'Your First Visit', u: '/first-visit', a: ['first session', 'what to expect', 'new client'] },
    { t: 'Amari Assessment', u: '/#book-assessment', a: ['assessment', 'consultation', 'consult', 'book', 'booking', 'appointment', 'price', 'cost', 'payment'] },
    { t: 'Client Portal', u: '/portal/', a: ['portal', 'client portal', 'login', 'log in', 'sign in', 'account', 'my account', 'dashboard'] },
    { t: 'FAQ', u: '/faq', a: ['insurance', 'hsa', 'fsa', 'receipt', 'receipts', 'superbill', 'billing', 'reimbursement', 'affirm', 'payment plan', 'questions'] },
    { t: 'Client Stories', u: '/stories', a: ['testimonials', 'reviews', 'results'] },
    { t: 'About Garrett', u: '/about', a: ['garrett', 'practitioner', 'who'] },
    { t: 'Conditions We Work With', u: '/conditions', a: ['conditions', 'pain', 'issues'] },
    { t: 'Lower Back Pain', u: '/lower-back-pain-san-francisco' },
    { t: 'Neck Pain', u: '/neck-pain-san-francisco' },
    { t: 'Shoulder Pain', u: '/shoulder-pain-san-francisco' },
    { t: 'Hip Pain', u: '/hip-pain-san-francisco' },
    { t: 'Knee Pain', u: '/knee-pain-san-francisco' },
    { t: 'Sciatica', u: '/sciatica-san-francisco' },
    { t: 'TMJ & Jaw Pain', u: '/tmj-san-francisco', a: ['jaw', 'tmj'] },
    { t: 'Plantar Fasciitis', u: '/plantar-fasciitis-san-francisco', a: ['foot', 'heel'] },
    { t: 'Chronic Pain', u: '/chronic-pain-san-francisco' },
    { t: 'In-Person Sessions', u: '/in-person-sessions', a: ['office', 'in person', 'san francisco'] },
    { t: 'Virtual Sessions', u: '/virtual-sessions', a: ['virtual', 'online session'] },
    { t: 'Ongoing Care', u: '/ongoing-care', a: ['follow up', 'follow-up', 'membership'] },
    { t: 'The Living Practice', u: '/living-practice', a: ['videos', 'home practice', 'program'] },
    { t: 'Partners', u: '/partners', a: ['affiliate', 'refer', 'referral'] },
    { t: 'Contact', u: '/contact', a: ['email', 'phone', 'address', 'location', 'hours'] },
    { t: 'Gift Card Redeem', u: '/gift-card-redeem', a: ['gift card', 'giftcard', 'redeem', 'voucher'] },
    { t: 'Journal', u: '/blog', a: ['blog', 'articles'] },
    { t: 'Back Pain from Sitting', u: '/blog-back-pain-from-sitting' },
    { t: 'Sciatica Relief', u: '/blog-sciatica-relief' },
    { t: 'Tennis Elbow: The Elbow Reset', u: '/blog-elbow-reset-tennis-elbow' },
    { t: 'TMJ Relief: The Jaw Align', u: '/blog-jaw-align-tmj-relief' },
    { t: 'Carpal Tunnel: The Hand Balancer', u: '/blog-hand-balancer-carpal-tunnel' },
    { t: 'The Active Bridge', u: '/blog-active-bridge-strength' },
    { t: 'The Passive Bridge', u: '/blog-passive-bridge-mobility' },
    { t: 'The Power Posture', u: '/blog-power-posture-shoulder-blades' },
    { t: 'Putting It All Together', u: '/blog-putting-it-all-together' },
    { t: 'The Spinal Wave', u: '/blog-spinal-wave-gentle-decompression' },
    { t: 'The Spring Step', u: '/blog-spring-step-calf-ankle' },
    { t: 'Why Stretching Is Not Helping', u: '/blog-stretching-not-helping' },
    { t: 'The Suspension Squat', u: '/blog-suspension-squat-hanging-exercises' },
    { t: 'The Vertical Drop', u: '/blog-vertical-drop-spine-decompression' },
    { t: 'Amari Method vs Physical Therapy', u: '/amari-method-vs-physical-therapy' },
    { t: 'Why Myofascial Release Does Not Last', u: '/blog-why-myofascial-release-doesnt-work' },
    { t: 'Why Your Psoas Tightens Your Back', u: '/blog-why-psoas-tightens-back' }
  ];

  function navLinks() {
    return NAV_ITEMS.map(function (item) {
      var cls = item.key === currentNav ? ' class="current"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + item.label + '</a>';
    }).join('\n    ');
  }

  function headerHTML() {
    return '' +
      '<header class="site on-dark" id="hdr">\n' +
      '  <div class="hdr-row">\n' +
      '    <div class="hdr-utility"><a href="/portal/">Client Portal</a></div>\n' +
      '    <a href="/" class="brand-slot"><span class="wordmark">AMARI</span><img class="logomark" src="' + LOGOMARK + '" alt="Amari"></a>\n' +
      '    <div class="hdr-right">\n' +
      '      <button class="hdr-search" type="button" aria-label="Search the site">' +
      '<svg class="hdr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg></button>\n' +
      '      <a href="' + BOOK_URL + '" class="btn hdr-book">Book Assessment</a>\n' +
      '      <button class="hdr-menu" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '  <nav class="nav-row">\n    ' + navLinks() + '\n  </nav>\n' +
      '  <nav class="mobile-nav" id="mobilenav">\n    ' + navLinks() +
      '\n    <a href="/portal/">Client Portal</a>' +
      '<a href="' + BOOK_URL + '" class="btn">Book Assessment</a>\n  </nav>\n' +
      '</header>';
  }

  function footerHTML() {
    return '' +
      '<footer>\n' +
      '  <div class="wrap">\n' +
      '    <div class="foot-grid">\n' +
      '      <div class="foot-col">\n' +
      '        <h3>What Amari Is</h3>\n' +
      '        <p>The Amari Method helps you end the cycle of needing someone else to fix you. You learn how to work with your own body, so the change belongs to you.</p>\n' +
      '        <div class="links"><a href="/how-it-works">Our Method</a><a href="/about">About Garrett</a></div>\n' +
      '      </div>\n' +
      '      <div class="foot-col">\n' +
      '        <h3>Newsletter</h3>\n' +
      '        <p>Occasional notes on movement, pain, and the practice. No noise.</p>\n' +
      '        <form class="news" id="newsform">\n' +
      '          <input type="email" name="email" required placeholder="Email address" aria-label="Email address">\n' +
      '          <button type="submit">Submit</button>\n' +
      '        </form>\n' +
      '        <p class="news-msg" aria-live="polite"></p>\n' +
      '      </div>\n' +
      '      <div class="foot-col foot-locs">\n' +
      '        <h3>Amari</h3>\n' +
      '        <a href="/contact">Contact</a>\n' +
      '        <a href="' + BOOK_URL + '">Book a $29 Assessment</a>\n' +
      '        <a href="/portal/">Client portal</a>\n' +
      '        <a href="/partners">Partners</a>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '    <div class="foot-bottom">\n' +
      '      <span>Amari © 2026</span>\n' +
      '      <div class="foot-nav">\n' +
      '        <a href="/faq">FAQ</a><a href="/partners">Partners</a><a href="/privacy-policy">Privacy</a><a href="/terms-of-use">Terms</a>\n' +
      '      </div>\n' +
      '      <span>San Francisco, CA</span>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '</footer>';
  }

  function searchHTML() {
    return '' +
      '<div class="search-overlay" id="searchov" hidden>\n' +
      '  <div class="search-panel">\n' +
      '    <div class="search-row">\n' +
      '      <input type="search" id="searchinput" placeholder="Search the site" aria-label="Search the site" autocomplete="off">\n' +
      '      <button class="search-close" type="button" aria-label="Close search">&times;</button>\n' +
      '    </div>\n' +
      '    <div class="search-results" id="searchresults" role="listbox"></div>\n' +
      '  </div>\n' +
      '</div>';
  }

  function initNewsletter() {
    // Wire EVERY newsletter form (footer + the per-article "Like what you're
    // reading?" blocks), not just the footer one.
    document.querySelectorAll('form.news').forEach(function (form) {
      var input = form.querySelector('input[type=email]');
      if (!input) return;
      form.removeAttribute('onsubmit'); // some markup had onsubmit="return false" (dead)
      var msg = form.parentElement.querySelector('.news-msg');
      if (!msg) {
        msg = document.createElement('p');
        msg.className = 'news-msg';
        msg.setAttribute('aria-live', 'polite');
        form.parentElement.appendChild(msg);
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = (input.value || '').trim();
        if (!email) return;
        var btn = form.querySelector('button');
        if (btn) btn.disabled = true;
        fetch('/api/newsletter-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        }).then(function (res) {
          if (!res.ok) throw new Error('bad status ' + res.status);
          return res.json();
        }).then(function () {
          form.hidden = true;
          msg.textContent = 'You’re on the list.';
        }).catch(function () {
          if (btn) btn.disabled = false;
          msg.textContent = 'That didn’t go through. Try again, or write to hello@amarimethod.com.';
        });
      });
    });
  }

  function initSearch() {
    document.body.insertAdjacentHTML('beforeend', searchHTML());
    var overlay = document.getElementById('searchov');
    var input = document.getElementById('searchinput');
    var results = document.getElementById('searchresults');
    var trigger = document.querySelector('.hdr-search');
    if (!trigger) return;

    function open() {
      overlay.hidden = false;
      document.body.classList.add('search-open');
      input.value = '';
      results.innerHTML = '';
      input.focus();
    }
    function close() {
      overlay.hidden = true;
      document.body.classList.remove('search-open');
    }
    function pageMatches(p, query) {
      if (p.t.toLowerCase().indexOf(query) !== -1) return true;
      var aliases = p.a || [];
      for (var i = 0; i < aliases.length; i++) {
        var alias = String(aliases[i]).toLowerCase();
        if (!alias) continue;
        if (alias.indexOf(query) !== -1 || query.indexOf(alias) !== -1) return true;
      }
      return false;
    }

    function render(q) {
      var query = q.trim().toLowerCase();
      if (!query) { results.innerHTML = ''; return; }
      var hits = PAGES.filter(function (p) {
        return pageMatches(p, query);
      }).slice(0, 8);
      if (!hits.length) {
        results.innerHTML = '<p class="search-empty">Nothing on the site matches that. Try a body part, or <a href="/contact">ask us directly</a>.</p>';
        return;
      }
      results.innerHTML = hits.map(function (p) {
        return '<a class="search-hit" href="' + p.u + '">' + p.t + '</a>';
      }).join('');
    }

    trigger.addEventListener('click', open);
    overlay.querySelector('.search-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) close(); });
    input.addEventListener('input', function () { render(input.value); });
  }

  function initMobileMenu() {
    var btn = document.querySelector('.hdr-menu');
    var nav = document.getElementById('mobilenav');
    var hdr = document.getElementById('hdr');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () {
      var open = hdr.classList.toggle('menu-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('menu-open', open);
    });
  }

  function assessmentBookingHTML() {
    return '' +
      '<div class="assessment-booking-modal" id="assessmentBookingModal" hidden>\n' +
      '  <div class="assessment-booking-backdrop" data-assessment-close></div>\n' +
      '  <section class="assessment-booking-panel" role="dialog" aria-modal="true" aria-labelledby="assessmentBookingTitle" tabindex="-1">\n' +
      '    <header class="assessment-booking-head">\n' +
      '      <div><p class="assessment-booking-eyebrow">Amari Assessment</p><p id="assessmentBookingTitle">$29 · 40 minutes · In person</p></div>\n' +
      '      <button type="button" class="assessment-booking-close" data-assessment-close aria-label="Close booking">×</button>\n' +
      '    </header>\n' +
      '    <iframe id="assessmentBookingFrame" title="Book an Amari Assessment" loading="lazy"></iframe>\n' +
      '  </section>\n' +
      '</div>';
  }

  function initAssessmentBooking() {
    if (document.getElementById('assessmentBookingModal')) return;

    document.body.insertAdjacentHTML('beforeend', assessmentBookingHTML());
    var modal = document.getElementById('assessmentBookingModal');
    var panel = modal.querySelector('.assessment-booking-panel');
    var frame = document.getElementById('assessmentBookingFrame');
    // This dedicated static page avoids the legacy /book/initial-in-person
    // redirect, which otherwise reloads the homepage booking modal inside
    // this iframe.
    var bookingFrameUrl = '/assessment-booking?assessment=1&embed=1';
    var lastFocusedElement = null;

    function setHash(open) {
      var url = window.location.pathname + window.location.search + (open ? '#book-assessment' : '');
      window.history.replaceState(null, '', url);
    }
    function open() {
      if (!modal.hidden) return;
      lastFocusedElement = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('assessment-booking-open');
      if (!frame.getAttribute('src')) frame.src = bookingFrameUrl;
      panel.focus();
    }
    function close(options) {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.classList.remove('assessment-booking-open');
      if (!options || options.clearHash !== false) setHash(false);
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
    }
    function isAssessmentLink(anchor) {
      if (!anchor) return false;
      var href = anchor.getAttribute('href') || '';
      return href === '#book-assessment' || href === '/#book-assessment' ||
        href === '/booking' || href === '/booking.html' ||
        href === '#assessment' || href === '/#assessment';
    }
    function validCheckoutUrl(value) {
      try {
        var url = new URL(value);
        return url.origin === 'https://link.amarimethod.com' &&
          url.pathname.indexOf('/payment-link/') === 0;
      } catch (err) {
        return false;
      }
    }
    function sameSiteOrigin(origin) {
      return origin === window.location.origin ||
        origin === 'https://www.amarimethod.com' ||
        origin === 'https://amarimethod.com';
    }

    document.addEventListener('click', function (event) {
      var anchor = event.target.closest('a[href]');
      if (!isAssessmentLink(anchor) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      setHash(true);
      open();
    });
    modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-assessment-close]')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) close();
    });
    window.addEventListener('hashchange', function () {
      if (window.location.hash === '#book-assessment') open();
      else if (!modal.hidden) close({ clearHash: false });
    });
    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (!sameSiteOrigin(event.origin) || event.source !== frame.contentWindow ||
          data.type !== 'amari-assessment-checkout' || !validCheckoutUrl(data.checkoutUrl)) return;
      window.location.assign(data.checkoutUrl);
    });

    if (window.location.hash === '#book-assessment' || window.location.hash === '#assessment') {
      if (window.location.hash === '#assessment') setHash(true);
      open();
    }
  }

  function init() {
    if (!noShell) {
      document.body.insertAdjacentHTML('afterbegin', headerHTML());
      document.body.insertAdjacentHTML('beforeend', footerHTML());
    }

    // Reveal-on-scroll. Fail open: content is visible by default (CSS), and we only
    // opt into the hidden-then-animate state once JS is confirmed running. If anything
    // goes wrong, show everything — a JS hiccup must never hide the pricing.
    try {
      document.documentElement.classList.add('js-reveal');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: .14, rootMargin: '0px 0px -6% 0px' });
      document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
      // Safety net: if a .reveal in the viewport has not been marked visible within
      // 2.5s (observer mis-fire, backgrounded tab), force it in.
      setTimeout(function () {
        document.querySelectorAll('.reveal:not(.in)').forEach(function (el) {
          if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in');
        });
      }, 2500);
    } catch (err) {
      document.documentElement.classList.remove('js-reveal');
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    }

    // Header: white over the dark hero, cream once scrolled past it.
    // Scroll-position based, not an IntersectionObserver ratio: a ratio
    // threshold fails whenever the hero is taller than the viewport
    // (short windows).
    // Treat display:none / zero-height heroes as absent (e.g. /blog?topic=…).
    var hdr = document.getElementById('hdr');
    if (hdr) {
      var hero = document.querySelector('.hero');
      var heroVisible = !!(hero && hero.offsetHeight > 40);
      if (heroVisible) {
        var swapAt = Math.min(140, Math.round(hero.offsetHeight * 0.15));
        var toggleHero = function () {
          if (window.scrollY > swapAt) { hdr.classList.remove('on-dark'); hdr.classList.add('scrolled'); }
          else { hdr.classList.add('on-dark'); hdr.classList.remove('scrolled'); }
        };
        toggleHero();
        window.addEventListener('scroll', toggleHero, { passive: true });
      } else {
        // No dark hero on this page: show the AMARI wordmark at the top on the page's
        // light background, and swap to the compact icon only after scrolling down.
        hdr.classList.remove('on-dark');
        var toggleScrolled = function () {
          if (window.scrollY > 40) { hdr.classList.add('scrolled'); }
          else { hdr.classList.remove('scrolled'); }
        };
        toggleScrolled();
        window.addEventListener('scroll', toggleScrolled, { passive: true });
      }
    }

    initNewsletter();
    if (!noShell) {
      initSearch();
      initMobileMenu();
      // The booking page is embedded inside this modal. Never let an iframe
      // create another copy of the modal inside itself.
      if (window.top === window) initAssessmentBooking();
    }
    initAnalytics();
  }

  /* GA4 engagement events — restored after site-v6 dropped js/main.js.
     Base page_view still comes from the gtag snippet in each page <head>. */
  function initAnalytics() {
    if (typeof window.gtag !== 'function') return;

    document.addEventListener('click', function (e) {
      var el = e.target.closest(
        'a.btn, button.btn, a[href*="/booking"], a[href*="/book/"], a[href*="discoverycall"], a[href*="discovery-call"]'
      );
      if (!el) return;

      var buttonText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      var buttonHref = el.getAttribute('href') || 'internal-link';
      var params = {
        event_category: 'engagement',
        event_label: buttonText,
        button_text: buttonText,
        button_url: buttonHref,
        page_location: window.location.pathname,
        value: 1
      };

      window.gtag('event', 'cta_button_click', params);

      var href = buttonHref.toLowerCase();
      var text = buttonText.toLowerCase();
      if (
        href.indexOf('discoverycall') !== -1 ||
        href.indexOf('discovery-call') !== -1 ||
        text.indexOf('discovery call') !== -1 ||
        text.indexOf('free 15') !== -1 ||
        text.indexOf('15-minute') !== -1 ||
        text.indexOf('15 minute') !== -1
      ) {
        window.gtag('event', 'click_discovery_call', params);
      } else if (
        href.indexOf('/booking') !== -1 ||
        href.indexOf('#assessment') !== -1 ||
        href.indexOf('#book-assessment') !== -1 ||
        href.indexOf('/book/') !== -1 ||
        text.indexOf('assessment') !== -1 ||
        text.indexOf('book session') !== -1 ||
        text.indexOf('book now') !== -1 ||
        text.indexOf('book a session') !== -1
      ) {
        window.gtag('event', 'click_book_assessment', params);
      }
    });

    var scrollDepthTracked = { 25: false, 50: false, 75: false, 100: false };
    var scrollDepthTicking = false;
    function checkScrollDepth() {
      var windowHeight = window.innerHeight;
      var documentHeight = document.documentElement.scrollHeight;
      var scrollTop = window.scrollY;
      var scrollPercent = Math.round(((scrollTop + windowHeight) / documentHeight) * 100);
      [25, 50, 75, 100].forEach(function (milestone) {
        if (scrollPercent >= milestone && !scrollDepthTracked[milestone]) {
          scrollDepthTracked[milestone] = true;
          window.gtag('event', 'scroll_depth', {
            event_category: 'engagement',
            event_label: milestone + '%',
            scroll_depth: milestone + '%'
          });
        }
      });
      if (scrollDepthTracked[100]) {
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

    var pageStartTime = Date.now();
    setInterval(function () {
      var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
      if ([30, 60, 120, 300].indexOf(timeOnPage) !== -1) {
        window.gtag('event', 'page_engagement', {
          event_category: 'engagement',
          event_label: timeOnPage + 's on page',
          engagement_time_msec: timeOnPage * 1000
        });
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
