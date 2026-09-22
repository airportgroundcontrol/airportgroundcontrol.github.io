import { distance, requestsAction } from "./sim.js";
import { drawAircraft, aircraftPixels } from "./aircraft/render.js";

const aircraftColors = {
  stand: "#f2f2ef",
  taxi: "#f0ca62",
  landing: "#78b7ff",
  takeoff: "#67d68c",
  pushback: "#b88762",
};

export const aircraftStatusColor = (aircraft) => {
  if (["gate", "parked"].includes(aircraft.state)) return aircraftColors.stand;
  if (["pushback", "disconnect"].includes(aircraft.state))
    return aircraftColors.pushback;
  if (["approach", "landing", "goaround"].includes(aircraft.state))
    return aircraftColors.landing;
  if (aircraft.state === "takeoff") return aircraftColors.takeoff;
  return aircraftColors.taxi;
};

export const formatArrivalETA = (seconds) => {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export class AirportMap {
  constructor(canvas, sim, onSelect, onWaypoint, onDismiss = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.staticCanvas = document.createElement("canvas");
    this.staticCtx = this.staticCanvas.getContext("2d");
    this.staticKey = "";
    this.waypointNodes = sim.data.nodes.filter(
      (node) => !sim.runwaysAt(node).length,
    );
    this.sim = sim;
    this.selected = sim.planes[0]?.id ?? null;
    this.preview = [];
    this.waypoints = [];
    this.labels = true;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.onSelect = onSelect;
    this.onWaypoint = onWaypoint;
    this.onDismiss = onDismiss;
    this.pointers = new Map();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bind();
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.staticCanvas.width = r.width * dpr;
    this.staticCanvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.staticKey = "";
    if (!this.initialized) {
      this.fit();
      this.initialized = true;
    }
    this.draw();
  }
  fit() {
    const header = document
      .querySelector(".topbar")
      .getBoundingClientRect().height;
    const width = this.width;
    const top = header + 20;
    const bottom = this.height - 55;
    const bounds = this.sim.data.operations.map.bounds;
    const zoom = Math.min(
      width / (bounds.maxX - bounds.minX),
      (bottom - top) / (bounds.maxY - bounds.minY),
    );
    this.camera = {
      x: (bounds.minX + bounds.maxX) / 2 + (this.width - width) / 2 / zoom,
      y:
        (bounds.minY + bounds.maxY) / 2 +
        (this.height / 2 - (top + bottom) / 2) / zoom,
      zoom,
    };
  }
  screen(n) {
    return {
      x: (n.x - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (n.y - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }
  aircraftScreen(p) {
    const point = this.screen(p);
    if (!p.airborne) return point;
    const left = Math.min(75, this.width / 2),
      right = Math.max(
        left,
        Math.min(this.width - left, this.aircraftBounds?.right ?? Infinity),
      ),
      bottom = Math.max(0, this.height - 80),
      headerBottom =
        document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 75,
      top = Math.min(
        bottom,
        Math.max(headerBottom + 100, this.aircraftBounds?.top ?? 0),
      );
    if (
      point.x >= left &&
      point.x <= right &&
      point.y >= top &&
      point.y <= bottom
    )
      return point;
    const offscreen = this.sim.planes.filter(
      (q) => q.airborne && q.state !== "done",
    );
    const index = offscreen.findIndex((q) => q.id === p.id);
    const offset = Math.min(index, 3) * 38;
    return {
      x: Math.max(left, Math.min(right, point.x)),
      y: Math.min(
        bottom,
        Math.max(
          top,
          point.y >= bottom ? bottom - offset : Math.max(top, point.y) + offset,
        ),
      ),
      offscreen: true,
    };
  }
  world(x, y) {
    return {
      x: (x - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (y - this.height / 2) / this.camera.zoom + this.camera.y,
    };
  }
  zoom(factor, x = this.width / 2, y = this.height / 2) {
    const old = this.world(x, y);
    this.camera.zoom = Math.max(0.1, Math.min(3, this.camera.zoom * factor));
    const now = this.world(x, y);
    this.camera.x += old.x - now.x;
    this.camera.y += old.y - now.y;
  }
  bind() {
    const c = this.canvas;
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.onDismiss();
        const r = c.getBoundingClientRect();
        this.zoom(
          Math.exp(-e.deltaY * 0.001),
          e.clientX - r.left,
          e.clientY - r.top,
        );
      },
      { passive: false },
    );
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      c.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const next = { x: e.clientX, y: e.clientY };
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(
          ([id]) => id !== e.pointerId,
        )[1];
        const before = distance(prev, other),
          after = distance(next, other);
        if (before > 0) this.zoom(after / before);
        this.drag.moved = true;
      } else {
        const dx = next.x - prev.x,
          dy = next.y - prev.y;
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4)
          this.drag.moved = true;
      }
      if (this.drag.moved) this.onDismiss();
      this.pointers.set(e.pointerId, next);
    });
    c.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      this.pointers.delete(e.pointerId);
      if (!this.drag?.moved && this.pointers.size === 0) {
        const r = c.getBoundingClientRect(),
          x = e.clientX - r.left,
          y = e.clientY - r.top;
        const plane = this.sim.planes
          .filter((p) => p.state !== "done")
          .reduce(
            (nearest, candidate) =>
              !nearest ||
              distance(this.aircraftScreen(candidate), { x, y }) <
                distance(this.aircraftScreen(nearest), { x, y })
                ? candidate
                : nearest,
            null,
          );
        if (
          plane &&
          distance(this.aircraftScreen(plane), { x, y }) <
            Math.max(
              23,
              aircraftPixels(plane.type, this.camera.zoom).length / 2 + 5,
            )
        ) {
          this.onSelect(plane.id, { x, y });
          return;
        }
        this.onDismiss();
        const p = this.world(x, y);
        const nearest = this.waypointNodes.reduce(
          (closest, node) =>
            !closest || distance(node, p) < distance(closest, p)
              ? node
              : closest,
          null,
        );
        if (nearest && distance(nearest, p) * this.camera.zoom < 24)
          this.onWaypoint(nearest.id);
      }
    });
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(),
        point = { x: e.clientX - r.left, y: e.clientY - r.top };
      const p = this.sim.planes
        .filter((plane) => plane.state !== "done")
        .reduce(
          (nearest, candidate) =>
            !nearest ||
            distance(this.aircraftScreen(candidate), point) <
              distance(this.aircraftScreen(nearest), point)
              ? candidate
              : nearest,
          null,
        );
      if (
        p &&
        distance(this.aircraftScreen(p), point) <
          Math.max(23, aircraftPixels(p.type, this.camera.zoom).length / 2 + 5)
      )
        this.onSelect(p.id, point);
      else this.onDismiss();
    });
    c.addEventListener("pointercancel", (e) =>
      this.pointers.delete(e.pointerId),
    );
    c.addEventListener("keydown", (e) => {
      if (["+", "=", "-", "0"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "0") this.fit();
        else this.zoom(e.key === "-" ? 0.8 : 1.25);
      }
    });
  }
  line(points, color, width, dash = []) {
    if (points.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    for (const [i, point] of points.entries()) {
      const p = this.screen(
        Array.isArray(point) ? { x: point[0], y: point[1] } : point,
      );
      if (i === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
  }
  polygon(points, fill, stroke) {
    const c = this.ctx;
    c.beginPath();
    points.forEach((point, i) => {
      const p = this.screen({ x: point[0], y: point[1] });
      if (!i) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    });
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  label(text, x, y, color = "#d5d6d8", size = 10, bg) {
    const c = this.ctx;
    c.font = `${size}px ui-monospace, monospace`;
    c.textAlign = "center";
    if (bg) {
      const w = c.measureText(text).width;
      c.fillStyle = bg;
      c.fillRect(x - w / 2 - 5, y - size, w + 10, size + 6);
    }
    c.fillStyle = color;
    c.fillText(text, x, y);
  }
  badge(text, x, y, color = aircraftColors.landing) {
    const c = this.ctx,
      size = 8;
    c.save();
    c.font = `700 ${size}px ui-monospace, monospace`;
    c.textAlign = "center";
    const width = c.measureText(text).width + 10,
      height = size + 6;
    c.beginPath();
    c.roundRect(x - width / 2, y - size - 2, width, height, 2);
    c.fillStyle = "#1b1c1ff2";
    c.fill();
    c.strokeStyle = color + "aa";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = color;
    c.fillText(text, x, y);
    c.restore();
  }
  drawStaticLayer() {
    const liveContext = this.ctx,
      c = this.staticCtx,
      z = this.camera.zoom;
    this.ctx = c;
    c.clearRect(0, 0, this.width, this.height);
    c.fillStyle = "#101112";
    c.fillRect(0, 0, this.width, this.height);
    c.lineJoin = "round";
    c.lineCap = "round";
    const grid = 250;
    const tl = this.world(0, 0),
      br = this.world(this.width, this.height);
    for (let x = Math.floor(tl.x / grid) * grid; x < br.x; x += grid)
      this.line(
        [
          { x, y: tl.y },
          { x, y: br.y },
        ],
        "#393b403b",
        0.6,
      );
    for (let y = Math.floor(tl.y / grid) * grid; y < br.y; y += grid)
      this.line(
        [
          { x: tl.x, y },
          { x: br.x, y },
        ],
        "#393b403b",
        0.6,
      );
    const fs = this.sim.data.features;
    for (const f of fs)
      if (f.type === "aerodrome") this.polygon(f.points, "#191a1c", "#3b3d41");
    for (const f of fs)
      if (f.type === "road")
        this.line(f.points, "#4a4c5050", Math.max(1, 5 * z));
    for (const f of fs)
      if (f.type === "apron") this.polygon(f.points, "#35373a", "#62656a");
    for (const f of fs)
      if (["taxiway", "taxilane"].includes(f.type)) {
        this.line(f.points, "#686a6d", Math.max(3, 26 * z));
        this.line(f.points, "#484a4e", Math.max(2, 23 * z));
      }
    for (const f of fs)
      if (["runway", "stopway"].includes(f.type)) {
        this.line(f.points, "#929397", Math.max(10, 48 * z));
        this.line(f.points, "#35373a", Math.max(8, 44 * z));
      }
    for (const f of fs)
      if (f.type === "runway")
        this.line(f.points, "#d4d4d1", Math.max(0.7, 1.5 * z), [
          Math.max(3, 27 * z),
          Math.max(3, 21 * z),
        ]);
    for (const f of fs)
      if (["taxiway", "taxilane"].includes(f.type))
        this.line(f.points, "#d5c466", Math.max(0.65, 1.2 * z));
    for (const f of fs)
      if (f.type === "parking_position")
        this.line(f.points, "#c8b967", Math.max(0.55, z), [3, 3]);
    for (const f of fs)
      if (["building", "terminal", "tower"].includes(f.type) && f.closed) {
        const airport = f.type === "terminal" || f.type === "tower";
        this.polygon(
          f.points,
          airport ? "#7d8085" : "#3a3c40",
          airport ? "#a7a9ad" : "#65676c55",
        );
      }
    for (const runway of this.sim.data.operations.runways) {
      const [start, end] = runway.ends.map((item) => item.position),
        heading = Math.atan2(end.y - start.y, end.x - start.x);
      for (const [i, n] of [start, end].entries()) {
        const p = this.screen(n);
        c.save();
        c.translate(p.x, p.y);
        c.rotate(heading + (i ? Math.PI : 0));
        c.fillStyle = "#e5e5e2";
        c.font = `bold ${Math.max(10, 28 * z)}px sans-serif`;
        c.textAlign = "center";
        c.fillText(runway.ends[i].label, 0, -5);
        for (let k = -3; k <= 3; k++)
          if (k !== 0) c.fillRect(25 * z, k * 5 * z, 30 * z, 2.5 * z);
        c.restore();
      }
    }
    if (this.labels) {
      const placed = [];
      for (const f of fs) {
        if (f.type !== "taxiway" || !f.ref) continue;
        const point = f.points[Math.floor(f.points.length / 2)],
          p = this.screen({ x: point[0], y: point[1] });
        if (placed.some((n) => distance(n, p) < 45)) continue;
        placed.push(p);
        this.label(f.ref, p.x, p.y - 5, "#e7d883", 9, "#2b2d31ed");
      }
      for (const label of this.sim.data.operations.map.labels) {
        if (z < label.minZoom) continue;
        const p = this.screen(label);
        this.label(label.text, p.x, p.y, label.color || "#c6c7c9", 10);
      }
    }
    this.ctx = liveContext;
  }
  draw() {
    const c = this.ctx,
      z = this.camera.zoom,
      staticKey = [
        this.width,
        this.height,
        this.camera.x,
        this.camera.y,
        z,
        this.labels,
      ].join(":");
    if (staticKey !== this.staticKey) {
      this.drawStaticLayer();
      this.staticKey = staticKey;
    }
    c.clearRect(0, 0, this.width, this.height);
    c.drawImage(this.staticCanvas, 0, 0, this.width, this.height);
    c.lineJoin = "round";
    c.lineCap = "round";
    const pulse = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0.35
      : (1 - Math.cos((performance.now() * Math.PI * 2) / 3000)) / 2;
    for (const runway of this.sim.data.operations.runways)
      if (this.sim.ownerForPhysical(runway.id))
        this.line(
          runway.ends.map((end) => end.position),
          "#efb76155",
          Math.max(10, 45 * z),
        );
    if (this.labels) {
      const selectedAircraft = this.sim.planes.find(
          (q) => q.id === this.selected,
        ),
        assigning =
          selectedAircraft?.direction === "arrival" &&
          ["inbound", "atpoint"].includes(selectedAircraft.state),
        selectedStand = selectedAircraft?.stand;
      for (const s of this.sim.data.stands) {
        if (z < 0.2 && s.id !== selectedStand) continue;
        if (
          z >= 0.2 &&
          z < 0.4 &&
          !this.sim.data.operations.map.mediumZoomStands.includes(s.id)
        )
          continue;
        const point = this.screen(this.sim.nodes.get(s.node)),
          busy = this.sim.planes.some(
            (q) => q.stand === s.id && q.state !== "done",
          );
        this.label(
          s.id,
          point.x,
          point.y + 15,
          assigning
            ? this.sim.standReason(selectedAircraft, s.id, { route: false })
              ? "#7f8186"
              : "#79bfff"
            : busy
              ? "#ecd179"
              : "#d0d1d2",
          Math.max(8, Math.min(12, 15 * z)),
        );
      }
    }
    const selectedPlane = this.sim.planes.find((p) => p.id === this.selected);
    const routeHolds = new Set(
      [...this.preview, ...(selectedPlane?.route || [])]
        .filter((n) => n.hold)
        .map((n) => n.id),
    );
    const holdLabels = [];
    for (const n of this.sim.holdingPoints()) {
      const point = this.screen(n),
        focused =
          this.focusHold?.id === n.id ||
          selectedPlane?.holdLimit?.node?.id === n.id;
      c.strokeStyle = focused ? "#ffec9c" : "#dfbd62";
      c.lineWidth = focused ? 4 : 2;
      c.beginPath();
      c.moveTo(point.x - 4, point.y - 2);
      c.lineTo(point.x + 4, point.y + 2);
      c.stroke();
      if (focused) {
        c.beginPath();
        c.arc(point.x, point.y, 12, 0, Math.PI * 2);
        c.stroke();
      }
      if (
        focused ||
        this.sim.activeRunways.some(
          (runway) => runway.departureHold === n.id,
        ) ||
        ((z > 0.65 || routeHolds.has(n.id)) &&
          !holdLabels.some((p) => distance(p, point) < 32))
      ) {
        this.label(n.ref, point.x + 10, point.y + 16, "#f1d47a", 9, "#292b2f");
        holdLabels.push(point);
      }
    }
    for (const p of this.sim.planes)
      if (p.route.length)
        this.line(
          [p, ...p.route],
          p.id === this.selected ? "#8fc9ff" : "#7ca9d970",
          p.id === this.selected ? 2.4 : 1.2,
          [6, 5],
        );
    if (this.preview.length) {
      this.line(this.preview, "#bddcff", 3);
      this.line(this.preview, "#568bc4", 1, [5, 6]);
    }
    for (const [i, id] of this.waypoints.entries()) {
      const p = this.screen(this.sim.nodes.get(id));
      c.beginPath();
      c.arc(p.x, p.y, 8, 0, Math.PI * 2);
      c.fillStyle = "#bddcff";
      c.fill();
      this.label(String(i + 1), p.x, p.y + 3, "#20242a", 10);
    }
    const labels = [];
    for (const p of this.sim.planes
      .filter((p) => p.state !== "done")
      .sort((a, b) => (b.id === this.selected) - (a.id === this.selected))) {
      const s = this.aircraftScreen(p);
      if (
        s.x < -100 ||
        s.x > this.width + 100 ||
        s.y < -100 ||
        s.y > this.height + 100
      )
        continue;
      const selected = p.id === this.selected;
      const runwayBadge =
        p.direction === "arrival" && p.state === "landing" && p.runwayKey
          ? `RWY ${this.sim.runwayFor(p).label}`
          : null;
      if (s.offscreen) {
        const eta = this.sim.arrivalETA(p),
          text =
            p.call +
            " / " +
            p.type +
            (eta !== null ? " / ETA " + formatArrivalETA(eta) : " / GO AROUND"),
          availableWidth = Math.max(1, this.width - 12);
        let size = 10;
        c.font = `${size}px ui-monospace, monospace`;
        let textWidth = c.measureText(text).width + 10;
        if (textWidth > availableWidth) {
          size = Math.max(7, (size * availableWidth) / textWidth);
          c.font = `${size}px ui-monospace, monospace`;
          textWidth = c.measureText(text).width + 10;
        }
        const labelX = Math.max(
          textWidth / 2 + 6,
          Math.min(this.width - textWidth / 2 - 6, s.x),
        );
        this.label(
          text,
          labelX,
          s.y - 14,
          aircraftColors.landing,
          size,
          "#1b1c1f",
        );
        if (runwayBadge)
          this.badge(runwayBadge, labelX, s.y - 29, aircraftColors.landing);
        c.save();
        c.translate(s.x, s.y);
        c.rotate(p.angle);
        if (requestsAction(p)) c.globalAlpha = 0.72 + 0.28 * pulse;
        c.strokeStyle = aircraftColors.landing;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-7, -6);
        c.lineTo(0, 0);
        c.lineTo(-7, 6);
        c.stroke();
        c.restore();
        continue;
      }
      const color = aircraftStatusColor(p);
      c.save();
      c.translate(s.x, s.y);
      c.rotate(p.angle);
      if (requestsAction(p)) c.globalAlpha = 0.72 + 0.28 * pulse;
      drawAircraft(c, p.type, z, color);
      c.restore();
      const size = aircraftPixels(p.type, z);
      const labelGap = Math.max(
        25,
        Math.max(size.length, size.wingspan) / 2 + 14,
      );
      const candidates = [
        { x: s.x, y: s.y - labelGap },
        { x: s.x, y: s.y + labelGap + 8 },
        { x: s.x + 65, y: s.y + 3 },
        { x: s.x - 65, y: s.y + 3 },
        { x: s.x, y: s.y - 56 },
      ];
      const label =
        candidates.find(
          (n) =>
            n.x > 55 &&
            n.x < this.width - 55 &&
            n.y > (runwayBadge ? 35 : 20) &&
            !(n.x > this.width - 175 && n.y < 100) &&
            !labels.some(
              (l) => Math.abs(l.x - n.x) < 100 && Math.abs(l.y - n.y) < 28,
            ),
        ) || candidates[1];
      labels.push(label);
      if (label !== candidates[0]) {
        c.strokeStyle = color + "77";
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(s.x, s.y);
        c.lineTo(label.x, label.y - 4);
        c.stroke();
      }
      this.label(
        `${p.call} / ${p.type}`,
        label.x,
        label.y,
        color,
        10,
        selected ? "#1b1c1ff0" : "#24262ae8",
      );
      if (runwayBadge)
        this.badge(runwayBadge, label.x, label.y - 14, aircraftColors.landing);
      if (selected && z > 0.2)
        this.label(
          p.blocked ? "TRAFFIC HOLD" : `${Math.round(p.speed * 1.944)} KT`,
          label.x,
          label.y - (runwayBadge ? 30 : 14),
          "#c4c6c9",
          8,
        );
    }
  }
}
