// A small static k-d tree for k-nearest-neighbour lookups on (lat, lon) degrees, used to give an outlet with an estate-name region the region of
// its nearest neighbours.

export class KdTree {
  private readonly ids: Int32Array;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;

  constructor(points: { x: number; y: number }[]) {
    this.xs = Float64Array.from(points, (p) => p.x);
    this.ys = Float64Array.from(points, (p) => p.y);
    this.ids = Int32Array.from(points.map((_, i) => i));
    this.build(0, points.length - 1, 0);
  }

  private coord(i: number, axis: number): number {
    return axis === 0 ? this.xs[this.ids[i]] : this.ys[this.ids[i]];
  }

  private build(lo: number, hi: number, axis: number): void {
    if (hi <= lo) return;
    const mid = (lo + hi) >> 1;
    this.select(lo, hi, mid, axis);
    this.build(lo, mid - 1, 1 - axis);
    this.build(mid + 1, hi, 1 - axis);
  }

  /** Quickselect: place the median of ids[lo..hi] on `axis` at index k. */
  private select(lo: number, hi: number, k: number, axis: number): void {
    while (hi > lo) {
      const pivot = this.coord((lo + hi) >> 1, axis);
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (this.coord(i, axis) < pivot) i++;
        while (this.coord(j, axis) > pivot) j--;
        if (i <= j) {
          const t = this.ids[i];
          this.ids[i] = this.ids[j];
          this.ids[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /** The indices (into the constructor's array) of the k nearest points, nearest first. */
  nearest(x: number, y: number, k: number): number[] {
    const best: { d: number; id: number }[] = [];
    const visit = (lo: number, hi: number, axis: number) => {
      if (hi < lo) return;
      const mid = (lo + hi) >> 1;
      const id = this.ids[mid];
      const dx = this.xs[id] - x;
      const dy = this.ys[id] - y;
      const d = dx * dx + dy * dy;
      if (best.length < k || d < best[best.length - 1].d) {
        best.push({ d, id });
        best.sort((a, b) => a.d - b.d || a.id - b.id);
        if (best.length > k) best.pop();
      }
      const diff = axis === 0 ? x - this.xs[id] : y - this.ys[id];
      const [near, far]: [[number, number], [number, number]] = diff < 0 ? [[lo, mid - 1], [mid + 1, hi]] : [[mid + 1, hi], [lo, mid - 1]];
      visit(near[0], near[1], 1 - axis);
      if (best.length < k || diff * diff < best[best.length - 1].d) visit(far[0], far[1], 1 - axis);
    };
    visit(0, this.ids.length - 1, 0);
    return best.map((b) => b.id);
  }
}
