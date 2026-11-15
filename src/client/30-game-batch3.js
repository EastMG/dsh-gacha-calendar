// src/client/30-game-batch3.js —— 2026-11-15 第三批：碧蓝幻想（gbf）/ 舰队Collection（kancolle）
//
// ── 为什么两条一起放这个文件 ─────────────────────────────────────────────────────
// 两条都是**日服网页游戏**、都**只有活动侧有源**（卡池侧未配置），抓法一样（单页 HTML → 表格/段位），
// 时区一样（Asia/Tokyo），所以按批次归一个 `30-game-batch3.js`（同 `30-game-batch2.js` 的先例）。
// 每条各自自包含：常量 + 纯解析 + 抓取器 + 登记，互不依赖。
//
// ══ ① 碧蓝幻想 GRANBLUE FANTASY（id `gbf`，日服，Cygames）══════════════════════════
// ── 官方渠道为什么接不了（已实测，别再来回找）──────────────────────────────────
//   · `https://game.granbluefantasy.jp/` 是 SPA，且**未登录直接 `window.location.href='.../authentication'`**；
//     `rest/*`（`/rest/info/list`、`/rest/news/list`、`/rest/gacha/list` …）在未登录下**全部回落成同一份
//     1744 B 的 SPA 壳**（`Content-Type: text/html`，不是 JSON）—— 公告/卡池档期是登录态数据，无公开 JSON。
//   · `https://granbluefantasy.jp/news/` 是**系列官网**（Cygames 的 GBF 品牌站，动漫/周边），不是游戏内公告。
//   · `https://gbf.wiki/`（社区主 wiki）对非浏览器请求 **403**（正文由 WAF 拦，`api.php` 同样 403）；
//     `granbluefantasy.fandom.com` 同名的 Fandom 站**已停更**（首页活动块停在 2021-07）。
//   ⇒ 卡池侧按口径**留空**（`url: ""` = 设置页/面板显示「未配置」，一个请求都不发）。
//
// ── 活动侧源（2026-11-15 实测；夹具 test/fixtures/gbf-events）────────────────────
//   `GET https://gbf-wiki.com/?イベント/開催予定・開催中`（PukiWiki 1.5.2，服务端渲染 HTML，200 / 166,127 B）
//   页面里有两张同构表格（表头第 6 列都是 `開催日時`）：
//     ·「現在開催中のイベント」——本期正在跑的（实测 1 行）
//     ·「今後の開催予定」——下一期/已公布档期（实测 3 行）
//   行 = `イベント種別 | 回数 | イベント名 | ボス属性 | 有利属性 | 開催日時 | 備考`
//   实测原样（2026-11-15）：
//     十天衆戦記 / 9 / 十天衆戦記 / 水 / 土 / `2026/11/13 17:00～2026/11/20 16:59`
//     コラボイベント / 1 /（SHAMAN KING） / — / — / `2027/01/15 ～`（**只有起点**）
//     シナリオイベント / 1 /（不明） / — / — / `2026/11/28 17:00～2026/12/06 20:59`
//     決戦！星の古戦場 / 85 / 決戦！星の古戦場 / 光 / 闇 / `2026/11/21 19:00～2026/11/28 23:59`
//   ⇒ 档期一律 `YYYY/MM/DD [HH:MM]～YYYY/MM/DD [HH:MM]`：带时刻就用，只写日期 → 起点 00:00 / 终点 23:59
//     （仓库通用约定，与 bwiki 系一致）；**只有起点**（`2027/01/15 ～`）⇒ 终点 null，不冒充"在期"。
//   名称：`（SHAMAN KING）`/`（不明）` 这种**占位括号**补上 `イベント種別` 前缀（`コラボイベント（SHAMAN KING）` /
//     `シナリオイベント（不明）`）—— 否则面板上只剩一个括号，看不出是什么。
//     PukiWiki 的「新建页面」问号链接（`<span class="noexists">名<a href="?cmd=edit…">?</a></span>`）要先摘掉，
//     否则名字尾巴会多一个 `?`。
//   时区 = `Asia/Tokyo`（源站自身口径，不换算）。
//
// ── 请求预算 / 缓存 ────────────────────────────────────────────────────────────────
//   1 次请求（单页；行里自带名字与档期，没有详情页）。解析结果按 **URL** 缓存，TTL 24h ⇒ 稳态 1 次/天。
//   （该源没有"条目 id"可缓存 —— 一页即一期，URL 就是它的 id。）
//
// ── 失败语义（与全仓一致）─────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 结构变了（**一张带 `開催日時` 表头的表都没有** / 表在但**一行 `<td>` 行都没有**）⇒ 抛
//     `gbf-events-changed:…`（抓取失败 ≠ 未公布；`{}` / 改版页 / 空响应都落这里）；
//   · 表正常但**时间锚点被抹掉** ⇒ 不抛，这一页就是"没有窗口"（不产出条目）；
//   · 有窗口但没有一条覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ══ ② 舰队Collection（id `kancolle`，日服，DMM）════════════════════════════════════
// ── 官方渠道为什么接不了（已实测）────────────────────────────────────────────────
//   · 官方公告只在 X/Twitter `@KanColle_STAFF`（无公开 JSON；不在本仓抓取器支持范围内）。
//   · `kancolle.wiki`：证书链在本机拉起失败（`SEC_E_UNTRUSTED_ROOT`），浏览器里同样会被拦 —— 不可用。
//   · `kancolle.fandom.com`：文件还在传，但**活动页停在 2021**（`Events/Main` 的 Event List 最后一行
//     是 2020 年；搜索「2026」零命中）⇒ 停更，不能当源。
//   · `zh.kcwiki.cn`：最后编辑 2023（活动页全停在 2021）。
//   · `en.kancollewiki.net`：主 wiki 活跃，但 `Events` 页只有**活动名**没有档期（`Current Event` 段被注释掉）。
//   ⇒ 活动侧用**日文攻略 wiki 的活动一览页**（下面这条），卡池侧不存在这个概念 ⇒ `url: ""` 未配置。
//
// ── 活动侧源（2026-11-15 实测；夹具 test/fixtures/kancolle-events）───────────────
//   `GET https://wikiwiki.jp/kancolle/期間限定出撃`（WikiWiki 服务端渲染 HTML，200 / 444,946 B）
//   页面 = 历年**期間限定海域（大型イベント）** 的档案，**新的一期在最上面**：
//     `<h2 …>反撃！第三十一戦隊の戦い(2026年夏イベント) <a class="anchor_super" …></a> …</h2>`
//     `<p><strong><span class="wikicolor" …>期間限定！【2026/07/08～2026/09/10】【終了】</span></strong>…`
//   ⇒ 事件名 = `<h2>` 里 `anchor_super` 之前的文字（去掉尾部的 `(YYYY年…イベント)` 期次后缀）；
//     档期 = 紧跟的 `期間限定！【起～止】`。实测全文 44 个 h2 段落、最新 6 期：
//       2026/07/08～2026/09/10 / 2025/10/30～2025/12/18 / 2025/03/08～2025/05/12 /
//       2024/07/27～2024/09/24 / 2024/03/01～2024/04/10 / 2023/08/09～2023/10/11
//   ⚠️ 该页只覆盖**海域イベント**；ミニイベント（鎮守府秋刀魚祭り / Halloween 等）不在这一页，
//      在 `期間限定ドロップイベント` 页里只有"开始日 + 継続中"、**没有终点** ⇒ 构不成窗口，不收录。
//   档期只有日期 ⇒ 起点 00:00 / 终点 23:59（仓库通用约定；実際の開幕是维护结束、闭幕多在 23:59，
//      但源站没写钟点，绝不假造）。时区 = `Asia/Tokyo`。
//
// ── 请求预算 / 缓存 ────────────────────────────────────────────────────────────────
//   1 次请求（单页档案，没有详情）。解析结果按 **URL** 缓存，TTL 24h ⇒ 稳态 1 次/天。
//
// ── 失败语义 ──────────────────────────────────────────────────────────────────────
//   · 结构变了（**带 `anchor_super` 的 `<h2>` 段位少于 10 个** —— 正常页有 40+）⇒ 抛
//     `kancolle-events-changed:no-sections`（`{}` / 改版页 / 换 h3 都落这里）；
//   · 段位正常但**时间锚点被抹掉**（`期間限定！【…】` 被删）⇒ 不抛，这一页就是"没有窗口"；
//   · 有窗口但没有一条覆盖 now ⇒ `null`（未公布）。
//   ⚠️ 2026-11-15 真机：**当期没有** —— 最近一期 2026 夏イベ 已于 2026/09/10 结束，秋イベ尚未公布
//      （页面 Last-modified 2026-09-27）⇒ 活动侧如实 `null`（不是失败），这是本源的正常返回之一。
//
// ══ 夹具（真抓 + 裁剪 + meta 见 test/fixtures/*/response.txt.meta.json）══════════════
//   gbf-events       2026-11-15T07:4xZ 真抓 166,127 B；只保留 `<head><title>` + 两张活动表所在片段
//   kancolle-events  2026-11-15T07:4xZ 真抓 444,946 B；只保留最新 6 期 `<h2>` + 紧跟的档期行

