# Implementation Plan - Complete Website Rebuild

## Assets Available

### Images in `/images/` folder:
- ✓ Dr. Garrett Professional Photo.avif
- ✓ Justin.png (client testimonial)
- ✓ Maria.png (client testimonial)
- ✓ Sarah.png (client testimonial)
- ✓ AmariLogo.avif
- ✓ Quiz cover image.avif

### Screenshots in `/Old Website screenshots/`:
- Original hero section with video, testimonials row, "Break Free From Pain" section
- "What Makes the Amari Method Different" section with Dr. Garrett photo
- "How It Works - Three Simple Steps"
- "Who we are" section with stats
- "The Journal" section (blog/content section)
- Full-width CTA: "A proven approach to helping you reconnect with your body's wisdom"
- Footer with "Discover What's Really Causing Your Pain" section

### Screenshots in `/About screenshots/`:
- About page header: "Transforming Lives Through Natural Healing"
- Client testimonial with image
- Stats section: "Trusted by thousands on their healing journey" (5000+, 2 decades, 90%)
- "Don't just take our word for it" section

---

## CURRENT REBUILD STATUS (✓ Done)

### ✅ Completed Sections:
1. **Menu Bar** - Sticky, clean, teal CTA
2. **Hero Section** - Video, headline, star rating, CTA
3. **Comparison Section** - 3-column cards (Chiropractors vs Amari vs PT)
4. **FAQ Section** - Clean accordion, first item open

### ⚠️ Sections That Need Work:
1. **First Testimonial Row** - Currently missing proper styling
2. **How It Works** - Structure exists, may need styling tweaks
3. **Credentials/Stats** - Missing Dr. Garrett photo and stat styling
4. **Meet Dr. Garrett** - Missing photo and proper layout
5. **Testimonials Section** - Missing client cards
6. **Journal/Blog Section** - Not implemented
7. **Final CTA** - Exists but verify styling
8. **Footer** - Basic structure, may need refinement

---

## DETAILED IMPLEMENTATION (Step-by-Step)

### STEP 1: Add First Testimonial Row (Right after Comparison)
**Location in HTML:** After "Why Different" comparison section, before "How It Works"
**Visual Reference:** Screenshot 2026-02-13 at 8.57.20 AM.png (top of page shows 3 client headshots)

**What to Add:**
```html
<section class="testimonials-preview">
  <div class="container">
    <div class="testimonials-grid">
      <!-- Justin testimonial card -->
      <div class="testimonial-card">
        <img src="images/Justin.png" alt="Justin" class="testimonial-photo">
        <p class="testimonial-quote">"[Testimonial quote from Justin]"</p>
        <p class="testimonial-name">Justin</p>
        <p class="testimonial-title">[His title/occupation]</p>
        <div class="testimonial-stars">★★★★★</div>
      </div>

      <!-- Maria testimonial card -->
      <div class="testimonial-card">
        <img src="images/Maria.png" alt="Maria" class="testimonial-photo">
        <p class="testimonial-quote">"[Testimonial quote from Maria]"</p>
        <p class="testimonial-name">Maria</p>
        <p class="testimonial-title">[Her title/occupation]</p>
        <div class="testimonial-stars">★★★★★</div>
      </div>

      <!-- Sarah testimonial card -->
      <div class="testimonial-card">
        <img src="images/Sarah.png" alt="Sarah" class="testimonial-photo">
        <p class="testimonial-quote">"[Testimonial quote from Sarah]"</p>
        <p class="testimonial-name">Sarah</p>
        <p class="testimonial-title">[Her title/occupation]</p>
        <div class="testimonial-stars">★★★★★</div>
      </div>
    </div>
  </div>
</section>
```

**CSS to Add:**
```css
.testimonials-preview {
  padding: 6rem 0;
  background: var(--bg-primary);
}

.testimonials-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
}

.testimonial-card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease;
}

.testimonial-card:hover {
  box-shadow: 0 8px 24px rgba(79, 138, 139, 0.1);
  border-color: var(--color-primary);
}

.testimonial-photo {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  margin-bottom: 1rem;
  object-fit: cover;
}

.testimonial-quote {
  font-style: italic;
  color: var(--color-text-light);
  margin-bottom: 1rem;
  line-height: 1.6;
}

.testimonial-name {
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.25rem;
}

.testimonial-title {
  font-size: 0.9rem;
  color: var(--color-text-light);
  margin-bottom: 0.75rem;
}

.testimonial-stars {
  color: var(--color-primary);
  letter-spacing: 2px;
}
```

**What You Need:** Testimonial quotes and titles for Justin, Maria, and Sarah

---

### STEP 2: Enhance How It Works Section
**Location in HTML:** "How It Works - Three Simple Steps" section
**Visual Reference:** Screenshot 2026-02-13 at 8.57.49 AM.png (middle section)

**Current Status:** Structure exists, may need styling verification

**Verify:**
- [ ] Card styling (12px border-radius, 1px border, subtle shadow)
- [ ] Step numbers are large and teal (font-size: 3rem)
- [ ] Step subtitles visible (Awakening/Connection/Freedom)
- [ ] 3-column grid layout on desktop
- [ ] Proper spacing (gap: 2rem)
- [ ] Light background around section

