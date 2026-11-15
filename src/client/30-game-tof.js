// src/client/30-game-tof.js —— 幻塔（国服 · 完美世界 Hotta Studio）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"tof"`，**只接卡池侧**。
// 活动侧**没有可靠源**（bwiki /ht 的拟态池停在 2026-08-12；官网「版本更新公告」列表冻结在
// 2026-01-14；TapTap 是 CSR）⇒ 条目写 `eventUrl:""` = 设置页显示「未配置」，不登记活动抓取器
// （与深空之眼 `30-game-bwiki-dhmmr.js` 同一形态）。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/tof-list / tof-detail-264766 / tof-detail-264156）──
//   列表 `GET https://ht.wanmei.com/news/gamenews/index.html`
//     200 / 7,636 B / `text/html`（无 charset 声明，实测 UTF-8）/ **纯服务端渲染**。
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 `PROXY_ALLOW_HOSTS`）。
//     一页 **6 条**，源站已按日期倒序；`index.html` 是第 1 页，翻页是 `index1.html … index46.html`
//     （共 47 页 / 278 条；当期版本公告一定在第 1 页 ⇒ 本条**只读第 1 页**）。
//     条目形如（一个 `<a>` 里两行）：
//       <a href="/news/gamenews/20261027/264766.html" target="_blank">
//         <div class="top"><span class="t">2026-10-28</span><span class="n">[新闻]</span>
//                          <span class="a">时间背面的谜底 《幻塔》6.5全新版本今日上线</span></div>
//         <div class="desc">…</div></a>
//     `gamenews`（新闻）**全是「《幻塔》X.Y全新版本今日上线」**这类版本公告；
//     `gamebroad`（公告）是维护/活动公告，本条不用。
//   详情 `GET https://ht.wanmei.com/news/gamenews/YYYYMMDD/{id}.html`（同样无 ACAO ⇒ 代理）
//     200 / 6,064~6,868 B / 整页真正要的只有 `<div class="text_cont">` 里那串 `<p>`：
//       `<p>限定拟态角色「黑利·佩茵特」、限定武器「圣谕权杖」以及限定「黑利·佩茵特意志」现已上线。</p>`
//       `<p>正式服活动时间：2026年10月28日12:00-2026年12月16日04:59。</p>`
//       `<p>活动期间，授权者在“黑利·佩茵特订购活动”中可使用「赤核」进行订购，…</p>`
//     ⇒ 版本公告里**头牌限定池**的四件事都写着：池名（`X订购活动`）+ 角色 + 武器 + 起止**到分**。
//     这三个位置（角色行 / 时间行 / 池名行）在 6.3 / 6.4 / 6.5 三版里逐字同形（接这一条时三版都抓过；
//     夹具留 6.5 + 6.4 两篇，6.4 用来证明正则不是只对"当前那一版"成立，见 `cases-new5.mjs` ⑩）。
//
// ── ② 只出「两端都明确」的池（复刻 / 自选UP / 时装一律降级）────────────────────────────
//   时间行必须写成 `正式服活动时间：YYYY年M月D日HH:MM-YYYY年M月D日HH:MM`（两端都带 4 位年 + 时分）
//   才认。版本公告里其余日期都是**单边**的：
//     `全新授权者万圣时装「夜愿魅影」也将于11月1日上架`（只有上架日，没有结束）
//   ⇒ 不产出（不补钟点、不拿版本周期凑终点）。复刻/自选UP 池只写「上架」也是同理。
//   「正式服活动时间」这个标签**必须逐字出现**：它是这条来源唯一的时间锚，抹掉它 ⇒ 这一篇 0 个窗口
//   ⇒ 卡池侧如实 null（nomatch，不是失败）—— 反证在 `cases-new5.mjs` ⑩。
//
// ── ③ 请求预算（用户口径：列表 1 + 每轮只对**最新版本那篇**取详情，详情按 URL 缓存）────────────
//   第 1 轮 = 列表 1 次 + 最新版本公告详情 1 次 = **2 次**；稳态 = **1 次**（详情按 URL 缓存 24h）。
//   ⚠️ 为什么只取最新那一篇：`gamenews` 第 1 页 6 条 = 最近 6 个版本，每个版本一篇公告；
//      当期池一定写在**最新那个版本**的公告里（换版本才有新池）。旧篇只用于"这一版的池已经结束"
//      这种判断 —— 而那种情况本来就该是 null（未公布），不需要多打请求。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（找不到 `<div class="list">` / 一条 `<a>`+`.top` 都解析不出）⇒ **抛**；
//   · 列表正常但**第 1 页没有版本公告**（改版把 gamenews 换了内容）⇒ `null`（当期没有，不是失败）；
//   · 详情结构变了（没有 `<div class="text_cont">` / 没有 `<h1>`；`{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 正文正常但没有任何「两端都明确」的池 ⇒ `null`（未公布，不硬凑）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（同上）。
//
// ── ⑤ 当期现状（2026-11-15 07:20 +08 实测）────────────────────────────────────────
//   最新版本 = 6.5「时间背面的谜底」（2026-10-28 开）⇒ 卡池外显
//   `黑利·佩茵特订购活动` / 角色 `黑利·佩茵特`（限定武器 `圣谕权杖`）/ `10-28 12:00 ~ 12-16 04:59`。
//   时区 = `Asia/Shanghai`（国服官网墙钟；“到分”的时刻本身就是 UTC+8 写法）。
//
// ── ⑥ 武器只在解析层（不进载荷）────────────────────────────────────────────────────
//   `限定武器「圣谕权杖」` 是这条来源能读到的**事实**（回归在 `cases-new5.mjs` ⑩ 的逐字断言里），
//   但载荷字段是 `banner` + `roles` + 档期：`roles` 是**角色**列，把武器塞进去会让面板把武器当角色。
//   所以 `weapon` 只活在 `ns_tof_detailOf` 的池事实里，`poolItemsOf` 明确丢掉它（不新造载荷字段）。

