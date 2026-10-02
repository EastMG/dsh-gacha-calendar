		//#region next-sources（试合并：新增游戏的解析器，生成自 next-sources/）
		// ⚠️ 生成物，勿手改：改 next-sources/ 后重跑
		//    node diag/handoff-2026/merge-next-sources.mjs
		// 位置：40-fetchers.js 之后（两个注册表已就绪）、50-refresh.js 之前。

		//#region next-sources 桥接适配器（试合并专用）
		// next-sources 的解析器原本 import ./lib/env.js 的这几个名字；这里用插件已有实现 + 少量补齐顶上，
		// 于是解析器代码**一行都不用改**（只做命名空间重命名）就能跑在插件里。
		//   · sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / pad2 / stripTags → 15-env.js 与 30-parsers.js 已有
		//   · decodeEntities / textOf                                                  → 这里补
		//   · fetchText / fetchJson / fetchMediaWikiText                               → 接到插件 transport
		const ENTITIES_NS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
		// ⚠️ pad2 插件本体**没有**（我第一版误以为有 → 7 个 bwiki 来源全报 "pad2 is not defined"）。
		//    网络其实是好的（HTTP 200 / JSON 正常），纯粹是这个名字缺定义。
		function pad2(n) { return String(n).padStart(2, "0"); }
		function decodeEntities(s) {
			return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
				const key = k.toLowerCase();
				if (ENTITIES_NS[key] != null) return ENTITIES_NS[key];
				if (/^#\d+$/.test(key)) { try { return String.fromCodePoint(Number(key.slice(1))); } catch { return m; } }
				return m;
			});
		}
		function textOf(html) {
			return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
				.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
		}
		// direct 模式：走插件直连（transportFetchRaw）
		async function nsFetchTextDirect(url, opts) {
			const o = opts || {};
			const res = await transportFetchRaw(url, {
				signal: o.signal,
				headers: Object.assign({}, rawHeaders(url), o.headers || {})
			});
			if (!res.ok) throw new Error("http-" + res.status);
			return res.text();
		}
		// 与 next-sources/lib/env.js 的 fetchText 同语义：proxy(默认) / direct
		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") return nsFetchTextDirect(url, o);
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}
		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}
		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}
		//#endregion


		// ===== 内联自 next-sources/parsers/p5x.js（模块级标识符已加 ns_p5x_ 前缀）=====

// next-sources/parsers/p5x.js —— P5X 国服（完美世界官方站）
//
// ⚠️ 调研修正（2026-10-02 实测）：官方站的**卡池/活动专栏已停更 2 年**
//   · /news/gamebroad/（卡池）最后一条 2024-10-10
//   · /news/gameevent/（活动）最后一条 2024-09-27
//   · 但 /news/gamenews/（综合，即版本更新公告）**仍在更新**（实测最新 2026-09-24「5.4.1版本今日上线」）
//   所以本解析器**只用 gamenews**：从版本更新公告正文里抽「开始日—结束日」档期。
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw? } | { event, eventDates, ... }
//
// 时区：国服，源码站**未见显式标注**（原文只有「2026年9月24日—10月22日」），按 UTC+8 推定。
// 数据形态：日期是**纯日期无时分**（如「2026年9月24日—10月22日更新前」）→
//   起止时刻按惯例补 04:00 / 03:59（维护窗口「凌晨04:20-上午10:00」的典型形态）。
//   ⚠️ 这是**推算**，不是源站给定值；调用方若需要精确时刻应自行复核。


const ns_p5x_BASE = "https://p5x.wanmei.com";

// 列表页 → 条目数组 [{ href, title, dateText }]
function ns_p5x_parseP5xList(html) {
	const items = [];
	// 站点形态：<a href="/news/gamenews/20260924/264338.html"> … <p class="item_title">标题</p> … <p class="date_time">2026.09.24</p>
	const re = /<a[^>]+href="(\/news\/[a-z]+\/(\d{8})\/(\d+)\.s?html)"[^>]*>([\s\S]{0,1200}?)<\/a>/g;
	for (const m of String(html).matchAll(re)) {
		const block = m[4];
		const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/);
		const dm = block.match(/class="date_time"[^>]*>([\s\S]*?)<\/\w+>/);
		const title = tm ? stripTags(tm[1]) : "";
		if (!title) continue;
		items.push({ href: m[1], dateKey: m[2], id: m[3], title, dateText: dm ? stripTags(dm[1]) : "" });
	}
	// 兜底：站点偶有 class 顺序不同 → 退化为"按 href 切块"再就近找标题/日期
	if (items.length === 0) {
		const links = [...String(html).matchAll(/href="(\/news\/([a-z]+)\/(\d{8})\/(\d+)\.s?html)"/g)];
		for (const m of links) {
			const start = m.index;
			const block = String(html).slice(start, start + 1400);
			const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/) || block.match(/<p[^>]*>([^<]{4,80})<\/p>/);
			const title = tm ? stripTags(tm[1]) : "";
			if (title) items.push({ href: m[1], dateKey: m[3], id: m[4], title, dateText: "" });
		}
	}
	// 去重（同一 href 可能在"最新/推荐"两处出现）
	const seen = new Set();
	return items.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

// 详情页正文 → 纯文本
function ns_p5x_bodyText(html) {
	return decodeEntities(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	).replace(/[ \t\u00a0]+/g, " ");
}

// 从正文抽「YYYY年M月D日 — YYYY年M月D日」档期；返回归一化后的窗口列表
// 形态（实测）：`2026年9月24日—10月22日更新前`、`2026年10月5日—2026年10月22日更新前`
function ns_p5x_parseP5xWindows(text, tz) {
	const out = [];
	const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*[—\-~～至]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g;
	for (const m of String(text).matchAll(re)) {
		const y1 = +m[1], mo1 = +m[2], d1 = +m[3];
		const y2 = m[4] ? +m[4] : (mo1 > +m[5] ? y1 + 1 : y1);   // 跨年：结束月小于开始月
		const mo2 = +m[5], d2 = +m[6];
		// 时刻：公告只给日期 → 按国服惯例补 04:00 开 / 03:59 收（推算，见文件头）
		const startTs = sourceInstant(y1, mo1, d1, 4, 0, tz);
		const endTs = sourceInstant(y2, mo2, d2, 3, 59, tz);
		if (endTs <= startTs) continue;
		out.push({ startTs, endTs, raw: `${y1}年${mo1}月${d1}日 ~ ${y2}年${mo2}月${d2}日` });
	}
	return out;
}

// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
function ns_p5x_cleanTitle(t) {
	return String(t).replace(/[-—|]\s*P5X\s*[-—|]?[\s\S]*$/, "").trim() || String(t).trim();
}

