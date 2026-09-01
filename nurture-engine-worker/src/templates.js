// Executable, fail-closed nurture template catalog.
//
// The exact reviewed Flow 1, Flow 2, and Flow 3 source copy is admitted here. This module
// renders content but does not address a recipient or send anything.

const MERGE_RE = /{{\s*([a-z0-9_.]+)\s*}}/gi;

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

const email = (sequenceId, subject, preheader, body) => ({
  sequenceId,
  audience: "client",
  channel: "email",
  from: { name: "Garrett", email: "garrett@amarimethod.com" },
  subject,
  preheader,
  body,
});

const FLOW_1_SPRING_STEP_BODY = `Hi {{contact.first_name}},
I promised you a protocol. Here it is.
It's called the Spring Step. I teach this to almost every client with {{contact.primary_pain_location}} pain because it decompresses your calves and Achilles, like hanging but for your lower body.
How to do it:
1. Find a step or curb at least 4 to 6 inches high.
2. Stand with the balls of your feet on the edge, heels hanging off.
3. Hold a railing for light balance support.
4. Let your heels drop below the step level and let gravity do the work.
5. Breathe and let your body relax into the decompression for 20 to 30 seconds.
That's it. No forcing, no pulling. You're just letting gravity decompress years of tightness in your Achilles and calves. Once that releases, everything above it moves better too.
This is one protocol. In a full session, you'd get a set adapted to your specific {{contact.pain_pattern_signature}} pattern. We work the whole chain of overworking and underworking, rather than one spot. Most clients feel a real shift in that first session.
Read the full Spring Step guide → https://www.amarimethod.com/blog
If you want to go deeper, a free discovery call is the best next step.
Schedule a free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`;

const FLOW_1_SKEPTICAL_BODY = `Hi {{contact.first_name}},
I want to be honest about something. The Amari Method doesn't work for everyone.
If you're looking for someone to crack your back and send you on your way, that's not what I do. If you want something done to you while you lie on a table, this isn't that either.
The Amari Method works for people who are willing to learn. I teach you protocols. You do them. Your body changes.
It works best for people who:
• Have tried PT or massage and gotten relief that didn't last
• Are tired of depending on appointments to feel okay
• Want to understand why they're in pain, instead of only chasing the symptom
• Are willing to spend 5 to 10 minutes a day on the protocols
If that sounds like you, this tends to work well.
Schedule a free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`;

const FLOW_1_WHEN_READY_BODY = `Hi {{contact.first_name}},
This is the last email I'll send you. No countdown timer. No manufactured urgency.
Just one thing I want to be honest about.
Patterns of overworking and underworking don't stay the same. They get deeper. Your body keeps building workarounds on top of workarounds. The hip thing becomes a hip and knee thing. The neck tension starts pulling your shoulder into it.
I've had clients come in after a year of managing their pain with foam rollers and quick fixes. Those things worked for a little while, then stopped. By the time they got here, there were three layers to unwind instead of one.
You took the quiz. You know your {{contact.pain_pattern_signature}} pattern. You've tried the protocol.
Whenever you're ready:
Schedule a free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Or see the full session options:
View sessions and pricing → https://www.amarimethod.com/booking
Either way, the protocol guides on the blog are yours whenever you want them: amarimethod.com/blog
Garrett`;

