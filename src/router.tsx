import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./components/AppShell";
import { SettingsPage } from "./pages/SettingsPage";
import { PlanPage } from "./pages/PlanPage";
import { TodayPage } from "./pages/TodayPage";
import { MockPage } from "./pages/MockPage";
import { MistakesPage } from "./pages/MistakesPage";
import { BankPage } from "./pages/BankPage";
import { SessionPage } from "./pages/SessionPage";
import { ResultPage } from "./pages/ResultPage";

export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/today" replace /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "plan", element: <PlanPage /> },
        { path: "today", element: <TodayPage /> },
        { path: "mock", element: <MockPage /> },
        { path: "mistakes", element: <MistakesPage /> },
        { path: "bank", element: <BankPage /> },
        { path: "sessions/:id", element: <SessionPage /> },
        { path: "sessions/:id/result", element: <ResultPage /> },
        { path: "*", element: <Navigate to="/today" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
