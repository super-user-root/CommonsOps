import assert from "node:assert/strict";
import test from "node:test";
import type { Cycle } from "@commonsops/domain";
import { buildFixtureJourney } from "../fixture-journey.ts";
import type { LiveTemplateRead } from "./registry-reads.ts";
import {
  deriveTemplateAvailability,
  preferredTemplate,
  TemplateSelection,
} from "./template-selection.ts";
import { guardedWalletSend, TransactionEvidence } from "./transactions.ts";

function read(
  cycle: Cycle,
  paused = false,
): Extract<LiveTemplateRead, { kind: "READY" }> {
  return {
    kind: "READY",
    templateId: cycle.key.template_id,
    paused,
    template: {
      id: cycle.key.template_id,
      active: !paused,
      manager_id: "manager.testnet",
      next_period_index: "1",
      created_at_ns: "1",
      input: {
        dao_account_id: cycle.dao_account_id,
        title: "Test fixture",
        description: "",
        amount_yocto: cycle.amount_yocto,
        start_at_ns: cycle.opens_at_ns,
        interval_ns: "604800000000000",
        work_window_ns: "432000000000000",
        claim_duration_ns: "172800000000000",
      },
    },
    latestCycle: { periodIndex: cycle.key.period_index, cycle },
    nextCycle: { periodIndex: "1", cycle: null },
  };
}
function open(cycle: Cycle, id = "2"): Cycle {
  return {
    ...cycle,
    key: { template_id: id, period_index: "0" },
    status: "OPEN",
    claim: null,
    evidence: null,
    submitted_at_ns: null,
    proposal_link: null,
  };
}

test("selection prefers connected active claim, then verified in-window open, never template 2 by identity", async () => {
  const journey = await buildFixtureJourney();
  const now = journey.contributor.observedBlockTimestampNs;
  const owner = journey.contributor.connectedAccountId;
  const entries = [
    read(journey.reviewer.cycle),
    read(open(journey.contributor.cycle, "7")),
    read({
      ...journey.contributor.cycle,
      key: { template_id: "9", period_index: "0" },
    }),
  ];
  const own = await Promise.all(
    entries.map((entry) => deriveTemplateAvailability(entry, now, owner)),
  );
  assert.equal(preferredTemplate(own), "9");
  const disconnected = await Promise.all(
    entries.map((entry) => deriveTemplateAvailability(entry, now, null)),
  );
  assert.equal(preferredTemplate(disconnected), "7");
  assert.equal(disconnected[1]!.view!.actions.claim_cycle.allowed, false);
  assert.equal(disconnected[1]!.view!.workWindowLive, true);
  assert.equal(preferredTemplate([]), null);
  // Prefer an existing active claim over the next open cycle in the same group.
  const both = {
    ...entries[2]!,
    nextCycle: {
      periodIndex: "1",
      cycle: {
        ...open(journey.contributor.cycle, "9"),
        key: { template_id: "9", period_index: "1" },
      },
    },
  };
  assert.equal(
    (await deriveTemplateAvailability(both, now, owner)).view?.key.period_index,
    "0",
  );
});

test("shared slot availability is time-bound, occupied after claim and non-releasable after submission", async () => {
  const journey = await buildFixtureJourney();
  const cycle = open(journey.contributor.cycle);
  const owner = journey.contributor.connectedAccountId;
  const now = journey.contributor.observedBlockTimestampNs;
  for (const time of [
    (BigInt(cycle.opens_at_ns) - 1n).toString(),
    cycle.deadline_at_ns,
  ]) {
    const summary = await deriveTemplateAvailability(read(cycle), time, owner);
    assert.equal(summary.preference, 2);
    assert.equal(summary.view?.actions.claim_cycle.allowed, false);
  }
  const available = await deriveTemplateAvailability(read(cycle), now, owner);
  assert.equal(available.view?.actions.claim_cycle.allowed, true);
  const occupied = { ...journey.contributor.cycle, key: cycle.key };
  assert.equal(
    (await deriveTemplateAvailability(read(occupied), now, "visitor.testnet"))
      .view?.actions.claim_cycle.allowed,
    false,
  );
  assert.equal(
    (await deriveTemplateAvailability(read(occupied), now, owner)).view?.actions
      .release_claim.allowed,
    true,
  );
  const submitted = { ...journey.reviewer.cycle, key: cycle.key };
  const frozen = await deriveTemplateAvailability(read(submitted), now, owner);
  assert.equal(frozen.view?.actions.release_claim.allowed, false);
  assert.equal(frozen.view?.actions.claim_cycle.allowed, false);
  assert.match(frozen.label, /immutable/);
  assert.equal(
    (await deriveTemplateAvailability(read(cycle, true), now, owner)).view,
    null,
  );
  const missing = { ...read(cycle), latestCycle: null, nextCycle: null };
  assert.match(
    (await deriveTemplateAvailability(missing, now, null)).label,
    /No materialized cycle/,
  );
  const invalid = await deriveTemplateAvailability(
    read({ ...cycle, claim: journey.contributor.cycle.claim }),
    now,
    owner,
  );
  assert.equal(invalid.view, null);
  assert.match(invalid.label, /validation failed/);
  const failure = await deriveTemplateAvailability(
    {
      kind: "ERROR",
      templateId: "4",
      code: "ERR_RPC_CONTRACT",
      message: "failed",
    },
    now,
    null,
  );
  assert.equal(failure.preference, 2);
  assert.equal(preferredTemplate([failure]), "4");
});

test("selection/hiding invalidates at every preparation await, even before unmount and on switch-back", async () => {
  for (const phase of ["prepare", "select", "convert"]) {
    for (const next of ["1", null, "switch-back"] as const) {
      const selection = new TemplateSelection();
      selection.select("2");
      const token = selection.capture("2", "alice.testnet");
      let release!: () => void;
      let reached!: () => void;
      const entered = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signs = 0;
      const pause = async (name: string) => {
        if (name === phase) {
          reached();
          await waiting;
        }
      };
      const send = guardedWalletSend(
        { receiverId: "commonsops.testnet", actions: [] },
        token,
        {
          prepare: async () => {
            await pause("prepare");
            return "bundle";
          },
          select: async () => {
            await pause("select");
            return "wallet";
          },
          convert: async (tx) => {
            await pause("convert");
            return tx;
          },
          currentSigner: () => "alice.testnet",
          sign: async () => {
            signs++;
            return [];
          },
        },
      );
      await entered;
      selection.select(next === "switch-back" ? "1" : next);
      if (next === "switch-back") selection.select("2");
      assert.equal(token.valid(), false); // no React render/effect required
      release();
      await assert.rejects(send, /ERR_STALE_SEND/);
      assert.equal(signs, 0, `${phase}/${next}`);
    }
  }
});

test("selected token remains valid on an unchanged selection; sent evidence survives hiding/disposal", () => {
  const selection = new TemplateSelection();
  const history = new TransactionEvidence();
  selection.select("2");
  const token = selection.capture("2", "alice.testnet");
  selection.select("2");
  assert.equal(token.valid(), true);
  history.set("2:0:claim", {
    status: "SUCCESS",
    method: "claim_cycle",
    transactionHash: "observed-hash",
    explorerUrl: "https://explorer.testnet.near.org/transactions/observed-hash",
  });
  selection.select(null);
  selection.dispose();
  assert.equal(token.valid(), false);
  assert.equal(history.records().length, 1);
  assert.equal(history.get("2:0:claim").status, "SUCCESS");
});
