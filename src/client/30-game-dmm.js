// src/client/30-game-dmm.js —— DMM：舰队Collection·日服（kancolle）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-batch3.js 的 ② 段拆出；条目 + 解析器 + 抓取器 + 登记都在本文件。
// 源：wikiwiki「期間限定出撃」单页档案（历年大型活动：`<h2>` 事件名 + `期間限定！【起～止】`）。
// 卡池侧 `url: ""` 未配置（本作没有「卡池」这一概念）。
// 复用关系：公共层 `ns_bwiki_eventPayload`（bwiki 载荷生成器）+ fmtWindow / sourceInstant；符号名不变。
// 请求预算：1 次/轮（解析结果按 URL 缓存 24h ⇒ 稳态 1 次/天）。

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

//#region ④ 舰队Collection：常量
const ns_kancolle_TZ = "Asia/Tokyo";
// 活動一覧（`期間限定出撃` = 历年期間限定海域档案，新的一期在最上面）
const ns_kancolle_EVENTS_URL = "https://wikiwiki.jp/kancolle/%E6%9C%9F%E9%96%93%E9%99%90%E5%AE%9A%E5%87%BA%E6%92%83";
// 图标：DMM 网页游戏**没有 app 图标**（DMM 游戏页/官方 feature 页都不带游戏专属图），
// 这里用抓取源站自己的 favicon（wikiwiki 公共资源，实测 200 / image/x-icon）。
// 图标 = 官方运营账号「艦これ」開発/運営（@KanColle_STAFF）的**头像**，**外链、不入库**（遵守 README「不存储任何游戏资源」）。
// 为什么不用 App Store / 官网：舰これ 是 DMM 页游，App Store / Google Play 都没有上架；
//   官网域名 www.kancolle.dmm.com 已 NXDOMAIN（DoH status=3），无官网静态资源可取。
// 为什么不用 Bwiki 的游戏 logo：那张是 300×80 宽幅图，面板图标位 20×20 + object-fit:cover
//   会裁成正中间 —— 实测裁切后是**空白**（文字在两侧），不能用。
// ⚠️ 2026-11-18 修：原值误用了 **wikiwiki 站点 favicon**（`cdn.wikiwiki.jp/.../user-favicon.ico`），面板显示的是 wiki 图标。
// 代价：依赖 unavatar（第三方头像代理，直接 pbs.twimg.com 在本网络不可达）；它会跟随官方换头像。
const ns_kancolle_ICON = "https://unavatar.io/x/KanColle_STAFF";
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

// 舰队Collection：卡池侧同理留空（本作没有"卡池"这一概念）；
// 活动侧 = wikiwiki 的期間限定出撃（标签逐字「wiki 活动一览（wikiwiki）」）。
registerSource({
	id: "kancolle",
	// 卡池侧未配置（`url` 为空）⇒ 出厂隐藏（用户 2026-11-19 口径）。
	defaultHidden: true,
	tz: ns_kancolle_TZ,
	name: "舰队Collection·日服",
	icon: ns_kancolle_ICON,
	url: "",
	eventUrl: ns_kancolle_EVENTS_URL,
	eventSource: ns_kancolle_SOURCE_LABEL
});
EVENT_FETCHERS["kancolle"] = Object.assign(EVENT_FETCHERS["kancolle"] || {}, {
	default: (url, signal, tz, now) => ns_kancolle_events(url, signal, tz, now)
});
