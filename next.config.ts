import type { NextConfig } from "next";

// Netlify sets NETLIFY="true" during its build. There, the Next.js runtime
// (@netlify/plugin-nextjs / OpenNext) emits its own serverless + edge output, so
// we must NOT produce a standalone server. The Coolify/VPS/Docker path (which
// runs `node server.js`) still needs standalone — keep it everywhere but Netlify.
const isNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  ...(isNetlify ? {} : { output: "standalone" }),
  devIndicators: false,
  // Must run in Node and never be bundled: puppeteer-core has dynamic requires;
  // @sparticuz/chromium ships a native Chromium binary used on serverless hosts.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // The PDF + OG-image functions read the Tajawal fonts (and, on serverless, the
  // Chromium binary) at runtime via process.cwd(). Next's file tracing can't see
  // those dynamic reads, so force the assets into the function bundles that use
  // them — otherwise Netlify Functions ENOENT on the fonts / find no browser.
  outputFileTracingIncludes: {
    "/offer/[serial]/pdf": ["./public/fonts/**", "./node_modules/@sparticuz/chromium/**"],
    "/client-offer/[serial]/pdf": ["./public/fonts/**", "./node_modules/@sparticuz/chromium/**"],
    "/offer/[serial]/image": ["./public/fonts/**"],
  },
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
