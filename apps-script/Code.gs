/**
 * 多益題庫 AI 出題（Google Apps Script）
 *
 * 貼在「多益題庫」試算表的「擴充功能 → Apps Script」。
 * - 每天約 06:00 自動出題（時間觸發條件），也可從選單「AI 出題」手動出一批。
 * - 新題目預設寫成「草稿」，審核後改成「已審核」，App 才會匯入。
 * - 「設定」分頁的「自動審核」填「是」時，出題後請 AI 不看正解再作答一次，答案一致的題目直接寫成「已審核」。
 * - 金鑰只放在「專案設定 → 指令碼屬性」：GEMINI_API_KEY 或 CLAUDE_API_KEY。程式碼與試算表都不放金鑰。
 *
 * 檔案分兩段：前半是純函式（不呼叫 Google 服務，可在本機測試），後半是試算表與 API 呼叫。
 */

var SHEET_BANK = '題庫';
var SHEET_SETTINGS = '設定';
var SHEET_LOG = '執行紀錄';
var TZ = 'Asia/Taipei';

/** 題庫欄位順序，需與 App 的 CSV 欄位一致 */
var COLUMNS = ['id', 'part', 'difficulty', 'group_id', 'passage', 'question', 'a', 'b', 'c', 'd',
  'answer', 'explanation', 'tags', 'status', 'version', 'created_at'];

var PART_INFO = {
  5: { label: 'Part 5 句子填空', perGroup: 1 },
  6: { label: 'Part 6 段落填空', perGroup: 4 },
  7: { label: 'Part 7 閱讀理解', perGroup: 3 }
};
var DIFFICULTIES = ['基礎', '中階', '進階'];
/** 模型留白時：gemini 自動挑選可用的最新穩定版 Flash 模型；claude 使用 claude-haiku-5-5 */
var DEFAULT_MODELS = { gemini: '', claude: 'claude-haiku-5-5' };

// ======================== 純函式 ========================

/** 依題數算出要請 AI 出幾組：Part 5 一組一題；Part 6 一篇 4 題；Part 7 一篇 3 題。 */
function planGroups(part, count) {
  var info = PART_INFO[part];
  if (!info) throw new Error('只支援 Part 5、6、7');
  var groups = Math.max(1, Math.ceil(count / info.perGroup));
  return { groups: groups, perGroup: info.perGroup, total: groups * info.perGroup };
}

/** 比對重複用：轉小寫、去掉空白與標點 */
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 從既有編號接續，例如 P5-0007 之後是 P5-0008 */
function nextSerial(existingIds, prefix, width) {
  var max = 0;
  var re = new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '(\\d+)$');
  existingIds.forEach(function (id) {
    var m = re.exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return function () {
    max += 1;
    var n = String(max);
    while (n.length < width) n = '0' + n;
    return prefix + n;
  };
}

/** 回傳給 AI 的 JSON 形狀（Claude 的 structured outputs 使用；Gemini 以提示詞描述） */
function responseSchema() {
  var question = {
    type: 'object',
    additionalProperties: false,
    required: ['question', 'a', 'b', 'c', 'd', 'answer', 'explanation', 'tags'],
    properties: {
      question: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
      c: { type: 'string' },
      d: { type: 'string' },
      answer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      explanation: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }
    }
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['groups'],
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['passage', 'questions'],
          properties: { passage: { type: 'string' }, questions: { type: 'array', items: question } }
        }
      }
    }
  };
}

