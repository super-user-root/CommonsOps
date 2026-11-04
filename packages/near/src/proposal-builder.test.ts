import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeSputnikTransferProposal,
  buildNativeTransferProposalPreview,
  buildUnsignedAddProposalRequest,
  isValidatedSputnikPolicySnapshot,
  parseSputnikPolicyFixture,
  prepareUnsignedAddProposalRequest,
  querySputnikPolicy,
  SPUTNIK_POLICY_RPC_ID,
  type SputnikPolicyRpcRequest,
} from "./index.ts";

const U64_MAX = "18446744073709551615";
const U128_MAX = "340282366920938463463374607431768211455";
const dao = "marmaj.sputnikv2.testnet";
const recipient = "chloe.testnet";
const amount = "81900000000000000000000000";
const bond = "19000000000000000000000";
const blockHash = "BL6QvZoH6WCmbAuAaiQUyhafeSmAsMar5NZxquHzyxvD";
const profile = {
  version: "2.0.0",
  codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq",
} as const;
const cycle = {
  templateId: "7",
  periodIndex: "3",
  evidenceUrl: "https://github.com/example/docs/pull/42",
  commitSha: "ab".repeat(20),
} as const;
const expectedDescription = `CommonsOps cycle 7:3; evidence ${cycle.evidenceUrl}; commit ${cycle.commitSha}`;

function bytes(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

function rpcResult(
  proposalBond: unknown = bond,
  overrides: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0",
    id: SPUTNIK_POLICY_RPC_ID,
    result: {
      block_hash: blockHash,
      block_height: 94_689_099,
      logs: [],
      result: bytes({ proposal_bond: proposalBond, roles: [] }),
      ...overrides,
    },
  };
}

function fixturePolicy(
  overrides: Partial<Parameters<typeof parseSputnikPolicyFixture>[0]> = {},
) {
  return parseSputnikPolicyFixture({
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    proposalBondYocto: bond,
    blockHash,
    blockHeight: "94689099",
    provenanceLabel:
      "P0-T01 get_policy fixture at final block 94689099; no live read",
    ...overrides,
  });
}

function proposal() {
  return buildNativeSputnikTransferProposal({
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: amount,
    cycle,
  });
}

function requestInput(
  overrides: Partial<
    Parameters<typeof prepareUnsignedAddProposalRequest>[0]
  > = {},
): Parameters<typeof prepareUnsignedAddProposalRequest>[0] {
  return {
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    policy: fixturePolicy(),
    proposal: proposal(),
    gas: "100000000000000",
    ...overrides,
  };
}

test("issues exactly one final get_policy call_function request with canonical empty args", async () => {
  const requests: SputnikPolicyRpcRequest[] = [];
  const snapshot = await querySputnikPolicy({
    daoAccountId: dao,
    profile,
    transport: async (request) => {
      requests.push(structuredClone(request));
      return rpcResult();
    },
  });

  assert.deepEqual(requests, [
    {
      jsonrpc: "2.0",
      id: "commonsops:get_policy",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: dao,
        method_name: "get_policy",
        args_base64: "e30=",
      },
    },
  ]);
  assert.equal(isValidatedSputnikPolicySnapshot(snapshot), true);
  assert.equal(snapshot.proposal_bond, bond);
  assert.deepEqual(snapshot.block, {
    finality: "final",
    hash: blockHash,
    height: "94689099",
  });
  assert.deepEqual(snapshot.profile, profile);
  assert.deepEqual(snapshot.source, {
    kind: "RPC",
    requestId: "commonsops:get_policy",
    label: "Injected TESTNET RPC get_policy response",
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.block), true);
});

test("decodes canonical base64 policy bytes without Buffer or an automatic network call", async () => {
  const encoded = btoa(JSON.stringify({ proposal_bond: U128_MAX }));
  let calls = 0;
  const snapshot = await querySputnikPolicy({
    daoAccountId: dao,
    profile,
    transport: async () => {
      calls += 1;
      return rpcResult(undefined, { result: encoded });
    },
  });
  assert.equal(calls, 1);
  assert.equal(snapshot.proposal_bond, U128_MAX);
});

