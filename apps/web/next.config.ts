import type { NextConfig } from "next";

// GitHub Pages deployment builds with COMMONSOPS_STATIC_EXPORT=1 and serve
// the deterministic fixture journey from pre-rendered HTML. The default
// build (pnpm build / pnpm start) is unchanged and stays server-rendered.
const staticExport = process.env.COMMONSOPS_STATIC_EXPORT === "1";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@commonsops/domain", "@commonsops/near"],
  ...(staticExport
    ? {
        output: "export",
        basePath: "/CommonsOps",
        trailingSlash: true,
      }
    : {}),
};

export default config;
