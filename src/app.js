import {
  createIcons,
  Plane,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  Sun,
  Plus,
  Minus,
  Scan,
  Tags,
  Navigation2,
  X,
  Check,
  Download,
  CornerDownLeft,
  PlaneLanding,
  Undo2,
  ArrowUpRight,
  PlaneTakeoff,
  Route,
  Keyboard,
  Trash2,
  SlidersHorizontal,
} from "lucide";
import { airportCatalog, defaultAirport } from "./airports/catalog.js";
import { populateAirportUI } from "./ui/airport.js";
import { flightStatus, requestsAction, orderedFlights } from "./sim.js";
import { AirportMap } from "./map.js";
import { GameSession } from "./session/game-session.js";
import { acquireWriter } from "./session/writer-lease.js";

const $ = (id) => document.getElementById(id);
const airportData =
  airportCatalog.find(
    (airport) =>
      airport.id === new URL(location.href).searchParams.get("airport"),
  ) || defaultAirport;
const icon = (name) => '<i data-lucide="' + name + '"></i>';
const icons = {
  Plane,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  Sun,
  Plus,
  Minus,
  Scan,
  Tags,
  Navigation2,
  X,
  Check,
  Download,
  CornerDownLeft,
  PlaneLanding,
  Undo2,
  ArrowUpRight,
  PlaneTakeoff,
  Route,
  Keyboard,
  Trash2,
  SlidersHorizontal,
};
const refreshIcons = () =>
  createIcons({ icons, attrs: { "stroke-width": 1.7 } });
const formatTime = (t) =>
  new Date((airportData.scenario.clockStartSeconds + Math.floor(t)) * 1000)
    .toISOString()
    .slice(11, 19);
const formatDuration = (seconds) => {
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  return minutes >= 60
    ? Math.floor(minutes / 60) + "h " + (minutes % 60) + "m"
    : minutes + " min";
};
const shortcuts = {
  p: "pushback",
  r: "pushbackchoice",
  t: "preview",
  h: "hold",
  l: "land",
  u: "lineup",
  d: "takeoff",
  o: "rolling",
  g: "goaround",
  b: "holdingpoint",
  s: "holdshort",
  y: "follow",
  w: "giveway",
  c: "continue",
  x: "canceltraffic",
  k: "runwaycrossing",
  Enter: "taxi",
};
let sim,
  session,
  map,
  selected = 1;
let planning = false,
  waypoints = [],
  destination = "",
  menuOpen = false,
  menuAnchor = null;
let lastMenu = "",
  toastTimer,
  modalPaused = null;
let menuMode = "",
  menuChoice = "";
let landingExitChoice = "",
  runwayChoice = "";
let saveWarning = false;
const selectedPlane = () => sim?.planes.find((p) => p.id === selected);
const assignedRunway = (p) => sim.runwayFor(runwayChoice || p);
const chooseRunway = (p, choices) => {
  if (!choices.some((runway) => runway.key === runwayChoice))
    runwayChoice =
      choices.find((runway) => runway.key === p.runwayKey)?.key ||
      choices[0]?.key ||
      "";
  return choices.find((runway) => runway.key === runwayChoice);
};
const canPlan = (p) =>
  p &&
  (["ready", "inbound", "atpoint", "holding"].includes(p.state) ||
    (["taxi", "taxiin"].includes(p.state) && p.held && p.speed < 0.05));
const stateText = flightStatus;

