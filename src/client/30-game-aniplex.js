// src/client/30-game-aniplex.js —— Aniplex / TYPE-MOON（Fate/Grand Order）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-fgo.js 的内容（原样保留；压平后见 30-game-aniplex.js）══
// 原 src/client/35-parsers-fgo.js（压平后见 30-game-aniplex.js）
//
// 由 next-sources/parsers/fgo.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_fgo__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-fgo.js（压平后见 30-game-aniplex.js） —— FGO 国服 · fgo.wiki（MediaWiki 1.43.9 + SemanticMediaWiki）
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
//   （lib/env.js `fetchText`/`fetchJson`，压平后见 22-fetcher-core.js）只有 GET —— 所以**不做 purge**。
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
// 30-parsers.js 的 sortEventItems/pickEventPrimary（压平后见 25-parser-order.js）同口径（越快结束越该被盯住）。
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

function ns_fgo_parseFgoBannerTable(html, tz = ns_fgo_FGO_TZ, now = nowMs()) {
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
	const bannerHover = hoverTextFromItems(
		pools.map((p) => ({ title: p.label || p.name, label: p.label || p.name, startTs: p.startTs, endTs: p.endTs, raw: p.raw })),
		"gacha", tz);
	return {
		...best,
		openCount: rows.length,
		// ── P3b：条目事实（悬停行）= 同一份 pools；数组由抓取器用它们收口 ──
		hoverItems: pools.map((p) => ({ title: p.label || p.name, label: p.label || p.name, startTs: p.startTs, endTs: p.endTs, raw: p.raw })),
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

function ns_fgo_parseFgoEventTable(html, tz = ns_fgo_FGO_TZ, now = nowMs()) {
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
	// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover；压平后见 28-parser-hover-tools.js）：`名称` + 3 空格 + `档期`。
	// ⚠️ 表格第 4 列的**类型**（Event/Campaign）是源站的**分类词**，不是活动名 —— 旧实现把它塞在
	//    「档期」和「名称」之间（`09-24 19:00 ~ 10-15 13:59   Event   幕末…`），既把档期放在了行首，
	//    又把分类词冒充成名称的一部分。用户 2026-10-03 反馈后**彻底删掉**（分类只用于 `tier` 排序，
	//    保留在 rows 里供外部使用，不进悬停文本）。
	const active = rows
		.filter((x) => coversNow(x, now))
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs));
	// <2 条时生成器返回 "" → 不设 eventHover，由 UI 走默认两行式
	// ── P3b：条目事实 → 悬停（数组由抓取器收口）──
	const hoverItems = active.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
	const eventHover = hoverTextFromItems(hoverItems, "event", tz);
	// 类别事实通道（P2 收尾，2026-11-07）：源站第 4 列的「类型」（Event / Campaign）是**源站给的
	// 分类**，上面第 241-244 行的注释说明了它为什么不能进悬停文本。数据层要把这个事实带进
	// `events` 数组（显示层按 category 分档，见 81-schedule-model.js 的 sideViewOf 规则表），
	// 所以另给一份 `itemFacts`：`{ "<活动名>": { category: "<类型>" } }`，只覆盖**当期**那些行
	// （数组里只有这些行）。`pickFields` 已登记该字段，见 50-refresh.js 的 GACHA_FIELDS 说明。
	const itemFacts = {};
	for (const x of active) itemFacts[x.name] = { category: x.type };
	return {
		year: found.year,
		rows,
		skipped,
		activeCount: active.length,
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		itemFacts,
		hoverItems,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 抓取器 ──
// ⚠️ mode 必须与原 registry-b3.js 里声明的 "proxy" 一致（fgo.wiki 的 ACAO 为空，不能直连）
async function ns_fgo_fetchPageText(url, signal) {
	if (!/^https?:\/\//.test(String(url || ""))) throw new Error("fgo-bad-url");
	return fetchMediaWikiText(url, { referer: ns_fgo_FGO_REFERER, signal, mode: "proxy" });
}

// ⚠️ 必须收 `now`（2026-10-17 修）：此前签名只有 (url, signal, tz)、体内写死 `nowMs()` ⇒
//   用例没法注入时刻，"选当期"一过期就选不中 → 断言**假红**。
//   第 4 参是**测试专用契约**（沿用 bandori 的约定）；默认值保证生产路径
//   （引擎只传 3 参，见 50-refresh.js:26）行为完全不变。
async function ns_fgo_gachaFgo(url, signal, tz = ns_fgo_FGO_TZ, now = nowMs()) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE), signal);
	const r = ns_fgo_parseFgoBannerTable(html, tz, now);
	if (!r) return null;
	const out = {
		banner: r.banner,
		roles: r.roles || "",
		bannerDates: fmtWindow(r.startTs, r.endTs, tz),
		bannerDatesRaw: r.raw,
		startTs: r.startTs,
		endTs: r.endTs,
		// 有 ≥2 个当期池才有值；1 个池时 ns_fgo_parseFgoBannerTable 不设该字段（UI 走默认两行式）
		...(r.bannerHover ? { bannerHover: r.bannerHover } : {})
	};
	// ── P3b：条目事实 → `gacha` 数组（主条 + 并列池）──
	out.gacha = dataArrayProducedGachaOf(out, r.hoverItems || [], { tz }, now);
	out.gachaHoverItems = r.hoverItems || [];
	return out;
}

