import createGraph from "ngraph.graph";
import { nextRandomState, validSeed } from "./session/random.js";
import { aStar } from "ngraph.path";
import {
  aircraftType,
  queueSeparation,
  crossingSeparation,
} from "./aircraft/catalog.js";
import {
  standFit,
  excludedStands,
  edgeAllows,
} from "./aircraft/compatibility.js";
import {
  movementTarget,
  advanceSpeed,
  trimRouteEnd,
  routeLength,
  curvedRoute,
  insideBuilding,
} from "./aircraft/movement.js";
import {
  arrivalETA,
  pushbackOptions,
  landingOptions,
} from "./aircraft/operations.js";
import {
  separation,
  distanceAhead,
  routeConflict,
  targetCleared,
} from "./traffic.js";

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const travelTime = (length, speed, acceleration, limit) => {
  if (length <= 0) return 0;
  const initial = Math.max(0, speed),
    target = Math.max(initial, limit),
    acceleratingDistance =
      acceleration > 0 ? (target ** 2 - initial ** 2) / (2 * acceleration) : 0;
  if (acceleratingDistance >= length && acceleration > 0)
    return (
      (Math.sqrt(initial ** 2 + 2 * acceleration * length) - initial) /
      acceleration
    );
  return (
    (acceleration > 0 ? (target - initial) / acceleration : 0) +
    Math.max(0, length - acceleratingDistance) / Math.max(target, 0.1)
  );
};
const segmentsIntersect = (a, b, c, d) => {
  const side = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = side(a, b, c),
    abD = side(a, b, d),
    cdA = side(c, d, a),
    cdB = side(c, d, b),
    epsilon = 0.001;
  return (
    Math.min(abC, abD) <= epsilon &&
    Math.max(abC, abD) >= -epsilon &&
    Math.min(cdA, cdB) <= epsilon &&
    Math.max(cdA, cdB) >= -epsilon
  );
};
const edgeKey = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
export const statusNames = {
  gate: "Request pushback",
  pushback: "Pushing back",
  disconnect: "Tug disconnecting",
  ready: "Request taxi",
  taxi: "Taxiing out",
  holding: "Request runway entry",
  lineup: "Lining up",
  linedup: "Request takeoff",
  takeoff: "Taking off",
  approach: "Request landing",
  goaround: "Going around",
  landing: "Landing / vacating",
  crossing: "Crossing runway",
  inbound: "Request stand",
  taxiin: "Taxiing to stand",
  atpoint: "Request onward taxi",
  parked: "On stand",
  done: "Departed",
};
export const requestsAction = (p) =>
  p.state !== "done" &&
  !(p.tugRemaining > 0) &&
  ([
    "gate",
    "ready",
    "holding",
    "linedup",
    "approach",
    "inbound",
    "atpoint",
  ].includes(p.state) ||
    p.held ||
    p.blocked);
export const orderedFlights = (planes) =>
  planes
    .filter((p) => p.state !== "done")
    .sort(
      (a, b) =>
        Number(requestsAction(b)) - Number(requestsAction(a)) ||
        b.wait - a.wait ||
        a.id - b.id,
    );
export const flightStatus = (p) =>
  p.state === "landing" && p.airborne
    ? "Cleared to land"
    : p.state === "lineup" && p.rollingDeparture
      ? "Rolling departure"
      : p.held && p.speed > 0.05
        ? "Stopping"
        : p.tugRemaining > 0
          ? "Tug disconnecting"
          : p.blocked
            ? "Traffic conflict"
            : p.holdReached
              ? "Request onward clearance"
              : p.held
                ? "Holding position"
                : p.trafficWaiting
                  ? "Giving way"
                  : p.trafficOrder?.kind === "follow"
                    ? "Following traffic"
                    : statusNames[p.state];