function buildPrompt(part, difficulty, plan, targetRange, avoid) {
  var lines = [
    '你是 TOEIC Listening & Reading 的出題老師。請出全新、原創的練習題，不可抄襲官方或網路上的試題。',
    '題目與選項用英文；explanation 用繁體中文，說明正解原因並逐一指出錯誤選項的陷阱。',
    '程度：' + difficulty + '（目標分數約 ' + targetRange + '）。tags 用繁體中文的考點名稱，例如「詞性」「時態」「主旨題」。',
    '每題四個選項 a、b、c、d 必須彼此不同，且只有一個正解；answer 只填 A、B、C 或 D。正解位置要平均分散。',
    ''
  ];
  if (part === 5) {
    lines.push('單元：Part 5 句子填空。請出 ' + plan.groups + ' 題。');
    lines.push('每題是一個 groups 項目：passage 填空字串 ""，questions 只放 1 題；question 是一個英文句子，空格寫成 -------（7 個減號）。');
  } else if (part === 6) {
    lines.push('單元：Part 6 段落填空。請出 ' + plan.groups + ' 篇短文（e-mail、公告、備忘錄、廣告等商務情境），每篇 4 題。');
    lines.push('passage 是 90–150 字的英文短文，文中依序標出 [1] [2] [3] [4] 四個空格；其中 1 題是句子插入題（選項為完整句子）。');
    lines.push('questions 依空格順序放 4 題，question 欄依序填 "[1]"、"[2]"、"[3]"、"[4]"。');
  } else {
    lines.push('單元：Part 7 閱讀理解。請出 ' + plan.groups + ' 篇文章（e-mail、公告、廣告、文章、聊天訊息等），每篇 3 題。');
    lines.push('passage 是 120–220 字的英文文章；若要出多篇文章題，兩篇之間用單獨一行 --- 分隔。');
    lines.push('3 題需涵蓋不同題型，例如主旨、細節、推論、同義字；question 是英文問句。');
  }
  if (avoid && avoid.length) {
    lines.push('');
    lines.push('以下是題庫裡已有的題目開頭，請避開相同或相似的內容：');
    avoid.slice(0, 40).forEach(function (s) { lines.push('- ' + s); });
  }
  lines.push('');
  lines.push('只輸出 JSON，不要任何其他文字，格式：{"groups":[{"passage":"...","questions":[{"question":"...","a":"...","b":"...","c":"...","d":"...","answer":"A","explanation":"...","tags":["..."]}]}]}');
  return lines.join('\n');
}

/** 解析 AI 回傳的文字：容許前後有 ``` 圍欄 */
function parseModelJson(text) {
  var s = String(text || '').trim();
  var fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1];
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 回傳的內容不是 JSON');
  var data = JSON.parse(s.slice(start, end + 1));
  if (!data || !Array.isArray(data.groups)) throw new Error('AI 回傳的 JSON 缺少 groups');
  return data;
}

function hasChinese(s) {
  return /[一-鿿]/.test(String(s || ''));
}

/** 檢查一題，回傳錯誤原因；沒問題回傳 null */
function questionProblem(part, q, indexInGroup) {
  if (!q) return '題目為空';
  var opts = ['a', 'b', 'c', 'd'].map(function (k) { return String(q[k] || '').trim(); });
  if (opts.some(function (o) { return !o; })) return '選項不齊全';
  var uniq = {};
  opts.forEach(function (o) { uniq[normalizeText(o)] = true; });
  if (Object.keys(uniq).length !== 4) return '選項重複';
  if (['A', 'B', 'C', 'D'].indexOf(String(q.answer || '').trim().toUpperCase()) === -1) return '正解不是 A–D';
  if (!hasChinese(q.explanation)) return '解析不是繁體中文或空白';
  var stem = String(q.question || '').trim();
  if (part === 5 && stem.indexOf('---') === -1) return 'Part 5 題目沒有空格（-------）';
  if (part === 7 && !stem) return 'Part 7 題目空白';
  if (part === 6 && stem && stem !== '[' + (indexInGroup + 1) + ']') return 'Part 6 空格編號不正確';
  return null;
}

/**
 * 把 AI 的結果轉成要寫入「題庫」的列。
 * 同一組（文章）只要有一題不合格，整組略過，避免文章缺題。
 * existing: 題庫既有資料（每列一個物件，欄位同 COLUMNS）
 */
