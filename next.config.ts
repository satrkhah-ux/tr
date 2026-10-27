import type { NextConfig } from "next";

// Netlify sets NETLIFY="true" during its build. There, the Next.js runtime
// (@netlify/plugin-nextjs / OpenNext) emits its own serverless + edge output, so
// we must NOT produce a standalone server. The Coolify/VPS/Docker path (which
// runs `node server.js`) still needs standalone — keep it everywhere but Netlify.
const isNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  ...(isNetlify ? {} : { output: "standalone" }),
  devIndicators: false,
  // Uploads go through server actions: a partner's registration carries up to
  // three 5MB documents, a payment its proof, a traveller a passport or visa
  // scan. Next's 1MB action default (and the proxy's 10MB buffer) cut them off.
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
    proxyClientMaxBodySize: "16mb",
  },
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
    "/repackage/flight-card/render": ["./public/fonts/**", "./node_modules/@sparticuz/chromium/**"],
    "/offer/[serial]/image": ["./public/fonts/**"],
  },
  // «إضافة المتصفح»: the linking page and its routes are never shown inside another site's frame
  async headers() {
    const noFrame = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [
      { source: "/extension", headers: noFrame },
      { source: "/extension/:path*", headers: noFrame },
      { source: "/api/ext/:path*", headers: noFrame },
    ];
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
