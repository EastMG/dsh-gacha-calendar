// src/client/30-game-nikki4.js —— 闪耀暖暖·国服（卡池 = 官网新闻 API 的「限时感应」公告；活动 = 官网首页）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族）：唯一来源 `id:"nikki4"`。**卡池与活动不再是同一条抓取路径**：
//   · 卡池侧：官网**新闻列表 API + 新闻详情 API**（`/api/v1/news`），从公告正文里读
//     「限时感应活动：<池名>」/「主题活动/特别活动【<池名>】」+「活动时间：<起>-<止>」；
//   · 活动侧：官网首页 `__NEXT_DATA__.pageData.newsbanner`（4 条精选）+ 详情页正文锚点（**原逻辑保留**）。
// 标签两侧都是逐字「官网公告」（中文站 ⇒ 不加语言后缀）。时区 `Asia/Shanghai`。
//
// ── ① 站点形态（2026-11-15 实测；夹具 `nikki4-news-list-{s1,s0}` + `nikki4-news-detail-{id}`）──
//   列表 `GET https://nikki4.papegames.cn/api/v1/news?section=<n>&offset=0&limit=<k>`
//     200 / JSON `{ ret:0, msg:"ok", data:{ total:<n>, data:[ { id, title, section, info, publish_time } ] } }`
//     （section=1&limit=40 实测 4,958 B；section=0&limit=20 实测 2,455 B）
//     `publish_time` 是 **ISO UTC**（`2026-11-03T08:44:14.000Z`）⇒ 与"墙钟"无关，直接 `Date.parse`。
//     `section` 分段（实测 total）：**1 = 公告 318**（卡池/活动公告都在这段）/ **0 = 资讯 1584**
//     （套装展示、版本介绍；历史版本的主题活动介绍帖如 102110 在这段）/ 2 = 功能优化 363 /
//     3 = 单品·幻色 47 / 4 起为空。⚠️ 不带 `section` 时只回首页 3 个栏目各 5 条（不是列表）。
//     ⚠️ 本文件**只抓 1 与 0 两段**：卡池公告历史上两段都出现过（2025 六周年在 0 段，2026 起都在 1 段）；
//        2/3 段实测是功能优化与单品幻色，从未出现过感应公告。
//   详情 `GET https://nikki4.papegames.cn/api/v1/news/{id}`
//     200 / JSON `{ ret:0, msg:"ok", data:[ { title, content_html, publish_time, id } ] }`
//     `content_html` 是**每段一个 `<p>`**（不是富文本一字一 `<span>`），行切法与活动侧同一套。
//     ⚠️ **不存在的 id 回 200 + `"data":{}`**（不是 404、也不是骨架页）⇒ 视作「结构变了」抛。
//   ⚠️ **没有专门的卡池/活动接口**：实测 `/api/v1/{activity,calendar,event,events,gacha,pool,suits,
//      suit,version,config,home,banner}` 全部 404；`/api/healthz` 只有心跳。
//      全站 JS chunk 里出现的 API 前缀只有 `v1/news`、`v1/picture`、`v1/video`、`v1/tongren`、
//      `v1/tongren/like`、`v1/risk/*` ⇒ 卡池数据**只能来自新闻正文**。
//   ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（与首页同口径）⇒ 浏览器直连必被 CORS 拦，
//      **必须走宿主代理**（域名已登记 `src/index.js` 的 PROXY_ALLOW_HOSTS）。
//   ⚠️ 旧卡池路径（从首页 `pageData.newsbanner` 的 **4 条编辑精选**里挑「限时感应/幻之海」帖）
//      **已按用户 2026-11-15 要求整段删除**：精选里 4 条常年是「套装/累充/福利/同人」，
//      只有恰好出现感应帖时才有卡池 ⇒ 卡池侧恒空（实测 2026-11-15：精选 4 条里 0 条感应帖）。
//
// ── ② 卡池数据在正文里的两种写法（实测逐字）────────────────────────────────────────
//   形态 A（最标准，标题多带「主题活动介绍/限时套装展示」）：
//     `限时感应活动：永昼启示录` ⏎ `活动时间：8月2日更新后-8月15日23:59` ⏎ `兑换时间：8月2日更新后-8月16日23:59`
//     （102110 六周年 / 102277 风谷沉语 / 102291 寻谕幻海城 / 102371 此刻无响应）
//   形态 B（2026 年的主流写法：池名挂在「主题活动/特别活动」上，档期在下几行）：
//     `9月22日更新后，全新主题活动【一叶逢我，莲尽灼春】限时开启！` ⏎ `⭐活动时间：9月22日更新后-10月8日23:59`
//     `11月5日更新后，新意节特别活动【笼中歌】限时开启。` ⏎ … ⏎ `活动时间&兑换时间：11月5日更新后-11月18日23:59`
//     （102543 一叶逢我 / 102572 笼中歌 ← **当期**）
//   ⚠️ **只用「活动时间」这一行**：`兑换时间` 是兑换商店的（通常比感应晚 1 天），不是卡池档期；
//      `活动时间&兑换时间：…` 合写时两端相同，按「活动时间」读（`24-parser-window.js` 的锚点正则已兼容 `&兑换时间`）。
//   ⚠️ **不认**名字在前的写法（`【绮夜新意】主题活动…`）：102578 那种是「团购活动」，
//      正文没有「感应」⇒ 本来也会被门槛滤掉；认了只会把商城活动当卡池，宁可空不可错。
//
// ── ③ 门槛（不许拿活动冒充卡池）──────────────────────────────────────────────────
//   一篇正文要产出卡池条目，必须同时满足：
//     ① 正文出现「**感应**」（闪暖的抽卡动词；福利/团购/礼包公告不一定有）；
//     ② 池名只从 `限时感应活动：<名>` 或 `<主题活动|特别活动>【<名>】` 取；
//     ③ 档期只从**同一篇**的「活动时间」锚点行取（起点缺失/两端不齐 ⇒ 这篇 0 条，不硬凑）。
//   三条缺一条 ⇒ 这篇不产出（不抛、不猜）。
//
// ── ④ 扫描口径（为什么是 21 天）───────────────────────────────────────────────────
//   闪暖的限时感应档期最长 16 天（实测 8/20~9/2、11/5~11/18 都是 14 天；最长 102543 的 16 天），
//   公告最早在开池前 4 天发（11/5 的公告 11/01 发）⇒ **覆盖当期池的公告一定在 21 天内**。
//   候选 = `publish_time ∈ [now-21d, now]`，按发布时间倒序，最多取 `ns_nikki4_GACHA_MAX_DETAILS = 24` 篇
//   （实测当期 15 篇，见 ⑥）。卡池条目只在「窗口覆盖 now」时外显（`ns_bwiki_batchGachaPayloadOf` 判），
//   解析到但没有一条覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 请求预算（实测 2026-11-15 19:51 +08 全链路）────────────────────────────────────
//   首轮 = **2 列表**（公告 40 条 + 资讯 20 条）+ **15 篇详情**（21 天内公告/资讯）= 17 次；
//          活动侧仍是首页 1 + 4 篇精选详情 = 5 次 ⇒ 一条来源整轮 **22 次**。
//   稳态 = 2 列表 + 1 首页 = **3 次**（详情按 id 缓存 24h；`pools` 为空或全结束过的详情**永不重取**）。
//   两侧**各自**轮内 promise 缓存：卡池侧的列表/详情与活动侧的首页/详情不共用（不同端点，无法复用）。
//
// ── ⑥ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchJson` 自己抛 `http-…`）；
//   · 列表结构变了（`ret != 0` / 没有 `data.data` 数组 / 一条合法 news 都没有）⇒ **抛**
//     （`nikki4-news-list-changed:*`）；
//   · 详情结构变了（没有 `data` 数组 / 首项不是对象 / 标题与正文都空；不存在的 id 的 `data:{}` 落这里）⇒ **抛**
//     （`nikki4-news-detail-changed:*`）；
//   · 详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 正文正常但没有感应锚点 / 档期两端不齐 ⇒ 这篇 0 条（**不抛、也不硬凑**）；
//   · 候选为空（21 天内没有新公告）⇒ 不抓详情，返回 `null`（未公布）。
//
// ── ⑦ 当期实测（2026-11-15 19:51 +08）──────────────────────────────────────────────
//   列表/详情真抓：池 = **笼中歌**，`2026-11-05 09:30 ~ 2026-11-18 23:59`（+08）
//   = UTC `2026-11-05T01:30Z ~ 2026-11-18T15:59Z`（「11月5日更新后」按维护结束时刻锚 09:30，见 ⑧）。
//   （来源：102572「新意节特别活动【笼中歌】限时开启」+「活动时间&兑换时间：11月5日更新后-11月18日23:59」；
//     102571 同篇确认「【笼中歌】限时感应活动即将开启」。）
//   活动侧：102574 限定累充 / 102583 改造吧！PP游戏（都是 11月5日更新后-11月18日23:59）。
//
// ── ⑧ 「更新后」怎么锚定（活动侧与卡池侧共用同一处钟点推定；用户 2026-11-09 口径）──────
//   闪暖的档期起点大量写成「**M月D日更新后**」——日期明确、时分不给。按仓库既有口径
//   （`23-parser-time.js` 的 `anchorStartOf`：「有日期（带不带『版本更新后』都一样）⇒ 该日 anchorHour:00」），
//   本文件锚定 **当日 09:30**（+08）：官方维护公告的固定写法是「将于 M月D日 **04:00-09:30** 进行维护更新」、
//   完成公告写「已于 M月D日 **9:30** 完成停服维护更新」⇒「更新后」= 09:30。
//   ⚠️ 这样锚定后条目**能进外显**，但 `raw` 保留源站原文（悬停照旧显示「11月5日更新后 ~ …」）。
//   ⚠️ 两端都写绝对时刻的**不做任何锚定**，原样解析。
//
// ── ⑨ 活动侧（原逻辑保留，不在本次重做范围）────────────────────────────────────────
//   首页 `GET https://nikki4.papegames.cn/` → `__NEXT_DATA__.pageProps.pageData.newsbanner`（4 条精选）→
//   详情 `GET https://nikki4.papegames.cn/news/{id}` 的 `pageData.content_html` → 锚点行
//   （`活动时间` / `感应时间` / `阁时间`）→ 窗口；`活动|累充|福利…` 归活动，`感应|阁|…` 归卡池但**卡池侧不再取它**
//   （卡池只认 ② 那两种写法；活动侧仍按关键字把感应窗口排除，避免同一档期两侧都报）。

