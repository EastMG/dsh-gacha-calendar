// test/cases-category.mjs —— category / tags 批 1（2026-11-08）：把"已经在内存里"的分类写进数组条目
//
// ── 为什么有这一批 ──
// `50-refresh.js` 的 `itemFacts` 通道（`{ "<标题>": { category?, tags? } }` → 贴到 `gacha`/`events`
// 数组条目上）与 `GACHA_FIELDS` / `EVENT_FIELDS` 的白名单**早就存在**，但此前只有 FGO 在用。
// 另有 8 款游戏的解析器**其实已经把类别读进变量**，只是在收口成数组时丢掉了：
//   终末地（`data.tags`）、重返未来1999（`sec.kind`）、明日方舟（SMW「活动类型」）、原神（SMW「类型」）、
//   星铁（表「类型」列）、女神异闻录5X（`block.category`）、PJSK（`eventType`）、
//   （雪松：`倒计时名称` —— **本批判定不该补**，见下面第 ④ 段）。
//
// ── 批 2（2026-11-08）在本文件里加了两件事 ──
//   · 绝区零 Bwiki 活动一览也开 `categoryFacts`（第 ⑦ 段）：它的「类型」列**有多值**，
//     如 `版本活动<br />常驻活动` ⇒ `category` = 首项、`tags` = 其余项（以前 `stripTags` 会把
//     `<br />` 变成空格，多值粘成 `版本活动 常驻活动` 那种串）；
//   · 字段名 `cat` → `category` 的**旧缓存兼容**（第 ⑧ 段）：老 lastData 条目上的旧键读入时
//     映射成 `category`，写出只写 `category`。
//
// ── 本文件守四件事 ──
//   ① **只写不猜**：每款用真夹具，逐条钉死 `events[]` 条目上的 `category` / `tags` **实际值**；
//      源站没给这一列的那一条**没有**这个键（不是空串、不是猜出来的词）。
//   ② **档位**：把补上的值喂给 `eventTier`，钉住它是第一档还是第二档 —— 这是这些事实**唯一**的消费方
//      （`25-parser-order.js` 的 `EVENT_TIER1_RE`；规则见 `81-schedule-model.js` 的 `sideViewOf`）。
//   ③ **外显**：直接走显示层本体 `T.scheduleCellOf`（= 面板那一格真正选的那条），逐款钉住"变没变"。
//      **批 1 只有终末地一款变了外显**，而且是**对齐**（从"结束最早那条"变成引擎自己挑的挑战活动），
//      下面 ③ 里用一条显式标注意图的断言钉死它。批 2 加的绝区零外显**不变**（第 ③ 段的通用断言守）。
//   ④ **反证**：把 `category`/`tags` 摘掉 ⇒ 档位与外显回到改造前的样子（这同时就是"老缓存没有这两个键
//      ⇒ 行为与今天一致"的证明：老缓存的数组条目上根本没有这两个键）。
//
// ⚠️ 与 `cases-p3.mjs` 的口径分工：那边的 golden / 等价性 oracle 都是**改造前**的产物（数组条目上
//    没有 category/tags），所以那边比较前统一摘掉这两个键；它们的**取值**由本文件钉。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, useFixtures, fixtureBody } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });

// ── 夹具（全部是真抓，见各目录的 `response.txt.meta.json`）──────────────────────────────
const B = {
	endfield: FIX("p3c-endfield-fz-activity"),   // fz.wiki REST（2026-11-07 抓）
	r1999: FIX("p3b-r1999-notice"),              // sl916 noticecp（2026-11-07 抓）
	ak: FIX("arknights-smw-events"),              // PRTS SMW action=ask
	genshin: FIX("p3-genshin-smw-events"),        // bwiki ys action=ask
	hsr: FIX("p4-hsr-bwiki-events-1107"),        // bwiki sr 活动一览（2026-11-07 真机夹具）
	zzz: FIX("p4-zzz-bwiki-events-1108"),        // bwiki zzz 活动一览（2026-11-08 真抓、未裁剪）
	p5xList: FIX("p5x-list"),
	p5xDetail: FIX("p5x-detail"),
	sekai: FIX("b1-sekai-events"),               // sekai-master-db-cn-diff events.json
	kedr: FIX("p8-kedr-template"),               // bwiki kedr Template:首页游戏版本内容
	fgo: FIX("fgo-event-parse")                  // fgo.wiki 活动一览
};

