// Per-pain-location content for the quiz results page.
//
// Source of truth: amari/content/condition-page-copy-{location}.md
// (Garrett-approved copy already shipped on the live condition pages).
// Lifted here so the quiz result reads as one coherent story with the
// rest of the site instead of an abstract psychometric label.
//
// Q0 (pain location) options from QuizStack.tsx:
//   Neck, Shoulders, Upper back, Lower back, Hips, Knees,
//   Ankles/Feet, Wrists/Hands, Elbows
//
// 5 of those have full Garrett-approved condition copy. The other 4
// fall back to a generic block that doesn't fake specificity.

export type WhyCard = {
  num: string;
  title: string;
  body: string;
};

export type ChainStep = {
  num: string;
  flow: string;          // e.g., "PELVIS → POSITION"
  title: string;
  body: string;
};

export type ProtocolIntro = {
  /** Protocol name as Garrett refers to it, e.g., "Spinal Wave" */
  name: string;
  /** A real Garrett quote pulled from the intro transcript — sets tone */
  framingLine: string;
  /** Direct video URL — currently filesafe.space (GHL/groups.amarimethod.com asset CDN) */
  introVideoUrl: string;
  /** Approximate runtime, shown to the visitor so they know what they're committing to */
  durationLabel: string;
};

export type MatchedTestimonial = {
  quote: string;
  name: string;        // real first name (per site-wide convention)
  attribution: string; // short tag like "Lower back relief" or "Photographer"
};

export type ConditionContent = {
  /** Display label, e.g., "Lower Back Pain" */
  displayName: string;
  /** Slug used to link to the live condition page on amarimethod.com */
  conditionPageSlug: string | null;
  /** Section heading: "Why your X keeps hurting" */
  whyHeading: string;
  /** Subline under the heading */
  whySubline: string;
  /** 3 cards — pattern, prior-treatment failure mode, root-cause framing */
  whyCards: WhyCard[];
  /** Section heading: "Where X actually comes from" */
  chainHeading: string;
  chainSubline: string;
  /** 3 or 4 cards — the postural chain that produces this pain */
  chainSteps: ChainStep[];
  /** Protocol intro to play between the why-cards and the chain explanation.
   *  Maps to the same protocol the GHL email sequence later sends.
   *  Mapping (Option B, agreed 2026-05-04):
   *    Lower back / Hips      → Spinal Wave
   *    Neck / Shoulders / Up. → Power Posture
   *    Knees / Ankles/Feet    → Spring Step
   *    Wrists/Hands           → Hand Balancer
   *    Elbows                 → Elbow Reset (the only divergence from GHL —
   *                              GHL workflow needs a matching split). */
  protocolIntro?: ProtocolIntro;
  /** Pain-location-matched testimonial used in the booking CTA below.
   *  Replaces the old hardcoded "Sarah, San Francisco" back-pain quote
   *  that was showing for every visitor regardless of where their pain was. */
  matchedTestimonial?: MatchedTestimonial;
};

// ─── LOWER BACK ──────────────────────────────────────────────────────
const lowerBack: ConditionContent = {
  displayName: 'Lower Back Pain',
  conditionPageSlug: 'lower-back-pain-san-francisco',
  whyHeading: 'Why your lower back keeps hurting',
  whySubline: "The back is where the pain lives. But it's rarely where the problem starts.",
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: 'Your lower back is absorbing force that should be distributed across your pelvis and hips. When parts of your body stop doing their job, other parts overwork to compensate. That overwork becomes tightness, compression, and eventually pain.',
    },
    {
      num: '02',
      title: "Why stretching and strengthening haven't worked",
      body: 'If the areas creating the problem are still out of balance, strengthening and stretching can actually reinforce the pattern. You end up with a stronger version of the same compensation. The pain keeps coming back because the root cause hasn\'t changed.',
    },
    {
      num: '03',
      title: 'Why temporary relief stays temporary',
      body: "Adjustments, injections, and massage can provide real relief. But if nothing changes the mechanical pattern loading your spine, the relief fades. The Amari Method finds both ends of the problem at once: what's overworking releases, what's underworking re-engages.",
    },
  ],
  chainHeading: 'Where lower back pain actually comes from',
  chainSubline: 'The lumbar spine is the endpoint of forces traveling up from the pelvis and hips.',
  chainSteps: [
    {
      num: '01', flow: 'PELVIS → POSITION',
      title: 'Your pelvis is out of position.',
      body: 'When the pelvis tips forward, the lower back is forced into compression with every step you take and every moment you stand. This is the most common pattern Dr. Garrett sees in people with chronic lower back pain. It\'s correctable, usually within the first few sessions.',
    },
    {
      num: '02', flow: 'HIPS → OFFLINE',
      title: 'Parts of your hips have stopped working.',
      body: "Sitting for hours changes the balance between the front and back of your hips. The front gets tight and overactive. The back stops engaging. Your lower back muscles take over as the primary movers, and they're not built for that job.",
    },
    {
      num: '03', flow: 'PATTERN → PAIN',
      title: 'Your spine is compensating for everything below it.',
      body: 'Whether your pain is from a disc issue, SI joint dysfunction, sciatica, or general tightness, the pattern driving it is identifiable. Dr. Garrett assesses how force moves through your pelvis and spine and finds the specific imbalance creating your symptoms.',
    },
  ],
};

