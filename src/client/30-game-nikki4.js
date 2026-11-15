// src/client/30-game-nikki4.js —— 闪耀暖暖·国服（官网「资讯快报」：卡池 + 活动**同源**）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族）：唯一来源 `id:"nikki4"`，卡池侧与活动侧**共用官网首页那份
// `__NEXT_DATA__`**（详情按 id 缓存），标签逐字「官网公告」。时区 `Asia/Shanghai`。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/nikki4-home + nikki4-detail-{102568,102571,102574,102582,102583}）──
//   列表 `GET https://nikki4.papegames.cn/`（Next.js SSG）
//     200 / 48,203 B / **服务端渲染**，数据在 `<script id="__NEXT_DATA__">` 的
//     `props.pageProps.pageData.newsbanner`：**4 条**（编辑精选的 4 格，不是时间序）——
//     每条 `{ id, title, info:"https://nikki4.papegames.cn/news/{新闻id}?utm_source", stime }`。
//     ⚠️ 数组元素自己的 `id`（8/9/6/10）是**栏目格子 id**、不是新闻 id；新闻 id 只能从 `info` 里取
//        （`/news/102583`）。`stime` 也不是新闻发布时间（与详情页 `publish_time` 差好几个月）⇒ 只用来兜底。
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 PROXY_ALLOW_HOSTS）。
//   详情 `GET https://nikki4.papegames.cn/news/{id}`（同样 Next.js）
//     200 / 37~39 KB / 数据在 `__NEXT_DATA__` 的 `props.pageProps.pageData`：
//     `{ title, publish_time:"YYYY-MM-DD HH:MM:SS", id, section, content_html, prev_id, next_id }`。
//     `content_html` 是**每段一个 `<p>`**（不是 Word 富文本那种一字一 `<span>`），行切法稳定。
//     ⚠️ 不存在的 id 回 200 + **骨架页**（`pageData` 为空）：实测 102588+ 都是这种 ⇒ 视作「结构变了」抛。
//   ⚠️ `/api/news` 是 404（实测），**别走 API**；`/newslist` 也只是一页同样的 4 条精选。
//
// ── ② 档期写法（实测 5 篇）────────────────────────────────────────────────────────
//   `🎁活动时间：` ⏎ `11月5日更新后-11月18日23:59`                     ← 锚点与档期**分两行**（102583）
//   `❤️活动时间：11月5日更新后-11月18日23:59`                          ← 同行（102574）
//   `⭐第42册【时尚提升计划】活动时间：2026年11月16日5:00-2027年1月17日 23:59` ← 两端绝对时刻 + 跨年（102582）
//   `活动时间&兑换时间：11月5日更新后-11月18日23:59`                    ← 锚点带 `&兑换时间` 尾巴
//   ⚠️ 只认下面这几条锚点：`活动时间` / `感应时间` / `阁时间`（任务口径点名「活动时间/阁时间」）。
//      `兑换时间` / `秀场兑换时间` / `预购时间` / `正式开售` **不是**活动本体档期，不单独成条
//      （`活动时间&兑换时间：…` 这种合写仍按「活动时间」那条读）。
//   ⚠️ `X月X日更新后长期开放`（没有终点）/ 只有「11月5日更新后，…即将开启」这种**叙述句**（没有终点）
//      都构不成窗口 ⇒ 0 条（不硬凑）。
//
// ── ③ 「更新后」怎么锚定（唯一一处钟点推定，用户 2026-11-09 口径：钟点直接锚定，不去解析维护公告）──
//   闪暖的档期起点大量写成「**M月D日更新后**」——日期明确、时分不给。按仓库既有口径
//   （`23-parser-time.js` 的 `anchorStartOf`：「有日期（带不带『版本更新后』都一样）⇒ 该日 anchorHour:00」），
//   本文件锚定 **当日 09:30**（+08）：官方维护公告的固定写法是「将于 M月D日 **04:00-09:30** 进行维护更新」、
//   完成公告写「已于 M月D日 **9:30** 完成停服维护更新」⇒「更新后」= 09:30。
//   依据（两处官方口径，2026-07 与 2026-05 的公告都这么写）：
//     · 国服维护公告（微信公众号）「7月9日 04:00-09:30 进行维护更新」；
//     · 台服官网同款公告「將於 3月4日 **04:00-09:30** 進行維護更新」。
//   ⇒ 这不是"猜一个钟点"：它是维护公告给的**结束时刻**，只是没写在这一篇正文里。
//   ⚠️ 这样锚定后，「更新后」条目**能进外显**，但 `raw` 保留源站原文（悬停照旧显示「11月5日更新后 ~ …」），
//      所以"钟点是我们锚的"这层信息不会丢（见 `hoverWindowTextOf` 的相对表述分支）。
//   ⚠️ 两端都写绝对时刻的（102582）**不做任何锚定**，原样解析。
//
// ── ④ 请求预算（用户口径：列表 1 + 新详情，详情按 id 缓存 TTL 24h，已结束不再取）──────────
//   第 1 轮 = 列表 1 次 + 最多 4 篇详情（首页精选一共 4 条 ⇒ `ns_nikki4_MAX_DETAILS = 4`）⇒ 实测 5 次。
//   稳态 = 1 次（只列表；详情按 id 缓存 24h，且**窗口全都结束过的详情永不重取**）。
//   两侧**共用同一次采集**（轮内 promise 缓存，与 wxnn 同一套）。
//
// ── ⑤ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（没有 `__NEXT_DATA__` / 没有 `pageData.newsbanner` / 一条新闻 id 都取不到）⇒ **抛**
//     （`nikki4-list-changed:*`）；
//   · 详情结构变了（没有 `__NEXT_DATA__` / 没有 `pageData` / 标题与正文都空）⇒ **抛**
//     （`nikki4-detail-changed:*`；`{}` / 空串 / 不存在的 id 的骨架页都落这里）；
//   · 正文正常但没有锚点、或锚点两端不齐 ⇒ 这一篇 0 个窗口（**不抛、也不硬凑**）；
//   · 详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑥ 卡池 / 活动怎么分 ───────────────────────────────────────────────────────────
//   锚点本身是 `阁时间` / `感应时间` ⇒ 卡池；否则看「锚点行前缀 + 名字」里有没有
//   `套装 | 感应 | 阁 | 幻之海 | 流光 | 抽` ⇒ 卡池，有 `累充 | 福利 | 活动 | 计划 | 赛季 | 家园`
//   ⇒ 活动；两边都不沾 ⇒ **归活动**（宁可放活动列，也不假装卡池）。
//
// ── ⑦ 当期现状（2026-11-15 实测）──────────────────────────────────────────────────
//   首页精选 4 条 = 102568（概念PV，无锚点）/ 102571（套装预告，只有起点）/ 102574（限定累充福利）/
//   102583（「改造吧！PP游戏！」福利活动）；后两篇的档期都是 `11月5日更新后-11月18日23:59`
//   ⇒ 活动侧在期（锚定 11-05 09:30 ~ 11-18 23:59）；**卡池侧当日 null**（精选里没有「限时感应/幻之海」帖）。
//   时区 = `Asia/Shanghai`（国服墙钟）。

