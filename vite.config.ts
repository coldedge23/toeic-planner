import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// GitHub Pages 的網址是 https://<帳號>.github.io/<repo>/，部署時由 workflow 傳入 BASE_PATH=/<repo>/
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 新版部署後自動更新；作答進度存在 IndexedDB，重新載入不會遺失
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "icon.svg"],
      manifest: {
        name: "多益備考 TOEIC PLANNER",
        short_name: "多益備考",
        description: "個人用 TOEIC 備考：閱讀、Part 2 聽力、單字與讀書計畫",
        lang: "zh-Hant",
        theme_color: "#0D2235",
        background_color: "#F3EEDF",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Google Fonts：離線時仍可顯示 Noto Sans TC／Jost
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // 主程式含 React、路由、IndexedDB 與驗證套件，壓縮後約 175 kB；圖表套件已拆到模擬考頁
  build: { chunkSizeWarningLimit: 600 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173 },
});
