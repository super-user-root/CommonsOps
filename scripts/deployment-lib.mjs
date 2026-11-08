import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  HistoricalRpcContext,
  LiveRpcError,
  RPC_ENDPOINTS,
  RpcContext,
} from "../packages/near/src/read-only-rpc.ts";

export const REVIEWED_SOURCE_HEAD = "27b631a15745859b92572349d60425dd2d1a6ed9";
export const REVIEWED_CONTRACT_TREE =
  "979db78a521e045676db8dd0564b8d17d24ab8bc";
export const REVIEWED_WASM_SHA256 =
  "9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c";
export const REVIEWED_WASM_BYTES = 261_226;
export const REVIEWED_RUST = "1.98.0";
export const REVIEWED_NEAR_SDK = "5.30.0";
export const REVIEWED_NEAR_CLI = "near-cli-rs 0.30.1";
export const RPC_URL = RPC_ENDPOINTS[0];
export const ACCOUNT_PATTERN =
  /^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/;

export function validateTestnetAccount(accountId, label) {
  if (!ACCOUNT_PATTERN.test(accountId) || !accountId.endsWith(".testnet")) {
    throw new Error(`Invalid ${label}: expected a named .testnet account`);
  }
  return accountId;
}

export function wasmDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertReviewedArtifact({
  contractTree,
  wasmBytes,
  wasmSha256,
}) {
  if (contractTree !== REVIEWED_CONTRACT_TREE) {
    throw new Error(`Contract tree is not reviewed: ${contractTree}`);
  }
  if (
    wasmSha256 !== REVIEWED_WASM_SHA256 ||
    wasmBytes !== REVIEWED_WASM_BYTES
  ) {
    throw new Error("WASM does not match the reviewed artifact");
  }
}

export function createDeploymentManifest({
  accountId,
  managerId,
  signerPublicKey,
  nonce,
  blockHash,
  preDeployment,
  sourceHead,
  contractTree,
  wasmBytes,
  wasmSha256,
}) {
  validateTestnetAccount(accountId, "contract account");
  validateTestnetAccount(managerId, "manager account");
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) {
    throw new Error("sourceHead must be a full lower-case Git SHA");
  }
  if (contractTree !== REVIEWED_CONTRACT_TREE) {
    throw new Error(`Contract tree is not reviewed: ${contractTree}`);
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(signerPublicKey)) {
    throw new Error("signerPublicKey must be an ed25519 public key");
  }
  if (!Number.isSafeInteger(nonce) || nonce <= 0) {
    throw new Error("nonce must be a positive safe integer");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(blockHash)) {
    throw new Error("blockHash must be a base58 crypto hash");
  }
  if (
    !preDeployment ||
    preDeployment.blockHash !== blockHash ||
    !Number.isSafeInteger(preDeployment.blockHeight) ||
    typeof preDeployment.codeHash !== "string"
  ) {
    throw new Error(
      "preDeployment must pin account state to the access-key block",
    );
  }
  assertReviewedArtifact({ contractTree, wasmBytes, wasmSha256 });
  const artifactPath = `deployments/testnet/artifacts/${wasmSha256}.wasm`;
  const initArgs = { manager_id: managerId, network: "TESTNET" };
  const unsignedCommandArgs = [
    "contract",
    "deploy",
    accountId,
    "use-file",
    artifactPath,
    "with-init-call",
    "new",
    "json-args",
    JSON.stringify(initArgs),
    "prepaid-gas",
    "50 Tgas",
    "attached-deposit",
    "0 NEAR",
    "network-config",
    "testnet",
    "sign-later",
    "--signer-public-key",
    signerPublicKey,
    "--nonce",
    String(nonce),
    "--block-hash",
    blockHash,
    "save-to-file",
    "deployments/testnet/unsigned-deploy.transaction",
  ];
  return {
    schemaVersion: 2,
    status: "PREPARED_UNSIGNED",
    network: "testnet",
    rpcUrl: RPC_URL,
    contractAccountId: accountId,
    managerAccountId: managerId,
    signerAccountId: accountId,
    signerPublicKey,
    sourceHead,
    reviewedSourceHead: REVIEWED_SOURCE_HEAD,
    contractTree,
    artifactPath,
    wasmSha256,
    wasmBytes,
    rust: REVIEWED_RUST,
    nearSdk: REVIEWED_NEAR_SDK,
    nearCli: REVIEWED_NEAR_CLI,
    atomicActions: ["DeployContract", "FunctionCall:new"],
    initArgs,
    prepaidGas: "50000000000000",
    attachedDeposit: "0",
    nonce,
    recentBlockHash: blockHash,
    preDeployment,
    unsignedCommandArgs,
    transactionHash: null,
    receipts: [],
    postDeployment: null,
  };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function powerShellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function bashCommand(manifest) {
  return ["near", ...manifest.unsignedCommandArgs].map(shellQuote).join(" ");
}

