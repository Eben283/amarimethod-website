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

        <svg viewBox="0 0 200 380" className="w-48 h-auto" xmlns="http://www.w3.org/2000/svg">
          {/* Head */}
          <ellipse cx="100" cy="24" rx="16" ry="20" fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1" />

          {/* Neck */}
          <rect x="94" y="42" width="12" height="14" rx="3" fill="#D4D0C8" />

          {/* ── UPPER BODY ── */}
          {/* Active upper torso (left) — broad shoulders, narrow waist */}
          <path
            d="M58,56 L98,56 L98,148 L68,148 L62,130 L58,100 L55,75 Z"
            fill={fill('active-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Active upper arm (left) — lean athletic arm */}
          <path
            d="M55,75 L58,56 L48,58 L38,65 L32,80 L30,100 L32,125 L26,148 L18,145 L22,120 L24,95 L28,75 L36,62 Z"
            fill={fill('active-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive upper torso (right) */}
          <path
            d="M102,56 L142,56 L145,75 L142,100 L138,130 L132,148 L102,148 Z"
            fill={fill('passive-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive upper arm (right) */}
          <path
            d="M145,75 L142,56 L152,58 L162,65 L168,80 L170,100 L168,125 L174,148 L182,145 L178,120 L176,95 L172,75 L164,62 Z"
            fill={fill('passive-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── MIDDLE BODY ── */}
          {/* Active middle torso (left) — tapered waist, hip */}
          <path
            d="M68,150 L98,150 L98,235 L72,235 L65,210 L64,180 L66,160 Z"
            fill={fill('active-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Active forearm/hand (left) */}
          <path
            d="M26,150 L18,147 L12,170 L8,200 L6,218 L14,220 L16,200 L20,175 Z"
            fill={fill('active-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive middle torso (right) */}
          <path
            d="M102,150 L132,150 L134,160 L136,180 L135,210 L128,235 L102,235 Z"
            fill={fill('passive-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive forearm/hand (right) */}
          <path
            d="M174,150 L182,147 L188,170 L192,200 L194,218 L186,220 L184,200 L180,175 Z"
            fill={fill('passive-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── LOWER BODY ── */}
          {/* Active lower — left leg, athletic taper */}
          <path
            d="M72,237 L98,237 L98,290 L94,320 L92,350 L88,372 L66,372 L68,350 L70,320 L68,290 L66,260 Z"
            fill={fill('active-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive lower — right leg */}
          <path
            d="M102,237 L128,237 L134,260 L132,290 L130,320 L132,350 L134,372 L112,372 L108,350 L106,320 L102,290 Z"
            fill={fill('passive-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Center dividing line */}
          <line x1="100" y1="56" x2="100" y2="372" stroke="#B8B4AC" strokeWidth="0.5" strokeDasharray="4,3" />

          {/* Region labels — clickable, pointer-events enabled */}
          <text x="75" y="108" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-upper')}>Upper</text>
          <text x="125" y="108" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-upper')}>Upper</text>
          <text x="78" y="198" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-middle')}>Middle</text>
          <text x="122" y="198" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-middle')}>Middle</text>
          <text x="82" y="310" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('active-lower')}>Lower</text>
          <text x="118" y="310" textAnchor="middle" className="text-[9px] font-medium cursor-pointer" fill="#666" onClick={() => handleToggle('passive-lower')}>Lower</text>
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
