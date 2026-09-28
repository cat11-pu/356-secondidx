// idxrun.js：按共用处理预算登记/删除，用尽后连着载压账，收尾不限预算补齐
import { dropOf } from "./idx.js";

function code(spec, key, fallback) {
  return spec[key] || fallback;
}

function fail(spec, key, fallback, message) {
  const error = new Error(message);
  error.code = code(spec, key, fallback);
  throw error;
}

// 主键必须是正整数，次键（登记时）不能为空；结构、主键、次键依次先校验。
function normalize(spec, kind, pk, sk) {
  if (kind !== "insert" && kind !== "remove") {
    fail(spec, "event_error_code", "E_BAD_EVENT", "不支持的事件类型");
  }
  if (!Number.isInteger(pk) || pk <= 0) {
    fail(spec, "bad_pk_code", "E_BAD_PK", "主键必须是正整数");
  }
  let nextSk = sk === undefined ? null : sk;
  if (kind === "insert" && (nextSk === null || nextSk === "")) {
    fail(spec, "bad_sk_code", "E_BAD_SK", "次键不能为空");
  }
  return [kind, pk, nextSk];
}

function normalizeEvent(spec, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    fail(spec, "event_error_code", "E_BAD_EVENT", "事件结构不合法");
  }
  return normalize(spec, event.kind, event.pk, event.sk);
}

function normalizeTuple(spec, tuple) {
  if (!Array.isArray(tuple)) {
    fail(spec, "event_error_code", "E_BAD_EVENT", "挂账结构不合法");
  }
  return normalize(spec, tuple[0], tuple[1], tuple[2]);
}

const sigOf = function (tuple) { return JSON.stringify(tuple); };

// 不改动入参状态，返回一份深拷贝；applied 用集合便于判重。
function cloneState(state) {
  const src = state || {};
  return {
    main: (src.main || []).map(function (row) { return [row[0], row[1]]; }),
    aux: (src.aux || []).map(function (row) { return [row[0], row[1].slice()]; }),
    cleaned: (src.cleaned || []).map(function (row) { return [row[0], row[1]]; }),
    ledger: (src.ledger || []).map(function (tuple) { return tuple.slice(); }),
    applied: new Set((src.applied || []).map(String))
  };
}

function finalize(state) {
  return {
    main: state.main, aux: state.aux, cleaned: state.cleaned,
    ledger: state.ledger, applied: Array.from(state.applied)
  };
}

function findMain(main, pk) {
  for (let i = 0; i < main.length; i += 1) {
    if (main[i][0] === pk) return i;
  }
  return -1;
}

// 对一条已校验的请求落账：登记进主表并挂二级索引，或摘除并记清理清单。
function apply(state, spec, tuple) {
  const kind = tuple[0];
  const pk = tuple[1];
  const sk = tuple[2];
  if (kind === "insert") {
    if (findMain(state.main, pk) !== -1) {
      fail(spec, "dup_code", "E_DUP_PK", "主键已在主表里");
    }
    state.main.push([pk, sk]);
    state.main.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    let target = null;
    for (const row of state.aux) {
      if (row[0] === sk) { target = row; break; }
    }
    if (!target) { target = [sk, []]; state.aux.push(target); }
    target[1].push(pk);
    target[1].sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    state.aux.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  } else {
    const at = findMain(state.main, pk);
    if (at === -1) {
      fail(spec, "missing_code", "E_NO_PK", "主键不在主表里");
    }
    const oldSk = state.main[at][1];
    state.main.splice(at, 1);
    state.cleaned.push([pk, oldSk]);
    state.aux = dropOf(state.aux, oldSk, pk);
  }
}

function parseBudget(spec) {
  const value = Math.floor(Number(spec.budget));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// 按处理预算处理事件：先把上一轮压着的账补齐，再处理本轮事件；
// 预算用尽后，没处理的连着载进 ledger；已处理过的请求重放时直接跳过。
export function step(spec) {
  const state = cloneState(spec.state);
  const events = Array.isArray(spec.events) ? spec.events : [];
  let budget = parseBudget(spec);
  let served = 0;
  let judged = 0;
  const queue = [];
  state.ledger.forEach(function (tuple) { queue.push({ tuple: tuple }); });
  events.forEach(function (event) { queue.push({ event: event }); });

  const remaining = [];
  for (const item of queue) {
    let tuple = null;
    let fromEvent = false;
    if (item.tuple) {
      tuple = item.tuple.slice();
    } else {
      fromEvent = true;
      // 没花预算的粗序列化，保证用尽后的事件原样连着载压账（收尾时再校验）。
      tuple = [item.event && item.event.kind, item.event && item.event.pk,
               item.event && item.event.sk === undefined ? null : item.event.sk];
    }
    const signature = sigOf(tuple);
    if (state.applied.has(signature)) continue;
    if (budget === 0) {
      remaining.push(tuple);
      continue;
    }
    const checked = item.tuple ? normalizeTuple(spec, tuple) : normalizeEvent(spec, item.event);
    apply(state, spec, checked);
    state.applied.add(sigOf(checked));
    budget -= 1;
    served += 1;
    if (fromEvent) judged += 1;
  }
  state.ledger = remaining;

  return {
    state: finalize(state),
    served: served,
    ledger_before: remaining.length,
    ledger: remaining.map(function (tuple) { return tuple.slice(); }),
    judged: judged,
    judged_bound: events.length
  };
}

// 收尾：不限预算把账处理完，返回补齐条数。
export function close(spec) {
  const state = cloneState(spec.state);
  let catchup = 0;
  const pending = state.ledger;
  state.ledger = [];
  for (const tuple of pending) {
    const checked = normalizeTuple(spec, tuple);
    apply(state, spec, checked);
    state.applied.add(sigOf(checked));
    catchup += 1;
  }
  return { state: finalize(state), catchup: catchup };
}
