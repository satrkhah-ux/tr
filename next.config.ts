import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // puppeteer-core has dynamic requires + must run in Node, not the bundler.
  serverExternalPackages: ["puppeteer-core"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.okx.com",
        pathname: "/cdn/**",
      },
    ],
  },
};

export default nextConfig;
