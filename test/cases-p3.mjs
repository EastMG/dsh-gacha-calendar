// test/cases-p3.mjs —— P3（第一批）：**解析器直出数组** + 悬停由条目**反生成**
//
// ── 为什么需要这一批 ──
// P1 的两个数组（`gacha` / `events`）是 `50-refresh.js` 从**旧字符串字段**反解出来的（悬停文本 → 并列条目），
// P2 把显示层改成读数组。这就留下一个"两套事实"的隐患：悬停文本是**手拼**的、数组是**从那段文本猜**的，
// 谁改了排版（多一个空格、少一行）都会让两边悄悄错位 —— 而面板看起来仍然正常。
//
// P3 把方向倒过来：**条目是事实**（解析器直接产出 `gacha` / `events`），悬停文本由条目生成
// （`hoverTextFromItems`，排版与 buildPoolHover / buildEventHover **逐字一致**）。
// 本批只切 3 款（原神卡池+活动 / 明日方舟卡池+活动 / 鸣潮卡池+活动），其余保持 P1 的合成路径。
//
// 这一段守四件事（任何一件错了都不会报错、只会"看起来正常"）：
//   ① **排版规则逐条**：生成器的分隔符 / 同窗口折叠 / 不足 2 条给空串 / 缺起止写原文 / 长期窗口过滤；
//   ② **用户可见输出逐字不变**：3 款 6 条路径的 12 个字符串字段与改造前（HEAD d4656e9 跑同一批夹具）
//      **逐字相等**（golden 是写死的字面量，不是拿当前实现现算）；
//   ③ **数组逐条相等**：非时间字段整段 JSON 与 golden 逐字相同；`startTs`/`endTs` 只比**类型**
//      （P1 的口径 = 本机时刻，见 README_Dev「已知不等价①」），但**值与改造前的合成结果**逐条相等
//      —— 用"把解析器给的数组摘掉、让旧合成器照同一份字符串字段再合成一次"来当对照（UTC / +08 都成立）；
//   ④ **同源**：`hoverTextFromItems(解析器给的条目事实)` 逐字等于载荷里的悬停文本 ⇒ 悬停确实是**产物**，
//      不是另外手拼的一份；条目事实是**通道**，不进记录、不落盘。

import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, summary, useFixtures, fixtureBody, makeFetchTransport } from "./harness.mjs";
import { T, FIXTURES_DIR } from "./load.mjs";
import { LEGACY } from "./legacy-golden.mjs";

const TZ_CN = "Asia/Shanghai";
// 时钟 = 夹具抓取时刻（不随跑测日期漂移）
const NOW_GEN = Date.parse("2026-11-07T00:28:21.868Z");
const NOW_AK = Date.parse("2026-11-07T00:00:00.000Z");
const NOW_WUWA = NOW_AK;

const AT = (s) => Date.parse(s);

// ── 改造前的**合成器 oracle** → 已固化成**字面量 golden**（P5 清理，2026-11-08）──────────────
// P3c 之前，`50-refresh.js` 有两个把"记录字符串 + 悬停文本"合成整列数组的函数
// （`dataArrayGachaOf` / `dataArrayEventsOf`，经 `dataArrayHoverPoolsOf` 展开并列条目）。
// 最后 3 款切完后它们**已从产品里删除**，于是"数组 == 改造前的合成结果"这条断言必须有对照：
// P3c 当时用同一批纯函数复刻了一遍（主条 = `dataArray*MainOf` 从**记录字符串**造；并列条 =
// `scheduleHoverItems` 逆解**悬停文本**后过 `dataArrayExtrasFromEntriesOf`；发 key =
// `dataArrayProducedListOf`），也就是 `legacySynthArrOf`。
//
// ⚠️ 那个复刻**依赖产品里的死代码**（`scheduleHoverItems` + `dataArrayExtrasFromEntriesOf` 的 `win`
//    分支），所以 P5 清理把它的**输出**固化成字面量（`test/fixtures/legacy-oracle-golden.json` 的
//    `p3Synth`，键 = `<路径 key>:<side>`），断言改成"**当前解析器直出 == 该字面量**"。
//    证据仍然是"改造前界面本来会显示的那几条"，只是不再需要跑改造前的代码。
// ⚠️ 字面量由 HEAD `d3e9d35` 的 `legacySynthArrOf` 原样采出（见 test/legacy-golden.mjs 顶部）。
const legacySynthArrOf = (key, side) => {
	const all = LEGACY.p3Synth || {};
	const k = key + ":" + side;
	if (!(k in all)) throw new Error("legacy-oracle-golden.json 缺键 " + k + " —— 等价性 oracle 覆盖不全");
	return all[k];
};

// ── category / tags 批 1（2026-11-08）：比较前摘掉 `category` / `tags` ──────────────────────────────
// 本批把"解析器早就拿在手里"的类别事实（`category` / `tags`）写进了 `events[]` / `gacha[]` 条目
// （见 README_Dev「category / tags 来源与现状」）。而本文件所有 golden（P3 ② 的字面量、
// `p3b-golden.json` / `p3d-golden.json`）与等价性 oracle（`legacySynthArrOf` = 冻结的"改造前
// 合成结果"）都是**改造前**的产物 —— 那时条目上根本没有这两个键。
//
// 所以比较口径改为："**除 category / tags 外**，条目与改造前逐字相等"（键序 / 顺序 / source / phase /
// 其余可选事实全等）。⚠️ 刻意**不改写** golden / oracle：P3 的采集模式明确禁止"改完再采集"
// （那会把回归钉成现状，见各采集模式上方的注释）。新增事实的**取值**由 `test/cases-category.mjs`
// 用真夹具逐款逐字钉住（含 `category` / `tags` 的实际值与 `eventTier` 档位）。
const sansCategoryTags = (arr) => (arr || []).map((x) => {
	if (!x || typeof x !== "object") return x;
	const o = Object.assign({}, x);
	delete o.category;
	delete o.tags;
	return o;
});
// golden 里存的数组是**已经归一过 ts 的 JSON 字符串**（见各 `*SansTs`）⇒ 反解后只摘 category/tags，
// **不要**再过一次 ts 归一（那会把 "number" 这类占位字符串按 `typeof` 变成 "string"）。
// 于是"实际数组（归一 ts + 摘 category/tags）"与"golden（摘 category/tags）"两边同一口径。
const sansCategoryTagsJson = (json) => JSON.stringify(sansCategoryTags(JSON.parse(json)));

