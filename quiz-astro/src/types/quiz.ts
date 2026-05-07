
export type QuizAnswer = {
  question: string;
  answer: string | string[] | null;
};

export type PatternSignature = 
  | 'Protective Tension'
  | 'Structural Adaptation'
  | 'Established Pattern'
  | 'Functional Limitation'
  | 'Compensatory Movement';

export type ScoreCategories = {
  softTissueTension: number;
  jointBoneAlignment: number;
  patternDuration: number;
  dailyActivitiesImpact: number;
  bodyAdaptations: number;
  recoveryPotential: number;
};

export type QuizInsight = {
  title: string;
  description: string;
};

export type QuizSubmission = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  soft_tissue_tension: number;
  joint_bone_alignment: number;
  pattern_duration: number;
  daily_activities_impact: number;
  body_adaptations: number;
  recovery_potential: number;
  pattern_signature: string;
  pain_locations: string[];
  pain_duration: string;
  pain_intensity: string;
  pain_timing: string[];
  pain_qualities: string[];
  aggravating_activities: string[];
  life_impact: string[];
  treatments_tried: string[];
  treatment_results: string;
  other_conditions: string[];
  insights: string[];
  dominant_system: string;
};
