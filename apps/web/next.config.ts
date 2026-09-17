import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@veladesk/desktop-engine",
    "@veladesk/desktop-interaction",
  ],
};

export default nextConfig;
