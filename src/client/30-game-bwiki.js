// src/client/30-game-bwiki.js —— bwiki 系（物华弥新 / 战双 / 卡厄斯 / 雪松）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-bwiki.js 的内容（原样保留）══
// src/client/42-parsers-bwiki.js —— bwiki wiki 页系（物华弥新 / 战双 / 卡厄斯 / 雪松 + 4 个备选源）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-bwiki.js                物华弥新 + 4 个 bwiki 备选源（kedr-kaxi / uma-cn-bwiki / uma-jp-bwiki / stellasora-bwiki）
//      · 42-parsers-bwiki-wikitext.js       战双（SMW ask + 公告）/ 卡厄斯（Lua 模块）/ 雪松（模板）
//      · 42-parsers-kedr-wiki.js            雪松 wiki 页解析工具（生产已改走 bwiki-wikitext；本文件供回归测试）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bwiki.js
// ─────────────────────────────────────────────────────────────────────────────
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
			y = lastMo != null && mo < lastMo - YEAR_HINT_MONTH_GAP ? lastY + 1 : lastY;   // 跨年（12月 → 1月）
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
function ns_bwiki_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : nowMs(); }

// 覆盖 now 的条目：结束在未来且已开始（起点未知的行按"已开始"处理）
function ns_bwiki_activeItems(items, now) {
	return items.filter((it) => coversNow(it, now));
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
// ⚠️ 2026-10-03 删掉了本文件自带的三个重复实现：`ns_bwiki_permanentLine` / `ns_bwiki_buildPoolHover` /
//    `ns_bwiki_buildEventHover`。它们与共用工具 `hoverPermanentLine` / `hoverPool` / `hoverEvent`
//    是同一套排版（措辞逐字相同），且卡池那份**少了按结束时间排序**（本体 buildPoolHover 会排）——
//    属于"同一条规则的第二份实现"。本文件只剩 4 个**备选源**仍在用（uma-cn-bwiki / kedr-kaxi /
//    uma-jp-bwiki / stellasora-bwiki），它们此前没被方案 A 的悬停审计覆盖到，所以漏改了。
function ns_bwiki_gachaPayload(items, tz, now) {
	const cur = ns_bwiki_pickCurrentPool(items, now);
	if (!cur) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const first = cur.first;
	// 池名与本体同构：有角色名 →「池名：角色」，没有 → 只写池名
	const hover = hoverPool(cur.pool.map((p) => ({ name: p.banner, label: `${p.banner}${p.roles ? `：${p.roles}` : ""}`, startTs: p.startTs, endTs: p.endTs, raw: p.raw })), tz);
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
	// 排序由调用方负责（hoverEvent **不排序**，与本体一致）：这里按结束时间升序
	const ordered = cur.ordered.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0)));
	const hover = hoverEvent(ordered.map((x) => ({ name: x.event, startTs: x.startTs, endTs: x.endTs, raw: x.raw })), tz, permanentCount);
	return {
		event: first.event,
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
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
// 预测卡池：**不进悬停**（方案 A：悬停只放"当期"，且不得含元信息）。
// 该表是 wiki 按日服时差机械平移出来的：池名里连**日服原始年份**都还留着
// （如 `八骏赛马娘卡池 20230911` 被平移到 2026-09），远期条目一路排到 2029 年。
// 2026-10-03 改：原先这里给 bannerHover 追加「—— 接下来的预测卡池（按日服时差推算，非官方时刻表） ——」
//   + 3 条未来条目。那既是"非当期"内容，头部又是元信息/来源说明 ——
//   「社区推算，非官方」这层意思已经写在来源标签里（`Bwiki 简中卡池（社区推算，非官方）`），
//   不需要再在悬停里重复。保留函数是为了让夹具测试仍能直接断言"预测表的解析结果"。
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
	// 预测表只用来让夹具测试断言解析结果，**不进悬停**（见 ns_bwiki_umaCnPredictHover 的说明）
	return ns_bwiki_gachaPayload(live, tz, n);
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

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bwiki-wikitext.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bwiki-wikitext.js
//
// 由 next-sources/parsers/bwiki-wikitext.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bwiki-wikitext__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bwiki-wikitext.js —— 批次 P8：三个 bwiki 来源的**wikitext 形态**解析器
//
// 本文件只装 P8 的三个来源（**不动** parsers/bwiki.js —— 那是 B2 的 `prop=text` HTML 形态）：
//   ① 战双帕弥什 zspms   —— 两步：SMW `action=ask` 索引 → 取最新「版本更新公告」→ `prop=wikitext` 正文
//   ② 卡厄斯梦境 czn     —— 一步：`Module:Gacha/data` 的 **Lua 表**（`prop=wikitext`）
//   ③ 雪松 kedrgame      —— 一步：`Template:首页游戏版本内容` 的 **模板调用**（`prop=wikitext`）
//
// 契约（与 CONVENTIONS.md / 插件 40-fetchers.js 完全一致）：
//   async (url, signal, tz, now = nowMs()) → 数据对象 | null
//     · 卡池侧 { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//     · 活动侧 { event, eventDates, eventDatesRaw, eventHover }
//   `now` 一律**第 4 个参数**（铁律 2：本仓库历史上把 now 放第二位 → `startTs <= now` 恒假 → 静默"未公布"）。
//   覆盖 now 的档期一条都没有 → **返回 null（未公布）**，绝不硬凑过期档期；结构性损坏才 throw。
//
// ══ 抓取证据（2026-10-02 实抓，夹具全部为真响应）══════════════════════════════
//   fixtures/p8-zspms-ask        HTTP 200 / 20,470B  SMW ask 命中 **40 条**，最新《远信回响》20260922
//   fixtures/p8-zspms-notice     HTTP 200 / 42,908B  parse.wikitext["*"] 正文 9,846B
//   fixtures/p8-czn-module       HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006）
//   fixtures/p8-kedr-template    HTTP 200 /  3,750B  `时间进度条` **5 条**
//   fixtures/p8-czn-record       HTTP 200 /    423B  备选页 `卡池记录`（模板调用 1 条，2026/03）
//
// ⚠️ bwiki 反爬（EdgeOne WAF）：请求发太密会被拦成 **HTTP 567**（≈7KB JS 挑战页、非 JSON、页内含 requestId）。
//    实测只带 UA 也能 200，**不是请求头问题** → 抓夹具要 6~10s 间隔 + 退避重试 + 校验 body 是 JSON
//    （见 test/capture-p8.mjs）。运行期若某侧抛 `bad-json`/`proxy-http-567`，那是 WAF，不是"未公布"。
//
// ══ 时区：三个来源一律 Asia/Shanghai（**均为推测**）═══════════════════════════
//   源站**都没有**时区标注。旁证：
//     · zspms 停服维护 05:00~11:00、卡池日切 05:00（国服特征）；公告尾部写「2026年9月22日」
//     · czn `10:00:00` 开池 / `02:00:00` 关池（国服作息）
//     · kedr 每期都在 `05:00` 换池（与 P6 的雪松社区页同款旁证）
//   故记"推测"，注册表注释里同样标注。
//
// ══ 「版本更新后」这类**相对起点**的锚点策略（重要，与任务书略有出入，理由在此）══
//   stellasora.js 的先例：相对起点没有绝对时刻 → 用**该公告的发布时间**当锚点 + 标 `startInferred: true`。
//   本文件沿用该精神（相对起点必须有据可依的锚点、必须标 inferred、绝不假造时刻），但锚点优先级更细：
//     ① 源站**自己写明的停服维护窗口**的结束时刻（`…将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
//        —— "版本更新后"就是维护结束之后，这是**源站原文给的绝对锚点**，比公告发布日期精确 2 天；
//     ② 兜底：公告 `{{公告|时间=YYYYMMDD}}` 字段（**= stellasora 先例的"公告发布时间"**，本夹具里是 20260922）；
//     ③ 再兜底：该相对点**自带的日期**（`2026年9月24日版本更新后`）按当日 00:00（防御性；只要正则匹配到相对点，
//        ② 的公告时间字段就一定存在，故这条实际到不了，保留以防字段被源站删除）。
//   三条路径**都**标 `startInferred: true`，并把推断依据留在**数据字段**（`startFrom`/`startRel`）与代码注释里。
//   ⚠️ 悬停**不写**推断依据（用户 2026-10-03：「悬停里的元信息彻底删掉」）——悬停只放名称/角色/档期，
//   与本体 buildPoolHover / buildEventHover 同格式（见下面 "当期挑选 / 悬停" 区域）。
//   （若坚持"一律用发布时间"，只需删掉 ns_bwiki_wikitext_zspmsMaintenanceWindow 的调用。兜底锚点行为不受悬停改动影响。）


//#region 通用：MediaWiki `prop=wikitext`（fetchMediaWikiText 只取 parse.text，这里要 parse.wikitext）
// 实测两种返回形态都要兼容：
//   · 本项目抓到的 bwiki 是 `{"parse":{"title":…,"wikitext":{"*":"正文"}}}`（对象包一层 `"*"`）
//   · 部分 MediaWiki（如 fgo.wiki 的某些配置）直接给字符串 → 也兼容
function ns_bwiki_wikitext_mediaWikiWikitext(json) {
	const p = json && json.parse;
	if (!p) return null;
	const wt = p.wikitext;
	if (typeof wt === "string") return wt;
	if (wt && typeof wt === "object" && typeof wt["*"] === "string") return wt["*"];
	return null;
}
// 带 Referer 请求（浏览器真实会带；bwiki 的 EdgeOne WAF 拦的主要是"频率"，但少一个 bot 信号没坏处）。
// ⚠️ 夹具测试不受影响：离线 harness 只读代理 URL 里的 `url` 参数，忽略 referer。
async function ns_bwiki_wikitext_fetchWikitext(url, signal, referer = "") {
	const json = await fetchJson(url, { referer, signal, mode: "proxy" });
	const wt = ns_bwiki_wikitext_mediaWikiWikitext(json);
	if (wt == null) throw new Error("bad-json");     // 含 missingtitle（HTTP 仍 200）→ 结构性损坏
	return wt;
}
//#endregion

//#region 通用：当期挑选 / 悬停
// ── 悬停排版（用户 2026-10-03 方案 A）────────────────────────────────────────
// 用户反馈「新增游戏的面板外显/悬停的样式、格式、规则和原来的差别很大」。本文件此前各写各的悬停，
// 三类偏差全中：① 首行塞元信息（来源站名/URL/SMW 时间/tz 推定/抓取条数/维护锚点）；
// ② 「档期在前、名称在后」；③ 自拼档期文本而非 fmtWindow。
// 修法：**排版一律交给 lib/env.js 的共用工具**（与本体 buildPoolHover / buildEventHover 逐字一致），
// 本区域只负责把解析结果映射成入参；悬停里**只剩** 名称/角色/档期。
// ⚠️ 元信息（来源站名、域名/URL、API/页面名、时区推定、抓取条数、内部 id、SMW 时间、起点锚点、
//    「起点推断」注记、游戏名+区服前缀、任何「（…）」实现说明）**直接删掉**，不搬家、不进任何字段。
//    实现说明只留在**代码注释**与数据字段（startInferred/startFrom/startRel）里，供测试与排查用。
function ns_bwiki_wikitext_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : nowMs(); }
// 覆盖 now 的条目（起点/终点都有绝对时刻才进候选；缺任一端的不产出）
function ns_bwiki_wikitext_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.startTs != null && coversNow(it, now));
}
// 卡池条目 → `hoverPool` 入参。`name` = 池名原文（工具用它判空/兜底），`label` = 外显同构的「池名：角色」
// （逐字照本体调用方：src/client/30-parsers.js 的 selectArknights`label: `${it.banner}：${it.roles}``）。
// ⚠️ 战双的池名形如「时崎狂三狙击 / 命运时崎狂三狙击」——**原样**当池名用，不自己编角色名。
function ns_bwiki_wikitext_poolItem(x) {
	const name = String(x.banner == null ? "" : x.banner).trim();
	const roles = String(x.roles == null ? "" : x.roles).trim();
	return {
		name,
		label: roles ? `${name}：${roles}` : name,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw || ""
	};
}
// 活动条目 → `hoverEvent` 入参：显示的是**活动名**（不是「活动时间」这类标签）+ 档期。
function ns_bwiki_wikitext_eventItem(x, nameOf) {
	return { name: nameOf(x), startTs: x.startTs, endTs: x.endTs, raw: x.raw || "" };
}
// 卡池侧载荷。cmp 决定"外显"优先序；默认 = 结束最早优先（越快结束越该盯住，与 bwiki.js 同口径）。
// 悬停一律走共用 `hoverPool`：≥2 池 → 每池「池名：角色」行 + 档期行（窗口全同则只写一次档期）；
// **<2 池 → 不设 bannerHover**（交回 UI 的「banner：roles」⏎「档期」两行式兜底，与本体约定一致）。
function ns_bwiki_wikitext_gachaPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const hover = hoverPool(sorted.map(ns_bwiki_wikitext_poolItem), tz);
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	return out;
}
// 活动侧载荷。cmp 决定外显优先序；悬停列出**全部覆盖当期**的条目（按同一排序，**名称在前**）。
// 悬停一律走共用 `hoverEvent`（名称 + 3 空格 + 档期；不排序，由调用方排好）：
// **<2 条 → 不设 eventHover**（交回 UI 的「event」⏎「eventDates|raw」兜底）。
function ns_bwiki_wikitext_eventPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const nameOf = opts.nameOf || ((x) => x.name || x.event || "");
	const hover = hoverEvent(sorted.map((x) => ns_bwiki_wikitext_eventItem(x, nameOf)), tz, opts.permanentCount || 0);
	return {
		event: nameOf(first),
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
	};
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
const ns_bwiki_wikitext_ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ns_bwiki_wikitext_ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
function ns_bwiki_wikitext_zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