**No new content needed** - Just verify CSS matches design standards

---

### STEP 3: Add Credentials Section with Stats
**Location in HTML:** After "How It Works", before "Meet Dr. Garrett"
**Visual Reference:** Screenshot 2026-02-13 at 8.58.04 AM.png (shows "Who we are" section)

**What to Add:**
```html
<section class="credentials-section">
  <div class="container credentials-grid">
    <!-- Left: Dr. Garrett Photo -->
    <div class="credentials-photo">
      <img src="images/Dr. Garrett Professional Photo.avif" alt="Dr. Garrett Hewstan">
    </div>

    <!-- Right: Content + Stats -->
    <div class="credentials-content">
      <h2>Who we are</h2>
      <p>Dr. Garrett Hewstan has dedicated his career to helping people escape the pain-relief cycle. Unlike franchised clinics, Dr. Garrett personally guides each client's healing journey, combining deep expertise with personalized care.</p>

      <div class="credentials-stats">
        <div class="stat-box">
          <div class="stat-number">200+</div>
          <div class="stat-label">Clients relieved</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">95%</div>
          <div class="stat-label">Satisfaction rate</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">4.9★</div>
          <div class="stat-label">Average rating</div>
        </div>
      </div>
    </div>
  </div>
</section>
```

**CSS Already Exists** - Should be in style.css from previous work:
```css
.credentials-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4rem;
  align-items: center;
}

.credentials-photo img {
  width: 100%;
  border-radius: 8px;
}

.stat-box {
  padding: 2rem;
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease;
}

.stat-number {
  font-size: 3rem;
  font-weight: 700;
  color: var(--color-primary);
  font-family: var(--font-serif-primary);
}

.stat-label {
  font-size: 0.95rem;
  color: var(--color-text);
}
```

**What You Need:**
- [ ] Biographical text about Dr. Garrett (currently in HTML)
- [ ] Confirm Dr. Garrett photo is in correct location
- [ ] Verify stat numbers (200+, 95%, 4.9★)

---

### STEP 4: Add Meet Dr. Garrett Section
**Location in HTML:** After credentials, before testimonials
**Visual Reference:** Screenshot 2026-02-13 at 8.57.49 AM.png (shows practice photo)

**What to Add:**
```html
<section class="amari-method-section">
  <div class="container amari-grid">
    <!-- Left: Dr. Garrett with client photo -->
    <div class="amari-photo">
      <img src="images/Dr-Garrett-with-client.jpg" alt="Dr. Garrett demonstrating method">
    </div>

    <!-- Right: Method explanation -->
    <div class="amari-content">
      <h2>Amari Method</h2>
      <p>A revolutionary, gentle approach designed to create lasting freedom from pain. The Amari Method empowers you with the tools, understanding, and guidance to restore alignment and care for your body — not just temporarily, but for life.</p>
      <a href="about.html" class="amari-link">See What Happens in a Session →</a>
    </div>
  </div>
</section>
```

**CSS:**
```css
.amari-method-section {
  padding: 6rem 0;
  background: var(--bg-primary);
}

.amari-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4rem;
  align-items: center;
}

.amari-photo img {
  width: 100%;
  border-radius: 8px;
}

.amari-content h2 {
  margin-bottom: 1.5rem;
}

.amari-content p {
  line-height: 1.7;
  margin-bottom: 2rem;
}

.amari-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s ease;
}

.amari-link:hover {
  color: var(--color-accent-teal-dark);
}
```

**What You Need:**
- [ ] Dr. Garrett with client demo photo (from original or new)
- [ ] Method explanation text

---

### STEP 5: Add Testimonials Section (Full)
**Location in HTML:** After "Meet Dr. Garrett"
**Visual Reference:** Need to see original testimonials carousel

**What to Add:**
```html
<section class="testimonials-full">
  <div class="container">
    <h2 class="section-title">What Our Clients Say</h2>

    <div class="testimonials-carousel">
      <div class="testimonial-item">
        <div class="testimonial-content">
          <p class="testimonial-quote">"[Full testimonial from client]"</p>
          <div class="testimonial-author">
            <img src="images/Justin.png" alt="Client" class="testimonial-avatar">
            <div>
              <p class="author-name">Justin</p>
              <p class="author-title">[Title]</p>
            </div>
          </div>
          <div class="testimonial-rating">★★★★★</div>
        </div>
      </div>
      <!-- More testimonials -->
    </div>
  </div>
</section>
```

**CSS:**
```css
.testimonials-full {
  padding: 6rem 0;
  background: #f9fbfc;
}

.testimonials-carousel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
}

.testimonial-item {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease;
}

.testimonial-item:hover {
  box-shadow: 0 8px 24px rgba(79, 138, 139, 0.1);
}
```

**What You Need:**
- [ ] Full testimonial quotes (3-4 detailed ones)
- [ ] Client names and titles
- [ ] Star ratings

---

### STEP 6: Add Journal/Blog Section
**Location in HTML:** After testimonials
**Visual Reference:** Screenshot 2026-02-13 at 8.58.04 AM.png (shows "The Journal" with 3 blog cards)