export class GroundSim {
  constructor(data, { seed = 1 } = {}) {
    if (!data.operations || !data.scenario)
      throw new Error("A validated airport package is required.");
    this.data = data;
    this.scenario = data.scenario;
    this.nodes = new Map(data.nodes.map((n) => [n.id, n]));
    this.stands = new Map(data.stands.map((s) => [s.id, s]));
    this.graph = createGraph();
    for (const n of data.nodes) this.graph.addNode(n.id, n);
    for (const e of data.edges) this.graph.addLink(e.a, e.b, e);
    this.standNodes = new Set(data.stands.map((stand) => stand.node));
    this.defaultRouteTypes = new Set(data.fleet?.defaultRouteTypes || []);
    this.routeTypesByRef = new Map(
      (data.fleet?.routeRules || []).flatMap((rule) =>
        rule.refs.map((ref) => [ref, new Set(rule.allowedTypes)]),
      ),
    );
    this.runwayBlockedEdges = new Map(
      data.operations.runways.map((runway) => [runway.id, new Set()]),
    );
    for (const edge of data.edges) {
      const a = this.nodes.get(edge.a),
        b = this.nodes.get(edge.b),
        key = edgeKey(edge.a, edge.b);
      for (const runway of data.operations.runways)
        if (
          this.runwayDistance(a, { physical: runway }) <
            runway.protectedHalfWidth ||
          this.runwayDistance(b, { physical: runway }) <
            runway.protectedHalfWidth ||
          this.edgeCrossesRunway(a, b, { physical: runway })
        )
          this.runwayBlockedEdges.get(runway.id).add(key);
    }
    this.pathCache = new Map();
    this.groundComponentCache = new Map();
    this.holdingPointNodes = data.operations.holdingPoints
      .map((id) => this.nodes.get(id))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    this.supportedStandCache = new Map();
    this.reset(seed);
  }
  random() {
    this.randomState = nextRandomState(this.randomState);
    return this.randomState / 0x100000000;
  }
  pick(values) {
    return values.length
      ? values[Math.floor(this.random() * values.length)]
      : undefined;
  }
  randomCount([min, max]) {
    return min + Math.floor(this.random() * (max - min + 1));
  }
  jitter(base, spread = 0) {
    return spread ? base * (1 - spread + 2 * spread * this.random()) : base;
  }
  resolveRunwayUses(uses) {
    if (!Array.isArray(uses) || !uses.length)
      throw new Error("Select at least one runway.");
    if (new Set(uses.map((use) => use.runwayId)).size !== uses.length)
      throw new Error("Opposite runway ends cannot be active together.");
    const resolved = uses.map((use) => {
      const base = this.data.runwayConfigurations.find(
        (runway) =>
          runway.runwayId === use.runwayId && runway.endId === use.endId,
      );
      if (
        !base ||
        typeof use.arrivals !== "boolean" ||
        typeof use.departures !== "boolean" ||
        (!use.arrivals && !use.departures) ||
        (use.arrivals && !base.capabilities.includes("arrival")) ||
        (use.departures && !base.capabilities.includes("departure")) ||
        (use.weight !== undefined &&
          (!Number.isFinite(use.weight) || use.weight <= 0))
      )
        throw new Error("That runway role is not available.");
      return {
        ...base,
        arrivals: use.arrivals,
        departures: use.departures,
        weight: use.weight || 1,
      };
    });
    if (!resolved.some((runway) => runway.arrivals))
      throw new Error("At least one arrival runway is required.");
    if (!resolved.some((runway) => runway.departures))
      throw new Error("At least one departure runway is required.");
    return resolved;
  }
  runwayFor(value = null) {
    const key =
      typeof value === "string" ? value : value?.runwayKey || value?.key;
    return (
      this.data.runwayConfigurations.find((runway) => runway.key === key) ||
      this.activeRunways[0] ||
      this.data.runwayConfigurations[0]
    );
  }
  ownerForRunway(value = null) {
    return this.runwayOwners.get(this.runwayFor(value).runwayId) ?? null;
  }
  setRunwayOwner(value, aircraftId) {
    const runwayId = this.runwayFor(value).runwayId;
    if (aircraftId == null) this.runwayOwners.delete(runwayId);
    else this.runwayOwners.set(runwayId, aircraftId);
  }
  ownerForPhysical(runwayId) {
    return this.runwayOwners.get(runwayId) ?? null;
  }
  setPhysicalRunwayOwner(runwayId, aircraftId) {
    if (aircraftId == null) this.runwayOwners.delete(runwayId);
    else this.runwayOwners.set(runwayId, aircraftId);
  }
  get runwayOwner() {
    return this.ownerForRunway();
  }
  set runwayOwner(aircraftId) {
    this.setRunwayOwner(null, aircraftId);
  }
  lastDepartureFor(value = null) {
    return this.lastDepartures.get(this.runwayFor(value).runwayId) ?? null;
  }
  setLastDeparture(value, departure) {
    const runwayId = this.runwayFor(value).runwayId;
    if (departure == null) this.lastDepartures.delete(runwayId);
    else this.lastDepartures.set(runwayId, departure);
  }
  get lastDeparture() {
    return this.lastDepartureFor();
  }
  set lastDeparture(departure) {
    this.setLastDeparture(null, departure);
  }
  weightedRunway(runways) {
    if (!runways.length) return null;
    const total = runways.reduce((sum, runway) => sum + runway.weight, 0);
    let pick = this.random() * total;
    for (const runway of runways) {
      pick -= runway.weight;
      if (pick <= 0) return runway;
    }
    return runways.at(-1);
  }
  standPathAllows(type, stand) {
    return stand.path.slice(1).every((id, index) => {
      const edge =
        this.graph.getLink(stand.path[index], id) ||
        this.graph.getLink(id, stand.path[index]);
      return edge && edgeAllows(this.data, edge.data, type);
    });
  }
  departureRunways(type, stand) {
    return this.activeRunways.filter(
      (runway) =>
        runway.departures &&
        runway.departureHold &&
        runway.departureEntry &&
        this.hasGroundRoute(stand.exit, runway.departureHold, type) &&
        this.path(runway.departureHold, runway.departureEntry, runway.key, type)
          .length > 0,
    );
  }
  departureRunwayOptions(p) {
    if (!p || p.direction !== "departure") return [];
    return this.activeRunways.filter((runway) => {
      if (!runway.departures) return false;
      if (p.node === runway.departureHold) return true;
      return this.plan(p, runway.departureHold).length >= 2;
    });
  }
  arrivalRunways(type, stand = null) {
    return this.activeRunways.filter((runway) => {
      if (!runway.arrivals || !runway.configuration.vacatePath?.length)
        return false;
      const last = runway.configuration.vacatePath.at(-1);
      return stand
        ? this.standPathAllows(type, stand) &&
            this.hasGroundRoute(last, stand.exit, type)
        : this.data.stands.some(
            (candidate) =>
              !standFit(this.data, candidate.id, type) &&
              this.standPathAllows(type, candidate) &&
              this.hasGroundRoute(last, candidate.exit, type),
          );
    });
  }
  arrivalRunwayOptions(p) {
    if (!p || p.direction !== "arrival") return [];
    const current = this.runwayFor(p);
    const candidates = [...this.arrivalRunways(p.type)];
    if (
      ["approach", "landing"].includes(p.state) &&
      current.capabilities.includes("arrival") &&
      !candidates.some((runway) => runway.key === current.key)
    )
      candidates.push(current);
    const headingDifference = (a, b) => {
      const difference = Math.abs(a - b) % (Math.PI * 2);
      return Math.min(difference, Math.PI * 2 - difference);
    };
    return candidates.filter((runway) => {
      const heading = Math.atan2(
        runway.end.y - runway.start.y,
        runway.end.x - runway.start.x,
      );
      return headingDifference(p.angle, heading) <= Math.PI / 12;
    });
  }
  trafficInterval(kind) {
    return this.jitter(
      this.scenario.traffic[kind + "Interval"],
      this.scenario.traffic.intervalJitter,
    );
  }
  supportedStands(type) {
    if (!this.supportedStandCache.has(type))
      this.supportedStandCache.set(
        type,
        this.data.stands.filter((s) => this.supportsType(type, s)),
      );
    return this.supportedStandCache.get(type);
  }
  spawnRandomDeparture() {
    const free = new Set(
      this.freeStands()
        .filter((s) => this.scenario.departureStands.includes(s.id))
        .map((s) => s.id),
    );
    const eligible = new Map(
      [...new Set(this.data.fleet.departureTypes)].map((type) => [
        type,
        this.supportedStands(type).filter((s) => free.has(s.id)),
      ]),
    );
    const type = this.pick(
      this.data.fleet.departureTypes.filter(
        (type) => eligible.get(type).length,
      ),
    );
    if (type)
      this.spawnDeparture(this.pick(eligible.get(type)).id, undefined, type);
  }
  standReason(p, id, { occupancy = true, route = true } = {}) {
    const stand = this.stands.get(id);
    if (!stand) return "Unknown stand";
    const fit = standFit(this.data, id, p.type);
    if (fit) return fit;
    const excluded = excludedStands(this.data, id);
    if (
      occupancy &&
      this.planes.some(
        (q) =>
          q.id !== p.id &&
          q.state !== "done" &&
          (excluded.has(q.stand) || excluded.has(q.departureStand)),
      )
    )
      return "Occupied or reserved";
    if (
      route &&
      !this.path(
        p.node || this.runwayFor(p).configuration.vacatePath.at(-1),
        stand.node,
        false,
        p.type,
      ).length
    )
      return "No compatible taxi route";
    return null;
  }
  supportsType(type, stand) {
    return (
      !standFit(this.data, stand.id, type) &&
      this.standPathAllows(type, stand) &&
      this.departureRunways(type, stand).length > 0 &&
      this.arrivalRunways(type, stand).some((runway) =>
        runway.configuration.vacatePath.slice(1).every((id, i) => {
          const previous = runway.configuration.vacatePath[i];
          const edge =
            this.graph.getLink(previous, id) ||
            this.graph.getLink(id, previous);
          return edge && edgeAllows(this.data, edge.data, type);
        }),
      )
    );
  }
  wakeWait(p) {
    const lastDeparture = this.lastDepartureFor(p);
    if (!lastDeparture) return 0;
    const leader = aircraftType(lastDeparture.type).wake;
    const follower = aircraftType(p.type).wake;
    const delay =
      this.data.fleet?.departureWakeSeconds?.[leader]?.[follower] || 0;
    return Math.max(0, lastDeparture.time + delay - this.time);
  }
  departureWakeDelay(leader, follower) {
    if (!leader || !follower) return 0;
    return (
      this.data.fleet?.departureWakeSeconds?.[aircraftType(leader.type).wake]?.[
        aircraftType(follower.type).wake
      ] || 0
    );
  }
  runwaySafetyBuffer(leader, follower) {
    if (!leader || !follower) return 8;
    const lead = aircraftType(leader.type),
      trail = aircraftType(follower.type);
    return (
      8 +
      (lead.wake === "H" ? (trail.wake === "M" ? 18 : 12) : 0) +
      Math.max(0, lead.length - trail.length) / 20
    );
  }
  runwayTraffic(value, exceptId = null) {
    const runwayId = this.runwayFor(value).runwayId;
    return this.planes.filter(
      (plane) =>
        plane.id !== exceptId &&
        plane.state !== "done" &&
        this.runwayFor(plane).runwayId === runwayId,
    );
  }
  clearedArrivalForRunway(value, exceptId = null) {
    return this.runwayTraffic(value, exceptId).find(
      (plane) => plane.state === "landing" && plane.airborne,
    );
  }
  rollingDepartureForRunway(value, exceptId = null) {
    return this.runwayTraffic(value, exceptId).find(
      (plane) => plane.state === "lineup" && plane.rollingDeparture,
    );
  }
  entryTravelSeconds(p, entryPath) {
    const perf = aircraftType(p.type).performance;
    let length = 0,
      previous = p;
    for (const point of entryPath) {
      length += distance(previous, point);
      previous = point;
    }
    return travelTime(length, p.speed, perf.acceleration, perf.taxi);
  }
  takeoffClearSeconds(p, { entryPath = null } = {}) {
    const runway = this.runwayFor(p),
      perf = aircraftType(p.type).performance,
      runwayLength = distance(runway.start, runway.end),
      entry = this.nodes.get(runway.departureEntry) || runway.start;
    let seconds = 0,
      start = p,
      speed = p.speed;
    if (entryPath) {
      seconds += this.entryTravelSeconds(p, entryPath);
      start = entry;
      speed = perf.taxi;
    }
    const clearDistance = distance(start, runway.end) + runwayLength * 0.25;
    return (
      seconds +
      travelTime(clearDistance, speed, perf.takeoffAcceleration, perf.takeoff)
    );
  }
  runwayReleaseSeconds(value) {
    const ownerId = this.ownerForRunway(value);
    if (!ownerId) return 0;
    const owner = this.planes.find((plane) => plane.id === ownerId);
    if (!owner) return Infinity;
    const perf = aircraftType(owner.type).performance;
    if (owner.state === "takeoff")
      return travelTime(
        routeLength(owner),
        owner.speed,
        perf.takeoffAcceleration,
        perf.takeoff,
      );
    if (owner.state === "landing" && !owner.airborne)
      return (
        routeLength(owner) / Math.max(3, Math.min(owner.speed || 3, 9)) + 5
      );
    if (owner.state === "crossing")
      return travelTime(routeLength(owner), owner.speed, perf.acceleration, 6);
    if (owner.state === "lineup" && owner.rollingDeparture)
      return this.takeoffClearSeconds(owner, { entryPath: owner.route });
    return Infinity;
  }
  arrivalRunwayWindow(p) {
    const eta = this.arrivalETA(p),
      runway = this.runwayFor(p),
      ownerId = this.ownerForRunway(p),
      owner = this.planes.find((plane) => plane.id === ownerId),
      rolling = this.rollingDepartureForRunway(p, p.id),
      otherArrival = this.clearedArrivalForRunway(p, p.id);
    if (otherArrival)
      return {
        ok: false,
        message: `Runway ${runway.label} already has a cleared arrival.`,
      };
    let leader = null,
      clearSeconds = 0;
    if (ownerId && ownerId !== p.id) {
      leader = owner;
      clearSeconds = this.runwayReleaseSeconds(p);
    }
    if (rolling && rolling.id !== ownerId) {
      const rollingClear = this.takeoffClearSeconds(rolling, {
        entryPath: rolling.route,
      });
      if (rollingClear > clearSeconds) {
        leader = rolling;
        clearSeconds = rollingClear;
      }
    }
    if (!leader) return { ok: true, anticipated: false };
    const buffer = this.runwaySafetyBuffer(leader, p);
    if (Number.isFinite(clearSeconds) && clearSeconds + buffer <= eta)
      return { ok: true, anticipated: true, leader, clearSeconds, buffer };
    return {
      ok: false,
      message: `Runway ${runway.label} traffic is not projected clear before threshold.`,
    };
  }
  takeoffRunwayWindow(p, { entryPath = null } = {}) {
    const runway = this.runwayFor(p),
      ownerId = this.ownerForRunway(p),
      owner = this.planes.find((plane) => plane.id === ownerId),
      rolling = !!entryPath,
      entrySeconds = rolling ? this.entryTravelSeconds(p, entryPath) : 0;
    if (!rolling && ownerId !== p.id)
      return { ok: false, message: `Line up on runway ${runway.label} first.` };
    const otherRolling = this.rollingDepartureForRunway(p, p.id);
    if (otherRolling)
      return {
        ok: false,
        message: "Another rolling departure is already cleared.",
      };
    if (rolling && ownerId && ownerId !== p.id) {
      const release = this.runwayReleaseSeconds(p),
        buffer = this.runwaySafetyBuffer(owner, p),
        wake = this.departureWakeDelay(owner, p);
      if (
        !Number.isFinite(release) ||
        release + Math.max(buffer, wake) > entrySeconds
      )
        return {
          ok: false,
          message: `Runway ${runway.label} will not be clear before runway entry.`,
        };
    }
    const wakeWait = this.wakeWait(p);
    if (wakeWait > entrySeconds)
      return {
        ok: false,
        message: `Wake separation. Wait ${Math.ceil(wakeWait - entrySeconds)} seconds.`,
      };
    const arrival = this.clearedArrivalForRunway(p, p.id);
    if (arrival) {
      const clearSeconds = this.takeoffClearSeconds(p, { entryPath }),
        buffer = this.runwaySafetyBuffer(p, arrival);
      if (clearSeconds + buffer > this.arrivalETA(arrival))
        return {
          ok: false,
          message: `${arrival.call} is too close for departure before landing.`,
        };
      return { ok: true, anticipated: true, arrival, clearSeconds, buffer };
    }
    return { ok: true, anticipated: rolling && !!ownerId };
  }
  pushbackOptions(p) {
    return pushbackOptions(this, p);
  }
  landingOptions(p, runwayValue = p) {
    return landingOptions(this, p, runwayValue);
  }
  crossingOptions(p) {
    if (p.state !== "atpoint" && p.state !== "holding") return [];
    return (this.data.operations.runwayCrossings || []).flatMap((crossing) => {
      const path =
        crossing.path[0] === p.node
          ? crossing.path
          : crossing.path.at(-1) === p.node
            ? [...crossing.path].reverse()
            : null;
      if (
        path &&
        path.slice(1).every((id, index) => {
          const link =
            this.graph.getLink(path[index], id) ||
            this.graph.getLink(id, path[index]);
          return link && edgeAllows(this.data, link.data, p.type);
        })
      )
        return [{ ...crossing, path }];
      return [];
    });
  }
  arrivalETA(p) {
    return arrivalETA(p, {
      ...this.data,
      activeRunways: this.data.runwayConfigurations,
    });
  }
  runwayUses() {
    return this.activeRunways.map(
      ({ runwayId, endId, arrivals, departures, weight }) => ({
        runwayId,
        endId,
        arrivals,
        departures,
        ...(weight === 1 ? {} : { weight }),
      }),
    );
  }
  configureRunways(uses, { presetId = null } = {}) {
    let next;
    try {
      next = this.resolveRunwayUses(uses);
    } catch (error) {
      return {
        ok: false,
        message: error.message.replace(/^Invalid airport package: /, ""),
      };
    }
    const before = this.runwayUses();
    const previousRunways = this.activeRunways,
      previousPresetId = this.runwayPresetId;
    this.activeRunways = next;
    this.runwayPresetId = presetId;
    this.supportedStandCache.clear();

    const reroutable = new Set(["gate", "pushback", "disconnect", "ready"]);
    const assignments = [];
    for (const p of this.planes) {
      if (
        !(
          (p.direction === "departure" && reroutable.has(p.state)) ||
          p.state === "parked"
        )
      )
        continue;
      const stand = p.stand ? this.stands.get(p.stand) : null;
      const origin = stand || (p.node ? { exit: p.node } : null);
      if (!origin) continue;
      const candidates = this.departureRunways(p.type, origin);
      if (!candidates.length) {
        this.activeRunways = previousRunways;
        this.runwayPresetId = previousPresetId;
        this.supportedStandCache.clear();
        return {
          ok: false,
          message: `${p.call} has no compatible route to a departure runway in that configuration.`,
        };
      }
      if (p.state === "parked") continue;
      const current = candidates.find((runway) => runway.key === p.runwayKey);
      const runway = current || candidates[0];
      if (runway.key !== p.runwayKey) assignments.push([p, runway.key]);
    }
    for (const [plane, runwayKey] of assignments) plane.runwayKey = runwayKey;
    const rerouted = assignments.length;

    const oldRoles = new Set(
      before.flatMap((use) => [
        ...(use.arrivals ? [use.runwayId + ":" + use.endId + ":arrival"] : []),
        ...(use.departures
          ? [use.runwayId + ":" + use.endId + ":departure"]
          : []),
      ]),
    );
    for (const use of this.runwayUses()) {
      if (use.arrivals)
        oldRoles.delete(use.runwayId + ":" + use.endId + ":arrival");
      if (use.departures)
        oldRoles.delete(use.runwayId + ":" + use.endId + ":departure");
    }
    this.runwayTransition = oldRoles.size
      ? { roles: [...oldRoles], startedAt: this.time }
      : null;
    this.updateRunwayTransition();
    return { ok: true, transitioning: !!this.runwayTransition, rerouted };
  }
  updateRunwayTransition() {
    if (!this.runwayTransition) return;
    const committed = this.planes.some((p) => {
      if (["done", "goaround"].includes(p.state)) return false;
      const role = `${this.runwayFor(p).key}:${p.direction}`;
      if (!this.runwayTransition.roles.includes(role)) return false;
      return p.direction === "arrival"
        ? ["approach", "landing"].includes(p.state)
        : ["taxi", "holding", "lineup", "linedup", "takeoff"].includes(p.state);
    });
    if (!committed) {
      this.runwayTransition = null;
    }
  }
  goAround(p, automatic = false, reason = "") {
    if (this.ownerForRunway(p) === p.id) this.setRunwayOwner(p, null);
    const runway = this.runwayFor(p),
      start = runway.start,
      end = runway.end;
    const length = distance(start, end),
      dx = (end.x - start.x) / length,
      dy = (end.y - start.y) / length;
    p.state = "goaround";
    p.airborne = true;
    p.route = [{ x: end.x + dx * 2500, y: end.y + dy * 2500 }];
    p.wait = 0;
    p.speed = aircraftType(p.type).performance.landing;
    p.targetSpeed = p.speed;
    const separationPenalty = reason === "separation";
    const penalty =
      this.scenario.scoring.goAround +
      (separationPenalty ? this.scenario.scoring.conflict : 0);
    this.score -= penalty;
    if (automatic) this.incidents++;
  }
  reset(seed = this.randomSeed) {
    if (!validSeed(seed))
      throw new Error("A nonzero 32-bit simulation seed is required.");
    this.randomSeed = this.randomState = seed;
    this.time = 0;
    this.score = 0;
    this.completed = 0;
    this.incidents = 0;
    this.planes = [];
    this.nextId = 1;
    this.runwayOwners = new Map();
    this.lastDepartures = new Map();
    this.activeRunways = this.resolveRunwayUses(this.scenario.runwayUses);
    this.runwayPresetId =
      this.data.runwayPresets.find(
        (preset) =>
          JSON.stringify(preset.runwayUses) ===
          JSON.stringify(this.scenario.runwayUses),
      )?.id || null;
    this.runwayTransition = null;
    this.nextArrival = this.trafficInterval("arrival");
    // Kept in snapshots for format-2 compatibility. After the opening roster,
    // departures only come from aircraft that arrived and completed a turnaround.
    this.nextDeparture = Infinity;
    this.nextCleanup = this.scenario.cleanupSeconds;
    this.conflictPairs = new Set();
    for (const { stand, call } of this.data.fleet
      ? this.scenario.initialDepartures
      : [])
      this.spawnDeparture(stand, call);
    for (const call of this.data.fleet ? this.scenario.initialArrivals : [])
      this.spawnArrival(call);
    if (this.data.fleet && this.scenario.initialTraffic) {
      const departures = this.randomCount(
        this.scenario.initialTraffic.departures,
      );
      const arrivals = this.randomCount(this.scenario.initialTraffic.arrivals);
      for (let i = 0; i < departures; i++) this.spawnRandomDeparture();
      for (let i = 0; i < arrivals; i++) this.spawnArrival();
    }
  }
  callsign(prefix) {
    let number = 100 + Math.floor(this.random() * 9900);
    while (
      this.planes.some((p) => p.state !== "done" && p.call === prefix + number)
    )
      number = number === 9999 ? 100 : number + 1;
    return prefix + number;
  }
  spawnDeparture(standId, call, requestedType) {
    const s = this.stands.get(standId);
    if (
      !s ||
      this.planes.some((p) => p.stand === standId && p.state !== "done")
    )
      return;
    const n = this.nodes.get(s.node);
    const type =
      requestedType ||
      this.data.fleet.initialTypes[call] ||
      this.pick(
        this.data.fleet.departureTypes.filter((type) =>
          this.supportsType(type, s),
        ),
      );
    if (
      !type ||
      !this.supportsType(type, s) ||
      this.standReason({ type }, standId, { route: false })
    )
      return;
    const runway = this.weightedRunway(this.departureRunways(type, s));
    if (!runway) return;
    const id = this.nextId++;
    const calls = this.scenario.traffic.departurePrefixes;
    this.planes.push({
      id,
      call: call || this.callsign(this.pick(calls)),
      type,
      state: "gate",
      x: n.x,
      y: n.y,
      node: s.node,
      angle: s.heading,
      stand: standId,
      route: [],
      speed: 0,
      direction: "departure",
      wait: 0,
      held: false,
      blocked: false,
      runwayKey: runway.key,
    });
  }
  spawnArrival(call, requestedType) {
    const type =
      requestedType ||
      this.data.fleet.initialTypes[call] ||
      this.pick(
        this.data.fleet.arrivalTypes.filter(
          (type) => this.supportedStands(type).length,
        ),
      );
    if (!type || !this.supportedStands(type).length) return;
    const runway = this.weightedRunway(this.arrivalRunways(type));
    if (!runway) return;
    const id = this.nextId++,
      start = runway.start,
      end = runway.end;
    const length = distance(start, end);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const approachSpeed = aircraftType(type).performance.landing;
    const latest = Math.max(
      0,
      ...this.planes
        .filter((p) => p.runwayKey === runway.key)
        .map((p) => this.arrivalETA(p) || 0),
    );
    const seconds = Math.max(
      this.jitter(
        this.scenario.traffic.approachSeconds || 90,
        this.scenario.traffic.approachJitter,
      ),
      latest
        ? latest + (this.scenario.traffic.approachSeparationSeconds || 60)
        : 0,
    );
    const spacing = seconds * approachSpeed;
    this.planes.push({
      id,
      call:
        call || this.callsign(this.pick(this.scenario.traffic.arrivalPrefixes)),
      type,
      state: "approach",
      x: start.x - ((end.x - start.x) / length) * spacing,
      y: start.y - ((end.y - start.y) / length) * spacing,
      angle,
      node: null,
      stand: null,
      route: [],
      speed: approachSpeed,
      airborne: true,
      direction: "arrival",
      wait: 0,
      held: false,
      blocked: false,
      runwayKey: runway.key,
    });
  }
  runwayDistance(n, value = null) {
    const runway = value?.physical ? value : this.runwayFor(value),
      physical = runway.physical || runway,
      [a, b] = physical.ends.map((end) => end.position),
      dx = b.x - a.x,
      dy = b.y - a.y,
      t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / (dx * dx + dy * dy);
    if (t < -0.01 || t > 1.01) return Infinity;
    return Math.abs((n.x - a.x) * dy - (n.y - a.y) * dx) / Math.hypot(dx, dy);
  }
  runwaysAt(point) {
    return this.data.operations.runways.filter(
      (runway) =>
        this.runwayDistance(point, { physical: runway }) <
        runway.protectedHalfWidth,
    );
  }
  edgeCrossesRunway(from, to, value) {
    const a = typeof from === "string" ? this.nodes.get(from) : from,
      b = typeof to === "string" ? this.nodes.get(to) : to,
      runway = value?.physical
        ? value.physical
        : this.runwayFor(value).physical,
      [start, end] = runway.ends.map((item) => item.position);
    if (!a || !b || !segmentsIntersect(a, b, start, end)) return false;
    const dx = end.x - start.x,
      dy = end.y - start.y,
      length = Math.hypot(dx, dy),
      signedDistance = (point) =>
        ((point.x - start.x) * dy - (point.y - start.y) * dx) / length,
      sideA = signedDistance(a),
      sideB = signedDistance(b);
    return (
      sideA * sideB < 0 &&
      Math.abs(sideA) >= runway.protectedHalfWidth &&
      Math.abs(sideB) >= runway.protectedHalfWidth
    );
  }
  hasGroundRoute(from, to, type) {
    if (!type) return this.path(from, to).length > 0;
    if (!this.nodes.has(from) || !this.nodes.has(to)) return false;
    if (!this.groundComponentCache.has(type)) {
      const parent = new Map(
          this.data.nodes
            .filter((node) => !this.standNodes.has(node.id))
            .map((node) => [node.id, node.id]),
        ),
        find = (id) => {
          let root = parent.get(id);
          while (root !== parent.get(root)) root = parent.get(root);
          while (id !== root) {
            const next = parent.get(id);
            parent.set(id, root);
            id = next;
          }
          return root;
        },
        union = (a, b) => {
          const rootA = find(a),
            rootB = find(b);
          if (rootA !== rootB) parent.set(rootB, rootA);
        };
      for (const edge of this.data.edges) {
        if (!parent.has(edge.a) || !parent.has(edge.b)) continue;
        if (
          !(this.routeTypesByRef.get(edge.ref) || this.defaultRouteTypes).has(
            type,
          )
        )
          continue;
        const key = edgeKey(edge.a, edge.b);
        if (
          this.data.operations.runways.some((runway) =>
            this.runwayBlockedEdges.get(runway.id).has(key),
          )
        )
          continue;
        union(edge.a, edge.b);
      }
      for (const id of parent.keys()) parent.set(id, find(id));
      this.groundComponentCache.set(type, parent);
    }
    const components = this.groundComponentCache.get(type);
    return components.has(from) && components.get(from) === components.get(to);
  }
  path(from, to, allowRunway = false, type = null) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return [];
    const allowed = new Set(
        allowRunway === true
          ? [this.data.activeRunways[0].runwayId]
          : typeof allowRunway === "string"
            ? [this.runwayFor(allowRunway).runwayId]
            : Array.isArray(allowRunway)
              ? allowRunway.map((value) => this.runwayFor(value).runwayId)
              : [],
      ),
      cacheKey = [from, to, [...allowed].sort().join(","), type || ""].join(
        "|",
      ),
      cached = this.pathCache.get(cacheKey);
    if (cached) return cached.map((id) => ({ ...this.nodes.get(id) }));
    const finder = aStar(this.graph, {
      distance: (a, b) => distance(a.data, b.data),
      heuristic: (a, b) => distance(a.data, b.data),
      blocked: (a, b, link) => {
        if (
          type &&
          !(
            this.routeTypesByRef.get(link.data.ref) || this.defaultRouteTypes
          ).has(type)
        )
          return true;
        if (
          (this.standNodes.has(a.id) && a.id !== from && a.id !== to) ||
          (this.standNodes.has(b.id) && b.id !== from && b.id !== to)
        )
          return true;
        return this.data.operations.runways.some(
          (runway) =>
            !allowed.has(runway.id) &&
            this.runwayBlockedEdges.get(runway.id).has(edgeKey(a.id, b.id)),
        );
      },
    });
    const result = finder.find(from, to).reverse();
    // Some blocked searches return a goal with no parent; reject incomplete routes.
    const ids =
      result[0]?.id === from && result.at(-1)?.id === to
        ? result.map((node) => node.id)
        : [];
    if (this.pathCache.size >= 2000) this.pathCache.clear();
    this.pathCache.set(cacheKey, ids);
    return ids.map((id) => ({ ...this.nodes.get(id) }));
  }
  plan(p, destination, waypoints = []) {
    const between =
      p.route.length && distance(p, this.nodes.get(p.node) || p) > 0.1;
    const nextNodeIndex = p.route.findIndex((n) => n.id);
    let from = between ? p.route[nextNodeIndex]?.id : p.node;
    let points = [];
    for (const to of [...waypoints, destination]) {
      const part = this.path(from, to, false, p.type);
      if (!part.length) return [];
      points.push(...part.slice(points.length ? 1 : 0));
      from = to;
    }
    return between
      ? [
          {
            x: p.x,
            y: p.y,
            edgeFrom: p.route[0].edgeFrom,
            edgeTo: p.route[0].edgeTo,
          },
          ...p.route.slice(0, Math.max(0, nextNodeIndex)),
          ...points,
        ]
      : points;
  }
  routeNames(points) {
    const names = [];
    for (let i = 1; i < points.length; i++) {
      const edge =
        this.graph.getLink(points[i - 1].id, points[i].id) ||
        this.graph.getLink(points[i].id, points[i - 1].id);
      const ref = edge?.data.ref;
      if (ref && ref !== names.at(-1) && edge.data.type !== "parking_position")
        names.push(ref);
    }
    return names;
  }
  setRoute(p, points, state, speed) {
    const allowedRunwayId = ["lineup", "landing"].includes(state)
      ? this.runwayFor(p).runwayId
      : state === "crossing"
        ? (this.data.operations.runwayCrossings || []).find(
            (crossing) => crossing.id === p.crossingId,
          )?.runwayId
        : null;
    p.route = [
      "pushback",
      "taxi",
      "taxiin",
      "lineup",
      "landing",
      "crossing",
    ].includes(state)
      ? curvedRoute(
          points,
          this.data.operations.curveCorridor || 3,
          (n) =>
            !insideBuilding(n, this.data.features) &&
            this.runwaysAt(n).every((runway) => runway.id === allowedRunwayId),
        )
      : points.map((n) => ({ ...n }));
    if (p.route.length && distance(p, p.route[0]) < 1) p.route.shift();
    p.state = state;
    p.targetSpeed = speed;
    p.held = false;
    p.blocked = false;
    p.wait = 0;
  }
  startTakeoff(p) {
    const runway = this.runwayFor(p),
      owner = this.ownerForRunway(p);
    if (owner && owner !== p.id) return false;
    this.setRunwayOwner(p, p.id);
    const end = runway.end;
    this.setRoute(
      p,
      [
        end,
        {
          x: end.x + (end.x - runway.start.x) * 0.25,
          y: end.y + (end.y - runway.start.y) * 0.25,
        },
      ],
      "takeoff",
      aircraftType(p.type).performance.takeoff,
    );
    return true;
  }
  holdingPoints() {
    return this.holdingPointNodes;
  }
  edgeRef(a, b) {
    return (this.graph.getLink(a, b) || this.graph.getLink(b, a))?.data.ref;
  }
  holdOptions(p) {
    if (!["taxi", "taxiin"].includes(p.state)) return [];
    const options = [];
    let previous = p,
      along = 0,
      lastRef = "";
    for (let i = 0; i < p.route.length; i++) {
      const n = p.route[i];
      along += distance(previous, n);
      if (
        this.data.operations.holdingPoints.includes(n.id) &&
        n.ref &&
        along > 5
      )
        options.push({
          id: "point:" + n.id,
          label: n.ref,
          distance: Math.max(0, along - aircraftType(p.type).length / 2 - 3),
          node: n,
        });
      const incoming =
        this.edgeRef(
          previous === p ? p.node : previous.id || previous.edgeFrom,
          n.id || n.edgeTo,
        ) || lastRef;
      const next = p.route[i + 1],
        outgoing =
          next &&
          (
            this.graph.getLink(n.id, next.id || next.edgeTo) ||
            this.graph.getLink(next.id || next.edgeTo, n.id)
          )?.data;
      if (
        incoming &&
        outgoing?.ref &&
        incoming !== outgoing.ref &&
        along > separation + 5 &&
        ["taxiway", "taxilane"].includes(outgoing.type)
      )
        options.push({
          id: "taxiway:" + n.id,
          label: "Taxiway " + outgoing.ref,
          distance: along - separation,
          node: n,
        });
      lastRef = incoming;
      previous = n;
    }
    return options.sort((a, b) => a.distance - b.distance);
  }
  trafficCandidates(p, kind) {
    if (!["taxi", "taxiin"].includes(p.state) || !p.route.length) return [];
    return this.planes
      .filter(
        (q) =>
          q.id !== p.id &&
          ["taxi", "taxiin", "pushback"].includes(q.state) &&
          q.route.length,
      )
      .filter((q) => {
        const conflict = routeConflict(p, q, { aligned: kind === "follow" });
        return (
          conflict &&
          conflict.distanceA >= separation &&
          !this.trafficCycle(p, q)
        );
      });
  }
  trafficCycle(p, q) {
    const seen = new Set([p.id]);
    while (q) {
      if (seen.has(q.id)) return true;
      seen.add(q.id);
      q = this.planes.find((n) => n.id === q.trafficOrder?.targetId);
    }
    return false;
  }
  freeStands(plane = null) {
    return this.data.stands.filter((s) =>
      plane
        ? !this.standReason(plane, s.id)
        : !this.planes.some(
            (p) =>
              (excludedStands(this.data, s.id).has(p.stand) ||
                excludedStands(this.data, s.id).has(p.departureStand)) &&
              p.state !== "done",
          ),
    );
  }
  command(
    id,
    action,
    {
      stand,
      waypoints = [],
      holdingPoint,
      holdPoint,
      targetId,
      pushbackOption,
      exitId,
      crossingId,
      runwayKey,
    } = {},
  ) {
    const p = this.planes.find((p) => p.id === id);
    if (!p || p.state === "done")
      return { ok: false, message: "No active flight." };
    const reject = (message) => ({ ok: false, message });
    if (action === "continue") {
      if (!p.holdReached || !p.route.length)
        return reject("A new taxi clearance is required.");
      p.holdLimit = null;
      p.holdReached = false;
      p.held = false;
      p.wait = 0;
      return { ok: true };
    }
    if (action === "hold") {
      if (
        !["pushback", "taxi", "taxiin", "ready", "inbound"].includes(p.state) ||
        p.holdReached
      )
        return reject("Use onward clearance to leave the holding point.");
      p.held = !p.held;
      return { ok: true };
    }
    if (action === "holdshort") {
      if (p.holdReached) return reject("Issue onward clearance first.");
      const limit = this.holdOptions(p).find((h) => h.id === holdPoint);
      if (!limit)
        return reject("Choose a holding point or taxiway ahead on this route.");
      p.holdLimit = { ...limit, stopAt: (p.travelled || 0) + limit.distance };
      return { ok: true };
    }
    if (action === "follow" || action === "giveway") {
      const q = this.trafficCandidates(p, action).find(
        (q) => q.id === targetId,
      );
      if (!q)
        return reject(
          "Choose compatible traffic ahead. Conflicting or circular instructions are unavailable.",
        );
      const conflict = routeConflict(p, q, { aligned: action === "follow" });
      p.trafficOrder = {
        kind: action,
        targetId: q.id,
        point: conflict.point,
        stopAt:
          (p.travelled || 0) + conflict.distanceA - crossingSeparation(p, q),
        releaseAt:
          (q.travelled || 0) + conflict.distanceB + crossingSeparation(q, p),
        merged: false,
      };
      return { ok: true };
    }
    if (action === "canceltraffic") {
      if (!p.trafficOrder) return reject("No traffic instruction is active.");
      p.trafficOrder = null;
      p.trafficWaiting = null;
      return { ok: true };
    }
    if (action === "pushback") {
      if (p.state !== "gate")
        return reject("Flight is not ready for pushback.");
      const s = this.stands.get(p.stand);
      const option = this.pushbackOptions(p).find(
        (o) => o.id === (pushbackOption || "standard"),
      );
      if (!option) return reject("Choose an available pushback option.");
      const points = option.path.map((n) => this.nodes.get(n));
      {
        if (!this.supportsType(p.type, s))
          return reject("No compatible pushback route.");
        const occupied = this.planes.some(
          (q) =>
            q.id !== p.id &&
            !["done", "approach", "goaround"].includes(q.state) &&
            !q.airborne &&
            (distanceAhead(
              { ...p, route: points },
              q,
              aircraftType(q.type).wingspan / 2 +
                aircraftType(p.type).wingspan / 2,
              Infinity,
            ) < Infinity ||
              (["pushback", "disconnect"].includes(q.state) &&
                routeConflict(
                  { ...p, route: points },
                  { ...q, route: q.pushbackPath || q.route },
                ) !== null)),
        );
        if (occupied) return reject("Pushback blocked by traffic.");
      }
      this.setRoute(p, points, "pushback", 2.6);
      p.pushbackMode = option.mode;
      p.pushbackPath = points;
      p.pushbackOption = option.id;
      return { ok: true };
    }
    if (action === "taxi") {
      if (p.tugRemaining > 0) return reject("Wait for tug disconnection.");
      if (
        !["ready", "inbound", "atpoint", "holding"].includes(p.state) &&
        !(["taxi", "taxiin"].includes(p.state) && p.held && p.speed < 0.05)
      )
        return reject("Stop the aircraft before revising its clearance.");
      const arriving = p.direction === "arrival";
      const runway = arriving
        ? this.runwayFor(p)
        : this.departureRunwayOptions(p).find(
            (candidate) =>
              candidate.key === (runwayKey || this.runwayFor(p).key),
          );
      if (!arriving && !runway)
        return reject(
          "Choose an active departure runway with a valid taxi route.",
        );
      let target = runway.departureHold;
      if (holdingPoint) {
        const h = this.holdingPoints().find((n) => n.id === holdingPoint);
        if (!h) return reject("Choose a mapped holding point.");
        target = h.id;
      } else if (arriving) {
        const s = this.stands.get(stand);
        if (!s) return reject("Choose a stand.");
        const reason = this.standReason(p, stand);
        if (reason) return reject(reason + ".");
        target = s.node;
      }
      let points = this.plan(p, target, waypoints);
      if (!arriving || holdingPoint)
        points = trimRouteEnd(points, aircraftType(p.type).length / 2 + 3);
      if (points.length < 2)
        return reject("No clear taxi route to that destination.");
      if (arriving && !holdingPoint) p.stand = stand;
      if (!arriving && !holdingPoint) p.runwayKey = runway.key;
      p.taxiTarget = holdingPoint ? "hold" : arriving ? "stand" : "runway";
      p.holdLabel = holdingPoint ? this.nodes.get(holdingPoint).ref : null;
      p.holdLimit = null;
      p.holdReached = false;
      p.trafficOrder = null;
      p.trafficWaiting = null;
      this.setRoute(p, points, arriving ? "taxiin" : "taxi", 8);
      p.destination = target;
      p.clearance = this.routeNames(points).join(" - ");
      return { ok: true };
    }
    if (action === "cross") {
      const crossing = this.crossingOptions(p).find(
        (option) => option.id === crossingId,
      );
      if (!crossing)
        return reject(
          "Taxi to a declared runway crossing holding point first.",
        );
      if (
        this.ownerForPhysical(crossing.runwayId) ||
        this.clearedArrivalForRunway(
          this.data.runwayConfigurations.find(
            (runway) => runway.runwayId === crossing.runwayId,
          ),
        ) ||
        this.rollingDepartureForRunway(
          this.data.runwayConfigurations.find(
            (runway) => runway.runwayId === crossing.runwayId,
          ),
        )
      )
        return reject("Runway occupied. Hold short.");
      const points = crossing.path.map((node) => this.nodes.get(node));
      if (!points.every(Boolean)) return reject("Runway crossing unavailable.");
      this.setPhysicalRunwayOwner(crossing.runwayId, p.id);
      p.crossingId = crossing.id;
      p.destination = crossing.path.at(-1);
      p.holdLabel = this.nodes.get(p.destination).ref;
      this.setRoute(p, points, "crossing", 6);
      return { ok: true };
    }
    if (action === "lineup") {
      const runway = this.runwayFor(p);
      if (
        p.state !== "holding" ||
        p.node !== runway.departureHold ||
        p.direction !== "departure"
      )
        return reject(
          `Taxi to holding point ${runway.departureHoldLabel} first.`,
        );
      if (this.ownerForRunway(p) || this.rollingDepartureForRunway(p))
        return reject("Runway occupied or reserved. Hold short.");
      const points = this.path(
        p.node,
        runway.departureEntry,
        runway.key,
        p.type,
      );
      if (!points.length) return reject("Runway entry unavailable.");
      const arrival = this.clearedArrivalForRunway(p);
      if (arrival) {
        const window = this.takeoffRunwayWindow(p, { entryPath: points });
        if (!window.ok) return reject(window.message);
      }
      this.setRunwayOwner(p, p.id);
      this.setRoute(p, points, "lineup", 6);
      return { ok: true };
    }
    if (action === "rolling") {
      const runway = this.runwayFor(p);
      if (
        p.state !== "holding" ||
        p.node !== runway.departureHold ||
        p.direction !== "departure"
      )
        return reject(
          `Taxi to holding point ${runway.departureHoldLabel} first.`,
        );
      const points = this.path(
        p.node,
        runway.departureEntry,
        runway.key,
        p.type,
      );
      if (!points.length) return reject("Runway entry unavailable.");
      const window = this.takeoffRunwayWindow(p, { entryPath: points });
      if (!window.ok) return reject(window.message);
      p.rollingDeparture = true;
      if (!this.ownerForRunway(p)) this.setRunwayOwner(p, p.id);
      this.setRoute(p, points, "lineup", aircraftType(p.type).performance.taxi);
      return { ok: true };
    }
    if (action === "takeoff") {
      const runway = this.runwayFor(p);
      if (p.state !== "linedup")
        return reject(`Line up on runway ${runway.label} first.`);
      const window = this.takeoffRunwayWindow(p);
      if (!window.ok) return reject(window.message);
      this.startTakeoff(p);
      return { ok: true };
    }
    if (action === "land") {
      if (p.state !== "approach") return reject("Aircraft is not on approach.");
      const runway = this.arrivalRunwayOptions(p).find(
        (candidate) => candidate.key === (runwayKey || this.runwayFor(p).key),
      );
      if (!runway)
        return reject(
          "Choose an active arrival runway parallel to the approach.",
        );
      const candidate = { ...p, runwayKey: runway.key };
      if (
        this.arrivalETA(candidate) <=
        (this.scenario.traffic.decisionSeconds || 8)
      )
        return reject("Too late for landing clearance. Go around.");
      if (!this.freeStands(candidate).length)
        return reject(
          "No available compatible stand. Arrival will go around without clearance.",
        );
      const selectedExit = this.landingOptions(candidate, runway).find(
        (exit) => !exitId || exit.id === exitId,
      );
      if (!selectedExit)
        return reject("No suitable exit for this aircraft's landing roll.");
      const exit = this.nodes.get(selectedExit.node);
      const toApron = selectedExit.path.map((id) => this.nodes.get(id));
      if (
        !toApron.length ||
        this.runwayDistance(toApron.at(-1), runway) <=
          Math.max(
            runway.physical.releaseDistance,
            runway.physical.protectedHalfWidth +
              Math.hypot(
                aircraftType(p.type).length,
                aircraftType(p.type).wingspan,
              ) /
                2 +
              3,
          )
      )
        return reject("No safe runway exit.");
      const window = this.arrivalRunwayWindow(candidate);
      if (!window.ok) return reject(window.message);
      p.runwayKey = runway.key;
      p.landingExit = exit.id;
      p.exitSpeed = selectedExit.speed;
      p.exitLabel = selectedExit.id;
      p.airborne = true;
      this.setRoute(
        p,
        [runway.start, exit, ...toApron.slice(1)],
        "landing",
        aircraftType(p.type).performance.landing,
      );
      return { ok: true };
    }
    if (action === "goaround") {
      if (p.state !== "approach" && !(p.state === "landing" && p.airborne))
        return reject("Only inbound flights can go around.");
      this.goAround(p);
      return { ok: true };
    }
    return reject("Unknown clearance.");
  }
  arrive(p) {
    p.speed = 0;
    p.route = [];
    p.trafficOrder = null;
    p.trafficWaiting = null;
    p.holdLimit = null;
    p.holdReached = false;
    p.wait = 0;
    if (
      ["taxi", "taxiin"].includes(p.state) &&
      p.taxiTarget === "hold" &&
      (p.destination !== this.runwayFor(p).departureHold ||
        p.direction === "arrival")
    ) {
      p.state = "atpoint";
      p.node = p.destination;
      return;
    }
    if (p.state === "pushback") {
      p.state = p.pushbackMode === "self" ? "ready" : "disconnect";
      {
        p.tugRemaining =
          p.pushbackMode === "self"
            ? 0
            : aircraftType(p.type).performance.tugSeconds;
        p.departureStand = p.stand;
      }
      p.stand = null;
    } else if (p.state === "taxi") {
      p.state = "holding";
      p.node = p.destination;
    } else if (p.state === "crossing") {
      const crossing = (this.data.operations.runwayCrossings || []).find(
        (option) => option.id === p.crossingId,
      );
      if (crossing) this.setPhysicalRunwayOwner(crossing.runwayId, null);
      p.state = "atpoint";
      p.node = p.destination;
      p.crossingId = null;
      p.taxiTarget = "hold";
    } else if (p.state === "lineup") {
      const runway = this.runwayFor(p);
      if (p.rollingDeparture) {
        if (!this.startTakeoff(p)) return;
      } else {
        p.state = "linedup";
        p.angle = Math.atan2(runway.end.y - p.y, runway.end.x - p.x);
      }
    } else if (p.state === "takeoff") {
      p.state = "done";
      p.completedAt = this.time;
      this.setLastDeparture(p, { type: p.type, time: this.time });
      this.setRunwayOwner(p, null);
      this.completed++;
      this.score += this.scenario.scoring.movement;
    } else if (p.state === "landing") {
      p.state = "inbound";
      this.setRunwayOwner(p, null);
    } else if (p.state === "taxiin") {
      p.state = "parked";
      p.angle = this.stands.get(p.stand).heading;
      p.parkedAt = this.time;
      p.turnaroundDuration = this.jitter(
        this.scenario.turnaroundSeconds *
          aircraftType(p.type).performance.turnaround,
        this.scenario.turnaroundJitter,
      );
      this.completed++;
      this.score += this.scenario.scoring.movement;
    }
  }
  tick(dt) {
    dt = Math.min(dt, 0.25);
    this.time += dt;
    this.updateRunwayTransition();
    if (this.time >= this.nextCleanup) {
      this.planes = this.planes.filter(
        (p) =>
          p.state !== "done" ||
          this.time - p.completedAt < this.scenario.cleanupSeconds,
      );
      const ids = new Set(this.planes.map((p) => p.id));
      for (const pair of this.conflictPairs)
        if (pair.split(":").some((id) => !ids.has(+id)))
          this.conflictPairs.delete(pair);
      this.nextCleanup = this.time + this.scenario.cleanupSeconds;
    }
    if (this.time > this.nextArrival) {
      if (
        this.planes.filter((p) => p.state === "approach").length <
          this.scenario.traffic.maxApproaches &&
        this.planes.filter((p) => p.state !== "done").length <
          this.scenario.traffic.maxActive
      )
        this.spawnArrival();
      this.nextArrival += this.trafficInterval("arrival");
    }
    const active = this.planes.filter(
      (p) => !["done", "approach", "goaround"].includes(p.state) && !p.airborne,
    );
    for (const p of this.planes) {
      {
        if (p.tugRemaining > 0)
          p.tugRemaining = Math.max(0, p.tugRemaining - dt);
        if (p.state === "disconnect" && !p.tugRemaining) {
          p.state = "ready";
          p.wait = 0;
          p.pushbackPath = null;
        }
        if (
          p.departureStand &&
          !p.tugRemaining &&
          distance(p, this.nodes.get(this.stands.get(p.departureStand).node)) >
            aircraftType(p.type).length + 10
        )
          p.departureStand = null;
      }
      p.wait += dt;
      p.blocked = false;
      p.trafficWaiting = null;
      if (
        p.state === "approach" ||
        (p.state === "landing" && p.airborne) ||
        p.state === "goaround"
      ) {
        if (
          p.state === "approach" &&
          this.arrivalETA(p) <= (this.scenario.traffic.decisionSeconds || 8)
        ) {
          this.goAround(p, true);
        }
        if (
          p.state === "landing" &&
          p.airborne &&
          this.arrivalETA(p) <= (this.scenario.traffic.decisionSeconds || 8) &&
          !this.arrivalRunwayWindow(p).ok
        ) {
          this.goAround(p, true, "separation");
        }
        const goal =
          p.state === "goaround" ? p.route[0] : this.runwayFor(p).start;
        const length = distance(p, goal),
          step = Math.min(length, p.speed * dt);
        const heading = Math.atan2(goal.y - p.y, goal.x - p.x);
        p.angle = heading;
        if (length > 0) {
          p.x += ((goal.x - p.x) / length) * step;
          p.y += ((goal.y - p.y) / length) * step;
        }
        if (length <= step + 0.001) {
          if (p.state === "goaround") {
            p.state = "done";
            p.completedAt = this.time;
            p.route = [];
            p.speed = 0;
          } else {
            const owner = this.ownerForRunway(p);
            if (p.state === "landing" && owner && owner !== p.id) {
              this.goAround(p, true, "separation");
              continue;
            }
            if (p.state === "landing") this.setRunwayOwner(p, p.id);
            p.airborne = false;
            if (distance(p, p.route[0]) < 1) p.route.shift();
          }
        }
        continue;
      }
      if (
        p.state === "parked" &&
        this.time - p.parkedAt > p.turnaroundDuration
      ) {
        const runway = this.weightedRunway(
          this.departureRunways(p.type, this.stands.get(p.stand)),
        );
        if (!runway) continue;
        p.runwayKey = runway.key;
        p.state = "gate";
        p.direction = "departure";
      }
      if ((p.held && p.speed < 0.01) || !p.route.length) {
        p.speed = 0;
        continue;
      }
      const next = p.route[0];
      let target = p.targetSpeed,
        allowance = Infinity;
      if (p.holdLimit)
        allowance = Math.max(0, p.holdLimit.stopAt - (p.travelled || 0));
      if (p.trafficOrder) {
        const order = p.trafficOrder,
          q = this.planes.find((q) => q.id === order.targetId);
        if (
          !order.merged &&
          targetCleared(order, q, q ? crossingSeparation(q, p) : separation)
        ) {
          if (order.kind === "giveway") {
            p.trafficOrder = null;
          } else order.merged = true;
        }
        if (p.trafficOrder && !order.merged) {
          const available = Math.max(0, order.stopAt - (p.travelled || 0));
          allowance = Math.min(allowance, available);
          if (available < 2) p.trafficWaiting = order.kind;
        }
        if (
          order.kind === "follow" &&
          order.merged &&
          (!q ||
            q.state === "done" ||
            (!routeConflict(p, q, { aligned: true }) &&
              distanceAhead(p, q, 24, Infinity) === Infinity))
        )
          p.trafficOrder = null;
      }
      if (p.state === "lineup" && p.rollingDeparture) {
        const owner = this.ownerForRunway(p);
        if (!owner) this.setRunwayOwner(p, p.id);
        else if (owner !== p.id) {
          allowance = Math.min(allowance, Math.max(0, routeLength(p) - 3));
          if (allowance < 4) p.trafficWaiting = "runway";
        }
      }
      if (p.state === "landing") {
        if (p.node === p.landingExit) p.vacating = true;
        if (p.vacating) target = p.exitSpeed || 7;
        else
          target = Math.min(
            target,
            Math.sqrt(
              (p.exitSpeed || 7) ** 2 +
                2 *
                  aircraftType(p.type).performance.braking *
                  Math.max(0, distance(p, this.nodes.get(p.landingExit)) - 2),
            ),
          );
      }
      const angle = Math.atan2(next.y - p.y, next.x - p.x);
      if (p.state !== "takeoff" && (p.state !== "landing" || p.vacating)) {
        for (const q of active) {
          if (q.id === p.id) continue;
          if (
            q.pushbackPath?.length &&
            ["pushback", "disconnect"].includes(q.state)
          ) {
            const crossing = routeConflict(
              p,
              { ...q.pushbackPath[0], route: q.pushbackPath.slice(1) },
              { horizon: 200 },
            );
            if (crossing) {
              const available = Math.max(
                0,
                crossing.distanceA - crossingSeparation(p, q),
              );
              allowance = Math.min(allowance, available);
              if (
                available <
                p.speed ** 2 / (2 * aircraftType(p.type).performance.braking) +
                  10
              )
                p.trafficWaiting = "pushback";
            }
          }
          let ahead = distanceAhead(
            p,
            q,
            (aircraftType(p.type).wingspan + aircraftType(q.type).wingspan) /
              2 +
              3,
          );
          const gap = queueSeparation(p, q);
          // Also protect short route ends where a nearby fuselage sits just beyond the final node.
          const forward =
            (q.x - p.x) * Math.cos(angle) + (q.y - p.y) * Math.sin(angle);
          if (
            forward > 0 &&
            distance(p, q) < 55 &&
            Math.abs(
              (q.x - p.x) * Math.sin(angle) - (q.y - p.y) * Math.cos(angle),
            ) < 26
          )
            ahead = Math.min(ahead, forward);
          if (ahead < 200) {
            allowance = Math.min(allowance, Math.max(0, ahead - gap));
            if (ahead < gap + 2) {
              const orderly =
                p.trafficWaiting === "pushback" ||
                p.trafficOrder?.targetId === q.id ||
                ([
                  "taxi",
                  "taxiin",
                  "holding",
                  "atpoint",
                  "lineup",
                  "linedup",
                ].includes(q.state) &&
                  Math.cos(
                    (q.route[0]
                      ? Math.atan2(q.route[0].y - q.y, q.route[0].x - q.x)
                      : q.angle) - angle,
                  ) > -0.3);
              if (orderly) p.trafficWaiting = "spacing";
              else {
                p.blocked = true;
                const pair = [p.id, q.id].sort().join(":");
                if (!this.conflictPairs.has(pair)) {
                  this.conflictPairs.add(pair);
                  this.incidents++;
                  this.score -= this.scenario.scoring.conflict;
                }
              }
            }
          }
          if (
            !["taxi", "taxiin"].includes(p.state) ||
            !q.route.length ||
            q.trafficOrder?.targetId === p.id
          )
            continue;
          const crossing = routeConflict(p, q, { horizon: 150 });
          if (!crossing || Math.abs(crossing.alignment) > 0.85) continue;
          const otherOnRight =
            crossing.heading.x * (q.y - p.y) -
              crossing.heading.y * (q.x - p.x) >
            0;
          if (
            (otherOnRight || q.state === "landing") &&
            !(
              crossing.distanceA < separation && crossing.distanceB > separation
            )
          ) {
            const available = Math.max(
              0,
              crossing.distanceA - crossingSeparation(p, q),
            );
            allowance = Math.min(allowance, available);
            if (
              available <
              (p.speed * p.speed) /
                (2 * aircraftType(p.type).performance.braking) +
                10
            )
              p.trafficWaiting = "right-of-way";
          }
        }
      }
      target = movementTarget({ ...p, targetSpeed: target }, allowance);
      if (p.held) target = 0;
      p.speed = advanceSpeed(p, target, dt);
      let remaining = Math.min(p.speed * dt, allowance);
      if (allowance < 0.05) {
        remaining = 0;
        p.speed = 0;
      }
      while (remaining > 0 && p.route.length) {
        const n = p.route[0],
          length = distance(p, n);
        if (length > 0) {
          const heading = Math.atan2(n.y - p.y, n.x - p.x);
          const desired =
            p.state === "pushback" && p.pushbackMode !== "self"
              ? heading + Math.PI
              : heading;
          let delta = Math.atan2(
            Math.sin(desired - p.angle),
            Math.cos(desired - p.angle),
          );
          p.angle += Math.max(-dt * 0.7, Math.min(dt * 0.7, delta));
        }
        p.travelled = (p.travelled || 0) + Math.min(remaining, length);
        if (remaining >= length) {
          p.x = n.x;
          p.y = n.y;
          p.node = n.id || p.node;
          remaining -= length;
          p.route.shift();
          if (p.state === "landing" && p.node === p.landingExit) {
            p.vacating = true;
            remaining = 0;
          }
        } else {
          p.x += ((n.x - p.x) / length) * remaining;
          p.y += ((n.y - p.y) / length) * remaining;
          remaining = 0;
        }
      }
      if (
        p.holdLimit &&
        p.route.length &&
        p.holdLimit.stopAt - (p.travelled || 0) < 0.05
      ) {
        p.held = true;
        p.holdReached = true;
        p.speed = 0;
        p.wait = 0;
      }
      if (
        p.state !== "takeoff" &&
        p.route.length &&
        routeLength(p) < 0.04 &&
        !(
          p.state === "lineup" &&
          p.rollingDeparture &&
          this.ownerForRunway(p) !== p.id
        )
      ) {
        const last = p.route.at(-1);
        p.x = last.x;
        p.y = last.y;
        p.node = last.id || p.destination || p.node;
        p.route = [];
      }
      if (!p.route.length) this.arrive(p);
    }
  }
}