// 同上：收 `now` 注入时刻（2026-10-17 修，测试专用契约，默认 nowMs() 保生产行为）
async function ns_fgo_eventsFgo(url, signal, tz = ns_fgo_FGO_TZ, now = nowMs()) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE), signal);
	const r = ns_fgo_parseFgoEventTable(html, tz, now);
	if (!r || !r.event) return null;
	const out = {
		event: r.event,
		eventDates: r.eventDates,
		eventDatesRaw: r.eventDatesRaw,
		// ≥2 条当期活动才有值；只有 1 条时不设该字段（UI 走默认两行式「名称 ⏎ 档期」）
		...(r.eventHover ? { eventHover: r.eventHover } : {}),
		// 类别事实通道：源站「类型」列（Event / Campaign）交给数据层贴到 events 数组条目的 `category` 上。
		// 必须在这里显式透传 —— 这个抓取器是**重新组装**返回对象（不是原样返回解析结果），
		// 漏一行就等于这条事实在数据层之前就没了（实测：数组 entries 的 category 全是 null）。
		...(r.itemFacts ? { itemFacts: r.itemFacts } : {})
	};
	// ── P3b：条目事实 → `events` 数组（category 事实经 itemFacts 贴上，与合成路径同一份）──
	out.events = dataArrayProducedEventsOf(out, r.hoverItems || [], { tz }, now);
	out.eventHoverItems = r.hoverItems || [];
	return out;
}

// ══ FGO 日服 · Atlas Academy（2026-11-14 接入；卡池 + 活动两侧同源）══════════════════
//
// 为什么接（2026-11-14 实测，两个端点都 200 且 `Access-Control-Allow-Origin: *`）：
//   · 卡池 `https://api.atlasacademy.io/export/JP/nice_gacha.json`
//     —— 2,018,335 B / 4334 条全量卡池导出；字段 `id / name / type / openedAt / closedAt /
//     featuredSvtIds / pickupId / …`，时间是 **epoch 秒**；`name` 是日文原文，形如
//     「真冬の水着スペシャル…！ \n高杉晋作ピックアップ召喚」（`\n` 是源站的换行排版）。
//   · 活动 `https://api.atlasacademy.io/basic/JP/event/search?ongoing=true`
//     —— 14,301 B / 65 条**在期**条目；字段 `id / type / name / startedAt / endedAt`（同为 epoch 秒）。
//     `type` 有 eventQuest / combineCampaign / questCampaign / … 多种（本解析器**不按类型筛**，
//     源站给什么就排什么）。
//   · 两个端点同域 ⇒ 直连（`mode: "direct"`），已登记进 `tools/check-host-allow.mjs` 的 DIRECT_HOSTS。
//
// 三条解析口径（「覆盖 now / 选当期」仍只走唯一真源 `coversNow`）：
//   ① **无结束哨兵**：源站用"远未来"表示"永久开放"——卡池 `closedAt = 1911653999`
//      （2030-07-30T14:59:59Z，本批 6 条共用：フレンドポイント / チュートリアル / ストーリー /
//      スタートダッシュ★5確定 第1~3弾）、活动 `endedAt = 1893423600`（2030-01-01 00:00 JST，
//      49 条共用：主线自由关卡 + 常驻 campaign）。**本批里最大的结束秒、且至少两条共用**就是这个
//      占位 ⇒ 判为无结束（endTs = null）：不参与选当期、也不进悬停（它们永远"在期"，进悬停只是噪音）。
//      不做这个区分的话，「结束最晚」会把 2030-07-30 才结束的常驻「ストーリー召喚」当成当期。
//   ② 卡池外显取**结束最晚**（本仓库惯例「越晚结束越靠前」）；同结束再比开始（更晚的在前）、
//      最后比 id（升序）—— 多池并行时只有一条能占外显，这条链保证同一份数据每次都选出同一条。
//   ③ 角色名**不新造**：`featuredSvtIds` 是数字 id（译名要另一份 2MB 的 nice_servant.json）、
//      `pickupId` 也不带名字 ⇒ `roles` 留空（与 pjsk 那种"源站没有角色名"的同构）。
//
// 失败 vs 未公布：不是数组（含 `{}`）⇒ 抛 `fgo-jp-*-bad-shape`（抓取失败）；
//   数组里没有一条覆盖 now ⇒ `null`（nomatch，源站没公布当期）。
const ns_fgo_jp_GACHA_URL = "https://api.atlasacademy.io/export/JP/nice_gacha.json";
const ns_fgo_jp_EVENT_URL = "https://api.atlasacademy.io/basic/JP/event/search?ongoing=true";
const ns_fgo_jp_TZ = "Asia/Tokyo";

