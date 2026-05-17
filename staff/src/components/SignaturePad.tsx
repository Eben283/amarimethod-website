import { useRef, useState, useEffect } from 'react';

type Props = {
  onChange: (dataUrl: string | null) => void;
  className?: string;
};

type Point = { x: number; y: number; time: number };

// Touch-friendly signature pad with quadratic Bezier smoothing and
// velocity-based line width — strokes look like a pen instead of jagged
// straight segments. Targets iPad pointer input.
//
// Smoothing technique: for each new captured point we have a window of the
// last three points. We draw a quadratic curve from the midpoint of
// points[0]→points[1] to the midpoint of points[1]→points[2], with
// points[1] as the control point. The midpoint trick produces curves that
// pass smoothly through every captured point.
//
// Velocity: distance/time between consecutive points → mapped to line
// width via exponential smoothing. Fast strokes get thinner lines, slow
// strokes get thicker — mimics ink pressure.
export default function SignaturePad({ onChange, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const lastWidthRef = useRef<number>(2.5);
  const [hasSignature, setHasSignature] = useState(false);

  // Pen parameters — tuned for finger signatures on iPad.
  const MIN_WIDTH = 1.2;
  const MAX_WIDTH = 3.5;
  const VELOCITY_FILTER = 0.7; // exponential smoothing on velocity
  const VELOCITY_MAX = 1.4;    // px/ms above which we hit MIN_WIDTH

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d1d1d';
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      time: performance.now(),
    };
  }

  function strokeWidthForVelocity(velocity: number): number {
    // Map velocity (px/ms) to line width via inverse relationship.
    const t = Math.min(velocity / VELOCITY_MAX, 1);
    const target = MAX_WIDTH - (MAX_WIDTH - MIN_WIDTH) * t;
    // Exponential smoothing so width doesn't jitter.
    lastWidthRef.current =
      VELOCITY_FILTER * target + (1 - VELOCITY_FILTER) * lastWidthRef.current;
    return lastWidthRef.current;
  }

  function midpoint(a: Point, b: Point): { x: number; y: number } {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function drawSmoothSegment(ctx: CanvasRenderingContext2D, points: Point[]) {
    if (points.length < 3) return;
    const [p0, p1, p2] = points.slice(-3);
    const m1 = midpoint(p0, p1);
    const m2 = midpoint(p1, p2);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dt = Math.max(p2.time - p1.time, 1); // avoid /0
    const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
    ctx.lineWidth = strokeWidthForVelocity(velocity);
    ctx.beginPath();
    ctx.moveTo(m1.x, m1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
    ctx.stroke();
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = getPoint(e);
    pointsRef.current = [p];
    lastWidthRef.current = (MIN_WIDTH + MAX_WIDTH) / 2;
    // Draw a small dot so a tap (no movement) still leaves a mark.
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.fillStyle = '#1d1d1d';
      ctx.arc(p.x, p.y, lastWidthRef.current / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPoint(e);
    pointsRef.current.push(p);
    drawSmoothSegment(ctx, pointsRef.current);
    if (!hasSignature) setHasSignature(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    // Finalize the last segment — draw from last midpoint to the final point
    // so the stroke doesn't end short.
    const ctx = canvasRef.current?.getContext('2d');
    const pts = pointsRef.current;
    if (ctx && pts.length >= 2) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const m = midpoint(prev, last);
      ctx.lineWidth = lastWidthRef.current;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    pointsRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL('image/png'));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pointsRef.current = [];
    setHasSignature(false);
    onChange(null);
  }

  return (
    <div className={className}>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full h-48 bg-white border border-amari-border rounded-lg touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {!hasSignature && (
          <p className="absolute inset-0 flex items-center justify-center text-amari-text-muted text-sm pointer-events-none italic">
            Sign here with your finger
          </p>
        )}
      </div>
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={clear}
          className="text-xs text-amari-text-muted hover:text-amari-charcoal py-1 px-2"
        >
          Clear signature
        </button>
      </div>
    </div>
  );
}
