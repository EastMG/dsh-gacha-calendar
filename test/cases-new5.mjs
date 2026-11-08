// test/cases-new5.mjs —— 2026-11-09 新接入的 5 款（用户：「五个都接入，暂时没有数据源的就留空未配置」）
//
// ── 这一段守什么 ──
//   ① **注册项**：5 条的 id / 名称 / 图标 / tz / 颜色都在，id 全局唯一；**有源的接全、无源的留空**：
//      · `wqmt` 两侧都有（bwiki 卡池 + 官方资讯 API 活动）；
//      · `pengpeng` 只有卡池（`eventUrl` **不写**）；
//      · `wd` / `hlr` / `cytq` 两侧都不写（只注册条目）。
//   ② **无期迷途卡池**：真夹具（`test/fixtures/wqmt-bwiki`，2026-11-09 抓）逐字断言
//      池名 / 卡池类型 / 角色 / 档期文本 / 绝对时刻 + `gacha[]` 逐条 + 悬停文本。
//      ⚠️ 2026-11-09 改口径：`开服后` **不再留 null** —— 有维护公告就取窗口结束（10-27 14:00），
//      没有就退常量 14:00（11-11 那批）。于是"未来批"如实是未来（state=wait），不再假在期。
//      只有"日期/年份都定不下来"才给 null（`wqmtEndOfPoint` 的末尾分支，② 段末尾反证）。
//   ③ **无期迷途活动**：真夹具（资讯列表 + 6 条正文）逐字断言 2 条在期活动；另加锚点机制的正反两例。
//   ④ **夜幕之下卡池**：夹具在抓取那天（2026-09-10 那一批）**已经过期** ⇒ 用批内时刻断言
//      逐字值，并单独钉住"当前时刻没有在期池 ⇒ 返回 null（未公布，不是失败）"。
//   ⑤ **「未配置」路径**（③④⑤ 三款的语义，也是 `pengpeng` 的活动侧）：
//      不抓取、不抛错、不产生 fail；自检里算 `unconfigured` 而**不是** `down`；
//      面板那一格派生不出条目（⇒ 写「该来源无数据」），所以底部失败横条也不会出现。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值 —— 谁把源站墙钟按本机时区
//    解释，这里立刻红。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });

// ── 夹具（全部真抓，见各目录 response.txt.meta.json 的 capturedAt）────────────────
const B = {
	wqmtBwiki: FIX("wqmt-bwiki"),          // wiki.biligame.com/wqmt 追踪一览（325KB / 174 行）
	wqmtNews: FIX("wqmt-news-list"),       // wqmt.aisnogames.com/api/news（三个栏目各 5 条）
	pengpeng: FIX("pengpeng-bwiki")        // wiki.biligame.com/pengpeng 契约一览（18 行）
};
// 卡池抓取器只取最新 6 条正文（`WQMT_EVENT_MAX_DETAILS`）——这 6 个 id 由 `wqmtEventCandidatesOf`
// 按 publish_time 从新到旧选出，测试里也逐个列出来（少一个就会抛"没有这个 URL 的夹具"）。
const WQMT_DETAILS = ["2120", "2119", "2121", "2118", "2117", "2099"];

function pickBody(url) {
	const u = String(url);
	if (/wiki\.biligame\.com\/wqmt\/api\.php/.test(u)) return B.wqmtBwiki;
	if (/wiki\.biligame\.com\/pengpeng\/api\.php/.test(u)) return B.pengpeng;
	const m = /wqmt\.aisnogames\.com\/api\/news\/(\d+)$/.exec(u);
	if (m) {
		if (!WQMT_DETAILS.includes(m[1])) throw new Error("没有这个公告正文的夹具：" + u);
		return FIX("wqmt-news-" + m[1]);
	}
	if (/wqmt\.aisnogames\.com\/api\/news$/.test(u)) return B.wqmtNews;
	throw new Error("新接入 5 款的用例没有这个 URL 的夹具：" + u);
}

