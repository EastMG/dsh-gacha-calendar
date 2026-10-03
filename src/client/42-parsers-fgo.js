// src/client/35-parsers-fgo.js
//
// 由 next-sources/parsers/fgo.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_fgo__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-fgo.js —— FGO 国服 · fgo.wiki（MediaWiki 1.43.9 + SemanticMediaWiki）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ══ 为什么最终选了「解析 HTML 表格」而不是 SMW `action=ask`（两条路都实测过）══
// 任务书提示该站启用了 SMW、`action=ask` 能拿结构化结果。实测结论：**ask 可用，但这条
// 路在本站选不出「国服当期」**，所以外显走 HTML 表格；SMW 只留作交叉验证时间口径。
//
//   ✅ ask 确实能用（2026-10-02 实测）：
//      https://fgo.wiki/api.php?action=ask&query=[[分类:活动]][[开始时间::>2026/09/01]]|?中文名称|?开始时间|?结束时间|?类型
//      返回 SMW 属性 `中文名称` / `开始时间` / `结束时间` / `类型`(Event|Campaign)，
//      且时间值带 `timestamp`（**UTC 秒**，例如 幕末武斗神话 开始 raw=1/2026/9/24/11/0/0/0
//      = 11:00Z ↔ 国服表 19:00 → +8）。这一点比仓库里原神那套（bwiki 的 raw 是服务器本地 +08，
//      需要按 tz 解释）更省事。
//   ❌ 但 `分类:活动` **同时含国服与日服的页面，且没有任何服务器判别字段**：
//      · 页面属性里确实有 `国服`/`日服`/`服务器` 三个 Property，实测**值全为空数组**
//        （printouts.国服 = []）→ 过滤不掉，`[[国服::+]]` 查询返回 0 条。
//      · 分类也一致：国服的「幕末武斗神话…」与日服的「见鬼去吧！南瓜农场屠杀」都是
//        `分类:活动` + `分类:主要活动` + `分类:活动信息`。
//      · 结果：2026-10-02 这一天，国服(9/24~10/15)与日服(9/16~10/7)两个 **Event** 都覆盖当期，
//        ask 无法回答"哪个是国服当期活动"。夹具 fgo-ask-activity 保留了这份证据。
//   ❌ 卡池侧 ask 更没用：`分类:推荐召唤` 的页面 printouts 只有一个畸形键 `{"3":[]}`，
//      **没有 开始时间/结束时间 属性**。
//   ✅ HTML 路（本文件采用）：`卡池一览` 的第一张表表头就写着 **「国服当前卡池」**；
//      `活动一览` 的国服表按年份分节（`2026年`），而日服表在页面最前面、表头明确标注
//      **「活动时间 （日本标准时间）」** —— 服务器归属是**页面自己标好的**，不用猜。
//      行内还带 `data-sort-value="2026-09-29 11:00"`（UTC）可交叉校验（本文件不依赖它）。
//
// ══ 实测形态（夹具 fgo-gacha-parse 115KB / fgo-event-parse 1.4MB）══
//   · `卡池一览`：3 张表 = [国服当前卡池, 日服当前卡池, 国服近未来卡池(带「预估」)]
//     列 = 卡池名 | 开始时间 ~ 结束时间 | 推荐召唤从者 | 推荐召唤概念礼装
//     窗口原文形如 `2026年9月22日(周二) 19:00 ~ 2026年10月6日(周二) 13:59`（同日用 <br> 分隔）
//   · `活动一览`：12 张表 = [日服当前(表头含「日本标准时间」), 2026年, 2025年, … 2016年]
//     国服表列 = 活动时间 | 名称 | 公告页面 | 类型
//     ⚠️ 国服表的**两个日期之间没有 `~`**，靠 `<br />` 换行分隔
//        （`<td data-sort-value="…">2026年9月29日(周二)19:00<br />2026年12月20日(周日)13:59`）
//        → 所以不按"分隔符"解析，而是「取该单元格里出现的**前两个** 日期+时刻」。
//
// ══ 时区 UTC+8（Asia/Shanghai）—— 有硬交叉验证 ══
//   国服表头不标时区，但：SMW 里同名活动的 `开始时间`(UTC) 与国服表墙钟**严格差 8 小时**
//   （幕末武斗神话：SMW=2026-09-24T11:00Z ↔ 国服表 9/24 19:00；南瓜农场屠杀同类吻合）
//   → 国服表就是 UTC+8，非推测。
//
// ══ 缓存警告 ══
//   两个页面顶部都有「该页面的信息或许并非最新 …刷新页面缓存」提示。任务书建议 `&action=purge`，
//   实测 **purge 必须 POST**（`{"error":{"code":"mustbeposted"}}`），而本目录的传输层
//   （lib/env.js `fetchText`/`fetchJson`）只有 GET —— 所以**不做 purge**。
//   好在 `action=parse` 是按当前 revision 重新渲染的（夹具里页面自带的刷新链接时间戳
//   `_=20261001172628` 正是抓取时刻），实测数据是新鲜的。


