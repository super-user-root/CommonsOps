// Selection is a presentation boundary, never an alternate authorization model.
// Use the same validated cycle view as the contributor builders, including time
// windows and immutable submission. Never infer claimability from status alone.
import type { LiveTemplateRead } from "./registry-reads.ts";
import { SendAuthority, type SendToken } from "./transactions.ts";
import {
  deriveContributorCycleView,
  type ContributorCycleView,
} from "../../src/features/contributor/contributor.ts";

export interface TemplateAvailability {
  readonly templateId: string;
  readonly view: ContributorCycleView | null;
  readonly label: string;
  readonly preference: 0 | 1 | 2;
  readonly error: string | null;
}

export async function deriveTemplateAvailability(
  read: LiveTemplateRead,
  observedBlockTimestampNs: string,
  accountId: string | null,
): Promise<TemplateAvailability> {
  const unavailable = (
    label: string,
    error: string | null = null,
  ): TemplateAvailability => ({
    templateId: read.templateId,
    view: null,
    label,
    preference: 2,
    error,
  });
  if (read.kind === "ERROR")
    return unavailable("Read failed — availability unknown", read.code);
  if (read.paused) return unavailable("Paused — cycles not read by this app");
  const candidates = [read.nextCycle?.cycle, read.latestCycle?.cycle].filter(
    (cycle, index, all) =>
      cycle != null &&
      all.findIndex(
        (entry) => entry?.key.period_index === cycle.key.period_index,
      ) === index,
  );
  if (!candidates.length)
    return unavailable("No materialized cycle — operator action needed");
  try {
    const views = await Promise.all(
      candidates.map((cycle) =>
        deriveContributorCycleView(cycle!, observedBlockTimestampNs, accountId),
      ),
    );
    const ownClaim = views.find(
      (view) => view.activeClaimLive && view.actions.release_claim.allowed,
    );
    const open = views.find(
      (view) => view.lifecycle === "OPEN" && view.workWindowLive,
    );
    const view = ownClaim ?? open ?? views[0]!;
    const label = ownClaim
      ? "Your active claim — release or submit evidence"
      : open
        ? "Open and in-window at the verified block"
        : view.activeClaimLive
          ? "Occupied by another claimant"
          : view.lifecycle === "SUBMITTED"
            ? "Submitted — immutable, cannot release"
            : view.lifecycle === "OPEN"
              ? "Not open yet at the verified block"
              : view.lifecycle === "STALE_CLAIM"
                ? "Claim expired — settlement needed"
                : view.lifecycle === "STALE_CYCLE"
                  ? "Work deadline elapsed — settlement needed"
                  : `${view.lifecycle.toLowerCase()} — no open slot`;
    return {
      templateId: read.templateId,
      view,
      label,
      preference: ownClaim ? 0 : open ? 1 : 2,
      error: null,
    };
  } catch (error) {
    return unavailable(
      "Cycle validation failed — availability unknown",
      error instanceof Error ? error.message : "Invalid cycle",
    );
  }
}

export function preferredTemplate(
  summaries: readonly TemplateAvailability[],
): string | null {
  return (
    summaries.find((entry) => entry.preference === 0)?.templateId ??
    summaries.find((entry) => entry.preference === 1)?.templateId ??
    summaries[0]?.templateId ??
    null
  );
}

// Event handlers call select BEFORE React state updates/unmount effects. Returning
// to an old group cannot resurrect a preparation token captured while it was shown.
export class TemplateSelection {
  private selected: string | null = null;
  private authority = new SendAuthority();
  select(templateId: string | null): void {
    if (templateId !== this.selected) {
      this.authority.invalidate();
      this.selected = templateId;
    }
  }
  capture(templateId: string, signerId: string): SendToken {
    return this.authority.capture(signerId, () => this.selected === templateId);
  }
  dispose(): void {
    this.authority.invalidate();
    this.selected = null;
  }
}
