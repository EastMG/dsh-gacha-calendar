// test/cases-batch6.mjs —— 第五批新来源（2026-11-15 接入）：4 款 bwiki 游戏
//
//   · `langrisser` 梦幻模拟战 —— SMW `action=ask` 查 `分类:召唤`（名称/开始/结束/项目）
//   · `crashfever` CrashFever —— SMW `action=ask` 查 `类别::卡池`（标题/时间/结束时间/类别）
//   · `bfzy` 百分之一 —— 页面 `历史卡池` 的 wikitext 表格（更新日/卡池/新UP/上期UP，530 行）
//   · `gwdz` 怪物弹珠 —— 卡池 `Data:GachaConfig.json`（**JSON 直读**）+ 活动 `Widget:游戏活动日历`
//     的 `CALENDAR_DATA.events`（JS 对象字面量，按括号切、**不 eval**）
//
// ── 这一段守什么 ──
//   ① **注册项**：id / 名称 / tz / 来源标签（逐字）/ 出厂展示 / 配色 / URL 逐字；
//   ② **真夹具驱动**：SMW `_dat` 的 `1/2026/9/10` 形态 / 历史表两种日期写法（`[[公告|日期]]` 与裸日期）
//      / `Data:GachaConfig.json`（含 `9999` 哨兵与 `启用:false` 模板条目）/ `CALENDAR_DATA`
//      （`recur` 每月轮换必须跳过）→ 「名 + 起止」都对得上绝对毫秒；
//   ③ **引擎整轮 + 请求数**（bwiki 一律走宿主代理：1 / 1 / 1 / 2）；
//   ④ **反证**：`{}` ⇒ **抛错**（结构损坏，不是 nomatch：引擎记 `*Fail`、面板不会静默"未公布"）；
//      抹掉时间锚点 ⇒ 该条**不进外显**（不抛、不硬凑）；
//      终点是 `9999` 哨兵的常驻池 ⇒ `endTs = null` ⇒ 不算当期。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const TZ_JP = "Asia/Tokyo";   // CrashFever（日服）
const B5 = T.parsers.batch5;

const LR_URL = B5.LANGRISSER_URL;
const CF_URL = B5.CRASHFEVER_URL;
const BF_URL = B5.BFZY_URL;
const GW_JSON_URL = B5.GWDZ_GACHA_URL;
const GW_CAL_URL = B5.GWDZ_CAL_URL;

// bwiki 目标 URL 在 transport 里会被补 `origin=*`（15-env.js 的 withBwikiCors）；
// 反证覆盖表按**补完后的**字符串命中（与夹具查找同一形态）。
const withOrigin = (u) => u + (u.includes("?") ? "&" : "?") + "origin=*";

const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;
const allIds = () => T.SOURCES.map((s) => s.id);

const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

/** 夹具 transport：默认按 map.json 取夹具原文；`overrides` 里按 URL 覆盖（反证用）。 */
const makeTransport = (sink, overrides) => ({
	async fetchRaw(url) {
		if (sink) sink.push(String(url));
		throw new Error("本批 4 条都走宿主代理（mode=proxy）：" + url);
	},
	async fetchViaProxy(url) {
		const u = String(url);
		if (sink) sink.push(u);
		if (overrides && overrides[u] != null) return overrides[u];
		return fixtureBody(u);
	}
});

const engineAt = (now, shownId, sink, overrides) => {
	const others = allIds().filter((x) => x !== shownId);
	return createEngine({
		transport: makeTransport(sink, overrides),
		storage: makeStore({ hidden: others, shown: [shownId] }),
		now: () => now,
		timer: { setTimeout, clearTimeout }
	});
};

const throws = (fn, re) => {
	try { fn(); return false; } catch (e) { return re ? re.test(String(e && e.message)) : true; }
};

// 引擎整轮失败态：`*Fail` 非空 = 抛错路径（结构损坏）；`*Fail == null` 且无外显 = nomatch（未公布）
const refreshAt = async (now, id, sink, overrides) => {
	const e = engineAt(now, id, sink, overrides);
	const r = await e.refresh();
	return (r && r.games && r.games[id]) || {};
};

