import React from 'react';

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
  validationError: string;
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
  validationError,
}: ContactInfoFormProps) => {
  return (
    <section className="screen contact">
      <span className="eyebrow" style={{ color: 'var(--rust)', display: 'block', marginBottom: 16 }}>
        Last step
      </span>
      <h2>Where should we send your reading?</h2>
      <p className="lede">
        Your results open on the next screen. We'll also email you a copy so you can come back to it.
      </p>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input
            type="text"
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First"
            required
            autoComplete="given-name"
          />
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input
            type="text"
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last"
            required
            autoComplete="family-name"
          />
        </div>
        <div className="field full">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="field full">
          <label htmlFor="phone">
            Phone <span style={{ textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            type="tel"
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
            autoComplete="tel"
          />
        </div>
      </form>

      {validationError && (
        <p className="q-err" style={{ marginTop: 16 }} role="alert">
          {validationError}
        </p>
      )}

      <div className="go">
        <button type="button" onClick={onSubmit} disabled={isSubmitting} className="btn">
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
