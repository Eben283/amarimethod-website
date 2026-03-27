import { useState } from 'react';
import {
  loadModuleData,
  saveModuleData,
  cycleBodyRegion,
  type ClientModuleData,
  type BodyRegionState,
} from '../data/moduleStorage';

interface Props {
  contactId: string;
}

const COLORS: Record<string, string> = {
  active: '#4DA8A0',
  passive: '#EBA584',
};
const OFF = '#E8E4DA';

function regionFill(state: BodyRegionState): string {
  if (!state) return OFF;
  return COLORS[state];
}

function stateLabel(state: BodyRegionState): string {
  if (state === 'active') return 'Active';
  if (state === 'passive') return 'Passive';
  return '';
}

export default function BodyGraph({ contactId }: Props) {
  const [data, setData] = useState<ClientModuleData>(() => loadModuleData(contactId));

  function handleCycle(regionId: string) {
    const next = cycleBodyRegion(data, regionId);
    setData(next);
    saveModuleData(contactId, next);
  }

  const upper = data.bodyGraph['upper'] ?? null;
  const middle = data.bodyGraph['middle'] ?? null;
  const lower = data.bodyGraph['lower'] ?? null;

  return (
    <div className="staff-card">
      <h3 className="text-xs font-medium text-amari-text-secondary uppercase tracking-wide mb-3">
        Body Map
      </h3>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.active }} />
          <span className="text-xs text-amari-text-secondary">Active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.passive }} />
          <span className="text-xs text-amari-text-secondary">Passive</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: OFF }} />
          <span className="text-xs text-amari-text-secondary">Unmarked</span>
        </div>
      </div>

      <p className="text-[10px] text-amari-text-muted text-center mb-2">Tap a zone to cycle: unmarked → active → passive</p>

      {/* Body SVG */}
      <div className="flex justify-center">
        <svg viewBox="0 0 200 440" className="w-44 h-auto" xmlns="http://www.w3.org/2000/svg">
          {/* Head */}
          <path
            d="M100,4 C112,4 120,14 120,28 C120,42 112,50 100,50 C88,50 80,42 80,28 C80,14 88,4 100,4 Z"
            fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1"
          />

          {/* Neck */}
          <path d="M92,50 L92,60 Q92,64 96,64 L104,64 Q108,64 108,60 L108,50" fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1" />

          {/* ── UPPER BODY — shoulders to waist ── */}
          {/* Left shoulder + arm */}
          <path
            d="M96,64 C80,64 60,66 48,72 C38,78 30,88 26,100 Q22,112 20,128 L16,148 Q14,156 18,162 L22,168 Q26,172 28,168 L34,148 Q38,130 40,118 L40,170 L100,170 L100,64 Z"
            fill={regionFill(upper)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Right shoulder + arm */}
          <path
            d="M104,64 C120,64 140,66 152,72 C162,78 170,88 174,100 Q178,112 180,128 L184,148 Q186,156 182,162 L178,168 Q174,172 172,168 L166,148 Q162,130 160,118 L160,170 L100,170 L100,64 Z"
            fill={regionFill(upper)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── MIDDLE BODY — waist to ankles ── */}
          {/* Left torso + leg */}
          <path
            d="M40,172 L100,172 L100,400 Q98,408 94,412 L86,412 Q82,408 82,402 L80,380 Q76,340 72,310 Q68,280 66,260 C60,240 52,218 44,200 Z"
            fill={regionFill(middle)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Right torso + leg */}
          <path
            d="M160,172 L100,172 L100,400 Q102,408 106,412 L114,412 Q118,408 118,402 L120,380 Q124,340 128,310 Q132,280 134,260 C140,240 148,218 156,200 Z"
            fill={regionFill(middle)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── LOWER BODY — ankles to feet ── */}
          {/* Left foot */}
          <path
            d="M82,412 L86,412 Q94,412 94,412 L96,420 Q98,430 92,434 L76,434 Q72,432 72,426 L74,418 Z"
            fill={regionFill(lower)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('lower')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Right foot */}
          <path
            d="M118,412 L114,412 Q106,412 106,412 L104,420 Q102,430 108,434 L124,434 Q128,432 128,426 L126,418 Z"
            fill={regionFill(lower)}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleCycle('lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Horizontal split lines */}
          <line x1="30" y1="170" x2="170" y2="170" stroke="#B8B4AC" strokeWidth="0.75" strokeDasharray="4,3" />
          <line x1="72" y1="412" x2="128" y2="412" stroke="#B8B4AC" strokeWidth="0.75" strokeDasharray="4,3" />

          {/* Region labels — clickable */}
          <text x="100" y="125" textAnchor="middle" className="text-[10px] font-medium cursor-pointer" fill="#555" onClick={() => handleCycle('upper')}>
            {stateLabel(upper) || 'Upper'}
          </text>
          <text x="100" y="290" textAnchor="middle" className="text-[10px] font-medium cursor-pointer" fill="#555" onClick={() => handleCycle('middle')}>
            {stateLabel(middle) || 'Middle'}
          </text>
          <text x="100" y="428" textAnchor="middle" className="text-[10px] font-medium cursor-pointer" fill="#555" onClick={() => handleCycle('lower')}>
            {stateLabel(lower) || 'Lower'}
          </text>
        </svg>
      </div>
    </div>
  );
}
