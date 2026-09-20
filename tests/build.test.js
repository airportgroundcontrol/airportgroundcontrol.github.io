import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

test("airport source retains its exact pre-refactor bytes", () => {
  const bytes = fs.readFileSync(
    new URL("../data/airports/egph/geometry.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "0147a01b50ef7ce7c8b3892aaa1e3e4ba4c6f2ae4a8d40b69843d382e584ea10",
  );
});
