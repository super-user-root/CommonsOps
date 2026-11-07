import assert from "node:assert/strict";
import test from "node:test";
import type { Cycle, Template } from "@commonsops/domain";
import {
  buildRegistrySnapshot,
  MAX_TEMPLATE_ENUMERATION,
  type RegistryReadDeps,
} from "./registry-reads.ts";
import { LiveRpcError } from "./rpc.ts";

const REGISTRY = "commonsops.testnet";
const BLOCK = Object.freeze({
  height: "276677732",
  timestampNs: "1794082183070369500",
  hash: "22MeNRa6KEynbHgjdHNC8kFo8o2jSYU7gdLHdivzDhCB",
});

function templateFixture(
  id: string,
  overrides: Partial<Template> = {},
): Template {
  return {
    id,
    manager_id: "commonsops.testnet",
    active: true,
    next_period_index: "1",
    created_at_ns: "1793910643118147928",
    input: {
      dao_account_id: "commonsops-dao.sputnikv2.testnet",
      title: `Template ${id}`,
      description: "",
      start_at_ns: "1793910183011867400",
      interval_ns: "604800000000000",
      work_window_ns: "432000000000000",
      claim_duration_ns: "172800000000000",
      amount_yocto: "500000000000000000000000",
    },
    ...overrides,
  };
}

function cycleFixture(
  templateId: string,
  periodIndex: string,
  status: Cycle["status"],
): Cycle {
  return {
    key: { template_id: templateId, period_index: periodIndex },
    status,
    opens_at_ns: "1793910183011867400",
    deadline_at_ns: "1794342183011867400",
    dao_account_id: "commonsops-dao.sputnikv2.testnet",
    amount_yocto: "500000000000000000000000",
    claim: null,
    evidence: null,
    submitted_at_ns: null,
    proposal_link: null,
  };
}

interface StubCall {
  readonly method: string;
  readonly args: unknown;
}

// Routes canned view results by method + args; throws for configured failures.
function stubDeps(views: {
  template: Map<string, unknown>;
  cycle: Map<string, unknown>;
}): RegistryReadDeps & { calls: StubCall[] } {
  const calls: StubCall[] = [];
  return {
    calls,
    fetchBlockHeader: async () => BLOCK,
    fetchView: async (_accountId, methodName, args) => {
      calls.push({ method: methodName, args });
      const record = args as {
        template_id?: string;
        cycle_key?: { template_id: string; period_index: string };
      };
      if (methodName === "get_template") {
        if (!record.template_id) throw new Error("stub: template_id missing");
        const value = views.template.get(record.template_id);
        if (value === "THROW") {
          throw new LiveRpcError("ERR_RPC_HTTP_STATUS", "upstream 503");
        }
        return value;
      }
      if (methodName === "get_cycle") {
        const key = record.cycle_key;
        if (!key) throw new Error("stub: cycle_key missing");
        const value = views.cycle.get(`${key.template_id}:${key.period_index}`);
        if (value === "THROW") {
          throw new LiveRpcError("ERR_RPC_HTTP_STATUS", "upstream 503");
        }
        return value;
      }
      if (methodName === "foundation_status") {
        return "foundation: no business behavior";
      }
      throw new Error(`stub: unexpected method ${methodName}`);
    },
  };
}

const FOUNDATION = "foundation: no business behavior";