// 记账 transport：`calls` = 实际发出去的地址（用来证明"未配置"的条目一个请求都不发）
function makeTransport(sink) {
	const rec = (u) => { if (sink) sink.push(String(u)); };
	return {
		async fetchRaw(url) {
			rec(url);
			const body = pickBody(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url) { rec(url); return pickBody(url); }
	};
}
const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
const engineAt = (now, seed, sink) => createEngine({
	transport: makeTransport(sink),
	storage: makeStore(seed),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});

// 夹具抓取时刻（2026-11-09 04:23 +08）：卡池表里在期的是 10-27 与 11-11 两批
const NOW = Date.parse("2026-11-09T04:23:18+08:00");
// 夜幕之下夹具里"最新一批"所在的时刻（2026-09-15 12:00 +08）
const NOW_PP = Date.parse("2026-09-15T12:00:00+08:00");

const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;

export default async function run() {
	// ─────────────────────① 注册项：5 条都在、字段齐全、id 唯一 ─────────────────────
	section("新接入 5 款 ①：注册项（id / 名称 / 图标 / tz / 颜色）+ 来源状态（有源接全 · 无源留空）");
	{
		const WANT = [
			["wqmt", "无期迷途"],
			["pengpeng", "夜幕之下"],
			["wd", "未定事件簿"],
			["hlr", "时空中的绘旅人"],
			["cytq", "炽焰天穹"]
		];
		const ids = T.SOURCES.map((s) => s.id);
		check("5 款都注册进了 SOURCES", WANT.every(([id]) => ids.includes(id)),
			WANT.map(([id]) => id + "=" + ids.includes(id)).join(","));
		check("SOURCES 里 id 全局唯一（新增 5 条没造成重复）", new Set(ids).size === ids.length,
			ids.length + " / " + new Set(ids).size);
		check("来源总数 = 33（28 + 本批 5）", T.SOURCES.length === 33, String(T.SOURCES.length));

		for (const [id, name] of WANT) {
			const s = srcOf(id);
			check(`${id} 名称 = ${name}`, !!s && s.name === name, s ? s.name : "缺失");
			check(`${id} tz = Asia/Shanghai（源站墙钟推定见各文件头）`, !!s && s.tz === TZ_CN, s ? String(s.tz) : "缺失");
			check(`${id} 有图标（http(s) 地址）`, !!s && /^https?:\/\//.test(String(s.icon)), s ? String(s.icon).slice(0, 60) : "缺失");
			// 颜色：本批 5 条在 20-source-core.js 的 SOURCE_COLORS 里各给了一个中间调
			check(`${id} 有游戏主题色（#rrggbb）`, !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s ? String(s.color) : "缺失");
			check(`${id} 出厂不隐藏（面板上占一行）`, !!s && s.defaultHidden === false, s ? String(s.defaultHidden) : "缺失");
		}

		// 有源接全 / 无源留空 —— 这一批的**核心口径**
		const wqmt = srcOf("wqmt");
		check("wqmt 卡池源已接（url + source 标签）",
			!!wqmt && /^https:\/\/wiki\.biligame\.com\/wqmt\/api\.php/.test(wqmt.url) && wqmt.source === "Bwiki",
			wqmt ? String(wqmt.url) : "缺失");
		check("wqmt 活动源已接（url + eventSource 标签）",
			!!wqmt && /^https:\/\/wqmt\.aisnogames\.com\/api\/news$/.test(wqmt.eventUrl) && wqmt.eventSource === "官方公告",
			wqmt ? String(wqmt.eventUrl) : "缺失");

		const pp = srcOf("pengpeng");
		check("pengpeng 卡池源已接（bwiki 契约一览）",
			!!pp && /^https:\/\/wiki\.biligame\.com\/pengpeng\/api\.php/.test(pp.url) && pp.source === "Bwiki",
			pp ? String(pp.url) : "缺失");
		check("pengpeng 活动侧**留空**（eventUrl 缺失 / 空串 —— 没有可用源就不假装有）",
			!!pp && !pp.eventUrl, pp ? JSON.stringify(pp.eventUrl) : "缺失");

		for (const id of ["wd", "hlr", "cytq"]) {
			const s = srcOf(id);
			check(`${id} 两侧来源都**留空未配置**（不写 url / eventUrl）`,
				!!s && !s.url && !s.eventUrl, s ? JSON.stringify({ url: s.url, eventUrl: s.eventUrl }) : "缺失");
			check(`${id} 没有挂任何抓取器（GACHA_FETCHERS / EVENT_FETCHERS 里查不到）`,
				typeof T.GACHA_FETCHERS[id] !== "function" && !T.EVENT_FETCHERS[id]);
		}

		// 设置页「卡池来源 / 活动来源」下拉对未配置的那一侧显示裸「未配置」（2026-10-03 用户要求去掉括号注释）
		for (const id of ["wd", "hlr", "cytq"]) {
			const s = srcOf(id);
			check(`${id} 设置页两侧都写「未配置」`,
				T.getDefaultSourceName(s, "url") === "未配置" && T.getDefaultSourceName(s, "eventUrl") === "未配置",
				JSON.stringify([T.getDefaultSourceName(s, "url"), T.getDefaultSourceName(s, "eventUrl")]));
		}
		check("pengpeng 设置页：卡池侧写「Bwiki」、活动侧写「未配置」",
			T.getDefaultSourceName(pp, "url") === "Bwiki" && T.getDefaultSourceName(pp, "eventUrl") === "未配置",
			JSON.stringify([T.getDefaultSourceName(pp, "url"), T.getDefaultSourceName(pp, "eventUrl")]));
	}

	// ─────────────────────② 无期迷途 卡池（真夹具 · 逐字）─────────────────────
	section("新接入 5 款 ②：无期迷途卡池（bwiki 追踪一览 → 池名 / 类型 / 起止 / 概率提升角色）");
	let wqmtGacha = null;
	{
		const e = engineAt(NOW);
		const s = e.__test.SOURCES.find((x) => x.id === "wqmt");
		wqmtGacha = await e.__test.GACHA_FETCHERS["wqmt"](s.url, undefined, s.tz);
		check("wqmt 卡池抓取器返回对象（真夹具 174 行里取在期）", !!wqmtGacha && typeof wqmtGacha === "object");

		// 外显 = 结束最早的那批（11-11 09:59:59 关的两口联动池：绛夜流光 + 真夜猫影）
		check("wqmt 外显池名 = 绛夜流光（结束最早那批）", wqmtGacha.banner === "绛夜流光", JSON.stringify(wqmtGacha.banner));
		check("wqmt 角色 = 同批（同结束时刻）两池合并、按源站顺序去重",
			wqmtGacha.roles === "来生泪、来生爱、普希拉、泰特拉、来生瞳", JSON.stringify(wqmtGacha.roles));
		// ⚠️ 2026-11-09 改：`开服后` 不再留 null —— 钟点锚定（维护公告窗口结束 / 常量 14:00）
		check("wqmt 档期文本 = 「10-27 14:00 ~ 11-11 09:59」（`开服后` 锚到维护窗口结束 14:00）",
			wqmtGacha.bannerDates === "10-27 14:00 ~ 11-11 09:59", JSON.stringify(wqmtGacha.bannerDates));
		check("wqmt startTs = 2026-10-27 14:00 +08（UTC 06:00；**不再**是 null）",
			wqmtGacha.startTs === Date.UTC(2026, 9, 27, 6, 0), String(wqmtGacha.startTs));
		// 绝对时刻：2026-11-11 09:59 +08 == 2026-11-11T01:59Z（手算，不用 sourceInstant 自证）
		check("wqmt endTs = 2026-11-11 09:59 +08（UTC 01:59）",
			wqmtGacha.endTs === Date.UTC(2026, 10, 11, 1, 59), String(wqmtGacha.endTs));

		// gacha[] 逐条（主条 + 2 口并列池）。**11-11 那 4 口池是未来批**（11-11 14:00 才开），
		// 按 2026-11-09 的口径「起点未知/未到 ≠ 已开始」⇒ 不进在期外显，也不进数组的在期条目。
		const g = wqmtGacha.gacha;
		check("wqmt gacha[] 共 3 条（1 主条 + 2 口在期并列池；11-11 那批是未来 ⇒ 不冒充在期）",
			Array.isArray(g) && g.length === 3, String(g && g.length));
		check("wqmt gacha[] 标题逐条（池名：角色）", g.map((x) => x.title).join(" | ")
			=== "绛夜流光 | 绛夜流光：来生泪、来生爱、普希拉、泰特拉 | 真夜猫影：来生瞳、来生爱、普希拉、泰特拉",
			g.map((x) => x.title).join(" | "));
		check("wqmt gacha[] 的 source 依次 = primary + hover×2",
			g.map((x) => x.source).join(",") === "primary,hover,hover",
			g.map((x) => x.source).join(","));
		check("wqmt gacha[] 的 key 是 wqmt:gacha:0..2",
			g.map((x) => x.key).join(",") === "wqmt:gacha:0,wqmt:gacha:1,wqmt:gacha:2",
			g.map((x) => x.key).join(","));
		check("wqmt gacha[] 全部带 tz = Asia/Shanghai（数组条目自带源站时区）",
			g.every((x) => x.tz === TZ_CN), JSON.stringify([...new Set(g.map((x) => x.tz))]));
		check("wqmt gacha[] 的档期原文逐条 = `MM-DD HH:MM ~ MM-DD HH:MM`（起点已锚定）",
			g.map((x) => x.raw).join(" | ")
			=== "10-27 14:00 ~ 11-11 09:59 | 10-27 14:00 ~ 11-11 09:59 | 10-27 14:00 ~ 11-11 09:59",
			g.map((x) => x.raw).join(" | "));
		// category = 卡池类型（`itemFacts` 通道贴上去的；主条与并列条都要有）
		check("wqmt gacha[] 的 category 逐条 = 源站加粗那行的卡池类型",
			g.map((x) => x.category).join(",") === "复刻·联动追踪,复刻·联动追踪,复刻·联动追踪",
			g.map((x) => x.category).join(","));
		check("wqmt gacha[] 的 ts 与源站墙钟一一对应（在期批 = 10-27 14:00 ~ 11-11 09:59）",
			g.every((x) => x.startTs === Date.UTC(2026, 9, 27, 6, 0) && x.endTs === Date.UTC(2026, 10, 11, 1, 59)),
			JSON.stringify([...new Set(g.map((x) => [x.startTs, x.endTs]))]));

		// 悬停（由同一份条目反生成）
		const HOVER = "绛夜流光：来生泪、来生爱、普希拉、泰特拉\n真夜猫影：来生瞳、来生爱、普希拉、泰特拉\n"
			+ "10-27 14:00 ~ 11-11 09:59";
		check("wqmt 悬停文本逐字（2 口池同窗 ⇒ 名称在前、窗口末尾只写一遍）",
			wqmtGacha.bannerHover === HOVER, JSON.stringify(wqmtGacha.bannerHover));
		check("wqmt 悬停与 gachaHoverItems 同源（条数 = 2）",
			Array.isArray(wqmtGacha.gachaHoverItems) && wqmtGacha.gachaHoverItems.length === 2,
			String(wqmtGacha.gachaHoverItems && wqmtGacha.gachaHoverItems.length));
		check("wqmt 悬停 == hoverTextFromItems(同一份条目)（生成器唯一实现）",
			T.hoverTextFromItems(wqmtGacha.gachaHoverItems, "gacha", TZ_CN) === wqmtGacha.bannerHover);
		assertHoverConvention("wqmt 卡池", wqmtGacha.bannerHover, { requireSet: true });

		// ── 锚点来源（真夹具：资讯列表 + 10-27 维护公告正文）──
		// ① 10-27 那批：维护公告 `维护时间：10月27日10:00-14:00` ⇒ 开服 = 窗口结束（14:00）；
		// ② 11-11 那批：公告里**没有** 11-11 的维护公告 ⇒ 退常量 14:00（同一个值，来源不同）。
		const PA = T.parsers.wqmt;
		const anchors = await PA.wqmtGachaAnchorsOf(undefined, TZ_CN);
		check("wqmt 卡池锚点：从真夹具的维护公告解出 10-27 14:00（窗口结束）",
			anchors["10-27"] === Date.UTC(2026, 9, 27, 6, 0), JSON.stringify(anchors));
		const rowsOf = PA.wqmtPoolsOf(await (async () => {
			const raw = FIX("wqmt-bwiki");
			return JSON.parse(raw).parse.text;
		})(), TZ_CN, anchors);
		const batch1027 = rowsOf.filter((r) => r.endTs === Date.UTC(2026, 10, 11, 1, 59));
		const batch1111 = rowsOf.filter((r) => r.endTs === Date.UTC(2026, 11, 9, 1, 59));
		check("wqmt 真夹具：10-27 那批 2 口的 startTs = 10-27 14:00（用锚点）",
			batch1027.length === 2 && batch1027.every((r) => r.startTs === Date.UTC(2026, 9, 27, 6, 0)),
			JSON.stringify(batch1027.map((r) => [r.banner, r.startTs])));
		check("wqmt 真夹具：11-11 那批 4 口的 startTs = 11-11 14:00（无锚点 ⇒ 退常量，仍不是 null）",
			batch1111.length === 4 && batch1111.every((r) => r.startTs === Date.UTC(2026, 10, 11, 6, 0)),
			JSON.stringify(batch1111.map((r) => [r.banner, r.startTs])));
		check("wqmt 常量锚点 = 14:00（官方维护窗口 10:00-14:00 的结束）", PA.WQMT_OPEN_FALLBACK_HOUR === 14,
			String(PA.WQMT_OPEN_FALLBACK_HOUR));
		// 「日期/年份都定不下来」的那一端仍必须给 null（不编时刻）
		check("wqmt 反证：连年份都定不下来 ⇒ 整条窗口不产出（不猜年份）",
			PA.wqmtWindowOf("11月11日 开服后 ~ 12月09日 07:59", TZ_CN, {}, null) === null);
		check("wqmt 反证：起点那一端连日期都定不下来 ⇒ ts = null、文本保留「开服后」（不编 14:00）",
			PA.wqmtEndOfPoint({ y: null, mo: 11, d: 11, h: null, mi: null, open: true }, TZ_CN, 0, 0, {}, true, PA.WQMT_OPEN_FALLBACK_HOUR).ts === null,
			JSON.stringify(PA.wqmtEndOfPoint({ y: null, mo: 11, d: 11, h: null, mi: null, open: true }, TZ_CN, 0, 0, {}, true, PA.WQMT_OPEN_FALLBACK_HOUR)));

		// 池名拆分规则：右侧角色全部能在「概率提升」列里找到才拆；对不上就整串当池名
		const P = T.parsers.wqmt;
		check("wqmt 池名拆分：`隐秘深渊-格芮芙、渡鸦` + 角色列含两人 ⇒ 拆开",
			P.wqmtPoolNameOf("隐秘深渊-格芮芙、渡鸦", "格芮芙、渡鸦、阿黛拉") === "隐秘深渊",
			P.wqmtPoolNameOf("隐秘深渊-格芮芙、渡鸦", "格芮芙、渡鸦、阿黛拉"));
		check("wqmt 池名拆分（反证）：右侧有人不在角色列 ⇒ 整串当池名，不猜",
			P.wqmtPoolNameOf("极限挑战-启示录", "某角色") === "极限挑战-启示录",
			P.wqmtPoolNameOf("极限挑战-启示录", "某角色"));
	}

	// ─────────────────────③ 无期迷途 活动（真夹具 + 锚点机制正反例）─────────────────────
	section("新接入 5 款 ③：无期迷途活动（官方资讯 API → 活动名 / 起止；「开服后」走维护公告锚点）");
	{
		const e = engineAt(NOW);
		const s = e.__test.SOURCES.find((x) => x.id === "wqmt");
		const ev = await e.__test.EVENT_FETCHERS["wqmt"].default(s.eventUrl, undefined, s.tz);
		check("wqmt 活动抓取器返回对象", !!ev && typeof ev === "object");

		// 2 条：数据间隙·时序11（11-05~12-03，结束最早） / 破碎防线第35期。
		// ⚠️「恩慈余光」原本也在（`11-11 开服后 ~ 12-09 07:59` 起点为 null ⇒ 被当成已开始）；
		//    2026-11-09 起 `开服后` 锚到 11-11 14:00（未来）⇒ 它是**未开始**，不进在期外显/数组。
		check("wqmt 外显活动 = 数据间隙·时序11上半赛季（同档位里结束最早）",
			ev.event === "数据间隙·时序11上半赛季", JSON.stringify(ev.event));
		check("wqmt 活动档期 = 「11-05 11:00 ~ 12-03 04:59」",
			ev.eventDates === "11-05 11:00 ~ 12-03 04:59", JSON.stringify(ev.eventDates));
		const E = ev.events || [];
		check("wqmt events[] 共 2 条（11-11 才开的「恩慈余光」是未来 ⇒ 不冒充在期）", E.length === 2, String(E.length));
		check("wqmt events[] 标题逐条",
			E.map((x) => x.title).join(" | ") === "数据间隙·时序11上半赛季 | 破碎防线·暗域第35期",
			E.map((x) => x.title).join(" | "));
		check("wqmt events[] 档期原文逐条",
			E.map((x) => x.raw).join(" | ") === "11-05 11:00 ~ 12-03 04:59 | 11-02 05:00 ~ 12-14 04:00",
			E.map((x) => x.raw).join(" | "));
		check("wqmt events[] 绝对时刻逐条（+08 手算成 UTC）",
			E[0].startTs === Date.UTC(2026, 10, 5, 3, 0) && E[0].endTs === Date.UTC(2026, 11, 2, 20, 59)
			&& E[1].startTs === Date.UTC(2026, 10, 1, 21, 0) && E[1].endTs === Date.UTC(2026, 11, 13, 20, 0),
			JSON.stringify(E.map((x) => [x.startTs, x.endTs])));
		check("wqmt 活动侧**不写** category / tags（源站只有公告体裁，没有活动类型）",
			E.every((x) => !("category" in x) && !("tags" in x)),
			JSON.stringify(E.map((x) => x.category)));
		check("wqmt 活动悬停逐字（2 行「名称 + 3 空格 + 档期」）",
			ev.eventHover === "数据间隙·时序11上半赛季   11-05 11:00 ~ 12-03 04:59\n"
			+ "破碎防线·暗域第35期   11-02 05:00 ~ 12-14 04:00",
			JSON.stringify(ev.eventHover));
		check("wqmt 活动悬停 == hoverTextFromItems(同一份条目)",
			T.hoverTextFromItems(ev.eventHoverItems, "event", TZ_CN) === ev.eventHover);
		assertHoverConvention("wqmt 活动", ev.eventHover, { requireSet: true });

		// ── 锚点机制（纯函数，正反两例）──
		// 正例：同一份正文里既有「维护时间：11月11日10:00-14:00」又有「活动时间：11月11日 开服后~12月09日 07:59」
		//       ⇒ 锚点 = 维护窗口**结束**（14:00）⇒ startTs 有值、档期文本变成正常两端时刻。
		const P = T.parsers.wqmt;
		const HINT = { y: 2026, mo: 11 };
		const BODY_ANCHOR = "维护时间：11月11日10:00-14:00\n■活动时间：11月11日 开服后~12月09日 07:59";
		const bodiesA = [{ id: 1, at: Date.parse("2026-11-09T04:00:00Z"), text: BODY_ANCHOR }];
		const anchorsA = P.wqmtMaintAnchorsOf(bodiesA, TZ_CN);
		check("wqmt 锚点：从 `维护时间：11月11日10:00-14:00` 读出开服时刻 = 14:00（维护窗口结束）",
			anchorsA["11-11"] === Date.UTC(2026, 10, 11, 6, 0), String(anchorsA["11-11"]));
		const winA = P.wqmtEventWindowsOf(BODY_ANCHOR, "【预告】丨「恩慈余光」", HINT, TZ_CN, anchorsA);
		check("wqmt 锚点·正例：有锚点 ⇒ 起点写成 11-11 14:00、startTs 不再是 null",
			winA.length === 1 && winA[0].startTs === Date.UTC(2026, 10, 11, 6, 0) && winA[0].raw === "11-11 14:00 ~ 12-09 07:59",
			JSON.stringify(winA.map((x) => [x.raw, x.startTs])));
		// 反例（2026-11-09 改）：同一份正文、**没有**维护公告 ⇒ 退常量 14:00（不再留 null）。
		// 口径依据 = 用户拍板「取不到窗口就退常量 14:00」；`null` 只剩"日期/年份都定不下来"那一种。
		const winB = P.wqmtEventWindowsOf("■活动时间：11月11日 开服后~12月09日 07:59", "【预告】丨「恩慈余光」", HINT, TZ_CN, {});
		check("wqmt 锚点·反例：没有维护公告 ⇒ 退常量 11-11 14:00（不再是 null）",
			winB.length === 1 && winB[0].startTs === Date.UTC(2026, 10, 11, 6, 0) && winB[0].raw === "11-11 14:00 ~ 12-09 07:59",
			JSON.stringify(winB.map((x) => [x.raw, x.startTs])));
		// 三态之三：连年份线索都没有 ⇒ 整条窗口不产出（不猜年份）。
		// "日期读不出 ⇒ startTs 为 null" 那条规则由 ② 段末尾的两条反证兜底（同一套 `wqmtWindowOf`
		// / `wqmtEndOfPoint`），这里不重复。

		// 正文解析的两条口径：① 只认两端都带 HH:MM 的「…」区间；② 公告标题 → 取「」里的名字
		check("wqmt 活动名：`【预告】丨MBCC特别庆典·「恩慈余光」…开启` → 恩慈余光",
			P.wqmtEventNameOf("【预告】丨MBCC特别庆典·「恩慈余光」全新主线11月11日开启") === "恩慈余光",
			P.wqmtEventNameOf("【预告】丨MBCC特别庆典·「恩慈余光」全新主线11月11日开启"));
		check("wqmt 活动名（无引号时退回整句）：生日会标题不再带 `【…】丨` 体裁前缀",
			P.wqmtEventNameOf("【公告】丨10月27日停服维护更新公告") === "10月27日停服维护更新公告",
			P.wqmtEventNameOf("【公告】丨10月27日停服维护更新公告"));
		check("wqmt 区间·反证：只写「将于X月X日结束」的句子**不算**区间（不会拼出假档期）",
			P.wqmtEventWindowsOf("■「无瑕之胚-极限挑战」将于09月15日限时开启，通过对BOSS造成伤害获得奖励", "t", HINT, TZ_CN, {}).length === 0,
			String(P.wqmtEventWindowsOf("■「无瑕之胚-极限挑战」将于09月15日限时开启，通过对BOSS造成伤害获得奖励", "t", HINT, TZ_CN, {}).length));
	}

	// ─────────────────────④ 夜幕之下 卡池（真夹具 · 两个时刻）─────────────────────
	section("新接入 5 款 ④：夜幕之下卡池（bwiki 契约一览；活动侧未配置）");
	{
		// (a) 夹具最新一批在期（2026-09-15）：逐字断言
		const e = engineAt(NOW_PP);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const g = await e.__test.GACHA_FETCHERS["pengpeng"](s.url, undefined, s.tz);
		check("pengpeng 有当期 ⇒ 返回对象", !!g && typeof g === "object");
		check("pengpeng 外显契约 = 天才不必孑立（结束最早的那批）", g.banner === "天才不必孑立", JSON.stringify(g.banner));
		check("pengpeng 角色 = 科技部长", g.roles === "科技部长", JSON.stringify(g.roles));
		check("pengpeng 档期 = 「09-10 05:00 ~ 09-24 04:59」", g.bannerDates === "09-10 05:00 ~ 09-24 04:59", JSON.stringify(g.bannerDates));
		check("pengpeng startTs = 2026-09-10 05:00 +08（UTC 09-09 21:00）",
			g.startTs === Date.UTC(2026, 8, 9, 21, 0), String(g.startTs));
		check("pengpeng endTs = 2026-09-24 04:59 +08（UTC 09-23 20:59）",
			g.endTs === Date.UTC(2026, 8, 23, 20, 59), String(g.endTs));
		check("pengpeng gacha[] 共 2 条（1 主条 + 1 并列）", g.gacha.length === 2, String(g.gacha.length));
		check("pengpeng gacha[] 标题 / 类型 / 时刻逐条",
			g.gacha.map((x) => x.title).join(" | ") === "天才不必孑立 | 隐秘的归属：杯中藏锋"
			&& g.gacha.map((x) => x.category).join(",") === "遴选,活动"
			&& g.gacha[1].endTs === Date.UTC(2026, 8, 30, 20, 59),
			JSON.stringify(g.gacha.map((x) => [x.title, x.category, x.endTs])));
		check("pengpeng 悬停逐字（2 行「契约：角色 ⏎ 档期」）",
			g.bannerHover === "天才不必孑立：科技部长\n09-10 05:00 ~ 09-24 04:59\n隐秘的归属：杯中藏锋\n09-10 05:00 ~ 10-01 04:59",
			JSON.stringify(g.bannerHover));
		assertHoverConvention("pengpeng 卡池", g.bannerHover, { requireSet: true });
		check("pengpeng 长期池（写「长期」，读不出窗口）如实跳过：events/gacha 里没有「夜色的呼唤」",
			!g.gacha.some((x) => /夜色的呼唤|起始的契约/.test(x.title)), JSON.stringify(g.gacha.map((x) => x.title)));

		// (b) 抓取那天（2026-11-09）**没有在期池** ⇒ null = 未公布，不是失败
		const e2 = engineAt(NOW);
		const s2 = e2.__test.SOURCES.find((x) => x.id === "pengpeng");
		let nullOk = false, err = "";
		let got = null;
		try { got = await e2.__test.GACHA_FETCHERS["pengpeng"](s2.url, undefined, s2.tz); }
		catch (e3) { err = String(e3 && e3.message || e3); }
		nullOk = got === null && err === "";
		check("pengpeng 当前时刻没有在期池 ⇒ 返回 null（「未公布」，不抛错 = 不记失败）", nullOk, err || JSON.stringify(got));

		// (c) 表结构变了 ⇒ 抛错（改版要看得见，不能静默成「未公布」）
		const e3 = createEngine({
			transport: { async fetchRaw() { return { ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>改版了</html>", json: async () => ({ parse: { text: "<html>改版了</html>" } }) }; }, async fetchViaProxy() { return JSON.stringify({ parse: { text: "<html>改版了</html>" } }); } },
			storage: makeStore(), now: () => NOW_PP, timer: { setTimeout, clearTimeout }
		});
		let bad = "";
		try { await e3.__test.GACHA_FETCHERS["pengpeng"]("https://wiki.biligame.com/pengpeng/api.php?x=1", undefined, TZ_CN); }
		catch (e4) { bad = String(e4 && e4.message || e4); }
		check("pengpeng 表结构异常 ⇒ 抛 pengpeng-no-table（抓取失败 ≠ 未公布）", bad === "pengpeng-no-table", bad);
	}

	// ─────────────────────⑤「未配置」路径（wd / hlr / cytq + pengpeng 活动侧）─────────────────────
	section("新接入 5 款 ⑤：「未配置」路径 —— 不抓取、不抛错、不产生 fail（自检算 unconfigured）");
	{
		const IDS = ["wd", "hlr", "cytq"];
		// (a) fetchEntry：两侧都没地址 ⇒ 直接 skipped（连 net 都不碰）
		const e = engineAt(NOW);
		for (const id of IDS) {
			const s = e.__test.SOURCES.find((x) => x.id === id);
			const r = await e.__test.fetchEntry(s, undefined);
			check(`${id} fetchEntry ⇒ { ok:true, reason:"skipped" }（跳过，不记成功也不记失败）`,
				r && r.ok === true && r.reason === "skipped", JSON.stringify(r));
		}

		// (b) 自检：只看这 4 条（3 条未配置 + pengpeng）⇒ down = 0、unconfigured = 7、ok = 1
		const ALL = T.SOURCES.map((x) => x.id);
		const KEEP = new Set([...IDS, "pengpeng"]);
		const calls = [];
		const e2 = engineAt(NOW_PP, { hidden: ALL.filter((x) => !KEEP.has(x)) }, calls);
		const rep = await e2.selfCheck({ timeoutMs: 5000 });
		const g = rep.games || {};
		for (const id of IDS) {
			check(`${id} 自检：卡池侧 state = unconfigured / text = 未配置来源`,
				g[id] && g[id].gacha.state === "unconfigured" && g[id].gacha.text === "未配置来源",
				JSON.stringify(g[id] && g[id].gacha));
			check(`${id} 自检：活动侧 state = unconfigured / text = 未配置来源`,
				g[id] && g[id].event.state === "unconfigured" && g[id].event.text === "未配置来源",
				JSON.stringify(g[id] && g[id].event));
		}
		check("pengpeng 自检：卡池侧 ok（真夹具）、活动侧 unconfigured（未配置 ≠ 失败）",
			g.pengpeng && g.pengpeng.gacha.state === "ok" && g.pengpeng.event.state === "unconfigured",
			JSON.stringify(g.pengpeng));
		check("自检汇总：失败 = 0（未配置**不**混进失败数字）", rep.summary.down === 0, JSON.stringify(rep.summary));
		check("自检汇总：未配置 = 7（3 款 × 2 侧 + pengpeng 活动侧）", rep.summary.unconfigured === 7, JSON.stringify(rep.summary));
		check("自检汇总：ok = 1（只有 pengpeng 卡池侧真的解析出内容）", rep.summary.ok === 1, JSON.stringify(rep.summary));
		check("自检期间**只**请求了 pengpeng 的 bwiki（未配置的 3 条一个请求都没发）",
			calls.length === 1 && /wiki\.biligame\.com\/pengpeng/.test(calls[0]), JSON.stringify(calls));

		// (c) 面板那一格：派生不出条目 ⇒ 写「该来源无数据」（灰底），因此**没有**失败横条
		//     （82-schedule-view.js 的横条判据是 isDown(gachaFail|eventFail)，这里两者都是 null）
		const rec = { id: "wd", name: "未定事件簿", tz: TZ_CN, gacha: [], events: [], gachaFail: null, eventFail: null };
		check("面板：未配置条目两侧都派生不出格子（⇒「该来源无数据」，不是「抓取失败」）",
			T.scheduleCellOf(rec, "gacha", new Date(NOW)) === null && T.scheduleCellOf(rec, "event", new Date(NOW)) === null);
		check("面板：未配置条目的两侧 fail 都是 null ⇒ 底部失败横条不会出现",
			rec.gachaFail === null && rec.eventFail === null
			&& T.scheduleNormalize(rec, "gacha", new Date(NOW)) === null
			&& T.scheduleNormalize(rec, "event", new Date(NOW)) === null,
			JSON.stringify([T.scheduleNormalize(rec, "gacha", new Date(NOW)), T.scheduleNormalize(rec, "event", new Date(NOW))]));
	}
}