function buildRows(part, difficulty, data, existing, today, limit) {
  var info = PART_INFO[part];
  var ids = existing.map(function (r) { return r.id; });
  var groupIds = existing.map(function (r) { return r.group_id; });
  var nextId = nextSerial(ids, 'P' + part + '-', 4);
  var nextGroup = nextSerial(groupIds, 'P' + part + '-G', 3);
  var seenStems = {};
  var seenPassages = {};
  existing.forEach(function (r) {
    if (r.question && String(r.question).indexOf('[') !== 0) seenStems[normalizeText(r.question)] = true;
    if (r.passage) seenPassages[normalizeText(r.passage).slice(0, 120)] = true;
  });

  var rows = [];
  var skipped = [];
  (data.groups || []).forEach(function (g, gi) {
    var qs = Array.isArray(g.questions) ? g.questions : [];
    var label = '第 ' + (gi + 1) + ' 組';
    if (qs.length !== info.perGroup) {
      skipped.push(label + '：題數應為 ' + info.perGroup + '，收到 ' + qs.length);
      return;
    }
    var passage = String(g.passage || '').trim();
    if (part !== 5) {
      if (!passage) { skipped.push(label + '：沒有文章'); return; }
      if (part === 6) {
        for (var k = 1; k <= 4; k++) {
          if (passage.indexOf('[' + k + ']') === -1) { skipped.push(label + '：文章缺少空格 [' + k + ']'); return; }
        }
      }
      var pKey = normalizeText(passage).slice(0, 120);
      if (seenPassages[pKey]) { skipped.push(label + '：文章與既有題目重複'); return; }
    }
    for (var i = 0; i < qs.length; i++) {
      var problem = questionProblem(part, qs[i], i);
      if (problem) { skipped.push(label + '：' + problem); return; }
      if (part !== 6) {
        var sKey = normalizeText(qs[i].question);
        if (seenStems[sKey]) { skipped.push(label + '：題目與既有題目重複'); return; }
      }
    }
    if (rows.length + qs.length > limit) { skipped.push(label + '：超過本次寫入上限'); return; }

    // 通過檢查才登記，避免同批重複
    if (part !== 5) seenPassages[normalizeText(passage).slice(0, 120)] = true;
    var groupId = part === 5 ? '' : nextGroup();
    qs.forEach(function (q, i) {
      if (part !== 6) seenStems[normalizeText(q.question)] = true;
      var tags = Array.isArray(q.tags) ? q.tags : String(q.tags || '').split(/[;；,]/);
      rows.push([
        nextId(),
        part,
        difficulty,
        groupId,
        i === 0 ? passage : '',
        part === 6 ? '[' + (i + 1) + ']' : String(q.question).trim(),
        String(q.a).trim(), String(q.b).trim(), String(q.c).trim(), String(q.d).trim(),
        String(q.answer).trim().toUpperCase(),
        String(q.explanation).trim(),
        tags.map(function (t) { return String(t).trim(); }).filter(Boolean).join(';'),
        '草稿',
        1,
        today
      ]);
    });
  });
  return { rows: rows, skipped: skipped };
}

/** 答案複核時 AI 回傳的 JSON 形狀 */
function verifySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'answer'],
          properties: { id: { type: 'string' }, answer: { type: 'string', enum: ['A', 'B', 'C', 'D'] } }
        }
      }
    }
  };
}

/** 答案複核的提示詞：只給題目與選項，不給正解與解析，請 AI 獨立作答 */
function buildVerifyPrompt(rows) {
  var lines = [
    '你是 TOEIC 閱讀測驗的考生。請作答以下每一題，每題只有一個正確答案。',
    '只輸出 JSON，不要任何其他文字，格式：{"answers":[{"id":"題目編號","answer":"A"}]}，answer 只填 A、B、C 或 D。',
    ''
  ];
  var lastGroup = null;
  rows.forEach(function (r) {
    if (r[3] && r[3] !== lastGroup) {
      lines.push('=== Passage (' + r[3] + ') ===');
      lines.push(String(r[4]));
      lines.push('');
    }
    lastGroup = r[3] || null;
    lines.push('[' + r[0] + '] ' + r[5]);
    lines.push('(A) ' + r[6] + '  (B) ' + r[7] + '  (C) ' + r[8] + '  (D) ' + r[9]);
    lines.push('');
  });
  return lines.join('\n');
}

