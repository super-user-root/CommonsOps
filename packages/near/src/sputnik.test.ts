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
  assert.match(result.reason, /action receipt failed/);
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

test("native payout requires SuccessValue and malformed graph stays unknown", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const payoutId = "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ";
  const changedStatus = structuredClone(paid);
  changedStatus.result.receipts_outcome.find(
    (entry: { id: string }) => entry.id === payoutId,
  ).outcome.status = { SuccessReceiptId: "child" };
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, changedStatus).state,
    "UNKNOWN",
  );

  const missingOutcome = structuredClone(paid);
  missingOutcome.result.receipts_outcome =
    missingOutcome.result.receipts_outcome.filter(
      (entry: { id: string }) => entry.id !== payoutId,
    );
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, missingOutcome).state,
    "UNKNOWN",
  );

  const nullPrefix = structuredClone(paid);
  nullPrefix.result.receipts.unshift(null);
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, nullPrefix).state,
    "UNKNOWN",
  );
});

test("root action receipt is independently bound to act_proposal", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const changedReceiver = structuredClone(paid);
  changedReceiver.result.receipts[0].receiver_id = "other.sputnikv2.testnet";
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, changedReceiver).state,
    "INVALID",
  );

  const missingAction = structuredClone(paid);
  missingAction.result.receipts[0].receipt.Action.actions = [];
  assert.equal(
    verifyNativeSputnikPayment(expected, proposal, missingAction).state,
    "INVALID",
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

// Real testnet capture of commonsops-dao.sputnikv2.testnet proposal 0
// (Sputnik 2.3.1, code hash pinned in pinnedSputnikProfiles): the payout
// Transfer is a direct child of the act receipt and a sibling
// on_proposal_callback FunctionCall receipt exists but does not gate PAID.
const expected231: ExpectedNativePayment = {
  network: "testnet",
  daoAccountId: "commonsops-dao.sputnikv2.testnet",
  proposalId: "0",
  recipientId: "commonsops.testnet",
  amountYocto: "500000000000000000000000",
  version: "2.3.1",
  codeHash: "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH",
};

const proposal231 = {
  id: 0,
  status: "Approved",
  kind: {
    Transfer: {
      token_id: "",
      receiver_id: "commonsops.testnet",
      amount: "500000000000000000000000",
      msg: null,
    },
  },
};

test("verifies the real 2.3.1 proposal 0 native NEAR payout", async () => {
  const result = verifyNativeSputnikPayment(
    expected231,
    proposal231,
    await fixture("dao-proposal-0-231-paid.json"),
  );
  assert.deepEqual(result, {
    state: "PAID",
    reason: "Verified one successful causal native NEAR payout",
    transactionHash: "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7",
    actionReceiptId: "kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro",
    payoutReceiptId: "EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2",
    evidenceKey:
      "testnet:commonsops-dao.sputnikv2.testnet:0:kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro:EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2",
    blockHash: "5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6",
  });
});

test("2.3.1 payout rejects wrong proposal, amount and recipient", async () => {
  const paid = await fixture("dao-proposal-0-231-paid.json");
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected231, proposalId: "1" },
      proposal231,
      paid,
    ).state,
    "INVALID",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      {
        ...expected231,
        amountYocto: "200864306250000000000",
      },
      proposal231,
      paid,
    ).state,
    "INVALID",
    "a sibling zero-deposit transfer is also causal and DAO-signed, so proposal-kind matching is required by the caller before adapter verification",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected231, recipientId: "other.testnet" },
      proposal231,
      paid,
    ).state,
    "INVALID",
  );
});

test("2.3.1 unsupported profile and codeHash mismatches stay unknown", async () => {
  const paid = await fixture("dao-proposal-0-231-paid.json");
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected231, codeHash: "unsupported" },
      proposal231,
      paid,
    ).state,
    "UNKNOWN",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected231, version: "2.0.0" },
      proposal231,
      paid,
    ).state,
    "UNKNOWN",
  );
  assert.equal(
    verifyNativeSputnikPayment(
      { ...expected231, version: "3.0.0" },
      proposal231,
      paid,
    ).state,
    "UNKNOWN",
    "the 3.0.0 placeholder pins a null code hash and never verifies",
  );
});

test("2.3.1 sibling on_proposal_callback outcome does not gate PAID", async () => {
  const paid = await fixture("dao-proposal-0-231-paid.json");
  const callbackId = "H7Uu9meqBeux4eeNa3DhcWBnEYzVCdTy5Jmu7iT4pugD";
  const failedCallback = structuredClone(paid);
  failedCallback.result.receipts_outcome.find(
    (entry: { id: string }) => entry.id === callbackId,
  ).outcome.status = { Failure: { error_message: "callback failed" } };
  const result = verifyNativeSputnikPayment(
    expected231,
    proposal231,
    failedCallback,
  );
  assert.equal(result.state, "PAID");
  assert.equal(
    result.payoutReceiptId,
    "EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2",
    "a failed sibling callback is not yet modeled as FAILED; the payout child alone derives PAID for the pinned 2.3.1 graph",
  );
});
