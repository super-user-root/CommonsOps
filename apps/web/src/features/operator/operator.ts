import type { TemplateInput } from "@commonsops/domain";
import { registryBounds } from "@commonsops/domain";

export type OperatorRequestState =
  | { readonly status: "IDLE" }
  | { readonly status: "PENDING"; readonly method: TransactionIntent["method"] }
  | { readonly status: "SUCCESS"; readonly transactionHash: string }
  | { readonly status: "ERROR"; readonly message: string };

export interface CreateTemplateDraft {
  readonly daoAccountId: string;
  readonly title: string;
  readonly description: string;
  readonly startAtNs: string;
  readonly intervalNs: string;
  readonly workWindowNs: string;
  readonly claimDurationNs: string;
  readonly amountYocto: string;
}

export interface TransactionIntent {
  readonly receiverId: string;
  readonly method:
    "create_template" | "set_template_active" | "materialize_cycle";
  readonly args: Readonly<Record<string, unknown>>;
  readonly attachedDepositYocto: string;
  readonly network: "TESTNET";
  readonly signingEnabled: false;
  readonly disabledReason: string;
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
// Testnet storage byte price, 10^19 yoctoNEAR per byte. Deployment/profile work must recheck it.
export const STORAGE_BYTE_COST_YOCTO = 10_000_000_000_000_000_000n;
export const TEMPLATE_MIN_DEPOSIT_YOCTO =
  STORAGE_BYTE_COST_YOCTO * BigInt(registryBounds.templateReserveBytes);
export const CYCLE_MIN_DEPOSIT_YOCTO =
  STORAGE_BYTE_COST_YOCTO * BigInt(registryBounds.cycleReserveBytes);

function canonicalDecimal(
  value: string,
  field: string,
  bits: 64 | 128,
  allowZero = false,
) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field}: decimal string required`);
  }
  const amount = BigInt(value);
  if (!allowZero && amount === 0n)
    throw new Error(`${field}: must be positive`);
  if (amount > (bits === 64 ? U64_MAX : U128_MAX)) {
    throw new Error(`${field}: overflow`);
  }
  return value;
}

function minimumDeposit(value: string, minimum: bigint, field: string) {
  const canonical = canonicalDecimal(value, field, 128);
  if (BigInt(canonical) < minimum) {
    throw new Error(`${field}: below required storage reserve`);
  }
  return canonical;
}

export function toTemplateInput(draft: CreateTemplateDraft): TemplateInput {
  if (
    !/^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/.test(
      draft.daoAccountId,
    )
  ) {
    throw new Error("daoAccountId: invalid NEAR account");
  }
  if (
    !draft.title.trim() ||
    new TextEncoder().encode(draft.title).length > registryBounds.maxTitleBytes
  ) {
    throw new Error("title: 1–120 UTF-8 bytes required");
  }
  if (
    new TextEncoder().encode(draft.description).length >
    registryBounds.maxDescriptionBytes
  ) {
    throw new Error("description: maximum 1024 UTF-8 bytes");
  }
  const start = BigInt(
    canonicalDecimal(draft.startAtNs, "startAtNs", 64, true),
  );
  const interval = BigInt(canonicalDecimal(draft.intervalNs, "intervalNs", 64));
  const window = BigInt(
    canonicalDecimal(draft.workWindowNs, "workWindowNs", 64),
  );
  if (window > interval)
    throw new Error("workWindowNs: cannot exceed intervalNs");
  if (start + window > U64_MAX)
    throw new Error("startAtNs + workWindowNs: overflow");
  return {
    dao_account_id: draft.daoAccountId,
    title: draft.title,
    description: draft.description,
    start_at_ns: draft.startAtNs,
    interval_ns: draft.intervalNs,
    work_window_ns: draft.workWindowNs,
    claim_duration_ns: canonicalDecimal(
      draft.claimDurationNs,
      "claimDurationNs",
      64,
    ),
    amount_yocto: canonicalDecimal(draft.amountYocto, "amountYocto", 128),
  };
}

export function createTemplateIntent(
  registryAccountId: string | null,
  draft: CreateTemplateDraft,
  storageDepositYocto: string,
): TransactionIntent {
  const input = toTemplateInput(draft);
  const deposit = minimumDeposit(
    storageDepositYocto,
    TEMPLATE_MIN_DEPOSIT_YOCTO,
    "storageDepositYocto",
  );
  return {
    receiverId: registryAccountId ?? "",
    method: "create_template",
    args: { input },
    attachedDepositYocto: deposit,
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: registryAccountId
      ? "Wallet connector is not configured."
      : "No reviewed testnet registry deployment is configured.",
  };
}

export function templateActionIntent(
  registryAccountId: string | null,
  method: "set_template_active" | "materialize_cycle",
  templateId: string,
  active?: boolean,
  storageDepositYocto = "0",
): TransactionIntent {
  canonicalDecimal(templateId, "templateId", 64, true);
  if (method === "set_template_active" && typeof active !== "boolean") {
    throw new Error("active: boolean required");
  }
  const deposit =
    method === "set_template_active"
      ? canonicalDecimal(storageDepositYocto, "storageDepositYocto", 128, true)
      : minimumDeposit(
          storageDepositYocto,
          CYCLE_MIN_DEPOSIT_YOCTO,
          "storageDepositYocto",
        );
  if (method === "set_template_active" && deposit !== "0") {
    throw new Error("storageDepositYocto: pause/resume requires zero deposit");
  }
  return {
    receiverId: registryAccountId ?? "",
    method,
    args:
      method === "set_template_active"
        ? { template_id: templateId, active }
        : { template_id: templateId },
    attachedDepositYocto: deposit,
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: registryAccountId
      ? "Wallet connector is not configured."
      : "No reviewed testnet registry deployment is configured.",
  };
}
