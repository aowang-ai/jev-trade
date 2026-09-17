/** Monotone-cubic interpolation (Fritsch-Carlson): a smooth path that never
 *  overshoots its own data points, so a price line stays truthful. */

const r = (v: number) => Math.round(v * 10) / 10;

export function smoothPath(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${r(pts[0][0])} ${r(pts[0][1])}`;

  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1][0] - pts[i][0];
    dx.push(h);
    m.push(h === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h);
  }

  const t = new Array<number>(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
    if (!Number.isFinite(t[i])) t[i] = 0;
  }

  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d +=
      `C${r(pts[i][0] + h)} ${r(pts[i][1] + t[i] * h)}` +
      ` ${r(pts[i + 1][0] - h)} ${r(pts[i + 1][1] - t[i + 1] * h)}` +
      ` ${r(pts[i + 1][0])} ${r(pts[i + 1][1])}`;
  }
  return d;
}