// ─── NECK ────────────────────────────────────────────────────────────
const neck: ConditionContent = {
  displayName: 'Neck Pain',
  conditionPageSlug: 'neck-pain-san-francisco',
  whyHeading: 'Why your neck keeps hurting',
  whySubline: "The neck is where the pain shows up. But it's rarely where the problem starts.",
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: 'Your neck muscles are working overtime to hold your head in position because something below them has shifted. For every inch your head sits in front of your shoulders, it adds roughly ten pounds of load on your neck. Most people are two to three inches forward.',
    },
    {
      num: '02',
      title: "Why stretching and massage haven't lasted",
      body: "Releasing the tight muscles in your neck and upper traps feels good in the moment. But those muscles are tight because they're overworking. If you don't change what they're overworking for, they tighten right back up.",
    },
    {
      num: '03',
      title: 'Why temporary relief stays temporary',
      body: "Adjustments, injections, and hands-on work can provide real relief. But if the postural pattern pulling your head forward hasn't changed, the load comes right back. The Amari Method finds both ends of the problem at once.",
    },
  ],
  chainHeading: 'Where neck pain actually comes from',
  chainSubline: 'The cervical spine is the endpoint of forces traveling up from the thoracic spine, ribcage, and shoulder blades.',
  chainSteps: [
    {
      num: '01', flow: 'MID-BACK → STIFF',
      title: 'Your mid-back has stiffened up.',
      body: 'When the thoracic spine rounds and locks, the body compensates by extending through the neck. That pushes the head forward and compresses the cervical joints. Releasing thoracic mobility is often the fastest path to lasting neck relief.',
    },
    {
      num: '02', flow: 'SHOULDER BLADES → OFF POSITION',
      title: 'Your shoulder blades have lost their position.',
      body: 'The muscles that anchor your shoulder blades attach directly to your cervical spine. When the shoulder blades collapse forward, those muscles pull on the neck and the upper traps take over to stabilize your head.',
    },
    {
      num: '03', flow: 'UPPER BACK → OFFLINE',
      title: 'Parts of your upper back have stopped working.',
      body: 'Sitting at a desk, driving, or working with your arms in front of you for years changes the balance between the front and back of your shoulders. The front gets tight and dominant. The back stops engaging.',
    },
    {
      num: '04', flow: 'PATTERN → PAIN',
      title: 'Your specific pattern is identifiable.',
      body: 'Whether your pain is from disc compression, cervicogenic headaches, thoracic outlet syndrome, or general stiffness, the pattern driving it can be found.',
    },
  ],
};

