export interface ClientData {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  seriesType: 'none' | '4-session' | '8-session' | 'Single';
  sessionsCompleted: number;
  sessionsRemaining: number;
  hasLivingPractice: boolean;
  portalAccess: boolean;
  isPartner: boolean;
}

export interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: 'confirmed' | 'completed' | 'showed' | 'cancelled' | 'no_show';
  appointmentType: string;
}

export interface PortalDataResponse {
  client: ClientData;
  appointments: Appointment[];
  upcomingAppointments: Appointment[];
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  contactId: string | null;
  email: string | null;
}