function ns_fgo_jp_badShape(what) { return new Error(`fgo-jp-${what}-bad-shape`); }

// 标题：把源站排版用的换行去掉（`\n` 两侧的空白一起收敛成**一个** ASCII 空格），其余字符逐字保留
// （全角空格「　」不动 —— 那是名字的一部分，见活动 80044 那类「亜種特異点Ⅰ　A.D.1999 …」）。
function ns_fgo_jp_titleOf(v) {
	if (typeof v !== "string") return "";
	return v.replace(/[ \t\u3000]*[\r\n]+[ \t\u3000]*/g, " ").replace(/ {2,}/g, " ").trim();
}

// 无结束占位 → 毫秒；不是占位 → null（判据见文件头 ①）。
function ns_fgo_jp_permanentEndMs(rows, endKey) {
	const ends = rows.map((x) => numOrNull(x && x[endKey])).filter((n) => n != null && n > 0);
	if (ends.length < 2) return null;
	const max = Math.max(...ends);
	return ends.filter((e) => e === max).length >= 2 ? max * 1000 : null;
}

// 一张表 → 条目事实：epoch 秒 → 毫秒；起止缺失就留 null，不猜（null 过不了 `coversNow`）。
function ns_fgo_jp_itemsOf(list, startKey, endKey, what) {
	if (!Array.isArray(list)) throw ns_fgo_jp_badShape(what);
	const perm = ns_fgo_jp_permanentEndMs(list, endKey);
	const out = [];
	for (const raw of list) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const title = ns_fgo_jp_titleOf(raw.name);
		if (!title) continue;
		const s = numOrNull(raw[startKey]), e = numOrNull(raw[endKey]);
		out.push({
			id: raw.id,
			title,
			startTs: s == null ? null : s * 1000,
			endTs: e == null ? null : e * 1000,
			permanent: e != null && perm != null && e * 1000 === perm
		});
	}
	return out;
}

// 当期 = 覆盖 now 的条目里**结束最晚**的那条（同结束比开始、再比 id，确定且可复现）。
function ns_fgo_jp_pickCurrent(items, now) {
	const live = items.filter((x) => coversNow(x, now));
	if (!live.length) return null;
	return live.slice().sort((a, b) =>
		(b.endTs - a.endTs) || (b.startTs - a.startTs) || ((Number(a.id) || 0) - (Number(b.id) || 0)))[0];
}

