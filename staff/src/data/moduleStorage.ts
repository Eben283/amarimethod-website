export interface ClientModuleData {
  modules: Record<string, boolean>;
  yogaBlockSize: '3' | '4' | null;
  bodyGraph: Record<string, boolean>;
}

export const MODULES = [
  { id: 'suspension-squat', name: 'Suspension Squat' },
  { id: 'hand-balancer', name: 'Hand Balancer' },
  { id: 'power-posture', name: 'Power Posture' },
  { id: 'vertical-drop', name: 'Vertical Drop' },
  { id: 'active-bridge', name: 'Active Bridge' },
  { id: 'passive-bridge', name: 'Passive Bridge' },
  { id: 'spinal-wave', name: 'Spinal Wave' },
  { id: 'spring-step', name: 'Spring Step' },
  { id: 'elbow-reset', name: 'Elbow Reset' },
  { id: 'jaw-align', name: 'Jaw Align' },
] as const;

export const BODY_REGIONS = [
  { id: 'active-upper', label: 'Upper', side: 'active' },
  { id: 'passive-upper', label: 'Upper', side: 'passive' },
  { id: 'active-middle', label: 'Middle', side: 'active' },
  { id: 'passive-middle', label: 'Middle', side: 'passive' },
  { id: 'active-lower', label: 'Lower', side: 'active' },
  { id: 'passive-lower', label: 'Lower', side: 'passive' },
] as const;

const STORAGE_PREFIX = 'staff_client_modules_';

function defaultData(): ClientModuleData {
  return {
    modules: {},
    yogaBlockSize: null,
    bodyGraph: {},
  };
}

export function loadModuleData(contactId: string): ClientModuleData {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + contactId);
    if (!raw) return defaultData();
    return { ...defaultData(), ...JSON.parse(raw) };
  } catch {
    return defaultData();
  }
}

export function saveModuleData(contactId: string, data: ClientModuleData): void {
  localStorage.setItem(STORAGE_PREFIX + contactId, JSON.stringify(data));
}

export function toggleModule(data: ClientModuleData, moduleId: string): ClientModuleData {
  return {
    ...data,
    modules: { ...data.modules, [moduleId]: !data.modules[moduleId] },
  };
}

export function setYogaBlockSize(data: ClientModuleData, size: '3' | '4'): ClientModuleData {
  return { ...data, yogaBlockSize: size };
}

export function toggleBodyRegion(data: ClientModuleData, regionId: string): ClientModuleData {
  return {
    ...data,
    bodyGraph: { ...data.bodyGraph, [regionId]: !data.bodyGraph[regionId] },
  };
}