export default async function runP3() {
	useFixtures();   // 只为了装"禁止真网络"的兜底；夹具按需显式读取

	// ── 夹具（P3 新抓；按 URL 选 body，不走 map.json —— 免得改变其它批次对默认源的期望）──
	const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });
	const BODY = {
		genshinBwiki: FIX("p3-genshin-bwiki-gacha"),
		genshinSmw: FIX("p3-genshin-smw-events"),
		akList: FIX("p3-arknights-official-list"),
		akDetail: FIX("p3-arknights-official-detail-4916"),
		akSmw: FIX("arknights-smw-events"),
		wuwaEntry: FIX("p3-wuwa-entry"),
		wuwaHans: FIX("p3-wuwa-zh-hans")
	};
	const pickBody = (url) => {
		const u = String(url);
		if (/wiki\.biligame\.com\/ys\/api\.php\?action=parse/.test(u)) return BODY.genshinBwiki;
		if (/wiki\.biligame\.com\/ys\/api\.php\?action=ask/.test(u)) return BODY.genshinSmw;
		if (/web-news\.hypergryph\.com\/api\/bulletin\/\d+/.test(u)) return BODY.akDetail;
		if (/web-news\.hypergryph\.com\/api\/bulletin/.test(u)) return BODY.akList;
		if (/prts\.wiki\/api\.php\?action=ask/.test(u)) return BODY.akSmw;
		if (/entrypoint\.json/.test(u)) return BODY.wuwaEntry;
		if (/zh-Hans\.json/.test(u)) return BODY.wuwaHans;
		throw new Error("P3 夹具里没有这个 URL：" + u);
	};
	// bwiki 在 transportFetchRaw 里强制走宿主代理 ⇒ 两个出口都要能供同一份 body。
	const transport = {
		async fetchRaw(url) {
			const body = pickBody(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url) { return pickBody(url); }
	};
	const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
	const engineAt = (now) => createEngine({ transport, storage: makeStore(), now: () => now, timer: { setTimeout, clearTimeout } });

	const WUWA_ENTRY = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";
	const AK_LIST = "https://web-news.hypergryph.com/api/bulletin?lang=zh-cn&code=arknights&page=1&pageSize=30";
	const YS_PARSE = "https://wiki.biligame.com/ys/api.php?action=parse&page=x";
	const YS_ASK = "https://wiki.biligame.com/ys/api.php?action=ask&query=x";
	const PRTS_ASK = "https://prts.wiki/api.php?action=ask&format=json&query=x";

	// 跑一条路径：抓取器 → 合并进记录（与 refresh() 里同一段代码）
	const runPath = async (id, side, fetcher, now) => {
		const e = engineAt(now);
		const payload = await fetcher(e);
		const rec = e.__test.mergeEntryRecord({ data: payload || {} }, null, now, { id, tz: TZ_CN });
		return { payload, rec, engine: e };
	};

	// 12 个旧字符串字段（可见字段）—— golden 只钉这些 + 数组
	const VISIBLE = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
		"event", "eventDates", "eventDatesRaw", "eventShow", "eventClaimDates", "eventHover", "eventHoverExtra"];
	// ── category / tags 批 1（2026-11-08）：golden / oracle 里**没有**这两个键 ──────────────────
	// 见文件顶部 `sansCategoryTags` 的说明（本批新增的条目事实不参与"与改造前逐字相等"）。
	const sansTs = (arr) => JSON.stringify(sansCategoryTags(arr).map((x) => {
		const o = Object.assign({}, x, {
			startTs: x.startTs == null ? "null" : typeof x.startTs,
			endTs: x.endTs == null ? "null" : typeof x.endTs
		});
		if (o.phase) o.phase = Object.assign({}, o.phase, {
			startTs: o.phase.startTs == null ? "null" : typeof o.phase.startTs,
			endTs: o.phase.endTs == null ? "null" : typeof o.phase.endTs
		});
		return o;
	}));

	// ══════════════════════════════════════════════════════════════════════════
	section("P3 ①：悬停生成器的排版规则（与 buildPoolHover / buildEventHover 逐字一致）");
	{
		const g1 = { title: "甲", startTs: AT("2026-10-01T04:00:00Z"), endTs: AT("2026-10-05T15:59:00Z") };   // +08 ⇒ 10-01 12:00 ~ 10-05 23:59
		const g2 = { title: "乙", startTs: AT("2026-10-02T04:00:00Z"), endTs: AT("2026-10-09T15:59:00Z") };   // +08 ⇒ 10-02 12:00 ~ 10-09 23:59
		const same1 = { title: "丙", startTs: g1.startTs, endTs: g1.endTs };
		const open = { title: "丁", startTs: null, endTs: null, raw: "4.7版本更新后 ~ 12-02 11:59" };
		const WIN1 = "10-01 12:00 ~ 10-05 23:59";
		const WIN2 = "10-02 12:00 ~ 10-09 23:59";
		const linesOf = (items, kind) => T.hoverLinesFromItems(items, kind, TZ_CN);

		check("活动侧：每行 = `名称` + **3 个空格** + 档期（逐字）",
			JSON.stringify(linesOf([g1, g2], "event")) === JSON.stringify([`甲   ${WIN1}`, `乙   ${WIN2}`]),
			JSON.stringify(linesOf([g1, g2], "event")));
		check("活动侧：窗口全同 ⇒ 每条只写名称、**末尾写一遍**档期",
			JSON.stringify(linesOf([g1, same1], "event")) === JSON.stringify(["甲", "丙", WIN1]),
			JSON.stringify(linesOf([g1, same1], "event")));
		check("活动侧：不足 2 条 ⇒ 空串（交回 UI 单条展示）",
			T.hoverTextFromItems([g1], "event", TZ_CN) === "" && T.hoverTextFromItems([], "event", TZ_CN) === "");
		check("活动侧：缺起止 ⇒ 原样写行内 raw（不编造日期）",
			JSON.stringify(linesOf([g1, open], "event")) === JSON.stringify([`甲   ${WIN1}`, "丁   4.7版本更新后 ~ 12-02 11:59"]),
			JSON.stringify(linesOf([g1, open], "event")));
		check("卡池侧：每条两行（`名称` ⏎ 档期）；窗口全同 ⇒ 末尾只写一遍档期",
			JSON.stringify(linesOf([g1, g2], "gacha")) === JSON.stringify(["甲", WIN1, "乙", WIN2])
			&& JSON.stringify(linesOf([g1, same1], "gacha")) === JSON.stringify(["甲", "丙", WIN1]),
			JSON.stringify([linesOf([g1, g2], "gacha"), linesOf([g1, same1], "gacha")]));
		check("卡池侧：缺起止 ⇒ 档期行写 raw；不足 2 条 ⇒ 空串",
			JSON.stringify(linesOf([g1, open], "gacha")) === JSON.stringify(["甲", WIN1, "丁", "4.7版本更新后 ~ 12-02 11:59"])
			&& T.hoverTextFromItems([g1], "gacha", TZ_CN) === "",
			JSON.stringify(linesOf([g1, open], "gacha")));
		check("卡池侧：`label` 优先于 `title`（池名：角色 那一行）",
			T.hoverTextFromItems([{ title: "池", label: "池：角色", startTs: g1.startTs, endTs: g1.endTs }, same1], "gacha", TZ_CN)
			=== `池：角色\n丙\n${WIN1}`,
			JSON.stringify(T.hoverTextFromItems([{ title: "池", label: "池：角色", startTs: g1.startTs, endTs: g1.endTs }, same1], "gacha", TZ_CN)));
		const longA = { title: "常驻", startTs: AT("2026-01-01T00:00:00Z"), endTs: AT("2026-12-31T00:00:00Z") };
		check("活动侧：长期/常驻窗口（>120 天）与 buildEventHover 一样被剔掉；只剩 1 条 ⇒ 空串",
			T.hoverTextFromItems([longA, g1], "event", TZ_CN) === "" && T.hoverTextFromItems([longA, g1, g2], "event", TZ_CN) === `甲   ${WIN1}\n乙   ${WIN2}`,
			JSON.stringify([T.hoverTextFromItems([longA, g1], "event", TZ_CN), T.hoverTextFromItems([longA, g1, g2], "event", TZ_CN)]));
		check("卡池侧不与活动侧共用「长期过滤」（buildPoolHover 也没有这条）",
			T.hoverTextFromItems([longA, g1], "gacha", TZ_CN) !== "");

		// 去重：同一个池被源描述两遍（「池名：角色」整段包住「角色」那一行）⇒ 只留一条。
		// ⚠️ 留的是**被包住的那条**：`buildPoolHover` 的既有口径（回看 26-parser-hover.js 的注释：
		//    「其中一条的信息整段出现在另一条『：』的某一侧 ⇒ **它是同一池的残缺描述**」）。
		const kept = T.poolHoverKept([
			{ name: "海渊巡游", label: "海渊巡游：克莱门莎", startTs: g1.startTs, endTs: g1.endTs },
			{ name: "克莱门莎", label: "克莱门莎", startTs: g1.startTs, endTs: g1.endTs }
		]);
		check("卡池去重（poolHoverKept）：同一口池的两种写法只留一条（口径与 buildPoolHover 相同）",
			kept.length === 1 && kept[0].label === "海渊巡游：克莱门莎", JSON.stringify(kept));
		// 与老渲染器逐字相同（同一份输入、同一份排版）—— 生成器才算"反向产物"，不是另写一套
		const pools = [
			{ name: "池A", label: "池A：角色甲", startTs: g1.startTs, endTs: g1.endTs, raw: "" },
			{ name: "池B", label: "池B：角色乙", startTs: g2.startTs, endTs: g2.endTs, raw: "" },
			{ name: "池C", startTs: null, endTs: null, raw: "4.7版本更新后 ~ 12-02 11:59" }
		];
		check("生成器输出 == 改造前的 buildPoolHover（同一份池列表，逐字节相同）",
			T.hoverTextFromItems(T.poolHoverKept(pools), "gacha", TZ_CN) === T.buildPoolHover(pools, TZ_CN),
			JSON.stringify([T.hoverTextFromItems(T.poolHoverKept(pools), "gacha", TZ_CN), T.buildPoolHover(pools, TZ_CN)]));
		check("生成器输出 == 改造前的 buildEventHover（同一份活动列表，逐字节相同）",
			T.hoverTextFromItems([g1, g2], "event", TZ_CN) === T.buildEventHover([{ name: "甲", startTs: g1.startTs, endTs: g1.endTs }, { name: "乙", startTs: g2.startTs, endTs: g2.endTs }], 0, TZ_CN),
			JSON.stringify([T.hoverTextFromItems([g1, g2], "event", TZ_CN), T.buildEventHover([{ name: "甲", startTs: g1.startTs, endTs: g1.endTs }, { name: "乙", startTs: g2.startTs, endTs: g2.endTs }], 0, TZ_CN)]));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("P3 ②：3 款 6 条路径 —— 12 个字符串字段与数组逐字不变（golden = 改造前）");
	// golden 来源：HEAD d4656e9 跑同一批夹具（`_tmp_p3probe` 的两份日志逐行 diff，字符串字段与数组 0 差异）。
	// ⚠️ 时间戳按类型比较（见上面 sansTs 的说明）；其余字段是**写死的字面量**。
	const GOLDEN = {
		genshinGacha: {
			rec: {
				banner: "「万序衍盈」108期角色活动祈愿",
				roles: "「列律名虚·米提亚(雷)」、「不休独舞·芙宁娜(水)」",
				bannerDates: "11-04 06:00 ~ 11-24 17:59",
				bannerDatesRaw: "11-04 06:00 ~ 11-24 17:59",
				bannerHover: "「万序衍盈」108期角色活动祈愿：「列律名虚·米提亚(雷)」\n「众水的颂诗」108-2期角色活动祈愿：「不休独舞·芙宁娜(水)」\n11-04 06:00 ~ 11-24 17:59"
			},
			gacha: '[{"key":"genshin:gacha:0","title":"「万序衍盈」108期角色活动祈愿","show":"米提亚、芙宁娜","roles":["「列律名虚·米提亚(雷)」","「不休独舞·芙宁娜(水)」"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 06:00 ~ 11-24 17:59","source":"primary"},{"key":"genshin:gacha:1","title":"「万序衍盈」108期角色活动祈愿：「列律名虚·米提亚(雷)」","show":"「万序衍盈」108期角色活动祈愿：「列律名虚·米提亚(雷)」","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 06:00 ~ 11-24 17:59","source":"hover"},{"key":"genshin:gacha:2","title":"「众水的颂诗」108-2期角色活动祈愿：「不休独舞·芙宁娜(水)」","show":"「众水的颂诗」108-2期角色活动祈愿：「不休独舞·芙宁娜(水)」","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 06:00 ~ 11-24 17:59","source":"hover"}]'
		},
		genshinEvent: {
			rec: {
				event: "「坏灭肇始之时」",
				eventDates: "11-04 10:00 ~ 12-15 14:59",
				eventDatesRaw: "11-04 10:00 ~ 12-15 14:59",
				eventHover: "「相遇·悠久旅途之暇」   11-04 10:00 ~ 12-15 14:59\n「坏灭肇始之时」   11-04 10:00 ~ 12-15 14:59\n「绮衣珍赏·赫炽」   11-04 10:00 ~ 12-16 05:59\n「全域镇卫·逆捍谬罚」   11-04 10:00 ~ 12-16 05:59\n「晶石如林生长之地」   2026-11-04 10:00 ~ 2027-01-26 14:59"
			},
			events: '[{"key":"genshin:event:0","title":"「坏灭肇始之时」","show":"「坏灭肇始之时」","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 10:00 ~ 12-15 14:59","source":"primary"},{"key":"genshin:event:1","title":"「相遇·悠久旅途之暇」","show":"「相遇·悠久旅途之暇」","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 10:00 ~ 12-15 14:59","source":"hover"},{"key":"genshin:event:2","title":"「绮衣珍赏·赫炽」","show":"「绮衣珍赏·赫炽」","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 10:00 ~ 12-16 05:59","source":"hover"},{"key":"genshin:event:3","title":"「全域镇卫·逆捍谬罚」","show":"「全域镇卫·逆捍谬罚」","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-04 10:00 ~ 12-16 05:59","source":"hover"},{"key":"genshin:event:4","title":"「晶石如林生长之地」","show":"「晶石如林生长之地」","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"2026-11-04 10:00 ~ 2027-01-26 14:59","source":"hover"}]'
		},
		arknightsGacha: {
			rec: {
				banner: "将雪投火",
				roles: "塔露拉、冻河、凛御银灰、新约能天使、荒芜拉普兰德、奥尔佳",
				bannerDates: "11-01 12:00 ~ 11-15 03:59",
				bannerDatesRaw: "11-01 12:00 ~ 11-15 03:59",
				bannerHover: ""
			},
			gacha: '[{"key":"arknights:gacha:0","title":"将雪投火","show":"塔露拉、冻河、凛御银灰、新约能天使、荒芜拉普兰德、奥尔佳","roles":["塔露拉","冻河","凛御银灰","新约能天使","荒芜拉普兰德","奥尔佳"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-01 12:00 ~ 11-15 03:59","source":"primary"}]'
		},
		arknightsEvent: {
			rec: {
				event: "视相博物馆：演化",
				eventDates: "11-07 03:59 ~ 11-10 03:59",
				eventDatesRaw: "11-07 03:59 ~ 11-10 03:59",
				eventShow: "视相博物馆：演化 兑换截止",
				eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
				eventHover: "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59",
				eventHoverExtra: "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59"
			},
			events: '[{"key":"arknights:event:0","title":"视相博物馆：演化","show":"视相博物馆：演化 兑换截止","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-07 03:59 ~ 11-10 03:59","source":"primary","phase":{"kind":"claim","startTs":"number","endTs":"number","show":"视相博物馆：演化 兑换截止"}},{"key":"arknights:event:1","title":"登录活动：感谢庆典2026限时签到","show":"登录活动：感谢庆典2026限时签到","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-01 12:00 ~ 11-15 03:59","source":"hover"},{"key":"arknights:event:2","title":"支线故事：时间啊，向前！","show":"支线故事：时间啊，向前！","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"11-01 12:00 ~ 11-22 03:59","source":"hover"}]'
		},
		wuwaGacha: {
			rec: {
				banner: "角色活动唤取",
				roles: "锁暝、灯灯、丹瑾、炽霞、洛瑟菈、琳奈",
				bannerDates: "10-22 10:00 ~ 11-12 03:59",
				bannerDatesRaw: "10-22 10:00 ~ 11-12 03:59",
				bannerHover: "角色活动唤取\n余心所向九死未悔：锁暝、灯灯、丹瑾、炽霞\n显影于明日：洛瑟菈、灯灯、丹瑾、炽霞\n非定义光谱：琳奈、灯灯、丹瑾、炽霞\n10-22 10:00 ~ 11-12 03:59",
				event: "[团团勇者大乱斗]休闲活动",
				eventDates: "09-30 04:00 ~ 11-12 03:59",
				eventDatesRaw: "09-30 04:00 ~ 11-12 03:59",
				eventHover: "[团团勇者大乱斗]休闲活动\n[梦构匣中]区域探索活动\n09-30 04:00 ~ 11-12 03:59"
			},
			gacha: '[{"key":"wuwa:gacha:0","title":"角色活动唤取","show":"锁暝、灯灯、丹瑾、炽霞、洛瑟菈、琳奈","roles":["锁暝","灯灯","丹瑾","炽霞","洛瑟菈","琳奈"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"10-22 10:00 ~ 11-12 03:59","source":"primary"},{"key":"wuwa:gacha:1","title":"余心所向九死未悔：锁暝、灯灯、丹瑾、炽霞","show":"余心所向九死未悔：锁暝、灯灯、丹瑾、炽霞","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"10-22 10:00 ~ 11-12 03:59","source":"hover"},{"key":"wuwa:gacha:2","title":"显影于明日：洛瑟菈、灯灯、丹瑾、炽霞","show":"显影于明日：洛瑟菈、灯灯、丹瑾、炽霞","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"10-22 10:00 ~ 11-12 03:59","source":"hover"},{"key":"wuwa:gacha:3","title":"非定义光谱：琳奈、灯灯、丹瑾、炽霞","show":"非定义光谱：琳奈、灯灯、丹瑾、炽霞","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"10-22 10:00 ~ 11-12 03:59","source":"hover"}]',
			events: '[{"key":"wuwa:event:0","title":"[团团勇者大乱斗]休闲活动","show":"[团团勇者大乱斗]休闲活动","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 04:00 ~ 11-12 03:59","source":"primary"},{"key":"wuwa:event:1","title":"[梦构匣中]区域探索活动","show":"[梦构匣中]区域探索活动","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 04:00 ~ 11-12 03:59","source":"hover"}]'
		},
		wuwaEvent: {
			rec: {
				event: "[团团勇者大乱斗]休闲活动",
				eventDates: "09-30 04:00 ~ 11-12 03:59",
				eventDatesRaw: "09-30 04:00 ~ 11-12 03:59",
				eventHover: "[团团勇者大乱斗]休闲活动\n[梦构匣中]区域探索活动\n09-30 04:00 ~ 11-12 03:59"
			},
			events: '[{"key":"wuwa:event:0","title":"[团团勇者大乱斗]休闲活动","show":"[团团勇者大乱斗]休闲活动","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 04:00 ~ 11-12 03:59","source":"primary"},{"key":"wuwa:event:1","title":"[梦构匣中]区域探索活动","show":"[梦构匣中]区域探索活动","startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 04:00 ~ 11-12 03:59","source":"hover"}]'
		}
	};

	const paths = [];
	// 原神 卡池（bwiki 往期祈愿）/ 活动（bwiki SMW ask）
	paths.push({
		key: "genshinGacha", id: "genshin", side: "gacha", now: NOW_GEN, kind: "gacha", field: "gacha",
		run: () => runPath("genshin", "gacha", (e) => e.__test.GACHA_FETCHERS["genshin"](YS_PARSE, undefined, TZ_CN), NOW_GEN)
	});
	paths.push({
		key: "genshinEvent", id: "genshin", side: "event", now: NOW_GEN, kind: "event", field: "events",
		run: () => runPath("genshin", "event", (e) => e.__test.EVENT_FETCHERS["genshin"].default(YS_ASK, undefined, TZ_CN), NOW_GEN)
	});
	paths.push({
		key: "arknightsGacha", id: "arknights", side: "gacha", now: NOW_AK, kind: "gacha", field: "gacha",
		run: () => runPath("arknights", "gacha", (e) => e.__test.GACHA_FETCHERS["arknights"](AK_LIST, undefined, TZ_CN), NOW_AK)
	});
	paths.push({
		key: "arknightsEvent", id: "arknights", side: "event", now: NOW_AK, kind: "event", field: "events",
		run: () => runPath("arknights", "event", (e) => e.__test.EVENT_FETCHERS["arknights"].default(PRTS_ASK, undefined, TZ_CN), NOW_AK)
	});
	paths.push({
		key: "wuwaGacha", id: "wuwa", side: "gacha", now: NOW_WUWA, kind: "gacha", field: "gacha",
		run: () => runPath("wuwa", "gacha", (e) => e.__test.GACHA_FETCHERS["wuwa"](WUWA_ENTRY, undefined, TZ_CN), NOW_WUWA)
	});
	paths.push({
		key: "wuwaEvent", id: "wuwa", side: "event", now: NOW_WUWA, kind: "event", field: "events",
		run: () => runPath("wuwa", "event", (e) => e.__test.EVENT_FETCHERS["wuwa"].default(WUWA_ENTRY, undefined, TZ_CN), NOW_WUWA)
	});

	const got = {};
	const textOf = (v) => (v == null ? "" : String(v));   // 没有这一侧 ⇒ 记录里根本没有这个键（按空串比）
	for (const p of paths) {
		const r = await p.run();
		got[p.key] = r;
		const g = GOLDEN[p.key];
		const changed = VISIBLE.filter((f) => textOf(r.rec[f]) !== textOf(g.rec[f]));
		check(`P3 golden（${p.key}）：12 个字符串字段与改造前逐字相同`, changed.length === 0, JSON.stringify(changed));
		const arr = r.rec[p.field] || [];
		check(`P3 golden（${p.key}）：\`${p.field}\` 非时间字段逐字不变（键序 / 顺序 / source / phase 全等）`,
			sansTs(arr) === sansCategoryTagsJson(g[p.field]), sansTs(arr));
		check(`P3 golden（${p.key}）：数组非空（解析器真的直出了，而不是悄悄退回空数组）`,
			arr.length > 0 || !!p.emptyOk, String(arr.length));
	}

	// ── ③ 数组与改造前的**合成结果**逐条相等（含 ts）：拿记录字符串 + 悬停文本过 oracle 再合成一遍 ──
	for (const p of paths) {
		const r = got[p.key];
		const other = p.field === "gacha" ? "events" : "gacha";
		const otherSide = p.field === "gacha" ? "event" : "gacha";
		const oldArr = legacySynthArrOf(p.key, p.side);
		const oldOther = legacySynthArrOf(p.key, otherSide);
		check(`P3 等价（${p.key}）：\`${p.field}\` 与改造前的合成结果**逐条相等**（含 startTs / endTs）`,
			JSON.stringify(sansCategoryTags(r.rec[p.field])) === JSON.stringify(sansCategoryTags(oldArr)),
			JSON.stringify([sansCategoryTags(r.rec[p.field]), oldArr]));
		check(`P3 等价（${p.key}）：另一侧也不会凭空多出条目（同一份合成结果同样相等）`,
			JSON.stringify(sansCategoryTags(r.rec[other])) === JSON.stringify(sansCategoryTags(oldOther)));
	}

	// ── ④ 同源：悬停文本 = 同一份条目事实的**生成结果**（不是另外手拼的）──────────
	for (const p of paths) {
		const r = got[p.key];
		const items = (p.kind === "gacha" ? r.payload.gachaHoverItems : r.payload.eventHoverItems) || [];
		const regen = T.hoverTextFromItems(items, p.kind, TZ_CN);
		const hover = p.kind === "gacha" ? r.payload.bannerHover : r.payload.eventHover;
		// 鸣潮卡池悬停的首行是"卡池类型"（不是任何一口池）⇒ 由 `banner` 补；其余 5 条路径都是纯生成结果
		const expected = p.key === "wuwaGacha"
			? (regen ? `${r.payload.banner}\n${regen}` : "")
			: regen;
		check(`P3 同源（${p.key}）：悬停 == hoverTextFromItems(条目事实) 逐字相等`,
			expected === hover, JSON.stringify([expected, hover]));
		check(`P3 同源（${p.key}）：条目事实非空、且每条都带 startTs/endTs/raw 三种事实`,
			items.length > 0 && items.every((x) => "startTs" in x && "endTs" in x && "raw" in x), JSON.stringify(items.length));
	}

	// ── ⑤ 通道不外泄：条目事实不进记录、不落盘 ───────────────────────────────
	for (const p of paths) {
		const r = got[p.key];
		check(`P3 通道（${p.key}）：记录里没有 \`gachaHoverItems\` / \`eventHoverItems\`（只是解析器→数据层的一跳）`,
			!("gachaHoverItems" in r.rec) && !("eventHoverItems" in r.rec), JSON.stringify(Object.keys(r.rec)));
	}

	await runP3b();
}

