import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import { registerSW } from "virtual:pwa-register";
import { repos } from "./storage";
import "./styles.css";

// demo 題庫以固定 id 覆蓋寫入，每次啟動呼叫也不會重複新增。
repos.bank.seedDemo().catch((err) => console.error("demo 題庫寫入失敗", err));

// 註冊 service worker：離線可用；有新版時自動更新
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