/** 解析複核結果，回傳 { 題目編號: 'A'–'D' } */
function parseVerifyJson(text) {
  var s = String(text || '').trim();
  var fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1];
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('複核回傳的內容不是 JSON');
  var data = JSON.parse(s.slice(start, end + 1));
  if (!data || !Array.isArray(data.answers)) throw new Error('複核回傳的 JSON 缺少 answers');
  var map = {};
  data.answers.forEach(function (a) {
    if (a && a.id) map[String(a.id).trim()] = String(a.answer || '').trim().toUpperCase();
  });
  return map;
}

/**
 * 依複核結果決定狀態：複核答案與正解一致的題目改成「已審核」，不一致或沒作答的維持「草稿」。
 * Part 6／7 同一篇文章的題目只要有一題不一致，整篇維持草稿（文章只寫在第一列，狀態必須一致）。
 * 直接修改 rows，回傳 { approved: 題數, mismatched: [說明] }。
 */
function applyVerification(rows, answers) {
  var badGroups = {};
  var mismatched = [];
  rows.forEach(function (r) {
    var got = answers[r[0]];
    if (got !== r[10]) {
      mismatched.push(r[0] + '（正解 ' + r[10] + '，複核 ' + (got || '未作答') + '）');
      if (r[3]) badGroups[r[3]] = true;
    }
  });
  var approved = 0;
  rows.forEach(function (r) {
    var ok = r[3] ? !badGroups[r[3]] : answers[r[0]] === r[10];
    r[13] = ok ? '已審核' : '草稿';
    if (ok) approved += 1;
  });
  return { approved: approved, mismatched: mismatched };
}

function parseYesNo(text, name) {
  var s = String(text || '').trim();
  if (s === '' || s === '否') return false;
  if (s === '是') return true;
  throw new Error('「' + name + '」須為 是 或 否');
}

/** 依日期決定今天出哪個 Part（台北日期，從 1970-01-01 起算的天數） */
function rotationPart(rotation, dateStr) {
  var days = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
  return rotation[days % rotation.length];
}

/**
 * 從 Gemini ListModels 的結果挑出最新的穩定版 Flash 模型（排除 lite、preview、exp、image、tts、live 等變體）。
 * 找不到穩定版時退而選最新的 Flash 預覽版；都沒有就回傳空字串。
 */
