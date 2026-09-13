import { describe, expect, it } from 'vitest';
import { clientDeskHtml } from './client-desk.js';

function desk(actor = 'Eben', storage = new Map(), denied = false) {
  const element = { value: '', textContent: '', innerHTML: '', addEventListener() {}, replaceChildren() {} };
  const window = {
    location: { pathname: '/client-desk', search: '', hash: '#dashboard_session=9999999999.' + btoa(actor) + '.fixture' },
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    sessionStorage: {
      getItem(key) { if (denied) throw new Error('denied'); return storage.get(key) || null; },
      setItem(key, value) { if (denied) throw new Error('denied'); storage.set(key, value); },
    },
  };
  window.parent = window;
  const script = [...clientDeskHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const end = script.lastIndexOf('})();');
  const instrumented = script.slice(0, end) + 'return { tasksMarkup, taskDraft, taskTime, taskLocalValue, taskDueIso, taskDraftDueAt, taskLocalZone, persistTaskDrafts }; })();';
  return new Function('window', 'history', 'document', 'fetch', 'return ' + instrumented.trim())(
    window, { replaceState() {} }, { getElementById: () => element },
    async () => ({ ok: true, json: async () => ({ threads: [] }) }),
  );
}
const data = { contact: { id: 'contact-a' }, ownedTaskAuthority: { state: 'ready' }, tasks: [
  { task_id: 'owned-1', title: '<Review>', state: 'open', authority: 'owned', defined_by: 'Eben', assigned_to: 'Garrett', revision: 2, due_at: '2020-09-12T17:30:00Z' },
  { task_id: 'mirror-1', title: 'Imported', status: 'open' },
] };

describe('Client Desk owned task rendering and retry persistence', () => {
  it('offers controls only for owned tasks and labels historical authority explicitly', () => {
    const markup = desk().tasksMarkup(data);
    expect(markup).toContain('data-task-id="owned-1"');
    expect(markup).not.toContain('data-task-id="mirror-1"');
    expect(markup).toContain('GHL history · read-only');
    expect(markup).toContain('Created by Eben');
    expect(markup).toContain('Assigned to Garrett');
    expect(markup).toContain('Overdue');
    expect(markup).toContain('&lt;Review&gt;');
    expect(markup).toContain('no SMS or email reminder is sent.');
    expect(markup).toContain('Due date and time (optional)');
  });
  it('distinguishes unavailable owned storage from an empty task list', () => {
    const markup = desk().tasksMarkup({ ...data, ownedTaskAuthority: { state: 'unavailable' } });
    expect(markup).toContain('Amari tasks are unavailable');
    expect(markup).toContain('Imported');
    expect(markup).not.toContain('id="task-form"');
  });
  it('retains the exact unresolved command and draft across renewal but isolates actors', () => {
    const storage = new Map();
    const first = desk('Eben', storage);
    const command = { action: 'create', contactId: 'contact-a', title: 'Review plan', dueAt: null, assignedTo: 'Garrett', idempotencyKey: 'same-command-001' };
    Object.assign(first.taskDraft('contact-a'), { title: command.title, assignedTo: command.assignedTo, command });
    expect(first.persistTaskDrafts()).toBe(true);
    expect(desk('Eben', storage).taskDraft('contact-a')).toMatchObject({ title: command.title, command });
    expect(desk('Garrett', storage).taskDraft('contact-a').command).toBeNull();
  });
  it('allows empty-title transition retries without native required-field blocking', () => {
    const helper = desk();
    helper.taskDraft('contact-a').command = { action: 'complete', taskId: 'owned-1', idempotencyKey: 'same-transition-001' };
    const markup = helper.tasksMarkup(data);
    expect(markup).toContain('Retry save');
    expect(markup).not.toContain(' required');
    expect(markup).toContain(' readonly');
    expect(markup).not.toContain('data-task-action');
  });
  it('disables mutations when storage cannot preserve a safe retry or a conflict needs review', () => {
    expect(desk('Eben', new Map(), true).tasksMarkup(data)).toContain('type="submit" disabled');
    const helper = desk();
    helper.taskDraft('contact-a').needsRefresh = true;
    expect(helper.tasksMarkup(data)).toContain('type="submit" disabled');
    expect(helper.tasksMarkup(data)).not.toContain('data-task-action');
  });
  it('keeps due timestamps visible as times with a timezone and never invents a null due date', () => {
    const helper = desk();
    expect(helper.taskTime(null)).toBe('No due time');
    const value = new Date('2026-09-12T17:30:00Z').toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    expect(helper.taskTime('2026-09-12T17:30:00Z')).toBe(value);
    expect(helper.taskDueIso('2026-09-12T10:30')).toBe(new Date('2026-09-12T10:30').toISOString());
    expect(helper.taskLocalValue('2026-09-12T17:30:00Z')).toMatch(/^2026-09-12T/);
  });
  it('rejects daylight-saving gaps and folds instead of silently shifting a local due time', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const helper = desk();
      expect(helper.taskDueIso('2026-03-08T02:30')).toBeNull();
      expect(helper.taskDueIso('2026-11-01T01:30')).toBeNull();
      expect(helper.taskDueIso('2026-11-01T03:30')).toBe(new Date('2026-11-01T03:30').toISOString());
      expect(helper.taskLocalZone()).toBe('America/Los_Angeles');
    } finally {
      process.env.TZ = previous;
    }
  });
  it('preserves an untouched exact due timestamp while allowing an intentional minute-level change', () => {
    const helper = desk();
    const draft = helper.taskDraft('contact-a');
    draft.edit = { taskId: 'owned-1', revision: 2, title: 'Review', dueLocal: helper.taskLocalValue('2026-09-12T17:30:45.000Z'), originalDueAt: '2026-09-12T17:30:45.000Z', dueDirty: false, assignedTo: 'Eben' };
    expect(helper.taskDraftDueAt(draft)).toBe('2026-09-12T17:30:45.000Z');
    draft.edit.dueDirty = true;
    expect(helper.taskDraftDueAt(draft)).toBe(new Date(draft.edit.dueLocal).toISOString());
  });
});
