import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const url = 'http://localhost:5173/';

if (!existsSync(vite)) {
  console.error('尚未安裝專案套件。請在專案資料夾執行 npm install 後再開啟。');
  process.exit(1);
}

console.log('正在啟動多益練習 APP，準備好後會自動開啟瀏覽器。');
console.log('使用期間請保留此視窗；結束時按 Ctrl+C。');
console.log('固定使用 localhost:5173，避免切換網址造成學習紀錄看似消失。');

const server = spawn(process.execPath, [vite, '--host', 'localhost', '--port', '5173', '--strictPort'], {
  cwd: root,
  env: { ...process.env, BASE_PATH: '/' },
  stdio: ['inherit', 'pipe', 'inherit'],
});
let opened = false;
let output = '';
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  output = (output + chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-4000);
  if (!opened && output.includes(url)) {
    opened = true;
    // 測試時可略過開啟瀏覽器，仍使用相同啟動流程。
    if (process.env.TOEIC_LAUNCHER_NO_BROWSER !== '1') {
      const browser = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' });
      browser.on('error', () => console.error(`無法自動開啟瀏覽器，請手動開啟 ${url}`));
    }
  }
});
server.on('error', (error) => {
  console.error(`啟動失敗：${error.message}`);
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  if (code && !signal) {
    console.error('若 5173 已被使用，請先關閉原本的本機網站視窗，再重試；也可直接開啟 http://localhost:5173/。');
  }
  process.exitCode = code ?? 0;
});
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill());
