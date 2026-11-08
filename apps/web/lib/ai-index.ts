// Server/build-only: resolve the one repository source from a module or build cwd.
// Fixed candidates support source execution, pnpm's web cwd, and repo-root builds.
// No maintained public/ copy, ancestor crawl, or filesystem paths in the response.
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readCanonicalAiIndex(
  moduleDirectory = import.meta.dirname,
  workingDirectory = process.cwd(),
): Promise<string> {
  const candidates = [
    moduleDirectory
      ? path.resolve(/* turbopackIgnore: true */ moduleDirectory, "../../..")
      : null,
    path.resolve(/* turbopackIgnore: true */ workingDirectory),
    path.resolve(/* turbopackIgnore: true */ workingDirectory, "../.."),
  ];
  for (const directory of new Set(candidates)) {
    if (!directory) continue;
    try {
      // force-static evaluates this only at build time; do not trace a dynamic
      // filesystem search into a production server bundle. The canonical file
      // is verified against both served and exported bytes in the build gates.
      const manifest = JSON.parse(
        await readFile(
          /* turbopackIgnore: true */ path.join(directory, "package.json"),
          "utf8",
        ),
      );
      if (manifest.name === "commonsops" && manifest.private === true) {
        return await readFile(
          /* turbopackIgnore: true */ path.join(directory, "llms.txt"),
          "utf8",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("ERR_AI_INDEX_SOURCE");
    }
  }
  throw new Error("ERR_AI_INDEX_SOURCE");
}
