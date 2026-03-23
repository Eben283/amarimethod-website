
import { QuizAnswer, ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';

export function calculateScores(answers: QuizAnswer[]): ScoreCategories {
  const scores: ScoreCategories = {
    softTissueTension: 0,
    jointBoneAlignment: 0,
    patternDuration: 0,
    dailyActivitiesImpact: 0,
    bodyAdaptations: 0,
    recoveryPotential: 0,
  };

  // Answer indices (updated with new Q2 trigger question):
  // Q1=0: Primary pain location
  // Q2=1: Pain trigger (NEW)
  // Q3=2: Additional pain locations
  // Q4=3: Pain duration
  // Q5=4: Pain intensity
  // Q6=5: Pain timing
  // Q7=6: Pain qualities
  // Q8=7: Aggravating activities
  // Q9=8: Life impact
  // Q10=9: Treatments tried
  // Q11=10: Treatment results
  // Q12=11: Other conditions
  // Q13=12: Contact info

  // Calculate Soft Tissue Tension score (Q1, Q3, Q6, Q7, Q8)
  const primaryPainLocation = answers[0].answer as string;
  const painTrigger = answers[1]?.answer as string;
  const additionalPainLocations = answers[2]?.answer as string[];
  const painTiming = answers[5]?.answer as string[];
  const painQualities = answers[6]?.answer as string[];
  const aggravatingActivities = answers[7]?.answer as string[];
  
  // Calculate based on primary pain location (Q1)
  if (['Neck', 'Shoulders', 'Upper back'].includes(primaryPainLocation)) {
    scores.softTissueTension += 20;
  } else if (['Lower back', 'Hips'].includes(primaryPainLocation)) {
    scores.softTissueTension += 15;
  }
  
  // Calculate based on additional pain locations (Q2)
  if (additionalPainLocations && additionalPainLocations.length > 0) {
    if (additionalPainLocations.some(loc => ['Neck', 'Shoulders', 'Upper back'].includes(loc))) {
      scores.softTissueTension += 10;
    }
  }
  
  // Calculate based on pain timing (Q5)
  if (painTiming && painTiming.includes('After physical activity')) {
    scores.softTissueTension += 15;
  }
  if (painTiming && painTiming.includes('After sitting for long periods')) {
    scores.softTissueTension += 15;
  }
  
  // Calculate based on pain qualities (Q7 - updated for combined options)
  if (painQualities) {
    const tensionQualities = ['Tight or stiff', 'Dull or achy', 'Throbbing'];
    const matchCount = painQualities.filter(qual => tensionQualities.includes(qual)).length;
    scores.softTissueTension += matchCount * 10;
  }

  // Calculate based on aggravating activities (Q8)
  if (aggravatingActivities) {
    const tensionActivities = ['Sitting', 'Standing for long periods', 'Repetitive movements'];
    const matchCount = aggravatingActivities.filter(act => tensionActivities.includes(act)).length;
    scores.softTissueTension += matchCount * 10;
  }
  
  // Normalize to 0-100 scale
  scores.softTissueTension = Math.min(100, scores.softTissueTension);

  // Calculate Joint & Bone Alignment score (Q1, Q2, Q6, Q7)
  // Calculate based on primary pain location (Q1)
  if (['Knees', 'Ankles/Feet', 'Hips'].includes(primaryPainLocation)) {
    scores.jointBoneAlignment += 20;
  } else if (['Lower back', 'Neck'].includes(primaryPainLocation)) {
    scores.jointBoneAlignment += 15;
  }
  
  // Calculate based on additional pain locations (Q2)
  if (additionalPainLocations && additionalPainLocations.length > 0) {
    if (additionalPainLocations.some(loc => ['Knees', 'Ankles/Feet', 'Hips'].includes(loc))) {
      scores.jointBoneAlignment += 10;
    }
  }
  
  // Calculate based on pain qualities (Q7 - updated for combined options)
  if (painQualities) {
    const alignmentQualities = ['Sharp or stabbing', 'Pinching', 'Burning', 'Shooting down arm/leg'];
    const matchCount = painQualities.filter(qual => alignmentQualities.includes(qual)).length;
    scores.jointBoneAlignment += matchCount * 10;
  }

  // Calculate based on aggravating activities (Q8)
  if (aggravatingActivities) {
    const alignmentActivities = ['Walking/Running', 'Going up/down stairs', 'Lifting or carrying objects', 'Twisting or rotating'];
    const matchCount = aggravatingActivities.filter(act => alignmentActivities.includes(act)).length;
    scores.jointBoneAlignment += matchCount * 10;
  }
  
  // Normalize to 0-100 scale
  scores.jointBoneAlignment = Math.min(100, scores.jointBoneAlignment);

  // Calculate Pattern Duration score (Q4)
  const painDuration = answers[3]?.answer as string;

  if (painDuration === 'Less than 1 week') {
    scores.patternDuration = 10;
  } else if (painDuration === '1-4 weeks') {
    scores.patternDuration = 25;
  } else if (painDuration === '1-3 months') {
    scores.patternDuration = 40;
  } else if (painDuration === '3-6 months') {
    scores.patternDuration = 60;
  } else if (painDuration === '6-12 months') {
    scores.patternDuration = 80;
  } else if (painDuration === 'More than 1 year') {
    scores.patternDuration = 100;
  }

  // Calculate Daily Activities Impact score (Q5, Q8, Q9)
  const painIntensity = answers[4]?.answer as string;
  const lifeImpact = answers[8]?.answer as string[];
  
  // Calculate based on pain intensity (Q4)
  if (painIntensity === 'Mild (1-3)') {
    scores.dailyActivitiesImpact += 10;
  } else if (painIntensity === 'Moderate (4-6)') {
    scores.dailyActivitiesImpact += 30;
  } else if (painIntensity === 'Severe (7-10)') {
    scores.dailyActivitiesImpact += 50;
  }
  
  // Calculate based on aggravating activities (Q8)
  if (aggravatingActivities && aggravatingActivities.length > 0) {
    scores.dailyActivitiesImpact += Math.min(30, aggravatingActivities.length * 10);
  }

  // Calculate based on life impact (Q9)
  if (lifeImpact) {
    scores.dailyActivitiesImpact += lifeImpact.length * 10;
  }

  // Normalize to 0-100 scale
  scores.dailyActivitiesImpact = Math.min(100, scores.dailyActivitiesImpact);

  // Calculate Body's Adaptations score (Q1, Q2, Q3, Q6, Q12)
  const otherConditions = answers[11]?.answer as string[];
  
  // Calculate based on pain trigger (Q2 - NEW)
  if (painTrigger === 'Gradual onset over time (no specific event)') {
    scores.bodyAdaptations += 20;  // Suggests long-term adaptation
  } else if (painTrigger === 'Stress or emotional factors') {
    scores.bodyAdaptations += 25;  // Deep pattern connection
  }

  // Calculate based on multiple pain locations (Q1, Q3)
  if (additionalPainLocations && additionalPainLocations.length > 0) {
    scores.bodyAdaptations += Math.min(50, additionalPainLocations.length * 15);
  }

  // Calculate based on pain timing (Q6)
  if (painTiming && painTiming.includes('In the morning, right after waking up')) {
    scores.bodyAdaptations += 20;
  }
  if (painTiming && painTiming.includes('At night, when trying to sleep')) {
    scores.bodyAdaptations += 15;
  }

  // Calculate based on other conditions (Q12)
  if (otherConditions && otherConditions.length > 0) {
    scores.bodyAdaptations += Math.min(30, otherConditions.length * 10);
  }
  
  // Normalize to 0-100 scale
  scores.bodyAdaptations = Math.min(100, scores.bodyAdaptations);

  // Calculate Recovery Potential score (Q2, Q4, Q10, Q11, Q12)
  const treatmentsTried = answers[9]?.answer as string[];
  const treatmentResults = answers[10]?.answer as string;

  // Base potential starts high because Amari Method is effective
  // Most people have 70-85% recovery potential with the right approach
  let recoveryPotential = 85;

  // Boost based on pain trigger (Q2 - NEW)
  if (painTrigger === 'Sudden injury or accident') {
    recoveryPotential += 10;  // Acute trauma responds very well
  } else if (painTrigger === 'After starting a new activity/exercise') {
    recoveryPotential += 5;   // Recent onset, good prognosis
  }

  // Reduce based on pain duration (Q4)
  if (painDuration === 'More than 1 year') {
    recoveryPotential -= 15;  // Reduced penalty - still very treatable
  } else if (painDuration === '6-12 months') {
    recoveryPotential -= 8;
  } else if (painDuration === '3-6 months') {
    recoveryPotential -= 3;
  } else if (painDuration === 'Less than 1 week') {
    recoveryPotential += 10;  // Acute injuries respond very well
  }

  // Reduce based on treatment history (Q10, Q11)
  if (treatmentsTried && treatmentsTried.length > 3) {
    recoveryPotential -= 8;  // Multiple failed treatments suggests complexity
  }

  if (treatmentResults === 'No improvement') {
    recoveryPotential -= 12;  // Pattern needs different approach
  } else if (treatmentResults === 'Temporary relief, but pain returned') {
    recoveryPotential -= 5;   // Good sign - body can change, just needs right method
  } else if (treatmentResults === 'Significant improvement but not complete') {
    recoveryPotential += 5;   // Responds well to treatment
  }

  // Reduce based on complex conditions (Q12)
  if (otherConditions && otherConditions.some(cond =>
    ['Fibromyalgia', 'Autoimmune condition', 'Chronic fatigue'].includes(cond))) {
    recoveryPotential -= 15;  // More complex, but still treatable
  }

  // Normalize to 0-100 scale (most people will be 65-90%)
  scores.recoveryPotential = Math.min(100, Math.max(88, recoveryPotential));

  return scores;
}

export function determinePatternSignature(scores: ScoreCategories): PatternSignature {
  // Find the category with the highest score
  const categories = [
    { name: 'Protective Tension', score: scores.softTissueTension },
    { name: 'Structural Adaptation', score: scores.jointBoneAlignment },
    { name: 'Established Pattern', score: scores.patternDuration },
    { name: 'Functional Limitation', score: scores.dailyActivitiesImpact },
    { name: 'Compensatory Movement', score: scores.bodyAdaptations },
  ];
  
  const sortedCategories = [...categories].sort((a, b) => b.score - a.score);
  
  return sortedCategories[0].name as PatternSignature;
}

export function generateInsights(answers: QuizAnswer[], scores: ScoreCategories): QuizInsight[] {
  const insights: QuizInsight[] = [];

  // Insight 1: Lower back pain AND Sitting
  if (
    (answers[0].answer === 'Lower back' ||
     (answers[2]?.answer && (answers[2].answer as string[]).includes('Lower back'))) &&
    (answers[7]?.answer && (answers[7].answer as string[]).includes('Sitting'))
  ) {
    insights.push({
      title: 'Your Sitting-to-Standing Connection',
      description: 'The transition between sitting and standing is creating a pattern your body is working to stabilize. This repetitive movement stress is contributing to your pain pattern.'
    });
  }

  // Insight 2: Lower back pain AND Hip pain
  if (
    ((answers[0].answer === 'Lower back' &&
     (answers[2]?.answer && (answers[2].answer as string[]).includes('Hips'))) ||
     (answers[0].answer === 'Hips' &&
     (answers[2]?.answer && (answers[2].answer as string[]).includes('Lower back'))))
  ) {
    insights.push({
      title: 'The Hip-Back Relationship',
      description: 'Your hips and lower back are in a continuous conversation, creating a reinforcing pattern. When one area compensates, the other takes on additional stress.'
    });
  }

  // Insight 3: Morning pain timing
  if (answers[5]?.answer && (answers[5].answer as string[]).includes('In the morning, right after waking up')) {
    insights.push({
      title: 'Your Morning Reset Pattern',
      description: 'Your body uses sleep to reset, but the transition to vertical movement creates a challenge. This indicates a deeper postural pattern where balance can be restored.'
    });
  }

  // Insight 4: Long-established pattern
  if (scores.patternDuration > 70) {
    insights.push({
      title: 'Your Established Neural Pathway',
      description: 'Your movement patterns have created well-traveled neural pathways that your brain can relearn. The duration of your pattern suggests it has become your body\'s "default setting."'
    });
  }

  // Insight 5: Multiple pain locations and aggravating activities
  if (
    answers[2]?.answer && (answers[2].answer as string[]).length >= 3 &&
    answers[7]?.answer && (answers[7].answer as string[]).length >= 1
  ) {
    insights.push({
      title: 'Your Movement Signature',
      description: 'Your body has developed a specific way of moving to protect itself that creates its own challenges. These multiple areas of discomfort are part of a connected pattern.'
    });
  }

  // NEW Insight 6: Desk posture pattern (Neck/Upper back + Sitting + Work impact)
  if (
    ['Neck', 'Shoulders', 'Upper back'].includes(answers[0].answer as string) &&
    (answers[7]?.answer && (answers[7].answer as string[]).includes('Sitting')) &&
    (answers[8]?.answer && (answers[8].answer as string[]).includes('Work performance'))
  ) {
    insights.push({
      title: 'Your Desk Posture Pattern',
      description: 'Your upper body pain is directly connected to prolonged sitting and work demands. This creates a cycle where tension builds throughout the day, reinforcing protective muscle patterns.'
    });
  }

  // NEW Insight 7: Sleep-pain cycle (Night pain + Sleep quality impact)
  if (
    (answers[5]?.answer && (answers[5].answer as string[]).includes('At night, when trying to sleep')) &&
    (answers[8]?.answer && (answers[8].answer as string[]).includes('Sleep quality'))
  ) {
    insights.push({
      title: 'The Sleep-Pain Cycle',
      description: 'Your pain disrupts sleep, and poor sleep amplifies pain sensitivity. Breaking this cycle requires addressing both the physical pattern and the sleep position strategies your body has developed.'
    });
  }

  // NEW Insight 8: Multiple failed treatments
  if (
    answers[9]?.answer && (answers[9].answer as string[]).length >= 3 &&
    answers[10]?.answer === 'No improvement'
  ) {
    insights.push({
      title: 'Why Past Treatments Haven\'t Worked',
      description: 'Your experience with multiple treatments suggests they addressed symptoms, not the underlying movement pattern. The Amari Method targets the root cause—the imbalance creating your pain.'
    });
  }
  
  // If we don't have at least 3 insights, add generic ones based on pattern signature
  if (insights.length < 3) {
    if (scores.softTissueTension > scores.jointBoneAlignment) {
      insights.push({
        title: 'Your Muscle Protection Response',
        description: 'Your muscles are working overtime to create stability in your body. This protective tension pattern is your body\'s attempt to provide support where it perceives weakness.'
      });
    } else {
      insights.push({
        title: 'Your Structural Compensation Pattern',
        description: 'Your body has adjusted its alignment to minimize stress on sensitive areas. These adaptations may provide short-term relief but create long-term patterns.'
      });
    }
    
    if (scores.dailyActivitiesImpact > 60) {
      insights.push({
        title: 'Your Daily Movement Barriers',
        description: 'The way your pain affects daily activities reveals important clues about your movement patterns. Your body has created specific strategies to protect itself during these movements.'
      });
    }
  }
  
  // Return 3-4 insights maximum
  return insights.slice(0, 4);
}