export function powerShellCommand(manifest) {
  return `& near ${manifest.unsignedCommandArgs.map(powerShellQuote).join(" ")}`;
}

export function nearCodeHash(bytes) {
  return base58Encode(Buffer.from(wasmDigest(bytes), "hex"));
}

export function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = alphabet[digit] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded || "1";
}

// Compatibility for the unsigned preparer's existing (method, params, fetch)
// calls. Historical callers must pass their explicit scoped context; no broad
// tx capability is silently granted here. A standalone read is always disposed.
export async function rpcCall(
  method,
  params,
  contextOrFetch,
  validate = (result) => result,
) {
  const context =
    contextOrFetch instanceof RpcContext
      ? contextOrFetch
      : new RpcContext(
          typeof contextOrFetch === "function" ? { fetch: contextOrFetch } : {},
        );
  try {
    return await context.call(RPC_URL, method, params, validate);
  } finally {
    if (!(contextOrFetch instanceof RpcContext)) context.dispose();
  }
}

export function isMain(metaUrl) {
  return Boolean(
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === metaUrl,
  );
}

// pnpm may forward one literal separator. Unknown/duplicate flags and surplus
// positional values are errors, before creating a context or reading artifacts.
export function parseReadOnlyArgs(argv, { accountRequired = false, usage }) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let stdoutOnly = false;
  let accountId;
  for (const arg of args) {
    if (arg === "--stdout-only" && !stdoutOnly) stdoutOnly = true;
    else if (accountRequired && accountId === undefined && !arg.startsWith("-"))
      accountId = validateTestnetAccount(arg, "contract account");
    else throw new Error(usage);
  }
  if (accountRequired && !accountId) throw new Error(usage);
  return { stdoutOnly, accountId };
}

// One scoped context, one disposal, including failed verification. Run evidence
// belongs OUTSIDE immutable attribution records and snapshot fingerprints.
export async function historicalRun(reads, maxAttempts, options, verify) {
  const context = new HistoricalRpcContext({
    ...options,
    reads,
    limits: {
      ...options?.limits,
      maxAttempts: Math.min(
        maxAttempts,
        options?.limits?.maxAttempts ?? maxAttempts,
      ),
    },
  });
  try {
    const value = await verify(context);
    context.check();
    return { value, runProvenance: context.provenance() };
  } catch (cause) {
    const error = new Error(
      cause instanceof Error ? cause.message : "Historical verification failed",
      { cause },
    );
    error.code =
      cause instanceof LiveRpcError ? cause.code : "ERR_VERIFICATION";
    error.runProvenance = context.provenance();
    throw error;
  } finally {
    context.dispose();
  }
}

export function verificationFailure(error) {
  return {
    status: "FAILED",
    error: {
      code: error?.code ?? "ERR_VERIFICATION",
      message: error instanceof Error ? error.message : "Verification failed",
    },
    runProvenance: error?.runProvenance ?? null,
  };
}

