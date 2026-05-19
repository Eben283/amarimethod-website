
import React from 'react';

const QuizFooter = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="mt-12 py-6 border-t border-amari-oat text-center text-sm text-gray-600">
      <div className="flex flex-col md:flex-row justify-center gap-4 md:gap-8">
        <a 
          href="https://www.amarimethod.com/privacy-policy"
          className="text-amari-pine-teal hover:underline"
        >
          Privacy Policy
        </a>
        <a 
          href="https://www.amarimethod.com/terms-of-use"
          className="text-amari-pine-teal hover:underline"
        >
          Terms of Use
        </a>
      </div>
      <p className="mt-4">© {currentYear} Amari Method. All rights reserved.</p>
    </footer>
  );
};

export default QuizFooter;