function pickGeminiModel(models) {
  var usable = (models || []).filter(function (m) {
    return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1;
  }).map(function (m) { return String(m.name || '').replace(/^models\//, ''); });
  var version = function (name) {
    var m = /^gemini-(\d+(?:\.\d+)?)-flash/.exec(name);
    return m ? Number(m[1]) : -1;
  };
  var byVersion = function (a, b) { return version(b) - version(a) || a.length - b.length; };
  var stable = usable.filter(function (n) { return /^gemini-\d+(?:\.\d+)?-flash$/.test(n); }).sort(byVersion);
  if (stable.length) return stable[0];
  var preview = usable.filter(function (n) {
    return version(n) >= 0 && !/(lite|image|tts|live|audio|embedding)/.test(n);
  }).sort(byVersion);
  return preview.length ? preview[0] : '';
}

/** 取出 API 錯誤 JSON 裡的 message，避免把整段原始回應顯示給使用者 */
function apiErrorMessage(body) {
  try {
    var data = JSON.parse(body);
    if (data && data.error && data.error.message) return String(data.error.message);
  } catch (e) {
    // 不是 JSON，直接用原文
  }
  return String(body || '').slice(0, 200);
}

function parseRotation(text) {
  var parts = String(text || '').split(/[,，\s]+/).map(Number).filter(function (p) { return PART_INFO[p]; });
  return parts.length ? parts : [5, 6, 7];
}

// ======================== 試算表與 API ========================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AI 出題')
    .addItem('出一批題目…', 'showGenerateDialog')
    .addItem('立即執行一次每日出題', 'runDailyNow')
    .addSeparator()
    .addItem('開啟每天 06:00 自動出題', 'installDailyTrigger')
    .addItem('停止每天自動出題', 'removeDailyTrigger')
    .addItem('檢查設定', 'checkSetup')
    .addToUi();
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function readSettings_() {
  var values = SpreadsheetApp.getActive().getSheetByName(SHEET_SETTINGS).getDataRange().getDisplayValues();
  var map = {};
  values.forEach(function (r) { if (r[0]) map[String(r[0]).trim()] = String(r[1] || '').trim(); });
  var provider = (map['AI 服務'] || 'gemini').toLowerCase();
  if (provider !== 'gemini' && provider !== 'claude') throw new Error('「AI 服務」須為 gemini 或 claude');
  var difficulty = map['每日難度'] || '中階';
  if (DIFFICULTIES.indexOf(difficulty) === -1) throw new Error('「每日難度」須為 基礎／中階／進階');
  return {
    dailyCount: Math.max(1, Number(map['每日題數']) || 10),
    rotation: parseRotation(map['每日單元輪替']),
    difficulty: difficulty,
    dailyCap: Math.max(1, Number(map['每日寫入上限']) || 30),
    manualMax: Math.max(1, Number(map['手動單次上限']) || 15),
    provider: provider,
    model: map['模型'] || DEFAULT_MODELS[provider],
    targetRange: map['目標分數範圍'] || '600–800',
    autoApprove: parseYesNo(map['自動審核'], '自動審核')
  };
}

function readBank_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BANK);
  var values = sheet.getDataRange().getDisplayValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    header.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function writtenToday_() {
  var log = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG).getDataRange().getDisplayValues();
  var day = today_();
  return log.slice(1).reduce(function (sum, r) {
    return String(r[0]).indexOf(day) === 0 && r[7] === '成功' ? sum + (Number(r[5]) || 0) : sum;
  }, 0);
}

function log_(mode, part, difficulty, requested, written, skipped, result, message) {
  SpreadsheetApp.getActive().getSheetByName(SHEET_LOG).appendRow([
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
    mode, 'Part ' + part, difficulty, requested, written, skipped, result, String(message || '').slice(0, 1000)
  ]);
}

function apiKey_(provider) {
  var name = provider === 'claude' ? 'CLAUDE_API_KEY' : 'GEMINI_API_KEY';
  var key = PropertiesService.getScriptProperties().getProperty(name);
  if (!key) throw new Error('找不到指令碼屬性 ' + name + '，請到「專案設定 → 指令碼屬性」新增');
  return key;
}

/** 模型留白時向 Gemini 查詢這把金鑰可用的模型並自動挑選；結果快取 6 小時 */
function resolveGeminiModel_(configured) {
  if (configured) return configured;
  var cache = CacheService.getScriptCache();
  var cached = cache.get('gemini_model');
  if (cached) return cached;
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey_('gemini') },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('無法查詢 Gemini 可用模型（' + res.getResponseCode() + '）：' + apiErrorMessage(res.getContentText()));
  }
  var model = pickGeminiModel(JSON.parse(res.getContentText()).models);
  if (!model) throw new Error('這把金鑰沒有可用的 Gemini Flash 模型，請在「設定」分頁的「模型」手動填入');
  cache.put('gemini_model', model, 21600);
  return model;
}

function callGemini_(model, prompt, temperature) {
  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey_('gemini') },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: temperature === undefined ? 0.9 : temperature }
      })
    }
  );
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    CacheService.getScriptCache().remove('gemini_model'); // 模型可能已下架，下次重新挑選
    throw new Error('Gemini API 錯誤 ' + code + '：' + apiErrorMessage(body));
  }
  var data = JSON.parse(body);
  var cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content) throw new Error('Gemini 沒有回傳內容（' + (cand && cand.finishReason) + '）');
  return cand.content.parts.map(function (p) { return p.text || ''; }).join('');
}

function callClaude_(model, prompt, schema) {
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey_('claude'), 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: schema || responseSchema() } }
    })
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) throw new Error('Claude API 錯誤 ' + code + '：' + apiErrorMessage(body));
  var data = JSON.parse(body);
  if (data.stop_reason === 'refusal') throw new Error('Claude 拒絕這次請求');
  if (data.stop_reason === 'max_tokens') throw new Error('回傳內容太長被截斷，請減少題數');
  return data.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

