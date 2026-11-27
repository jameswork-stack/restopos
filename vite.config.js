import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      strategies: "generateSW",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],

      manifest: {
        name: "Restopos",
        short_name: "resto",
        description:
          "Inventory and Point of Sale Management System",

        theme_color: "#2563eb",
        background_color: "#ffffff",

        display: "standalone",
        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        navigateFallback: "/index.html",

        navigateFallbackDenylist: [
          /^\/api\//,
        ],

        globPatterns: [
          "**/*.{js,css,html,ico,png,jpg,jpeg,svg,webp,woff,woff2,json}",
        ],

        maximumFileSizeToCacheInBytes:
          5 * 1024 * 1024,
      },
    }),
  ],

  build: {
    outDir: "dist",
  },
});