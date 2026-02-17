
import React, { createContext, useContext, useState, useEffect } from 'react';
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
};

const QuizContext = createContext<QuizContextType | undefined>(undefined);

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
    if (currentStep === 0 && !answers[0]?.answer) {
      toast({ title: "Required Field", description: "Please select where your pain is primarily located", variant: "destructive" });
      return;
    }
    if (currentStep === 1 && !answers[1]?.answer) {
      toast({ title: "Required Field", description: "Please select what triggered your pain", variant: "destructive" });
      return;
    }
    if (currentStep === 3 && !answers[3]?.answer) {
      toast({ title: "Required Field", description: "Please select how long you've been experiencing this pain", variant: "destructive" });
      return;
    }
    if (currentStep === 4 && !answers[4]?.answer) {
      toast({ title: "Required Field", description: "Please select your pain intensity", variant: "destructive" });
      return;
    }
    if (
      currentStep === 10 &&
      answers[9]?.answer &&
      (answers[9].answer as string[]).length > 0 &&
      !(answers[9].answer as string[]).includes("I haven't tried any treatments") &&
      !answers[10]?.answer
    ) {
      toast({ title: "Required Field", description: "Please describe your results from previous treatments", variant: "destructive" });
      return;
    }
    if (currentStep === 12) {
      if (!firstName.trim() || !lastName.trim()) {
        toast({ title: "Required Field", description: "Please enter your first and last name", variant: "destructive" });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email.trim() || !emailRegex.test(email)) {
        toast({ title: "Invalid Email", description: "Please enter a valid email address", variant: "destructive" });
        return;
      }
      submitQuiz();
      return;
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
  };

  // Use the API route at /api/send-to-ghl (not /src/pages/api)
  const apiRoute = "/api/send-to-ghl"; 

  const sendContactToAPI = async (): Promise<Response> => {
    const contactData = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone
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
        sendContactToAPI(),
        new Promise(resolve => setTimeout(resolve, 2500)) // 2.5 seconds to show processing animation
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response error:', response.status, errorText);
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      setIsProcessing(false);
      setIsCompleted(true);
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
      const [response] = await Promise.all([
        sendContactToAPI(),
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
    setIsCompleted(false);
    setSubmissionError(null);
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
      resetQuiz
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
