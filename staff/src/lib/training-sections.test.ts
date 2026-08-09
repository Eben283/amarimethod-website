import { describe, expect, it } from 'vitest';
import { trainingPath, trainingPlaybookFromSearch, trainingSectionFromSearch } from './training-sections';

describe('Training workspace navigation', () => {
  it('builds stable links for each training section', () => {
    expect(trainingPath('sharpen')).toBe('/training?section=sharpen');
    expect(trainingPath('playbooks')).toBe('/training?section=playbooks');
    expect(trainingPath('reference')).toBe('/training?section=reference');
  });

  it('opens Sharpen by default and rejects unknown sections', () => {
    expect(trainingSectionFromSearch('')).toBe('sharpen');
    expect(trainingSectionFromSearch('?section=playbooks')).toBe('playbooks');
    expect(trainingSectionFromSearch('?section=reference')).toBe('reference');
    expect(trainingSectionFromSearch('?section=calendar')).toBe('sharpen');
  });

  it('preserves an exact playbook deep link without accepting unknown tabs', () => {
    expect(trainingPath('playbooks', 'positioning')).toBe('/training?section=playbooks&playbook=positioning');
    expect(trainingPlaybookFromSearch('?section=playbooks&playbook=partner')).toBe('partner');
    expect(trainingPlaybookFromSearch('?section=playbooks&playbook=unknown')).toBe('discovery');
  });
});
