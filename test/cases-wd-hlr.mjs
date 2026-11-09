// test/cases-wd-hlr.mjs —— 未定事件簿（米游社官方版块）+ 时空中的绘旅人（官网新闻）2026-11-09 晚接入
//
// ── 本段守什么 ──
//   ① 注册：`wd` / `hlr` 两侧都有 url + eventUrl + 来源标签，出厂仍 `defaultHidden: true`
//      （2026-11-09 用户要求不勾选展示；本次只换来源、不改展示口径）；
//   ② `wd` 卡池：真夹具 `wd-miyoushe-list` + `wd-miyoushe-detail-79191336`，
//      逐字断言 池名 / 角色（思绪名）/ 档期 / 源站原文 / 绝对时刻 / 悬停 / `gacha[]`；
//      「11月5日更新后」那一池（`79308001`）**不进外显**（startTs=null），只出现在悬停里；
//   ③ `wd` 活动：当期活动逐字（`79207926`），两条「更新后」活动只在悬停里；
//   ④ 单侧失败不影响另一侧（卡池详情 500 ⇒ gachaFail=down，event 照常产出）；
//   ⑤ `hlr` 卡池 + 活动：真夹具 `hlr-official-list` + 3 篇详情，逐字断言 画廊名 / SSR 画灵 / 起止；
//   ⑥ `hlr` 缺年份补年：真跨年夹具 `hlr-official-detail-20251229`（2025-12-27 ~ 2026-01-05）；
//   ⑦ 反向证明（纯函数）：把关键标记拿掉 ⇒ 解析器**返回空**，不是硬凑一条；
//   ⑧ `hlr` **真机现状**（2026-11-09）：官网新闻首页最新一篇 = 2026-11-05「怪谈：时融」，
//      该期 11-07 05:00 已结束 ⇒ 卡池/活动都如实 null。这条钉的是「nomatch = 活动空窗期，
//      不是解析坏了」：⑤ 用的是**期内的 now（11-05 12:00）**，只看 ⑤ 会误以为真机也出数据。
//
// 夹具全部真抓（2026-11-09 晚），裁剪规则写在各自 `response.txt.meta.json` 的 `trim` 字段里。
// 时间断言一律写绝对毫秒（`Date.UTC` 手算），UTC 与 +08 两道门禁跑同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });

const WD = T.parsers.wd;
const HLR = T.parsers.hlr;

// ── 夹具 ─────────────────────────────────────────────────────────────────────
const B = {
	wdList: FIX("wd-miyoushe-list"),
	wdDetails: {
		"79191336": FIX("wd-miyoushe-detail-79191336"),
		"79308001": FIX("wd-miyoushe-detail-79308001"),
		"79361917": FIX("wd-miyoushe-detail-79361917"),
		"79327803": FIX("wd-miyoushe-detail-79327803"),
		"79287295": FIX("wd-miyoushe-detail-79287295"),
		"79207926": FIX("wd-miyoushe-detail-79207926")
	},
	hlrList: FIX("hlr-official-list"),
	hlrDetails: {
		"20261105/30882_1318851": FIX("hlr-official-detail-20261105"),
		"20261014/30882_1316576": FIX("hlr-official-detail-20261014"),
		"20260929/30882_1315388": FIX("hlr-official-detail-20260929"),
		"20251229/30882_1279222": FIX("hlr-official-detail-20251229")
	}
};

// ── 抓取时刻 ──
// wd：夹具抓取时刻（2026-11-09 22:43 +08）—— 轮替池 10-30 ~ 11-13 在期，周边活动 10-31 ~ 11-20 在期
const NOW_WD = Date.parse("2026-11-09T22:43:00+08:00");
// hlr：最新活动「怪谈：时融」10-31 ~ 11-07 在期（用 11-05 12:00 +08 断言）
const NOW_HLR = Date.parse("2026-11-05T12:00:00+08:00");

