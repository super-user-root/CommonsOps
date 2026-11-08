// modal-ui 10.1.4 supports show/hide/onHide, but has no dialog/close-label or
// focus options. Adapt only its owned root, without replacing wallet UI/signing,
// changing page DOM, polling, or taking over the library's delayed Escape close.
export const WALLET_MODAL_ROOT_ID = "near-wallet-selector-modal";
interface ModalLifecycle {
  show(): void;
  hide(): void;
  on(event: "onHide", callback: () => void): { remove(): void };
}
export interface WalletChooser {
  show(opener?: HTMLElement | null): void;
  dispose(): void;
}

export function dialogFocusIndex(
  current: number,
  count: number,
  backwards: boolean,
): number | null {
  if (count === 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

export function accessibleWalletChooser(
  modal: ModalLifecycle,
  root: HTMLElement,
  observe: (
    onChange: () => void,
  ) => Pick<MutationObserver, "observe" | "disconnect"> = (callback) =>
    new MutationObserver(callback),
): WalletChooser {
  const document = root.ownerDocument;
  let observer: ReturnType<typeof observe> | null = null;
  let dialog: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  let active = false;
  let seen = false;
  let closing = false;
  const undo: Array<() => void> = [];
  const patch = (element: HTMLElement, name: string, value: string) => {
    if (element.getAttribute(name) === value) return;
    const prior = element.getAttribute(name);
    element.setAttribute(name, value);
    undo.push(() => {
      if (element.getAttribute(name) !== value) return;
      if (prior === null) element.removeAttribute(name);
      else element.setAttribute(name, prior);
    });
  };
  const focusable = () =>
    dialog
      ? Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.hasAttribute("disabled") &&
            element.getClientRects().length > 0 &&
            !element.closest("[hidden], [inert]"),
        )
      : [];
  const enter = () => {
    if (!dialog) return;
    const close = dialog.querySelector<HTMLElement>("button.close-button");
    (close ?? focusable()[0] ?? dialog).focus();
  };
  const keydown = (event: KeyboardEvent) => {
    if (!active || !dialog || event.key !== "Tab") return;
    const targets = focusable();
    const index = dialogFocusIndex(
      targets.indexOf(document.activeElement as HTMLElement),
      targets.length,
      event.shiftKey,
    );
    event.preventDefault();
    (index === null ? dialog : targets[index]!).focus();
  };
  const focusin = () => {
    if (active && dialog && !dialog.contains(document.activeElement)) enter();
  };
  const finish = () => {
    active = false;
    observer?.disconnect();
    observer = null;
    root.removeEventListener("keydown", keydown);
    document.removeEventListener("focusin", focusin);
    for (const restore of undo.splice(0).reverse()) restore();
    dialog = null;
    if (opener?.isConnected && !opener.hasAttribute("disabled")) opener.focus();
    opener = null;
  };
  const sync = () => {
    if (!active) return;
    const next = root.querySelector<HTMLElement>(".nws-modal-background");
    if (!next) {
      if (seen || closing) finish();
      return;
    }
    const changed = dialog !== next;
    dialog = next;
    seen = true;
    patch(dialog, "role", "dialog");
    patch(dialog, "aria-modal", "true");
    patch(dialog, "tabindex", "-1");
    const title = dialog.querySelector<HTMLElement>(".nws-modal-title");
    if (title) {
      if (!title.id) patch(title, "id", "commonsops-wallet-chooser-title");
      patch(dialog, "aria-labelledby", title.id);
    } else patch(dialog, "aria-label", "Connect testnet wallet");
    const close = dialog.querySelector<HTMLElement>("button.close-button");
    if (close) patch(close, "aria-label", "Close wallet chooser");
    if (changed || !dialog.contains(document.activeElement)) enter();
  };
  const subscription = modal.on("onHide", () => {
    closing = true;
    // The library keeps its DOM for a 200ms close transition. The root observer
    // restores focus when it is actually removed, not while it is still a dialog.
    sync();
  });
  return {
    show(returnFocus = document.activeElement as HTMLElement | null) {
      if (active) return;
      active = true;
      seen = false;
      closing = false;
      opener = returnFocus;
      observer = observe(sync);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "disabled"],
      });
      root.addEventListener("keydown", keydown);
      document.addEventListener("focusin", focusin);
      try {
        modal.show();
        sync();
      } catch (error) {
        finish();
        throw error;
      }
    },
    dispose() {
      subscription.remove();
      if (active) modal.hide();
      finish();
    },
  };
}
