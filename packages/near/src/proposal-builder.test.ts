import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeSputnikTransferProposal,
  buildNativeTransferProposalPreview,
  buildUnavailableAddProposalPreview,
  buildUnsignedAddProposalRequest,
  isValidatedSputnikPolicySnapshot,
  parseSputnikPolicyFixture,
  parseSputnikPolicyFixtureWithoutBlock,
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

function withOwnProto<T extends object>(
  value: T,
  protoValue: unknown,
): T & { readonly __proto__: unknown } {
  Object.defineProperty(value, "__proto__", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: protoValue,
  });
  return value as T & { readonly __proto__: unknown };
}

async function expectPolicyQueryRejected(response: unknown): Promise<void> {
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () => response,
    }),
    /unexpected or missing fields/,
  );
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
    availability: "AVAILABLE",
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
      bondCapability: "POSITIVE_BOND_REQUIRES_ATTACHED_NEAR",
      required: "WALLET_OR_FULL_ACCESS_KEY",
      commonsOpsFlow: "WALLET_ONLY",
      functionCallKeyProtocolCompatible: false,
      functionCallKeyIntegrationSupported: false,
      functionCallKeyCanAttachNear: false,
      allowanceControlsAssetSpending: false,
      notice:
        "Wallet/full-access authorization is required because this positive policy bond attaches NEAR. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. CommonsOps does not implement or authorize a function-call-key flow.",
    },
    policySnapshot: policy,
    disabledReason:
      "Policy provenance is fixture-only (P0-T01 get_policy fixture at final block 94689099; no live read); no live policy query is claimed. Wallet/full-access authorization is required because this positive policy bond attaches NEAR. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. CommonsOps does not implement or authorize a function-call-key flow. This descriptor is unsigned and non-executable; it has no key, nonce, transaction block hash, signature, callback, transaction hash, or send method.",
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

test("rejects accessor, inherited and proxy boundaries before repeated reads", async () => {
  let transportReads = 0;
  const accessorInput = Object.defineProperties(
    {},
    {
      transport: {
        enumerable: true,
        get() {
          transportReads += 1;
          return async () => rpcResult();
        },
      },
      daoAccountId: { enumerable: true, value: dao },
      profile: { enumerable: true, value: profile },
    },
  );
  await assert.rejects(
    querySputnikPolicy(accessorInput as never),
    /data property/,
  );
  assert.equal(transportReads, 0);

  const inherited = Object.create({ daoAccountId: dao });
  Object.assign(inherited, { transport: async () => rpcResult(), profile });
  await assert.rejects(querySputnikPolicy(inherited), /plain object|fields/);

  const proxiedProfile = new Proxy({ ...profile }, {});
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile: proxiedProfile,
      transport: async () => rpcResult(),
    }),
    /proxies|cloneable/,
  );

  const validPolicy = fixturePolicy();
  const validProposal = proposal();
  let policyReads = 0;
  let proposalReads = 0;
  const request = Object.defineProperties(
    {},
    {
      network: { enumerable: true, value: "TESTNET" },
      daoAccountId: { enumerable: true, value: dao },
      profile: { enumerable: true, value: profile },
      policy: {
        enumerable: true,
        get() {
          policyReads += 1;
          return validPolicy;
        },
      },
      proposal: {
        enumerable: true,
        get() {
          proposalReads += 1;
          return validProposal;
        },
      },
      gas: { enumerable: true, value: "1" },
    },
  );
  assert.throws(
    () => prepareUnsignedAddProposalRequest(request as never),
    /data property/,
  );
  assert.equal(policyReads, 0);
  assert.equal(proposalReads, 0);
});

test("captures exact branded references once and resists post-invocation mutation", async () => {
  const policy = fixturePolicy();
  const builtProposal = proposal();
  const profileInput = { ...profile };
  const requestInputValue = {
    network: "TESTNET" as const,
    daoAccountId: dao,
    profile: profileInput,
    policy,
    proposal: builtProposal,
    gas: "1",
  };
  const built = prepareUnsignedAddProposalRequest(requestInputValue);
  Object.assign(profileInput, { version: "mutated", codeHash: "mutated" });
  Object.assign(requestInputValue, {
    policy: structuredClone(policy),
    proposal: structuredClone(builtProposal),
  });
  assert.strictEqual(built.policySnapshot, policy);
  assert.strictEqual(built.args.proposal, builtProposal);
  assert.equal(built.attachedDepositYocto, bond);
  assert.equal(built.args.proposal.kind.Transfer.receiver_id, recipient);
});

test("accepts only canonical base58 CryptoHashes decoding to exactly 32 bytes", () => {
  const zeroHash = "1".repeat(32);
  const snapshot = fixturePolicy({ blockHash: zeroHash });
  assert.equal(snapshot.block.hash, zeroHash);
  for (const invalid of [
    "1".repeat(31),
    "1".repeat(33),
    "1".repeat(44),
    "z".repeat(44),
    `1${blockHash}`,
    "0".repeat(32),
  ]) {
    assert.throws(
      () => fixturePolicy({ blockHash: invalid }),
      /32 bytes|base58/,
    );
  }
});

