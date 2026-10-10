import type { ContentGroup, Difficulty, OptionKey, Part, Question } from "@/domain/schema";

/**
 * 內建 demo 題庫：全部為本專案原創練習題，非 ETS 官方試題，僅供開發與試用。
 * id 固定，重複寫入 IndexedDB 時以 id 覆蓋，不會重複新增。
 */

const CREATED = "2026-10-10T00:00:00+08:00";
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

type Opts = [string, string, string, string];

function q(
  n: number,
  part: Part,
  sourceId: string,
  stem: string,
  options: Opts,
  correct: OptionKey,
  explanation: string,
  difficulty: Difficulty,
  tags: string[],
  groupId: string | null = null,
): Question {
  return {
    id: uuid(n),
    created_at: CREATED,
    updated_at: CREATED,
    group_id: groupId,
    part,
    stem,
    options: (["A", "B", "C", "D"] as const).map((key, i) => ({ key, text: options[i] })),
    correct_key: correct,
    explanation_zh: explanation,
    tags: ["demo", ...tags],
    difficulty,
    source_id: sourceId,
    version: 1,
    status: "approved",
  };
}

function group(n: number, part: Part, sourceId: string, title: string, body: string): ContentGroup {
  return {
    id: uuid(n),
    created_at: CREATED,
    updated_at: CREATED,
    part,
    passages: [{ title, body }],
    image_asset_id: null,
    audio_asset_id: null,
    transcript: null,
    speaker_labels: [],
    source_id: sourceId,
  };
}

const P6_GROUP = uuid(1001);
const P7_GROUP = uuid(1002);

export const demoGroups: ContentGroup[] = [
  group(
    1001,
    6,
    "demo-P6-G001",
    "Memo: Parking Lot Resurfacing",
    [
      "To: All Staff",
      "From: Facilities Department",
      "",
      "Please be aware that the north parking lot will be closed from Monday, March 9, through Wednesday, March 11, while it is [1]. During this period, employees are asked to use the overflow lot on Carver Street. A free shuttle will run between the overflow lot and the main entrance every ten minutes, [2] 7:00 A.M. to 7:00 P.M.",
      "",
      "[3]. Staff members who require accessible parking should contact the Facilities Department in advance so that temporary spaces can be reserved near the building.",
      "",
      "We apologize for any inconvenience and appreciate your [4] while this work is completed.",
    ].join("\n"),
  ),
  group(
    1002,
    7,
    "demo-P7-G001",
    "E-mail: Order Confirmation",
    [
      "From: customer.service@brightleafsupply.com",
      "To: Daniel Ortega",
      "Subject: Order #58213",
      "",
      "Dear Mr. Ortega,",
      "",
      "Thank you for your order of 40 ergonomic office chairs. We are pleased to confirm that 25 chairs will be shipped from our Riverside warehouse tomorrow and should arrive at your office by Friday. Unfortunately, the remaining 15 chairs in charcoal gray are temporarily out of stock. We expect to receive more from the manufacturer within two weeks and will ship them immediately at no additional delivery charge.",
      "",
      "If you would prefer to receive all 40 chairs together, or to replace the gray chairs with the navy blue model, which is currently in stock, please reply to this e-mail by Wednesday.",
      "",
      "Sincerely,",
      "Mei-Ling Chou",
      "Customer Service, Brightleaf Office Supply",
    ].join("\n"),
  ),
];