//#region ① 常量
const ns_tof_TZ = "Asia/Shanghai";
const ns_tof_HOME = "https://ht.wanmei.com/";
const ns_tof_LIST_URL = "https://ht.wanmei.com/news/gamenews/index.html";
const ns_tof_SOURCE_LABEL = "官网公告";
// 详情解析结果按 **URL** 缓存 24h（换版本才有新 URL，不会串）
const ns_tof_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq / pcr-tw 的 30s）
const ns_tof_ROUND_TTL_MS = 30000;
// 列表段（导航里也有链接，收窄到 `.list` 容器更稳，也让静态守卫能定位）
const ns_tof_LIST_OPEN = '<div class="list">';
// 详情正文段：到「返回顶部」锚点为止（正文里可能有嵌套 div，所以**不按第一个 </div> 切**）
const ns_tof_BODY_OPEN = '<div class="text_cont">';
const ns_tof_BODY_END = '<a class="btn_gtt">';
// 条目：`<a href="/news/gamenews/YYYYMMDD/{id}.html">` + `.top` 里的日期 / 栏目 / 标题（四组）
const ns_tof_ITEM_RE = /<a\b[^>]*href="(\/news\/gamenews\/(\d{8})\/(\d+)\.html)"[^>]*>[\s\S]*?<div class="top"><span class="t">([\s\S]*?)<\/span><span class="n">([\s\S]*?)<\/span><span class="a">([\s\S]*?)<\/span><\/div>/g;
// 版本公告标题：`时间背面的谜底 《幻塔》6.5全新版本今日上线` ⇒ 6.5
const ns_tof_VERSION_RE = /《幻塔》\s*(\d+(?:\.\d+)?)\s*全新版本/;
// 角色 + 武器（同一行，源站逐字用「」括起来）
const ns_tof_ROLE_RE = /限定拟态角色「([^」]{1,40})」\s*[、,，]\s*限定武器「([^」]{1,40})」/;
// 时间锚：「正式服活动时间：…」——**唯一**的窗口标签
const ns_tof_TIME_LABEL_RE = /正式服活动时间\s*[：:]\s*([^\n]{8,160})/;
// 两端都必须带 4 位年 + 时分（只有日期 / 只有一端的不认，见文件头 ②）
const ns_tof_WINDOW_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～—–]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
// 池名：`“黑利·佩茵特订购活动”`（写在时间行**后面**那句「活动期间…」里）
const ns_tof_POOL_NAME_RE = /“([^“”]{1,40}?)订购活动”/;
// 角色行到时间行之间最多隔几行（实测 1 行：中间只隔一张图；放宽到 6 行更抗版式微调）
const ns_tof_ROLE_SPAN_LINES = 6;
// 时间行到池名行最多看几行（实测 1 行）
const ns_tof_NAME_SPAN_LINES = 4;
//#endregion

