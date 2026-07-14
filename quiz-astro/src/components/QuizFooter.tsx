import React from 'react';

const QuizFooter = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="qfoot">
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <a href="https://www.amarimethod.com/privacy-policy">Privacy Policy</a>
        <a href="https://www.amarimethod.com/terms-of-use">Terms of Use</a>
      </div>
      <p>© {currentYear} Amari Method</p>
    </footer>
  );
};

export default QuizFooter;
