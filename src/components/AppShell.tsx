import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { NAV_ITEMS } from "@/nav";
import { useDaysToExam } from "@/hooks/useSettings";

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const daysToExam = useDaysToExam();

  // 換頁後關閉手機抽屜
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand-title">多益備考</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="開啟選單"
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </header>

      <div className={`drawer-backdrop${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />

      <aside id="sidebar" className={`sidebar${drawerOpen ? " open" : ""}`} aria-label="主選單">
        <div className="brand">
          <div className="brand-title">多益備考</div>
          <div className="brand-sub">TOEIC PLANNER</div>
        </div>
        <nav>
          <ul className="nav">
            {NAV_ITEMS.map((item, i) => (
              <li key={item.path}>
                <NavLink to={item.path} className={({ isActive }) => (isActive ? "active" : undefined)}>
                  <span className="nav-index num">{i + 1}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          {daysToExam === undefined ? null : daysToExam === null ? (
            <span>尚未設定考試日期</span>
          ) : (
            <span>
              距考試<strong className="num">{daysToExam}</strong>天
            </span>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