//#region ① 常量
const ns_nikki4_TZ = "Asia/Shanghai";
const ns_nikki4_LIST_URL = "https://nikki4.papegames.cn/";
const ns_nikki4_DETAIL_BASE = "https://nikki4.papegames.cn/news/";
const ns_nikki4_SOURCE_LABEL = "官网公告";
const ns_nikki4_ICON = "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e0/fb/00/e0fb0062-4bbc-423f-2c1c-e1cefbd0399f/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg";
// 首页精选一共 4 条 ⇒ 每轮最多取 4 篇详情（见文件头 ④）
const ns_nikki4_MAX_DETAILS = 4;
// 详情解析结果缓存 TTL = 24h（按 id 缓存；换公告不会串）
const ns_nikki4_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 「更新后」的钟点锚（当日 09:30 +08；依据见文件头 ③）
const ns_nikki4_UPDATE_ANCHOR = { h: 9, mi: 30 };
const ns_nikki4_NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const ns_nikki4_SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const ns_nikki4_BLOCK_END_RE = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|table|section|blockquote)>/gi;
// 锚点行：`<前缀>活动时间[&兑换时间]：<值>`（值可同行或下一行）
const ns_nikki4_ANCHOR_RE = /^(.*?)(阁时间|感应时间|活动时间)\s*(?:[&＆]\s*(?:兑换时间|兑换))?\s*[：:]\s*(.*)$/;
// 档期：两端都必须是「[YYYY年]M月D日 + (H:MM | 更新后)」，但**终点不允许是「更新后」**
const ns_nikki4_WINDOW_RE = new RegExp(
	String.raw`^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(更新后))\s*`
	+ String.raw`[-~～—–－至到]\s*`
	+ String.raw`(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[（(][^）)]*[）)])?$`
);
// 时区后缀（`(UTC+8)` / `（服务器时间）`）—— 剥掉，不进悬停
const ns_nikki4_SUFFIX_RE = /[\s]*[（(]\s*(?:UTC\s*\+\s*8|GMT\s*\+\s*8|服务器时间)\s*[）)]\s*$/i;
// 归属关键词（见文件头 ⑥）：
// ⚠️ `套装` **不算**卡池信号 —— 累充/福利活动的标题里常写「稀有套装…」（实测 102574 就是这种情况，
//    第一版把它误判成卡池）。只认真正的「阁/感应」词，其余**默认活动**。
const ns_nikki4_GACHA_RE = /感应|感應|阁|閣|幻之海|流光|抽/;
const ns_nikki4_EVENT_RE = /累充|福利|活动|活動|计划|計劃|赛季|賽季|家园|家園|礼包|禮包/;
// 标题尾巴（`| 11月5日更新` / `| 11月16日上线`）与栏目前缀（`【福利活动】`）
const ns_nikki4_TITLE_TAIL_RE = /\s*[|｜]\s*[^|｜]{0,24}$/;
const ns_nikki4_TITLE_HEAD_RE = /^【[^】]{1,20}】\s*/;
// 名字行里的名字（`参与【改造吧！PP游戏！】福利活动` / `「…」`）
const ns_nikki4_BRACKET_RE = /【([^】]{1,30})】|「([^」]{1,30})」/;
//#endregion

