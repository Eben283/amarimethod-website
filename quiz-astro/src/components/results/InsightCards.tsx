
import React from 'react';
import { QuizInsight } from '@/types/quiz';

type InsightCardsProps = {
  insights: QuizInsight[];
};

const InsightCards = ({ insights }: InsightCardsProps) => {
  return (
    <section className="px-6 py-10 bg-amari-bone-white">
      <div className="max-w-3xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal mb-2">
            What We Discovered About You
          </h2>
          <p className="text-base text-amari-text-light font-sans max-w-xl mx-auto">
            Based on your responses, here are the key patterns specific to your situation.
          </p>
        </div>

        {/* Insight cards */}
        <div className="space-y-4 mb-10">
          {insights.map((insight, index) => (
            <div
              key={index}
              className="bg-white rounded-xl border border-amari-border shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
            >
              <div className="flex items-stretch gap-0">
                {/* Left accent bar */}
                <div className="w-1 flex-shrink-0" style={{ backgroundColor: '#EBA584' }} />

                <div className="flex items-start gap-4 p-5 md:p-6 flex-1">
                  {/* Numbered badge */}
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: '#EBA584' }}
                  >
                    <span className="text-white font-serif font-bold text-sm leading-none">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <h3 className="text-lg md:text-xl font-serif text-amari-charcoal mb-2">
                      {insight.title}
                    </h3>
                    <p className="text-sm md:text-base font-sans text-amari-text-light leading-relaxed">
                      {insight.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* The Missing Piece callout */}
        <div className="bg-gradient-to-br from-amari-light-sand to-amari-oat p-7 md:p-9 rounded-xl border-2 border-amari-pine-teal shadow-md">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-7 h-7 text-amari-pine-teal flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <h3 className="text-xl md:text-2xl font-serif text-amari-charcoal">The Missing Piece</h3>
          </div>
          <p className="text-base font-sans text-amari-charcoal leading-relaxed mb-3">
            Most traditional approaches focus only on symptoms or the area that hurts. That's why so many people get temporary relief—then the pain returns.
          </p>
          <p className="text-base font-sans text-amari-charcoal leading-relaxed">
            <strong className="text-amari-pine-teal">The Amari Method is different:</strong> We address your entire pattern by restoring balance between overworking and underworking parts—creating lasting change in how your body moves.
          </p>
        </div>
      </div>
    </section>
  );
};

export default InsightCards;