export default async function run() {
	// ═════════ ① 注册项（4 条）═════════
	section("第五批 ①：4 条注册项（id / 名称 / tz / 标签逐字 / 出厂展示 / 配色 / URL）");
	{
		const want = [
			["langrisser", "梦幻模拟战", "Bwiki 召唤一览（停更）", null, LR_URL],
			["crashfever", "CrashFever·日服", "Bwiki 卡池一览", null, CF_URL],
			["bfzy", "百分之一", "Bwiki 历史卡池（停更）", null, BF_URL],
			["gwdz", "怪物弹珠·日服", "Bwiki 卡池配置", "Bwiki 活动日历", GW_JSON_URL]
		];
		for (const [id, name, gachaLabel, eventLabel, url] of want) {
			const s = srcOf(id);
			check(`${id} 已注册（name / tz / 卡池标签逐字）`,
				!!s && s.name === name && s.tz === (id === "crashfever" ? TZ_JP : TZ_CN) && s.source === gachaLabel,
				s ? JSON.stringify([s.name, s.tz, s.source]) : "缺失");
			const wantHidden = id === "langrisser" || id === "bfzy";   // 2026-11-15：wiki 停更 ⇒ 默认置空（不占面板行）
			check(`${id} 出厂默认展示 = ${!wantHidden}（defaultHidden）`, !!s && s.defaultHidden === wantHidden, s && String(s.defaultHidden));
			check(`${id} 有配色（面板「颜色 = 游戏」）`, !!s && /^#[0-9A-F]{6}$/i.test(String(s.color)), s && String(s.color));
			check(`${id} 卡池 URL 逐字`, !!s && s.url === url, s && String(s.url).slice(0, 120));
			if (eventLabel) {
				check(`${id} 活动侧标签 =「${eventLabel}」/ URL 与卡池不同`,
					!!s && s.eventSource === eventLabel && s.eventUrl === GW_CAL_URL && s.eventUrl !== s.url,
					s ? JSON.stringify([s.eventSource, String(s.eventUrl).slice(0, 80)]) : "缺失");
			} else {
				check(`${id} 活动侧未配置（eventUrl 为空串）`, !!s && s.eventUrl === "", s && JSON.stringify(s.eventUrl));
			}
		}
		check("4 条 id 全局唯一（没和既有来源撞 id）", new Set(allIds()).size === allIds().length, String(allIds().length));
		check("gwdz 两侧来源标签不同（卡池配置 / 活动日历）",
			srcOf("gwdz").source !== srcOf("gwdz").eventSource,
			JSON.stringify([srcOf("gwdz").source, srcOf("gwdz").eventSource]));
	}

	// ═════════ ② langrisser：SMW `_dat` 形态 + 引擎整轮 ═════════
	section("第五批 ②：梦幻模拟战（langrisser）真夹具 —— SMW ask / 反证 / 引擎整轮");
	{
		const LR_NOW = Date.parse("2026-09-20T12:00:00+08:00");
		check("`_dat.raw` 解析：`1/2026/9/10` ⇒ 2026-09-10（只有日期）/ `1/2026/11/12/15/0/0/0` ⇒ 带 15:00",
			JSON.stringify(B5.ns_b5_pointOfText("1/2026/9/10")) === JSON.stringify({ y: 2026, mo: 9, d: 10, h: null, mi: null })
			&& JSON.stringify(B5.ns_b5_pointOfText("1/2026/11/12/15/0/0/0")) === JSON.stringify({ y: 2026, mo: 11, d: 12, h: 15, mi: 0 }),
			JSON.stringify([B5.ns_b5_pointOfText("1/2026/9/10"), B5.ns_b5_pointOfText("1/2026/11/12/15/0/0/0")]));

		const json = JSON.parse(fixtureBody(LR_URL));
		const items = B5.langrisserParseAsk(json, TZ_CN);
		check("ask ⇒ 6 条（夹具裁剪后的行数）", items.length === 6, String(items.length));
		const top = items.find((x) => x.banner === "炽潮双刃，斩浪焚海");
		check("最新一期：2026-09-10 00:00 ~ 10-14 23:59 +08（UTC 手算 09-09T16:00Z / 10-14T15:59Z）",
			!!top && top.startTs === Date.UTC(2026, 8, 9, 16, 0) && top.endTs === Date.UTC(2026, 9, 14, 15, 59),
			JSON.stringify(top && [top.startTs, top.endTs]));
		check("`项目` = UP 角色（多值 `、` 连接）⇒ roles，raw 只写日期、display 补全时刻",
			!!top && top.roles === "妮、红莲" && top.raw === "2026-09-10 ~ 2026-10-14"
			&& top.display === "09-10 00:00 ~ 10-14 23:59",
			JSON.stringify(top && [top.roles, top.raw, top.display]));
		const noRoles = items.find((x) => x.banner === "轮纪·许愿召唤");
		check("`项目` 为空的那期 ⇒ roles = 空串（不编角色）", !!noRoles && noRoles.roles === "", JSON.stringify(noRoles && noRoles.roles));

		const payload = B5.langrisserPayloadOf(items, TZ_CN, LR_NOW);
		check("外显（now=2026-09-20）：炽潮双刃，斩浪焚海 / 09-10 00:00 ~ 10-14 23:59 / roles 妮、红莲",
			!!payload && payload.banner === "炽潮双刃，斩浪焚海"
			&& payload.bannerDates === "09-10 00:00 ~ 10-14 23:59"
			&& payload.bannerDatesRaw === "2026-09-10 ~ 2026-10-14"
			&& payload.roles === "妮、红莲"
			&& payload.gacha.length === 1 && payload.gacha[0].key === "langrisser:gacha:0",
			JSON.stringify(payload && [payload.banner, payload.bannerDates, payload.roles]));
		if (payload && payload.bannerHover) assertHoverConvention("langrisser 卡池悬停", payload.bannerHover);
		check("当期没有（now=2026-11-15）⇒ null（夹具最新一期 10-14 已结束）",
			B5.langrisserPayloadOf(items, TZ_CN, Date.parse("2026-11-15T12:00:00+08:00")) === null);

		// 反证 ①：结构损坏（`{}`）⇒ 纯解析抛错（不是"未公布"）
		check("反证：`{}` ⇒ 抛错 `langrisser-ask:bad-json`", throws(() => B5.langrisserParseAsk({}), /langrisser-ask:bad-json/));
		// 反证 ②：抹掉时间锚点 ⇒ 该条不进外显
		const noAnchor = JSON.parse(fixtureBody(LR_URL));
		const row = noAnchor.query.results["召唤/20260910/炽潮双刃，斩浪焚海"];
		delete row.printouts["开始"];
		delete row.printouts["结束"];
		const items2 = B5.langrisserParseAsk(noAnchor, TZ_CN);
		check("反证：抹掉在期那一期的 开始/结束 ⇒ 条目数 6→5，且外显 null（不抛、不硬凑）",
			items2.length === 5 && B5.langrisserPayloadOf(items2, TZ_CN, LR_NOW) === null,
			JSON.stringify([items2.length, B5.langrisserPayloadOf(items2, TZ_CN, LR_NOW) && "有外显"]));

		// 引擎整轮：1 个请求
		const calls = [];
		const rec = await refreshAt(LR_NOW, "langrisser", calls, null);
		check("引擎：整轮 **1 次**请求（SMW ask 一次拿全；sort=开始 desc 保证最新一期在首页）",
			calls.length === 1 && calls[0] === withOrigin(LR_URL), "requests=" + calls.length + " " + JSON.stringify(calls.slice(0, 2)));
		check("引擎外显：banner / bannerDates / roles 与解析层一致，gachaFail = null",
			rec.banner === "炽潮双刃，斩浪焚海" && rec.bannerDates === "09-10 00:00 ~ 10-14 23:59"
			&& rec.roles === "妮、红莲" && rec.gachaFail === null,
			JSON.stringify([rec.banner, rec.bannerDates, rec.gachaFail]));
		if (rec.bannerHover) assertHoverConvention("langrisser 引擎悬停", rec.bannerHover, { requireSet: true });
		// 反证 ③：`{}` 走引擎 ⇒ 记失败（面板会报"抓取失败"，不会静默"未公布"）
		const recBad = await refreshAt(LR_NOW, "langrisser", [], { [withOrigin(LR_URL)]: "{}" });
		check("反证：引擎遇到 `{}` ⇒ gachaFail 非空、无外显（与非 nomatch 区分开）",
			recBad.gachaFail != null && !recBad.banner,
			JSON.stringify([recBad.gachaFail, recBad.banner]));
	}

	// ═════════ ③ crashfever：同窗口多池 + 结构性坏行 ═════════
	section("第五批 ③：CrashFever（crashfever）真夹具 —— ask / 悬停 / 反证 / 引擎整轮");
	{
		const CF_NOW = Date.parse("2026-11-15T12:00:00+08:00");
		const json = JSON.parse(fixtureBody(CF_URL));
		const items = B5.crashfeverParseAsk(json, TZ_JP);
		check("ask ⇒ 4 条（模板页「添加卡池预设」没有时间 ⇒ 跳过，不是结构损坏）", items.length === 4, String(items.length));
		const cur = items.find((x) => x.banner === "超Fever祭典【傅柯】");
		check("在期池：2026-11-12 15:00 ~ 11-26 14:59 +09（UTC 11-12T06:00Z / 11-26T05:59Z）",
			!!cur && cur.startTs === Date.UTC(2026, 10, 12, 6, 0) && cur.endTs === Date.UTC(2026, 10, 26, 5, 59),
			JSON.stringify(cur && [cur.startTs, cur.endTs]));
		check("`类别` 落 category；raw 是源站墙钟（`2026-11-12 15:00 ~ …`），display 同年省略年",
			!!cur && cur.category === "卡池" && cur.raw === "2026-11-12 15:00 ~ 2026-11-26 14:59"
			&& cur.display === "11-12 15:00 ~ 11-26 14:59",
			JSON.stringify(cur && [cur.category, cur.raw, cur.display]));
		check("未来池也在结果里（11-19 开）但不进当期外显",
			items.some((x) => x.banner === "极Fever祭典【奇幻三人组】")
			&& B5.crashfeverPayloadOf(items, TZ_JP, CF_NOW).startTs === cur.startTs);

		const payload = B5.crashfeverPayloadOf(items, TZ_JP, CF_NOW);
		check("外显 = 结束最早的到期池（超Fever祭典【傅柯】），同结束池一起进悬停/数组",
			!!payload && payload.banner === "超Fever祭典【傅柯】"
			&& payload.bannerDates === "11-12 15:00 ~ 11-26 14:59"
			&& payload.bannerDatesRaw === "2026-11-12 15:00 ~ 2026-11-26 14:59"
			&& payload.gacha.length === 2,
			JSON.stringify(payload && [payload.banner, payload.bannerDates, payload.gacha.length]));
		if (payload && payload.bannerHover) assertHoverConvention("crashfever 卡池悬停", payload.bannerHover, { requireSet: true });

		check("反证：`{}` ⇒ 抛错 `crashfever-ask:bad-json`",
			throws(() => B5.crashfeverParseAsk({}), /crashfever-ask:bad-json/));

		// 反证：抹掉两个在期池的时间 ⇒ 当期 null（条目数仍是 2：未来池 + 已结束池）
		const noAnchor = JSON.parse(fixtureBody(CF_URL));
		for (const k of ["超Fever祭典【傅柯】", "超进化适应卡池【伊迪丝】"]) {
			delete noAnchor.query.results[k].printouts["时间"];
			delete noAnchor.query.results[k].printouts["结束时间"];
		}
		const items2 = B5.crashfeverParseAsk(noAnchor, TZ_JP);
		check("反证：抹掉在期两池的时间锚 ⇒ 外显 null（其它行还在 ⇒ 不抛）",
			items2.length === 2 && B5.crashfeverPayloadOf(items2, TZ_JP, CF_NOW) === null,
			JSON.stringify([items2.length, B5.crashfeverPayloadOf(items2, TZ_JP, CF_NOW) && "有外显"]));

		const calls = [];
		const rec = await refreshAt(CF_NOW, "crashfever", calls, null);
		check("引擎：整轮 **1 次**请求（limit=500 一次拿全，无 query-continue-offset）",
			calls.length === 1 && calls[0] === withOrigin(CF_URL), "requests=" + calls.length);
		check("引擎外显：banner / bannerDates / category 事实，gachaFail = null",
			rec.banner === "超Fever祭典【傅柯】" && rec.bannerDates === "11-12 15:00 ~ 11-26 14:59"
			&& rec.gachaFail === null
			&& rec.gacha && rec.gacha.every((x) => x.category === "卡池"),
			JSON.stringify([rec.banner, rec.bannerDates, rec.gachaFail]));
		if (rec.bannerHover) assertHoverConvention("crashfever 引擎悬停", rec.bannerHover, { requireSet: true });
	}

	// ═════════ ④ bfzy：历史表 → 相邻更新日窗口 ═════════
	section("第五批 ④：百分之一（bfzy）真夹具 —— wikitext 表 / 窗口推定 / 反证 / 引擎整轮");
	{
		const BF_NOW_PREV = Date.parse("2026-09-02T12:00:00+08:00");   // 上一期（08-28 起）在期
		const BF_NOW_NEW = Date.parse("2026-09-05T12:00:00+08:00");    // 最新一期（09-04 起）在期
		const outer = JSON.parse(fixtureBody(BF_URL));
		const rows = B5.bfzyRowsOf(outer.parse.wikitext);
		check("表 ⇒ 6 行（2 个更新日 × 3 行），卡池列 80抽·第1天 / 50抽·第2天 / 50抽·第1天",
			rows.length === 6 && rows[0].date === "2026-09-04" && rows[0].pool === "80抽·第1天",
			JSON.stringify(rows.map((r) => [r.date, r.pool])));
		check("新UP 去掉 `'''粗体` 与 `[[链接]]`（两种写法都吃）",
			rows[2].up === "天穹统御·中途岛" && rows[0].up === "礼装的双子温蒂尼",
			JSON.stringify([rows[0].up, rows[2].up]));

		const items = B5.bfzyParseHistory(outer.parse.wikitext, TZ_CN);
		check("窗口 = [更新日 00:00, 下一更新日 00:00)；最新一期按每周轮换 +7 天",
			items.length === 6
			&& items[0].startTs === Date.UTC(2026, 8, 3, 16, 0) && items[0].endTs === Date.UTC(2026, 8, 10, 16, 0)
			&& items[3].startTs === Date.UTC(2026, 7, 27, 16, 0) && items[3].endTs === Date.UTC(2026, 8, 3, 16, 0),
			JSON.stringify(items.map((x) => [x.startTs, x.endTs])));
		check("raw 只有源站原文的更新日（止是推定值，不进 raw）",
			items[0].raw === "2026-09-04" && items[0].display === "09-04 00:00 ~ 09-11 00:00",
			JSON.stringify([items[0].raw, items[0].display]));

		const pPrev = B5.bfzyPayloadOf(items, TZ_CN, BF_NOW_PREV);
		const pNew = B5.bfzyPayloadOf(items, TZ_CN, BF_NOW_NEW);
		check("外显（now=09-02）= 08-28 那一期：「80抽·第2天」+ 3 张新UP 合并 / 08-28 00:00 ~ 09-04 00:00",
			!!pPrev && pPrev.banner === "80抽·第2天"
			&& pPrev.bannerDates === "08-28 00:00 ~ 09-04 00:00"
			&& pPrev.roles === "奇迹锚点·约克城、凝华·天津四、蔷薇密令·希尔达"
			&& pPrev.gacha.length === 4 && pPrev.gacha[0].category === "80抽·第2天",
			JSON.stringify(pPrev && [pPrev.banner, pPrev.bannerDates, pPrev.roles]));
		check("外显（now=09-05）= 09-04 那一期：「80抽·第1天」/ 09-04 00:00 ~ 09-11 00:00",
			!!pNew && pNew.banner === "80抽·第1天" && pNew.bannerDates === "09-04 00:00 ~ 09-11 00:00"
			&& pNew.roles === "礼装的双子温蒂尼、宵练赤虹·乞巧、天穹统御·中途岛",
			JSON.stringify(pNew && [pNew.banner, pNew.bannerDates, pNew.roles]));
		if (pNew && pNew.bannerHover) assertHoverConvention("bfzy 卡池悬停", pNew.bannerHover, { requireSet: true });

		// 反证：抹掉最新一期的日期 ⇒ 只剩 08-28 一行组 ⇒ now=09-05 已过其止 ⇒ 外显 null
		const noAnchor = JSON.parse(fixtureBody(BF_URL));
		noAnchor.parse.wikitext = noAnchor.parse.wikitext.split("|2026-09-04]]").join("|]]");
		check("反证：抹掉在期那一期的更新日 ⇒ 表里只剩 08-28 组、外显 null（不抛）",
			(() => {
				const it = B5.bfzyParseHistory(noAnchor.parse.wikitext, TZ_CN);
				return it.length === 3 && B5.bfzyPayloadOf(it, TZ_CN, BF_NOW_NEW) === null;
			})(),
			JSON.stringify(noAnchor.parse.wikitext.includes("2026-09-04")));

		const recBad = await refreshAt(BF_NOW_NEW, "bfzy", [], { [withOrigin(BF_URL)]: "{}" });
		check("反证：引擎遇到 {}（没有 parse.wikitext）⇒ gachaFail 非空、无外显（与非 nomatch 区分开）",
			recBad.gachaFail != null && !recBad.banner, JSON.stringify([recBad.gachaFail, recBad.banner]));

		const calls = [];
		const rec = await refreshAt(BF_NOW_NEW, "bfzy", calls, null);
		check("引擎：整轮 **1 次**请求（一次 parse 拿整页 wikitext）",
			calls.length === 1 && calls[0] === withOrigin(BF_URL), "requests=" + calls.length);
		check("引擎外显：banner = 80抽·第1天 / 09-04 00:00 ~ 09-11 00:00 / gachaFail = null",
			rec.banner === "80抽·第1天" && rec.bannerDates === "09-04 00:00 ~ 09-11 00:00" && rec.gachaFail === null,
			JSON.stringify([rec.banner, rec.bannerDates, rec.gachaFail]));
		if (rec.bannerHover) assertHoverConvention("bfzy 引擎悬停", rec.bannerHover, { requireSet: true });
	}

	// ═════════ ⑤ gwdz 卡池侧：JSON 直读（哨兵 / 启用:false）═════════
	section("第五批 ⑤：怪物弹珠（gwdz）卡池 —— `Data:GachaConfig.json` JSON 直读 / 哨兵 / 反证");
	{
		const GW_NOW = Date.parse("2026-11-15T12:00:00+08:00");
		const outer = JSON.parse(fixtureBody(GW_JSON_URL));
		check("外层是 MediaWiki JSON、内容是 **JSON 字符串**（不是 HTML）", typeof outer.parse.wikitext === "string");
		const items = B5.gwdzParseConfig(outer, TZ_CN);
		check("⇒ 4 条（`-1` 池基础 `启用:false` ⇒ 跳过；`彩兽神祭` 9999 哨兵保留但 endTs=null）",
			items.length === 4 && items.filter((x) => x.endTs == null).length === 1,
			JSON.stringify(items.map((x) => [x.banner, x.endTs])));
		const cur = items.find((x) => x.banner === "无职转生Ⅲ联动-6星3体up");
		check("在期池：2026-11-15 11:00 ~ 12-02 10:59 +08（UTC 11-15T03:00Z / 12-02T02:59Z）",
			!!cur && cur.startTs === Date.UTC(2026, 10, 15, 3, 0) && cur.endTs === Date.UTC(2026, 11, 2, 2, 59),
			JSON.stringify(cur && [cur.startTs, cur.endTs]));
		check("哨兵池：raw 保留源站 `9999/9/9 99:59`、endTs = null、display 只有起点（不猜终点）",
			(() => {
				const s = items.find((x) => x.banner.includes("彩兽神祭"));
				return !!s && s.endTs === null && /9999\/9\/9 99:59/.test(s.raw) && s.display === "2024-12-31 23:00";
			})(),
			JSON.stringify(items.find((x) => x.endTs == null)));
		const payload = B5.gwdzGachaPayloadOf(items, TZ_CN, GW_NOW);
		check("外显 = 无职转生Ⅲ联动-6星3体up / 11-15 11:00 ~ 12-02 10:59 / 常驻池不进外显",
			!!payload && payload.banner === "无职转生Ⅲ联动-6星3体up"
			&& payload.bannerDates === "11-15 11:00 ~ 12-02 10:59"
			&& payload.gacha.length === 1 && payload.gacha[0].key === "gwdz:gacha:0",
			JSON.stringify(payload && [payload.banner, payload.bannerDates, payload.gacha.length]));

		check("反证：`{}` ⇒ 抛错 `gwdz-config:bad-json`", throws(() => B5.gwdzParseConfig({}), /gwdz-config:bad-json/));
		// 反证：抹掉在期池的 关闭时间 ⇒ endTs=null ⇒ 不进外显
		const cfg = JSON.parse(outer.parse.wikitext);
		delete cfg.卡池列表["物语"].关闭时间;
		const items2 = B5.gwdzParseConfig({ parse: { wikitext: JSON.stringify(cfg) } }, TZ_CN);
		check("反证：抹掉在期池的关闭时间 ⇒ 外显 null（其余行还在 ⇒ 不抛）",
			items2.length === 4 && B5.gwdzGachaPayloadOf(items2, TZ_CN, GW_NOW) === null,
			JSON.stringify([items2.length, B5.gwdzGachaPayloadOf(items2, TZ_CN, GW_NOW) && "有外显"]));
	}

	// ═════════ ⑥ gwdz 活动侧：CALENDAR_DATA（不 eval）+ 引擎整轮 2 次请求 ═════════
	section("第五批 ⑥：怪物弹珠（gwdz）活动 —— `CALENDAR_DATA.events` / recur 跳过 / 反证 / 引擎整轮");
	{
		const GW_NOW = Date.parse("2026-11-15T12:00:00+08:00");
		const outer = JSON.parse(fixtureBody(GW_CAL_URL));
		const wikitext = outer.parse.wikitext;
		check("`CALENDAR_DATA` 对象能被括号切出来（长度 > events 数组；不 eval）",
			typeof wikitext === "string" && B5.gwdzCalendarObjectOf(wikitext).length > 1000);
		check("`events:` 认的是**属性名**（注释里也出现「events 数组」字样，按裸 indexOf 会切到 meta.notices）",
			B5.gwdzEventObjectsOf(B5.gwdzCalendarObjectOf(wikitext)).length > 0);
		const items = B5.gwdzParseCalendar(wikitext, TZ_CN);
		check("⇒ 5 条固定窗口（2 条 `recur` 每月轮换跳过；单日解禁 `endTime:\"\"` 没有窗口 ⇒ 跳过）",
			items.length === 5, JSON.stringify(items.map((x) => x.event)));
		const collab = items.find((x) => x.event === "新联动-无职转生Ⅲ联动");
		check("在期活动：2026-11-15 11:00 ~ 12-02 10:59 +08（与卡池同窗口）",
			!!collab && collab.startTs === Date.UTC(2026, 10, 15, 3, 0) && collab.endTs === Date.UTC(2026, 11, 2, 2, 59),
			JSON.stringify(collab && [collab.startTs, collab.endTs]));
		check("跨年活动「弹珠高手记录」⇒ 2026-10-02 11:00 ~ 2027-04-01 02:59（跨年两端都带年份）",
			(() => {
				const x = items.find((y) => y.event === "「弹珠高手记录」");
				return !!x && x.startTs === Date.UTC(2026, 9, 2, 3, 0) && x.endTs === Date.UTC(2027, 2, 31, 18, 59)
					&& x.display === "2026-10-02 11:00 ~ 2027-04-01 02:59";
			})(),
			JSON.stringify(items.find((y) => y.event === "「弹珠高手记录」")));
		const payload = B5.gwdzEventPayloadOf(items, TZ_CN, GW_NOW);
		check("活动外显 = 结束最早的联动「新联动-无职转生Ⅲ联动」/ 悬停 2 行",
			!!payload && payload.event === "新联动-无职转生Ⅲ联动"
			&& payload.eventDates === "11-15 11:00 ~ 12-02 10:59"
			&& payload.eventDatesRaw === "2026-11-15 11:00 ~ 2026-12-02 10:59"
			&& payload.events.length === 2 && payload.events[0].key === "gwdz:event:0",
			JSON.stringify(payload && [payload.event, payload.eventDates, payload.events.length]));
		if (payload && payload.eventHover) assertHoverConvention("gwdz 活动悬停", payload.eventHover, { requireSet: true });

		check("反证：`{}` ⇒ 抛错 `gwdz-calendar:bad-json`", throws(() => B5.gwdzParseCalendar({}), /gwdz-calendar:bad-json/));
		// 反证：抹掉 2 条在期活动的 start ⇒ 只剩已结束的 ⇒ 外显 null
		const noAnchor = wikitext.split('start: "2026-11-15"').join('startMissing: "2026-11-15"')
			.split('start: "2026-10-02"').join('startMissing: "2026-10-02"');
		check("反证：抹掉在期活动的 start ⇒ 条目 5→3、外显 null（不抛）",
			(() => {
				const it = B5.gwdzParseCalendar(noAnchor, TZ_CN);
				return it.length === 3 && B5.gwdzEventPayloadOf(it, TZ_CN, GW_NOW) === null;
			})(),
			JSON.stringify(B5.gwdzParseCalendar(noAnchor, TZ_CN).map((x) => x.event)));

		// 引擎整轮：卡池 1 + 活动 1 = **2 次**请求（两侧 URL 不同）
		const calls = [];
		const rec = await refreshAt(GW_NOW, "gwdz", calls, null);
		check("引擎：整轮 **2 次**请求（卡池 JSON 1 + 活动日历 1，两侧 URL 不同）",
			calls.length === 2 && calls.includes(withOrigin(GW_JSON_URL)) && calls.includes(withOrigin(GW_CAL_URL)),
			"requests=" + calls.length + " " + JSON.stringify(calls));
		check("引擎外显：卡池 = 无职转生Ⅲ联动-6星3体up / 活动 = 新联动-无职转生Ⅲ联动（两侧都成功）",
			rec.banner === "无职转生Ⅲ联动-6星3体up" && rec.bannerDates === "11-15 11:00 ~ 12-02 10:59"
			&& rec.event === "新联动-无职转生Ⅲ联动" && rec.eventDates === "11-15 11:00 ~ 12-02 10:59"
			&& rec.gachaFail === null && rec.eventFail === null,
			JSON.stringify([rec.banner, rec.event, rec.gachaFail, rec.eventFail]));
		if (rec.bannerHover) assertHoverConvention("gwdz 引擎卡池悬停", rec.bannerHover);
		if (rec.eventHover) assertHoverConvention("gwdz 引擎活动悬停", rec.eventHover);
	}
}
