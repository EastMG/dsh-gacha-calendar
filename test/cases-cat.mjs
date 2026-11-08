// test/cases-cat.mjs —— cat / tags 批 1（2026-11-08）：把"已经在内存里"的分类写进数组条目
//
// ── 为什么有这一批 ──
// `50-refresh.js` 的 `itemFacts` 通道（`{ "<标题>": { cat?, tags? } }` → 贴到 `gacha`/`events`
// 数组条目上）与 `GACHA_FIELDS` / `EVENT_FIELDS` 的白名单**早就存在**，但此前只有 FGO 在用。
// 另有 8 款游戏的解析器**其实已经把类别读进变量**，只是在收口成数组时丢掉了：
//   终末地（`data.tags`）、重返未来1999（`sec.kind`）、明日方舟（SMW「活动类型」）、原神（SMW「类型」）、
//   星铁（表「类型」列）、女神异闻录5X（`block.category`）、PJSK（`eventType`）、
//   （雪松：`倒计时名称` —— **本批判定不该补**，见下面第 ④ 段）。
//
// ── 本文件守四件事 ──
//   ① **只写不猜**：每款用真夹具，逐条钉死 `events[]` 条目上的 `cat` / `tags` **实际值**；
//      源站没给这一列的那一条**没有**这个键（不是空串、不是猜出来的词）。
//   ② **档位**：把补上的值喂给 `eventTier`，钉住它是第一档还是第二档 —— 这是这些事实**唯一**的消费方
//      （`25-parser-order.js` 的 `EVENT_TIER1_RE`；规则见 `81-schedule-model.js` 的 `sideViewOf`）。
//   ③ **外显**：直接走显示层本体 `T.scheduleCellOf`（= 面板那一格真正选的那条），逐款钉住"变没变"。
//      **本批只有终末地一款变了外显**，而且是**对齐**（从"结束最早那条"变成引擎自己挑的挑战活动），
//      下面 ③ 里用一条显式标注意图的断言钉死它。
//   ④ **反证**：把 `cat`/`tags` 摘掉 ⇒ 档位与外显回到改造前的样子（这同时就是"老缓存没有这两个键
//      ⇒ 行为与今天一致"的证明：老缓存的数组条目上根本没有这两个键）。
//
// ⚠️ 与 `cases-p3.mjs` 的口径分工：那边的 golden / 等价性 oracle 都是**改造前**的产物（数组条目上
//    没有 cat/tags），所以那边比较前统一摘掉这两个键；它们的**取值**由本文件钉。

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
	if (/p5x\.wanmei\.com\/news\/gamenews\/index\.html/.test(u)) return B.p5xList;
	if (/p5x\.wanmei\.com\/news\/gamenews\/\d+\/\d+\.html/.test(u)) return B.p5xDetail;
	if (/sekai-master-db/.test(u)) return B.sekai;
	if (/kedrgame\/api\.php\?action=parse&page=Template/.test(u)) return B.kedr;
	if (/fgo\.wiki\/api\.php\?action=parse/.test(u)) return B.fgo;
	throw new Error("cat/tags 批 1 没有这个 URL 的夹具：" + u);
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

