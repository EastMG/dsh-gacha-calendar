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
		check("来源总数 = 34（28 + 2026-11-09 的 5 + 2026-11-11 的 uma-tw）", T.SOURCES.length === 34, String(T.SOURCES.length));

		for (const [id, name] of WANT) {
			const s = srcOf(id);
			check(`${id} 名称 = ${name}`, !!s && s.name === name, s ? s.name : "缺失");
			check(`${id} tz = Asia/Shanghai（源站墙钟推定见各文件头）`, !!s && s.tz === TZ_CN, s ? String(s.tz) : "缺失");
			check(`${id} 有图标（http(s) 地址）`, !!s && /^https?:\/\//.test(String(s.icon)), s ? String(s.icon).slice(0, 60) : "缺失");
			// 颜色：本批 5 条在 20-source-core.js 的 SOURCE_COLORS 里各给了一个中间调
			check(`${id} 有游戏主题色（#rrggbb）`, !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s ? String(s.color) : "缺失");
			// 2026-11-09 用户：本批 4 款（夜幕之下 / 未定 / 绘旅人 / 炽焰天穹）出厂**不勾选展示**；
			// 无期迷途两侧都有源 ⇒ 仍出厂展示。2026-11-09 晚 wd/hlr 接上了源，但用户当轮的
			// 「出厂不勾选」要求**没有撤回** ⇒ 它们的 defaultHidden 仍是 true（只改源、不改展示口径）。
			// 这张 `defaultHidden` 表与提醒侧那份副本必须一致
			// （`65-remind.js` 的 REMIND_DEFAULT_HIDDEN_IDS / 宿主拿它判「展示中」，守卫见 cases-remind.mjs）。
			const wantHidden = id !== "wqmt";
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

		// 本批唯一仍然留空的：cytq（旧断言「wd / hlr / cytq 三款都留空」只剩下这一条）
		const cytq = srcOf("cytq");
		check("cytq 两侧来源都**留空未配置**（不写 url / eventUrl）",
			!!cytq && !cytq.url && !cytq.eventUrl, cytq ? JSON.stringify({ url: cytq.url, eventUrl: cytq.eventUrl }) : "缺失");
		check("cytq 没有挂任何抓取器（GACHA_FETCHERS / EVENT_FETCHERS 里查不到）",
			typeof T.GACHA_FETCHERS["cytq"] !== "function" && !T.EVENT_FETCHERS["cytq"]);

		// 设置页「卡池来源 / 活动来源」下拉：已接的写来源名，未配置的写裸「未配置」
		check("wd / hlr 设置页两侧都写各自的来源名",
			T.getDefaultSourceName(wd, "url") === "米游社公告" && T.getDefaultSourceName(wd, "eventUrl") === "米游社公告"
			&& T.getDefaultSourceName(hlr, "url") === "官网新闻" && T.getDefaultSourceName(hlr, "eventUrl") === "官网新闻 + 学院公告",
			JSON.stringify([T.getDefaultSourceName(wd, "url"), T.getDefaultSourceName(hlr, "url"), T.getDefaultSourceName(hlr, "eventUrl")]));
		check("cytq 设置页两侧都写「未配置」",
			T.getDefaultSourceName(cytq, "url") === "未配置" && T.getDefaultSourceName(cytq, "eventUrl") === "未配置",
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

	// ─────────────────────⑤「未配置」路径（现在只剩 cytq）─────────────────────
	section("新接入 5 款 ⑤：「未配置」路径 —— 不抓取、不抛错、不产生 fail（自检算 unconfigured）");
	{
		// 2026-11-09 晚：wd / hlr 接上两侧源、pengpeng 活动侧也接上 ⇒ 本段只剩 cytq。
		// 旧断言「wd / hlr / cytq 各 2 侧未配置 + pengpeng 活动侧 = 7」随之拆掉；
		// 取而代之：cytq 2 侧未配置、0 请求、0 失败（下面的 2/0/0 三个数字就是新口径）。
		const IDS = ["cytq"];
		// (a) fetchEntry：两侧都没地址 ⇒ 直接 skipped（连 net 都不碰）
		const e = engineAt(NOW);
		for (const id of IDS) {
			const s = e.__test.SOURCES.find((x) => x.id === id);
			const r = await e.__test.fetchEntry(s, undefined);
			check(`${id} fetchEntry ⇒ { ok:true, reason:"skipped" }（跳过，不记成功也不记失败）`,
				r && r.ok === true && r.reason === "skipped", JSON.stringify(r));
		}

		// (b) 自检：只看 cytq ⇒ down = 0、unconfigured = 2、ok = 0、一个请求都不发
		const ALL = T.SOURCES.map((x) => x.id);
		const KEEP = new Set(IDS);
		const calls = [];
		// cytq 出厂默认隐藏 ⇒ 自检范围 = 展示中的条目，必须同时写进 `shown` 才能验证这条路径。
		const e2 = engineAt(NOW_PP, { hidden: ALL.filter((x) => !KEEP.has(x)), shown: [...KEEP] }, calls);
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
		check("自检汇总：失败 = 0（未配置**不**混进失败数字）", rep.summary.down === 0, JSON.stringify(rep.summary));
		check("自检汇总：未配置 = 2（cytq 两侧）", rep.summary.unconfigured === 2, JSON.stringify(rep.summary));
		check("自检汇总：ok = 0（只剩 cytq，没有一侧能解析出内容）", rep.summary.ok === 0, JSON.stringify(rep.summary));
		check("自检期间**一个请求都没发**（未配置的条目连 net 都不碰）",
			calls.length === 0, JSON.stringify(calls));

		// (c) 面板那一格：派生不出条目 ⇒ 写「该来源无数据」（灰底），因此**没有**失败明细
		//     （失败横条已于 2026-11-10 删除，失败信息改为刷新横幅悬停明细；判据仍是 fail 是否 down）
		const rec = { id: "cytq", name: "炽焰天穹", tz: TZ_CN, gacha: [], events: [], gachaFail: null, eventFail: null };
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
		check("ddlezj 卡池未配置 ⇒ 面板卡池格派生不出条目（走「该来源无卡池数据」）",
			T.scheduleCellOf(rec, "gacha", new Date(NOW_1113)) === null,
			JSON.stringify(T.scheduleCellOf(rec, "gacha", new Date(NOW_1113))));
		check("ddlezj 卡池未配置 ⇒ 这一侧一个请求都没发（calls 里没有 bwiki / biligame API）",
			calls.every((u) => !/wiki\.biligame\.com|api\.biligame\.com/.test(String(u))),
			JSON.stringify(calls));

		// (b) cytq：两侧都未配置 ⇒ 两侧旧值一起清空（同一处修复，不针对 ddlezj 特判）
		const calls2 = [];
		const e2 = engineAt(NOW_1113, only("cytq"), calls2);
		const rep2 = await e2.refresh();
		const rec2 = (rep2.games || {}).cytq || {};
		check("cytq 两侧都未配置 ⇒ 卡池/活动两侧内容都清空、两个数组都为空、无 stale",
			rec2.banner === "" && rec2.event === "" && rec2.roles === ""
			&& (rec2.gacha || []).length === 0 && (rec2.events || []).length === 0
			&& rec2.gachaStale === false && rec2.eventStale === false,
			JSON.stringify({ banner: rec2.banner, event: rec2.event, gacha: (rec2.gacha || []).length, events: (rec2.events || []).length }));
		check("cytq 两侧都未配置 ⇒ 一个请求都没发", calls2.length === 0, JSON.stringify(calls2));
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
}