test("enumerates every registered template with latest and next cycles", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", templateFixture("1")],
      ["2", templateFixture("2", { next_period_index: "0" })],
      ["3", null],
    ]),
    cycle: new Map<string, unknown>([
      ["0:0", cycleFixture("0", "0", "SUBMITTED")],
      ["0:1", null],
      ["1:0", cycleFixture("1", "0", "SUBMITTED")],
      ["1:1", null],
      ["2:0", cycleFixture("2", "0", "OPEN")],
    ]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);

  assert.equal(snapshot.registryAccountId, REGISTRY);
  assert.equal(snapshot.block.height, BLOCK.height);
  assert.equal(snapshot.foundationStatus, FOUNDATION);
  assert.equal(snapshot.enumerationComplete, true);
  assert.equal(snapshot.templates.length, 3);

  const [zero, one, two] = snapshot.templates;
  assert.ok(zero?.kind === "READY");
  assert.ok(one?.kind === "READY");
  assert.ok(two?.kind === "READY");

  assert.equal(zero.latestCycle?.periodIndex, "0");
  assert.equal(zero.latestCycle?.cycle?.status, "SUBMITTED");
  assert.equal(zero.nextCycle?.periodIndex, "1");
  assert.equal(zero.nextCycle?.cycle, null);

  assert.equal(one.latestCycle?.cycle?.status, "SUBMITTED");
  assert.equal(one.nextCycle?.cycle, null);

  // Template 2 has next_period_index "0": no latest read, next 2:0 is OPEN.
  assert.equal(two.template.next_period_index, "0");
  assert.equal(two.latestCycle, null);
  assert.equal(two.nextCycle?.periodIndex, "0");
  assert.equal(two.nextCycle.cycle?.status, "OPEN");

  // Cycle reads are issued only for existing periods.
  const cycleKeys = deps.calls
    .filter((call) => call.method === "get_cycle")
    .map((call) => {
      const key = (
        call.args as {
          cycle_key: { template_id: string; period_index: string };
        }
      ).cycle_key;
      return `${key.template_id}:${key.period_index}`;
    });
  assert.deepEqual(cycleKeys, ["0:0", "0:1", "1:0", "1:1", "2:0"]);
});

test("a missing template ends the enumeration as complete", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", null],
    ]),
    cycle: new Map<string, unknown>([
      ["0:0", cycleFixture("0", "0", "SUBMITTED")],
      ["0:1", null],
    ]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);
  assert.equal(snapshot.templates.length, 1);
  assert.equal(snapshot.enumerationComplete, true);
  assert.ok(
    !deps.calls.some(
      (call) =>
        call.method === "get_template" &&
        (call.args as { template_id: string }).template_id === "2",
    ),
  );
});

test("a template erroring after a success is a named per-template error, not a global failure", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", "THROW"],
    ]),
    cycle: new Map<string, unknown>([
      ["0:0", cycleFixture("0", "0", "SUBMITTED")],
      ["0:1", null],
    ]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);
  assert.equal(snapshot.templates.length, 2);
  const [zero, one] = snapshot.templates;
  assert.ok(zero?.kind === "READY");
  assert.equal(zero.template.id, "0");
  assert.ok(one?.kind === "ERROR");
  assert.equal(one.templateId, "1");
  assert.equal(one.code, "ERR_RPC_HTTP_STATUS");
  assert.equal(snapshot.enumerationComplete, false);
});

test("a cycle read failure is also a per-template error", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", null],
    ]),
    cycle: new Map<string, unknown>([["0:0", "THROW"]]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);
  assert.equal(snapshot.templates.length, 1);
  const only = snapshot.templates[0];
  assert.ok(only?.kind === "ERROR");
  assert.equal(only.templateId, "0");
  assert.equal(only.code, "ERR_RPC_HTTP_STATUS");
});

test("malformed cycle data fails that template with the hardened parse error", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", null],
    ]),
    cycle: new Map<string, unknown>([["0:0", { broken: true }]]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);
  const only = snapshot.templates[0];
  assert.ok(only?.kind === "ERROR");
  assert.equal(only.code, "ERR_LIVE_REGISTRY_DATA");
});

test("the cap stops enumeration and is reported as incomplete", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0")],
      ["1", templateFixture("1")],
      ["2", templateFixture("2", { next_period_index: "0" })],
    ]),
    cycle: new Map<string, unknown>([
      ["0:0", cycleFixture("0", "0", "SUBMITTED")],
      ["0:1", null],
      ["1:0", cycleFixture("1", "0", "SUBMITTED")],
      ["1:1", null],
      ["2:0", cycleFixture("2", "0", "OPEN")],
    ]),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY, 2);
  assert.equal(MAX_TEMPLATE_ENUMERATION, 16);
  assert.equal(snapshot.templates.length, 2);
  assert.equal(snapshot.enumerationComplete, false);
});

test("a paused template is read but gets no cycle reads", async () => {
  const deps = stubDeps({
    template: new Map<string, unknown>([
      ["0", templateFixture("0", { active: false })],
      ["1", null],
    ]),
    cycle: new Map(),
  });
  const snapshot = await buildRegistrySnapshot(deps, REGISTRY);
  assert.equal(snapshot.templates.length, 1);
  const only = snapshot.templates[0];
  assert.ok(only?.kind === "READY");
  assert.equal(only.paused, true);
  assert.ok(!deps.calls.some((call) => call.method === "get_cycle"));
});
