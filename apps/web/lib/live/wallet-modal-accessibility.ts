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
  const window = document.defaultView;
  let entryFrame: number | null = null;
  let focusing = false;
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
  const rendered = (element: HTMLElement): boolean => {
    if (
      !element.isConnected ||
      !element.getClientRects().length ||
      element.closest("[hidden], [inert]")
    )
      return false;
    const style = window?.getComputedStyle(element);
    return (
      style?.display !== "none" &&
      style?.visibility !== "hidden" &&
      style?.visibility !== "collapse"
    );
  };
  const opening = () => {
    const wrapper = dialog?.closest(".nws-modal-wrapper");
    return (
      active &&
      !closing &&
      Boolean(dialog) &&
      !wrapper?.classList.contains("closing")
    );
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
            rendered(element),
        )
      : [];
  const focus = (element: HTMLElement) => {
    if (focusing || !rendered(element)) return false;
    focusing = true;
    try {
      element.focus({ preventScroll: true });
      return document.activeElement === element;
    } finally {
      focusing = false;
    }
  };
  const enter = () => {
    if (!opening() || !dialog || !rendered(dialog)) return;
    if (dialog.contains(document.activeElement)) return;
    const targets = focusable();
    const close = dialog.querySelector<HTMLElement>("button.close-button");
    // The close button exists during modalFadeIn's visibility:hidden FROM
    // frame. DOM insertion/rects alone do not mean focus() can succeed.
    const first = close && targets.includes(close) ? close : targets[0];
    if (!first || !focus(first)) focus(dialog);
  };
  const cancelEntry = () => {
    if (entryFrame !== null) window?.cancelAnimationFrame(entryFrame);
    entryFrame = null;
  };
  const scheduleEntry = () => {
    if (!opening() || entryFrame !== null || !window) return;
    // One render opportunity per real mount/mutation/open-animation event.
    // Never self-reschedule or poll while hidden. animationend/cancel handles
    // the library's 200ms opening transition; a plain/reduced-motion render
    // needs only this frame.
    entryFrame = window.requestAnimationFrame(() => {
      entryFrame = null;
      enter();
    });
  };
  const animationSettled = (event: AnimationEvent) => {
    if (!dialog) return;
    const wrapper = dialog.closest(".nws-modal-wrapper");
    if (
      (event.target === wrapper && event.animationName === "modalFadeIn") ||
      (event.target === dialog && event.animationName === "modalScaleIn")
    )
      scheduleEntry();
  };
  const keydown = (event: KeyboardEvent) => {
    if (!opening() || !dialog || event.key !== "Tab") return;
    // Temporary document-capture listener: BODY/outside Tab never bubbles
    // through the owned root. No handling after close/dispose, or for Escape.
    event.preventDefault();
    if (!rendered(dialog)) {
      scheduleEntry();
      return;
    }
    const targets = focusable();
    const index = dialogFocusIndex(
      targets.indexOf(document.activeElement as HTMLElement),
      targets.length,
      event.shiftKey,
    );
    focus(index === null ? dialog : targets[index]!);
  };
  const focusin = () => {
    if (opening() && dialog && !dialog.contains(document.activeElement))
      enter();
  };
  const finish = () => {
    active = false;
    cancelEntry();
    observer?.disconnect();
    observer = null;
    document.removeEventListener("keydown", keydown, true);
    root.removeEventListener("animationend", animationSettled);
    root.removeEventListener("animationcancel", animationSettled);
    document.removeEventListener("focusin", focusin);
    for (const restore of undo.splice(0).reverse()) restore();
    dialog = null;
    if (opener?.isConnected && !opener.hasAttribute("disabled")) focus(opener);
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
    if (changed || !dialog.contains(document.activeElement)) scheduleEntry();
  };
  const subscription = modal.on("onHide", () => {
    closing = true;
    cancelEntry();
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
        attributeFilter: ["class", "style", "hidden", "disabled", "inert"],
      });
      document.addEventListener("keydown", keydown, true);
      root.addEventListener("animationend", animationSettled);
      root.addEventListener("animationcancel", animationSettled);
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
