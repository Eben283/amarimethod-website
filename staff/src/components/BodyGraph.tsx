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

        <svg viewBox="0 0 200 360" className="w-48 h-auto" xmlns="http://www.w3.org/2000/svg">
          {/* Head (not interactive — just for shape context) */}
          <ellipse cx="100" cy="28" rx="20" ry="24" fill="#D4D0C8" stroke="#B8B4AC" strokeWidth="1" />

          {/* Neck */}
          <rect x="92" y="50" width="16" height="12" rx="4" fill="#D4D0C8" />

          {/* ── UPPER BODY ── */}
          {/* Active upper (left side of figure) */}
          <path
            d="M50,62 L98,62 L98,150 L40,150 L30,120 L28,90 L35,70 Z"
            fill={fill('active-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Active upper arm */}
          <path
            d="M35,70 L28,90 L30,120 L20,145 L10,140 L15,100 L20,75 L30,65 Z"
            fill={fill('active-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive upper (right side of figure) */}
          <path
            d="M102,62 L150,62 L165,70 L172,90 L170,120 L160,150 L102,150 Z"
            fill={fill('passive-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-upper')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive upper arm */}
          <path
            d="M165,70 L172,90 L170,120 L180,145 L190,140 L185,100 L180,75 L170,65 Z"
            fill={fill('passive-upper')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-upper')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── MIDDLE BODY ── */}
          {/* Active middle (left) */}
          <path
            d="M40,152 L98,152 L98,230 L55,230 L42,190 Z"
            fill={fill('active-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Active forearm/hand */}
          <path
            d="M20,147 L10,142 L2,175 L0,200 L8,202 L12,180 Z"
            fill={fill('active-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive middle (right) */}
          <path
            d="M102,152 L160,152 L158,190 L145,230 L102,230 Z"
            fill={fill('passive-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-middle')}
            className="cursor-pointer transition-colors duration-200"
          />
          {/* Passive forearm/hand */}
          <path
            d="M180,147 L190,142 L198,175 L200,200 L192,202 L188,180 Z"
            fill={fill('passive-middle')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-middle')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* ── LOWER BODY ── */}
          {/* Active lower (left leg) */}
          <path
            d="M55,232 L98,232 L98,280 L92,320 L88,355 L62,355 L65,320 L60,280 L50,250 Z"
            fill={fill('active-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('active-lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Passive lower (right leg) */}
          <path
            d="M102,232 L145,232 L150,250 L140,280 L135,320 L138,355 L112,355 L108,320 L102,280 Z"
            fill={fill('passive-lower')}
            stroke="#B8B4AC"
            strokeWidth="1"
            onClick={() => handleToggle('passive-lower')}
            className="cursor-pointer transition-colors duration-200"
          />

          {/* Center dividing line */}
          <line x1="100" y1="62" x2="100" y2="355" stroke="#B8B4AC" strokeWidth="0.5" strokeDasharray="4,3" />

          {/* Region labels */}
          <text x="65" y="112" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Upper</text>
          <text x="135" y="112" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Upper</text>
          <text x="68" y="195" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Middle</text>
          <text x="132" y="195" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Middle</text>
          <text x="78" y="295" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Lower</text>
          <text x="122" y="295" textAnchor="middle" className="text-[9px] font-medium" fill="#666">Lower</text>
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
