export interface ClientData {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /**
   * Derived from real purchases (orders + invoices), not the GHL custom field.
   * The custom field can lag or be wrong; the ledger reflects what was bought.
   */
  seriesType: 'none' | '4-session' | '8-session' | 'Single';
  /**
   * Lifetime journey counter: total past appointments with status
   * showed/completed/confirmed. Grows monotonically across packages.
   * Used as the "how far have I come?" number.
   */
  sessionsCompleted: number;
  /**
   * Prepaid package balance: derived as max(0, packageSize - attendedAgainstPackage).
   * Decrements only for sessions in series calendars (initial + follow-up),
   * not entrainments or partner-comp initials.
   * Used as the "when do I need to act?" number.
   */
  sessionsRemaining: number;
  /**
   * Total sessions ever purchased across all packages (8-pack = 8,
   * 4-pack + 8-pack = 12). Used to show pack size in the UI ("5 left in your 8-pack").
   * 0 means the client has never bought a package (pay-as-you-go).
   */
  packageSize: number;
  /**
   * Sessions consumed from the package — only counts series-calendar
   * appointments since the earliest package purchase. Surfaces if the
   * UI wants to show "3 of 8 used" instead of "5 left."
   */
  attendedAgainstPackage: number;
  /**
   * 'high' = ledger derivation agrees with custom fields and has clean
   * source data. 'low' = ambiguity detected (custom field disagrees with
   * derived, or attended exceeds purchased). UI may want to surface a
   * "contact Garrett to confirm" message when low.
   */
  ledgerConfidence: 'high' | 'low';
  /**
   * 'orders+invoices+appointments' = derived from real data.
   * 'empty' = no orders/invoices found, balance is unknown.
   */
  ledgerSource: 'orders+invoices+appointments' | 'empty';
  hasLivingPractice: boolean;
  portalAccess: boolean;
  isPartner: boolean;
  referralCount?: number;
  rewardCode?: string | null;
  /** Reminder cadence the client chose: all | some | none. Defaults to 'all'. */
  reminderPreference?: 'all' | 'some' | 'none';
}

export interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: 'confirmed' | 'completed' | 'showed' | 'cancelled' | 'no_show';
  appointmentType: string;
  meetingUrl?: string | null;
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
