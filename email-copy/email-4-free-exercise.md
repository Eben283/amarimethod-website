# Email 4: A Free Exercise for Your Pain (+6 days)

## GHL Workflow Branching Logic

This email requires IF/ELSE branches in the GHL workflow based on `primary_pain_location`:

```
IF primary_pain_location = "Lower back" OR "Hips"
  → Send Email 4a (Spinal Wave)
ELSE IF primary_pain_location = "Neck" OR "Shoulders" OR "Upper back"
  → Send Email 4b (Power Posture)
ELSE IF primary_pain_location = "Knees" OR "Ankles/Feet"
  → Send Email 4c (Spring Step)
ELSE IF primary_pain_location = "Wrists/Hands" OR "Elbows"
  → Send Email 4d (Hand Balancer)
ELSE (fallback — including "Head" or any unknown value)
  → Send Email 4b (Power Posture — most universally applicable)
```

**Important:** The pain location values come from the quiz and are exactly:
Neck, Shoulders, Upper back, Lower back, Hips, Knees, Ankles/Feet, Wrists/Hands, Elbows

---

## Email 4a: Spinal Wave (Lower back / Hips)

### Subject Line
A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}

### Preview Text
Try this at home today — it takes 2 minutes.

### Email Body

Hi {{contact.first_name}},

I promised you a free exercise for your {{contact.primary_pain_location}} — here it is.

It's called the **Spinal Wave**, and it's one of the first things I teach clients with {{contact.primary_pain_location}} pain. It gently decompresses your spine and helps overworked muscles release the tension patterns that keep pulling you out of alignment.

**How to do it:**
1. Lie on your back with knees bent, feet flat on the floor
2. Starting from your tailbone, slowly roll your spine up one vertebra at a time
3. Pause at the top, then roll back down just as slowly
4. Repeat 5-8 times, breathing deeply with each wave

The key is *slow*. Your body responds to gentle input, not force.

This is a preview of what a full Amari Method session covers — except in a session, every exercise is tailored to your specific {{contact.pain_pattern_signature}} pattern and we address the full chain of compensation, not just one area.

**[Read the Full Spinal Wave Guide](https://www.amarimethod.com/blog-spinal-wave-gentle-decompression)**

Want to go deeper?

**[Schedule Your Free Discovery Call](https://discoverycall.amarimethod.com/discovery-call-booking)**

— Dr. Garrett

---

## Email 4b: Power Posture (Neck / Shoulders / Upper back)

### Subject Line
A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}

### Preview Text
Try this at home today — it takes 2 minutes.

### Email Body

Hi {{contact.first_name}},

I promised you a free exercise for your {{contact.primary_pain_location}} — here it is.

It's called the **Power Posture**, and it's one of the first things I teach clients with {{contact.primary_pain_location}} pain. It reactivates your shoulder blade stabilizers — the muscles that are supposed to support your upper body but have often gone dormant.

**How to do it:**
1. Stand with your back against a wall, feet 6 inches out
2. Press the back of your hands into the wall at shoulder height
3. Slowly slide your arms up the wall (like a snow angel), keeping contact
4. Hold at the top for 3 seconds, then slowly lower
5. Repeat 8-10 times

You should feel your upper back muscles engaging — that's your body relearning proper support.

This is a preview of what a full Amari Method session covers — except in a session, every exercise is tailored to your specific {{contact.pain_pattern_signature}} pattern and we address the full chain of compensation, not just one area.

**[Read the Full Power Posture Guide](https://www.amarimethod.com/blog-power-posture-shoulder-blades)**

Want to go deeper?

**[Schedule Your Free Discovery Call](https://discoverycall.amarimethod.com/discovery-call-booking)**

— Dr. Garrett

---

## Email 4c: Spring Step (Knees / Ankles/Feet)

### Subject Line
A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}

### Preview Text
Try this at home today — it takes 2 minutes.

### Email Body

Hi {{contact.first_name}},

I promised you a free exercise for your {{contact.primary_pain_location}} — here it is.

It's called the **Spring Step**, and it's one of the first things I teach clients with {{contact.primary_pain_location}} pain. It restores the natural spring mechanism in your calf and ankle — the foundation that supports everything above it.

**How to do it:**
1. Stand on the edge of a step with your heels hanging off
2. Slowly lower your heels below the step level (3 seconds down)
3. Rise up onto your toes (2 seconds up)
4. Pause at the top for 1 second
5. Repeat 10-12 times

The slow lowering phase is where the magic happens — it restores your tendons' ability to absorb force properly.

This is a preview of what a full Amari Method session covers — except in a session, every exercise is tailored to your specific {{contact.pain_pattern_signature}} pattern and we address the full chain of compensation, not just one area.

**[Read the Full Spring Step Guide](https://www.amarimethod.com/blog-spring-step-calf-ankle)**

Want to go deeper?

**[Schedule Your Free Discovery Call](https://discoverycall.amarimethod.com/discovery-call-booking)**

— Dr. Garrett

---

## Email 4d: Hand Balancer (Wrists/Hands / Elbows)

### Subject Line
A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}

### Preview Text
Try this at home today — it takes 2 minutes.

### Email Body

Hi {{contact.first_name}},

I promised you a free exercise for your {{contact.primary_pain_location}} — here it is.

It's called the **Hand Balancer**, and it's one of the first things I teach clients with {{contact.primary_pain_location}} pain. It rebalances the muscles in your forearm and hand that get locked in repetitive patterns — especially from typing, gripping, or phone use.

**How to do it:**
1. Extend your arm in front of you, palm facing down
2. Use your other hand to gently press your fingers back (hold 15 seconds)
3. Then flip — palm facing up — and gently press fingers toward the floor (hold 15 seconds)
4. Finish by spreading all fingers wide, then making a tight fist — repeat 10 times

This resets the flexor/extensor balance that gets locked from repetitive use.

This is a preview of what a full Amari Method session covers — except in a session, every exercise is tailored to your specific {{contact.pain_pattern_signature}} pattern and we address the full chain of compensation, not just one area.

**[Read the Full Hand Balancer Guide](https://www.amarimethod.com/blog-hand-balancer-carpal-tunnel)**

Want to go deeper?

**[Schedule Your Free Discovery Call](https://discoverycall.amarimethod.com/discovery-call-booking)**

— Dr. Garrett

---

## Notes for GHL Implementation
- **Timing:** 6 days after Email 1 (2 days after Email 3)
- **Branching:** Requires IF/ELSE in GHL workflow based on `primary_pain_location` custom field
- **Merge tags used (all versions):**
  - `{{contact.first_name}}`
  - `{{contact.primary_pain_location}}`
  - `{{contact.pain_pattern_signature}}`
- **CTA links per version:**
  - 4a: https://www.amarimethod.com/blog-spinal-wave-gentle-decompression
  - 4b: https://www.amarimethod.com/blog-power-posture-shoulder-blades
  - 4c: https://www.amarimethod.com/blog-spring-step-calf-ankle
  - 4d: https://www.amarimethod.com/blog-hand-balancer-carpal-tunnel
- **Discovery call (all):** https://discoverycall.amarimethod.com/discovery-call-booking
- **Word count:** ~180-200 words each
- **Note:** The plan originally included a 4e for "Head" → Jaw Align blog post. If you have that blog post live at `amarimethod.com/blog-jaw-align-tmj-relief`, create a 4e version following the same template. Otherwise, the fallback (Power Posture) works for Head/TMJ since upper body posture contributes to jaw tension.
