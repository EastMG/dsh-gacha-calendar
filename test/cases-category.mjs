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
// ── 批 3（2026-11-08，用户拍板）：`eventTier` 的 haystack 改成 **OR 语义** ──
// 旧写法 `hay = category || name`：只要条目上有 `category`，活动名就**完全不参与**档位判定。
// 批 1/批 2 把 `category` 补进数组条目之后，名字里带「全息 / 极限 / 挑战 / 决战 / 深度巡防」的活动
// 被**降档**（线上真实行：绝区零「全息强袭战域」「深度巡防-三倍赏金」「极限裁决试炼」、星铁「不要笑挑战」
// 「酷得走火—宇宙！咻！咻！大挑战！」）。现在三段都参与，任意段缺失不影响另外两段。
// 本批新增三段（⑨ OR 的 16 格真值表 / ⑩ 反证 / ⑪ 逐款逐时刻外显 + 变化登记）。
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

// 采样时刻（批 3 ⑪）：从记录的活动窗里取 —— 每个条目的「起点 + 1/8、中点、终点 - 1/8」+ 6 个等距点，
// 按"该刻并行活动数多 → 时间靠前"排序后取 8 个。目的：覆盖**有并行活动**的时间窗，而不是只看抓取那一刻。
function momentsOf(events) {
	const ivs = (Array.isArray(events) ? events : [])
		.filter((x) => x && x.endTs != null)
		.map((x) => [x.startTs == null ? x.endTs - 30 * 864e5 : x.startTs, x.endTs]);
	if (!ivs.length) return [];
	const lo = Math.min(...ivs.map((v) => v[0])), hi = Math.max(...ivs.map((v) => v[1]));
	const activeCount = (t) => events.filter((x) => (x.startTs == null || x.startTs <= t) && x.endTs != null && x.endTs >= t).length;
	const cand = [];
	for (const [s, e] of ivs) for (const f of [1 / 8, 1 / 2, 7 / 8]) cand.push(Math.round(s + (e - s) * f));
	for (let i = 1; i <= 6; i++) cand.push(Math.round(lo + ((hi - lo) * i) / 7));
	const uniq = [...new Set(cand)].filter((t) => t >= lo && t <= hi).sort((a, b) => a - b);
	const scored = uniq.map((t) => ({ t, n: activeCount(t) })).filter((x) => x.n > 0);
	const pick = [];
	for (const x of scored.slice().sort((a, b) => (b.n - a.n) || (a.t - b.t))) if (pick.length < 8) pick.push(x.t);
	for (const x of scored) if (pick.length < 8 && !pick.includes(x.t)) pick.push(x.t);
	return pick.sort((a, b) => a - b).slice(0, 8);
}

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
		// ── 批 3（OR 语义）之后：这条 what-if 的**结论反过来了** ──────────────────────────
		// 旧语义 `hay = category || name` 下"补 category"会把名字挡掉 ⇒ 外显退化成「战令通行证赛季」
		// （当时的实测结论）。现在 name 始终参与 ⇒ 补上「赛季」也抬不动它，外显仍是那条剧情活动。
		// 也就是说：当初"不补"的理由（**补了会让档位退化**）在 OR 语义下**已不成立**；
		// 但补不补 category 是另一次改动（本任务只改 haystack），所以条目上仍然一个类别键都没有。
		check("雪松：OR 语义下**假如**补 category，外显不再退化（「补了就降档」这个旧理由已随批 3 失效）",
			after === "个人剧情活动第1期：【新机动队故事】", JSON.stringify(after));
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
	// ── 2026-11-11：**同名页面**靠页面标题区分（真机 bug）─────────────────
	// 原神 bwiki：「巡历雪境，凝铸锋锐」与它的「…新手」变体页的 SMW「名称」属性**完全相同**，
	// 旧取名按「名称」⇒ 两页混成一条（已结束的主活动被当成 294 天长期活动）。
	// 现在一律取**页面标题**（用户要求：保留并按完整页面名显示）。
	{
		const mk = (title, nameProp, s, e) => ({
			[title]: {
				fulltext: title,
				printouts: {
					"名称": [nameProp],
					"开始时间": [{ raw: "1/" + s }],
					"结束时间": [{ raw: "1/" + e }],
					"类型": ["额外活动"]
				}
			}
		});
		const json = { query: { results: Object.assign({},
			mk("「同名测试活动」", "「同名测试活动」", "2026/11/5/10/0/0/0", "2026/11/20/3/59/0/0"),
			mk("「同名测试活动」新手", "「同名测试活动」", "2026/11/6/10/0/0/0", "2026/11/25/3/59/0/0")
		) } };
		const parsed = T.parseSmwActivity(json, TZ_CN, { emitArrays: true, id: "genshin" });
		const titles = ((parsed && parsed.events) || []).map((x) => x.title).sort();
		check("同名页面不再混成一条：两条各自用**页面标题**（含「新手」后缀）",
			titles.length === 2 && titles.includes("「同名测试活动」") && titles.some((x) => x.endsWith("新手")),
			JSON.stringify(titles));
		check("页面标题就是显示名（不是 SMW「名称」属性）",
			((parsed && parsed.events) || []).every((x) => titles.includes(x.title)), JSON.stringify(titles));
	}

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

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 3 ⑨：`eventTier` 的 haystack = OR 语义（category + tags + name **三段都参与**）");
	{
		const tier = (o) => T.eventTier(o);
		// 名字：命中 / 不命中；类别：存在但**不**在第一档词表里（这样 tags / name 才有决定权）
		const NAME_HIT = "「全息强袭战域」";
		const NAME_MISS = "「云端礼赠」";
		const CAT_MISS = "版本活动";
		// (category 有/无) × (tags 有/无/空数组/非数组) × (name 命中/不命中) = 16 格真值表。
		// 任务书列的 12 格是它的子集：这里把 tags 的「无」再拆出「空数组」与「非数组」两种退化输入。
		const TAGS_STATES = [["有", ["挑战活动"]], ["无", undefined], ["空数组", []], ["非数组", null]];
		const CAT_STATES = [["有（不命中）", CAT_MISS], ["无", ""]];
		const NAME_STATES = [["命中", NAME_HIT], ["不命中", NAME_MISS]];
		let n = 0;
		for (const [tagsLabel, tags] of TAGS_STATES) {
			for (const [catLabel, category] of CAT_STATES) {
				for (const [nameLabel, name] of NAME_STATES) {
					// category 这一段本身不命中 ⇒ 档位只由 tags / name 决定（谁命中谁就是第一档）
					const want = (tagsLabel === "有" || nameLabel === "命中") ? 1 : 2;
					const got = tier({ category, tags, name });
					n++;
					check(`⑨-${String(n).padStart(2, "0")} category=${catLabel} / tags=${tagsLabel} / name=${nameLabel} ⇒ 第 ${want} 档`,
						got === want, `实际 ${got}（${JSON.stringify({ category, tags, name })}）`);
				}
			}
		}
		// 关键格：**有类别字段时名字照样参与**（旧写法 `hay = category || name` 在这里给的是 2）
		check("⑨ 关键格：category 有（不命中）+ name 命中 ⇒ 第一档（旧语义在这里是第二档）",
			tier({ category: CAT_MISS, name: NAME_HIT }) === 1
			&& tier({ category: "常规活动", tags: ["周年活动"], name: "「极限裁决试炼」" }) === 1,
			JSON.stringify([tier({ category: CAT_MISS, name: NAME_HIT }), tier({ category: "常规活动", tags: ["周年活动"], name: "「极限裁决试炼」" })]));
		check("⑨ 三段都不命中 ⇒ 第二档（不是「有类别就一律第一档」）",
			tier({ category: CAT_MISS, tags: ["特殊活动"], name: NAME_MISS }) === 2,
			String(tier({ category: CAT_MISS, tags: ["特殊活动"], name: NAME_MISS })));
		// 空值安全：任意段缺失都不许抛错、不许把 `undefined` 拼进 haystack（`x?.` + 逐段收值）
		check("⑨ 空值安全：`{}` / `null` / `undefined` / 只给 tags / tags 是字符串 / tags 是对象或数字 —— 都不抛错，按实际有的段判",
			tier({}) === 2 && tier(null) === 2 && tier(undefined) === 2
			&& tier({ tags: ["挑战活动"] }) === 1 && tier({ tags: "挑战活动" }) === 1
			&& tier({ tags: {} }) === 2 && tier({ tags: 42 }) === 2,
			JSON.stringify([tier({}), tier(null), tier(undefined), tier({ tags: ["挑战活动"] }), tier({ tags: "挑战活动" }), tier({ tags: {} }), tier({ tags: 42 })]));
		check("⑨ 数组里混非字符串元素时逐项跳过（`null` / 数字不会被拼成 haystack 的一部分）",
			tier({ tags: [null, 42, "挑战活动"] }) === 1 && tier({ tags: [null, 42] }) === 2,
			JSON.stringify([tier({ tags: [null, 42, "挑战活动"] }), tier({ tags: [null, 42] })]));
		// 分隔符：段与段之间**恰好一个空格** —— 既不会把两段"粘"出一个假分类词，也不会让 `\b` 词边界漏判
		check("⑨ 分隔符：`Eve` + `nt` 不许粘成 `Event`（粘出来就会被英文分支误命中）",
			tier({ category: "Eve", tags: ["nt"] }) === 2, String(tier({ category: "Eve", tags: ["nt"] })));
		check("⑨ 分隔符：`Event` 与 name 之间要有空格（`\\bEvent\\b` 才成立）⇒ 第一档",
			tier({ category: "Event", tags: [], name: "123" }) === 1, String(tier({ category: "Event", tags: [], name: "123" })));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 3 ⑩：反证 —— 把 `name` 从 haystack 摘掉 / 把 `tags` 摘掉，红的是哪几条");
	{
		// 名字命中的**线上真实行**（星铁「不要笑挑战」「酷得走火…大挑战！」与绝区零三行）。
		// ⚠️ 星铁那两行**离线夹具里没有**（`p4-hsr-bwiki-events-1107` 只裁了 3 行、不含这两个名字），
		//    所以它们只能在这一层（纯函数 + 真实行名 + 真实类型列取值）钉住；绝区零三行有真夹具证据（⑪）。
		const NAME_ROWS = [
			{ category: "版本活动", name: "「不要笑挑战」", hit: "挑战" },
			{ category: "版本活动", name: "「酷得走火—宇宙！咻！咻！大挑战！」", hit: "挑战" },
			{ category: "特殊活动", tags: ["周年活动"], name: "「深度巡防-三倍赏金」", hit: "深度巡防" },
			{ category: "常规活动", name: "「极限裁决试炼」", hit: "极限" },
			{ category: "常规活动", name: "「全息强袭战域」", hit: "全息" },
			{ category: "特殊活动", name: "「决战『金手指』之巅」", hit: "决战" }
		];
		for (const r of NAME_ROWS) {
			const withName = T.eventTier(r);
			// 旧语义 `hay = category || name` 的等价输入：有类别事实时名字根本不参与 ⇒ 摘掉 name
			const noName = T.eventTier({ category: r.category, tags: r.tags });
			check(`⑩ 名字命中「${r.hit}」：带 name ⇒ 第一档；**摘掉 name ⇒ 第二档**（${r.name}）`,
				withName === 1 && noName === 2, JSON.stringify([withName, noName]));
		}
		// `tags` 不是摆设：终末地 6 条都**只有 tags**（没有 category），其中 2 条的第一档完全来自 tags
		const endEvents = (results.endfield && results.endfield.rec.events) || [];
		const tagsOnly = endEvents.filter((x) => ("tags" in x) && !("category" in x));
		const tagDriven = tagsOnly.filter((x) => T.eventTier({ name: x.title, tags: x.tags }) === 1);
		check("⑩ tags 确实影响档位（不是「摘掉也无影响」）：终末地 tags-only 6 条里有 2 条 ⇒ 带 tags 第一档、摘掉 tags 第二档",
			tagsOnly.length === 6 && tagDriven.length === 2
			&& tagDriven.every((x) => T.eventTier({ name: x.title }) === 2),
			JSON.stringify(tagsOnly.map((x) => [x.title, T.eventTier({ name: x.title, tags: x.tags }), T.eventTier({ name: x.title })])));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("category / tags 批 3 ⑪：逐款逐时刻外显（真 `scheduleCellOf` / 真 `pickEventPrimary`）—— 变化项逐条登记");
	{
		const hasFacts = (x) => (typeof x.category === "string" && x.category !== "")
			|| (Array.isArray(x.tags) && x.tags.length > 0);
		// **改前**的等价 oracle：真 `T.pickEventPrimary`，只是把「有类别事实时旧规则忽略 name」喂回去。
		// 这不是近似 —— 旧 haystack 就是 `category || name`，有类别事实时名字本来就不参与。
		const beforeOf = (events) => {
			const adapted = events.map((x) => ({
				item: x,
				name: hasFacts(x) ? "" : (x.title || ""),
				category: x.category, tags: x.tags,
				startTs: x.startTs, endTs: x.endTs,
				phase: x.phase && typeof x.phase === "object" ? x.phase.kind : x.phase
			}));
			const p = T.pickEventPrimary(adapted);
			return p ? p.item.title : null;
		};
		// **改后** = 显示层本体：面板那一格真正选的那条
		const afterOf = (events, at, gameId) => {
			const cell = T.scheduleCellOf({ id: gameId, name: gameId, tz: TZ_CN, events }, "event", new Date(at));
			return cell && cell.primary ? cell.primary.title : null;
		};

		// ① 每款 ≥6 个时刻（从**真夹具**记录的活动窗里取，覆盖并行活动窗）
		const SAMPLES = [];   // { game, at, mode, before, after, events? }
		for (const p of PATHS) {
			const r = results[p.key];
			if (!r) continue;
			const ev = r.rec.events || [];
			const ms = momentsOf(ev);
			check(`⑪（${p.key}）采样时刻 ≥ 6（覆盖有并行活动的时间窗）`, ms.length >= 6, `实际 ${ms.length} 个`);
			for (const t of ms) {
				SAMPLES.push({ game: p.key, at: t, mode: "record", before: beforeOf(ev), after: afterOf(ev, t, p.id) });
			}
		}

		// ② 「应用在时刻 t 运行」：抓取与显示都在 t。**只有这样才能覆盖到线上真实行在期的窗口**
		//    —— 夹具是全量活动表，抓取时按 now 过滤，只换显示时刻是看不到那几行的。
		//    （每对 `[时刻, [游戏...]]` 只取该刻真有在期活动的那几款：PJSK 的 events.json 从 2025-02
		//     之后才有条目 ⇒ 不硬凑。）
		// ⚠️ 2026-11-09（「起点未知 ≠ 已开始」）：星铁原来挂在下面 8 个 zzz 时刻上 —— 那 8 个时刻
		//    星铁夹具里**没有任何行真正覆盖**（行是 2026-09~12 的），它之所以"有在期活动"，是因为
		//    `4.6版本更新后 ~ …` 那种**起点为 null** 的行被当成了已开始（假在期）。收紧后那 8 个时刻
		//    星铁确实空 ⇒ 改成真有在期项的时刻（10-25：镇伏『贪饕』09-28~11-10 与「爱，幽灵与机器人」
		//    10-21~12-02 都在期），并在断言里额外钉住"未来/起点未知的行不算在期"。
		const RUN_AT = [
			["2025-01-29T12:00:00.000Z", ["zzz"]],   // 绝区零「决战『金手指』之巅」在期
			["2025-02-06T12:00:00.000Z", ["zzz"]],   // 同上（外显的"前一条"已换成「全新放送」第十一期）
			["2025-06-16T12:00:00.000Z", ["zzz"]],   // 绝区零「全息强袭战域」在期
			["2025-06-24T12:00:00.000Z", ["zzz"]],
			["2026-05-20T12:00:00.000Z", ["zzz"]],   // 绝区零「极限裁决试炼」在期
			["2026-05-24T12:00:00.000Z", ["zzz"]],
			["2026-05-26T12:00:00.000Z", ["zzz"]],   // 同窗口：档位翻成第一档，但外显本来就是它（不变）
			["2026-08-14T12:00:00.000Z", ["zzz"]],   // 绝区零「深度巡防-三倍赏金」在期（档位翻了、外显不变）
			["2026-10-25T12:00:00.000Z", ["hsr"]],   // 星铁活动一览：09-28 与 10-21 开的两条都在期
			["2026-12-22T12:00:00.000Z", ["pjsk"]]   // PJSK：名字里「故事」命中（档位翻了、外显不变）
		];
		for (const [atISO, games] of RUN_AT) {
			const at = Date.parse(atISO);
			for (const key of games) {
				const p = PATHS.find((x) => x.key === key);
				const e = engineAt(at);
				const src = e.__test.SOURCES.find((s) => s.id === p.id);
				const payload = await p.call(e.__test, src);
				const rec = e.__test.mergeEntryRecord({ data: payload || {} }, null, at, { id: p.id, tz: src.tz });
				const ev = rec.events || [];
				check(`⑪ 时刻 ${atISO}（${key}）该刻有在期活动（夹具是全量表，靠 now 过滤）`, ev.length > 0, `${ev.length} 条`);
				SAMPLES.push({ game: key, at, atISO, mode: "run", before: beforeOf(ev), after: afterOf(ev, at, p.id), events: ev });
			}
		}

		// ③ 逐条钉住 8 个 zzz 时刻 + 1 个 pjsk 时刻的「改前 → 改后」（= 有意变化清单的时刻级版本）
		const RUN_EXPECT = {
			zzz: {
				"2025-01-29T12:00:00.000Z": ["「若能化作天琴」", "「决战『金手指』之巅」"],
				"2025-02-06T12:00:00.000Z": ["「全新放送」第十一期", "「决战『金手指』之巅」"],
				"2025-06-16T12:00:00.000Z": ["「全新放送」第十一期", "「全息强袭战域」"],
				"2025-06-24T12:00:00.000Z": ["「全新放送」第十一期", "「全息强袭战域」"],
				"2026-05-20T12:00:00.000Z": ["「先遣赏金-区域巡防」第十四期", "「极限裁决试炼」"],
				"2026-05-24T12:00:00.000Z": ["「先遣赏金-区域巡防」第十四期", "「极限裁决试炼」"],
				"2026-05-26T12:00:00.000Z": ["「极限裁决试炼」", "「极限裁决试炼」"],
				"2026-08-14T12:00:00.000Z": ["「深度巡防-三倍赏金」", "「深度巡防-三倍赏金」"]
			},
			pjsk: { "2026-12-22T12:00:00.000Z": ["这则故事承载着希望", "这则故事承载着希望"] }
		};
		for (const s of SAMPLES) {
			if (s.mode !== "run") continue;
			const want = RUN_EXPECT[s.game] && RUN_EXPECT[s.game][s.atISO];
			if (!want) continue;
			check(`⑪ 时刻 ${s.atISO}（${s.game}）外显：${JSON.stringify(want[0])} → ${JSON.stringify(want[1])}`,
				s.before === want[0] && s.after === want[1], JSON.stringify([s.before, s.after]));
		}

		// ④ 档位翻转清单（行级，全采样汇总）：谁从第二档升到第一档
		const oldTierOf = (x) => T.eventTier({ name: hasFacts(x) ? "" : (x.title || ""), category: x.category, tags: x.tags });
		const records = [];
		for (const p of PATHS) { const r = results[p.key]; if (r) records.push([p.key, r.rec.events || []]); }
		for (const s of SAMPLES) if (s.events) records.push([s.game, s.events]);
		const flipObserved = new Map();
		for (const [k, ev] of records) {
			for (const x of ev) {
				const nowT = T.eventTier({ name: x.title || "", category: x.category, tags: x.tags });
				const oldT = oldTierOf(x);
				if (nowT !== oldT) flipObserved.set(`${k}|${x.title}`, { nowT, oldT });
			}
		}
		// **有意变化清单 · 档位级**（5 条；全部 2 → 1，没有一条降档）
		const OR_TIER_FLIPS = [
			{ game: "zzz", title: "「决战『金手指』之巅」", hit: "决战" },
			{ game: "zzz", title: "「全息强袭战域」", hit: "全息" },
			{ game: "zzz", title: "「极限裁决试炼」", hit: "极限" },
			{ game: "zzz", title: "「深度巡防-三倍赏金」", hit: "深度巡防" },
			{ game: "pjsk", title: "这则故事承载着希望", hit: "故事" }
		];
		const flipKey = (c) => `${c.game}|${c.title}`;
		const flipRegistered = new Map(OR_TIER_FLIPS.map((c) => [flipKey(c), c]));
		for (const [k, v] of flipObserved) {
			check(`⑪ **未登记的档位变化**：${k}（只允许清单里的 5 条，且只许 2 → 1）`,
				flipRegistered.has(k) && v.oldT === 2 && v.nowT === 1, JSON.stringify(v));
		}
		for (const [k, c] of flipRegistered) {
			check(`⑪ 清单登记「${c.hit}」命中 → 档位确实升到第一档：${k}`, flipObserved.has(k), JSON.stringify([...flipObserved.keys()]));
		}

		// ⑤ 外显变化清单（**有意变化**，3 条）：未登记的意外变化 ⇒ 红（这正是任务书要的那道闸）
		// ⚠️ FGO 豁免：它的活动外显走特化规则 `schedulePickFgoEvent`（`SCHEDULE_SIDE_RULES` 的
		//    `"fgo:event"`），**根本不读 `eventTier`** ⇒ 本任务不可能改它；下面单独钉它的外显快照。
		// 每条登记 = 「这次新上位的**那一条**」+ 它可能顶掉的「改前那条」集合（同一窗口里前一条会随时间
		// 变化：决战窗口里先后是「若能化作天琴」/「美梦如约而至」/「全新放送」第十一期）。
		const OR_DISPLAY_CHANGES = [
			{ game: "zzz", after: "「决战『金手指』之巅」", hit: "决战", from: ["「全新放送」第十一期", "「若能化作天琴」", "「美梦如约而至」"] },
			{ game: "zzz", after: "「全息强袭战域」", hit: "全息", from: ["「全新放送」第十一期"] },
			{ game: "zzz", after: "「极限裁决试炼」", hit: "极限", from: ["「先遣赏金-区域巡防」第十四期"] }
		];
		const dispObserved = new Map();
		for (const s of SAMPLES) {
			if (s.game === "fgo") continue;            // 特化规则，见上
			if (s.before === s.after) continue;
			const k = `${s.game}|${s.after}|${s.before}`;
			if (!dispObserved.has(k)) dispObserved.set(k, new Date(s.at).toISOString());
		}
		const dispByAfter = new Map(OR_DISPLAY_CHANGES.map((c) => [`${c.game}|${c.after}`, c]));
		for (const [k, at] of dispObserved) {
			const [game, after, before] = k.split("|");
			const reg = dispByAfter.get(`${game}|${after}`);
			check(`⑪ **未登记的外显变化**（会红）：${k}（首次 ${at}）`, !!reg && reg.from.includes(before), k);
		}
		for (const c of OR_DISPLAY_CHANGES) {
			const got = [...dispObserved.keys()].filter((k) => k.startsWith(`${c.game}|${c.after}|`));
			check(`⑪ 清单登记「${c.hit}」命中的外显变化确实发生：${c.game} → ${c.after}（顶掉 ${c.from.join(" / ")} 之一）`,
				got.length > 0, JSON.stringify([...dispObserved.keys()]));
		}
		// FGO：外显快照不变（它不走 eventTier；这里只钉"采样时刻的外显就是这条"，防以后有人把特化规则删掉）
		const fgoSamples = SAMPLES.filter((s) => s.game === "fgo");
		check("⑪（fgo）9 个采样时刻的外显全是「迦勒底·U－夏日岛 ～总统会梦见夏日吗？～」（特化规则，与 eventTier 无关）",
			fgoSamples.length >= 6 && fgoSamples.every((s) => s.after === "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～"),
			JSON.stringify(fgoSamples.map((s) => s.after)));
		// 反证（显示层）：三条有意变化的「改前那条」都必须落在登记的 `from` 集合里 —— 把 name 从 haystack
		// 摘掉（= 旧语义）后，显示层给出的正是这些 `from`，也就是此刻的 `after` 会**退回**到它们。
		for (const c of OR_DISPLAY_CHANGES) {
			const hit = SAMPLES.find((s) => s.game === c.game && s.after === c.after && c.from.includes(s.before));
			check(`⑪ 反证：摘掉 name ⇒ 显示层退回登记里的改前那条（${c.from.join(" / ")} 之一），该变化 100% 来自名字命中「${c.hit}」`,
				!!hit, JSON.stringify([c, SAMPLES.filter((s) => s.game === c.game && s.after === c.after).map((s) => s.before)]));
		}
	}
}
