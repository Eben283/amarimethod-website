import React, { useRef, useState } from 'react';

type ContactInfoFormProps = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  setFirstName: (name: string) => void;
  setLastName: (name: string) => void;
  setEmail: (email: string) => void;
  setPhone: (phone: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
};

const ContactInfoForm = ({
  firstName,
  lastName,
  email,
  phone,
  setFirstName,
  setLastName,
  setEmail,
  setPhone,
  onSubmit,
  onBack,
  isSubmitting,
}: ContactInfoFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submitContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Read the form itself. This includes browser/autofill values, which do
    // not reliably dispatch React change events before a visitor clicks submit.
    const values = new FormData(event.currentTarget);
    const nextFirstName = String(values.get('firstName') || '').trim();
    const nextLastName = String(values.get('lastName') || '').trim();
    const nextEmail = String(values.get('email') || '').trim();
    const nextPhone = String(values.get('phone') || '').trim();
    const errors: Record<string, string> = {};

    if (!nextFirstName) errors.firstName = 'Enter your first name.';
    if (!nextLastName) errors.lastName = 'Enter your last name.';
    if (!nextEmail) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) errors.email = 'Enter a valid email address.';

    setFieldErrors(errors);
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`#${firstInvalid}`)?.focus();
      return;
    }

    setFirstName(nextFirstName);
    setLastName(nextLastName);
    setEmail(nextEmail);
    setPhone(nextPhone);

    // Let the controlled state update before the context submits its payload.
    window.setTimeout(onSubmit, 0);
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  return (
    <section className="screen contact">
      <span className="eyebrow" style={{ color: 'var(--rust)', display: 'block', marginBottom: 16 }}>
        Last step
      </span>
      <h2>Where should we send your reading?</h2>
      <p className="lede">
        Your results open on the next screen. We'll also email you a copy so you can come back to it.
      </p>
      <p className="form-requirements"><span aria-hidden="true">*</span> Required</p>

      <form
        ref={formRef}
        className="form"
        noValidate
        onSubmit={submitContact}
      >
        <div className="field">
          <label htmlFor="firstName">First name <span className="required-mark" aria-hidden="true">*</span></label>
          <input
            type="text"
            id="firstName"
            name="firstName"
            value={firstName}
            onChange={(e) => { setFirstName(e.target.value); clearFieldError('firstName'); }}
            placeholder="First"
            required
            aria-required="true"
            aria-invalid={Boolean(fieldErrors.firstName)}
            aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined}
            autoComplete="given-name"
          />
          {fieldErrors.firstName && <p className="field-error" id="firstName-error" role="alert">{fieldErrors.firstName}</p>}
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name <span className="required-mark" aria-hidden="true">*</span></label>
          <input
            type="text"
            id="lastName"
            name="lastName"
            value={lastName}
            onChange={(e) => { setLastName(e.target.value); clearFieldError('lastName'); }}
            placeholder="Last"
            required
            aria-required="true"
            aria-invalid={Boolean(fieldErrors.lastName)}
            aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined}
            autoComplete="family-name"
          />
          {fieldErrors.lastName && <p className="field-error" id="lastName-error" role="alert">{fieldErrors.lastName}</p>}
        </div>
        <div className="field full">
          <label htmlFor="email">Email <span className="required-mark" aria-hidden="true">*</span></label>
          <input
            type="email"
            id="email"
            name="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
            placeholder="you@email.com"
            required
            aria-required="true"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            autoComplete="email"
          />
          {fieldErrors.email && <p className="field-error" id="email-error" role="alert">{fieldErrors.email}</p>}
        </div>
        <div className="field full">
          <label htmlFor="phone">
            Phone <span style={{ textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
            autoComplete="tel"
          />
        </div>

        <div className="go">
          <button type="submit" disabled={isSubmitting} className="btn">
          {isSubmitting ? (
            'Processing…'
          ) : (
            <>
              See my result <span className="arrow">→</span>
            </>
          )}
          </button>
          <span className="privacy">Private. Read only by Garrett. No spam, ever.</span>
        </div>
      </form>

      <p className="legal">
        By submitting, you agree to our{' '}
        <a href="https://www.amarimethod.com/privacy-policy">Privacy Policy</a>
        {' '}and{' '}
        <a href="https://www.amarimethod.com/terms-of-use">Terms of Use</a>.
      </p>

      <div style={{ marginTop: 26 }}>
        <button type="button" onClick={onBack} className="q-back" aria-label="Back">
          ←
        </button>
      </div>
    </section>
  );
};

export default ContactInfoForm;
