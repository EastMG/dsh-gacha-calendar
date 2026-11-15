// src/client/30-game-pcr-tw.js —— 公主连结 Re:Dive·繁中服（So-net 官网公告：卡池 + 活动**同源**）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"pcr-tw"`，
// 卡池侧与活动侧**共用一份公告列表**，标签逐字「官网公告」。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/pcr-tw-list / -list-2 / -list-3 / detail-{4106,4117,4115}）──
//   列表 `GET https://www.princessconnect.so-net.tw/news?page=1`（翻页 = `?page=2` / `?page=3`）
//     200 / 58,895 B / `content-type: text/html; charset=UTF-8` / **服务端渲染**（无 JS）
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 `PROXY_ALLOW_HOSTS`）。
//     一页 10 条，源站**已按日期倒序**；`page=1..5` 都实测 200 且结构逐字相同（本条按页前进，上限见 ③）。
//     条目 = `<li>` 三件套：`<time datetime="YYYY.MM.DD">` + `<span class="ac0X">類型</span>` +
//            `<a href="/news/newsDetail/{id}">標題</a>`（整页只有 10 个 newsDetail 链接，全在 `<article class="news_con">` 里）。
//     ⚠️ 页面是**日期倒序、同日按发布先后（id 升序）**：2026-11-15 19:16 实测第 1 页
//        = `4118,4119,4120,4121,4122,4123`（都 11-15，id 升序）+ `4116,4117`（11-14）+ `4115`（11-13）+ `4125`（11-11）；
//        第 2 页 = `4111`（11-09）… `4106,4107,4108,4109,4105`（都 11-03，id 升序）。
//        ⚠️ 所以**越新的公告越可能只是「舉辦預告」**（窗口还没开）：11-15 那批 4119/4120/4121
//        全是 11-16 才开的卡池预告，当期的《精選轉蛋》（4106，11-04~11-16）已经被挤到第 2 页。
//     ⚠️ `ac0X` 的类名**不是**类别：`ac01` 同时出现在「活動」和「轉蛋」上（4106 是【轉蛋】、label 却写「活動」）
//        ⇒ 类别**只认标题前缀**（见 ②），`span` 里的字只当参考、不参与分流。
//   详情 `GET https://www.princessconnect.so-net.tw/news/newsDetail/{id}`（同样无 ACAO ⇒ 代理）
//     200 / 58~63 KB / 整页里真正要的只有 `<section class="news_con">`：
//       `<p class="news_meta">`（日期 + 类别）→ `<h2>标题</h2>` → `<div class="news-body">正文</div>`。
//     正文是**每段一个 `<p>` + `<br />` 换行**（不是 Word 富文本那种一字一 `<span>`），
//     所以「一行一句」的切法稳定：`<br>` / `</p>` 当行边界，其余标签不插分隔符。
//   档期写法（实测 9 篇，逐篇一致）：
//     `■精選轉蛋舉辦期間` ⏎ `2026/11/04 16:00 ～ 2026/11/16 15:59`
//     **整行只有一个日期区间**（两端都带 4 位年 + 时分），前面紧邻一行 `■…期間` 就是它的名字。
//     实测的四种 `■` 标签：`精選轉蛋舉辦期間` / `第10次精選角色出現率3倍轉蛋舉辦期間` /
//     `公主祭典轉蛋舉辦期間` / `附贈大師碎片的★3必中白金轉蛋舉辦期間` / `舉辦期間` / `活動期間` / `販售期間`。
//     ⇒ 名字取 `■` 那行去掉尾缀（`舉辦期間`/`活動期間`/`販售期間`/`期間`）；`舉辦|活動|販售` 这种
//        **通用词**（名字剥完是空）就退回标题派生名（见 `ns_pcr_tw_titleNameOf`）。
//     ⚠️ 只在**整行恰为区间**时认窗口：`4. 2026/11/0415:59以前停留在轉蛋頁面…` 这种行内日期、
//        `預計自2026/11/24 05:00起…` 这种前瞻句都**不是**档期（实测 4106 里两种都有）。
//
// ── ② 卡池 / 活动怎么分（只认标题前缀）────────────────────────────────────────────
//   `【轉蛋】…` ⇒ 卡池；`【活動】…` ⇒ 活动；其余（`【更新】` / `【公告】` / `【優惠】` / `《外掛停權》`）
//   ⇒ 两侧都不要（更新公告里没有档期，礼包/停权不是"卡池或活动"）。
//   ⚠️ **不要再假设"当期本命池一定在第 1 页"**（2026-11-15 19:16 实测已被推翻）：公告一多，
//      当期池/活动会被当天新发的「舉辦預告」挤到第 2 页甚至更后面 ⇒ 必须按页前进（见 ③）。
//      翻页后**页内也按"公告日期从早到晚"取候选**（同一页里越早发的越可能已经开期；
//      同日多条按站点原序 = 发布先后）—— 这是把"被新预告挤到页尾的当期公告"重新纳入 2 篇预算的办法。
//
// ── ③ 请求预算（用户口径：按页前进 + N 条详情，详情按 id 缓存 TTL 24h）──────────────────
//   每侧：page 1 → 解析不出「覆盖 now 的窗口」→ page 2 → page 3（上限 `ns_pcr_TW_MAX_LIST_PAGES` = 3），
//        某页能产出有效载荷就停；三页都没有 ⇒ `null`（nomatch，不抛）。
//   · 每侧每页最多 2 篇详情（`ns_pcr_TW_MAX_DETAILS`），候选 = 该页该侧按 (公告日期升序, 站点原序) 的前 2 条；
//   · **列表按 (url, page) 缓存到本轮刷新**（`fetchRoundSeqOf` + 轮内 Promise，`ns_pcr_tw_listCache` 是 Map）
//     —— 两侧共用同一页的列表请求；轮外（设置页「测试来源」/ 离线用例直调）一律现取；
//   · 详情按 id 缓存 24h（跨轮、跨页共用；某页没命中而被翻过去的详情也算白拿到的结论，不重复取）。
//   ⇒ 稳态（page 1 就能出）= 列表 1 次；page 1 miss 才多花 1~2 次列表请求（2026-11-15 19:16 实测：
//      page 1 miss 卡池 → page 2 命中 ⇒ 列表 2 次 + 详情 6 次 = 8 次，见 ⑤）。
//   ⚠️ 每侧 2 篇/页够不够：**单看一页的最新 2 篇是不够的**（11-15 那批全是 11-16 才开的预告）；
//      页内从早到晚取 + 按页前进，才能在第 2 页把 4106《精選轉蛋》与 4107（同批、同窗口）一起取到。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（**任一所取页**找不到 `<article class="news_con">` / 一条 `<li>` 都解析不出）⇒ **抛**；
//   · 详情结构变了（没有 `<h2>` / 没有 `news-body`；`{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 正文正常但**没有任何整行区间**（`～` 被抹掉）⇒ 不抛，这一篇就是"没有窗口"（不进外显）；
//   · 某页的候选详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ **继续下一页**；全部页都没有 ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 19:16 实测，page 1 已不含当期池）────────────────────────
//   at 2026-11-15 19:16 +08：
//   卡池 = `精選轉蛋`（`露易絲瑪莉（夏日）`）11-04 16:00 ~ 11-16 15:59 在期 —— 公告 4106 在 **page 2**
//     （page 2 的候选按 (日期, 站点原序) = 4106, 4107，正好把同批同窗口的两条都拿到；
//      page 1 的 4119/4120 是 11-16 才开的预告 ⇒ page 1 卡池如实 miss）；
//   活动 = `「NORMAL」裝備道具、星素掉落量3倍・瑪那掉落量2倍` 11-15 05:00 ~ 11-21 04:59 在期 ——
//     公告 4115 仍在 page 1，但它是 page 1 里**按 id 倒序的第 4 条活动**（上面压着 4123/4118/4117 三条新预告），
//     页内按日期从早到晚取候选后它是**第 1 篇候选**、当场命中（若按"最新 2 篇"取，会被三条预告挤掉
//     ⇒ 这就是旧实现活动侧也 nomatch 的真因，**不是**分页）；
//   另：`官方 WebStore限定 每月主題禮包「究極鍊成」` 11-15 16:00 已开期 ⇒ 同批候选里也在期，
//     events[] 会如实有 2 条（外显取结束最早的那条 = NORMAL）。
//   时区 = `Asia/Taipei`（源站是繁中服官网，墙钟就是 UTC+8；与 UTC 的换算由 `sourceInstant` 负责）。

