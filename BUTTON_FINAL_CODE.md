# WORKING PRIMARY BUTTON CODE

## HTML STRUCTURE (Use This Exactly)

```html
<a href="#services" class="btn-primary">
  <span class="btn-content">
    <span class="arrow">→</span>
    <span class="btn-text">Book Relief Session</span>
  </span>
</a>
```

### Key Points:
- The button uses nested `<span>` elements with specific classes
- `.btn-content` is the container that manages layout
- `.arrow` is the animated arrow character
- `.btn-text` is the text that moves on hover
- Replace `href="#services"` with your actual link
- Replace `Book Relief Session` with your button text

---

## CSS RULES (Add These to css/style.css)

```css
/* PRIMARY BUTTON */
.btn-primary {
  background: #000000;
  color: white;
  display: inline-block;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-family: var(--font-sans-primary);
  font-size: 0.95rem;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
  text-decoration: none;
  position: relative;
  overflow: visible;
  white-space: nowrap;
}

/* BUTTON CONTAINER - CRITICAL: Must be flex */
.btn-content {
  display: flex;
  align-items: center;
}

/* ARROW ANIMATION */
.btn-primary .arrow {
  position: absolute;
  left: 0.75rem;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.btn-primary:hover .arrow {
  opacity: 1;
  left: 1.5rem;
}

/* TEXT ANIMATION */
.btn-text {
  display: inline;
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.btn-primary:hover .btn-text {
  transform: translateX(1.2rem);
}
```

---

## HOW IT WORKS

1. **Default State**: Arrow is hidden (opacity: 0) at position left: 0.75rem
2. **On Hover**:
   - Arrow becomes visible (opacity: 1) and slides right to left: 1.5rem
   - Text simultaneously moves right by 1.2rem via transform
3. **Button Size**: Stays constant - no expanding or shrinking
4. **Layout**: Flex container keeps both elements aligned while allowing the animation

---

## CRITICAL FIX THAT MADE THIS WORK

The `.btn-content { display: flex; align-items: center; }` is the key. This must be **flex, not inline**.

Without flex display, the child transform on `.btn-text` won't display properly. This was the breakthrough after multiple failed attempts.

---

## TESTING CHECKLIST

- [ ] Arrow appears on left side of text (not right)
- [ ] Arrow slides in smoothly from left: 0.75rem to left: 1.5rem
- [ ] Text moves right by ~1.2rem on hover
- [ ] Button container size stays constant (no expanding)
- [ ] Animation is smooth with 0.3s duration
- [ ] Works on all pages (index.html, about.html, booking.html, contact.html, etc.)

---

*Last Updated: 2026-02-14*
*Status: WORKING - Use this as the standard for all primary buttons*
