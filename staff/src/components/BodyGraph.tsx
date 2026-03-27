import { useState } from 'react';
import {
  loadModuleData,
  saveModuleData,
  toggleBodyRegion,
  type ClientModuleData,
} from '../data/moduleStorage';

interface Props {
  contactId: string;
}

const ACTIVE_ON = '#4DA8A0';
const PASSIVE_ON = '#EBA584';
const OFF = '#E8E4DA';

export default function BodyGraph({ contactId }: Props) {
  const [data, setData] = useState<ClientModuleData>(() => loadModuleData(contactId));

  function handleToggle(regionId: string) {
    const next = toggleBodyRegion(data, regionId);
    setData(next);
    saveModuleData(contactId, next);
  }

  function fill(regionId: string): string {
    if (!data.bodyGraph[regionId]) return OFF;
    return regionId.startsWith('active') ? ACTIVE_ON : PASSIVE_ON;
  }

  return (
    <div className="staff-card">
      <h3 className="text-xs font-medium text-amari-text-secondary uppercase tracking-wide mb-3">
        Body Map
      </h3>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: ACTIVE_ON }} />
          <span className="text-xs text-amari-text-secondary">Active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: PASSIVE_ON }} />
          <span className="text-xs text-amari-text-secondary">Passive</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: OFF }} />
          <span className="text-xs text-amari-text-secondary">Unmarked</span>
        </div>
      </div>

      {/* Side labels + body SVG */}
      <div className="flex items-center justify-center gap-2">
        {/* Active label */}
        <span className="text-[10px] font-medium text-amari-text-muted uppercase tracking-wider"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          Active
        </span>

        <svg viewBox="0 0 200 440" className="w-44 h-auto" xmlns="http://www.w3.org/2000/svg">
          {/* Head — smooth oval */}
          <path
            d="M100,4 C112,4 120,14 120,28 C120,42 112,50 100,50 C88,50 80,42 80,28 C80,14 88,4 100,4 Z"
            fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1"
          />

          {/* Neck */}
          <path d="M92,50 L92,60 Q92,64 96,64 L104,64 Q108,64 108,60 L108,50" fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1" />

          {/* ── UPPER BODY — shoulders to bottom of ribcage ── */}
          {/* Active upper (left half): shoulder → arm → hand + torso */}
          <path
            d="M96,64 C80,64 60,66 48,72 C38,78 30,88 26,100 Q22,112 20,128 L16,148 Q14,156 18,162 L22,168 Q26,172 28,168 L34,148 Q38,130 40,118
               L40,170 L98,170 L98,64 Z"
            fill={fill('active-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive upper (right half) */}
          <path
            d="M104,64 C120,64 140,66 152,72 C162,78 170,88 174,100 Q178,112 180,128 L184,148 Q186,156 182,162 L178,168 Q174,172 172,168 L166,148 Q162,130 160,118
               L160,170 L102,170 L102,64 Z"
            fill={fill('passive-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── MIDDLE BODY — waist to top of thigh ── */}
          {/* Active middle (left) */}
          <path
            d="M40,172 L98,172 L98,272 Q96,278 92,280 L82,280
               Q72,278 66,270 C60,258 54,240 48,222 Q44,210 42,196 Z"
            fill={fill('active-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive middle (right) */}
          <path
            d="M160,172 L102,172 L102,272 Q104,278 108,280 L118,280
               Q128,278 134,270 C140,258 146,240 152,222 Q156,210 158,196 Z"
            fill={fill('passive-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── LOWER BODY — thighs to feet ── */}
          {/* Active lower (left leg) */}
          <path
            d="M82,282 L98,282 L98,360 Q98,380 96,400 L94,420 Q94,428 90,432 L82,432
               Q78,432 78,426 L78,420 Q76,400 74,380 Q72,360 72,340 Q70,320 72,300 Q74,290 78,284 Z"
            fill={fill('active-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-lower')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive lower (right leg) */}
          <path
            d="M118,282 L102,282 L102,360 Q102,380 104,400 L106,420 Q106,428 110,432 L118,432
               Q122,432 122,426 L122,420 Q124,400 126,380 Q128,360 128,340 Q130,320 128,300 Q126,290 122,284 Z"
            fill={fill('passive-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Center dividing line */}
          <line x1="100" y1="64" x2="100" y2="432" stroke="#B8B4AC" strokeWidth="0.5" strokeDasharray="4,3" />

          {/* Region labels — clickable */}
          <text x="68" y="125" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-upper')}>Upper</text>
          <text x="132" y="125" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-upper')}>Upper</text>
          <text x="72" y="228" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-middle')}>Middle</text>
          <text x="128" y="228" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-middle')}>Middle</text>
          <text x="86" y="355" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-lower')}>Lower</text>
          <text x="114" y="355" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-lower')}>Lower</text>
        </svg>

        {/* Passive label */}
        <span className="text-[10px] font-medium text-amari-text-muted uppercase tracking-wider"
          style={{ writingMode: 'vertical-rl' }}>
          Passive
        </span>
      </div>
    </div>
  );
}
