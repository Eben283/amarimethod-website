# PRIMARY BUTTON SPECIFICATION
## LOCKED STANDARD - DO NOT DEVIATE

This is the definitive specification for the Amari Method primary button. Every button across the entire website must follow this standard exactly.

---

## HTML MARKUP (REQUIRED)

```html
<a href="#DESTINATION" class="btn-primary"><span>BUTTON TEXT</span></a>
```

### Rules:
- **Tag**: Must be an `<a>` tag (anchor link) OR `<button>` tag
- **Class**: MUST be `class="btn-primary"` (exactly this, nothing else unless specified)
- **Structure**: Text must be wrapped in `<span></span>` tags
- **No additional classes** unless explicitly needed (e.g., `.btn-outline` for outline variant)

### Examples:
```html
<!-- CORRECT -->
<a href="#services" class="btn-primary"><span>Book Relief Session</span></a>

<!-- CORRECT (button tag variant) -->
<button class="btn-primary"><span>Start Your Assessment</span></button>

<!-- CORRECT (outline variant) -->
<a href="virtual-sessions" class="btn-primary btn-outline"><span>Learn More</span></a>

<!-- WRONG - Do not use these variations -->
<a href="#services" class="btn btn-primary"><span>Book</span></a>
<button class="btn-primary btn-block"><span>Book</span></button>
```

---

## CSS STYLING (LOCKED IN style.css)

### Default State
```css
.btn-primary {
  background: #000000;                         /* Black background */
  color: white;                                /* White text */
  display: inline-block;                       /* Inline-block display */
  padding: 0.75rem 1.5rem;                    /* 12px vertical, 24px horizontal */
  border: none;                                /* No border */
  border-radius: 4px;                         /* Slight corner radius */
  font-family: var(--font-sans-primary);      /* System sans-serif */
  font-size: 0.95rem;                         /* 15.2px */
  font-weight: 600;                           /* Semi-bold */
  cursor: pointer;                             /* Pointer cursor on hover */
  transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);  /* Smooth transitions */
  text-decoration: none;                       /* No underline */
  position: relative;                          /* For arrow positioning */
  overflow: hidden;                            /* Clip arrow animation */
}
```

### Hover State (ARROW ANIMATION)
```css
.btn-primary:hover {
  background: #000000;                        /* Black stays black */
  color: white;                               /* White stays white */
}

.btn-primary::after {
  content: ' →';
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
  display: inline-block;
  transform: translateX(-20px);               /* Arrow hidden left */
  opacity: 0;
}

.btn-primary:hover::after {
  transform: translateX(0);                   /* Arrow slides in */
  opacity: 1;
}
```

### Key Animation Details:
- **Arrow Animation**: Arrow slides in from the left on hover
- **Background**: Black button, stays black on hover (no color change)
- **Text**: White text, stays white on hover (no color change)
- **Duration**: 0.3s smooth cubic-bezier easing
- **Arrow**: Slides in from left using `transform: translateX(-20px)` to `translateX(0)`

---

## COLOR TOKENS

```
--color-primary: #2d5a5f (Teal)
--color-accent-teal-dark: Darker shade of teal (on hover)
```

**Note**: These are CSS variables defined in `css/style.css`. Never hardcode colors.

---

## BUTTON VARIANTS

### Outline Button
For secondary calls-to-action where you want a button that stands out less:
```html
<a href="virtual-sessions" class="btn-primary btn-outline"><span>Learn More</span></a>
```

### Block Button (Full Width)
For forms and contained spaces:
```html
<button type="submit" class="btn-primary btn-block"><span>Send Message</span></button>
```

### Combined
```html
<button class="btn-primary btn-block" type="submit"><span>Send</span></button>
```

---

## SECONDARY BUTTON (For Reference Only)

Do NOT use `.btn-secondary` when `.btn-primary` is appropriate.

```html
<a href="#" class="btn-secondary"><span>Schedule Free Call</span></a>
```

**Secondary Button Properties:**
- Background: White
- Text Color: Black
- Used for: Alternative/secondary actions
- Hover: White stays white, black stays black, arrow slides in from the left