test("fails closed on JSON-RPC error and malformed response envelopes", async () => {
  const invalidResponses: readonly unknown[] = [
    null,
    {},
    { jsonrpc: "1.0", id: SPUTNIK_POLICY_RPC_ID, result: {} },
    { jsonrpc: "2.0", id: "wrong", result: {} },
    {
      jsonrpc: "2.0",
      id: SPUTNIK_POLICY_RPC_ID,
      result: {},
      error: { code: -1, message: "both" },
    },
    { jsonrpc: "2.0", id: SPUTNIK_POLICY_RPC_ID },
    { jsonrpc: "2.0", id: SPUTNIK_POLICY_RPC_ID, result: null },
    { jsonrpc: "2.0", id: SPUTNIK_POLICY_RPC_ID, error: {} },
  ];
  for (const response of invalidResponses) {
    await assert.rejects(
      querySputnikPolicy({
        daoAccountId: dao,
        profile,
        transport: async () => response,
      }),
      /RPC/,
    );
  }
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () => ({
        jsonrpc: "2.0",
        id: SPUTNIK_POLICY_RPC_ID,
        error: { code: -32_000, message: "contract failure" },
      }),
    }),
    /get_policy error -32000: contract failure/,
  );
});

test("rejects malformed bytes, UTF-8, JSON, policy, logs and block provenance", async () => {
  const malformedResults: readonly Record<string, unknown>[] = [
    { result: [] },
    { result: [256] },
    { result: [1.5] },
    { result: [0xc3, 0x28] },
    { result: bytes("not json") },
    { result: bytes(null) },
    { result: bytes({ roles: [] }) },
    { result: "eA===" },
    { result: "AB==" },
    { result: bytes({ proposal_bond: bond }), logs: null },
    { result: bytes({ proposal_bond: bond }), logs: [7] },
    { result: bytes({ proposal_bond: bond }), block_hash: "not-base58" },
    { result: bytes({ proposal_bond: bond }), block_height: -1 },
    { result: bytes({ proposal_bond: bond }), block_height: 2 ** 53 },
  ];
  for (const overrides of malformedResults) {
    await assert.rejects(
      querySputnikPolicy({
        daoAccountId: dao,
        profile,
        transport: async () => rpcResult(undefined, overrides),
      }),
    );
  }
});

test("accepts zero, positive and U128 max bonds and rejects noncanonical or overflow values", async () => {
  for (const value of ["0", "1", U128_MAX]) {
    const snapshot = await querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () => rpcResult(value),
    });
    assert.equal(snapshot.proposal_bond, value);
  }
  for (const invalid of [
    null,
    1,
    "",
    "00",
    "01",
    "-1",
    "1.5",
    `${U128_MAX}0`,
  ]) {
    await assert.rejects(
      querySputnikPolicy({
        daoAccountId: dao,
        profile,
        transport: async () => rpcResult(invalid),
      }),
      /proposal_bond/,
    );
  }
});

test("rejects invalid DAO input before transport but retains exact unsupported profile context", async () => {
  let calls = 0;
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: "INVALID",
      profile,
      transport: async () => {
        calls += 1;
        return rpcResult();
      },
    }),
    /valid NEAR account/,
  );
  assert.equal(calls, 0);

  const unsupported = { version: "9.9.9", codeHash: "unsupported-hash" };
  const snapshot = await querySputnikPolicy({
    daoAccountId: dao,
    profile: unsupported,
    transport: async () => rpcResult(),
  });
  assert.deepEqual(snapshot.profile, unsupported);
});

test("fixture parser labels exact current-block provenance and rejects malformed fixtures", () => {
  const snapshot = fixturePolicy();
  assert.equal(snapshot.source.kind, "FIXTURE");
  assert.match(snapshot.source.label, /no live read/);
  assert.equal(snapshot.block.height, "94689099");
  assert.equal(isValidatedSputnikPolicySnapshot(snapshot), true);

  for (const invalid of [
    { network: "MAINNET" },
    { daoAccountId: "INVALID" },
    { proposalBondYocto: "01" },
    { blockHash: "bad" },
    { blockHeight: "01" },
    { blockHeight: `${U64_MAX}0` },
    { provenanceLabel: "" },
  ]) {
    assert.throws(() => fixturePolicy(invalid as never), /policy fixture/);
  }
});

