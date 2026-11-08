# CommonsOps demo guide

**Hosted workspace:** <https://super-user-root.github.io/CommonsOps/>.
No wallet is needed to read. [Recorded proof](https://super-user-root.github.io/CommonsOps/#journey)
works without RPC; the separate [live registry](https://super-user-root.github.io/CommonsOps/#live-registry)
uses current final-block reads or shows a real unavailable/Retry state. Never
interpret the recorded PAID card as today's live result.

**Public X demo post: pending human publication.** No public post URL has been
supplied. These repository assets do not establish that a post was published,
attached to a post, or that the project was submitted. If judges cannot open the
hosted demo, the official rules require a public video rather than screenshots
alone. Future hosting availability is an ongoing obligation, not a guarantee.

## A short judge tour

1. See the outcome: recurring public work, immutable evidence identity, and a
   recorded **0.5 NEAR DAO payout**. The registry does not verify work quality,
   authorship or merge status; reviewers still assess the public PR.
2. Open the recorded operator, contributor and reviewer disclosures. Full wire
   values, SHA, timestamps, receipt graph and unsigned intent panels remain in
   HTML and can be expanded with a keyboard, without JavaScript disclosure code.
3. Try a live read. Select one template for detail/actions; availability comes
   from validated state and block time. If RPC is unavailable, use the explicit
   **View recorded testnet evidence — not a live result** link.
4. Cycle **2:0 is one global shared slot**, not one per judge. The first claimant
   occupies it. Only an active unsubmitted claim can be released; immutable
   evidence submission prevents release. No payout is guaranteed. See the
   [release guide](../docs/testnet-journey.md#shared-demo-slot).
5. Repeat `node --test tests/e2e/e2e-replay.test.ts` offline. No wallet, available
   slot, new provisioned cycle or current RPC success is required.

Operator provisioning and DAO governance/payout are external handoffs, not
in-app actions. CommonsOps holds no DAO payout funds; registry storage collateral
is retained. Testnet wallet selection is optional; browsing must never sign or
send on the visitor's behalf.

## Current compact-tour captures

The following PNGs were captured from source commit
[`f59065c`](https://github.com/super-user-root/CommonsOps/commit/f59065c9958ee2ae1ddb360a0dda1d7eb71b43c5)
on 2026-11-09 through the browser capture tool, using a locally served
production build. They are native viewport captures, not upscaled images or a
claim of high-DPI capture. Keyboard focus outlines are intentionally visible.

| Current capture                                                                              | Viewport   | What was observed                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [10-compact-overview-desktop.png](screenshots/10-compact-overview-desktop.png)               | 1280 × 720 | Product overview with separate live and recorded-proof routes; the 0.5 NEAR result is explicitly recorded.                                                     |
| [11-recorded-payout-expanded.png](screenshots/11-recorded-payout-expanded.png)               | 1280 × 720 | The recorded payout disclosure is open, with the approval-versus-payment warning and recorded fixture provenance visible; full receipt details continue below. |
| [12-live-unavailable-recorded-route.png](screenshots/12-live-unavailable-recorded-route.png) | 1280 × 720 | A real RPC failure, Retry, and an explicitly non-live recorded-evidence route. No live data or successful claim was fabricated.                                |
| [13-compact-overview-mobile.png](screenshots/13-compact-overview-mobile.png)                 | 390 × 844  | Mobile navigation and the two entry routes at their actual viewport size; more recorded-outcome content continues below the frame.                             |

These images demonstrate the captured UI and states, not provider uptime,
current shared-slot availability, wallet signing, or a published X post.

## Screenshot inventory — archival, not the current layout

The existing files below were last refreshed in public commit
[`5b290d2`](https://github.com/super-user-root/CommonsOps/commit/5b290d2),
2026-11-08 (navigation/footer-era build, before the compact disclosure tour).
They are retained as **historical captures**, not current UI/availability proof.
This inventory follows public Git history; exact individual capture timestamps
and device pixel ratios are not asserted. Full images are linked rather than
scaled into a long default README.

| Historical file                                                            | What the frame records                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [01-hero.png](screenshots/01-hero.png)                                     | Earlier hero and recorded-journey banner.                                                                          |
| [02-network-boundary.png](screenshots/02-network-boundary.png)             | Earlier testnet/mainnet configuration presentation.                                                                |
| [03-operator.png](screenshots/03-operator.png)                             | Recorded template-0 create/materialize intent previews, signing disabled.                                          |
| [04-contributor.png](screenshots/04-contributor.png)                       | Recorded CLAIMED cycle 0:0 and public PR #17 evidence preview.                                                     |
| [05-reviewer-approved-only.png](screenshots/05-reviewer-approved-only.png) | Approval-only boundary: PENDING_PAYMENT_EVIDENCE, not a payout.                                                    |
| [06-reviewer-paid.png](screenshots/06-reviewer-paid.png)                   | Recorded proposal-0 receipt graph through the production reviewer; derived PAID.                                   |
| [07-state-gallery.png](screenshots/07-state-gallery.png)                   | Illustrative state patterns, not live requests.                                                                    |
| [08-truth-panel.png](screenshots/08-truth-panel.png)                       | Earlier implementation/boundary summary.                                                                           |
| [09-live-registry.png](screenshots/09-live-registry.png)                   | Historical live-read presentation. Any displayed OPEN slot was only an observation then, not current claimability. |

The compact-tour captures above replace these frames as the current layout
illustrations. The archive remains useful for historical context, but it does
not establish present focus behavior, network results, or slot availability.

## Recorded evidence provenance

The recorded stages are separate frozen snapshots of the executed journey;
later evidence does not mutate the earlier claim/operator preview. The reviewer
uses [`apps/web/lib/fixtures/proposal-0-paid.json`](../apps/web/lib/fixtures/proposal-0-paid.json),
the recorded `EXPERIMENTAL_tx_status` response for
`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`, imported through
`buildReviewerModel`. Its causal payout receipt is
`EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`. This is the documented
0.5 NEAR payout, not a synthetic transaction or a fresh network response.

The [journey record](../docs/testnet-journey.md) contains the successful
transaction links from deployment through immutable linkage. Historical
[release verification](../docs/release-verification.md) preserves deployment
hash/receipt JSON and scopes byte equality to the measured Windows environment;
Linux build bytes differ. No current browser observation is inferred from either.

## Reproduce without changing chain state

Follow [toolchain and cache setup](../docs/COMMANDS.md#setup-network-allowed), then:

```text
pnpm verify:offline
node --test tests/e2e/e2e-replay.test.ts
pnpm start
```

Open `http://127.0.0.1:3000`. For a separate bounded historical chain check:

```text
node scripts/smoke-testnet.mjs commonsops.testnet --stdout-only
node scripts/reconcile-live.mjs --stdout-only
```

These commands sign nothing and preserve stored artifacts. Success prints the
verified historical fields plus actual `runProvenance`; failure exits 1 with
`FAILED` on stderr. On 2026-11-08, the commands were verified once each at
`9264cf3b14d408dff5d3e71990d9a41934406abd`, with official archival success after
two primary timeouts (26.416s smoke, 15.549s reconciliation). This is a dated
observation, not a provider uptime promise or a live-template availability test.
See [COMMANDS](../docs/COMMANDS.md) for bounds, source checks and output semantics.