// ── 卡池侧 ──
// P5X 没有独立的"卡池时刻表"栏目（gamebroad 已停更）→ 从最新版本更新公告里抽档期。
// 返回体系里的卡池字段；抽不到 → null（未公布）。
async function ns_p5x_gachaP5x(url, signal, tz = "Asia/Shanghai") {
	const listUrl = url || `${ns_p5x_BASE}/news/gamenews/index.html`;
	const list = ns_p5x_parseP5xList(await fetchText(listUrl, { referer: ns_p5x_BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	// 站点新→旧：取第一条（若列表未排序则按 dateKey 排序兜底）
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
	const newest = sorted[0];
	const detailUrl = newest.href.startsWith("http") ? newest.href : ns_p5x_BASE + newest.href;
	const text = ns_p5x_bodyText(await fetchText(detailUrl, { referer: ns_p5x_BASE, signal }));
	const wins = ns_p5x_parseP5xWindows(text, tz);
	if (wins.length === 0) return null;
	// ⚠️ 只在**有窗口覆盖当前时刻**时才外显；否则返回 null（= 未公布）。
	// 为什么不做"回退到结束最晚的过期档期"：那会把几年前的活动当成"当期"展示，
	// 与插件本体 `selectCurrent` / `bwikiGachaPayload` 的语义也**不一致**
	// （B2 批次指出过这个偏差，已按插件语义统一）。
	const now = Date.now();
	const cur = wins.find((w) => w.startTs <= now && w.endTs >= now);
	if (!cur) return null;
	return {
		banner: ns_p5x_cleanTitle(newest.title),
		roles: "",
		bannerDates: fmtWindow(cur.startTs, cur.endTs, tz),
		bannerDatesRaw: cur.raw,
		startTs: cur.startTs,
		endTs: cur.endTs
	};
}

// ── 活动侧 ──
// 同源同一份数据：把**全部**当期窗口列出（悬停逐行），外显取覆盖当前时刻的那个。
async function ns_p5x_eventsP5x(url, signal, tz = "Asia/Shanghai") {
	const listUrl = url || `${ns_p5x_BASE}/news/gamenews/index.html`;
	const list = ns_p5x_parseP5xList(await fetchText(listUrl, { referer: ns_p5x_BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
	const newest = sorted[0];
	const detailUrl = newest.href.startsWith("http") ? newest.href : ns_p5x_BASE + newest.href;
	const text = ns_p5x_bodyText(await fetchText(detailUrl, { referer: ns_p5x_BASE, signal }));
	const wins = ns_p5x_parseP5xWindows(text, tz);
	if (wins.length === 0) return null;
	const now = Date.now();
	const active = wins.filter((w) => w.startTs <= now && w.endTs >= now);
	const primary = (active.length ? active : wins).slice().sort((a, b) => a.endTs - b.endTs)[0];
	const hover = (active.length ? active : wins)
		.slice().sort((a, b) => a.endTs - b.endTs)
		.map((w) => `${fmtWindow(w.startTs, w.endTs, tz)}${w.raw ? `   (${w.raw})` : ""}`)
		.join("\n");
	return {
		event: ns_p5x_cleanTitle(newest.title),
		eventDates: fmtWindow(primary.startTs, primary.endTs, tz),
		eventDatesRaw: primary.raw,
		eventHover: hover
	};
}

// 供测试：从本地 HTML 直接跑解析（不联网）
function ns_p5x_gachaP5xFromHtml(listHtml, detailHtml, tz = "Asia/Shanghai") {
	void listHtml; void detailHtml; void tz;
	throw new Error("unused");   // 夹具测试走 fetch 注入（见 test/run.mjs）
}

		// ===== 内联自 next-sources/parsers/bwiki.js（模块级标识符已加 ns_bwiki_ 前缀）=====

// next-sources/parsers/bwiki.js —— 批次 B2：bwiki（MediaWiki api.php）来源
//
// 统一抓取形态（**全部 mode:"proxy"**，2026-10-02 实测 bwiki 全系 ACAO 为空）：
//   https://wiki.biligame.com/<wiki>/api.php?action=parse&page=<页面名URL编码>&prop=text&format=json&formatversion=2
// 用 `fetchMediaWikiText(url, opts)`：它会自动追加 `&origin=*` 并取 `parse.text`。
// 契约：async (url, signal, tz) → 数据对象 | null（见 CONVENTIONS.md）。
//   `now` 只在最后一位、自带默认值（铁律 2）；测试可传固定 now 以离线断言。
//
// ─────────────────────────────────────────────────────────────────────────────
// 实测结论（2026-10-02，夹具见 fixtures/bwiki-*）：**7 个来源 / 8 个"侧"里只有 2 侧能给出"当期"数据**
//   来源            页面            结构                        实测最新一条        当期可用?
//   whmx 物华弥新    限时招集档案     CardSelect 表 113 行        2026-09-30 起        ✅ 覆盖 now
//   umamusume 简中   简中卡池         两张表：已实装 191 行 / 预测 240 行  2026-10-23 止  ✅ 覆盖 now
//   umamusume 日服   活动             单表 100 行（标题=「往期活动」）   2025-12-26 起    ❌ 归档，停在 2025-12
//   whmx 物华弥新    活动             CardSelect 表 62 行        2025-05-01 起        ❌ 停在 2025-05
//   zspms 战双       研发记录         107 张小表（每池一张）       2024-03-21 起        ❌ 停在 2024Q1
//   kedrgame 雪松    卡池信息         无表格，仅「台架测试[一/二]」  2024-12-07 ~ 13      ❌ 台架测试占位
//   czn 卡厄斯梦境   卡池记录         只有「模板:Gacha」链接，空页   —                    ❌ 无内容
//   stellasora 星塔  首页             活动日历 2 项（JS 计算剩余时间） 2026-04-07 止     ❌ 停更 + 无名
//   ⇒ 另外 6 侧在"当期"判定下**如实返回 null**（源站抓到页面但当期没有内容），
//     而不是硬凑一个过期档期。逐条都在这份注释与 registry-b2.js 里写明。
// ─────────────────────────────────────────────────────────────────────────────
//
// 「当期」判定沿用插件本体 `src/client/30-parsers.js` 的 bwiki 语义（bwikiGachaPayload /
// genericEventPayload）：**过滤出覆盖当前时刻的条目；一条都没有 → 返回 null（未公布）**。
// 卡池外显取"结束最早"的池（越快结束越该盯住），roles 合并同期全部主池；活动外显优先
// 剧情/挑战档，悬停按结束时间升序逐行。
//
// 时区（依据见 registry-b2.js 注释）：
//   · 国服（whmx / umamusume 简中 / zspms / kedrgame / czn / stellasora）= Asia/Shanghai（**推测**，源站未显式标注）
//   · 赛马娘日服（umamusume 活动）= Asia/Tokyo（**硬标注**：卡池页正文「日服卡池时间记录统一为日本时间」）
//
// 已知源站坑（都做了处理，见各解析器注释）：
//   ① umamusume 简中「已实装卡池」表的时间列是 **结束 ~ 开始**（与其它表相反）→ 按整表多数票判定朝向
//   ② 该表 191 个数据行里，94 行「支援卡卡池」共用上一行的 `rowspan="2"` 时间 → 只有 3 格，需继承日期
//   ③ 战双日期带 12 小时制（`10:00 AM`）；雪松日期只有日期无时刻；whmx 有「开服后」这种无时刻写法
//   ④ 源站存在错行（uma 日服活动 `2025/04/10 11:00~ 2024/04/18 10:59`）→ endTs<=startTs 的行整行丢弃
//   ⑤ bwiki 对高频请求返回 HTTP 567（WAF 挑战页，body 7KB，含 "567 <id>"）→ 抓夹具必须重试/限速


//#region HTML 工具（够用即可，不引依赖）
// MediaWiki 的表格会嵌套（cell 内嵌 table）→ 用深度计数切表，避免非贪婪正则截断
function ns_bwiki_eachTable(html) {
	const out = [];
	const re = /<table\b[^>]*>|<\/table>/gi;
	let m, depth = 0, start = -1;
	while ((m = re.exec(html))) {
		if (m[0][1] !== "/") { if (depth === 0) start = m.index; depth++; }
		else { depth--; if (depth === 0) out.push(html.slice(start, m.index + m[0].length)); }
	}
	return out;
}
// 行 → [{ attrs, cells:[{tag,attrs,html,text}] }]
function ns_bwiki_tableRows(tbl) {
	const rows = [];
	const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
	let m;
	while ((m = re.exec(tbl))) rows.push({ attrs: m[1], cells: ns_bwiki_rowCells(m[2]) });
	return rows;
}
function ns_bwiki_rowCells(rowHtml) {
	const out = [];
	const re = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
	let m;
	while ((m = re.exec(rowHtml))) {
		out.push({ tag: m[1].toLowerCase(), attrs: m[2], html: m[3], text: stripTags(m[3]) });
	}
	return out;
}
function ns_bwiki_attrOf(html, name) {
	const s = String(html);
	const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) || s.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
	return m ? stripTags(m[1]) : "";
}
// 表头单元格文本（取第一行含 <th> 的）
function ns_bwiki_headerCells(tbl) {
	const hr = ns_bwiki_tableRows(tbl).find((r) => r.cells.some((c) => c.tag === "th"));
	return hr ? hr.cells.map((c) => c.text) : [];
}
function ns_bwiki_findTablesByHeaders(tables, wanted) {
	return tables.filter((tbl) => {
		const h = ns_bwiki_headerCells(tbl).join("|");
		return wanted.every((w) => h.includes(w));
	});
}
// 表/节点之前最近的小节标题（用于取干净的池名、区分「已实装/预测」两张同表头表）
function ns_bwiki_headingBefore(html, idx) {
	const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m, last = "";
	while ((m = re.exec(html))) {
		if (m.index >= idx) break;
		last = stripTags(m[2]).replace(/\s*\[\s*编辑\s*\]\s*/g, "").trim();
	}
	return last;
}
// 图片名 → 可读名（whmx 用 `孤岛螺旋-banner.png`；stellasora 用 `Banner bossrush 5.png`）
function ns_bwiki_cleanImgName(alt) {
	let x = String(alt || "").trim();
	if (!x || /^(无图|暂无)/.test(x)) return "";
	x = x.replace(/^文件\s*[:：]\s*/, "").replace(/\.(png|jpe?g|gif|webp)$/i, "");
	x = x.replace(/^banner[\s_-]*/i, "").replace(/[\s_-]*banner$/i, "");
	return x.trim();
}
// 单元格里所有 <a title="…">（去重、保序）—— bwiki 常把角色名只放在 title/alt 属性里。
// 少数行没有角色词条，只有图片文件链接（如 whmx 自选池 `文件:结伴同游·请调书.png`）→ 退化为清洗后的文件名。
function ns_bwiki_linkTitles(html) {
	const out = [], seen = new Set();
	const re = /<a\b[^>]*\btitle\s*=\s*"([^"]*)"/gi;
	let m;
	while ((m = re.exec(String(html)))) {
		let t = stripTags(m[1]).trim();
		if (/^(文件|File|分类|Category)\s*[:：]/i.test(t) || /\.(png|jpe?g|gif|webp)$/i.test(t)) t = ns_bwiki_cleanImgName(t);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}
//#endregion

//#region 日期解析
// 三种源站写法：
//   `2026年09月30日 10:00`、`2026年9月30日开服后`（无时刻）
//   `2026/09/30 10:00`、`2026/9/30 9:59 AM`（12 小时制）、`2024/12/7`
//   `10月22日 09:59`（省年份 → 继承上一个点的年份，月倒退则 +1 年）
const ns_bwiki_DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})|(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

// 紧跟日期之后的时刻（可带 AM/PM）；没有 → null（= 源站只给日期）
function ns_bwiki_timeAfter(text, from) {
	const m = String(text).slice(from, from + 14).match(/^\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/);
	if (!m) return null;
	let h = +m[1];
	const mi = +m[2];
	const ap = m[3] ? m[3].toLowerCase() : "";
	if (ap === "p" && h < 12) h += 12;
	if (ap === "a" && h === 12) h = 0;
	if (h > 23 || mi > 59) return null;
	return { h, mi };
}
// 文本 → 日期点数组 [{y,mo,d,h,mi,noTime}]
function ns_bwiki_parsePoints(text) {
	const s = String(text);
	const out = [];
	let lastY = null, lastMo = null;
	ns_bwiki_DATE_RE.lastIndex = 0;
	let m;
	while ((m = ns_bwiki_DATE_RE.exec(s))) {
		let y, mo, d;
		if (m[1] != null) { y = +m[1]; mo = +m[2]; d = +m[3]; }
		else if (m[4] != null) { y = +m[4]; mo = +m[5]; d = +m[6]; }
		else { y = null; mo = +m[7]; d = +m[8]; }
		if (y == null) {
			if (lastY == null) continue;                        // 前面也没有年份 → 无法定位
			y = lastMo != null && mo < lastMo - 6 ? lastY + 1 : lastY;   // 跨年（12月 → 1月）
		}
		const t = ns_bwiki_timeAfter(s, m.index + m[0].length);
		out.push({ y, mo, d, h: t ? t.h : 0, mi: t ? t.mi : 0, noTime: !t });
		lastY = y; lastMo = mo;
	}
	return out;
}
function ns_bwiki_pointTs(p, tz) { return sourceInstant(p.y, p.mo, p.d, p.h, p.mi, tz); }
function ns_bwiki_prettyPoint(p) { return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`; }

// 整表朝向：源站有些表写「开始 ~ 结束」，有些写「结束 ~ 开始」（uma 简中已实装表就是后者）。
// 用多数票判定，避免个别错行把整表判反；错行本身按 endTs<=startTs 丢弃。
function ns_bwiki_detectOrientation(texts, tz) {
	let rev = 0, nor = 0;
	for (const t of texts) {
		const ps = ns_bwiki_parsePoints(t);
		if (ps.length < 2) continue;
		const a = ns_bwiki_pointTs(ps[0], tz), b = ns_bwiki_pointTs(ps[1], tz);
		if (a > b) rev++;
		else if (a < b) nor++;
	}
	return rev > nor ? "endFirst" : "startFirst";
}
// 单元格 → 窗口（取前两个日期点）；只有日期没时刻时：起点按 00:00、终点按 23:59
function ns_bwiki_windowsFromCell(text, tz, orient = "startFirst") {
	const ps = ns_bwiki_parsePoints(text);
	if (ps.length < 2) return [];
	const a = ps[0], b = ps[1];
	let sp, ep;
	if (orient === "endFirst") { sp = b; ep = a; } else { sp = a; ep = b; }
	const startTs = ns_bwiki_pointTs(sp, tz);
	const endTs = ns_bwiki_pointTs(ep.noTime ? { ...ep, h: 23, mi: 59 } : ep, tz);
	if (!(endTs > startTs)) return [];                     // 源站错行 → 丢掉（不硬造）
	const raw = String(text).replace(/\s+/g, " ").trim();
	return [{ startTs, endTs, raw, startText: ns_bwiki_prettyPoint(sp), endText: ns_bwiki_prettyPoint(ep) }];
}
//#endregion

//#region 当期挑选（沿用插件本体语义）
const ns_bwiki_EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|全息/;
function ns_bwiki_eventTier(x) {
	const cat = `${x.cat || ""} ${x.name || x.event || ""}`.trim();
	return ns_bwiki_EVENT_TIER1_RE.test(cat) ? 1 : 2;
}
function ns_bwiki_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }

// 覆盖 now 的条目：结束在未来且已开始（起点未知的行按"已开始"处理）
function ns_bwiki_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now));
}
// 卡池：主池优先；外显取结束最早（同结束按**页面顺序**，与插件 `selectCurrent` 的稳定排序一致）
function ns_bwiki_pickCurrentPool(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const main = act.filter((it) => it.isMain !== false);
	const pool = (main.length ? main : act).slice()
		.sort((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0)));
	return { first: pool[0], pool };
}
function ns_bwiki_mergeRoles(items) {
	const seen = new Set(), out = [];
	for (const it of items) {
		for (const r of String(it.roles || "").split(/[、，,]/)) {
			const k = r.trim();
			if (!k || seen.has(k)) continue;
			seen.add(k);
			out.push(k);
		}
	}
	return out.join("、");
}
// 活动：外显优先剧情/挑战档，同级内结束时间升序
function ns_bwiki_pickCurrentEvent(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const ordered = act.slice().sort((a, b) => (ns_bwiki_eventTier(a) - ns_bwiki_eventTier(b))
		|| (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0)));
	return { first: ordered[0], ordered };
}
const ns_bwiki_permanentLine = (n) => (n > 0 ? `以及常驻活动 ${n} 项` : "");
// 卡池悬停：每池一行「池名：角色」，窗口不同时逐行补时间
function ns_bwiki_buildPoolHover(pools, tz) {
	if (pools.length < 2) return "";
	const same = new Set(pools.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
	const lines = [];
	for (const p of pools) {
		lines.push(`${p.banner}${p.roles ? `：${p.roles}` : ""}`);
		if (!same) lines.push(fmtWindow(p.startTs, p.endTs, tz));
	}
	if (same) lines.push(fmtWindow(pools[0].startTs, pools[0].endTs, tz));
	return lines.join("\n");
}
// 活动悬停：结束时间升序逐行；全部同窗口时时间只在末尾写一遍（与插件 ns_bwiki_buildEventHover 同）
function ns_bwiki_buildEventHover(items, tz, permanentCount = 0) {
	if (items.length < 2) return ns_bwiki_permanentLine(permanentCount);
	const same = new Set(items.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
	const lines = items.map((x) => (same ? x.event : `${x.event}   ${fmtWindow(x.startTs, x.endTs, tz)}`));
	if (same) lines.push(fmtWindow(items[0].startTs, items[0].endTs, tz));
	if (permanentCount > 0) lines.push(ns_bwiki_permanentLine(permanentCount));
	return lines.join("\n");
}
function ns_bwiki_gachaPayload(items, tz, now, extraHover = "") {
	const cur = ns_bwiki_pickCurrentPool(items, now);
	if (!cur) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const first = cur.first;
	const hover = [ns_bwiki_buildPoolHover(cur.pool, tz), extraHover].filter(Boolean).join("\n");
	return {
		banner: first.banner,
		roles: ns_bwiki_mergeRoles(cur.pool),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
function ns_bwiki_eventPayload(items, tz, now, permanentCount = 0) {
	const cur = ns_bwiki_pickCurrentEvent(items, now);
	if (!cur) return null;
	const first = cur.first;
	return {
		event: first.event,
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		eventHover: ns_bwiki_buildEventHover(cur.ordered, tz, permanentCount)
	};
}
//#endregion

//#region ① 物华弥新（whmx）
// 卡池页「限时招集档案」：`<table id="CardSelectTr" class="CardSelect wikitable sortable col-fold">`
//   表头 `活动名称 | UP器者 | 开放时间 | 备注`，113 行数据；**名称/UP 都只在 <img alt> / <a title> 属性里**
//   （正文 text 是空的），所以必须读属性。行属性 `data-param1` 是招集类型（新实装器者·限定 …）。
//   时间写法：`2026年09月30日 10:00 ~ 10月22日 09:59`（终点省年份）；远古行有 `2024年4月19日开服后~…`。
function ns_bwiki_parseWhmxGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];                       // 空页 → 无候选
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间", "活动名称"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-gacha:no-table");   // 结构变了 → 抓取失败
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		const banner = ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || ns_bwiki_attrOf(r.attrs, "data-param1") || "限时招集";
		const roles = ns_bwiki_linkTitles(c1.html).join("、") || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt"));
		items.push({
			_i: i, banner, roles, cat: ns_bwiki_attrOf(r.attrs, "data-param1"), note: c3.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
// 活动页「活动」：同款 CardSelect 表，表头 `活动时间 | 图 | 名称 | 类型 | 备注`，63 行数据。
// ⚠️ 实测最新一条 = 2025/05/01（页面缓存时间 2026-10-01，即内容确实停在 2025-05）→ 当期无覆盖 → null。
function ns_bwiki_parseWhmxEvents(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 5 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3, c4] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")), note: c4.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ② 闪耀优俊少女 国服（umamusume / page=简中卡池）
// 页面两张同表头的表（各含表头行共 192 / 241 行，数据行 191 / 240）：
//   ①「已实装卡池」= 简中服**实际已实装**的记录（当期外显用这张） ②「预测卡池」= **推算**。
//   ⚠️ 页首正文：「简中卡池加速 -> 简中预测时间-185天 / 2025/05/22 简中重新更新 -> 简中预测时间+423天」
//      ⇒ 简中服时刻是**按日服时差推算**出来的，**不是官方时刻表**。本解析器只用①做当期外显，
//        ②的推算结果只放进 `bannerHover` 并显式标注「接下来的预测卡池（按日服时差推算，非官方时刻表）」。
//   表结构：表头 `时间 | 卡池(colspan=2) | Up对象` → 数据行 4 格 [时间][池类型][池名][Up对象]，
//     其中「支援卡卡池」行与上一行共用时间（上一行 `rowspan="2"`）→ 只有 3 格，需继承日期。
//   ⚠️① 表时间列是 **结束 ~ 开始**（整表多数票判定为 endFirst）；② 表是 **开始 ~ 结束**。
function ns_bwiki_parseUmaCnGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { live: [], predicted: [] };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["时间", "卡池"]);
	if (cands.length === 0) throw new Error("bwiki-uma-cn-gacha:no-table");
	const parseOne = (tbl) => {
		const raw = [];
		let pendingDate = "";
		for (const r of ns_bwiki_tableRows(tbl)) {
			const cs = r.cells;
			if (!cs.length || cs.some((c) => c.tag === "th")) continue;
			if (cs.length >= 4) {
				pendingDate = cs[0].text;
				raw.push({ dateText: pendingDate, catCell: cs[1], nameCell: cs[2], upCell: cs[3] });
			} else if (cs.length === 3) {
				raw.push({ dateText: pendingDate, catCell: cs[0], nameCell: cs[1], upCell: cs[2] });
			}
		}
		const orient = ns_bwiki_detectOrientation(raw.map((x) => x.dateText), tz);
		const items = [];
		raw.forEach((x, i) => {
			const wins = ns_bwiki_windowsFromCell(x.dateText, tz, orient);
			if (wins.length === 0) return;
			const cat = x.catCell.text;
			const roles = textOf(x.upCell.html).split("\n")
				.map((s) => s.trim().replace(/^简\//, "")).filter(Boolean).join("、");
			items.push({
				_i: i,
				banner: String(x.nameCell.text).replace(/\s+/g, " ").trim() || "卡池",
				roles, cat, isMain: !/支援/.test(cat),
				startTs: wins[0].startTs, endTs: wins[0].endTs,
				orient,                                   // 整表朝向（诊断/测试用；不进契约字段）
				raw: wins[0].raw                          // 源站原文（不含任何加工）
			});
		});
		return items;
	};
	// 用各表之前最近的小节标题区分「已实装」/「预测」（取不到标题时退回文档顺序）
	const withHead = cands.map((tbl) => ({ tbl, head: ns_bwiki_headingBefore(html, html.indexOf(tbl)) }));
	const liveTbl = (withHead.find((x) => /已实装/.test(x.head)) || withHead[0]).tbl;
	const predTbl = (withHead.find((x) => /预测/.test(x.head)) || withHead[1] || withHead[0]).tbl;
	return { live: parseOne(liveTbl), predicted: predTbl === liveTbl ? [] : parseOne(predTbl) };
}
// 预测卡池：只列"还没开始"的若干条（按开始时间升序），并显式标注为推算。
// 注：该表是 wiki 按日服时差机械平移出来的，池名里连**日服原始年份**都还留着
// （如 `八骏赛马娘卡池 20230911` 被平移到 2026-09），且远期条目一路排到 2029 年 ⇒ 只能当参考。
function ns_bwiki_umaCnPredictHover(predicted, tz, now, limit = 3) {
	const next = predicted.filter((p) => p.startTs > now).sort((a, b) => a.startTs - b.startTs || (a._i - b._i)).slice(0, limit);
	if (next.length === 0) return "";
	const lines = next.map((p) => `${p.banner}   ${fmtWindow(p.startTs, p.endTs, tz)}`);
	return ["—— 接下来的预测卡池（按日服时差推算，非官方时刻表） ——", ...lines].join("\n");
}
//#endregion

//#region ③ 赛马娘 日服（umamusume / page=活动）—— 时区硬标注 Asia/Tokyo
// 页面只有一张表，标题是「往期活动」（**归档**，不是当期排期），100 行；表头 `活动时间 | 图 | 名称 | 类型`。
//   时间写法 `2025/12/26 11:00~ 2026/01/08 10:59`（开始 ~ 结束）。
//   第 1 行是常驻（`常驻~ 常驻`，无日期）→ 只计入常驻条数，不进当期排序。
//   ⚠️ 实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
//   ⚠️ 源站有错行 `2025/04/10 11:00~ 2024/04/18 10:59` → endTs<=startTs 被整行丢弃。
function ns_bwiki_parseUmaJpEvents(html, tz = "Asia/Tokyo") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { items: [], permanent: 0 };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-uma-jp-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	let permanent = 0;
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) {
			if (/常驻|永久|長期|长期/.test(c0.text)) permanent++;
			return;
		}
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return { items, permanent };
}
//#endregion

//#region ④ 战双帕弥什 国服（zspms / page=研发记录）
// 107 张独立小表，每张 = 一期「降临狙击」研发池：行1 = `<td colspan="2">` 立绘/名（名在 <a title>），
//   行2 = `日期 | 2024/03/21 10:00 AM 至 2024/04/04 09:59 AM`（**12 小时制**），
//   行3 = `效果 | 「<a title=角色>」…`。表格前最近的 h2 就是干净的池名（如 `【露西亚·深红囚影】…限时概率UP`）。
//   ⚠️ 实测最新一期 = 2024/03/21（页面缓存时间 2026-10-01）→ 该页 **停在 2024Q1**，当期无覆盖 → null。
//      （页首自述「目前该记录仅包括"降临狙击角色"池和"命运降临角色狙击"池」。）
function ns_bwiki_parseZspmsGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const items = [];
	let seenLabel = 0;
	tables.forEach((tbl, ti) => {
		const rows = ns_bwiki_tableRows(tbl);
		let dateText = "", roleText = "", imgTitle = "";
		for (const r of rows) {
			if (r.cells.length === 1) {                        // 立绘行（colspan=2）
				const t = ns_bwiki_attrOf(r.cells[0].html, "title") || r.cells[0].text;
				if (t) imgTitle = t;
			}
			for (let i = 0; i < r.cells.length; i++) {
				const label = r.cells[i].text;
				const next = r.cells[i + 1];
				if (!next) continue;
				if (/^(日期|时间)/.test(label)) { dateText = next.text; seenLabel++; }
				else if (/^效果/.test(label)) roleText = next.html;
			}
		}
		const w = ns_bwiki_windowsFromCell(dateText, tz, "startFirst")[0];
		if (!w) return;
		const head = ns_bwiki_headingBefore(html, html.indexOf(tbl));
		const roles = ns_bwiki_linkTitles(roleText).join("、");
		items.push({
			_i: ti,
			banner: head || ns_bwiki_cleanImgName(imgTitle) || "研发池",
			roles, cat: "研发", note: "降临狙击角色池",
			startTs: w.startTs, endTs: w.endTs, raw: w.raw
		});
	});
	if (seenLabel === 0 && tables.length > 0) throw new Error("bwiki-zspms-gacha:no-table");   // 结构变了
	return items;
}
//#endregion

//#region ⑤ 雪松（kedrgame / page=卡池信息）—— ⚠️ 台架测试占位页，可能已停更
// 该页**没有任何表格**，只有两个小节「台架测试[一]」「台架测试[二]」，正文形如：
//   `<b>===时间===</b>：2024/12/7-2024/12/13`（**只有日期、没有时刻**）
//   第二段是 `？-？`（未填）。→ 实测唯一可解析的窗口 = 2024/12/07 ~ 2024/12/13，早于当期 → null。
//   ⚠️ 风险标注：最近编辑 2025-08-01、页面自称「台架测试」；但同 wiki 有 `历史卡池-精英集结-1.0.0-*`、
//      `游戏内部公告(2026.6/7)` 等更新页面，说明 wiki 还活着、只是本页不再是有效数据源。
function ns_bwiki_parseKedrGacha(html, tz = "Asia/Shanghai") {
	const re = /={2,}\s*时间\s*={2,}\s*(?:<\/b>)?\s*[:：]?\s*([^<]*)/g;
	const items = [];
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const value = m[1].replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(value, tz, "startFirst")[0];
		if (!w) continue;
		items.push({
			_i: i++,
			banner: ns_bwiki_headingBefore(html, m.index) || "卡池",
			roles: "", cat: "台架测试", note: value,
			startTs: w.startTs, endTs: w.endTs, raw: value
		});
	}
	return items;
}
//#endregion

//#region ⑥ 卡厄斯梦境 国服（czn / page=卡池记录）—— ⚠️ 实测为空页
// `prop=text` 全文只有 `模板:Gacha` 一个链接，**无表格、无日期**（wiki 侧该模板已不存在/不产出内容）。
// 同 wiki 站内搜索 "卡池" 只命中 4 页（卡池记录 / 首页 / 首页-PC端 / 首页-移动端），没有更好的卡池页。
// ⇒ 返回 []，抓取器据此返回 null（如实"抓到了页面但当期没内容"）。若日后 wiki 补全为 CardSelect 表，
//    本解析器按 whmx 同款表头（开放时间/活动名称）兜底解析。
function ns_bwiki_parseCznGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间"]);
	if (cands.length === 0) return [];                         // 有表但不是卡池表 → 视为无内容
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			banner: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || "卡池",
			roles: ns_bwiki_linkTitles(c1.html).join("、"),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ⑦ 星塔旅人 国服（stellasora / page=首页 的「活动日历」区块）—— ⚠️ 低可用性
// 区块形如：
//   `<div class="activity-item"><img alt="Banner bossrush 5.png" …>
//      <div class="activity-time" data-end-time="2026-04-01T02:59:59">计算中...</div>
//      <div class="activity-date">2026/03/01</div></div>`
// 只有 2 项；**没有活动名文本字段**（只能取立绘文件名）、剩余时间由页面 JS 现算（静态是「计算中...」）。
// `data-end-time` 是**不带时区**的 ISO → 按源站墙钟（国服 UTC+8）解释（**假设**，见 registry-b2.js）。
// ⚠️ 实测两项分别止于 2026-04-01 / 2026-04-07（页面静态计数「当前正在进行的活动有 0 个」）→ 当期无覆盖 → null。
function ns_bwiki_parseStellasoraEvents(html, tz = "Asia/Shanghai") {
	const out = [];
	const re = /<div class="activity-item">([\s\S]*?)<div class="activity-date"\s*>([^<]*)<\/div>/g;
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const block = m[1];
		const endIso = ns_bwiki_attrOf(block, "data-end-time");
		const startText = m[2].replace(/\s+/g, " ").trim();
		const alt = ns_bwiki_attrOf(block, "alt");
		const sp = ns_bwiki_parsePoints(startText)[0];
		const em = String(endIso).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
		if (!sp || !em) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, 0, 0, tz);
		const endTs = sourceInstant(+em[1], +em[2], +em[3], +em[4], +em[5], tz);
		if (!(endTs > startTs)) continue;
		out.push({
			_i: i++,
			event: ns_bwiki_cleanImgName(alt) || "活动",
			cat: "活动日历", img: ns_bwiki_cleanImgName(alt), imgRaw: alt,
			startTs, endTs, raw: `${startText} ~ ${endIso}`
		});
	}
	return out;
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
async function ns_bwiki_fetchHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy" });
}
// 物华弥新 国服 —— 卡池
async function ns_bwiki_gachaWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_gachaPayload(items, tz, ns_bwiki_nowOf(now));
}
// 物华弥新 国服 —— 活动
async function ns_bwiki_eventsWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
// 闪耀优俊少女 国服 —— 卡池（只用「已实装卡池」，预测只进 bannerHover 且标注为推算）
async function ns_bwiki_gachaUmaCn(url, signal, tz = "Asia/Shanghai", now) {
	const { live, predicted } = ns_bwiki_parseUmaCnGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	const n = ns_bwiki_nowOf(now);
	return ns_bwiki_gachaPayload(live, tz, n, ns_bwiki_umaCnPredictHover(predicted, tz, n));
}
// 赛马娘 日服 —— 活动（bwiki 侧；页面为「往期活动」归档）
async function ns_bwiki_eventsUmaJp(url, signal, tz = "Asia/Tokyo", now) {
	const { items, permanent } = ns_bwiki_parseUmaJpEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), permanent);
}
// 战双帕弥什 国服 —— 卡池（研发记录）
async function ns_bwiki_gachaZspms(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseZspmsGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 雪松 —— 卡池（台架测试占位页）
async function ns_bwiki_gachaKedr(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseKedrGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 卡厄斯梦境 国服 —— 卡池（页面为空，预期 null）
async function ns_bwiki_gachaCzn(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseCznGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 星塔旅人 国服 —— 活动（首页活动日历，低可用性）
async function ns_bwiki_eventsStellasora(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_eventPayload(ns_bwiki_parseStellasoraEvents(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

		// ===== 内联自 next-sources/parsers/umapyoi.js（模块级标识符已加 ns_umapyoi_ 前缀）=====

// next-sources/parsers/umapyoi.js —— 赛马娘 日服（第三方 API：api.umapyoi.net）
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? } | null
//
// ⚠️ 实测（2026-10-02 夹具 `b1-umapyoi-gacha`，704 条）与任务给的简化形态的差别：
//   GET https://api.umapyoi.net/api/v1/gacha → JSON **数组**，每条 =
//     { card_type: "Outfit" | "Support Card", id, start_date, end_date, type }
//   · `start_date` / `end_date` 是 **Unix 秒**（不是毫秒）。
//   · `end_date === 2147483647`（INT32_MAX）是**常驻哨兵**：源站用它表示"没有结束时间"（夹具里 38 条）。
//   · **源站只给"卡"（id + 卡类型）的获取窗口，没有卡池名** —— 所以 banner 只能合成：
//     本解析器把"同一 (start_date, end_date) 的一批新卡"当作一个卡池窗口，
//     banner 写成「赛马娘日服卡池（卡类型…）」。
//     ⚠️ 只按 `start_date` 分组是**错的**：实测 29 个 start_date 同时挂多组不同 end_date，
//        而且常驻卡（哨兵）与有界卡会共用同一个 start_date —— 按 start 分组会把"常驻"
//        混进窗口，从而把整组误判成已过期（2026-03-11 那批就是这样）。
//
// 时区：`Asia/Tokyo`。依据（两条）：
//   ① bwiki 正文硬标注「日服卡池时间记录统一为日本时间」；
//   ② 夹具自洽：666 个**有界** end_date 全部落在 02:59:59Z（= 11:59:59 JST，一个不差），
//      且 664/704 个 start_date 落在 03:00Z（= 12:00 JST，日服卡池 12:00 更新）——
//      只有 UTC+9 才能把这些渲染成"整点 12:00 / 11:59:59"。
//
// 选池规则（本项目 JSON 源的通用约定，见 registry-b1.js 注释）：
//   覆盖当前时刻的**有界窗口**里取 startTs 最新的那批（并列取结束更早、id 更小）。
//   常驻卡（哨兵）不构成"当期窗口"；当期没有任何有界窗口 → 返回 null（未公布）。


const ns_umapyoi_DEFAULT_URL = "https://api.umapyoi.net/api/v1/gacha";
const ns_umapyoi_PERMANENT_END = 2147483647;   // 源站常驻哨兵（Unix 秒 = INT32_MAX）
const ns_umapyoi_HOVER_MAX = 20;                      // hover 最多列这么多行，余下只报数量

const ns_umapyoi_toNum = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const ns_umapyoi_byNewestStart = (a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs) || (a.id0 - b.id0);

// 纯函数：夹具/单测可直接喂 JSON（不联网）
function ns_umapyoi_parseUmapyoiGacha(json, now = Date.now(), tz = "Asia/Tokyo") {
	if (!Array.isArray(json)) throw new Error("umapyoi-bad-shape");
	const rows = [];
	for (const it of json) {
		if (!it || typeof it !== "object") continue;
		const s = ns_umapyoi_toNum(it.start_date);
		if (s == null) continue;
		const e = ns_umapyoi_toNum(it.end_date);
		// 常驻哨兵（或缺失结束）→ endTs 记为 null：**绝不**把 2147483647 当成真实时刻
		const permanent = e == null || e >= ns_umapyoi_PERMANENT_END;
		rows.push({
			id: it.id,
			id0: ns_umapyoi_toNum(it.id) == null ? Number.MAX_SAFE_INTEGER : ns_umapyoi_toNum(it.id),
			cardType: String(it.card_type == null ? "" : it.card_type),
			type: it.type,
			startTs: s * 1000,
			endTs: permanent ? null : e * 1000,
			permanent
		});
	}
	if (rows.length === 0) throw new Error("umapyoi-no-rows");

	// 有界窗口 = 同一 (start_date, end_date) 的一批卡（见文件头：不能只按 start_date 分组）
	const merged = new Map();
	for (const r of rows) {
		if (r.permanent) continue;
		const k = r.startTs + "|" + r.endTs;
		let p = merged.get(k);
		if (!p) { p = { startTs: r.startTs, endTs: r.endTs, id0: r.id0, items: [] }; merged.set(k, p); }
		p.items.push(r);
		if (r.id0 < p.id0) p.id0 = r.id0;
	}
	const pools = [...merged.values()].map((p) => ({
		startTs: p.startTs,
		endTs: p.endTs,
		id0: p.id0,
		items: p.items,
		ids: p.items.map((x) => x.id).filter((x) => x != null),
		cardTypes: [...new Set(p.items.map((x) => x.cardType).filter(Boolean))]
	}));

	const active = pools.filter((p) => p.startTs <= now && p.endTs >= now).sort(ns_umapyoi_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;   // 抓到数据但当期没有有界窗口（常驻卡不算） = 未公布

	const types = cur.cardTypes.join("、");
	const banner = types ? `赛马娘日服卡池（${types}）` : "赛马娘日服卡池";
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	const lines = active.slice(0, ns_umapyoi_HOVER_MAX).map((p) => {
		const detail = `${p.cardTypes.join("、") || "卡"}×${p.items.length}`
			+ (p.ids.length ? `（id ${p.ids.join("、")}）` : "");
		return `${fmtWindow(p.startTs, p.endTs, tz)}  ${detail}`;
	});
	if (active.length > lines.length) lines.push(`…另有 ${active.length - lines.length} 个同期窗口未列出`);
	const permActive = rows.filter((r) => r.permanent && r.startTs <= now).length;
	if (permActive > 0) lines.push(`另有 ${permActive} 张常驻卡（end_date=2147483647 哨兵，无结束时间，不计入当期窗口）`);
	// 源站无卡池名 → hover 首行如实说明 banner 是合成的
	const hover = ["赛马娘日服（源站为卡级数据，无卡池名；起止＝该批新卡的获取窗口）", ...lines].join("\n");

	return {
		banner,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: hover
	};
}

// 抓取器：mode="direct"（实测 api.umapyoi.net 响应 ACAO=*）
async function ns_umapyoi_gachaUmapyoi(url, signal, tz = "Asia/Tokyo", now = Date.now()) {
	const data = await fetchJson(url || ns_umapyoi_DEFAULT_URL, { signal, mode: "direct" });
	return ns_umapyoi_parseUmapyoiGacha(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/bestdori.js（模块级标识符已加 ns_bestdori_ 前缀）=====

// next-sources/parsers/bestdori.js —— BanG Dream!（Bestdori 社区数据库，取**简中服**时间段）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-bestdori-gacha` / `b1-bestdori-events`）与任务给的简化形态的差别：
//   1. 两个文件都是**以 id 为 key 的对象**（不是数组）：gacha 2149 个键、events 345 个键。
//   2. 时间是 **字符串毫秒**（`"1462071600000"`），需要 Number()；缺失服区为 `null`。
//   3. 字段名实测：
//      gacha：{ resourceName, bannerAssetBundleName, gachaName[5], publishedAt[5], closedAt[5], type, newCards }
//      event：{ eventType, eventName[5], assetBundleName, startAt[5], endAt[5], … }
//      —— 任务里猜的 `eventName`/`startAt`/`publishedAt`/`closedAt` 全对，但**值是字符串**。
//
// 服区下标：0=日 1=英 2=繁中 **3=简中** 4=韩。
//   实测交叉验证（夹具里的 gacha 1「リリース記念ガチャ」五连名称）：
//     [0] リリース記念ガチャ / [1] Release Celebration Gacha / [2] 遊戲上線紀念轉蛋 / [3] 开服纪念招募 / [4] 오픈 기념 뽑기
//   → [3] 是**简体中文**，即简中服（本条目要的服区）。gacha 里带 CN 时间的有 1734 / 2149 条。
//
// 时区：UTC+8。UTC 毫秒本身就是**绝对时刻**，这里**不做任何时区换算**；
//   `tz`（Asia/Shanghai）只用于把绝对时刻渲染成源站墙钟文本（sourceWallParts/fmtWindow）。
//   交叉验证（调研文档 + 夹具）：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt=1790647200000（=02:00Z）完全吻合。


const ns_bestdori_DEFAULT_GACHA = "https://bestdori.com/api/gacha/all.5.json";
const ns_bestdori_DEFAULT_EVENT = "https://bestdori.com/api/events/all.5.json";
const ns_bestdori_CN_INDEX = 3;                        // 简中服下标（见文件头实测）
const ns_bestdori_LONG_MS = 400 * 86400e3;             // >400 天 = 长期/常驻池（如 closedAt=2100-08-15）
const ns_bestdori_HOVER_MAX = 20;

const ns_bestdori_toTs = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const ns_bestdori_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((Number(a.id) || 0) - (Number(b.id) || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**（≤400 天）简中池里取 startTs 最新的一期当"当期卡池"；
// 长期/常驻池（miracle/free 等，closedAt 常是 2100 哨兵）不参与选择，只在 hover 里报个数。
function ns_bestdori_parseBestdoriGacha(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-gacha-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const pools = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.publishedAt) || !Array.isArray(v.closedAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.gachaName) ? v.gachaName[ns_bestdori_CN_INDEX] : null;
		const p = ns_bestdori_toTs(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = ns_bestdori_toTs(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_bestdori_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同名同期（同一期招募在多处登记）→ 合并成一行并标 ×n，hover 才不会被重复行刷屏
	const pooled = [];
	for (const p of bounded) {
		const hit = pooled.find((x) => x.name === p.name && x.startTs === p.startTs && x.endTs === p.endTs);
		if (hit) hit.n += 1; else pooled.push({ ...p, n: 1 });
	}
	const shown = pooled.slice(0, ns_bestdori_HOVER_MAX).map((p) => `${p.name}（${p.type}）${p.n > 1 ? `×${p.n}` : ""}  ${fmtWindow(p.startTs, p.endTs, tz)}`);
	if (pooled.length > shown.length) shown.push(`…另有 ${pooled.length - shown.length} 个同期卡池未列出`);
	const longN = active.length - bounded.length;
	if (longN > 0) shown.push(`另有 ${longN} 个长期/常驻卡池（结束时间是 2100 之类的哨兵值，未计入"当期"）`);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: shown.length >= 2 ? shown.join("\n") : ""
	};
}

// ── 活动侧 ──
function ns_bestdori_parseBestdoriEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-event-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const rows = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.startAt) || !Array.isArray(v.endAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.eventName) ? v.eventName[ns_bestdori_CN_INDEX] : null;
		const s = ns_bestdori_toTs(v.startAt[ns_bestdori_CN_INDEX]);
		const e = ns_bestdori_toTs(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_bestdori_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 活动一般只有一期在期；多期时 hover 逐行列出（与插件 buildEventHover 同约定：<2 条返回 ""）
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: dates, eventHover: hover };
}

// 抓取器：mode="proxy"（实测 bestdori.com 无 ACAO，必须走宿主代理）
async function ns_bestdori_gachaBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_GACHA, { signal });
	return ns_bestdori_parseBestdoriGacha(data, now, tz);
}
async function ns_bestdori_eventsBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_EVENT, { signal });
	return ns_bestdori_parseBestdoriEvents(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/sekai.js（模块级标识符已加 ns_sekai_ 前缀）=====

// next-sources/parsers/sekai.js —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-sekai-gachas` 59 条 / `b1-sekai-events` 198 条）与任务给的形态的差别：
//   1. `gachas.json` 的 `gachaType` 是**字符串枚举**（beginner/normal/sureturn/subeginner/ceil/sunormal），
//      不是数字；`events.json` 的 `eventType` 也是字符串（marathon/cheerful_carnival/world_bloom）。
//   2. **`events.json` 里根本没有 `endAt` 字段**（这是任务给的字段形态里最需要纠正的一处）。
//      实测字段：startAt / aggregateAt / rankingAnnounceAt / distributionStartAt / closedAt / distributionEndAt。
//      本解析器把**活动游玩期**取为 `startAt ~ aggregateAt`（aggregateAt = 活动结束、开始统计的时刻），
//      并在 `eventDatesRaw` 里如实注明这个映射；`closedAt` 是结果公布时刻，不作窗口结束。
//   3. `gachas.json` 里有大量**长期池**：endAt 是 2099 哨兵（如 id 579「任务招募」2025-01-01 ~ 2099-12-30）。
//      它们不参与"当期"选择（见下），只在 hover 里报个数。
//
// 时区：UTC+8（`Asia/Shanghai`）。epoch 毫秒 = 绝对时刻，**不做时区换算**，`tz` 只用于渲染墙钟文本。
//   依据（夹具自洽，把"推测"变成了可验证的三条）：
//   ① 生日池 836「[桐谷遥]HAPPY BIRTHDAY 2026招募」startAt=1790784000000 → UTC+8 渲染正好是 2026-10-01 00:00
//      （桐谷遥生日当天 00:00；UTC+9 会渲染成 01:00，不成立）；
//   ② 月卡池 802「缤纷月卡招募」startAt=1788145200000 → UTC+8 是 2026-09-01 04:00（每月 1 日 04:00 换月卡）；
//   ③ 常规卡池轮换时刻 825/826… 都落在 UTC+8 的 12:00。
//
// ⚠️ 服区存疑（不要当成"国服专属源"）：仓库名是 `sekai-master-db-cn-diff`，但夹具里
//   第一条事件 id=1「雨过天晴的启明星」startAt=1633762800000 = 2021-10-09 15:00(UTC+8)
//   （更接近**繁中服** 2021-09-30 上线后的首期活动），且部分条目名是繁体（如 gacha 16「新手應援起跑衝刺招募」）。
//   简中服与繁中服**同为 UTC+8**，所以时区取值不受影响；但"这是哪个服"未定论 → 注册表条目如实备注。


const ns_sekai_DEFAULT_GACHA = "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json";
const ns_sekai_DEFAULT_EVENT = "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json";
const ns_sekai_LONG_MS = 400 * 86400e3;   // >400 天 = 长期/常驻池（2099 哨兵）
const ns_sekai_HOVER_MAX = 20;

const ns_sekai_toTs = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ns_sekai_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((a.id || 0) - (b.id || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**池里取 startTs 最新的一期当"当期招募"；长期池不参与（只在 hover 报个数）。
function ns_sekai_parseSekaiGachas(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = ns_sekai_toTs(g.startAt), e = ns_sekai_toTs(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e, long: e - s > ns_sekai_LONG_MS });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_sekai_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同名同期（实测：阶梯招募/高级礼物招募各按角色重复 4~6 条）→ 合并成一行并标 ×n
	const pooled = [];
	for (const p of bounded) {
		const hit = pooled.find((x) => x.name === p.name && x.startTs === p.startTs && x.endTs === p.endTs);
		if (hit) hit.n += 1; else pooled.push({ ...p, n: 1 });
	}
	const shown = pooled.slice(0, ns_sekai_HOVER_MAX).map((p) => `${p.name}（${p.type}）${p.n > 1 ? `×${p.n}` : ""}  ${fmtWindow(p.startTs, p.endTs, tz)}`);
	if (pooled.length > shown.length) shown.push(`…另有 ${pooled.length - shown.length} 组同期招募未列出`);
	const longN = active.length - bounded.length;
	if (longN > 0) shown.push(`另有 ${longN} 个长期/常驻招募（endAt 是 2099 之类的哨兵值，未计入"当期"）`);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: shown.length >= 2 ? shown.join("\n") : ""
	};
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
function ns_sekai_parseSekaiEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-event-bad-shape");
	const rows = [];
	for (const e of json) {
		if (!e || typeof e !== "object") continue;
		const s = ns_sekai_toTs(e.startAt);
		const agg = ns_sekai_toTs(e.aggregateAt);
		const end = agg != null ? agg : ns_sekai_toTs(e.closedAt);   // 源站无 endAt：优先 aggregateAt
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name || s == null || end == null || end <= s) continue;
		rows.push({ id: e.id, name, type: String(e.eventType || ""), startTs: s, endTs: end, closedAt: ns_sekai_toTs(e.closedAt) });
	}
	if (rows.length === 0) throw new Error("sekai-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_sekai_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 源站没有"活动起止"这一对字段名 → 悬停里注明映射，避免读者以为 endAt 是从源站直接读到的
	const raw = `${dates}（源站无 endAt：结束取 aggregateAt${cur.closedAt != null ? `；closedAt=${fmtWindow(cur.closedAt, cur.closedAt, tz).split(" ~ ")[0]} 为结果公布` : ""}）`;
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: raw, eventHover: hover };
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
async function ns_sekai_gachaSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_GACHA, { signal, mode: "direct" });
	return ns_sekai_parseSekaiGachas(data, now, tz);
}
async function ns_sekai_eventsSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_EVENT, { signal, mode: "direct" });
	return ns_sekai_parseSekaiEvents(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/gf2.js（模块级标识符已加 ns_gf2_ 前缀）=====

// next-sources/parsers/gf2.js —— 少女前线2：追放 国服（sunborngame 官方 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/gf2-*）────────────────────────
// 列表 API：GET /website/news_list/{typeId}?page=1&limit=10
//   → { code:0, msg:"", data:{ limit, page, total, list:[{Id,Type,Title,Date,Content,Marks,Site,GlobalTop}] } }
//   ⚠️ **列表里的 `Content` 恒为空字符串**（实测 4 个夹具都是 ""）：正文只在详情 API 里。
//      所以卡池/活动的「活动时间」必须再抓一次 /website/news/{Id}。
//      任务书里说的「Content 是 HTML 富文本」指的是**详情**响应，列表响应不是。
// 详情 API：GET /website/news/{Id} → { code:0, data:{ Id, Type, Title, Date, Content:"<p>…<br>…", … } }
//
// ── typeId 实测语义（与任务书的「简化版形态」有出入，以实测为准）──────────────
//   · typeId=4：**活动与卡池混排**。同页既有【静默突触】这类大型主题活动，也有
//     「…限时概率UP活动现已开启！」「【新装采购·睡醒的人鱼】」「【重逢采购】」这类卡池公告。
//     → 卡池侧**必须按标题过滤**出卡池类公告，不能无脑取第一条（第一条往往是主题活动）。
//   · typeId=3：官方公告（版本更新公告 / 临时维护公告 / 封禁公告）。
//   · 卡池过滤词：概率UP / 采购 / 军备提升（GF2 的卡池就叫「采购」，装备池叫「军备提升」）。
//
// ── `Date` 字段的真正含义（实测的交叉验证，非猜测）──────────────────────────
//   · 9/22 版本更新公告：Date="2026-09-21 18:31:03"（公告发布时刻），
//     正文「维护时间：2026年9月22日09:00~12:00」。
//   · 卡池公告 2128「代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！」：
//     Date="2026-09-22 12:00:00" = **当日维护结束 12:00**；正文「活动时间：
//     2026年9月22日 版本更新后~2026年10月13日 08:59」。
//   · 另一条【迭代回廊】Date="2026-10-01 05:00:00" —— 正是国服每日 05:00 刷新点。
//   ⇒ `Date` = **该条公告的生效时刻**，而正文里的「版本更新后」= 维护结束 = `Date` 的时刻部分。
//     所以「版本更新后」这类**起点不明确的窗口**用 `Date` 的时刻补齐（源站自身给出的值），
//     不去猜「凌晨4点」之类的惯例。日期不同日则视为无法解析、跳过该窗口（宁缺勿造）。
//
// ── 时区 UTC+8（Asia/Shanghai）**推定** ─────────────────────────────────────
//   源站正文未硬标注时区。推定依据：① API 的 Date 全部是北京时间口径（发布 18:31、
//   维护 09:00~12:00）；② 每日刷新点 05:00 是国服惯例；③ 同一条公告里的维护窗口与
//   卡池窗口同源同口径。属**推定**，报告里已注明（非硬证据）。


const ns_gf2_GF2_BASE = "https://gf2-web-preregister-api.sunborngame.com";
const ns_gf2_GF2_HOME = "https://gf2.sunborngame.com/";
const ns_gf2_GF2_TZ = "Asia/Shanghai";
// 注册表用的两个入口（两侧 URL 就是任务书给的那两个 typeId）
const ns_gf2_GF2_GACHA_URL = `${ns_gf2_GF2_BASE}/website/news_list/4?page=1&limit=10`;
const ns_gf2_GF2_EVENT_URL = `${ns_gf2_GF2_BASE}/website/news_list/3?page=1&limit=10`;

// 依次试候选：单条失败（网络/404）不整体崩，留给下一条；**全部失败则抛出第一个错误**
// —— 不能把"源站挂了"静默降级成"未公布"（那会让上层以为当期真的没内容）。
async function ns_gf2_firstWorking(candidates, work) {
	let firstErr = null;
	for (const c of candidates) {
		try {
			const r = await work(c);
			if (r) return r;
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// 卡池类公告的标题特征（实测：采购 = 角色池，军备提升 = 装备池）
const ns_gf2_GF2_POOL_RE = /概率UP|采购|军备提升/;
// 版本更新公告的特征（活动侧优先取它；其余是临时维护/封禁公告）
const ns_gf2_GF2_VERSION_RE = /版本更新|维护/;

// ── 列表解析 ──
// 容错：形状不对 → 抛错（= 该侧抓取失败）；list 为空数组 → 返回 []（= 当期无内容）
function ns_gf2_parseGf2List(json, tz = ns_gf2_GF2_TZ) {
	if (!json || typeof json !== "object") throw new Error("gf2-bad-json");
	if (json.code !== 0) throw new Error("gf2-code-" + json.code);
	const data = json.data;
	if (!data || !Array.isArray(data.list)) throw new Error("gf2-bad-json");
	return data.list
		.filter((x) => x && typeof x.Id === "number" && typeof x.Title === "string")
		.map((x) => ({
			id: x.Id,
			type: x.Type,
			title: x.Title,
			date: typeof x.Date === "string" ? x.Date : "",
			dateTs: ns_gf2_parseGf2Date(x.Date, tz)
		}));
}

// "2026-09-22 12:00:00" → 绝对毫秒（按 tz 解释源站墙钟）。解析不出 → null
function ns_gf2_parseGf2Date(s, tz = ns_gf2_GF2_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_gf2_gf2DetailUrl(id) { return `${ns_gf2_GF2_BASE}/website/news/${id}`; }

// ── 正文窗口解析 ──
// 令牌化：日期(必带年) / 时刻 / 「版本更新后」类短语 / 区间分隔符
// 为什么用令牌而不用一条大正则：GF2 的窗口有 3 种写法混排——
//   `2026年9月22日09:00~12:00`（同日，末段只有时刻）
//   `2026年9月22日 版本更新后~2026年11月3日 08:59`（起点是短语）
//   `2026年9月22日 版本更新后~2026年10月13日 08:59`
// 令牌走法可以把「起点未知」和「末段缺日期」分别处理，比分组的可选组好读也好测。
const ns_gf2_GF2_TOKEN = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?|(版本更新完成后|版本更新后|更新维护后|维护完成后|维护后|更新后)|([~～\-—－至])/g;

// 「维护后」类短语 → 用 dateHint（= 该条公告的 `Date`）的时刻补起点；
// 只有 hint 的**日历日**与窗口起点日一致时才敢用（否则宁可不解析这个窗口）
function ns_gf2_resolvePhrase(phrase, dateHint, tz, y, mo, d) {
	if (!phrase || !dateHint) return null;
	const hintParts = sourceWallParts(dateHint, tz);
	if (!hintParts) return null;
	if (hintParts.y !== y || hintParts.mo !== mo || hintParts.d !== d) return null;
	return { h: hintParts.h, mi: hintParts.mi };
}

// 从正文纯文本抽窗口。返回 [{ label, startTs, endTs, raw, openStart }]
//   · 只认**同一行内**的窗口（textOf 已把 <br> 变成 \n）——实测 GF2 的窗口都不跨行
//   · 单日期（如「补偿有效期：2026年9月28日23:59:59」）不构成窗口 → 不产出（不硬凑区间）
function ns_gf2_parseGf2Windows(text, tz = ns_gf2_GF2_TZ, dateHint = null) {
	const out = [];
	const lines = String(text == null ? "" : text).split("\n");
	let lastHeader = "";
	for (const lineRaw of lines) {
		const line = String(lineRaw);
		if (!line.trim()) continue;
		const toks = [];
		ns_gf2_GF2_TOKEN.lastIndex = 0;
		let m;
		while ((m = ns_gf2_GF2_TOKEN.exec(line)) !== null) {
			toks.push({
				date: m[1] ? { y: +m[1], mo: +m[2], d: +m[3] } : null,
				time: m[4] != null ? { h: +m[4], mi: +m[5], s: m[6] != null ? +m[6] : 0 } : null,
				phrase: m[7] || null,
				sep: m[8] || null,
				at: m.index,
				end: m.index + m[0].length
			});
			if (m[0] === "") ns_gf2_GF2_TOKEN.lastIndex++;   // 保险：零宽匹配不吞死循环
		}
		let i = 0;
		while (i < toks.length) {
			const t0 = toks[i];
			if (!t0.date) { i++; continue; }
			let j = i + 1;
			let startTime = null, startPhrase = null;
			if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { startPhrase = toks[j].phrase; j++; }
			if (!(toks[j] && toks[j].sep)) { i++; continue; }
			j++;
			let endDate = null, endTime = null, endPhrase = null;
			if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
			if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { endPhrase = toks[j].phrase; j++; }
			if (!endDate && !endTime && !endPhrase) { i++; continue; }

			const y1 = t0.date.y, mo1 = t0.date.mo, d1 = t0.date.d;
			// 末段没写日期（同日窗口，如 `09:00~12:00`）→ 日期同起点。
			// 注意：GF2 的日期令牌**必带年**（没有「9月22日」这种裸写法），所以 endDate 一定有 y。
			const eD = endDate || { y: y1, mo: mo1, d: d1 };
			const y2 = eD.y, mo2 = eD.mo, d2 = eD.d;

			// 起点时分
			let h1 = 0, mi1 = 0;
			if (startTime) { h1 = startTime.h; mi1 = startTime.mi; }
			else if (startPhrase) {
				const r = ns_gf2_resolvePhrase(startPhrase, dateHint, tz, y1, mo1, d1);
				if (!r) { i++; continue; }          // 短语无法定日 → 跳过，不猜
				h1 = r.h; mi1 = r.mi;
			}
			// 终点时分
			let h2 = 23, mi2 = 59;
			if (endTime) { h2 = endTime.h; mi2 = endTime.mi; }
			else if (endPhrase) {
				const r = ns_gf2_resolvePhrase(endPhrase, dateHint, tz, y2, mo2, d2);
				if (!r) { i++; continue; }
				h2 = r.h; mi2 = r.mi;
			}

			const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			if (!(endTs > startTs)) { i++; continue; }
			const pre = line.slice(0, t0.at);
			let label = pre.replace(/[\s\u00a0]+/g, "").replace(/[:：]+$/, "");
			// 行内标签过长（说明这行是正文句子而非「XX时间：」标签）→ 不用它
			if (label.length > 12) label = "";
			if (!label) label = lastHeader;
			out.push({
				label,
				startTs,
				endTs,
				raw: line.slice(t0.at, toks[j - 1].end).trim(),
				openStart: !!startPhrase
			});
			i++;
		}
		// 记忆「上一行是短标签行」（如单独一行的 `活动时间：`）→ 供下一行的窗口当 label。
		// 只认以「时间/日程/期间/期限/范围」结尾且不含数字的短行，避免把 `尊敬的指挥官：`
		// 这种称呼行当成标签（实测踩到：2142 的维护窗口被标成"尊敬的指挥官"）。
		const cleaned = line.replace(/[\s\u00a0★☆※]+/g, "");
		if (cleaned && /[:：]$/.test(cleaned) && cleaned.length <= 12) {
			const cand = cleaned.replace(/[:：]+$/, "");
			if (!/\d/.test(cand) && /(时间|日程|期间|期限|范围)$/.test(cand)) lastHeader = cand;
		}
	}
	return out;
}

// 卡池公告正文里的 UP 对象（人形）→ roles
function ns_gf2_parseGf2Roles(contentHtml) {
	const t = textOf(contentHtml);
	const a = t.indexOf("本期概率UP对象");
	const b = t.indexOf("访问说明");
	const scope = a >= 0 ? t.slice(a, b > a ? b : undefined) : t;
	const names = [];
	for (const m of scope.matchAll(/■\s*(?:精英|标准|旧式)?人形[「【]([^」】]{1,20})[」】]/g)) {
		const n = m[1].trim();
		if (n && !names.includes(n)) names.push(n);
	}
	return names.join("、");
}

function ns_gf2_cleanTitle(t) {
	return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

// 选当期窗口：优先「覆盖 now」的（越快结束越该被盯住，与插件 selectCurrent 同口径），
// 其次未来最近要开的，最后退化为结束最晚的。
function ns_gf2_selectGf2Window(wins, now) {
	const list = Array.isArray(wins) ? wins : [];
	if (!list.length) return null;
	const covering = list.filter((w) => w.startTs <= now && w.endTs >= now);
	if (covering.length) return covering.slice().sort((a, b) => a.endTs - b.endTs)[0];
	const future = list.filter((w) => w.startTs > now).sort((a, b) => a.startTs - b.startTs);
	if (future.length) return future[0];
	return list.slice().sort((a, b) => b.endTs - a.endTs)[0];
}

// ── 卡池侧 ──
// 取 typeId=4 列表 → 过滤卡池类公告（概率UP/采购/军备提升）→ 详情 → 抽窗口。
// 逐条最多试 3 条（一般第 1 条就命中），避免为了容错把请求数放大。
async function ns_gf2_gachaGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_GACHA_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const pools = list.filter((x) => ns_gf2_GF2_POOL_RE.test(x.title));
	const ordered = (pools.length ? pools : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	return ns_gf2_firstWorking(ordered.slice(0, 3), async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		return {
			banner: ns_gf2_cleanTitle(it.title),
			roles: ns_gf2_parseGf2Roles(d.Content || ""),
			bannerDates: fmtWindow(w.startTs, w.endTs, tz),
			bannerDatesRaw: w.raw,
			startTs: w.startTs,
			endTs: w.endTs
		};
	});
}

// ── 活动侧 ──
// typeId=3 = 官方公告栏目。GF2 **没有独立的「活动一览」**：
//   · 版本更新公告给出的时间窗口是「维护时间：2026年9月22日09:00~12:00」（版本开服窗口）
//   · 主题大活动的窗口（如【静默突触】2026年9月22日 版本更新后~2026年11月3日 08:59）
//     落在 typeId=4 里，不在 typeId=3。
// 本侧按任务书给定的 URL（typeId=3）取**最新版本更新公告**，外显其维护窗口；
// 公告正文里所有可解析窗口逐行进 eventHover 如实交代。已知语义弱点：维护窗口只有几小时，
// 不等于「活动周期」——这是源站该栏目本身的形态，报告里已注明（不硬造活动区间）。
async function ns_gf2_eventsGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_EVENT_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const byId = list.slice().sort((a, b) => b.id - a.id);
	const versions = byId.filter((x) => ns_gf2_GF2_VERSION_RE.test(x.title));
	const ordered = (versions.length ? versions : byId).slice(0, 3);
	const now = Date.now();
	return ns_gf2_firstWorking(ordered, async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		const hover = wins
			.slice()
			.sort((a, b) => a.endTs - b.endTs)
			.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}${x.label ? `   ${x.label}` : ""}`)
			.join("\n");
		return {
			event: ns_gf2_cleanTitle(it.title),
			eventDates: fmtWindow(w.startTs, w.endTs, tz),
			eventDatesRaw: w.raw,
			eventHover: hover
		};
	});
}

		// ===== 内联自 next-sources/parsers/bandori.js（模块级标识符已加 ns_bandori_ 前缀）=====

// next-sources/parsers/bandori.js —— BanG Dream! 少女乐团派对 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/bandori-list、bandori-detail-18418）──
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20
//   → { code:0, totalNum:2815, data:[{ id, title, ctime, mtime, content, displayTime?, typeId, … }] }
//   ⚠️ 两个实测坑（任务书已提示，夹具再次证实）：
//     ① 列表里的 `content` 是**截断的**（末尾 `…`）→ 正文必须抓详情 /news/{id}
//     ② **返回顺序非严格倒序**：page 1 的头两条是 2019 年的常驻置顶公告
//        （概率公示 / 公平运营声明），后面才是 2026 年的倒序块
//        → 必须按 `displayTime || ctime` 自行排序，不能信数组顺序
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, code:0, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, … } }
//
// ── 公告正文的实际结构（两侧都从这里抽）──────────────────────────────────
// 一期公告用 `活动一、`…`活动八、` 分节，每节形如：
//     活动二、「黄金周纪念·前篇Dream＆KIRAMEKI Festival招募」开启！
//     ★招募日程★
//     9月29日维护后~10月11日12:59
//     …
//     ※可招募时间：9月29日维护后~10月16日12:59      ← 节内补充窗口（挂到 hover）
// 所以：
//   · 卡池侧 = 名字含「招募」且**非**免费/确定/StepUp 类的那一节（活动二）→ 主窗口 + ★5 名单当 roles
//   · 活动侧 = 名字不含「招募」的那一节（活动一「…」挑战演出活动）→ 主窗口
//   · 每一节的**主窗口**只取 `★…日程★`/`★…时间★` 之后的第一条窗口行（节内补充窗口不算主窗口）
//     —— 否则同节多条窗口会让「选当期」随系统时间漂移，测试也不可复现。
//   · `维护后`（起点无具体时刻）用该公告 `displayTime` 的时刻补齐（实测 18418：
//     displayTime=2026-09-29 10:00:00，正文「9月29日维护后」= 10:00，与 Bestdori CN startAt 吻合）。
//
// ── 时区 UTC+8（Asia/Shanghai）**已交叉验证** ─────────────────────────────
//   任务书给的交叉证据：官方 displayTime=2026-09-29 10:00 ↔ Bestdori CN startAt=2026-09-29 02:00Z
//   （= 10:00+08）。本条是硬证据，非推测。


const ns_bandori_BANDORI_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20";
const ns_bandori_BANDORI_TZ = "Asia/Shanghai";
const ns_bandori_BANDORI_HOME = "https://www.biligame.com/detail/?id=138";

// lib/env.js 的 decodeEntities 只覆盖了少量实体，公告正文里高频出现的
// `&middot;` / `&times;` / `&hellip;` / `&sup2;` 需要本地补齐（不改 lib/）。
const ns_bandori_ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
	sup2: "²", sup3: "³", deg: "°", ensp: " ", emsp: " ", thinsp: " ",
	bull: "•", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»"
};
function ns_bandori_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_bandori_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
// 公告 HTML → 纯文本（先补实体再走 textOf，保证 &middot; 这类不残留）
function ns_bandori_plain(html) { return ns_bandori_decodeExtra(textOf(html)); }
// 标题（WP/REST 的 title 可能是对象；这里统一取字符串）
function ns_bandori_bandoriTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return ns_bandori_decodeExtra(t.rendered || "");
	return ns_bandori_decodeExtra(t || "");
}

// ── 列表解析 ──
function ns_bandori_parseBandoriList(json) {
	if (!json || typeof json !== "object") throw new Error("bandori-bad-json");
	if (json.code !== 0) throw new Error("bandori-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("bandori-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => ({
			id: x.id,
			title: ns_bandori_bandoriTitle(x),
			displayTime: x.displayTime || "",
			ctime: x.ctime || "",
			mtime: x.mtime || "",
			// 排序用的"生效时刻"：优先 displayTime（= 维护后开服时刻），退 ctime
			sortKey: String(x.displayTime || x.ctime || ""),
			dateTs: ns_bandori_parseBandoriDate(x.displayTime || x.ctime)
		}))
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}

// "2026-09-29 10:00:00" → 绝对毫秒（按 tz 解释源站墙钟）
function ns_bandori_parseBandoriDate(s, tz = ns_bandori_BANDORI_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_bandori_bandoriDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_bandori_BANDORI_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

// ── 窗口行 ──
// 整行匹配（前后不允许有别的文字）——实测这样刚好滤掉正文里大量
// 「9月29日维护后，《MATSURI BAYASHI》将上架…」这类**带尾巴**的日期句，
// 以及「本期也将开启限时招募券任务（9月29日 维护后～10月14日 22:59）！」这类括注。
const ns_bandori_WIN_LINE = /^[※☆★\s]*((?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*(?:更新维护后|维护后|\d{1,2}:\d{2})?)\s*[~～]\s*((?:(?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*)?(?:更新维护后|维护后|\d{1,2}:\d{2}))\s*[！!。]?\s*$/;
const ns_bandori_HALF = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(更新维护后|维护后)?(?:\s*(\d{1,2}):(\d{2}))?$/;

// 单侧（起点或终点）→ { mo, d, phrase, h, mi }；解析不出 → null
function ns_bandori_parseHalf(s) {
	const m = ns_bandori_HALF.exec(String(s || "").trim());
	if (!m) return null;
	return {
		y: m[1] ? +m[1] : null,
		mo: +m[2], d: +m[3],
		phrase: m[4] || null,
		h: m[5] != null ? +m[5] : null,
		mi: m[6] != null ? +m[6] : null
	};
}

// 一条窗口行 → { startTs, endTs, raw }；短语起点用 hint（公告 displayTime）补时刻
function ns_bandori_parseBandoriWindow(line, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const m = ns_bandori_WIN_LINE.exec(String(line || "").trim());
	if (!m) return null;
	const a = ns_bandori_parseHalf(m[1]), b = ns_bandori_parseHalf(m[2]);
	if (!a || !b) return null;
	// 年份：源站只写「9月29日」→ 取公告年份（hint）；跨年时末段 +1
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	const y1 = a.y != null ? a.y : (hintParts ? hintParts.y : null);
	if (y1 == null) return null;
	let y2 = b.y != null ? b.y : y1;
	if (b.y == null && (b.mo < a.mo || (b.mo === a.mo && b.d < a.d))) y2 = y1 + 1;

	let h1 = a.h, mi1 = a.mi;
	if (h1 == null) {
		if (!a.phrase || !hintParts) return null;           // 起点不明又不给 hint → 不猜
		h1 = hintParts.h; mi1 = hintParts.mi;
	}
	if (mi1 == null) mi1 = 0;
	let h2 = b.h, mi2 = b.mi;
	if (h2 == null) {
		if (!b.phrase || !hintParts) return null;
		h2 = hintParts.h; mi2 = hintParts.mi;
	}
	if (mi2 == null) mi2 = 0;

	const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
	const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: String(line).trim() };
}

// ── 正文分节 ──
// 返回 [{ name, quote, windows:[{…}], primary }]
//   · name  = 「活动二、…」里的整段
//   · quote = name 里第一个「…」内的名字（外显用，比整段干净）
//   · primary = 节内第一条「★…日程★/★…时间★」表头之后的窗口；没有表头则取该节第一条窗口
function ns_bandori_parseBandoriSections(text, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim()).filter(Boolean);
	const sections = [];
	let cur = null;
	let expectWindow = false;      // 上一条是 ★…日程★ 类表头 → 下一条窗口即主窗口
	for (const line of lines) {
		const sec = /^活动\s*[一二三四五六七八九十百\d]+\s*、\s*([\s\S]+)$/.exec(line);
		if (sec) {
			cur = { name: sec[1].trim(), quote: "", windows: [], primary: null };
			const q = /[「【]([^」】]+)[」】]/.exec(cur.name);
			cur.quote = q ? q[1].trim() : "";
			sections.push(cur);
			expectWindow = false;
			continue;
		}
		if (/^[★☆※\s]*(活动日程|招募日程|活动时间|招募时间|举办日程|开展时间|日程)[★☆※\s]*$/.test(line)) {
			expectWindow = true;
			continue;
		}
		const w = ns_bandori_parseBandoriWindow(line, tz, hint);
		if (w) {
			if (cur) {
				cur.windows.push(w);
				if (cur.primary == null && expectWindow) cur.primary = w;
			}
			expectWindow = false;
			continue;
		}
		if (line.length > 14) expectWindow = false;   // 长正文行打断"表头→窗口"的邻接关系
	}
	for (const s of sections) if (s.primary == null && s.windows.length) s.primary = s.windows[0];
	return sections;
}

// 卡池节 = 名字含「招募」；主卡池节 = 再排除免费/确定/StepUp 这类派生池
const ns_bandori_GACHA_SEC_RE = /招募/;
const ns_bandori_GACHA_SIDE_RE = /免费|無料|确定|確定|初次|Step\s*up|StepUp|1日1次|每日|一日一次/i;

function ns_bandori_pickBandoriGachaSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && ns_bandori_GACHA_SEC_RE.test(s.name));
	if (!pool.length) return null;
	const main = pool.filter((s) => !ns_bandori_GACHA_SIDE_RE.test(s.name));
	return (main.length ? main : pool)[0];
}
function ns_bandori_pickBandoriEventSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name) && /活动/.test(s.name));
	if (pool.length) return pool[0];
	return (sections || []).find((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name)) || null;
}

// 节内 ★5 名单 → roles（实测形态：`★5 丸山彩[镜中无法映照的手中]`、`★5 CHU² [这样的休假方式]`）
function ns_bandori_bandoriRolesFromSection(text, section) {
	if (!section) return "";
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim());
	const startIdx = lines.findIndex((l) => l.startsWith(`活动`) && l.includes(section.name));
	if (startIdx < 0) return "";
	const names = [];
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (/^活动\s*[一二三四五六七八九十百\d]+\s*、/.test(lines[i])) break;
		const m = /^★\s*5\s*(.+?)\s*[\[［]/.exec(lines[i]);
		if (m) {
			const n = m[1].replace(/[&][a-z0-9]+;/gi, "").trim();
			if (n && !names.includes(n)) names.push(n);
		}
	}
	return names.join("、");
}

// ── 取一期公告：列表倒序 → 逐条抓详情 → 用 selector 挑第一个"可用"的 ──
// 单条详情失败（网络/404）不整体崩，继续下一条；**全部失败则抛第一个错误**
// （不能把"源站挂了"静默降级成"未公布"）。
async function ns_bandori_loadAnnouncement(listUrl, signal, selector, limit = 5) {
	const list = ns_bandori_parseBandoriList(await fetchJson(listUrl, { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null;
	for (const it of list.slice(0, limit)) {
		try {
			const detail = await fetchJson(ns_bandori_bandoriDetailUrl(listUrl, it.id), { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			const text = ns_bandori_plain(d.content);
			const hint = ns_bandori_parseBandoriDate(d.displayTime || d.mtime || it.displayTime || it.ctime) || it.dateTs;
			const sections = ns_bandori_parseBandoriSections(text, ns_bandori_BANDORI_TZ, hint);
			const picked = selector(sections);
			if (!picked) continue;
			return { item: it, data: d, text, hint, sections, picked };
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// ── 卡池侧 ──
async function ns_bandori_gachaBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriGachaSection);
	if (!a) return null;
	const w = a.picked.primary;
	const banner = a.picked.quote || a.picked.name;
	return {
		banner,
		roles: ns_bandori_bandoriRolesFromSection(a.text, a.picked),
		bannerDates: fmtWindow(w.startTs, w.endTs, tz),
		bannerDatesRaw: w.raw,
		startTs: w.startTs,
		endTs: w.endTs
	};
}

// ── 活动侧 ──
// 同源同一份公告：外显取"挑战演出活动"那一节，hover 列出该公告全部节的窗口
// （含卡池节，并附节名），这样悬停能看到这一期一起开的全部档期。
async function ns_bandori_eventsBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriEventSection);
	if (!a) return null;
	const w = a.picked.primary;
	const lines = [];
	for (const s of a.sections) {
		if (!s.primary) continue;
		lines.push(`${fmtWindow(s.primary.startTs, s.primary.endTs, tz)}   ${s.quote || s.name}`);
	}
	return {
		event: a.picked.quote || ns_bandori_bandoriTitle(a.item) || a.picked.name,
		eventDates: fmtWindow(w.startTs, w.endTs, tz),
		eventDatesRaw: w.raw,
		eventHover: lines.join("\n")
	};
}

		// ===== 内联自 next-sources/parsers/ournotes.js（模块级标识符已加 ns_ournotes_ 前缀）=====

// next-sources/parsers/ournotes.js —— BanG Dream! OurNotes 日服（bushimo 官方 WordPress REST）
//
// 契约：async (url, signal, tz) → { event, eventDates, eventDatesRaw?, eventHover? } | null
//   本来源**只有活动/公告侧单侧**（没有卡池专用源）——按任务书只写 event 侧。
//
// ── 可直连（mode="direct"）──────────────────────────────────────────────────
//   调研实测 `https://bang-dream-on.bushimo.jp` 的 ACAO **回显 Origin**
//   → 是环境里仅有的三个可直接 fetch 的源之一（另两个是 api.umapyoi.net / sekai-world.github.io）。
//   注意：registry 里声明的 mode 与这里 fetchJson 传的 mode **必须一致**。
//
// ── 实测形态（2026-10-01/02 抓夹具 fixtures/ournotes-list）──────────────────
// 列表：GET /wp-json/wp/v2/posts?per_page=20&page=1
//   → 标准 WP REST 数组，每项 { id, date, date_gmt, link, title{rendered}, excerpt{rendered}, content{rendered}, … }
//   ⚠️ **不能加 `_fields=id,date,date_gmt,link,title` 裁剪**（任务书给的省流写法）：
//      活动区间藏在 `excerpt`/`content` 里，只取 title/date 就只剩"公告发布时刻"，
//      拿不到任何「举办期间」。夹具实测：288 的活动区间 `2026年9月24日(木)～10月28日(水)14:59`
//      只出现在 content 里，excerpt 里没有。
//   ⚠️ 这是**新游戏**：全站只有 11 篇公告（2026-01 建站 → 2026-09），
//      其中只有 6 篇带日期区间，属正常状态，不是抓取失败。
//
// ── 时区 Asia/Tokyo（**实测**，非推测）──────────────────────────────────────
//   逐条比对 `date` 与 `date_gmt`：全部相差 **9 小时**
//   （例：id=389 `date=2026-09-21T16:30:30` / `date_gmt=2026-09-21T07:30:30`）→ JST=UTC+9。
//
// ── 取值策略 ────────────────────────────────────────────────────────────────
//   公告不是排期表：一篇公告里可能完全没有日期（如 id=389「動作環境について」），
//   也可能有多个不相干的区间（直播时刻、展会日程、活动期间）。
//   所以：① 按 date_gmt 倒序遍历公告；② 从 title+excerpt+content 抽「日期[时刻]～日期[时刻]」区间；
//        ③ 外显取**第一条覆盖当前时刻**的区间（没有则取最新一篇的第一条区间）；
//        ④ hover 逐行列出所有覆盖当前的区间（附所属公告标题）。
//   只给"一个日期"的句子（「9月24日(木)に決定しました！」）**不算区间** → 不产出，不硬凑。


const ns_ournotes_OURNOTES_LIST_URL = "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1";
const ns_ournotes_OURNOTES_TZ = "Asia/Tokyo";

// lib/env.js 的 decodeEntities 未覆盖的常见实体（公告里 `&hellip;` 之类）
const ns_ournotes_ENT_EXTRA = { hellip: "…", middot: "·", times: "×", mdash: "—", ndash: "–", nbsp: " ", amp: "&", quot: '"', apos: "'" };
function ns_ournotes_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_ournotes_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_ournotes_plain(html) { return ns_ournotes_decodeExtra(textOf(html)); }
function ns_ournotes_ournotesTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return ns_ournotes_decodeExtra(t.rendered || "").replace(/\s+/g, " ").trim();
	return ns_ournotes_decodeExtra(t || "").replace(/\s+/g, " ").trim();
}

// ── 日文日期区间令牌 ──
// 令牌化而不是一条大正则：日文公告里「年」可省、「月」在末段可省（`10月17日(土)・18日(日)`）、
// 时刻可省、分隔符有 `～`/`〜`/`~`/`・` 多种 —— 用一条正则的可选组会互相吃掉，走令牌清楚得多。
//   DATE：年?(可选) 月?(可选) 日 + 可选 (曜日)
//   TIME：HH:MM（全角冒号也算）
//   SEP ：~ ～ 〜 〰 － - – — ・
const ns_ournotes_JP_TOKEN = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,6}[）)])?|(\d{1,2})\s*[:：]\s*(\d{2})|([~\uff5e\u301c\u3030\uff0d\-\u2013\u2014]|・)/g;

// 从一段文本抽区间。返回 [{ startTs, endTs, raw }]（同 raw 去重）
//   起点**必须**带月份（防止把「5日連続」「30日間」这类裸"日"当窗口起点）
//   末段可省"月"（`・18日(日)`）→ 月份取起点月，日小于起点日则进一个月
//   末段缺时刻 → 全天（00:00 / 23:59）；起点缺时刻 → 00:00
function ns_ournotes_parseOurNotesWindows(text, tz = ns_ournotes_OURNOTES_TZ, hint = null) {
	const out = [];
	const seen = new Set();
	const s = String(text == null ? "" : text);
	ns_ournotes_JP_TOKEN.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_ournotes_JP_TOKEN.exec(s)) !== null) {
		toks.push({
			date: m[3] != null ? { y: m[1] ? +m[1] : null, mo: m[2] != null ? +m[2] : null, d: +m[3] } : null,
			time: m[4] != null ? { h: +m[4], mi: +m[5] } : null,
			sep: m[6] || null,
			at: m.index,
			end: m.index + m[0].length
		});
		if (m[0] === "") ns_ournotes_JP_TOKEN.lastIndex++;
	}
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	let i = 0;
	while (i < toks.length) {
		const t0 = toks[i];
		if (!t0.date || t0.date.mo == null) { i++; continue; }
		let j = i + 1;
		let startTime = null;
		if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
		if (!(toks[j] && toks[j].sep)) { i++; continue; }
		j++;
		let endDate = null, endTime = null;
		if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
		if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
		if (!endDate && !endTime) { i++; continue; }

		// 年份：源站常只写月日 → 取公告年份
		const y1 = t0.date.y != null ? t0.date.y : (hintParts ? hintParts.y : null);
		if (y1 == null) { i++; continue; }
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo != null ? endDate.mo : t0.date.mo;
			d2 = endDate.d;
			y2 = endDate.y != null ? endDate.y : y1;
			if (endDate.y == null) {
				if (mo2 < t0.date.mo || (mo2 === t0.date.mo && d2 < t0.date.d)) {
					// 末段只写「日」且比起点日小 → 视为下一个月
					if (endDate.mo == null) { mo2 = t0.date.mo + 1; if (mo2 > 12) { mo2 = 1; y2 = y1 + 1; } }
					else y2 = y1 + 1;
				}
			}
		} else {
			mo2 = t0.date.mo; d2 = t0.date.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, t0.date.mo, t0.date.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) { i++; continue; }
		const raw = s.slice(t0.at, toks[j - 1].end).trim();
		if (!seen.has(raw)) { seen.add(raw); out.push({ startTs, endTs, raw }); }
		i++;
	}
	return out;
}

// ── 公告集合 → [{ id, title, dateTs, windows }]（按 date_gmt 倒序）──
function ns_ournotes_parseOurNotesPosts(json, tz = ns_ournotes_OURNOTES_TZ) {
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	return json
		.filter((p) => p && p.id != null)
		.map((p) => {
			const hint = ns_ournotes_parseOurNotesInstant(p.date, tz);
			const hay = [
				ns_ournotes_ournotesTitle(p),
				ns_ournotes_plain(p.excerpt && p.excerpt.rendered),
				ns_ournotes_plain(p.content && p.content.rendered)
			].join("\n");
			return {
				id: p.id,
				title: ns_ournotes_ournotesTitle(p),
				dateText: p.date || "",
				dateTs: hint,
				windows: ns_ournotes_parseOurNotesWindows(hay, tz, hint)
			};
		})
		.sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

// WP 的 `date` 是**源站本地时间且不带时区后缀**（"2026-09-21T16:30:30"）→ 按 tz 解释为墙钟
function ns_ournotes_parseOurNotesInstant(s, tz = ns_ournotes_OURNOTES_TZ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

// 外显挑选：第一条"覆盖当前时刻"的区间（按公告倒序、区间原序）；都没有则取最新一篇的第一条区间
function ns_ournotes_selectOurNotesPrimary(entries, now) {
	const list = Array.isArray(entries) ? entries : [];
	for (const p of list) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) return { post: p, win: w };
	for (const p of list) if (p.windows.length) return { post: p, win: p.windows[0] };
	return null;
}

// ── 抓取器（活动侧单侧）──
async function ns_ournotes_eventsOurNotes(url, signal, tz = ns_ournotes_OURNOTES_TZ) {
	const listUrl = url || ns_ournotes_OURNOTES_LIST_URL;
	// mode 必须与 registry-<batch>.js 里声明的 "direct" 一致（本目录只有 3 个源可直连）
	const json = await fetchJson(listUrl, { signal, mode: "direct" });
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	if (json.length === 0) return null;
	const posts = ns_ournotes_parseOurNotesPosts(json, tz);
	const now = Date.now();
	const picked = ns_ournotes_selectOurNotesPrimary(posts, now);
	if (!picked || !picked.win) return null;
	const active = [];
	for (const p of posts) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) active.push({ p, w });
	const hoverLines = (active.length ? active : [picked]).map(({ p, w }) => `${fmtWindow(w.startTs, w.endTs, tz)}   ${p.title}`);
	return {
		event: picked.post.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		eventHover: hoverLines.join("\n")
	};
}

		// ===== 内联自 next-sources/parsers/fgo.js（模块级标识符已加 ns_fgo_ 前缀）=====

// next-sources/parsers/fgo.js —— FGO 国服 · fgo.wiki（MediaWiki 1.43.9 + SemanticMediaWiki）
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
	const covering = rows.filter((r) => r.startTs <= now && r.endTs >= now);
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
function ns_fgo_parseFgoBannerTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const tables = ns_fgo_fgoTables(html);
	if (!tables.length) throw new Error("fgo-no-table");
	const tb = tables.find((t) => /国服当前卡池/.test(stripTags(ns_fgo_rowsOf(t.html)[0] || "")));
	if (!tb) throw new Error("fgo-no-current-banner-table");
	const rows = [];
	let openCount = 0;
	for (const r of ns_fgo_rowsOf(tb.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 2 || ns_fgo_isHeaderRow(cells)) continue;
		const name = stripTags(cells[0]).replace(/\s+/g, " ").trim();
		const w = ns_fgo_parseFgoWindow(stripTags(cells[1]), tz);
		if (!name || !w) continue;
		openCount++;
		let roles = cells.length > 2 ? stripTags(cells[2]).replace(/\s+/g, " ").trim() : "";
		// wiki 在"推荐召唤从者>15 骑"时用一行占位提示顶替名单 → 不把它当角色名
		if (/请前往|大于15|详见|Template:/.test(roles)) roles = "";
		rows.push({ banner: name, roles, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return null;
	return { ...best, openCount };
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
	// 悬停：只列**覆盖当前时刻**的行（该年的表含全年 57 行，全列会淹没当期；按结束时间升序）
	const active = rows
		.filter((x) => x.startTs <= now && x.endTs >= now)
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs));
	const hover = active
		.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}${x.type ? `   ${x.type}` : ""}   ${x.name}`)
		.join("\n");
	return {
		year: found.year,
		rows,
		skipped,
		activeCount: active.length,
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		eventHover: hover
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
		endTs: r.endTs
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
		eventHover: r.eventHover
	};
}

		// ===== 追加来源进 SOURCES =====

		const NS_SOURCES = [

			{
				id: "p5x",
				tz: "Asia/Shanghai",
				name: "P5X 国服（女神异闻录：夜幕魅影）",
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "official-html",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "official-html",
			},

			{
				id: "uma-jp-umapyoi",
				tz: "Asia/Tokyo",
				name: "赛马娘 日服（umapyoi）",
				url: "https://api.umapyoi.net/api/v1/gacha",
				source: "third-party",
			},

			{
				id: "bandori-bestdori",
				tz: "Asia/Shanghai",
				name: "BanG Dream! 国服（Bestdori）",
				url: "https://bestdori.com/api/gacha/all.5.json",
				source: "third-party",
				eventUrl: "https://bestdori.com/api/events/all.5.json",
				eventSource: "third-party",
			},

			{
				id: "pjsk",
				tz: "Asia/Shanghai",
				name: "PJSK 缤纷舞台（sekai-master-db cn-diff）",
				url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
				source: "third-party",
				eventUrl: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
				eventSource: "third-party",
			},

			{
				id: "wuhuamixin",
				tz: "Asia/Shanghai",
				name: "物华弥新 国服（bwiki）",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "wiki",
				eventUrl: "https://wiki.biligame.com/whmx/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2",
				eventSource: "wiki",
			},

			{
				id: "uma-cn",
				tz: "Asia/Shanghai",
				name: "闪耀优俊少女 国服（bwiki，简中卡池）",
				url: "https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2",
				source: "wiki",
			},

			{
				id: "uma-jp-bwiki",
				tz: "Asia/Tokyo",
				name: "赛马娘 日服（bwiki 活动侧）",
				eventUrl: "https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2",
				eventSource: "wiki",
			},

			{
				id: "zspms",
				tz: "Asia/Shanghai",
				name: "战双帕弥什 国服（bwiki 研发记录）",
				url: "https://wiki.biligame.com/zspms/api.php?action=parse&page=研发记录&prop=text&format=json&formatversion=2",
				source: "wiki",
			},

			{
				id: "kedrgame",
				tz: "Asia/Shanghai",
				name: "雪松（bwiki 卡池信息）",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2",
				source: "wiki",
			},

			{
				id: "czn",
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境 国服（bwiki 卡池记录）",
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=卡池记录&prop=text&format=json&formatversion=2",
				source: "wiki",
			},

			{
				id: "stellasora",
				tz: "Asia/Shanghai",
				name: "星塔旅人 国服（bwiki 首页·活动日历）",
				eventUrl: "https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2",
				eventSource: "wiki",
			},

			{
				id: "gf2",
				tz: "Asia/Shanghai",
				name: "少女前线2：追放 国服",
				url: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				source: "official-api",
				eventUrl: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/3?page=1&limit=10",
				eventSource: "official-api",
			},

			{
				id: "bandori",
				tz: "Asia/Shanghai",
				name: "BanG Dream! 少女乐团派对 国服 · 官方公告",
				url: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				source: "official-api",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				eventSource: "official-api",
			},

			{
				id: "ournotes",
				tz: "Asia/Tokyo",
				name: "BanG Dream! OurNotes 日服 · 官方公告",
				eventUrl: "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1",
				eventSource: "official-api",
			},

			{
				id: "fgo",
				tz: "Asia/Shanghai",
				name: "Fate/Grand Order 国服 · fgo.wiki",
				url: "https://fgo.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				source: "wiki",
				eventUrl: "https://fgo.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "wiki",
			},

		];

		for (const s of NS_SOURCES) SOURCES.push(s);

		// ===== 注册抓取器（函数名取自 next-sources 真实导出，已加前缀）=====

		Object.assign(GACHA_FETCHERS, {

			"p5x": (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz),

			"uma-jp-umapyoi": (url, signal, tz) => ns_umapyoi_gachaUmapyoi(url, signal, tz),

			"bandori-bestdori": (url, signal, tz) => ns_bestdori_gachaBestdori(url, signal, tz),

			"pjsk": (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz),

			"wuhuamixin": (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz),

			"uma-cn": (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz),

			"zspms": (url, signal, tz) => ns_bwiki_gachaZspms(url, signal, tz),

			"kedrgame": (url, signal, tz) => ns_bwiki_gachaKedr(url, signal, tz),

			"czn": (url, signal, tz) => ns_bwiki_gachaCzn(url, signal, tz),

			"gf2": (url, signal, tz) => ns_gf2_gachaGf2(url, signal, tz),

			"bandori": (url, signal, tz) => ns_bandori_gachaBandori(url, signal, tz),

			"fgo": (url, signal, tz) => ns_fgo_gachaFgo(url, signal, tz),

		});

		Object.assign(EVENT_FETCHERS, {

			"p5x": { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) },

			"bandori-bestdori": { default: (url, signal, tz) => ns_bestdori_eventsBestdori(url, signal, tz) },

			"pjsk": { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) },

			"wuhuamixin": { default: (url, signal, tz) => ns_bwiki_eventsWhmx(url, signal, tz) },

			"uma-jp-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsUmaJp(url, signal, tz) },

			"stellasora": { default: (url, signal, tz) => ns_bwiki_eventsStellasora(url, signal, tz) },

			"gf2": { default: (url, signal, tz) => ns_gf2_eventsGf2(url, signal, tz) },

			"bandori": { default: (url, signal, tz) => ns_bandori_eventsBandori(url, signal, tz) },

			"ournotes": { default: (url, signal, tz) => ns_ournotes_eventsOurNotes(url, signal, tz) },

			"fgo": { default: (url, signal, tz) => ns_fgo_eventsFgo(url, signal, tz) },

		});

		//#endregion