export const demoQuestions: Question[] = [
  // ---------- Part 5 ----------
  q(1, 5, "demo-P5-001",
    "The marketing team will present its ------- for the new product launch at Thursday's meeting.",
    ["propose", "proposal", "proposed", "proposing"], "B",
    "空格前有所有格 its，後面需要名詞，故選 proposal（提案）。propose 是動詞，proposed／proposing 是分詞，都不能直接接在所有格後當受詞。",
    "basic", ["詞性"]),
  q(2, 5, "demo-P5-002",
    "Ms. Tanaka has worked at the Osaka branch ------- she joined the company in 2019.",
    ["since", "during", "until", "while"], "A",
    "主要子句用現在完成式 has worked，表示從過去某時點持續到現在，搭配 since 引導起點子句。during 後接名詞，不接子句；until 表示「直到」，與完成式語意不合；while 表示同時發生。",
    "basic", ["連接詞", "時態"]),
  q(3, 5, "demo-P5-003",
    "All visitors must ------- their identification badges at the security desk before leaving the building.",
    ["return", "returns", "returning", "returned"], "A",
    "助動詞 must 後面接原形動詞，故選 return。其他選項是第三人稱單數、動名詞或過去式，都不能接在 must 後面。",
    "basic", ["助動詞"]),
  q(4, 5, "demo-P5-004",
    "The new accounting software is ------- easier to use than the system we had last year.",
    ["very", "much", "many", "more"], "B",
    "比較級 easier 前面要用 much、far、even 等副詞加強語氣。very 不能修飾比較級；many 修飾可數名詞；more easier 是重複比較，文法錯誤。",
    "intermediate", ["比較級"]),
  q(5, 5, "demo-P5-005",
    "------- the heavy rain, the outdoor concert proceeded as scheduled.",
    ["Although", "Despite", "Because of", "However"], "B",
    "空格後是名詞片語 the heavy rain，前後語意相反（下大雨但照常舉行），故選介系詞 Despite。Although 後要接子句；Because of 表示原因，語意不合；However 是副詞，不能直接接名詞片語。",
    "intermediate", ["介系詞", "連接詞"]),
  q(6, 5, "demo-P5-006",
    "Applicants are advised to submit their portfolios ------- in advance of the deadline to allow time for review.",
    ["good", "well", "best", "better"], "B",
    "well in advance of 是固定用法，表示「遠早於」。good 是形容詞，不能修飾片語；best、better 是比較變化，語意與結構不合。",
    "advanced", ["副詞", "慣用語"]),

  // ---------- Part 6（共用文章：停車場整修公告） ----------
  q(101, 6, "demo-P6-001-1", "",
    ["resurfaced", "resurfacing", "being resurfaced", "to resurface"], "C",
    "停車場是「被」整修，且整修在關閉期間進行中，用現在進行被動式 is being resurfaced。is resurfaced 表示一般被動，無法表達「正在進行」；resurfacing 會變成主動語意；to resurface 文法不通。",
    "intermediate", ["被動語態"], P6_GROUP),
  q(102, 6, "demo-P6-001-2", "",
    ["from", "between", "since", "within"], "A",
    "from 7:00 A.M. to 7:00 P.M. 是「從…到…」的固定搭配。between 要搭配 and；since 表示從過去某時點至今；within 表示「在…之內」，都不能與 to 搭配。",
    "basic", ["介系詞"], P6_GROUP),
  q(103, 6, "demo-P6-001-3", "",
    [
      "The north lot was built more than twenty years ago",
      "Parking in the overflow lot is limited to company employees",
      "The shuttle service has been discontinued",
      "Visitors should park on the street during this time",
    ], "B",
    "句子插入題。後一句提到需要無障礙停車的員工要事先聯絡，前一句說明替代停車場的使用規則最連貫，故選 B。A 與上下文無關；C 與前段「會有免費接駁車」矛盾；D 與「請員工使用替代停車場」的安排不一致。",
    "advanced", ["句子插入"], P6_GROUP),
  q(104, 6, "demo-P6-001-4", "",
    ["patience", "patient", "patiently", "patients"], "A",
    "空格前有所有格 your，後面需要名詞，且語意是「感謝您的耐心」，故選 patience。patient 當名詞時指「病患」，patients 是其複數，語意不合；patiently 是副詞。",
    "basic", ["詞性"], P6_GROUP),

  // ---------- Part 7（共用文章：訂單確認信） ----------
  q(201, 7, "demo-P7-001-1",
    "What is the main purpose of the e-mail?",
    [
      "To request payment for an order",
      "To provide an update on a shipment",
      "To introduce a new line of products",
      "To apologize for a damaged delivery",
    ], "B",
    "信件說明 25 張椅子明天出貨、15 張暫時缺貨，主旨是告知出貨狀況，故選 B。信中沒有提到付款、新產品或商品損壞。",
    "basic", ["主旨題"], P7_GROUP),
  q(202, 7, "demo-P7-001-2",
    "How many chairs will be delivered by Friday?",
    ["15", "25", "40", "55"], "B",
    "信中寫明 25 chairs will be shipped ... should arrive at your office by Friday，故選 B。40 是訂購總數，15 是缺貨數量。",
    "basic", ["細節題"], P7_GROUP),
  q(203, 7, "demo-P7-001-3",
    "What is Mr. Ortega asked to do by Wednesday?",
    [
      "Pay an additional delivery charge",
      "Visit the Riverside warehouse",
      "Indicate whether he wants to change the order",
      "Confirm the number of chairs he needs",
    ], "C",
    "最後一段請他在週三前回覆：要一起收全部 40 張，或把灰色椅子換成藏青色，也就是表明是否要調整訂單，故選 C。A 與「不另收運費」矛盾；B、D 信中沒有提到。",
    "intermediate", ["推論題"], P7_GROUP),
];