// ─── SHOULDER ────────────────────────────────────────────────────────
const shoulder: ConditionContent = {
  displayName: 'Shoulder Pain',
  conditionPageSlug: 'shoulder-pain-san-francisco',
  whyHeading: 'Why your shoulder keeps hurting',
  whySubline: "The shoulder is where the pain lives. But it's rarely where the problem starts.",
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: 'Your shoulder joint is taking on stress that should be distributed across your shoulder blade and upper back. When the muscles that stabilize your shoulder blade stop doing their job, other muscles overwork to pick up the slack. That overwork becomes impingement, tightness, and eventually pain.',
    },
    {
      num: '02',
      title: "Why rotator cuff strengthening hasn't worked",
      body: "If the shoulder blade is still out of position, strengthening the rotator cuff can actually make things worse. You're building strength into a pattern that's already compromised. The pain keeps coming back because the foundation underneath the shoulder joint hasn't changed.",
    },
    {
      num: '03',
      title: 'Why temporary relief stays temporary',
      body: 'Injections, massage, and manual therapy can provide real relief. But if nothing changes the positioning problem loading your shoulder, the relief fades.',
    },
  ],
  chainHeading: 'Where shoulder pain actually comes from',
  chainSubline: 'The shoulder joint is the endpoint of forces traveling up from the upper back and shoulder blade.',
  chainSteps: [
    {
      num: '01', flow: 'SHOULDER BLADE → POSITION',
      title: 'Your shoulder blade is out of position.',
      body: 'When the shoulder blade tips forward and down, it narrows the space where your rotator cuff tendons live. Every time you raise your arm, those tendons get pinched. This is the most common pattern Dr. Garrett sees in people with chronic shoulder pain.',
    },
    {
      num: '02', flow: 'UPPER BACK → OFFLINE',
      title: 'Parts of your upper back have stopped working.',
      body: 'Sitting, driving, and phone use change the balance between the front and back of your upper body. The chest gets tight and overactive. The muscles between your shoulder blades stop engaging.',
    },
    {
      num: '03', flow: 'THORACIC → STIFF',
      title: "Your upper back isn't moving the way it should.",
      body: 'A stiff thoracic spine forces the shoulders forward. Before any shoulder work can hold, the upper back needs to move freely. This is a step most shoulder treatments skip entirely.',
    },
    {
      num: '04', flow: 'PATTERN → PAIN',
      title: 'Your individual pattern is identifiable.',
      body: 'Whether your pain is from impingement, a rotator cuff issue, frozen shoulder, or general tightness, the pattern driving it is identifiable.',
    },
  ],
};

// ─── HIP ─────────────────────────────────────────────────────────────
const hip: ConditionContent = {
  displayName: 'Hip Pain',
  conditionPageSlug: 'hip-pain-san-francisco',
  whyHeading: 'Why your hip pain keeps coming back',
  whySubline: 'The hip is where the pain shows up. But the problem almost always starts somewhere else.',
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: 'Your hip is being compressed because the structures around it are out of balance. When parts of your body stop doing their job, your hip joint absorbs forces it was never designed to handle alone. Tightness, pinching, and restricted movement are symptoms of that overload.',
    },
    {
      num: '02',
      title: "Why stretching and strengthening haven't worked",
      body: 'If the areas creating the problem are still out of balance, stretching tight hip flexors or strengthening your glutes can reinforce the same pattern. You get temporarily looser or stronger, but the hip is still being loaded the same way.',
    },
    {
      num: '03',
      title: 'Why temporary relief stays temporary',
      body: 'Injections, manual therapy, and rest can provide real relief. But if nothing changes the mechanical pattern compressing your hip, the relief fades.',
    },
  ],
  chainHeading: 'Where hip pain actually comes from',
  chainSubline: 'The hip joint is a pressure junction. What surrounds it determines how it moves.',
  chainSteps: [
    {
      num: '01', flow: 'PELVIS → POSITION',
      title: 'Your pelvis is out of position.',
      body: "When the pelvis tips forward, it compresses the front of the hip joint. This is the single most common pattern Dr. Garrett sees in people with chronic hip pain. It's behind most diagnoses of impingement, labral irritation, hip flexor strain, and groin tightness.",
    },
    {
      num: '02', flow: 'HIPS → OFFLINE',
      title: 'Parts of your hips have stopped working.',
      body: "Sitting for hours changes the balance between the front and back of your hips. The front gets tight and overactive. The back stops engaging. The hip joint loses its primary stabilizers and other structures take over. That's where the pinching and the feeling that your hip \"catches\" comes from.",
    },
    {
      num: '03', flow: 'SUPPORT → OVERLOADED',
      title: 'The structures taking over are getting overloaded.',
      body: "The IT band, piriformis, and hip flexors are often blamed for pain, but they're rarely the original cause. They become overworked because the primary hip mechanics aren't functioning. Releasing them directly without addressing the underlying pattern provides only temporary relief.",
    },
    {
      num: '04', flow: 'PATTERN → PAIN',
      title: 'Your pattern is specific to you.',
      body: 'Hip pain presents differently in every person. Dr. Garrett assesses your individual pelvic position, how your hip moves under load, and which structures are overworking and which have shut down.',
    },
  ],
};

