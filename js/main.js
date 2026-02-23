/* =============================================
   AMARI METHOD - MAIN JAVASCRIPT
   ============================================= */

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
    const is200Plus = element.textContent.includes('200');
    const target = is200Plus ? 200 : (finalValue === '25+' ? 25 : 1);
    const duration = 1800;
    const startTime = Date.now();

    function update() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.round(easeOutQuart * target);

      if (is200Plus) {
        element.textContent = currentValue + '+';
      } else if (finalValue === '25+') {
        element.textContent = currentValue + '+';
      } else {
        element.textContent = currentValue;
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

    gtag('event', 'cta_button_click', {
      'event_category': 'engagement',
      'event_label': buttonText,
      'button_text': buttonText,
      'button_url': buttonHref,
      'page_location': pageLocation,
      'value': 1
    });
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