// Write only already-verified results. Same-directory exclusive temp + rename
// means a failed write cannot truncate a previously successful artifact.
export async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function verifyDeploymentTransaction(manifest, transaction) {
  if (
    !manifest ||
    !["PREPARED_UNSIGNED", "DEPLOYED"].includes(manifest.status)
  ) {
    throw new Error("Manifest has invalid deployment lifecycle state");
  }
  if (!transaction || transaction.final_execution_status !== "FINAL") {
    throw new Error("Deployment transaction is not final");
  }
  if (
    transaction.transaction?.hash !== manifest.transactionHash ||
    transaction.transaction?.signer_id !== manifest.contractAccountId ||
    transaction.transaction?.receiver_id !== manifest.contractAccountId ||
    transaction.transaction?.public_key !== manifest.signerPublicKey ||
    Number(transaction.transaction?.nonce) !== manifest.nonce
  ) {
    throw new Error(
      "Deployment hash/key/nonce/signer/receiver does not match manifest",
    );
  }
  const actions = transaction.transaction.actions;
  if (!Array.isArray(actions) || actions.length !== 2) {
    throw new Error("Deployment must contain exactly two actions");
  }
  const codeBase64 = actions[0]?.DeployContract?.code;
  const call = actions[1]?.FunctionCall;
  if (!codeBase64 || !call || call.method_name !== "new") {
    throw new Error("Deployment action order or init method is invalid");
  }
  const code = Buffer.from(codeBase64, "base64");
  if (code.length === 32) {
    // Current nearcore RPC transaction views replace the DeployContract code
    // with a 32-byte internal identifier. The byte-level reviewed-artifact
    // proof is enforced by the smoke tool's onchain view_code check, which
    // hashes the stored contract and requires the reviewed SHA-256.
  } else {
    assertReviewedArtifact({
      contractTree: manifest.contractTree,
      wasmBytes: code.length,
      wasmSha256: wasmDigest(code),
    });
  }
  const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  if (
    JSON.stringify(args) !== JSON.stringify(manifest.initArgs) ||
    String(call.gas) !== manifest.prepaidGas ||
    String(call.deposit) !== manifest.attachedDeposit
  ) {
    throw new Error(
      "Deployment init arguments, gas or deposit differ from manifest",
    );
  }
  const outcomes = [
    transaction.transaction_outcome,
    ...(transaction.receipts_outcome ?? []),
  ];
  const isSuccessStatus = (status) =>
    status &&
    typeof status === "object" &&
    (Object.hasOwn(status, "SuccessReceiptId") ||
      Object.hasOwn(status, "SuccessValue"));
  if (
    outcomes.length < 2 ||
    outcomes.some((entry) => !isSuccessStatus(entry?.outcome?.status))
  ) {
    throw new Error("Deployment has missing, unknown or failed outcomes");
  }
  const receiptIds = (transaction.receipts_outcome ?? []).map(
    (entry) => entry.id,
  );
  if (receiptIds.some((id) => typeof id !== "string")) {
    throw new Error("Deployment receipt IDs are incomplete");
  }
  const expectedInitReceiptId =
    transaction.transaction_outcome.outcome.status.SuccessReceiptId;
  const initReceipt = (transaction.receipts_outcome ?? []).find(
    (entry) =>
      entry.id === expectedInitReceiptId &&
      (entry?.outcome?.logs ?? []).some((log) =>
        log.includes('"event":"registry_initialized"'),
      ),
  );
  if (!initReceipt?.block_hash) {
    throw new Error("Successful registry initialization receipt is missing");
  }
  return {
    transactionHash: transaction.transaction.hash,
    transactionBlockHash: transaction.transaction_outcome.block_hash,
    postStateBlockHash: initReceipt.block_hash,
    receiptIds,
    reviewedCodeHash: nearCodeHash(code),
  };
}
