// One finalized block per snapshot, sequential null-terminated discovery,
// then a bounded cycle worker pool. No READY entry exists until all its reads
// have completed; infrastructure failures reject the whole refresh.
import type { Cycle, Template } from "@commonsops/domain";
import type { LiveNetworkConfig } from "./network.ts";
import {
  abortable,
  callViewFunction,
  fetchFinalBlockHeader,
  isInfrastructureError,
  LiveRpcError,
  parseCycle,
  parseFoundationStatus,
  parseTemplate,
  RpcContext,
  type FinalBlockHeader,
  type RpcOptions,
} from "./rpc.ts";

export const MAX_TEMPLATE_ENUMERATION = 16;
export interface LiveCycleRead {
  readonly periodIndex: string;
  readonly cycle: Cycle | null;
}
export type LiveTemplateRead =
  | {
      readonly kind: "READY";
      readonly templateId: string;
      readonly template: Template;
      readonly paused: boolean;
      readonly latestCycle: LiveCycleRead | null;
      readonly nextCycle: LiveCycleRead | null;
    }
  | {
      readonly kind: "ERROR";
      readonly templateId: string;
      readonly code: string;
      readonly message: string;
    };
export interface LiveRegistrySnapshot {
  readonly registryAccountId: string;
  readonly block: FinalBlockHeader;
  readonly foundationStatus: string;
  readonly endpoints: readonly string[];
  readonly templates: readonly LiveTemplateRead[];
  readonly enumerationComplete: boolean;
  readonly enumerationStop: "COMPLETE" | "CAPPED" | "INTERRUPTED";
}
export interface RegistryReadDeps {
  readonly fetchBlockHeader: () => Promise<FinalBlockHeader>;
  readonly fetchView: (
    accountId: string,
    methodName: string,
    args: unknown,
    block: FinalBlockHeader,
  ) => Promise<unknown>;
  readonly signal?: AbortSignal;
  readonly cancel?: () => void;
  readonly check?: () => void;
  readonly endpoints?: () => readonly string[];
}
export function liveReadDeps(
  nodeUrl: string,
  context: RpcContext,
): RegistryReadDeps {
  return {
    signal: context.signal,
    cancel: () => context.cancel(),
    check: () => context.check(),
    endpoints: () => context.endpoints(),
    fetchBlockHeader: () => fetchFinalBlockHeader(nodeUrl, context),
    fetchView: (accountId, methodName, args, block) =>
      callViewFunction(nodeUrl, accountId, methodName, args, block, context),
  };
}
function failure(error: unknown): { code: string; message: string } {
  return error instanceof LiveRpcError
    ? { code: error.code, message: error.message }
    : {
        code: "ERR_LIVE_READ",
        message: "Live registry read failed validation.",
      };
}

