import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the system installable as an app on phones
 * (Android "Add to Home screen" / install prompt; iOS via Safari share menu).
 * Served automatically at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ترافليون — نظام العمليات السياحية",
    short_name: "Traveliun",
    description: "نظام ترافليون لإدارة العروض والبكجات السياحية",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#eef3f1",
    theme_color: "#185045",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
