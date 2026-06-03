import { useEffect, useRef, useState } from 'react';
import { cycleBodyRegion, type ClientModuleData, type BodyRegionState } from '../data/moduleStorage';

interface Props {
  data: ClientModuleData;
  onUpdate: (data: ClientModuleData) => void;
}

// The design figure has three anatomical zones (above hips / below hips / feet).
// They map onto the app's real body-graph region ids (upper / middle / lower).
const ZONES = [
  { regionId: 'upper',  maskKey: 'upper', label: 'Above hips' },
  { regionId: 'middle', maskKey: 'lower', label: 'Below hips' },
  { regionId: 'lower',  maskKey: 'feet',  label: 'Feet' },
] as const;

// pelvis + ankle divider lines (fraction of figure height) and torso corridor
const HIP = 0.48;
const ANK = 0.91;
const CXL = 0.311;
const CXR = 0.676;

// state → fill colour. Matches the .sa legend swatches (--line2 / --good / --passive).
const FILL: Record<'0' | '1' | '2', string> = { '0': '#E7ECEF', '1': '#2C8466', '2': '#C0743A' };
const stateNum = (s: BodyRegionState): '0' | '1' | '2' => (s === 'active' ? '1' : s === 'passive' ? '2' : '0');
const stateLabel = (s: BodyRegionState): string => (s === 'active' ? 'Active' : s === 'passive' ? 'Passive' : 'Unmarked');

const ASSET = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`;

type ImgSet = Record<string, HTMLImageElement>;

// Module-level cache so the five PNGs load once per session, not per mount.
let cachedImgs: ImgSet | null = null;

function useBodyImages(): ImgSet | null {
  const [imgs, setImgs] = useState<ImgSet | null>(cachedImgs);
  useEffect(() => {
    if (cachedImgs) { setImgs(cachedImgs); return; }
    const srcs: Record<string, string> = {
      upper: ASSET('zone-upper.png'),
      lower: ASSET('zone-lower.png'),
      feet: ASSET('zone-feet.png'),
      full: ASSET('body-mask.png'),
      outline: ASSET('body-outline.png'),
    };
    const keys = Object.keys(srcs);
    const res: ImgSet = {};
    let n = 0;
    let cancelled = false;
    keys.forEach((k) => {
      const im = new Image();
      im.onload = () => {
        res[k] = im;
        if (++n === keys.length && !cancelled) { cachedImgs = res; setImgs({ ...res }); }
      };
      im.src = srcs[k];
    });
    return () => { cancelled = true; };
  }, []);
  return imgs;
}

export default function BodyMapCanvas({ data, onUpdate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgs = useBodyImages();

  const regions = ZONES.map((z) => ({
    ...z,
    state: (data.bodyGraph[z.regionId] ?? null) as BodyRegionState,
  }));
  const markedCount = regions.filter((r) => r.state !== null).length;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !imgs) return;
    const w = 210, h = 388, dpr = 2, W2 = w * dpr, H2 = h * dpr;
    cv.width = W2; cv.height = H2;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W2, H2);

    const tmp = document.createElement('canvas');
    tmp.width = W2; tmp.height = H2;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;

    const paint = (mask: HTMLImageElement, color: string) => {
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, W2, H2);
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, W2, H2);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0, W2, H2);
      ctx.drawImage(tmp, 0, 0);
    };
    regions.forEach((r) => paint(imgs[r.maskKey], FILL[stateNum(r.state)]));

    // hip + ankle divider lines, clipped to the body silhouette
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, W2, H2);
    tctx.fillStyle = 'rgba(255,255,255,.92)';
    const xl = CXL * W2, xw = (CXR - CXL) * W2;
    tctx.fillRect(xl, HIP * H2 - dpr, xw, 2 * dpr);
    tctx.fillRect(xl, ANK * H2 - dpr, xw, 2 * dpr);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(imgs.full, 0, 0, W2, H2);
    ctx.drawImage(tmp, 0, 0);

    ctx.drawImage(imgs.outline, 0, 0, W2, H2);
  }, [data.bodyGraph, imgs]);

  const figClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    let regionId: string;
    if (y < HIP) regionId = 'upper';
    else if (x >= CXL && x <= CXR) regionId = y < ANK ? 'middle' : 'lower';
    else regionId = 'upper';
    onUpdate(cycleBodyRegion(data, regionId));
  };

  return (
    <section className="sa-card">
      <div className="sa-bm-top">
        <span className="lbl">Body map</span>
        <div className="sa-bm-legend">
          <span><i style={{ background: 'var(--good)' }} />Active</span>
          <span><i style={{ background: 'var(--passive)' }} />Passive</span>
          <span><i style={{ background: 'var(--line2)' }} />Unmarked</span>
        </div>
      </div>
      <p className="sa-bm-hint">Tap a zone to cycle: unmarked → active → passive.</p>
      <div className="sa-bm-wrap">
        <div className="sa-bm-fig">
          <canvas ref={canvasRef} className="sa-bm-canvas" />
          <button className="sa-bm-hit" onClick={figClick} title="Tap a zone to cycle" />
        </div>
        <div className="sa-bm-side">
          <span className="lbl">Zones ({markedCount} marked)</span>
          <div className="sa-bm-sum" style={{ marginTop: 10 }}>
            {regions.map((r) => (
              <div key={r.regionId} className="row">
                <i style={{ background: r.state === 'active' ? 'var(--good)' : r.state === 'passive' ? 'var(--passive)' : 'var(--line2)' }} />
                <b>{r.label}</b>
                <span className="st">{stateLabel(r.state)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
