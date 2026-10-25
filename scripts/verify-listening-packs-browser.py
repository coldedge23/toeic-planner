"""Per-pack/offline acceptance in disposable contexts, with synthetic legacy v5 data."""
import json
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parent.parent
base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4186').rstrip('/')
output = root / '.impeccable/review/packs'
output.mkdir(parents=True, exist_ok=True)
packs = json.loads((root / 'src/fixtures/listening-pack-audio.json').read_text(encoding='utf-8'))
questions = json.loads((root / 'src/fixtures/listening-part2.json').read_text(encoding='utf-8'))
legacy = json.loads((root / 'src/fixtures/listening-audio.json').read_text(encoding='utf-8'))

def rows(page):
    return page.evaluate("""async () => {
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('toeic-planner');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const rows=await new Promise((resolve,reject)=>{const r=db.transaction('listening_sessions').objectStore('listening_sessions').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close(); return rows;
    }""")

def active(page):
    return next((s for s in rows(page) if s['status'] == 'in_progress'), None)

def overflow(page):
    size = page.evaluate('({width:innerWidth, scrollWidth:document.documentElement.scrollWidth})')
    assert size['scrollWidth'] <= size['width'], size
    return size

def capture(page, name):
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(output / name), full_page=True)

def packrow(page, name):
    return page.locator('.listening-pack-row').filter(has=page.get_by_role('heading', name=name, exact=False))

def choose(page, index):
    try:
        expect(page.get_by_role('combobox', name='題包', exact=True)).to_be_visible()
        page.get_by_role('combobox', name='題包', exact=True).select_option(f"{packs[index]['id']}-v{packs[index]['version']}")
    except Exception:
        print(page.locator('body').inner_text().encode('unicode_escape').decode())
        print(json.dumps(rows(page),ensure_ascii=True))
        capture(page,'failure.png')
        raise

def download(page, index):
    name = packs[index]['title']
    page.get_by_role('button', name='下載' + name + '題包', exact=True).click()
    expect(packrow(page, name).get_by_text('已完整下載，可離線播放', exact=True)).to_be_visible(timeout=60000)

def playable(page):
    page.wait_for_function('document.querySelector("audio")?.readyState >= 2')

def play(page):
    playable(page)
    page.locator('audio').click(position={'x':28,'y':25})
    page.wait_for_function('!document.querySelector("audio").paused && document.querySelector("audio").currentTime > 0.05')

def end_audio(page):
    page.locator('audio').evaluate('(a)=>{a.currentTime=a.duration-0.15;return a.play();}')

