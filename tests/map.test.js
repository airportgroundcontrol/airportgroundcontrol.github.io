import test from "node:test";
import assert from "node:assert/strict";
import { aircraftStatusColor, formatArrivalETA } from "../src/map.js";

test("aircraft colors communicate operational state", () => {
  assert.equal(aircraftStatusColor({ state: "gate" }), "#f2f2ef");
  assert.equal(aircraftStatusColor({ state: "parked" }), "#f2f2ef");
  assert.equal(aircraftStatusColor({ state: "taxi" }), "#f0ca62");
  assert.equal(aircraftStatusColor({ state: "holding" }), "#f0ca62");
  assert.equal(aircraftStatusColor({ state: "approach" }), "#78b7ff");
  assert.equal(aircraftStatusColor({ state: "landing" }), "#78b7ff");
  assert.equal(aircraftStatusColor({ state: "takeoff" }), "#67d68c");
  assert.equal(aircraftStatusColor({ state: "pushback" }), "#b88762");
  assert.equal(aircraftStatusColor({ state: "disconnect" }), "#b88762");
  assert.equal(
    aircraftStatusColor({ state: "taxi", blocked: true }),
    "#f0ca62",
  );
});

test("arrival ETAs use minutes and zero-padded seconds", () => {
  assert.equal(formatArrivalETA(0), "0:00");
  assert.equal(formatArrivalETA(1.1), "0:02");
  assert.equal(formatArrivalETA(65), "1:05");
  assert.equal(formatArrivalETA(600), "10:00");
});