const ns_fgo_FGO_API = "https://fgo.wiki/api.php";
const ns_fgo_FGO_GACHA_PAGE = "卡池一览";
const ns_fgo_FGO_EVENT_PAGE = "活动一览";
const ns_fgo_FGO_TZ = "Asia/Shanghai";
const ns_fgo_FGO_REFERER = "https://fgo.wiki/";

function ns_fgo_fgoParseUrl(page) {
	// ⚠️ 这里对 page 做 encodeURIComponent —— registry-<batch>.js 里的 URL 必须用**同一个**构造方式，
	// 否则离线夹具（test/map.json / cases-b3.mjs 的 overrides 按整串匹配）会命中不到。
	return `${ns_fgo_FGO_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_fgo_FGO_GACHA_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE);
const ns_fgo_FGO_EVENT_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE);

// ── 只做 indexOf 扫描的表格切分（1.4MB 页面上不跑贪婪正则）──
function ns_fgo_fgoTables(html) {
	const heads = [];
	const hre = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g;
	let hm;
	while ((hm = hre.exec(html)) !== null) heads.push({ index: hm.index, text: stripTags(hm[2]) });
	const out = [];
	let i = html.indexOf("<table");
	while (i !== -1) {
		const end = html.indexOf("</table>", i);
		let head = null;
		for (let k = heads.length - 1; k >= 0; k--) if (heads[k].index < i) { head = heads[k].text; break; }
		out.push({ index: i, head, html: html.slice(i, end === -1 ? html.length : end + 8) });
		i = html.indexOf("<table", i + 1);
	}
	return out;
}

function ns_fgo_rowsOf(tableHtml) {
	return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}
function ns_fgo_cellsOf(rowHtml) {
	return [...rowHtml.matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/g)].map((m) => m[2]);
}
function ns_fgo_isHeaderRow(cells) {
	const first = stripTags(cells[0]);
	if (/国服当前卡池|日服当前卡池|国服近未来卡池/.test(first)) return true;
	const t = cells.map((c) => stripTags(c)).join(" ").trim();
	return /^活动时间/.test(t) && /名称/.test(t);
}

// ── 单元格里的「日期+时刻」对 ──
// 取该单元格中**前两个**「YYYY年M月D日(周X) HH:MM」；时刻可缺（近未来表写「预估 … ~ …」）
// → 缺起点时刻按 00:00、缺终点时刻按 23:59（只影响预估行，当期表都有明确时刻）
const ns_fgo_FGO_DT = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*周\s*[一二三四五六日天]\s*[）)])?(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/g;
function ns_fgo_parseFgoWindow(cellText, tz = ns_fgo_FGO_TZ) {
	const hits = [];
	ns_fgo_FGO_DT.lastIndex = 0;
	let m;
	while ((m = ns_fgo_FGO_DT.exec(String(cellText || ""))) !== null) {
		hits.push({ text: m[0].replace(/\s+/g, " ").trim(), y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null });
		if (m[0] === "") ns_fgo_FGO_DT.lastIndex++;
	}
	if (hits.length < 2) return null;
	const a = hits[0], b = hits[1];
	const startTs = sourceInstant(a.y, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
	const endTs = sourceInstant(b.y, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
	if (!(endTs > startTs)) return null;
	// raw 用两个匹配片段拼 `… ~ …`：国服活动表的两个日期之间**没有**分隔符（只有 <br />），
	// 拼接后既能当"源站原文"展示，也和卡池表的原文形态一致。
	return { startTs, endTs, raw: `${a.text} ~ ${b.text}` };
}

// 选当期：覆盖 now 的里按 (类型档位, 结束时间, 开始时间) 取第一 —— 与插件
// 30-parsers.js 的 sortEventItems/pickEventPrimary 同口径（越快结束越该被盯住）。
// 没有覆盖的 → 取最近要开的；再没有 → null（未公布，不硬造）。
function ns_fgo_pickRow(rows, now) {
	if (!rows.length) return null;
	const covering = rows.filter((r) => coversNow(r, now));
	const pool = covering.length ? covering : rows.filter((r) => r.startTs > now);
	if (!pool.length) return null;
	return pool.slice().sort((a, b) => {
		const t = (a.tier || 0) - (b.tier || 0);
		if (t !== 0) return t;
		if (a.endTs !== b.endTs) return a.endTs - b.endTs;
		return a.startTs - b.startTs;
	})[0];
}

// ── 卡池侧：国服当前卡池 ──
// 悬停里的角色名用「、」连接（与本体 buildPoolHover 的 `池名：角色` 观感一致）：
// wiki 表格用**空格**分隔从者名（`阿蒂拉 罗摩 兰斯洛特(Saber) …`），
// 直接塞进「池名：角色」会变成一长串空格分隔名，跟本体的「A、B、C」不一致。
function ns_fgo_formatFgoRoles(roles) {
	return String(roles || "").replace(/\s+/g, " ").trim().replace(/ +/g, "、");
}

function ns_fgo_parseFgoBannerTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const tables = ns_fgo_fgoTables(html);
	if (!tables.length) throw new Error("fgo-no-table");
	const tb = tables.find((t) => /国服当前卡池/.test(stripTags(ns_fgo_rowsOf(t.html)[0] || "")));
	if (!tb) throw new Error("fgo-no-current-banner-table");
	const rows = [];
	for (const r of ns_fgo_rowsOf(tb.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 2 || ns_fgo_isHeaderRow(cells)) continue;
		const name = stripTags(cells[0]).replace(/\s+/g, " ").trim();
		const w = ns_fgo_parseFgoWindow(stripTags(cells[1]), tz);
		if (!name || !w) continue;
		let roles = cells.length > 2 ? stripTags(cells[2]).replace(/\s+/g, " ").trim() : "";
		// wiki 在"推荐召唤从者>15 骑"时用一行占位提示顶替名单 → 不把它当角色名
		if (/请前往|大于15|详见|Template:/.test(roles)) roles = "";
		rows.push({ banner: name, roles, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return null;
	// 悬停（本体 buildPoolHover 格式）：当期主池每池「池名：角色」+ 档期两行，结束时间升序。
	// 「卡池一览」的这一张表 = **国服当前卡池**，表内解析出的行本就都是当期池，不需要再按 now 过滤。
	// 只有 1 个当期池时 hoverPool 返回 ""，此处**不设 bannerHover**，由 UI 走默认两行式。
	// 角色名过长（>8 骑，如「天草四郎时贞推荐召唤」动辄 20 骑）会淹掉档期行 → 不放进悬停。
	const pools = (rows.length < 2 ? [] : rows)
		.slice()
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs))
		.map((r) => {
			const names = ns_fgo_formatFgoRoles(r.roles);
			const short = names && names.split("、").length <= 8 ? names : "";
			return {
				name: r.banner,
				label: short ? `${r.banner}：${short}` : r.banner,
				startTs: r.startTs,
				endTs: r.endTs,
				raw: r.raw
			};
		});
	const bannerHover = hoverPool(pools, tz);
	return {
		...best,
		openCount: rows.length,
		...(bannerHover ? { bannerHover } : {})
	};
}

// ── 活动侧：国服当年那张表 ──
// 选表规则（三条同时成立）：① 表头含「活动时间」且含「名称」且含「类型」；
// ② **不得**含「日本标准时间」（那是日服表）；③ 表前最近的标题是 `YYYY年`，取年份最大的那张。
function ns_fgo_findFgoEventTable(html) {
	const tables = ns_fgo_fgoTables(html);
	let best = null;
	for (const t of tables) {
		const head = stripTags(ns_fgo_rowsOf(t.html)[0] || "");
		if (!/活动时间/.test(head) || !/名称/.test(head) || !/类型/.test(head)) continue;
		if (/日本标准时间/.test(head)) continue;
		const ym = /(\d{4})\s*年/.exec(t.head || "");
		if (!ym) continue;
		const year = +ym[1];
		if (!best || year > best.year) best = { year, table: t };
	}
	return best;
}

function ns_fgo_parseFgoEventTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const found = ns_fgo_findFgoEventTable(html);
	if (!found) throw new Error("fgo-no-cn-event-table");
	const rows = [];
	let skipped = 0;
	for (const r of ns_fgo_rowsOf(found.table.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 4 || ns_fgo_isHeaderRow(cells)) continue;
		const w = ns_fgo_parseFgoWindow(stripTags(cells[0]), tz);
		const name = stripTags(cells[1]).replace(/\s+/g, " ").trim();
		if (!w || !name) { skipped++; continue; }
		const type = stripTags(cells[3]).replace(/\s+/g, " ").trim();
		rows.push({ name, type, tier: /^Event/i.test(type) ? 0 : 1, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return { year: found.year, rows, skipped, event: null };
	// 悬停：只列**覆盖当前时刻**的行（该年的表含全年 57 行，全列会淹没当期；按结束时间升序）。
	// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`。
	// ⚠️ 表格第 4 列的**类型**（Event/Campaign）是源站的**分类词**，不是活动名 —— 旧实现把它塞在
	//    「档期」和「名称」之间（`09-24 19:00 ~ 10-15 13:59   Event   幕末…`），既把档期放在了行首，
	//    又把分类词冒充成名称的一部分。用户 2026-10-03 反馈后**彻底删掉**（分类只用于 `tier` 排序，
	//    保留在 rows 里供外部使用，不进悬停文本）。
	const active = rows
		.filter((x) => coversNow(x, now))
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs));
	// <2 条时 hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式
	const eventHover = hoverEvent(active, tz);
	return {
		year: found.year,
		rows,
		skipped,
		activeCount: active.length,
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 抓取器 ──
// ⚠️ mode 必须与 registry-b3.js 里声明的 "proxy" 一致（fgo.wiki 的 ACAO 为空，不能直连）
async function ns_fgo_fetchPageText(url, signal) {
	if (!/^https?:\/\//.test(String(url || ""))) throw new Error("fgo-bad-url");
	return fetchMediaWikiText(url, { referer: ns_fgo_FGO_REFERER, signal, mode: "proxy" });
}

async function ns_fgo_gachaFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE), signal);
	const r = ns_fgo_parseFgoBannerTable(html, tz, Date.now());
	if (!r) return null;
	return {
		banner: r.banner,
		roles: r.roles || "",
		bannerDates: fmtWindow(r.startTs, r.endTs, tz),
		bannerDatesRaw: r.raw,
		startTs: r.startTs,
		endTs: r.endTs,
		// 有 ≥2 个当期池才有值；1 个池时 ns_fgo_parseFgoBannerTable 不设该字段（UI 走默认两行式）
		...(r.bannerHover ? { bannerHover: r.bannerHover } : {})
	};
}

async function ns_fgo_eventsFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE), signal);
	const r = ns_fgo_parseFgoEventTable(html, tz, Date.now());
	if (!r || !r.event) return null;
	return {
		event: r.event,
		eventDates: r.eventDates,
		eventDatesRaw: r.eventDatesRaw,
		// ≥2 条当期活动才有值；只有 1 条时不设该字段（UI 走默认两行式「名称 ⏎ 档期」）
		...(r.eventHover ? { eventHover: r.eventHover } : {})
	};
}