//#region 战双：SMW ask 索引
// 实测返回（fixtures/p8-zspms-ask）：
//   {"query-continue-offset":40,
//    "query":{"printrequests":[{"label":"标题",…},{"label":"时间",…}],
//             "results":{"《远信回响》版本更新公告":{"printouts":{"标题":["《远信回响》版本更新公告"],
//                                                              "时间":["20260922"]},
//                                                 "fulltext":"《远信回响》版本更新公告","fullurl":…,"namespace":0,"exists":"1"}},
//             "serializer":"SMW\\Serializers\\QueryResultSerializer","version":2,
//             "meta":{"hash":…,"count":40,"offset":0,…}}}
// ⚠️ `时间` 是**字符串** `"20260922"`（YYYYMMDD），**不是** SMW 的 timestamp 对象。
//    但仍做兼容：字符串 / 数组 / {timestamp} / {fulltext} 都吃。
function ns_bwiki_wikitext_smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_wikitext_smwText(v[0]);
	if (typeof v === "object") {
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// ask JSON → 按 `时间` 严格倒序的行 [{ page, title, time, fullurl }]
//   结构性损坏（无 query.results）→ 抛错；**0 条也抛错**：该查询依赖 `类别::版本`，
//   返回 0 条说明索引/属性坏了，绝不能静默降级成"未公布"（任务书明确要求）。
function ns_bwiki_wikitext_parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: ns_bwiki_wikitext_smwText(p["标题"]) || page,
			time: ns_bwiki_wikitext_smwText(p["时间"]),
			fullurl: (v && v.fullurl) || ""
		};
	});
	if (rows.length === 0) throw new Error("zspms-ask:no-result");
	rows.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
	return rows;
}
//#endregion

