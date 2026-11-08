import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibleWalletChooser,
  dialogFocusIndex,
} from "./wallet-modal-accessibility.ts";

// Minimal owned-root test double, not a mounted React/browser DOM harness.
class ElementStub {
  attrs = new Map<string, string>();
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  tabIndex = 0;
  isConnected = true;
  visible = true;
  listeners = new Map<string, EventListener>();
  readonly kind: string;
  readonly ownerDocument: DocumentStub;
  constructor(kind: string, ownerDocument: DocumentStub) {
    this.kind = kind;
    this.ownerDocument = ownerDocument;
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  contains(target: unknown): boolean {
    return (
      target === this || this.children.some((child) => child.contains(target))
    );
  }
  querySelector(selector: string): ElementStub | null {
    const kind =
      selector === ".nws-modal-background"
        ? "dialog"
        : selector === ".nws-modal-title"
          ? "title"
          : "close";
    return (
      this.children.find((element) => element.kind === kind) ??
      this.children
        .map((element) => element.querySelector(selector))
        .find(Boolean) ??
      null
    );
  }
  querySelectorAll() {
    return this.children.filter((child) =>
      ["close", "button"].includes(child.kind),
    );
  }
  getClientRects() {
    return this.visible ? [{}] : [];
  }
  closest() {
    return null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  addEventListener(name: string, callback: EventListener) {
    this.listeners.set(name, callback);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
}
class DocumentStub {
  activeElement: ElementStub | null = null;
  listeners = new Map<string, () => void>();
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
}

test("focus index cycles forward/backward, including focus outside or empty dialogs", () => {
  assert.equal(dialogFocusIndex(1, 2, false), 0);
  assert.equal(dialogFocusIndex(0, 2, true), 1);
  assert.equal(dialogFocusIndex(-1, 2, false), 0);
  assert.equal(dialogFocusIndex(-1, 2, true), 1);
  assert.equal(dialogFocusIndex(0, 0, false), null);
});

test("owned-root adapter names dialog/close, enters and traps focus, restores after delayed hide, and cleans up", () => {
  const doc = new DocumentStub();
  const root = new ElementStub("root", doc);
  const dialog = new ElementStub("dialog", doc);
  const title = new ElementStub("title", doc);
  const close = new ElementStub("close", doc);
  const button = new ElementStub("button", doc);
  const opener = new ElementStub("button", doc);
  dialog.children = [title, close, button];
  let changed = () => {};
  let hideEvent = () => {};
  let disconnected = 0;
  let removed = 0;
  let hides = 0;
  const modal = {
    show() {},
    hide() {
      hides++;
    },
    on(_event: "onHide", callback: () => void) {
      hideEvent = callback;
      return {
        remove() {
          removed++;
        },
      };
    },
  };
  const chooser = accessibleWalletChooser(
    modal,
    root as unknown as HTMLElement,
    (callback) => {
      changed = callback;
      return {
        observe(target) {
          assert.strictEqual(target, root);
        },
        disconnect() {
          disconnected++;
        },
      };
    },
  );
  opener.focus();
  chooser.show(opener as unknown as HTMLElement);
  assert.strictEqual(doc.activeElement, opener); // waits for real owned DOM, no timers
  root.children = [dialog];
  changed();
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-labelledby"), title.id);
  assert.equal(close.getAttribute("aria-label"), "Close wallet chooser");
  assert.strictEqual(doc.activeElement, close);
  button.focus();
  let prevented = false;
  root.listeners.get("keydown")!({
    key: "Tab",
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  } as unknown as Event);
  assert.strictEqual(doc.activeElement, close);
  assert.equal(prevented, true);
  root.listeners.get("keydown")!({
    key: "Tab",
    shiftKey: true,
    preventDefault() {},
  } as unknown as Event);
  assert.strictEqual(doc.activeElement, button);
  opener.focus();
  doc.listeners.get("focusin")!();
  assert.strictEqual(doc.activeElement, close);
  hideEvent();
  assert.strictEqual(doc.activeElement, close); // library's close animation not over
  root.children = [];
  changed();
  assert.strictEqual(doc.activeElement, opener);
  assert.equal(doc.listeners.size, 0);
  assert.equal(root.listeners.size, 0);
  assert.equal(dialog.getAttribute("role"), null);
  assert.equal(close.getAttribute("aria-label"), null);
  assert.equal(disconnected, 1);
  chooser.show(opener as unknown as HTMLElement);
  root.children = [dialog];
  changed();
  chooser.dispose();
  assert.equal(hides, 1);
  assert.equal(removed, 1);
  assert.equal(disconnected, 2);
  assert.equal(doc.listeners.size, 0);
});

test("programmatic hide/removal and failed show restore focus without leaked observers", () => {
  const doc = new DocumentStub();
  const root = new ElementStub("root", doc);
  const opener = new ElementStub("button", doc);
  let disconnects = 0;
  const chooser = accessibleWalletChooser(
    {
      show() {
        throw new Error("load failed");
      },
      hide() {},
      on() {
        return { remove() {} };
      },
    },
    root as unknown as HTMLElement,
    () => ({
      observe() {},
      disconnect() {
        disconnects++;
      },
    }),
  );
  assert.throws(
    () => chooser.show(opener as unknown as HTMLElement),
    /load failed/,
  );
  assert.strictEqual(doc.activeElement, opener);
  assert.equal(root.listeners.size, 0);
  assert.equal(doc.listeners.size, 0);
  assert.equal(disconnects, 1);
  chooser.dispose();
});
