// test/cases-new5.mjs —— 2026-11-09 新接入的 5 款（用户：「五个都接入，暂时没有数据源的就留空未配置」）
//
// ── 这一段守什么 ──
//   ① **注册项**：5 条的 id / 名称 / 图标 / tz / 颜色都在，id 全局唯一；**有源的接全、无源的留空**：
//      · `wqmt` 两侧都有（bwiki 卡池 + 官方资讯 API 活动）；
//      · `pengpeng` 卡池 + 活动（卡池 bwiki **SMW `action=ask`**；活动 TapTap feed JSON）；
//      · `wd` 两侧都有（米游社公告 forum_id=33，卡池 + 活动）；
//      · `hlr` 两侧都有（官网新闻列表 + 详情，卡池 + 活动）；
//      · `cytq` 两侧都不写（**本批唯一**仍然「未配置」的条目）。
//      ⚠️ 2026-11-09 晚改：`wd` / `hlr` / `pengpeng` 的活动侧是用新调研到的源接上的，
//         不再是「未配置」——本文件原先那几条「留空」断言已逐条改成「已配置」，理由见 ①/⑤。
//   ② **无期迷途卡池**：真夹具（`test/fixtures/wqmt-bwiki`，2026-11-09 抓）逐字断言
//      池名 / 卡池类型 / 角色 / 档期文本 / 绝对时刻 + `gacha[]` 逐条 + 悬停文本。
//      ⚠️ 2026-11-09 改口径：`开服后` **不再留 null** —— 有维护公告就取窗口结束（10-27 14:00），
//      没有就退常量 14:00（11-11 那批）。于是"未来批"如实是未来（state=wait），不再假在期。
//      只有"日期/年份都定不下来"才给 null（`wqmtEndOfPoint` 的末尾分支，② 段末尾反证）。
//   ③ **无期迷途活动**：真夹具（资讯列表 + 6 条正文）逐字断言 2 条在期活动；另加锚点机制的正反两例。
//   ④ **夜幕之下卡池**：夹具在抓取那天（2026-09-10 那一批）**已经过期** ⇒ 用批内时刻断言
//      逐字值，并单独钉住"当前时刻没有在期池 ⇒ 返回 null（未公布，不是失败）"。
//      （活动侧的新用例在 `test/cases-pengpeng-event.mjs`，不混在这里。）
//   ⑤ **「未配置」路径**（现在只剩 `cytq`）：不抓取、不抛错、不产生 fail；自检里算 `unconfigured`
//      而**不是** `down`；面板那一格派生不出条目（⇒ 写「该来源无数据」），所以也不会进刷新横幅的悬停明细
//      （2026-11-10 起失败信息不再单独占一条横条，已并入底栏刷新横幅的悬停）。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值 —— 谁把源站墙钟按本机时区
//    解释，这里立刻红。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";
import { readFileSync } from "node:fs";

// 直接读夹具原文（不走 transport）：给"看响应长什么样"的反证用
const fixtureBodyText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");

const TZ_CN = "Asia/Shanghai";
const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });

// ── 夹具（全部真抓，见各目录 response.txt.meta.json 的 capturedAt）────────────────
const B = {
	wqmtBwiki: FIX("wqmt-bwiki"),          // wiki.biligame.com/wqmt 追踪一览（325KB / 174 行）
	wqmtNews: FIX("wqmt-news-list"),       // wqmt.aisnogames.com/api/news（三个栏目各 5 条）
	pengpeng: FIX("pengpeng-ask"),         // wiki.biligame.com/ymzx SMW ask（11 行，9 条有窗口）
	pengpengTable: FIX("pengpeng-table")   // wiki.biligame.com/pengpeng 契约一览 HTML 表（18 行，2026-11-13 抓）
};
// 卡池抓取器只取最新 N 条正文（`WQMT_EVENT_MAX_DETAILS`；2026-11-11 起 6 → 10，见下面 ⑥）。
// ③ 段用的是 11-09 那份列表夹具（2099 恰好是第 6 条）⇒ 这 6 个 id 由 `wqmtEventCandidatesOf`
// 按 publish_time 从新到旧选出，测试里逐个列出来（少一个就会抛"没有这个 URL 的夹具"）。
const WQMT_DETAILS = ["2120", "2119", "2121", "2118", "2117", "2099"];

