import { GroundSim } from "../sim.js";
import { GameStorage } from "../persistence.js";

// Owns the simulation and persistence lifecycle; DOM/view state stays with the UI.
export class GameSession {
  constructor(
    airport,
    {
      storage,
      readView = () => ({}),
      onSaveError = () => {},
      onCommand = () => {},
    } = {},
  ) {
    this.airport = airport;
    this.scenario = airport.scenario;
    this.sim = new GroundSim(airport);
    this.storage = new GameStorage(airport, storage);
    this.readView = readView;
    this.onSaveError = onSaveError;
    this.onCommand = onCommand;
    this.paused = false;
    this.speed = 4;
    this.ready = false;
    this.disposed = false;
    this.lastAutosave = null;
    this.restored = this.storage.load(this.sim);
    if (this.restored.status === "restored") {
      this.paused = this.restored.ui.paused;
      this.speed = this.restored.ui.speed;
    }
  }

  activate() {
    if (this.disposed) return false;
    this.ready = true;
    return this.save();
  }

  save() {
    if (!this.ready || this.disposed) return false;
    const ok = this.storage.save(this.sim, this.readView());
    if (!ok) this.onSaveError();
    return ok;
  }

  dispatch(aircraftId, action, payload) {
    if (this.disposed)
      return { ok: false, message: "Session closed.", events: [] };
    const before = new Set(this.sim.logs);
    const result = this.sim.command(aircraftId, action, payload);
    const events = this.sim.logs
      .filter((event) => !before.has(event))
      .reverse()
      .map((event) => ({ ...event }));
    const outcome = { ...result, events };
    // The UI clears transient route drafts before the successful command is saved.
    try {
      this.onCommand(outcome, aircraftId);
    } finally {
      if (result.ok) this.save();
    }
    return outcome;
  }

  advance(elapsedSeconds) {
    if (
      this.disposed ||
      this.paused ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds <= 0
    )
      return;
    let remaining = Math.min(elapsedSeconds, 0.1) * this.speed;
    while (remaining > 0) {
      const step = Math.min(0.1, remaining);
      this.sim.tick(step);
      remaining -= step;
    }
  }

  autosave(now) {
    if (this.lastAutosave === null) this.lastAutosave = now;
    if (now - this.lastAutosave >= 1000) {
      this.save();
      this.lastAutosave = now;
    }
  }

  restart(resetView = () => {}) {
    if (this.disposed) return false;
    this.storage.startNewGame();
    this.sim.reset();
    this.paused = false;
    resetView();
    return this.save();
  }

  dispose() {
    if (this.disposed) return;
    this.save();
    this.disposed = true;
    this.ready = false;
  }
}