// ─── KNEE ────────────────────────────────────────────────────────────
const knee: ConditionContent = {
  displayName: 'Knee Pain',
  conditionPageSlug: 'knee-pain-san-francisco',
  whyHeading: 'Why your knee keeps hurting',
  whySubline: "The knee is where the pain lives. But it's almost never where the problem starts.",
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: "Your knee is a hinge. It does what the hip above it and the foot below it tell it to do. When parts of your hip stop doing their job, the knee starts absorbing rotational forces it wasn't built for. That shows up as pain around the kneecap, along the outside of the knee, or deep inside the joint.",
    },
    {
      num: '02',
      title: "Why strengthening your quads hasn't worked",
      body: "The standard approach to knee pain is quad strengthening. But if your hip isn't controlling how your thigh bone rotates, you're just loading a misaligned joint harder. You end up with stronger legs and the same faulty mechanics.",
    },
    {
      num: '03',
      title: "Why braces and injections don't last",
      body: 'Braces redirect force temporarily. Cortisone reduces inflammation temporarily. Neither one changes the movement pattern that\'s overloading your knee in the first place. When the brace comes off or the injection wears off, the same forces return.',
    },
  ],
  chainHeading: 'Where knee pain actually comes from',
  chainSubline: "The knee is a transmission point. What's above it determines how it moves.",
  chainSteps: [
    {
      num: '01', flow: 'HIP → CONTROL',
      title: "Your hip isn't controlling your thigh bone.",
      body: "When the muscles on the side and back of your hip aren't doing their job, your thigh bone rotates inward with every step. That inward rotation pulls the kneecap off its natural track and creates stress on structures that weren't designed for that load.",
    },
    {
      num: '02', flow: 'IT BAND → OVERWORKING',
      title: 'Your IT band is overworking.',
      body: "The IT band runs from the hip to just below the knee. When the hip isn't stable, the IT band picks up the slack. It tightens, creates friction on the outside of the knee, and becomes painful. Foam rolling feels good temporarily, but it doesn't change why the IT band is tight.",
    },
    {
      num: '03', flow: 'PATTERN → PAIN',
      title: 'Your knee is absorbing forces meant for other structures.',
      body: 'Whether your pain is patellofemoral, IT band syndrome, meniscus irritation, or general achiness that gets worse with stairs and running, the pattern behind it is identifiable.',
    },
  ],
};

// ─── GENERIC FALLBACK ────────────────────────────────────────────────
// Used for upper back, ankles/feet, wrists/hands, elbows — areas without
// dedicated condition pages. Avoids faking anatomy-specific copy.

// Natural-language phrases for the fallback heading. Avoids the grammar
// bug where `${displayName.toLowerCase()} keeps hurting` produces
// "elbows keeps hurting" / "wrists/hands keeps hurting" (plural noun +
// singular verb) and "wrists/hands" (slash in display).
const PAIN_PHRASE: Record<string, string> = {
  'elbows': 'elbow pain',
  'wrists-hands': 'wrist or hand pain',
  'ankles-feet': 'ankle or foot pain',
  'upper-back': 'upper back pain',
};

