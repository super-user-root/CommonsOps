// Read-only stdin helper for the public curl examples. Reuse the existing
// bounded/duplicate-safe RPC parser and fatal UTF-8 contract-result decoder.
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodeCallFunctionResult,
  parseRpcEnvelope,
  RPC_LIMITS,
} from "../packages/near/src/read-only-rpc.ts";

export function decodeRpcView(raw: string): unknown {
  return decodeCallFunctionResult(parseRpcEnvelope(raw).result);
}

export async function decodeStdin(
  input: AsyncIterable<Uint8Array>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of input) {
    length += chunk.byteLength;
    if (length > RPC_LIMITS.maxResponseBytes)
      throw new Error("ERR_RPC_RESPONSE_LIMIT");
    chunks.push(chunk);
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
  // Serialize the decoded JSON value (object/string/null), never the byte array.
  return `${JSON.stringify(decodeRpcView(raw), null, 2)}\n`;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Usage: curl ... | node tests/decode-rpc-view.ts");
    process.stdout.write(await decodeStdin(process.stdin));
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : "Invalid RPC response" })}\n`,
    );
    process.exitCode = 1;
  }
}