//#region ② 纯解析：列表
// 列表页 → `[{ id, href, url, date, label, title, version, dateTs }]`，按日期倒序（源站本来倒序，这里再稳一次）。
// **结构变了要抛**：找不到 `.list` 容器、或一条都解析不出（`{}` / 改版页 / 空串都落这里）。
function ns_tof_listOf(html) {
	const src = String(html == null ? "" : html);
	if (src.indexOf(ns_tof_LIST_OPEN) < 0) throw new Error("tof-list-changed:no-list");
	const out = [];
	ns_tof_ITEM_RE.lastIndex = 0;
	let m;
	while ((m = ns_tof_ITEM_RE.exec(src)) !== null) {
		const title = decodeExtra(stripTags(m[6])).replace(/\s+/g, " ").trim();
		const date = String(m[4] || "").replace(/\s+/g, " ").trim();
		out.push({
			id: String(m[3]),
			href: String(m[1]),
			url: ns_tof_HOME.replace(/\/$/, "") + String(m[1]),
			date,
			label: decodeExtra(stripTags(m[5])).replace(/\s+/g, " ").trim(),
			title,
			version: (ns_tof_VERSION_RE.exec(title) || [])[1] || "",
			dateTs: ns_tof_dateTsOf(date)
		});
	}
	if (out.length === 0) throw new Error("tof-list-changed:no-item");
	// 源站已倒序；这里再稳一次（同日按 id 倒序，与 pcr-tw 同一口径）
	return out.sort((x, y) => ((y.dateTs || 0) - (x.dateTs || 0)) || (Number(y.id) - Number(x.id)));
}
// `2026-10-28`（列表上的日期）→ 该日 00:00 的绝对毫秒（只用于排序，不做窗口语义）
function ns_tof_dateTsOf(s) {
	const m = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(String(s == null ? "" : s));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], 0, 0, ns_tof_TZ);
}
// 最新版本公告那一行（列表里没有版本公告 ⇒ null = 当期没有，不是失败）
function ns_tof_versionRowOf(rows) {
	const list = Array.isArray(rows) ? rows : [];
	const hits = list.filter((r) => r && r.version);
	return hits.length ? hits[0] : null;
}
//#endregion

