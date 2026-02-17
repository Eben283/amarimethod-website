
import React, { useState } from 'react';
import { ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';
import OverviewTab from './tabs/OverviewTab';
import InsightsTab from './tabs/InsightsTab';
import PathForwardTab from './tabs/PathForwardTab';

type ResultsTabsProps = {
  patternSignature: PatternSignature;
  scores: ScoreCategories;
  insights: QuizInsight[];
};

const ResultsTabs = ({ patternSignature, scores, insights }: ResultsTabsProps) => {
  const [activeTab, setActiveTab] = useState('path-forward');

  return (
    <div className="mt-8">
      <div className="border-b border-amari-oat">
        <nav className="flex -mb-px">
          <button
            onClick={() => setActiveTab('path-forward')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-sm md:text-base transition-colors ${
              activeTab === 'path-forward'
                ? 'border-amari-pine-teal text-amari-pine-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Path Forward
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-sm md:text-base transition-colors ${
              activeTab === 'overview'
                ? 'border-amari-pine-teal text-amari-pine-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-sm md:text-base transition-colors ${
              activeTab === 'insights'
                ? 'border-amari-pine-teal text-amari-pine-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Insights
          </button>
        </nav>
      </div>

      <div className="py-8 animate-fade-in">
        {activeTab === 'overview' && <OverviewTab patternSignature={patternSignature} scores={scores} />}
        {activeTab === 'insights' && <InsightsTab insights={insights} />}
        {activeTab === 'path-forward' && <PathForwardTab patternSignature={patternSignature} />}
      </div>
    </div>
  );
};

export default ResultsTabs;
