// src/client/35-parsers-bwiki.js
//
// 由 next-sources/parsers/bwiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bwiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bwiki.js —— 批次 B2：bwiki（MediaWiki api.php）来源
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