export async function buildRegistrySnapshot(
  deps: RegistryReadDeps,
  registryAccountId: string,
  maxTemplates: number = MAX_TEMPLATE_ENUMERATION,
): Promise<LiveRegistrySnapshot> {
  if (!Number.isInteger(maxTemplates) || maxTemplates < 1) {
    throw new LiveRpcError(
      "ERR_RPC_CONFIG",
      "Template cap must be a positive finite integer.",
    );
  }
  maxTemplates = Math.min(MAX_TEMPLATE_ENUMERATION, maxTemplates);
  const controller = new AbortController();
  const abort = () => controller.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", abort, { once: true });
  if (deps.signal?.aborted) abort();
  const read = <T>(operation: () => Promise<T>) =>
    abortable(Promise.resolve().then(operation), controller.signal);
  try {
    const block = await read(deps.fetchBlockHeader);
    const view = (method: string, args: unknown) =>
      read(() => deps.fetchView(registryAccountId, method, args, block));
    const foundationStatus = parseFoundationStatus(
      await view("foundation_status", {}),
    );
    const discovered: Array<Template | LiveTemplateRead> = [];
    let enumerationStop: LiveRegistrySnapshot["enumerationStop"] = "CAPPED";
    for (let id = 0; id < maxTemplates; id++) {
      const templateId = String(id);
      try {
        const raw = await view("get_template", { template_id: templateId });
        if (raw === null) {
          enumerationStop = "COMPLETE";
          break;
        }
        const template = parseTemplate(raw);
        if (template.id !== templateId)
          throw new LiveRpcError(
            "ERR_LIVE_REGISTRY_DATA",
            "Template identity does not match the request.",
          );
        discovered.push(template);
      } catch (error) {
        if (controller.signal.aborted || isInfrastructureError(error))
          throw error;
        discovered.push({ kind: "ERROR", templateId, ...failure(error) });
        enumerationStop = "INTERRUPTED";
        break;
      }
    }
    const templates: LiveTemplateRead[] = new Array(discovered.length);
    let cursor = 0;
    let fatal: unknown;
    const cycleRead = async (
      templateId: string,
      periodIndex: string,
    ): Promise<LiveCycleRead> => {
      const cycle = parseCycle(
        await view("get_cycle", {
          cycle_key: { template_id: templateId, period_index: periodIndex },
        }),
      );
      if (
        cycle &&
        (cycle.key.template_id !== templateId ||
          cycle.key.period_index !== periodIndex)
      ) {
        throw new LiveRpcError(
          "ERR_LIVE_REGISTRY_DATA",
          "Cycle identity does not match the request.",
        );
      }
      return { periodIndex, cycle };
    };
    const worker = async () => {
      while (cursor < discovered.length && !controller.signal.aborted) {
        const index = cursor++;
        const entry = discovered[index]!;
        if ("kind" in entry) {
          templates[index] = entry;
          continue;
        }
        const template = entry;
        const templateId = template.id;
        try {
          let latestCycle: LiveCycleRead | null = null;
          let nextCycle: LiveCycleRead | null = null;
          if (template.active) {
            if (template.next_period_index !== "0")
              latestCycle = await cycleRead(
                templateId,
                (BigInt(template.next_period_index) - 1n).toString(),
              );
            nextCycle = await cycleRead(templateId, template.next_period_index);
          }
          templates[index] = {
            kind: "READY",
            templateId,
            template,
            paused: !template.active,
            latestCycle,
            nextCycle,
          };
        } catch (error) {
          if (controller.signal.aborted || isInfrastructureError(error)) {
            if (fatal === undefined) fatal = error;
            controller.abort(error);
            deps.cancel?.();
            return;
          }
          templates[index] = { kind: "ERROR", templateId, ...failure(error) };
        }
      }
    };
    // Workers catch and settle before returning; cancellation drains queued
    // reads rather than leaving sibling promises unobserved.
    await Promise.all(
      Array.from({ length: Math.min(4, discovered.length) }, worker),
    );
    if (fatal !== undefined) throw fatal;
    if (controller.signal.aborted)
      throw new LiveRpcError("ERR_RPC_CANCELLED", "Live read cancelled.");
    deps.check?.();
    return Object.freeze({
      registryAccountId,
      endpoints: Object.freeze([...(deps.endpoints?.() ?? [])]),
      block,
      foundationStatus,
      templates: Object.freeze(templates),
      enumerationComplete: enumerationStop === "COMPLETE",
      enumerationStop,
    });
  } finally {
    controller.abort();
    deps.signal?.removeEventListener("abort", abort);
  }
}
export async function fetchLiveRegistrySnapshot(
  config: LiveNetworkConfig,
  registryAccountId: string,
  options: RpcOptions = {},
): Promise<LiveRegistrySnapshot> {
  const context = new RpcContext(options);
  try {
    const snapshot = await buildRegistrySnapshot(
      liveReadDeps(config.nodeUrl, context),
      registryAccountId,
    );
    context.check();
    return snapshot;
  } finally {
    context.dispose();
  }
}
