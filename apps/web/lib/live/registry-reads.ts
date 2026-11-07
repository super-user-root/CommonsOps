// Live registry snapshot: read-only JSON-RPC reads of the deployed testnet
// registry (commonsops.testnet) at NEAR final blocks. No wallet is needed and
// nothing is signed. Every failure is a named error; no fallback data.
//
// Templates are enumerated by id (0, 1, 2, …) until the registry answers
// null (the contract assigns sequential ids, so the first missing id ends
// the registry's template list), capped at MAX_TEMPLATE_ENUMERATION reads.
// A template that errors after earlier successes is a named per-template
// error — earlier templates still render; the enumeration stops there.

import type { Cycle, Template } from "@commonsops/domain";
import type { LiveNetworkConfig } from "./network.ts";
import {
  callViewFunction,
  fetchFinalBlockHeader,
  parseCycle,
  parseFoundationStatus,
  parseTemplate,
  type FinalBlockHeader,
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
      // Cycle reads run only for active templates. For an active template,
      // latestCycle is null when next_period_index is "0" (no period has
      // ever been materialized) and nextCycle is always read; for a paused
      // template both are null and nothing was read.
      readonly latestCycle: LiveCycleRead | null;
      // The template's next period (next_period_index): null onchain until
      // the operator materializes it (e.g. template 0 period 1 today), or a
      // live OPEN/CLAIMED/… cycle (e.g. the judge-demo template 2 period 0).
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
  readonly templates: readonly LiveTemplateRead[];
  // false when the loop stopped at the cap instead of at a missing template:
  // more templates may exist onchain and are not shown.
  readonly enumerationComplete: boolean;
}

export interface RegistryReadDeps {
  readonly fetchBlockHeader: () => Promise<FinalBlockHeader>;
  readonly fetchView: (
    accountId: string,
    methodName: string,
    args: unknown,
  ) => Promise<unknown>;
}

export function liveReadDeps(nodeUrl: string): RegistryReadDeps {
  return {
    fetchBlockHeader: () => fetchFinalBlockHeader(nodeUrl),
    fetchView: (accountId, methodName, args) =>
      callViewFunction(nodeUrl, accountId, methodName, args),
  };
}

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof Error && error.name === "LiveRpcError") {
    const rpcError = error as Error & { code?: string };
    if (rpcError.code) {
      return { code: rpcError.code, message: error.message };
    }
  }
  return {
    code: "ERR_LIVE_READ",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function readCycle(
  deps: RegistryReadDeps,
  registryAccountId: string,
  templateId: string,
  periodIndex: string,
): Promise<LiveCycleRead> {
  const cycle = parseCycle(
    await deps.fetchView(registryAccountId, "get_cycle", {
      cycle_key: { template_id: templateId, period_index: periodIndex },
    }),
  );
  return { periodIndex, cycle };
}

export async function buildRegistrySnapshot(
  deps: RegistryReadDeps,
  registryAccountId: string,
  maxTemplates: number = MAX_TEMPLATE_ENUMERATION,
): Promise<LiveRegistrySnapshot> {
  const block = await deps.fetchBlockHeader();
  const foundationStatus = parseFoundationStatus(
    await deps.fetchView(registryAccountId, "foundation_status", {}),
  );

  const templates: LiveTemplateRead[] = [];
  let enumerationComplete = false;
  for (let id = 0; id < maxTemplates; id++) {
    const templateId = String(id);
    let template: Template;
    try {
      const raw = await deps.fetchView(registryAccountId, "get_template", {
        template_id: templateId,
      });
      if (raw === null) {
        // The registry returns none here: sequential ids are exhausted.
        // (Malformed non-null data still throws in parseTemplate below.)
        enumerationComplete = true;
        break;
      }
      template = parseTemplate(raw);
    } catch (error) {
      // Named per-template error: earlier templates stay rendered, later
      // ones are unread rather than invented.
      templates.push({
        kind: "ERROR",
        templateId,
        ...failure(error),
      });
      break;
    }

    try {
      // Cycle reads run only for active templates; paused templates render
      // without cycle cards or contributor actions.
      let latestCycle: LiveCycleRead | null = null;
      let nextCycle: LiveCycleRead | null = null;
      if (template.active) {
        const nextPeriodIndex = template.next_period_index;
        latestCycle =
          nextPeriodIndex === "0"
            ? null
            : await readCycle(
                deps,
                registryAccountId,
                templateId,
                (BigInt(nextPeriodIndex) - 1n).toString(),
              );
        nextCycle = await readCycle(
          deps,
          registryAccountId,
          templateId,
          nextPeriodIndex,
        );
      }
      templates.push({
        kind: "READY",
        templateId,
        template,
        paused: !template.active,
        latestCycle,
        nextCycle,
      });
    } catch (error) {
      templates.push({
        kind: "ERROR",
        templateId,
        ...failure(error),
      });
      break;
    }
  }

  return Object.freeze({
    registryAccountId,
    block,
    foundationStatus,
    templates: Object.freeze(templates),
    enumerationComplete,
  });
}

export async function fetchLiveRegistrySnapshot(
  config: LiveNetworkConfig,
  registryAccountId: string,
): Promise<LiveRegistrySnapshot> {
  return buildRegistrySnapshot(liveReadDeps(config.nodeUrl), registryAccountId);
}