// ══════════════════════════════════════════════════════════════════════════════
// P3b（2026-11-07）：**其余 25 款**逐个切"解析器直出数组 + 悬停由条目反生成"
//
// 与 P3a 的差别只在**覆盖面**（P3a 6 条路径 → 本段按批次追加，最终 25 款两侧全覆盖）：
//   ① 每款一条路径 = 真实夹具 + 固定 now 跑一次"抓取器 → mergeEntryRecord"（URL 走 `test/map.json`，
//      个别没进 map 的夹具用 `urlsOf(src)` 就地补）；
//   ② golden = **改造前（HEAD）跑同一批夹具**的 12 个字符串字段 + 数组（非时间字段逐字）；
//      文件 `test/fixtures/p3b-golden.json`，用 `node test/cases-p3.mjs --capture-p3b` 采集
//      （**只补缺**，不覆盖已有条目 —— 否则"改完再采集"会把回归钉成现状，等于没有 golden）；
//   ③ 数组**逐条相等（含 startTs / endTs）**：把解析器给的数组摘掉，让改造前的合成器照同一份
//      字符串字段再合成一次，两者必须逐字相同（UTC / +08 都成立）；
//   ④ 悬停 == hoverTextFromItems(解析器给的条目事实) 逐字相等 ⇒ 悬停确实是**产物**。
//      只对 `switched: true` 的路径断言（未切的款仍走改造前的手拼路径，那是剩余工作，不是回归）；
//      `P3B_SWITCHED_EXPECT` 让"切了没登记 / 登记了没切"都会红。
//
// ⚠️ 为什么 golden 存文件而不是写字面量：25 款 × 两侧 = 40+ 条路径，每条 12 个字符串 + 整段数组，
//    手抄必然抄错；采集脚本本身把"取自 HEAD"这件事固化成一条命令（见上面 ②）。
const P3B_GOLDEN_FILE = path.join(FIXTURES_DIR, "p3b-golden.json");
const CAPTURE_P3B = process.argv.includes("--capture-p3b");

// 夹具目录 → map.json 形状的覆盖表（每项 "<dir>/response.txt"）
const p3bFixtureMapOf = (overrides) => {
	const m = {};
	for (const [url, dir] of Object.entries(overrides || {})) m[url] = dir + "/response.txt";
	return m;
};

