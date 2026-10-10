import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./components/AppShell";
import { TodayPage } from "./pages/TodayPage";

// 「今日」是首頁，直接打包；其餘頁面按需載入（圖表套件只在模擬考頁載入）
export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/today" replace /> },
        { path: "today", element: <TodayPage /> },
        { path: "settings", lazy: () => import("./pages/SettingsPage").then((m) => ({ Component: m.SettingsPage })) },
        { path: "plan", lazy: () => import("./pages/PlanPage").then((m) => ({ Component: m.PlanPage })) },
        { path: "mock", lazy: () => import("./pages/MockPage").then((m) => ({ Component: m.MockPage })) },
        { path: "mistakes", lazy: () => import("./pages/MistakesPage").then((m) => ({ Component: m.MistakesPage })) },
        { path: "bank", lazy: () => import("./pages/BankPage").then((m) => ({ Component: m.BankPage })) },
        {
          path: "sessions/:id",
          lazy: () => import("./pages/SessionPage").then((m) => ({ Component: m.SessionPage })),
        },
        {
          path: "sessions/:id/result",
          lazy: () => import("./pages/ResultPage").then((m) => ({ Component: m.ResultPage })),
        },
        { path: "*", element: <Navigate to="/today" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
