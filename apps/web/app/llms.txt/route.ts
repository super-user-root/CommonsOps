import { readCanonicalAiIndex } from "../../lib/ai-index.ts";

// Read at build time in normal production AND the Pages static export.
export const dynamic = "force-static";

export async function GET() {
  return new Response(await readCanonicalAiIndex(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
