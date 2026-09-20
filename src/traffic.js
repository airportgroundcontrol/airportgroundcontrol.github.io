export const separation = 60;
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

export function segments(plane, horizon = Infinity) {
  const result = [];
  let start = plane,
    travelled = 0;
  for (const end of plane.route) {
    const size = length(start, end);
    if (size > 0.001) result.push({ start, end, size, travelled });
    travelled += size;
    start = end;
    if (travelled > horizon) break;
  }
  return result;
}

export function distanceAhead(plane, point, corridor = 24, horizon = 300) {
  for (const segment of segments(plane, horizon)) {
    const v = sub(segment.end, segment.start),
      offset = sub(point, segment.start);
    const t = dot(v, offset) / (segment.size * segment.size);
    if (t < 0 || t > 1 || Math.abs(cross(v, offset)) / segment.size > corridor)
      continue;
    const distance = segment.travelled + t * segment.size;
    if (distance > 0.01 && distance <= horizon) return distance;
  }
  return Infinity;
}

// Intersections include collinear overlaps, so merging and same-taxiway queues share one model.
export function routeConflict(
  a,
  b,
  { aligned = false, horizon = Infinity } = {},
) {
  let first = null;
  for (const sa of segments(a, horizon))
    for (const sb of segments(b, horizon)) {
      const r = sub(sa.end, sa.start),
        s = sub(sb.end, sb.start),
        offset = sub(sb.start, sa.start);
      const denominator = cross(r, s),
        alignment = dot(r, s) / (sa.size * sb.size);
      if (aligned && alignment < 0.85) continue;
      let t, u;
      if (Math.abs(denominator) < 0.0001) {
        if (Math.abs(cross(offset, r)) / sa.size > 0.1) continue;
        const t0 = dot(offset, r) / dot(r, r),
          t1 = t0 + dot(s, r) / dot(r, r);
        t = Math.max(0, Math.min(t0, t1));
        if (t > Math.min(1, Math.max(t0, t1)) + 0.00001) continue;
        const point = { x: sa.start.x + r.x * t, y: sa.start.y + r.y * t };
        u = dot(sub(point, sb.start), s) / dot(s, s);
      } else {
        t = cross(offset, s) / denominator;
        u = cross(offset, r) / denominator;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      }
      const distanceA = sa.travelled + t * sa.size,
        distanceB = sb.travelled + u * sb.size;
      if (distanceA > horizon || distanceB > horizon) continue;
      if (
        !first ||
        distanceA < first.distanceA ||
        (distanceA === first.distanceA && distanceB < first.distanceB)
      ) {
        first = {
          point: { x: sa.start.x + t * r.x, y: sa.start.y + t * r.y },
          distanceA,
          distanceB,
          alignment,
          heading: r,
        };
      }
    }
  return first;
}

export function targetCleared(order, target) {
  if (!target || target.state === "done") return true;
  if (length(target, order.point) < separation) return false;
  if ((target.travelled || 0) >= order.releaseAt) return true;
  // A revised clearance that no longer approaches the crossing also releases the waiting aircraft.
  return distanceAhead(target, order.point, 30, Infinity) === Infinity;
}