export const FLOW_1_QUIZ_TEMPLATES = deepFreeze({
  "f1-email-1-quiz-results": email(
    "flow-1-quiz",
    "{{contact.first_name}}, your {{contact.pain_pattern_signature}} pattern explained",
    "Here's what your quiz results reveal about your {{contact.primary_pain_location}} pain.",
    `Hi {{contact.first_name}},
You just completed your Pain Pattern Assessment, and your results reveal something important about your {{contact.primary_pain_location}}.
Your Pattern Signature: {{contact.pain_pattern_signature}}
This means your body has developed a specific way of adapting to stress, and that adaptation is what's driving your {{contact.primary_pain_location}} pain right now.
Here's the key insight from your results. You're not broken. You're out of balance.
Some parts of your body are working too hard because other parts aren't working enough. That imbalance is what creates the pain. It's also what makes lasting relief possible.
Your body already knows how to heal. It just needs the right input.
That's exactly what the Amari Method provides. After 25+ years of bodywork, I built a systematic approach that helps people who've been stuck for years. I'm not the one who heals you. I show you what your body has been trying to tell you all along.
If you'd like to understand exactly what's happening with your {{contact.primary_pain_location}} and what to do about it, a free 15-minute discovery call is the best next step.
Schedule your free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
It's just 15 minutes to get clear on your pattern and your options.
Garrett
P.S. Over the next few days, I'll share more about why your pattern keeps coming back, and what changes it.`,
  ),
  "f1-email-2": email(
    "flow-1-quiz",
    "Why your {{contact.primary_pain_location}} pain keeps coming back",
    "Where it hurts isn't why it hurts.",
    `Hi {{contact.first_name}},
If your {{contact.primary_pain_location}} pain keeps showing up no matter what you try, there's an important reason.
What you've tried didn't fail you. It was aimed at the symptom, not the pattern behind it.
After {{contact.pain_duration}} of dealing with {{contact.primary_pain_location}} pain, your body has settled into deep patterns of overworking and underworking. Every time one area stops doing its job, another area picks up the slack. That's your body being intelligent, but it comes at a cost.
If what you've tried so far hasn't brought lasting relief, it's likely because those approaches targeted where it hurts instead of why it hurts.
It comes down to balance. Your pain exists because some parts of your body are working too hard to make up for other parts that aren't working enough. Until that imbalance is addressed at its source, relief stays temporary.
This is exactly what the Amari Method is built to solve. Not by chasing symptoms, but by rebalancing the system that's creating them.
If you want to see exactly where your imbalance is and what to do about it, a free 15-minute discovery call is the best next step.
Schedule your free 15-min discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-2-chronic": email(
    "flow-1-quiz",
    "Why your chronic pain keeps coming back",
    "Where it hurts isn't why it hurts.",
    `Hi {{contact.first_name}},
If your chronic pain keeps showing up no matter what you try, there's an important reason.
What you've tried didn't fail you. It was aimed at the symptom, not the pattern behind it.
After years of persistent pain, your body has settled into deep patterns of overworking and underworking. Every time one area stops doing its job, another area picks up the slack. That's your body being intelligent, but it comes at a cost.
If what you've tried so far hasn't brought lasting relief, it's likely because those approaches targeted where it hurts instead of why it hurts.
It comes down to balance. Your pain exists because some parts of your body are working too hard to make up for other parts that aren't working enough. Until that imbalance is addressed at its source, relief stays temporary.
This is exactly what the Amari Method is built to solve. Not by chasing symptoms, but by rebalancing the system that's creating them.
If you want to see exactly where your imbalance is and what to do about it, a free 15-minute discovery call is the best next step.
Schedule your free 15-min discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-3-real-reason": email(
    "flow-1-quiz",
    "The real reason behind your {{contact.pain_pattern_signature}} pattern",
    "It comes down to balance.",
    `Hi {{contact.first_name}},
Remember your {{contact.pain_pattern_signature}} result from the Pain Pattern Assessment? Here's what most practitioners miss about it.
Your {{contact.primary_pain_location}} pain isn't a muscle or joint problem. It's a balance problem.
Here's what that means. Your body has settled into a pattern where some parts overwork while others shut down. It keeps recreating that pattern, even after you've worked on it. That's why the relief never holds. It's always temporary.
Your body returns to the same place because the underlying cause was never addressed, the imbalance between what's working too hard and what isn't working enough.
The Amari Method works differently.
Instead of forcing your body into a position, we teach your body to hold its own balance. Once you learn it, you've got it for life. No dependency. No endless appointments.
This is why I created the Amari Method. After 25+ years of bodywork, I kept seeing the same pattern: people getting temporary relief that never lasted. The method was built to solve that.
Read how the Amari Method works → https://www.amarimethod.com/how-it-works
If you want to find out what it could do for your {{contact.primary_pain_location}}, a free discovery call is the best next step.
Schedule your free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-4a-spinal-wave": email(
    "flow-1-quiz",
    "A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}",
    "Try this at home today — it takes 2 minutes.",
    `Hi {{contact.first_name}},
I promised you a protocol for your {{contact.primary_pain_location}}, so here it is.
It's called the Spinal Wave, and it's one of the first protocols I teach clients with {{contact.primary_pain_location}} pain. It gently lengthens your spine and helps your nervous system let go of the patterns that keep pulling you back into the same position.
How to do it:
1. Lie on your back with knees bent, feet flat on the floor.
2. Starting from your tailbone, slowly roll your spine up one vertebra at a time.
3. Pause at the top, then roll back down just as slowly.
4. Repeat 5 to 8 times, breathing slowly with each wave.
The key is slow. Your nervous system responds to gentle input, not force. Go for the feeling of it, not the doing of it.
This is a preview of what a full Amari Method session covers. In a session, every protocol is adapted to your specific {{contact.pain_pattern_signature}} pattern. We work the whole chain of overworking and underworking, rather than one area.
Read the full Spinal Wave guide → https://www.amarimethod.com/blog
If you want to go deeper, a free discovery call is the best next step.
Schedule your free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-4b-power-posture": email(
    "flow-1-quiz",
    "A free exercise for your {{contact.primary_pain_location}}, {{contact.first_name}}",
    "Try this at home today — it takes 2 minutes.",
    `Hi {{contact.first_name}},
I promised you a protocol for your {{contact.primary_pain_location}}, so here it is.
It's called Power Posture, and it's one of the first protocols I teach clients with {{contact.primary_pain_location}} pain. It reactivates your shoulder blade stabilizers, the muscles that are supposed to support your upper body but have often gone dormant.
How to do it:
1. Stand with your back against a wall, feet 6 inches out.
2. Press the back of your hands into the wall at shoulder height.
3. Slowly slide your arms up the wall like a snow angel, keeping contact.
4. Hold at the top for 3 seconds, then slowly lower.
5. Repeat 8 to 10 times.
You should feel your upper back muscles engaging. That's your body relearning proper support. Most of us spend all day rounded forward, and this protocol works against that.
This is a preview of what a full Amari Method session covers. In a session, every protocol is adapted to your specific {{contact.pain_pattern_signature}} pattern. We work the whole chain of overworking and underworking, rather than one area.
Read the full Power Posture guide → https://www.amarimethod.com/blog
If you want to go deeper, a free discovery call is the best next step.
Schedule your free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-4c-spring-step": email(
    "flow-1-quiz",
    "Try this for your {{contact.primary_pain_location}} — takes 2 minutes",
    "One of the first exercises I teach clients with your pattern.",
    FLOW_1_SPRING_STEP_BODY,
  ),
  "f1-email-4c-chronic": email(
    "flow-1-quiz",
    "Try this for your chronic pain — takes 2 minutes",
    "One of the first exercises I teach clients with your pattern.",
    FLOW_1_SPRING_STEP_BODY,
  ),
  "f1-email-4d-hand-balancer": email(
    "flow-1-quiz",
    "Try this for your {{contact.primary_pain_location}} — takes 2 minutes",
    "One of the first exercises I teach clients with your pattern.",
    `Hi {{contact.first_name}},
I promised you a protocol. Here it is.
It's called the Hand Balancer. I teach this to almost every client with {{contact.primary_pain_location}} pain because it activates the extensor muscles in your hands, the ones that have gone dormant from years of gripping and typing.
The problem: your hands only do half their job. You grip and close all day (the flexors). You almost never open and spread (the extensors). That imbalance compresses the small bones in your palm, which squeezes the nerves running through your wrist.
How it works: the Hand Balancer creates opposition between your thumb and pinky metacarpal bones, forcing your hand to open from the inside out. Your dormant extensors wake up, and the compression releases.
The exact hand positioning and pressure are specific to your anatomy. This is one I teach in person, so you get it right from the start.
This is one protocol. In a full session, you'd get a set adapted to your specific {{contact.pain_pattern_signature}} pattern. We work the whole chain of overworking and underworking, rather than one spot. Most clients feel a real shift in that first session.
Read the full Hand Balancer guide → https://www.amarimethod.com/blog
If you want to go deeper, a free discovery call is the best next step.
Schedule a free discovery call → https://discoverycall.amarimethod.com/discovery-call-booking
Garrett`,
  ),
  "f1-email-5-skeptical": email(
    "flow-1-quiz",
    "I can't help everyone with {{contact.primary_pain_location}} pain",
    "Here's who the Amari Method works for — and who it doesn't.",
    FLOW_1_SKEPTICAL_BODY,
  ),
  "f1-email-5-chronic": email(
    "flow-1-quiz",
    "I can't help everyone with chronic pain",
    "Here's who the Amari Method works for — and who it doesn't.",
    FLOW_1_SKEPTICAL_BODY,
  ),
  "f1-email-6-when-ready": email(
    "flow-1-quiz",
    "{{contact.first_name}}, one last thought about your {{contact.primary_pain_location}}",
    "This is the last email I'll send you.",
    FLOW_1_WHEN_READY_BODY,
  ),
  "f1-email-6-chronic": email(
    "flow-1-quiz",
    "{{contact.first_name}}, one last thought about your pain",
    "This is the last email I'll send you.",
    FLOW_1_WHEN_READY_BODY,
  ),
});

export const FLOW_2_POST_DISCOVERY_TEMPLATES = deepFreeze({
  "f2-email-1-good-talking": email(
    "flow-2-post-discovery",
    "Good talking with you, {{contact.first_name}}",
    "Here's what stuck with me from our call.",
    `Hi {{contact.first_name}},

So glad we got to talk!

What I keep coming back to is that pain or tension can be a sign that part of your body is working harder than it needs to. In the Assessment, we look at how you move and what may be contributing.

It is a 50-minute, $29 first visit. You will have space to experience the work and decide whether continuing together is right for you.

Book your Assessment → https://www.amarimethod.com/assessment-booking

Or just reply here, I read every one of these myself.

Garrett`,
  ),
  "f2-email-2-personalized": email(
    "flow-2-post-discovery",
    "What your Assessment looks like",
    "So there are no surprises.",
    `Hi {{contact.first_name}},

I said I’d tell you what the Assessment is like, so here it is.

First I watch how you move. I’m looking for where your body is working too hard and where it may need more support.

Then I guide you through a simple protocol so you can notice what changes in real time. You are the one doing the work. I’m there to guide you through it.

The Assessment is 50 minutes and $29. It gives us a chance to see the work together and decide whether continuing is the right fit.

Book your Assessment →
https://www.amarimethod.com/assessment-booking

Garrett`,
  ),
  "f2-email-2-chronic": email(
    "flow-2-post-discovery",
    "What your Assessment looks like",
    "So there are no surprises.",
    `Hi {{contact.first_name}},

I promised I’d tell you what the Assessment is like, so here it is.

First I watch how you move. Simple things like walking or reaching can show where your body is working too hard and where it may need more support.

Then I guide you through a simple protocol so you can notice what changes in real time. You are the one doing the work. I’m your guide.

The Assessment is 50 minutes and $29. It gives us a chance to see the work together and decide whether continuing is the right fit.

Book your Assessment →
https://www.amarimethod.com/assessment-booking

Garrett`,
  ),
});

export const FLOW_3_POST_INITIAL_TEMPLATES = deepFreeze({
  "f3-email-1-protocols-portal": {
    sequenceId: "flow-3-post-initial",
    audience: "client",
    channel: "email",
    from: { name: "Garrett", email: "garrett@amarimethod.com" },
    subject: "Your protocols are in the portal, {{contact.first_name}}",
    preheader: "Do the protocols. Don't force them.",
    body: "Hi {{contact.first_name}},\n\nLoved working with you today!\n\nOver the next day or two you'll probably feel some shifts. Things loosening up, maybe a little soreness in spots that haven't been sore in a while. That's your body recalibrating. It's a good sign.\n\nHere's everything you need.\n\nYour protocols:\nAccess your tools → https://www.amarimethod.com/tools\n\nBook sessions and track your progress:\nYour client portal → https://www.amarimethod.com/portal/\n\nThe main thing this week: do the protocols, but don't force them. They should feel like relief, not work. If something feels like effort, ease back. The movement should feel like your body remembering something, not learning something new.\n\nReply here if anything comes up. I read these myself.\n\nGarrett",
  },
  "f3-email-2-practice-going": {
    sequenceId: "flow-3-post-initial",
    audience: "client",
    channel: "email",
    from: { name: "Garrett", email: "garrett@amarimethod.com" },
    subject: "How's the practice going, {{contact.first_name}}?",
    preheader: "Most people notice something by now.",
    body: "Hi {{contact.first_name}},\n\nIt's been a few days. Just wondering how you're doing.\n\nBy now you've probably noticed one of two things. Either something has clearly shifted, like less tension or better sleep. Or things feel like they're slowly reorganizing. Both are normal. Both mean it's working.\n\nThe protocols are doing the real work between sessions. Every time you do them, you're reinforcing what we started. That's how this becomes lasting. Your body starts to own it, so you don't need me for it.\n\nIf anything feels off, or you have questions about the protocols, just reply here.\n\nWhen you're ready to keep going:\nBook your next session → https://www.amarimethod.com/portal/\n\nGarrett",
  },
});

export const NURTURE_TEMPLATES = deepFreeze({
  ...FLOW_1_QUIZ_TEMPLATES,
  ...FLOW_2_POST_DISCOVERY_TEMPLATES,
  ...FLOW_3_POST_INITIAL_TEMPLATES,
});

function renderText(text, fields) {
  return text.replace(MERGE_RE, (_, key) => {
    const value = fields[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`missing required nurture merge field: ${key}`);
    }
    return value.trim();
  });
}

export function getNurtureTemplate(templateId) {
  return NURTURE_TEMPLATES[templateId] || null;
}

export function renderNurtureTemplate(templateId, fields = {}) {
  const template = getNurtureTemplate(templateId);
  if (!template) throw new Error(`unowned nurture template: ${templateId}`);
  const rendered = {
    templateId,
    sequenceId: template.sequenceId,
    audience: template.audience,
    channel: template.channel,
    from: { ...template.from },
    subject: renderText(template.subject, fields),
    preheader: renderText(template.preheader, fields),
    body: renderText(template.body, fields),
  };
  if (MERGE_RE.test(`${rendered.subject}\n${rendered.preheader}\n${rendered.body}`)) {
    throw new Error(`unresolved nurture merge field: ${templateId}`);
  }
  return rendered;
}

export function flow3MessagePreview() {
  return Object.entries(FLOW_3_POST_INITIAL_TEMPLATES).map(([templateId, template], stepIndex) => ({
    templateId,
    stepIndex,
    audience: template.audience,
    channel: template.channel,
    from: `${template.from.name} <${template.from.email}>`,
    subject: template.subject,
    preheader: template.preheader,
    body: template.body,
  }));
}
