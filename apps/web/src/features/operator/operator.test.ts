import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemplateIntent,
  CYCLE_MIN_DEPOSIT_YOCTO,
  TEMPLATE_MIN_DEPOSIT_YOCTO,
  templateActionIntent,
  toTemplateInput,
} from "./operator.ts";

const draft = {
  daoAccountId: "community.sputnikv2.testnet",
  title: "Documentation maintenance",
  description: "Update public docs",
  startAtNs: "1793740800000000000",
  intervalNs: "604800000000000",
  workWindowNs: "432000000000000",
  claimDurationNs: "86400000000000",
  amountYocto: "1000000000000000000000000",
};

test("normalizes exact integer template input", () => {
  assert.deepEqual(toTemplateInput(draft), {
    dao_account_id: "community.sputnikv2.testnet",
    title: "Documentation maintenance",
    description: "Update public docs",
    start_at_ns: "1793740800000000000",
    interval_ns: "604800000000000",
    work_window_ns: "432000000000000",
    claim_duration_ns: "86400000000000",
    amount_yocto: "1000000000000000000000000",
  });
});

test("creates disabled testnet intent without fabricating a deployment", () => {
  const intent = createTemplateIntent(null, draft, "40960000000000000000000");
  assert.equal(intent.receiverId, "");
  assert.equal(intent.signingEnabled, false);
  assert.match(intent.disabledReason, /No reviewed testnet registry/);
  assert.equal(intent.attachedDepositYocto, "40960000000000000000000");
  assert.equal(intent.network, "TESTNET");
});

test("rejects floating, overflow, overlapping and malformed values", () => {
  assert.throws(() => toTemplateInput({ ...draft, amountYocto: "1.5" }));
  assert.throws(() =>
    toTemplateInput({ ...draft, amountYocto: String(1n << 128n) }),
  );
  assert.throws(() =>
    toTemplateInput({ ...draft, intervalNs: "100", workWindowNs: "101" }),
  );
  assert.throws(() => toTemplateInput({ ...draft, daoAccountId: "Not Valid" }));
  assert.throws(() => toTemplateInput({ ...draft, title: "é".repeat(61) }));
});

test("rejects field-specific integer and time overflows", () => {
  assert.throws(() =>
    toTemplateInput({ ...draft, intervalNs: String(1n << 64n) }),
  );
  assert.throws(() =>
    toTemplateInput({
      ...draft,
      startAtNs: String((1n << 64n) - 1n),
      workWindowNs: "1",
    }),
  );
  assert.throws(() =>
    templateActionIntent(
      "registry.testnet",
      "materialize_cycle",
      String(1n << 64n),
      undefined,
      CYCLE_MIN_DEPOSIT_YOCTO.toString(),
    ),
  );
});

test("enforces storage reserve minimums and zero pause deposit", () => {
  assert.throws(() =>
    createTemplateIntent(
      null,
      draft,
      (TEMPLATE_MIN_DEPOSIT_YOCTO - 1n).toString(),
    ),
  );
  assert.doesNotThrow(() =>
    createTemplateIntent(null, draft, TEMPLATE_MIN_DEPOSIT_YOCTO.toString()),
  );
  assert.throws(() =>
    templateActionIntent(
      "registry.testnet",
      "materialize_cycle",
      "7",
      undefined,
      (CYCLE_MIN_DEPOSIT_YOCTO - 1n).toString(),
    ),
  );
  assert.throws(() =>
    templateActionIntent(
      "registry.testnet",
      "set_template_active",
      "7",
      true,
      "1",
    ),
  );
});

test("builds pause and materialize intents with exact deposits", () => {
  assert.deepEqual(
    templateActionIntent("registry.testnet", "set_template_active", "7", false),
    {
      receiverId: "registry.testnet",
      method: "set_template_active",
      args: { template_id: "7", active: false },
      attachedDepositYocto: "0",
      network: "TESTNET",
      signingEnabled: false,
      disabledReason:
        "Recorded preview — signing disabled here; use live registry above.",
    },
  );
  const materialize = templateActionIntent(
    "registry.testnet",
    "materialize_cycle",
    "7",
    undefined,
    "163840000000000000000000",
  );
  assert.equal(materialize.attachedDepositYocto, "163840000000000000000000");
  assert.equal(materialize.method, "materialize_cycle");
});