function readView() {
  return {
    selected,
    speed: session.speed,
    paused: modalPaused ?? session.paused,
    labels: map.labels,
    camera: map.camera,
    planning,
    waypoints,
    destination,
    runwayChoice,
  };
}
function saveGame() {
  return session?.save();
}
function saveFailed() {
  if (!saveWarning) {
    saveWarning = true;
    toast("Saving unavailable. Progress may be lost when this page closes.");
  }
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function clearPlan() {
  planning = false;
  waypoints = [];
  destination = "";
  runwayChoice = "";
  if (map) {
    map.preview = [];
    map.waypoints = [];
  }
}
function closeMenu(cancelPlan = false) {
  if (menuMode === "pushbackchoice" && map) map.preview = [];
  menuOpen = false;
  menuMode = "";
  menuChoice = "";
  landingExitChoice = "";
  if (!planning) runwayChoice = "";
  if (map) map.focusHold = null;
  $("aircraft-menu").hidden = true;
  document.body.classList.remove("context-open");
  if (cancelPlan) {
    clearPlan();
    render();
  }
}
function pause(value) {
  session.paused = session.awaitingRecovery || value;
  const paused = session.paused;
  $("pause").innerHTML = icon(paused ? "play" : "pause");
  const label = paused ? "Resume simulation" : "Pause simulation";
  $("pause").title = label + " (Space)";
  $("pause").setAttribute("aria-label", label);
  $("simulation-status").textContent = paused ? "PAUSED" : "RUNNING";
  refreshIcons();
  saveGame();
}
function showDialog(id) {
  closeMenu();
  modalPaused = session.paused;
  pause(true);
  $(id).showModal();
}
function roleLabel(runway) {
  if (runway.arrivals && runway.departures) return "Mixed";
  return runway.arrivals ? "Arrivals" : "Departures";
}
function runwayDraftFrom(uses) {
  return new Map(
    airportData.operations.runways.map((physical) => {
      const use = uses.find((candidate) => candidate.runwayId === physical.id);
      return [
        physical.id,
        use
          ? { endId: use.endId, role: roleLabel(use).toLowerCase() }
          : { endId: "", role: "closed" },
      ];
    }),
  );
}
let runwayDraft = null,
  runwayDraftPreset = null;
function renderRunwayPlanner() {
  const presets = $("runway-presets");
  presets.replaceChildren();
  for (const preset of airportData.runwayPresets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = runwayDraftPreset === preset.id ? "active" : "";
    button.textContent = preset.label;
    button.onclick = () => {
      runwayDraft = runwayDraftFrom(preset.runwayUses);
      runwayDraftPreset = preset.id;
      renderRunwayPlanner();
    };
    presets.append(button);
  }
  const rows = $("runway-rows");
  rows.replaceChildren();
  for (const physical of airportData.operations.runways) {
    const draft = runwayDraft.get(physical.id),
      configurations = airportData.runwayConfigurations.filter(
        (runway) => runway.runwayId === physical.id,
      );
    const row = document.createElement("div");
    row.className = "runway-row";
    const name = document.createElement("strong");
    name.textContent = physical.label;
    const end = document.createElement("select");
    end.setAttribute("aria-label", physical.label + " direction");
    end.append(new Option("Closed", ""));
    for (const runway of configurations)
      end.append(new Option("Runway " + runway.label, runway.endId));
    end.value = draft.endId;
    const role = document.createElement("select");
    role.setAttribute("aria-label", physical.label + " role");
    const updateRoles = () => {
      const runway = configurations.find(
        (candidate) => candidate.endId === end.value,
      );
      role.replaceChildren();
      if (!runway) {
        role.append(new Option("Closed", "closed"));
        role.disabled = true;
        draft.endId = "";
        draft.role = "closed";
        return;
      }
      role.disabled = false;
      if (runway.capabilities.includes("arrival"))
        role.append(new Option("Arrivals", "arrivals"));
      if (runway.capabilities.includes("departure"))
        role.append(new Option("Departures", "departures"));
      if (
        runway.capabilities.includes("arrival") &&
        runway.capabilities.includes("departure")
      )
        role.append(new Option("Mixed", "mixed"));
      const available = [...role.options].map((option) => option.value);
      role.value = available.includes(draft.role) ? draft.role : available[0];
      draft.endId = end.value;
      draft.role = role.value;
    };
    end.onchange = () => {
      runwayDraftPreset = null;
      draft.endId = end.value;
      updateRoles();
      renderRunwayPlanner();
    };
    role.onchange = () => {
      runwayDraftPreset = null;
      draft.role = role.value;
      presets
        .querySelectorAll("button")
        .forEach((button) => button.classList.remove("active"));
    };
    updateRoles();
    row.append(name, end, role);
    rows.append(row);
  }
}
function showRunwayPlanner() {
  runwayDraft = runwayDraftFrom(sim.runwayUses());
  runwayDraftPreset = sim.runwayPresetId;
  $("runway-error").hidden = true;
  renderRunwayPlanner();
  showDialog("runway-dialog");
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    if (modalPaused !== null) {
      pause(modalPaused);
      modalPaused = null;
    }
    $("map").focus({ preventScroll: true });
  });
}
function usableWidth() {
  return innerWidth;
}
function select(id, anchor) {
  const p = sim.planes.find((p) => p.id === id && p.state !== "done");
  if (!p) return;
  if (selected !== id) {
    clearPlan();
    menuMode = "";
    menuChoice = "";
  }
  selected = id;
  map.selected = id;
  menuOpen = true;
  document.body.classList.add("context-open");
  if (!anchor) {
    const point = map.screen(p);
    const top = document
      .querySelector(".topbar")
      .getBoundingClientRect().bottom;
    if (
      point.x < 45 ||
      point.x > usableWidth() - 45 ||
      point.y < top + 60 ||
      point.y > innerHeight - 60
    ) {
      map.camera.x =
        p.x + (innerWidth / 2 - usableWidth() / 2) / map.camera.zoom;
      map.camera.y =
        p.y + (innerHeight / 2 - (innerHeight + top) / 2) / map.camera.zoom;
    }
  }
  menuAnchor = anchor || map.screen(p);
  lastMenu = "";
  render();
  $("aircraft-menu").focus({ preventScroll: true });
}
function positionMenu() {
  if (!menuOpen) return;
  const menu = $("aircraft-menu");
  const anchor = menuAnchor || map.screen(selectedPlane());
  const top =
    document.querySelector(".topbar").getBoundingClientRect().bottom + 10;
  const right = Math.max(menu.offsetWidth + 24, usableWidth() - 12);
  let x = anchor.x + 26;
  if (x + menu.offsetWidth > right) x = anchor.x - menu.offsetWidth - 26;
  x = Math.max(12, Math.min(right - menu.offsetWidth, x));
  const y = Math.max(
    top,
    Math.min(innerHeight - menu.offsetHeight - 12, anchor.y - 24),
  );
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}
function preview() {
  const p = selectedPlane();
  if (!canPlan(p)) return;
  planning = true;
  if (p.direction === "arrival" && !destination)
    destination = p.stand || sim.freeStands(p)[0]?.id || "";
  const runway =
    p.direction === "departure"
      ? chooseRunway(p, sim.departureRunwayOptions(p))
      : null;
  const target =
    p.direction === "arrival"
      ? sim.stands.get(destination)?.node
      : runway?.departureHold;
  map.preview = target ? sim.plan(p, target, waypoints) : [];
  map.waypoints = waypoints;
  if (!map.preview.length)
    toast("No taxi route is available to this destination.");
  lastMenu = "";
  render();
  saveGame();
}
function options(p) {
  if (!p || p.state === "done") return [];
  const action = (
    id,
    label,
    glyph,
    key,
    primary = false,
    disabled = false,
  ) => ({ id, label, glyph, key, primary, disabled });
  if (p.state === "gate")
    return [
      action("pushback", "Approve pushback", "corner-down-left", "P", true),
      ...(sim.pushbackOptions(p).length > 1
        ? [action("pushbackchoice", "Pushback direction...", "route", "R")]
        : []),
    ];
  if (p.state === "landing" && p.airborne)
    return [action("goaround", "Go around", "undo-2", "G")];
  if (p.state === "approach") {
    const runway =
      chooseRunway(p, sim.arrivalRunwayOptions(p)) || assignedRunway(p);
    return [
      action(
        "land",
        "Clear to land / " + runway.label,
        "plane-landing",
        "L",
        true,
        false,
      ),
      action("goaround", "Go around", "undo-2", "G"),
    ];
  }
  if (p.state === "linedup")
    return [
      action("takeoff", "Cleared for takeoff", "plane-takeoff", "D", true),
    ];
  const actions = [];
  if (sim.crossingOptions(p).length)
    actions.push(
      action("runwaycrossing", "Cross runway...", "arrow-up-right", "K", true),
    );
  if (p.state === "holding") {
    const runway = assignedRunway(p);
    actions.push(
      action(
        "lineup",
        "Line up & wait / " + runway.label,
        "arrow-up-right",
        "U",
        true,
        false,
      ),
      action(
        "rolling",
        "Rolling departure / " + runway.label,
        "plane-takeoff",
        "O",
      ),
    );
  }
  if (p.holdReached)
    actions.push(action("continue", "Continue taxi", "play", "C", true));
  if (canPlan(p)) {
    actions.push(
      action(
        "preview",
        planning ? "Update taxi route" : "Plan taxi route",
        "route",
        "T",
        !planning,
      ),
    );
    actions.push(
      action("holdingpoint", "Taxi to holding point", "navigation-2", "B"),
    );
    if (planning)
      actions.push(
        action(
          "taxi",
          "Issue taxi clearance",
          "check",
          "Enter",
          true,
          map.preview.length < 2,
        ),
      );
  }
  if (["taxi", "taxiin"].includes(p.state) && !p.holdReached) {
    actions.push(action("holdshort", "Hold short of...", "pause", "S"));
    actions.push(action("follow", "Follow...", "route", "Y"));
    actions.push(action("giveway", "Give way to...", "corner-down-left", "W"));
  }
  if (p.trafficOrder)
    actions.push(
      action("canceltraffic", "Cancel traffic instruction", "x", "X"),
    );
  if (["pushback", "taxi", "taxiin"].includes(p.state) && !p.holdReached)
    actions.push(
      action(
        "hold",
        p.held ? "Resume movement" : "Hold position",
        p.held ? "play" : "pause",
        "H",
      ),
    );
  return actions;
}
function instructionChoices(p, mode) {
  if (mode === "pushbackchoice") return sim.pushbackOptions(p);
  if (mode === "holdingpoint")
    return sim
      .holdingPoints()
      .filter((n) => n.id !== p.node && sim.plan(p, n.id).length >= 2)
      .map((n) => ({ id: n.id, label: n.ref, node: n }));
  if (mode === "holdshort") return sim.holdOptions(p);
  if (mode === "runwaycrossing") return sim.crossingOptions(p);
  return sim
    .trafficCandidates(p, mode)
    .map((q) => ({ id: String(q.id), label: q.call }));
}
function execute(action, payload) {
  const result = session.dispatch(selected, action, payload);
  if (!result.ok) {
    toast(result.message);
    return;
  }
  clearPlan();
  closeMenu();
  $("map").focus({ preventScroll: true });
  lastMenu = "";
  render();
}
function issue(action) {
  if (action === "back") {
    if (["pushbackchoice", "runwaycrossing"].includes(menuMode))
      map.preview = [];
    menuMode = "";
    menuChoice = "";
    map.focusHold = null;
    lastMenu = "";
    render();
    return;
  }
  if (action === "confirm" && menuMode) {
    if (
      !instructionChoices(selectedPlane(), menuMode).some(
        (c) => c.id === menuChoice,
      )
    ) {
      toast("That instruction is no longer available.");
      return;
    }
    execute(
      menuMode === "holdingpoint"
        ? "taxi"
        : menuMode === "pushbackchoice"
          ? "pushback"
          : menuMode === "runwaycrossing"
            ? "cross"
            : menuMode,
      {
        holdingPoint: menuMode === "holdingpoint" ? menuChoice : undefined,
        holdPoint: menuChoice,
        targetId: Number(menuChoice),
        waypoints,
        pushbackOption: menuMode === "pushbackchoice" ? menuChoice : undefined,
        crossingId: menuMode === "runwaycrossing" ? menuChoice : undefined,
      },
    );
    return;
  }
  const p = selectedPlane(),
    option = options(p).find((a) => a.id === action);
  if (!option) {
    toast(
      p
        ? "That action is unavailable: " + stateText(p) + "."
        : "Select an aircraft first.",
    );
    return;
  }
  if (option.disabled) {
    toast(
      action === "taxi"
        ? "A valid taxi route is required."
        : "Runway occupied. Hold position.",
    );
    return;
  }
  if (
    [
      "holdingpoint",
      "holdshort",
      "follow",
      "giveway",
      "pushbackchoice",
      "runwaycrossing",
    ].includes(action)
  ) {
    if (!menuOpen) select(selected);
    menuMode = action;
    menuChoice = instructionChoices(p, action)[0]?.id || "";
    lastMenu = "";
    render();
    $("aircraft-menu").focus({ preventScroll: true });
    return;
  }
  if (action === "preview") {
    if (!menuOpen) select(selected);
    preview();
    if (map.preview.length >= 2) {
      closeMenu();
      $("map").focus({ preventScroll: true });
    }
    return;
  }
  execute(action, {
    stand: destination,
    waypoints,
    exitId: landingExitChoice || undefined,
    runwayKey: runwayChoice || undefined,
  });
}
function menuHTML(p) {
  if (menuMode) {
    const titles = {
      pushbackchoice: "Pushback direction",
      holdingpoint: "Taxi to holding point",
      holdshort: "Hold short of",
      follow: "Follow aircraft",
      giveway: "Give way to aircraft",
      runwaycrossing: "Runway crossing",
    };
    const choices = instructionChoices(p, menuMode);
    if (!choices.some((c) => c.id === menuChoice)) menuChoice = "";
    map.focusHold = choices.find((c) => c.id === menuChoice)?.node || null;
    if (["pushbackchoice", "runwaycrossing"].includes(menuMode))
      map.preview = (choices.find((c) => c.id === menuChoice)?.path || []).map(
        (id) => sim.nodes.get(id),
      );
    return (
      '<div class="instruction-picker"><button class="icon-button" data-action="back" title="Back" aria-label="Back to actions">' +
      icon("undo-2") +
      '</button><label for="instruction-select">' +
      titles[menuMode] +
      "</label>" +
      (choices.length
        ? '<select id="instruction-select"><option value="" disabled' +
          (!menuChoice ? " selected" : "") +
          ">Choose a target</option>" +
          choices
            .map(
              (c) =>
                '<option value="' +
                c.id +
                '"' +
                (c.id === menuChoice ? " selected" : "") +
                ">" +
                c.label +
                "</option>",
            )
            .join("") +
          "</select>"
        : "<p>No compatible " +
          (["follow", "giveway"].includes(menuMode)
            ? "traffic"
            : menuMode === "runwaycrossing"
              ? "runway crossings"
              : "holding points") +
          " ahead.</p>") +
      '</div><div class="menu-actions" role="menu" aria-label="Clearances for ' +
      p.call +
      '"><button role="menuitem" class="menu-action primary-action" data-action="confirm"' +
      (!menuChoice ? " disabled" : "") +
      ">" +
      icon("check") +
      '<span class="action-label">' +
      (menuMode === "holdingpoint" ? "Clear taxi" : "Issue instruction") +
      "</span><kbd>Enter</kbd></button></div>"
    );
  }
  const arriving = p.direction === "arrival";
  const runwayChoices =
    p.state === "approach"
      ? sim.arrivalRunwayOptions(p)
      : canPlan(p) && !arriving
        ? sim.departureRunwayOptions(p)
        : [];
  if (runwayChoices.length) chooseRunway(p, runwayChoices);
  const actions = options(p);
  let content = "";
  if (p.state === "approach") {
    content +=
      '<div class="destination"><label for="runway-select">ARRIVAL RUNWAY</label><select id="runway-select">' +
      runwayChoices
        .map(
          (runway) =>
            '<option value="' +
            runway.key +
            '"' +
            (runway.key === runwayChoice ? " selected" : "") +
            ">Runway " +
            runway.label +
            "</option>",
        )
        .join("") +
      "</select></div>";
    const exits = sim.landingOptions(p, runwayChoice);
    if (!exits.some((e) => e.id === landingExitChoice))
      landingExitChoice = exits[0]?.id || "";
    content +=
      '<div class="destination"><label for="exit-select">RUNWAY EXIT</label><select id="exit-select">' +
      (exits.length
        ? exits
            .map(
              (e) =>
                '<option value="' +
                e.id +
                '"' +
                (e.id === landingExitChoice ? " selected" : "") +
                ">" +
                e.id +
                "</option>",
            )
            .join("")
        : "<option>No suitable exit / stand</option>") +
      "</select></div>";
  }
  if (canPlan(p) && !arriving) {
    content +=
      '<div class="destination"><label for="runway-select">DEPARTURE RUNWAY</label><select id="runway-select">' +
      runwayChoices
        .map(
          (runway) =>
            '<option value="' +
            runway.key +
            '"' +
            (runway.key === runwayChoice ? " selected" : "") +
            ">Runway " +
            runway.label +
            " / " +
            runway.departureHoldLabel +
            "</option>",
        )
        .join("") +
      "</select></div>";
  }
  if (p.holdLimit)
    content +=
      '<div class="route-summary">Hold short: ' + p.holdLimit.label + "</div>";
  if (p.trafficOrder)
    content +=
      '<div class="route-summary">' +
      (p.trafficOrder.kind === "follow" ? "Follow " : "Give way to ") +
      (sim.planes.find((q) => q.id === p.trafficOrder.targetId)?.call ||
        "traffic") +
      "</div>";
  if (canPlan(p) && arriving) {
    const choices = sim.data.stands
      .map((s) => {
        const reason = sim.standReason(p, s.id);
        return (
          '<option value="' +
          s.id +
          '" ' +
          (s.id === destination ? "selected " : "") +
          (reason ? "disabled" : "") +
          ">Stand " +
          s.id +
          (reason ? " / " + reason : "") +
          "</option>"
        );
      })
      .join("");
    content +=
      '<div class="destination"><label for="stand-select">DESTINATION STAND</label><select id="stand-select"><option value="">Assign stand</option>' +
      choices +
      "</select></div>";
  }
  if (planning)
    content +=
      '<div class="route-summary">' +
      (sim.routeNames(map.preview).join(" → ") || "Apron") +
      " → " +
      (arriving
        ? "Stand " + destination
        : `${assignedRunway(p).departureHoldLabel} / RWY ${assignedRunway(p).label}`) +
      "</div>";
  content +=
    '<div class="menu-actions" role="menu" aria-label="Clearances for ' +
    p.call +
    '">' +
    actions
      .map(
        (a) =>
          '<button role="menuitem" class="menu-action ' +
          (a.primary ? "primary-action" : "") +
          '" data-action="' +
          a.id +
          '" aria-keyshortcuts="' +
          a.key +
          '" ' +
          (a.disabled ? 'disabled title="Clearance unavailable"' : "") +
          ">" +
          icon(a.glyph) +
          '<span class="action-label">' +
          a.label +
          "</span><kbd>" +
          a.key +
          "</kbd></button>",
      )
      .join("") +
    "</div>";
  if (!actions.length)
    content +=
      '<div class="clearance-note">' +
      (p.state === "parked"
        ? "Turnaround in progress / ready in " +
          formatDuration(p.parkedAt + p.turnaroundDuration - sim.time)
        : p.state === "done"
          ? "Handoff complete"
          : "Clearance active") +
      "</div>";
  return content;
}
function render() {
  if (!sim) return;
  const p = selectedPlane();
  map.aircraftBounds = {
    right: innerWidth - 65,
    top: document.querySelector(".topbar").getBoundingClientRect().bottom + 100,
  };
  $("clock").textContent = formatTime(sim.time);
  $("movements").textContent = sim.completed;
  $("score").textContent = sim.score;
  $("incidents").textContent = sim.incidents;
  $("runway-badge").classList.toggle("transitioning", !!sim.runwayTransition);
  $("runway-badge").querySelector(".runway-symbol").textContent =
    sim.activeRunways.map((runway) => runway.label).join(" / ");
  const occupiedRunways = sim.data.operations.runways.flatMap((runway) => {
    const owner = sim.ownerForPhysical(runway.id),
      plane = sim.planes.find((candidate) => candidate.id === owner);
    return plane ? [{ runway, plane }] : [];
  });
  const reservedRunways = sim.data.operations.runways.flatMap((runway) => {
    const configuration = sim.data.runwayConfigurations.find(
        (candidate) => candidate.runwayId === runway.id,
      ),
      plane = configuration ? sim.clearedArrivalForRunway(configuration) : null;
    return plane ? [{ runway, plane }] : [];
  });
  const nextArrival = (runway) =>
    reservedRunways.find((reserved) => reserved.runway.id === runway.id)?.plane;
  $("runway-status").textContent = sim.runwayTransition
    ? "Changing"
    : occupiedRunways.length > 1
      ? `${occupiedRunways.length} occupied`
      : occupiedRunways.length === 1
        ? `${occupiedRunways[0].runway.ends[0].label}/${occupiedRunways[0].runway.ends[1].label} ${occupiedRunways[0].plane.call}${nextArrival(occupiedRunways[0].runway) ? ` / ${nextArrival(occupiedRunways[0].runway).call} next` : ""}`
        : reservedRunways.length > 1
          ? `${reservedRunways.length} reserved`
          : reservedRunways.length === 1
            ? `${reservedRunways[0].runway.ends[0].label}/${reservedRunways[0].runway.ends[1].label} ${reservedRunways[0].plane.call} next`
            : "Available";
  $("runway-badge").classList.toggle("occupied", !!occupiedRunways.length);
  $("runway-badge").classList.toggle("reserved", !!reservedRunways.length);
  $("runway-badge").title = sim.runwayTransition
    ? "Runway changeover in progress"
    : occupiedRunways.length || reservedRunways.length
      ? [
          ...occupiedRunways.map(
            ({ runway, plane }) =>
              `Runway ${runway.ends[0].label}/${runway.ends[1].label} occupied by ${plane.call}`,
          ),
          ...reservedRunways.map(
            ({ runway, plane }) =>
              `Runway ${runway.ends[0].label}/${runway.ends[1].label} reserved for ${plane.call}`,
          ),
        ].join("; ")
      : "All active runways available";
  if (menuOpen && (!p || p.state === "done")) closeMenu();
  if (menuOpen) {
    const html = menuHTML(p);
    const menu = $("aircraft-menu");
    menu.hidden = false;
    if (html !== lastMenu) {
      const focusedAction = menu.contains(document.activeElement)
        ? document.activeElement.dataset.action
        : null;
      const focusedId = menu.contains(document.activeElement)
        ? document.activeElement.id
        : null;
      menu.innerHTML = html;
      lastMenu = html;
      menu
        .querySelectorAll("[data-action]")
        .forEach((b) => (b.onclick = () => issue(b.dataset.action)));
      if ($("stand-select"))
        $("stand-select").onchange = (e) => {
          destination = e.target.value;
          if (planning) preview();
        };
      if ($("exit-select"))
        $("exit-select").onchange = (e) => {
          landingExitChoice = e.target.value;
        };
      if ($("runway-select"))
        $("runway-select").onchange = (e) => {
          runwayChoice = e.target.value;
          landingExitChoice = "";
          lastMenu = "";
          if (planning) preview();
          else render();
        };
      if ($("instruction-select"))
        $("instruction-select").onchange = (e) => {
          menuChoice = e.target.value;
          lastMenu = "";
          render();
        };
      if (focusedAction)
        (
          menu.querySelector('[data-action="' + focusedAction + '"]') || menu
        ).focus({ preventScroll: true });
      else if (focusedId && $(focusedId))
        $(focusedId).focus({ preventScroll: true });
      refreshIcons();
    }
    positionMenu();
  }
  $("route-banner").hidden = !planning;
  $("route-text").textContent =
    (waypoints.length ? waypoints.length + " via / " : "") +
    "Taxi to " +
    (p?.direction === "arrival"
      ? "stand " + destination
      : `${assignedRunway(p).departureHoldLabel} / ${assignedRunway(p).label}`);
  $("route-issue").disabled = map.preview.length < 2;
}
function restart() {
  clearTimeout(toastTimer);
  $("toast").hidden = true;
  return session.restart(() => {
    clearPlan();
    closeMenu();
    selected = sim.planes[0]?.id ?? null;
    map.selected = selected;
    pause(false);
    map.fit();
    document
      .querySelectorAll("[data-speed]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          +button.dataset.speed === session.speed,
        ),
      );
    render();
  });
}
$("pause").onclick = () => pause(!session.paused);
document.querySelectorAll("[data-speed]").forEach(
  (b) =>
    (b.onclick = () => {
      session.speed = +b.dataset.speed;
      document
        .querySelectorAll("[data-speed]")
        .forEach((x) => x.classList.toggle("active", x === b));
    }),
);
$("zoom-in").onclick = () => {
  closeMenu();
  map.zoom(1.3);
};
$("zoom-out").onclick = () => {
  closeMenu();
  map.zoom(1 / 1.3);
};
$("fit").onclick = () => {
  closeMenu();
  map.fit();
};
$("labels").onclick = () => {
  map.labels = !map.labels;
  $("labels").classList.toggle("active", map.labels);
  $("labels").setAttribute("aria-pressed", String(map.labels));
};
$("route-clear").onclick = () => {
  waypoints = [];
  preview();
};
$("route-issue").onclick = () => issue("taxi");
$("airport-button").onclick = () => showDialog("airport-dialog");
$("runway-badge").onclick = showRunwayPlanner;
$("runway-config").onclick = showRunwayPlanner;
$("cancel-runways").onclick = () => $("runway-dialog").close();
$("apply-runways").onclick = () => {
  const uses = [...runwayDraft.entries()].flatMap(
    ([runwayId, { endId, role }]) =>
      !endId || role === "closed"
        ? []
        : [
            {
              runwayId,
              endId,
              arrivals: ["arrivals", "mixed"].includes(role),
              departures: ["departures", "mixed"].includes(role),
            },
          ],
  );
  const result = session.configureRunways(uses, {
    presetId: runwayDraftPreset,
  });
  if (!result.ok) {
    $("runway-error").textContent = result.message;
    $("runway-error").hidden = false;
    return;
  }
  lastMenu = "";
  modalPaused = false;
  $("runway-dialog").close();
  render();
};
function showReset() {
  $("reset-message").textContent = session.awaitingRecovery
    ? "The saved game is incompatible with this version. Delete it to start a new game."
    : "Delete the current game and start over? Aircraft and scores will reset.";
  $("cancel-restart").hidden = session.awaitingRecovery;
  showDialog("restart-dialog");
}
$("restart").onclick = showReset;
$("restart-dialog").addEventListener("cancel", (event) => {
  if (session.awaitingRecovery) event.preventDefault();
});
$("cancel-restart").onclick = () => $("restart-dialog").close();
$("confirm-restart").onclick = () => {
  if (restart()) {
    modalPaused = false;
    $("restart-dialog").close();
  } else {
    pause(true);
    $("reset-message").textContent =
      "Could not reset the game. Browser storage is unavailable; the current state has not been deleted.";
  }
};
$("shortcuts").onclick = () => showDialog("shortcuts-dialog");
document.addEventListener("pointerdown", (e) => {
  if (
    menuOpen &&
    !$("aircraft-menu").contains(e.target) &&
    !$("strips").contains(e.target) &&
    e.target !== $("map")
  )
    closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (!session || session.disposed) return;
  if (
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    document.querySelector("dialog[open]")
  )
    return;
  const target = document.activeElement;
  if (target.matches("input,textarea,select") || target.isContentEditable)
    return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeMenu(true);
    $("map").focus({ preventScroll: true });
    return;
  }
  if (
    menuOpen &&
    ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
    $("aircraft-menu").contains(target)
  ) {
    const buttons = [
      ...$("aircraft-menu").querySelectorAll(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    if (!buttons.length) return;
    e.preventDefault();
    const index = buttons.indexOf(target);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].focus();
    return;
  }
  if (e.key === "?") {
    e.preventDefault();
    showDialog("shortcuts-dialog");
    return;
  }
  if (e.code === "Space") {
    if (target.matches("button,summary")) return;
    e.preventDefault();
    pause(!session.paused);
    return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "f") {
    e.preventDefault();
    closeMenu();
    map.fit();
    return;
  }
  if (key === "n") {
    e.preventDefault();
    const queue = orderedFlights(sim.planes).filter(requestsAction);
    if (queue.length)
      select(
        queue[(queue.findIndex((p) => p.id === selected) + 1) % queue.length]
          .id,
      );
    return;
  }
  const action = shortcuts[key];
  if (!action) return;
  if (key === "Enter" && target.matches("button")) return;
  if (key === "Enter" && menuMode) {
    e.preventDefault();
    issue("confirm");
    return;
  }
  if (key === "Enter" && (!planning || target.closest(".topbar"))) return;
  e.preventDefault();
  issue(action);
});
window.addEventListener("resize", () => {
  closeMenu();
});
for (const event of ["click", "change", "keydown", "pointerup"])
  document.addEventListener(event, () => queueMicrotask(saveGame));
