// Live registry snapshot: read-only JSON-RPC reads of the deployed testnet
// registry (commonsops.testnet) at NEAR final blocks. No wallet is needed and
// nothing is signed. Every failure is a named error; no fallback data.

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

// The registered maintenance template rendered by the live surface.
export const LIVE_TEMPLATE_ID = "0";
// The latest materialized cycle of template 0 (the recorded journey cycle).
export const LATEST_PERIOD_INDEX = "0";

export interface LiveRegistrySnapshot {
  readonly registryAccountId: string;
  readonly block: FinalBlockHeader;
  readonly foundationStatus: string;
  readonly template: Template;
  readonly latestCycle: Cycle | null;
  readonly nextCycle: Cycle | null;
}

export interface LiveCycleRead {
  readonly periodIndex: string;
  readonly cycle: Cycle | null;
}

export async function fetchLiveRegistrySnapshot(
  config: LiveNetworkConfig,
  registryAccountId: string,
): Promise<LiveRegistrySnapshot> {
  const block = await fetchFinalBlockHeader(config.nodeUrl);
  const foundationStatus = parseFoundationStatus(
    await callViewFunction(
      config.nodeUrl,
      registryAccountId,
      "foundation_status",
      {},
    ),
  );
  const template = parseTemplate(
    await callViewFunction(config.nodeUrl, registryAccountId, "get_template", {
      template_id: LIVE_TEMPLATE_ID,
    }),
  );
  const latestCycle = parseCycle(
    await callViewFunction(config.nodeUrl, registryAccountId, "get_cycle", {
      cycle_key: {
        template_id: LIVE_TEMPLATE_ID,
        period_index: LATEST_PERIOD_INDEX,
      },
    }),
  );
  // The next period is whatever the template says comes next; today that is
  // period 1 and no cycle exists for it (the operator materializes it when
  // due). Design for both states: present or honestly absent.
  const nextPeriodIndex = template.next_period_index;
  const nextCycle =
    nextPeriodIndex === LATEST_PERIOD_INDEX
      ? null
      : parseCycle(
          await callViewFunction(
            config.nodeUrl,
            registryAccountId,
            "get_cycle",
            {
              cycle_key: {
                template_id: LIVE_TEMPLATE_ID,
                period_index: nextPeriodIndex,
              },
            },
          ),
        );

  return Object.freeze({
    registryAccountId,
    block,
    foundationStatus,
    template,
    latestCycle,
    nextCycle,
  });
}
