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
import { check, section, summary, useFixtures, fixtureBody } from "./harness.mjs";
import { T, FIXTURES_DIR } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
// 时钟 = 夹具抓取时刻（不随跑测日期漂移）
const NOW_GEN = Date.parse("2026-11-07T00:28:21.868Z");
const NOW_AK = Date.parse("2026-11-07T00:00:00.000Z");
const NOW_WUWA = NOW_AK;

const AT = (s) => Date.parse(s);

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
	// 时间戳只比类型（P1 口径 = 本机时刻；UTC 与 +08 的绝对数字不同，钉死会让门禁假红）
	const sansTs = (arr) => JSON.stringify((arr || []).map((x) => {
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
	// 把解析器直出的数组/通道摘掉 ⇒ mergeEntryRecord 会走**改造前的合成路径**（同一份字符串字段）
	const stripProduced = (payload) => {
		const o = Object.assign({}, payload || {});
		delete o.gacha; delete o.events; delete o.gachaHoverItems; delete o.eventHoverItems;
		return o;
	};

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
			sansTs(arr) === g[p.field], sansTs(arr));
		check(`P3 golden（${p.key}）：数组非空（解析器真的直出了，而不是悄悄退回空数组）`,
			arr.length > 0 || !!p.emptyOk, String(arr.length));
	}

	// ── ③ 数组与改造前的**合成结果**逐条相等（含 ts）：把解析器给的数组摘掉，旧合成器照同一份字符串字段再合成 ──
	for (const p of paths) {
		const r = got[p.key];
		const oldRec = r.engine.__test.mergeEntryRecord({ data: stripProduced(r.payload) }, null, p.now, { id: p.id, tz: TZ_CN });
		check(`P3 等价（${p.key}）：\`${p.field}\` 与改造前的合成结果**逐条相等**（含 startTs / endTs）`,
			JSON.stringify(r.rec[p.field]) === JSON.stringify(oldRec[p.field]),
			JSON.stringify([r.rec[p.field], oldRec[p.field]]));
		check(`P3 等价（${p.key}）：另一侧也不会凭空多出条目（摘掉数组后合成结果同样相等）`,
			JSON.stringify(r.rec[p.field === "gacha" ? "events" : "gacha"]) === JSON.stringify(oldRec[p.field === "gacha" ? "events" : "gacha"]));
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
const P3B_SWITCHED_EXPECT = 47;   // 已切路径数（每批提交时 +N，最终 = P3B_PATHS.length）
const P3B_PATHS = [
	// ── 第 1 批：星铁（bwiki）/ 绝区零（官方公告）/ 崩坏3（米游社备选）/ 米游社卡池 ──
	{
		key: "hsrGacha", switched: true, id: "hsr", side: "gacha", field: "gacha", now: Date.parse("2026-11-07T00:00:00.000Z"),
		urlsOf: (s) => ({ [s.url]: "p4-hsr-bwiki-warp-1107" }),
		call: (t, s) => t.GACHA_FETCHERS[s.id](s.url, undefined, s.tz)
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
	}];

// 12 个用户可见字符串字段（与 P3a 同一份口径）
const P3B_VISIBLE = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
	"event", "eventDates", "eventDatesRaw", "eventShow", "eventClaimDates", "eventHover", "eventHoverExtra"];
const p3bTextOf = (v) => (v == null ? "" : String(v));
// 时间戳只比类型（口径 = 本机时刻，见 README_Dev「已知不等价①」）；值的相等由 ③ 单独守
const p3bSansTs = (arr) => JSON.stringify((arr || []).map((x) => {
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
// 把解析器直出的数组/通道摘掉 ⇒ mergeEntryRecord 走改造前的合成路径（同一份字符串字段）
const p3bStripProduced = (payload) => {
	const o = Object.assign({}, payload || {});
	delete o.gacha; delete o.events; delete o.gachaHoverItems; delete o.eventHoverItems;
	return o;
};

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
		const changed = P3B_VISIBLE.filter((f) => p3bTextOf(r.rec[f]) !== p3bTextOf(g.rec[f]));
		check(`P3b golden（${p.key}）：12 个字符串字段与改造前逐字相同`, changed.length === 0, JSON.stringify(changed));
		const arr = r.rec[p.field] || [];
		check(`P3b golden（${p.key}）：\`${p.field}\` 非时间字段逐字不变（键序 / 顺序 / source / phase 全等）`,
			p3bSansTs(arr) === g.array, p3bSansTs(arr));
		check(`P3b golden（${p.key}）：数组非空（解析器真的直出了，而不是悄悄退回空数组）`,
			arr.length > 0 || !!p.emptyOk, String(arr.length));
	}

	section("P3b ②：数组与改造前**合成结果**逐条相等（含 startTs / endTs）");
	for (const p of P3B_PATHS) {
		const r = results[p.key];
		const oldRec = r.engine.__test.mergeEntryRecord({ data: p3bStripProduced(r.payload) }, null, p.now, { id: p.id, tz: r.src.tz });
		check(`P3b 等价（${p.key}）：\`${p.field}\` 与改造前的合成结果逐条相等（含 ts）`,
			JSON.stringify(r.rec[p.field]) === JSON.stringify(oldRec[p.field]),
			JSON.stringify([r.rec[p.field], oldRec[p.field]]));
		const other = p.field === "gacha" ? "events" : "gacha";
		check(`P3b 等价（${p.key}）：另一侧也不会凭空多出条目`,
			JSON.stringify(r.rec[other]) === JSON.stringify(oldRec[other]));
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
}

// 直接 `node test/cases-p3.mjs` 时自报结果；被 all.mjs import 时不报（由 all.mjs 统一 summary）
if (process.argv[1] && process.argv[1].endsWith("cases-p3.mjs")) { await runP3(); summary(); }
