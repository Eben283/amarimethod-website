import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarSummary,
  getConversations,
  getOpsSystemsBoard,
  getOutreachCards,
  getStaffRevenue,
  type OpsSystemsBoard,
  type StaffRevenueData,
} from '../lib/api';
import type {
  ConversationSummary,
  OutreachSnapshotResponse,
  TodayAppointment,
} from '../types/staff';

type HomeResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export type HomeAutomationFailure = {
  ts: number | string;
  flowKey: string | null;
  action: string | null;
  outcome: string | null;
  channel: string | null;
};

export type HomeAutomationFailures = {
  configured: boolean;
  failures: HomeAutomationFailure[];
};

export type HomeOperationsState = {
  schedule: HomeResource<TodayAppointment[]>;
  conversations: HomeResource<ConversationSummary[]>;
  followUps: HomeResource<OutreachSnapshotResponse>;
  revenue: HomeResource<StaffRevenueData>;
  systems: HomeResource<OpsSystemsBoard>;
  automation: HomeResource<HomeAutomationFailures>;
  refreshedAt: number | null;
};

const pending = <T,>(): HomeResource<T> => ({ data: null, loading: true, error: null });

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function pacificDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function useHomeOperations() {
  const [state, setState] = useState<HomeOperationsState>({
    schedule: pending(),
    conversations: pending(),
    followUps: pending(),
    revenue: pending(),
    systems: pending(),
    automation: pending(),
    refreshedAt: null,
  });

  const load = useCallback(() => {
    let active = true;
    const update = <K extends keyof Omit<HomeOperationsState, 'refreshedAt'>>(
      key: K,
      resource: HomeOperationsState[K],
    ) => {
      if (!active) return;
      setState((current) => ({ ...current, [key]: resource, refreshedAt: Date.now() }));
    };

    setState((current) => ({
      ...current,
      schedule: { ...current.schedule, loading: true, error: null },
      conversations: { ...current.conversations, loading: true, error: null },
      followUps: { ...current.followUps, loading: true, error: null },
      revenue: { ...current.revenue, loading: true, error: null },
      systems: { ...current.systems, loading: true, error: null },
      automation: { ...current.automation, loading: true, error: null },
    }));

    void getCalendarSummary(pacificDate())
      .then((data) => update('schedule', { data, loading: false, error: null }))
      .catch((error) => update('schedule', { data: null, loading: false, error: message(error, 'Today’s schedule could not be loaded.') }));

    void getConversations('needs_reply')
      .then((result) => update('conversations', { data: result.conversations || [], loading: false, error: null }))
      .catch((error) => update('conversations', { data: null, loading: false, error: message(error, 'Replies could not be loaded.') }));

    void getOutreachCards()
      .then((data) => update('followUps', { data, loading: false, error: null }))
      .catch((error) => update('followUps', { data: null, loading: false, error: message(error, 'Follow-ups could not be loaded.') }));

    void getStaffRevenue(6)
      .then((data) => update('revenue', { data, loading: false, error: null }))
      .catch((error) => update('revenue', { data: null, loading: false, error: message(error, 'Revenue could not be loaded.') }));

    void getOpsSystemsBoard()
      .then((data) => update('systems', { data, loading: false, error: null }))
      .catch((error) => update('systems', { data: null, loading: false, error: message(error, 'System health could not be loaded.') }));

    void fetch('/api/staff-automations?view=failures&sinceHours=168', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Automation evidence could not be loaded.');
        const data = await response.json() as Partial<HomeAutomationFailures>;
        update('automation', {
          data: { configured: data.configured === true, failures: Array.isArray(data.failures) ? data.failures : [] },
          loading: false,
          error: null,
        });
      })
      .catch((error) => update('automation', { data: null, loading: false, error: message(error, 'Automation evidence could not be loaded.') }));

    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancel = load();
    const reloadWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      cancel();
      cancel = load();
    };
    window.addEventListener('focus', reloadWhenVisible);
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => {
      cancel();
      window.removeEventListener('focus', reloadWhenVisible);
      document.removeEventListener('visibilitychange', reloadWhenVisible);
    };
  }, [load]);

  return { state, refresh: load };
}