**What to Add:**
```html
<section class="journal-section">
  <div class="container">
    <h2 class="section-title">The Journal</h2>

    <div class="journal-grid">
      <div class="journal-card">
        <img src="images/journal-1.jpg" alt="Blog post 1" class="journal-image">
        <div class="journal-tag">What is Amari</div>
        <h3>The Amari Method: A Gentle Path to Back Pain Relief</h3>
        <p>Discover how a revolutionary approach is changing the way people think about pain relief...</p>
      </div>
      <!-- More journal cards -->
    </div>
  </div>
</section>
```

**CSS:**
```css
.journal-section {
  padding: 6rem 0;
  background: var(--bg-primary);
}

.journal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
}

.journal-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease;
}

.journal-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(79, 138, 139, 0.1);
}

.journal-image {
  width: 100%;
  height: 200px;
  object-fit: cover;
}

.journal-tag {
  display: inline-block;
  background: var(--color-primary);
  color: white;
  padding: 0.25rem 0.75rem;
  margin: 1rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}
```

**What You Need:**
- [ ] 3 blog post titles
- [ ] Blog post summaries
- [ ] Blog post images
- [ ] Tags/categories

---

### STEP 7: Verify Final CTA Section
**Location in HTML:** Before footer
**Visual Reference:** Screenshot 2026-02-13 at 8.58.14 AM.png (shows full-width image with gradient text overlay)

**Already Implemented** - Just verify:
- [ ] Gradient background: 135deg from #4f8a8b to #3d7a7b
- [ ] White text with high contrast
- [ ] Two CTA buttons visible
- [ ] Proper padding (6rem 0)
- [ ] Texture overlay (subtle)

**CSS Should Already Exist:**
```css
.final-cta-section {
  padding: 6rem 0;
  background: linear-gradient(135deg, var(--color-primary) 0%, #3d7a7b 100%);
  color: white;
  text-align: center;
  position: relative;
  overflow: hidden;
}
```

---

### STEP 8: Verify Footer
**Location in HTML:** Last section
**Visual Reference:** Screenshot 2026-02-13 at 8.58.14 AM.png (bottom shows footer)

**Current Status:** May need refinement

**Should Include:**
- [ ] Light gray background (#f9fbfc)
- [ ] Grid layout with columns:
  - Footer brand (logo, tagline, contact)
  - Services
  - About
  - Experience
  - Follow (social icons)
- [ ] Footer bottom with copyright
- [ ] All footer links functional

---

## MISSING CONTENT TO GATHER

### Text Content Needed:
1. **Client Testimonials (Justin, Maria, Sarah):**
   - [ ] Full testimonial quotes
   - [ ] Client titles/occupations
   - [ ] Star ratings (assume 5★)

2. **Amari Method Section:**
   - [ ] Explanation text (you may already have this)
   - [ ] "See What Happens in a Session" link text

3. **Blog/Journal Posts:**
   - [ ] 3 blog post titles
   - [ ] 3 blog post descriptions/summaries
   - [ ] Blog post tags/categories

4. **Services Section (if needed):**
   - [ ] Service names
   - [ ] Service descriptions
   - [ ] Pricing (if applicable)

### Visual Assets Needed:
1. **Client Testimonial Photos:**
   - ✓ Justin.png (have)
   - ✓ Maria.png (have)
   - ✓ Sarah.png (have)

2. **Dr. Garrett Photos:**
   - ✓ Dr. Garrett Professional Photo.avif (have)
   - [ ] Dr. Garrett demonstrating method/with client (optional)

3. **Blog/Journal Images:**
   - [ ] 3 blog post featured images

---

## PRIORITY ORDER FOR IMPLEMENTATION

1. **HIGH PRIORITY** (Critical for professional look):
   - [x] Menu bar
   - [x] Hero section
   - [x] Comparison section
   - [ ] **Testimonial cards** (Step 1)
   - [ ] **Credentials section** (Step 3)

2. **MEDIUM PRIORITY** (Important for completeness):
   - [ ] **How It Works styling** (Step 2 - verify)
   - [ ] **Meet Dr. Garrett** (Step 4)
   - [ ] **Testimonials section** (Step 5)
   - [x] FAQ section

3. **LOWER PRIORITY** (Nice to have):
   - [ ] **Journal/Blog** (Step 6)
   - [ ] Final CTA verification (Step 7)
   - [ ] Footer refinement (Step 8)

---

## NEXT STEPS

1. **Gather Missing Content:**
   - Get testimonial quotes and titles for Justin, Maria, Sarah
   - Get blog post titles and descriptions (if needed)

2. **Implement Sections in Order:**
   - Add testimonial cards row
   - Add credentials section with stats
   - Add Meet Dr. Garrett section
   - Add full testimonials section
   - Add journal/blog section (optional)

3. **Verify Styling:**
   - Make sure all card styling is consistent
   - Verify hover effects work
   - Test responsive design

4. **Final Polish:**
   - Check spacing and alignment
   - Verify all colors match design standards
   - Test on mobile devices

This plan should get your rebuilt website looking as professional as the original Framer design!