//#region ② 纯解析：列表
// Next.js 页面 → `__NEXT_DATA__` 的 JSON；没有 marker / JSON 坏 ⇒ null（调用方按结构变了抛）
function ns_nikki4_nextDataOf(html) {
	const m = ns_nikki4_NEXT_DATA_RE.exec(String(html == null ? "" : html));
	if (!m) return null;
	try { return JSON.parse(m[1]); } catch { return null; }
}
// 新闻发布时间 `2026-11-01 21:23:29` → 绝对毫秒（按条目 tz 解释墙钟）；读不出 ⇒ 0
function ns_nikki4_publishTsOf(v, tz = ns_nikki4_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/.exec(String(v == null ? "" : v).trim());
	if (!m) return 0;
	return sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Number(m[4]) : 0, m[5] != null ? Number(m[5]) : 0, tz);
}
// 新闻 id 只能从 `info` 的 `/news/{id}` 里取（数组元素自己的 id 是栏目格子 id，见文件头 ①）
function ns_nikki4_newsIdOf(info) {
	const m = /\/news\/(\d+)/.exec(String(info == null ? "" : info));
	return m ? m[1] : "";
}
// 首页 → `[{ id, title, url, publishTs }]`，按新闻 id 倒序（= 越新越靠前；精选格子的顺序是编辑排的）。
// **结构变了要抛**：没有 `__NEXT_DATA__` / 没有 `pageData.newsbanner` / 一条新闻 id 都没有。
function ns_nikki4_homeOf(html, tz = ns_nikki4_TZ) {
	const j = ns_nikki4_nextDataOf(html);
	if (!j) throw new Error("nikki4-list-changed:no-next-data");
	const pd = j.props && j.props.pageProps && j.props.pageProps.pageData;
	if (!pd || typeof pd !== "object") throw new Error("nikki4-list-changed:no-page-data");
	const list = Array.isArray(pd.newsbanner) ? pd.newsbanner : null;
	if (list == null) throw new Error("nikki4-list-changed:no-newsbanner");
	const out = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = ns_nikki4_newsIdOf(it.info);
		if (!id) continue;
		out.push({
			id,
			title: htmlTextTight(it.title == null ? "" : it.title),
			url: ns_nikki4_DETAIL_BASE + id,
			publishTs: ns_nikki4_publishTsOf(it.stime, tz)
		});
	}
	if (out.length === 0) throw new Error("nikki4-list-changed:no-news");
	return out.sort((x, y) => Number(y.id) - Number(x.id));
}
//#endregion