//#region ① 常量
const ns_pcr_TW_TZ = "Asia/Taipei";
const ns_pcr_TW_HOME = "https://www.princessconnect.so-net.tw/";
const ns_pcr_TW_LIST_URL = "https://www.princessconnect.so-net.tw/news?page=1";
const ns_pcr_TW_DETAIL_BASE = "https://www.princessconnect.so-net.tw/news/newsDetail/";
const ns_pcr_TW_SOURCE_LABEL = "官网公告";
// 每侧最多取几篇详情（见文件头 ③）
const ns_pcr_TW_MAX_DETAILS = 2;
// 列表最多翻到第几页（见文件头 ③：1 → 2 → 3 顺序前进，某页命中即停）
const ns_pcr_TW_MAX_LIST_PAGES = 3;
// 详情正文解析结果缓存 TTL = 24h（用户口径；按 id 缓存，换池不会串）
const ns_pcr_TW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq 的 30s）
const ns_pcr_TW_ROUND_TTL_MS = 30000;
// 列表段（导航里没有 newsDetail 链接，但收窄到 article 更稳，也让静态守卫能定位）
const ns_pcr_TW_ARTICLE_OPEN = '<article class="news_con"';
const ns_pcr_TW_ARTICLE_CLOSE = "</article>";
// 详情段：**必须收窄到这一段**（理由见 `ns_pcr_tw_sectionOf`）
const ns_pcr_TW_SECTION_OPEN = '<section class="news_con">';
const ns_pcr_TW_SECTION_CLOSE = "</section>";
// 条目：`<time datetime="…">` + 类别 span + 详情链接 + 标题（四组：日期 / 类别字 / id / 标题）
const ns_pcr_TW_ITEM_RE = /<time\b[^>]*\bdatetime="([^"]+)"[^>]*>[\s\S]*?<\/time>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<a\b[^>]*href="\/news\/newsDetail\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
// 详情正文里"一整行恰为一个日期区间"（两端都带 4 位年 + 时分）——见文件头 ①
const ns_pcr_TW_RANGE_RE = /^(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*[~～]\s*(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
// 档期的名字行（`■精選轉蛋舉辦期間`）
const ns_pcr_TW_LABEL_RE = /^■\s*(.{1,40}?)\s*$/;
// 名字行尾缀：剥掉这些词，剩下的才是"这个档期叫什么"
const ns_pcr_TW_LABEL_TAIL_RE = /(?:舉辦|活動|販售)?期間$/;
// 标题前缀 = 类别（见文件头 ②）
const ns_pcr_TW_GACHA_RE = /^【\s*轉蛋\s*】/;
const ns_pcr_TW_EVENT_RE = /^【\s*活動\s*】/;
// 标题派生名要剥掉的尾巴（`…舉辦預告！` / `…期間限定方式販售預告！`）
const ns_pcr_TW_TITLE_TAIL_RE = /(?:期間限定)?(?:方式)?(?:販售|舉辦|登場|開始|推出|復刻)?(?:預告|中)?[！!。\s]*$/;
// 卡池角色从标题里的「…」取；这些词说明那对引号里是**池名**不是角色
const ns_pcr_TW_POOL_WORD_RE = /轉蛋|扭蛋|招募|卡池|精選/;
//#endregion

//#region ② 纯解析：列表
// 列表页 → `[{ id, date, type, title, kind, dateTs, src }]`，按日期倒序（源站本来倒序，这里再稳一次）。
// **结构变了要抛**：找不到 `<article>`、或一条都解析不出（`{}` / 改版页 / 空串都落这里）。
// `src` = 该条在**站点原始顺序**里的下标（日期倒序、同日按发布先后）——只给候选排序用（见 ③），
// 不参与外显；排序本身不动（同日仍按 id 倒序，历史用例钉着）。
function ns_pcr_tw_listOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_pcr_TW_ARTICLE_OPEN);
	const b = a >= 0 ? src.indexOf(ns_pcr_TW_ARTICLE_CLOSE, a) : -1;
	if (a < 0 || b < 0) throw new Error("pcr-tw-list-changed:no-article");
	const seg = src.slice(a, b);
	const out = [];
	ns_pcr_TW_ITEM_RE.lastIndex = 0;
	let m;
	while ((m = ns_pcr_TW_ITEM_RE.exec(seg)) !== null) {
		const title = decodeExtra(stripTags(m[4])).replace(/\s+/g, " ").trim();
		const date = String(m[1] || "").trim();
		out.push({
			src: out.length,
			id: String(m[3]),
			date,
			type: decodeExtra(stripTags(m[2])).replace(/\s+/g, " ").trim(),
			title,
			kind: ns_pcr_tw_kindOf(title),
			dateTs: ns_pcr_tw_dateTsOf(date)
		});
	}
	if (out.length === 0) throw new Error("pcr-tw-list-changed:no-item");
	return out.sort((x, y) => ((y.dateTs || 0) - (x.dateTs || 0)) || (Number(y.id) - Number(x.id)));
}
// 标题前缀 → 哪一侧（见文件头 ②）
function ns_pcr_tw_kindOf(title) {
	const t = String(title == null ? "" : title);
	if (ns_pcr_TW_GACHA_RE.test(t)) return "gacha";
	if (ns_pcr_TW_EVENT_RE.test(t)) return "event";
	return "other";
}
// `2026.11.14`（列表上的日期）→ 该日 00:00 的绝对毫秒（只用于排序，不做窗口语义）
function ns_pcr_tw_dateTsOf(s) {
	const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(String(s == null ? "" : s));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], 0, 0, ns_pcr_TW_TZ);
}
// 列表地址 + 页号 → 该页地址（page 1 **原样返回**：注册表里的 URL 就是 page=1，历史行为/请求数不变）。
function ns_pcr_tw_pageUrlOf(url, page) {
	const base = String(url == null ? "" : url).trim() || ns_pcr_TW_LIST_URL;
	const n = Math.floor(Number(page) || 1);
	if (!(n > 1)) return base;
	try {
		const u = new URL(base);
		u.searchParams.set("page", String(n));
		return u.toString();
	} catch {
		return base + (base.includes("?") ? "&" : "?") + "page=" + n;
	}
}
// 一页里某一侧的候选：按 **(公告日期升序, 站点原序)** 取前 `ns_pcr_TW_MAX_DETAILS` 条（见文件头 ③）。
// 为什么不是"取最新 2 条"：列表是日期倒序，新公告多数只是「舉辦預告」（窗口还没开）；
// 同一页里越早发布的越可能已经开期。同日多条按站点原序（= 发布先后）—— 同批卡池里
// 主池公告（page2 的 4106《精選轉蛋》）就排在 4107/4108 之前，重排成 id 倒序会把它挤出预算。
function ns_pcr_tw_candidatesOf(rows, want) {
	return (Array.isArray(rows) ? rows : [])
		.filter((r) => r && r.kind === want)
		.sort((a, b) => ((a.dateTs || 0) - (b.dateTs || 0)) || ((a.src || 0) - (b.src || 0)))
		.slice(0, ns_pcr_TW_MAX_DETAILS);
}
//#endregion