// ── 期望值（**逐字**，取自真夹具；`cat`/`tags` 为 `undefined` = 该条没有这个键）──────────────
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
		{ title: "佩施塔·雪红与玫瑰白", cat: "角色剧情活动" },
		{ title: "亚特兰蒂斯谋杀案·上篇", cat: "签到活动" },
		{ title: "推理演绎", cat: "说明" },
		{ title: "烟斗客指津", cat: "说明" },
		{ title: "吼吼点唱机：余下的真相", cat: "新品上架" },
		{ title: "亚特兰蒂斯谋杀案", cat: "活动正篇" },
		{ title: "红鲱鱼推理爱好社", cat: "说明" },
		{ title: "幸存者游戏", cat: "8-bit街机秀" },
		{ title: "狂想与解构", cat: "活动介绍" },
		{ title: "鬃毛邮报", cat: "活动介绍" },
		{ title: "星光礼赠", cat: "活动介绍" },
		{ title: "衣着风尚", cat: "新品上架" },
		{ title: "注定之城", cat: "新品上架" },
		{ title: "焦点闪回", cat: "周期挑战玩法" },
		{ title: "书页与小憩", cat: "大英图书馆联动活动" }
	],
	arknights: [
		// 这一条页内的「活动类型」就是「视相博物馆」（源站原样，不做归一）
		{ title: "视相博物馆：演化", cat: "视相博物馆" },
		{ title: "登录活动：感谢庆典2026限时签到", cat: "登录活动" },
		{ title: "支线故事：时间啊，向前！", cat: "支线故事" }
	],
	genshin: [
		{ title: "「坏灭肇始之时」", cat: "剧情活动" },
		{ title: "「相遇·悠久旅途之暇」", cat: "特殊活动", tags: ["千音雅集"] },
		{ title: "「绮衣珍赏·赫炽」", cat: "特殊活动", tags: ["千星奇域"] },
		{ title: "「全域镇卫·逆捍谬罚」", cat: "角色获取", tags: ["版本活动"] },
		{ title: "「晶石如林生长之地」", cat: "探索活动" }
	],
	hsr: [
		{ title: "「镇伏『贪饕』，汇聚愿力」", cat: "版本活动" },
		{ title: "「巡星之礼」第二十七期", cat: "额外活动" },
		{ title: "「爱，幽灵与机器人」", cat: "版本活动" }
	],
	p5x: [
		{ title: "2.5周年时光庆典", cat: "活动更新" },
		{ title: "怪盗团团长的特训日程", cat: "活动更新" },
		{ title: "2.5周年庆典特别福利", cat: "活动更新" },
		{ title: "2.5周年特别礼包", cat: "活动更新" },
		{ title: "2.5周年特别回馈", cat: "活动更新" },
		{ title: "2.5周年魅影通行证", cat: "活动更新" }
	],
	pjsk: [{ title: "Colors of Pure Sense", cat: "marathon" }],
	// 雪松：本批**未补**（理由见第 ④ 段）⇒ 条目上一个类别键都没有
	kedr: [
		{ title: "战令通行证赛季" },
		{ title: "第三期边境防卫活动" },
		{ title: "个人剧情活动第1期：【新机动队故事】" }
	],
	// FGO：批 1 之前就已落地（`30-game-aniplex.js:262`），本批只改了 `EVENT_TIER1_RE` 认英文
	fgo: [
		{ title: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", cat: "Event" },
		{ title: "「总统特异点」通关应援纪念活动 第2弹", cat: "Campaign" },
		{ title: "「冠位戴冠战：Extra」开幕前夕纪念活动", cat: "Campaign" },
		{ title: "Final Order Project [Lostbelt No.1]通关应援纪念活动", cat: "Campaign" },
		{ title: "Final Order Project [Lostbelt No.2]通关应援纪念活动", cat: "Campaign" }
	]
};

