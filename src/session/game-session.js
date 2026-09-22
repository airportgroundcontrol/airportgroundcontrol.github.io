import { GroundSim } from "../sim.js";
import { GameStorage } from "../persistence.js";
import { freshSeed } from "./random.js";

// Owns the simulation and persistence lifecycle; DOM/view state stays with the UI.
export class GameSession {
  constructor(
    airport,
    {
      storage,
      seed,
      seedSource = freshSeed,
      readView = () => ({}),
      onSaveError = () => {},
      onCommand = () => {},
    } = {},
  ) {
    if (!airport.fleet)
      throw new Error("Aircraft operations are required to play this airport.");
    this.airport = airport;
    this.scenario = airport.scenario;
    this.seedSource = seedSource;
    this.sim = new GroundSim(airport, { seed: seed ?? seedSource() });
    this.storage = new GameStorage(airport, storage);
    this.readView = readView;
    this.onSaveError = onSaveError;
    this.onCommand = onCommand;
    this.paused = false;
    this.speed = 1;
    this.ready = false;
    this.disposed = false;
    this.lastAutosave = null;
    this.accumulator = 0;
    this.restored = this.storage.load(this.sim);
    if (this.awaitingRecovery) this.paused = true;
    if (this.restored.status === "restored") {
      this.paused = this.restored.ui.paused;
      this.speed = this.restored.ui.speed;
    }
  }

  get speed() {
    return this._speed;
  }

  set speed(value) {
    this._speed = value === 1 ? 1 : 4;
  }

  get awaitingRecovery() {
    return this.storage.protectOriginal === true;
  }

  activate() {
    if (this.disposed) return false;
    this.ready = true;
    return this.save();
  }

  save() {
    if (!this.ready || this.disposed || this.awaitingRecovery) return false;
    const ok = this.storage.save(this.sim, this.readView());
    if (!ok) this.onSaveError();
    return ok;
  }

  dispatch(aircraftId, action, payload) {
    if (this.disposed) return { ok: false, message: "Session closed." };
    if (this.awaitingRecovery)
      return {
        ok: false,
        message:
          "The saved game cannot be loaded. Delete it to start a new game.",
      };
    const result = this.sim.command(aircraftId, action, payload);
    // The UI clears transient route drafts before the successful command is saved.
    try {
      this.onCommand(result, aircraftId);
    } finally {
      if (result.ok) this.save();
    }
    return result;
  }

  configureRunways(uses, options) {
    if (this.disposed || this.awaitingRecovery)
      return { ok: false, message: "Runway configuration unavailable." };
    const result = this.sim.configureRunways(uses, options);
    if (result.ok) this.save();
    return result;
  }

  advance(elapsedSeconds) {
    if (
      this.disposed ||
      this.awaitingRecovery ||
      this.paused ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds <= 0
    )
      return;
    this.accumulator += Math.min(elapsedSeconds, 0.1) * this.speed;
    while (this.accumulator >= 0.05 - 1e-10) {
      this.sim.tick(0.05);
      this.accumulator = Math.max(0, this.accumulator - 0.05);
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
    const seed = this.seedSource(),
      previousSpeed = this.speed;
    try {
      const candidate = new GroundSim(this.airport, { seed });
      this.speed = 1;
      this.storage.reset(candidate, this.readView());
    } catch {
      this.speed = previousSpeed;
      this.onSaveError();
      return false;
    }
    this.sim.reset(seed);
    this.accumulator = 0;
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
