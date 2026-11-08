// Bounded iterative JSON scanner: decoded duplicate keys and grammar are
// checked BEFORE JSON.parse. Lossless numeric mode never rounds U64 tokens.
export interface JsonBounds {
  readonly maxJsonDepth: number;
  readonly maxJsonNodes: number;
  readonly maxJsonWork: number;
}
export class BoundedJsonError extends Error {}
type Frame = {
  kind: "object" | "array";
  state: "first" | "key" | "value" | "colon" | "comma";
  keys?: Set<string>;
};
export function parseBoundedJson(
  text: string,
  bounds: JsonBounds,
  lossless = false,
): unknown {
  const fail = (reason: string): never => {
    throw new BoundedJsonError(reason);
  };
  if (text.length > bounds.maxJsonWork) fail("JSON work limit exceeded.");
  let index = 0;
  let nodes = 0;
  let work = 0;
  let rootDone = false;
  let copied = 0;
  const chunks: string[] = [];
  const stack: Frame[] = [];
  const charge = (amount: number) => {
    work += amount;
    if (work > bounds.maxJsonWork) fail("JSON work limit exceeded.");
  };
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(text[index] ?? "")) {
      index++;
      charge(1);
    }
  };
  const string = (): string => {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === "\\") index++;
      else if (char === '"') {
        charge(index - start);
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          return fail("Invalid JSON string.");
        }
      }
    }
    return fail("Unterminated JSON string.");
  };
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const value = () => {
    nodes++;
    if (nodes > bounds.maxJsonNodes) fail("JSON node limit exceeded.");
    const char = text[index];
    if (char === "{" || char === "[") {
      if (stack.length + 1 > bounds.maxJsonDepth)
        fail("JSON depth limit exceeded.");
      stack.push({
        kind: char === "{" ? "object" : "array",
        state: "first",
        keys: char === "{" ? new Set() : undefined,
      });
      index++;
      charge(1);
      return;
    }
    if (char === '"') {
      string();
      return;
    }
    number.lastIndex = index;
    const digits = number.exec(text)?.[0];
    if (digits) {
      charge(digits.length);
      if (lossless) {
        chunks.push(text.slice(copied, index), JSON.stringify(digits));
        copied = index + digits.length;
      }
      index += digits.length;
      return;
    }
    for (const literal of ["null", "true", "false"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        charge(literal.length);
        return;
      }
    }
    fail("Invalid JSON value.");
  };
  while (true) {
    whitespace();
    const frame = stack.at(-1);
    if (!frame) {
      if (rootDone) break;
      rootDone = true;
      value();
      continue;
    }
    const closing = frame.kind === "object" ? "}" : "]";
    if (frame.state === "first" && text[index] === closing) {
      index++;
      charge(1);
      stack.pop();
      continue;
    }
    if (
      frame.kind === "object" &&
      (frame.state === "first" || frame.state === "key")
    ) {
      if (text[index] !== '"') fail("Invalid JSON object key.");
      const key = string();
      nodes++;
      if (nodes > bounds.maxJsonNodes) fail("JSON node limit exceeded.");
      if (frame.keys!.has(key)) fail("Duplicate JSON member.");
      frame.keys!.add(key);
      frame.state = "colon";
      continue;
    }
    if (frame.state === "colon") {
      if (text[index] !== ":") fail("Missing JSON colon.");
      index++;
      charge(1);
      frame.state = "value";
      continue;
    }
    if (frame.state === "first" || frame.state === "value") {
      frame.state = "comma";
      value();
      continue;
    }
    if (text[index] === closing) {
      index++;
      charge(1);
      stack.pop();
      continue;
    }
    if (text[index] !== ",") fail("Invalid JSON delimiter.");
    index++;
    charge(1);
    frame.state = frame.kind === "object" ? "key" : "value";
  }
  if (index !== text.length) fail("Trailing JSON data.");
  try {
    if (lossless) {
      chunks.push(text.slice(copied));
      return JSON.parse(chunks.join("")) as unknown;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return fail("Invalid JSON.");
  }
}