def offline_reload(page, context):
    page.evaluate('navigator.serviceWorker.ready')
    page.reload()
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    context.set_offline(True)
    page.reload()
    expect(page.get_by_role('heading', name='聽力練習', exact=True)).to_be_visible()

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome', headless=True)
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base+'/listening')
    expect(page.get_by_role('heading', name='聽力練習', exact=True)).to_be_visible()
    expect(page.locator('.listening-pack-row')).to_have_count(len(packs))
    for pack in packs:
        expect(packrow(page, pack['title']).get_by_text('尚未下載', exact=True)).to_be_visible()
    download(page,0)
    expect(packrow(page,packs[1]['title']).get_by_text('尚未下載',exact=True)).to_be_visible()
    capture(page,'desktop.png'); desktop=overflow(page)
    page.set_viewport_size({'width':360,'height':800})
    page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right<=0')
    capture(page,'mobile.png'); mobile=overflow(page)
    page.get_by_role('button',name='開始聽力練習',exact=True).click()
    expect(page.get_by_role('heading',name='第 1／5 題',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='移除資訊問答音訊',exact=True)).to_be_disabled()
    assert page.locator('.listening-transcript').count()==0
    play(page); end_audio(page)
    expect(page.get_by_role('button',name='選擇 A',exact=True)).to_be_enabled()
    s=active(page); q=s['question_snapshot'][0]
    assert all(item['id'] in packs[0]['question_ids'] for item in s['question_snapshot'])
    wrong=next(k for k in ('A','B','C') if k!=q['correct_key'])
    page.get_by_role('button',name='選擇 '+wrong,exact=True).click()
    expect(page.get_by_role('heading',name='答錯 · 正確答案 '+q['correct_key'])).to_be_visible()
    capture(page,'mobile-review.png'); overflow(page)
    page.reload()
    expect(page.locator('.listening-transcript')).to_have_text(q['prompt'])
    page.get_by_role('button',name='下一題',exact=True).click()
    expect(page.get_by_role('heading',name='第 2／5 題',exact=True)).to_be_visible()
    page.get_by_role('button',name='結束本次練習',exact=True).click()
    choose(page,0); page.get_by_label('題目來源').select_option('mistakes')
    expect(page.get_by_text('此題包錯題（1 題）',exact=True)).to_be_attached()
    choose(page,1); page.get_by_label('題目來源').select_option('mistakes')
    expect(page.get_by_text('此題包錯題（0 題）',exact=True)).to_be_attached()
    expect(page.get_by_role('button',name='開始聽力練習',exact=True)).to_be_disabled()
    download(page,1)
    choose(page,2); page.get_by_label('通勤時間').select_option('15')
    page.get_by_role('button',name='開始聽力練習',exact=True).click()
    expect(page.get_by_role('heading',name='第 1／6 題',exact=True)).to_be_visible()
    assert len({q['id'] for q in active(page)['question_snapshot']})==6
    page.get_by_role('button',name='結束本次練習',exact=True).click()
    # 阻斷新包連續音檔，檢查單題已完成的部分下載可重試。
    blocked='**/audio/part2-packs/part2-indirect/v1/*'
    page.route(blocked,lambda route:route.abort())
    page.get_by_role('button',name='下載間接回應與確認題包',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('「間接回應與確認」音訊下載未完成，已完成的下載保留。請確認網路後按「繼續下載」重試。')
    expect(packrow(page,packs[2]['title']).get_by_text('部分已下載（6／7 個音檔）',exact=True)).to_be_visible()
    expect(packrow(page,packs[0]['title']).get_by_text('已完整下載，可離線播放',exact=True)).to_be_visible()
    capture(page,'mobile-partial.png')
    page.unroute(blocked)
    download(page,2)
    page.get_by_label('練習模式').select_option('listen')
    expect(page.get_by_text('播放 6 題，實際約 3 分 17 秒',exact=False)).to_be_visible()
    page.get_by_role('button',name='開始連續收聽',exact=True).click()
    play(page)
    page.locator('audio').evaluate('(a)=>{a.currentTime=42;a.pause();}')
    page.wait_for_function("""async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('toeic-planner');r.onsuccess=()=>resolve(r.result);});
      const records=await new Promise(resolve=>{const r=db.transaction('listening_sessions').objectStore('listening_sessions').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
      return records.some(s=>s.status==='in_progress'&&s.audio_position>=42);
    }""")
    offline_reload(page,context)
    expect(page.get_by_role('heading',name='連續收聽 · 6 題',exact=True)).to_be_visible()
    playable(page)
    assert page.locator('audio').get_attribute('src').startswith('blob:')
    assert page.locator('audio').evaluate('(a)=>a.currentTime')>=41
    expect(page.get_by_role('button',name='移除間接回應與確認音訊',exact=True)).to_be_disabled()
    # 移除另一包可立即釋放空間，不中斷目前的 Blob 播放。
    page.get_by_role('button',name='移除職場互動音訊',exact=True).click()
    expect(packrow(page,packs[1]['title']).get_by_text('尚未下載',exact=True)).to_be_visible()
    play(page); capture(page,'mobile-offline.png'); overflow(page)
    end_audio(page)
    expect(page.get_by_text('本次收聽已結束，不計入作答正確率。',exact=True)).to_be_visible()
    expect(page.get_by_text('今日已作答 1 題 · 答對 0 題',exact=True)).to_be_visible()
    before=rows(page)
    page.get_by_role('button',name='移除資訊問答音訊',exact=True).click()
    expect(packrow(page,packs[0]['title']).get_by_text('尚未下載',exact=True)).to_be_visible()
    assert rows(page)==before
    choose(page,0); page.get_by_label('練習模式').select_option('answer'); page.get_by_label('通勤時間').select_option('5')
    page.get_by_role('button',name='開始聽力練習',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('尚未下載')
    missing=active(page)
    context.set_offline(False)
    download(page,0)
    playable(page)
    assert active(page)['id']==missing['id']
    assert active(page)['question_snapshot']==missing['question_snapshot']
    context.set_offline(True)
    page.reload(); playable(page); play(page)
    assert page.locator('audio').get_attribute('src').startswith('blob:')
    context.close()

    # 另一個全新 context，驗證舊版整包練習與既有錯題可繼續使用。
    old_context=browser.new_context(viewport={'width':360,'height':800})
    old_page=old_context.new_page()
    old_page.on('pageerror',lambda e:errors.append(str(e)))
    old_page.goto(base+'/listening')
    expect(old_page.get_by_role('heading',name='聽力練習',exact=True)).to_be_visible()
    qs={q['id']:q for q in questions}
    stamp='2026-10-14T00:00:00.000Z'
    old={'id':'00000000-0000-4000-8000-000000000001','created_at':stamp,'updated_at':stamp,'mode':'listen','minutes':5,'status':'in_progress','revision':0,'position':0,'audio_position':42,'answers':[],'question_snapshot':[qs[id] for id in legacy['playlists'][0]['ids']]}
    answered={**old,'id':'00000000-0000-4000-8000-000000000002','mode':'answer','status':'completed','position':1,'audio_position':0,'question_snapshot':[qs['L2-001'],qs['L2-002']],'answers':[{'question_id':'L2-001','selected':'A','answered_at':stamp}]}
    old_page.evaluate("""async records=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('toeic-planner');r.onsuccess=()=>resolve(r.result);});
      await new Promise((resolve,reject)=>{const t=db.transaction('listening_sessions','readwrite');for(const s of records)t.objectStore('listening_sessions').add(s);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
    }""",[old,answered])
    old_page.reload()
    expect(old_page.get_by_text('沿用原本的題目、音檔與進度',exact=False)).to_be_visible()
    old_page.get_by_role('button',name='補下載舊版音訊',exact=True).click()
    expect(old_page.get_by_text('舊版快取 33／33 個音檔',exact=False)).to_be_visible(timeout=60000)
    offline_reload(old_page,old_context)
    playable(old_page)
    assert active(old_page)['question_snapshot']==old['question_snapshot']
    assert old_page.locator('audio').evaluate('(a)=>a.currentTime')>=41
    assert old_page.locator('audio').get_attribute('src').startswith('blob:')
    capture(old_page,'mobile-legacy.png'); overflow(old_page)
    play(old_page); end_audio(old_page)
    expect(old_page.get_by_text('本次收聽已結束，不計入作答正確率。',exact=True)).to_be_visible()
    old_context.set_offline(False)
    choose(old_page,0); download(old_page,0)
    retained=rows(old_page)
    old_page.get_by_role('button',name='移除舊版整包音訊',exact=True).click()
    expect(old_page.get_by_role('heading',name='舊版整包音訊',exact=True)).to_have_count(0)
    assert rows(old_page)==retained
    expect(packrow(old_page,packs[0]['title']).get_by_text('已完整下載，可離線播放',exact=True)).to_be_visible()
    old_context.set_offline(True)
    old_page.get_by_label('題目來源').select_option('mistakes')
    old_page.get_by_role('button',name='開始聽力練習',exact=True).click()
    expect(old_page.get_by_role('heading',name='第 1／1 題',exact=True)).to_be_visible()
    assert active(old_page)['question_snapshot'][0]['id']=='L2-001'
    play(old_page)
    assert not errors,errors
    report={'base':base,'browser':'isolated Chromium','desktop':desktop,'mobile':mobile,'verified':['individual download','package-filtered questions and mistakes','short pack without repeats','interrupted download retry','offline continuous playback and resume','remove another pack during playback','remove audio preserves records','redownload continues same session','legacy v5 resume','legacy cache reuse and removal','offline legacy mistakes'],'page_errors':errors,'iphone_hardware':'not tested'}
    suffix='pages' if '/toeic-planner' in base else 'local'
    (output/f'qa-{suffix}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))
    browser.close()