//#region ③ 纯解析：详情（正文行 → 锚点 → 条目事实）
// 详情页 → `pageData`（`{ title, publishTs, id, contentHtml }`）。
// **结构变了要抛**：没有 `__NEXT_DATA__` / 没有 `pageData` / 标题与正文都空（不存在的 id 的骨架页）。
function ns_nikki4_pageOf(html, tz = ns_nikki4_TZ) {
	const j = ns_nikki4_nextDataOf(html);
	if (!j) throw new Error("nikki4-detail-changed:no-next-data");
	const pd = j.props && j.props.pageProps && j.props.pageProps.pageData;
	if (!pd || typeof pd !== "object") throw new Error("nikki4-detail-changed:no-page-data");
	const title = htmlTextTight(pd.title == null ? "" : pd.title);
	const contentHtml = String(pd.content_html == null ? "" : pd.content_html);
	if (!title && contentHtml.trim() === "") throw new Error("nikki4-detail-changed:empty-page");
	return { id: pd.id, title, publishTs: ns_nikki4_publishTsOf(pd.publish_time, tz), contentHtml };
}
// `content_html` → 行数组（`<br>` / 块级收尾当行边界，实体解一遍）
function ns_nikki4_linesOf(contentHtml) {
	const html = String(contentHtml == null ? "" : contentHtml)
		.replace(ns_nikki4_SCRIPT_RE, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(ns_nikki4_BLOCK_END_RE, "\n");
	return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// 一段档期 → `{ startTs, endTs, raw, rawOriginal, display }`；两端不齐 / 源站错行 ⇒ null（不硬凑）。
// 「更新后」起点锚定当日 `ns_nikki4_UPDATE_ANCHOR`（见文件头 ③）。
function ns_nikki4_windowOf(text, hint, tz = ns_nikki4_TZ) {
	const s = String(text == null ? "" : text).replace(ns_nikki4_SUFFIX_RE, "").trim();
	const m = ns_nikki4_WINDOW_RE.exec(s);
	if (!m) return null;
	const sm = Number(m[2]), sd = Number(m[3]);
	const startY = inferYear(m[1] != null ? Number(m[1]) : null, sm, hint);
	if (startY == null) return null;
	const openStart = m[6] != null;
	const startTs = openStart
		? sourceInstant(startY, sm, sd, ns_nikki4_UPDATE_ANCHOR.h, ns_nikki4_UPDATE_ANCHOR.mi, tz)
		: sourceInstant(startY, sm, sd, Number(m[4]), Number(m[5]), tz);
	const em = Number(m[8]), ed = Number(m[9]);
	const endY = m[7] != null ? Number(m[7]) : startY + (endsNextYear(sm, sd, em, ed) ? 1 : 0);
	const endTs = sourceInstant(endY, em, ed, Number(m[10]), Number(m[11]), tz);
	if (!(endTs > startTs)) return null;
	const rawOriginal = s;
	const raw = s.replace(/\s*[-~～—–－至到]\s*/, " ~ ");
	return { startTs, endTs, raw, rawOriginal, display: fmtWindow(startTs, endTs, tz), openStart };
}
// 锚点行前缀 + 名字 → 归属（见文件头 ⑥）
function ns_nikki4_kindOf(anchorWord, prefix, name) {
	if (anchorWord === "阁时间" || anchorWord === "感应时间") return "gacha";
	const hay = `${String(prefix == null ? "" : prefix)} ${String(name == null ? "" : name)}`;
	if (ns_nikki4_GACHA_RE.test(hay)) return "gacha";
	if (ns_nikki4_EVENT_RE.test(hay)) return "event";
	return "event";
}

// 标题 → 可读名：剥栏目前缀 `【…】` 与尾巴 `| 11月5日更新`
function ns_nikki4_titleNameOf(title) {
	let s = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
	s = s.replace(ns_nikki4_TITLE_HEAD_RE, "").replace(ns_nikki4_TITLE_TAIL_RE, "").trim();
	return s || String(title == null ? "" : title).trim();
}
// 窗口的名字：锚点行前缀里的 `【…】/「…」` 优先，其次往上 3 行里**带活动语境**的名字，最后退回标题派生。
function ns_nikki4_nameOf(lines, at, prefix, title) {
	const pre = ns_nikki4_BRACKET_RE.exec(String(prefix == null ? "" : prefix));
	if (pre) return String(pre[1] || pre[2] || "").trim();
	const list = Array.isArray(lines) ? lines : [];
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const line = String(list[j] == null ? "" : list[j]);
		if (!/活动|活動|感应|感應|开启|開啟|参与|參與|阁|閣/.test(line)) continue;
		const m = ns_nikki4_BRACKET_RE.exec(line);
		if (m) return String(m[1] || m[2] || "").trim();
	}
	return ns_nikki4_titleNameOf(title);
}
// 详情 → 事实 `{ id, title, publishTs, windows:[{ name, kind, startTs, endTs, raw, rawOriginal, display }] }`
function ns_nikki4_factsOf(row, page, tz = ns_nikki4_TZ) {
	const lines = ns_nikki4_linesOf(page.contentHtml);
	const hint = page.publishTs ? sourceWallParts(page.publishTs, tz) : null;
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const a = ns_nikki4_ANCHOR_RE.exec(lines[i]);
		if (!a) continue;
		const value = String(a[3] || "").trim() || lines[i + 1] || "";
		const w = ns_nikki4_windowOf(value, hint, tz);
		if (!w) continue;                                     // 只有一端 / 长期开放 ⇒ 不是窗口（不硬凑）
		const name = ns_nikki4_nameOf(lines, i, a[1], page.title || row.title);
		if (!name) continue;
		const kind = ns_nikki4_kindOf(a[2], a[1], name);
		const key = `${kind}|${w.startTs}|${w.endTs}|${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({ name, kind, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawOriginal: w.rawOriginal, display: w.display, openStart: w.openStart });
	}
	return { id: row.id, title: page.title || row.title, publishTs: page.publishTs || row.publishTs, windows };
}
// 事实 → 卡池条目事实（池名 = 窗口名；roles 留空 —— 源站没有「池名：角色」的分离写法）
function ns_nikki4_poolItemsOf(fact) {
	const items = [];
	for (const w of fact && Array.isArray(fact.windows) ? fact.windows : []) {
		if (w.kind !== "gacha") continue;
		items.push({ _i: items.length, banner: w.name, roles: "", startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display, isMain: true });
	}
	return items;
}
// 事实 → 活动条目事实
function ns_nikki4_eventItemsOf(fact) {
	const items = [];
	for (const w of fact && Array.isArray(fact.windows) ? fact.windows : []) {
		if (w.kind !== "event") continue;
		items.push({ _i: items.length, event: w.name, category: "", startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 缓存两级：详情按 id（TTL 24h；**窗口全都结束过的详情永不重取**）+ 轮内共享同一份采集 promise。
let ns_nikki4_detailCache = new Map();        // id → { at, fact }
let ns_nikki4_roundCache = { round: -1, promise: null };
function ns_nikki4_resetCache() { ns_nikki4_detailCache = new Map(); ns_nikki4_roundCache = { round: -1, promise: null }; }
function ns_nikki4_sealedOf(fact, now) {
	const all = fact && Array.isArray(fact.windows) ? fact.windows : [];
	if (all.length === 0) return true;
	return all.every((w) => w.endTs != null && w.endTs < now);
}
function ns_nikki4_cachedOf(id, now) {
	const hit = ns_nikki4_detailCache.get(id);
	if (!hit) return null;
	if (ns_nikki4_sealedOf(hit.fact, now)) return hit;
	return now - hit.at < ns_nikki4_CACHE_TTL_MS ? hit : null;
}
// 首页 → 详情 → 事实数组。详情全部失败且一条都没解析出来 ⇒ 抛（抓取失败 ≠ 未公布）。
async function ns_nikki4_collect(url, signal, tz, now) {
	const listUrl = String(url == null ? "" : url).trim() || ns_nikki4_LIST_URL;
	const rows = ns_nikki4_homeOf(await fetchText(listUrl, { mode: "proxy", referer: ns_nikki4_LIST_URL, signal }), tz);
	const facts = [];
	let firstErr = null, parsed = 0;
	for (const row of rows.slice(0, ns_nikki4_MAX_DETAILS)) {
		const hit = ns_nikki4_cachedOf(row.id, now);
		if (hit) { facts.push(hit.fact); continue; }
		try {
			const page = ns_nikki4_pageOf(await fetchText(row.url, { mode: "proxy", referer: ns_nikki4_LIST_URL, signal }), tz);
			const fact = ns_nikki4_factsOf(row, page, tz);
			ns_nikki4_detailCache.set(row.id, { at: now, fact });
			parsed++;
			facts.push(fact);
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (parsed === 0 && firstErr) throw firstErr;
	return facts;
}
function ns_nikki4_collectInRound(url, signal, tz, now) {
	const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
	if (round > 0 && ns_nikki4_roundCache.round === round && ns_nikki4_roundCache.promise) return ns_nikki4_roundCache.promise;
	const promise = ns_nikki4_collect(url, signal, tz, now);
	if (round > 0) {
		ns_nikki4_roundCache = { round, promise };
		promise.catch(() => { if (ns_nikki4_roundCache.promise === promise) ns_nikki4_roundCache = { round: -1, promise: null }; });
	}
	return promise;
}
async function ns_nikki4_gacha(url, signal, tz = ns_nikki4_TZ, now = nowMs()) {
	const facts = await ns_nikki4_collectInRound(url, signal, tz, now);
	const items = [];
	for (const fact of facts) for (const it of ns_nikki4_poolItemsOf(fact)) items.push(Object.assign({}, it, { _i: items.length }));
	if (items.length === 0) return null;                       // 精选里没有带窗口的「阁/感应」帖 ⇒ 未公布
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "nikki4" });
}
async function ns_nikki4_events(url, signal, tz = ns_nikki4_TZ, now = nowMs()) {
	const facts = await ns_nikki4_collectInRound(url, signal, tz, now);
	const items = [];
	for (const fact of facts) for (const it of ns_nikki4_eventItemsOf(fact)) items.push(Object.assign({}, it, { _i: items.length }));
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "nikki4");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条首页 URL**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告」。
registerSource({
	id: "nikki4",
	defaultHidden: false,
	tz: ns_nikki4_TZ,
	name: "闪耀暖暖",
	icon: ns_nikki4_ICON,
	url: ns_nikki4_LIST_URL,
	source: ns_nikki4_SOURCE_LABEL,
	eventUrl: ns_nikki4_LIST_URL,
	eventSource: ns_nikki4_SOURCE_LABEL
});
GACHA_FETCHERS["nikki4"] = (url, signal, tz, now) => ns_nikki4_gacha(url, signal, tz, now);
EVENT_FETCHERS["nikki4"] = Object.assign(EVENT_FETCHERS["nikki4"] || {}, {
	default: (url, signal, tz, now) => ns_nikki4_events(url, signal, tz, now)
});
//#endregion