// ── P3b 路径表（**每款每侧一条**；新增批次只往这里加）──────────────────────────
// `call(t, src)` 收 `engine.__test` 与来源声明（用它自己的 url / eventUrl / tz）；
// `urlsOf(src)` 就地补 map 覆盖（个别夹具没进 map.json）；
// `switched: true` = 该路径已改成"解析器直出数组 + 悬停由条目反生成"。
const P3B_SWITCHED_EXPECT = 48;   // 已切路径数（每批提交时 +N，最终 = P3B_PATHS.length）
const P3B_PATHS = [
	// ── 第 1 批：星铁（bwiki 备选）/ 绝区零（官方公告）/ 崩坏3（米游社备选）/ 米游社卡池 ──
	{
		// ⚠️ 2026-11-09：星铁卡池默认源换成官方公告 CMS，bwiki「历史跃迁」降为备选
		// （`altSources[0]`，抓取器键 `hsr-bwiki`）。这条 golden 钉的是**同一份 bwiki 夹具**的
		// 解析结果，所以改走备选源地址 + 备选抓取器；产物（12 个字符串字段 / 数组 / 悬停）逐字不变。
		// `approvedChange`：同一天"起点未知 ≠ 已开始"让这一侧的**外显与角色**有意变了（见下面分支）。
		key: "hsrGacha", switched: true, id: "hsr", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T00:00:00.000Z"),
		approvedChange: "open-start-not-live",
		urlsOf: (s) => ({ [(s.altSources || [])[0].url]: "p4-hsr-bwiki-warp-1107" }),
		call: (t, s) => t.GACHA_FETCHERS["hsr-bwiki"]((s.altSources || [])[0].url, undefined, s.tz)
	},
	{
		key: "hsrEvent", switched: true, id: "hsr", side: "event", field: "events", now: Date.parse("2026-11-07T00:00:00.000Z"),
		urlsOf: (s) => ({ [s.eventUrl]: "p4-hsr-bwiki-events-1107" }),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "zzzGacha", switched: true, id: "zzz", side: "gacha", field: "gacha", now: Date.parse("2026-10-25T12:00:00+08:00"),
		urlsOf: (s) => ({ [s.url]: "p4-zzz-freq-official" }),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "zzzEvent", switched: true, id: "zzz", side: "event", field: "events", now: Date.parse("2026-10-25T12:00:00+08:00"),
		urlsOf: (s) => ({ [s.eventUrl]: "p4-zzz-freq-official" }),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// 米游社卡池（`ns_miyoushe_gachaMiyoushe`）是 4 个 gids 共用的**一个**生产者，
		// 这里用星铁的夹具（`p4-hsr-news` 有可解析的当期池；bh3 的补给公告正文无日期 ⇒ 恒 null，
		// 拿它当"直出非空"的样本会永远测不到）。米游社的 URL 已在 map.json 里。
		key: "hsrGachaMiyoushe", switched: true, id: "hsr", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T14:37:00.000Z"),
		call: (t) => t.GACHA_FETCHERS["hsr-miyoushe"]("https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=1&page_size=20", undefined, TZ_CN)
	},
	{
		key: "bh3EventMiyoushe", switched: true, id: "bh3", side: "event", field: "events", now: Date.parse("2026-10-02T14:37:00.000Z"),
		call: (t) => t.EVENT_FETCHERS["bh3"]["bh3-miyoushe"].default("https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20", undefined, TZ_CN)
	},

	// ── 第 2 批：bwiki 族 —— 物华弥新 / 战双帕弥什 / 卡厄斯梦境 / 雪松 ──
	{
		key: "whmxGacha", switched: true, id: "wuhuamixin", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "whmxEvent", switched: true, id: "wuhuamixin", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "zspmsGacha", switched: true, id: "zspms", side: "gacha", field: "gacha", now: Date.parse("2026-09-25T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "zspmsEvent", switched: true, id: "zspms", side: "event", field: "events", now: Date.parse("2026-09-25T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// 卡厄斯梦境的默认页是 Lua `Module:Gacha/data`（不在 map.json）→ 就地补；
		// now 取最新一期档期内（2026-06-17 ~ 07-08），否则当期恒 null（cases-p8 也这么钉）。
		key: "cznGacha", switched: true, id: "czn", side: "gacha", field: "gacha", now: Date.parse("2026-06-25T00:00:00.000Z"),
		urlsOf: (s) => ({ [s.url]: "p8-czn-module" }),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "kedrGacha", switched: true, id: "kedr", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "kedrEvent", switched: true, id: "kedr", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},

	// ── 第 3 批：biligame / cygames 族 —— 嘟嘟脸恶作剧 / 闪耀优俊少女国服 / 赛马娘日服 / 赛马娘国际服 ──
	{
		key: "ddlezjGacha", switched: true, id: "ddlezj", side: "gacha", field: "gacha", now: Date.parse("2026-04-30T12:00:00+09:00"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "ddlezjEvent", switched: true, id: "ddlezj", side: "event", field: "events", now: Date.parse("2026-04-30T12:00:00+09:00"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "umaCnGacha", switched: true, id: "uma-cn", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T16:33:46Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "umaCnEvent", switched: true, id: "uma-cn", side: "event", field: "events", now: Date.parse("2026-10-02T16:33:46Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "umaJpGacha", switched: true, id: "uma-jp", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T14:36:35Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "umaJpEvent", switched: true, id: "uma-jp", side: "event", field: "events", now: Date.parse("2026-10-02T14:36:35Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "umaGlobalGacha", switched: true, id: "uma-global", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T14:36:56Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		// 国际服活动侧：夹具里**没有**覆盖当期的活动（官方 index 夹具 10-02 抓取，活动档期全已过期 /
		// 未上线）⇒ 载荷恒 null、数组恒空。这一条只守"没有数据时行为不变"（空数组、字符串仍为空）；
		// 该生产者的**有数据路径**由 `umaJpEvent`（同一个官方公告家族的生产者）覆盖，不是抽样。
		key: "umaGlobalEvent", switched: true, id: "uma-global", side: "event", field: "events", emptyOk: true, now: Date.parse("2026-10-02T14:36:56Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	// ── 第 4 批：bandori / 世嘉 族 —— BanG Dream! / PJSK / OurNotes / OurNotes 国际服 ──
	{
		key: "bandoriGacha", switched: true, id: "bandori", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "bandoriEvent", switched: true, id: "bandori", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// PJSK 默认源走 gh-proxy 前缀（map.json 里没有）→ 用备选源同款静态地址（已在 map.json 里）
		key: "pjskGacha", switched: true, id: "pjsk", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t) => t.GACHA_FETCHERS["pjsk"]("https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json", undefined, TZ_CN)
	},
	{
		key: "pjskEvent", switched: true, id: "pjsk", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t) => t.EVENT_FETCHERS["pjsk"].default("https://sekai-world.github.io/sekai-master-db-cn-diff/events.json", undefined, TZ_CN)
	},
	{
		key: "ournotesEvent", switched: true, id: "ournotes", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// OurNotes 国际服**默认未配置**（只挂备选源）→ 走备选活动抓取器；页面夹具换成"有内容"的那份
		// （map.json 里这条 URL 指向 empty 夹具，用于守"空列表 ⇒ 未公布"，这里要看有数据的一面）。
		key: "ournotesGlobalEvent", switched: true, hoverKind: "gacha", id: "ournotes-global", side: "event", field: "events", now: Date.parse("2026-10-03T00:00:00.000Z"),
		urlsOf: () => ({ "https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw": "p9-ournotes-global-list" }),
		call: (t) => t.EVENT_FETCHERS["ournotes-global"]["ournotes-global-event"].default("https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw", undefined, TZ_CN)
	}
,
	// ── 第 5 批：各厂自家解析 —— FGO / 少女前线2 / 女神异闻录5X / 异环 / 星塔旅人 ──
	{
		key: "fgoGacha", switched: true, id: "fgo", side: "gacha", field: "gacha", now: Date.parse("2026-08-25T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "fgoEvent", switched: true, id: "fgo", side: "event", field: "events", now: Date.parse("2026-08-25T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "gf2Gacha", switched: true, id: "gf2", side: "gacha", field: "gacha", now: Date.parse("2026-08-25T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "gf2Event", switched: true, id: "gf2", side: "event", field: "events", now: Date.parse("2026-08-25T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "p5xGacha", switched: true, id: "p5x", side: "gacha", field: "gacha", now: Date.parse("2026-09-25T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "p5xEvent", switched: true, id: "p5x", side: "event", field: "events", now: Date.parse("2026-09-25T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "nteGacha", switched: true, id: "nte", side: "gacha", field: "gacha", now: Date.parse("2026-10-20T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "nteEvent", switched: true, id: "nte", side: "event", field: "events", now: Date.parse("2026-10-20T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		key: "stellasoraGacha", switched: true, id: "stellasora", side: "gacha", field: "gacha", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "stellasoraEvent", switched: true, id: "stellasora", side: "event", field: "events", now: Date.parse("2026-10-02T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	}
,
	// ── 第 6 批：蔚蓝档案国服（日志表）+ 重返未来 1999（游戏内公告）──
	{
		key: "baCnGacha", switched: true, id: "ba-cn", side: "gacha", field: "gacha", now: Date.parse("2026-10-20T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "baCnEvent", switched: true, id: "ba-cn", side: "event", field: "events", now: Date.parse("2026-10-20T00:00:00.000Z"),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// 重返未来 1999：默认源 = 游戏内公告接口（一条 URL 同时含卡池/活动），夹具是**本批新抓**的
		// 真响应（`p3b-r1999-notice`，2026-11-07 抓取），now = 抓取时刻。
		key: "r1999Gacha", switched: true, id: "r1999", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T01:08:25.105Z"),
		urlsOf: (s) => ({ [s.url]: "p3b-r1999-notice" }),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "r1999Event", switched: true, id: "r1999", side: "event", field: "events", now: Date.parse("2026-11-07T01:08:25.105Z"),
		urlsOf: (s) => ({ [s.eventUrl]: "p3b-r1999-notice" }),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	// ── 第 7 批（P3c）：最后 3 款 —— 蔚蓝档案国际服 / 蔚蓝档案日服 / 终末地 ──────────
	// 夹具全是**本批真抓**（2026-11-07T01:19:55.965Z，`p3c-*`，不进 map.json）；now = 抓取时刻。
	// GameKee 一侧的抓取器自带三条地址（目录树 + 两个 detail + CDN），所以 `urlsOf` 给的是**字面量**
	// 映射而不是 `[s.url]`：`s.url` 只是设置页展示用的页面地址，抓取器根本不读它。
	{
		key: "baGlobalGacha", switched: true, id: "ba-global", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T01:19:55.965Z"),
		urlsOf: () => ({
			"https://www.gamekee.com/v1/wiki/entry?id=15": "p3c-ba-gamekee-tree",
			"https://www.gamekee.com/v1/content/detail/725935": "p3c-ba-gamekee-detail-725935",
			"https://www.gamekee.com/v1/content/detail/609133": "p3c-ba-gamekee-detail-609133",
			"https://api-cdn.gamekee.com/wiki2.0/pro/829/content/609133.json": "p3c-ba-gamekee-cdn-609133"
		}),
		call: (t) => t.GACHA_FETCHERS["ba-global"]()
	},
	{
		key: "baGlobalEvent", switched: true, id: "ba-global", side: "event", field: "events", now: Date.parse("2026-11-07T01:19:55.965Z"),
		// ⚠️ `fetchGameKeeBa` 一次返回**两侧**（卡池 + 活动），所以活动路径也会走完卡池那条 609133 链
		// （detail + CDN 两次请求）—— 这里必须把两条地址一起映射，否则会命中 map.json 里那份**裁剪过**的
		// 旧 CDN 夹具（`ba-gamekee-pool-blocks` 是 block 数组本体、没有 `content` 外壳）。
		urlsOf: () => ({
			"https://www.gamekee.com/v1/wiki/entry?id=15": "p3c-ba-gamekee-tree",
			"https://www.gamekee.com/v1/content/detail/725935": "p3c-ba-gamekee-detail-725935",
			"https://www.gamekee.com/v1/content/detail/609133": "p3c-ba-gamekee-detail-609133",
			"https://api-cdn.gamekee.com/wiki2.0/pro/829/content/609133.json": "p3c-ba-gamekee-cdn-609133"
		}),
		call: (t) => t.EVENT_FETCHERS["ba-global"].default()
	},
	{
		// 日服卡池 = 官网新闻接口（多池同公告 ⇒ 悬停多行）；日服活动 = GameKee「日服当期活动」+「日服当期卡池评测」
		// 两个 detail（活动路径要读卡池标题那条目录项，因为 `fetchGameKeeBa("jp")` 会顺带读它）。
		key: "baJpGacha", switched: true, id: "ba-jp", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T01:19:55.965Z"),
		urlsOf: (s) => ({ [s.url]: "p3c-ba-jp-news" }),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		key: "baJpEvent", switched: true, id: "ba-jp", side: "event", field: "events", now: Date.parse("2026-11-07T01:19:55.965Z"),
		urlsOf: () => ({
			"https://www.gamekee.com/v1/wiki/entry?id=15": "p3c-ba-gamekee-tree",
			"https://www.gamekee.com/v1/content/detail/726227": "p3c-ba-gamekee-detail-726227",
			"https://www.gamekee.com/v1/content/detail/718684": "p3c-ba-gamekee-detail-718684"
		}),
		call: (t) => t.EVENT_FETCHERS["ba-jp"].default()
	},
	{
		// 终末地卡池 = canmoe：页面 HTML → BannerCalendar 的 chunk → 期次数组。抓取器**倒序 + 每轮 6 路并发**
		// ⇒ 夹具只放它第一轮真的抓到的那 6 份 chunk（数据 chunk 在其中，命中即早停，与真实请求数一致）。
		key: "endfieldGacha", switched: true, id: "endfield", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T01:19:55.965Z"),
		urlsOf: () => ({
			"https://end.canmoe.com/zh-CN/banner-calendar": "p3c-endfield-canmoe-page",
			"https://end.canmoe.com/_next/static/chunks/07m_6mk9s-9qb.js": "p3c-endfield-canmoe-chunk-07m_6mk9s-9qb",
			"https://end.canmoe.com/_next/static/chunks/0lnuph-ewk8dj.js": "p3c-endfield-canmoe-chunk-0lnuph-ewk8dj",
			"https://end.canmoe.com/_next/static/chunks/13kxy1q0s7d.n.js": "p3c-endfield-canmoe-chunk-13kxy1q0s7d_n",
			"https://end.canmoe.com/_next/static/chunks/04~5p.89x0d79.js": "p3c-endfield-canmoe-chunk-04_5p_89x0d79",
			"https://end.canmoe.com/_next/static/chunks/0oh.dd.dcudno.js": "p3c-endfield-canmoe-chunk-0oh_dd_dcudno",
			"https://end.canmoe.com/_next/static/chunks/0g5.ugx67tnlm.js": "p3c-endfield-canmoe-chunk-0g5_ugx67tnlm"
		}),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	},
	{
		// 终末地活动 = FZ Wiki：`eventUrl` 是给人看的页面地址，抓取器由它推出 api.fz.wiki 那条 REST 地址。
		key: "endfieldEvent", switched: true, id: "endfield", side: "event", field: "events", now: Date.parse("2026-11-07T01:19:55.965Z"),
		urlsOf: () => ({
			"https://api.fz.wiki/api/v1/articles/by-title?ns=0&title=%E6%B4%BB%E5%8A%A8&withRevision=1": "p3c-endfield-fz-activity"
		}),
		call: (t, s) => t.EVENT_FETCHERS[s.id].default(s.eventUrl, undefined, s.tz)
	},
	{
		// 蔚蓝档案国服**第三条载荷路径**（P3c 普查时发现 P3b-6 漏切）：默认源的第①步是
		// 「维护更新说明」正文块（parseBaCnMaintText），它只产卡池类型 + 角色 + 活动名，**没有悬停**。
		// P3b-6 只切了 ②/③（baCnFromNoticeBlocks 的两条），于是这一条仍在靠合成器出数组 ——
		// 删兼容层前必须补上，否则走这条路径的当期（如 09-25 这期）会整个变成「无数据」。
		// 夹具 = map.json 里 ba-cn 默认源的 ba-cn-live-1021（就是这条路径的响应）；now = 09-25 当期内。
		key: "baCnMaintText", switched: true, id: "ba-cn", side: "gacha", field: "gacha", now: Date.parse("2026-09-25T00:00:00.000Z"),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
	}];

// 12 个用户可见字符串字段（与 P3a 同一份口径）
const P3B_VISIBLE = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
	"event", "eventDates", "eventDatesRaw", "eventShow", "eventClaimDates", "eventHover", "eventHoverExtra"];
const p3bTextOf = (v) => (v == null ? "" : String(v));
// 时间戳只比类型（口径 = 本机时刻，见 README_Dev「已知不等价①」）；值的相等由 ③ 单独守
// category / tags 批 1：先摘掉 `category` / `tags`（golden 是改造前的产物，没有这两个键，见文件顶部说明）
const p3bSansTs = (arr) => JSON.stringify(sansCategoryTags(arr).map((x) => {
	const o = Object.assign({}, x, {
		startTs: x.startTs == null ? "null" : typeof x.startTs,
		endTs: x.endTs == null ? "null" : typeof x.endTs
	});
	if (o.phase) o.phase = Object.assign({}, o.phase, {
		startTs: o.phase.startTs == null ? "null" : typeof o.phase.startTs,
		endTs: o.phase.endTs == null ? "null" : typeof o.phase.endTs
	});
	return o;
}));
async function runP3b() {
	const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
	const golden = existsSync(P3B_GOLDEN_FILE) ? JSON.parse(readFileSync(P3B_GOLDEN_FILE, "utf8")) : {};
	const fresh = {};
	const results = {};
	const srcCache = {};
	for (const p of P3B_PATHS) {
		// 每个路径一份**自己的**夹具实现（map.json + 该路径的覆盖）：
		// `useFixtures()` 返回的 impl 已包好"走代理 / 直连 / 404"三种形态，覆盖只影响这一次调用。
		const src0 = srcCache[p.id] || (srcCache[p.id] = createEngine({
			transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { throw new Error("no"); } },
			storage: makeStore(), now: () => p.now
		}).__test.SOURCES.find((s) => s.id === p.id));
		if (!src0) throw new Error("P3b 找不到来源：" + p.id);
		const overrides = p3bFixtureMapOf(p.urlsOf ? p.urlsOf(src0) : null);
		const fixture = useFixtures(overrides);
		const transport = {
			async fetchRaw(url, opts) {
				const r = await fixture(url, opts);
				return { ok: r.ok, status: r.status, headers: { get: () => null }, text: () => r.text(), json: () => r.json() };
			},
			async fetchViaProxy(url, opts) {
				const o = opts || {};
				let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
				api += "&referer=" + encodeURIComponent(o.referer || "");
				if (o.headers) api += "&headers=" + encodeURIComponent(JSON.stringify(o.headers));
				const r = await fixture(api);
				if (!r.ok) throw new Error("proxy-http-" + r.status);
				const wrapped = JSON.parse(await r.text());
				if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
				return wrapped.body;
			}
		};
		const engine = createEngine({ transport, storage: makeStore(), now: () => p.now, timer: { setTimeout, clearTimeout } });
		const src = engine.__test.SOURCES.find((s) => s.id === p.id) || src0;
		const payload = await p.call(engine.__test, src);
		const rec = engine.__test.mergeEntryRecord({ data: payload || {} }, null, p.now, { id: p.id, tz: src.tz });
		results[p.key] = { payload, rec, engine, p, src };
		const arr = rec[p.field] || [];
		fresh[p.key] = {
			rec: Object.fromEntries(P3B_VISIBLE.map((f) => [f, p3bTextOf(rec[f])])),
			array: p3bSansTs(arr)
		};
	}
	// ── 采集模式：**只补缺**（已有条目一律不动，避免"改完再采集"把回归钉成现状）──
	if (CAPTURE_P3B) {
		const added = [];
		for (const [k, v] of Object.entries(fresh)) {
			if (golden[k]) continue;
			golden[k] = v;
			added.push(k);
		}
		writeFileSync(P3B_GOLDEN_FILE, JSON.stringify(golden, null, "\t") + "\n", "utf8");
		section("P3b golden 采集（只补缺）");
		check("P3b golden 采集：本次新增条目（已有条目一字未动）", added.length > 0, JSON.stringify(added));
	}

	section("P3b ①：解析器直出 —— 12 个字符串字段与改造前逐字相同（golden，全款覆盖）");
	for (const p of P3B_PATHS) {
		const g = golden[p.key];
		const r = results[p.key];
		check(`P3b golden（${p.key}）：golden 里有这一条（覆盖到、不是抽样）`, !!g, p.key);
		if (!g) continue;
		if (p.approvedChange) {
			// ⚠️ 2026-11-09「起点未知 ≠ 已开始」（用户拍板）：星铁 bwiki 侧的外显/角色**有意变了** ——
			// 只有两端明确的「我身即刃」在期，`4.6/4.7版本更新后`（无日期）的三口池不再并入外显。
			// 旧 golden（p3b-golden.json）原样保留作"改造前长什么样"的存档，不再比相等；新口径逐字由
			// 这里的两条 + cases-core ④-9 + cases-hsr-official 钉住。
			const arr2 = r.rec[p.field] || [];
			check(`P3b golden（${p.key}）**已批准差异**：roles 只剩两端明确的「千冶•刃（虚无•火）」`,
				p3bTextOf(r.rec.roles) === "千冶\u2022刃（虚无\u2022火）", JSON.stringify(r.rec.roles));
			check(`P3b golden（${p.key}）**已批准差异**：数组 4 条（主行 + 3 条悬停行，其中 3 条起点未知）`,
				arr2.length === 4 && arr2.filter((x) => x.startTs == null).length === 3,
				JSON.stringify(arr2.map((x) => [x.title, x.startTs == null ? "null" : "number"])));
			check(`P3b golden（${p.key}）：旧 golden 原样保留（存档"改造前会显示什么"）`,
				p3bTextOf(g.rec.roles).indexOf("真珠") > 0, JSON.stringify(g.rec.roles));
			continue;
		}
		const changed = P3B_VISIBLE.filter((f) => p3bTextOf(r.rec[f]) !== p3bTextOf(g.rec[f]));
		check(`P3b golden（${p.key}）：12 个字符串字段与改造前逐字相同`, changed.length === 0, JSON.stringify(changed));
		const arr = r.rec[p.field] || [];
		check(`P3b golden（${p.key}）：\`${p.field}\` 非时间字段逐字不变（键序 / 顺序 / source / phase 全等）`,
			p3bSansTs(arr) === sansCategoryTagsJson(g.array), p3bSansTs(arr));
		check(`P3b golden（${p.key}）：数组非空（解析器真的直出了，而不是悄悄退回空数组）`,
			arr.length > 0 || !!p.emptyOk, String(arr.length));
	}

	section("P3b ②：数组与改造前**合成结果**逐条相等（含 startTs / endTs）");
	for (const p of P3B_PATHS) {
		const r = results[p.key];
		const other = p.field === "gacha" ? "events" : "gacha";
		const otherSide = p.side === "gacha" ? "event" : "gacha";
		const oldArr = legacySynthArrOf(p.key, p.side);
		const oldOther = legacySynthArrOf(p.key, otherSide);
		if (p.approvedChange) {
			// 已批准差异：改造前 5 条（含「沧海萃珠」并进外显角色）→ 现在 4 条（外显只有「我身即刃」）。
			check(`P3b 等价（${p.key}）**已批准差异**：改造前 5 条 → 现在 4 条（起点未知不再算在期）`,
				(r.rec[p.field] || []).length === 4 && oldArr.length === 5,
				JSON.stringify([(r.rec[p.field] || []).length, oldArr.length]));
			check(`P3b 等价（${p.key}）：另一侧也不会凭空多出条目`,
				JSON.stringify(sansCategoryTags(r.rec[other])) === JSON.stringify(sansCategoryTags(oldOther)));
			continue;
		}
		check(`P3b 等价（${p.key}）：\`${p.field}\` 与改造前的合成结果逐条相等（含 ts）`,
			JSON.stringify(sansCategoryTags(r.rec[p.field])) === JSON.stringify(sansCategoryTags(oldArr)),
			JSON.stringify([sansCategoryTags(r.rec[p.field]), oldArr]));
		check(`P3b 等价（${p.key}）：另一侧也不会凭空多出条目`,
			JSON.stringify(sansCategoryTags(r.rec[other])) === JSON.stringify(sansCategoryTags(oldOther)));
	}

	section("P3b ③：同源 —— 悬停 == hoverTextFromItems(解析器给的条目事实)");
	const switched = P3B_PATHS.filter((x) => x.switched);
	check(`P3b 已切路径数 = ${P3B_SWITCHED_EXPECT}（每批提交时同步 +N；最终 = ${P3B_PATHS.length} 条路径）`,
		switched.length === P3B_SWITCHED_EXPECT, `${switched.length} / ${P3B_PATHS.length}：${switched.map((x) => x.key).join(",")}`);
	for (const p of switched) {
		const r = results[p.key];
		const pay = r.payload || {};
		if (p.emptyOk && !r.payload) {
			// 这一侧的夹具里本来就没有数据（未公布）⇒ 没有条目事实、也没有悬停可生成（数组空、字符串空）
			check("P3b 同源（${p.key}）：载荷为空（未公布）⇒ 没有条目事实可断言", true);
			continue;
		}
		const items = (p.side === "gacha" ? pay.gachaHoverItems : pay.eventHoverItems) || [];
		// ⚠️ 用**该来源自己的 tz**：悬停文本是解析器按源站墙钟渲染的（ddlezj 是 +540、赛马娘日服是 Asia/Tokyo）
		const regen = T.hoverTextFromItems(items, p.hoverKind || p.side, r.src.tz || TZ_CN, p.genOpts);
		const hover = p.side === "gacha" ? pay.bannerHover : pay.eventHover;
		// `hoverPrefix`：有些来源的悬停首行不是条目（如鸣潮的"卡池类型"），由构造方显式声明
		const expected = p.hoverPrefix ? (regen ? p.hoverPrefix(pay) + regen : "") : regen;
		check(`P3b 同源（${p.key}）：悬停 == hoverTextFromItems(条目事实) 逐字相等`,
			expected === (hover || ""), JSON.stringify([expected, hover || ""]));
		// 悬停为空时允许条目为 0（生成器对 0/1 条给空串；gf2 活动侧会出现"选中的窗口不覆盖 now"的既有时序）
		const hoverEmpty = !(p.side === "gacha" ? pay.bannerHover : pay.eventHover);
		check(`P3b 同源（${p.key}）：条目事实齐备（每条带 startTs/endTs/raw；悬停非空时至少 1 条）`,
			items.every((x) => "startTs" in x && "endTs" in x && "raw" in x) && (items.length > 0 || hoverEmpty), String(items.length));
		check(`P3b 通道（${p.key}）：记录里没有 \`gachaHoverItems\` / \`eventHoverItems\``,
			!("gachaHoverItems" in r.rec) && !("eventHoverItems" in r.rec), JSON.stringify(Object.keys(r.rec)));
	}
	await runP3d();
	await runP3e();
}

// ══════════════════════════════════════════════════════════════════════════════
// P3d（2026-11-07）：**备选来源**（设置页手动切源时用）也直出数组
//
// ── 为什么还有这一批 ──
// P3c 删掉 `dataArrayGachaOf` / `dataArrayEventsOf` / `dataArrayHoverPoolsOf` 之后，28 款的**默认源**
// 都能直出数组；但**备选源**（`altSources` / `eventAltSources`，用户手动切过去才走）里有一批仍然
// 只产字符串 ⇒ 数组为 null ⇒ 那一侧显示「该来源无数据」。这是"手动切源"功能的**实际回归**。
//
// ── 这一段守四件事 ──
// ① **golden** = 改造前（HEAD 1268d71）跑同一批夹具的字符串字段（多数路径 12 个；Nexon 卡池侧只钉
//    5 个卡池字段，理由见那条路径的注释）+ 数组（非时间字段逐字）。采集命令：
//    `node test/cases-p3.mjs --capture-p3d`（**必须在切代码之前**跑，见采集模式那段注释）。
// ② **数组逐条相等（含 startTs / endTs）**：用 P3c 冻结的 `legacySynthArrOf` 当 oracle ——
//    把解析器给的数组摘掉，让改造前的合成器照同一份字符串字段再合成一次。
// ③ **悬停逐字相等 + 同源**：`hover == hoverTextFromItems(条目事实)`，且 golden 里的悬停文本与改造前逐字相同。
// ④ **端到端手动切源**：走**真实设置存储**（`customUrls` / `customEventUrls` = 备选源标识，
//    与设置页写的是同一种值）→ `engine.refresh()` → 该侧 `scheduleCellOf` 非 null（= 面板不再是
//    「该来源无卡池数据 / 无活动数据」）。反向证明：去掉任一备选源的直出 ⇒ ① 的数组 + ④ 两条同时红
//    （实测红字见 README_Dev 的「反向证明（P3d 实测）」）。
//
// ⚠️ 夹具：P3 专用夹具**不进 `map.json`**（那会改变其它批次对默认源的期望），一律用 `urlsOf` 就地映射。
//    13 份夹具的真抓 / 手工构造依据写在各自的 `response.txt.meta.json` 里。
const P3D_GOLDEN_FILE = path.join(FIXTURES_DIR, "p3d-golden.json");
const CAPTURE_P3D = process.argv.includes("--capture-p3d");
// 夹具抓取时刻附近的"期中"时刻（2026-11-06 20:00 +08 / 12:00 UTC）——所有当期窗口都远远包住它，
// 所以「覆盖当前」的判定在 UTC 与 +08 两道门禁下一致（不靠本机时区巧合）。
const P3D_NOW = Date.parse("2026-11-06T12:00:00.000Z");
// GachaTracker 的夹具数据停在 2026-09（最新一期 09-02 ~ 09-29）⇒ 这一条用**夹具内**的时刻，
// 而不是抓取时刻（否则当期恒 null，断言会变成"空数组也绿"的假绿）。
const P3D_NOW_GT = Date.parse("2026-09-10T00:00:00.000Z");

const P3D_PATHS = [
	// ① 明日方舟·卡池备选：PRTS 卡池一览
	{
		key: "arknightsPrtsGacha", id: "arknights", side: "gacha", field: "gacha",
		alt: "arknights-prts", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-arknights-prts-pool" })
	},
	// ② 明日方舟·活动备选：PRTS 活动一览（+ 一次批量 wikitext）
	{
		key: "arknightsEventList", id: "arknights", side: "event", field: "events",
		alt: "arknights-event-list", now: P3D_NOW,
		urlsOf: (alt) => ({
			[alt.url]: "p3d-arknights-events-list",
			"https://prts.wiki/api.php?action=query&prop=revisions": "p3d-arknights-events-pages"
		})
	},
	// ③ 鸣潮·卡池备选：Bwiki 角色轮换池（`parseWuwaPool`）
	{
		key: "wuwaPoolBwiki", id: "wuwa", side: "gacha", field: "gacha",
		alt: "wuwa-bwiki", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-wuwa-pool-bwiki" })
	},
	// ④ 鸣潮·活动备选：Bwiki 活动日历（`parseWuwaCalendar`）
	{
		key: "wuwaEventBwiki", id: "wuwa", side: "event", field: "events",
		alt: "wuwa-event-bwiki", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-wuwa-event-bwiki" })
	},
	// ⑤ 绝区零·卡池备选：Bwiki 往期调频
	{
		key: "zzzBwikiGacha", id: "zzz", side: "gacha", field: "gacha",
		alt: "zzz-bwiki", now: P3D_NOW,
		// ⚠️ 2026-11-09 晚（用户选 B「绝区零的 bwiki 不收录未来卡池」）：这一条来源在注册表里声明了
		// `unknownStartIsActive: true` ⇒ 它的「X.Y版本更新后」（起点未知）按"已开始"处理，
		// 于是这里**恢复到改造前**的行为（含下面 ①/② 的 golden 与等价 oracle 都按原样比对）。
		// 唯一一条例外；依据 / 为什么星铁 bwiki 不能同样处理，见 30-game-hoyoverse.js 该条的注释
		// 与本批 `test/cases-zzz-bwiki.mjs`（含"拿掉开关 ⇒ 这里立刻红"的反向证明）。
		urlsOf: (alt) => ({ [alt.url]: "p3d-zzz-bwiki" })
	},
	// ⑥ 蔚蓝档案国际服·备选：Nexon 更新日志（卡池 + 活动同一份载荷）
	// ⚠️ golden **只钉卡池侧字段**：同一个抓取器也顺手填了活动侧，但那一侧的活动悬停文本
	//    **随运行环境时区变**（成因见下面 `baGlobalNexonEvent` 的注释，是 P3d 之前就有的缺陷）⇒
	//    钉 12 个字段会让 UTC 门禁为了一个与 P3d 无关的原因变红。
	{
		key: "baGlobalNexonGacha", id: "ba-global", side: "gacha", field: "gacha",
		alt: "ba-global-nexon", now: P3D_NOW,
		goldenFields: ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover"],
		urlsOf: (alt) => ({
			[alt.url]: "p3d-ba-nexon-list",
			"https://forum.nexon.com/api/v1/thread/3567784?alias=bluearchiveTW&countryCode=KR": "p3d-ba-nexon-detail"
		})
	},
	{
		key: "baGlobalNexonEvent", id: "ba-global", side: "event", field: "events",
		alt: "ba-global-nexon", now: P3D_NOW,
		// ⚠️ 这一侧**在 P3d 之前就已经直出**（P3c 收尾时 `fetchBaGlobal` 一起切了），所以它不是 P3d 要修的回归；
		//    而且它的两个产物都**随运行环境时区变**（P3d 之前就如此，本轮不改）：
		//      · 活动悬停文本：`parseBaLogRows` 用 `new Date(y,mo,d,…)` 造**本机墙钟**时刻，悬停却按
		//        `tz`（本源是 `UTC`）渲染 ⇒ 机器不在 UTC 时整段偏 8 小时（+08 下是 `11-03 02:00 ~ 11-09 18:59`）；
		//      · 数组顺序：主条的窗口来自**文本**（按本机时区回读），并列条的窗口来自**ts** ⇒ 两者在
		//        非 UTC 机器上不再是同一把尺，`endTs` 升序的次序会变。
		//    所以这里**不钉 golden / 不做逐条等价**（钉了只会让 UTC 门禁红在一个与 P3d 无关的地方）。
		//    仍然断言的是 P3d 真正负责的东西：**数组非空**、**悬停 == 同一份条目事实的生成结果**、
		//    **切源后那一格能渲染**。（这两条时区缺陷已写进报告，留待单独一轮修。）
		noGolden: true,
		urlsOf: (alt) => ({
			[alt.url]: "p3d-ba-nexon-list",
			"https://forum.nexon.com/api/v1/thread/3567784?alias=bluearchiveTW&countryCode=KR": "p3d-ba-nexon-detail"
		})
	},
	// ⑦ 终末地·卡池备选：GachaTracker（英文）
	{
		key: "endfieldGachatracker", id: "endfield", side: "gacha", field: "gacha",
		alt: "endfield-gachatracker", now: P3D_NOW_GT,
		urlsOf: (alt) => ({ [alt.url]: "p3d-endfield-gachatracker" })
	},
	// ⑧ 终末地·卡池备选：wiki.gg（英文）
	{
		key: "endfieldWikigg", id: "endfield", side: "gacha", field: "gacha",
		alt: "endfield-wiki-gg", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-endfield-wikigg" })
	},
	// ⑨ 终末地·活动备选：Game8（英文）
	{
		key: "endfieldGame8", id: "endfield", side: "event", field: "events",
		alt: "endfield-game8", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-endfield-game8" })
	},
	// ⑩ 重返未来 1999·备选：官网公告+小米（卡池侧与活动侧是同一个抓取器）
	{
		key: "r1999OfficialGacha", id: "r1999", side: "gacha", field: "gacha",
		alt: "r1999-official", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-r1999-official", "https://game.xiaomi.com/game/62346241": "p3d-r1999-xiaomi" })
	},
	{
		key: "r1999OfficialEvent", id: "r1999", side: "event", field: "events",
		alt: "r1999-official", now: P3D_NOW,
		urlsOf: (alt) => ({ [alt.url]: "p3d-r1999-official", "https://game.xiaomi.com/game/62346241": "p3d-r1999-xiaomi" })
	}
];

// 12 个用户可见字符串字段（与 P3b 同一份口径）
const P3D_VISIBLE = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
	"event", "eventDates", "eventDatesRaw", "eventShow", "eventClaimDates", "eventHover", "eventHoverExtra"];
const p3dTextOf = (v) => (v == null ? "" : String(v));

async function runP3d() {
	const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
	const golden = existsSync(P3D_GOLDEN_FILE) ? JSON.parse(readFileSync(P3D_GOLDEN_FILE, "utf8")) : {};
	const fresh = {};
	const results = {};

	for (const p of P3D_PATHS) {
		// 每个路径一份**自己的**夹具实现（map.json + 该路径的覆盖；`urlsOf` 收的是**注册表里的那个备选源**）
		const src0 = createEngine({
			transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { throw new Error("no"); } },
			storage: makeStore(), now: () => p.now
		}).__test.SOURCES.find((s) => s.id === p.id);
		if (!src0) throw new Error("P3d 找不到来源：" + p.id);
		const altFrom = (s) => ((p.side === "event" ? s.eventAltSources : s.altSources) || []).find((a) => a.fetcher === p.alt) || null;
		const alt0 = altFrom(src0);
		if (!alt0) throw new Error(`P3d 找不到备选源：${p.id} / ${p.alt}`);
		const overrides = p3bFixtureMapOf(p.urlsOf ? p.urlsOf(alt0) : null);
		const fixture = useFixtures(overrides);
		const transport = {
			async fetchRaw(url, opts) {
				const r = await fixture(url, opts);
				return { ok: r.ok, status: r.status, headers: { get: () => null }, text: () => r.text(), json: () => r.json() };
			},
			async fetchViaProxy(url, opts) {
				const o = opts || {};
				let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
				api += "&referer=" + encodeURIComponent(o.referer || "");
				if (o.headers) api += "&headers=" + encodeURIComponent(JSON.stringify(o.headers));
				const r = await fixture(api);
				if (!r.ok) throw new Error("proxy-http-" + r.status);
				const wrapped = JSON.parse(await r.text());
				if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
				return wrapped.body;
			}
		};
		const engine = createEngine({ transport, storage: makeStore(), now: () => p.now, timer: { setTimeout, clearTimeout } });
		const src = engine.__test.SOURCES.find((s) => s.id === p.id) || src0;
		const alt = altFrom(src) || alt0;
		// 走**注册表里的那个抓取器**（不是随便调一个内部函数）：`gachaFetcherFor` / `eventFetcherFor`
		// 在设置页切源后选中它，这里必须证明"它产出的就是能显示的数组"。
		const fetcher = p.side === "event"
			? (engine.__test.EVENT_FETCHERS[src.id] || {})[alt.fetcher]
			: (engine.__test.GACHA_FETCHERS || {})[alt.fetcher];
		if (typeof fetcher !== "function") throw new Error(`P3d 抓取器没登记：${alt.fetcher}`);
		const payload = await fetcher(alt.url, undefined, src.tz);
		const rec = engine.__test.mergeEntryRecord({ data: payload || {} }, null, p.now, { id: p.id, tz: src.tz });
		results[p.key] = { payload, rec, engine, p, src, alt, transport, now: p.now };
		const arr = rec[p.field] || [];
		// `noGolden` 的路径不参与 golden（它那一侧在 P3d 之前就直出，且产物随运行环境时区变，见该路径注释）
		if (p.noGolden) continue;
		fresh[p.key] = {
			rec: Object.fromEntries((p.goldenFields || P3D_VISIBLE).map((f) => [f, p3dTextOf(rec[f])])),
			// ⚠️ 数组 golden = **改造前代码真实产出的数组**；改造前这一侧**还没有数组**（P3c 之后仍是字符串）
			//    时退回**改造前合成器**的输出（P5 清理已把它冻结成字面量 `legacySynthArrOf`）——
			//    那正是改造前界面本来会显示的条目。两种口径都等于"改造前的行为"，不是"改完再采集"。
			array: p3bSansTs(arr.length ? arr : legacySynthArrOf(p.key, p.side))
		};
	}

	// ── 采集模式：**只补缺**（已有条目一律不动 —— 否则"改完再采集"会把回归钉成现状）──
	// 用法（**必须在切代码之前**）：`git stash push -- src lib packages` → `node build.mjs` →
	// `node test/cases-p3.mjs --capture-p3d` → `git stash pop` → `node build.mjs`。
	if (CAPTURE_P3D) {
		const added = [];
		for (const [k, v] of Object.entries(fresh)) {
			if (golden[k]) continue;
			golden[k] = v;
			added.push(k);
		}
		writeFileSync(P3D_GOLDEN_FILE, JSON.stringify(golden, null, "\t") + "\n", "utf8");
		section("P3d golden 采集（只补缺；只有 golden 里已有『改造前』的记录才算有效）");
		check("P3d golden 采集：本次新增条目（已有条目一字未动）", added.length > 0, JSON.stringify(added));
		return;
	}

	section("P3d ①：备选来源直出 —— 字符串字段与改造前逐字相同（golden，8 组 / 11 条路径全覆盖）");
	for (const p of P3D_PATHS) {
		const r = results[p.key];
		const arr = r.rec[p.field] || [];
		if (p.noGolden) {
			// 这一侧不钉 golden（原因见该路径上的注释）⇒ 只断言"有数组"这件 P3d 负责的事
			check(`P3d golden（${p.key}）：不钉 golden（该侧 P3d 之前就直出、产物随运行环境时区变）⇒ 只断言数组非空`,
				arr.length > 0, String(arr.length));
			continue;
		}
		const g = golden[p.key];
		check(`P3d golden（${p.key}）：golden 里有这一条（覆盖到、不是抽样）`, !!g, p.key);
		if (!g) continue;
		const fields = p.goldenFields || P3D_VISIBLE;
		const changed = fields.filter((f) => p3dTextOf(r.rec[f]) !== p3dTextOf(g.rec[f]));
		check(`P3d golden（${p.key}）：${fields.length} 个字符串字段与改造前逐字相同`, changed.length === 0, JSON.stringify(changed));
		check(`P3d golden（${p.key}）：\`${p.field}\` 非时间字段逐字不变（键序 / 顺序 / source / phase 全等）`,
			p3bSansTs(arr) === sansCategoryTagsJson(g.array), p3bSansTs(arr));
		check(`P3d golden（${p.key}）：数组非空（备选源真的直出了，而不是悄悄退回空数组）`,
			arr.length > 0, String(arr.length));
	}

	section("P3d ②：数组与改造前**合成结果**逐条相等（含 startTs / endTs）");
	for (const p of P3D_PATHS) {
		if (p.noGolden) continue;   // 同上：这一侧的产物随运行环境时区变，不做逐条钉死
		const r = results[p.key];
		const oldArr = legacySynthArrOf(p.key, p.side);
		const arr = r.rec[p.field] || [];
		check(`P3d 等价（${p.key}）：\`${p.field}\` 与改造前的合成结果逐条相等（含 ts）`,
			JSON.stringify(sansCategoryTags(arr)) === JSON.stringify(sansCategoryTags(oldArr)),
			JSON.stringify([sansCategoryTags(arr), oldArr]));
	}

	section("P3d ③：同源 —— 悬停 == hoverTextFromItems(条目事实)，且与 golden 逐字相同");
	for (const p of P3D_PATHS) {
		const r = results[p.key];
		const pay = r.payload || {};
		const items = (p.side === "gacha" ? pay.gachaHoverItems : pay.eventHoverItems) || [];
		const regen = T.hoverTextFromItems(items, p.side, r.src.tz || TZ_CN);
		const hover = p.side === "gacha" ? pay.bannerHover : pay.eventHover;
		check(`P3d 同源（${p.key}）：悬停 == hoverTextFromItems(条目事实) 逐字相等`,
			regen === (hover || ""), JSON.stringify([regen, hover || ""]));
		check(`P3d 同源（${p.key}）：条目事实齐备（每条带 startTs/endTs/raw；悬停非空时至少 1 条）`,
			items.every((x) => "startTs" in x && "endTs" in x && "raw" in x) && (items.length > 0 || !hover),
			String(items.length));
		check(`P3d 通道（${p.key}）：记录里没有 \`gachaHoverItems\` / \`eventHoverItems\``,
			!("gachaHoverItems" in r.rec) && !("eventHoverItems" in r.rec), JSON.stringify(Object.keys(r.rec)));
	}

	// ── ④ 端到端：设置页把来源切到备选源 → 一整轮 refresh() → 该侧真的能显示 ──────────
	section("P3d ④：端到端手动切源 —— 设置存储里写备选源 ⇒ refresh() ⇒ 该侧不再是「该来源无数据」");
	// 只让目标条目「可见」（其余全部进 hidden）⇒ 一轮 refresh 只发这个条目的请求（与 cases-core 同一手法）
	const allIds = createEngine({
		transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { throw new Error("no"); } },
		storage: makeStore(), now: () => 0
	}).__test.SOURCES.map((s) => s.id);
	for (const p of P3D_PATHS) {
		const r = results[p.key];
		// 设置页写的就是这个值：备选源的 `url`（老配置里也可能是 `id`，见 altSourceId）
		const altUrl = r.alt.url || r.alt.id || "";
		const store = makeStore();
		await store.set("hidden", allIds.filter((x) => x !== p.id));
		await store.set(p.side === "event" ? "customEventUrls" : "customUrls", JSON.stringify({ [p.id]: altUrl }));
		const engine = createEngine({ transport: r.transport, storage: store, now: () => p.now, timer: { setTimeout, clearTimeout } });
		const res = await engine.refresh();
		const rec = (res.games || {})[p.id] || {};
		const arr = rec[p.field] || [];
		const view = T.scheduleCellOf(Object.assign({ id: p.id }, rec), p.side, new Date(p.now));
		check(`P3d 端到端（${p.key}）：切源后数组非空（${arr.length} 条）`, arr.length > 0, String(arr.length));
		check(`P3d 端到端（${p.key}）：面板那一格能渲染（\`scheduleCellOf\` 非 null ⇒ 不再写「该来源无数据」）`,
			!!view && !!view.primary, JSON.stringify(view && { title: view.primary && view.primary.title, rest: view.rest && view.rest.length }));
	}

	// ── ⑤ 反向证明用钩子：这一节读的是**构建产物里的真实抓取器**，所以"关掉某条备选源的直出"
	//    会让 ①/②/④ 同时红（见报告里的贴红）。这里只固定"每条路径都恰好经它自己的那一个备选抓取器"。
	section("P3d ⑤：路径与注册表一致（每条路径用的就是设置页会选中的那个 fetcher）");
	for (const p of P3D_PATHS) {
		const r = results[p.key];
		const list = p.side === "event" ? (r.src.eventAltSources || []) : (r.src.altSources || []);
		const hit = list.find((a) => a.fetcher === p.alt);
		check(`P3d 注册（${p.key}）：\`${p.id}\` 的${p.side === "event" ? "活动" : "卡池"}备选源里有 ${p.alt}`,
			!!hit && (hit.url === (r.alt.url) || hit.id === r.alt.id), JSON.stringify(hit));
	}
}

// ══════════════════════════════════════════════════════════════════════════════
// P3e（2026-11-07）：**用户自定义地址**直出 + 最后一批备选源直出 + 路由解包 + 一处独立 bug
//
// ── 为什么还有这一批 ──
// P3d 把「手动切源才走」的备选源全部切成了直出，但留下两个洞：
//   ① **用户自定义地址**（设置页填任意 URL ⇒ `custom:<url>` / 自定义条目 ⇒ `allowGeneric`）：
//      `tryParseGenericGacha` 的三条通用分支（bwiki 表 / 方舟轮换表 / 普通 HTML 表）与
//      `genericEventPayloadFromHtml` 都只产字符串 ⇒ P3c 删掉合成器后，切到自定义地址那一侧
//      显示「无数据」（**功能回归**）。
//   ② 备选源里还有 5 条没直出（本批全切）：`bandori-bestdori-gacha`（本批点名）、
//      `uma-jp-umapyoi`（本批点名）、`bandori-bestdori-event`、`uma-global-gt`、`nte-ldshop`
//      （后三条是**穷尽普查**抓出来的：它们同样"真机有数据、数组为 null"）。
//   ③ 独立 bug：`nte-ldshop` 真机抛 `base.getTime is not a function`（`parseLdshopRange` 收到
//      数字当 Date 用）；修好之后它才有"能显示"的前提。
//   ④ 顺带抓出的路由 bug：8 个**活动备选源**登记成 `{ default: fn }`，而 `eventFetcherFor`
//      直接返回该对象 ⇒ `await fetcher(...)` 抛 "fetcher is not a function"（切过去只看到
//      「抓取失败」）。`eventFetcherFor` 现在统一解包成一等函数。
//
// ── 这一段守四件事 ──
// ① **自定义地址端到端**：设置存储写 `custom:<url>`（内置条目的自定义地址）与 `customEntries`
//    （自定义条目）→ `engine.refresh()` → `rec.gacha` / `rec.events` 非空 **且**
//    `scheduleCellOf` 非 null（= 面板不再写「该来源无数据」）。
// ② **解析失败不抛错**：任意站 / HTML 不匹配 ⇒ 数组为空、`refresh()` 正常返回。
// ③ **备选源直出**：数组（含 ts）与改造前合成结果**逐条相等**、悬停与条目事实**逐字同源**、
//    切源端到端有数据 —— 5 条路径全覆盖（含本批点名的 2 条）。
// ④ **nte-ldshop 回归**：夹具级（`parseLdshopPools` 不再抛错）+ 抓取器级（能出载荷/数组）。
//
// ⚠️ 夹具全部 `p3e-*`，**不进 map.json**（免得改变其它批次对默认源 404 的期望）；
//    来源与构造依据写在各自的 `response.txt.meta.json` 里。
const P3E_FIX = {
	bwiki: "p3e-custom-bwiki-html/response.txt",          // 真抓夹具的 parse.text（bwiki 原神往期祈愿）
	events: "p3e-custom-events-html/response.txt",       // 真抓夹具的 parse.text（bwiki 星铁活动一览）
	nomatch: "p3e-custom-nomatch/response.txt",          // 手工：故意没有任何表格
	bestdoriGacha: "p3e-bandori-bestdori-gacha/response.txt",
	bestdoriEvent: "p3e-bandori-bestdori-event/response.txt",
	umapyoi: "p3e-uma-umapyoi-gacha/response.txt",
	gt: "p3e-uma-global-gt/response.txt",
	ldshop: "p3e-nte-ldshop/response.txt"
};
// 合成出来的"自定义地址"（`example.invalid` 不会被真的访问 —— 全部经夹具 transport）
const P3E_CUSTOM_URL = "https://example.invalid/p3e-custom-bwiki.html";
const P3E_CUSTOM_EVENT_URL = "https://example.invalid/p3e-custom-events.html";
const P3E_CUSTOM_NOMATCH_URL = "https://example.invalid/p3e-custom-nomatch.html";
// 夹具抓取时刻（bwiki/星铁活动页）/ gachatracker 数据期 / ldshop 页数据期
const P3E_NOW = Date.parse("2026-11-07T02:20:17.024Z");
const P3E_NOW_BWIKI = Date.parse("2026-11-07T00:28:21.868Z");
const P3E_NOW_GT = Date.parse("2026-10-05T00:00:00.000Z");
const P3E_NOW_LDSHOP = Date.parse("2026-09-15T00:00:00.000Z");

// 5 条备选路径：id / side / 备选源键 / 夹具时刻 / URL→夹具映射
const P3E_PATHS = [
	{
		// 本批点名 ①：BanG Dream! 扭蛋备选（Bestdori 社区库，简中服）
		key: "bandoriBestdoriGacha", id: "bandori", side: "gacha", field: "gacha",
		alt: "bandori-bestdori-gacha", now: P3E_NOW,
		urls: { "https://bestdori.com/api/gacha/all.5.json": P3E_FIX.bestdoriGacha },
		// 改造前的悬停 = `hoverPool(uniq...)`（本轮改成 hoverTextFromItems，必须逐字相同）
		legacyHoverPool: true
	},
	{
		// 本批点名 ②：赛马娘日服卡池备选（umapyoi，无卡池名）
		key: "umaJpUmapyoi", id: "uma-jp", side: "gacha", field: "gacha",
		alt: "uma-jp-umapyoi", now: P3E_NOW,
		urls: { "https://api.umapyoi.net/api/v1/gacha": P3E_FIX.umapyoi },
		legacyHoverPool: true
	},
	{
		// 穷尽普查抓出来的 ③：BanG Dream! 活动备选（Bestdori 活动）
		// ⚠️ 这里**只**钉"直出/同源/切源有数据"：本源的活动档期互不重叠（夹具普查：任一时刻
		//    最多 1 期在期），所以 `eventHover` 恒为 ""（与改造前相同，UI 走默认两行式）；
		//    多期时的新排版（3 空格，本体约定）在本夹具里走不到 —— 如实记录，不假装测过。
		key: "bandoriBestdoriEvent", id: "bandori", side: "event", field: "events",
		alt: "bandori-bestdori-event", now: P3E_NOW,
		urls: { "https://bestdori.com/api/events/all.5.json": P3E_FIX.bestdoriEvent },
	},
	{
		// 穷尽普查抓出来的 ④：赛马娘国际服卡池备选（GachaTracker 英文；数据停在 10-11）
		key: "umaGlobalGt", id: "uma-global", side: "gacha", field: "gacha",
		alt: "uma-global-gt", now: P3E_NOW_GT,
		urls: { "https://gachatracker.app/games/umamusume/banners/": P3E_FIX.gt }
	},
	{
		// 穷尽普查抓出来的 ⑤：异环卡池备选（LDSHOP 繁体静态表）
		key: "nteLdshop", id: "nte", side: "gacha", field: "gacha",
		alt: "nte-ldshop", now: P3E_NOW_LDSHOP,
		urls: { "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html": P3E_FIX.ldshop }
	}
];

async function runP3e() {
	const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
	const allIds = createEngine({
		transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { throw new Error("no"); } },
		storage: makeStore(), now: () => 0
	}).__test.SOURCES.map((s) => s.id);
	// 一份夹具 transport（P3d 同一手法：直连与宿主代理两个出口都映射到同一份 body）
	const transportOf = (overrides) => makeFetchTransport(useFixtures(overrides));
	const cellOf = (id, rec, side, now) => T.scheduleCellOf(Object.assign({ id }, rec), side, new Date(now));

	// ── ① 自定义地址（内置条目 + `custom:<url>`）：两侧都要有数据 ──────────────
	section("P3e ①：自定义地址（custom:<url>）端到端 —— 卡池/活动两侧都不再是「无数据」");
	{
		const transport = transportOf({
			[P3E_CUSTOM_URL]: P3E_FIX.bwiki,
			[P3E_CUSTOM_EVENT_URL]: P3E_FIX.events,
			[P3E_CUSTOM_NOMATCH_URL]: P3E_FIX.nomatch
		});
		const store = makeStore();
		await store.set("hidden", allIds.filter((x) => x !== "genshin"));
		await store.set("customUrls", JSON.stringify({ genshin: "custom:" + P3E_CUSTOM_URL }));
		await store.set("customEventUrls", JSON.stringify({ genshin: "custom:" + P3E_CUSTOM_EVENT_URL }));
		const engine = createEngine({ transport, storage: store, now: () => P3E_NOW_BWIKI, timer: { setTimeout, clearTimeout } });
		let rec = {};
		let threw = "";
		try {
			const res = await engine.refresh();
			rec = (res.games || {}).genshin || {};
		} catch (e) { threw = String((e && e.message) || e); }
		check("P3e 自定义地址（内置条目）：`refresh()` 不抛错", threw === "", threw);
		check(`P3e 自定义地址：卡池数组非空（${(rec.gacha || []).length} 条 ⇒ 通用 bwiki 分支直出）`,
			(rec.gacha || []).length > 0, JSON.stringify((rec.gacha || []).map((x) => x.title)));
		check(`P3e 自定义地址：活动数组非空（${(rec.events || []).length} 条 ⇒ genericEventPayloadFromHtml 直出）`,
			(rec.events || []).length > 0, JSON.stringify((rec.events || []).map((x) => x.title)));
		const gCell = cellOf("genshin", rec, "gacha", P3E_NOW_BWIKI);
		const eCell = cellOf("genshin", rec, "event", P3E_NOW_BWIKI);
		check("P3e 自定义地址：面板卡池那一格能渲染（scheduleCellOf 非 null）", !!gCell && !!gCell.primary,
			JSON.stringify(gCell && gCell.primary && gCell.primary.title));
		check("P3e 自定义地址：面板活动那一格能渲染（scheduleCellOf 非 null）", !!eCell && !!eCell.primary,
			JSON.stringify(eCell && eCell.primary && eCell.primary.title));
		// 数组 key 由数据层按记录 id 重发（解析器不知道 meta.id）
		check("P3e 自定义地址：数组 key 前缀是记录 id（`genshin:gacha:i` / `genshin:event:i`）",
			(rec.gacha || []).every((x) => /^genshin:gacha:\d+$/.test(x.key)) &&
			(rec.events || []).every((x) => /^genshin:event:\d+$/.test(x.key)),
			JSON.stringify([(rec.gacha || []).map((x) => x.key), (rec.events || []).map((x) => x.key)]));
		// 悬停确实由条目生成（P3e 的三段式）：不与非条目串比较绝对档期 —— 数组条目的 ts 是
		// P1 的「本机时刻」口径，重算悬停会在非 +08 机器上偏 8 小时（见「已知不等价①」）。
		// 这里钉的是**与机器时区无关**的那部分：悬停非空、且外显池名出现在悬停行里。
		const gMain = (rec.gacha || []).find((x) => x.source === "primary");
		check("P3e 自定义地址：卡池悬停非空且由条目生成（外显池名出现在悬停里）",
			!!(rec.bannerHover || "") && !!gMain && rec.bannerHover.split("\n").some((l) => l.indexOf(gMain.title) === 0),
			JSON.stringify([rec.bannerHover || "", gMain && gMain.title]));
		const eMain = (rec.events || []).find((x) => x.source === "primary");
		check("P3e 自定义地址：活动悬停非空且由条目生成（外显活动名出现在悬停里）",
			!!(rec.eventHover || "") && !!eMain && rec.eventHover.split("\n").some((l) => l.indexOf(eMain.title) === 0),
			JSON.stringify([rec.eventHover || "", eMain && eMain.title]));

		// 独立条目（customEntries）：卡池与活动**同一条 URL** ⇒ 活动侧走「复用卡池那次 HTML」分支
		const store2 = makeStore();
		await store2.set("hidden", allIds);
		await store2.set("customEntries", JSON.stringify([{
			id: "p3e-custom-entry", name: "P3E 自定义条目", url: P3E_CUSTOM_EVENT_URL, eventUrl: P3E_CUSTOM_EVENT_URL
		}]));
		const engine2 = createEngine({ transport, storage: store2, now: () => P3E_NOW_BWIKI, timer: { setTimeout, clearTimeout } });
		const res2 = await engine2.refresh();
		const rec2 = (res2.games || {})["p3e-custom-entry"] || {};
		check(`P3e 自定义条目（两侧同址）：卡池数组非空（${(rec2.gacha || []).length} 条）`,
			(rec2.gacha || []).length > 0, String((rec2.gacha || []).length));
		check(`P3e 自定义条目（两侧同址）：活动数组非空（${(rec2.events || []).length} 条 ⇒ genericEventPayloadFromHtml 复用分支）`,
			(rec2.events || []).length > 0, String((rec2.events || []).length));
		check("P3e 自定义条目（两侧同址）：两格都能渲染",
			!!cellOf("p3e-custom-entry", rec2, "gacha", P3E_NOW_BWIKI) && !!cellOf("p3e-custom-entry", rec2, "event", P3E_NOW_BWIKI));

		// 解析失败（HTML 不匹配）⇒ 不抛错、该侧数组为空（与今天一致）
		const store3 = makeStore();
		await store3.set("hidden", allIds.filter((x) => x !== "genshin"));
		await store3.set("customUrls", JSON.stringify({ genshin: "custom:" + P3E_CUSTOM_NOMATCH_URL }));
		await store3.set("customEventUrls", JSON.stringify({ genshin: "custom:" + P3E_CUSTOM_NOMATCH_URL }));
		const engine3 = createEngine({ transport, storage: store3, now: () => P3E_NOW_BWIKI, timer: { setTimeout, clearTimeout } });
		let threw3 = "";
		let rec3 = {};
		try { const res3 = await engine3.refresh(); rec3 = (res3.games || {}).genshin || {}; }
		catch (e) { threw3 = String((e && e.message) || e); }
		check("P3e 解析失败（任意站 / HTML 不匹配）：`refresh()` 不抛错", threw3 === "", threw3);
		check("P3e 解析失败：两侧数组都为空（空数组 + 不抛错 = 今天的口径）",
			(rec3.gacha || []).length === 0 && (rec3.events || []).length === 0,
			JSON.stringify([(rec3.gacha || []).length, (rec3.events || []).length]));
		check("P3e 解析失败：该侧如实记失败/未命中（不伪装成有数据）",
			!!rec3.gachaFail && !!rec3.eventFail, JSON.stringify([rec3.gachaFail, rec3.eventFail]));
	}

	// ── ② 备选源（含本批点名的 2 条 + 穷尽普查补的 3 条）──────────────────────
	section("P3e ②：备选源直出 —— 数组与改造前合成结果逐条相等（含 ts）/ 悬停同源 / 切源后有数据");
	const results = {};
	for (const p of P3E_PATHS) {
		const transport = transportOf(p.urls);
		const eng0 = createEngine({ transport, storage: makeStore(), now: () => p.now });
		const src0 = eng0.__test.SOURCES.find((s) => s.id === p.id);
		if (!src0) throw new Error("P3e 找不到来源：" + p.id);
		const list = p.side === "event" ? (src0.eventAltSources || []) : (src0.altSources || []);
		const alt0 = list.find((a) => a.fetcher === p.alt);
		check(`P3e 注册（${p.key}）：\`${p.id}\` 的${p.side === "event" ? "活动" : "卡池"}备选源里有 ${p.alt}`,
			!!alt0, JSON.stringify(list));
		if (!alt0) continue;
		// 走**注册表路由**（设置页切源后真正会拿到的那一个）；P3e 顺带把 `{default:fn}` 解包
		const fetcher = p.side === "event"
			? eng0.__test.eventFetcherFor(src0, alt0.url)
			: eng0.__test.gachaFetcherFor(src0, alt0.url);
		check(`P3e 路由（${p.key}）：\`${alt0.fetcher}\` 经注册表解出一个**可调用**的抓取器`,
			typeof fetcher === "function", typeof fetcher);
		if (typeof fetcher !== "function") continue;
		const engine = createEngine({ transport, storage: makeStore(), now: () => p.now, timer: { setTimeout, clearTimeout } });
		let payload = null;
		let fetchThrew = "";
		try { payload = await fetcher(alt0.url, undefined, src0.tz); }
		catch (e) { fetchThrew = String((e && e.message) || e); }
		// 抓取器自己抛错 ⇒ 干净地记一条红（而不是让整批用例崩掉）：
		// 反向证明「把 nte-ldshop 的类型归一改回去」时会红在这一条（错误原文 = base.getTime is not a function）。
		check(`P3e 抓取（${p.key}）：抓取器不抛错（${fetchThrew || "ok"}）`, fetchThrew === "", fetchThrew);
		if (!payload) { check(`P3e 载荷（${p.key}）：当期有数据（夹具覆盖 now）`, false, String(p.now)); continue; }
		const rec = engine.__test.mergeEntryRecord({ data: payload }, null, p.now, { id: p.id, tz: src0.tz });
		const arr = rec[p.field] || [];
		const oldArr = legacySynthArrOf(p.key, p.side);
		const items = (p.side === "gacha" ? payload.gachaHoverItems : payload.eventHoverItems) || [];
		const hover = p.side === "gacha" ? payload.bannerHover : payload.eventHover;
		results[p.key] = { payload, rec, engine, p, src: src0, alt: alt0, transport, items };
		check(`P3e 直出（${p.key}）：\`${p.field}\` 数组非空（${arr.length} 条）`, arr.length > 0, String(arr.length));
		check(`P3e 等价（${p.key}）：数组与改造前合成结果逐条相等（含 startTs / endTs）`,
			JSON.stringify(arr) === JSON.stringify(oldArr), JSON.stringify([arr, oldArr]));
		check(`P3e 同源（${p.key}）：悬停 == hoverTextFromItems(条目事实) 逐字相等`,
			(hover || "") === T.hoverTextFromItems(items, p.side, src0.tz),
			JSON.stringify([hover || "", T.hoverTextFromItems(items, p.side, src0.tz)]));
		check(`P3e 通道（${p.key}）：记录里没有 \`gachaHoverItems\` / \`eventHoverItems\``,
			!("gachaHoverItems" in rec) && !("eventHoverItems" in rec), JSON.stringify(Object.keys(rec)));
		if (p.legacyHoverPool) {
			// 改造前的悬停是 `hoverPool(name/startTs/endTs)`：新实现必须**逐字**等于它
			const legacyHover = T.hoverPool(items.map((x) => ({ name: x.title, startTs: x.startTs, endTs: x.endTs })), src0.tz);
			check(`P3e 悬停逐字（${p.key}）：== 改造前 \`hoverPool\` 的输出（逐字相等）`,
				(hover || "") === legacyHover, JSON.stringify([hover || "", legacyHover]));
		}
	}

	// ── ③ 端到端手动切源（设置存储写备选源 ⇒ refresh ⇒ 该侧能渲染）──────────
	section("P3e ③：端到端切源 —— 设置存储里写备选源 ⇒ refresh() ⇒ 该侧不再是「该来源无数据」");
	for (const p of P3E_PATHS) {
		const r = results[p.key];
		if (!r) continue;
		const altUrl = r.alt.url || r.alt.id || "";
		const store = makeStore();
		await store.set("hidden", allIds.filter((x) => x !== p.id));
		await store.set(p.side === "event" ? "customEventUrls" : "customUrls", JSON.stringify({ [p.id]: altUrl }));
		const engine = createEngine({ transport: r.transport, storage: store, now: () => p.now, timer: { setTimeout, clearTimeout } });
		let threw = "";
		let rec = {};
		try { const res = await engine.refresh(); rec = (res.games || {})[p.id] || {}; }
		catch (e) { threw = String((e && e.message) || e); }
		const arr = rec[p.field] || [];
		check(`P3e 端到端（${p.key}）：切源后 refresh() 不抛错`, threw === "", threw);
		check(`P3e 端到端（${p.key}）：切源后数组非空（${arr.length} 条）`, arr.length > 0, String(arr.length));
		const cell = cellOf(p.id, rec, p.side, p.now);
		check(`P3e 端到端（${p.key}）：面板那一格能渲染（scheduleCellOf 非 null）`, !!cell && !!cell.primary,
			JSON.stringify(cell && cell.primary && cell.primary.title));
	}

	// ── ④ nte-ldshop 独立 bug 回归（夹具级 + 抓取器级）────────────────────────
	section("P3e ④：nte-ldshop 不再抛 `base.getTime is not a function`（夹具级回归）");
	{
		const r = results.nteLdshop;
		const html = readFileSync(path.join(FIXTURES_DIR, P3E_FIX.ldshop), "utf8");
		let pools = null;
		let threw = "";
		try { pools = T.parsers.nte.parseLdshopPools(html, "Asia/Shanghai"); } catch (e) { threw = String((e && e.message) || e); }
		check("P3e nte-ldshop：`parseLdshopPools(html, tz)` 不抛错（真因 = 把 nowMs() 当 Date 用）",
			threw === "", threw);
		check("P3e nte-ldshop：解析出 2 口池（夹具里就是两期）", Array.isArray(pools) && pools.length === 2,
			JSON.stringify(pools && pools.length));
		check("P3e nte-ldshop：抓取器出载荷且带 `gacha` 数组（切过去能显示）",
			!!r && (r.rec.gacha || []).length > 0 && !!r.rec.banner, JSON.stringify(r && r.rec.banner));
	}

	// ── ⑤ 穷尽守卫：**所有**已登记的备选源都能解出可调用抓取器（P3e 抓出的路由 bug）──
	section("P3e ⑤：全部已登记备选源的路由都能解出函数（8 个 `{default:fn}` 形状不再炸）");
	{
		const engine = createEngine({
			transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { throw new Error("no"); } },
			storage: makeStore(), now: () => 0
		});
		const t = engine.__test;
		let gTotal = 0, gBad = [];
		let eTotal = 0, eBad = [];
		for (const s of t.SOURCES) {
			for (const a of (s.altSources || [])) {
				gTotal++;
				const f = t.gachaFetcherFor(s, a.url || a.id || "");
				if (typeof f !== "function") gBad.push(s.id + "/" + a.fetcher);
			}
			for (const a of (s.eventAltSources || [])) {
				eTotal++;
				const f = t.eventFetcherFor(s, a.url || a.id || "");
				if (typeof f !== "function") eBad.push(s.id + "/" + a.fetcher);
			}
		}
		check(`P3e 普查：卡池备选源 ${gTotal} 条全部解出函数`, gBad.length === 0, JSON.stringify(gBad));
		check(`P3e 普查：活动备选源 ${eTotal} 条全部解出函数（本轮修的就是这一类）`, eBad.length === 0, JSON.stringify(eBad));
	}
}

// 直接 `node test/cases-p3.mjs` 时自报结果；被 all.mjs import 时不报（由 all.mjs 统一 summary）
if (process.argv[1] && process.argv[1].endsWith("cases-p3.mjs")) { await runP3(); summary(); }
