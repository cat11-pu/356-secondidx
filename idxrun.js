// idxrun.js：按处理预算处理并留账，收尾不限预算清账
import { chainOf, dropOf } from "./idx.js";

function codes(spec) {
  return {
    badEvent: spec.event_error_code || "E_BAD_EVENT",
    badPk: spec.bad_pk_code || "E_BAD_PK",
    badSk: spec.bad_sk_code || "E_BAD_SK",
    dup: spec.dup_code || "E_DUP_PK",
    missing: spec.missing_code || "E_NO_PK"
  };
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function appliedKey(kind, pk, sk) {
  return String(kind) + ":" + String(pk) + ":" + (sk === undefined || sk === null ? "" : String(sk));
}

function copyState(state) {
  state = state || {};
  return {
    main: (state.main || []).map(function (row) { return [row[0], row[1]]; }),
    aux: (state.aux || []).map(function (row) { return [row[0], row[1].slice()]; }),
    cleaned: (state.cleaned || []).map(function (row) { return [row[0], row[1]]; }),
    ledger: (state.ledger || []).map(function (row) { return row.slice(); }),
    applied: (state.applied || []).slice()
  };
}

function toEvent(raw) {
  if (Array.isArray(raw)) return { kind: raw[0], pk: raw[1], sk: raw[2] };
  return raw;
}

// 先校验结构、主键、次键，再谈得上业务判断
function validate(raw, c) {
  const event = toEvent(raw);
  if (!event || typeof event !== "object") fail(c.badEvent, "event must be an object");
  const kind = event.kind;
  if (kind !== "insert" && kind !== "remove") fail(c.badEvent, "unknown event kind");
  if (!("pk" in event)) fail(c.badEvent, "event misses pk");
  if (kind === "insert" && !("sk" in event)) fail(c.badEvent, "insert misses sk");
  const pk = event.pk;
  if (typeof pk !== "number" || !Number.isInteger(pk) || pk <= 0) {
    fail(c.badPk, "pk must be a positive integer");
  }
  if (kind === "insert") {
    const sk = event.sk;
    if (sk === undefined || sk === null || sk === "") fail(c.badSk, "sk must not be empty");
  }
  return { kind: kind, pk: pk, sk: kind === "insert" ? event.sk : null };
}

function insertMain(main, pk, sk) {
  const next = [];
  let placed = false;
  for (const row of main) {
    if (!placed && row[0] > pk) { next.push([pk, sk]); placed = true; }
    next.push([row[0], row[1]]);
  }
  if (!placed) next.push([pk, sk]);
  return next;
}

function insertAux(aux, pk, sk) {
  const next = [];
  let placed = false;
  for (const row of aux) {
    if (row[0] === sk) {
      const chain = row[1].slice();
      let at = 0;
      while (at < chain.length && chain[at] < pk) at += 1;
      chain.splice(at, 0, pk);
      next.push([row[0], chain]);
      placed = true;
    } else {
      if (!placed && row[0] > sk) { next.push([sk, [pk]]); placed = true; }
      next.push([row[0], row[1].slice()]);
    }
  }
  if (!placed) next.push([sk, [pk]]);
  return next;
}

function apply(state, event, c) {
  if (event.kind === "insert") {
    for (const row of state.main) {
      if (row[0] === event.pk) fail(c.dup, "pk already in main: " + event.pk);
    }
    state.main = insertMain(state.main, event.pk, event.sk);
    state.aux = insertAux(state.aux, event.pk, event.sk);
    return state;
  }
  let hit = null;
  for (const row of state.main) {
    if (row[0] === event.pk) { hit = row; break; }
  }
  if (!hit) fail(c.missing, "pk not in main: " + event.pk);
  state.main = state.main.filter(function (row) { return row[0] !== event.pk; });
  state.aux = dropOf(state.aux, hit[1], event.pk);
  state.cleaned = state.cleaned.concat([[event.pk, hit[1]]]);
  return state;
}

export function step(spec) {
  const c = codes(spec);
  const events = spec.events || [];
  const budget = typeof spec.budget === "number" ? spec.budget : 0;
  let state = copyState(spec.state);
  let served = 0;
  let judged = 0;
  let remaining = budget;
  for (const raw of events) {
    const probe = toEvent(raw) || {};
    if (state.applied.indexOf(appliedKey(probe.kind, probe.pk, probe.sk)) !== -1) continue;
    judged += 1;
    if (remaining > 0) {
      const event = validate(raw, c);
      state = apply(state, event, c);
      state.applied.push(appliedKey(event.kind, event.pk, event.sk));
      remaining -= 1;
      served += 1;
    } else {
      state.ledger.push([
        probe.kind === undefined ? null : probe.kind,
        probe.pk === undefined ? null : probe.pk,
        probe.sk === undefined ? null : probe.sk
      ]);
    }
  }
  return { state: state, served: served, ledger_before: state.ledger.length,
           ledger: state.ledger, judged: judged, judged_bound: events.length };
}

export function close(spec) {
  const c = codes(spec);
  let state = copyState(spec.state);
  const pending = state.ledger;
  state.ledger = [];
  let catchup = 0;
  for (const raw of pending) {
    const event = validate(raw, c);
    const key = appliedKey(event.kind, event.pk, event.sk);
    if (state.applied.indexOf(key) !== -1) continue;
    state = apply(state, event, c);
    state.applied.push(key);
    catchup += 1;
  }
  return { state: state, catchup: catchup };
}