test("builds the exact immutable native Transfer proposal", () => {
  const built = proposal();
  assert.deepEqual(built, {
    description: expectedDescription,
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: recipient,
        amount,
        msg: null,
      },
    },
  });
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.kind.Transfer), true);
});

test("validates claimant binding, native amount, accounts, reference and pinned profile", () => {
  const base = {
    network: "TESTNET" as const,
    daoAccountId: dao,
    profile,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: amount,
    cycle,
  };
  const invalid: readonly Record<string, unknown>[] = [
    { network: "MAINNET" },
    { daoAccountId: "INVALID" },
    { claimantId: "mallory.testnet" },
    { recipientId: "INVALID" },
    { amountYocto: "0" },
    { amountYocto: "01" },
    { amountYocto: `${U128_MAX}0` },
    { cycle: { ...cycle, templateId: "01" } },
    { cycle: { ...cycle, evidenceUrl: "https://evil.example/x" } },
    { cycle: { ...cycle, commitSha: "AB".repeat(20) } },
    { profile: { ...profile, codeHash: "unsupported" } },
    { profile: { ...profile, version: "3.0.0" } },
  ];
  for (const override of invalid) {
    assert.throws(() =>
      buildNativeSputnikTransferProposal({ ...base, ...override } as never),
    );
  }

  const previewBase = {
    network: "TESTNET" as const,
    daoAccountId: dao,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: amount,
    cycle,
  };
  assert.deepEqual(buildNativeTransferProposalPreview(previewBase), {
    description: expectedDescription,
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: recipient,
        amount,
        msg: null,
      },
    },
  });
});

test("rejects description injection and bounds maximum canonical UTF-8 description", () => {
  assert.throws(
    () =>
      buildNativeTransferProposalPreview({
        network: "TESTNET",
        daoAccountId: dao,
        claimantId: recipient,
        recipientId: recipient,
        amountYocto: amount,
        cycle: {
          ...cycle,
          evidenceUrl: "https://github.com/example/docs/pull/42<svg>",
        },
      }),
    /evidenceUrl|plain text/,
  );
  const longestNames = "a".repeat(100);
  const maximum = buildNativeTransferProposalPreview({
    network: "TESTNET",
    daoAccountId: dao,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: amount,
    cycle: {
      ...cycle,
      templateId: U64_MAX,
      periodIndex: U64_MAX,
      evidenceUrl: `https://github.com/${longestNames}/${longestNames}/pull/${U64_MAX}`,
    },
  });
  assert(new TextEncoder().encode(maximum.description).length <= 512);
});

test("builds an exact unsigned add_proposal request with exact bond and reviewed gas", () => {
  const policy = fixturePolicy();
  const builtProposal = proposal();
  const request = buildUnsignedAddProposalRequest({
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    policy,
    proposal: builtProposal,
    gas: "100000000000000",
  });
  assert.deepEqual(request, {
    receiverId: dao,
    method: "add_proposal",
    args: { proposal: builtProposal },
    attachedDepositYocto: bond,
    gas: "100000000000000",
    gasParameter: {
      status: "REVIEWED_PARAMETER",
      value: "100000000000000",
      basis: "CALLER_REVIEWED_REQUEST_PARAMETER_NOT_MEASURED",
      notice:
        "Gas is a caller-reviewed request parameter, not a measured add_proposal requirement or spending allowance.",
    },
    network: "TESTNET",
    signingEnabled: false,
    executable: false,
    authorization: {
      required: "WALLET_OR_FULL_ACCESS_KEY",
      functionCallKeyAccepted: false,
      functionCallKeyCanAttachNear: false,
      allowanceControlsAssetSpending: false,
      notice:
        "Wallet/full-access authorization is required. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. A zero current bond is valid, but this audited descriptor still does not authorize a function-call-key flow.",
    },
    policySnapshot: policy,
    disabledReason:
      "Policy provenance is fixture-only (P0-T01 get_policy fixture at final block 94689099; no live read); no live policy query is claimed. Wallet/full-access authorization is required. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. A zero current bond is valid, but this audited descriptor still does not authorize a function-call-key flow. This descriptor is unsigned and non-executable; it has no key, nonce, transaction block hash, signature, callback, transaction hash, or send method.",
  });
  assert.strictEqual(request.args.proposal, builtProposal);
  assert.strictEqual(request.policySnapshot, policy);
  for (const forbidden of [
    "key",
    "publicKey",
    "secretKey",
    "nonce",
    "blockHash",
    "signature",
    "transactionHash",
    "callbackUrl",
    "send",
    "sign",
  ]) {
    assert.equal(forbidden in request, false, forbidden);
  }
});