//#region ③ 纯解析：详情（正文行 → 整行区间 → 条目事实）
// 详情页 → 只留内容块 `<section class="news_con"> … </section>`（拿不到 ⇒ null）。
// ⚠️ **必须收窄**：整页里还有**别的 `<h2>`** —— 导航折叠面板在正文之前就有
//    `<h2 class="accordion-header" id="flush-heading0">…熱門遊戲…</h2>`（2026-11-15 实测 4115）。
//    在整页上找"第一个 `<h2>`"会拿到导航标题（第一次活网跑出来 event = "熱門遊戲" 就是这个坑）。
//    夹具 `pcr-tw-detail-4115` 因此**刻意保留整页未裁**，专门钉住这一点。
function ns_pcr_tw_sectionOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_pcr_TW_SECTION_OPEN);
	if (a < 0) return null;
	const b = src.indexOf(ns_pcr_TW_SECTION_CLOSE, a);
	return b > a ? src.slice(a, b + ns_pcr_TW_SECTION_CLOSE.length) : src.slice(a);
}
// 内容块 → 行数组。`<br>` / `</p>` / 块级收尾都当行边界，
// **其余标签不插分隔符**（实体再解一遍：`&times;` 等）。没有正文区 ⇒ null（结构变了，调用方抛）。
function ns_pcr_tw_linesOf(section) {
	const src = String(section == null ? "" : section);
	const s = src.indexOf('<div class="news-body"');
	if (s < 0) return null;                       // 没有正文区 = 结构变了，交给调用方抛
	const e = src.indexOf(ns_pcr_TW_SECTION_CLOSE, s);
	const body = e > s ? src.slice(s, e) : src.slice(s);
	return body
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情页 → `{ title, windows:[{ label, startTs, endTs, raw, display }] }`。
// **没有内容块 / 没有 `<h2>` / 没有 `news-body` ⇒ 抛**（`{}` / 空串 / 改版页）；
// 有正文但没有整行区间 ⇒ `windows: []`。
function ns_pcr_tw_detailOf(html, tz = ns_pcr_TW_TZ) {
	const sec = ns_pcr_tw_sectionOf(html);
	if (sec == null) throw new Error("pcr-tw-detail-changed:no-section");
	const h = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(sec);
	if (!h) throw new Error("pcr-tw-detail-changed:no-title");
	const lines = ns_pcr_tw_linesOf(sec);
	if (lines == null) throw new Error("pcr-tw-detail-changed:no-body");
	const title = decodeExtra(stripTags(h[1])).replace(/\s+/g, " ").trim();
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const m = ns_pcr_TW_RANGE_RE.exec(lines[i]);
		if (!m) continue;
		const startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		const endTs = sourceInstant(+m[6], +m[7], +m[8], +m[9], +m[10], tz);
		if (endTs == null || startTs == null || !(endTs > startTs)) continue;   // 源站错行 ⇒ 丢掉，不硬造
		const label = ns_pcr_tw_labelOf(lines, i);
		const raw = `${m[1]}/${String(m[2]).padStart(2, "0")}/${String(m[3]).padStart(2, "0")} ${String(m[4]).padStart(2, "0")}:${m[5]}`
			+ ` ~ ${m[6]}/${String(m[7]).padStart(2, "0")}/${String(m[8]).padStart(2, "0")} ${String(m[9]).padStart(2, "0")}:${m[10]}`;
		const key = `${startTs}|${endTs}|${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({ label, startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) });
	}
	return { title, windows };
}
// 区间行的名字：往上最多 3 行找 `■…`，剥掉尾缀；找不到 / 剥完是通用词 ⇒ 空串（交给标题派生）
function ns_pcr_tw_labelOf(lines, at) {
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const m = ns_pcr_TW_LABEL_RE.exec(lines[j]);
		if (!m) continue;
		const name = m[1].replace(ns_pcr_TW_LABEL_TAIL_RE, "").replace(/\s+/g, " ").trim();
		return /^(?:舉辦|活動|販售)?$/.test(name) ? "" : name;
	}
	return "";
}
// 标题 → 可读名：剥 `【…】` 前缀 + 尾巴（`舉辦預告！` / `期間限定方式販售預告！`），
// 整名被一对「」包住就留里面的（`「艾爾皮斯討魔戰線」舉辦預告！` ⇒ `艾爾皮斯討魔戰線`）。
function ns_pcr_tw_titleNameOf(title) {
	let s = String(title == null ? "" : title).replace(/^【[^】]{1,8}】\s*/, "").replace(/\s+/g, " ").trim();
	for (let i = 0; i < 3; i++) {
		const t = s.replace(ns_pcr_TW_TITLE_TAIL_RE, "").trim();
		if (t === s) break;
		s = t;
	}
	const q = /^「([^」]{1,60})」$/.exec(s);
	if (q) s = q[1].trim();
	return s || String(title == null ? "" : title).trim();
}
// 卡池角色：标题里的「…」；含 `轉蛋/精選` 类的引号是**池名**不是角色（4107 / 4101 实测）
function ns_pcr_tw_rolesOf(title, banner) {
	const out = [], seen = new Set();
	for (const m of String(title == null ? "" : title).matchAll(/「([^「」]{1,32})」/g)) {
		const name = m[1].replace(/\s+/g, " ").trim();
		if (!name || name === banner || ns_pcr_TW_POOL_WORD_RE.test(name) || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out.join("、");
}
// 详情 → 卡池条目事实（每个区间一口池；没有窗口 ⇒ 空数组）
function ns_pcr_tw_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const title = String(d.title || "");
	const titleName = ns_pcr_tw_titleNameOf(title);
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		const banner = w.label || titleName;
		items.push({
			_i: items.length,
			banner,
			roles: ns_pcr_tw_rolesOf(title, banner),
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display,
			isMain: true
		});
	}
	return items;
}
// 详情 → 活动条目事实（活动名取**标题派生名**；`■舉辦期間` 那种通用标签不是活动名）
function ns_pcr_tw_eventItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const name = ns_pcr_tw_titleNameOf(String(d.title || ""));
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		items.push({
			_i: items.length,
			event: name,
			category: "",
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display
		});
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 列表缓存：**按页**存（`${page}\u0000${url}`），值 = { url, page, round, at, promise }。
// 只在一轮刷新内复用（round 一致 + 30s 兜底）；轮外/跨轮一律现取。两侧共用同一页的请求 ⇒ 同时翻到
// 第 2 页也只发一次（promise 先入 Map 再 await，后到的调用方拿同一个 promise）。
let ns_pcr_tw_listCache = new Map();
let ns_pcr_tw_detailCache = new Map();       // id → { at, value:{ title, windows } }
function ns_pcr_tw_resetCache() { ns_pcr_tw_listCache = new Map(); ns_pcr_tw_detailCache = new Map(); }
// 列表第 page 页：一轮刷新里两侧共用同一次请求（轮外 / 设置页「测试来源」一律现取）
async function ns_pcr_tw_rowsOf(url, page, signal) {
	const key = String(url == null ? "" : url).trim() || ns_pcr_TW_LIST_URL;
	const n = Math.max(1, Math.floor(Number(page) || 1));
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const mapKey = n + "\u0000" + key;
	const hit = ns_pcr_tw_listCache.get(mapKey);
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.page === n && hit.round === round && at - hit.at < ns_pcr_TW_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchText(ns_pcr_tw_pageUrlOf(key, n), { mode: "proxy", referer: ns_pcr_TW_HOME, signal })
			.then((html) => ns_pcr_tw_listOf(html));
		ns_pcr_tw_listCache.set(mapKey, { url: key, page: n, round, at, promise });
		promise.catch(() => {
			const cur = ns_pcr_tw_listCache.get(mapKey);
			if (cur && cur.promise === promise) ns_pcr_tw_listCache.delete(mapKey);
		});
	}
	return promise;
}
// 一页里的候选（≤2 篇）→ 条目事实。详情按 id 缓存 24h（跨轮 / 跨页共用）。
// 这一页的候选详情**全部失败且一条都没解析出来** ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）。
async function ns_pcr_tw_itemsOnPage(cand, signal, tz, now, side) {
	const out = [];
	let firstErr = null, got = 0, failed = 0;
	for (const row of cand) {
		const hit = ns_pcr_tw_detailCache.get(row.id);
		let detail;
		if (hit && now - hit.at < ns_pcr_TW_CACHE_TTL_MS) {
			detail = hit.value;
			got++;
		} else {
			try {
				const html = await fetchText(ns_pcr_TW_DETAIL_BASE + row.id, { mode: "proxy", referer: ns_pcr_TW_HOME, signal });
				detail = ns_pcr_tw_detailOf(html, tz);
				ns_pcr_tw_detailCache.set(row.id, { at: now, value: detail });
				got++;
			} catch (e) {
				if (!firstErr) firstErr = e;
				failed++;
				continue;                              // 单篇失败不整体崩；全失败才抛（见下）
			}
		}
		for (const it of side === "pools" ? ns_pcr_tw_poolItemsOf(detail) : ns_pcr_tw_eventItemsOf(detail)) {
			out.push(Object.assign({}, it, { _i: out.length }));
		}
	}
	if (failed > 0 && got === 0) throw firstErr;       // 这一页详情全失败 ⇒ 抛
	return out;
}
// 一侧的条目：按页前进 —— page 1 → 解析不出「覆盖 now 的窗口」→ page 2 → page 3（上限 3），
// 某页能产出有效载荷就停；全部页都没有覆盖 now 的窗口 ⇒ 空数组（调用方给 null = nomatch，不抛）。
// `maxPages` 第 6 参只给回归用（=1 钉住"第 1 页单独没有覆盖 now"；生产调用不传，走常量上限）。
async function ns_pcr_tw_itemsOf(url, signal, tz, now, side, maxPages = ns_pcr_TW_MAX_LIST_PAGES) {
	const want = side === "pools" ? "gacha" : "event";
	const limit = Math.max(1, Math.min(ns_pcr_TW_MAX_LIST_PAGES, Math.floor(Number(maxPages) || ns_pcr_TW_MAX_LIST_PAGES)));
	for (let page = 1; page <= limit; page++) {
		const rows = await ns_pcr_tw_rowsOf(url, page, signal);
		const cand = ns_pcr_tw_candidatesOf(rows, want);
		if (cand.length === 0) continue;               // 这一页没有该侧公告 ≠ 结构变了（继续翻）
		const items = await ns_pcr_tw_itemsOnPage(cand, signal, tz, now, side);
		if (items.some((it) => coversNow(it, now))) return items;   // 这一页能产出有效载荷 ⇒ 停
	}
	return [];
}
// 卡池侧：同批（同结束时刻）合并角色 —— 这款的换池是整批换的（精選轉蛋 / 白金轉蛋 / 第10次同窗开合）
async function ns_pcr_tw_gacha(url, signal, tz = ns_pcr_TW_TZ, now = nowMs()) {
	const items = await ns_pcr_tw_itemsOf(url, signal, tz, now, "pools");
	if (items.length === 0) return null;              // 没有带窗口的卡池公告 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "pcr-tw" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷
async function ns_pcr_tw_events(url, signal, tz = ns_pcr_TW_TZ, now = nowMs()) {
	const items = await ns_pcr_tw_itemsOf(url, signal, tz, now, "events");
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "pcr-tw");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条列表**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告」。
registerSource({
	id: "pcr-tw",
	defaultHidden: false,
	tz: ns_pcr_TW_TZ,
	name: "公主连结Re:Dive·繁中服",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/5e/11/a2/5e11a217-4266-19ed-40e0-2a2357067278/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_pcr_TW_LIST_URL,
	source: ns_pcr_TW_SOURCE_LABEL,
	eventUrl: ns_pcr_TW_LIST_URL,
	eventSource: ns_pcr_TW_SOURCE_LABEL
});
GACHA_FETCHERS["pcr-tw"] = (url, signal, tz, now) => ns_pcr_tw_gacha(url, signal, tz, now);
EVENT_FETCHERS["pcr-tw"] = Object.assign(EVENT_FETCHERS["pcr-tw"] || {}, {
	default: (url, signal, tz, now) => ns_pcr_tw_events(url, signal, tz, now)
});
//#endregion
