// Browser compatibility surface. Transport/parsing bounds live in the shared
// package; registry domain parsers remain here. The historical capability is
// deliberately NOT exported from this browser module.
import type { Cycle, Template } from "@commonsops/domain";
import { isCanonicalDecimal } from "@commonsops/domain";
import { LiveRpcError } from "../../../../packages/near/src/read-only-rpc.ts";
export {
  LiveRpcError,
  RPC_ENDPOINTS,
  RPC_LIMITS,
  RpcContext,
  abortable,
  isTransientRpcCode,
  isInfrastructureError,
  rpcCall,
  encodeViewArgs,
  decodeCallFunctionResult,
  callViewFunction,
  parseFinalBlockHeader,
  fetchFinalBlockHeader,
  type RpcOptions,
  type FinalBlockHeader,
} from "../../../../packages/near/src/read-only-rpc.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function invalidField(field: string): never {
  throw new LiveRpcError(
    "ERR_LIVE_REGISTRY_DATA",
    `unexpected ${field} in live registry response`,
  );
}
function canonicalField(
  record: Record<string, unknown>,
  field: string,
  bits: 64 | 128,
): string {
  const value = record[field];
  if (typeof value !== "string" || !isCanonicalDecimal(value, bits)) {
    return invalidField(field);
  }
  return value;
}
function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return invalidField(field);
  }
  return value;
}
const CYCLE_STATUSES = new Set([
  "OPEN",
  "CLAIMED",
  "SUBMITTED",
  "EXPIRED",
  "CANCELLED",
]);

// Structural guards reject malformed live data rather than inventing defaults.
export function parseTemplate(value: unknown): Template {
  if (!isObject(value)) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "template is not an object",
    );
  }
  const input = isObject(value.input) ? value.input : null;
  if (!input) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "template input is missing",
    );
  }
  if (typeof value.active !== "boolean") return invalidField("active");
  if (typeof input.description !== "string")
    return invalidField("input.description");
  return Object.freeze({
    id: canonicalField(value, "id", 64),
    manager_id: stringField(value, "manager_id"),
    active: value.active,
    next_period_index: canonicalField(value, "next_period_index", 64),
    created_at_ns: canonicalField(value, "created_at_ns", 64),
    input: Object.freeze({
      dao_account_id: stringField(input, "dao_account_id"),
      title: stringField(input, "title"),
      description: input.description,
      start_at_ns: canonicalField(input, "start_at_ns", 64),
      interval_ns: canonicalField(input, "interval_ns", 64),
      work_window_ns: canonicalField(input, "work_window_ns", 64),
      claim_duration_ns: canonicalField(input, "claim_duration_ns", 64),
      amount_yocto: canonicalField(input, "amount_yocto", 128),
    }),
  } satisfies Template);
}
function parseOptionalClaim(value: unknown): Cycle["claim"] {
  if (value === null) return null;
  if (!isObject(value))
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "claim is not an object");
  return Object.freeze({
    claimant_id: stringField(value, "claimant_id"),
    payout_recipient_id: stringField(value, "payout_recipient_id"),
    expires_at_ns: canonicalField(value, "expires_at_ns", 64),
  });
}
function parseOptionalEvidence(value: unknown): Cycle["evidence"] {
  if (value === null) return null;
  if (!isObject(value))
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "evidence is not an object",
    );
  return Object.freeze({
    repository_owner: stringField(value, "repository_owner"),
    repository_name: stringField(value, "repository_name"),
    pull_request_number: canonicalField(value, "pull_request_number", 64),
    url: stringField(value, "url"),
    commit_sha: stringField(value, "commit_sha"),
    digest_sha256: stringField(value, "digest_sha256"),
  });
}
function parseOptionalProposalLink(value: unknown): Cycle["proposal_link"] {
  if (value === null) return null;
  if (!isObject(value) || !isObject(value.key))
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "proposal link is not an object",
    );
  const key = value.key;
  const network = key.network;
  if (network !== "TESTNET" && network !== "MAINNET")
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "proposal link network is invalid",
    );
  return Object.freeze({
    key: Object.freeze({
      network,
      dao_account_id: stringField(key, "dao_account_id"),
      proposal_id: canonicalField(key, "proposal_id", 64),
    }),
    linked_at_ns: canonicalField(value, "linked_at_ns", 64),
  });
}
export function parseCycle(value: unknown): Cycle | null {
  if (value === null) return null;
  if (!isObject(value))
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle is not an object");
  const key = isObject(value.key) ? value.key : null;
  if (!key)
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle key is missing");
  const status = value.status;
  if (typeof status !== "string" || !CYCLE_STATUSES.has(status))
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle status is invalid");
  return Object.freeze({
    key: Object.freeze({
      template_id: canonicalField(key, "template_id", 64),
      period_index: canonicalField(key, "period_index", 64),
    }),
    status: status as Cycle["status"],
    opens_at_ns: canonicalField(value, "opens_at_ns", 64),
    deadline_at_ns: canonicalField(value, "deadline_at_ns", 64),
    dao_account_id: stringField(value, "dao_account_id"),
    amount_yocto: canonicalField(value, "amount_yocto", 128),
    claim: parseOptionalClaim(value.claim ?? null),
    evidence: parseOptionalEvidence(value.evidence ?? null),
    submitted_at_ns:
      value.submitted_at_ns === null || value.submitted_at_ns === undefined
        ? null
        : canonicalField(value, "submitted_at_ns", 64),
    proposal_link: parseOptionalProposalLink(value.proposal_link ?? null),
  } satisfies Cycle);
}
export function parseFoundationStatus(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "foundation_status is not a string",
    );
  return value;
}
