# WORKING SECONDARY BUTTON CODE

## HTML STRUCTURE (Use This Exactly)

```html
<a href="#discovery" class="btn-secondary">
  <span class="btn-content">
    <span class="arrow">→</span>
    <span class="btn-text">Schedule Free Call</span>
  </span>
</a>
```

### Key Points:
- Same nested structure as primary button (`.btn-content`, `.arrow`, `.btn-text`)
- Use `class="btn-secondary"` instead of `btn-primary`
- White background with black text and black arrow
- Replace `href="#discovery"` with your actual link
- Replace `Schedule Free Call` with your button text

---

## CSS RULES (Add These to css/style.css)

```css
/* SECONDARY BUTTON */
.btn-secondary {
  background: white;
  color: #000000;
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
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* BUTTON CONTAINER - CRITICAL: Must be flex */
.btn-content {
  display: flex;
  align-items: center;
}

/* ARROW ANIMATION */
.btn-secondary .arrow {
  position: absolute;
  left: 0.75rem;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
  color: #000000;
}

.btn-secondary:hover .arrow {
  opacity: 1;
  left: 1.5rem;
}

/* TEXT ANIMATION */
.btn-text {
  display: inline;
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.btn-secondary:hover .btn-text {
  transform: translateX(1.2rem);
}

/* OPTIONAL: Enhanced hover state */
.btn-secondary:hover {
  background: white;
  color: #000000;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}
```

---

## VISUAL DIFFERENCES FROM PRIMARY BUTTON

| Aspect | Primary (Black) | Secondary (White) |
|--------|-----------------|-------------------|
| Background | #000000 (Black) | white |
| Text Color | white | #000000 (Black) |
| Arrow Color | white | #000000 (Black) |
| Shadow | None | 0 4px 12px rgba(0,0,0,0.15) |
| Hover Shadow | None | Enhanced to 0 8px 20px rgba(0,0,0,0.2) |
| Animation | Same (arrow slides, text moves) | Same (arrow slides, text moves) |

---

## HOW IT WORKS

1. **Default State**: Arrow is hidden (opacity: 0) at position left: 0.75rem
2. **On Hover**:
   - Arrow becomes visible (opacity: 1) and slides right to left: 1.5rem
   - Text simultaneously moves right by 1.2rem via transform
   - Shadow deepens (optional enhanced hover state)
3. **Button Size**: Stays constant - no expanding or shrinking
4. **Layout**: Same flex container as primary button

---

## CRITICAL FIX THAT MADE THIS WORK

The `.btn-content { display: flex; align-items: center; }` is essential. This must be **flex, not inline**.

The secondary button uses the exact same layout mechanism as the primary button - only the colors differ.

---

## TESTING CHECKLIST

- [ ] Arrow appears on left side of text (black color on white background)
- [ ] Arrow slides in smoothly from left: 0.75rem to left: 1.5rem
- [ ] Text moves right by ~1.2rem on hover
- [ ] Button container size stays constant (no expanding)
- [ ] White background with black text is clearly visible
- [ ] Shadow is subtle but visible
- [ ] Animation is smooth with 0.3s duration
- [ ] Works alongside primary buttons on same pages

---

## USE CASES

**Use Secondary Button For:**
- Alternative options to primary CTAs
- Less prominent actions
- Contrast against dark backgrounds
- Secondary calls-to-action (e.g., "Schedule Free Call" vs "Book Relief Session")

---

*Last Updated: 2026-02-14*
*Status: WORKING - Use this as the standard for all secondary buttons*
