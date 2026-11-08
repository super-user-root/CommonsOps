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
  visibility = "visible";
  focusCalls = 0;
  listeners = new Map<string, EventListener>();
  get classList() {
    return {
      contains: (name: string) =>
        (this.getAttribute("class") ?? "").split(/\s+/).includes(name),
    };
  }
  append(child: ElementStub) {
    child.parent = this;
    this.children.push(child);
  }
  renderedVisibility(): string {
    return this.parent?.renderedVisibility() === "hidden"
      ? "hidden"
      : this.visibility;
  }
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
  closest(selector: string): ElementStub | null {
    if (selector === ".nws-modal-wrapper" && this.kind === "wrapper")
      return this;
    if (
      selector !== ".nws-modal-wrapper" &&
      (this.hasAttribute("hidden") || this.hasAttribute("inert"))
    )
      return this;
    return this.parent?.closest(selector) ?? null;
  }
  focus() {
    this.focusCalls++;
    if (
      this.isConnected &&
      this.visible &&
      this.renderedVisibility() !== "hidden" &&
      !this.hasAttribute("disabled")
    )
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
  frames = new Map<number, FrameRequestCallback>();
  frameId = 0;
  defaultView = {
    getComputedStyle: (element: ElementStub) => ({
      visibility: element.renderedVisibility(),
      display: element.visible ? "block" : "none",
    }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++this.frameId;
      this.frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      this.frames.delete(id);
    },
  };
  paint() {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const frame of frames) frame(0);
  }
  listeners = new Map<string, (event?: unknown) => void>();
  addEventListener(name: string, callback: (event?: unknown) => void) {
    this.listeners.set(name, callback);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
}

function delayedModalFixture() {
  const doc = new DocumentStub();
  const root = new ElementStub("root", doc);
  const wrapper = new ElementStub("wrapper", doc);
  const dialog = new ElementStub("dialog", doc);
  const title = new ElementStub("title", doc);
  const close = new ElementStub("close", doc);
  const button = new ElementStub("button", doc);
  const opener = new ElementStub("button", doc);
  const body = new ElementStub("body", doc);
  dialog.append(title);
  dialog.append(close);
  dialog.append(button);
  wrapper.append(dialog);
  wrapper.setAttribute("class", "nws-modal-wrapper open");
  wrapper.visibility = "hidden"; // modalFadeIn FROM frame, still has client rects
  doc.activeElement = body;
  let changed = () => {};
  let onHide = () => {};
  let disconnects = 0;
  let removes = 0;
  const chooser = accessibleWalletChooser(
    {
      show() {},
      hide() {},
      on(_event, callback) {
        onHide = callback;
        return {
          remove() {
            removes++;
          },
        };
      },
    },
    root as unknown as HTMLElement,
    (callback) => {
      changed = callback;
      return {
        observe() {},
        disconnect() {
          disconnects++;
        },
      };
    },
  );
  return {
    doc,
    root,
    wrapper,
    dialog,
    close,
    button,
    opener,
    body,
    chooser,
    mount() {
      root.append(wrapper);
      changed();
    },
    changed() {
      changed();
    },
    hide() {
      onHide();
      wrapper.setAttribute("class", "nws-modal-wrapper closing");
    },
    removed() {
      root.children = [];
      changed();
    },
    counts() {
      return { disconnects, removes };
    },
  };
}

test("delayed visible opening enters only after rendering, recovers after animation and restores actual opener", () => {
  const fixture = delayedModalFixture();
  const { doc, chooser, opener, close, wrapper, root, body } = fixture;
  chooser.show(opener as unknown as HTMLElement); // BODY was active; opener supplied explicitly
  fixture.mount();
  doc.paint();
  assert.equal(
    close.focusCalls,
    0,
    "hidden opening frame must not get a focus attempt",
  );
  assert.strictEqual(doc.activeElement, body);
  assert.equal(doc.frames.size, 0, "no recursive animation-frame polling");
  wrapper.visibility = "visible"; // CSS animation does not mutate DOM
  root.listeners.get("animationend")?.({
    target: wrapper,
    animationName: "modalFadeIn",
  } as unknown as Event);
  doc.paint();
  assert.strictEqual(
    doc.activeElement,
    close,
    "focus after owned opening animation becomes visible",
  );
  fixture.hide();
  doc.paint();
  assert.notStrictEqual(
    doc.activeElement,
    opener,
    "do not restore during the 200ms close transition",
  );
  fixture.removed();
  assert.strictEqual(doc.activeElement, opener);
  assert.equal(doc.frames.size, 0);
  assert.equal(doc.listeners.size, 0);
  assert.equal(root.listeners.size, 0);
  assert.equal(fixture.counts().disconnects, 1);
  chooser.dispose();
});

test("document capture handles Tab and Shift+Tab from BODY while preserving official Escape", () => {
  for (const backwards of [false, true]) {
    const fixture = delayedModalFixture();
    const { chooser, opener, doc, wrapper, body, close, button } = fixture;
    chooser.show(opener as unknown as HTMLElement);
    fixture.mount();
    wrapper.visibility = "visible";
    doc.paint();
    doc.activeElement = body; // silent browser focus loss, no focusin in the owned root
    let prevented = false;
    doc.listeners.get("keydown")?.({
      key: "Tab",
      shiftKey: backwards,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.strictEqual(doc.activeElement, backwards ? button : close);
    prevented = false;
    doc.listeners.get("keydown")?.({
      key: "Escape",
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
    chooser.dispose();
    assert.equal(doc.listeners.size, 0);
  }
});

test("pending rendered entry is cancelled on hide/dispose and animation events never resurrect it", () => {
  const fixture = delayedModalFixture();
  const { chooser, opener, doc, wrapper, root, close } = fixture;
  chooser.show(opener as unknown as HTMLElement);
  fixture.mount();
  assert.equal(doc.frames.size, 1);
  wrapper.visibility = "visible";
  fixture.hide();
  doc.paint();
  assert.equal(close.focusCalls, 0);
  fixture.removed();
  chooser.dispose();
  root.listeners.get("animationend")?.({
    target: wrapper,
    animationName: "modalFadeIn",
  } as unknown as Event);
  doc.paint();
  assert.equal(doc.frames.size, 0);
  assert.strictEqual(doc.activeElement, opener);
  assert.equal(root.listeners.size, 0);
});

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
  doc.paint();
  assert.strictEqual(doc.activeElement, close);
  button.focus();
  let prevented = false;
  doc.listeners.get("keydown")!({
    key: "Tab",
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  } as unknown as Event);
  assert.strictEqual(doc.activeElement, close);
  assert.equal(prevented, true);
  doc.listeners.get("keydown")!({
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
