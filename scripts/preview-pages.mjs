// 在本機模擬 GitHub Pages：以 /toeic-planner/ 為根路徑建置，複製 404.html，再啟動預覽伺服器
import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";

const env = { ...process.env, BASE_PATH: "/toeic-planner/" };
execSync("npx vite build", { stdio: "inherit", env });
copyFileSync("dist/index.html", "dist/404.html");
execSync("npx vite preview --port 4173 --strictPort", { stdio: "inherit", env });
