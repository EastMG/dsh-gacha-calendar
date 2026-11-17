// test/cases-batch4.mjs —— 第四批新来源（2026-11-15 合并）：6 条 + 2026-11-15 追加的 imas 第 5 款
//
// 落点（**只取源文件 + 重新接线**，不是 git merge）：
//   · `src/client/30-game-nikki4.js`   闪耀暖暖·国服 —— **卡池侧已重做**（2026-11-15 用户点名）：
//     活动侧仍是首页 `__NEXT_DATA__` + `/news/{id}`；卡池侧改抓**新闻 API**
//     （列表 `/api/v1/news?section=1|0` + 详情 `/api/v1/news/{id}`），池名/档期来自正文的
//     「限时感应活动：<名>」/「主题活动|特别活动【<名>】」+「活动时间」。
//     旧「从首页 4 条编辑精选里猜卡池」的代码路径已删除。
//   · `src/client/30-game-idolmaster.js` アイドルマスター系列 **5 款**（学マス / シャニマス /
//     ミリシタ / デレステ / **シャニソン = シャイニーカラーズ Song for Prism**）——
//     `melonpapapapa-n.com` 每款一个月份页，卡池 + 活动同一张表
//     （第 5 款是同日补的：源站第 5 个品牌代号 `ss`；判据见 30-game-idolmaster.js 文件头）
//
// ── 这一段守什么 ──
//   ① **注册项**：7 条的 id / 名称 / tz / 来源标签 / 配色（+ 颜色）；
//      nikki4 的**卡池 URL 与活动 URL 已分开**（卡池 = 新闻列表 API / 活动 = 官网首页），
//      imas 五款的卡池·活动仍**同源同 URL**；
//      以及用户 2026-11-15 拍板的**标签后缀口径**：5 条 imas 的来源文案逐字带「（日文）」，
//      条目 name 不加任何后缀；
//      引擎整轮；imas 五款走引擎的 `GACHA_FETCHERS` 抓取器，卡池/活动同一次抓取）；
//   ③ **反证**：`{}` / `data:{}` / `ret != 0` ⇒ **抛错**（不是 nomatch）；
//      抹掉时间锚点 ⇒ 该条**不进外显**（不抛、不硬凑）；
//      imas 月份页所有时刻锚都消失 ⇒ 抛结构错（不许静默成"本期没有"）。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值。
//
// 夹具全部真抓（见各 `response.txt.meta.json` 的 capturedAt / note）：
//   活动侧 `nikki4-home` + `nikki4-detail-{102568,102571,102574,102582,102583}`；
//   卡池侧（2026-11-15 重做）`nikki4-news-list-{s1,s0}` + `nikki4-news-detail-<id>`（15 篇 = 21 天内公告/资讯）；
//   imas 六份月份页 `imas-{gakumas-202610,gakumas-202611,shinycolors-202611,millisita-202611,deresute-202611,shanison-202611}`。

import { readFileSync } from "node:fs";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

const TZ_TW = "Asia/Taipei";
const TZ_CN4 = "Asia/Shanghai";
const TZ_JP = "Asia/Tokyo";

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
		throw new Error("本批 6 条都走宿主代理（mode=proxy）：" + url);
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

