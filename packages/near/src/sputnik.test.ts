import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  verifyNativeSputnikPayment,
  type ExpectedNativePayment,
} from "./index.ts";

const fixtures = path.resolve(
  import.meta.dirname,
  "../../../tests/fixtures/sputnik",
);
const expected: ExpectedNativePayment = {
  network: "testnet",
  daoAccountId: "marmaj.sputnikv2.testnet",
  proposalId: "63",
  recipientId: "chloe.testnet",
  amountYocto: "81900000000000000000000000",
  version: "2.0.0",
  codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq",
};

const proposal = {
  id: 63,
  status: "Approved",
  kind: {
    Transfer: {
      token_id: "",
      receiver_id: "chloe.testnet",
      amount: "81900000000000000000000000",
      msg: null,
    },
  },
};

async function fixture(name: string) {
  return JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
}

test("verifies the pinned proposal 63 native NEAR payout", async () => {
  const result = verifyNativeSputnikPayment(
    expected,
    proposal,
    await fixture("proposal-63-paid.json"),
  );
  assert.deepEqual(result, {
    state: "PAID",
    reason: "Verified one successful causal native NEAR payout",
    transactionHash: "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm",
    actionReceiptId: "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
    payoutReceiptId: "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
    evidenceKey:
      "testnet:marmaj.sputnikv2.testnet:63:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
    blockHash: "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy",
  });
});

test("returns failed for final vote whose proposal receipt failed", async () => {
  const failedProposal = {
    id: 62,
    status: "InProgress",
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: "chloe.testnet",
        amount: "378000000000000000000000000",
        msg: null,
      },
    },
  };
  const result = verifyNativeSputnikPayment(
    {
      ...expected,
      proposalId: "62",
      amountYocto: "378000000000000000000000000",
    },
    failedProposal,
    await fixture("proposal-62-failed.json"),
  );
  assert.equal(result.state, "FAILED");
  assert.match(result.reason, /action receipt did not succeed/);
  assert.equal(result.payoutReceiptId, null);
});

test("rejects wrong proposal, amount, recipient and unsupported profile", async () => {
  const paid = await fixture("proposal-63-paid.json");
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected, proposalId: "54" },
      proposal,
      paid,
    ).state,
    "INVALID",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected, amountYocto: "19000000000000000000000" },
      proposal,
      paid,
    ).state,
    "INVALID",
    "bond refund is also causal/DAO-signed, so proposal-kind matching is required by the caller before adapter verification",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected, recipientId: "other.testnet" },
      proposal,
      paid,
    ).state,
    "INVALID",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected, codeHash: "unsupported" },
      proposal,
      paid,
    ).state,
    "UNKNOWN",
  );
});

test("fails closed for incomplete and ambiguous receipt graphs", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const incomplete = structuredClone(paid);
  delete incomplete.result.receipts_outcome;
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, incomplete).state,
    "UNKNOWN",
  );

  const ambiguous = structuredClone(paid);
  const payout = ambiguous.result.receipts.find(
    (receipt: { receipt_id: string }) =>
      receipt.receipt_id === "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  );
  const outcome = ambiguous.result.receipts_outcome.find(
    (entry: { id: string }) => entry.id === payout?.receipt_id,
  );
  const rootOutcome = ambiguous.result.receipts_outcome[0];
  assert(payout && outcome && rootOutcome);
  const duplicateId = "9".repeat(44);
  ambiguous.result.receipts.push({
    ...structuredClone(payout),
    receipt_id: duplicateId,
  });
  ambiguous.result.receipts_outcome.push({
    ...structuredClone(outcome),
    id: duplicateId,
  });
  rootOutcome.outcome.receipt_ids.push(duplicateId);
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, ambiguous).state,
    "AMBIGUOUS",
  );
});
