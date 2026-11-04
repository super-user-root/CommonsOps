import type { TemplateInput } from "@commonsops/domain";

export type OperatorRequestState =
  | { readonly status: "IDLE" }
  | { readonly status: "PENDING"; readonly method: string }
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

function canonicalDecimal(value: string, field: string, allowZero = false) {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error(`${field}: decimal string required`);
  const amount = BigInt(value);
  if (!allowZero && amount === 0n)
    throw new Error(`${field}: must be positive`);
  if (amount > (1n << 128n) - 1n) throw new Error(`${field}: overflow`);
  return value;
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
    new TextEncoder().encode(draft.title).length > 120
  ) {
    throw new Error("title: 1–120 UTF-8 bytes required");
  }
  if (new TextEncoder().encode(draft.description).length > 1024) {
    throw new Error("description: maximum 1024 UTF-8 bytes");
  }
  const interval = BigInt(canonicalDecimal(draft.intervalNs, "intervalNs"));
  const window = BigInt(canonicalDecimal(draft.workWindowNs, "workWindowNs"));
  if (window > interval)
    throw new Error("workWindowNs: cannot exceed intervalNs");
  return {
    dao_account_id: draft.daoAccountId,
    title: draft.title,
    description: draft.description,
    start_at_ns: canonicalDecimal(draft.startAtNs, "startAtNs", true),
    interval_ns: draft.intervalNs,
    work_window_ns: draft.workWindowNs,
    claim_duration_ns: canonicalDecimal(
      draft.claimDurationNs,
      "claimDurationNs",
    ),
    amount_yocto: canonicalDecimal(draft.amountYocto, "amountYocto"),
  };
}

export function createTemplateIntent(
  registryAccountId: string | null,
  draft: CreateTemplateDraft,
  storageDepositYocto: string,
): TransactionIntent {
  const input = toTemplateInput(draft);
  canonicalDecimal(storageDepositYocto, "storageDepositYocto");
  return {
    receiverId: registryAccountId ?? "",
    method: "create_template",
    args: { input },
    attachedDepositYocto: storageDepositYocto,
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
  canonicalDecimal(templateId, "templateId", true);
  canonicalDecimal(
    storageDepositYocto,
    "storageDepositYocto",
    method === "set_template_active",
  );
  if (method === "set_template_active" && typeof active !== "boolean") {
    throw new Error("active: boolean required");
  }
  return {
    receiverId: registryAccountId ?? "",
    method,
    args:
      method === "set_template_active"
        ? { template_id: templateId, active }
        : { template_id: templateId },
    attachedDepositYocto:
      method === "set_template_active" ? "0" : storageDepositYocto,
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: registryAccountId
      ? "Wallet connector is not configured."
      : "No reviewed testnet registry deployment is configured.",
  };
}