function pickBody(url) {
	const u = String(url).replace(/[?&]origin=\*/, "");
	if (u === WD.WD_LIST_URL) return B.wdList;
	const wd = /getPostFull\?post_id=(\d+)/.exec(u);
	if (wd) {
		const body = B.wdDetails[wd[1]];
		if (!body) throw new Error("没有这个 wd 正文的夹具：" + u);
		return body;
	}
	if (u === HLR.HLR_LIST_URL) return B.hlrList;
	const hlr = /\/news\/official\/(\d{8}\/30882_\d+)\.html/.exec(u);
	if (hlr) {
		const body = B.hlrDetails[hlr[1]];
		if (!body) throw new Error("没有这个 hlr 正文的夹具：" + u);
		return body;
	}
	throw new Error("wd/hlr 用例没有这个 URL 的夹具：" + u);
}

// 记账 transport：sink 收 { url, referer }；`failDetail` 可让指定 post_id 的详情 500（验证单侧失败）
function makeTransport(sink, failDetail) {
	const rec = (url, referer) => { if (sink) sink.push({ url: String(url), referer: referer || "" }); };
	return {
		async fetchRaw(url) {
			rec(url, "");
			const body = pickBody(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url, opts) {
			rec(url, opts && opts.referer);
			if (failDetail && failDetail.test(String(url))) throw new Error("http-500");
			return pickBody(url);
		}
	};
}
const makeStore = () => {
	const m = new Map();
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
const engineAt = (now, sink, failDetail) => createEngine({
	transport: makeTransport(sink, failDetail),
	storage: makeStore(),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});
const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;

export default async function runWdHlr() {
	// ─────────────────────① 注册 ─────────────────────
	section("未定事件簿 / 绘旅人 ①：注册（两侧来源 + 来源标签 + 出厂不勾选）");
	{
		const wd = srcOf("wd");
		const hlr = srcOf("hlr");
		check("wd 卡池 url = 米游社未定版块列表（forum_id=33）",
			!!wd && wd.url === WD.WD_LIST_URL && /forum_id=33/.test(wd.url), wd ? String(wd.url) : "缺失");
		check("wd 活动 eventUrl 与卡池同一条（同一个版块，按标题分流）",
			!!wd && wd.eventUrl === wd.url, wd ? String(wd.eventUrl) : "缺失");
		check("wd 两侧来源标签 = 米游社官方版块",
			!!wd && wd.source === "米游社官方版块" && wd.eventSource === "米游社官方版块",
			wd ? JSON.stringify([wd.source, wd.eventSource]) : "缺失");
		check("hlr 卡池 url = 官网新闻列表页",
			!!hlr && hlr.url === HLR.HLR_LIST_URL && hlr.url === "https://hlr.163.com/news/official/",
			hlr ? String(hlr.url) : "缺失");
		check("hlr 活动 eventUrl 与卡池同一条（同一列表，逐篇详情抽窗口）",
			!!hlr && hlr.eventUrl === hlr.url, hlr ? String(hlr.eventUrl) : "缺失");
		check("hlr 两侧来源标签 = 官网新闻",
			!!hlr && hlr.source === "官网新闻" && hlr.eventSource === "官网新闻",
			hlr ? JSON.stringify([hlr.source, hlr.eventSource]) : "缺失");
		check("wd / hlr 出厂都不勾选展示（defaultHidden === true，2026-11-09 用户要求没变）",
			!!wd && !!hlr && wd.defaultHidden === true && hlr.defaultHidden === true,
			JSON.stringify([wd && wd.defaultHidden, hlr && hlr.defaultHidden]));
	}

	// ─────────────────────② wd 卡池 ─────────────────────
	section("未定事件簿 ②：卡池（米游社版块 · 真夹具逐字；「更新后」不进外显）");
	let wdGacha = null;
	{
		const calls = [];
		const e = engineAt(NOW_WD, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "wd");
		wdGacha = await e.__test.GACHA_FETCHERS["wd"](s.url, undefined, s.tz);
		check("wd 卡池抓取器返回对象（列表里两篇卡池稿）", !!wdGacha && typeof wdGacha === "object");
		check("wd 外显池名 = 轮替女神之影（标题 `丨` 前 + 去掉尾缀「更新」）",
			wdGacha && wdGacha.banner === "轮替女神之影", JSON.stringify(wdGacha && wdGacha.banner));
		check("wd 角色 = 正文 `SSR/SSS/SR【…】` 的思绪名（按文档顺序去重）",
			wdGacha && wdGacha.roles === "风烛引归、最佳拍档、虚妄之泪、童心攻势", JSON.stringify(wdGacha && wdGacha.roles));
		check("wd 档期 = 「10-30 11:00 ~ 11-13 11:00」（补全文本）",
			wdGacha && wdGacha.bannerDates === "10-30 11:00 ~ 11-13 11:00", JSON.stringify(wdGacha && wdGacha.bannerDates));
		check("wd 源站原文 = 「2026年10月30日11:00 ~ 11月13日11:00」（raw 与 display 分开）",
			wdGacha && wdGacha.bannerDatesRaw === "2026年10月30日11:00 ~ 11月13日11:00", JSON.stringify(wdGacha && wdGacha.bannerDatesRaw));
		check("wd startTs = 2026-10-30 11:00 +08（UTC 03:00）",
			wdGacha && wdGacha.startTs === Date.UTC(2026, 9, 30, 3, 0), String(wdGacha && wdGacha.startTs));
		check("wd endTs = 2026-11-13 11:00 +08（UTC 03:00）",
			wdGacha && wdGacha.endTs === Date.UTC(2026, 10, 13, 3, 0), String(wdGacha && wdGacha.endTs));
		// 悬停：结束最早的「雪愿相宜」（11-12 04:00）在前 → 轮替池；「更新后」原样印源站原文
		check("wd 悬停逐字（2 行；起点未知那行印源站原文「2026年11月5日更新后」）",
			wdGacha && wdGacha.bannerHover === "雪愿相宜：雪愿相宜\n2026年11月5日更新后 ~ 11月12日04:00\n轮替女神之影：风烛引归、最佳拍档、虚妄之泪、童心攻势\n10-30 11:00 ~ 11-13 11:00",
			JSON.stringify(wdGacha && wdGacha.bannerHover));
		check("wd `gacha[]` 共 2 条（1 主条 + 1 起点未知的并列条）",
			!!wdGacha && Array.isArray(wdGacha.gacha) && wdGacha.gacha.length === 2,
			JSON.stringify(wdGacha && wdGacha.gacha && wdGacha.gacha.map((x) => x.title)));
		check("wd `gacha[]`：主条 = 轮替 / 并列条 = 雪愿相宜，且并列条 startTs 为 null（起点未知 ≠ 已开始）",
			!!wdGacha && wdGacha.gacha[0].title === "轮替女神之影"
			&& wdGacha.gacha[0].source === "primary"
			&& wdGacha.gacha[1].title === "雪愿相宜：雪愿相宜"
			&& wdGacha.gacha[1].startTs === null,
			JSON.stringify(wdGacha && wdGacha.gacha.map((x) => [x.title, x.source, x.startTs])));
		if (wdGacha && wdGacha.bannerHover) assertHoverConvention("wd 卡池", wdGacha.bannerHover, { requireSet: true });
		// Referer 门：列表 + 每篇详情都必须带 https://www.miyoushe.com/wd/
		const details = calls.filter((c) => /getPostFull/.test(c.url));
		check("wd 全程走宿主代理（mode=proxy）", calls.length > 0 && calls.every((c) => /bbs-api\.miyoushe\.com/.test(c.url)));
		check("wd 列表 + 详情都带 Referer `https://www.miyoushe.com/wd/`（实测：只带 UA ⇒ 403）",
			calls.length > 0 && calls.every((c) => c.referer === WD.WD_REFERER) && details.length === 2,
			JSON.stringify(calls.map((c) => [c.url.slice(0, 40), c.referer])));
	}

	// ─────────────────────③ wd 活动 ─────────────────────
	section("未定事件簿 ③：活动（当期逐字；两条「更新后」只在悬停里）");
	let wdEvent = null;
	{
		const calls = [];
		const e = engineAt(NOW_WD, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "wd");
		wdEvent = await e.__test.EVENT_FETCHERS["wd"].default(s.eventUrl, undefined, s.tz);
		check("wd 活动抓取器返回对象", !!wdEvent && typeof wdEvent === "object");
		check("wd 当期活动名逐字（周边秋季上新活动；两端都明确的才进外显）",
			wdEvent && wdEvent.event === "《未定事件簿》周边秋季上新活动即将开启！多款新品即将上架！",
			JSON.stringify(wdEvent && wdEvent.event));
		check("wd 活动档期 = 「10-31 20:00 ~ 11-20 23:59」",
			wdEvent && wdEvent.eventDates === "10-31 20:00 ~ 11-20 23:59", JSON.stringify(wdEvent && wdEvent.eventDates));
		check("wd 活动源站原文 = 「2026年10月31日20:00 ~ 11月20日23:59」",
			wdEvent && wdEvent.eventDatesRaw === "2026年10月31日20:00 ~ 11月20日23:59", JSON.stringify(wdEvent && wdEvent.eventDatesRaw));
		check("wd 活动 startTs = 2026-10-31 20:00 +08（UTC 12:00）",
			wdEvent && wdEvent.events[0].startTs === Date.UTC(2026, 9, 31, 12, 0), String(wdEvent && wdEvent.events[0].startTs));
		check("wd 活动 endTs = 2026-11-20 23:59 +08（UTC 15:59）",
			wdEvent && wdEvent.events[0].endTs === Date.UTC(2026, 10, 20, 15, 59), String(wdEvent && wdEvent.events[0].endTs));
		check("wd 悬停逐字（更新后两条 + 当期周边活动，按结束时间升序）",
			wdEvent && wdEvent.eventHover === "欲爱相逢·莫弈篇   2026年11月5日更新后 ~ 11月12日04:00\n纷彩心意   2026年11月5日更新后 ~ 11月12日04:00\n《未定事件簿》周边秋季上新活动即将开启！多款新品即将上架！   10-31 20:00 ~ 11-20 23:59",
			JSON.stringify(wdEvent && wdEvent.eventHover));
		check("wd 「11月5日更新后」的两条**不进外显**（event ≠ 欲爱相逢/纷彩心意）",
			!!wdEvent && wdEvent.event !== "欲爱相逢·莫弈篇" && wdEvent.event !== "纷彩心意",
			JSON.stringify(wdEvent && wdEvent.event));
		check("wd `events[]` 共 3 条；两条更新后条目的 startTs 为 null（悬停/数组保留事实，不冒充在期）",
			!!wdEvent && Array.isArray(wdEvent.events) && wdEvent.events.length === 3
			&& wdEvent.events.filter((x) => x.title === "欲爱相逢·莫弈篇" || x.title === "纷彩心意").every((x) => x.startTs === null),
			JSON.stringify(wdEvent && wdEvent.events.map((x) => [x.title, x.startTs])));
		if (wdEvent && wdEvent.eventHover) assertHoverConvention("wd 活动", wdEvent.eventHover, { requireSet: true });
		check("wd 活动侧请求同样全带 Referer（列表 1 次 + 4 篇详情）",
			calls.length === 5 && calls.every((c) => c.referer === WD.WD_REFERER),
			JSON.stringify(calls.map((c) => [c.url.slice(0, 40), c.referer])));
	}

	// ─────────────────────④ 单侧失败不影响另一侧 ─────────────────────
	section("未定事件簿 ④：单侧失败不影响另一侧（卡池详情 500 ⇒ 只记 gachaFail）");
	{
		// 只让两篇卡池稿的详情 500（活动稿照常 200）
		const e = engineAt(NOW_WD, [], /getPostFull\?post_id=(79191336|79308001)$/);
		const s = e.__test.SOURCES.find((x) => x.id === "wd");
		const r = await e.__test.fetchEntry(s, undefined);
		check("卡池侧：详情全 500 ⇒ gachaFail.kind = down（抓取失败 ≠ 未公布）",
			r && r.gachaFail && r.gachaFail.kind === "down", JSON.stringify(r && r.gachaFail));
		check("活动侧：同一轮里照常产出当期活动（单侧失败没把另一侧带塌）",
			r && r.eventFail == null && r.data && r.data.event === "《未定事件簿》周边秋季上新活动即将开启！多款新品即将上架！",
			JSON.stringify(r && [r.eventFail, r.data && r.data.event]));
	}

	// ─────────────────────⑤ hlr 卡池 + 活动 ─────────────────────
	section("时空中的绘旅人 ⑤：卡池 + 活动（官网新闻 · 真夹具逐字）");
	{
		const calls = [];
		const e = engineAt(NOW_HLR, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "hlr");
		const g = await e.__test.GACHA_FETCHERS["hlr"](s.url, undefined, s.tz);
		check("hlr 卡池抓取器返回对象（最新一篇有「活动画廊」段）", !!g && typeof g === "object");
		check("hlr 画廊名 = 怪谈：时融（从正文「「怪谈：时融」活动画廊」取）",
			g && g.banner === "怪谈：时融", JSON.stringify(g && g.banner));
		check("hlr 角色 = 叠轨晨昏（`叶瑄SSR[叠轨晨昏]` → 方括号里的画灵名）",
			g && g.roles === "叠轨晨昏", JSON.stringify(g && g.roles));
		check("hlr 卡池档期 = 「10-31 09:30 ~ 11-07 05:00」",
			g && g.bannerDates === "10-31 09:30 ~ 11-07 05:00", JSON.stringify(g && g.bannerDates));
		check("hlr 卡池源站原文 = 「10月31日09:30 ~ 11月7日05:00」（缺年份已补进 ts，原文不补）",
			g && g.bannerDatesRaw === "10月31日09:30 ~ 11月7日05:00", JSON.stringify(g && g.bannerDatesRaw));
		check("hlr 卡池 startTs = 2026-10-31 09:30 +08（UTC 01:30）",
			g && g.startTs === Date.UTC(2026, 9, 31, 1, 30), String(g && g.startTs));
		check("hlr 卡池 endTs = 2026-11-07 05:00 +08（UTC 11-06 21:00）",
			g && g.endTs === Date.UTC(2026, 10, 6, 21, 0), String(g && g.endTs));
		check("hlr 只有一个在期画廊 ⇒ 不设 bannerHover（UI 走默认两行式）",
			g && g.bannerHover === void 0, JSON.stringify(g && g.bannerHover));

		// 活动侧：同一批详情，取每篇正文的第一个窗口
		const calls2 = [];
		const e2 = engineAt(NOW_HLR, calls2);
		const s2 = e2.__test.SOURCES.find((x) => x.id === "hlr");
		const ev = await e2.__test.EVENT_FETCHERS["hlr"].default(s2.eventUrl, undefined, s2.tz);
		check("hlr 活动抓取器返回对象", !!ev && typeof ev === "object");
		check("hlr 当期活动名 = 怪谈：时融（标题「…」里的名字）",
			ev && ev.event === "怪谈：时融", JSON.stringify(ev && ev.event));
		check("hlr 活动档期 = 「10-31 09:30 ~ 11-07 05:00」",
			ev && ev.eventDates === "10-31 09:30 ~ 11-07 05:00", JSON.stringify(ev && ev.eventDates));
		check("hlr 活动源站原文 = 「10月31日09:30 ~ 11月7日05:00」",
			ev && ev.eventDatesRaw === "10月31日09:30 ~ 11月7日05:00", JSON.stringify(ev && ev.eventDatesRaw));
		check("hlr 活动 startTs / endTs 与卡池同一段（同一篇正文）",
			ev && ev.events[0].startTs === Date.UTC(2026, 9, 31, 1, 30) && ev.events[0].endTs === Date.UTC(2026, 10, 6, 21, 0),
			JSON.stringify(ev && ev.events && ev.events[0]));
		check("hlr 列表只取前 3 篇详情（1 次列表 + 3 次详情，不把 280 页全抓）",
			calls.length === 4 && calls2.length === 4, JSON.stringify([calls.length, calls2.length]));
		check("hlr 全程走宿主代理且带 Referer `https://hlr.163.com/`",
			calls.concat(calls2).every((c) => /hlr\.163\.com/.test(c.url) && c.referer === "https://hlr.163.com/"),
			JSON.stringify(calls.concat(calls2).map((c) => [c.url.slice(0, 40), c.referer])));
	}

	// ─────────────────────⑥ hlr 跨年（缺年份补年）─────────────────────
	section("时空中的绘旅人 ⑥：缺年份补年（真跨年夹具 2025-12-27 ~ 2026-01-05）");
	{
		const html = B.hlrDetails["20251229/30882_1279222"];
		const d = HLR.hlrParseDetail(html);
		const year = HLR.hlrYearOf(d, "https://hlr.163.com/news/official/20251229/30882_1279222.html");
		check("hlr 跨年夹具：artDate = 时间：2025-12-27 ⇒ 年份 2025", d.dateText === "时间：2025-12-27" && year === 2025,
			JSON.stringify([d.dateText, year]));
		const rows = HLR.hlrBlocksOf(d.contentHtml).flatMap((b) => HLR.hlrGalleryRowsOf(b, year, TZ_CN));
		check("hlr 跨年卡池：只剩一段「活动卡池」窗口", rows.length === 1, JSON.stringify(rows.length));
		check("hlr 跨年卡池名 = 归途的寒春 / 角色 = 逆光而行",
			rows[0] && rows[0].banner === "归途的寒春" && rows[0].roles === "逆光而行",
			JSON.stringify(rows[0] && [rows[0].banner, rows[0].roles]));
		check("hlr 跨年：开始端缺年份 ⇒ 补 2025（startTs = 2025-12-27 09:30 +08 = UTC 01:30）",
			rows[0] && rows[0].startTs === Date.UTC(2025, 11, 27, 1, 30), String(rows[0] && rows[0].startTs));
		check("hlr 跨年：结束端自带 2026 年 ⇒ 用它（endTs = 2026-01-05 05:00 +08 = UTC 01-04 21:00）",
			rows[0] && rows[0].endTs === Date.UTC(2026, 0, 4, 21, 0), String(rows[0] && rows[0].endTs));
		check("hlr 跨年 display 两端都带年份（不写成 `12-27 ~ 01-05` 那种会读反的文本）",
			rows[0] && rows[0].display === "2025-12-27 09:30 ~ 2026-01-05 05:00", JSON.stringify(rows[0] && rows[0].display));
		// 同一判据对活动侧也成立（event 取正文第一个窗口）
		const wins = HLR.hlrWindowsOf(HLR.hlrParseDetail(html).contentHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "), 2025, TZ_CN);
		check("hlr 跨年活动窗口同样补年正确", wins[0] && wins[0].startTs === Date.UTC(2025, 11, 27, 1, 30) && wins[0].endTs === Date.UTC(2026, 0, 4, 21, 0),
			JSON.stringify(wins[0]));
	}

	// ─────────────────────⑦ 反向证明（纯函数）─────────────────────
	section("未定事件簿 / 绘旅人 ⑦：反向证明（关掉关键解析 ⇒ 解析不出，不硬凑）");
	{
		check("wd 反证：正文没有日期 ⇒ wdWindowsOf 返回空（不会硬凑窗口）",
			WD.wdWindowsOf("晴雪映双影，烛暖人相依。", TZ_CN).length === 0,
			String(WD.wdWindowsOf("晴雪映双影，烛暖人相依。", TZ_CN).length));
		check("wd 反证：只有「更新后」没有结束时刻 ⇒ 不是窗口",
			WD.wdWindowsOf("▶活动时间：2026年11月5日更新后", TZ_CN).length === 0,
			String(WD.wdWindowsOf("▶活动时间：2026年11月5日更新后", TZ_CN).length));
		check("wd 反证：起点「更新后」⇒ startTs 必须是 null（不许猜钟点）",
			(() => {
				const w = WD.wdWindowsOf("2026年11月5日更新后-11月12日04:00", TZ_CN);
				return w.length === 1 && w[0].startTs === null;
			})(),
			JSON.stringify(WD.wdWindowsOf("2026年11月5日更新后-11月12日04:00", TZ_CN)));
		check("hlr 反证：段落里没有「活动画廊/活动卡池」⇒ 不算卡池（gacha 段返回空）",
			HLR.hlrGalleryRowsOf("10月31日09:30 - 11月7日05:00，全新活动「怪谈：时融」开启。", 2026, TZ_CN).length === 0,
			String(HLR.hlrGalleryRowsOf("10月31日09:30 - 11月7日05:00，全新活动「怪谈：时融」开启。", 2026, TZ_CN).length));
		check("hlr 反证：只有一个时刻（`10月31日09:30起`）⇒ 不是窗口",
			HLR.hlrWindowsOf("10月31日09:30起，活动开放探索。", 2026, TZ_CN).length === 0,
			String(HLR.hlrWindowsOf("10月31日09:30起，活动开放探索。", 2026, TZ_CN).length));
	}

	// ─────────────────────⑧ 真机现状：官网活动空窗期 ⇒ 如实 null ─────────────────────
	// 2026-11-09 23:1x 真机复测（宿主代理、真响应）：列表 24,505 B / 6 条，最新详情 24,569 B，
	// artTitle / artDate（时间：2026-10-31）/ artText 全部命中，`怪谈：时融` 解析正常 ——
	// 但该期档期 10-31 09:30 ~ 11-07 05:00 **已经结束**，此刻官网没有覆盖 now 的窗口
	// （首页最新一篇仍是 2026-11-05）。按全仓口径不拿过期档期顶 ⇒ 返回 null（未公布）。
	// 这一节就是「真机刷新看到未公布」的机器证据：它守的是行为（不硬凑），不是源站某一天的内容。
	section("时空中的绘旅人 ⑧：真机现状（2026-11-09）官网最新一期已结束 ⇒ 卡池/活动都如实 null");
	{
		const NOW_REAL = Date.parse("2026-11-09T23:15:00+08:00");
		const e = engineAt(NOW_REAL);
		const s = e.__test.SOURCES.find((x) => x.id === "hlr");
		let g = "not-run", gErr = "", ev = "not-run", evErr = "";
		try { g = await e.__test.GACHA_FETCHERS["hlr"](s.url, undefined, s.tz); }
		catch (e2) { gErr = String((e2 && e2.message) || e2); }
		try { ev = await e.__test.EVENT_FETCHERS["hlr"].default(s.eventUrl, undefined, s.tz); }
		catch (e3) { evErr = String((e3 && e3.message) || e3); }
		check("hlr 真机现状：解析链路正常但最后一期 11-07 05:00 已结束 ⇒ 卡池如实 null（不抛错 = 不记失败）",
			g === null && gErr === "", gErr || JSON.stringify(g));
		check("hlr 真机现状：活动侧同样如实 null（不拿过期档期顶）",
			ev === null && evErr === "", evErr || JSON.stringify(ev));
		// 对照：同一批夹具、只把 now 挪回期内（11-05 12:00）就有数据 ⇒ 差异只来自时间，不是解析。
		const e2 = engineAt(NOW_HLR);
		const g2 = await e2.__test.GACHA_FETCHERS["hlr"](s.url, undefined, s.tz);
		check("hlr 对照：同一批夹具在期内 now（11-05 12:00）⇒ 怪谈：时融 有数据（差异只来自时间）",
			!!g2 && g2.banner === "怪谈：时融", JSON.stringify(g2 && g2.banner));
	}
}