// URL → 夹具。断言里用的是**来源自己的默认地址**（`SOURCES[].eventUrl`），不另造路径。
function pickBody(url) {
	const u = String(url);
	if (/api\.fz\.wiki/.test(u)) return B.endfield;
	if (/noticecp/.test(u)) return B.r1999;
	if (/prts\.wiki\/api\.php\?action=ask/.test(u)) return B.ak;
	if (/wiki\.biligame\.com\/ys\/api\.php\?action=ask/.test(u)) return B.genshin;
	if (/wiki\.biligame\.com\/sr\/api\.php/.test(u)) return B.hsr;
	if (/wiki\.biligame\.com\/zzz\/api\.php/.test(u)) return B.zzz;
	if (/p5x\.wanmei\.com\/news\/gamenews\/index\.html/.test(u)) return B.p5xList;
	if (/p5x\.wanmei\.com\/news\/gamenews\/\d+\/\d+\.html/.test(u)) return B.p5xDetail;
	if (/sekai-master-db/.test(u)) return B.sekai;
	if (/kedrgame\/api\.php\?action=parse&page=Template/.test(u)) return B.kedr;
	if (/fgo\.wiki\/api\.php\?action=parse/.test(u)) return B.fgo;
	throw new Error("category/tags 批 1 没有这个 URL 的夹具：" + u);
}
const transport = {
	async fetchRaw(url) {
		const body = pickBody(url);
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
	},
	async fetchViaProxy(url) { return pickBody(url); }
};
const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
const engineAt = (now) => createEngine({ transport, storage: makeStore(), now: () => now, timer: { setTimeout, clearTimeout } });

// 事件侧路径：`call` 一律用**来源自己的默认抓取器 + 默认地址**（与生产同一跳）
const PATHS = [
	{
		key: "endfield", id: "endfield", now: Date.parse("2026-11-07T01:19:55.965Z"), fixture: "p3c-endfield-fz-activity",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "r1999", id: "r1999", now: Date.parse("2026-11-07T01:08:25.105Z"), fixture: "p3b-r1999-notice",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "arknights", id: "arknights", now: Date.parse("2026-11-07T00:00:00.000Z"), fixture: "arknights-smw-events",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "genshin", id: "genshin", now: Date.parse("2026-11-07T00:28:21.868Z"), fixture: "p3-genshin-smw-events",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "hsr", id: "hsr", now: Date.parse("2026-11-07T00:00:00.000Z"), fixture: "p4-hsr-bwiki-events-1107",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// 绝区零**备选**源（Bwiki 活动一览）；批 2 起它才开 `categoryFacts`。走来源自己的
		// `eventAltSources[].url` / `fetcher`（不硬编码地址与下标，登记表改了这里跟着走）。
		key: "zzz", id: "zzz", now: Date.parse("2026-08-25T00:00:00.000Z"), fixture: "p4-zzz-bwiki-events-1108",
		call: (t, s) => {
			const alt = (s.eventAltSources || []).find((a) => a.fetcher === "zzz-event-bwiki");
			if (!alt) throw new Error("绝区零没有登记 zzz-event-bwiki 备选源");
			return t.EVENT_FETCHERS[s.id]["zzz-event-bwiki"](alt.url, undefined, s.tz);
		}
	},
	{
		key: "p5x", id: "p5x", now: Date.parse("2026-09-25T00:00:00.000Z"), fixture: "p5x-list + p5x-detail",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// PJSK 默认 eventUrl 走 gh-proxy（夹具是直连源的真抓）⇒ 这里用直连地址（抓取器收 url 参数，
		// 与 cases-b1 同一做法），解析路径一个字不差。
		key: "pjsk", id: "pjsk", now: Date.parse("2026-11-07T00:00:00.000Z"), fixture: "b1-sekai-events",
		call: (t) => t.EVENT_FETCHERS["pjsk"].default("https://sekai-world.github.io/sekai-master-db-cn-diff/events.json", undefined, TZ_CN)
	},
	{
		key: "kedr", id: "kedr", now: Date.parse("2026-10-01T00:00:00.000Z"), fixture: "p8-kedr-template",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "fgo", id: "fgo", now: Date.parse("2026-08-25T00:00:00.000Z"), fixture: "fgo-event-parse",
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	}
];