// 悬停行顺序：结束时间升序（与 bwiki / FGO 国服同一口径 —— 外显那条排在最后）。
function ns_fgo_jp_hoverOrderOf(a, b) {
	return (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((Number(a.id) || 0) - (Number(b.id) || 0));
}

// 源站会把**同一个 campaign 用多个 id** 重复列在 `ongoing=true` 里（实测 2026-11-14：活动侧
// 「消費AP 50%DOWN」「強化『大成功＆極大成功』率3倍！」各有一组同名同窗的重复行）⇒ 条目层按
// 「名称 + 起止」去掉**完全相同**的重复行。方向与数据层「归一后同名只留第一条」一致，但不提前
// 按标题合并（那是数组的收口，见 `dataArrayExtrasFromEntriesOf`）：同名不同窗的行仍然都留着。
function ns_fgo_jp_uniqueOf(items) {
	const seen = new Set();
	const out = [];
	for (const x of items) {
		const k = `${x.title}\u0000${x.startTs}\u0000${x.endTs}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(x);
	}
	return out;
}

async function ns_fgo_jp_fetchList(url, signal, what) {
	let data;
	try {
		data = await fetchJson(url, { signal, mode: "direct" });
	} catch (e) {
		if (e && e.name === "AbortError") throw e;
		throw new Error(`fgo-jp-${what}-fetch-failed:${(e && e.message) || e}`);
	}
	if (!Array.isArray(data)) throw ns_fgo_jp_badShape(what);   // `{}` / 对象 ⇒ 失败，不是 nomatch
	return data;
}

async function ns_fgo_jp_gachaFgoJp(url, signal, tz = ns_fgo_jp_TZ, now = nowMs()) {
	const list = await ns_fgo_jp_fetchList(url || ns_fgo_jp_GACHA_URL, signal, "gacha");
	// 常驻池（无结束占位）不参与：它们永远在期
	const items = ns_fgo_jp_uniqueOf(ns_fgo_jp_itemsOf(list, "openedAt", "closedAt", "gacha").filter((x) => !x.permanent));
	const live = items.filter((x) => coversNow(x, now));
	if (!live.length) return null;                  // 没有覆盖 now 的 ⇒ 未公布（**不是**失败）
	const cur = ns_fgo_jp_pickCurrent(live, now);
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	const out = {
		banner: cur.title,
		roles: "",                                  // 源站没有可用的角色名（见文件头 ③）
		bannerDates: dates,
		bannerDatesRaw: dates,                      // 源站只有 epoch 秒、没有墙钟原文 ⇒ 同值
		startTs: cur.startTs,
		endTs: cur.endTs
	};
	// ── P3b：条目事实 → 悬停 + `gacha` 数组（悬停 = 全部在期池；只有 1 条时不设 bannerHover）──
	const hoverItems = live.slice().sort(ns_fgo_jp_hoverOrderOf)
		.map((x) => ({ title: x.title, startTs: x.startTs, endTs: x.endTs, raw: "" }));
	const hover = hoverTextFromItems(hoverItems, "gacha", tz);
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, hoverItems, { tz }, now);
	out.gachaHoverItems = hoverItems;
	return out;
}

async function ns_fgo_jp_eventsFgoJp(url, signal, tz = ns_fgo_jp_TZ, now = nowMs()) {
	const list = await ns_fgo_jp_fetchList(url || ns_fgo_jp_EVENT_URL, signal, "event");
	const items = ns_fgo_jp_uniqueOf(ns_fgo_jp_itemsOf(list, "startedAt", "endedAt", "event").filter((x) => !x.permanent));
	const live = items.filter((x) => coversNow(x, now));
	if (!live.length) return null;
	const cur = ns_fgo_jp_pickCurrent(live, now);
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ── 条目事实 → 悬停 + `events` 数组（**不排序**给数组：`dataArrayExtrasFromEntriesOf` 自己按判据收口）──
	const eventItems = live.slice().sort(ns_fgo_jp_hoverOrderOf)
		.map((x) => ({ title: x.title, startTs: x.startTs, endTs: x.endTs, raw: "" }));
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: cur.title,
		eventDates: dates,
		eventDatesRaw: dates,
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}

		// ── 条目 ──
		registerSource({
				id: "fgo",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "Fate/Grand Order",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/db/d4/19/dbd4196a-68cb-8a74-ca0b-045d0795e10c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://fgo.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://fgo.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki",
		});

		// 同一款游戏的**日服**（Atlas Academy 数据导出，解析器见文件内「FGO 日服」段落）。
		// 与国服条目相邻；国服那条（fgo.wiki / Bwiki）一个字都不动。
		registerSource({
				id: "fgo-jp",
				defaultHidden: false,
				tz: ns_fgo_jp_TZ,
				name: "Fate/Grand Order·日服",
				// 源站只有 JSON、没有图标地址 ⇒ 沿用同款游戏（国服条目）的图标
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/db/d4/19/dbd4196a-68cb-8a74-ca0b-045d0795e10c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: ns_fgo_jp_GACHA_URL,
				source: "Atlas Academy",
				eventUrl: ns_fgo_jp_EVENT_URL,
				eventSource: "Atlas Academy",
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["fgo"] = (url, signal, tz) => ns_fgo_gachaFgo(url, signal, tz);
		EVENT_FETCHERS["fgo"] = Object.assign(EVENT_FETCHERS["fgo"] || {}, { default: (url, signal, tz) => ns_fgo_eventsFgo(url, signal, tz) });
		GACHA_FETCHERS["fgo-jp"] = (url, signal, tz) => ns_fgo_jp_gachaFgoJp(url, signal, tz);
		EVENT_FETCHERS["fgo-jp"] = Object.assign(EVENT_FETCHERS["fgo-jp"] || {}, { default: (url, signal, tz) => ns_fgo_jp_eventsFgoJp(url, signal, tz) });
