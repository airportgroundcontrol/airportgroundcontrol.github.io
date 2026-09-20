import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GroundSim,
  distance,
  requestsAction,
  groupedFlights,
} from "../src/sim.js";
import { routeConflict, separation } from "../src/traffic.js";
const data = JSON.parse(
  fs.readFileSync(new URL("../dist/data/egph.json", import.meta.url)),
);
const setup = () => {
  const s = new GroundSim(data);
  s.nextArrival = s.nextDeparture = Infinity;
  return s;
};
const advance = (s, predicate, seconds = 800) => {
  for (let i = 0; i < seconds * 10 && !predicate(); i++) s.tick(0.1);
  assert.ok(predicate(), "Expected condition was not reached");
};
const ready = (s) => {
  s.command(1, "pushback");
  advance(s, () => s.planes[0].state === "ready");
  return s.planes[0];
};
const taxi = (id, x, y, end) => ({
  id,
  call: "TEST" + id,
  state: "taxi",
  direction: "departure",
  x,
  y,
  angle: Math.atan2(end.y - y, end.x - x),
  node: null,
  stand: null,
  route: [end],
  targetSpeed: 8,
  speed: 0,
  wait: 0,
  travelled: 0,
  held: false,
});

test("mapped holding clearance stops at A15 and needs a new clearance; runway entry remains protected", () => {
  const s = setup(),
    p = ready(s),
    hold = s.holdingPoints().find((n) => n.ref === "A15");
  assert.ok(s.command(1, "taxi", { holdingPoint: hold.id }).ok);
  advance(s, () => p.state === "atpoint");
  assert.equal(p.node, hold.id);
  assert.equal(distance(p, hold), 0);
  assert.ok(requestsAction(p));
  assert.equal(s.command(1, "lineup").ok, false);
  assert.equal(s.command(1, "continue").ok, false);
  assert.ok(s.command(1, "taxi").ok);
  advance(s, () => p.state === "holding");
  assert.equal(p.node, data.departureHold);
});

test("hold short stops on the existing route and only onward clearance releases it", () => {
  const s = setup(),
    p = ready(s);
  s.command(1, "taxi");
  const limit = s.holdOptions(p).find((h) => h.id.startsWith("taxiway:"));
  assert.ok(limit);
  assert.deepEqual(
    s
      .holdOptions(p)
      .filter((h) => h.id.startsWith("taxiway:"))
      .map((h) => h.label),
    ["Taxiway F", "Taxiway A", "Taxiway D"],
  );
  assert.ok(s.command(1, "holdshort", { holdPoint: limit.id }).ok);
  advance(s, () => p.holdReached);
  const position = { x: p.x, y: p.y };
  for (let i = 0; i < 100; i++) s.tick(0.1);
  assert.equal(distance(p, position), 0);
  assert.ok(
    distance(p, limit.node) > 35,
    "Stops before the intersection, not in it",
  );
  assert.equal(s.command(1, "hold").ok, false);
  assert.equal(s.command(1, "lineup").ok, false);
  assert.ok(s.command(1, "continue").ok);
  advance(s, () => p.state === "holding");
  assert.equal(p.node, data.departureHold);
});

test("arrival can taxi to an intermediate hold before being assigned a stand", () => {
  const s = setup(),
    p = s.planes[3];
  s.command(p.id, "land");
  advance(s, () => p.state === "inbound");
  const hold = s.holdingPoints().find((n) => n.ref === "A15");
  assert.ok(s.command(p.id, "taxi", { holdingPoint: hold.id }).ok);
  advance(s, () => p.state === "atpoint");
  assert.equal(s.completed, 0);
  assert.ok(s.command(p.id, "taxi", { stand: "14" }).ok);
  advance(s, () => p.state === "parked");
  assert.equal(s.completed, 1);
});

test("mid-edge revised route starts at current position and continues to the next network node", () => {
  const s = setup(),
    p = ready(s);
  s.command(1, "taxi");
  for (let i = 0; i < 20; i++) s.tick(0.1);
  s.command(1, "hold");
  const next = p.route[0];
  const plan = s.plan(p, data.departureHold);
  assert.equal(distance(p, plan[0]), 0);
  assert.equal(plan[1].id, next.id);
  assert.ok(s.command(1, "taxi").ok);
  assert.equal(p.route[0].id, next.id);
});

test("follow queues behind the specified aircraft without incidents and resumes automatically", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1500, y: 1500 }),
    q = taxi(102, 200, 1500, { x: 1500, y: 1500 });
  s.planes = [p, q];
  q.held = true;
  assert.ok(s.command(p.id, "follow", { targetId: q.id }).ok);
  advance(s, () => p.trafficWaiting && p.speed < 0.05);
  assert.ok(distance(p, q) >= separation - 0.1);
  assert.equal(requestsAction(p), false);
  assert.equal(s.incidents, 0);
  const before = p.x;
  q.held = false;
  for (let i = 0; i < 500; i++) {
    s.tick(0.1);
    assert.ok(distance(p, q) >= separation - 0.1);
  }
  assert.ok(p.x > before + 100);
  assert.equal(s.incidents, 0);
});

