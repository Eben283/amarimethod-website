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

  var LOGOMARK = '/images/v6/logo-icon.png';

  var NAV_ITEMS = [
    { key: 'method',     label: 'Our Method',  href: '/how-it-works' },
    { key: 'firstvisit', label: 'First Visit', href: '/first-visit' },
    { key: 'sessions',   label: 'Sessions',    href: '/booking' },
    { key: 'stories',    label: 'Stories',     href: '/stories' },
    { key: 'about',      label: 'About',       href: '/about' }
  ];

  var BOOK_URL = '/book/initial-in-person';
  var CALL_URL = '/book/discovery-call';

  /* Search index: every public page. Titles are what a visitor
     would type, not internal names. */
  var PAGES = [
    { t: 'Home', u: '/' },
    { t: 'Our Method: How It Works', u: '/how-it-works' },
    { t: 'Your First Visit', u: '/first-visit' },
    { t: 'Sessions & Pricing', u: '/booking' },
    { t: 'Client Stories', u: '/stories' },
    { t: 'About Garrett', u: '/about' },
    { t: 'Book a Session', u: '/book/initial-in-person' },
    { t: 'Book a Virtual Session', u: '/book/initial-virtual' },
    { t: 'Free 15-Minute Call', u: '/book/discovery-call' },
    { t: 'Conditions We Work With', u: '/conditions' },
    { t: 'Lower Back Pain', u: '/lower-back-pain-san-francisco' },
    { t: 'Neck Pain', u: '/neck-pain-san-francisco' },
    { t: 'Shoulder Pain', u: '/shoulder-pain-san-francisco' },
    { t: 'Hip Pain', u: '/hip-pain-san-francisco' },
    { t: 'Knee Pain', u: '/knee-pain-san-francisco' },
    { t: 'Sciatica', u: '/sciatica-san-francisco' },
    { t: 'TMJ & Jaw Pain', u: '/tmj-san-francisco' },
    { t: 'Plantar Fasciitis', u: '/plantar-fasciitis-san-francisco' },
    { t: 'Chronic Pain', u: '/chronic-pain-san-francisco' },
    { t: 'In-Person Sessions', u: '/in-person-sessions' },
    { t: 'Virtual Sessions', u: '/virtual-sessions' },
    { t: 'Ongoing Care', u: '/ongoing-care' },
    { t: 'The Living Practice', u: '/living-practice' },
    { t: 'Partners', u: '/partners' },
    { t: 'Contact', u: '/contact' },
    { t: 'Journal', u: '/blog' },
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
      '    <div class="hdr-utility"><a href="/blog">Journal</a><a href="/booking">Pricing</a><a href="/portal/">Client Portal</a></div>\n' +
      '    <a href="/" class="brand-slot"><span class="wordmark">AMARI</span><img class="logomark" src="' + LOGOMARK + '" alt="Amari"></a>\n' +
      '    <div class="hdr-right">\n' +
      '      <button class="hdr-search" type="button" aria-label="Search the site">' +
      '<svg class="hdr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg></button>\n' +
      '      <a href="' + BOOK_URL + '" class="btn hdr-book">Book Now</a>\n' +
      '      <button class="hdr-menu" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '  <nav class="nav-row">\n    ' + navLinks() + '\n  </nav>\n' +
      '  <nav class="mobile-nav" id="mobilenav">\n    ' + navLinks() +
      '\n    <a href="/blog">Journal</a><a href="/contact">Contact</a><a href="/portal/">Client Portal</a>' +
      '<a href="' + BOOK_URL + '" class="btn">Book Now</a>\n  </nav>\n' +
      '</header>';
  }

  function footerHTML() {
    return '' +
      '<footer>\n' +
      '  <div class="wrap">\n' +
      '    <div class="foot-grid">\n' +
      '      <div class="foot-col">\n' +
      '        <h3>Our Philosophy</h3>\n' +
      '        <p>Only your body can heal you. The Amari Method teaches it how, so you need the table less over time, not more.</p>\n' +
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
      '        <a href="/contact">San Francisco, CA</a>\n' +
      '        <a href="' + BOOK_URL + '">Book a session</a>\n' +
      '        <a href="' + CALL_URL + '">Free 15-minute call</a>\n' +
      '        <a href="/portal/">Client portal</a>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '    <div class="foot-bottom">\n' +
      '      <span>Amari © 2026</span>\n' +
      '      <div class="foot-nav">\n' +
      '        <a href="/contact">Contact</a><a href="/faq">FAQ</a><a href="/booking">Pricing</a><a href="/stories">Stories</a><a href="/partners">Partners</a><a href="/partner-app">Partner Toolkit</a><a href="/refer">Submit a Referral</a><a href="/privacy-policy">Privacy</a><a href="/terms-of-use">Terms</a>\n' +
      '      </div>\n' +
      '      <span>San Francisco</span>\n' +
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
    function render(q) {
      var query = q.trim().toLowerCase();
      if (!query) { results.innerHTML = ''; return; }
      var hits = PAGES.filter(function (p) {
        return p.t.toLowerCase().indexOf(query) !== -1;
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

  // Elbow Reset Study announcement banner — ported verbatim from js/main.js
  // (live-site copy). Sitewide, dismissible, skips the study's own pages.
  // The v6 header is absolutely positioned at top:0, so the banner height is
  // published as --banner-h and the header offsets below it (css site-v6).
  function initStudyBanner() {
    var SKIP_PATHS = ['/elbow-study', '/elbow-study.html', '/elbow-study-updates', '/elbow-study-updates.html'];
    var DISMISS_KEY = 'elbowStudyBannerDismissed';

    var path = window.location.pathname.replace(/\/$/, '');
    if (SKIP_PATHS.indexOf(path) !== -1) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

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
      'z-index:50',
      'background:#252525',
      'color:rgba(255,255,255,.92)',
      'font-family:var(--sans, sans-serif)',
      'font-size:14px',
      'text-align:center'
    ].join(';');

    var text = document.createElement('span');
    text.textContent = 'Tennis elbow? Amari Method is running a free 3-session study for SF players.';

    var link = document.createElement('a');
    link.href = '/elbow-study';
    link.textContent = 'Learn more';
    link.style.cssText = 'color:#EBA584;font-weight:600;text-decoration:underline;white-space:nowrap;';

    var close = document.createElement('button');
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:rgba(255,255,255,.7);padding:4px 8px;';
    close.addEventListener('click', function () {
      banner.remove();
      document.documentElement.style.removeProperty('--banner-h');
      localStorage.setItem(DISMISS_KEY, '1');
    });

    banner.appendChild(text);
    banner.appendChild(link);
    banner.appendChild(close);
    document.body.insertBefore(banner, document.body.firstChild);
    document.documentElement.style.setProperty('--banner-h', banner.offsetHeight + 'px');
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

  function init() {
    document.body.insertAdjacentHTML('afterbegin', headerHTML());
    document.body.insertAdjacentHTML('beforeend', footerHTML());

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
    // (short windows, and any page once the study banner adds height).
    var hdr = document.getElementById('hdr');
    var hero = document.querySelector('.hero');
    if (hero) {
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

    initStudyBanner();
    initNewsletter();
    initSearch();
    initMobileMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
