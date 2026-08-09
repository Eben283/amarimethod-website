import { describe, expect, it } from 'vitest';
import { automationDrilldownPath } from './automation-navigation';

describe('automationDrilldownPath', () => {
  it('opens the selected workflow family with the owned person already in context', () => {
    expect(automationDrilldownPath('session reminders', 'person/123')).toBe(
      '/automations?family=session+reminders&contact=person%2F123',
    );
  });
});