const fallback = (displayName: string, normalized: string): ConditionContent => ({
  displayName,
  conditionPageSlug: null,
  whyHeading: `Why your ${PAIN_PHRASE[normalized] ?? `${displayName.toLowerCase()} pain`} keeps coming back`,
  whySubline: 'The pain is where you feel it. The problem is rarely where it starts.',
  whyCards: [
    {
      num: '01',
      title: 'The pattern nobody has explained to you',
      body: 'When parts of your body stop doing their job, other parts overwork to compensate. That overwork becomes tightness, compression, and eventually pain. Most treatments address the spot that hurts without asking why it\'s under so much load in the first place.',
    },
    {
      num: '02',
      title: "Why stretching and strengthening haven't worked",
      body: 'If the areas creating the problem are still out of balance, stretching and strengthening can reinforce the same pattern. The pain keeps coming back because the root cause hasn\'t changed.',
    },
    {
      num: '03',
      title: 'Why temporary relief stays temporary',
      body: "Manual therapy, injections, and adjustments can provide real relief. But if nothing changes the mechanical pattern, the relief fades. The Amari Method finds both ends of the problem: what's overworking releases, what's underworking re-engages.",
    },
  ],
  chainHeading: `Where pain like yours actually comes from`,
  chainSubline: 'Pain is the endpoint of forces moving through your body. The chain that produces it is identifiable.',
  chainSteps: [
    {
      num: '01', flow: 'BALANCE → SHIFTED',
      title: 'Your body is out of balance.',
      body: 'Something is working too hard because something else stopped doing its job. Until that balance is restored, the overworking part stays under load.',
    },
    {
      num: '02', flow: 'COMPENSATION → LOAD',
      title: 'The structures taking over are getting overloaded.',
      body: 'Whatever is compensating for the underworking part is bearing forces it wasn\'t designed for. That\'s where the chronic tightness, fatigue, and pain comes from.',
    },
    {
      num: '03', flow: 'PATTERN → PAIN',
      title: 'Your pattern is identifiable.',
      body: 'Dr. Garrett assesses how force moves through your whole body — not just the area that hurts — and finds the specific imbalance creating your symptoms.',
    },
  ],
});

// ─── PROTOCOL INTRO LIBRARY ──────────────────────────────────────────
// Video URLs from amari/Course Videos/course-video-urls.json (filesafe.space CDN).
// Framing lines pulled from Garrett's actual intro transcripts —
// his words, not Claude paraphrase.
//
// Mapping decided 2026-05-04 (Option B): mirrors the GHL email branch
// logic for 8 of 9 pain locations; Elbows uses the dedicated Elbow Reset
// protocol instead of Hand Balancer (small divergence — GHL workflow
// should be split to match when next iterating that branch).

const SPINAL_WAVE: ProtocolIntro = {
  name: 'The Spinal Wave',
  framingLine: '"Go for the feeling of it, not the doing of it. Let the ocean move you."',
  introVideoUrl: 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30c3bfe4d0d3ac8d60938.mp4',
  durationLabel: '4 min',
};

// NOTE 2026-05-04: course-video-urls.json has Power Posture and Spring Step
// URLs swapped (verified by byte-size comparison against local masters in
// amari/Course Videos/). The URLs below are the *corrected* mapping —
// content matches the protocol name. Do not "fix" by reverting to the JSON.
const POWER_POSTURE: ProtocolIntro = {
  name: 'Power Posture',
  framingLine: '"We have a huge over-flexion problem in the culture, and this exercise totally corrects it."',
  introVideoUrl: 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30d0ef5a3893acea59684.mp4',
  durationLabel: '2 min',
};

const SPRING_STEP: ProtocolIntro = {
  name: 'Spring Step',
  framingLine: '"Imagine feeling the bottom of your body as buoyant and free, rather than stuck."',
  introVideoUrl: 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c306b5f5a389ab2aa4c3a0.mp4',
  durationLabel: '3 min',
};

const HAND_BALANCER: ProtocolIntro = {
  name: 'The Hand Balancer',
  framingLine: '"Most people are experiencing some kind of hand issue these days. This balances out the hand so the front and back are working equally."',
  introVideoUrl: 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c305e33ab4d91e7fc7763d.mp4',
  durationLabel: '1 min',
};

const ELBOW_RESET: ProtocolIntro = {
  name: 'The Elbow Reset',
  framingLine: '"From all the overuse we do with the forearm, the tendon gets inflamed. This is a great tool for any kind of dysfunction of the elbow or forearm."',
  introVideoUrl: 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30e9b6bd30ff0fd318d61.mp4',
  durationLabel: '1 min',
};

