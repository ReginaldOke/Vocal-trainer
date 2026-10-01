/** One point of a sung line on screen: where it is, how thick the band is there, and its colour. */
export interface RibbonPoint { x: number; y: number; w: number; c: string }

/** Even out the widths a little so the band swells and thins smoothly instead of flickering. */
export function smoothWidths(pts: RibbonPoint[], reach = 2) {
  const w = pts.map((p) => p.w);
  for (let k = 0; k < pts.length; k++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, k - reach); j <= Math.min(pts.length - 1, k + reach); j++) { sum += w[j]; n++; }
    pts[k].w = sum / n;
  }
}

/**
 * Draw a run of points as one continuous band whose thickness follows the voice's loudness.
 * A stroked line can only have one width, so the band is built as a shape: an edge above and an
 * edge below the path, filled stretch by stretch in each stretch's colour.
 */
export function drawRibbon(g: CanvasRenderingContext2D, pts: RibbonPoint[], fill: (c: string) => string | CanvasGradient) {
  const n = pts.length;
  if (n < 2) return;
  const up: [number, number][] = [], down: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const h = pts[k].w / 2;
    up.push([pts[k].x - dy * h, pts[k].y + dx * h]);
    down.push([pts[k].x + dy * h, pts[k].y - dx * h]);
  }
  let start = 0;
  for (let s = 1; s < n; s++) {
    if (s < n - 1 && pts[s + 1].c === pts[s].c) continue;
    g.beginPath();
    g.moveTo(up[start][0], up[start][1]);
    for (let k = start + 1; k <= s; k++) g.lineTo(up[k][0], up[k][1]);
    for (let k = s; k >= start; k--) g.lineTo(down[k][0], down[k][1]);
    g.closePath();
    g.fillStyle = fill(pts[s].c);
    g.fill();
    start = s;
  }
  // Rounded ends.
  for (const k of [0, n - 1]) {
    g.beginPath();
    g.arc(pts[k].x, pts[k].y, pts[k].w / 2, 0, Math.PI * 2);
    g.fillStyle = fill(pts[k === 0 ? 1 : k].c);
    g.fill();
  }
}

/** How thick the band is for a level, given the quiet and loud ends of this voice. */
export function thickness(db: number, lo: number, hi: number, min: number, max: number) {
  const span = Math.max(12, hi - lo);
  const t = Math.max(0, Math.min(1, (db - (hi - span)) / span));
  return min + Math.pow(t, 1.3) * (max - min);
}