//#region ③ 纯解析：详情
// 详情页 → 正文行数组（`<br>` / `</p>` 当行边界，其余标签不插分隔符）。
// 没有 `<div class="text_cont">` ⇒ null（结构变了，调用方抛）。
// ⚠️ **不按第一个 `</div>` 收尾**：正文容器里可能出现嵌套块（图注 / 视频），
//    按容器切会在那里截断 ⇒ 用「返回顶部」锚点 `<a class="btn_gtt">` 当正文结束标记。
function ns_tof_linesOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_tof_BODY_OPEN);
	if (a < 0) return null;
	const rest = src.slice(a + ns_tof_BODY_OPEN.length);
	const e = rest.indexOf(ns_tof_BODY_END);
	const body = e >= 0 ? rest.slice(0, e) : rest;
	return body
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情页 → `{ title, date, pools:[{ banner, role, weapon, startTs, endTs, raw, display }] }`。
// **没有正文容器 / 没有 `<h1>` ⇒ 抛**（`{}` / 空串 / 改版页）；有正文但没有「两端都明确」的池 ⇒ `pools: []`。
function ns_tof_detailOf(html, tz = ns_tof_TZ) {
	const src = String(html == null ? "" : html);
	const lines = ns_tof_linesOf(src);
	if (lines == null) throw new Error("tof-detail-changed:no-body");
	// 标题只在正文**之前**找（详情页导航里没有 h1，但别指望这一点）
	const before = src.slice(0, src.indexOf(ns_tof_BODY_OPEN));
	const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(before);
	if (!h) throw new Error("tof-detail-changed:no-title");
	const title = decodeExtra(stripTags(h[1])).replace(/\s+/g, " ").trim();
	// 页头 `<h3><span>2026-10-28</span><span>《幻塔》手游官网</span></h3>`
	const d = /<h3[^>]*>[\s\S]*?<span[^>]*>\s*(\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2})\s*<\/span>/i.exec(before);
	const date = d ? d[1].replace(/\s+/g, "") : "";
	const pools = [];
	const seen = new Set();
	// 状态机：角色行记下 `{ role, weapon, at }`；随后的时间行消费它（用过即清，免得一条角色行配多条时间行）
	let pending = null;
	for (let i = 0; i < lines.length; i++) {
		const rm = ns_tof_ROLE_RE.exec(lines[i]);
		if (rm) {
			pending = { role: rm[1].trim(), weapon: rm[2].trim(), at: i };
			continue;
		}
		const lm = ns_tof_TIME_LABEL_RE.exec(lines[i]);
		if (!lm) continue;
		const wm = ns_tof_WINDOW_RE.exec(lm[1]);
		if (!wm) continue;                                   // 单边/无年份 ⇒ 不认（见文件头 ②）
		const role = pending && i - pending.at <= ns_tof_ROLE_SPAN_LINES ? pending : null;
		pending = null;
		if (!role) continue;                                 // 没有角色行 ⇒ 不是限定池
		const startTs = sourceInstant(+wm[1], +wm[2], +wm[3], +wm[4], +wm[5], tz);
		const endTs = sourceInstant(+wm[6], +wm[7], +wm[8], +wm[9], +wm[10], tz);
		if (startTs == null || endTs == null || !(endTs > startTs)) continue;   // 源站错行 ⇒ 丢掉
		const pool = ns_tof_poolNameOf(lines, i);
		// 池名优先取正文里那对引号（源站自己的写法）；取不到按源站命名规律由角色名派生（`X订购活动`）
		const banner = pool || `${role.role}订购活动`;
		const key = `${banner}|${startTs}|${endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		pools.push({
			banner,
			role: role.role,
			weapon: role.weapon,
			startTs,
			endTs,
			raw: wm[0],
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	return { title, date, pools };
}
// 时间行之后的池名（`“X订购活动”`）；找不到 ⇒ 空串（交给调用方按角色名派生）
function ns_tof_poolNameOf(lines, at) {
	for (let j = at + 1; j <= at + ns_tof_NAME_SPAN_LINES && j < lines.length; j++) {
		const m = ns_tof_POOL_NAME_RE.exec(lines[j]);
		if (m) return `${m[1].trim()}订购活动`;
	}
	return "";
}
// 详情 → 卡池条目事实（每口池一条；`weapon` 留在解析层，见文件头 ⑥）
function ns_tof_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const items = [];
	for (const p of Array.isArray(d.pools) ? d.pools : []) {
		items.push({
			_i: items.length,
			banner: p.banner,
			roles: p.role,
			startTs: p.startTs,
			endTs: p.endTs,
			raw: p.raw,
			display: p.display,
			isMain: true
		});
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_tof_listCache = null;                 // { url, round, at, promise }
let ns_tof_detailCache = new Map();          // 详情 URL → { at, value:{ title, date, pools } }
function ns_tof_resetCache() { ns_tof_listCache = null; ns_tof_detailCache = new Map(); }
// 列表：一轮刷新里现取一次（轮外 / 设置页「测试来源」也现取），轮内 30s 复用同一个 promise
async function ns_tof_rowsOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_tof_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_tof_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_tof_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchText(key, { mode: "proxy", referer: ns_tof_HOME, signal })
			.then((html) => ns_tof_listOf(html));
		ns_tof_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_tof_listCache && ns_tof_listCache.promise === promise) ns_tof_listCache = null; });
	}
	return promise;
}
// 版本公告详情：按 URL 缓存 24h（换版本换 URL ⇒ 自然失效）
async function ns_tof_detailOfRow(row, signal, tz, now) {
	const hit = row && ns_tof_detailCache.get(row.url);
	if (hit && now - hit.at < ns_tof_CACHE_TTL_MS) return hit.value;
	const html = await fetchText(row.url, { mode: "proxy", referer: ns_tof_HOME, signal });
	const value = ns_tof_detailOf(html, tz);
	ns_tof_detailCache.set(row.url, { at: now, value });
	return value;
}
// 卡池侧：列表 1 次 → 最新版本公告 1 次（缓存内 0 次）→ 覆盖 now 的池（没有就 null）
async function ns_tof_gacha(url, signal, tz = ns_tof_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const rows = await ns_tof_rowsOf(url, signal);
	const row = ns_tof_versionRowOf(rows);
	if (!row) return null;                                   // 第 1 页没有版本公告 ⇒ 当期没有
	const detail = await ns_tof_detailOfRow(row, signal, tz, at);
	const items = ns_tof_poolItemsOf(detail);
	if (items.length === 0) return null;                     // 有公告但没有两端明确的池 ⇒ 未公布
	return ns_bwiki_batchGachaPayloadOf(items, tz, at, { id: "tof" });
}
//#endregion

//#region ⑤ 条目登记
// 卡池来源标签按任务书提议「官网公告」；活动侧**留空** = 显示「未配置」（见文件头 ①）。
registerSource({
	id: "tof",
	defaultHidden: false,
	tz: ns_tof_TZ,
	name: "幻塔",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/6d/f5/a0/6df5a0a7-6ae6-9b9c-310a-1c4515c42cf3/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
	url: ns_tof_LIST_URL,
	source: ns_tof_SOURCE_LABEL,
	eventUrl: ""
});
GACHA_FETCHERS["tof"] = (url, signal, tz, now) => ns_tof_gacha(url, signal, tz, now);
//#endregion
