import { useState } from 'react';

// Garrett-facing playbooks for in-call lookup. Mirrors
// amari/strategy/Discovery Call.md and amari/strategy/Partner Call.md.
// When either doc changes, update the matching section here.

type StepSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function StepSection({ title, defaultOpen = false, children }: StepSectionProps) {
  return (
    <details className="staff-card p-0 overflow-hidden group" open={defaultOpen}>
      <summary className="px-4 py-3 cursor-pointer font-semibold text-amari-charcoal flex items-center justify-between min-h-[48px] list-none select-none">
        <span>{title}</span>
        <span className="text-amari-text-muted text-sm group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3 text-sm text-amari-charcoal/90 leading-relaxed border-t border-amari-border/60">
        {children}
      </div>
    </details>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-amari-accent-warm pl-3 italic text-amari-charcoal/80 my-2">
      {children}
    </blockquote>
  );
}

// ── Discovery Call ──

function DiscoveryCallPlaybook() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal mb-2">Discovery Call</h1>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          15-minute call. Recommend a session or series and book it.
        </p>
      </header>

      <section className="staff-card mb-4">
        <ul className="text-sm text-amari-charcoal/90 leading-relaxed space-y-1 pl-1">
          <li><strong>Listen</strong> → they trust a recommendation only after they feel heard</li>
          <li><strong>Reflect</strong> → proves you understood, earns the right to diagnose</li>
          <li><strong>Diagnose + reframe</strong> → distinguishes the work from what they've tried, justifies the price</li>
          <li><strong>Recommend + book</strong> → the close</li>
        </ul>
      </section>

      <div className="space-y-3">
        <StepSection title="0. Frame the call (~60 sec)">
          <Quote>"Tell me what's going on. I'll listen, then tell you what I think and what I'd recommend."</Quote>
        </StepSection>

        <StepSection title="1. Listen (1–6 min)">
          <p>Don't interrupt. Take notes on:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Body parts ("right knee," "between the shoulder blades")</li>
            <li>Duration ("6 months," "since my kid was born")</li>
            <li>What they've tried + why it stopped helping</li>
            <li>Functional impact ("can't sit through meetings," "can't sleep on my side")</li>
            <li>Emotional words ("scared," "fed up," "hopeless")</li>
          </ul>
          <p>
            Permissible interjections: <em>"Keep going."</em> <em>"Tell me more about that."</em>{' '}
            <em>"And then what happened?"</em>
          </p>
          <p className="font-medium pt-2">After they finish, up to 3 clarifiers:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Timing.</strong> "Morning, after activity, end of day, or constant?"</li>
            <li><strong>What's been tried.</strong> "What have you tried — what shifted, what didn't?"</li>
            <li><strong>Why now.</strong> "Why now, instead of six months ago?"</li>
          </ol>
          <p className="text-amari-text-muted">Stop at 3. More feels like an intake form.</p>
        </StepSection>

        <StepSection title="2. Reflect (8–10 min)">
          <p>Mirror their specifics back.</p>
          <p className="font-medium">Format:</p>
          <Quote>
            "OK so what I'm hearing is — [body part / duration] → [what they've tried + why it failed] →
            [functional impact] → [why now]. Is that about right?"
          </Quote>
          <p className="font-medium">Example.</p>
          <p>
            They said <em>"my lower back's been killing me for 8 months, PT helped briefly then failed, GP
            wants an MRI, can't pick up my kid":</em>
          </p>
          <Quote>
            "8 months of lower back pain, PT helped briefly but didn't hold, MRI on the table, and it's
            affecting things you care about like picking up your kid. Is that about right?"
          </Quote>
          <p className="font-medium pt-2">
            Don't: summarize abstractly. Interpret yet. Say "I hear you." Skip ahead to "here's what Amari is."
          </p>
        </StepSection>

        <StepSection title="3. Diagnose + reframe (10–12 min)">
          <p className="font-medium">Ask permission first:</p>
          <Quote>"OK so given all that — want to hear what I think?"</Quote>
          <p>Wait for yes. Tie everything that follows to what <em>they</em> said.</p>

          <p className="font-medium">Lead with pattern recognition:</p>
          <Quote>"Honestly — I've seen this 6, 12, 15, 25 times before. It moves. It doesn't stay where it is."</Quote>
          <p>Adjust the number to whatever's true.</p>

          <p className="font-medium">Underlying frame:</p>
          <Quote>
            "Your body is a suspension bridge. Every part is designed to hold the load equally. When one part
            is doing too much and another isn't doing enough, the overworked part is where pain shows up. The
            body isn't asking for surgery or stretching — it's asking for balance."
          </Quote>
          <p className="font-medium">Format:</p>
          <Quote>
            "Here's what I think is going on. [Where they're out of balance — what's overworking, what isn't
            doing its share]. The reason [what they tried] didn't hold is [explanation]. You're not broken —
            [reframe]."
          </Quote>
          <p className="font-medium pt-1">Reframes by what they've been told:</p>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "You need surgery."
              </p>
              <Quote>
                "Surgery is for true emergencies — arm-falling-off, car accident. Most surgery treats an
                out-of-balance body biomechanically — like putting a plastic bag where the window should be.
                Worth trying balance before something irreversible."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "PT helped, then stopped."
              </p>
              <Quote>
                "PT is muscular-based — it loads the area that hurts. It doesn't look at how the whole body
                shares the load. Strengthening a part that's already overworking just trains the imbalance
                harder. That's why it didn't hold."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "Just stretch / do core work."
              </p>
              <Quote>
                "Stretching is half the story. The tight part is overworking because something else isn't
                doing its share. Stretch the tight part and you've ignored the other half. We find what isn't
                engaged, bring it online — the tight part lets go on its own."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "Chiro didn't hold."
              </p>
              <Quote>
                "Chiro is done <em>to</em> you — you lay passively while someone forces the structure. Gives
                relief, but your body didn't learn anything. The minute you leave, your imbalance pulls you
                back. You do the work here, so your body learns the new balance."
              </Quote>
            </div>
          </div>

          <p className="font-medium pt-2">Then, 30 seconds on Amari:</p>
          <Quote>
            "I teach a small set of protocols — 8 in total, most people only need 3 or 4 for what their body
            needs. They bring you back into balance, every part sharing the load. Most clients feel a shift in
            the first session. We refine it over a series so it holds."
          </Quote>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Timeline language
            </h4>
            <p>
              <strong>Don't say:</strong> <em>"It takes months to learn anything."</em>
            </p>
            <p className="font-medium mt-3">Say:</p>
            <Quote>
              "You'll feel shifts in your first session. The real work is over the next few months — your body
              learning to hold the new balance without me. That's why I work in series, not one-offs."
            </Quote>
            <Quote>
              "Short term, you feel shifts. Long term, balance — and balance takes a few months to actually
              hold."
            </Quote>
          </div>
        </StepSection>

        <StepSection title="4. Recommend + book (12–14 min)">
          <p>
            Make the recommendation <em>for</em> them — don't ask{' '}
            <em>"Do you want to book your first session?"</em>
          </p>

          <div className="pt-2">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Stakes (~30 sec)
            </h4>
            <p>Before the tier — negative and positive, both from specifics they actually said.</p>
            <Quote>
              "The thing is — this kind of pattern doesn't resolve on its own. 6 months from now you're still
              working around it; couple years the MRI conversation gets heavier, not lighter. What I see for
              you on the other side — [picking up your kid without thinking, sleeping on your side, sitting
              through a meeting and forgetting you have a back]."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Recommend + real capacity
            </h4>
            <Quote>
              "Based on what you've told me — [one-sentence reflection] — what I'd recommend is{' '}
              <strong>[tier]</strong>. For context, I take about 6 new series clients a month and
              Tuesday/Thursday afternoons fill 2-3 weeks out. I've got [day at time] or [day at time] open.
              Which works?"
            </Quote>
            <p>Use real numbers.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Example (full flow)
            </h4>
            <Quote>
              "This kind of pattern doesn't resolve on its own. 6 months from now you're still working around
              it; couple years the MRI conversation gets heavier. What I see for you on the other side —
              picking up your kid without thinking, sleeping on your side again, sitting through a meeting
              and forgetting you have a back.
              <br /><br />
              Based on what you've told me — 8 months in, PT didn't hold, getting in the way of stuff you
              care about — what I'd recommend is the 8-session series. For context, I take about 6 new
              series clients a month and afternoons fill 2-3 weeks out. I've got Tuesday at 2 or Thursday
              at 11 open this week. Which works?"
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Which tier
            </h4>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-amari-border">
                  <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal">What you heard</th>
                  <th className="text-left py-1.5 font-semibold text-amari-charcoal">Recommend</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Acute, recent, healthy</td>
                  <td className="py-2 font-medium">Initial $225</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Chronic, localized</td>
                  <td className="py-2 font-medium">4-pack $720</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Chronic + multiple sites + been through the medical system</td>
                  <td className="py-2 font-medium">8-pack $1,295</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Surgery deadline / urgent</td>
                  <td className="py-2 font-medium">8-pack $1,295</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Acute injury, red flags, neuro symptoms</td>
                  <td className="py-2 font-medium">Refer out</td>
                </tr>
              </tbody>
            </table>
            <p className="text-amari-text-muted mt-2">Pick one tier.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              How to book it
            </h4>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL during the call.</li>
              <li>From the client's page in the staff app, tap the pay-link button for the recommended tier (Initial / 4-pack / 8-pack).</li>
              <li>Stay on the line. Walk them through paying — script below.</li>
              <li>Confirm payment came through. Confirm the slot back to them.</li>
            </ol>
            <p className="text-amari-text-muted">Don't tell them about the iPad / policies. They'll sign when they arrive.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Sending the pay link — script
            </h4>
            <p className="font-medium">Frame it:</p>
            <Quote>
              "Great — let's lock you in. Texting you the link now. Should take about a minute — you can
              Apple Pay it. Stay on with me."
            </Quote>
            <p className="font-medium">Tap the button.</p>
            <p className="font-medium">Narrate while they tap:</p>
            <Quote>"Got the text? Tap that — Stripe, totally secure..."</Quote>
            <p className="font-medium">When it confirms:</p>
            <Quote>
              "Got it on my end. You're in for Tuesday at 2. Looking forward to working with you."
            </Quote>
            <p className="font-medium pt-2">Rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>No link until you've heard a clear verbal yes</li>
              <li>Don't hang up before payment confirms</li>
              <li>Don't go silent while they pay — narrate</li>
              <li>Confirm immediately after payment lands</li>
            </ul>
          </div>
        </StepSection>

        <StepSection title="Handling push-back + objections (anytime)">
          <div>
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Push-back on the close
            </h4>
            <p className="font-medium">"Can we just start with one?"</p>
            <Quote>
              "Yes, absolutely. Most people in your situation end up wanting the series after the first — so
              know the $225 applies as credit toward a series if you convert."
            </Quote>
            <p className="font-medium pt-2">"Let me think about it."</p>
            <Quote>
              "Of course. Honestly — Tuesday at 2 is the next opening I have until [next available slot]. If
              you want it I'll hold it through tomorrow evening; after that I have to open it back up. Take
              your time either way."
            </Quote>
            <p className="text-amari-text-muted">Only say it if it's true.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Top objections
            </h4>
            <p className="font-medium">"I've tried everything, why would this be different?"</p>
            <Quote>
              "Everything you've tried treated the area that hurts. We work on what's pulling the area into
              pain. If no one's worked on the pattern instead of the symptom, that variable hasn't been
              tested."
            </Quote>
            <p className="font-medium pt-2">"How do I know it'll work for me?"</p>
            <Quote>
              "I don't guarantee. Most clients feel a real shift in the first session. If you don't, we talk
              about whether to keep going. I'm not selling you something that isn't working for your body."
            </Quote>
            <p className="font-medium pt-2">"It's a lot of money."</p>
            <Quote>"It is. Real quick — on a scale of 1 to 10, how ready are you to actually be out of pain?"</Quote>
            <p className="pl-3 mt-1">
              If <strong>8 or above:</strong> <em>"OK. Let's figure out what works for you. We can split it — half now, half at session 3 — if that helps."</em>
            </p>
            <p className="pl-3 mt-1">
              If <strong>7 or below:</strong> <em>"Got it. Then this might not be the right moment. Better to wait until you're actually ready than push through it now. Let me know when that shifts."</em>
            </p>
            <p className="font-medium pt-2">"My doctor said I need surgery."</p>
            <Quote>
              "Take that seriously. Surgery treats the structure. What's driving the structure to fail is
              usually a pattern. Work on the pattern for a few sessions — if it improves, you've avoided
              something irreversible. If not, surgery is still there."
            </Quote>
          </div>
        </StepSection>
      </div>
    </>
  );
}