// ── 期望值（**逐字**，取自真夹具；`category`/`tags` 为 `undefined` = 该条没有这个键）──────────────
const EXPECT = {
	endfield: [
		{ title: "予众魂的新光影", tags: ["趣味活动"] },
		{ title: "百趣演武", tags: ["挑战活动"] },
		{ title: "烟火生缘", tags: ["趣味活动"] },
		{ title: "星河共我签到", tags: ["限时签到"] },
		{ title: "作战演练", tags: ["干员试用活动"] },
		{ title: "归野", tags: ["叙事活动"] }
	],
	r1999: [
		{ title: "佩施塔·雪红与玫瑰白", category: "角色剧情活动" },
		{ title: "亚特兰蒂斯谋杀案·上篇", category: "签到活动" },
		{ title: "推理演绎", category: "说明" },
		{ title: "烟斗客指津", category: "说明" },
		{ title: "吼吼点唱机：余下的真相", category: "新品上架" },
		{ title: "亚特兰蒂斯谋杀案", category: "活动正篇" },
		{ title: "红鲱鱼推理爱好社", category: "说明" },
		{ title: "幸存者游戏", category: "8-bit街机秀" },
		{ title: "狂想与解构", category: "活动介绍" },
		{ title: "鬃毛邮报", category: "活动介绍" },
		{ title: "星光礼赠", category: "活动介绍" },
		{ title: "衣着风尚", category: "新品上架" },
		{ title: "注定之城", category: "新品上架" },
		{ title: "焦点闪回", category: "周期挑战玩法" },
		{ title: "书页与小憩", category: "大英图书馆联动活动" }
	],
	arknights: [
		// 这一条页内的「活动类型」就是「视相博物馆」（源站原样，不做归一）
		{ title: "视相博物馆：演化", category: "视相博物馆" },
		{ title: "登录活动：感谢庆典2026限时签到", category: "登录活动" },
		{ title: "支线故事：时间啊，向前！", category: "支线故事" }
	],
	genshin: [
		{ title: "「坏灭肇始之时」", category: "剧情活动" },
		{ title: "「相遇·悠久旅途之暇」", category: "特殊活动", tags: ["千音雅集"] },
		{ title: "「绮衣珍赏·赫炽」", category: "特殊活动", tags: ["千星奇域"] },
		{ title: "「全域镇卫·逆捍谬罚」", category: "角色获取", tags: ["版本活动"] },
		{ title: "「晶石如林生长之地」", category: "探索活动" }
	],
	hsr: [
		{ title: "「镇伏『贪饕』，汇聚愿力」", category: "版本活动" },
		{ title: "「巡星之礼」第二十七期", category: "额外活动" },
		{ title: "「爱，幽灵与机器人」", category: "版本活动" }
	],
	// 绝区零（批 2）：同一个 bwiki「活动一览」来源，类型列**多值**用 `<br />` 分隔 ⇒
	// 首项进 `category`、其余进 `tags`（「恰浪花逐夏而至」正是任务书点名的 `版本活动<br />常驻活动`）。
	// TAG 列本批**不读** ⇒ 条目上不会出现「签到」「战斗 拍照」这些 TAG 词。
	zzz: [
		{ title: "「咔滋酥脆出餐计划」", category: "特殊活动" },
		{ title: "「极危通缉与悠游假期」", category: "常规活动" },
		{ title: "「恰浪花逐夏而至」", category: "版本活动", tags: ["常驻活动"] },
		{ title: "「『嗯呢』大派送！」", category: "额外活动", tags: ["周年活动"] },
		{ title: "「云端礼赠」", category: "额外活动" },
		{ title: "「初代虚狩，回归」", category: "网页活动", tags: ["特殊活动"] }
	],
	p5x: [
		{ title: "2.5周年时光庆典", category: "活动更新" },
		{ title: "怪盗团团长的特训日程", category: "活动更新" },
		{ title: "2.5周年庆典特别福利", category: "活动更新" },
		{ title: "2.5周年特别礼包", category: "活动更新" },
		{ title: "2.5周年特别回馈", category: "活动更新" },
		{ title: "2.5周年魅影通行证", category: "活动更新" }
	],
	pjsk: [{ title: "Colors of Pure Sense", category: "marathon" }],
	// 雪松：本批**未补**（理由见第 ④ 段）⇒ 条目上一个类别键都没有
	kedr: [
		{ title: "战令通行证赛季" },
		{ title: "第三期边境防卫活动" },
		{ title: "个人剧情活动第1期：【新机动队故事】" }
	],
	// FGO：批 1 之前就已落地（`30-game-aniplex.js:262`），本批只改了 `EVENT_TIER1_RE` 认英文
	fgo: [
		{ title: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", category: "Event" },
		{ title: "「总统特异点」通关应援纪念活动 第2弹", category: "Campaign" },
		{ title: "「冠位戴冠战：Extra」开幕前夕纪念活动", category: "Campaign" },
		{ title: "Final Order Project [Lostbelt No.1]通关应援纪念活动", category: "Campaign" },
		{ title: "Final Order Project [Lostbelt No.2]通关应援纪念活动", category: "Campaign" }
	]
};

// ── 期望的档位（`eventTier`：1 = 第一档，2 = 第二档）────────────────────────────────────
const EXPECT_TIER = {
	endfield: [2, 1, 2, 2, 2, 1],
	r1999: [1, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 2],
	arknights: [2, 2, 1],
	genshin: [1, 2, 2, 2, 2],
	hsr: [2, 2, 2],
	zzz: [2, 2, 2, 2, 2, 2],
	p5x: [2, 2, 2, 2, 2, 2],
	pjsk: [2],
	kedr: [2, 2, 1],
	fgo: [1, 1, 1, 1, 1]
};

// 显示层外显（`T.scheduleCellOf` 的 primary）—— 本批**只有终末地变了**
const EXPECT_PRIMARY = {
	endfield: { before: "予众魂的新光影", after: "百趣演武", changed: true },
	r1999: { before: "佩施塔·雪红与玫瑰白", after: "佩施塔·雪红与玫瑰白", changed: false },
	arknights: { before: "视相博物馆：演化", after: "视相博物馆：演化", changed: false },
	genshin: { before: "「坏灭肇始之时」", after: "「坏灭肇始之时」", changed: false },
	hsr: { before: "「镇伏『贪饕』，汇聚愿力」", after: "「镇伏『贪饕』，汇聚愿力」", changed: false },
	// 批 2：绝区零补上 category/tags 后外显**一字不变**（六条的类型都判不出第一档词 ⇒ 档位仍全为 2，
	// 于是仍按"结束最早 + 起点最早"选到「咔滋酥脆出餐计划」；这与任务书的实测口径一致）。
	zzz: { before: "「咔滋酥脆出餐计划」", after: "「咔滋酥脆出餐计划」", changed: false },
	p5x: { before: "2.5周年时光庆典", after: "2.5周年时光庆典", changed: false },
	pjsk: { before: "Colors of Pure Sense", after: "Colors of Pure Sense", changed: false },
	kedr: { before: "个人剧情活动第1期：【新机动队故事】", after: "个人剧情活动第1期：【新机动队故事】", changed: false },
	fgo: { before: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", after: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", changed: false }
};

export default async function runCategory() {
	useFixtures();   // 兜底：任何"漏网的真网络"都直接抛错

	// 逐条跑：抓取器 → mergeEntryRecord（与 refresh() 同一段代码）
	const results = {};
	for (const p of PATHS) {
		const e = engineAt(p.now);
		const src = e.__test.SOURCES.find((s) => s.id === p.id);
		if (!src) { check(`category/tags 批 1：能找到来源 ${p.id}`, false, p.id); continue; }
		const payload = await p.call(e.__test, src);
		const rec = e.__test.mergeEntryRecord({ data: payload || {} }, null, p.now, { id: p.id, tz: src.tz });
		results[p.key] = { payload, rec, src, now: new Date(p.now), engine: e };
	}

	// 数组条目 → `eventTier` 认的形状（`81-schedule-model.js` 的 `sideViewOf` 那一层只读适配）
	const tierOf = (x) => T.eventTier({ name: x.title || "", category: x.category, tags: x.tags, startTs: x.startTs, endTs: x.endTs });

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ①：9 款（批 1 的 8 款 + 批 2 的绝区零）`events[]` 条目上的 category / tags —— 真夹具逐字（只写不猜）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const arr = r.rec.events || [];
		const exp = EXPECT[p.key];
		check(`（${p.key}）数组非空（夹具真的产出了条目，而不是悄悄退回空数组）`, arr.length === exp.length,
			`实际 ${arr.length} 条 / 期望 ${exp.length} 条`);
		const got = arr.map((x) => {
			const o = { title: x.title };
			if ("category" in x) o.category = x.category;
			if ("tags" in x) o.tags = x.tags;
			return o;
		});
		check(`（${p.key}）条目顺序 + \`category\` / \`tags\` 取值逐字相等（缺的那条**没有**这个键）`,
			JSON.stringify(got) === JSON.stringify(exp), JSON.stringify(got));
		// 反向：不许出现空串 / 空数组这类"写了个空值"的假事实
		check(`（${p.key}）没有空串 \`category\` / 空 \`tags\`（要么有值、要么没这个键）`,
			arr.every((x) => !("category" in x) || (typeof x.category === "string" && x.category !== ""))
			&& arr.every((x) => !("tags" in x) || (Array.isArray(x.tags) && x.tags.length > 0)),
			JSON.stringify(arr.map((x) => [x.category, x.tags])));
		check(`（${p.key}）这两个事实只是"解析器→数据层"的一跳：记录里没有 \`itemFacts\``,
			!("itemFacts" in r.rec), JSON.stringify(Object.keys(r.rec)));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ②：`eventTier` 对补上的值给出预期档位（第一档 / 第二档）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const arr = r.rec.events || [];
		const got = arr.map(tierOf);
		check(`（${p.key}）逐条档位 = ${EXPECT_TIER[p.key].join("/")}`, JSON.stringify(got) === JSON.stringify(EXPECT_TIER[p.key]),
			JSON.stringify(got));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ③：显示层外显 —— 直接走 `T.scheduleCellOf`（面板那一格真正选的那条）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const g = Object.assign({ id: p.id, name: p.id, tz: TZ_CN }, r.rec);
		const cell = T.scheduleCellOf(g, "event", r.now);
		const after = cell && cell.primary ? cell.primary.title : null;
		check(`（${p.key}）外显 = ${JSON.stringify(EXPECT_PRIMARY[p.key].after)}`, after === EXPECT_PRIMARY[p.key].after, JSON.stringify(after));
		// 老缓存 / 改造前等价：数组条目上**没有** category/tags 时，外显就是改造前的样子
		const oldRec = Object.assign({}, r.rec, { events: (r.rec.events || []).map((x) => { const o = Object.assign({}, x); delete o.category; delete o.tags; return o; }) });
		const oldCell = T.scheduleCellOf(Object.assign({ id: p.id, name: p.id, tz: TZ_CN }, oldRec), "event", r.now);
		const before = oldCell && oldCell.primary ? oldCell.primary.title : null;
		check(`（${p.key}）摘掉 category/tags ⇒ 外显回到改造前：${JSON.stringify(EXPECT_PRIMARY[p.key].before)}（= 老缓存的行为）`,
			before === EXPECT_PRIMARY[p.key].before, JSON.stringify(before));
		if (EXPECT_PRIMARY[p.key].changed) {
			// ⚠️ **有意变化**：用户已知批 1 会改进档位判定。这里把"变"本身也钉住，
			//    免得以后有人以为这是回归又把它改回去（改回去 = 面板显示"结束最早那条"，
			//    而引擎自己挑的外显（记录里的 `event`）是另一条 ⇒ 两套事实打架）。
			check(`（${p.key}）**【有意变化】**外显确实从「予众魂的新光影」变成「百趣演武」——` +
				`后者是引擎自己挑的那条（终末地 tags「挑战活动」第一档），改前两者不一致`,
				before === "予众魂的新光影" && after === "百趣演武" && r.rec.event === "百趣演武",
				JSON.stringify([before, after, r.rec.event]));
		} else {
			check(`（${p.key}）外显**未变**（补 category/tags 不动用户已看到的这一条）`, before === after, JSON.stringify([before, after]));
		}
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ④：雪松 —— `timer` 有值但**故意不补**（补了会让档位退化）");
	{
		const r = results.kedr;
		const arr = (r && r.rec.events) || [];
		// 源站确实给了类别词（模板参数「倒计时名称」），但都不在 `EVENT_TIER1_RE` 里。
		const timers = ["赛季", "边境防卫", "活动"];
		check("雪松：源站的「倒计时名称」三个值都不在第一档词表里（所以它不是有用的类别词）",
			timers.every((x) => T.eventTier({ category: x }) === 2), JSON.stringify(timers.map((x) => T.eventTier({ category: x }))));
		// 若真把它当 category 写进去：原本靠**活动名**命中第一档的「个人剧情活动第1期」会掉到第二档，
		// 外显随之从它变成「战令通行证赛季」—— 这就是"不该发生的变化"。
		const whatIf = arr.map((x, i) => { const o = Object.assign({}, x); o.category = ["赛季", "边境防卫", "活动"][i] || ""; return o; });
		const g = Object.assign({ id: "kedr", name: "kedr", tz: TZ_CN }, r.rec, { events: whatIf });
		const cell = T.scheduleCellOf(g, "event", r.now);
		const after = cell && cell.primary ? cell.primary.title : null;
		check("雪松：**假如**补 category，外显会退化成「战令通行证赛季」（改造前是「个人剧情活动第1期：【新机动队故事】」）",
			after === "战令通行证赛季", JSON.stringify(after));
		check("雪松：所以本批不补 —— 条目上一个类别键都没有（不写 > 写错）",
			arr.length > 0 && arr.every((x) => !("category" in x) && !("tags" in x)),
			JSON.stringify(arr.map((x) => [x.title, x.category, x.tags])));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ⑤：`EVENT_TIER1_RE` 的英文分支（FGO 的 Event / Campaign / Other）");
	{
		const tier = (o) => T.eventTier(o);
		check("`Event`（源站类型列原样）= 第一档", tier({ category: "Event" }) === 1, String(tier({ category: "Event" })));
		check("`Campaign` = 第一档（与 Event 同视作「活动正篇」）", tier({ category: "Campaign" }) === 1, String(tier({ category: "Campaign" })));
		check("`Other` = 第二档（FGO 的第三个分类，不许被英文分支误命中）", tier({ category: "Other" }) === 2, String(tier({ category: "Other" })));
		// 词边界防护：不带 `\b` 时 `Events` / `Eventful` 会被裸 `Event` 命中；`Pother` 也不该命中。
		check("词边界：`Events` / `Eventful` / `Campaigns` / `Campaigner` 都**不是**分类词 ⇒ 第二档",
			tier({ category: "Events" }) === 2 && tier({ category: "Eventful" }) === 2
			&& tier({ category: "Campaigns" }) === 2 && tier({ category: "Campaigner" }) === 2,
			JSON.stringify([tier({ category: "Events" }), tier({ category: "Eventful" }), tier({ category: "Campaigns" }), tier({ category: "Campaigner" })]));
		check("词边界：`Event` 嵌在别的词里不算（`Pother` / `OpEvent`）",
			tier({ category: "Pother" }) === 2 && tier({ category: "OpEvent" }) === 2,
			JSON.stringify([tier({ category: "Pother" }), tier({ category: "OpEvent" })]));
		check("中文里的英文分类词照样命中（`Event 复刻` 这种源站写法）", tier({ category: "Event 复刻" }) === 1, String(tier({ category: "Event 复刻" })));
		check("`Other` 与中文第一档词共存时按中文判（`Other 剧情活动` ⇒ 第一档，不因为 Other 而降档）",
			tier({ category: "Other 剧情活动" }) === 1, String(tier({ category: "Other 剧情活动" })));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 1 ⑥：反证 —— 摘掉补上的值，档位 / 外显就往回退（不是「看起来绿」）");
	{
		// A. 终末地：tags「挑战活动」是第一档的唯一来源（活动名里没有第一档关键词）
		const arr = results.endfield.rec.events || [];
		const bare = arr.map((x) => { const o = Object.assign({}, x); delete o.category; delete o.tags; return o; });
		check("终末地：`百趣演武` 的名字本身判不出第一档（摘掉 tags ⇒ 第二档）",
			tierOf(arr.find((x) => x.title === "百趣演武")) === 1
			&& tierOf(bare.find((x) => x.title === "百趣演武")) === 2,
			JSON.stringify([tierOf(arr.find((x) => x.title === "百趣演武")), tierOf(bare.find((x) => x.title === "百趣演武"))]));
		// B. FGO：不带 `\b` 的英文分支不成立 —— `Other` 那条必须落在第二档
		check("FGO：`Other` 类的那条不会被英文分支抬到第一档（词边界防护的实际效果）",
			T.eventTier({ category: "Other", name: "「总统特异点」通关应援纪念活动 第2弹" }) === 2,
			String(T.eventTier({ category: "Other", name: "「总统特异点」通关应援纪念活动 第2弹" })));
		// C. 原神：`剧情活动` 是第一档的唯一来源（名字「坏灭肇始之时」没有关键词）
		const gArr = results.genshin.rec.events || [];
		const gBare = gArr.map((x) => { const o = Object.assign({}, x); delete o.category; delete o.tags; return o; });
		check("原神：摘掉 category ⇒ `「坏灭肇始之时」` 从第一档掉到第二档（category 是唯一来源）",
			tierOf(gArr[0]) === 1 && tierOf(gBare[0]) === 2,
			JSON.stringify([tierOf(gArr[0]), tierOf(gBare[0])]));
		// D. 重返未来1999：`活动正篇` / `角色剧情活动` 同样是名字判不出来的
		const rArr = results.r1999.rec.events || [];
		const rBare = rArr.map((x) => { const o = Object.assign({}, x); delete o.category; delete o.tags; return o; });
		const pickTier = (list) => list.map(tierOf);
		check("重返未来1999：摘掉 category ⇒ 3 条第一档（角色剧情活动 / 活动正篇 / 周期挑战玩法）同时掉档",
			pickTier(rArr).filter((x) => x === 1).length === 3 && pickTier(rBare).every((x) => x === 2),
			JSON.stringify([pickTier(rArr).filter((x) => x === 1).length, pickTier(rBare).filter((x) => x === 1).length]));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 2 ⑦：绝区零「类型」列多值按 `<br />` 拆（首项 category、其余 tags）");
	{
		const arr = (results.zzz && results.zzz.rec.events) || [];
		const at = (t) => arr.find((x) => x.title === t) || null;
		// 先证明**夹具本身**是多值的：源站单元格原文就是 `版本活动<br />常驻活动`
		//（`stripTags` 会把它变成空格 ⇒ 那正是本批要修的 bug；下面 ⑦-2 的反向断言盯的就是它）
		check("夹具实证：绝区零「恰浪花逐夏而至」的类型单元格原样是 `版本活动<br />常驻活动`",
			B.zzz.includes("版本活动<br />常驻活动"),
			"夹具里找不到这个多值单元格 ⇒ 下面的拆分断言就失去依据（夹具被换掉了？）");
		const multi = at("「恰浪花逐夏而至」");
		check("多值拆分：`版本活动<br />常驻活动` ⇒ category=\"版本活动\"、tags=[\"常驻活动\"]",
			!!multi && multi.category === "版本活动" && JSON.stringify(multi.tags) === JSON.stringify(["常驻活动"]),
			JSON.stringify(multi && [multi.category, multi.tags]));
		const more = at("「『嗯呢』大派送！」");
		check("多值拆分：`额外活动<br />周年活动` ⇒ category=\"额外活动\"、tags=[\"周年活动\"]",
			!!more && more.category === "额外活动" && JSON.stringify(more.tags) === JSON.stringify(["周年活动"]),
			JSON.stringify(more && [more.category, more.tags]));
		const rev = at("「初代虚狩，回归」");
		check("多值拆分：`网页活动<br />特殊活动` ⇒ category=\"网页活动\"、tags=[\"特殊活动\"]（顺序按源站，不排序）",
			!!rev && rev.category === "网页活动" && JSON.stringify(rev.tags) === JSON.stringify(["特殊活动"]),
			JSON.stringify(rev && [rev.category, rev.tags]));
		// ⑦-2 **反向**：不许留下"没拆开"的痕迹（空格粘串 / `<br` 残渣）；空值也不许写成空串/空数组
		check("拆开的证据：没有条目的 category / tags 带空格或 `<br`（`版本活动 常驻活动` 这种串 = 没拆）",
			arr.length > 0 && arr.every((x) => !/\s/.test(String(x.category || ""))
				&& (x.tags || []).every((t) => !/\s/.test(t) && !/<br/i.test(t))
				&& !/<br/i.test(String(x.category || ""))),
			JSON.stringify(arr.map((x) => [x.category, x.tags])));
		// ⑦-3 TAG 列本批**不读**（任务书：TAG 留给后续决策）：源站 TAG「签到 / 战斗 拍照 / …」不许出现
		const TAG_WORDS = ["签到", "剧情 拍照", "战斗 拍照", "代理人获取", "名片 装饰"];
		check("TAG 列本批不读（tags 里只有类型列的其余项，没有源站 TAG 词）",
			arr.every((x) => (x.tags || []).every((t) => !TAG_WORDS.includes(t) && !TAG_WORDS.some((w) => t.includes(w)))),
			JSON.stringify(arr.map((x) => x.tags)));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 2 ⑧：`cat` → `category` 改名的**旧缓存兼容**（一条用例）");
	{
		// 老 lastData 里的数组条目可能带旧键（旧名就是任务书里点出来的那个三字母缩写）。
		const LEGACY_KEY = "cat";
		const legacyEvents = [
			// 多值：旧键 + tags 都在
			{ key: "zzz:event:0", title: "甲", show: "甲", startTs: 1, endTs: 2, tz: TZ_CN, raw: "", source: "primary", [LEGACY_KEY]: "版本活动", tags: ["常驻活动"] },
			// 单值
			{ key: "zzz:event:1", title: "乙", show: "乙", startTs: 3, endTs: 4, tz: TZ_CN, raw: "", source: "hover", [LEGACY_KEY]: "特殊活动" },
			// 新旧键**同时**存在（脏数据：老版本写过旧键、新版本又写了新键）⇒ 新键必须赢
			{ key: "zzz:event:2", title: "丙", show: "丙", startTs: 5, endTs: 6, tz: TZ_CN, raw: "", source: "hover", category: "常规活动", [LEGACY_KEY]: "特殊活动" }
		];
		const store = makeStore();
		await store.set("lastData", JSON.stringify({ zzz: { name: "绝区零", events: legacyEvents } }));
		const e = createEngine({ transport, storage: store, now: () => Date.parse("2026-11-08T00:00:00Z"), timer: { setTimeout, clearTimeout } });
		const cached = await e.getCached();   // = 老缓存读入的唯一入口（normalizeRecord 的数组分支）
		const ev = (cached.games.zzz && cached.games.zzz.events) || [];
		check("老缓存：旧键被当成 `category` 的旧名读入（值一字不改，多值条目的 tags 也照原样）",
			ev.length === 3 && ev[0].category === "版本活动" && JSON.stringify(ev[0].tags) === JSON.stringify(["常驻活动"])
			&& ev[1].category === "特殊活动",
			JSON.stringify(ev.map((x) => [x.category, x.tags])));
		check("老缓存：**写出只写 `category`** —— 归一后的条目上没有任何旧键（下一次写盘就迁移完）",
			ev.every((x) => !(LEGACY_KEY in x)),
			JSON.stringify(ev.map((x) => Object.keys(x))));
		check("新缓存本来就用 `category`：值不受影响，键序仍是 `…source → category → tags`",
			ev[2].category === "常规活动"
			&& JSON.stringify(Object.keys(ev[0])) === JSON.stringify(["key", "title", "show", "startTs", "endTs", "tz", "raw", "source", "category", "tags"])
			&& JSON.stringify(Object.keys(ev[2])) === JSON.stringify(["key", "title", "show", "startTs", "endTs", "tz", "raw", "source", "category"]),
			JSON.stringify(ev.map((x) => Object.keys(x))));
		// 同时钉住优先级：两个键都在时以 `category` 为准（旧键不许覆盖新事实）
		check("旧键与新键同时存在时以新键 `category` 为准（脏数据也不许旧名赢）",
			!Object.prototype.hasOwnProperty.call(ev[2], LEGACY_KEY) && ev[2].category === "常规活动",
			JSON.stringify(ev[2]));
	}
}