// ── 期望的档位（`eventTier`：1 = 第一档，2 = 第二档）────────────────────────────────────
const EXPECT_TIER = {
	endfield: [2, 1, 2, 2, 2, 1],
	r1999: [1, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 2],
	arknights: [2, 2, 1],
	genshin: [1, 2, 2, 2, 2],
	hsr: [2, 2, 2],
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
	p5x: { before: "2.5周年时光庆典", after: "2.5周年时光庆典", changed: false },
	pjsk: { before: "Colors of Pure Sense", after: "Colors of Pure Sense", changed: false },
	kedr: { before: "个人剧情活动第1期：【新机动队故事】", after: "个人剧情活动第1期：【新机动队故事】", changed: false },
	fgo: { before: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", after: "迦勒底·U－夏日岛 ～总统会梦见夏日吗？～", changed: false }
};

export default async function runCat() {
	useFixtures();   // 兜底：任何"漏网的真网络"都直接抛错

	// 逐条跑：抓取器 → mergeEntryRecord（与 refresh() 同一段代码）
	const results = {};
	for (const p of PATHS) {
		const e = engineAt(p.now);
		const src = e.__test.SOURCES.find((s) => s.id === p.id);
		if (!src) { check(`cat/tags 批 1：能找到来源 ${p.id}`, false, p.id); continue; }
		const payload = await p.call(e.__test, src);
		const rec = e.__test.mergeEntryRecord({ data: payload || {} }, null, p.now, { id: p.id, tz: src.tz });
		results[p.key] = { payload, rec, src, now: new Date(p.now), engine: e };
	}

	// 数组条目 → `eventTier` 认的形状（`81-schedule-model.js` 的 `sideViewOf` 那一层只读适配）
	const tierOf = (x) => T.eventTier({ name: x.title || "", cat: x.cat, tags: x.tags, startTs: x.startTs, endTs: x.endTs });

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ①：8 款 `events[]` 条目上的 cat / tags —— 真夹具逐字（只写不猜）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const arr = r.rec.events || [];
		const exp = EXPECT[p.key];
		check(`（${p.key}）数组非空（夹具真的产出了条目，而不是悄悄退回空数组）`, arr.length === exp.length,
			`实际 ${arr.length} 条 / 期望 ${exp.length} 条`);
		const got = arr.map((x) => {
			const o = { title: x.title };
			if ("cat" in x) o.cat = x.cat;
			if ("tags" in x) o.tags = x.tags;
			return o;
		});
		check(`（${p.key}）条目顺序 + \`cat\` / \`tags\` 取值逐字相等（缺的那条**没有**这个键）`,
			JSON.stringify(got) === JSON.stringify(exp), JSON.stringify(got));
		// 反向：不许出现空串 / 空数组这类"写了个空值"的假事实
		check(`（${p.key}）没有空串 \`cat\` / 空 \`tags\`（要么有值、要么没这个键）`,
			arr.every((x) => !("cat" in x) || (typeof x.cat === "string" && x.cat !== ""))
			&& arr.every((x) => !("tags" in x) || (Array.isArray(x.tags) && x.tags.length > 0)),
			JSON.stringify(arr.map((x) => [x.cat, x.tags])));
		check(`（${p.key}）这两个事实只是"解析器→数据层"的一跳：记录里没有 \`itemFacts\``,
			!("itemFacts" in r.rec), JSON.stringify(Object.keys(r.rec)));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ②：`eventTier` 对补上的值给出预期档位（第一档 / 第二档）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const arr = r.rec.events || [];
		const got = arr.map(tierOf);
		check(`（${p.key}）逐条档位 = ${EXPECT_TIER[p.key].join("/")}`, JSON.stringify(got) === JSON.stringify(EXPECT_TIER[p.key]),
			JSON.stringify(got));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ③：显示层外显 —— 直接走 `T.scheduleCellOf`（面板那一格真正选的那条）");
	for (const p of PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const g = Object.assign({ id: p.id, name: p.id, tz: TZ_CN }, r.rec);
		const cell = T.scheduleCellOf(g, "event", r.now);
		const after = cell && cell.primary ? cell.primary.title : null;
		check(`（${p.key}）外显 = ${JSON.stringify(EXPECT_PRIMARY[p.key].after)}`, after === EXPECT_PRIMARY[p.key].after, JSON.stringify(after));
		// 老缓存 / 改造前等价：数组条目上**没有** cat/tags 时，外显就是改造前的样子
		const oldRec = Object.assign({}, r.rec, { events: (r.rec.events || []).map((x) => { const o = Object.assign({}, x); delete o.cat; delete o.tags; return o; }) });
		const oldCell = T.scheduleCellOf(Object.assign({ id: p.id, name: p.id, tz: TZ_CN }, oldRec), "event", r.now);
		const before = oldCell && oldCell.primary ? oldCell.primary.title : null;
		check(`（${p.key}）摘掉 cat/tags ⇒ 外显回到改造前：${JSON.stringify(EXPECT_PRIMARY[p.key].before)}（= 老缓存的行为）`,
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
			check(`（${p.key}）外显**未变**（补 cat/tags 不动用户已看到的这一条）`, before === after, JSON.stringify([before, after]));
		}
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ④：雪松 —— `timer` 有值但**故意不补**（补了会让档位退化）");
	{
		const r = results.kedr;
		const arr = (r && r.rec.events) || [];
		// 源站确实给了类别词（模板参数「倒计时名称」），但都不在 `EVENT_TIER1_RE` 里。
		const timers = ["赛季", "边境防卫", "活动"];
		check("雪松：源站的「倒计时名称」三个值都不在第一档词表里（所以它不是有用的类别词）",
			timers.every((x) => T.eventTier({ cat: x }) === 2), JSON.stringify(timers.map((x) => T.eventTier({ cat: x }))));
		// 若真把它当 cat 写进去：原本靠**活动名**命中第一档的「个人剧情活动第1期」会掉到第二档，
		// 外显随之从它变成「战令通行证赛季」—— 这就是"不该发生的变化"。
		const whatIf = arr.map((x, i) => { const o = Object.assign({}, x); o.cat = ["赛季", "边境防卫", "活动"][i] || ""; return o; });
		const g = Object.assign({ id: "kedr", name: "kedr", tz: TZ_CN }, r.rec, { events: whatIf });
		const cell = T.scheduleCellOf(g, "event", r.now);
		const after = cell && cell.primary ? cell.primary.title : null;
		check("雪松：**假如**补 cat，外显会退化成「战令通行证赛季」（改造前是「个人剧情活动第1期：【新机动队故事】」）",
			after === "战令通行证赛季", JSON.stringify(after));
		check("雪松：所以本批不补 —— 条目上一个类别键都没有（不写 > 写错）",
			arr.length > 0 && arr.every((x) => !("cat" in x) && !("tags" in x)),
			JSON.stringify(arr.map((x) => [x.title, x.cat, x.tags])));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ⑤：`EVENT_TIER1_RE` 的英文分支（FGO 的 Event / Campaign / Other）");
	{
		const tier = (o) => T.eventTier(o);
		check("`Event`（源站类型列原样）= 第一档", tier({ cat: "Event" }) === 1, String(tier({ cat: "Event" })));
		check("`Campaign` = 第一档（与 Event 同视作「活动正篇」）", tier({ cat: "Campaign" }) === 1, String(tier({ cat: "Campaign" })));
		check("`Other` = 第二档（FGO 的第三个分类，不许被英文分支误命中）", tier({ cat: "Other" }) === 2, String(tier({ cat: "Other" })));
		// 词边界防护：不带 `\b` 时 `Events` / `Eventful` 会被裸 `Event` 命中；`Pother` 也不该命中。
		check("词边界：`Events` / `Eventful` / `Campaigns` / `Campaigner` 都**不是**分类词 ⇒ 第二档",
			tier({ cat: "Events" }) === 2 && tier({ cat: "Eventful" }) === 2
			&& tier({ cat: "Campaigns" }) === 2 && tier({ cat: "Campaigner" }) === 2,
			JSON.stringify([tier({ cat: "Events" }), tier({ cat: "Eventful" }), tier({ cat: "Campaigns" }), tier({ cat: "Campaigner" })]));
		check("词边界：`Event` 嵌在别的词里不算（`Pother` / `OpEvent`）",
			tier({ cat: "Pother" }) === 2 && tier({ cat: "OpEvent" }) === 2,
			JSON.stringify([tier({ cat: "Pother" }), tier({ cat: "OpEvent" })]));
		check("中文里的英文分类词照样命中（`Event 复刻` 这种源站写法）", tier({ cat: "Event 复刻" }) === 1, String(tier({ cat: "Event 复刻" })));
		check("`Other` 与中文第一档词共存时按中文判（`Other 剧情活动` ⇒ 第一档，不因为 Other 而降档）",
			tier({ cat: "Other 剧情活动" }) === 1, String(tier({ cat: "Other 剧情活动" })));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("cat / tags 批 1 ⑥：反证 —— 摘掉补上的值，档位 / 外显就往回退（不是「看起来绿」）");
	{
		// A. 终末地：tags「挑战活动」是第一档的唯一来源（活动名里没有第一档关键词）
		const arr = results.endfield.rec.events || [];
		const bare = arr.map((x) => { const o = Object.assign({}, x); delete o.cat; delete o.tags; return o; });
		check("终末地：`百趣演武` 的名字本身判不出第一档（摘掉 tags ⇒ 第二档）",
			tierOf(arr.find((x) => x.title === "百趣演武")) === 1
			&& tierOf(bare.find((x) => x.title === "百趣演武")) === 2,
			JSON.stringify([tierOf(arr.find((x) => x.title === "百趣演武")), tierOf(bare.find((x) => x.title === "百趣演武"))]));
		// B. FGO：不带 `\b` 的英文分支不成立 —— `Other` 那条必须落在第二档
		check("FGO：`Other` 类的那条不会被英文分支抬到第一档（词边界防护的实际效果）",
			T.eventTier({ cat: "Other", name: "「总统特异点」通关应援纪念活动 第2弹" }) === 2,
			String(T.eventTier({ cat: "Other", name: "「总统特异点」通关应援纪念活动 第2弹" })));
		// C. 原神：`剧情活动` 是第一档的唯一来源（名字「坏灭肇始之时」没有关键词）
		const gArr = results.genshin.rec.events || [];
		const gBare = gArr.map((x) => { const o = Object.assign({}, x); delete o.cat; delete o.tags; return o; });
		check("原神：摘掉 cat ⇒ `「坏灭肇始之时」` 从第一档掉到第二档（cat 是唯一来源）",
			tierOf(gArr[0]) === 1 && tierOf(gBare[0]) === 2,
			JSON.stringify([tierOf(gArr[0]), tierOf(gBare[0])]));
		// D. 重返未来1999：`活动正篇` / `角色剧情活动` 同样是名字判不出来的
		const rArr = results.r1999.rec.events || [];
		const rBare = rArr.map((x) => { const o = Object.assign({}, x); delete o.cat; delete o.tags; return o; });
		const pickTier = (list) => list.map(tierOf);
		check("重返未来1999：摘掉 cat ⇒ 3 条第一档（角色剧情活动 / 活动正篇 / 周期挑战玩法）同时掉档",
			pickTier(rArr).filter((x) => x === 1).length === 3 && pickTier(rBare).every((x) => x === 2),
			JSON.stringify([pickTier(rArr).filter((x) => x === 1).length, pickTier(rBare).filter((x) => x === 1).length]));
	}
}
