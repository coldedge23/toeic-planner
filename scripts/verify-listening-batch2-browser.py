"""Second-batch acceptance: disposable browser profiles and synthetic records only."""
import json
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent.parent
base = sys.argv[1].rstrip('/')
output = root / 'out/playwright/batch2'
output.mkdir(parents=True, exist_ok=True)
packs = json.loads((root / 'src/fixtures/listening-pack-audio.json').read_text(encoding='utf-8'))

def records(page):
    return page.evaluate('''async () => {
      const db = await new Promise((resolve,reject) => {const r=indexedDB.open('toeic-planner');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const result = await new Promise((resolve,reject) => {const r=db.transaction('listening_sessions').objectStore('listening_sessions').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close();return result;
    }''')

def active(page):
    return next(s for s in records(page) if s['status'] == 'in_progress')

def row(page, pack):
    return page.locator('.listening-pack-row').filter(has=page.get_by_role('heading', name=pack['title'], exact=False))

def download(page, pack):
    page.get_by_role('button', name='下載' + pack['title'] + '題包', exact=True).click()
    expect(row(page, pack).get_by_text('已完整下載，可離線播放', exact=True)).to_be_visible(timeout=60000)

def play(page):
    page.wait_for_function('document.querySelector("audio")?.readyState >= 2')
    page.locator('audio').click(position={'x': 28, 'y': 25})
    page.wait_for_function('!document.querySelector("audio").paused && document.querySelector("audio").currentTime > 0.05')

errors = []
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    for index, pack in enumerate(packs[3:]):
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/listening')
        expect(page.locator('.listening-pack-row')).to_have_count(6)
        expect(page.get_by_text('共 60 題原創美式英語合成音訊。', exact=False)).to_be_visible()
        if index == 0:
            files = [file['path'] for item in packs[3:] for file in item['files']]
            decoded = page.evaluate('''async ({base, files}) => {
              const audio = new AudioContext();
              try {
                const result = [];
                for (const path of files) {
                  const response = await fetch(base + '/' + path);
                  if (!response.ok) throw new Error('Missing audio: ' + path);
                  const buffer = await audio.decodeAudioData(await response.arrayBuffer());
                  if (!(buffer.duration > 0)) throw new Error('Empty audio: ' + path);
                  result.push({path, duration: buffer.duration});
                }
                return result;
              } finally { await audio.close(); }
            }''', {'base': base, 'files': files})
            assert len(decoded) == 36
            (output / 'audio-decoding.json').write_text(json.dumps(decoded, indent=2), encoding='utf-8')
        page.get_by_role('combobox', name='題包', exact=True).select_option(f"{pack['id']}-v{pack['version']}")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if index == 0:
            page.screenshot(path=str(output / 'desktop.png'), full_page=True)
        page.set_viewport_size({'width': 360, 'height': 800})
        page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right<=0')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        # Interrupt continuous download after the singles have completed.
        blocked = '**/audio/part2-packs/' + pack['id'] + '/v1/*'
        page.route(blocked, lambda route: route.abort())
        page.get_by_role('button', name='下載' + pack['title'] + '題包', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('已完成的下載保留')
        expect(row(page, pack).get_by_text(f"部分已下載（10／{len(pack['files'])} 個音檔）", exact=True)).to_be_visible()
        page.unroute(blocked)
        download(page, pack)
        expect(row(page, packs[0]).get_by_text('尚未下載', exact=True)).to_be_visible()
        page.get_by_label('通勤時間').select_option('15')
        page.get_by_role('button', name='開始聽力練習', exact=True).click()
        expect(page.get_by_role('heading', name='第 1／10 題', exact=True)).to_be_visible()
        assert len({q['id'] for q in active(page)['question_snapshot']}) == 10
        assert page.locator('.listening-transcript').count() == 0
        play(page)
        page.locator('audio').evaluate('(a)=>{a.currentTime=a.duration-0.15;return a.play();}')
        expect(page.get_by_role('button', name='選擇 A', exact=True)).to_be_enabled()
        question = active(page)['question_snapshot'][0]
        page.get_by_role('button', name='選擇 ' + question['correct_key'], exact=True).click()
        expect(page.get_by_role('heading', name='答對 · 正確答案 ' + question['correct_key'], exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(output / f"{pack['id']}-answer.png"), full_page=True)
        page.reload()
        expect(page.locator('.listening-transcript')).to_have_text(question['prompt'])
        page.get_by_role('button', name='結束本次練習', exact=True).click()
        page.get_by_role('combobox', name='題包', exact=True).select_option(f"{pack['id']}-v1")
        page.get_by_label('練習模式').select_option('listen')
        page.get_by_label('通勤時間').select_option('15')
        page.get_by_role('button', name='開始連續收聽', exact=True).click()
        play(page)
        page.locator('audio').evaluate('(a)=>{a.currentTime=42;a.pause();}')
        page.wait_for_function('''async()=>{
          const db=await new Promise(resolve=>{const r=indexedDB.open('toeic-planner');r.onsuccess=()=>resolve(r.result);});
          const items=await new Promise(resolve=>{const r=db.transaction('listening_sessions').objectStore('listening_sessions').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
          return items.some(s=>s.status==='in_progress'&&s.audio_position>=42);
        }''')
        session = active(page)
        page.evaluate('navigator.serviceWorker.ready')
        page.reload()
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        context.set_offline(True)
        page.reload()
        page.wait_for_function('document.querySelector("audio")?.readyState >= 2')
        assert active(page)['id'] == session['id']
        assert page.locator('audio').evaluate('(a)=>a.currentTime') >= 41
        assert page.locator('audio').get_attribute('src').startswith('blob:')
        play(page)
        expect(page.get_by_role('button', name='移除' + pack['title'] + '音訊', exact=True)).to_be_disabled()
        page.screenshot(path=str(output / f"{pack['id']}-offline.png"), full_page=True)
        page.locator('audio').evaluate('(a)=>{a.currentTime=a.duration-0.15;return a.play();}')
        expect(page.get_by_text('本次收聽已結束，不計入作答正確率。', exact=True)).to_be_visible()
        before = records(page)
        page.get_by_role('button', name='移除' + pack['title'] + '音訊', exact=True).click()
        expect(row(page, pack).get_by_text('尚未下載', exact=True)).to_be_visible()
        assert records(page) == before
        results.append({'pack': pack['id'], 'single_audio': 'decoded', 'continuous_audio': 'decoded offline', 'resume_seconds': 42, 'retry': 'passed', 'remove_retains_records': True, 'desktop_width': 1280, 'mobile_width': 360})
        context.close()
    browser.close()
assert not errors, errors
report = {'base': base, 'results': results, 'page_errors': errors, 'iphone_batch2': 'not tested; first-batch user acceptance does not cover new content'}
suffix = 'pages' if '/toeic-planner' in base else 'local'
(output / f'qa-{suffix}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
