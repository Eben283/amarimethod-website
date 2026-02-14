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

// FAQ Toggle
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

// 2. Track scroll depth
let scrollDepthTracked = {
  '25': false,
  '50': false,
  '75': false,
  '100': false
};

window.addEventListener('scroll', function() {
  if (typeof gtag === 'undefined') return;

  const windowHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const scrollTop = window.scrollY;

  // Calculate scroll percentage
  const scrollPercent = Math.round(((scrollTop + windowHeight) / documentHeight) * 100);

  // Track milestones
  if (scrollPercent >= 25 && !scrollDepthTracked['25']) {
    scrollDepthTracked['25'] = true;
    gtag('event', 'scroll_depth', {
      'event_category': 'engagement',
      'event_label': '25%',
      'scroll_depth': '25%'
    });
  }

  if (scrollPercent >= 50 && !scrollDepthTracked['50']) {
    scrollDepthTracked['50'] = true;
    gtag('event', 'scroll_depth', {
      'event_category': 'engagement',
      'event_label': '50%',
      'scroll_depth': '50%'
    });
  }

  if (scrollPercent >= 75 && !scrollDepthTracked['75']) {
    scrollDepthTracked['75'] = true;
    gtag('event', 'scroll_depth', {
      'event_category': 'engagement',
      'event_label': '75%',
      'scroll_depth': '75%'
    });
  }

  if (scrollPercent >= 100 && !scrollDepthTracked['100']) {
    scrollDepthTracked['100'] = true;
    gtag('event', 'scroll_depth', {
      'event_category': 'engagement',
      'event_label': '100%',
      'scroll_depth': '100%'
    });
  }
});

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

// Google Analytics initialization (GA4 script is loaded in HTML head)
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
// Note: GA4 measurement ID is configured in each page's HTML head