//#region ① 常量
const ns_nikki4_TZ = "Asia/Shanghai";
// —— 活动侧（首页 4 条精选，未改）——
const ns_nikki4_LIST_URL = "https://nikki4.papegames.cn/";
const ns_nikki4_DETAIL_BASE = "https://nikki4.papegames.cn/news/";
// —— 卡池侧（新闻 API）——
const ns_nikki4_NEWS_API = "https://nikki4.papegames.cn/api/v1/news";
const ns_nikki4_NEWSLIST_URL = "https://nikki4.papegames.cn/newslist";
// 列表分段：[公告 1] 40 条 + [资讯 0] 20 条（见文件头 ①）
const ns_nikki4_GACHA_SECTIONS = [{ section: 1, limit: 40 }, { section: 0, limit: 20 }];
// 候选窗口：21 天（依据见文件头 ④）
const ns_nikki4_SCAN_DAYS = 21;
// 单轮最多抓多少篇详情（实测当期 15 篇；上限只防源站突发灌水）
const ns_nikki4_GACHA_MAX_DETAILS = 24;
const ns_nikki4_SOURCE_LABEL = "官网公告";
const ns_nikki4_ICON = "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e0/fb/00/e0fb0062-4bbc-423f-2c1c-e1cefbd0399f/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg";
// 活动侧：首页精选一共 4 条 ⇒ 每轮最多取 4 篇详情
const ns_nikki4_MAX_DETAILS = 4;
// 详情解析结果缓存 TTL = 24h（两侧各自按 id 缓存；换公告不会串）
const ns_nikki4_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 「更新后」的钟点锚（当日 09:30 +08；依据见文件头 ⑧）
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
// 活动侧归属关键词（见文件头 ⑨）：`套装` **不算**卡池信号（累充/福利活动标题里常写「稀有套装…」）。
const ns_nikki4_GACHA_RE = /感应|感應|阁|閣|幻之海|流光|抽/;
const ns_nikki4_EVENT_RE = /累充|福利|活动|活動|计划|計劃|赛季|賽季|家园|家園|礼包|禮包/;
// 标题尾巴（`| 11月5日更新` / `| 11月16日上线`）与栏目前缀（`【福利活动】`）
const ns_nikki4_TITLE_TAIL_RE = /\s*[|｜]\s*[^|｜]{0,24}$/;
const ns_nikki4_TITLE_HEAD_RE = /^【[^】]{1,20}】\s*/;
// 名字行里的名字（`参与【改造吧！PP游戏！】福利活动` / `「…」`）
const ns_nikki4_BRACKET_RE = /【([^】]{1,30})】|「([^」]{1,30})」/;
// 卡池侧：池名的两种写法（见文件头 ②）
const ns_nikki4_GACHA_A_RE = /^限时感应活动\s*[：:]\s*(.+)$/;
const ns_nikki4_GACHA_B_RE = /(?:主题活动|特别活动)【([^】]{2,30})】/;
// 池名之后最多往下找几行才认「活动时间」（102572 实测隔 3 行）
const ns_nikki4_GACHA_LOOKAHEAD = 10;
//#endregion