function pickBody(url) {
	const u = String(url);
	if (/wiki\.biligame\.com\/wqmt\/api\.php/.test(u)) return B.wqmtBwiki;
	if (/wiki\.biligame\.com\/ymzx\/api\.php\?action=ask/.test(u)) return B.pengpeng;
	// /pengpeng 的「契约一览」HTML 表（卡池备选 ②；中文页名是 percent-encoded 的）
	if (/wiki\.biligame\.com\/pengpeng\/api\.php\?action=parse&page=%E5%A5%91%E7%BA%A6%E4%B8%80%E8%A7%88/.test(u)) return B.pengpengTable;
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
// 夜幕之下 **SMW 夹具**（2026-11-11 抓）里某一期在期的时刻：07-30 那批（乘自由之风 / 轻纱下的秘密 08-13 收，
// 喧嚣止息之时 08-20 收）⇒ 2026-08-05 12:00 三条都在期。
const NOW_PP_ASK = Date.parse("2026-08-05T12:00:00+08:00");

const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;

export default async function run() {
	// ── 0）刷新横幅：不再报「跳过 k 个」，未配置那一侧写明原因 ──
	// 用户 2026-11-09：去掉跳过统计；未配置用与失败项同一种排版（名字 + 空格 + 项目、项目，不加【】）
	section("新接入 5 款 ①：刷新横幅汇总（不再报跳过个数 + 未配置明细）");
	{
		const sources = [
			{ id: "cfg", name: "已配置", url: "https://example.com/a", eventUrl: "https://example.com/b" },
			{ id: "half", name: "只有卡池", url: "https://example.com/c", eventUrl: "" },
			{ id: "none", name: "未配置", url: "", eventUrl: "" }
		];
		const games = sources.map((s) => ({ id: s.id, name: s.name }));
		const result = { games: { cfg: {}, half: {}, none: {} } };
		const got = T.buildScrapeInfo(games, result, sources);
		check("刷新横幅文字不再含「跳过」", !/跳过/.test(got.info), got.info);
		check("横幅文字 = 成功 3/3（未配置不计入分母也不报跳过）", got.info === "成功 3/3", got.info);
		check("两侧都没写来源 ⇒ 两项未配置同行（名字后一个空格，项目用「、」）",
			got.lines.includes("未配置 卡池未配置有效来源、活动未配置有效来源"), JSON.stringify(got.lines));
		check("只有卡池源 ⇒ 只报活动侧未配置",
			got.lines.includes("只有卡池 活动未配置有效来源"), JSON.stringify(got.lines));
		check("两侧都配了且无失败 ⇒ 不出现在明细里", !got.lines.some((l) => l.startsWith("已配置")), JSON.stringify(got.lines));
		check("不传 sources ⇒ 无未配置行且不报错", (() => {
			const r2 = T.buildScrapeInfo(games, result);
			return r2.info === "成功 3/3" && r2.lines.length === 0;
		})());
	}

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
		check("来源总数 = 59（28 + 2026-11-09 的 5 + 2026-11-11 的 uma-tw + 2026-11-14 的 pjsk-tc/pjsk-kr/fgo-jp + 2026-11-15 的 bjhl/yys/dhmmr/bh2 + wxnn + 2026-11-15 第三批的 gbf/kancolle + 2026-11-15 第四批的 longhun/nikki4/imas 4 款）", T.SOURCES.length === 59, String(T.SOURCES.length));		for (const [id, name] of WANT) {
			const s = srcOf(id);
			check(`${id} 名称 = ${name}`, !!s && s.name === name, s ? s.name : "缺失");
			check(`${id} tz = Asia/Shanghai（源站墙钟推定见各文件头）`, !!s && s.tz === TZ_CN, s ? String(s.tz) : "缺失");
			check(`${id} 有图标（http(s) 地址）`, !!s && /^https?:\/\//.test(String(s.icon)), s ? String(s.icon).slice(0, 60) : "缺失");
			// 颜色：本批 5 条在 20-source-core.js 的 SOURCE_COLORS 里各给了一个中间调
			check(`${id} 有游戏主题色（#rrggbb）`, !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s ? String(s.color) : "缺失");
			// 2026-11-14 用户拍板：**除 cytq 外全部默认展示**（本批 5 款里只剩 cytq 仍出厂隐藏）。
			// 这张 `defaultHidden` 表与提醒侧那份副本必须一致
			// （`65-remind.js` 的 REMIND_DEFAULT_HIDDEN_IDS / 宿主拿它判「展示中」，守卫见 cases-remind.mjs）。
			const wantHidden = id === "cytq";
			check(`${id} 出厂${wantHidden ? "不勾选展示" : "展示"}（defaultHidden = ${wantHidden}）`,
				!!s && s.defaultHidden === wantHidden, s ? String(s.defaultHidden) : "缺失");
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
		// 2026-11-13 用户拍板：卡池侧**默认置空**（口径同 ddlezj），两个 bwiki 源都降为手动备选。
		// 背景：/ymzx 的 SMW ask 结构最好但内容停更（最后一期止于 2026-09-10 04:59）；
		// 2026-11-13 复核发现 /pengpeng 的「契约一览」HTML 表仍活着、且比它新 1~2 期。
		const PP_ALTS = (pp && Array.isArray(pp.altSources)) ? pp.altSources : [];
		check("pengpeng 卡池默认置空：url = \"\"（不抓）且不写 source（设置页显示裸「未配置」）",
			!!pp && pp.url === "" && pp.source === void 0,
			pp ? JSON.stringify({ url: pp.url, source: pp.source }) : "缺失");
		check("pengpeng 卡池备选 = 2 条，标签逐字「Bwiki（停更）」/「Bwiki 表格（停更）」",
			PP_ALTS.length === 2
			&& PP_ALTS[0].label === "Bwiki（停更）" && PP_ALTS[1].label === "Bwiki 表格（停更）",
			JSON.stringify(PP_ALTS.map((a) => a && a.label)));
		check("pengpeng 备选 ① = /ymzx 的 SMW ask（fetcher「pengpeng-bwiki-ask」已登记在 GACHA_FETCHERS）",
			!!PP_ALTS[0] && /^https:\/\/wiki\.biligame\.com\/ymzx\/api\.php\?action=ask&/.test(String(PP_ALTS[0].url))
			&& PP_ALTS[0].fetcher === "pengpeng-bwiki-ask"
			&& typeof T.GACHA_FETCHERS["pengpeng-bwiki-ask"] === "function",
			JSON.stringify(PP_ALTS[0]));
		check("pengpeng 备选 ② = /pengpeng「契约一览」表（地址逐字 / fetcher「pengpeng-bwiki-table」已登记）",
			!!PP_ALTS[1]
			&& PP_ALTS[1].url === "https://wiki.biligame.com/pengpeng/api.php?action=parse&page=%E5%A5%91%E7%BA%A6%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2"
			&& PP_ALTS[1].url === T.parsers.pengpeng.PENGPENG_TABLE_URL
			&& PP_ALTS[1].fetcher === "pengpeng-bwiki-table"
			&& typeof T.GACHA_FETCHERS["pengpeng-bwiki-table"] === "function",
			JSON.stringify(PP_ALTS[1]));
		// 2026-11-10：活动侧默认源再换一档 —— bwiki `公告/` 停更 6 周 ⇒ TapTap tab 成默认，
		// bwiki 公告降为 eventAltSources 手动备选（标签如实写「不可靠」）。
		// 2026-11-13：`taptap.cn` 的 robots.txt `Disallow /webapi/`、`/webapiv2/` ⇒ 改抓**允许路径**的
		// tab 页（`/app/746164/topic?type=official`，SSR 里就有活动档期）；用户可见标签仍是「TapTap」。
		check("pengpeng 活动源默认 = TapTap tab 页 `app/746164/topic?type=official`（robots 允许）",
			!!pp && /^https:\/\/www\.taptap\.cn\/app\/746164\/topic\?type=official$/.test(String(pp.eventUrl))
			&& String(pp.eventUrl).indexOf("webapiv2") < 0,
			pp ? String(pp.eventUrl) : "缺失");
		check("pengpeng 活动来源标签 = 「TapTap」",
			!!pp && pp.eventSource === "TapTap", pp ? String(pp.eventSource) : "缺失");
		check("pengpeng 旧 bwiki 公告源保留为 eventAltSources（抓取器已登记 / 标签写明不可靠）",
			!!pp && (pp.eventAltSources || []).some((a) => /^https:\/\/wiki\.biligame\.com\/pengpeng\/api\.php\?action=query&generator=allpages&gapprefix=/.test(String(a.url))
				&& /不可靠/.test(String(a.label)) && typeof (T.EVENT_FETCHERS["pengpeng"] || {})[a.fetcher] === "function"),
			pp ? JSON.stringify(pp.eventAltSources) : "缺失");

		// wd / hlr：2026-11-09 晚上两端都接上（原「未配置」断言拆成两段：具体源见下面两条）
		const wd = srcOf("wd");
		check("wd 卡池源已接（米游社公告 forum_id=33）",
			!!wd && /bbs-api\.miyoushe\.com\/post\/wapi\/getForumPostList\?forum_id=33/.test(String(wd.url))
			&& wd.source === "米游社公告", wd ? String(wd.url) : "缺失");
		check("wd 活动源已接（与卡池同一个列表，按标题分流）",
			!!wd && wd.eventUrl === wd.url && wd.eventSource === "米游社公告", wd ? JSON.stringify([wd.url, wd.eventUrl]) : "缺失");
		check("wd 两个抓取器都已登记（卡池 / 活动各一）",
			typeof T.GACHA_FETCHERS["wd"] === "function" && !!(T.EVENT_FETCHERS["wd"] && T.EVENT_FETCHERS["wd"].default));

		const hlr = srcOf("hlr");
		check("hlr 卡池源已接（官网新闻列表）",
			!!hlr && hlr.url === "https://hlr.163.com/news/official/" && hlr.source === "官网新闻",
			hlr ? String(hlr.url) : "缺失");
		check("hlr 活动源已接（同一个抓取器同时抓官方通稿 + 学院公告）",
			!!hlr && hlr.eventUrl === hlr.url && hlr.eventSource === "官网新闻 + 学院公告", hlr ? JSON.stringify([hlr.url, hlr.eventUrl, hlr.eventSource]) : "缺失");
		check("hlr 两个抓取器都已登记（卡池 / 活动各一）",
			typeof T.GACHA_FETCHERS["hlr"] === "function" && !!(T.EVENT_FETCHERS["hlr"] && T.EVENT_FETCHERS["hlr"].default));

		// 2026-11-15：cytq 不再是「未配置」—— 接上官方 H5 公告（`30-game-cytq.js`，原
		// `30-game-unconfigured.js` 只剩这一条 ⇒ 文件改名）。出厂隐藏**保持不动**（用户口径）。
		const cytq = srcOf("cytq");
		const CY = T.parsers.cytq;
		check("cytq 两侧来源已接（官方 H5 公告列表，两侧同一条 URL）",
			!!cytq && cytq.url === CY.CYTQ_LIST_URL && cytq.eventUrl === CY.CYTQ_LIST_URL,
			cytq ? JSON.stringify([cytq.url, cytq.eventUrl]) : "缺失");
		check("cytq 两侧来源标签逐字 = 「官网公告」",
			!!cytq && cytq.source === "官网公告" && cytq.eventSource === "官网公告",
			cytq ? JSON.stringify([cytq.source, cytq.eventSource]) : "缺失");
		check("cytq 仍然出厂隐藏（defaultHidden = true，用户 2026-11-14 口径：只有 cytq 默认隐藏）",
			!!cytq && cytq.defaultHidden === true, cytq ? String(cytq.defaultHidden) : "缺失");
		check("cytq 两个抓取器都已登记（卡池 / 活动各一）",
			typeof T.GACHA_FETCHERS["cytq"] === "function" && !!(T.EVENT_FETCHERS["cytq"] && T.EVENT_FETCHERS["cytq"].default));

		// 设置页「卡池来源 / 活动来源」下拉：已接的写来源名，未配置的写裸「未配置」
		check("wd / hlr 设置页两侧都写各自的来源名",
			T.getDefaultSourceName(wd, "url") === "米游社公告" && T.getDefaultSourceName(wd, "eventUrl") === "米游社公告"
			&& T.getDefaultSourceName(hlr, "url") === "官网新闻" && T.getDefaultSourceName(hlr, "eventUrl") === "官网新闻 + 学院公告",
			JSON.stringify([T.getDefaultSourceName(wd, "url"), T.getDefaultSourceName(hlr, "url"), T.getDefaultSourceName(hlr, "eventUrl")]));
		check("cytq 设置页两侧都写「官网公告」",
			T.getDefaultSourceName(cytq, "url") === "官网公告" && T.getDefaultSourceName(cytq, "eventUrl") === "官网公告",
			JSON.stringify([T.getDefaultSourceName(cytq, "url"), T.getDefaultSourceName(cytq, "eventUrl")]));
		check("pengpeng 设置页：卡池侧写「未配置」、活动侧写「TapTap」",
			T.getDefaultSourceName(pp, "url") === "未配置" && T.getDefaultSourceName(pp, "eventUrl") === "TapTap",
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
		// ⚠️ 2026-11-09 新口径（raw = 源站原文 / display = 补全文本，见 30-game-bwiki-common.js 文件头）：
		// `bannerDatesRaw` 必须留着源站的「开服后」，不能是上面那串被补全过的钟点。
		check("wqmt bannerDatesRaw = 源站原文「10-27 开服后 ~ 11-11 09:59」（不被锚点补全改写）",
			wqmtGacha.bannerDatesRaw === "10-27 开服后 ~ 11-11 09:59", JSON.stringify(wqmtGacha.bannerDatesRaw));
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
		// ⚠️ 2026-11-09 改（有意变化）：**主条** raw = 源站原文（`10-27 开服后 ~ 11-11 09:59`），
		// 不再是补全后的 `14:00`（原先 bannerDates / bannerDatesRaw / 主条 raw 取同一个值）。
		// 并列条那两条的 raw 仍由 `dataArrayWindowTextOf` 从 ts **派生**（`MM-DD HH:MM ~ …`）——
		// 这是 P3 就有的口径（`50-refresh.js` 的说明）：它还要被 `dataArrayWindowOf` 反解析回 ts，
		// 换成含「开服后」的原文会让 ts 整片变 null。所以数组这里是"主条原文 / 并列条派生文本"，
		// 与悬停（全部原文）**有意不同**；本段只钉住"主条那一条原文没丢 + 并列条 ts 不变"。
		check("wqmt gacha[] 的 raw 逐条 = 主条源站原文 + 并列条派生文本",
			g.map((x) => x.raw).join(" | ")
			=== "10-27 开服后 ~ 11-11 09:59 | 10-27 14:00 ~ 11-11 09:59 | 10-27 14:00 ~ 11-11 09:59",
			g.map((x) => x.raw).join(" | "));
		// category = 卡池类型（`itemFacts` 通道贴上去的；主条与并列条都要有）
		check("wqmt gacha[] 的 category 逐条 = 源站加粗那行的卡池类型",
			g.map((x) => x.category).join(",") === "复刻·联动追踪,复刻·联动追踪,复刻·联动追踪",
			g.map((x) => x.category).join(","));
		check("wqmt gacha[] 的 ts 与源站墙钟一一对应（在期批 = 10-27 14:00 ~ 11-11 09:59）",
			g.every((x) => x.startTs === Date.UTC(2026, 9, 27, 6, 0) && x.endTs === Date.UTC(2026, 10, 11, 1, 59)),
			JSON.stringify([...new Set(g.map((x) => [x.startTs, x.endTs]))]));

		// 悬停（由同一份条目反生成）
		// ⚠️ 2026-11-09 改（有意变化）：悬停里的档期那一行现在是**源站原文**
		// `10-27 开服后 ~ 11-11 09:59`（`hoverWindowTextOf` 见 raw 含相对表述 ⇒ 印原文），
		// 不再是补全后的 `10-27 14:00 ~ …`（用户实测反馈的就是这一处）。
		const HOVER = "绛夜流光：来生泪、来生爱、普希拉、泰特拉\n真夜猫影：来生瞳、来生爱、普希拉、泰特拉\n"
			+ "10-27 开服后 ~ 11-11 09:59";
		check("wqmt 悬停文本逐字（2 口池同窗 ⇒ 名称在前、窗口末尾只写一遍；窗口 = 源站原文）",
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

		// ── 验收（用户 2026-11-09 原话口径）：11-11 那批在期时的三段文本 ────────────────
		// 真夹具 + 时刻挪到 11-11 批在期（2026-11-20 12:00 +08；10-27 批已结束、更远的批还没开）：
		//   `bannerDates`    = `11-11 14:00 ~ 12-09 09:59`  ← display（补全：无锚点 ⇒ 常量 14:00）
		//   `bannerDatesRaw` = `11-11 开服后 ~ 12-09 09:59` ← raw（源站原文，`开服后` 留着）
		//   悬停里那一行     = `11-11 开服后 ~ 12-09 09:59` ← raw（同一份条目反生成）
		// 三段**必须不是同一个串**：这正是"原文 vs 补全"拆成两个字段的验收点。
		const NOW_1111 = Date.parse("2026-11-20T12:00:00+08:00");
		const e1111 = engineAt(NOW_1111);
		const s1111 = e1111.__test.SOURCES.find((x) => x.id === "wqmt");
		const pay1111 = await e1111.__test.GACHA_FETCHERS["wqmt"](s1111.url, undefined, s1111.tz);
		check("wqmt·11-11 批在期：bannerDates = 补全文本「11-11 14:00 ~ 12-09 09:59」",
			!!pay1111 && pay1111.bannerDates === "11-11 14:00 ~ 12-09 09:59", JSON.stringify(pay1111 && pay1111.bannerDates));
		check("wqmt·11-11 批在期：bannerDatesRaw = 源站原文「11-11 开服后 ~ 12-09 09:59」",
			!!pay1111 && pay1111.bannerDatesRaw === "11-11 开服后 ~ 12-09 09:59", JSON.stringify(pay1111 && pay1111.bannerDatesRaw));
		check("wqmt·11-11 批在期：悬停里那一行 = 源站原文（看得见「开服后」）",
			!!pay1111 && String(pay1111.bannerHover || "").split("\n").includes("11-11 开服后 ~ 12-09 09:59"),
			JSON.stringify(pay1111 && pay1111.bannerHover));
		check("wqmt·11-11 批在期：startTs/endTs 与改前逐字相同（11-11 14:00 / 12-09 09:59 的绝对时刻）",
			!!pay1111 && pay1111.startTs === Date.UTC(2026, 10, 11, 6, 0) && pay1111.endTs === Date.UTC(2026, 11, 9, 1, 59),
			JSON.stringify(pay1111 && [pay1111.startTs, pay1111.endTs]));
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
		// ⚠️ 2026-11-09 改（有意变化）：窗口对象现在给**两份文本** ——
		//   `display` = 补全后的可读文本（锚点 14:00 写在这里）、`raw` = 源站原文（「开服后」留着）。
		// 这条断言同时钉住"锚点确实补进了 display"与"原文没有被补全顶掉"。
		check("wqmt 锚点·正例：有锚点 ⇒ display 写成 11-11 14:00、startTs 不再是 null；raw 仍是原文「开服后」",
			winA.length === 1 && winA[0].startTs === Date.UTC(2026, 10, 11, 6, 0)
			&& winA[0].display === "11-11 14:00 ~ 12-09 07:59" && winA[0].raw === "11-11 开服后 ~ 12-09 07:59",
			JSON.stringify(winA.map((x) => [x.display, x.raw, x.startTs])));
		// 反例（2026-11-09 改）：同一份正文、**没有**维护公告 ⇒ 退常量 14:00（不再留 null）。
		// 口径依据 = 用户拍板「取不到窗口就退常量 14:00」；`null` 只剩"日期/年份都定不下来"那一种。
		const winB = P.wqmtEventWindowsOf("■活动时间：11月11日 开服后~12月09日 07:59", "【预告】丨「恩慈余光」", HINT, TZ_CN, {});
		check("wqmt 锚点·反例：没有维护公告 ⇒ 退常量 11-11 14:00（display 有钟点、raw 仍是『开服后』）",
			winB.length === 1 && winB[0].startTs === Date.UTC(2026, 10, 11, 6, 0)
			&& winB[0].display === "11-11 14:00 ~ 12-09 07:59" && winB[0].raw === "11-11 开服后 ~ 12-09 07:59",
			JSON.stringify(winB.map((x) => [x.display, x.raw, x.startTs])));
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

	// ─────────────────────④ 夜幕之下 卡池（真夹具 · 两个备选源）─────────────────────
	section("新接入 5 款 ④：夜幕之下卡池（默认置空；备选 ① SMW ask / 备选 ② /pengpeng 表格；活动侧见 cases-pengpeng-event）");
	{
		// (a) 备选 ①（原默认源）：历史某一期在期（2026-08-05 12:00 +08）逐字断言
		//     夹具 = `pengpeng-ask`（2026-11-11 抓的 SMW 结果，11 行；9 条有结束时间）
		const e = engineAt(NOW_PP_ASK);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const ASK_ALT = (s.altSources || []).find((a) => a.fetcher === "pengpeng-bwiki-ask");
		const g = await e.__test.GACHA_FETCHERS["pengpeng-bwiki-ask"](ASK_ALT.url, undefined, s.tz);
		check("pengpeng 有当期 ⇒ 返回对象", !!g && typeof g === "object");
		check("pengpeng 外显契约 = 乘自由之风（07-30 那批里结束最早的）", g.banner === "乘自由之风", JSON.stringify(g.banner));
		check("pengpeng 角色 = 推荐风格「热沙骑士、复仇童谣」（同一结束时刻的整批合并）",
			g.roles === "热沙骑士、复仇童谣", JSON.stringify(g.roles));
		check("pengpeng 档期 = 「07-30 05:00 ~ 08-13 04:59」", g.bannerDates === "07-30 05:00 ~ 08-13 04:59", JSON.stringify(g.bannerDates));
		check("pengpeng 源站原文 = 「2026-07-30 05:00:00 ~ 2026-08-13 04:59:59」（raw 与 display 分开）",
			g.bannerDatesRaw === "2026-07-30 05:00:00 ~ 2026-08-13 04:59:59", JSON.stringify(g.bannerDatesRaw));
		check("pengpeng startTs = 2026-07-30 05:00 +08（UTC 07-29 21:00）",
			g.startTs === Date.UTC(2026, 6, 29, 21, 0), String(g.startTs));
		check("pengpeng endTs = 2026-08-13 04:59 +08（UTC 08-12 20:59）",
			g.endTs === Date.UTC(2026, 7, 12, 20, 59), String(g.endTs));
		// gacha[] = 1 主条（池名）+ 3 口在期池（池名：风格）—— 与 wqmt 同一形状（`ns_bwiki_batchGachaPayloadOf` 共用），
		// 所以主条与第一口池的标题会各出现一次（既有口径，不是本次回归）。
		check("pengpeng gacha[] 共 4 条（1 主条 + 3 口在期池）", g.gacha.length === 4, String(g.gacha.length));
		check("pengpeng gacha[] 标题逐条（主条 = 池名；并列条 = 池名：推荐风格）",
			g.gacha.map((x) => x.title).join(" | ") === "乘自由之风 | 乘自由之风：热沙骑士 | 轻纱下的秘密：复仇童谣 | 喧嚣止息之时：无声裁决",
			JSON.stringify(g.gacha.map((x) => x.title)));
		check("pengpeng gacha[] 末条 endTs = 2026-08-20 04:59 +08（UTC 08-19 20:59）",
			g.gacha[3].endTs === Date.UTC(2026, 7, 19, 20, 59), String(g.gacha[3] && g.gacha[3].endTs));
		check("pengpeng gacha[] 不再带 category（SMW 的 `契约类型` 是「限时/常规」，含义不同 ⇒ 不拿来顶替旧的「遴选/活动」）",
			g.gacha.every((x) => x.category == null), JSON.stringify(g.gacha.map((x) => x.category)));
		check("pengpeng 悬停逐字（3 行「契约：风格 ⏎ 档期」）",
			g.bannerHover === "乘自由之风：热沙骑士\n07-30 05:00 ~ 08-13 04:59\n轻纱下的秘密：复仇童谣\n07-30 05:00 ~ 08-13 04:59\n喧嚣止息之时：无声裁决\n07-30 05:00 ~ 08-20 04:59",
			JSON.stringify(g.bannerHover));
		assertHoverConvention("pengpeng 卡池", g.bannerHover, { requireSet: true });
		check("pengpeng 长期池（没有 `活动结束`）如实跳过：gacha 里没有「夜色的呼唤」「起始的契约」",
			!g.gacha.some((x) => /夜色的呼唤|起始的契约/.test(x.title)), JSON.stringify(g.gacha.map((x) => x.title)));

		// (a2) 备选 ②：/pengpeng「契约一览」HTML 表（真夹具 2026-11-13 活网抓，48920 字节）
		//     表格 18 行 = 表头 1 + 有窗口 15 + 「长期」2；比 /ymzx SMW 的最后一期（09-10 04:59 止）
		//     新 1~2 期 —— 最新两行就是用户给的事实：
		//       天才不必孑立 | 遴选 | 2026/09/10 05:00:00 ~ 2026/09/24 04:59:59 | 科技部长
		//       隐秘的归属   | 活动 | 2026/09/10 05:00:00 ~ 2026/10/01 04:59:59 | 杯中藏锋
		const TABLE_ALT = (s.altSources || []).find((a) => a.fetcher === "pengpeng-bwiki-table");
		const tableRaw = FIX("pengpeng-table");
		const PPPT = T.parsers.pengpeng;
		const tableItems = PPPT.pengpengTablePoolsOf(JSON.parse(tableRaw), TZ_CN);
		check("表格：18 行里解析出 15 条有窗口的条目（表头 + 「长期」2 行被跳过）",
			tableItems.length === 15, String(tableItems.length));
		check("表格：第 1 条逐字 = 天才不必孑立 / 遴选 / 科技部长 / 「2026/09/10 05:00:00 ~ 2026/09/24 04:59:59」",
			JSON.stringify(tableItems[0]) === JSON.stringify({
				banner: "天才不必孑立", roles: "科技部长",
				raw: "2026/09/10 05:00:00 ~ 2026/09/24 04:59:59",
				display: "09-10 05:00 ~ 09-24 04:59",
				startTs: Date.UTC(2026, 8, 9, 21, 0),
				endTs: Date.UTC(2026, 8, 23, 20, 59),
				isMain: true, _i: 0, type: "遴选"
			}),
			JSON.stringify(tableItems[0]));
		check("表格：第 2 条 = 隐秘的归属 / 活动 / 杯中藏锋（10-01 04:59 收）",
			!!tableItems[1] && tableItems[1].banner === "隐秘的归属" && tableItems[1].type === "活动"
			&& tableItems[1].roles === "杯中藏锋" && tableItems[1].endTs === Date.UTC(2026, 8, 30, 20, 59),
			JSON.stringify(tableItems[1]));
		check("表格：「长期」两行没有两端 ⇒ 不在条目里（夜色的呼唤 / 起始的契约）",
			!tableItems.some((x) => /夜色的呼唤|起始的契约/.test(x.banner)),
			JSON.stringify(tableItems.map((x) => x.banner)));
		// 多风格格（起始的契约 的 3 个风格）用「、」连 —— 取表格里那一行的最后一个 td 验一遍
		{
			const text = JSON.parse(tableRaw).parse.text;
			const at = text.indexOf("起始的契约");
			const rowHtml = text.slice(text.lastIndexOf("<tr>", at), text.indexOf("</tr>", at));
			const styleCell = rowHtml.slice(rowHtml.lastIndexOf("<td>"));
			check("表格：一格多个风格用「、」连（起始的契约 ⇒ 海上浪子、深渊审判、复仇童谣）",
				PPPT.pengpengTableBoldTextsOf(styleCell).join("、") === "海上浪子、深渊审判、复仇童谣",
				JSON.stringify(PPPT.pengpengTableBoldTextsOf(styleCell)));
		}
		// 抓取器（备选 ②）：在期时刻（2026-09-15 12:00 +08）→ 与 ask 解析器**同一形状**的载荷
		const NOW_TABLE = Date.parse("2026-09-15T12:00:00+08:00");
		const eT = engineAt(NOW_TABLE);
		const gt = await eT.__test.GACHA_FETCHERS["pengpeng-bwiki-table"](TABLE_ALT.url, undefined, s.tz);
		check("表格抓取器：2026-09-15 有当期 ⇒ 外显 = 天才不必孑立 / 科技部长 / 档期「09-10 05:00 ~ 09-24 04:59」",
			!!gt && gt.banner === "天才不必孑立" && gt.roles === "科技部长"
			&& gt.bannerDates === "09-10 05:00 ~ 09-24 04:59"
			&& gt.bannerDatesRaw === "2026/09/10 05:00:00 ~ 2026/09/24 04:59:59",
			JSON.stringify(gt && { banner: gt.banner, roles: gt.roles, bannerDates: gt.bannerDates, raw: gt.bannerDatesRaw }));
		check("表格抓取器：绝对时刻与 ask 同口径（05:00 起 / 04:59 止，Asia/Shanghai）",
			!!gt && gt.startTs === Date.UTC(2026, 8, 9, 21, 0) && gt.endTs === Date.UTC(2026, 8, 23, 20, 59),
			JSON.stringify(gt && [gt.startTs, gt.endTs]));
		check("表格抓取器：gacha[] 与悬停（主条 + 另一口在期池）",
			!!gt && gt.gacha.map((x) => x.title).join(" | ") === "天才不必孑立 | 隐秘的归属：杯中藏锋"
			&& gt.bannerHover === "天才不必孑立：科技部长\n09-10 05:00 ~ 09-24 04:59\n隐秘的归属：杯中藏锋\n09-10 05:00 ~ 10-01 04:59",
			JSON.stringify(gt && [gt.gacha.map((x) => x.title), gt.bannerHover]));
		// 仓库口径：只出覆盖 now 的池；表格最后一条止于 2026-09-24 04:59 ⇒ 当前（11-13）如实 null
		const eLive = engineAt(Date.parse("2026-11-13T23:30:00+08:00"));
		let tableNull = "unset";
		try { tableNull = await eLive.__test.GACHA_FETCHERS["pengpeng-bwiki-table"](TABLE_ALT.url, undefined, s.tz); }
		catch (e5) { tableNull = "throw:" + String(e5 && e5.message || e5); }
		check("表格抓取器：当前（2026-11-13）没有在期池 ⇒ null（未公布，不抛错/不记失败）",
			tableNull === null, JSON.stringify(tableNull));

		// (b) 当前时刻（2026-11-09 / 夹具抓取那天）：SMW 最后一期止于 2026-09-10 04:59 ⇒ null = 未公布
		//     **这是事实**（wiki 停更），不是抓取失败：不外推、不把上一期当"当前"。
		const e2 = engineAt(NOW);
		const s2 = e2.__test.SOURCES.find((x) => x.id === "pengpeng");
		const ASK_ALT_2 = (s2.altSources || []).find((a) => a.fetcher === "pengpeng-bwiki-ask");
		let nullOk = false, err = "";
		let got = null;
		try { got = await e2.__test.GACHA_FETCHERS["pengpeng-bwiki-ask"](ASK_ALT_2.url, undefined, s2.tz); }
		catch (e3) { err = String(e3 && e3.message || e3); }
		nullOk = got === null && err === "";
		check("pengpeng 当前时刻没有在期池 ⇒ 返回 null（「未公布」，不抛错 = 不记失败）", nullOk, err || JSON.stringify(got));

		// (c) 结构变了 ⇒ 抛错（改版要看得见，不能静默成「未公布」）
		//     旧 HTML 页面（契约一览）现在只剩一段重定向 ⇒ 把 HTML 喂给这条链路就是 bad-json。
		const bodyEngine = (body, now) => createEngine({
			transport: {
				async fetchRaw() { return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) }; },
				async fetchViaProxy() { return body; }
			},
			storage: makeStore(), now: () => now || NOW_PP, timer: { setTimeout, clearTimeout }
		});
		const errOf = async (body) => {
			const en = bodyEngine(body);
			const src = en.__test.SOURCES.find((x) => x.id === "pengpeng");
			const alt = (src.altSources || []).find((a) => a.fetcher === "pengpeng-bwiki-ask");
			try { await en.__test.GACHA_FETCHERS["pengpeng-bwiki-ask"](alt.url, undefined, src.tz); return "no-throw"; }
			catch (e4) { return String(e4 && e4.message || e4); }
		};
		check("pengpeng 响应里没有 `query` ⇒ 抛 pengpeng-bad-shape（抓取失败 ≠ 未公布）",
			(await errOf(JSON.stringify({ batchcomplete: "" }))) === "pengpeng-bad-shape",
			await errOf(JSON.stringify({ batchcomplete: "" })));
		check("pengpeng SMW 查询报错 ⇒ 抛 pengpeng-ask-error",
			(await errOf(JSON.stringify({ error: { code: "smw-error", info: "…" } }))) === "pengpeng-ask-error",
			await errOf(JSON.stringify({ error: { code: "smw-error", info: "…" } })));
		check("pengpeng `query` 里没有 `results` ⇒ 抛 pengpeng-bad-list",
			(await errOf(JSON.stringify({ query: { printrequests: [] } }))) === "pengpeng-bad-list",
			await errOf(JSON.stringify({ query: { printrequests: [] } })));
		check("pengpeng 一行窗口都读不出（只剩两口常驻池）⇒ 抛 pengpeng-no-table",
			(await errOf(JSON.stringify({ query: { results: { 夜色的呼唤: { printouts: { "名称": ["夜色的呼唤"], "活动开始": ["2024-08-01 10:00:00"] } } } } }))) === "pengpeng-no-table",
			await errOf(JSON.stringify({ query: { results: { 夜色的呼唤: { printouts: { "名称": ["夜色的呼唤"], "活动开始": ["2024-08-01 10:00:00"] } } } } })));

		// (d) 反向证明：**/ymzx** 那个 wiki 的「契约一览」**已 #REDIRECT**，抓它永远空表 ——
		//     所以那一边只能走 SMW ask；/pengpeng 是**另一个 wiki**，同一页仍是活的 HTML 表（见 ④(a2)）。
		//     夹具 `pengpeng-contract-redirect` = 2026-11-11 用 /ymzx 的旧地址真抓的响应（1059 字节）。
		{
			const raw = JSON.parse(fixtureBodyText("pengpeng-contract-redirect/response.txt"));
			const txt = String((raw.parse && raw.parse.text) || "");
			check("反证：/ymzx 的 `action=parse&page=契约一览` 只回重定向提示（无表格、无契约行）",
				/redirectMsg/.test(txt) && /契约图鉴/.test(txt)
				&& !/<table/i.test(txt) && !/ymzx-qiyue-tag/.test(txt),
				JSON.stringify(txt.slice(0, 160)));
			check("反证：卡池默认 url 已置空（不再直连任何 parse/ask 地址），HTML 表只在备选 ② 的 /pengpeng 地址上",
				typeof T.parsers.pengpeng.pengpengPoolsOf === "undefined"
				&& typeof T.parsers.pengpeng.pengpengNameOf === "undefined"
				&& String(T.SOURCES.find((x) => x.id === "pengpeng").url) === "");
		}

		// (e) 2026-11-11 复核：卡池侧**不接** TapTap（见 30-game-pengpeng.js 的「卡池侧 2026-11-11 复核」段）
		//     TapTap 的卡池信息只有「N月N日 活动契约限时开启」—— 无年份、无结束日；图片档期不可解析。
		//     选 C（不动）：单边窗口在仓库里没有合法载荷（`coversNow` 两端都要）⇒ 这里钉死显示层行为。
		const s3 = T.SOURCES.find((x) => x.id === "pengpeng");
		check("卡池侧没有 TapTap 备选源 / 抓取器（无自动换源；单边源也不做成手动选项）",
			!!s3
			&& !(s3.altSources || []).some((a) => /taptap/i.test(String(a.url) + String(a.fetcher)))
			// 只查**本条目的**抓取器键：2026-11-13 起嘟嘟脸的卡池备选键 `ddlezj-taptap-gacha`
			// 里有 taptap 字样，但它不属于 pengpeng，别把全局键当成本条目的选项
			&& !Object.keys(T.GACHA_FETCHERS).some((k) => /pengpeng/i.test(k) && /taptap/i.test(k)),
			JSON.stringify([s3 && s3.altSources, Object.keys(T.GACHA_FETCHERS).filter((k) => /pengpeng/i.test(k))]));
		// 只有开启日 = 2026-10-22 05:00 +08（UTC 10-21 21:00）
		const oneOpen = Date.UTC(2026, 9, 21, 21, 0);
		check("单边窗口（只有开启日、结束日未公布）**不覆盖 now**、也不进悬停候选",
			T.coveredOrOpen({ startTs: oneOpen, endTs: null }, NOW) === false
			&& T.coveredOrOpen({ startTs: oneOpen, endTs: null }, Date.parse("2026-10-23T00:00:00+08:00")) === false,
			JSON.stringify([T.coveredOrOpen({ startTs: oneOpen, endTs: null }, NOW)]));
		const oneSided = { title: "「幸福无罪论」活动契约", startTs: oneOpen, endTs: null, raw: "2026年10月22日 活动契约限时开启" };
		const oneView = T.scheduleItemOf({ id: "pengpeng", banner: "（另一条）", bannerDates: "" }, "gacha", oneSided, new Date(NOW));
		check("反证：真把单边条目喂进数组，显示层会当**「长期」**（state=long / remain=0 / endTs=0）—— 所以不接",
			!!oneView && oneView.state === "long" && oneView.remain === 0 && oneView.endTs === 0 && oneView.startTs === oneOpen,
			JSON.stringify(oneView && { state: oneView.state, startTs: oneView.startTs, endTs: oneView.endTs, remain: oneView.remain }));
	}

	// ─────────────────────⑤「未配置」路径（改用**自定义条目**）─────────────────────
	// 2026-11-15：内置条目里**已经没有**两侧都不配来源的了（cytq 接上了官方 H5 公告）⇒ 这一段
	// 改用产品里仍然存在的同类形态：用户自建的自定义条目，两侧地址都留空。
	// 口径一条没变：不抓取、不抛错、不产生 fail；自检里算 `unconfigured` 而不是 `down`。
	section("新接入 5 款 ⑤：「未配置」路径 —— 不抓取、不抛错、不产生 fail（自检算 unconfigured）");
	{
		const CUSTOM_ID = "custom:probe-unconfigured";
		const CUSTOM = JSON.stringify([{ id: CUSTOM_ID, name: "自定义（两侧留空）" }]);
		// (a) fetchEntry：两侧都没地址 ⇒ 直接 skipped（连 net 都不碰）
		const e = engineAt(NOW);
		const bare = { id: CUSTOM_ID, name: "自定义（两侧留空）", tz: TZ_CN, url: "", eventUrl: "", custom: true };
		const r0 = await e.__test.fetchEntry(bare, undefined);
		check(`${CUSTOM_ID} fetchEntry ⇒ { ok:true, reason:"skipped" }（跳过，不记成功也不记失败）`,
			r0 && r0.ok === true && r0.reason === "skipped", JSON.stringify(r0));

		// (b) 自检：只留这一条 ⇒ down = 0、unconfigured = 2、ok = 0、一个请求都不发
		const ALL = T.SOURCES.map((x) => x.id);
		const calls = [];
		// 只让自定义条目进「展示中」范围（内置条目全部写进 hidden）
		const e2 = engineAt(NOW_PP, { hidden: ALL, shown: [], customEntries: CUSTOM }, calls);
		const rep = await e2.selfCheck({ timeoutMs: 5000 });
		const g = rep.games || {};
		check(`${CUSTOM_ID} 自检：卡池侧 state = unconfigured / text = 未配置来源`,
			g[CUSTOM_ID] && g[CUSTOM_ID].gacha.state === "unconfigured" && g[CUSTOM_ID].gacha.text === "未配置来源",
			JSON.stringify(g[CUSTOM_ID] && g[CUSTOM_ID].gacha));
		check(`${CUSTOM_ID} 自检：活动侧 state = unconfigured / text = 未配置来源`,
			g[CUSTOM_ID] && g[CUSTOM_ID].event.state === "unconfigured" && g[CUSTOM_ID].event.text === "未配置来源",
			JSON.stringify(g[CUSTOM_ID] && g[CUSTOM_ID].event));
		check("自检汇总：失败 = 0（未配置**不**混进失败数字）", rep.summary.down === 0, JSON.stringify(rep.summary));
		check("自检汇总：未配置 = 2（自定义条目两侧）", rep.summary.unconfigured === 2, JSON.stringify(rep.summary));
		check("自检汇总：ok = 0（只剩这条未配置的自定义条目）", rep.summary.ok === 0, JSON.stringify(rep.summary));
		check("自检期间**一个请求都没发**（未配置的条目连 net 都不碰）",
			calls.length === 0, JSON.stringify(calls));

		// (c) 面板那一格：派生不出条目 ⇒ 写「该来源无数据」（灰底），因此**没有**失败明细
		//     （失败横条已于 2026-11-10 删除，失败信息改为刷新横幅悬停明细；判据仍是 fail 是否 down）
		const rec = { id: CUSTOM_ID, name: "自定义（两侧留空）", tz: TZ_CN, gacha: [], events: [], gachaFail: null, eventFail: null };
		check("面板：未配置条目两侧都派生不出格子（⇒「该来源无数据」，不是「抓取失败」）",
			T.scheduleCellOf(rec, "gacha", new Date(NOW)) === null && T.scheduleCellOf(rec, "event", new Date(NOW)) === null);
		check("面板：未配置条目的两侧 fail 都是 null ⇒ 刷新横幅悬停明细里不会出现失败项（底部失败横条已删）",
			rec.gachaFail === null && rec.eventFail === null
			&& T.scheduleNormalize(rec, "gacha", new Date(NOW)) === null
			&& T.scheduleNormalize(rec, "event", new Date(NOW)) === null,
			JSON.stringify([T.scheduleNormalize(rec, "gacha", new Date(NOW)), T.scheduleNormalize(rec, "event", new Date(NOW))]));
	}

	// ─────────────⑤b 未配置的一侧不再沿用旧值（2026-11-13 ddlezj 真机 bug）─────────────
	// 现场：ddlezj 卡池已改成 `url=""`（不抓），但控制台面板仍显示「全新使徒【波朗】限时概率上升
	// 11-05~11-19」—— 根因在 `mergeEntryRecord`：未配置的一侧本轮没有新数据，旧记录被当成
	// "上次成功"照旧沿回，面板于是把旧结论一直挂在屏幕上。修法 = 本轮的 `gachaNone` / `eventNone`
	// 把「未配置」与「没抓到」分开：未配置的一侧**不沿回、不写 stale**，显示层走「该来源无数据」。
	section("新接入 5 款 ⑤b：改成「未配置」后该侧清空（先有数据 ⇒ url=\"\" ⇒ 再刷新 ⇒ 该侧为空）");
	{
		const OLD_START = Date.UTC(2026, 10, 4, 21, 0);   // 2026-11-05 05:00 +08
		const OLD_END = Date.UTC(2026, 10, 18, 20, 59);   // 2026-11-19 04:59 +08
		const ALL_IDS = T.SOURCES.map((x) => x.id);
		const only = (id) => ({
			lastData: JSON.stringify({
				[id]: {
					name: id === "ddlezj" ? "嘟嘟脸恶作剧" : "炽焰天穹",
					banner: "全新使徒【波朗】限时概率上升", roles: "波朗",
					bannerDates: "11-05 05:00 ~ 11-19 04:59", bannerDatesRaw: "2026/11/05 05:00 ~ 2026/11/19 04:59",
					bannerHover: "全新使徒【波朗】限时概率上升：波朗\n11-05 05:00 ~ 11-19 04:59",
					event: "旧活动", eventDates: "10-01 05:00 ~ 10-15 04:59", eventDatesRaw: "2026/10/01 05:00 ~ 2026/10/15 04:59",
					gacha: [{
						title: "全新使徒【波朗】", show: "波朗", roles: ["波朗"],
						startTs: OLD_START, endTs: OLD_END, tz: TZ_CN,
						raw: "2026/11/05 05:00 ~ 2026/11/19 04:59", source: "primary"
					}],
					events: [],
					gachaFail: null, eventFail: null, gachaStale: false, eventStale: false, okAt: OLD_START
				}
			}),
			hidden: ALL_IDS.filter((x) => x !== id),
			shown: [id]
		});
		const NOW_1113 = Date.parse("2026-11-13T23:30:00+08:00");

		// (a) ddlezj：卡池未配置（url=""），活动侧仍有源（TapTap，测试里取不到夹具 ⇒ 记为失败）
		const calls = [];
		const e = engineAt(NOW_1113, only("ddlezj"), calls);
		const before = (await e.getCached()).games.ddlezj || {};
		check("构造前提：刷新前缓存里确实有旧卡池（11-05~11-19）",
			before.banner === "全新使徒【波朗】限时概率上升" && (before.gacha || []).length === 1,
			JSON.stringify([before.banner, before.gacha && before.gacha.length]));
		const rep = await e.refresh();
		const rec = (rep.games || {}).ddlezj || {};
		check("ddlezj 卡池未配置 ⇒ 刷新后 banner / roles / 档期全空（不再沿用旧值）",
			rec.banner === "" && rec.roles === "" && rec.bannerDates === "" && rec.bannerDatesRaw === "",
			JSON.stringify({ banner: rec.banner, roles: rec.roles, bannerDates: rec.bannerDates }));
		check("ddlezj 卡池未配置 ⇒ gacha 数组为空、**没有** gachaStale（不是「沿用旧值」而是「无数据」）",
			Array.isArray(rec.gacha) && rec.gacha.length === 0 && rec.gachaStale === false,
			JSON.stringify([rec.gacha && rec.gacha.length, rec.gachaStale]));
		check("ddlezj 卡池未配置 ⇒ 面板卡池格派生不出条目（走「暂无卡池数据」）",
			T.scheduleCellOf(rec, "gacha", new Date(NOW_1113)) === null,
			JSON.stringify(T.scheduleCellOf(rec, "gacha", new Date(NOW_1113))));
		check("ddlezj 卡池未配置 ⇒ 这一侧一个请求都没发（calls 里没有 bwiki / biligame API）",
			calls.every((u) => !/wiki\.biligame\.com|api\.biligame\.com/.test(String(u))),
			JSON.stringify(calls));

		// (b) 自定义条目：两侧都未配置 ⇒ 两侧旧值一起清空（同一处修复，不针对 ddlezj 特判）
		//     （2026-11-15 起内置条目里没有这种形态了 —— cytq 接上了来源 ⇒ 换成自定义条目验证）
		const CUSTOM_ID = "custom:probe-cleared";
		const CUSTOM = JSON.stringify([{ id: CUSTOM_ID, name: "自定义（两侧留空）" }]);
		const calls2 = [];
		const e2 = engineAt(NOW_1113, Object.assign(only(CUSTOM_ID), { customEntries: CUSTOM }), calls2);
		const rep2 = await e2.refresh();
		const rec2 = (rep2.games || {})[CUSTOM_ID] || {};
		check("自定义条目两侧都未配置 ⇒ 卡池/活动两侧内容都清空、两个数组都为空、无 stale",
			rec2.banner === "" && rec2.event === "" && rec2.roles === ""
			&& (rec2.gacha || []).length === 0 && (rec2.events || []).length === 0
			&& rec2.gachaStale === false && rec2.eventStale === false,
			JSON.stringify({ banner: rec2.banner, event: rec2.event, gacha: (rec2.gacha || []).length, events: (rec2.events || []).length }));
		check("自定义条目两侧都未配置 ⇒ 一个请求都没发", calls2.length === 0, JSON.stringify(calls2));
	}

	// ── ⑥ 2026-11-11：活动候选配额 6 → 10（非档期公告把 10/27 维护公告挤到第 7 位）─────────────
	// 现场：11-09 起「禁闭者装束 / 档案 / 影像捕获 / MBCC前瞻」4 条密集发布，把真正写档期的
	// 10/27 停服维护公告（id=2099）从第 5 位挤到**第 7 位** ⇒ 旧配额 6 把它截断、活动整列空窗。
	// 真夹具：`wqmt-news-list-1111`（2026-11-11 列表）+ 前 10 条正文各一份 `wqmt-news-<id>`。
	section("新接入 5 款 ⑥：无期迷途活动候选配额 6 → 10（2099 被 4 条非档期公告挤到第 7 位）");
	{
		const LIST = "https://wqmt.aisnogames.com/api/news";
		const listRaw = FIX("wqmt-news-list-1111");
		const NOW_1111 = Date.parse("2026-11-11T00:53:00+08:00");
		const route = (u) => {
			if (u === LIST) return listRaw;
			const m = /\/api\/news\/(\d+)$/.exec(u);
			if (m) return FIX("wqmt-news-" + m[1]);
			throw new Error("⑥ 没有这个 URL 的夹具：" + u);
		};
		const run = async (body) => {
			const calls = [];
			const transport = {
				async fetchRaw(u) {
					calls.push(String(u));
					const b = u === LIST ? body : route(String(u));
					return { ok: true, status: 200, headers: { get: () => null }, text: async () => b, json: async () => JSON.parse(b) };
				},
				async fetchViaProxy(u) { calls.push(String(u)); return route(String(u)); }
			};
			const e = createEngine({ transport, storage: makeStore(), now: () => NOW_1111, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "wqmt");
			const ev = await e.__test.EVENT_FETCHERS["wqmt"].default(s.eventUrl, undefined, s.tz);
			return { ev, calls };
		};
		const wqmtList = JSON.parse(listRaw);
		const cands = T.parsers.wqmt.wqmtEventCandidatesOf(wqmtList.data);
		check("真夹具：配额 = 10；11-11 列表里 2099 排**第 7 位**（旧配额 6 正好截掉它）",
			T.parsers.wqmt.WQMT_EVENT_MAX_DETAILS === 10 && cands.length === 10 && cands[6].id === 2099,
			JSON.stringify(cands.map((x) => x.id)));

		const { ev, calls } = await run(listRaw);
		check("活动侧出 2 条在期：外显 = 数据间隙·时序11上半赛季 / 11-05 11:00 ~ 12-03 04:59",
			!!ev && ev.event === "数据间隙·时序11上半赛季" && ev.eventDates === "11-05 11:00 ~ 12-03 04:59",
			JSON.stringify(ev && [ev.event, ev.eventDates]));
		check("活动悬停逐字（名称 + 3 空格 + 档期；结束时间升序）",
			!!ev && ev.eventHover === "数据间隙·时序11上半赛季   11-05 11:00 ~ 12-03 04:59\n"
			+ "破碎防线·暗域第35期   11-02 05:00 ~ 12-14 04:00", JSON.stringify(ev && ev.eventHover));
		check("events[] 绝对时刻（+08 手算）：数据间隙 11-05 11:00~12-03 04:59 / 破碎防线 11-02 05:00~12-14 04:00",
			!!ev && ev.events.length === 2
			&& ev.events[0].startTs === Date.UTC(2026, 10, 5, 3, 0) && ev.events[0].endTs === Date.UTC(2026, 11, 2, 20, 59)
			&& ev.events[1].startTs === Date.UTC(2026, 10, 1, 21, 0) && ev.events[1].endTs === Date.UTC(2026, 11, 13, 20, 0),
			JSON.stringify(ev && ev.events.map((x) => [x.startTs, x.endTs])));
		check("请求数 = 1 次列表 + 10 篇正文（配额 10）", calls.length === 11, "requests=" + calls.length);

		// 反向证明：把列表截到前 6 条（= 旧配额能看到的那 6 条）⇒ 活动侧 null（2099 进不来）
		const top6 = JSON.parse(listRaw);
		const all = [];
		for (const sec of ["news", "activity", "notices"]) for (const it of (top6.data[sec] || [])) all.push(it);
		all.sort((a, b) => (Date.parse(b.publish_time || "") || 0) - (Date.parse(a.publish_time || "") || 0));
		const keep = new Set(all.slice(0, 6).map((x) => x.id));
		for (const sec of ["news", "activity", "notices"]) top6.data[sec] = (top6.data[sec] || []).filter((it) => keep.has(it.id));
		const { ev: ev6 } = await run(JSON.stringify(top6));
		check("反证：只给前 6 条（旧配额的效果）⇒ 活动侧 null（空窗就是 2099 被截断造成的）",
			ev6 === null && !keep.has(2099), JSON.stringify([[...keep], ev6 && ev6.event]));
	}

	// ───────── ⑥ 2026-11-15 新增 2 款：深空之眼（dhmmr）/ 崩坏学园2（bh2）─────────
	// 落点：`30-game-bwiki-dhmmr.js`（SMW ask，只有卡池侧）/ `30-game-benghuai2.js`（官网公告，两侧）。
	// 夹具：`dhmmr-ask`（真抓 + 只留前 8 条）/ `bh2-notice-list`（真抓 POST + 各栏目前 8 条）/
	//       `bh2-gach-<id>` × 6 / `bh2-event-<id>` × 6（详情原样）。
	section("2026-11-15 新增 2 款：注册项（标签逐字）+ 真夹具解析 + 反证");
	{
		const dh = srcOf("dhmmr");
		const bh = srcOf("bh2");
		const DH = T.parsers.dhmmr;
		const B2 = T.parsers.bh2;
		const NOW_LIVE = Date.parse("2026-11-15T12:00:00+08:00");

		// ── 注册项 ──
		check("dhmmr / bh2 都已注册进 SOURCES", !!dh && !!bh, JSON.stringify([!!dh, !!bh]));
		check("dhmmr = 深空之眼 / Asia/Shanghai / 默认展示 / 有图标与主题色",
			!!dh && dh.name === "深空之眼" && dh.tz === TZ_CN && dh.defaultHidden === false
			&& /^https?:\/\//.test(String(dh.icon)) && /^#[0-9A-Fa-f]{6}$/.test(String(dh.color)),
			dh ? JSON.stringify([dh.name, dh.tz, dh.defaultHidden, dh.color]) : "缺失");
		check("dhmmr 卡池来源标签逐字 = 「Bwiki 卡池列表」",
			!!dh && dh.source === "Bwiki 卡池列表", dh && String(dh.source));
		check("dhmmr 只有卡池侧：url 是 dhmmr 的 action=ask；eventUrl = \"\"（活动页空壳 ⇒ 设置页显示未配置）",
			!!dh && dh.url === DH.DHMMR_URL
			&& /^https:\/\/wiki\.biligame\.com\/dhmmr\/api\.php\?action=ask&format=json&query=/.test(String(dh.url))
			&& dh.eventUrl === "" && dh.eventSource === void 0,
			dh ? JSON.stringify([String(dh.url).slice(0, 80), dh.eventUrl, dh.eventSource]) : "缺失");
		check("bh2 = 崩坏学园2 / Asia/Shanghai / 默认展示 / 有图标与主题色",
			!!bh && bh.name === "崩坏学园2" && bh.tz === TZ_CN && bh.defaultHidden === false
			&& /^https?:\/\//.test(String(bh.icon)) && /^#[0-9A-Fa-f]{6}$/.test(String(bh.color)),
			bh ? JSON.stringify([bh.name, bh.tz, bh.defaultHidden, bh.color]) : "缺失");
		check("bh2 两侧标签逐字 = 「官网公告」，两侧同一条列表 URL",
			!!bh && bh.source === "官网公告" && bh.eventSource === "官网公告"
			&& bh.url === B2.BH2_LIST_URL && bh.eventUrl === B2.BH2_LIST_URL,
			bh ? JSON.stringify([bh.source, bh.eventSource, bh.url]) : "缺失");
		check("抓取器已接线：GACHA_FETCHERS.dhmmr / GACHA_FETCHERS.bh2 / EVENT_FETCHERS.bh2.default",
			typeof T.GACHA_FETCHERS["dhmmr"] === "function"
			&& typeof T.GACHA_FETCHERS["bh2"] === "function"
			&& !!(T.EVENT_FETCHERS["bh2"] && typeof T.EVENT_FETCHERS["bh2"].default === "function")
			&& !T.EVENT_FETCHERS["dhmmr"],
			JSON.stringify([typeof T.GACHA_FETCHERS["dhmmr"], typeof T.GACHA_FETCHERS["bh2"]]));

		// ── 深空之眼：SMW ask 解析（真夹具；8 条里 2 条是沙盒页副本，按页名排除）──
		const ask = JSON.parse(FIX("dhmmr-ask"));
		const dhRows = DH.parseDhmmrAsk(ask, TZ_CN);
		check("dhmmr 真夹具解析出 6 条（`沙盒/卡池列表#…` 的副本不进结果）",
			dhRows.length === 6, String(dhRows.length));
		check("052 期逐字：丝与刃之歌 / 限定、协议扩充 / 07-23 00:00 ~ 09-17 23:59",
			dhRows[0].banner === "丝与刃之歌" && dhRows[0].display === "07-23 00:00 ~ 09-17 23:59"
			&& dhRows[0].category === "限定、协议扩充" && dhRows[0].raw === "2026-07-23 ~ 2026-09-17",
			JSON.stringify([dhRows[0].banner, dhRows[0].display, dhRows[0].category]));
		check("052 期绝对时刻（+08 手算：只有日期 ⇒ 起 00:00 / 止 23:59）",
			dhRows[0].startTs === Date.UTC(2026, 6, 22, 16, 0) && dhRows[0].endTs === Date.UTC(2026, 8, 17, 15, 59),
			JSON.stringify([dhRows[0].startTs, dhRows[0].endTs]));
		const pDh = DH.dhmmrPayloadOf(dhRows, TZ_CN, Date.parse("2026-08-01T12:00:00+08:00"));
		check("期内（08-01）外显 = 丝与刃之歌 + 档期",
			!!pDh && pDh.banner === "丝与刃之歌" && pDh.bannerDates === "07-23 00:00 ~ 09-17 23:59",
			JSON.stringify(pDh && [pDh.banner, pDh.bannerDates]));
		check("期内悬停 = 三池（窗口全同 ⇒ 名称各一行 + 末尾一行档期；同开始/结束按池名定序，防 SMW 平局乱序）",
			!!pDh && pDh.bannerHover === "丝与刃之歌\n奇迹缔造法则\n幻梦回环之理\n07-23 00:00 ~ 09-17 23:59",
			JSON.stringify(pDh && pDh.bannerHover));
		check("期内 gacha[] 3 条（主条 + 2 并列条，主条 source=primary）",
			!!pDh && pDh.gacha.length === 3 && pDh.gacha[0].source === "primary",
			JSON.stringify(pDh && pDh.gacha.map((x) => [x.title, x.source])));
		check("真实时刻（2026-11-15）没有在期池 ⇒ null（wiki 的卡池列表最后编辑 2026-09-25，052 止于 09-17）",
			DH.dhmmrPayloadOf(dhRows, TZ_CN, NOW_LIVE) === null);

		// 053 期那种「结束时间为空」：如实 endTs=null，不猜终点；也不因此冒充当期
		const ask053 = {
			query: {
				results: {
					"卡池列表#探测053-0期": {
						printouts: {
							"卡池开始时间": ["2026-09-17"], "卡池结束时间": [], "卡池名称": ["协议锚定探测"],
							"卡池类型": ["常驻", "限定", "自选扩充"]
						},
						fulltext: "卡池列表#探测053-0期"
					}
				}
			}
		};
		const r053 = DH.parseDhmmrAsk(ask053, TZ_CN);
		check("结束时间为空 ⇒ endTs = null，raw/display 照出源站原文（不猜终点）",
			r053.length === 1 && r053[0].endTs === null && r053[0].raw === "2026-09-17" && r053[0].display === "2026-09-17",
			JSON.stringify(r053[0]));
		check("单边窗口（只有开始）不算当期 ⇒ 外显 null",
			DH.dhmmrPayloadOf(r053, TZ_CN, NOW_LIVE) === null);

		// 反证：抹掉时间锚点 ⇒ 不进外显；`{}` ⇒ 抛错（不是 nomatch）
		const oneStripped = {
			query: {
				results: {
					"卡池列表#探测052-1期": {
						printouts: {
							"卡池开始时间": ["2026-07-23"], "卡池结束时间": ["2026-09-17"],
							"卡池名称": ["丝与刃之歌"], "卡池类型": ["限定"]
						},
						fulltext: "卡池列表#探测052-1期"
					},
					"卡池列表#锚点被抹掉": {
						printouts: { "卡池开始时间": [], "卡池结束时间": [], "卡池名称": ["锚点被抹掉"], "卡池类型": ["限定"] },
						fulltext: "卡池列表#锚点被抹掉"
					}
				}
			}
		};
		const keptRows = DH.parseDhmmrAsk(oneStripped, TZ_CN);
		check("抹掉时间锚点的那条不进结果 ⇒ 外显只可能来自有锚点的行",
			keptRows.length === 1 && keptRows[0].banner === "丝与刃之歌"
			&& DH.dhmmrPayloadOf(keptRows, TZ_CN, Date.parse("2026-08-01T12:00:00+08:00")).banner === "丝与刃之歌",
			JSON.stringify(keptRows.map((x) => x.banner)));
		let dhThrow = false;
		try { DH.parseDhmmrAsk({}, TZ_CN); } catch { dhThrow = true; }
		check("`{}` ⇒ 抛错（结构性损坏，不是 nomatch / null）", dhThrow);
		let dhThrow2 = false;
		try { DH.parseDhmmrAsk({ query: { results: {} } }, TZ_CN); } catch { dhThrow2 = true; }
		check("`query.results` 为空 ⇒ 抛错（属性名/页面结构变了要看得见）", dhThrow2);

		// ── 崩坏学园2：列表 POST + 6 条详情（真夹具走 transport，记账请求方法与 body）──
		const GACH_IDS = ["20104735", "20104679", "20104534", "20104533", "20104532", "20104455"];
		const calls = [];
		const transport = {
			async fetchRaw(u) { calls.push({ u: String(u), method: "GET", body: null }); throw new Error("bh2 不应直连：" + u); },
			async fetchViaProxy(u, opts) {
				const o = opts || {};
				calls.push({ u: String(u), method: o.body !== void 0 ? "POST" : "GET", body: o.body === void 0 ? null : o.body });
				const target = String(u);
				if (target === B2.BH2_LIST_URL) return FIX("bh2-notice-list");
				const m = /id=(\d+)$/.exec(target);
				if (!m) throw new Error("bh2 用例没有这个 URL 的夹具：" + target);
				return FIX("bh2-" + (GACH_IDS.includes(m[1]) ? "gach" : "event") + "-" + m[1]);
			}
		};
		T.setCoreEnv({ transport, timer: { setTimeout, clearTimeout } });
		const NOW_BH2 = Date.parse("2026-11-15T12:00:00+08:00");
		const gB = await T.GACHA_FETCHERS["bh2"](B2.BH2_LIST_URL, undefined, TZ_CN, NOW_BH2);
		check("列表请求是 **POST** 且 body = `{}`（宿主代理只在 body 非空时发 POST；源站忽略 body）",
			calls.length > 0 && calls[0].u === B2.BH2_LIST_URL && calls[0].method === "POST"
			&& JSON.stringify(calls[0].body) === "{}",
			JSON.stringify([calls[0] && calls[0].method, calls[0] && calls[0].body]));
		check("卡池外显 = 妮娜&黛尔塔 / 金蔷薇、蛉翅 / 11-09 00:00 ~ 11-20 00:00（源站 11-19 24:00 ⇒ 次日 0 点）",
			!!gB && gB.banner === "妮娜&黛尔塔" && gB.roles === "金蔷薇、蛉翅"
			&& gB.bannerDates === "11-09 00:00 ~ 11-20 00:00"
			&& gB.startTs === Date.UTC(2026, 10, 8, 16, 0) && gB.endTs === Date.UTC(2026, 10, 19, 16, 0),
			JSON.stringify(gB && [gB.banner, gB.roles, gB.bannerDates]));
		const gLines = String((gB && gB.bannerHover) || "").split("\n");
		check("卡池悬停 = 2 池 ×（名称 ⏎ 档期），按结束升序 → 同结束按开始升序",
			gLines.length === 4 && gLines[1] === "10-15 00:00 ~ 11-20 00:00"
			&& gLines[2] === "妮娜&黛尔塔：金蔷薇、蛉翅" && gLines[3] === "11-09 00:00 ~ 11-20 00:00",
			JSON.stringify(gLines));
		check("公主祈愿 4 组自选装备逐字进悬停（24 个 UP 名，不是 4 组标题）",
			/^少女的心愿：自我时支配·仿制版、该隐之血眷、/.test(gLines[0] || "")
			&& String(gLines[0]).split("、").length === 24,
			String(gLines[0]).slice(0, 80));
		check("卡池 gacha[] 2 条（当期两口祈愿各一行）",
			!!gB && Array.isArray(gB.gacha) && gB.gacha.length === 2,
			JSON.stringify(gB && gB.gacha.map((x) => x.title)));
		check("卡池请求数 = 1 次列表 + 6 条详情", calls.length === 7, "requests=" + calls.length);

		const eB = await T.EVENT_FETCHERS["bh2"].default(B2.BH2_LIST_URL, undefined, TZ_CN, NOW_BH2);
		check("活动外显 = 双11狂欢节丨千羽万事屋活动新品上架 / 11-10 20:00 ~ 11-22 23:59（结束最早优先）",
			!!eB && eB.event === "双11狂欢节丨千羽万事屋活动新品上架" && eB.eventDates === "11-10 20:00 ~ 11-22 23:59",
			JSON.stringify(eB && [eB.event, eB.eventDates]));
		check("活动悬停逐字（名称 + 3 空格 + 档期；结束升序）",
			!!eB && eB.eventHover === "双11狂欢节丨千羽万事屋活动新品上架   11-10 20:00 ~ 11-22 23:59\n"
			+ "极地小航海   11-09 12:00 ~ 11-23 23:59\n"
			+ "斯坦因秘境   11-13 12:00 ~ 11-30 00:00",
			JSON.stringify(eB && eB.eventHover));
		check("events[] 绝对时刻（+08 手算）",
			!!eB && eB.events.length === 3
			&& eB.events[0].startTs === Date.UTC(2026, 10, 10, 12, 0) && eB.events[0].endTs === Date.UTC(2026, 10, 22, 15, 59)
			&& eB.events[1].startTs === Date.UTC(2026, 10, 9, 4, 0) && eB.events[1].endTs === Date.UTC(2026, 10, 23, 15, 59)
			&& eB.events[2].startTs === Date.UTC(2026, 10, 13, 4, 0) && eB.events[2].endTs === Date.UTC(2026, 10, 29, 16, 0),
			JSON.stringify(eB && eB.events.map((x) => [x.startTs, x.endTs])));
		check("活动请求数 = 1 次列表 + 6 条详情（两侧共享列表只在**同一轮刷新**内生效，这里直调各算一次）",
			calls.length === 14, "requests=" + calls.length);

		// 整轮刷新：两侧同一条列表 URL ⇒ 列表只发一次（1 + 6 + 6 = 13）。与 uma-global 的
		// GameTora manifest 同一套 `fetchRoundSeqOf` 轮内缓存；这里用真引擎跑一轮来钉住。
		const allIds = T.SOURCES.map((x) => x.id);
		const engineB = createEngine({
			transport,
			storage: makeStore({ hidden: allIds.filter((id) => id !== "bh2"), shown: ["bh2"] }),
			now: () => NOW_BH2,
			timer: { setTimeout, clearTimeout }
		});
		calls.length = 0;
		const round = await engineB.refresh();
		const rec = round.games["bh2"] || {};
		check("整轮刷新 = 1 次列表 + 6 + 6 条详情（13 次；列表两侧共享同一个轮内 promise）",
			calls.length === 13 && calls.filter((c) => c.u === B2.BH2_LIST_URL).length === 1,
			"requests=" + calls.length);
		check("整轮记录：卡池 + 活动两侧都拿到新数据、都不 fail",
			rec.banner === "妮娜&黛尔塔" && rec.event === "双11狂欢节丨千羽万事屋活动新品上架"
			&& !rec.gachaFail && !rec.eventFail,
			JSON.stringify([rec.banner, rec.event, rec.gachaFail, rec.eventFail]));

		// ── bh2 口径反证 ──
		let b2Throw = false;
		try { B2.bh2ListOf({}); } catch { b2Throw = true; }
		let b2Throw2 = false;
		try { B2.bh2ListOf({ data: {} }); } catch { b2Throw2 = true; }
		check("`{}` / 无任何栏目 ⇒ 抛错（列表结构变了不能静默成未公布）", b2Throw && b2Throw2);
		check("`售卖时间` / `问卷填写时间` 不认（只有 活动时间/开启时间/活动日期/活动期限 才算档期）",
			B2.bh2WindowOf("售卖时间： 10月30日 00:00 ~ 11月15日 24:00", { y: 2026, mo: 10 }, TZ_CN) === null
			&& !!B2.bh2WindowOf("【活动时间】\n11月13日 12:00 ~ 11月29日 24:00", { y: 2026, mo: 11 }, TZ_CN));
		const noAnchor = { title: "极地小航海", text: "<p>极地小航海 活动开启</p><p>活动中可以得以下稀有物品哦~</p>", feature: 0 };
		check("抹掉时间锚点 ⇒ 这条公告不产出条目（不进外显/悬停/数组）",
			B2.bh2ItemOf(noAnchor, { id: "0", title: "极地小航海", hint: { y: 2026, mo: 11 } }, "event", TZ_CN, NOW_BH2) === null);
		const dreamRow = { id: "20104532", title: "梦想祈愿", hint: { y: 2026, mo: 10 }, feature: 22 };
		const dreamDetail = JSON.parse(FIX("bh2-gach-20104532"));
		const dreamLines = B2.bh2LinesOf(dreamDetail.data.text);
		const dreamWin = B2.bh2WindowOf(dreamLines.join("\n"), dreamRow.hint, TZ_CN);
		const dreamRoles1 = B2.bh2UpRolesOf(dreamLines, dreamWin, Date.parse("2026-10-16T12:00:00+08:00"), TZ_CN);
		const dreamRoles2 = B2.bh2UpRolesOf(dreamLines, dreamWin, Date.parse("2026-10-19T12:00:00+08:00"), TZ_CN);
		check("梦想祈愿的「UP装备如下」分段表：按 now 取**当前那一段**（10-16 → 第 1 段 10 件；10-19 → 第 2 段）",
			dreamRoles1.split("、").length === 10 && dreamRoles1.indexOf("携带型崩坏能探测仪") === 0
			&& dreamRoles2.split("、").length === 10 && dreamRoles2.indexOf("领域水解") === 0
			&& dreamWin && dreamWin.endTs === Date.UTC(2026, 9, 26, 16, 0),
			JSON.stringify([dreamRoles1.split("、").slice(0, 2), dreamRoles2.split("、").slice(0, 2)]));
	}

	// ───────── ⑦ 2026-11-15：炽焰天穹（cytq）接上**官方 H5 公告** ─────────
	// 落点：`src/client/30-game-cytq.js`（原 `30-game-unconfigured.js` 只剩这一条 ⇒ 文件名跟着改）。
	// 源站事实（详见该文件头）：列表 `GET /web/announcement?phoneType=4` 一页 38 条、**没有日期**、
	// 不分页；正文里才有 `活动时间 …` 与 PickUp 名单 ⇒ 用户拍板的方案 =
	// 「列表 1 次 → 只对在期 & 未缓存的 id 取详情 → 按 id 缓存（TTL 24h；已结束的不再取）」。
	// 夹具：`cytq-list`（真抓原样 43961 B）+ `cytq-detail-<id>` × 14（真抓原样；4 个扭蛋帖 114~265KB）。
	section("2026-11-15 炽焰天穹（cytq）：官方 H5 公告（列表 1 次 → 在期详情 + id 缓存 TTL 24h）");
	{
		const CY = T.parsers.cytq;
		const LIST = CY.CYTQ_LIST_URL;
		const NOW_LIVE = Date.parse("2026-11-15T13:50:00+08:00");
		const ALL_IDS = T.SOURCES.map((x) => x.id);
		const detailUrl = (id) => CY.CYTQ_DETAIL_BASE + id + CY.CYTQ_DETAIL_PARAMS;
		// 列表里 is-gacha / is-event / is-campaign 的 14 条（= 首轮要取详情的那批，顺序 = 源站顺序）
		const DET_IDS = ["1222", "1220", "500000191", "220000127", "200000260", "1215", "200000258",
			"400001431", "400001432", "500000178", "500000179", "500000171", "200000261", "1179"];
		// 窗口结束 < 2026-11-26 12:00 - 1 天 ⇒ 「已结束、永不再取」的那 8 条
		const ENDED = ["1220", "500000191", "200000260", "1215", "200000258", "400001431", "400001432", "500000171"];
		const OPEN = ["1222", "220000127", "500000178", "500000179", "200000261", "1179"];
		const ROLES_AUTUMN = "东城司、石井色叶、瑞原蓝娜、国见玉、水濑李、茅森月歌、白河由依奈、苍井绘里香、卡罗尔・利帕、玛利亚・德・安洁莉斯";
		// 记账 transport：夹具按 URL 查 map.json；**代理一律抛**（ACAO * ⇒ 直连，摸到代理就是接线错了）
		const transportOf = (sink) => ({
			async fetchRaw(u) {
				const url = String(u);
				sink.push(url);
				const body = fixtureBody(url);
				return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
			},
			async fetchViaProxy(u) { sink.push("PROXY:" + String(u)); throw new Error("cytq 不应走代理：" + u); }
		});
		const onlyCytq = () => ({ hidden: ALL_IDS.filter((id) => id !== "cytq"), shown: ["cytq"] });
		const idOfDetail = (u) => {
			const m = /\/web\/announcement\/(\d+)\?phoneType=4$/.exec(String(u));
			return m ? m[1] : "";
		};

		// ── (a) 列表解析（38 条；只认三类；其余 24 条不取详情）──
		const list = CY.cytqListOf(fixtureBody(LIST));
		const clsCount = (c) => list.filter((x) => x.categoryClass === c).length;
		check("列表解析出 38 条（顶部 32 条轮播 `article.event` 不是公告，不进列表）",
			list.length === 38, String(list.length));
		check("分类分布逐字：is-gacha 4 / is-event 5 / is-campaign 5；其余 24 条（礼包 12 / 更新 8 / 通知 3 / 问题说明 1）不取详情",
			clsCount("is-gacha") === 4 && clsCount("is-event") === 5 && clsCount("is-campaign") === 5
			&& list.filter((x) => !CY.CYTQ_SIDE_BY_CLASS[x.categoryClass]).length === 24
			&& Object.keys(CY.CYTQ_SIDE_BY_CLASS).length === 3,
			JSON.stringify({ gacha: clsCount("is-gacha"), event: clsCount("is-event"), campaign: clsCount("is-campaign") }));
		check("列表项字段逐字（第一条 = 999800005 / is-bug / 问题说明那条）",
			list[0].id === "999800005" && list[0].categoryClass === "is-bug"
			&& list[0].title === "10月28日必得SS探索券扭蛋的问题修复说明", JSON.stringify(list[0]));
		check("1220 那条：id / is-gacha / 标题逐字（`&amp;` 已解实体）",
			(() => { const x = list.find((i) => i.id === "1220") || {}; return x.categoryClass === "is-gacha" && x.title === "感谢庆典纪念 SS1.5倍扭蛋举办中！"; })(),
			JSON.stringify(list.find((i) => i.id === "1220")));
		let lThrow1 = false;
		try { CY.cytqListOf("<html></html>"); } catch { lThrow1 = true; }
		let lThrow2 = false;
		try { CY.cytqListOf('<article class="article-item" data-announcement-id="1"><p class="article-body">x</p></article>'); } catch { lThrow2 = true; }
		check("列表 0 条 ⇒ 抛错；有项但一条分类 class 都没有 ⇒ 也抛错（结构变了不能静默成「未公布」）",
			lThrow1 && lThrow2);

		// ── (b) 详情纯解析：标题 / 角色 / 窗口（含「维护后」⇒ startTs=null）──
		const d431 = CY.cytqDetailOf(fixtureBody(detailUrl("400001431")), TZ_CN);
		check("详情 400001431：标题 + 「登场风格」名单（去 `[风格名]` 前缀、去姓名中间空白、`、` 连接）",
			d431.title === "SS小笠原绯雨登场！精选白金扭蛋" && d431.roles === "小笠原绯雨、月城最中"
			&& d431.categoryClass === "is-gacha" && d431.side === "gacha", JSON.stringify([d431.title, d431.roles]));
		check("详情 400001431：起点「2026/10/28 维护后」⇒ startTs = **null**（不猜钟点），终点 = 11/18 12:59（+08 手算）",
			d431.win.startTs === null && d431.win.endTs === Date.UTC(2026, 10, 18, 4, 59)
			&& d431.win.raw === "2026/10/28 维护后 ~ 2026/11/18 12:59"
			&& d431.win.display === "2026/10/28 维护后 ~ 2026/11/18 12:59", JSON.stringify(d431.win));
		const d1220 = CY.cytqDetailOf(fixtureBody(detailUrl("1220")), TZ_CN);
		check("详情 1220（某批风格概率提升、不指名角色）⇒ roles = \"\"；窗口两端都是绝对时刻",
			d1220.roles === "" && d1220.win.startTs === Date.UTC(2026, 10, 11, 3, 0)
			&& d1220.win.endTs === Date.UTC(2026, 10, 25, 2, 59)
			&& d1220.win.display === "11-11 11:00 ~ 11-25 10:59"
			&& d1220.win.raw === "2026/11/11 11:00 ~ 2026/11/25 10:59", JSON.stringify([d1220.roles, d1220.win]));
		const d220 = CY.cytqDetailOf(fixtureBody(detailUrl("220000127")), TZ_CN);
		check("详情 220000127：`活动时间 2026/8/12 维护后 ~`（开放终点）⇒ 两端都 null、原文照留（**不拿**「※第六轮活动时间」子窗口冒充）",
			d220.win.startTs === null && d220.win.endTs === null
			&& d220.win.raw === "2026/8/12 维护后 ~", JSON.stringify(d220.win));
		const d1222 = CY.cytqDetailOf(fixtureBody(detailUrl("1222")), TZ_CN);
		check("一览帖 1222 只取**第 1 条** `活动时间`（整场庆典窗口），18 条分块窗口不展开（各分帖会独立抓到）",
			d1222.win.raw === "2026/10/28 维护后 ~ 2026/12/2 12:59" && d1222.win.startTs === null
			&& d1222.win.endTs === Date.UTC(2026, 11, 2, 4, 59), JSON.stringify(d1222.win));

		// ── (c) 反证：结构变了要看得见；抹掉锚点就不进外显；角色有退路 ──
		let dThrow1 = false;
		try { CY.cytqDetailOf("{}", TZ_CN); } catch { dThrow1 = true; }
		let dThrow2 = false;
		try { CY.cytqDetailOf("", TZ_CN); } catch { dThrow2 = true; }
		check("`{}` / 空串 ⇒ 抛错（**不是** nomatch：详情结构变了必须报失败）", dThrow1 && dThrow2);
		const noAnchor = CY.cytqDetailOf(String(fixtureBody(detailUrl("1215"))).replace(/活动时间/g, "開催期間"), TZ_CN);
		check("反证：抹掉「活动时间」锚点 ⇒ win = null（不进外显，也**不**算失败；标题照出）",
			noAnchor.win === null && noAnchor.title === "Autumn特别精选扭蛋举办中！", JSON.stringify(noAnchor.win));
		check("反证：只有标题、没有日期 ⇒ win = null（不出窗口）",
			CY.cytqDetailOf('<h1 class="article-body">只有标题没有日期</h1>', TZ_CN).win === null);
		const noStyle = CY.cytqDetailOf(String(fixtureBody(detailUrl("400001431")))
			.replace(/<h2[^>]*class="header-gacha"[^>]*>[\s\S]*?<\/h2>/g, ""), TZ_CN);
		check("反证：抹掉「登场风格」段 ⇒ 角色退路（正文「精选「A」「B」」连排）仍给出同一份名单",
			noStyle.roles === "小笠原绯雨、月城最中", JSON.stringify(noStyle.roles));

		// ── (d) 首轮：1 次列表 + 14 条详情（两侧共享同一条列表 URL 的轮内 promise ⇒ 不是 16 次）──
		CY.cytqResetDetailCache();
		const calls = [];
		const engineC = createEngine({
			transport: transportOf(calls),
			storage: makeStore(onlyCytq()),
			now: () => NOW_LIVE,
			timer: { setTimeout, clearTimeout }
		});
		const r1 = await engineC.refresh();
		const rec = r1.games.cytq || {};
		check("首轮请求数 = 1 + 14 = 15（列表只在**同一轮**里发一次：卡池侧与活动侧共享）",
			calls.length === 15 && calls[0] === LIST, "requests=" + calls.length);
		check("详情只取 is-gacha / is-event / is-campaign 那 14 条（礼包/更新/通知/问题说明一条都不取）",
			JSON.stringify(calls.slice(1)) === JSON.stringify(DET_IDS.map(detailUrl)),
			JSON.stringify(calls.slice(1).map(idOfDetail)));
		check("一个代理请求都没有（ACAO: * ⇒ 直连）",
			calls.every((u) => /^https:\/\/le3-prod-bili-gs-fever\.bilibiligame\.net\//.test(String(u))),
			JSON.stringify(calls.filter((u) => !/^https:\/\//.test(String(u)))));

		// ── (e) 载荷逐字：卡池（外显 + 悬停 + gacha[]）/ 活动（外显 + 悬停 + events[]）──
		check("卡池外显 = Autumn特别精选扭蛋举办中！/ 10 位角色 / 11-04 11:00 ~ 11-18 12:59（绝对时刻 +08 手算）",
			rec.banner === "Autumn特别精选扭蛋举办中！" && rec.roles === ROLES_AUTUMN
			&& rec.bannerDates === "11-04 11:00 ~ 11-18 12:59"
			&& rec.bannerDatesRaw === "2026/11/4 11:00 ~ 2026/11/18 12:59"
			// ⚠️ 记录里没有 startTs/endTs（GACHA_FIELDS 不含它们）⇒ 绝对时刻断言放在 gacha[0] 上
			&& rec.gacha[0].startTs === Date.UTC(2026, 10, 4, 3, 0) && rec.gacha[0].endTs === Date.UTC(2026, 10, 18, 4, 59),
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.gacha[0] && rec.gacha[0].startTs]));
		const gLines = String(rec.bannerHover || "").split("\n");
		check("卡池悬停 = 4 池 ×（`池名：角色` ⏎ 档期），结束时间升序；「维护后」那两池印**原文**（不编钟点）",
			gLines.length === 8
			&& gLines[0] === `Autumn特别精选扭蛋举办中！：${ROLES_AUTUMN}`
			&& gLines[1] === "11-04 11:00 ~ 11-18 12:59"
			&& gLines[2] === "SS小笠原绯雨登场！精选白金扭蛋：小笠原绯雨、月城最中"
			&& gLines[3] === "2026/10/28 维护后 ~ 2026/11/18 12:59"
			&& gLines[6] === "感谢庆典纪念 SS1.5倍扭蛋举办中！"
			&& gLines[7] === "11-11 11:00 ~ 11-25 10:59",
			JSON.stringify(gLines));
		check("卡池 gacha[] 4 条（主条 source=primary + 3 条并列；起点未知那两条 ts 为空 —— 与星铁「版本更新后」同一口径）",
			Array.isArray(rec.gacha) && rec.gacha.length === 4 && rec.gacha[0].source === "primary"
			&& rec.gacha[0].title === "Autumn特别精选扭蛋举办中！"
			&& rec.gacha.some((x) => x.startTs == null && x.endTs == null && /小笠原绯雨、月城最中/.test(String(x.title))),
			JSON.stringify((rec.gacha || []).map((x) => [x.title, x.startTs, x.endTs])));
		check("卡池格：面板能派生出在期条目（不是「该来源无数据」）",
			!!T.scheduleCellOf(rec, "gacha", new Date(NOW_LIVE)) && rec.gachaFail === null,
			JSON.stringify(T.scheduleCellOf(rec, "gacha", new Date(NOW_LIVE))));
		check("活动外显 = 剧情活动批量精选开放中！/ 10-21 11:00 ~ 11-18 12:59（类别档位 → 结束最早）",
			rec.event === "剧情活动批量精选开放中！" && rec.eventDates === "10-21 11:00 ~ 11-18 12:59"
			&& rec.eventDatesRaw === "2026/10/21 11:00 ~ 2026/11/18 12:59",
			JSON.stringify([rec.event, rec.eventDates]));
		check("活动悬停逐字（名称 + 3 空格 + 档期；结束升序 → 同结束按开始升序）",
			rec.eventHover === "剧情活动批量精选开放中！   10-21 11:00 ~ 11-18 12:59\n"
			+ "剪影活动「珍藏的回忆」开放中！   11-04 11:00 ~ 11-18 12:59\n"
			+ "高分挑战活动#67开启！   11-04 11:00 ~ 11-18 12:59\n"
			+ "光球技能习得庆典举办中！   11-11 11:00 ~ 11-18 12:59",
			JSON.stringify(rec.eventHover));
		check("活动 events[] 4 条（绝对时刻 +08 手算；开放终点的 220000127 / 1179 不进数组）",
			Array.isArray(rec.events) && rec.events.length === 4
			&& rec.events[0].startTs === Date.UTC(2026, 9, 21, 3, 0) && rec.events[0].endTs === Date.UTC(2026, 10, 18, 4, 59)
			&& rec.events[3].startTs === Date.UTC(2026, 10, 11, 3, 0) && rec.events[3].endTs === Date.UTC(2026, 10, 18, 4, 59)
			&& !rec.events.some((x) => /异时层EX|邀请好友/.test(String(x.title))),
			JSON.stringify((rec.events || []).map((x) => [x.title, x.startTs, x.endTs])));
		check("两侧都不 fail（首轮解析成功）", rec.gachaFail === null && rec.eventFail === null,
			JSON.stringify([rec.gachaFail, rec.eventFail]));

		// ── (f) 稳态：TTL 内的第 2 轮 = 1 次（只列表）──
		calls.length = 0;
		const r2 = await engineC.refresh();
		const rec2 = r2.games.cytq || {};
		check("稳态第 2 轮 = 1 次（只列表；14 条详情全在 24h 缓存里）",
			calls.length === 1 && calls[0] === LIST, "requests=" + calls.length);
		check("稳态第 2 轮的值与首轮逐字相同",
			rec2.banner === rec.banner && rec2.roles === rec.roles && rec2.event === rec.event
			&& rec2.bannerHover === rec.bannerHover && rec2.eventHover === rec.eventHover);

		// ── (g) 缓存口径：TTL 24h 过期会重取；**已结束的永不再取**；没在期 ⇒ null ──
		CY.cytqResetDetailCache();
		let clock = NOW_LIVE;
		const callsT = [];
		const engineT = createEngine({
			transport: transportOf(callsT),
			storage: makeStore(onlyCytq()),
			now: () => clock,
			timer: { setTimeout, clearTimeout }
		});
		await engineT.refresh();
		check("(g) 前提：重置缓存后的首轮又是 1 + 14", callsT.length === 15, "requests=" + callsT.length);
		callsT.length = 0;
		clock = NOW_LIVE + 25 * 3600 * 1000;          // 2026-11-16 14:50：TTL 过期、窗口都还没结束
		await engineT.refresh();
		check("TTL 24h 过期且窗口未结束 ⇒ 重新取详情（1 + 14 = 15）",
			callsT.length === 15, "requests=" + callsT.length);
		callsT.length = 0;
		clock = Date.parse("2026-11-26T12:00:00+08:00");   // 全部 11/18 与 11/25 的窗口都已结束 > 1 天
		const r3 = await engineT.refresh();
		const rec3 = r3.games.cytq || {};
		const redone = callsT.slice(1).map(idOfDetail).filter(Boolean);
		check("已结束的 8 条（窗口结束 < now - 1 天）**永不再取**；这一轮只补 1 + 6（12/2 结束的 4 条 + 两个没有终点的）",
			callsT.length === 7 && callsT[0] === LIST
			&& ENDED.every((id) => !redone.includes(id))
			&& OPEN.every((id) => redone.includes(id)),
			"requests=" + callsT.length + " → " + JSON.stringify(redone));
		check("那一轮两侧都没在期 ⇒ 标 nomatch（**不是**失败），字符串列沿用上一轮并标 stale（nomatch 不清空已有数据）",
			String(rec3.gachaFail && rec3.gachaFail.kind) === "nomatch"
			&& String(rec3.eventFail && rec3.eventFail.kind) === "nomatch"
			&& rec3.gachaStale === true && rec3.eventStale === true
			&& rec3.banner === rec.banner && rec3.event === rec.event,
			JSON.stringify([rec3.banner, rec3.event, rec3.gachaFail, rec3.eventFail, rec3.gachaStale, rec3.eventStale]));

		// ── (h) defaultHidden 保持 true：不勾「展示」就一个请求都不发 ──
		CY.cytqResetDetailCache();
		const callsH = [];
		const engineH = createEngine({
			transport: transportOf(callsH),
			storage: makeStore({ hidden: ALL_IDS, shown: [] }),
			now: () => NOW_LIVE,
			timer: { setTimeout, clearTimeout }
		});
		await engineH.refresh();
		check("cytq 出厂隐藏（defaultHidden: true）⇒ 不勾展示时一个请求都不发（接上来源不改变这条口径）",
			callsH.length === 0, JSON.stringify(callsH));
	}

	// ───────── ⑧ 2026-11-15：碧蓝航线 —— 国服只接活动（hl）/ 日服卡池 + 活动（hl-jp）─────────
	// 落点：`src/client/30-game-hl.js`（一个厂商级文件装两条来源）。
	// 源站事实与口径见该文件头 ①~⑥；夹具全部真抓（2026-11-15）：
	//   · `hl-cn-list`（20 条裁到 5 条：置顶的概率公示 + 最近 4 篇维护公告）
	//   · `hl-cn-detail-18574`（11-12 维护公告原样 49 KB；正文是 Word 富文本，每个 run 一个 `<span>`）
	//   · `hl-jp-list`（`/api/news/list?index=1&size=10` 裁到 5 行：2 条 offset 回绕的老行 + 771/770/769）
	section("2026-11-15 碧蓝航线（hl 国服只接活动 / hl-jp 日服卡池 + 活动）：真夹具逐字 + 反证");
	{
		const HL = T.parsers.hl;
		const TZ_JP = "Asia/Tokyo";
		const LIST_CN = HL.HL_CN_LIST_URL;
		const DETAIL_CN = HL.HL_CN_DETAIL_BASE + "18574";
		const LIST_JP = HL.HL_JP_LIST_URL;
		const ALL_IDS = T.SOURCES.map((x) => x.id);
		// 真夹具（`origin=*` 是 bwiki/biligame 出口自动补的，比对前先剥掉）
		const norm = (u) => String(u).replace(/[?&]origin=\*/, "");
		const BODY = { [LIST_CN]: FIX("hl-cn-list"), [DETAIL_CN]: FIX("hl-cn-detail-18574"), [LIST_JP]: FIX("hl-jp-list") };
		const transportOf = (sink, overrides) => ({
			async fetchRaw(u) { throw new Error("hl 两侧都走宿主代理（mode=proxy）：" + u); },
			async fetchViaProxy(u) {
				const url = norm(u);
				if (sink) sink.push(url);
				if (overrides && overrides[url] != null) return overrides[url];
				if (BODY[url] != null) return BODY[url];
				throw new Error("hl 用例没有这个 URL 的夹具：" + url);
			}
		});
		const seedHl = () => ({ hidden: ALL_IDS.filter((id) => id !== "hl" && id !== "hl-jp"), shown: ["hl", "hl-jp"] });
		const engineHl = (now, sink, overrides) => createEngine({
			transport: transportOf(sink, overrides),
			storage: makeStore(seedHl()),
			now: () => now,
			timer: { setTimeout, clearTimeout }
		});
		const NOW_HL = Date.parse("2026-11-15T06:30:00+08:00");
		const NOW_JP_POOL = Date.parse("2026-10-25T12:00:00+08:00");

		// ── ① 注册 ──
		const srcHl = srcOf("hl");
		const srcJp = srcOf("hl-jp");
		check("hl 注册：卡池侧 `url: \"\"` 且**不写 source**（= 未配置，面板显示「未配置」而不是失败）",
			!!srcHl && srcHl.url === "" && srcHl.source === void 0 && srcHl.eventUrl === LIST_CN,
			srcHl ? JSON.stringify([srcHl.url, srcHl.source, srcHl.eventUrl]) : "缺失");
		check("hl 活动侧标签逐字 = 「官网公告」；tz = Asia/Shanghai；出厂默认展示",
			!!srcHl && srcHl.eventSource === "官网公告" && srcHl.tz === "Asia/Shanghai" && srcHl.defaultHidden === false,
			srcHl ? JSON.stringify([srcHl.eventSource, srcHl.tz, srcHl.defaultHidden]) : "缺失");
		check("hl-jp 注册：卡池与活动**同一条**新闻列表；标签逐字「官网公告（日服）」；tz = Asia/Tokyo；默认展示",
			!!srcJp && srcJp.url === LIST_JP && srcJp.eventUrl === LIST_JP
			&& srcJp.source === "官网公告（日服）" && srcJp.eventSource === "官网公告（日服）"
			&& srcJp.tz === "Asia/Tokyo" && srcJp.defaultHidden === false
			&& srcJp.name === "碧蓝航线·日服",
			srcJp ? JSON.stringify([srcJp.url, srcJp.eventUrl, srcJp.source, srcJp.tz]) : "缺失");
		check("两条来源都有配色（面板「颜色 = 游戏」），且 hl / hl-jp 不同色、id 全局唯一",
			!!srcHl && !!srcJp && /^#[0-9A-F]{6}$/i.test(String(srcHl.color)) && /^#[0-9A-F]{6}$/i.test(String(srcJp.color))
			&& srcHl.color !== srcJp.color && new Set(ALL_IDS).size === ALL_IDS.length,
			JSON.stringify([srcHl && srcHl.color, srcJp && srcJp.color]));

		// ── ② 国服：列表 / 详情 / 条目事实（逐字）──
		const cnList = HL.hlCnListOf(JSON.parse(BODY[LIST_CN]));
		check("国服列表：5 条按 `displayTime || ctime` 倒序（2017 的置顶概率公示**排到最后**，不是源站原序）",
			cnList.length === 5 && cnList[0].id === "18574" && cnList[cnList.length - 1].id === "1591"
			&& cnList.map((x) => x.id).join(",") === "18574,18549,18495,18457,1591",
			JSON.stringify(cnList.map((x) => x.id)));
		const cnDetail = HL.hlCnDetailOf(JSON.parse(BODY[DETAIL_CN]), TZ_CN);
		check("国服详情：标题 / 年份（标题里的 2026）/ 同篇维护窗 11-12 10:00~15:00（结束时刻 15:00）",
			cnDetail.title === "2026维护公告（2026年11月12日10:00）" && cnDetail.year === 2026
			&& cnDetail.maint && cnDetail.maint.mo === 11 && cnDetail.maint.d === 12
			&& cnDetail.maint.endH === 15 && cnDetail.maint.endMi === 0,
			JSON.stringify([cnDetail.title, cnDetail.year, cnDetail.maint]));
		check("国服条目事实 2 条：`开幕！天使们的碧蓝舞台` 与 `JUUs动态`（名字取 `活动时间` 前最近的「…」）",
			cnDetail.items.length === 2
			&& cnDetail.items[0].event === "开幕！天使们的碧蓝舞台" && cnDetail.items[1].event === "JUUs动态",
			JSON.stringify(cnDetail.items.map((x) => x.event)));
		check("国服起点 = 「维护后」→ 同篇维护结束时刻 11-12 15:00 +08（UTC 07:00）；终点 = 11-26 23:59 +08（UTC 15:59）",
			cnDetail.items[0].startTs === Date.UTC(2026, 10, 12, 7, 0)
			&& cnDetail.items[0].endTs === Date.UTC(2026, 10, 26, 15, 59),
			JSON.stringify([cnDetail.items[0].startTs, cnDetail.items[0].endTs]));
		check("国服 raw 保留源站原文（`维护后` 原样）、display 是补全后的可读文本（两份文本不混）",
			cnDetail.items[0].raw === "11月12日维护后 ~ 11月26日23:59"
			&& cnDetail.items[0].display === "11-12 15:00 ~ 11-26 23:59",
			JSON.stringify([cnDetail.items[0].raw, cnDetail.items[0].display]));

		// ── ③ 国服：抓取器 + 请求预算 + 载荷 ──
		HL.hlCnResetCache();
		HL.hlJpResetCache();
		const calls1 = [];
		const e1 = engineHl(NOW_HL, calls1);
		const r1 = await e1.refresh();
		const recHl = r1.games.hl || {};
		const recJp = r1.games["hl-jp"] || {};
		check("首轮请求 = 3 次（国服列表 + 国服当期详情 + 日服列表；日服两轮内共享同一次列表）",
			calls1.length === 3
			&& calls1.filter((u) => u === LIST_CN).length === 1
			&& calls1.filter((u) => u === DETAIL_CN).length === 1
			&& calls1.filter((u) => u === LIST_JP).length === 1,
			"requests=" + calls1.length + " " + JSON.stringify(calls1));
		check("国服卡池侧一个请求都不发、也不记失败（未配置 ≠ 抓取失败）",
			recHl.banner === "" && recHl.gachaFail === null, JSON.stringify([recHl.banner, recHl.gachaFail]));
		check("国服活动外显 = 开幕！天使们的碧蓝舞台 / 11-12 15:00 ~ 11-26 23:59（原文 `维护后` 保留在 *Raw）",
			recHl.event === "开幕！天使们的碧蓝舞台" && recHl.eventDates === "11-12 15:00 ~ 11-26 23:59"
			&& recHl.eventDatesRaw === "11月12日维护后 ~ 11月26日23:59" && recHl.eventFail === null,
			JSON.stringify([recHl.event, recHl.eventDates, recHl.eventDatesRaw]));
		check("国服活动悬停逐字（两个活动同一窗口 ⇒ 折叠式：两行名字 + 一行原文）",
			recHl.eventHover === "开幕！天使们的碧蓝舞台\nJUUs动态\n11月12日维护后 ~ 11月26日23:59",
			JSON.stringify(recHl.eventHover));
		check("国服 events[] 2 条，绝对时刻 +08（UTC 手算）",
			Array.isArray(recHl.events) && recHl.events.length === 2
			&& recHl.events[0].startTs === Date.UTC(2026, 10, 12, 7, 0)
			&& recHl.events[0].endTs === Date.UTC(2026, 10, 26, 15, 59),
			JSON.stringify((recHl.events || []).map((x) => [x.title, x.startTs, x.endTs])));
		// ⚠️ 这里**不**跑 assertHoverConvention：它的元信息词表里含「维护后」，而本条的悬停按
		// 2026-11-09 口径（raw 含相对表述 ⇒ 印**源站原文**）会原样印出「11月12日维护后 ~ …」——
		// 与 cytq 的「2026/10/28 维护后 ~ …」同一情形（那条也没跑这个检查器）。上面的逐字断言已经钉住文本。

		// 稳态：详情进 24h 缓存 ⇒ 只发列表（国服 1 / 日服 1）
		calls1.length = 0;
		const r1b = await e1.refresh();
		check("稳态第 2 轮 = 2 次（国服只列表 + 日服只列表；国服详情 / 日服行解析都在 24h 缓存里）",
			calls1.length === 2 && calls1.filter((u) => u === DETAIL_CN).length === 0
			&& (r1b.games.hl || {}).event === recHl.event && (r1b.games["hl-jp"] || {}).event === recJp.event,
			"requests=" + calls1.length + " " + JSON.stringify(calls1));

		// ── ④ 日服：列表 / 行解析（池 + 活动，逐字）──
		const jpRows = HL.hlJpListOf(JSON.parse(BODY[LIST_JP]));
		check("日服列表：5 行，前两行是服务端 offset 回绕的 2017 老行（`index=1&size=10` 的真实形态，解析器必须无视它们）",
			jpRows.length === 5 && jpRows.map((x) => x.id).join(",") === "289,284,771,770,769",
			JSON.stringify(jpRows.map((x) => x.id)));
		const nJunk = HL.hlJpNoticeOf(jpRows[0], TZ_JP);
		check("日服回绕老行：既没有池也没有活动（0 / 0，不误报）",
			nJunk.pools.length === 0 && nJunk.events.length === 0, JSON.stringify([nJunk.pools.length, nJunk.events.length]));
		const n771 = HL.hlJpNoticeOf(jpRows[2], TZ_JP);
		check("日服 771（11-10 发布 / 11-12 维护）：**没有 期間限定建造 段**（联动角色走任务获取）⇒ pools 0",
			n771.pools.length === 0, JSON.stringify(n771.pools));
		check("日服 771 活动 2 条：`開幕！天使たちのアズールステージ`（起点 = 同篇实施时间结束 20:00）与継続中の `強化ユニットキャンペーン『バヤール』`（起点未知）",
			n771.events.length === 2
			&& n771.events[0].event === "開幕！天使たちのアズールステージ"
			&& n771.events[0].startTs === Date.UTC(2026, 10, 12, 11, 0)
			&& n771.events[0].endTs === Date.UTC(2026, 10, 26, 14, 59)
			&& n771.events[1].event === "強化ユニットキャンペーン『バヤール』" && n771.events[1].startTs === null,
			JSON.stringify(n771.events.map((x) => [x.event, x.startTs, x.endTs])));
		const n769 = HL.hlJpNoticeOf(jpRows[4], TZ_JP);
		check("日服 769（10-20）：池 1 条 —— 池名「期間限定建造」+ 4 位舰名 + 起止（+09 手算）",
			n769.pools.length === 1
			&& n769.pools[0].banner === "期間限定建造"
			&& n769.pools[0].roles === "メルクーリィ、セリミエ、ヤーンバアデン、オーメン・ランゲ"
			&& n769.pools[0].startTs === Date.UTC(2026, 9, 22, 11, 0)
			&& n769.pools[0].endTs === Date.UTC(2026, 10, 5, 14, 59),
			JSON.stringify(n769.pools));
		check("日服窗口原文：「…メンテナンス後 ~ …メンテナンスまで」（display 用补全文本、raw 保留原文）",
			n769.pools[0].raw === "10月22日(木)メンテナンス後 ~ 11月5日(木)メンテナンスまで"
			&& n769.pools[0].display === "10-22 20:00 ~ 11-05 23:59",
			JSON.stringify([n769.pools[0].raw, n769.pools[0].display]));
		check("日服活动名不把 `◇…イベント「X」について` 这种说明段当活动（同一行必须带「開催」）",
			n771.events.every((x) => !/天使ステージ[LM]/.test(x.event)),
			JSON.stringify(n771.events.map((x) => x.event)));

		// ── ⑤ 日服：当期（真机时刻）+ 请求预算 ──
		check("日服 at 2026-11-15：**卡池如实 null**（最后一口限时池 10/22~11/5 已结束；不硬凑过期档期）",
			recJp.banner === "" && String(recJp.gachaFail && recJp.gachaFail.kind) === "nomatch",
			JSON.stringify([recJp.banner, recJp.gachaFail]));
		check("日服 at 2026-11-15：活动 2 条在期，外显 = 開幕！天使たちのアズールステージ / 11-12 20:00 ~ 11-26 23:59",
			recJp.event === "開幕！天使たちのアズールステージ" && recJp.eventDates === "11-12 20:00 ~ 11-26 23:59"
			&& recJp.eventDatesRaw === "11月12日(木)メンテナンス後 ~ 11月26日(木)23:59まで" && recJp.eventFail === null,
			JSON.stringify([recJp.event, recJp.eventDates, recJp.eventDatesRaw]));
		check("日服活动悬停逐字（同一期在 771/770 各写一遍 ⇒ 去重后只剩 2 行，起点明确的那条优先）",
			recJp.eventHover === "開幕！天使たちのアズールステージ   11-12 20:00 ~ 11-26 23:59\n"
			+ "強化ユニットキャンペーン『バヤール』   11-05 20:00 ~ 12-03 23:59",
			JSON.stringify(recJp.eventHover));
		check("日服 events[] 2 条（強化… 的 startTs 由 770 补上，不是 null）",
			Array.isArray(recJp.events) && recJp.events.length === 2
			&& recJp.events[1].startTs === Date.UTC(2026, 10, 5, 11, 0)
			&& recJp.events[1].endTs === Date.UTC(2026, 11, 3, 14, 59),
			JSON.stringify((recJp.events || []).map((x) => [x.title, x.startTs, x.endTs])));
		if (recJp.eventHover) assertHoverConvention("hl-jp 活动", recJp.eventHover, { requireSet: true });

		// 对照：把 now 放回池期内（10-25）⇒ 卡池出「期間限定建造」+ 舰名（证明池解析本身没坏）
		const e2 = engineHl(NOW_JP_POOL);
		const sJp = e2.__test.SOURCES.find((x) => x.id === "hl-jp");
		const gPool = await e2.__test.GACHA_FETCHERS["hl-jp"](sJp.url, undefined, sJp.tz);
		check("日服对照（now = 10-25 12:00）：卡池出「期間限定建造」+ 4 位舰名 + 10-22 20:00 ~ 11-05 23:59",
			!!gPool && gPool.banner === "期間限定建造"
			&& gPool.roles === "メルクーリィ、セリミエ、ヤーンバアデン、オーメン・ランゲ"
			&& gPool.bannerDates === "10-22 20:00 ~ 11-05 23:59"
			&& gPool.startTs === Date.UTC(2026, 9, 22, 11, 0) && gPool.endTs === Date.UTC(2026, 10, 5, 14, 59),
			JSON.stringify(gPool && [gPool.banner, gPool.roles, gPool.bannerDates]));
		// 只发列表、**不**取详情（行里自带正文）：1 次
		const callsPool = [];
		const e2b = engineHl(NOW_JP_POOL, callsPool);
		await e2b.refresh();
		check("日服 1 次列表就够（行里自带完整正文；卡池侧与活动侧共享同一次列表请求）",
			callsPool.filter((u) => u === LIST_JP).length === 1 && callsPool.filter((u) => u === LIST_CN).length === 1,
			JSON.stringify(callsPool));

		// ── ⑥ 反证（结构变了要看得见；抹掉锚点/维护窗不进外显）──
		const throws = (fn) => { try { fn(); return false; } catch { return true; } };
		check("国服反证：`{}` / 空串 ⇒ 抛错（列表与详情都是「结构变了」，不是 nomatch）",
			throws(() => HL.hlCnListOf({})) && throws(() => HL.hlCnDetailOf({})) && throws(() => HL.hlCnDetailOf(""))
			&& throws(() => HL.hlCnListOf({ code: 0, data: [] })));
		check("日服反证：`{}` / meta.ok=false / rows 空 ⇒ 抛错（不是「当期没有」）",
			throws(() => HL.hlJpListOf({})) && throws(() => HL.hlJpListOf({ meta: { ok: false, err: { code: 500 } } }))
			&& throws(() => HL.hlJpListOf({ data: { rows: [] } })));
		// 抹掉国服的 `活动时间` 锚点 ⇒ 这篇不出任何条目（但不抛错）
		const noAnchor = JSON.parse(BODY[DETAIL_CN]);
		noAnchor.data.content = String(noAnchor.data.content).replace(/活动时间/g, "開催期間");
		const dNo = HL.hlCnDetailOf(noAnchor, TZ_CN);
		check("国服反证：抹掉 `活动时间` 锚点 ⇒ items 为空（不进外显，**也不**算失败）",
			dNo.items.length === 0 && dNo.title === cnDetail.title, JSON.stringify(dNo.items));
		// 抹掉同篇维护窗 ⇒ 「维护后」没有钟点 ⇒ 起点未知（不猜）⇒ 不进外显
		// （只改 `司令部将于` 这个词组：正文的 Word 富文本把一句话拆进几十个 `<span>`，按整句 replace 匹配不上）
		const noMaint = JSON.parse(BODY[DETAIL_CN]);
		noMaint.data.content = String(noMaint.data.content).replace(/司令部将于/g, "本次");
		const dNoMaint = HL.hlCnDetailOf(noMaint, TZ_CN);
		check("国服反证：抹掉同篇维护窗 ⇒ 起点未知（startTs = null），不会拿「维护后」硬编一个钟点",
			dNoMaint.items.length === 2 && dNoMaint.items.every((x) => x.startTs === null),
			JSON.stringify(dNoMaint.items.map((x) => [x.event, x.startTs])));
		const callsNoMaint = [];
		const eNoMaint = engineHl(NOW_HL, callsNoMaint, { [DETAIL_CN]: JSON.stringify(noMaint) });
		const rNoMaint = await eNoMaint.refresh();
		check("国服反证（端到端）：维护窗被抹掉 ⇒ 该篇两个活动都不在期 ⇒ 活动如实 nomatch（不硬凑）",
			(rNoMaint.games.hl || {}).event === ""
			&& String(((rNoMaint.games.hl || {}).eventFail || {}).kind) === "nomatch",
			JSON.stringify([(rNoMaint.games.hl || {}).event, (rNoMaint.games.hl || {}).eventFail]));
		// 抹掉日服的 `開催期間` ⇒ 池与活动都是 0（不硬凑）
		const stripJp = JSON.stringify(JSON.parse(BODY[LIST_JP])).replace(/開催期間/g, "会場時間");
		const rowsNoWin = HL.hlJpListOf(JSON.parse(stripJp));
		const noWin = rowsNoWin.map((x) => HL.hlJpNoticeOf(x, TZ_JP));
		check("日服反证：抹掉 `開催期間` ⇒ 所有行 0 条池 / 0 条活动（不出窗口、也不抛）",
			noWin.every((n) => n.pools.length === 0 && n.events.length === 0),
			JSON.stringify(noWin.map((n) => [n.pools.length, n.events.length])));
		check("日服窗口反证：缺一端（`開催期間：11月12日(木)メンテナンス後`）⇒ 不是窗口",
			HL.hlJpWindowOf("開催期間：11月12日(木)メンテナンス後", 2026, null, TZ_JP) === null);
		check("日服窗口反证：起点「メンテナンス後」但同篇没有实施时间 ⇒ startTs = null（不猜钟点）",
			(() => {
				const w = HL.hlJpWindowOf("開催期間：11月12日(木)メンテナンス後～11月26日(木)23:59まで", 2026, null, TZ_JP);
				return !!w && w.startTs === null && w.endTs === Date.UTC(2026, 10, 26, 14, 59);
			})());
		check("日服跨年反证：12-26 ~ 次年 01-09 ⇒ 终点补到次年（共用 endsNextYear）",
			(() => {
				const w = HL.hlJpWindowOf("開催期間：12月26日(金)メンテナンス後～1月9日(土)23:59まで", 2026, null, TZ_JP);
				return !!w && w.endTs === Date.UTC(2027, 0, 9, 14, 59);
			})());
		// 端到端：源站回 `{}`（结构变了）⇒ 记 down（**不是** nomatch）
		const callsEmpty = [];
		const eEmpty = engineHl(NOW_HL, callsEmpty, {
			[LIST_CN]: "{}",
			[LIST_JP]: JSON.stringify({ meta: { ok: false, err: { code: 500 } } })
		});
		const rEmpty = await eEmpty.refresh();
		const hlEmpty = rEmpty.games.hl || {};
		const jpEmpty = rEmpty.games["hl-jp"] || {};
		check("反证（端到端）：源站回 `{}` / meta.ok=false ⇒ 两侧都记 **down**（抓取失败 ≠ 未公布）",
			String((hlEmpty.eventFail || {}).kind) === "down"
			&& String((jpEmpty.gachaFail || {}).kind) === "down"
			&& String((jpEmpty.eventFail || {}).kind) === "down",
			JSON.stringify([hlEmpty.eventFail, jpEmpty.gachaFail, jpEmpty.eventFail]));
	}

	// ───────── ⑨ 2026-11-15：公主连结·繁中服（pcr-tw）/ 雷索纳斯（reso）─────────
	// 落点：`src/client/30-game-pcr-tw.js`（厂商级，一条来源）与 `src/client/30-game-bwiki-reso.js`
	// （**文件名是历史命名**：2026-11-15 数据源已从 bwiki 换成官网首页内联 JSON，一条来源）。
	// 源站事实与口径见两个文件的文件头 ①~⑥。夹具全部真抓（2026-11-15）：
	//   · `pcr-tw-list`（第 1 页 10 条裁到 5 条：4116【更新】/4117/4115/4111【活動】/4106【轉蛋】）
	//   · `pcr-tw-detail-4106`（裁到 `<section class="news_con">`，卡池正文）
	//   · `pcr-tw-detail-4117`（裁到 section，活动的 `■販售期間`）
	//   · `pcr-tw-detail-4115`（**整页未裁**，故意的：导航里有个 `<h2 …>熱門遊戲</h2>` 排在正文之前，
	//     钉住"只认 section 里的 h2" —— 第一次活网跑出来 event = 熱門遊戲 就是这个坑）
	//   · `reso-home`（官网首页**头部原文 54,918 字符** = `var news_json` 语句之前；再接从同一响应
	//     第 2,880,537 字符处原样截出的 `var notice_json = JSON.parse("…")`：数组 100→8 条、
	//     每条 content 只留「起止时间」窗口段。**完整 7,451,933 B 未入库**，见 meta 的 truncation）
	//     ⚠️ 头部 100KB **不含** `notice_json`（它在 2.88MB 处），服务端又忽略 Range ⇒ 本段第一条反证
	//     就是"拿真头部去解析必然抛错"；活网 7.4MB 整页只取一次、缓存 24h（见文件头 ④）。
	section("2026-11-15 公主连结·繁中服（pcr-tw）+ 雷索纳斯（reso，官网首页内联 JSON）：真夹具逐字 + 年份 + 反证");
	{
		const PCR = T.parsers["pcr-tw"];
		const RESO = T.parsers.reso;
		const TZ_TW = "Asia/Taipei";
		const TZ_CN2 = "Asia/Shanghai";
		const PCR_LIST = PCR.PCR_TW_LIST_URL;
		const PCR_D_4106 = PCR.PCR_TW_DETAIL_BASE + "4106";
		const PCR_D_4117 = PCR.PCR_TW_DETAIL_BASE + "4117";
		const PCR_D_4115 = PCR.PCR_TW_DETAIL_BASE + "4115";
		const PCR_D_4111 = PCR.PCR_TW_DETAIL_BASE + "4111";
		const RESO_URL = RESO.RESO_URL;
		const ALL_IDS2 = T.SOURCES.map((x) => x.id);
		const norm = (u) => String(u).replace(/[?&]origin=\*/, "");
		const BODY2 = {
			[PCR_LIST]: FIX("pcr-tw-list"),
			[PCR_D_4106]: FIX("pcr-tw-detail-4106"),
			[PCR_D_4117]: FIX("pcr-tw-detail-4117"),
			[PCR_D_4115]: FIX("pcr-tw-detail-4115"),
			[RESO_URL]: FIX("reso-home")
		};
		// 记账 transport：`sink` = 实际发出去的地址；`refs` = 每条代理请求带的 Referer
		const transport2 = (sink, refs, overrides) => ({
			async fetchRaw(u) { throw new Error("两条来源都走宿主代理（mode=proxy）：" + u); },
			async fetchViaProxy(u, opts) {
				const url = norm(u);
				if (sink) sink.push(url);
				if (refs) refs.push({ url, referer: String((opts && opts.referer) || "") });
				if (overrides && overrides[url] != null) return overrides[url];
				if (BODY2[url] != null) return BODY2[url];
				throw new Error("pcr-tw / reso 用例没有这个 URL 的夹具：" + url);
			}
		});
		const engine2 = (now, sink, refs, overrides) => createEngine({
			transport: transport2(sink, refs, overrides),
			storage: makeStore({ hidden: ALL_IDS2.filter((id) => id !== "pcr-tw" && id !== "reso"), shown: ["pcr-tw", "reso"] }),
			now: () => now,
			timer: { setTimeout, clearTimeout }
		});
		// 只开 reso 的引擎（给"换个 now 看外显"的端到端用；两侧同一条 URL ⇒ 首轮仍只有 1 次请求）
		const engineReso = (now, sink, refs, overrides) => createEngine({
			transport: transport2(sink, refs, overrides),
			storage: makeStore({ hidden: ALL_IDS2.filter((id) => id !== "reso"), shown: ["reso"] }),
			now: () => now,
			timer: { setTimeout, clearTimeout }
		});
		// 夹具抓取那天（2026-11-15）上午：4117 的販售 16:00 才开 ⇒ 活动外显应是 4115 那条
		const NOW2 = Date.parse("2026-11-15T06:30:00+08:00");
		// reso 的"当期"：官网最新一条更新公告是 2025-12-23（id 290），窗口跨到 2026-01-12 ⇒
		// 用 2025-12-25 当 now 才能看到它（夹具抓取时刻 2026-11-15 时已全部结束，见 ⑧ 的反向断言）
		const NOW_RESO = Date.parse("2025-12-25T00:00:00+08:00");
		const errOf = (fn) => { try { fn(); return ""; } catch (e) { return String((e && e.message) || e); } };
		const throws2 = (fn) => { try { fn(); return false; } catch { return true; } };

		// ── ① 注册 ──
		const srcPcr = srcOf("pcr-tw");
		const srcReso = srcOf("reso");
		check("pcr-tw 注册：卡池与活动**同一条**列表 URL；标签逐字「官网公告」；tz = Asia/Taipei；出厂默认展示",
			!!srcPcr && srcPcr.url === PCR_LIST && srcPcr.eventUrl === PCR_LIST
			&& srcPcr.source === "官网公告" && srcPcr.eventSource === "官网公告"
			&& srcPcr.tz === TZ_TW && srcPcr.defaultHidden === false
			&& srcPcr.name === "公主连结Re:Dive·繁中服",
			srcPcr ? JSON.stringify([srcPcr.url, srcPcr.eventUrl, srcPcr.source, srcPcr.tz, srcPcr.name]) : "缺失");
		check("reso 注册：卡池与活动同一条**官网首页** URL；标签逐字「官网公告」；tz = Asia/Shanghai；默认展示",
			!!srcReso && srcReso.url === RESO_URL && srcReso.eventUrl === RESO_URL
			&& srcReso.source === "官网公告" && srcReso.eventSource === "官网公告"
			&& srcReso.tz === TZ_CN2 && srcReso.defaultHidden === false && srcReso.name === "雷索纳斯",
			srcReso ? JSON.stringify([srcReso.url, srcReso.eventUrl, srcReso.source, srcReso.tz]) : "缺失");
		check("两条都有配色（面板「颜色 = 游戏」）、不同色、id 全局唯一",
			!!srcPcr && !!srcReso && /^#[0-9A-F]{6}$/i.test(String(srcPcr.color))
			&& /^#[0-9A-F]{6}$/i.test(String(srcReso.color)) && srcPcr.color !== srcReso.color
			&& new Set(ALL_IDS2).size === ALL_IDS2.length,
			JSON.stringify([srcPcr && srcPcr.color, srcReso && srcReso.color]));
		check("reso 常量：URL / Referer 都是 https://soli-reso.com/；缓存 TTL ≥ 24h",
			RESO.RESO_URL === "https://soli-reso.com/" && RESO.RESO_REFERER === "https://soli-reso.com/"
			&& RESO.RESO_CACHE_TTL_MS >= 24 * 60 * 60 * 1000,
			JSON.stringify([RESO.RESO_URL, RESO.RESO_REFERER, RESO.RESO_CACHE_TTL_MS]));

		// ── ② pcr-tw：列表（类别只认标题前缀，不认 `ac0X`）──
		const pcrRows = PCR.pcrTwListOf(BODY2[PCR_LIST]);
		check("pcr 列表：5 条，按日期倒序（同日按 id 倒序：4117 排在 4116 前）",
			pcrRows.length === 5 && pcrRows.map((x) => x.id).join(",") === "4117,4116,4115,4111,4106",
			JSON.stringify(pcrRows.map((x) => x.id)));
		check("pcr 列表：`kind` 只按标题前缀分（`【轉蛋】`=4106 是 gacha，`活動` span 的 `ac0X` 类名不作数）",
			pcrRows.find((x) => x.id === "4106").kind === "gacha"
			&& pcrRows.find((x) => x.id === "4106").type === "活動"
			&& pcrRows.find((x) => x.id === "4115").kind === "event"
			&& pcrRows.find((x) => x.id === "4116").kind === "other"
			&& pcrRows.find((x) => x.id === "4111").kind === "event",
			JSON.stringify(pcrRows.map((x) => [x.id, x.type, x.kind])));
		check("pcr 列表日期 `2026.11.14` → Asia/Taipei 当日 00:00（= UTC 前一天 16:00）",
			pcrRows.find((x) => x.id === "4117").dateTs === Date.UTC(2026, 10, 13, 16, 0),
			String(pcrRows.find((x) => x.id === "4117").dateTs));

		// ── ③ pcr-tw：卡池详情（逐字）──
		const d4106 = PCR.pcrTwDetailOf(BODY2[PCR_D_4106], TZ_TW);
		check("pcr 详情 4106：窗口 1 条，名字取 `■精選轉蛋舉辦期間` 去尾缀 ⇒ 「精選轉蛋」",
			d4106.windows.length === 1 && d4106.windows[0].label === "精選轉蛋",
			JSON.stringify(d4106.windows.map((x) => x.label)));
		check("pcr 详情 4106：起止 = 2026-11-04 16:00 ~ 11-16 15:59 +08（UTC 手算 08:00 / 07:59）",
			d4106.windows[0].startTs === Date.UTC(2026, 10, 4, 8, 0)
			&& d4106.windows[0].endTs === Date.UTC(2026, 10, 16, 7, 59),
			JSON.stringify([d4106.windows[0].startTs, d4106.windows[0].endTs]));
		check("pcr 详情 4106：raw 保留源站原文、display 是补全后的可读文本（两份文本不混）",
			d4106.windows[0].raw === "2026/11/04 16:00 ~ 2026/11/16 15:59"
			&& d4106.windows[0].display === "11-04 16:00 ~ 11-16 15:59",
			JSON.stringify([d4106.windows[0].raw, d4106.windows[0].display]));
		const p4106 = PCR.pcrTwPoolItemsOf(d4106);
		check("pcr 卡池条目事实：banner「精選轉蛋」+ 角色「露易絲瑪莉（夏日）」（引号里的角色名取全名）",
			p4106.length === 1 && p4106[0].banner === "精選轉蛋" && p4106[0].roles === "露易絲瑪莉（夏日）",
			JSON.stringify(p4106.map((x) => [x.banner, x.roles])));
		check("pcr 页头陷阱：整页（未裁）里有 `<h2 …>熱門遊戲</h2>` 排在正文之前 ⇒ 只认 section 里的 h2",
			BODY2[PCR_D_4115].indexOf("熱門遊戲") > 0
			&& PCR.pcrTwDetailOf(BODY2[PCR_D_4115], TZ_TW).title.indexOf("熱門遊戲") < 0,
			JSON.stringify(PCR.pcrTwDetailOf(BODY2[PCR_D_4115], TZ_TW).title.slice(0, 40)));

		// ── ④ pcr-tw：活动详情（`■活動期間` / `■販售期間` 两个锚点都是通用词 ⇒ 名字退回标题派生）──
		const d4115 = PCR.pcrTwDetailOf(BODY2[PCR_D_4115], TZ_TW);
		const d4117 = PCR.pcrTwDetailOf(BODY2[PCR_D_4117], TZ_TW);
		check("pcr 详情 4115：`■活動期間` 是通用词 ⇒ label 留空，活动名走标题派生",
			d4115.windows.length === 1 && d4115.windows[0].label === "",
			JSON.stringify([d4115.windows.length, d4115.windows[0] && d4115.windows[0].label]));
		check("pcr 活动名：剥 `【活動】` + 尾巴（`舉辦預告` / `期間限定方式販售預告`），整名带引号就留里面",
			PCR.pcrTwTitleNameOf(d4115.title) === "「NORMAL」裝備道具、星素掉落量3倍・瑪那掉落量2倍"
			&& PCR.pcrTwTitleNameOf(d4117.title) === "官方 WebStore限定 每月主題禮包「究極鍊成」"
			&& PCR.pcrTwTitleNameOf("【活動】「艾爾皮斯討魔戰線」舉辦預告！") === "艾爾皮斯討魔戰線",
			JSON.stringify([PCR.pcrTwTitleNameOf(d4115.title), PCR.pcrTwTitleNameOf(d4117.title)]));
		check("pcr 详情 4117：`■販售期間` 的窗口照样解出来（2026-11-15 16:00 ~ 12-15 23:59 +08）",
			d4117.windows.length === 1
			&& d4117.windows[0].startTs === Date.UTC(2026, 10, 15, 8, 0)
			&& d4117.windows[0].endTs === Date.UTC(2026, 11, 15, 15, 59),
			JSON.stringify(d4117.windows));

		// ── ⑤ pcr-tw：端到端 + 请求预算（1 页 + 每侧 ≤2 篇详情；reso 首轮 1 次 / 稳态 0 次）──
		PCR.pcrTwResetCache();
		RESO.resoResetCache();
		const calls2 = [];
		const refs2 = [];
		const e2 = engine2(NOW2, calls2, refs2);
		const r2 = await e2.refresh();
		const recPcr = r2.games["pcr-tw"] || {};
		const recReso = r2.games.reso || {};
		check("首轮请求 = 5 次（pcr 列表 1 + 详情 3；reso 官网首页 1；两侧各只取自己的）",
			calls2.length === 5
			&& calls2.filter((u) => u === PCR_LIST).length === 1
			&& calls2.filter((u) => u === PCR_D_4106).length === 1
			&& calls2.filter((u) => u === PCR_D_4117).length === 1
			&& calls2.filter((u) => u === PCR_D_4115).length === 1
			&& calls2.filter((u) => u === RESO_URL).length === 1
			&& calls2.indexOf(PCR_D_4111) < 0,
			"requests=" + calls2.length + " " + JSON.stringify(calls2));
		check("pcr 卡池外显 = 精選轉蛋 / 露易絲瑪莉（夏日）/ 11-04 16:00 ~ 11-16 15:59",
			recPcr.banner === "精選轉蛋" && recPcr.roles === "露易絲瑪莉（夏日）"
			&& recPcr.bannerDates === "11-04 16:00 ~ 11-16 15:59"
			&& recPcr.bannerDatesRaw === "2026/11/04 16:00 ~ 2026/11/16 15:59" && recPcr.gachaFail === null,
			JSON.stringify([recPcr.banner, recPcr.roles, recPcr.bannerDates, recPcr.bannerDatesRaw]));
		check("pcr 活动外显 = 「NORMAL」裝備道具… / 11-15 05:00 ~ 11-21 04:59（4117 当天 16:00 才开 ⇒ 不进外显）",
			recPcr.event === "「NORMAL」裝備道具、星素掉落量3倍・瑪那掉落量2倍"
			&& recPcr.eventDates === "11-15 05:00 ~ 11-21 04:59" && recPcr.eventFail === null,
			JSON.stringify([recPcr.event, recPcr.eventDates, recPcr.eventFail]));
		check("pcr events[] 只有 1 条（4117 的窗口 16:00 才开，未覆盖 now ⇒ 如实不进数组）",
			Array.isArray(recPcr.events) && recPcr.events.length === 1
			&& recPcr.events[0].startTs === Date.UTC(2026, 10, 14, 21, 0)
			&& recPcr.events[0].endTs === Date.UTC(2026, 10, 20, 20, 59),
			JSON.stringify((recPcr.events || []).map((x) => [x.title, x.startTs, x.endTs])));
		check("pcr gacha[] 1 条（只有 1 口在期池 ⇒ 不设 bannerHover，交回 UI 两行式）",
			Array.isArray(recPcr.gacha) && recPcr.gacha.length === 1
			&& recPcr.gacha[0].title === "精選轉蛋" && !recPcr.bannerHover,
			JSON.stringify([(recPcr.gacha || []).map((x) => x.title), recPcr.bannerHover]));

		// 稳态：pcr 详情进缓存 / reso 整页解析结果进 24h 缓存 ⇒ 只剩 pcr 列表 1 次
		calls2.length = 0;
		const r2b = await e2.refresh();
		check("稳态第 2 轮 = 1 次（pcr 只列表 1；pcr 三篇详情 24h 缓存 + reso 首页解析结果 24h 缓存）",
			calls2.length === 1 && calls2.filter((u) => u === PCR_LIST).length === 1
			&& calls2.filter((u) => u.indexOf("/news/newsDetail/") >= 0).length === 0
			&& calls2.filter((u) => u === RESO_URL).length === 0
			&& (r2b.games["pcr-tw"] || {}).banner === recPcr.banner,
			"requests=" + calls2.length + " " + JSON.stringify(calls2));
		check("两条来源的每个代理请求都带了 Referer（pcr 带官网首页；reso 带 soli-reso.com 首页）",
			refs2.length > 0 && refs2.every((x) => x.referer !== "")
			&& refs2.filter((x) => x.url.indexOf("soli-reso.com") >= 0).every((x) => x.referer === "https://soli-reso.com/")
			&& refs2.filter((x) => x.url.indexOf("princessconnect") >= 0).every((x) => x.referer === "https://www.princessconnect.so-net.tw/"),
			JSON.stringify(refs2.slice(0, 3)));
		// NOW2（夹具抓取时刻）下 reso 官网最新公告窗口已全部结束 ⇒ 卡池/活动都如实 nomatch（见文件头 ⑥）
		check("reso 在夹具抓取时刻（2026-11-15）：最新公告（2025-12-23）窗口已全部结束 ⇒ 卡池与活动都 nomatch",
			recReso.banner === "" && String((recReso.gachaFail || {}).kind) === "nomatch"
			&& recReso.event === "" && String((recReso.eventFail || {}).kind) === "nomatch",
			JSON.stringify([recReso.banner, recReso.gachaFail, recReso.event, recReso.eventFail]));

		// ── ⑥ reso：首页内联 JSON（双重转义 ⇒ 两次 JSON.parse）──
		const resoHome = BODY2[RESO_URL];
		const resoNotices = RESO.resoNoticesOf(resoHome);
		check("reso 内联 notice_json：双重转义（\\u0022 等）⇒ 两次 JSON.parse 才拿到数组；夹具 8 条公告",
			Array.isArray(resoNotices) && resoNotices.length === 8,
			JSON.stringify([Array.isArray(resoNotices), resoNotices && resoNotices.length]));
		check("reso 公告字段逐字（id / update_time / pub_date / title）与最新 id = 290",
			resoNotices[0].id === 290 && resoNotices[0].update_time === "2025-12-23"
			&& resoNotices[0].pub_date === "2025-12-23"
			&& resoNotices[0].title === "《雷索纳斯》12月22日更新公告"
			&& RESO.resoNewestIdOf(resoNotices) === 290,
			JSON.stringify([resoNotices[0].id, resoNotices[0].update_time, resoNotices[0].title, RESO.resoNewestIdOf(resoNotices)]));
		check("reso 年份线索取 `pub_date` 优先（缺失退回 `update_time`）；取不到 ⇒ null",
			(() => {
				const h = RESO.resoYearHintOf(resoNotices[0]);
				return h && h.y === 2025 && h.mo === 12;
			})()
			&& RESO.resoYearHintOf({ pub_date: "2024-03-15" }).y === 2024
			&& RESO.resoYearHintOf({ update_time: "2023-01-09" }).y === 2023
			&& RESO.resoYearHintOf({}) === null && RESO.resoYearHintOf({ pub_date: "not-a-date" }) === null,
			JSON.stringify([RESO.resoYearHintOf(resoNotices[0]), RESO.resoYearHintOf({})]));
		check("reso 头部原文（前 54,918 字符 = 真抓页面头部 100KB 的前段）**不含** notice_json（实测它在第 2,880,537 字符处；服务端忽略 Range）⇒ 拿头部解析必然抛错",
			!resoHome.slice(0, 54918).includes("var notice_json")
			&& errOf(() => RESO.resoNoticesOf(resoHome.slice(0, 54918))) === "reso-home-changed:no-notice-json",
			JSON.stringify([resoHome.indexOf("var notice_json"), errOf(() => RESO.resoNoticesOf(resoHome.slice(0, 54918))) ]));

		// ── ⑦ reso：`起止时间` 窗口逐条（14 条 / 7 种写法 / 显式年 / 跨年 / 角色行）──
		const resoRows = RESO.resoRowsOf(resoNotices, TZ_CN2);
		check("reso 窗口 14 条（8 条公告里 7 种起止写法 + 多池公告），全部是卡池、活动 0 条",
			resoRows.length === 14 && resoRows.every((x) => x.kind === "gacha")
			&& RESO.resoRowsOf(resoNotices, TZ_CN2).filter((x) => x.kind === "event").length === 0,
			JSON.stringify([resoRows.length, resoRows.filter((x) => x.kind === "event").length]));
		check("reso 窗口逐字（banner / 角色 / 源站原文）：专列招募 时萝 / 常驻招募 苏恩 / 专列招募·净灭八苦 乌刹娜",
			resoRows[0].banner === "专列招募" && resoRows[0].roles === "时萝"
			&& resoRows[0].raw === "12月22日更新后 - 1月12日 12:00" && resoRows[0].rawText === "12月22日更新后 ~ 1月12日 12:00"
			&& resoRows[1].banner === "常驻招募" && resoRows[1].roles === "苏恩"
			&& resoRows[12].banner === "特设招募·净灭八苦" && resoRows[12].roles === "乌刹娜"
			&& resoRows[12].raw === "2025年1月23日 12:00 - 2025年2月19日 12:00",
			JSON.stringify(resoRows.map((x) => [x.banner, x.roles, x.raw])));
		check("reso 窗口绝对时刻（+08 手算）：跨年 2025-12-22 00:00 ~ 2026-01-12 12:00；显式年 2025-01-23 12:00 ~ 02-19 12:00",
			resoRows[0].startTs === Date.UTC(2025, 11, 21, 16, 0) && resoRows[0].endTs === Date.UTC(2026, 0, 12, 4, 0)
			&& resoRows[0].display === "2025-12-22 00:00 ~ 2026-01-12 12:00"
			&& resoRows[12].startTs === Date.UTC(2025, 0, 23, 4, 0) && resoRows[12].endTs === Date.UTC(2025, 1, 19, 4, 0),
			JSON.stringify([resoRows[0].startTs, resoRows[0].endTs, resoRows[12].startTs, resoRows[12].endTs]));
		check("reso 写法变体：起点带钟点 `7月11日 12:00 - 7月18日 12:00` ⇒ 12:00 起（不是 00:00）；「更新后」无钟点 ⇒ 00:00",
			resoRows[6].startTs === Date.UTC(2025, 6, 11, 4, 0) && resoRows[6].endTs === Date.UTC(2025, 6, 18, 4, 0)
			&& resoRows[7].raw === "7月11日 12:00- 7月18日 12:00"
			&& resoRows[8].raw === "6月15日 更新后-7月15日 12:00"
			&& resoRows[8].startTs === Date.UTC(2025, 5, 14, 16, 0),
			JSON.stringify([resoRows[6].startTs, resoRows[6].endTs, resoRows[8].startTs]));
		check("reso 角色行三种写法都认：`SSR X` / `SSR “池名”X`（去引号池名）/ `X 获得概率提升`",
			resoRows[3].roles === "隼" && resoRows[9].roles === "静流·逐夏"
			&& resoRows[13].roles === "罗洁尔·定格" && resoRows[10].roles === "隼",
			JSON.stringify(resoRows.map((x) => x.roles)));
		check("reso 窗口变体逐字：7 种写法都能解（跨年 / 前导 0 / 显式年 / 起点带钟点 / 更新后无空格 / 同日多池）",
			[
				"12月22日更新后 - 1月12日 12:00",
				"12月02日更新后 - 12月22日 12:00",
				"11月26日更新后 - 12月17日 12:00",
				"7月11日 12:00 - 7月18日 12:00",
				"6月15日 更新后-7月15日 12:00",
				"5月23日 更新后 - 5月30日 12:00",
				"2025年1月23日 12:00 - 2025年2月19日 12:00"
			].every((raw) => resoRows.some((x) => x.raw === raw)),
			JSON.stringify(resoRows.map((x) => x.raw)));

		// ── ⑧ reso：年份补全（显式年 / inferYear 上一年 / 跨年镜像 / endsNextYear）──
		check("reso 补年份：显式 4 位年优先（不看线索）；无显式年时按公告月补齐",
			RESO.resoStartYearOf(1, { y: 2025, mo: 6 }, 2019) === 2019
			&& RESO.resoStartYearOf(12, { y: 2025, mo: 12 }) === 2025
			&& RESO.resoStartYearOf(2, { y: 2025, mo: 2 }) === 2025,
			JSON.stringify([RESO.resoStartYearOf(1, { y: 2025, mo: 6 }, 2019), RESO.resoStartYearOf(12, { y: 2025, mo: 12 })]));
		check("reso 补年份（上一年）：1 月公告里写 `12.28` ⇒ 去年（共用 inferYear + YEAR_HINT_MONTH_GAP）",
			RESO.resoStartYearOf(12, { y: 2026, mo: 1 }) === 2025, String(RESO.resoStartYearOf(12, { y: 2026, mo: 1 })));
		check("reso 补年份（次年镜像）：12 月公告里写 `01.10` ⇒ 次年（滚动读公告的镜像规则）",
			RESO.resoStartYearOf(1, { y: 2026, mo: 12 }) === 2027, String(RESO.resoStartYearOf(1, { y: 2026, mo: 12 })));
		check("reso 补年份：**线索拿不到就一条都不出**（不留错年份）—— 没线索 / 线索不是有限数 / 月份不是数",
			RESO.resoStartYearOf(10, null) === null && RESO.resoStartYearOf(10, {}) === null
			&& RESO.resoStartYearOf(10, { y: NaN, mo: 10 }) === null
			&& RESO.resoStartYearOf(Number.NaN, { y: 2026, mo: 10 }) === null
			&& RESO.resoRowsOf([{ id: 1, content: "<p>【专列招募】</p><p>起止时间：</p><p>12月22日更新后 - 1月12日 12:00</p>" }], TZ_CN2).length === 0,
			JSON.stringify([RESO.resoStartYearOf(10, null), RESO.resoStartYearOf(10, {})]));
		check("reso 跨年：`12月22日 - 1月12日` ⇒ 终点补到次年（共用 endsNextYear）",
			(resoRows[0].endTs - resoRows[0].startTs) > 0
			&& new Date(resoRows[0].endTs).getUTCFullYear() === 2026,
			String(resoRows[0].endTs));
		check("reso 窗口解析器逐字：起/止年份、时、分都从原文取（含全角/半角冒号）",
			(() => {
				const w = RESO.resoWindowOf("2025年1月23日 12:00 - 2025年2月19日 12:00");
				return !!w && w.sy === 2025 && w.sm === 1 && w.sd === 23 && w.sh === 12 && w.smi === 0
					&& w.ey === 2025 && w.em === 2 && w.ed === 19 && w.eh === 12 && w.emi === 0;
			})()
			&& (() => {
				const w = RESO.resoWindowOf("6月15日 更新后-7月15日 12：00");
				return !!w && w.sy === null && w.sh === null && w.eh === 12 && w.emi === 0;
			})(),
			JSON.stringify(RESO.resoWindowOf("2025年1月23日 12:00 - 2025年2月19日 12:00")));
		check("reso 活动窗口：标签不是招募但含「活动」⇒ 归活动（用标签与锚点之间的行当名字）；本期夹具里 0 条",
			(() => {
				const html = "var notice_json = JSON.parse(" + JSON.stringify(JSON.stringify([{
					id: 1, pub_date: "2025-12-23",
					content: "<p>【限时活动】</p><p>冬日大冒险</p><p>起止时间：</p><p>12月22日更新后 - 1月5日 12:00</p>"
				}])) + ");";
				const rows = RESO.resoRowsOf(RESO.resoNoticesOf(html), TZ_CN2);
				return rows.length === 1 && rows[0].kind === "event" && rows[0].event === "冬日大冒险"
					&& rows[0].startTs === Date.UTC(2025, 11, 21, 16, 0) && rows[0].endTs === Date.UTC(2026, 0, 5, 4, 0);
			})(),
			JSON.stringify(RESO.resoRowsOf(resoNotices, TZ_CN2).filter((x) => x.kind === "event")));

		// ── ⑨ reso：端到端（把 now 钉到 2025-12-25 ⇒ 官网最新公告的两口池在期）──
		RESO.resoResetCache();
		const callsReso = [];
		const eReso = engineReso(NOW_RESO, callsReso);
		const rReso = await eReso.refresh();
		const recResoNow = rReso.games.reso || {};
		check("reso 首轮请求 = 1（官网首页整页 1 次；卡池与活动两侧同一份数据、轮内共享）",
			callsReso.length === 1 && callsReso[0] === RESO_URL, JSON.stringify(callsReso));
		check("reso 卡池外显 = 结束最早的在期池（常驻招募 / 苏恩 / 12-22 00:00 ~ 12-29 12:00）",
			recResoNow.banner === "常驻招募" && recResoNow.roles === "苏恩"
			&& recResoNow.bannerDates === "12-22 00:00 ~ 12-29 12:00"
			&& recResoNow.bannerDatesRaw === "12月22日更新后 ~ 12月29日 12:00" && recResoNow.gachaFail === null,
			JSON.stringify([recResoNow.banner, recResoNow.roles, recResoNow.bannerDates, recResoNow.bannerDatesRaw]));
		check("reso 卡池悬停逐字（两行「池名：角色」+ 各自档期；含「更新后」的行按仓库口径写源站原文）",
			recResoNow.bannerHover === "常驻招募：苏恩\n12月22日更新后 ~ 12月29日 12:00\n专列招募：时萝\n12月22日更新后 ~ 1月12日 12:00",
			JSON.stringify(recResoNow.bannerHover));
		if (recResoNow.bannerHover) assertHoverConvention("reso 卡池", recResoNow.bannerHover, { requireSet: true });
		check("reso 卡池数组 2 条在期（常驻招募 苏恩 / 专列招募 时萝），key 前缀 = reso:gacha、绝对时刻 +08 手算",
			Array.isArray(recResoNow.gacha) && recResoNow.gacha.length === 2
			&& recResoNow.gacha[0].key === "reso:gacha:0" && recResoNow.gacha[0].endTs === Date.UTC(2025, 11, 29, 4, 0)
			&& recResoNow.gacha[1].key === "reso:gacha:1" && recResoNow.gacha[1].endTs === Date.UTC(2026, 0, 12, 4, 0),
			JSON.stringify((recResoNow.gacha || []).map((x) => [x.key, x.title, x.startTs, x.endTs])));
		check("reso 活动侧如实 null（本期公告 0 条「起止时间」活动 = nomatch，不是失败、也不是未配置）",
			recResoNow.event === "" && String((recResoNow.eventFail || {}).kind) === "nomatch"
			&& (!Array.isArray(recResoNow.events) || recResoNow.events.length === 0),
			JSON.stringify([recResoNow.event, recResoNow.eventFail]));

		// ── ⑩ 反证（结构变了要看得见；抹掉时间锚点 ⇒ 不进外显）──
		check("pcr 反证：`{}` / 空串 / 没有 `<article>` / article 里一条都没有 ⇒ 抛错（不是 nomatch）",
			throws2(() => PCR.pcrTwListOf({})) && throws2(() => PCR.pcrTwListOf(""))
			&& throws2(() => PCR.pcrTwListOf("<html><body>改版页</body></html>"))
			&& throws2(() => PCR.pcrTwListOf('<article class="news_con"><ul></ul></article>')));
		check("pcr 反证：详情 `{}` / 空串 / 没有 section / 没有 h2 / 没有 news-body ⇒ 抛错",
			throws2(() => PCR.pcrTwDetailOf({})) && throws2(() => PCR.pcrTwDetailOf(""))
			&& throws2(() => PCR.pcrTwDetailOf("<section>x</section>"))
			&& throws2(() => PCR.pcrTwDetailOf('<section class="news_con"><div class="news-body">x</div></section>'))
			&& throws2(() => PCR.pcrTwDetailOf('<section class="news_con"><h2>t</h2></section>')));
		// 抹掉"整行区间"（把全角 `～` 换成 `至`）⇒ 这一篇不出任何窗口（不进外显，但**不抛**）
		const noRange = BODY2[PCR_D_4106].replace(/～/g, "至");
		check("pcr 反证：抹掉区间分隔符 ⇒ 这篇 0 个窗口（不进外显，也不算失败）",
			PCR.pcrTwDetailOf(noRange, TZ_TW).windows.length === 0
			&& PCR.pcrTwPoolItemsOf(PCR.pcrTwDetailOf(noRange, TZ_TW)).length === 0,
			JSON.stringify(PCR.pcrTwDetailOf(noRange, TZ_TW).windows));
		PCR.pcrTwResetCache();
		const eNoRange = engine2(NOW2, null, null, { [PCR_D_4106]: noRange });
		const rNoRange = await eNoRange.refresh();
		check("pcr 反证（端到端）：卡池那篇没有窗口 ⇒ 卡池如实 nomatch（不硬凑过期档期）",
			((rNoRange.games["pcr-tw"] || {}).banner) === ""
			&& String((((rNoRange.games["pcr-tw"] || {}).gachaFail) || {}).kind) === "nomatch",
			JSON.stringify([(rNoRange.games["pcr-tw"] || {}).banner, (rNoRange.games["pcr-tw"] || {}).gachaFail]));
		// 详情全失败（源站回 `{}`）⇒ 记 down（抓取失败 ≠ 未公布）
		PCR.pcrTwResetCache();
		const eDown = engine2(NOW2, null, null, { [PCR_LIST]: "{}", [RESO_URL]: "{}" });
		const rDown = await eDown.refresh();
		check("反证（端到端）：pcr 列表 `{}` / reso 首页 `{}` ⇒ 两侧都记 **down**（不是 nomatch）",
			String((((rDown.games["pcr-tw"] || {}).gachaFail) || {}).kind) === "down"
			&& String((((rDown.games["pcr-tw"] || {}).eventFail) || {}).kind) === "down"
			&& String((((rDown.games.reso || {}).gachaFail) || {}).kind) === "down"
			&& String((((rDown.games.reso || {}).eventFail) || {}).kind) === "down",
			JSON.stringify([(rDown.games["pcr-tw"] || {}).gachaFail, (rDown.games.reso || {}).gachaFail]));
		// reso：首页没有内联 JSON / 两次 JSON.parse 失败 ⇒ 抛错（结构变了 = down，不是"当期没有"）
		check("reso 反证：空串 / `{}` / 改版页 / 没有 notice_json / 内层不是数组 / 两次 parse 失败 ⇒ 抛错",
			errOf(() => RESO.resoNoticesOf("")) === "reso-home-changed:empty"
			&& errOf(() => RESO.resoNoticesOf("{}")) === "reso-home-changed:no-notice-json"
			&& errOf(() => RESO.resoNoticesOf("<html><body>改版页</body></html>")) === "reso-home-changed:no-notice-json"
			&& errOf(() => RESO.resoNoticesOf('var news_json = JSON.parse("[]");')) === "reso-home-changed:no-notice-json"
			&& errOf(() => RESO.resoNoticesOf('var notice_json = JSON.parse("{bad");')) === "reso-home-changed:bad-notice-json"
			&& errOf(() => RESO.resoNoticesOf('var notice_json = JSON.parse("{}");')) === "reso-home-changed:bad-notice-json",
			JSON.stringify([
				errOf(() => RESO.resoNoticesOf("")), errOf(() => RESO.resoNoticesOf("{}")),
				errOf(() => RESO.resoNoticesOf('var notice_json = JSON.parse("{bad");'))
			]));
		// 抹掉 `起止时间` ⇒ 窗口 0 条 ⇒ 端到端如实 nomatch（"宁缺勿造"）
		const strippedNotices = resoNotices.map((n) => ({ ...n, content: String(n.content).replace(/起止时间/g, "时间") }));
		check("reso 反证：抹掉 `起止时间` ⇒ 窗口 0 条（不进外显）；公告本身还在（不是解析失败）",
			RESO.resoRowsOf(strippedNotices, TZ_CN2).length === 0
			&& RESO.resoItemsOf(RESO.resoRowsOf(strippedNotices, TZ_CN2), "gacha").length === 0
			&& strippedNotices.length === resoNotices.length,
			JSON.stringify([RESO.resoRowsOf(strippedNotices, TZ_CN2).length, strippedNotices.length]));
		const strippedHome = "var notice_json = JSON.parse(" + JSON.stringify(JSON.stringify(strippedNotices)) + ");";
		RESO.resoResetCache();
		const eStripped = engineReso(NOW_RESO, null, null, { [RESO_URL]: strippedHome });
		const rStripped = await eStripped.refresh();
		check("reso 反证（端到端）：抹掉 `起止时间` 后没有窗口 ⇒ 卡池如实 nomatch（不硬凑过期档期）",
			((rStripped.games.reso || {}).banner) === ""
			&& String((((rStripped.games.reso || {}).gachaFail) || {}).kind) === "nomatch",
			JSON.stringify([(rStripped.games.reso || {}).banner, (rStripped.games.reso || {}).gachaFail]));
		// 首页改成"没有内联 JSON 的改版页" ⇒ down（不是 nomatch）
		RESO.resoResetCache();
		const eChanged = engineReso(NOW_RESO, null, null, { [RESO_URL]: "<html><body>改版页</body></html>" });
		const rChanged = await eChanged.refresh();
		check("reso 反证（端到端）：首页没有 notice_json ⇒ 记 **down**（结构变了 ≠ 当期没有）",
			String((((rChanged.games.reso || {}).gachaFail) || {}).kind) === "down"
			&& String((((rChanged.games.reso || {}).eventFail) || {}).kind) === "down",
			JSON.stringify([(rChanged.games.reso || {}).gachaFail, (rChanged.games.reso || {}).eventFail]));
		RESO.resoResetCache();
		PCR.pcrTwResetCache();
	}

	// ───────── ⑩ 2026-11-15：幻塔（tof，国服官网 gamenews，**只有卡池侧**）─────────
	// 落点：`src/client/30-game-tof.js`（厂商级，一条来源）。
	// 夹具全部真抓（2026-11-15）：
	//   · `tof-list`（第 1 页 6 条版本公告裁到前 3 条：6.5 / 6.4 / 6.3；页脚页码表逐字未改）
	//   · `tof-detail-264766`（6.5「时间背面的谜底」：黑利·佩茵特 / 圣谕权杖 / 10-28 12:00 ~ 12-16 04:59）
	//   · `tof-detail-264156`（6.4「命运交叉的时空」：芮娜 / 破空 / 09-16 12:00 ~ 10-28 04:59）——
	//     刻意留两版：证明正则不是只对"当前那一篇"成立（6.4 的月/日是**不补零**写法 `9月16日`）。
	section("2026-11-15 幻塔（tof）：列表 + 6.5/6.4 两版逐字 + 请求 2→1 + 反证");
	{
		const TOF = T.parsers.tof;
		const TZ_CN3 = "Asia/Shanghai";
		const TOF_LIST = TOF.TOF_LIST_URL;
		const TOF_D_264766 = "https://ht.wanmei.com/news/gamenews/20261027/264766.html";
		const TOF_D_264156 = "https://ht.wanmei.com/news/gamenews/20260915/264156.html";
		const ALL_IDS3 = T.SOURCES.map((x) => x.id);
		const BODY3 = {
			[TOF_LIST]: FIX("tof-list"),
			[TOF_D_264766]: FIX("tof-detail-264766"),
			[TOF_D_264156]: FIX("tof-detail-264156")
		};
		// 记账 transport：`sink` = 实际发出去的地址；`refs` = 每条代理请求带的 Referer
		const transport3 = (sink, refs, overrides) => ({
			async fetchRaw(u) { throw new Error("幻塔走宿主代理（mode=proxy）：" + u); },
			async fetchViaProxy(u, opts) {
				const url = String(u);
				if (sink) sink.push(url);
				if (refs) refs.push({ url, referer: String((opts && opts.referer) || "") });
				if (overrides && overrides[url] != null) return overrides[url];
				if (BODY3[url] != null) return BODY3[url];
				throw new Error("tof 用例没有这个 URL 的夹具：" + url);
			}
		});
		const engine3 = (now, sink, refs, overrides) => createEngine({
			transport: transport3(sink, refs, overrides),
			storage: makeStore({ hidden: ALL_IDS3.filter((id) => id !== "tof"), shown: ["tof"] }),
			now: () => now,
			timer: { setTimeout, clearTimeout }
		});
		// 夹具抓取那天上午（6.5 的池 10-28 12:00 已开，12-16 04:59 才收）
		const NOW3 = Date.parse("2026-11-15T07:20:00+08:00");

		// ── ① 注册（只有卡池侧；活动 = 未配置，不是失败）──
		const srcTof = srcOf("tof");
		check("tof 注册：卡池 = gamenews 列表；标签逐字「官网公告」；tz = Asia/Shanghai；出厂默认展示；活动侧 url 为空（未配置）",
			!!srcTof && srcTof.url === TOF_LIST && srcTof.eventUrl === ""
			&& srcTof.source === "官网公告" && srcTof.eventSource === void 0
			&& srcTof.tz === TZ_CN3 && srcTof.defaultHidden === false && srcTof.name === "幻塔",
			srcTof ? JSON.stringify([srcTof.url, srcTof.eventUrl, srcTof.source, srcTof.tz]) : "缺失");
		check("tof 只登记卡池抓取器（`GACHA_FETCHERS.tof` 是函数、`EVENT_FETCHERS.tof` 不存在）",
			typeof T.GACHA_FETCHERS.tof === "function" && !T.EVENT_FETCHERS.tof,
			JSON.stringify([typeof T.GACHA_FETCHERS.tof, typeof T.EVENT_FETCHERS.tof]));
		check("tof 有配色（面板「颜色 = 游戏」）、id 全局唯一",
			!!srcTof && /^#[0-9A-F]{6}$/i.test(String(srcTof.color))
			&& new Set(ALL_IDS3).size === ALL_IDS3.length,
			JSON.stringify([srcTof && srcTof.color]));

		// ── ② 列表（3 条版本公告，按日期倒序）──
		const tofRows = TOF.tofListOf(BODY3[TOF_LIST]);
		check("tof 列表：3 条，按日期倒序 264766 / 264156 / 263524，版本号 6.5 / 6.4 / 6.3",
			tofRows.length === 3 && tofRows.map((x) => x.id).join(",") === "264766,264156,263524"
			&& tofRows.map((x) => x.version).join(",") === "6.5,6.4,6.3",
			JSON.stringify(tofRows.map((x) => [x.id, x.version])));
		check("tof 列表：栏目逐字「[新闻]」，详情 URL 补成绝对地址（源站写的是 `/news/gamenews/…`）",
			tofRows.every((x) => x.label === "[新闻]") && tofRows[0].url === TOF_D_264766
			&& tofRows[1].url === TOF_D_264156,
			JSON.stringify(tofRows.map((x) => [x.label, x.url])));
		check("tof 列表日期 `2026-10-28` → Asia/Shanghai 当日 00:00（= UTC 前一天 16:00）",
			tofRows[0].dateTs === Date.UTC(2026, 9, 27, 16, 0), String(tofRows[0].dateTs));
		check("tof 最新版本那一行 = 6.5（264766）；把版本号抹掉（改成普通公告）⇒ 选不出行（null，不是抛）",
			TOF.tofVersionRowOf(tofRows).id === "264766"
			&& TOF.tofVersionRowOf(tofRows.map((r) => ({ ...r, version: "" }))) === null,
			JSON.stringify(TOF.tofVersionRowOf(tofRows) && TOF.tofVersionRowOf(tofRows).id));

		// ── ③ 6.5 正文逐字（池名 + 角色 + 武器 + 起止到分）──
		const d65 = TOF.tofDetailOf(BODY3[TOF_D_264766], TZ_CN3);
		check("tof 详情 6.5：标题 / 页头日期逐字",
			d65.title === "时间背面的谜底 《幻塔》6.5全新版本今日上线" && d65.date === "2026-10-28",
			JSON.stringify([d65.title, d65.date]));
		check("tof 详情 6.5：1 口池 —— 池名「黑利·佩茵特订购活动」/ 角色「黑利·佩茵特」/ 武器「圣谕权杖」",
			d65.pools.length === 1 && d65.pools[0].banner === "黑利·佩茵特订购活动"
			&& d65.pools[0].role === "黑利·佩茵特" && d65.pools[0].weapon === "圣谕权杖",
			JSON.stringify(d65.pools.map((x) => [x.banner, x.role, x.weapon])));
		check("tof 详情 6.5：起止 = 2026-10-28 12:00 ~ 12-16 04:59 +08（UTC 手算 04:00 / 20:59）",
			d65.pools[0].startTs === Date.UTC(2026, 9, 28, 4, 0)
			&& d65.pools[0].endTs === Date.UTC(2026, 11, 15, 20, 59),
			JSON.stringify([d65.pools[0].startTs, d65.pools[0].endTs]));
		check("tof 详情 6.5：raw 保留源站原文、display 是补全后的可读文本（两份文本不混）",
			d65.pools[0].raw === "2026年10月28日12:00-2026年12月16日04:59"
			&& d65.pools[0].display === "10-28 12:00 ~ 12-16 04:59",
			JSON.stringify([d65.pools[0].raw, d65.pools[0].display]));

		// ── ④ 6.4 正文（证明正则不是只对当前那一版成立：月/日不补零）──
		const d64 = TOF.tofDetailOf(BODY3[TOF_D_264156], TZ_CN3);
		check("tof 详情 6.4：芮娜 / 破空 /「芮娜订购活动」；`2026年9月16日12:00-2026年10月28日04:59` 解成 09-16 12:00 ~ 10-28 04:59",
			d64.pools.length === 1 && d64.pools[0].banner === "芮娜订购活动"
			&& d64.pools[0].role === "芮娜" && d64.pools[0].weapon === "破空"
			&& d64.pools[0].raw === "2026年9月16日12:00-2026年10月28日04:59"
			&& d64.pools[0].startTs === Date.UTC(2026, 8, 16, 4, 0)
			&& d64.pools[0].endTs === Date.UTC(2026, 9, 27, 20, 59)
			&& d64.pools[0].display === "09-16 12:00 ~ 10-28 04:59",
			JSON.stringify(d64.pools));
		check("tof 条目事实：`roles` = 角色名、`isMain` = true、**武器不进条目事实**（载荷不新造字段）",
			(() => {
				const it = TOF.tofPoolItemsOf(d65)[0];
				return !!it && it.roles === "黑利·佩茵特" && it.isMain === true && it.banner === "黑利·佩茵特订购活动"
					&& it.raw === "2026年10月28日12:00-2026年12月16日04:59" && !("weapon" in it);
			})(),
			JSON.stringify(TOF.tofPoolItemsOf(d65)[0]));

		// ── ⑤ 端到端 + 请求预算（列表 1 + 只对最新版本那篇取详情 1）──
		TOF.tofResetCache();
		const calls3 = [];
		const refs3 = [];
		const e3 = engine3(NOW3, calls3, refs3);
		const r3 = await e3.refresh();
		const recTof = r3.games.tof || {};
		check("tof 首轮请求 = 2 次（列表 1 + 6.5 那篇详情 1；6.4 那篇**不取**）",
			calls3.length === 2 && calls3.filter((u) => u === TOF_LIST).length === 1
			&& calls3.filter((u) => u === TOF_D_264766).length === 1
			&& calls3.indexOf(TOF_D_264156) < 0,
			"requests=" + calls3.length + " " + JSON.stringify(calls3));
		check("tof 卡池外显 = 黑利·佩茵特订购活动 / 黑利·佩茵特 / 10-28 12:00 ~ 12-16 04:59",
			recTof.banner === "黑利·佩茵特订购活动" && recTof.roles === "黑利·佩茵特"
			&& recTof.bannerDates === "10-28 12:00 ~ 12-16 04:59"
			&& recTof.bannerDatesRaw === "2026年10月28日12:00-2026年12月16日04:59"
			&& recTof.gachaFail === null,
			JSON.stringify([recTof.banner, recTof.roles, recTof.bannerDates, recTof.bannerDatesRaw]));
		check("tof gacha[] 1 条（只有 1 口在期池 ⇒ 不设 bannerHover，交回 UI 两行式；key 前缀 tof）",
			Array.isArray(recTof.gacha) && recTof.gacha.length === 1
			&& recTof.gacha[0].key === "tof:gacha:0" && !recTof.bannerHover
			&& recTof.gacha[0].endTs === Date.UTC(2026, 11, 15, 20, 59),
			JSON.stringify([(recTof.gacha || []).map((x) => [x.key, x.title, x.endTs]), recTof.bannerHover]));
		check("tof 活动侧如实「未配置」：event / eventDates 空串、**没有** eventFail（不抓取、不算失败）",
			recTof.event === "" && recTof.eventDates === "" && recTof.eventFail == null
			&& (!Array.isArray(recTof.events) || recTof.events.length === 0),
			JSON.stringify([recTof.event, recTof.eventDates, recTof.eventFail]));
		// 稳态：详情进缓存 ⇒ 只发列表
		calls3.length = 0;
		const r3b = await e3.refresh();
		check("tof 稳态第 2 轮 = 1 次（只列表；详情按 URL 缓存 24h）",
			calls3.length === 1 && calls3[0] === TOF_LIST
			&& (r3b.games.tof || {}).banner === recTof.banner,
			"requests=" + calls3.length + " " + JSON.stringify(calls3));
		check("tof 每个代理请求都带 `Referer: https://ht.wanmei.com/`",
			refs3.length > 0 && refs3.every((x) => x.referer === "https://ht.wanmei.com/"),
			JSON.stringify(refs3.slice(0, 2)));

		// ── ⑥ 反证（结构变了要看得见；抹掉时间锚点 ⇒ 不进外显）──
		const throws3 = (fn) => { try { fn(); return false; } catch { return true; } };
		check("tof 反证：列表 `{}` / 空串 / 没有 `.list` 容器 / 容器里一条都没有 ⇒ 抛错（不是 nomatch）",
			throws3(() => TOF.tofListOf({})) && throws3(() => TOF.tofListOf(""))
			&& throws3(() => TOF.tofListOf("<html><body>改版页</body></html>"))
			&& throws3(() => TOF.tofListOf('<div class="list"><div class="page"></div></div>')));
		check("tof 反证：详情 `{}` / 空串 / 没有 text_cont / 没有 h1 ⇒ 抛错",
			throws3(() => TOF.tofDetailOf({})) && throws3(() => TOF.tofDetailOf(""))
			&& throws3(() => TOF.tofDetailOf('<h1>只有标题</h1>'))
			&& throws3(() => TOF.tofDetailOf('<div class="text_cont"><p>正文</p></div>')));
		// 抹掉「正式服活动时间」这个唯一时间锚 ⇒ 这一篇 0 个窗口（不进外显，但**不抛**）
		const noLabel = BODY3[TOF_D_264766].replace(/正式服活动时间/g, "活动时间");
		check("tof 反证：抹掉「正式服活动时间」⇒ 这篇 0 个窗口（不进外显，也不算失败）",
			TOF.tofDetailOf(noLabel, TZ_CN3).pools.length === 0
			&& TOF.tofPoolItemsOf(TOF.tofDetailOf(noLabel, TZ_CN3)).length === 0,
			JSON.stringify(TOF.tofDetailOf(noLabel, TZ_CN3).pools));
		// 只留起点、抹掉终点 ⇒ 两端不齐 ⇒ 不认（不拿"下一次版本"凑终点）
		const noEnd = BODY3[TOF_D_264766].replace("2026年12月16日04:59", "");
		check("tof 反证：只有起点没有终点 ⇒ 0 口池（仓库口径：两端都明确才算池）",
			TOF.tofDetailOf(noEnd, TZ_CN3).pools.length === 0,
			JSON.stringify(TOF.tofDetailOf(noEnd, TZ_CN3).pools));
		TOF.tofResetCache();
		const eNoLabel = engine3(NOW3, null, null, { [TOF_D_264766]: noLabel });
		const rNoLabel = await eNoLabel.refresh();
		check("tof 反证（端到端）：最新版本那篇没有窗口 ⇒ 卡池如实 nomatch（不硬凑过期档期）",
			(rNoLabel.games.tof || {}).banner === ""
			&& String((((rNoLabel.games.tof || {}).gachaFail) || {}).kind) === "nomatch",
			JSON.stringify([(rNoLabel.games.tof || {}).banner, (rNoLabel.games.tof || {}).gachaFail]));
		// 详情全失败（源站回 `{}`）⇒ 记 down（抓取失败 ≠ 未公布）
		TOF.tofResetCache();
		const eDown3 = engine3(NOW3, null, null, { [TOF_LIST]: "{}", [TOF_D_264766]: "{}" });
		const rDown3 = await eDown3.refresh();
		check("tof 反证（端到端）：列表 `{}` / 详情 `{}` ⇒ 记 **down**（不是 nomatch）",
			String((((rDown3.games.tof || {}).gachaFail) || {}).kind) === "down",
			JSON.stringify((rDown3.games.tof || {}).gachaFail));
		// now 在池开始之前（10-27）⇒ 解出来了但不覆盖 ⇒ null（未公布）
		TOF.tofResetCache();
		const eBefore = engine3(Date.parse("2026-10-27T12:00:00+08:00"), null, null);
		const rBefore = await eBefore.refresh();
		check("tof 反证（端到端）：池 10-28 12:00 才开 ⇒ 10-27 跑出来是 nomatch（不提前假在期）",
			(rBefore.games.tof || {}).banner === ""
			&& String((((rBefore.games.tof || {}).gachaFail) || {}).kind) === "nomatch",
			JSON.stringify([(rBefore.games.tof || {}).banner, (rBefore.games.tof || {}).gachaFail]));
	}

	// ───────── ⑪ 2026-11-15：プリンセスコネクト！Re:Dive·日服（pcr-jp）─────────
	// 落点：`src/client/30-game-pcr-jp.js`（厂商级，一条来源；microCMS 官方公告）。
	// 夹具全部真抓（2026-11-15 16:36 JST）：
	//   · `pcr-jp-list`（filter 同时圈卡池 + 活动，20 条裁到 8 条）
	//   · `pcr-jp-detail-78691968`（当期ピックアップガチャ；body_html 按段落裁，保留两条**行内日期**陷阱）
	//   · `pcr-jp-detail-78578770`（当期活动 バトルスタジアム；保留 `※★獲得報酬は…14:59まで` 陷阱）
	//   · `pcr-jp-detail-14116419`（明日 11/16 才开的活动 ⇒ 抓到了但尚未在期）
	//   · `pcr-jp-detail-27607457`（复刻活动；**正文里没有整行区间** ⇒ 0 个窗口、不抛）
	//   · `pcr-jp-detail-80995963`（11月深淵討伐戦 開催中；窗口 11-03 ~ 11-09 **已结束** ⇒ 封存反证用）
	// 时间断言一律 `Date.UTC(...)` 手算（JST 墙钟 −9h），UTC / +08 两道门禁跑同一份期望值。
	section("2026-11-15 公主连结·日服（pcr-jp）：microCMS 真夹具逐字 + 请求预算 + 缓存封存 + 反证");
	{
		const PCRJ = T.parsers["pcr-jp"];
		const TZ_JP4 = "Asia/Tokyo";
		const JP_LIST = PCRJ.PCR_JP_LIST_URL;
		const JP_D = (id) => PCRJ.PCR_JP_DETAIL_BASE + id;
		const JP_D_78691968 = JP_D("78691968");
		const JP_D_78578770 = JP_D("78578770");
		const JP_D_14116419 = JP_D("14116419");
		const JP_D_27607457 = JP_D("27607457");
		const JP_D_80995963 = JP_D("80995963");
		const ALL_IDS4 = T.SOURCES.map((x) => x.id);
		const BODY4 = {
			[JP_LIST]: FIX("pcr-jp-list"),
			[JP_D_78691968]: FIX("pcr-jp-detail-78691968"),
			[JP_D_78578770]: FIX("pcr-jp-detail-78578770"),
			[JP_D_14116419]: FIX("pcr-jp-detail-14116419"),
			[JP_D_27607457]: FIX("pcr-jp-detail-27607457"),
			[JP_D_80995963]: FIX("pcr-jp-detail-80995963")
		};
		const resp4 = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) });
		// 记账 transport：`sink` = 实际发出去的地址；`heads` = 每个直连请求的头（证明带了 microCMS key）；
		// 代理出口**故意抛**（本条实测 ACAO * ⇒ 必须直连；真走代理会在这里炸出来）
		const transport4 = (sink, heads, overrides) => ({
			async fetchRaw(u, opts) {
				const url = String(u);
				if (sink) sink.push(url);
				if (heads) heads.push({ url, headers: Object.assign({}, (opts && opts.headers) || {}) });
				if (overrides && overrides[url] != null) return resp4(overrides[url]);
				if (BODY4[url] != null) return resp4(BODY4[url]);
				throw new Error("pcr-jp 用例没有这个 URL 的夹具：" + url);
			},
			async fetchViaProxy(u) { throw new Error("pcr-jp 实测 ACAO * ⇒ 走直连（mode=direct），不该用代理：" + u); }
		});
		const engine4 = (now, sink, heads, overrides) => createEngine({
			transport: transport4(sink, heads, overrides),
			storage: makeStore({ hidden: ALL_IDS4.filter((id) => id !== "pcr-jp"), shown: ["pcr-jp"] }),
			now: () => now,
			timer: { setTimeout, clearTimeout }
		});
		// 夹具抓取那天（2026-11-15）16:30 JST：バトルスタジアム 20:59 才收、エルピス討魔戦線 明日才开
		const NOW4 = Date.parse("2026-11-15T16:30:00+09:00");

		// ── ① 注册 ──
		const srcJp = srcOf("pcr-jp");
		check("pcr-jp 注册：卡池与活动**同一条**列表 URL；两侧标签逐字「官网公告（日服）」；tz = Asia/Tokyo；出厂默认展示",
			!!srcJp && srcJp.url === JP_LIST && srcJp.eventUrl === JP_LIST
			&& srcJp.source === "官网公告（日服）" && srcJp.eventSource === "官网公告（日服）"
			&& srcJp.tz === TZ_JP4 && srcJp.defaultHidden === false
			&& srcJp.name === "公主连结Re:Dive·日服",
			srcJp ? JSON.stringify([srcJp.url, srcJp.eventUrl, srcJp.source, srcJp.tz, srcJp.name]) : "缺失");
		check("pcr-jp 有配色（与 pcr-tw 同族但不同色）、id 全局唯一；两个抓取器都登记了",
			!!srcJp && /^#[0-9A-F]{6}$/i.test(String(srcJp.color))
			&& srcJp.color !== (srcOf("pcr-tw") || {}).color
			&& new Set(ALL_IDS4).size === ALL_IDS4.length
			&& typeof T.GACHA_FETCHERS["pcr-jp"] === "function"
			&& !!(T.EVENT_FETCHERS["pcr-jp"] && typeof T.EVENT_FETCHERS["pcr-jp"].default === "function"),
			JSON.stringify([srcJp && srcJp.color, (srcOf("pcr-tw") || {}).color, new Set(ALL_IDS4).size, ALL_IDS4.length]));
		check("pcr-jp 列表地址：filters 同时圈卡池（title contains ガチャ）与活动（categories contains イベント）+ orders=-display_date",
			/\/api\/v1\/news\?filters=/.test(JP_LIST)
			&& decodeURIComponent(JP_LIST).includes("title[contains]ガチャ[or]categories[contains]イベント")
			&& JP_LIST.includes("orders=-display_date") && JP_LIST.includes("fields=id,title,categories,display_date")
			&& PCRJ.PCR_JP_SOURCE_LABEL === "官网公告（日服）" && PCRJ.PCR_JP_TZ === TZ_JP4,
			JP_LIST);

		// ── ② 列表：kind 分类（本命池 / 活动 / 已结束 / 其他）──
		const jpRows = PCRJ.pcrJpListOf(JSON.parse(BODY4[JP_LIST]));
		check("pcr-jp 列表：8 条，顺序 = 源站（`orders=-display_date`，本地不再排）",
			jpRows.length === 8
			&& jpRows.map((x) => x.id).join(",") === "14116419,34574244,27607457,78691968,99142261,78578770,80995963,70706490",
			JSON.stringify(jpRows.map((x) => x.id)));
		check("pcr-jp 列表 kind：`ピックアップガチャ`=gacha / `イベント` 分类=event / 标题写「終了」=ended / 其余=other",
			jpRows.find((x) => x.id === "78691968").kind === "gacha"
			&& jpRows.find((x) => x.id === "34574244").kind === "other"
			&& jpRows.find((x) => x.id === "14116419").kind === "event"
			&& jpRows.find((x) => x.id === "99142261").kind === "ended"
			&& jpRows.find((x) => x.id === "78578770").kind === "event",
			JSON.stringify(jpRows.map((x) => [x.id, x.kind])));
		check("pcr-jp 分类反证：`マスターピースつき ★3確定プラチナガチャ` / `選べるプライズガチャ` / `10回目ピックアップキャラ出現率3倍ガチャ` 都**不是**本命池",
			PCRJ.pcrJpKindOf("「マスターピースつき ★3確定プラチナガチャ」開催！", ["お知らせ"]) === "other"
			&& PCRJ.pcrJpKindOf("「選べるプライズガチャ」開催！【2026/11/10(火) 12:30 追記】", ["お知らせ"]) === "other"
			&& PCRJ.pcrJpKindOf("「10回目ピックアップキャラ出現率3倍ガチャ」開催！", ["お知らせ"]) === "other"
			&& PCRJ.pcrJpKindOf("プリンセスフェスガチャ開催！！限定キャラ「アグライア」登場！", ["お知らせ"]) === "gacha");
		check("pcr-jp 已结束标题带【追記】后缀也认（`開催期間終了！【2026/10/31(土) 13:00 追記】`）",
			PCRJ.pcrJpKindOf("「10月クランバトル」開催期間終了！【2026/10/31(土) 13:00 追記】", ["イベント"]) === "ended"
			&& PCRJ.pcrJpKindOf("復刻ストーリーイベント「Summer Anemos, Summer Qualia」開催終了！", ["イベント"]) === "ended");

		// ── ③ 详情：`■アンカー + 下一行整行区间`（行内日期陷阱不认）──
		const d786 = PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_78691968]), TZ_JP4);
		check("pcr-jp 详情 78691968：窗口 1 条（`※…の開催期間は2026/11/10…～ 11/16…までです。` 那类**行内日期**不算）",
			d786.windows.length === 1 && d786.windows[0].label === "ピックアップガチャ",
			JSON.stringify(d786.windows.map((x) => x.label)));
		check("pcr-jp 详情 78691968：起止 = 2026-11-10 12:00 ~ 11-30 11:59 JST（UTC 手算 03:00 / 02:59）",
			d786.windows[0].startTs === Date.UTC(2026, 10, 10, 3, 0)
			&& d786.windows[0].endTs === Date.UTC(2026, 10, 30, 2, 59),
			JSON.stringify([d786.windows[0].startTs, d786.windows[0].endTs]));
		check("pcr-jp 详情 78691968：raw 保留源站原文（含 `(曜日)` 与全角 ～）、display 是补全后的可读文本",
			d786.windows[0].raw === "2026/11/10(火) 12:00 ～ 2026/11/30(月) 11:59"
			&& d786.windows[0].display === "11-10 12:00 ~ 11-30 11:59",
			JSON.stringify([d786.windows[0].raw, d786.windows[0].display]));
		check("pcr-jp 区间解析：行内日期**不**算窗口；结束年可省且跨年补到次年；`〜` 分隔符也认",
			PCRJ.pcrJpWindowOf("※開催期間は2026/11/10(火) 12:00 ～ 2026/11/16(月) 11:59までです。", TZ_JP4) === null
			&& (() => {
				const w = PCRJ.pcrJpWindowOf("2026/12/28(月) 12:00 ～ 01/05(月) 11:59", TZ_JP4);
				return !!w && w.startTs === Date.UTC(2026, 11, 28, 3, 0) && w.endTs === Date.UTC(2027, 0, 5, 2, 59);
			})()
			&& (() => {
				const w = PCRJ.pcrJpWindowOf("2026/11/10(日) 12:00〜2026/11/30(月) 11:59", TZ_JP4);
				return !!w && w.endTs === Date.UTC(2026, 10, 30, 2, 59);
			})(),
			JSON.stringify(PCRJ.pcrJpWindowOf("2026/12/28(月) 12:00 ～ 01/05(月) 11:59", TZ_JP4)));
		check("pcr-jp 卡池条目事实：banner「ピックアップガチャ」+ 角色「ラッキーライラック」+ isMain",
			(() => {
				const its = PCRJ.pcrJpPoolItemsOf(d786);
				return its.length === 1 && its[0].banner === "ピックアップガチャ"
					&& its[0].roles === "ラッキーライラック" && its[0].isMain === true;
			})(),
			JSON.stringify(PCRJ.pcrJpPoolItemsOf(d786)));

		// ── ④ 活动详情：`■開催期間` 是通用锚点 ⇒ 名字走标题派生；无整行区间 ⇒ 0 窗口（不抛）──
		const d785 = PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_78578770]), TZ_JP4);
		const d141 = PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_14116419]), TZ_JP4);
		const d276 = PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_27607457]), TZ_JP4);
		check("pcr-jp 详情 78578770：`■開催期間` 剥完是空 ⇒ label 留空；起止 11-09 12:00 ~ 11-15 20:59 JST",
			d785.windows.length === 1 && d785.windows[0].label === ""
			&& d785.windows[0].startTs === Date.UTC(2026, 10, 9, 3, 0)
			&& d785.windows[0].endTs === Date.UTC(2026, 10, 15, 11, 59),
			JSON.stringify(d785.windows));
		check("pcr-jp 活动名：没有引号就剥 `開催中！` ⇒「バトルスタジアム」；有引号就留引号内",
			PCRJ.pcrJpEventNameOf("バトルスタジアム開催中！") === "バトルスタジアム"
			&& PCRJ.pcrJpEventNameOf("「エルピス討魔戦線」開催決定！") === "エルピス討魔戦線"
			&& PCRJ.pcrJpEventNameOf("「11月深淵討伐戦」開催期間終了！") === "11月深淵討伐戦",
			JSON.stringify([PCRJ.pcrJpEventNameOf("バトルスタジアム開催中！"), PCRJ.pcrJpEventNameOf("「エルピス討魔戦線」開催決定！")]));
		check("pcr-jp 活动名：`復刻ストーリーイベント「…」開催決定！` ⇒ 引号内（不被整句带跑）",
			PCRJ.pcrJpEventNameOf(d276.title).startsWith("【『I Wish』後伝】")
			&& PCRJ.pcrJpEventNameOf(d276.title).includes("掴み取るこの手で"),
			PCRJ.pcrJpEventNameOf(d276.title));
		check("pcr-jp 详情 14116419（明日才开）窗口解得出、但**不覆盖 NOW** ⇒ 端到端不进外显（见下）",
			d141.windows.length === 1
			&& d141.windows[0].startTs === Date.UTC(2026, 10, 16, 3, 0)
			&& d141.windows[0].endTs === Date.UTC(2026, 10, 21, 19, 59),
			JSON.stringify(d141.windows));
		check("pcr-jp 详情 27607457：正文没有任何整行区间（只有 `11/17(火) 12:00から` 前瞻句）⇒ 0 窗口、**不抛**",
			d276.windows.length === 0 && PCRJ.pcrJpEventItemsOf(d276).length === 0,
			JSON.stringify(d276.windows));
		check("pcr-jp 详情 80995963（11月深淵討伐戦）：窗口照样解得出来（11-03 12:00 ~ 11-09 04:59 JST）——在期与否由载荷判",
			(() => {
				const d = PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_80995963]), TZ_JP4);
				return d.windows.length === 1 && d.windows[0].label === ""
					&& d.windows[0].endTs === Date.UTC(2026, 10, 8, 19, 59);
			})(),
			JSON.stringify(PCRJ.pcrJpDetailOf(JSON.parse(BODY4[JP_D_80995963]), TZ_JP4).windows));
		check("pcr-jp 活动条目事实：event 名来自标题、category 留空（不把粗分类 `イベント` 塞进事实）",
			(() => {
				const its = PCRJ.pcrJpEventItemsOf(d785);
				return its.length === 1 && its[0].event === "バトルスタジアム" && its[0].category === "";
			})(),
			JSON.stringify(PCRJ.pcrJpEventItemsOf(d785)));

		// ── ⑤ 端到端 + 请求预算（列表 1 + 卡池详情 1 + 活动详情 3 = 首轮 5；稳态 1）──
		PCRJ.pcrJpResetCache();
		const calls4 = [];
		const heads4 = [];
		const e4 = engine4(NOW4, calls4, heads4);
		const r4 = await e4.refresh();
		const recJp = r4.games["pcr-jp"] || {};
		check("pcr-jp 首轮请求 = 5 次（列表 1 + 78691968 卡池 1 + 活动 14116419/27607457/78578770 各 1；命中当期即停 ⇒ 80995963/70706490 不取）",
			calls4.length === 5
			&& calls4.filter((u) => u === JP_LIST).length === 1
			&& calls4.filter((u) => u === JP_D_78691968).length === 1
			&& calls4.filter((u) => u === JP_D_14116419).length === 1
			&& calls4.filter((u) => u === JP_D_27607457).length === 1
			&& calls4.filter((u) => u === JP_D_78578770).length === 1
			&& calls4.indexOf(JP_D("80995963")) < 0 && calls4.indexOf(JP_D("34574244")) < 0
			&& calls4.indexOf(JP_D("99142261")) < 0,
			"requests=" + calls4.length + " " + JSON.stringify(calls4));
		check("pcr-jp 每个请求都带了 `X-MICROCMS-API-KEY`（microCMS 必需；漏了会 401）",
			heads4.length === 5 && heads4.every((x) => x.headers["X-MICROCMS-API-KEY"] === PCRJ.PCR_JP_API_KEY),
			JSON.stringify(heads4.slice(0, 2)));
		check("pcr-jp 卡池外显 = ピックアップガチャ / ラッキーライラック / 11-10 12:00 ~ 11-30 11:59",
			recJp.banner === "ピックアップガチャ" && recJp.roles === "ラッキーライラック"
			&& recJp.bannerDates === "11-10 12:00 ~ 11-30 11:59"
			&& recJp.bannerDatesRaw === "2026/11/10(火) 12:00 ～ 2026/11/30(月) 11:59"
			&& recJp.gachaFail === null,
			JSON.stringify([recJp.banner, recJp.roles, recJp.bannerDates, recJp.bannerDatesRaw]));
		check("pcr-jp 活动外显 = バトルスタジアム / 11-09 12:00 ~ 11-15 20:59（エルピス討魔戦線 明日才开 ⇒ 不进外显）",
			recJp.event === "バトルスタジアム"
			&& recJp.eventDates === "11-09 12:00 ~ 11-15 20:59"
			&& recJp.eventDatesRaw === "2026/11/09(月) 12:00 ～ 2026/11/15(日) 20:59"
			&& recJp.eventFail === null,
			JSON.stringify([recJp.event, recJp.eventDates, recJp.eventFail]));
		check("pcr-jp gacha[] 1 条 / events[] 1 条（各只有 1 条在期 ⇒ 不设悬停；key 前缀 pcr-jp；绝对时刻 + tz）",
			Array.isArray(recJp.gacha) && recJp.gacha.length === 1
			&& recJp.gacha[0].key === "pcr-jp:gacha:0" && recJp.gacha[0].title === "ピックアップガチャ"
			&& recJp.gacha[0].show === "ラッキーライラック"
			&& recJp.gacha[0].startTs === Date.UTC(2026, 10, 10, 3, 0)
			&& recJp.gacha[0].endTs === Date.UTC(2026, 10, 30, 2, 59)
			&& recJp.gacha[0].tz === TZ_JP4 && !recJp.bannerHover
			&& Array.isArray(recJp.events) && recJp.events.length === 1
			&& recJp.events[0].key === "pcr-jp:event:0" && recJp.events[0].title === "バトルスタジアム"
			&& recJp.events[0].endTs === Date.UTC(2026, 10, 15, 11, 59) && !recJp.eventHover,
			JSON.stringify([(recJp.gacha || []).map((x) => [x.key, x.title, x.startTs, x.endTs]), (recJp.events || []).map((x) => [x.key, x.title]), recJp.bannerHover, recJp.eventHover]));
		// 稳态：详情全进缓存 ⇒ 只发列表
		calls4.length = 0;
		const r4b = await e4.refresh();
		check("pcr-jp 稳态第 2 轮 = 1 次（只列表；详情按 id 缓存 24h）",
			calls4.length === 1 && calls4[0] === JP_LIST
			&& (r4b.games["pcr-jp"] || {}).banner === recJp.banner
			&& (r4b.games["pcr-jp"] || {}).event === recJp.event,
			"requests=" + calls4.length + " " + JSON.stringify(calls4));

		// ── ⑥ 缓存语义（TTL 24h / 已结束永久封存 = "已结束不再取"）──
		check("pcr-jp 缓存判定：null / 超 TTL 且未封存 ⇒ 不可用；TTL 内 / 已封存 ⇒ 可用",
			PCRJ.pcrJpCacheValidOf(null, NOW4) === false
			&& PCRJ.pcrJpCacheValidOf({ at: NOW4 - 25 * 3600 * 1000, value: { windows: [] }, sealed: false }, NOW4) === false
			&& PCRJ.pcrJpCacheValidOf({ at: NOW4 - 3600 * 1000, value: { windows: [] }, sealed: false }, NOW4) === true
			&& PCRJ.pcrJpCacheValidOf({ at: NOW4 - 400 * 24 * 3600 * 1000, value: { windows: [{}] }, sealed: true }, NOW4) === true);
		check("pcr-jp 封存判定：有窗口且全部 endTs<=抓取时刻 ⇒ 封存；还有未来窗口 / 没有窗口 ⇒ 不封存",
			PCRJ.pcrJpCacheSealedOf({ windows: [{ endTs: NOW4 - 1 }] }, NOW4) === true
			&& PCRJ.pcrJpCacheSealedOf({ windows: [{ endTs: NOW4 - 1 }, { endTs: NOW4 + 1 }] }, NOW4) === false
			&& PCRJ.pcrJpCacheSealedOf({ windows: [] }, NOW4) === false);
		// 端到端：11/23 12:00 JST 时活动窗口全过期 ⇒ 首轮抓完当场封存；+25h（超 TTL）只重取"未封存"的那些。
		// ⚠️ 必须用**同一台引擎**（缓存是每引擎一份）：now 走可变闭包，第 2 轮把时钟拨后 25h。
		PCRJ.pcrJpResetCache();
		const NOW_SEALED = Date.parse("2026-11-23T12:00:00+09:00");
		let nowSealed = NOW_SEALED;
		const callsSealed = [];
		const eSealed = createEngine({
			transport: transport4(callsSealed, null, null),
			storage: makeStore({ hidden: ALL_IDS4.filter((id) => id !== "pcr-jp"), shown: ["pcr-jp"] }),
			now: () => nowSealed,
			timer: { setTimeout, clearTimeout }
		});
		await eSealed.refresh();
		check("pcr-jp 封存①：11/23 首轮 = 6 次（列表 1 + 卡池 1 + 活动 4：当晚无当期 ⇒ 不提前收，4 篇都抓）",
			callsSealed.length === 6
			&& callsSealed.indexOf(JP_D_14116419) >= 0 && callsSealed.indexOf(JP_D_78578770) >= 0
			&& callsSealed.indexOf(JP_D("80995963")) >= 0,
			"requests=" + callsSealed.length + " " + JSON.stringify(callsSealed));
		callsSealed.length = 0;
		nowSealed = NOW_SEALED + 25 * 3600 * 1000;
		await eSealed.refresh();
		check("pcr-jp 封存②：超 TTL 后**已结束的 14116419 / 78578770 / 80995963 不再取**（只重取未封存的 27607457 + 仍在期的卡池）",
			callsSealed.length === 3
			&& callsSealed.filter((u) => u === JP_LIST).length === 1
			&& callsSealed.indexOf(JP_D_14116419) < 0 && callsSealed.indexOf(JP_D_78578770) < 0
			&& callsSealed.indexOf(JP_D_80995963) < 0
			&& callsSealed.indexOf(JP_D_27607457) >= 0 && callsSealed.indexOf(JP_D_78691968) >= 0,
			"requests=" + callsSealed.length + " " + JSON.stringify(callsSealed));

		// ── ⑦ 反证（结构变了要看得见；抹掉时间锚点 ⇒ 不进外显）──
		const throws4 = (fn) => { try { fn(); return false; } catch { return true; } };
		check("pcr-jp 反证：列表 `{}` / 空串 / 数组 / 没有 contents / contents 里一条可用行都没有 ⇒ 抛错（不是 nomatch）",
			throws4(() => PCRJ.pcrJpListOf({})) && throws4(() => PCRJ.pcrJpListOf(""))
			&& throws4(() => PCRJ.pcrJpListOf([])) && throws4(() => PCRJ.pcrJpListOf({ contents: "x" }))
			&& throws4(() => PCRJ.pcrJpListOf({ contents: [] })));
		check("pcr-jp 反证：详情 `{}` / 空串 / 没有 body_html / body_html 不是非空字符串 / 正文抽不出行 ⇒ 抛错",
			throws4(() => PCRJ.pcrJpDetailOf({})) && throws4(() => PCRJ.pcrJpDetailOf(""))
			&& throws4(() => PCRJ.pcrJpDetailOf([])) && throws4(() => PCRJ.pcrJpDetailOf({ body_html: "" }))
			&& throws4(() => PCRJ.pcrJpDetailOf({ body_html: 123 }))
			&& throws4(() => PCRJ.pcrJpDetailOf({ body_html: "<p></p>" })));
		// 抹掉时间锚点（把全角 `～` 换成 `から`）⇒ 这篇 0 个窗口（不进外显，但**不抛**）
		const noRange4 = BODY4[JP_D_78691968].replace(/～/g, "から");
		check("pcr-jp 反证：抹掉区间分隔符 ⇒ 这篇 0 个窗口（不进外显，也不算失败）",
			PCRJ.pcrJpDetailOf(JSON.parse(noRange4), TZ_JP4).windows.length === 0
			&& PCRJ.pcrJpPoolItemsOf(PCRJ.pcrJpDetailOf(JSON.parse(noRange4), TZ_JP4)).length === 0,
			JSON.stringify(PCRJ.pcrJpDetailOf(JSON.parse(noRange4), TZ_JP4).windows));
		PCRJ.pcrJpResetCache();
		const eNoRange4 = engine4(NOW4, null, null, { [JP_D_78691968]: noRange4 });
		const rNoRange4 = await eNoRange4.refresh();
		check("pcr-jp 反证（端到端）：卡池那篇没有窗口 ⇒ 卡池如实 nomatch（活动侧不受影响、照常出）",
			((rNoRange4.games["pcr-jp"] || {}).banner) === ""
			&& String((((rNoRange4.games["pcr-jp"] || {}).gachaFail) || {}).kind) === "nomatch"
			&& (rNoRange4.games["pcr-jp"] || {}).event === "バトルスタジアム",
			JSON.stringify([(rNoRange4.games["pcr-jp"] || {}).banner, (rNoRange4.games["pcr-jp"] || {}).gachaFail, (rNoRange4.games["pcr-jp"] || {}).event]));
		// 详情全失败（源站回 `{}`）⇒ 两侧都记 down（抓取失败 ≠ 未公布）
		PCRJ.pcrJpResetCache();
		const eDown4 = engine4(NOW4, null, null, {
			[JP_D_78691968]: "{}", [JP_D_14116419]: "{}", [JP_D_27607457]: "{}",
			[JP_D_78578770]: "{}", [JP_D_80995963]: "{}"
		});
		const rDown4 = await eDown4.refresh();
		check("pcr-jp 反证（端到端）：四篇活动详情 + 卡池详情都回 `{}` ⇒ 卡池与活动都记 **down**（不是 nomatch）",
			String((((rDown4.games["pcr-jp"] || {}).gachaFail) || {}).kind) === "down"
			&& String((((rDown4.games["pcr-jp"] || {}).eventFail) || {}).kind) === "down",
			JSON.stringify([(rDown4.games["pcr-jp"] || {}).gachaFail, (rDown4.games["pcr-jp"] || {}).eventFail]));
		PCRJ.pcrJpResetCache();
		const eListDown4 = engine4(NOW4, null, null, { [JP_LIST]: "{}" });
		const rListDown4 = await eListDown4.refresh();
		check("pcr-jp 反证（端到端）：列表 `{}` ⇒ 两侧都记 **down**",
			String((((rListDown4.games["pcr-jp"] || {}).gachaFail) || {}).kind) === "down"
			&& String((((rListDown4.games["pcr-jp"] || {}).eventFail) || {}).kind) === "down",
			JSON.stringify([(rListDown4.games["pcr-jp"] || {}).gachaFail, (rListDown4.games["pcr-jp"] || {}).eventFail]));
		// 11/23：活动窗口全过期、卡池仍在期 ⇒ 活动侧如实 nomatch（不硬凑过期档期），卡池照常出
		PCRJ.pcrJpResetCache();
		const eLate = engine4(NOW_SEALED, null, null);
		const rLate = await eLate.refresh();
		check("pcr-jp 反证（端到端）：11/23 活动全过期 ⇒ 活动如实 nomatch；卡池仍在期照样外显",
			(rLate.games["pcr-jp"] || {}).event === ""
			&& String((((rLate.games["pcr-jp"] || {}).eventFail) || {}).kind) === "nomatch"
			&& (rLate.games["pcr-jp"] || {}).banner === "ピックアップガチャ"
			&& (rLate.games["pcr-jp"] || {}).gachaFail === null,
			JSON.stringify([(rLate.games["pcr-jp"] || {}).event, (rLate.games["pcr-jp"] || {}).eventFail, (rLate.games["pcr-jp"] || {}).banner]));
		// 夹具 meta 的 URL 与抓取链对得上（防止换了接口没换夹具）
		check("pcr-jp 夹具 meta.url = 列表地址 / 详情地址（夹具与抓取链对得上）",
			JSON.parse(readFileSync(new URL("./fixtures/pcr-jp-list/response.txt.meta.json", import.meta.url), "utf8")).url === JP_LIST
			&& JSON.parse(readFileSync(new URL("./fixtures/pcr-jp-detail-78691968/response.txt.meta.json", import.meta.url), "utf8")).url === JP_D_78691968,
			JP_LIST);
	}
}
