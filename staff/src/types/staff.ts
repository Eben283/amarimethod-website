export interface StaffAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface TodayAppointment {
  id: string;
  contactId: string;
  contactName: string;
  startTime: string;
  endTime: string;
  title: string;
  sessionsRemaining: number;
  sessionsCompleted: number;
  seriesType: string;
  tags: string[];
}

export interface ContactListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastAppointment: string | null;
  sessionsRemaining: number;
  seriesType: string;
}

export interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  seriesType: string;
  sessionsCompleted: number;
  sessionsRemaining: number;
  tags: string[];
  dateAdded: string;
  lastAppointment: string | null;
  appointments: ContactAppointment[];
  notes: ContactNote[];
  messages: ContactMessage[];
  quizResults: QuizResults | null;
}

export interface ContactAppointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

export interface ContactNote {
  id: string;
  body: string;
  dateAdded: string;
}

export interface ContactMessage {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  dateAdded: string;
  type: string;
}

export interface QuizResults {
  patternSignature: string;
  recoveryPotentialScore: string | null;
  primaryPainLocation: string | null;
  painDuration: string | null;
  painIntensity: string | null;
  painTrigger: string | null;
  additionalPainAreas: string | null;
  painType: string | null;
  treatmentsTried: string | null;
  treatmentResults: string | null;
  aggravatingActivities: string | null;
  dailyImpact: string | null;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  category: 'operational' | 'conversational';
  hint?: string;
}

export interface ChecklistState {
  [itemId: string]: boolean;
}