test("preserves zero, positive and U128 max bond without override, padding or conversion", () => {
  for (const value of ["0", "1", U128_MAX]) {
    const request = buildUnsignedAddProposalRequest(
      requestInput({
        policy: fixturePolicy({ proposalBondYocto: value }),
      }) as Parameters<typeof buildUnsignedAddProposalRequest>[0],
    );
    assert.equal(request.attachedDepositYocto, value);
    assert.equal(typeof request.attachedDepositYocto, "string");
  }
});

test("requires canonical positive U64 reviewed gas and never invents a default", () => {
  const preview = prepareUnsignedAddProposalRequest(
    requestInput({ gas: null }),
  );
  assert.equal(preview.gas, null);
  assert.equal(preview.gasParameter.status, "REQUIRED");
  assert.match(
    preview.disabledReason,
    /gas request parameter is still required/,
  );
  assert.equal(preview.executable, false);

  for (const invalid of ["", "0", "00", "01", "-1", "1.5", `${U64_MAX}0`]) {
    assert.throws(
      () => prepareUnsignedAddProposalRequest(requestInput({ gas: invalid })),
      /request.gas/,
    );
  }
  const maximum = buildUnsignedAddProposalRequest(
    requestInput({ gas: U64_MAX }) as Parameters<
      typeof buildUnsignedAddProposalRequest
    >[0],
  );
  assert.equal(maximum.gas, U64_MAX);
});

test("rejects foreign DAO, network, profile, unvalidated policy and unvalidated proposal", () => {
  const valid = requestInput();
  assert.throws(
    () =>
      prepareUnsignedAddProposalRequest({
        ...valid,
        daoAccountId: "other.sputnikv2.testnet",
      }),
    /must match/,
  );
  assert.throws(
    () =>
      prepareUnsignedAddProposalRequest({
        ...valid,
        network: "MAINNET" as "TESTNET",
      }),
    /TESTNET/,
  );
  assert.throws(
    () =>
      prepareUnsignedAddProposalRequest({
        ...valid,
        profile: { ...profile, codeHash: "unsupported" },
      }),
    /must match/,
  );
  assert.throws(
    () =>
      prepareUnsignedAddProposalRequest({
        ...valid,
        policy: structuredClone(valid.policy),
      }),
    /validated policy snapshot/,
  );
  assert.throws(
    () =>
      prepareUnsignedAddProposalRequest({
        ...valid,
        proposal: structuredClone(valid.proposal),
      }),
    /validated proposal/,
  );
});

test("snapshots policy/proposal before caller mutation and retains final block provenance", async () => {
  const response = rpcResult();
  const profileInput = { ...profile };
  const snapshot = await querySputnikPolicy({
    daoAccountId: dao,
    profile: profileInput,
    transport: async () => response,
  });
  Object.assign(profileInput, { version: "9.9.9", codeHash: "mutated" });
  Object.assign(response.result, {
    block_hash: "mutated",
    result: bytes({ proposal_bond: "0" }),
  });
  assert.deepEqual(snapshot.profile, profile);
  assert.equal(snapshot.proposal_bond, bond);
  assert.equal(snapshot.block.hash, blockHash);

  const builtProposal = proposal();
  const request = buildUnsignedAddProposalRequest({
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    policy: snapshot,
    proposal: builtProposal,
    gas: "1",
  });
  assert.equal(request.attachedDepositYocto, bond);
  assert.equal(request.policySnapshot.block.height, "94689099");
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.args), true);
});
