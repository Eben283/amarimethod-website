export type BodyRegionState = 'active' | 'passive' | null;

export interface ClientModuleData {
  modules: Record<string, boolean>;
  yogaBlockSize: '3' | '4' | null;
  bodyGraph: Record<string, BodyRegionState>;
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
  { id: 'upper', label: 'Upper Body' },
  { id: 'middle', label: 'Middle Body' },
  { id: 'lower', label: 'Lower Body' },
] as const;

export function defaultData(): ClientModuleData {
  return {
    modules: {},
    yogaBlockSize: null,
    bodyGraph: {},
  };
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

export function cycleBodyRegion(data: ClientModuleData, regionId: string): ClientModuleData {
  const current = data.bodyGraph[regionId] ?? null;
  const next: BodyRegionState = current === null ? 'active' : current === 'active' ? 'passive' : null;
  return {
    ...data,
    bodyGraph: { ...data.bodyGraph, [regionId]: next },
  };
}
