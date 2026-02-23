
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { QuizAnswer, ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';
import { calculateScores, determinePatternSignature, generateInsights } from '@/lib/quizLogic';
import { useToast } from '@/components/ui/use-toast';

type QuizContextType = {
  currentStep: number;
  totalSteps: number;
  answers: QuizAnswer[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  scores: ScoreCategories | null;
  patternSignature: PatternSignature | null;
  insights: QuizInsight[];
  isSubmitting: boolean;
  isLoading: boolean;
  isProcessing: boolean;
  isCompleted: boolean;
  submissionError: string | null;
  validationError: string;
  goToNextStep: () => void;
  goToPrevStep: () => void;
  skipStep: () => void;
  setAnswer: (index: number, answer: string | string[] | null) => void;
  setFirstName: (value: string) => void;
  setLastName: (value: string) => void;
  setEmail: (value: string) => void;
  setPhone: (value: string) => void;
  submitQuiz: () => Promise<boolean>;
  retrySubmission: () => Promise<boolean>;
  resetQuiz: () => void;
  hasStarted: boolean;
  startQuiz: () => void;
};

const QuizContext = createContext<QuizContextType | undefined>(undefined);

// GA4 event helper — fires only if gtag is loaded (safe to call even before GA initializes)
function trackEvent(eventName: string, params?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', eventName, params);
  }
}

export function QuizProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps] = useState(13);  // Updated from 12 to 13 (added trigger question)
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [scores, setScores] = useState<ScoreCategories | null>(null);
  const [patternSignature, setPatternSignature] = useState<PatternSignature | null>(null);
  const [insights, setInsights] = useState<QuizInsight[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const startQuiz = useCallback(() => setHasStarted(true), []);

  // Always-current refs so setTimeout callbacks (auto-advance) read fresh state
  const answersRef = useRef<QuizAnswer[]>([]);
  answersRef.current = answers;
  const currentStepRef = useRef(0);
  currentStepRef.current = currentStep;

  useEffect(() => {
    setAnswers([
      { question: "Where is your pain primarily located?", answer: null },
      { question: "What do you think triggered or worsened your pain?", answer: null },
      { question: "Do you experience pain in any additional areas?", answer: [] },
      { question: "How long have you been experiencing this pain?", answer: null },
      { question: "How would you describe your pain intensity?", answer: null },
      { question: "When do you typically experience pain?", answer: [] },
      { question: "What type of pain are you experiencing?", answer: [] },
      { question: "What activities make your pain worse?", answer: [] },
      { question: "Does your pain affect any of the following aspects of your life?", answer: [] },
      { question: "Have you tried any treatments for your pain?", answer: [] },
      { question: "How would you describe your results from previous treatments?", answer: null },
      { question: "Do you have any other health conditions?", answer: [] }
    ]);
  }, []);

  const goToNextStep = () => {
    // Read from refs so this is safe to call from a stale setTimeout closure
    const step = currentStepRef.current;
    const ans = answersRef.current;

    setValidationError(''); // clear any previous error on each attempt
    if (step === 0 && !ans[0]?.answer) {
      setValidationError('Please select where your pain is primarily located');
      return;
    }
    if (step === 1 && !ans[1]?.answer) {
      setValidationError('Please select what triggered your pain');
      return;
    }
    if (step === 3 && !ans[3]?.answer) {
      setValidationError("Please select how long you've been experiencing this pain");
      return;
    }
    if (step === 4 && !ans[4]?.answer) {
      setValidationError('Please select your pain intensity');
      return;
    }
    if (
      step === 10 &&
      ans[9]?.answer &&
      (ans[9].answer as string[]).length > 0 &&
      !(ans[9].answer as string[]).includes("I haven't tried any treatments") &&
      !ans[10]?.answer
    ) {
      setValidationError('Please describe your results from previous treatments');
      return;
    }
    if (step === 12) {
      if (!firstName.trim() || !lastName.trim()) {
        setValidationError('Please enter your first and last name');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email.trim() || !emailRegex.test(email)) {
        setValidationError('Please enter a valid email address');
        return;
      }
      submitQuiz();
      return;
    }
    // Fire quiz_start when user leaves step 0 (first real engagement)
    if (step === 0) {
      trackEvent('quiz_start');
    }
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const goToPrevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 0));

  const skipStep = () => {
    // Skip function bypasses validation for optional questions
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const setAnswer = (index: number, answer: string | string[] | null) => {
    const newAnswers = [...answers];
    newAnswers[index] = { ...newAnswers[index], answer };
    setAnswers(newAnswers);
    setValidationError(''); // clear inline error as soon as user makes a selection
  };

  // Use the API route at /api/send-to-ghl (Cloudflare Pages Function)
  const apiRoute = "/api/send-to-ghl";

  const sendContactToAPI = async (
    calculatedScores: ScoreCategories,
    signature: PatternSignature
  ): Promise<Response> => {
    const primaryPainLocation = answers[0]?.answer as string;
    const painTrigger = answers[1]?.answer as string;
    const painDuration = answers[3]?.answer as string;
    const treatmentsRaw = answers[9]?.answer as string[];
    const treatmentsTried = Array.isArray(treatmentsRaw)
      ? treatmentsRaw.filter(t => t !== "I haven't tried any treatments").join(', ')
      : '';

    // Determine severity from recovery potential score
    let painSeverity = 'moderate';
    if (calculatedScores.recoveryPotential >= 80) painSeverity = 'mild';
    else if (calculatedScores.recoveryPotential < 60) painSeverity = 'severe';

    const contactData = {
      firstName,
      lastName,
      email,
      phone,
      patternSignature: signature || 'Unknown',
      recoveryPotentialScore: calculatedScores.recoveryPotential || 0,
      primaryPainLocation: primaryPainLocation || 'Unknown',
      painSeverity,
      painDuration: painDuration || '',
      treatmentsTried: treatmentsTried || '',
      painTrigger: painTrigger || '',
    };

    console.log('Sending data to API at:', apiRoute);
    console.log('Contact data:', contactData);

    return fetch(apiRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contactData)
    });
  };

  const submitQuiz = async (): Promise<boolean> => {
    setIsSubmitting(true);
    setIsLoading(true);
    setSubmissionError(null);

    try {
      const calculatedScores = calculateScores(answers);
      const signature = determinePatternSignature(calculatedScores);
      const generatedInsights = generateInsights(answers, calculatedScores);
      setScores(calculatedScores);
      setPatternSignature(signature);
      setInsights(generatedInsights);

      // Show processing screen
      setIsProcessing(true);

      const [response] = await Promise.all([
        sendContactToAPI(calculatedScores, signature),
        new Promise(resolve => setTimeout(resolve, 2500)) // 2.5 seconds to show processing animation
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response error:', response.status, errorText);
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      setIsProcessing(false);
      setIsCompleted(true);
      trackEvent('quiz_complete', {
        pattern_signature: signature,
        recovery_potential: calculatedScores.recoveryPotential,
        pain_location: (answers[0]?.answer as string) || 'Unknown',
        pain_severity: calculatedScores.recoveryPotential >= 80 ? 'mild'
          : calculatedScores.recoveryPotential < 60 ? 'severe' : 'moderate',
      });
      return true;
    } catch (err: any) {
      const message = err?.message || "Unknown error";
      console.error('Quiz submission error:', message);
      setSubmissionError(message);
      toast({ title: "Submission Error", description: message, variant: "destructive" });
      return false;
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  };

  const retrySubmission = async (): Promise<boolean> => {
    setIsSubmitting(true);
    setIsLoading(true);
    setSubmissionError(null);

    try {
      if (!scores || !patternSignature) {
        throw new Error('Missing quiz scores for retry');
      }

      const [response] = await Promise.all([
        sendContactToAPI(scores, patternSignature),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response error:', response.status, errorText);
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      setIsCompleted(true);
      return true;
    } catch (err: any) {
      const message = err?.message || "Unknown error";
      console.error('Quiz submission error:', message);
      setSubmissionError(message);
      toast({ title: "Retry Failed", description: message, variant: "destructive" });
      return false;
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  };

  const resetQuiz = () => {
    setCurrentStep(0);
    setHasStarted(false);
    setIsCompleted(false);
    setSubmissionError(null);
    setValidationError('');
    setScores(null);
    setPatternSignature(null);
    setInsights([]);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setAnswers([
      { question: "Where is your pain primarily located?", answer: null },
      { question: "What do you think triggered or worsened your pain?", answer: null },
      { question: "Do you experience pain in any additional areas?", answer: [] },
      { question: "How long have you been experiencing this pain?", answer: null },
      { question: "How would you describe your pain intensity?", answer: null },
      { question: "When do you typically experience pain?", answer: [] },
      { question: "What type of pain are you experiencing?", answer: [] },
      { question: "What activities make your pain worse?", answer: [] },
      { question: "Does your pain affect any of the following aspects of your life?", answer: [] },
      { question: "Have you tried any treatments for your pain?", answer: [] },
      { question: "How would you describe your results from previous treatments?", answer: null },
      { question: "Do you have any other health conditions?", answer: [] }
    ]);
  };

  return (
    <QuizContext.Provider value={{
      currentStep,
      totalSteps,
      answers,
      firstName,
      lastName,
      email,
      phone,
      scores,
      patternSignature,
      insights,
      isSubmitting,
      isLoading,
      isProcessing,
      isCompleted,
      submissionError,
      validationError,
      goToNextStep,
      goToPrevStep,
      skipStep,
      setAnswer,
      setFirstName,
      setLastName,
      setEmail,
      setPhone,
      submitQuiz,
      retrySubmission,
      resetQuiz,
      hasStarted,
      startQuiz,
    }}>
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() {
  const context = useContext(QuizContext);
  if (!context) throw new Error("useQuiz must be used within a QuizProvider");
  return context;
}