// ─── TESTIMONIAL LIBRARY ─────────────────────────────────────────────
// Pseudonyms per site-wide privacy convention (Sara/Becca/Paul/Katie/Tyler
// in display; image filenames preserve the original first names internally).
// Quotes are the canonical homepage testimonials — visitor sees the one
// whose pain location matches theirs.

const T_SARA: MatchedTestimonial = {
  quote: 'I thought the best I could hope for was less pain. I\'ve never felt this at home in my body.',
  name: 'Sara',
  attribution: 'Low back relief',
};

const T_BECCA: MatchedTestimonial = {
  quote: 'I went from barely walking to six-mile hikes. I didn\'t think that was possible for me again after my accident.',
  name: 'Becca',
  attribution: 'Hip pain',
};

const T_TYLER: MatchedTestimonial = {
  quote: 'I finally understand WHY my neck has been hurting. That\'s worth more than any treatment I\'ve ever had.',
  name: 'Tyler',
  attribution: 'Photographer · neck',
};

const T_PAUL: MatchedTestimonial = {
  quote: 'My shoulder was just the weakest link. Huge a-ha moment.',
  name: 'Paul',
  attribution: 'Weightlifter · shoulder',
};

const T_KATIE: MatchedTestimonial = {
  quote: 'One visit with Dr. Garrett gave me more results than two years of physical therapy.',
  name: 'Katie',
  attribution: 'Runner recovery',
};

// Body-agnostic fallback for areas where no specific homepage testimonial
// applies (elbows, wrists/hands). The quote doesn't reference any body
// part, so attribution stays generic. Sourced from index.html homepage
// testimonials (Marisol · Teacher).
const T_MARISOL: MatchedTestimonial = {
  quote: 'I follow his protocol every day. 8 months no pain.',
  name: 'Marisol',
  attribution: 'Teacher',
};

const TESTIMONIAL_BY_LOCATION: Record<string, MatchedTestimonial> = {
  'lower-back':   T_SARA,
  'hips':         T_BECCA,
  'hip':          T_BECCA,
  'neck':         T_TYLER,
  'shoulders':    T_PAUL,
  'shoulder':     T_PAUL,
  'upper-back':   T_TYLER,    // anatomy-adjacent; Tyler's neck/upper-back story applies
  'knees':        T_KATIE,
  'knee':         T_KATIE,
  'ankles-feet':  T_KATIE,    // running/lower-extremity story applies
  'wrists-hands': T_MARISOL,  // body-agnostic; quote doesn't tie to a location
  'elbows':       T_MARISOL,  // ditto
};

// Maps every Q0 pain location slug → matched protocol intro
const PROTOCOL_BY_LOCATION: Record<string, ProtocolIntro> = {
  'lower-back': SPINAL_WAVE,
  'hips': SPINAL_WAVE,
  'hip': SPINAL_WAVE,
  'neck': POWER_POSTURE,
  'shoulders': POWER_POSTURE,
  'shoulder': POWER_POSTURE,
  'upper-back': POWER_POSTURE,
  'knees': SPRING_STEP,
  'knee': SPRING_STEP,
  'ankles-feet': SPRING_STEP,
  'wrists-hands': HAND_BALANCER,
  'elbows': ELBOW_RESET,
};

// ─── MAP + LOOKUP ────────────────────────────────────────────────────
const CONTENT_MAP: Record<string, ConditionContent> = {
  'lower-back': lowerBack,
  'neck': neck,
  'shoulders': shoulder,
  'shoulder': shoulder,
  'hips': hip,
  'hip': hip,
  'knees': knee,
  'knee': knee,
};

/**
 * Look up content for a Q0 pain location answer.
 * Returns null if the visitor didn't answer Q0 (caller can skip the section).
 */
export function getConditionContent(painLocation: string | null): ConditionContent | null {
  if (!painLocation) return null;
  const normalized = painLocation.toLowerCase().replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-');
  const base = CONTENT_MAP[normalized] ?? fallback(painLocation, normalized);
  const protocolIntro = PROTOCOL_BY_LOCATION[normalized];
  const matchedTestimonial = TESTIMONIAL_BY_LOCATION[normalized];
  return {
    ...base,
    ...(protocolIntro && { protocolIntro }),
    ...(matchedTestimonial && { matchedTestimonial }),
  };
}