//#region ① 碧蓝幻想：常量
const ns_gbf_TZ = "Asia/Tokyo";
// 活动一览（PukiWiki 页面名 = `イベント/開催予定・開催中`；百分号编码是站点自己的规范形态）
const ns_gbf_EVENTS_URL = "https://gbf-wiki.com/?%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88%2F%E9%96%8B%E5%82%AC%E4%BA%88%E5%AE%9A%E3%83%BB%E9%96%8B%E5%82%AC%E4%B8%AD";
// 官方游戏图标（game.granbluefantasy.jp 的 SPA `<link rel="apple-touch-icon-precomposed">`，实测 200 / image/png）
const ns_gbf_ICON = "https://prd-game-a-granbluefantasy.akamaized.net/assets/img/sp/touch_icon.png";
const ns_gbf_SOURCE_LABEL = "wiki 活动一览（gbf-wiki）";
// 解析结果缓存 TTL = 24h（用户口径；一页即一期，URL 就是它的 id）
const ns_gbf_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 表头认这一列（两张活动表都有；报表/商城表没有 ⇒ 天然被过滤掉）
const ns_gbf_DATE_HEAD = "開催日時";
// 档期：`YYYY/MM/DD [HH:MM]～YYYY/MM/DD [HH:MM]`，终点整段可缺（`2027/01/15 ～`）
const ns_gbf_RANGE_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*[～~]\s*(?:(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?)?/;
// 占位名：整格就是一对括号（`（不明）` / `（SHAMAN KING）`）
const ns_gbf_PLACEHOLDER_RE = /^（[^）]*）$/;
//#endregion

//#region ② 碧蓝幻想：纯解析（HTML → 条目事实）
// `<table>` 块（PukiWiki 1.5.2 的活动表没有嵌套表，非贪婪切即可）
function ns_gbf_tablesOf(html) {
	return [...String(html == null ? "" : html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
}
// 单元格 → 文本：**先摘掉 PukiWiki 的「新建页面」问号链接**（`<a href="?cmd=edit…">?</a>`），
// 再走共用的 HTML → 文本（标签只当分隔符，实体解一遍）。不摘那一下，名字尾巴会多一个 `?`。
function ns_gbf_cellText(cell) {
	const s = String(cell == null ? "" : cell).replace(/<a\b[^>]*>\s*[?？]\s*<\/a>/gi, "");
	return htmlTextTight(s).trim();
}
// 一格档期 → `{ startTs, endTs, raw, display }`（没有起点 ⇒ null；只有起点 ⇒ endTs=null）
//   · 带时刻就用；只写日期 ⇒ 起点 00:00 / 终点 23:59（仓库通用约定）；
//   · 终点整段缺失 ⇒ endTs=null（"不冒充在期"，但仍如实产出条目，进 `raw`）。
function ns_gbf_windowOf(text, tz) {
	const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
	const m = ns_gbf_RANGE_RE.exec(s);
	if (!m) return null;
	const y1 = +m[1], mo1 = +m[2], d1 = +m[3], h1 = m[4] != null ? +m[4] : 0, mi1 = m[5] != null ? +m[5] : 0;
	if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || h1 > 23 || mi1 > 59) return null;
	const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
	let endTs = null;
	if (m[6] != null) {
		const y2 = +m[6], mo2 = +m[7], d2 = +m[8], h2 = m[9] != null ? +m[9] : 23, mi2 = m[10] != null ? +m[10] : 59;
		if (mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31 || h2 > 23 || mi2 > 59) return null;
		endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) return null;           // 源站错行 ⇒ 丢掉，不硬造
	}
	const raw = s;
	const display = endTs != null ? fmtWindow(startTs, endTs, tz) : raw;
	return { startTs, endTs, raw, display };
}
// HTML → 条目事实数组（**结构变了才抛**；时间锚点被抹掉 ⇒ 返回空数组，不抛）
//   条目形状与 bwiki 系一致：`{ _i, event, category, startTs, endTs, raw, display }`
function ns_gbf_itemsOf(html, tz = ns_gbf_TZ) {
	const tables = ns_gbf_tablesOf(html).filter((t) => new RegExp(`<th\\b[^>]*>\\s*${ns_gbf_DATE_HEAD}\\s*</th>`).test(t));
	if (tables.length === 0) throw new Error("gbf-events-changed:no-table");
	const items = [];
	const seen = new Set();
	let rows = 0;
	for (const table of tables) {
		// 列位按**表头逐字**定位（`イベント種別|回数|イベント名|ボス属性|有利属性|開催日時|備考`）：
		// 源站若插入/删掉一列，名字与档期会**整列错位**（不报错、只出错数据）⇒ 这里不许硬编码下标。
		const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => ns_gbf_cellText(h[1]));
		const kindAt = heads.indexOf("イベント種別");
		const nameAt = heads.indexOf("イベント名");
		const dateAt = heads.indexOf(ns_gbf_DATE_HEAD);
		if (nameAt < 0 || dateAt < 0) throw new Error("gbf-events-changed:no-columns");
		const need = Math.max(kindAt, nameAt, dateAt) + 1;
		for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
			const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
			if (cells.length < need) continue;         // `<thead>` 的 `<th>` 行 / 分隔行（colspan）都不算
			rows++;
			const kind = kindAt < 0 ? "" : ns_gbf_cellText(cells[kindAt]);
			const name0 = ns_gbf_cellText(cells[nameAt]);
			const win = ns_gbf_windowOf(ns_gbf_cellText(cells[dateAt]), tz);
			if (!name0 || !win) continue;
			const name = ns_gbf_PLACEHOLDER_RE.test(name0) && kind ? kind + name0 : name0;
			const key = `${name}|${win.startTs}|${win.endTs}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({
				_i: items.length,
				event: name,
				category: kind,                        // イベント種別（決戦！星の古戦場 等）—— 只用于档位排序
				startTs: win.startTs, endTs: win.endTs,
				raw: win.raw, display: win.display
			});
		}
	}
	if (rows === 0) throw new Error("gbf-events-changed:no-rows");
	return items;
}
//#endregion

//#region ③ 碧蓝幻想：抓取器（契约：async (url, signal, tz, now = nowMs()) → 载荷 | null）
let ns_gbf_cache = null;                           // { url, at, items }
function ns_gbf_resetCache() { ns_gbf_cache = null; }
async function ns_gbf_events(url, signal, tz = ns_gbf_TZ, now = nowMs()) {
	const key = String(url == null ? "" : url).trim() || ns_gbf_EVENTS_URL;
	const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
	const hit = ns_gbf_cache;
	let items;
	if (hit && hit.url === key && at >= hit.at && at - hit.at < ns_gbf_CACHE_TTL_MS) items = hit.items;
	else {
		const html = await fetchText(key, { mode: "proxy", signal });
		items = ns_gbf_itemsOf(html, tz);
		ns_gbf_cache = { url: key, at, items };
	}
	if (items.length === 0) return null;           // 时间锚点被抹掉 ⇒ 这一页没有窗口（不是失败）
	return ns_bwiki_eventPayload(items, tz, at, 0, "gbf");
}
//#endregion

//#region ④ 舰队Collection：常量
const ns_kancolle_TZ = "Asia/Tokyo";
// 活動一覧（`期間限定出撃` = 历年期間限定海域档案，新的一期在最上面）
const ns_kancolle_EVENTS_URL = "https://wikiwiki.jp/kancolle/%E6%9C%9F%E9%96%93%E9%99%90%E5%AE%9A%E5%87%BA%E6%92%83";
// 图标：DMM 网页游戏**没有 app 图标**（DMM 游戏页/官方 feature 页都不带游戏专属图），
// 这里用抓取源站自己的 favicon（wikiwiki 公共资源，实测 200 / image/x-icon）。
const ns_kancolle_ICON = "https://cdn.wikiwiki.jp/to/w/common/user-favicon.ico?v=4";
const ns_kancolle_SOURCE_LABEL = "wiki 活动一览（wikiwiki）";
const ns_kancolle_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 段位标记：每个事件 `<h2>` 里都有一个 `class="anchor_super"` 的锚点（指南类 h2 没有 ⇒ 天然被排除）
const ns_kancolle_ANCHOR = 'class="anchor_super"';
// 档期行：`期間限定！【2026/07/08～2026/09/10】【終了】`（后面的状态标记忽略）
const ns_kancolle_BOX_RE = /期間限定[！!]?\s*【([^】]{4,80})】/;
const ns_kancolle_RANGE_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[～~]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/;
// 期次后缀：`…(2026年夏イベント)` / `…（2014年夏イベント）` ⇒ 名字里去掉（档期已经说明是哪一期）
const ns_kancolle_SEASON_RE = /\s*[（(]\s*\d{4}\s*年[^）)]*[）)]\s*$/;
//#endregion

//#region ⑤ 舰队Collection：纯解析（HTML → 条目事实）
// `<h2>` 段位（只要带 `anchor_super` 的 = 事件段；每段正文到下一个 `<h2>` 为止）
function ns_kancolle_sectionsOf(html) {
	const src = String(html == null ? "" : html);
	const marks = [];
	const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
	let m;
	while ((m = re.exec(src)) !== null) marks.push({ start: m.index, end: re.lastIndex, head: m[1] });
	const out = [];
	for (let i = 0; i < marks.length; i++) {
		const { end, head } = marks[i];
		if (head.indexOf(ns_kancolle_ANCHOR) < 0) continue;
		// 名字 = 第一个 `<a`（锚点/编辑按钮）之前的那段文字
		const name = htmlTextTight(head.replace(/<a\b[\s\S]*$/i, "")).trim();
		if (!name) continue;
		const body = src.slice(end, i + 1 < marks.length ? marks[i + 1].start : end + 4000);
		out.push({ name, body });
	}
	return out;
}
// 段标题 → 事件名（去掉期次后缀；去掉后为空则保留原样）
function ns_kancolle_nameOf(head) {
	const s = String(head == null ? "" : head).replace(/\s+/g, " ").trim();
	const cut = s.replace(ns_kancolle_SEASON_RE, "").trim();
	return cut || s;
}
// HTML → 条目事实数组（**结构变了才抛**；档期被抹掉 ⇒ 返回空数组，不抛）
function ns_kancolle_itemsOf(html, tz = ns_kancolle_TZ) {
	const sections = ns_kancolle_sectionsOf(html);
	if (sections.length < 10) throw new Error("kancolle-events-changed:no-sections");
	const items = [];
	const seen = new Set();
	for (const sec of sections) {
		const box = ns_kancolle_BOX_RE.exec(sec.body);
		if (!box) continue;                        // 这一段没有档期锚点 ⇒ 如实不产出
		const m = ns_kancolle_RANGE_RE.exec(box[1]);
		if (!m) continue;
		const mo1 = +m[2], d1 = +m[3], mo2 = +m[5], d2 = +m[6];
		if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31) continue;
		const startTs = sourceInstant(+m[1], mo1, d1, 0, 0, tz);
		const endTs = sourceInstant(+m[4], mo2, d2, 23, 59, tz);
		if (!(endTs > startTs)) continue;          // 源站错行 ⇒ 丢掉，不硬造
		const name = ns_kancolle_nameOf(sec.name);
		if (!name) continue;
		const key = `${name}|${startTs}|${endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			_i: items.length,
			event: name,
			category: "",
			startTs, endTs,
			raw: box[1].trim(),
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	return items;
}
//#endregion

//#region ⑥ 舰队Collection：抓取器（契约同上）
let ns_kancolle_cache = null;                      // { url, at, items }
function ns_kancolle_resetCache() { ns_kancolle_cache = null; }
async function ns_kancolle_events(url, signal, tz = ns_kancolle_TZ, now = nowMs()) {
	const key = String(url == null ? "" : url).trim() || ns_kancolle_EVENTS_URL;
	const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
	const hit = ns_kancolle_cache;
	let items;
	if (hit && hit.url === key && at >= hit.at && at - hit.at < ns_kancolle_CACHE_TTL_MS) items = hit.items;
	else {
		const html = await fetchText(key, { mode: "proxy", signal });
		items = ns_kancolle_itemsOf(html, tz);
		ns_kancolle_cache = { url: key, at, items };
	}
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, at, 0, "kancolle");
}
//#endregion

//#region ⑦ 条目登记
// 碧蓝幻想：**卡池侧留空**（`url: ""` + 不写 `source` ⇒ 设置页/面板显示「未配置」，不发请求）；
// 活动侧 = gbf-wiki 的活动一览（标签逐字「wiki 活动一览（gbf-wiki）」）。
registerSource({
	id: "gbf",
	defaultHidden: false,
	tz: ns_gbf_TZ,
	name: "碧蓝幻想",
	icon: ns_gbf_ICON,
	url: "",
	eventUrl: ns_gbf_EVENTS_URL,
	eventSource: ns_gbf_SOURCE_LABEL
});
EVENT_FETCHERS["gbf"] = Object.assign(EVENT_FETCHERS["gbf"] || {}, {
	default: (url, signal, tz, now) => ns_gbf_events(url, signal, tz, now)
});

// 舰队Collection：卡池侧同理留空（本作没有"卡池"这一概念）；
// 活动侧 = wikiwiki 的期間限定出撃（标签逐字「wiki 活动一览（wikiwiki）」）。
registerSource({
	id: "kancolle",
	defaultHidden: false,
	tz: ns_kancolle_TZ,
	name: "舰队Collection",
	icon: ns_kancolle_ICON,
	url: "",
	eventUrl: ns_kancolle_EVENTS_URL,
	eventSource: ns_kancolle_SOURCE_LABEL
});
EVENT_FETCHERS["kancolle"] = Object.assign(EVENT_FETCHERS["kancolle"] || {}, {
	default: (url, signal, tz, now) => ns_kancolle_events(url, signal, tz, now)
});
//#endregion
