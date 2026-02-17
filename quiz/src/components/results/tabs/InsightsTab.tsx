
import React from 'react';
import { QuizInsight } from '@/types/quiz';

type InsightsTabProps = {
  insights: QuizInsight[];
};

const InsightsTab = ({ insights }: InsightsTabProps) => {
  return (
    <div className="px-6 py-8 bg-amari-bone-white">
      {/* Header */}
      <div className="text-center mb-12 max-w-3xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-serif mb-4 text-amari-charcoal">Your Personal Insights</h2>
        <p className="text-lg font-sans text-amari-text-light">
          Based on your responses, we've identified several key insights about your unique pain pattern.
        </p>
      </div>

      {/* Insights List */}
      <div className="space-y-6 max-w-4xl mx-auto mb-12">
        {insights.map((insight, index) => (
          <div
            key={index}
            className="bg-white p-6 md:p-8 rounded-xl border-l-4 border-amari-pine-teal shadow-md hover:shadow-lg transition-shadow duration-300"
          >
            <div className="flex items-start gap-4">
              {/* Number Badge */}
              <div className="flex-shrink-0 w-10 h-10 bg-amari-pine-teal text-white rounded-full flex items-center justify-center font-ui font-semibold text-lg">
                {index + 1}
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl font-serif mb-3 text-amari-charcoal">
                  {insight.title}
                </h3>
                <p className="text-base md:text-lg font-sans text-amari-text-light leading-relaxed">
                  {insight.description}
                </p>
              </div>

              {/* Lightbulb Icon */}
              <div className="flex-shrink-0 hidden md:block">
                <svg className="w-8 h-8 text-amari-pine-teal opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The Missing Piece - Highlighted Section */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="bg-gradient-to-br from-amari-light-sand to-amari-oat p-8 md:p-10 rounded-xl shadow-lg border-2 border-amari-pine-teal">
          <div className="flex items-center justify-center gap-3 mb-6">
            <svg className="w-8 h-8 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <h3 className="text-2xl md:text-3xl font-serif text-amari-charcoal">The Missing Piece</h3>
          </div>

          <p className="text-lg font-sans text-amari-charcoal leading-relaxed mb-4">
            Most traditional approaches to pain focus solely on the symptoms or the specific area that hurts.
            This is why so many people experience temporary relief, only to have their pain return later.
          </p>

          <p className="text-lg font-sans text-amari-charcoal leading-relaxed">
            <strong className="text-amari-pine-teal">The Amari Method is different:</strong> We address your entire pattern by restoring balance between overworking and
            underworking parts, creating lasting change in how your body moves and functions.
          </p>
        </div>
      </div>

      {/* Subtle CTA */}
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-base font-sans text-amari-text-light mb-4">
          Ready to address these patterns at their source?
        </p>
        <p className="text-sm text-amari-pine-teal font-medium">
          → Check out the "Path Forward" tab to see your next steps
        </p>
      </div>
    </div>
  );
};

export default InsightsTab;
