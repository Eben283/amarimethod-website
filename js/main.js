/* =============================================
   AMARI METHOD - MAIN JAVASCRIPT
   ============================================= */

// Mobile Menu Toggle
document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (menuToggle) {
    menuToggle.addEventListener('click', function() {
      navMenu.classList.toggle('active');
    });

    // Close menu when clicking on a link
    const navLinks = navMenu.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        navMenu.classList.remove('active');
      });
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', function(event) {
    if (!event.target.closest('nav') && navMenu && navMenu.classList.contains('active')) {
      navMenu.classList.remove('active');
    }
  });
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

// Track link clicks for analytics (placeholder)
document.addEventListener('click', function(e) {
  const link = e.target.closest('a[href*="booking"], a[href*="discoverycall"], a[href*="quiz"]');
  if (link && typeof gtag !== 'undefined') {
    gtag('event', 'booking_click', {
      'link_url': link.href,
      'link_text': link.textContent
    });
  }
});

// Google Analytics tracking
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
// Note: Add your GA4 ID in the index.html header:
// <script async src="https://www.googletagmanager.com/gtag/js?id=YOUR_GA4_ID"></script>
