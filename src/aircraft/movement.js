import { aircraftType } from "./catalog.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Cubic centerline interpolation with shared tangents at graph nodes. Control
// handles stay in a narrow, configured corridor; this is not swept-wing physics.
export function curvedRoute(points, corridor = 3, allowed = () => true) {
  const result = [];
  const tangent = (i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)];
    const length = distance(a, b) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    result.push({ ...a });
    if (!b || !a.id || !b.id || a.edgeFrom || b.edgeFrom) continue;
    const length = distance(a, b);
    if (length < 1) continue;
    const ta = tangent(i),
      tb = tangent(i + 1);
    const handle = Math.min(length / 3, corridor);
    const c1 = { x: a.x + ta.x * handle, y: a.y + ta.y * handle };
    const c2 = { x: b.x - tb.x * handle, y: b.y - tb.y * handle };
    const samples = [];
    const count = Math.max(4, Math.ceil(length / 6));
    for (let step = 1; step < count; step++) {
      const t = step / count,
        u = 1 - t;
      samples.push({
        x:
          u ** 3 * a.x +
          3 * u * u * t * c1.x +
          3 * u * t * t * c2.x +
          t ** 3 * b.x,
        y:
          u ** 3 * a.y +
          3 * u * u * t * c1.y +
          3 * u * t * t * c2.y +
          t ** 3 * b.y,
        edgeFrom: a.id,
        edgeTo: b.id,
      });
    }
    if (samples.every(allowed)) result.push(...samples);
  }
  return result;
}

export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function insideBuilding(p, features) {
  return features.some((f) => {
    if (!["building", "terminal"].includes(f.type) || !f.closed) return false;
    let inside = false;
    for (let i = 0, j = f.points.length - 1; i < f.points.length; j = i++) {
      const [x, y] = f.points[i],
        [px, py] = f.points[j];
      if (y > p.y !== py > p.y && p.x < ((px - x) * (p.y - y)) / (py - y) + x)
        inside = !inside;
    }
    return inside;
  });
}
export function routeLength(p) {
  let total = 0,
    previous = p;
  for (const next of p.route) {
    total += distance(previous, next);
    previous = next;
  }
  return total;
}

// Braking lookahead along the authorized centerline. No geometric corner cutting.
export function movementTarget(p, allowance) {
  const profile = aircraftType(p.type).performance;
  let target = p.targetSpeed;
  if (p.state === "takeoff") return target;
  const ground = p.state !== "landing" || p.vacating;
  if (ground)
    target = Math.min(
      target,
      p.state === "pushback" ? profile.pushback : profile.taxi,
    );
  if (p.state === "taxiin" && p.taxiTarget !== "hold" && routeLength(p) < 35)
    target = Math.min(target, 2);
  let along = 0,
    previous = p;
  for (let i = 0; i < p.route.length; i++) {
    const n = p.route[i],
      next = p.route[i + 1];
    along += distance(previous, n);
    if (next && distance(previous, n) > 0.01) {
      const incoming = Math.atan2(n.y - previous.y, n.x - previous.x);
      const outgoing = Math.atan2(next.y - n.y, next.x - n.x);
      const delta = Math.abs(
        Math.atan2(
          Math.sin(outgoing - incoming),
          Math.cos(outgoing - incoming),
        ),
      );
      if (delta > 0.2) {
        const cornerSpeed = Math.max(1, profile.turn / Math.max(0.6, delta));
        target = Math.min(
          target,
          Math.sqrt(
            cornerSpeed ** 2 + 2 * profile.braking * Math.max(0, along - 4),
          ),
        );
      }
    }
    previous = n;
  }
  const stopping = Math.min(allowance, along);
  target = Math.min(
    target,
    Math.sqrt(2 * profile.braking * Math.max(0, stopping - 0.03)),
  );
  if (stopping > 0.03 && target < 0.15) target = 0.15;
  return target;
}

export function advanceSpeed(p, target, dt) {
  const perf = aircraftType(p.type).performance;
  const acceleration =
    p.state === "takeoff" ? perf.takeoffAcceleration : perf.acceleration;
  return target >= p.speed
    ? Math.min(target, p.speed + acceleration * dt)
    : Math.max(target, p.speed - perf.braking * dt);
}

export function trimRouteEnd(points, clearance) {
  const route = points.map((p) => ({ ...p }));
  while (route.length > 1 && clearance > 0) {
    const b = route.pop(),
      a = route.at(-1),
      length = distance(a, b);
    if (length > clearance) {
      const t = (length - clearance) / length;
      route.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return route;
    }
    clearance -= length;
  }
  return [];
}
