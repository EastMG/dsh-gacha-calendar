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
import { createEngine } from "../packages/core/core.mjs";
import { check, section, useFixtures, fixtureBody } from "./harness.mjs";
import { T } from "./load.mjs";

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
			arr.length > 0, String(arr.length));
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
}