test("give way stops before a crossing then releases only after the target clears", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1200, y: 1500 }),
    q = taxi(102, 300, 1200, { x: 300, y: 2400 });
  s.planes = [p, q];
  q.held = true;
  assert.ok(s.command(p.id, "giveway", { targetId: q.id }).ok);
  assert.equal(
    s.command(q.id, "giveway", { targetId: p.id }).ok,
    false,
    "Circular orders rejected",
  );
  advance(s, () => p.trafficWaiting && p.speed < 0.05);
  assert.ok(p.x <= 240.1);
  q.held = false;
  advance(s, () => !p.trafficOrder);
  assert.ok(q.y >= 1560);
  advance(s, () => p.x > 350);
  assert.equal(s.incidents, 0);
});

test("invalid traffic orders are rejected without altering the active route", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1200, y: 1500 }),
    q = taxi(102, 200, 1800, { x: 1200, y: 1800 });
  s.planes = [p, q];
  const route = JSON.stringify(p.route);
  for (const targetId of [101, 102, 999])
    assert.equal(s.command(101, "follow", { targetId }).ok, false);
  assert.equal(s.command(101, "holdshort", { holdPoint: "missing" }).ok, false);
  assert.equal(JSON.stringify(p.route), route);
});

test("cancelling traffic instructions does not override a manual stop or clearance limit", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1200, y: 1500 }),
    q = taxi(102, 200, 1500, { x: 1200, y: 1500 });
  s.planes = [p, q];
  s.command(101, "follow", { targetId: 102 });
  s.command(101, "hold");
  p.holdLimit = { stopAt: 100, label: "Test limit" };
  assert.ok(s.command(101, "canceltraffic").ok);
  assert.equal(p.held, true);
  assert.equal(p.holdLimit.stopAt, 100);
  s.tick(0.1);
  assert.equal(p.x, 0);
});

test("give-way order releases if the target is rerouted away, but not while it occupies the crossing", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1200, y: 1500 }),
    q = taxi(102, 300, 1200, { x: 300, y: 2400 });
  s.planes = [p, q];
  s.command(101, "giveway", { targetId: 102 });
  q.route = [{ x: 1000, y: 1200 }];
  s.tick(0.1);
  assert.equal(p.trafficOrder, null);
  q.x = 300;
  q.y = 1500;
  q.route = [{ x: 300, y: 2400 }];
  q.held = true;
  assert.ok(s.command(101, "giveway", { targetId: 102 }).ok);
  for (let i = 0; i < 300; i++) s.tick(0.1);
  assert.ok(p.trafficOrder);
  assert.ok(p.x <= 240.1);
});

test("crossing traffic on the right is given priority without a manual command", () => {
  const s = setup(),
    p = taxi(101, 0, 1500, { x: 1000, y: 1500 }),
    q = taxi(102, 150, 1650, { x: 150, y: 1000 });
  s.planes = [p, q];
  let yielded = false,
    minimum = Infinity;
  for (let i = 0; i < 450; i++) {
    s.tick(0.1);
    yielded ||= p.trafficWaiting === "right-of-way";
    minimum = Math.min(minimum, distance(p, q));
  }
  assert.ok(yielded);
  assert.ok(minimum > 45);
  assert.ok(p.x > 150);
  assert.equal(s.incidents, 0);
});

test("status groups aggregate requests first and distinguish automatic yielding from requests", () => {
  const s = setup();
  s.command(1, "pushback");
  const groups = groupedFlights(s.planes);
  assert.equal(groups[0].label, "Request pushback");
  assert.equal(groups[0].planes.length, 2);
  assert.equal(groups.at(-1).label, "Pushing back");
  const p = s.planes[0];
  p.state = "taxi";
  p.trafficWaiting = "giveway";
  assert.equal(requestsAction(p), false);
  assert.equal(groupedFlights([p])[0].label, "Giving way");
  p.holdReached = true;
  p.held = true;
  assert.equal(groupedFlights([p])[0].label, "Request onward clearance");
});

test("shared-route geometry distinguishes crossing, following and unrelated routes", () => {
  const a = taxi(1, 0, 0, { x: 500, y: 0 });
  assert.equal(
    routeConflict(a, taxi(2, 200, -100, { x: 200, y: 300 })).distanceA,
    200,
  );
  assert.equal(
    routeConflict(a, taxi(2, 200, -100, { x: 200, y: 300 }), { aligned: true }),
    null,
  );
  assert.equal(
    routeConflict(a, taxi(2, 100, 0, { x: 500, y: 0 }), { aligned: true })
      .distanceA,
    100,
  );
});