**Styling:**
```css
.btn-secondary {
  background: white;
  color: #000000;
  font-weight: 600;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  position: relative;
  overflow: hidden;
}

.btn-secondary::after {
  content: ' →';
  transition: transform 0.3s ease;
  display: inline-block;
  transform: translateX(-20px);
  opacity: 0;
}

.btn-secondary:hover::after {
  transform: translateX(0);
  opacity: 1;
}

.btn-secondary:hover {
  background: white;
  color: #000000;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}
```

---

## TERTIARY BUTTON (Text with Arrow)

For subtle, text-based navigation links that look like bold text with an arrow.

```html
<a href="ongoing-care" class="btn-tertiary">Explore ongoing care</a>
```

**Tertiary Button Properties:**
- Background: None (transparent)
- Text Color: Dark text (`var(--text-dark)`)
- Font Weight: 600 (semi-bold)
- Arrow: Automatically appended via CSS `::after` content " →"
- Hover Effect: Arrow slides right 3px with smooth animation
- Use Case: Subtle next-step navigation, "Learn more" links, secondary CTAs

**Styling:**
```css
.btn-tertiary {
  color: var(--text-dark);
  font-weight: 600;
  text-decoration: none;
  display: inline-block;
  transition: all 0.3s ease;
  position: relative;
}

.btn-tertiary::after {
  content: ' →';
  transition: transform 0.3s ease;
  display: inline-block;
}

.btn-tertiary:hover::after {
  transform: translateX(3px);
}

.btn-tertiary:hover {
  color: var(--color-primary);
}
```

---

## USAGE LOCATIONS

✅ **Use Primary Button (Black) For:**
- Main CTAs (Book Relief Session, Learn More, Get Started)
- Hero section buttons
- Section call-to-action buttons
- Form submission buttons
- Navigation "Book Session" button

✅ **Use Secondary Button (White) For:**
- Alternative options (Schedule Free Call)
- Less prominent CTAs
- Contrast against dark backgrounds

✅ **Use Tertiary Button (Text with Arrow) For:**
- Subtle next-step navigation
- "Learn more" or "Explore" links
- Secondary CTAs within content sections

---

## DO NOT DEVIATE

The following are FORBIDDEN:
- ❌ Custom inline styles on buttons
- ❌ Different classes than `.btn-primary`
- ❌ Text without `<span>` wrapper
- ❌ Hardcoded colors instead of CSS variables
- ❌ Different padding or sizing
- ❌ Removing the hover animation
- ❌ Adding borders or outlines (unless `.btn-outline`)
- ❌ Changing font weight or size
- ❌ Using `<div>` or `<span>` as buttons

---

## IMPLEMENTATION CHECKLIST

When adding or updating ANY button on the site:

- [ ] Is the HTML tag `<a>` or `<button>`?
- [ ] Is the class EXACTLY `class="btn-primary"`?
- [ ] Is the text wrapped in `<span></span>`?
- [ ] No extra classes (unless `.btn-outline` or `.btn-block`)?
- [ ] No inline styles?
- [ ] No hardcoded colors?
- [ ] Does it have a valid `href` or `onclick`?

---

## SUMMARY

### Primary Button
**HTML**: `<a href="#" class="btn-primary"><span>Text</span></a>`
**Colors**: Black background, white text
**Animation**: Arrow slides in from left on hover (background and text stay same)

### Secondary Button
**HTML**: `<a href="#" class="btn-secondary"><span>Text</span></a>`
**Colors**: White background, black text
**Animation**: Arrow slides in from left on hover (background and text stay same)

### Tertiary Button
**HTML**: `<a href="#" class="btn-tertiary">Text</a>`
**Colors**: Transparent, dark text
**Animation**: Arrow slides right on hover, text changes to teal

**Golden Rule**: If it's not one of these three exact types, it's wrong.

---

*Last Updated: 2026-02-13*
*Status: LOCKED - NO CHANGES WITHOUT EXPLICIT APPROVAL*
