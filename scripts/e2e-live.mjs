#!/usr/bin/env node
// P3-T06 live mode runner for the end-to-end automation on NEAR testnet.
//
// Safety model (see .commonsops/handoffs/P3-T06.md):
// - This script never embeds, reads, or transports private keys, and it never
//   signs anything itself. Signing, when explicitly requested, is performed
//   exclusively by the `near` CLI (near-cli-rs) using the operating-system
//   keychain (Windows Credential Manager, legacy near CLI entry naming), as
//   instructed subprocess calls of the exact commands printed in plan mode.
// - Default mode (no flags) is a pure plan printer: it spawns nothing, opens
//   no network connection, and only prints the planned calls with their
//   expected outcomes. It is safe to run anywhere, including CI.
// - Execute mode requires BOTH the `--execute` flag and the environment
//   confirmation `COMMONSOPS_E2E_KEY=1`. Without either, the script prints the
//   plan and exits. Testnet signing for this journey is pre-authorized by the
//   project owner; every executed transaction is reported to the handoff and
//   recorded (public data only) in tests/e2e/live-e2e-results.json.
//
// Sequence (coordinator-approved):
//  1. duplicate-claim control: claim_cycle on cycle 0:0 (SUBMITTED) must fail
//     onchain (exact panic recorded from the RPC execution outcome).
//  2. create_template (template 1): demonstration template with the same
//     economics as template 0 (same DAO, 0.5 NEAR per cycle, 7-day interval,
//     5-day work window, 2-day claim duration) but start_at_ns = now, because
//     template 0 period 1 is not due until 2026-11-12T20:23:03Z
//     (start_at_ns + 7-day interval; the contract asserts ERR_PERIOD_NOT_DUE).
//     Storage deposit 0.04096 NEAR per the recorded journey.
//  3. materialize_cycle template 1 -> cycle 1:0 OPEN (deposit 0.16384 NEAR).
//  4. claim_cycle cycle 1:0 (claimant = payout recipient commonsops.testnet).
//  5. submit_evidence cycle 1:0 with PR 17 + commit 1032733c… (evidence is
//     per-cycle; the same public PR backs the demonstration cycle).
//  6. proposal-reuse control: link_proposal cycle 1:0 + proposal 0 must fail
//     onchain with ERR_PROPOSAL_REPLAY (proposal 0 is already linked to 0:0).
//  7. Honest final state: cycle 1:0 stays SUBMITTED and unlinked; no proposal
//     link is created; balances change only by the two storage deposits and
//     burned gas.

import { spawnSync } from "node:child_process";

const RPC_URL = "https://rpc.testnet.near.org";
const REGISTRY = "commonsops.testnet";
const DAO = "commonsops-dao.sputnikv2.testnet";
const PARTICIPANT = "commonsops.testnet";
const GAS = "100 TeraGas";
const ZERO_DEPOSIT = "0 NEAR";
const TEMPLATE_DEPOSIT_YOCTO = "40960000000000000000000"; // 0.04096 NEAR
const CYCLE_DEPOSIT_YOCTO = "163840000000000000000000"; // 0.16384 NEAR
const COMMIT_SHA = "1032733c2115b9e9c038d50617f6e151ac8bd59d";
const PR_NUMBER = "17";
const EXPECTED_CLAIM_PANIC = "ERR_CYCLE_NOT_OPEN";
const EXPECTED_REPLAY_PANIC = "ERR_PROPOSAL_REPLAY";

const START_AT_PLACEHOLDER = "<final-block-timestamp-ns-at-execution>";
const AMOUNT_YOCTO = "500000000000000000000000"; // 0.5 NEAR per cycle

function jsonArgs(value) {
  return JSON.stringify(value);
}

function baseArgs() {
  return ["contract", "call-function", "as-transaction"];
}

