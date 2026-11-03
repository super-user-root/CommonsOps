import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@commonsops/domain", "@commonsops/near"],
};

export default config;