//#region 战双：正文 → 档期
// `{{颜色引用|红|2026年9月24日版本更新后 - 2026年11月5日05:00}}` —— 档期**写在模板参数里**，
// 所以必须先剥模板（保留内文），否则整段档期都看不见。处理顺序：
//   ① `{{颜色引用|<色>|<正文>}}` → 只留 <正文>（档期就在这里）  ② `{{公告|…}}` 信息模板 → 整块丢弃（时间另取）
//   ③ 其它无参/单参模板 → 无参丢、有参留最后一个参数   ④ `'''` 粗体标记 → 去掉
//   ⑤ `[[file:…]]` → 去掉   ⑥ `<br>`/块级标签 → 换行（正文是 `<br>` 分行写的）
//   ⑦ 标题 `==X==` → 独立行，并打上 `\u0001H<level>\u0001` 前缀（后面要靠标题栈取活动名）
function ns_bwiki_wikitext_zspmsNormalize(wikitext) {
	let s = String(wikitext == null ? "" : wikitext);
	s = s.replace(/\{\{颜色引用\s*\|[^|{}]*\|([\s\S]*?)\}\}/g, "$1");
	s = s.replace(/\{\{公告[\s\S]*?\}\}/g, "");
	s = s.replace(/\{\{[^{}]*\}\}/g, (m) => { const i = m.lastIndexOf("|"); return i < 0 ? "" : m.slice(i + 1, -2); });
	s = s.replace(/'''/g, "");
	s = s.replace(/\[\[(?:file|File|文件)\s*:[^\]]*\]\]/g, "");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/?(?:hr|center|div|p|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/?(?:b|i|u|span|small|big|font|sup|sub)\b[^>]*>/gi, "");
	s = s.replace(/&nbsp;/gi, " ");
	// ⚠️ 标题必须**整行**匹配（加 m + ^$）：否则表格行 `{| class="wikitable" style="…"` 里的两个 `=`
	//    会被当成一级标题，往标题栈里塞一个假标题。
	s = s.replace(/^(={1,6})\s*([^=\n]+?)\s*\1\s*$/gm, (m, eq, title) => `\u0001H${eq.length}\u0001${title}`);
	return s;
}

// 停服维护窗口（源站原文，例：`我们将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
// 只在含「停服维护/停机维护」的那一行里找 `YY…MM…DD HH:MM - HH:MM`（终点可省日期）。
function ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const line = String(text == null ? "" : text).split("\n").find((l) => /停服维护|停机维护|维护更新/.test(l) && /\d{4}\s*年/.test(l));
	if (!line) return null;
	const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(line);
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const startTs = sourceInstant(y, mo, d, +m[4], +m[5], tz);
	let endTs = sourceInstant(y, mo, d, +m[6], +m[7], tz);
	if (endTs <= startTs) endTs = sourceInstant(y, mo, d + 1, +m[6], +m[7], tz);   // 跨零点的维护（如 22:00-02:00）
	if (!(endTs > startTs)) return null;
	const raw = `${y}-${pad2(mo)}-${pad2(d)} ${pad2(+m[4])}:${m[5]} - ${pad2(+m[6])}:${m[7]}`;
	return { startTs, endTs, raw };
}

// 中文年月日「起点 - 终点」窗口（源站墙钟原文形态）：
//   `2026年9月24日版本更新后 - 2026年11月5日05:00`（相对起点）
//   `2026年9月29日10:00 - 2026年11月3日23:59`（双端显式时刻）
//   `2026年9月24日 - 2026年10月1日`（双端只有日期 → 起点 00:00 / 终点 23:59）
// ⚠️ 内部空白只用 `[ \t]`（**不许跨行**）：否则维护段 `9月24日05:00 - 11:00` 会跟下一行的日期拼成假窗口。
const ns_bwiki_wikitext__SP = "[ \\t]*";
const ns_bwiki_wikitext__CN_DATE = "(\\d{4})" + ns_bwiki_wikitext__SP + "年" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "月" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "日";
const ns_bwiki_wikitext__CN_TIME = "(\\d{1,2})" + ns_bwiki_wikitext__SP + "[:：]" + ns_bwiki_wikitext__SP + "(\\d{2})";
const ns_bwiki_wikitext__CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const ns_bwiki_wikitext__CN_WIN_SRC = ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + "|" + ns_bwiki_wikitext__CN_REL + ")?" + ns_bwiki_wikitext__SP + "[-–—－~～至到]" + ns_bwiki_wikitext__SP
	+ ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const ns_bwiki_wikitext__GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function ns_bwiki_wikitext_cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
function ns_bwiki_wikitext_zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: ns_bwiki_wikitext_cleanHead(m[2]) });
	});
	return out;
}
function ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !ns_bwiki_wikitext__GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const ns_bwiki_wikitext__ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function ns_bwiki_wikitext_zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function ns_bwiki_wikitext_zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
function ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = ns_bwiki_wikitext_zspmsNormalize(raw);
	const maint = ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = ns_bwiki_wikitext_zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(ns_bwiki_wikitext__CN_WIN_SRC, "g");
	let m;
	while ((m = re.exec(text))) {
		// —— 起点：显式时刻 > 相对锚点（① 源站维护结束时刻 → ② 公告时间字段[stellasora 先例] → ③ 自带日期）
		//    三条相对锚点路径都标 startInferred=true，并把依据写进 startFrom（hover 会如实显示）
		let startTs, startInferred = false, startFrom = "", startRel = "";
		if (m[4] != null) {
			startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		} else if (m[6] != null) {
			startRel = m[6];
			startInferred = true;
			if (maint && maint.endTs != null) { startTs = maint.endTs; startFrom = `源站维护窗口 ${maint.raw} 的结束时刻`; }
			else if (annDate) { startTs = sourceInstant(annDate.y, annDate.mo, annDate.d, 0, 0, tz); startFrom = `公告时间 ${timeField}`; }
			else { startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz); startFrom = `自带日期 ${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`; }
		} else {
			startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz);
			startInferred = true;
			startFrom = "源站只给日期，起点按 00:00";
		}
		// —— 终点（缺时刻按 23:59）
		const endTs = m[10] != null
			? sourceInstant(+m[7], +m[8], +m[9], +m[10], +m[11], tz)
			: sourceInstant(+m[7], +m[8], +m[9], 23, 59, tz);
		if (!(endTs > startTs)) { skipped++; continue; }             // 源站错行 → 丢弃，不硬造

		// —— 行上下文（分类 + 池名 + 活动名都只看本行）
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		let lineEnd = text.indexOf("\n", m.index);
		if (lineEnd < 0) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd);
		const lineIdx = text.slice(0, lineStart).split("\n").length - 1;
		const isPool = /研发池/.test(line);
		const base = {
			_i: items.length,
			startTs, endTs,
			raw: m[0],
			startInferred, startFrom, startRel,
			line: line.trim()
		};
		if (isPool) {
			const pools = ns_bwiki_wikitext_zspmsPools(line);
			const role = ns_bwiki_wikitext_zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = ns_bwiki_wikitext__ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const ns_bwiki_wikitext__ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
function ns_bwiki_wikitext_zspmsEventTier(x) { return ns_bwiki_wikitext__ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function ns_bwiki_wikitext_zspmsEventCmp(a, b) {
	return (ns_bwiki_wikitext_zspmsEventTier(a) - ns_bwiki_wikitext_zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
// ⚠️ 原先这里有个 zspmsHeader()：往悬停首行拼「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8
//    为推测；起点锚点=源站维护结束 …）」。按方案 A **整段删除**（元信息不进悬停，也不搬到别的字段）。
//    公告标题/SMW 时间/维护窗口仍是**数据字段**（announceTime / anchor / startFrom），解析逻辑不变。

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
async function ns_bwiki_wikitext_zspmsLatestNotice(url, signal) {
	const rows = ns_bwiki_wikitext_parseZspmsAsk(await fetchJson(url || ns_bwiki_wikitext_ZSPMS_ASK_URL, { referer: ns_bwiki_wikitext_ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(ns_bwiki_wikitext_zspmsParseUrl(row.page), signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	return { row, rows, wikitext };
}
async function ns_bwiki_wikitext_gachaZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	// `row`（ask 索引行）仍要传给解析器：`{{公告|时间=…}}` 缺失时用它兜底相对起点的锚点。
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
async function ns_bwiki_wikitext_eventsZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
const ns_bwiki_wikitext_CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
const ns_bwiki_wikitext_CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_RECORD_PAGE = "卡池记录";
const ns_bwiki_wikitext_CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
function ns_bwiki_wikitext_cznStamp(text) {
	const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ \t]+(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*[:：]\s*(\d{2}))?\s*$/.exec(String(text == null ? "" : text));
	if (!m) return null;
	const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// Lua 表 → 6 期 [{ id, type, char, startTs, endTs, raw }]
// 实测形态（fixtures/p8-czn-module，999B，6 期）：
//   return { ["0001"] = { type = "主战员营救概率提升", start_date = "2026-5-28 10:00:00",
//                          end_date = "2026-6-17 02:00:00", link_char = "绯", }, … }
function ns_bwiki_wikitext_parseCznLua(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = ns_bwiki_wikitext_cznStamp(f.start_date), b = ns_bwiki_wikitext_cznStamp(f.end_date);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;                       // 源站错行 → 丢弃
		items.push({
			_i: items.length,
			id: m[1],
			type: f.type || "",
			char: f.link_char || "",
			startTs, endTs,
			raw: `${f.start_date} ~ ${f.end_date}`
		});
	}
	if (items.length === 0) throw new Error("czn-lua:no-entry");   // 结构变了（Lua 表被改/页面空）→ 抓取失败
	return items;
}
// 备选页 `卡池记录`（**只有 1 条**模板调用，2026/03，已过期；本文件只导出纯函数，不挂抓取器）：
//   {{Gacha|id=TEST|title=小春概率UP|type=救援概率UP|Start_Date=2026/03/22 8:59:00|End_Date=2026/03/27 8:59:00|UP=小春|banner=…}}
function ns_bwiki_wikitext_parseCznRecord(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const callRe = /\{\{\s*Gacha\s*\|([\s\S]*?)\}\}/g;
	let m;
	while ((m = callRe.exec(src))) {
		const f = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			f[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		const a = ns_bwiki_wikitext_cznStamp(f["Start_Date"]), b = ns_bwiki_wikitext_cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			cat: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
// ⚠️ 原先此处给 `ns_bwiki_wikitext_gachaPayload` 传了 header「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」
//    —— 那是悬停元信息（来源站名 / API 名 / 抓取条数 / 时区推定），按方案 A **整段删除**。
//    Lua 表页名/期数仍是**数据**（ns_bwiki_wikitext_CZN_MODULE_PAGE / items.length），注释与注册表里都有，不进悬停。
async function ns_bwiki_wikitext_gachaCzn(url, signal, tz = ns_bwiki_wikitext_CZN_TZ, now = nowMs()) {
	const items = ns_bwiki_wikitext_parseCznLua(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_CZN_MODULE_URL, signal, ns_bwiki_wikitext_CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return ns_bwiki_wikitext_gachaPayload(items, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
const ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
function ns_bwiki_wikitext_kedrTemplateUrl(page = ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_KEDR_TEMPLATE_URL = ns_bwiki_wikitext_kedrTemplateUrl();
const ns_bwiki_wikitext_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
function ns_bwiki_wikitext_kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
function ns_bwiki_wikitext_kedrStamp(text) { return ns_bwiki_wikitext_cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
function ns_bwiki_wikitext_kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
function ns_bwiki_wikitext_kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (ns_bwiki_wikitext_kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
function ns_bwiki_wikitext_kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
function ns_bwiki_wikitext_parseKedrTemplate(wikitext, tz = ns_bwiki_wikitext_KEDR_TZ) {
	const calls = ns_bwiki_wikitext_kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = ns_bwiki_wikitext_kedrStamp(p["开始时间"]), b = ns_bwiki_wikitext_kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (ns_bwiki_wikitext_kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: ns_bwiki_wikitext_kedrRoleFromName(name) });
		else if (ns_bwiki_wikitext_kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
// ⚠️ 原先这里有个 _KEDR_HEADER：「雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，
//    活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）」——悬停元信息（来源站名/页面名/分流口径/时区推定），
//    按方案 A **整段删除**（分流规则仍在 ns_bwiki_wikitext_kedrIsGacha / ns_bwiki_wikitext_kedrIsEvent 的注释里）。
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
async function ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { gacha } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_gachaPayload(gacha, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
async function ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { event } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_eventPayload(event, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-kedr-wiki.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-kedr-wiki.js
//
// 由 next-sources/parsers/kedr-wiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_kedr-wiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-kedr-wiki.js —— 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 契约：async (url, signal, tz, now = nowMs()) → { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover } | null
//
// ⚠️ **这是社区 wiki，不是官方源**：雪松（Кедр / kedrgame，俄语"雪松"）**官方源未找到**
//    （调研结论见 `dsh-gacha-calendar-新增来源第二轮调研-2026-10-02.md` §5：官方无公告 API，
//      bwiki 的 `page=卡池信息` 又是「台架测试」占位页）→ 本来源是**社区结构化页**，`kind: "wiki"`。
//    稳定性弱于官方 API：页面随时可能被社区改写/停更。
//
// ══ 实测形态（2026-10-02 抓夹具 fixtures/p6-kedr-archive，HTTP 200 / 17,298 B）══
//   GET https://wiki.biligame.com/kedrgame/api.php?action=parse&page=<percent-encoded>&prop=text&format=json&formatversion=2
//   （页名 `往期动员【常驻】—1.0.0—` **必须 percent-encode 后再拼 URL**，见 ns_kedr_wiki_kedrParseUrl）
//   → 标准 MediaWiki `{ parse:{ title, pageid, text } }`，`text` 是 16,516 B 的 HTML。
//
//   ⚠️ **与任务书假设不同：该页没有任何 `<table>`（实测 0 张）**，所以不存在"表格档期抽取"。
//      真实结构是「每个小节一段档期 + 若干可折叠卡池面板」：
//        <h1><span class="mw-headline" id="1.0.0-1"><b>1.0.0-1</b></span>…[编辑]</h1>
//        <div …><p><big>
//          <b>开始时间：2026-06-22-12:00<br /></b>
//          <b>结束时间：2026-06-29-05:00<br /></b>
//        </big></p>
//        <div class="panel panel-info"><div class="panel-heading">…<span>卡池:精英集结·指挥</span>…展开/折叠
//          <div class="panel-body…"><p>角色：<a title="安吉拉">安吉拉</a><br />职业：指挥<br />卡池：【<a …>精英集结·指挥</a>】…
//      要点：① 档期不是一行"起 ~ 止"，而是**开始时间 / 结束时间 两行**（各带 `<br />`）→ 要配对；
//            ② 时间戳形态是 `YYYY-MM-DD-HH:MM`（日期与时刻之间**又多一个连字符**，非标准写法）；
//            ③ 小节标题在 `<h1>` 里，4 节 = `1.0.0-1` ~ `1.0.0-4`；
//            ④ 每节 2 个卡池（`卡池:` 出现在折叠面板标题上），`角色：` 后是 UP 角色（安克文本即名字）。
//      ⇒ 解析器按 `<h1>` 切节（下面 ns_kedr_wiki_kedrSections），节内配对两个时间戳 + 收集卡池/角色。
//
// ══ 时区 Asia/Shanghai（**推测**，源站未标注）══
//   页面正文没有任何时区字样。两条旁证支持国服 UTC+8：① 每期 `结束时间` 都落在 **05:00**
//   （国服常见的每日 05:00 日切点）；② 起始是 `12:00`（中午开池）。**未经源站声明**，故记"推测"。
//
// ══ 「往期动员」是**归档页**（重要）══
//   页面标题即「往期」：实测 4 期全部落在 2026-06-22 ~ 2026-07-20（抓取时刻 2026-10-02 已全部结束）
//   → 抓取器在"当期"语义下会**如实返回 null（未公布）**，而不是硬凑一个过期档期。
//   若社区把当期动员也挂到同一页/同款结构，本解析器无需改动即可产出。
//
// ══ bwiki 反爬（抓夹具时必看）══
//   高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 ~7KB 挑战页、**不是 JSON**）
//   → 抓夹具要限速 30s 重试，并**校验 body 是不是 JSON**（否则会把挑战页存成夹具）。
//   本次抓取两次请求都是 HTTP 200 + 合法 JSON（无触发）。`fetchMediaWikiText` 对坏 JSON 会抛
//   `bad-json` → 属"该侧抓取失败"，不会被当成"未公布"。


const ns_kedr_wiki_KEDR_API = "https://wiki.biligame.com/kedrgame/api.php";
const ns_kedr_wiki_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";
const ns_kedr_wiki_KEDR_ARCHIVE_PAGE = "往期动员【常驻】—1.0.0—";
// 推测：国服 UTC+8（源站未标注；旁证见文件头）
const ns_kedr_wiki_KEDR_TZ = "Asia/Shanghai";

// ⚠️ 页名必须 encodeURIComponent 后再拼（与 fgo.js 的 fgoParseUrl 同做法）：
//    registry-p6.js 里的 URL 必须用这同一个函数构造，否则离线夹具（test/map.json 的整串键）命中不到。
function ns_kedr_wiki_kedrParseUrl(page) {
	return `${ns_kedr_wiki_KEDR_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_kedr_wiki_KEDR_ARCHIVE_URL = ns_kedr_wiki_kedrParseUrl(ns_kedr_wiki_KEDR_ARCHIVE_PAGE);

//#region 结构解析
// 按 <h1>…</h6> 切节；节标题取 `<span class="mw-headline">`（退回去标签后的文本），并去掉 `[编辑]`
//   ⚠️ 页首的目录标题 `<h2 id="mw-toc-heading">目录</h2>` 也是 heading → 显式排除（否则小节数虚高）
function ns_kedr_wiki_kedrSections(html) {
	const s = String(html == null ? "" : html);
	const heads = [];
	const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
	let m;
	while ((m = re.exec(s)) !== null) {
		if (/mw-toc-heading/.test(m[2])) continue;
		const inner = m[3];
		const hl = /<span[^>]*class="mw-headline"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
		const title = stripTags(hl ? hl[1] : inner)
			.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
			.replace(/\s+/g, " ")
			.trim();
		heads.push({ level: +m[1], title, start: m.index, bodyStart: re.lastIndex });
	}
	return heads.map((h, i) => ({
		title: h.title,
		level: h.level,
		html: s.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : s.length)
	}));
}
// `开始时间：2026-06-22-12:00` / `结束时间：2026-06-29-05:00`
//   ⚠️ 源站的时间戳是 `YYYY-MM-DD-HH:MM`（日期与时刻之间再多一个连字符）→ 分隔符放宽
const ns_kedr_wiki_STAMP_BODY = "(\\d{4})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\s]\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
function ns_kedr_wiki_kedrStamp(sectionHtml, label) {
	const re = new RegExp(label + "\\s*[:：][\\s\\S]{0,40}?" + ns_kedr_wiki_STAMP_BODY);
	const m = re.exec(String(sectionHtml == null ? "" : sectionHtml));
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi, text: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}-${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}
// 节内卡池名：`卡池:精英集结·指挥`（折叠面板标题上）；正文里 `卡池：【<a…>…】` 形态由
// 排除 `<`/`【`/`】` 的字符类天然跳过，不会重复取到。去重保序。
function ns_kedr_wiki_kedrPools(sectionHtml) {
	return [...String(sectionHtml == null ? "" : sectionHtml).matchAll(/卡池\s*[:：]\s*([^<【】\n]{1,24})/g)]
		.map((m) => m[1].replace(/\s+/g, " ").trim())
		.filter((x, i, a) => x && a.indexOf(x) === i);
}
// 节内 UP 角色：`角色：<a …>安吉拉</a><br />` → 取到第一个 <br>/</p> 之前的内容去标签
function ns_kedr_wiki_kedrRoles(sectionHtml) {
	const out = [];
	const re = /角色\s*[:：]([\s\S]{0,200}?)(?:<br\s*\/?>|<\/p>|$)/gi;
	let m;
	while ((m = re.exec(String(sectionHtml == null ? "" : sectionHtml))) !== null) {
		const t = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (t && !out.includes(t)) out.push(t);
		if (m[0] === "") re.lastIndex++;
	}
	return out;
}

// 页面 HTML → { sectionTitles, items:[{section,pools,roles,startTs,endTs,raw}], skipped }
//   结构性损坏（没有任何小节）→ 抛错（该侧算抓取失败），与 bwiki.js 的 no-table 同口径。
function ns_kedr_wiki_parseKedrArchive(html, tz = ns_kedr_wiki_KEDR_TZ) {
	const sections = ns_kedr_wiki_kedrSections(html);
	if (sections.length === 0) throw new Error("kedr-wiki:no-section");
	const items = [];
	let skipped = 0;
	sections.forEach((sec, i) => {
		const a = ns_kedr_wiki_kedrStamp(sec.html, "开始时间");
		const b = ns_kedr_wiki_kedrStamp(sec.html, "结束时间");
		if (!a || !b) { skipped++; return; }                      // 缺档期的小节（如纯说明节）→ 跳过
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }            // 源站错行 → 丢掉，不硬造
		items.push({
			_i: i,
			section: sec.title || `第 ${i + 1} 节`,
			pools: ns_kedr_wiki_kedrPools(sec.html),
			roles: ns_kedr_wiki_kedrRoles(sec.html),
			startTs, endTs,
			// raw：两端都是源站原文（`YYYY-MM-DD-HH:MM`），中间的 `~` 是本解析器拼的（源站分行写）
			raw: `${a.text} ~ ${b.text}`
		});
	});
	return { sectionTitles: sections.map((s) => s.title), items, skipped };
}
//#endregion

//#region 抓取器
// 当期 = 窗口覆盖 now 的那一节（取结束最早，并列按页面顺序）；没有覆盖 → null（未公布）
async function ns_kedr_wiki_gachaKedrWiki(url, signal, tz = ns_kedr_wiki_KEDR_TZ, now = nowMs()) {
	const html = await fetchMediaWikiText(url || ns_kedr_wiki_KEDR_ARCHIVE_URL, { referer: ns_kedr_wiki_KEDR_REFERER, signal, mode: "proxy" });
	const parsed = ns_kedr_wiki_parseKedrArchive(html, tz);
	const act = parsed.items
		.filter((x) => coversNow(x, now))
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.x._i - b.x._i))
		.map((o) => o.x);
	if (act.length === 0) return null;
	const first = act[0];
	// ⚠️ 2026-10-03 改：这里原本手搓悬停，且三处不合规 ——
	//   ① 头行 `${KEDR_ARCHIVE_PAGE}（bwiki 社区页，非官方源；tz=UTC+8 为推测）` = 来源名 + 可信度说明 + 时区推定
	//      （「社区页 / 非官方 / tz 为推测」这类信息应写在**来源声明**里：条目 tz 字段 + 设置页来源标签）
	//   ② 行格式是 `档期   节名`（**档期在前**），本体一律「池名 ⏎ 档期」
	//   ③ 自带排版实现（没走共用 hoverPool）
	// 现在改用共用 hoverPool。
	const hover = hoverPool(act.map((x) => ({
		name: `${x.section}${x.pools.length ? `（${x.pools.join(" / ")}）` : ""}`,
		startTs: x.startTs,
		endTs: x.endTs
	})), tz);
	return {
		banner: first.pools.length ? `${first.section}（${first.pools.join(" / ")}）` : first.section,
		roles: first.roles.join("、"),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw,
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
//#endregion

		// ── 条目 ──
		registerSource({
				id: "wuhuamixin",
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
		});

		registerSource({
				id: "zspms",
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				eventSource: "Bwiki",
		});

		registerSource({
				id: "czn",
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json",
				source: "Bwiki",
		});

		registerSource({
				id: "kedr",
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
				altSources: [{"label":"Bwiki 卡池信息（台架测试占位）","url":"https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2","fetcher":"kedr-kaxi"}],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["wuhuamixin"] = (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz);
		GACHA_FETCHERS["zspms"] = (url, signal, tz) => ns_bwiki_wikitext_gachaZspms(url, signal, tz);
		GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
		GACHA_FETCHERS["kedr"] = (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz);
		EVENT_FETCHERS["wuhuamixin"] = Object.assign(EVENT_FETCHERS["wuhuamixin"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) });
		EVENT_FETCHERS["zspms"] = Object.assign(EVENT_FETCHERS["zspms"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsZspms(url, signal, tz) });
		EVENT_FETCHERS["kedr"] = Object.assign(EVENT_FETCHERS["kedr"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) });
		GACHA_FETCHERS["kedr-kaxi"] = (url, signal, tz) => ns_bwiki_gachaKedr(url, signal, tz);
