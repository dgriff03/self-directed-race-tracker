import { applyFixes, type Fix, type Race } from "../shared/race";
// Advancing only applies newly visible fixes. Seeking backwards rebuilds from
// the original race, so completion and later splits cannot leak into the past.
export class ReplayEngine {
  private current: Race;
  private count = 0;
  constructor(
    private initial: Race,
    private points: Fix[],
  ) {
    this.current = initial;
  }
  seek(at: number): Race {
    let end = 0,
      high = this.points.length;
    while (end < high) {
      const mid = (end + high) >>> 1;
      if (this.points[mid].at <= at) end = mid + 1;
      else high = mid;
    }
    if (end < this.count) {
      this.current = this.initial;
      this.count = 0;
    }
    if (end > this.count)
      this.current = applyFixes(
        this.current,
        this.points.slice(this.count, end),
        at,
      );
    this.count = end;
    return this.current;
  }
}