export default async function run() {
	// ═════════ ① 注册项（6 条 + imas 第 5 款 = 7 条）═════════
	section("第四批 ①：7 条注册项（id / 名称 / tz / 标签 / 卡池·活动同源 URL + 颜色）");
	{
		const N = T.parsers.nikki4, I = T.parsers.idolmaster;
		// 用户 2026-11-15 拍板的后缀口径：只许这一种写法（不许（日服）/（JST）/（原文）…）
		const IMAS_LABEL_LITERAL = "melonpapapapa（日文）";
		for (const [id, name, tz, label] of [
			["nikki4", "闪耀暖暖", TZ_CN4, "官网公告"],
			["gakumas", "学园偶像大师·日服", TZ_JP, I.IMAS_SOURCE_LABEL],
			["shinycolors", "偶像大师 闪耀色彩·日服", TZ_JP, I.IMAS_SOURCE_LABEL],
			["millisita", "偶像大师 百万现场 剧场时光·日服", TZ_JP, I.IMAS_SOURCE_LABEL],
			["deresute", "偶像大师 灰姑娘女孩 星光舞台·日服", TZ_JP, I.IMAS_SOURCE_LABEL],
			// 2026-11-15 追加：源站第 5 个品牌代号 `ss`（页面标题「シャニソン」）
			["shanison", "偶像大师 闪耀色彩 Song for Prism·日服", TZ_JP, I.IMAS_SOURCE_LABEL]
		]) {
			const s = srcOf(id);
			check(`${id} 已注册（name / tz / 标签逐字）`,
				!!s && s.name === name && s.tz === tz && s.source === label && s.eventSource === label,
				s ? JSON.stringify([s.name, s.tz, s.source, s.eventSource]) : "缺失");
			// 卡池侧重做后：只有 imas 五款还保持「卡池/活动同源同 URL」；nikki4 的两侧端点已分开（下面单独断言）
			if (id !== "nikki4") {
				check(`${id} 卡池与活动**同一条** URL（同源同轮只抓一次）`,
					!!s && !!s.url && s.url === s.eventUrl, s ? JSON.stringify([s.url, s.eventUrl]) : "缺失");
			}
			check(`${id} 出厂默认展示（defaultHidden = false）`, !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check(`${id} 有配色（面板「颜色 = 游戏」）`, !!s && /^#[0-9A-F]{6}$/i.test(String(s.color)), s && String(s.color));
		}
		// 用户 2026-11-15 明确要求：这 5 条来源的**选项文案**（source / eventSource）含日文原文
		// ⇒ 统一加「（日文）」后缀，且只许这一种。
		// 2026-11-17 用户再要求：去掉「総合カレンダー」，只留站点名 + 语言后缀。
		const IMAS_FIVE = ["gakumas", "shinycolors", "millisita", "deresute", "shanison"];
		check(`imas 5 条来源标签逐字 = 「${IMAS_LABEL_LITERAL}」（后缀只此一种）`,
			IMAS_FIVE.every((id) => srcOf(id).source === IMAS_LABEL_LITERAL && srcOf(id).eventSource === IMAS_LABEL_LITERAL),
			JSON.stringify(IMAS_FIVE.map((id) => [srcOf(id).source, srcOf(id).eventSource])));
		check("imas 5 条来源标签都**不是**旧写法（无后缀的那版已全部改掉）",
			IMAS_FIVE.every((id) => srcOf(id).source !== "melonpapapapa"),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).source)));
		check("imas 5 条的条目 name **不带**「（日文）」这类后缀（后缀只加在来源文案上）",
			IMAS_FIVE.every((id) => !/（日文）$/.test(String(srcOf(id).name))),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).name)));
		// 2026-11-15 卡池侧重做：卡池 = 新闻列表 API（`/api/v1/news`），活动 = 官网首页 —— **两条不同 URL**
		check("nikki4 卡池 URL 逐字 = 新闻列表 API（不是首页、也不是 /news/{id}）",
			srcOf("nikki4").url === N.NIKKI4_NEWS_API && srcOf("nikki4").url === "https://nikki4.papegames.cn/api/v1/news",
			String(srcOf("nikki4").url));
		check("nikki4 活动 URL 仍是官网首页（活动侧逻辑保留，未改）",
			srcOf("nikki4").eventUrl === N.NIKKI4_LIST_URL, String(srcOf("nikki4").eventUrl));
		check("nikki4 两侧 URL 已分开（旧「同一条 URL」已不成立，且不是靠 newsbanner 猜卡池）",
			srcOf("nikki4").url !== srcOf("nikki4").eventUrl,
			JSON.stringify([srcOf("nikki4").url, srcOf("nikki4").eventUrl]));
		check("imas 五款的注册地址 = 当月的各自月份页（YYYYMM + brand slug）",
			[["gakumas", "imas_gm"], ["shinycolors", "imas_sc"], ["millisita", "imas_ml"], ["deresute", "imas_cgss"], ["shanison", "imas_ss"]]
				.every(([id, slug]) => new RegExp("^https://melonpapapapa-n\\.com/" + slug + "_\\d{6}/$").test(String(srcOf(id).url))),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).url)));
		check("imas 第 5 款（shanison）brand class / 名称 / slug 三者对得上（`ss` ⇒ brand-shanison）",
			I.IMAS_BRANDS.shanison.slug === "imas_ss" && I.IMAS_BRANDS.shanison.cls === "brand-shanison"
			&& I.IMAS_BRANDS.shanison.name === "偶像大师 闪耀色彩 Song for Prism·日服",
			JSON.stringify(I.IMAS_BRANDS.shanison));
		check("7 条 id 全局唯一（没和既有来源撞 id）", new Set(allIds()).size === allIds().length, String(allIds().length));
	}

	// ═════════ ③ nikki4：活动侧（首页 4 条精选，原逻辑）+ 卡池侧（新闻 API，2026-11-15 重做）═════════
	section("第四批 ③：闪耀暖暖·国服（nikki4）真夹具 —— 活动侧（原逻辑保留）/ 卡池侧（新闻 API）/ 引擎整轮");
	{
		const N = T.parsers.nikki4;
		const TZ = TZ_CN4;
		const NOW = Date.parse("2026-11-15T15:00:00+08:00");
		const NK_LIST = N.NIKKI4_LIST_URL;
		const NK_D = (id) => N.NIKKI4_DETAIL_BASE + id;
		const ids = ["102568", "102571", "102574", "102582", "102583"];
		const BODY = { [NK_LIST]: fixtureBody(NK_LIST) };
		for (const id of ids) BODY[NK_D(id)] = fixtureBody(NK_D(id));

		// ── 活动侧（**逻辑未改**：首页 `pageData.newsbanner` 4 条精选 → `/news/{id}` 正文锚点）──
		const rows = N.nikki4HomeOf(BODY[NK_LIST], TZ);
		check("活动侧：首页 4 条精选，按新闻 id 倒序（102583 / 102574 / 102571 / 102568）",
			rows.length === 4 && rows.map((x) => x.id).join(",") === "102583,102574,102571,102568",
			JSON.stringify(rows.map((x) => x.id)));
		check("活动侧：新闻 id 取自 `info` 的 `/news/{id}`（栏目格子 id 8/9/6/10 不当新闻 id）",
			rows.every((x) => /^\d{6}$/.test(x.id)) && rows[0].url === NK_D("102583"),
			JSON.stringify(rows.map((x) => [x.id, x.url])));

		const fact = (id) => {
			const page = N.nikki4PageOf(BODY[NK_D(id)], TZ);
			return N.nikki4FactsOf({ id, title: page.title, publishTs: page.publishTs }, page, TZ);
		};
		check("两侧共用「更新后」锚定 = 当日 09:30（+08；依据见 30-game-nikki4.js 文件头 ⑧）",
			N.NIKKI4_UPDATE_ANCHOR.h === 9 && N.NIKKI4_UPDATE_ANCHOR.mi === 30,
			JSON.stringify(N.NIKKI4_UPDATE_ANCHOR));
		check("活动侧 102574：活动窗口 1 条，起止 = 2026-11-05 09:30 ~ 11-18 23:59 +08（UTC 手算 01:30Z / 15:59Z）",
			fact("102574").windows.length === 1 && fact("102574").windows[0].kind === "event"
			&& fact("102574").windows[0].startTs === Date.UTC(2026, 10, 5, 1, 30)
			&& fact("102574").windows[0].endTs === Date.UTC(2026, 10, 18, 15, 59),
			JSON.stringify(fact("102574").windows.map((w) => [w.kind, w.startTs, w.endTs])));
		check("活动侧 102574 raw 保留「11月5日更新后」⇒ 悬停印原文、外显用锚定后的可读文本",
			fact("102574").windows[0].raw === "11月5日更新后 ~ 11月18日23:59"
			&& fact("102574").windows[0].display === "11-05 09:30 ~ 11-18 23:59",
			JSON.stringify([fact("102574").windows[0].raw, fact("102574").windows[0].display]));
		check("活动侧 102583：锚点与档期**分两行**也认；活动名取正文上一行的 `【改造吧！PP游戏！】`",
			fact("102583").windows.length === 1 && fact("102583").windows[0].name === "改造吧！PP游戏！"
			&& fact("102583").windows[0].startTs === Date.UTC(2026, 10, 5, 1, 30),
			JSON.stringify(fact("102583").windows.map((w) => [w.name, w.startTs])));
		check("活动侧 102582：两端绝对时刻 + 跨年 ⇒ 2026-11-16 05:00 ~ 2027-01-17 23:59（不做「更新后」锚定）",
			fact("102582").windows.length === 1
			&& fact("102582").windows[0].startTs === Date.UTC(2026, 10, 15, 21, 0)
			&& fact("102582").windows[0].endTs === Date.UTC(2027, 0, 17, 15, 59)
			&& fact("102582").windows[0].openStart === false,
			JSON.stringify(fact("102582").windows));
		check("活动侧：只有起点没有终点的两篇（概念PV / 套装预告）⇒ 0 窗口",
			fact("102568").windows.length === 0 && fact("102571").windows.length === 0,
			JSON.stringify([fact("102568").windows.length, fact("102571").windows.length]));

		// ── 卡池侧：新闻列表 API（`/api/v1/news?section=1|0`）──
		const API = N.NIKKI4_NEWS_API;
		const NK_S1 = `${API}?section=1&offset=0&limit=40`;
		const NK_S0 = `${API}?section=0&offset=0&limit=20`;
		const NK_ND = (id) => `${API}/${id}`;
		// 21 天窗内的 15 篇（公告 13 + 资讯 2）= 抓取器实际会请求的全部详情
		const NK_CAND = ["102586", "102585", "102583", "102582", "102581", "102578", "102577", "102575", "102573", "102574", "102572", "102571", "102570", "102569", "102568"];
		const NEWS = { [NK_S1]: JSON.parse(fixtureBody(NK_S1)), [NK_S0]: JSON.parse(fixtureBody(NK_S0)) };
		for (const id of NK_CAND) NEWS[NK_ND(id)] = JSON.parse(fixtureBody(NK_ND(id)));

		check("卡池侧扫描分段逐字 = 公告 1（40 条）+ 资讯 0（20 条）；2/3 段不扫（功能优化 / 单品，从不放感应公告）",
			JSON.stringify(N.NIKKI4_GACHA_SECTIONS) === '[{"section":1,"limit":40},{"section":0,"limit":20}]'
			&& N.NIKKI4_SCAN_DAYS === 21 && N.NIKKI4_GACHA_MAX_DETAILS === 24,
			JSON.stringify([N.NIKKI4_GACHA_SECTIONS, N.NIKKI4_SCAN_DAYS, N.NIKKI4_GACHA_MAX_DETAILS]));

		const listS1 = N.nikki4NewsListOf(NEWS[NK_S1], TZ);
		const listS0 = N.nikki4NewsListOf(NEWS[NK_S0], TZ);
		check("列表 API：公告 40 条 / 资讯 20 条，按发布时间倒序",
			listS1.length === 40 && listS0.length === 20
			&& listS1.every((r, i) => i === 0 || listS1[i - 1].publishTs >= r.publishTs)
			&& listS1[0].id === "102586" && listS0[0].id === "102569",
			JSON.stringify([listS1.length, listS0.length, listS1[0].id, listS0[0].id]));
		check("列表 publish_time 是 ISO UTC ⇒ 直接按**绝对时刻**解析（不当 +08 墙钟；首条 = 2026-11-03T08:44:14Z）",
			listS1[0].publishTs === Date.UTC(2026, 10, 3, 8, 44, 14)
			&& listS0[0].publishTs === Date.UTC(2026, 10, 1, 13, 12, 6)
			&& N.nikki4ApiTsOf("2026-11-03T08:44:14.000Z") === Date.UTC(2026, 10, 3, 8, 44, 14)
			&& N.nikki4ApiTsOf("") === 0,
			JSON.stringify([listS1[0].publishTs, listS0[0].publishTs]));

		// ── 卡池侧：详情 API → 限时感应块（两种写法）──
		const post = (id) => N.nikki4NewsDetailOf(NEWS[NK_ND(id)], TZ);
		const pools = (id) => N.nikki4GachaPoolsOf(post(id), TZ);
		check("详情 API：`data[0]` 的 title / content_html / publish_time（ISO UTC）",
			post("102572").title === "【闪暖荆棘鸟·免费80抽】同步送闪耀单品、创意妆容等福利 | 11月5日更新"
			&& post("102572").publishTs === Date.UTC(2026, 10, 1, 13, 20, 38)
			&& post("102572").contentHtml.includes("新意节特别活动【笼中歌】"),
			JSON.stringify([post("102572").title, post("102572").publishTs]));
		check("**当期卡池**逐字：102572（形态 B「新意节特别活动【笼中歌】」+「活动时间&兑换时间」）⇒ 笼中歌 / 11-05 09:30 ~ 11-18 23:59",
			pools("102572").length === 1 && pools("102572")[0].name === "笼中歌"
			&& pools("102572")[0].startTs === Date.UTC(2026, 10, 5, 1, 30)
			&& pools("102572")[0].endTs === Date.UTC(2026, 10, 18, 15, 59)
			&& pools("102572")[0].raw === "11月5日更新后 ~ 11月18日23:59"
			&& pools("102572")[0].display === "11-05 09:30 ~ 11-18 23:59"
			&& pools("102572")[0].openStart === true,
			JSON.stringify(pools("102572")));
		check("形态 A（`限时感应活动：<池名>` ⏎ `活动时间：…`）也认：102277 ⇒ 风谷沉语 / 2026-01-16 09:30 ~ 01-25 23:59",
			(() => {
				const p = N.nikki4GachaPoolsOf(N.nikki4NewsDetailOf(JSON.parse(fixtureBody(NK_ND("102277"))), TZ), TZ);
				return p.length === 1 && p[0].name === "风谷沉语"
					&& p[0].startTs === Date.UTC(2026, 0, 16, 1, 30)
					&& p[0].endTs === Date.UTC(2026, 0, 25, 15, 59);
			})(),
			"102277");
		check("门槛：只有「兑换时间」没有「活动时间」的 102573 ⇒ 0 条（兑换时间不是卡池档期）",
			pools("102573").length === 0, JSON.stringify(pools("102573")));
		check("门槛：名字在前的商城活动 102578（`【绮夜新意】主题活动`）⇒ 0 条（不拿活动冒充卡池）",
			pools("102578").length === 0, JSON.stringify(pools("102578")));
		check("门槛：只有「【笼中歌】限时感应活动即将开启」没有档期的 102571 ⇒ 0 条（不硬凑）",
			pools("102571").length === 0, JSON.stringify(pools("102571")));
		check("21 天窗内 15 篇里只有 102572 产出卡池（其余 14 篇 0 条，不误报累充/福利/礼包）",
			NK_CAND.filter((id) => pools(id).length > 0).join(",") === "102572",
			JSON.stringify(NK_CAND.filter((id) => pools(id).length > 0)));

		// ── 卡池侧抓取器：请求数 + 载荷 ──
		N.nikki4ResetCache();
		const gsink = [];
		const d0 = await (async () => {
			const e = engineAt(NOW, "nikki4", gsink);
			const s = e.__test.SOURCES.find((x) => x.id === "nikki4");
			return e.__test.GACHA_FETCHERS["nikki4"](s.url, undefined, s.tz);
		})();
		check("卡池侧首轮 = 17 次（2 列表 + 15 篇 21 天内详情；活动侧不算在这里）",
			gsink.length === 17 && gsink[0] === NK_S1 && gsink[1] === NK_S0
			&& gsink.slice(2).every((u) => u.startsWith(API + "/") && NK_CAND.includes(u.slice(API.length + 1))),
			"requests=" + gsink.length + " " + JSON.stringify(gsink));
		check("卡池载荷：banner / bannerDates / bannerDatesRaw / 绝对毫秒（起止都在 gacha[0] 上）",
			!!d0 && d0.banner === "笼中歌" && d0.bannerDates === "11-05 09:30 ~ 11-18 23:59"
			&& d0.bannerDatesRaw === "11月5日更新后 ~ 11月18日23:59"
			&& d0.startTs === Date.UTC(2026, 10, 5, 1, 30) && d0.endTs === Date.UTC(2026, 10, 18, 15, 59)
			&& Array.isArray(d0.gacha) && d0.gacha.length === 1
			&& d0.gacha[0].key === "nikki4:gacha:0" && d0.gacha[0].title === "笼中歌"
			&& d0.gacha[0].startTs === Date.UTC(2026, 10, 5, 1, 30)
			&& d0.gacha[0].endTs === Date.UTC(2026, 10, 18, 15, 59),
			JSON.stringify(d0 && { b: d0.banner, d: d0.bannerDates, raw: d0.bannerDatesRaw, g: d0.gacha }));

		// ── 引擎整轮（卡池 + 活动同轮）──
		N.nikki4ResetCache();
		const calls = [];
		const e = engineAt(NOW, "nikki4", calls);
		const rec = (await e.refresh()).games.nikki4 || {};
		check("引擎：首轮 22 次 = 卡池 17（2 列表 + 15 详情）+ 活动 5（首页 1 + 4 篇精选详情）",
			calls.length === 22 && calls.filter((u) => u === NK_S1).length === 1 && calls.filter((u) => u === NK_S0).length === 1
			&& calls.filter((u) => u === NK_LIST).length === 1
			&& ["102583", "102574", "102571", "102568"].every((id) => calls.filter((x) => x === NK_D(id)).length === 1)
			&& NK_CAND.every((id) => calls.filter((x) => x === NK_ND(id)).length === 1),
			"requests=" + calls.length + " " + JSON.stringify(calls));
		check("引擎外显（卡池）：笼中歌 / 11-05 09:30 ~ 11-18 23:59（raw 保留「更新后」；不再是精选里没感应帖就恒空）",
			rec.banner === "笼中歌" && rec.bannerDates === "11-05 09:30 ~ 11-18 23:59"
			&& rec.bannerDatesRaw === "11月5日更新后 ~ 11月18日23:59" && rec.gachaFail === null,
			JSON.stringify([rec.banner, rec.bannerDates, rec.bannerDatesRaw, rec.gachaFail]));
		check("引擎外显（活动）：活动 = 改造吧！PP游戏！/ 11-05 09:30 ~ 11-18 23:59（活动侧逻辑保留）",
			rec.event === "改造吧！PP游戏！" && rec.eventDates === "11-05 09:30 ~ 11-18 23:59"
			&& rec.eventDatesRaw === "11月5日更新后 ~ 11月18日23:59" && rec.eventFail === null,
			JSON.stringify([rec.event, rec.eventDates, rec.eventDatesRaw]));
		check("引擎：两侧都出数；卡池数组 1 条（key = `nikki4:gacha:0`）、活动数组 2 条",
			Array.isArray(rec.gacha) && rec.gacha.length === 1 && rec.gacha[0].key === "nikki4:gacha:0"
			&& Array.isArray(rec.events) && rec.events.length === 2
			&& rec.events.every((x) => x.key.startsWith("nikki4:event:")),
			JSON.stringify([(rec.gacha || []).map((x) => x.key), (rec.events || []).map((x) => x.key)]));
		if (rec.eventHover) assertHoverConvention("nikki4 活动悬停", rec.eventHover, { requireSet: true });
		if (rec.bannerHover) assertHoverConvention("nikki4 卡池悬停", rec.bannerHover);

		// 稳态：详情按 id 缓存命中 ⇒ 第二轮只剩列表 + 首页
		const before = calls.length;
		await e.refresh();
		check("引擎稳态：第二轮只 3 次（2 列表 + 1 首页；详情按 id 缓存 24h 命中）",
			calls.length - before === 3
			&& calls.slice(before).filter((u) => u === NK_S1 || u === NK_S0 || u === NK_LIST).length === 3,
			"+" + (calls.length - before) + " " + JSON.stringify(calls.slice(before)));

		// 无当期 ⇒ null（解析到了笼中歌，但 now=11/20 已过 11/18 结束 ⇒ 不硬凑过期档期）
		N.nikki4ResetCache();
		const calls2 = [];
		const e2 = engineAt(Date.parse("2026-11-20T15:00:00+08:00"), "nikki4", calls2);
		const rec2 = (await e2.refresh()).games.nikki4 || {};
		check("无当期（11/20，笼中歌 11/18 已结束）⇒ 卡池侧 null / nomatch（不是抛错、也不冒充有池）",
			rec2.banner === "" && String((rec2.gachaFail || {}).kind) === "nomatch",
			JSON.stringify([rec2.banner, rec2.gachaFail]));
		check("无当期时仍把 15 篇详情拉全（解析过、只是没覆盖 now）⇒ 整轮仍 22 次",
			calls2.length === 22, "requests=" + calls2.length);
	}

	// ═════════ ④ アイドルマスター系列 5 款：月份页（1 次请求 / 跨月补抓）═════════
	section("第四批 ④：アイドルマスター系列 5 款真夹具 —— 名 + 起止（卡池 + 活动）");
	{
		const I = T.parsers.idolmaster;
		const NOW = Date.parse("2026-11-15T12:00:00+09:00");
		const jst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
		const fetchOf = async (id, now, sink, overrides) => {
			const e = engineAt(now, id, sink, overrides);
			const s = e.__test.SOURCES.find((x) => x.id === id);
			const d = await e.__test.GACHA_FETCHERS[id](s.url, undefined, s.tz);
			return { d, fu: e.__test.EVENT_FETCHERS[id].default };
		};

		// 学マス：当月页 1 次；卡池/活动起止到分
		{
			const sink = [];
			const { d } = await fetchOf("gakumas", NOW, sink);
			check("学マス：只抓当月页 1 次", sink.length === 1 && /imas_gm_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("学マス 卡池 = LIVE TOUR -標-ファイナル公演記念ガシャDAY2 · 11-08 21:00 ~ 11-16 09:59（JST→绝对毫秒）",
				!!d && d.banner === "LIVE TOUR -標-ファイナル公演記念ガシャDAY2"
				&& d.startTs === jst(2026, 11, 8, 21, 0) && d.endTs === jst(2026, 11, 16, 9, 59)
				&& d.bannerDates === "11-08 21:00 ~ 11-16 09:59" && d.bannerDatesRaw === "11/8 21:00 ~ 11/16 09:59",
				d ? JSON.stringify([d.banner, d.bannerDates, d.startTs, d.endTs]) : "null");
			check("学マス 活动 = 「氷渡香名江エピソード0」公開，起止同窗",
				!!d && d.event === "「氷渡香名江エピソード0」公開" && d.eventDates === "11-08 21:00 ~ 11-16 09:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
			if (d && d.bannerHover) assertHoverConvention("学マス 卡池悬停", d.bannerHover);
		}
		// シャニマス
		{
			const sink = [];
			const { d } = await fetchOf("shinycolors", NOW, sink);
			check("シャニマス：只抓当月页 1 次", sink.length === 1 && /imas_sc_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("シャニマス 卡池 = 【ふたりぶんわんだふる】市川 雛菜 特別ピンナップアイドルスタンプガシャ · 11-11 00:00 ~ 11-18 11:59",
				!!d && d.banner === "【ふたりぶんわんだふる】市川 雛菜 特別ピンナップアイドルスタンプガシャ"
				&& d.startTs === jst(2026, 11, 11, 0, 0) && d.endTs === jst(2026, 11, 18, 11, 59),
				d ? JSON.stringify([d.banner, d.bannerDates]) : "null");
			check("シャニマス 活动 = 2026年11月「マスターズフェス」· 11-10 15:00 ~ 11-18 04:59",
				!!d && d.event === "2026年11月「マスターズフェス」" && d.eventDates === "11-10 15:00 ~ 11-18 04:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
		}
		// ミリシタ / デレステ
		{
			const { d: ml } = await fetchOf("millisita", NOW, []);
			check("ミリシタ 卡池 = Snapshot Memoriesガシャ · 11-09 15:00 ~ 11-17 14:59",
				!!ml && ml.banner === "Snapshot Memoriesガシャ" && ml.bannerDates === "11-09 15:00 ~ 11-17 14:59"
				&& ml.startTs === jst(2026, 11, 9, 15, 0) && ml.endTs === jst(2026, 11, 17, 14, 59),
				ml ? JSON.stringify([ml.banner, ml.bannerDates]) : "null");
			check("ミリシタ 活动 = ミリコレ！～MILLIONLIVE COLLECTION～ · 11-09 15:00 ~ 11-15 20:59",
				!!ml && ml.event === "ミリコレ！～MILLIONLIVE COLLECTION～" && ml.eventDates === "11-09 15:00 ~ 11-15 20:59",
				ml ? JSON.stringify([ml.event, ml.eventDates]) : "null");
			const { d: cs } = await fetchOf("deresute", NOW, []);
			check("デレステ 卡池 = プレミアムオーディションガシャ · 11-15 00:00 ~ 11-23 23:59",
				!!cs && cs.banner === "プレミアムオーディションガシャ" && cs.bannerDates === "11-15 00:00 ~ 11-23 23:59"
				&& cs.startTs === jst(2026, 11, 15, 0, 0) && cs.endTs === jst(2026, 11, 23, 23, 59),
				cs ? JSON.stringify([cs.banner, cs.bannerDates]) : "null");
			check("デレステ 活动 = SSレアアイドル勧誘チャレンジ · 11-01 00:00 ~ 11-30 23:59",
				!!cs && cs.event === "SSレアアイドル勧誘チャレンジ" && cs.eventDates === "11-01 00:00 ~ 11-30 23:59",
				cs ? JSON.stringify([cs.event, cs.eventDates]) : "null");
		}
		// シャニソン（第 5 款）：源站代号 `ss`，与上面 4 款同一套月份页 → 同一个抓取器形态
		{
			const sink = [];
			const { d } = await fetchOf("shanison", NOW, sink);
			check("シャニソン：只抓当月页 1 次（`imas_ss_202611`）", sink.length === 1 && /imas_ss_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("シャニソン 卡池 = 小糸誕生日記念ガシャ2026 · 11-11 00:00 ~ 11-17 23:59（JST→绝对毫秒；`t-text` 写的是 0:00，raw 补零成 00:00）",
				!!d && d.banner === "小糸誕生日記念ガシャ2026"
				&& d.startTs === jst(2026, 11, 11, 0, 0) && d.endTs === jst(2026, 11, 17, 23, 59)
				&& d.bannerDates === "11-11 00:00 ~ 11-17 23:59" && d.bannerDatesRaw === "11/11 00:00 ~ 11/17 23:59",
				d ? JSON.stringify([d.banner, d.bannerDates, d.bannerDatesRaw, d.startTs, d.endTs]) : "null");
			check("シャニソン 活动 = 第18回テクニカルチャレンジ杯「秋の終わり、僕の記憶(xRライブ ver.)」· 11-13 12:00 ~ 11-16 20:59",
				!!d && d.event === "第18回テクニカルチャレンジ杯「秋の終わり、僕の記憶(xRライブ ver.)」"
				&& d.eventDates === "11-13 12:00 ~ 11-16 20:59"
				&& d.eventDatesRaw === "11/13 12:00 ~ 11/16 20:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
			// 夹具里 cat-gacha 6 条 / cat-event 3 条都在期内（其余 cat-login/mission/shop/other 一律不进）
			check("シャニソン：cat-gacha 6 条进卡池数组 / cat-event 3 条进活动数组（ログボ·ミッション·ショップ·その他 一条不进）",
				!!d && d.gacha.length === 6 && d.events.length === 3
				&& JSON.stringify(d).indexOf("ログインボーナス") < 0 && JSON.stringify(d).indexOf("記念ミッション") < 0
				&& JSON.stringify(d).indexOf("販売") < 0,
				d ? JSON.stringify([d.gacha.length, d.events.length, d.gacha.map((x) => x.title)]) : "null");
			if (d && d.bannerHover) assertHoverConvention("シャニソン 卡池悬停", d.bannerHover);
			if (d && d.eventHover) assertHoverConvention("シャニソン 活动悬停", d.eventHover);
		}
		// 月初：当月页无覆盖 ⇒ 补抓上一月（跨月条目只在上一月页带完整起点）
		{
			const sink = [];
			const { d } = await fetchOf("gakumas", Date.parse("2026-11-01T12:00:00+09:00"), sink);
			check("月初（11/01 12:00 JST 11 月页还没开池）⇒ 当月 + 上一月 = 2 次请求",
				sink.length === 2 && /imas_gm_202611\/$/.test(sink[0]) && /imas_gm_202610\/$/.test(sink[1]),
				JSON.stringify(sink));
			check("跨月卡池从上一月页拿到完整起点（10-09 11:00 ~ 11-04 10:59）",
				!!d && d.banner === "アナザーアイドルアップデート記念！48 時間限定 SSR アナザーアイドル確定ガシャ"
				&& d.bannerDates === "10-09 11:00 ~ 11-04 10:59"
				&& d.startTs === jst(2026, 10, 9, 11, 0) && d.endTs === jst(2026, 11, 4, 10, 59),
				d ? JSON.stringify([d.banner, d.bannerDates]) : "null");
			check("跨月活动也从上一月页补齐（あさり先生のプロデュースゼミ · 10-30 11:00 ~ 11-09 10:59）",
				!!d && d.event === "あさり先生のプロデュースゼミ" && d.eventDates === "10-30 11:00 ~ 11-09 10:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
		}
	}

	// ═════════ ⑤ 反证（`{}` ⇒ 抛错；抹掉时间锚点 ⇒ 不进外显）═════════
	section("第四批 ⑤：反证 —— `{}` ⇒ 抛错（不是 nomatch）/ 抹掉时间锚点 ⇒ 不进外显");
	{
		const N = T.parsers.nikki4, I = T.parsers.idolmaster;
		const throws = (fn) => { try { fn(); return false; } catch { return true; } };
		check("nikki4 反证：首页 `{}` / 空串 / 没有 __NEXT_DATA__ / 无 newsbanner ⇒ 抛错",
			throws(() => N.nikki4HomeOf({})) && throws(() => N.nikki4HomeOf(""))
			&& throws(() => N.nikki4HomeOf("<html></html>"))
			&& throws(() => N.nikki4HomeOf('<script id="__NEXT_DATA__">{"props":{"pageProps":{"pageData":{}}}}</script>')));
		check("nikki4 反证：详情 `{}` / 空串 / 没有 pageData（不存在的 id 的骨架页）⇒ 抛错",
			throws(() => N.nikki4PageOf({})) && throws(() => N.nikki4PageOf(""))
			&& throws(() => N.nikki4PageOf('<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>')));

		// 抹掉时间锚点 ⇒ 0 窗口（不抛、不进外显）
		const NK_102574 = N.NIKKI4_DETAIL_BASE + "102574";
		const nkNoAnchor = fixtureBody(NK_102574).replace(/活动时间/g, "活动说明");
		check("nikki4 反证：抹掉 `活动时间` 锚点 ⇒ 这篇 0 窗口（不进外显、不抛）",
			(() => {
				const page = N.nikki4PageOf(nkNoAnchor, TZ_CN4);
				return N.nikki4FactsOf({ id: "102574", title: page.title }, page, TZ_CN4).windows.length === 0;
			})(),
			"0 windows");

		// ── 卡池侧（新闻 API）反证：结构变 ⇒ 抛（不是 nomatch）；档期缺失/换成兑换时间 ⇒ 0 条 ──
		const NK_API = N.NIKKI4_NEWS_API;
		const NK_ND = (id) => `${NK_API}/${id}`;
		const NK_CAND = ["102586", "102585", "102583", "102582", "102581", "102578", "102577", "102575", "102573", "102574", "102572", "102571", "102570", "102569", "102568"];
		check("卡池侧反证：列表 `{}` / `ret != 0` / 没有 `data.data` / 一条合法新闻都没有 ⇒ 抛 `nikki4-news-list-changed:*`",
			(() => {
				const errs = [
					(() => { try { N.nikki4NewsListOf({}, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsListOf({ ret: 1, data: { data: [] } }, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsListOf({ ret: 0, data: {} }, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsListOf({ ret: 0, data: { total: 0, data: [] } }, TZ_CN4); return ""; } catch (e) { return e.message; } })()
				];
				return errs.every((m) => /^nikki4-news-list-changed:/.test(m));
			})(),
			"list 4 种坏结构");
		check("卡池侧反证：详情 `{}` / 不存在 id 的 `data:{}` / 首项 `{}` / `ret != 0` ⇒ 抛 `nikki4-news-detail-changed:*`",
			(() => {
				const errs = [
					(() => { try { N.nikki4NewsDetailOf({}, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsDetailOf({ ret: 0, data: {} }, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsDetailOf({ ret: 0, data: [{}] }, TZ_CN4); return ""; } catch (e) { return e.message; } })(),
					(() => { try { N.nikki4NewsDetailOf({ ret: 2, data: [] }, TZ_CN4); return ""; } catch (e) { return e.message; } })()
				];
				return errs.every((m) => /^nikki4-news-detail-changed:/.test(m));
			})(),
			"detail 4 种坏结构");
		check("卡池侧反证：抹掉 102572 的 `活动时间` 锚点 ⇒ 这篇 0 条（不抛、也不拿「兑换时间」顶替）",
			(() => {
				const mut = JSON.parse(fixtureBody(NK_ND("102572")));
				mut.data[0].content_html = String(mut.data[0].content_html).replace(/活动时间/g, "活动说明");
				return N.nikki4GachaPoolsOf(N.nikki4NewsDetailOf(mut, TZ_CN4), TZ_CN4).length === 0;
			})(),
			"102572 无活动时间");
		check("卡池侧反证：只剩「兑换时间」的行 ⇒ 0 条（兑换商店档期不是卡池档期）",
			(() => {
				const mut = JSON.parse(fixtureBody(NK_ND("102572")));
				mut.data[0].content_html = String(mut.data[0].content_html).replace(/活动时间(?:&amp;|&)兑换时间/g, "兑换时间");
				return N.nikki4GachaPoolsOf(N.nikki4NewsDetailOf(mut, TZ_CN4), TZ_CN4).length === 0;
			})(),
			"102572 只剩兑换时间");
		{
			// 15 篇详情全部结构坏 ⇒ 抛（抓取失败 ≠ 未公布；与活动侧同一套语义）
			const overrides = {};
			for (const id of NK_CAND) overrides[NK_ND(id)] = "{}";
			N.nikki4ResetCache();
			const e = engineAt(Date.parse("2026-11-15T15:00:00+08:00"), "nikki4", [], overrides);
			const s = e.__test.SOURCES.find((x) => x.id === "nikki4");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["nikki4"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("卡池侧反证：15 篇详情全部结构坏 ⇒ 抛 `nikki4-news-detail-changed:*`（不是静默成「本期没有」）",
				!!err && /^nikki4-news-detail-changed:/.test(String(err.message)), JSON.stringify(err && err.message));
		}

		// imas：抹掉**单条**的时刻锚 ⇒ 该条不进 gacha[]（其余与外显不变，且不抛）
		const GM11_URL = "https://melonpapapapa-n.com/imas_gm_202611/";
		const GM11 = fixtureBody(GM11_URL);
		const oneGone = String(GM11).replace(/<tr class='calendar-row[\s\S]*?<\/tr>/g, (row) =>
			(row.indexOf("ガラクタロード Vol.7 千奈ガシャ") >= 0 ? row.replace(/<span class='t-text'>[^<]*<\/span>/g, "") : row));
		{
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: oneGone });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			const d = await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz);
			check("imas 反证：抹掉单条的时刻锚 ⇒ 该条不进 gacha[]（4 → 3），外显仍是 DAY2",
				!!d && d.gacha.length === 3 && d.banner === "LIVE TOUR -標-ファイナル公演記念ガシャDAY2"
				&& JSON.stringify(d).indexOf("千奈ガシャ") < 0,
				d ? JSON.stringify([d.banner, d.gacha.map((x) => x.title)]) : "null");
		}
		// 所有时刻锚都抹掉 ⇒ 结构错（不许静默成"本期没有"）
		{
			const allGone = String(GM11).replace(/<span class='t-text'>[^<]*<\/span>/g, "");
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: allGone });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("imas 反证：所有时刻锚都消失 ⇒ 抛 `imas-gakumas-rows-changed`（不是「未公布」）",
				!!err && err.message === "imas-gakumas-rows-changed", JSON.stringify(err && err.message));
		}
		// `{}` ⇒ 抛 `imas-gakumas-no-table`（页面结构变了，不许冒充"当期没有"）
		{
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: "{}" });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("imas 反证：月份页回 `{}` ⇒ 抛 `imas-gakumas-no-table`",
				!!err && err.message === "imas-gakumas-no-table", JSON.stringify(err && err.message));
		}
		// 第 5 款同一套失败语义（错误码带自己的 brand key：`imas-shanison-…`）
		{
			const SS11_URL = "https://melonpapapapa-n.com/imas_ss_202611/";
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "shanison", [], { [SS11_URL]: "{}" });
			const s = e.__test.SOURCES.find((x) => x.id === "shanison");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["shanison"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("シャニソン 反证：月份页回 `{}` ⇒ 抛 `imas-shanison-no-table`（与老四款同一套语义）",
				!!err && err.message === "imas-shanison-no-table", JSON.stringify(err && err.message));
			const allGone = String(fixtureBody(SS11_URL)).replace(/<span class='t-text'>[^<]*<\/span>/g, "");
			const e2 = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "shanison", [], { [SS11_URL]: allGone });
			const s2 = e2.__test.SOURCES.find((x) => x.id === "shanison");
			let err2 = null;
			try { await e2.__test.GACHA_FETCHERS["shanison"](s2.url, undefined, s2.tz); } catch (x) { err2 = x; }
			check("シャニソン 反证：所有时刻锚都消失 ⇒ 抛 `imas-shanison-rows-changed`",
				!!err2 && err2.message === "imas-shanison-rows-changed", JSON.stringify(err2 && err2.message));
		}
		check("imas 反证：条目全部已结束 ⇒ 卡池/活动侧 null（不是抛错）",
			I.imasSidePayloadOf([{ name: "往期池", startTs: Date.UTC(2026, 9, 1, 0, 0), endTs: Date.UTC(2026, 9, 2, 0, 0), raw: "10/1 00:00 ~ 10/2 00:00" }],
				"gacha", "gakumas", TZ_JP, Date.parse("2026-11-15T12:00:00+09:00")) === null);
	}

	// ═════════ ⑤（2026-11-18 真机修复）宿主代理「不发 Origin」开关 + nikki4 卡池侧启用 ═════════
	//
	// 真机依据（2026-11-18 实测，同一 IP / UA / Referer，只改 Origin）：
	//   GET https://nikki4.papegames.cn/api/v1/news?section=1&offset=0&limit=40
	//     `Origin: https://nikki4.papegames.cn` → **HTTP 403**
	//     `Origin: https://example.com`          → **HTTP 403**
	//     **不带 Origin**                         → **HTTP 200**
	//   同域**首页**（活动侧 `https://nikki4.papegames.cn/`）带 Origin 也是 200 ⇒ 只有 `/api/` 路径的
	//   WAF 对 Origin 敏感；列表段 + 24 篇详情 26 请求 2.8s 全 200 ⇒ 不是频率 / Referer 问题。
	//   修法：宿主代理认 `?origin=0`（不发 Origin 头），只有 nikki4 **卡池侧**三条请求带
	//   `noOrigin: true`；活动侧首页带 Origin 也是 200 ⇒ 一个字节都不改（下面 ③ 是反向证明）。
	section("第四批 ⑤：宿主代理 origin=0（nikki4 卡池侧不发 Origin；活动侧反向证明不改）");
	{
		// 与 ③ 的 nikki4 夹具同一抓取时刻（夹具覆盖的那一轮）
		const NOW = Date.parse("2026-11-15T15:00:00+08:00");
		// ── ① 宿主：出站头唯一构造点 `proxyHeadersOf` 的**真实实现**（截取后直接跑）──
		{
			const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
			const m = /\nfunction proxyHeadersOf\(target, referer, noOrigin\) \{\n([\s\S]*?)\n\}/.exec(hostSrc);
			check("⑤① 宿主有纯函数 proxyHeadersOf(target, referer, noOrigin)（出站头唯一构造点）",
				!!m, "src/index.js 里没找到该函数（签名变了？）");
			let fn = null;
			if (m) fn = new Function("UA", "return function proxyHeadersOf(target, referer, noOrigin) {" + m[1] + "\n};")("test-UA");
			const target = new URL("https://nikki4.papegames.cn/api/v1/news?section=1&offset=0&limit=40");
			const referer = "https://nikki4.papegames.cn/newslist";
			const withOrigin = fn ? fn(target, referer, false) : {};
			const withoutOrigin = fn ? fn(target, referer, true) : {};
			check("⑤① 默认（noOrigin=false）⇒ 照旧带 `Origin: <目标站 origin>`（其它来源既有行为不变）",
				withOrigin.Origin === "https://nikki4.papegames.cn", JSON.stringify(withOrigin));
			check("⑤① origin=0（noOrigin=true）⇒ **完全没有** Origin 头（反证：带 Origin → 403 / 不带 → 200）",
				fn !== null && !Object.prototype.hasOwnProperty.call(withoutOrigin, "Origin"), JSON.stringify(withoutOrigin));
			check("⑤① 其它头不受影响（UA / Accept / Referer 仍在）",
				withoutOrigin["User-Agent"] === "test-UA"
				&& /application\/json/.test(String(withoutOrigin.Accept))
				&& withoutOrigin.Referer === referer, JSON.stringify(withoutOrigin));
			check("⑤① proxyHandler 从查询参数读 `origin=0` 并交给 proxyHeadersOf（静态接线）",
				/parsed\.searchParams\.get\("origin"\) === "0"/.test(hostSrc)
				&& /const headers = proxyHeadersOf\(target, referer, noOrigin\);/.test(hostSrc));
			check("⑤① 注释写明实测证据（带 Origin → 403 / 不带 Origin → 200，2026-11-18）",
				/不带 Origin → 200/.test(hostSrc) && /403/.test(hostSrc) && /2026-11-18/.test(hostSrc));
		}

		// ── ② 代理 URL 上的 origin=0 只由 dshProxyApiOf 拼、且只拼一次（幂等）──
		const originParamCount = (s) => (String(s).match(/[?&]origin=0(?:&|$)/g) || []).length;
		{
			const apiFn = T.dshProxyApiOf;
			check("⑤② __regression 暴露 dshProxyApiOf（92-dsh-env.js 的唯一拼装点，测试不必抄一份拼装逻辑）",
				typeof apiFn === "function", typeof apiFn);
			if (typeof apiFn === "function") {
				const target = "https://nikki4.papegames.cn/api/v1/news?section=1&offset=0&limit=40";
				const referer = "https://nikki4.papegames.cn/newslist";
				const on = apiFn(target, { referer, noOrigin: true });
				const onAgain = apiFn(target, { referer, noOrigin: true });
				const off = apiFn(target, { referer });
				const offFalse = apiFn(target, { referer, noOrigin: false });
				check("⑤② noOrigin=true ⇒ 代理 URL 上有且仅有 1 个 `origin=0`", originParamCount(on.api) === 1, on.api);
				check("⑤② 缺省 / noOrigin=false ⇒ 代理 URL 上一个 `origin=0` 都没有（其它来源逐字不变）",
					originParamCount(off.api) === 0 && originParamCount(offFalse.api) === 0, off.api);
				check("⑤② 目标站地址原样编进 url 参数（不在目标 URL 上手改，也不会拼成代理套代理）",
					decodeURIComponent(new URL(on.api, "http://dsh.local").searchParams.get("url")) === target
					&& !/gacha-calendar-proxy/.test(decodeURIComponent(new URL(on.api, "http://dsh.local").searchParams.get("url"))));
				check("⑤② 幂等：同一入参两次拼装逐字相同", on.api === onAgain.api);
			}
		}

		// ── ③ 抓取器端到端（真夹具）：卡池侧所有代理请求带 origin=0；活动侧一条都不带 ──
		{
			const N = T.parsers.nikki4;
			const HOST = "nikki4.papegames.cn";
			const hostOf = (u) => { try { return new URL(String(u)).hostname; } catch { return ""; } };
			// 记账 transport：`fetchViaProxy` 收到的就是**目标站地址**（与真实宿主代理同一形态）。
			const makeOptsTransport = (sink) => ({
				async fetchRaw(url) { throw new Error("nikki4 两侧都走宿主代理：" + url); },
				async fetchViaProxy(url, opts) {
					sink.push({ url: String(url), opts: opts || {} });
					return fixtureBody(String(url));
				}
			});
			check("⑤③ 前置：验证用夹具已登记（卡池列表两段 + 首页）",
				!!fixtureBody(N.NIKKI4_NEWS_API + "?section=1&offset=0&limit=40")
				&& !!fixtureBody(N.NIKKI4_NEWS_API + "?section=0&offset=0&limit=20")
				&& !!fixtureBody(N.NIKKI4_LIST_URL));

			// 卡池侧：2 次列表 + 详情（21 天内候选），**全部**应带 noOrigin: true
			N.nikki4ResetCache();
			const gachaSink = [];
			const eg = createEngine({ transport: makeOptsTransport(gachaSink), storage: makeStore(), now: () => NOW, timer: { setTimeout, clearTimeout } });
			const sg = eg.__test.SOURCES.find((x) => x.id === "nikki4");
			let gachaErr = null;
			try { await eg.__test.GACHA_FETCHERS["nikki4"](sg.url, void 0, sg.tz); } catch (x) { gachaErr = x; }
			const gachaCalls = gachaSink.filter((c) => hostOf(c.url) === HOST);
			check("⑤③ 卡池侧真的发出了代理请求（列表 2 段 + 详情若干，全部 nikki4 主机）",
				gachaCalls.length >= 3 && gachaCalls.length === gachaSink.length,
				JSON.stringify({ gacha: gachaSink.length, nikki4: gachaCalls.length, err: gachaErr && gachaErr.message }));
			check("⑤③ 卡池侧**所有**代理请求都带 `noOrigin: true`（含两次列表 + 全部详情）",
				gachaCalls.length > 0 && gachaCalls.every((c) => c.opts.noOrigin === true),
				JSON.stringify(gachaCalls.filter((c) => c.opts.noOrigin !== true).map((c) => c.url).slice(0, 3)));
			check("⑤③ 卡池侧每个请求拼出的代理 URL 都带 `origin=0`（且只有 1 个）",
				gachaCalls.length > 0 && gachaCalls.every((c) => originParamCount(T.dshProxyApiOf(c.url, c.opts).api) === 1));
			check("⑤③ 卡池侧确实解析出池事实（不是靠失败走完流程）", !gachaErr, JSON.stringify(gachaErr && gachaErr.message));

			// 活动侧：首页 + 详情，**一条都不带**（首页带 Origin 也是 200 ⇒ 刻意不改）
			N.nikki4ResetCache();
			const eventSink = [];
			const ee = createEngine({ transport: makeOptsTransport(eventSink), storage: makeStore(), now: () => NOW, timer: { setTimeout, clearTimeout } });
			const se = ee.__test.SOURCES.find((x) => x.id === "nikki4");
			let eventErr = null;
			try { await ee.__test.EVENT_FETCHERS["nikki4"].default(se.eventUrl, void 0, se.tz); } catch (x) { eventErr = x; }
			const eventCalls = eventSink.filter((c) => hostOf(c.url) === HOST);
			check("⑤③ 活动侧真的发出了代理请求（首页 + 详情）", eventCalls.length >= 2 && eventCalls.length === eventSink.length,
				JSON.stringify({ event: eventSink.length, nikki4: eventCalls.length, err: eventErr && eventErr.message }));
			check("⑤③ 活动侧**没有任何**请求带 noOrigin（反向证明：只有 /api/ 卡池侧开开关）",
				eventCalls.length > 0 && eventCalls.every((c) => !c.opts.noOrigin),
				JSON.stringify(eventCalls.filter((c) => c.opts.noOrigin).map((c) => c.url).slice(0, 3)));
			check("⑤③ 活动侧每个请求拼出的代理 URL 都不带 `origin=0`",
				eventCalls.length > 0 && eventCalls.every((c) => originParamCount(T.dshProxyApiOf(c.url, c.opts).api) === 0));
			N.nikki4ResetCache();
		}
	}
}