/** 出題並寫入題庫。回傳摘要文字。 */
function generateAndAppend_(mode, part, difficulty, requested) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  var settings;
  try {
    settings = readSettings_();
    var remaining = settings.dailyCap - writtenToday_();
    if (remaining <= 0) {
      log_(mode, part, difficulty, requested, 0, 0, '略過', '今天已達寫入上限 ' + settings.dailyCap + ' 題');
      return '今天已達寫入上限（' + settings.dailyCap + ' 題），沒有出題。';
    }
    var plan = planGroups(part, Math.min(requested, remaining));
    var existing = readBank_();
    var avoid = existing
      .filter(function (r) { return Number(r.part) === part; })
      .map(function (r) { return String(r.question && r.question.indexOf('[') !== 0 ? r.question : r.passage).slice(0, 60); })
      .filter(Boolean)
      .slice(-40);
    var prompt = buildPrompt(part, difficulty, plan, settings.targetRange, avoid);
    if (settings.provider === 'gemini') settings.model = resolveGeminiModel_(settings.model);
    var text = settings.provider === 'claude' ? callClaude_(settings.model, prompt) : callGemini_(settings.model, prompt);
    var result = buildRows(part, difficulty, parseModelJson(text), existing, today_(), remaining);
    var review = { approved: 0, note: '' };
    if (settings.autoApprove && result.rows.length) review = verifyRows_(settings, result.rows);
    if (result.rows.length) {
      var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BANK);
      var start = sheet.getLastRow() + 1;
      var need = start + result.rows.length - 1 - sheet.getMaxRows();
      if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need + 100);
      sheet.getRange(start, 1, result.rows.length, COLUMNS.length).setValues(result.rows);
    }
    var drafts = result.rows.length - review.approved;
    var msg = settings.provider + '／' + settings.model +
      (settings.autoApprove ? '｜已審核 ' + review.approved + '、草稿 ' + drafts + (review.note ? '｜' + review.note : '') : '') +
      (result.skipped.length ? '｜略過：' + result.skipped.join('；') : '');
    log_(mode, part, difficulty, plan.total, result.rows.length, plan.total - result.rows.length, '成功', msg);
    var written = settings.autoApprove
      ? '寫入 ' + result.rows.length + ' 題（已審核 ' + review.approved + ' 題、草稿 ' + drafts + ' 題）'
      : '寫入 ' + result.rows.length + ' 題草稿';
    return written + (result.skipped.length ? '，略過 ' + result.skipped.length + ' 組' : '') +
      (result.skipped.length || (settings.autoApprove && drafts) ? '（原因見「執行紀錄」）' : '') + '。';
  } catch (e) {
    log_(mode, part, difficulty, requested, 0, 0, '失敗', e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 自動審核：請 AI 不看正解再作答一次，答案一致的題目改成「已審核」。
 * 複核失敗時不中斷出題，所有題目維持草稿，原因記在「執行紀錄」。
 */
function verifyRows_(settings, rows) {
  try {
    var prompt = buildVerifyPrompt(rows);
    var text = settings.provider === 'claude'
      ? callClaude_(settings.model, prompt, verifySchema())
      : callGemini_(settings.model, prompt, 0);
    var r = applyVerification(rows, parseVerifyJson(text));
    return { approved: r.approved, note: r.mismatched.length ? '複核不一致：' + r.mismatched.join('；') : '' };
  } catch (e) {
    return { approved: 0, note: '複核失敗，全部維持草稿：' + e.message };
  }
}

/** 時間觸發條件呼叫這個函式 */
function dailyGenerate() {
  var s = readSettings_();
  var part = rotationPart(s.rotation, today_());
  return generateAndAppend_('每日自動', part, s.difficulty, s.dailyCount);
}

function runDailyNow() {
  try {
    SpreadsheetApp.getActive().toast(dailyGenerate(), 'AI 出題', 8);
  } catch (e) {
    SpreadsheetApp.getUi().alert('出題失敗：' + e.message);
  }
}

function showGenerateDialog() {
  var html = HtmlService.createHtmlOutput(DIALOG_HTML).setWidth(360).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, 'AI 出一批題目');
}

/** 對話框按下「出題」時呼叫 */
function generateFromDialog(form) {
  var s = readSettings_();
  var part = Number(form.part);
  var count = Math.floor(Number(form.count));
  if (!PART_INFO[part]) throw new Error('請選擇 Part');
  if (DIFFICULTIES.indexOf(form.difficulty) === -1) throw new Error('請選擇難度');
  if (!(count >= 1 && count <= s.manualMax)) throw new Error('題數須為 1–' + s.manualMax);
  return generateAndAppend_('手動', part, form.difficulty, count);
}

function installDailyTrigger() {
  removeDailyTrigger(true);
  ScriptApp.newTrigger('dailyGenerate').timeBased().atHour(6).everyDays(1).inTimezone(TZ).create();
  SpreadsheetApp.getUi().alert('已開啟：每天 06:00–07:00 之間自動出題（Google 會在這一小時內的某個時間執行）。');
}

function removeDailyTrigger(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyGenerate') ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) SpreadsheetApp.getUi().alert('已停止每天自動出題。');
}

function checkSetup() {
  var lines = [];
  try {
    var s = readSettings_();
    var model = s.model;
    if (s.provider === 'gemini') {
      try { model = resolveGeminiModel_(s.model) + (s.model ? '' : '（自動選擇）'); } catch (e) { model = '無法取得：' + e.message; }
    }
    lines.push('AI 服務：' + s.provider + '（模型 ' + model + '）');
    lines.push('每日：' + s.dailyCount + ' 題，難度 ' + s.difficulty + '，輪替 Part ' + s.rotation.join('、'));
    lines.push('自動審核：' + (s.autoApprove ? '是（AI 複核答案一致的題目直接寫成已審核）' : '否（新題目寫成草稿）'));
    lines.push('今天出 Part ' + rotationPart(s.rotation, today_()) + '；今天已寫入 ' + writtenToday_() + '／上限 ' + s.dailyCap + ' 題');
    lines.push('金鑰：' + (PropertiesService.getScriptProperties().getProperty(s.provider === 'claude' ? 'CLAUDE_API_KEY' : 'GEMINI_API_KEY') ? '已設定' : '未設定'));
  } catch (e) {
    lines.push('設定有誤：' + e.message);
  }
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyGenerate'; });
  lines.push('每天自動出題：' + (hasTrigger ? '已開啟' : '未開啟'));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

var DIALOG_HTML = [
  '<style>body{font-family:Arial,"Noto Sans TC",sans-serif;font-size:14px}label{display:block;margin:10px 0 4px}',
  'select,input{width:100%;padding:6px;box-sizing:border-box}button{margin-top:16px;padding:8px 16px;background:#0D2235;color:#fff;border:0}',
  '#msg{margin-top:12px;white-space:pre-wrap}</style>',
  '<form id="f"><label>單元</label><select name="part"><option value="5">Part 5 句子填空</option>',
  '<option value="6">Part 6 段落填空（每篇 4 題）</option><option value="7">Part 7 閱讀理解（每篇 3 題）</option></select>',
  '<label>難度</label><select name="difficulty"><option>基礎</option><option selected>中階</option><option>進階</option></select>',
  '<label>題數</label><input name="count" type="number" min="1" value="10">',
  '<button type="submit" id="go">出題</button></form><div id="msg"></div>',
  '<script>document.getElementById("f").onsubmit=function(e){e.preventDefault();var b=document.getElementById("go");',
  'var m=document.getElementById("msg");b.disabled=true;m.textContent="出題中，約需 10–90 秒…";',
  'var f=e.target;google.script.run.withSuccessHandler(function(t){m.textContent=t;b.disabled=false;})',
  '.withFailureHandler(function(err){m.textContent="失敗："+err.message;b.disabled=false;})',
  '.generateFromDialog({part:f.part.value,difficulty:f.difficulty.value,count:f.count.value});};</script>'
].join('');
