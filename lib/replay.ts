import { applyFixes, type Fix, type Race } from "../shared/race";
// Immutable checkpoints bound backward reconstruction to fewer than 250 fixes.
export class ReplayEngine {
  private current: Race;
  private count = 0;
  private snapshots = new Map<number, Race>();
  constructor(
    private initial: Race,
    private points: Fix[],
  ) {
    this.current = initial;
    this.snapshots.set(0, initial);
  }
  seek(at: number): Race {
    let end = 0,
      high = this.points.length;
    while (end < high) {
      const mid = (end + high) >>> 1;
      if (this.points[mid].at <= at) end = mid + 1;
      else high = mid;
    }
    if (
      end < this.count ||
      (Math.floor(end / 250) * 250 > this.count &&
        this.snapshots.has(Math.floor(end / 250) * 250))
    ) {
      this.count = Math.floor(end / 250) * 250;
      this.current = this.snapshots.get(this.count)!;
    }
    while (this.count < end) {
      const next = Math.min(end, (Math.floor(this.count / 250) + 1) * 250);
      this.current = applyFixes(
        this.current,
        this.points.slice(this.count, next),
        at,
      );
      this.count = next;
      if (next % 250 === 0) {
        // The static course is shared; each checkpoint retains independent dynamic state.
        this.current.route = this.initial.route;
        this.current.distances = this.initial.distances;
        if ("elevationsM" in this.initial)
          this.current.elevationsM = this.initial.elevationsM;
        this.snapshots.set(next, this.current);
      }
    }
    return this.current;
  }
}
