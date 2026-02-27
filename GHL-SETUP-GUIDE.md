# GHL Setup Guide — Affiliate/Referral System

## 1. Create Custom Field: `referral_source`

In GHL: Settings > Custom Fields > Contact > Add Field

| Setting | Value |
|---------|-------|
| Label | Referral Source |
| Key | `referral_source` |
| Type | Single Line Text |
| Group | General (or create "Referral Tracking") |

After creating, copy the field ID and update these files:
- `functions/api/send-to-ghl.js` — Add to FIELD_IDS object
- `functions/api/affiliate-refer.js` — Add to custom fields update step

---

## 2. Workflow: Affiliate Referral Submitted

**Trigger:** Tag Added = `affiliate-referral`

**Actions:**

### A) SMS to Client (Mike)
- Wait 2 minutes
- Send SMS:
  > Hi {contact.firstName}! {referral_source} mentioned you might be dealing with some pain. Take this free 2-minute assessment to see what's going on: https://www.amarimethod.com/client-landing?ref={referral_source}
  >
  > — Dr. Garrett, Amari Method

### B) SMS to Referring Partner (Sarah)
- Internal notification (SMS or email to partner)
- Need: A way to look up the partner's phone from the referral_source value
- Option 1: Store partner contacts as GHL contacts with tag `affiliate-partner`, look up by name
- Option 2: Hardcode partner numbers in a workflow branch (simpler for now)
- Message:
  > Hey {referral_source}! Got your referral for {contact.firstName}. We're reaching out now. We'll keep you posted. — Amari Method

### C) SMS to Garrett
- Internal notification:
  > New affiliate referral: {contact.firstName} {contact.lastName} from partner {referral_source}. Phone: {contact.phone}

---

## 3. Workflow: New Partner Onboarding

**Trigger:** Tag Added = `affiliate-partner`

**Actions:**
- Send SMS:
  > Welcome to the Amari Method partner program, {contact.firstName}! Here are your links:
  >
  > Your partner page (share with clients): https://www.amarimethod.com/client-landing?ref={contact.firstName}
  >
  > Submit a referral: https://www.amarimethod.com/refer?ref={contact.firstName}
  >
  > Your partner app (add to home screen): https://www.amarimethod.com/partner-app?ref={contact.firstName}
  >
  > Questions? Just text back. — Dr. Garrett

---

## 4. Workflow: 48-Hour Follow-Up (No Booking)

**Trigger:** Tag Added = `affiliate-referral`

**Actions:**
- Wait 48 hours
- IF contact has NO appointments (check `hs_num_associated_appointments` = 0 or check appointments API)
- Send SMS:
  > Hey {contact.firstName}! Just checking in. Did you get a chance to take the free assessment? Here's the link if you need it: https://www.amarimethod.com/client-landing?ref={referral_source}
  >
  > No pressure at all — happy to answer any questions. — Dr. Garrett

---

## 5. Workflow: Post-Session Follow-Up

**Trigger:** Appointment Status = Completed (or Tag Added = `session-completed`)

**Actions:**

### A) Follow-up to Client (Mike) — 2 hours after session
- Send SMS:
  > Hey {contact.firstName}! Great working with you today. Remember those exercises we went over — try to do them once a day this week. Text me if anything comes up. — Dr. Garrett

### B) Status update to Partner (Sarah) — same day
- Need to look up partner from referral_source field
- Send SMS:
  > Hey {referral_source}! Just finished up with {contact.firstName}. Session went well. They've got their exercises and we'll follow up in a few days. Thanks for the referral! — Dr. Garrett

---

## Notes

- All workflows are configured in GHL: Automation > Workflows
- Partner contacts should be tagged `affiliate-partner` and have their phone number stored
- The `referral_source` custom field stores the partner's first name (lowercase) — used for linking referrals back to partners
- Quiz submissions from `?ref=` URLs already tag contacts with `referred-by-{name}` and set source to `Pain Assessment Quiz (ref: {name})`
- Affiliate-refer form submissions tag contacts with `affiliate-referral` and set source to `Affiliate Referral - {name}`