window.addEventListener("pagehide", (event) => {
  if (event.persisted) saveGame();
  else session?.dispose();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveGame();
});

async function start() {
  try {
    const writer = await acquireWriter(airportData.id);
    if (writer.status === "busy") {
      $("map-loading").textContent =
        "This airport is open in another tab. Close that tab, then reload.";
      document.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      return;
    }
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) writer.release();
    });
    populateAirportUI(airportData, airportCatalog, (airport) => {
      if (airport.id === airportData.id) {
        $("airport-dialog").close();
        return;
      }
      if (!saveGame()) {
        toast(
          "Save unavailable. Airport change cancelled to protect this session.",
        );
        return;
      }
      const url = new URL(location.href);
      url.searchParams.set("airport", airport.id);
      location.assign(url.href);
    });
    refreshIcons();
    session = new GameSession(airportData, {
      ...(writer.status === "unsupported"
        ? {
            storage: () => {
              throw new Error("Exclusive save access unavailable");
            },
          }
        : {}),
      readView,
      onSaveError: saveFailed,
      onCommand: (result, aircraftId) => {
        if (result.ok && aircraftId === selected) {
          clearPlan();
          closeMenu();
        }
      },
    });
    sim = session.sim;
    const saved = session.restored;
    selected = sim.planes[0]?.id ?? null;
    map = new AirportMap(
      $("map"),
      sim,
      select,
      (id) => {
        if (canPlan(selectedPlane())) {
          if (!planning) preview();
          if (waypoints.at(-1) !== id) waypoints.push(id);
          preview();
        }
      },
      () => closeMenu(),
    );
    $("map-loading").hidden = true;
    if (saved.status === "restored") {
      const ui = saved.ui;
      selected = ui.selected;
      map.selected = selected;
      session.speed = ui.speed;
      map.labels = ui.labels;
      $("labels").classList.toggle("active", ui.labels);
      $("labels").setAttribute("aria-pressed", String(ui.labels));
      if (ui.camera) map.camera = ui.camera;
      document
        .querySelectorAll("[data-speed]")
        .forEach((b) =>
          b.classList.toggle("active", +b.dataset.speed === session.speed),
        );
      pause(ui.paused);
      destination = ui.destination;
      runwayChoice = ui.runwayChoice;
      if (ui.planning && canPlan(selectedPlane())) {
        waypoints = ui.waypoints;
        preview();
      }
    }
    const dataDownload = $("airport-dialog").querySelector("a");
    dataDownload.href = URL.createObjectURL(
      new Blob([JSON.stringify(airportData)], { type: "application/json" }),
    );
    dataDownload.download = airportData.id.toLowerCase() + ".json";
    render();
    session.activate();
    if (session.awaitingRecovery) showReset();
    if (writer.status === "unsupported")
      toast(
        "Exclusive save access unavailable. Progress cannot be kept after closing this page.",
      );
    window.groundControl = {
      session,
      sim,
      map,
      select,
      issue,
      preview,
      setPaused: pause,
      getState: () => ({
        time: sim.time,
        score: sim.score,
        completed: sim.completed,
        runways: Object.fromEntries(sim.runwayOwners),
        flights: sim.planes.map(
          ({
            id,
            call,
            state,
            x,
            y,
            stand,
            held,
            holdLimit,
            holdReached,
            trafficOrder,
            trafficWaiting,
          }) => ({
            id,
            call,
            state,
            x,
            y,
            stand,
            held,
            holdLimit,
            holdReached,
            trafficOrder,
            trafficWaiting,
          }),
        ),
      }),
    };
    const context = document.modelContext;
    if (context?.registerTool) {
      const controller = new AbortController();
      window.addEventListener("pagehide", () => controller.abort(), {
        once: true,
      });
      const tools = [
        {
          name: "read_ground_control",
          description: "Read the airport simulation and flight states.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: () => window.groundControl.getState(),
        },
        {
          name: "issue_ground_clearance",
          description:
            "Issue a clearance to an aircraft using the same rules as the context menu.",
          inputSchema: {
            type: "object",
            properties: {
              flightId: { type: "integer" },
              action: {
                type: "string",
                enum: [
                  "pushback",
                  "hold",
                  "taxi",
                  "lineup",
                  "takeoff",
                  "rolling",
                  "land",
                  "goaround",
                  "holdshort",
                  "follow",
                  "giveway",
                  "continue",
                  "canceltraffic",
                  "cross",
                ],
              },
              stand: { type: "string" },
              holdingPoint: { type: "string" },
              holdPoint: { type: "string" },
              targetId: { type: "integer" },
              pushbackOption: { type: "string" },
              exitId: { type: "string" },
              runwayKey: { type: "string" },
              crossingId: { type: "string" },
            },
            required: ["flightId", "action"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: (input) => {
            if (
              !Number.isInteger(input.flightId) ||
              typeof input.action !== "string"
            )
              throw new Error("Invalid clearance");
            const result = session.dispatch(
              input.flightId,
              input.action,
              input,
            );
            if (result.ok && input.flightId === selected) {
              clearPlan();
              closeMenu();
            }
            render();
            return result;
          },
        },
      ];
      for (const tool of tools) {
        try {
          Promise.resolve(
            context.registerTool(tool, { signal: controller.signal }),
          ).catch(() => {});
        } catch {}
      }
    }
    let previous = performance.now(),
      lastUI = 0;
    function frame(now) {
      if (session.disposed) return;
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (!document.hidden) session.advance(dt);
      map.draw();
      if (now - lastUI > 150) {
        render();
        lastUI = now;
      }
      session.autosave(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (error) {
    $("map-loading").textContent = error.message;
    console.error(error);
  }
}
refreshIcons();
start();