//#region ② 纯解析：活动侧（首页 / 详情页；原逻辑保留）
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
// `content_html` → 行数组（`<br>` / 块级收尾当行边界，实体解一遍）——两侧共用
function ns_nikki4_linesOf(contentHtml) {
	const html = String(contentHtml == null ? "" : contentHtml)
		.replace(ns_nikki4_SCRIPT_RE, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(ns_nikki4_BLOCK_END_RE, "\n");
	return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// 一段档期 → `{ startTs, endTs, raw, rawOriginal, display, openStart }`；两端不齐 / 源站错行 ⇒ null（不硬凑）。
// 「更新后」起点锚定当日 `ns_nikki4_UPDATE_ANCHOR`（见文件头 ⑧）。
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
// 锚点行前缀 + 名字 → 归属（见文件头 ⑨）：卡池侧的窗口从这里**不再出卡池条目**，只用于活动侧排除
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

//#region ③ 纯解析：卡池侧（新闻 API 列表 / 详情 / 限时感应块）
// 列表 JSON → `[{ id, title, publishTs }]`（按发布时间倒序）。
// **结构变了要抛**：`ret != 0` / 没有 `data` / 没有 `data.data` 数组 / 一条合法新闻都没有。
function ns_nikki4_newsListOf(json, tz = ns_nikki4_TZ) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("nikki4-news-list-changed:not-object");
	if (String(json.ret) !== "0") throw new Error("nikki4-news-list-changed:ret-" + String(json.ret));
	const data = json.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("nikki4-news-list-changed:no-data");
	const arr = Array.isArray(data.data) ? data.data : null;
	if (arr == null) throw new Error("nikki4-news-list-changed:no-list");
	const out = [];
	for (const it of arr) {
		if (!it || typeof it !== "object") continue;
		const id = String(it.id == null ? "" : it.id).trim();
		if (!/^\d+$/.test(id)) continue;
		out.push({
			id,
			title: htmlTextTight(it.title == null ? "" : it.title),
			publishTs: ns_nikki4_apiTsOf(it.publish_time)
		});
	}
	if (out.length === 0) throw new Error("nikki4-news-list-changed:no-rows");
	if (!out.some((r) => r.publishTs > 0)) throw new Error("nikki4-news-list-changed:no-publish-time");
	return out.sort((x, y) => (y.publishTs - x.publishTs) || (Number(y.id) - Number(x.id)));
}
// API 的 `publish_time` 是 ISO UTC（`2026-11-03T08:44:14.000Z`）⇒ 直接按绝对时刻解析（**不做墙钟解释**）。
function ns_nikki4_apiTsOf(v) {
	const s = String(v == null ? "" : v).trim();
	if (!s) return 0;
	const t = Date.parse(s);
	return Number.isFinite(t) ? t : 0;
}
// 详情 JSON → `{ id, title, publishTs, contentHtml }`。
// **结构变了要抛**：`data` 不是数组（不存在的 id 回 `data:{}`）/ 首项不是对象 / 标题与正文都空。
function ns_nikki4_newsDetailOf(json, tz = ns_nikki4_TZ) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("nikki4-news-detail-changed:not-object");
	if (String(json.ret) !== "0") throw new Error("nikki4-news-detail-changed:ret-" + String(json.ret));
	const arr = Array.isArray(json.data) ? json.data : null;
	if (arr == null) throw new Error("nikki4-news-detail-changed:no-data");
	const it = arr[0];
	if (!it || typeof it !== "object" || Array.isArray(it)) throw new Error("nikki4-news-detail-changed:empty-item");
	const title = htmlTextTight(it.title == null ? "" : it.title);
	const contentHtml = String(it.content_html == null ? "" : it.content_html);
	if (!title && contentHtml.trim() === "") throw new Error("nikki4-news-detail-changed:empty-page");
	return {
		id: String(it.id == null ? "" : it.id).trim(),
		title,
		publishTs: ns_nikki4_apiTsOf(it.publish_time),
		contentHtml
	};
}
// 详情 → 卡池条目事实 `[{ name, startTs, endTs, raw, display, openStart }]`（口径见文件头 ②③）。
// 0 条 = 这篇不是感应公告（不抛、不硬凑）。
function ns_nikki4_gachaPoolsOf(post, tz = ns_nikki4_TZ) {
	const content = String(post && post.contentHtml != null ? post.contentHtml : "");
	if (!/感应/.test(content)) return [];                 // 门槛 ①：正文没有「感应」⇒ 不是卡池公告
	const lines = ns_nikki4_linesOf(content);
	const hint = post && post.publishTs ? sourceWallParts(post.publishTs, tz) : null;
	const out = [];
	const seen = new Set();
	const push = (name, w) => {
		const n = String(name == null ? "" : name).trim();
		if (!n) return;
		const key = `${n}|${w.startTs}|${w.endTs}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ name: n, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawOriginal: w.rawOriginal, display: w.display, openStart: w.openStart });
	};
	// 池名之后最多 `LOOKAHEAD` 行内找「活动时间」锚点（起点锚定/跨年沿用 windowOf）
	const windowAfter = (from) => {
		for (let j = from; j < lines.length && j <= from + ns_nikki4_GACHA_LOOKAHEAD; j++) {
			const a = ns_nikki4_ANCHOR_RE.exec(lines[j]);
			if (!a) continue;
			const value = String(a[3] || "").trim() || lines[j + 1] || "";
			const w = ns_nikki4_windowOf(value, hint, tz);
			if (w) return w;
		}
		return null;
	};
	for (let i = 0; i < lines.length; i++) {
		const a = ns_nikki4_GACHA_A_RE.exec(lines[i]);
		if (a) {
			const w = windowAfter(i + 1);
			if (w) push(a[1], w);
			continue;
		}
		const b = ns_nikki4_GACHA_B_RE.exec(lines[i]);
		if (b) {
			const w = windowAfter(i + 1);
			if (w) push(b[1], w);
		}
	}
	return out;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// —— 活动侧：首页 4 条精选 → 详情（原逻辑保留）——
let ns_nikki4_eventCache = new Map();          // id → { at, fact }
let ns_nikki4_eventRound = { round: -1, promise: null };
function ns_nikki4_sealedOf(fact, now) {
	const all = fact && Array.isArray(fact.windows) ? fact.windows : [];
	if (all.length === 0) return true;
	return all.every((w) => w.endTs != null && w.endTs < now);
}
function ns_nikki4_cachedOf(id, now) {
	const hit = ns_nikki4_eventCache.get(id);
	if (!hit) return null;
	if (ns_nikki4_sealedOf(hit.fact, now)) return hit;
	return now - hit.at < ns_nikki4_CACHE_TTL_MS ? hit : null;
}
// 首页 → 详情 → 事实数组。详情全部失败且一条都没解析出来 ⇒ 抛（抓取失败 ≠ 未公布）。
async function ns_nikki4_collectEvents(url, signal, tz, now) {
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
			ns_nikki4_eventCache.set(row.id, { at: now, fact });
			parsed++;
			facts.push(fact);
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (parsed === 0 && firstErr) throw firstErr;
	return facts;
}
function ns_nikki4_collectEventsInRound(url, signal, tz, now) {
	const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
	if (round > 0 && ns_nikki4_eventRound.round === round && ns_nikki4_eventRound.promise) return ns_nikki4_eventRound.promise;
	const promise = ns_nikki4_collectEvents(url, signal, tz, now);
	if (round > 0) {
		ns_nikki4_eventRound = { round, promise };
		promise.catch(() => { if (ns_nikki4_eventRound.promise === promise) ns_nikki4_eventRound = { round: -1, promise: null }; });
	}
	return promise;
}

// —— 卡池侧：新闻列表 API（公告 + 资讯）→ 21 天内的详情 → 限时感应块 ——
let ns_nikki4_gachaCache = new Map();          // id → { at, pools }
let ns_nikki4_gachaRound = { round: -1, promise: null };
// 详情解析结果「已定型」= 没有池，或池的窗口全都结束过 ⇒ 永不重取（公告不会二次改档期）
function ns_nikki4_sealedPoolsOf(pools, now) {
	const all = Array.isArray(pools) ? pools : [];
	if (all.length === 0) return true;
	return all.every((p) => p.endTs != null && p.endTs < now);
}
function ns_nikki4_cachedPoolsOf(id, now) {
	const hit = ns_nikki4_gachaCache.get(id);
	if (!hit) return null;
	if (ns_nikki4_sealedPoolsOf(hit.pools, now)) return hit;
	return now - hit.at < ns_nikki4_CACHE_TTL_MS ? hit : null;
}
// `url` = 列表 API 基址（可被用户自定义覆盖）；详情地址 = 基址 + `/` + id。
function ns_nikki4_apiBaseOf(url) {
	const s = String(url == null ? "" : url).trim() || ns_nikki4_NEWS_API;
	return s.split("?")[0].replace(/\/+$/, "") || ns_nikki4_NEWS_API;
}
// 列表（两段）→ 21 天内候选 → 详情 → 池事实（去重）。
// **详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错**；候选为空 ⇒ 返回 []（上游按「未公布」出 null）。
async function ns_nikki4_collectGachaPools(url, signal, tz, now) {
	const base = ns_nikki4_apiBaseOf(url);
	const rows = [];
	for (const sec of ns_nikki4_GACHA_SECTIONS) {
		const listUrl = `${base}?section=${sec.section}&offset=0&limit=${sec.limit}`;
		const list = await fetchJson(listUrl, { mode: "proxy", referer: ns_nikki4_NEWSLIST_URL, signal });
		for (const row of ns_nikki4_newsListOf(list, tz)) rows.push(row);
	}
	const cutoff = now - ns_nikki4_SCAN_DAYS * 24 * 60 * 60 * 1000;
	const seenIds = new Set();
	const candidates = rows
		.filter((r) => {
			if (!(r.publishTs > 0 && r.publishTs >= cutoff && r.publishTs <= now)) return false;
			if (seenIds.has(r.id)) return false;             // 两段之间的重复 id（理论上不会，防一手）
			seenIds.add(r.id);
			return true;
		})
		.sort((a, b) => (b.publishTs - a.publishTs) || (Number(b.id) - Number(a.id)))
		.slice(0, ns_nikki4_GACHA_MAX_DETAILS);
	const pools = [];
	let firstErr = null, parsed = 0;
	for (const row of candidates) {
		const hit = ns_nikki4_cachedPoolsOf(row.id, now);
		if (hit) { for (const p of hit.pools) pools.push(p); continue; }
		try {
			const post = ns_nikki4_newsDetailOf(await fetchJson(`${base}/${row.id}`, { mode: "proxy", referer: ns_nikki4_NEWSLIST_URL, signal }), tz);
			const got = ns_nikki4_gachaPoolsOf(post, tz);
			ns_nikki4_gachaCache.set(row.id, { at: now, pools: got });
			parsed++;
			for (const p of got) pools.push(p);
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (parsed === 0 && firstErr) throw firstErr;
	const seen = new Set(), out = [];
	for (const p of pools) {
		const key = `${p.name}|${p.startTs}|${p.endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(p);
	}
	return out;
}
function ns_nikki4_collectGachaInRound(url, signal, tz, now) {
	const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
	if (round > 0 && ns_nikki4_gachaRound.round === round && ns_nikki4_gachaRound.promise) return ns_nikki4_gachaRound.promise;
	const promise = ns_nikki4_collectGachaPools(url, signal, tz, now);
	if (round > 0) {
		ns_nikki4_gachaRound = { round, promise };
		promise.catch(() => { if (ns_nikki4_gachaRound.promise === promise) ns_nikki4_gachaRound = { round: -1, promise: null }; });
	}
	return promise;
}
// 卡池侧：池名 = 限时感应活动名（roles 留空 —— 闪暖是套装池，源站没有「池名：角色」的分离写法）。
async function ns_nikki4_gacha(url, signal, tz = ns_nikki4_TZ, now = nowMs()) {
	const pools = await ns_nikki4_collectGachaInRound(url, signal, tz, now);
	const items = pools.map((p, i) => ({
		_i: i, banner: p.name, roles: "", startTs: p.startTs, endTs: p.endTs, raw: p.raw, display: p.display, isMain: true
	}));
	if (items.length === 0) return null;                       // 21 天内没有感应公告 ⇒ 未公布
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "nikki4" });
}
async function ns_nikki4_events(url, signal, tz = ns_nikki4_TZ, now = nowMs()) {
	const facts = await ns_nikki4_collectEventsInRound(url, signal, tz, now);
	const items = [];
	for (const fact of facts) for (const it of ns_nikki4_eventItemsOf(fact)) items.push(Object.assign({}, it, { _i: items.length }));
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "nikki4");
}
// 回归/测试用：把两侧缓存与轮内 promise 全部清掉
function ns_nikki4_resetCache() {
	ns_nikki4_eventCache = new Map();
	ns_nikki4_eventRound = { round: -1, promise: null };
	ns_nikki4_gachaCache = new Map();
	ns_nikki4_gachaRound = { round: -1, promise: null };
}
//#endregion

//#region ⑤ 条目登记
// 卡池侧 = 新闻列表 API（`/api/v1/news`）；活动侧 = 官网首页。两侧标签逐字「官网公告」。
registerSource({
	id: "nikki4",
	defaultHidden: false,
	tz: ns_nikki4_TZ,
	name: "闪耀暖暖",
	icon: ns_nikki4_ICON,
	url: ns_nikki4_NEWS_API,
	source: ns_nikki4_SOURCE_LABEL,
	eventUrl: ns_nikki4_LIST_URL,
	eventSource: ns_nikki4_SOURCE_LABEL
});
GACHA_FETCHERS["nikki4"] = (url, signal, tz, now) => ns_nikki4_gacha(url, signal, tz, now);
EVENT_FETCHERS["nikki4"] = Object.assign(EVENT_FETCHERS["nikki4"] || {}, {
	default: (url, signal, tz, now) => ns_nikki4_events(url, signal, tz, now)
});
//#endregion