// ── Partner Call ──

function PartnerCallPlaybook() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal mb-2">Partner Call</h1>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-2">
          15-minute call. Get them to book a free partner session.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          The free session is "give before you get." They experience the work, they refer. The call is
          logistics; the session is the pitch. Don't pitch the partner program on the call. Don't explain
          commission. Don't show them the partner page.
        </p>
      </header>

      <section className="staff-card mb-4">
        <ul className="text-sm text-amari-charcoal/90 leading-relaxed space-y-1 pl-1">
          <li><strong>Open</strong> → peer compliment + reason for calling</li>
          <li><strong>Listen</strong> → their body first, then their stuck client</li>
          <li><strong>Reflect</strong> → name the unserved slice in their book</li>
          <li><strong>Frame Amari as the second guide</strong> → not replacement, the stage their work doesn't cover</li>
          <li><strong>Invite + book</strong> → free session as give-before-you-get</li>
        </ul>
      </section>

      <div className="space-y-3">
        <StepSection title="1. Open (0–1 min)">
          <p>Specific compliment + reason for calling. Don't pre-negotiate the exit ramps.</p>
          <Quote>
            "Hey [name], it's Garrett. I came across [specific — their gym, their content, a mutual client].
            Most [trainers / golf pros / etc.] don't do that. The reason I'm calling — we serve similar
            people. Wanted to see if our work overlaps. You got 15 min?"
          </Quote>
          <p className="font-medium pt-2">Variant — when there's a mutual client (much warmer than cold):</p>
          <Quote>
            "Hey [name], it's Garrett. I'm working with [mutual client]. They mentioned you're their trainer.
            Wanted to coordinate care."
          </Quote>
        </StepSection>

        <StepSection title="2. Listen — their body first, then their stuck client (1–8 min)">
          <p>
            Lead with their body. Trainers, golf pros, Pilates teachers — they're all carrying something.
            Overuse, compensation, things they "train around." Get curious about it first.
          </p>
          <p className="font-medium">Open with body:</p>
          <Quote>"Before we talk about your clients — how's your own body holding up after all these years?"</Quote>
          <p>or:</p>
          <Quote>"You've been [coaching / training / teaching] how long? What's your body like at this point?"</Quote>
          <p>
            Listen the same way you would with any chronic-pain client. Permissible interjections:{' '}
            <em>"Tell me more."</em> <em>"What does that feel like?"</em> <em>"What have you tried?"</em>
          </p>
          <p>
            Their body is the entry point. They're going to feel something shift in the free session — that's
            what converts them.
          </p>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Then — their stuck client (around min 5)
            </h4>
            <p>Once you've heard about their body, pivot to their work:</p>
            <Quote>"And which clients do you find yourself wishing you had a better answer for?"</Quote>
            <p className="font-medium">Follow-ups:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><em>"What have they tried?"</em></li>
              <li><em>"What does the plateau look like?"</em></li>
              <li><em>"Who do you refer when that comes up — and how often does it hold?"</em></li>
            </ul>
            <p>
              You're locating the overlap: their body (what they'll feel shift in the session) + the stuck-client
              pattern (who Amari serves once they've felt it).
            </p>
          </div>
        </StepSection>

        <StepSection title="3. Reflect (8–10 min)">
          <p>Mirror back their body first, then their stuck-client pattern.</p>
          <Quote>
            "OK so what I'm hearing is — you've got [body part / how long it's been there], comes with the
            territory after [years coaching / training]. The clients you wish you had a better answer for are
            [pattern], and you refer to [where] but it doesn't always hold. Is that about right?"
          </Quote>
          <p className="font-medium pt-2">
            Don't: summarize abstractly. Skip ahead to telling them about Amari.
          </p>
        </StepSection>

        <StepSection title="4. Frame Amari as the second guide (10–12 min)">
          <p>Don't dump everything. Pick the angles that match what they told you.</p>

          <p className="font-medium">Position Amari as their second guide — not replacement, the stage their work doesn't cover:</p>
          <Quote>
            "Most of your stuck clients are caught in patterns their body learned years ago. You can program
            around it, strengthen around it — the pattern keeps pulling them back. That's the stage we work
            at. We teach them to feel where they're out of balance and bring it back themselves — every day,
            at home, for life."
          </Quote>

          <p className="font-medium">Different work (trainer / fitness pro):</p>
          <Quote>
            "We do different things. You're getting them stronger, more capable, looking like they want to
            look. We're working on what's underneath — the body being out of balance. When someone's out of
            balance, your work doesn't stick — they plateau or get hurt. Once they're back in balance, your
            work starts landing again."
          </Quote>

          <p className="font-medium">Feeling over doing (trainer-language hook):</p>
          <Quote>
            "It's not about crushing reps. It's about whether the right thing is firing. Your clients are
            trying to muscle through with things that have been shut down for years — no wonder it doesn't
            hold."
          </Quote>

          <p className="font-medium">The trainer story (use when there's a pause):</p>
          <Quote>
            "A very fit guy in his sixties came in with no complaints — just heard the tools were good. After
            one session he said, 'I didn't realize how heavy I was in my body. I didn't know I needed this.'"
          </Quote>
        </StepSection>

        <StepSection title="5. Invite + book (12–15 min)">
          <p className="font-medium">Ask permission first:</p>
          <Quote>"OK so given all that — want to come feel what this is for yourself?"</Quote>
          <p>Wait for yes. Then the give-before-you-get ask:</p>
          <Quote>
            "Honestly, reading about it won't tell you what this is. Twenty minutes of doing it will. You're
            going to feel something shift in your [body part they named] — you'll do the work, I'll guide
            you through it. Let me give you the full session — about an hour, totally free. The only ask:
            1) try it, 2) tell me what you noticed, 3) if you have stuck clients who'd be a fit, send them
            my way. Fair?"
          </Quote>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Book it
            </h4>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open GHL → contact → book on <strong>Partner Session</strong> calendar</li>
              <li>Add tags: <code>partner-prospect</code> + their category (<code>trainer</code>, <code>golf-instructor</code>, <code>pilates-teacher</code>, etc.)</li>
              <li>Confirm: <em>"Tuesday at 2. I'll text you a confirmation."</em></li>
              <li>Set expectations: <em>"You'll come in for an hour. We do an assessment, you experience the protocols, we talk about what you noticed. No prep needed."</em></li>
            </ol>
          </div>
        </StepSection>

        <StepSection title="Handling push-back + objections (anytime)">
          <div>
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Push-back on the invite
            </h4>
            <p className="font-medium">"I'd need to experience it before I refer anyone."</p>
            <Quote>"Exactly — that's why I'm inviting you in. The only way to really get it is to feel it."</Quote>
            <p className="font-medium pt-2">"My schedule's packed."</p>
            <Quote>
              "Is this a this-month thing or a this-quarter thing? I'd rather find the actual right moment
              than chase you."
            </Quote>
            <p className="font-medium pt-2">"Send me some info first."</p>
            <Quote>
              "Happy to — the info is really just a primer for the experience. Let me put a tentative session
              date down. Cancel if the materials don't land."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Top objections
            </h4>
            <p className="font-medium">"So it's like physical therapy?"</p>
            <Quote>
              "PT is good at restoring function by prescribing movement. Amari isn't a prescription — it's a
              scaffolding for discovering how to move so the overworked parts release and function comes back
              on its own."
            </Quote>
            <p className="text-amari-text-muted pl-3 text-xs">(Or your own line: <em>"I guarantee you I don't do what you think I do."</em>)</p>

            <p className="font-medium pt-2">"My clients already stretch / do yoga / foam roll."</p>
            <Quote>
              "Great for maintenance. This is different — it's figuring out why one side is doing all the
              work in the first place. Stretching a muscle that's compensating just gives it more slack when
              it actually needs to hold tension."
            </Quote>

            <p className="font-medium pt-2">"Is there science behind it?"</p>
            <Quote>
              "Doctor with 25 years in clinical practice. The protocols work with how the body distributes
              load — every part holds the weight equally, like a suspension bridge. When that breaks down,
              you get pain in the part that's overworking."
            </Quote>

            <p className="font-medium pt-2">"We already refer to a PT / chiro."</p>
            <Quote>
              "Great. We're not the same lane. We work with the clients they've already discharged, or the
              ones who never fit those modalities to begin with."
            </Quote>

            <p className="font-medium pt-2">"What's in it for me?"</p>
            <Quote>
              "Mostly status — you become the trainer known as the one who solved the un-fixable for their
              clients. We can talk about a referral structure after the session if it makes sense."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Direct "no"
            </h4>
            <Quote>
              "No problem at all. If you know anyone else who might be looking to expand their referral
              network, let me know. Anyway — what's new with your practice?"
            </Quote>
          </div>
        </StepSection>

        <StepSection title="After the session — where the partnership actually starts">
          <p>The call gets them in the door. The session converts them. The follow-up is what compounds.</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Handwritten thank-you within 48 hours.</strong> Chiro literature reports 3-4x referral lift from this single move vs. no follow-up.</li>
            <li><strong>GHL tag:</strong> <code>partner-active</code> + date of session.</li>
            <li><strong>Monthly touch</strong> for the next 6 months — one-paragraph update on a co-managed client when there is one.</li>
          </ol>
        </StepSection>
      </div>
    </>
  );
}

// ── Tabbed shell ──

type Tab = 'discovery' | 'partner';

export default function PlaybookPage() {
  const [tab, setTab] = useState<Tab>('discovery');

  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 px-3 text-sm font-medium rounded-md transition-colors min-h-[40px] ${
      active
        ? 'bg-white text-amari-charcoal shadow-sm'
        : 'text-amari-text-muted hover:text-amari-charcoal'
    }`;

  return (
    <div className="px-4 pt-4 pb-8 max-w-2xl mx-auto">
      <div className="sticky top-0 -mx-4 px-4 py-2 bg-amari-light-sand/95 backdrop-blur z-10 mb-3">
        <div className="flex gap-1 p-1 bg-amari-border/30 rounded-lg">
          <button onClick={() => setTab('discovery')} className={tabClass(tab === 'discovery')}>
            Discovery Call
          </button>
          <button onClick={() => setTab('partner')} className={tabClass(tab === 'partner')}>
            Partner Call
          </button>
        </div>
      </div>

      {tab === 'discovery' ? <DiscoveryCallPlaybook /> : <PartnerCallPlaybook />}
    </div>
  );
}
