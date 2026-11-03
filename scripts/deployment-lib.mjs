import { createHash } from "node:crypto";

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

export function createDeploymentManifest({
  accountId,
  managerId,
  sourceHead,
  wasmBytes,
  wasmSha256,
}) {
  validateTestnetAccount(accountId, "contract account");
  validateTestnetAccount(managerId, "manager account");
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) {
    throw new Error("sourceHead must be a full lower-case Git SHA");
  }
  if (!/^[a-f0-9]{64}$/.test(wasmSha256)) {
    throw new Error("wasmSha256 must be a SHA-256 hex digest");
  }
  if (!Number.isSafeInteger(wasmBytes) || wasmBytes <= 0) {
    throw new Error("wasmBytes must be a positive safe integer");
  }
  const initArgs = { manager_id: managerId, network: "TESTNET" };
  const unsignedCommandArgs = [
    "contract",
    "deploy",
    accountId,
    "use-file",
    "contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
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
    "<PUBLIC_KEY>",
    "--nonce",
    "<NONCE>",
    "--block-hash",
    "<RECENT_BLOCK_HASH>",
    "save-to-file",
    "deployments/testnet/unsigned-deploy.transaction",
  ];
  return {
    schemaVersion: 1,
    status: "PREPARED_UNSIGNED",
    network: "testnet",
    contractAccountId: accountId,
    managerAccountId: managerId,
    sourceHead,
    wasmPath:
      "contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
    wasmSha256,
    wasmBytes,
    rust: "1.98.0",
    nearSdk: "5.30.0",
    nearCli: "near-cli-rs 0.30.1",
    atomicActions: ["DeployContract", "FunctionCall:new"],
    initArgs,
    prepaidGas: "50 Tgas",
    attachedDeposit: "0 NEAR",
    unsignedCommandArgs,
    transactionHash: null,
    receipts: [],
    deployedCodeHash: null,
  };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function bashCommand(manifest) {
  return ["near", ...manifest.unsignedCommandArgs].map(shellQuote).join(" ");
}