test("represents missing fixture block provenance explicitly and deeply freezes it", () => {
  const snapshot = parseSputnikPolicyFixtureWithoutBlock({
    network: "TESTNET",
    daoAccountId: dao,
    profile,
    proposalBondYocto: bond,
    provenanceLabel: "legacy fixture without a recorded block",
  });
  assert.deepEqual(snapshot.block, {
    availability: "UNAVAILABLE",
    finality: null,
    hash: null,
    height: null,
  });
  assert.equal(snapshot.source.kind, "FIXTURE_UNAVAILABLE_PROVENANCE");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.profile), true);
  assert.equal(Object.isFrozen(snapshot.block), true);
  assert.equal(Object.isFrozen(snapshot.source), true);
});

test("strict RPC parsing rejects inherited, accessor, extra and ambiguous data", async () => {
  const inherited = Object.create({
    jsonrpc: "2.0",
    id: SPUTNIK_POLICY_RPC_ID,
  });
  inherited.result = rpcResult().result;
  const accessor = Object.defineProperties(
    {},
    {
      jsonrpc: { enumerable: true, value: "2.0" },
      id: { enumerable: true, value: SPUTNIK_POLICY_RPC_ID },
      result: { enumerable: true, get: () => rpcResult().result },
    },
  );
  const extra = { ...rpcResult(), extra: true };
  for (const response of [inherited, accessor, extra]) {
    await assert.rejects(
      querySputnikPolicy({
        daoAccountId: dao,
        profile,
        transport: async () => response,
      }),
      /plain object|data property|fields|cloneable/,
    );
  }
  const duplicate = new TextEncoder().encode(
    '{"proposal_bond":"1","proposal_bond":"2"}',
  );
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () =>
        rpcResult(undefined, { result: Array.from(duplicate) }),
    }),
    /duplicate JSON member/,
  );
});

test("rejects own __proto__ keys at every exact RPC object boundary", async () => {
  const protoValues = [null, "primitive", { nested: true }];
  for (const protoValue of protoValues) {
    const envelope = withOwnProto(rpcResult(), protoValue);
    await expectPolicyQueryRejected(envelope);

    const result = withOwnProto(
      structuredClone(rpcResult().result),
      protoValue,
    );
    await expectPolicyQueryRejected({
      jsonrpc: "2.0",
      id: SPUTNIK_POLICY_RPC_ID,
      result,
    });

    const error = withOwnProto(
      { code: -1, message: "bounded error" },
      protoValue,
    );
    await expectPolicyQueryRejected({
      jsonrpc: "2.0",
      id: SPUTNIK_POLICY_RPC_ID,
      error,
    });
  }

  const parsedEnvelope = JSON.parse(
    `{"jsonrpc":"2.0","id":"${SPUTNIK_POLICY_RPC_ID}","result":${JSON.stringify(
      rpcResult().result,
    )},"__proto__":null}`,
  );
  await expectPolicyQueryRejected(parsedEnvelope);
});

test("rejects own __proto__ keys throughout unsupported proposal boundaries", () => {
  const unsupportedProfile = { version: "9.9.9", codeHash: "unsupported" };
  const policy = parseSputnikPolicyFixtureWithoutBlock({
    network: "TESTNET",
    daoAccountId: dao,
    profile: unsupportedProfile,
    proposalBondYocto: "0",
    provenanceLabel: "special-key fixture",
  });
  const source = buildNativeTransferProposalPreview({
    network: "TESTNET",
    daoAccountId: dao,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: "2",
    cycle,
  });
  for (const protoValue of [null, 7, { nested: true }]) {
    const proposalExtra = withOwnProto(structuredClone(source), protoValue);
    assert.throws(
      () =>
        buildUnavailableAddProposalPreview({
          network: "TESTNET",
          daoAccountId: dao,
          profile: unsupportedProfile,
          policy,
          proposal: proposalExtra,
        }),
      /unexpected or missing fields/,
    );

    const kindExtra = withOwnProto(structuredClone(source.kind), protoValue);
    assert.throws(
      () =>
        buildUnavailableAddProposalPreview({
          network: "TESTNET",
          daoAccountId: dao,
          profile: unsupportedProfile,
          policy,
          proposal: { ...source, kind: kindExtra },
        }),
      /unexpected or missing fields/,
    );

    const transferExtra = withOwnProto(
      structuredClone(source.kind.Transfer),
      protoValue,
    );
    assert.throws(
      () =>
        buildUnavailableAddProposalPreview({
          network: "TESTNET",
          daoAccountId: dao,
          profile: unsupportedProfile,
          policy,
          proposal: {
            ...source,
            kind: { Transfer: transferExtra },
          },
        }),
      /unexpected or missing fields/,
    );
  }
});