// Builds one instructed `near` CLI subprocess call (argv array).
function callCommand(contract, method, args, deposit) {
  return [
    ...baseArgs(),
    contract,
    method,
    "json-args",
    jsonArgs(args),
    "prepaid-gas",
    GAS,
    "attached-deposit",
    deposit,
    "sign-as",
    PARTICIPANT,
    "network-config",
    "testnet",
    // The commonsops.testnet signing key lives in the OS keychain (Windows
    // Credential Manager, near-cli-rs keyring entry). The trailing `send`
    // subcommand answers the CLI's post-signature "How would you like to
    // proceed?" prompt declaratively, keeping the run non-interactive.
    "sign-with-keychain",
    "send",
  ];
}

function quote(argv) {
  return argv
    .map((part) =>
      /[\s"'{}]/.test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part,
    )
    .join(" ");
}

function planSteps(startAtNs) {
  const cycleKey0 = { template_id: "0", period_index: "0" };
  const cycleKey1 = { template_id: "1", period_index: "0" };
  return [
    {
      step: 1,
      label: "duplicate-claim control (must fail onchain)",
      method: "claim_cycle",
      args: { cycle_key: cycleKey0 },
      deposit: ZERO_DEPOSIT,
      expected: `contract panic ${EXPECTED_CLAIM_PANIC} (cycle 0:0 is SUBMITTED, not OPEN)`,
    },
    {
      step: 2,
      label: "create demonstration template 1 (same economics as template 0)",
      method: "create_template",
      args: {
        input: {
          dao_account_id: DAO,
          title: "P3-T06 e2e replay demonstration",
          description:
            "Demonstration template for the P3-T06 end-to-end replay automation: same economics as template 0.",
          start_at_ns: startAtNs,
          interval_ns: "604800000000000",
          work_window_ns: "432000000000000",
          claim_duration_ns: "172800000000000",
          amount_yocto: AMOUNT_YOCTO,
        },
      },
      deposit: `${TEMPLATE_DEPOSIT_YOCTO} yoctoNEAR`,
      expected: "template 1 created; 0.04096 NEAR storage deposit",
    },
    {
      step: 3,
      label: "materialize cycle 1:0",
      method: "materialize_cycle",
      args: { template_id: "1" },
      deposit: `${CYCLE_DEPOSIT_YOCTO} yoctoNEAR`,
      expected: "cycle 1:0 OPEN; 0.16384 NEAR storage deposit",
    },
    {
      step: 4,
      label: "claim cycle 1:0",
      method: "claim_cycle",
      args: { cycle_key: cycleKey1 },
      deposit: ZERO_DEPOSIT,
      expected:
        "cycle 1:0 CLAIMED by commonsops.testnet (claimant = payout recipient)",
    },
    {
      step: 5,
      label: "submit evidence for cycle 1:0 (PR 17 + recorded commit)",
      method: "submit_evidence",
      args: {
        cycle_key: cycleKey1,
        repository_owner: "super-user-root",
        repository_name: "commonsops",
        pull_request_number: PR_NUMBER,
        commit_sha: COMMIT_SHA,
      },
      deposit: ZERO_DEPOSIT,
      expected: "cycle 1:0 SUBMITTED; evidence and amounts immutable",
    },
    {
      step: 6,
      label: "proposal-reuse control (must fail onchain)",
      method: "link_proposal",
      args: { cycle_key: cycleKey1, proposal_id: "0" },
      deposit: ZERO_DEPOSIT,
      expected: `contract panic ${EXPECTED_REPLAY_PANIC} (proposal 0 already linked to cycle 0:0)`,
    },
  ];
}

function printPlan() {
  process.stdout.write(
    "P3-T06 live mode plan (plan mode: nothing is signed, spawned, or sent)\n\n",
  );
  for (const step of planSteps(START_AT_PLACEHOLDER)) {
    process.stdout.write(`step ${step.step}: ${step.label}\n`);
    process.stdout.write(`  method:  ${step.method}\n`);
    process.stdout.write(`  args:    ${jsonArgs(step.args)}\n`);
    process.stdout.write(`  deposit: ${step.deposit}\n`);
    process.stdout.write(`  gas:     ${GAS}\n`);
    process.stdout.write(`  expect:  ${step.expected}\n`);
    process.stdout.write(
      `  command: near ${quote(callCommand(REGISTRY, step.method, step.args, step.deposit))}\n\n`,
    );
  }
  process.stdout.write(
    [
      "Execution gate: run `node scripts/e2e-live.mjs --execute` with environment",
      "COMMONSOPS_E2E_KEY=1 to execute the sequence. Signing is performed only by",
      "the `near` CLI via the OS keychain; this script never holds or uses keys.",
      "step 2 start_at_ns is resolved from the final block timestamp at execution.",
      "",
    ].join("\n"),
  );
}

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "commonsops:e2e-live",
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC transport failed: HTTP ${response.status}`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

async function viewFunction(method, args) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: REGISTRY,
    method_name: method,
    args_base64: Buffer.from(jsonArgs(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}

async function viewAccount(accountId) {
  return rpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
}

const BASE58_TX = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;

async function confirmTransaction(txHash, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await rpc("EXPERIMENTAL_tx_status", {
      tx_hash: txHash,
      sender_account_id: PARTICIPANT,
    });
    if (status.final_execution_status === "FINAL") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`transaction ${txHash} did not reach FINAL execution`);
}

function extractTxHash(output) {
  const candidates = [...new Set(output.match(BASE58_TX) ?? [])];
  return candidates;
}

// The CLI output contains many base58 tokens (receipt ids, block hashes,
// proof hashes, keys). They are all probed concurrently against the RPC; the
// resolved transaction is the one the chain knows as a transaction.
async function resolveTxHash(candidates) {
  const probes = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const status = await confirmTransaction(candidate, 3);
        return status.transaction?.hash === candidate
          ? { txHash: candidate, status }
          : null;
      } catch {
        return null;
      }
    }),
  );
  const resolved = probes.find(Boolean);
  if (resolved) return resolved;
  // The transaction may still be propagating; retry the whole probe set once
  // with a longer window.
  for (const candidate of candidates) {
    try {
      const status = await confirmTransaction(candidate, 16);
      if (status.transaction?.hash === candidate) {
        return { txHash: candidate, status };
      }
    } catch {
      // Not a transaction hash known to the chain; try the next candidate.
    }
  }
  return { txHash: null, status: null };
}

// The FunctionCall failure lives on the ACTION receipt outcome, not on the
// transaction outcome (whose status is a SuccessReceiptId even when the call
// fails onchain).
function exactFailure(status) {
  const outcomes = status?.receipts_outcome;
  if (!Array.isArray(outcomes)) return null;
  const txStatus = status?.transaction_outcome?.outcome?.status ?? null;
  const rootReceiptId =
    typeof txStatus?.SuccessReceiptId === "string"
      ? txStatus.SuccessReceiptId
      : null;
  const failures = outcomes
    .filter((entry) => entry?.outcome?.status?.Failure)
    .map((entry) => entry.outcome.status.Failure);
  if (failures.length === 0) return null;
  if (rootReceiptId) {
    const root = outcomes.find(
      (entry) => entry?.id === rootReceiptId && entry?.outcome?.status?.Failure,
    );
    if (root) return root.outcome.status.Failure;
  }
  return failures[0] ?? null;
}

function exactPanic(status) {
  const failure = exactFailure(status);
  const executionError =
    failure?.ActionError?.FunctionCallError?.ExecutionError;
  return typeof executionError === "string" ? executionError : null;
}

const ANSI_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

function cleanOutput(text) {
  return text.replaceAll(ANSI_ESCAPE, "").trim();
}

async function executeStep(step, results) {
  process.stderr.write(
    `step ${step.step}: ${step.label}\n> near ${quote(callCommand(REGISTRY, step.method, step.args, step.deposit))}\n`,
  );
  const binary = process.platform === "win32" ? "near.exe" : "near";
  // --teach-me makes near-cli-rs dump the full signed-transaction status JSON,
  // which is the only place the transaction hash appears when the onchain
  // execution fails (0.30.1 prints no hash on failed sends otherwise).
  const run = spawnSync(
    binary,
    [
      "--teach-me",
      ...callCommand(REGISTRY, step.method, step.args, step.deposit),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      // The keychain lookup never needs stdin; ignoring it makes any unexpected
      // interactive prompt fail fast instead of hanging the run.
      stdin: "ignore",
      timeout: 120_000,
    },
  );
  const output = cleanOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  if (run.error) {
    throw new Error(`near CLI could not be executed: ${run.error.message}`);
  }
  const { txHash, status } = await resolveTxHash(extractTxHash(output));
  const record = {
    step: step.step,
    label: step.label,
    method: step.method,
    args: step.args,
    attachedDeposit: step.deposit,
    gas: GAS,
    command: `near ${quote(callCommand(REGISTRY, step.method, step.args, step.deposit))}`,
    cliExitCode: run.status,
    cliSignal: run.signal ?? null,
    txHash,
    finalExecutionStatus: status?.final_execution_status ?? null,
    outcomeStatus: status?.transaction_outcome?.outcome?.status ?? null,
    exactPanic: exactPanic(status),
    exactFailureObject: exactFailure(status),
    blockHash: status?.transaction_outcome?.block_hash ?? null,
    rawCliOutputTail: output.split("\n").slice(-40).join("\n"),
  };
  results.push(record);
  process.stderr.write(
    `  tx ${record.txHash ?? "<unresolved>"} exit=${run.status} panic=${record.exactPanic ?? "none"}\n`,
  );
  return record;
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(`preflight failed: ${message}`);
  }
}

async function preflight() {
  const block = await rpc("block", { finality: "final" });
  const startAtNs = block.header.timestamp;
  const template0 = await viewFunction("get_template", { template_id: "0" });
  const cycle0 = await viewFunction("get_cycle", {
    cycle_key: { template_id: "0", period_index: "0" },
  });
  const template1 = await viewFunction("get_template", { template_id: "1" });
  const cycle1 = await viewFunction("get_cycle", {
    cycle_key: { template_id: "1", period_index: "0" },
  });
  assertCondition(
    cycle0?.status === "SUBMITTED",
    "cycle 0:0 must be SUBMITTED before the duplicate-claim control",
  );
  assertCondition(
    cycle0?.proposal_link?.key?.proposal_id === "0",
    "proposal 0 must already be linked to cycle 0:0",
  );
  assertCondition(template0?.active === true, "template 0 must be active");
  assertCondition(
    template0?.next_period_index === "1",
    "template 0 next_period_index must be 1",
  );
  if (template1 !== null) {
    // Resumable run: a previously created demonstration template must match
    // the planned economics before later steps are allowed to continue.
    assertCondition(
      template1?.input?.dao_account_id === DAO &&
        template1?.input?.amount_yocto === AMOUNT_YOCTO &&
        template1?.active === true,
      "existing template 1 does not match the planned demonstration economics",
    );
  }
  return {
    startAtNs,
    template1Exists: template1 !== null,
    cycle1Status: cycle1?.status ?? null,
    balancesBefore: await snapshotBalances(),
  };
}

async function snapshotBalances() {
  const registry = await viewAccount(PARTICIPANT);
  const dao = await viewAccount(DAO);
  return {
    [PARTICIPANT]: {
      amountYocto: registry.amount,
      lockedYocto: registry.locked,
    },
    [DAO]: { amountYocto: dao.amount, lockedYocto: dao.locked },
  };
}

async function run() {
  const execute = process.argv.includes("--execute");
  const gate = process.env.COMMONSOPS_E2E_KEY === "1";
  if (!execute || !gate) {
    printPlan();
    if (execute && !gate) {
      process.stderr.write(
        "\n--execute was passed but COMMONSOPS_E2E_KEY=1 is not set; plan mode only.\n",
      );
    }
    return;
  }

  const pre = await preflight();
  process.stderr.write(
    `preflight ok: start_at_ns=${pre.startAtNs} block-time; cycle 0:0 SUBMITTED; proposal 0 linked; template1Exists=${pre.template1Exists}; cycle1Status=${pre.cycle1Status ?? "absent"}\n`,
  );

  // Resumable sequence: state is re-read before every step, so steps whose
  // onchain effect is already present are skipped and a rerun continues from
  // the first missing state change.
  const currentCycle1Status = async () => {
    const cycle = await viewFunction("get_cycle", {
      cycle_key: { template_id: "1", period_index: "0" },
    });
    return cycle?.status ?? null;
  };

  const results = [];
  for (const step of planSteps(String(pre.startAtNs))) {
    if (step.step === 2 && pre.template1Exists) {
      process.stderr.write("step 2 skipped: template 1 already exists\n");
      continue;
    }
    if (step.step === 3 && (await currentCycle1Status()) !== null) {
      process.stderr.write("step 3 skipped: cycle 1:0 already materialized\n");
      continue;
    }
    if (step.step === 4 && (await currentCycle1Status()) !== "OPEN") {
      process.stderr.write(
        "step 4 skipped: cycle 1:0 is not OPEN (already claimed or beyond)\n",
      );
      continue;
    }
    if (step.step === 5 && (await currentCycle1Status()) !== "CLAIMED") {
      process.stderr.write(
        "step 5 skipped: cycle 1:0 is not CLAIMED (already submitted or missing)\n",
      );
      continue;
    }
    results.push(await executeStep(step, results));
  }
  const stepResult = (stepNumber) =>
    results.find((record) => record.step === stepNumber) ?? null;

  const cycle1 = await viewFunction("get_cycle", {
    cycle_key: { template_id: "1", period_index: "0" },
  });
  const proposalCycle = await viewFunction("get_proposal_cycle", {
    proposal_key: { network: "TESTNET", dao_account_id: DAO, proposal_id: "0" },
  });
  const balancesAfter = await snapshotBalances();

  const summary = {
    schemaVersion: 1,
    task: "P3-T06",
    mode: "live",
    network: "testnet",
    rpcEndpoint: RPC_URL,
    registry: REGISTRY,
    dao: DAO,
    balancesBefore: pre.balancesBefore,
    transactions: results,
    controls: {
      duplicateClaim: {
        attemptedMethod: "claim_cycle",
        cycle: { template_id: "0", period_index: "0" },
        abiExpectedPanic: EXPECTED_CLAIM_PANIC,
        observedPanic: stepResult(1)?.exactPanic ?? null,
        rejectedOnchain: exactFailure(stepResult(1)) !== null,
        txHash: stepResult(1)?.txHash ?? null,
      },
      proposalReuse: {
        attemptedMethod: "link_proposal",
        cycle: { template_id: "1", period_index: "0" },
        proposalId: "0",
        abiExpectedPanic: EXPECTED_REPLAY_PANIC,
        observedPanic: stepResult(6)?.exactPanic ?? null,
        rejectedOnchain: exactFailure(stepResult(6)) !== null,
        txHash: stepResult(6)?.txHash ?? null,
      },
    },
    finalState: {
      cycle_1_0: cycle1,
      proposal_0_linked_cycle: proposalCycle,
      balancesAfter,
    },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  const duplicateClaimOk = summary.controls.duplicateClaim.rejectedOnchain;
  const replayOk = summary.controls.proposalReuse.rejectedOnchain;
  const sequenceComplete =
    cycle1?.status === "SUBMITTED" && cycle1?.proposal_link === null;
  if (!duplicateClaimOk || !replayOk || !sequenceComplete) {
    process.stderr.write(
      "\nWARNING: one or more live controls did not produce the expected onchain result; inspect the summary above.\n",
    );
    process.exitCode = 1;
  }
}

await run();
