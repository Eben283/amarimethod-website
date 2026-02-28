# Email 2: Why It Keeps Coming Back (+2 days)

## Subject Line
Why your {{contact.primary_pain_location}} pain keeps coming back

## Preview Text
It's not because you're doing something wrong.

---

## Email Body

Hi {{contact.first_name}},

If your {{contact.primary_pain_location}} pain keeps showing up no matter what you try, there's an important reason.

It's not because the treatments failed. It's because they were addressing the symptom — not the pattern behind it.

After {{contact.contactpain_duration}} of dealing with {{contact.primary_pain_location}} pain, your body has built deep compensation patterns. Every time one area struggles, another area picks up the slack. That's your body being intelligent — but it comes at a cost.

If what you've tried so far hasn't provided lasting relief, it's likely because those approaches targeted where it hurts instead of *why* it hurts.

**The difference is the balance equation:**

Your pain exists because some parts of your body are working too hard to make up for other parts that aren't working enough. Until that imbalance is addressed at its source, relief stays temporary.

This is exactly what the Amari Method is designed to solve. Not by chasing symptoms — but by rebalancing the system that's creating them.

Want to understand exactly where your imbalance is and what to do about it?

**[Schedule Your Free 15-Min Discovery Call](https://discoverycall.amarimethod.com/discovery-call-booking)**

— Dr. Garrett

---

## Notes for GHL Implementation
- **Timing:** 2 days after Email 1
- **Merge tags used:**
  - `{{contact.first_name}}` — always populated (required contact field)
  - `{{contact.primary_pain_location}}` — always populated (required quiz question)
  - `{{contact.contactpain_duration}}` — always populated (required quiz question)
- **CTA link:** https://discoverycall.amarimethod.com/discovery-call-booking
- **Word count:** ~195 words
- **Note:** `treatments_tried` was removed from this email because that quiz question is optional/skippable. All remaining merge tags in this email are from required questions and will always have data.

## Field requirements across all emails

| Merge Tag | Required in Quiz? | Used in Emails |
|---|---|---|
| `{{contact.first_name}}` | Yes (contact form) | 1, 2, 3, 4, 5, 6 |
| `{{contact.primary_pain_location}}` | Yes (Q0) | 1, 2, 3, 4, 5, 6 |
| `{{contact.pain_pattern_signature}}` | Yes (calculated) | 1, 3, 4, 6 |
| `{{contact.contactpain_duration}}` | Yes (Q3) | 2 |
| `{{contact.contactpain_trigger}}` | Yes (Q1) | Not used in emails |
| `{{contact.contacttreatments_tried}}` | **No (skippable)** | **None (removed)** |