test("duplicate scanner emits a bounded constant error without raw key leakage", async () => {
  const attackerKey = `${"x".repeat(100_000)}\u0001secret`;
  const encodedKey = JSON.stringify(attackerKey);
  const policyText = `{${encodedKey}:1,${encodedKey}:2,"proposal_bond":"1"}`;
  const encodedPolicy = Buffer.from(policyText, "utf8").toString("base64");
  let caught: Error | null = null;
  try {
    await querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () =>
        rpcResult(undefined, {
          result: encodedPolicy,
        }),
    });
  } catch (error) {
    caught = error as Error;
  }
  assert(caught);
  assert.equal(caught.message, "policy result: duplicate JSON member");
  assert(new TextEncoder().encode(caught.message).length <= 256);
  assert.equal(caught.message.includes("secret"), false);
  assert.equal(caught.message.includes("x".repeat(100)), false);
});
test("bounds base64 before parsing and bounds JSON-RPC error text/data", async () => {
  const maxEncoded = "A".repeat(4 * Math.ceil((256 * 1024) / 3));
  const tooLarge = `${maxEncoded}AAAA`;
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () => rpcResult(undefined, { result: tooLarge }),
    }),
    /encoded base64 length|JSON string exceeds the byte limit/,
  );
  await assert.rejects(
    querySputnikPolicy({
      daoAccountId: dao,
      profile,
      transport: async () => rpcResult(undefined, { result: maxEncoded }),
    }),
    /decoded byte length|UTF-8|JSON/,
  );
  for (const error of [
    { code: -1, message: "x".repeat(1025) },
    { code: -1, message: "bounded", data: "x".repeat(4097) },
    { code: -1, message: "bounded", extra: true },
  ]) {
    await assert.rejects(
      querySputnikPolicy({
        daoAccountId: dao,
        profile,
        transport: async () => ({
          jsonrpc: "2.0",
          id: SPUTNIK_POLICY_RPC_ID,
          error,
        }),
      }),
      /bounded|fields|byte bound/,
    );
  }
});

test("unsupported preview validates exact native shape and is deeply frozen", () => {
  const unsupportedProfile = { version: "9.9.9", codeHash: "unsupported" };
  const policy = parseSputnikPolicyFixtureWithoutBlock({
    network: "TESTNET",
    daoAccountId: dao,
    profile: unsupportedProfile,
    proposalBondYocto: "0",
    provenanceLabel: "unsupported display fixture",
  });
  const source = buildNativeTransferProposalPreview({
    network: "TESTNET",
    daoAccountId: dao,
    claimantId: recipient,
    recipientId: recipient,
    amountYocto: "2",
    cycle,
  });
  const preview = buildUnavailableAddProposalPreview({
    network: "TESTNET",
    daoAccountId: dao,
    profile: unsupportedProfile,
    policy,
    proposal: source,
  });
  assert.equal(Object.isFrozen(preview.args.proposal), true);
  assert.equal(Object.isFrozen(preview.args.proposal.kind), true);
  assert.equal(Object.isFrozen(preview.args.proposal.kind.Transfer), true);
  assert.throws(() => {
    (preview.args.proposal.kind.Transfer as { amount: string }).amount = "999";
  });
  for (const invalid of [
    { ...source, injected: true },
    {
      ...source,
      kind: { Transfer: { ...source.kind.Transfer, injected: true } },
    },
    {
      ...source,
      kind: { Transfer: { ...source.kind.Transfer, token_id: "ft" } },
    },
    { ...source, kind: { Transfer: { ...source.kind.Transfer, msg: "x" } } },
    { ...source, kind: { Transfer: { ...source.kind.Transfer, amount: "0" } } },
    {
      ...source,
      kind: { Transfer: { ...source.kind.Transfer, receiver_id: "INVALID" } },
    },
  ]) {
    assert.throws(() =>
      buildUnavailableAddProposalPreview({
        network: "TESTNET",
        daoAccountId: dao,
        profile: unsupportedProfile,
        policy,
        proposal: invalid as never,
      }),
    );
  }
});

test("authorization distinguishes positive and zero-bond protocol capability", () => {
  const positive = prepareUnsignedAddProposalRequest(
    requestInput({ gas: null }),
  );
  assert.equal(
    positive.authorization.bondCapability,
    "POSITIVE_BOND_REQUIRES_ATTACHED_NEAR",
  );
  assert.equal(positive.authorization.functionCallKeyProtocolCompatible, false);
  assert.equal(
    positive.authorization.functionCallKeyIntegrationSupported,
    false,
  );
  assert.equal(positive.authorization.required, "WALLET_OR_FULL_ACCESS_KEY");

  const zero = prepareUnsignedAddProposalRequest(
    requestInput({
      policy: fixturePolicy({ proposalBondYocto: "0" }),
      gas: null,
    }),
  );
  assert.equal(zero.attachedDepositYocto, "0");
  assert.equal(
    zero.authorization.bondCapability,
    "ZERO_BOND_REQUIRES_NO_ATTACHED_NEAR",
  );
  assert.equal(zero.authorization.functionCallKeyProtocolCompatible, true);
  assert.equal(zero.authorization.functionCallKeyIntegrationSupported, false);
  assert.equal(zero.authorization.required, "COMMONSOPS_WALLET_FLOW_ONLY");
  assert.equal(zero.signingEnabled, false);
  assert.equal(zero.executable, false);
});
