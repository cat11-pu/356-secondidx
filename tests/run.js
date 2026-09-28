import assert from "node:assert";
import { chainOf, dropOf } from "../idx.js";
import { step, close } from "../idxrun.js";
import { render } from "../app.js";

const base = {
  budget: 1,
  state: { main: [], aux: [], cleaned: [], ledger: [], applied: [] },
  events: [{ id: 1, kind: "insert", pk: 1, sk: "a" }],
  bad_pk_code: "E_BAD_PK", bad_sk_code: "E_BAD_SK",
  dup_code: "E_DUP_PK", missing_code: "E_NO_PK",
  event_error_code: "E_BAD_EVENT"
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + e.message); }
}

check("chainOf returns a list", () => {
  assert.ok(Array.isArray(chainOf([["a", [1]]], "a")));
});

check("dropOf returns a list", () => {
  assert.ok(Array.isArray(dropOf([["a", [1]]], "a", 1)));
});

check("step returns a state", () => {
  assert.strictEqual(typeof step(base).state, "object");
});

check("close returns a state", () => {
  assert.strictEqual(typeof close(base).state, "object");
});

check("render counts events", () => {
  assert.strictEqual(typeof render(base).count_events, "number");
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
