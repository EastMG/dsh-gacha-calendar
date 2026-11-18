// src/client/30-game-wfskey.js —— WFS / Key：炽焰天穹（cytq，国服）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-cytq.js 整体改名迁入；条目 + 解析器 + 抓取器 + 登记原样保留。
// 源：官方 H5 公告（列表 1 次 → 只取 is-gacha / is-event / is-campaign 的详情；按 id 缓存 TTL 24h、
//   已结束的不再取；卡池 / 活动同一条列表 URL 轮内共享）。
// 复用关系：bwiki 公共层的载荷 / 悬停生成器（本文件不自制排版）；符号名 `ns_*` 一个都没改。
// 请求预算：列表 1 + 在期详情（首轮 2~4 次 / 稳态 1 次）。

//
// ── 为什么这条能接（2026-11-09 曾判定「无源可接」，2026-11-15 推翻）─────────────────
// 当时只查了 bwiki（`cytq` 子站没有卡池表 / 活动表）与「官网有没有 JSON 接口」，结论是留空未配置。
// 2026-11-15 复核发现：国服官网公告是**服务端渲染的 H5 页面**（HTML），没有 JSON 接口也不需要 ——
// 公告正文里就写着 `活动时间 2026/11/11 11:00 ~ 2026/11/25 10:59` 与 PickUp 名单。
//
// ── 源站事实（2026-11-15 实测；夹具见 test/fixtures/cytq-*）───────────────────────
// 站点：https://le3-prod-bili-gs-fever.bilibiligame.net/  （B 站服 H5，`Access-Control-Allow-Origin: *`
// ⇒ **直连**，`mode: "direct"`，不进宿主代理白名单）
//
// ① 列表 `GET /web/announcement?phoneType=4` → 200 `text/html` ~42KB，一页 38 条，**不分页**
//    （`page` / `offset` / `limit` / `detail` / `ids` 全部被忽略，实测）。
//    页面里有两组 `<article>`，**只有一组是公告列表**：
//      · `<article class="event">`   × 32 —— 顶部轮播 banner，只有 `alt="标题"` 与 `event-date`
//        （`11/25 10:59结束` 这种**只有结束时刻、没有年份也没有开始**的残句）⇒ **本文件不读**；
//      · `<article class="article-item" data-announcement-id="…">` × 38 —— 真列表，每条给：
//        `data-announcement-id`、`<div class="article-header is-…">` 的**分类 class**、`<h2
//        class="article-category">` 的分类中文名、`<p class="article-body">` 的标题。
//    ⚠️ 列表里**没有任何日期**（轮播那 32 条不算证据，见上）⇒ 「哪条在期」只能看详情。
//    ⚠️ 唯一例外：`href` 里带 `userId=0&region=1&language=1&phoneType=4&token=…`（会话 token 每次变，
//       **不要**拿它当 URL 身份；详情地址按 `/web/announcement/<id>?phoneType=4` 自己拼）。
//
// ② 详情 `GET /web/announcement/<id>?phoneType=4` → 200：扭蛋帖 ~265KB、活动帖 ~10KB。
//    一条详情**只讲一个卡池/活动**（38 条独立帖），正文里：
//      · `<h1 class="article-body">…</h1>` = 帖名（= 卡池名 / 活动名，源站自己的叫法）；
//      · 档期 = `活动时间` 锚点后面那一句：`<h3 class="headline-pink">活动时间</h3>` +
//        `<p>2026/11/11 11:00 ~ 2026/11/25 10:59<br></p>`（也有内联形态 `活动时间:2026/10/28 …
//        ~ 2026/12/2 12:59`）；
//      · 卡池角色 = `登场风格` 段里每个 `<h2 class="header-gacha">…<span class="headline-m-text">
//        [风格名] 角色名</span></h2>`（取 `]` 之后的角色名，`、` 连接）。
//    ⚠️ 例外帖子 **1222**「感谢庆典特别活动一览！」一篇含 18 条 `活动时间` + 5 个卡池角色名。
//       本文件**只取它的第 1 条**（= 整个庆典的窗口 10/28~12/2）；那 18 条分块窗口属于**各自的分帖**
//       （400001431 / 400001432 / 1215 / 1220 / 500000178 / 500000179 …），那些分帖会被独立抓到 ⇒
//       展开就会把同一档期重复入表。
//
// ── 请求预算（用户 2026-11-15 拍板的方案）──────────────────────────────────────
//   列表 1 次 → **只对「在期 & 未缓存」的 id** 取详情 → 按 id 缓存（TTL 24h；已结束的不再取）
//   ⇒ 首轮 1 + N（N = 列表里 is-gacha/is-event/is-campaign 的条数；2026-11-15 实测 N = 14），
//     稳态 ≈ 1 次/轮（1 次列表 + 0 次详情）。
//   为什么不是 38 次：礼包（is-pack）/ 更新（is-update）/ 通知（is-info）/ 问题说明（is-bug）
//   **不含卡池或活动档期**，取了对载荷毫无贡献（实测 38 条里 24 条属这四类）。
//   为什么缓存不放"标题级"而是"id 级"：一条帖子讲一个卡池，改期 = 同一个 id 换正文；按 id 缓存
//   配合 TTL 就够，不需要猜"哪条是新帖"。
//   轮内复用（`ns_cytq_listOf`）：卡池侧与活动侧**同一条列表 URL**，`refreshAll` 一轮里两侧各调一次
//   抓取器 ⇒ 不共享就会每轮发 2 次列表请求。做法与 `30-game-cygames.js` 的 GameTora manifest 同一套
//   （`fetchRoundSeqOf` 轮次判定 + 缓存 **Promise**）；轮外（设置页「测试来源」/ 离线用例直调）一律现取。
//
// ── 当期口径（照本仓库现成的那几条）──────────────────────────────────────────────
//   · 卡池 = `is-gacha` 帖；活动 = `is-event` / `is-campaign` 帖。
//   · 当期 = `coversNow`（两端都明确且覆盖 now）。**「维护后」这类相对起点 ⇒ `startTs = null`**
//     （用户口径：不猜钟点 ⇒ 别去解析维护公告）。后果如实写在这里：实测 400001431 / 400001432
//     两口池的起点是 `2026/10/28 维护后` ⇒ 它们**不冒充在期**（不进外显），但仍会出现在悬停里
//     （`coveredOrOpen`：起点未知、终点未过 ⇒ "事实仍要列出来"）。所以外显落在窗口明确的池上。
//   · 外显/悬停/数组 = 共用 `ns_bwiki_batchGachaPayloadOf`（卡池，按 id 加 `cytq:gacha:` 前缀）与
//     `ns_bwiki_eventPayload`（活动，按 id 加 `cytq:event:` 前缀）—— 与白荆回廊 / 以闪亮之名同一套
//     载荷生成器，不新造字段、不另写悬停排版。
//   · 两端都拿不到的帖子（如「邀请好友活动」写 `2026/10/8 维护后 ~` 没有终点）**不进数组/悬停**：
//     `coversNow` / `coveredOrOpen` 都要终点，画不出来的行不硬凑（与 dhmmr 同口径）。
//
// ── 字段口径 ────────────────────────────────────────────────────────────────────
//   卡池名 = 详情 `<h1 class="article-body">` 原文（`Autumn特别精选扭蛋举办中！`）；
//   角色   = 「登场风格」名单，去掉 `[风格名]` 前缀、去名字中间的空白（`小笠原 绯雨` → `小笠原绯雨`，
//            与正文 `PickUp「小笠原绯雨」「月城最中」` 同一写法），`、` 连接、去重保序；
//            没有登场风格段的池（如「SS1.5倍扭蛋」这种"某批风格概率提升"）⇒ 角色留空；
//            退路：正文「精选「A」「B」」连排（≥2 个）也认，判据见 `ns_cytq_pickUpNamesOf`。
//   活动名 = 详情 `<h1>` 原文；`category` 不写（源站没有类型列，N 分类 class 只是列表分组）。
//   `raw` / `display` 两份文本照 `30-game-bwiki-common.js` 文件头的约定：`raw` = 源站原文
//   （`2026/10/28 维护后 ~ 2026/11/18 12:59`，相对词原样保留），`display` = 两端都明确时的
//   `fmtWindow` 文本，否则同 `raw`（不硬造钟点）。悬停走 `hoverTextFromItems`（raw 含相对表述 ⇒ 印原文）。
//
// ── 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（0 条 `article-item` / 一条都没有分类 class）⇒ **抛**（抓取失败，不是"当期没有"）；
//   · 详情结构变了（没有 `<h1 class="article-body">` —— `{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 详情正常但**没有 `活动时间` 锚点**（或锚点后面没有日期）⇒ 不抛，这一条就是"没有窗口"
//     （用户点名的那条反证：抹掉锚点 ⇒ 不进外显，也不该被当成失败）；
//   · 解出来了但没有任何窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── defaultHidden = false（用户 2026-11-19 口径）────────────────────────────────
//   出厂隐藏 = **至少一侧（url / eventUrl）未配置**的条目。本文件两侧都有来源 ⇒ 恢复出厂展示：
//   `65-remind.js` 的 `REMIND_DEFAULT_HIDDEN_IDS` 里已没有 cytq（守卫见 test/cases-remind.mjs ⑨）。

//#region ① 常量（URL 是条目的事实：登记与夹具索引都逐字比它）
const ns_cytq_TZ = "Asia/Shanghai";
const ns_cytq_LIST_URL = "https://le3-prod-bili-gs-fever.bilibiligame.net/web/announcement?phoneType=4";
const ns_cytq_DETAIL_BASE = "https://le3-prod-bili-gs-fever.bilibiligame.net/web/announcement/";
const ns_cytq_DETAIL_PARAMS = "?phoneType=4";
// 列表的**分类 class** → 这一帖属于哪一侧。只认这三类（其余四类不取详情，见文件头「请求预算」）。
// 值是 `gacha` / `event`，与 `fetchEntry` 的两侧一一对应。
const ns_cytq_SIDE_BY_CLASS = { "is-gacha": "gacha", "is-event": "event", "is-campaign": "event" };
// 详情缓存：id → { at, post }。TTL = 24h（用户口径「TTL ≥ 24h」）。
const ns_cytq_DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
// 「已结束」宽限：窗口结束 < now - 1 天 ⇒ 永不再取（那种帖子的档期不会再变）。
const ns_cytq_ENDED_GRACE_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用的兜底上限（同 cygames 的 30s：一轮刷新不会跑这么久，超时即重取）
const ns_cytq_ROUND_TTL_MS = 30000;
// 相对起点词表（只用于**判定"起点未知"**；不要拿它去推钟点 —— 用户口径：不猜）
const ns_cytq_RELATIVE_START_RE = /维护后|维护结束后|维护完成后|更新后|开服后/;
// 列表项 / 分类 class / 标题（逐字对应文件的 ①② 事实）
const ns_cytq_ITEM_ID_RE = /\bdata-announcement-id\s*=\s*"(\d+)"/;
const ns_cytq_HEADER_CLASS_RE = /\barticle-header\s+([A-Za-z][\w-]*)/;
const ns_cytq_TITLE_RE = /<h1[^>]*class="article-body"[^>]*>([\s\S]*?)<\/h1>/;
//#endregion

//#region ② 纯解析：列表 HTML → 条目；详情 HTML → 条目事实
// 列表：只要 `article-item` 那组（`article.event` 是顶部轮播，见文件头 ①）。
// 返回 `[{ id, categoryClass, title }]`，顺序 = 源站顺序（从新到旧）。
function ns_cytq_listOf(html) {
	const src = String(html == null ? "" : html);
	const out = [];
	const re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
	let m;
	while ((m = re.exec(src))) {
		const attrs = m[1] || "";
		// ⚠️ 用 `\barticle-item\b` 而不是 `class === "article-item"`：分类 class 将来若挪到外层，
		//    这里仍认得出来；轮播那条是 `class="event"`，天然不命中。
		if (!/\barticle-item\b/.test(attrs)) continue;
		const idm = ns_cytq_ITEM_ID_RE.exec(attrs);
		if (!idm) continue;
		const body = m[2] || "";
		const cls = ns_cytq_HEADER_CLASS_RE.exec(body);
		const tm = body.match(/<p[^>]*class="article-body"[^>]*>([\s\S]*?)<\/p>/);
		out.push({
			id: idm[1],
			categoryClass: cls ? cls[1] : "",
			title: tm ? stripTags(tm[1]) : ""
		});
	}
	if (out.length === 0) throw new Error("cytq-list-changed:no-items");
	if (!out.some((x) => x.categoryClass)) throw new Error("cytq-list-changed:no-category");
	return out;
}

// 详情正文 → **按行**的纯文本（`<br>` / 块级结束标签都换成换行）。
// 为什么要按行：`活动时间` 锚点有两种形态（独占一行 / 与日期同行），行结构是最稳的判据。
function ns_cytq_linesOf(html) {
	return String(html == null ? "" : html)
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|h[1-6]|div|small|section|li|tr|table)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.split(/\n/)
		.map((x) => stripTags(x))                 // 折空白 + 解实体（`&amp;` 等）
		.filter(Boolean);
}

// 档期文本 → 窗口（`{ startTs, endTs, raw, display }`），拿不到任何日期 ⇒ `null`。
//   · 两端各自解析（`parseTime` 认 `YYYY/M/D HH:MM`）；
//   · 起点带「维护后 / 更新后 / 开服后」⇒ **`startTs = null`**（用户口径：不猜钟点）；
//   · 只有日期没有时刻：起 00:00 / 止 23:59（仓库通用约定）；
//   · `raw` = 源站原文那一句（`2026/10/28 维护后 ~ 2026/11/18 12:59`）；
//     `display` = 两端都明确时 `fmtWindow`（按源站 tz），否则同 `raw`。
function ns_cytq_windowOf(text, tz = ns_cytq_TZ) {
	const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
	if (!t) return null;
	const hasSep = /[~～]/.test(t);
	const parts = t.split(/[~～]/);
	const a = (parts[0] || "").trim();
	const b = hasSep ? (parts[1] || "").trim() : "";
	// 一端 → 绝对时刻（认不出 ⇒ null）。相对起点由调用点单独挡掉，这里只负责"能认的认出来"。
	const tsOf = (s, isEnd) => {
		const raw = String(s == null ? "" : s).trim();
		if (!raw) return null;
		const p = parseTime(raw, tz);
		if (p.ts != null) return p.ts;
		// 只有日期（源站没给时刻）：起点 00:00 / 终点 23:59（仓库通用约定）
		const d = /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/.exec(raw);
		if (d && !ns_cytq_RELATIVE_START_RE.test(raw)) {
			return sourceInstant(Number(d[1]), Number(d[2]), Number(d[3]), isEnd ? 23 : 0, isEnd ? 59 : 0, tz);
		}
		return null;
	};
	// 起点带相对表述 ⇒ 即便 `parseTime` 将来认了这类写法，这里也一律按"起点未知"处理（不猜）
	const startTs = ns_cytq_RELATIVE_START_RE.test(a) ? null : tsOf(a, false);
	const endTs = b ? tsOf(b, true) : null;
	// `raw` = 源站原文那一句（相对词原样留着；末尾空的那一端照旧留一个 `~`）
	const raw = hasSep ? `${a} ~ ${b}`.trim() : a;
	if (!/\d{4}/.test(raw)) return null;          // 一句里一个日期都没有 ⇒ 不是档期
	const display = startTs != null && endTs != null ? fmtWindow(startTs, endTs, tz) : raw;
	return { startTs, endTs, raw, display };
}

// 详情正文里**第一个**带日期的 `活动时间` 锚点 → 档期文本（找不到 ⇒ `""`）。
// 锚点必须**在行首**（`活动时间` / `活动时间:…` / `活动时间 …`）—— 正文里"活动时间而变动"那种
// 句子（200000258 实测有 5 处）不算锚点。
function ns_cytq_windowTextOf(html) {
	const lines = ns_cytq_linesOf(html);
	for (let i = 0; i < lines.length; i++) {
		const m = /^活动时间\s*[:：]?\s*(.*)$/.exec(lines[i]);
		if (!m) continue;
		const same = m[1].trim();
		if (/\d{4}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}/.test(same)) return same;
		const next = lines[i + 1] || "";
		if (/\d{4}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}/.test(next)) return next;
	}
	return "";
}

// 正文「精选「A」「B」」连排（≥2 个名字）→ 名单。只是「登场风格」段的**退路**：
// 判据刻意收紧到「前 30 字内出现`精选`」+ 名字形态（不含全角叹号/音符/斜杠/数字），免得把
// `「奖励量表」「必得SS探索券」` 这类正文小标题当成角色（实测 1215 / 1220 / 400001432 的正文
// 都有这类连排）。
function ns_cytq_pickUpNamesOf(html) {
	const text = ns_cytq_linesOf(html).join(" ");
	const re = /精选[^。！!]{0,30}?((?:「[^「」]{1,12}」){2,})/g;
	const out = [];
	let m;
	while ((m = re.exec(text))) {
		const names = [...m[1].matchAll(/「([^「」]{1,12})」/g)].map((x) => x[1].trim());
		const ok = names.filter((n) => n && !/[！!♪～~／/\d]/.test(n));
		if (ok.length >= 2) out.push(...ok);
	}
	return out;
}

// 「登场风格」段 → 角色名数组（去 `[风格名]` 前缀、去名字中间空白，去重保序）。
function ns_cytq_styleNamesOf(html) {
	const out = [];
	const seen = new Set();
	const re = /<h2[^>]*class="header-gacha"[^>]*>([\s\S]*?)<\/h2>/gi;
	let m;
	while ((m = re.exec(String(html == null ? "" : html)))) {
		const t = stripTags(m[1]);
		// `[春色复活节兔] 小笠原 绯雨` → `小笠原 绯雨` → `小笠原绯雨`（取**最后一个** `]` 之后的部分）
		const name = t.replace(/^[\s\S]*[\]］]/, "").replace(/\s+/g, "").trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

// 详情 HTML → 条目事实 `{ title, categoryClass, side, roles, win }`。
// **结构变了要抛错**（没有 `<h1 class="article-body">` ⇒ `{}` / 空串 / 改版页）；
// 有标题但没有 `活动时间` 锚点 ⇒ `win: null`（用户口径：不进外显，但不是失败）。
function ns_cytq_detailOf(html, tz = ns_cytq_TZ) {
	const src = String(html == null ? "" : html);
	const tm = ns_cytq_TITLE_RE.exec(src);
	if (!tm) throw new Error("cytq-detail-changed:no-title");
	const title = stripTags(tm[1]);
	if (!title) throw new Error("cytq-detail-changed:no-title");
	const cm = /<div[^>]*class="article-header\s+([A-Za-z][\w-]*)"/.exec(src);
	const categoryClass = cm ? cm[1] : "";
	const winText = ns_cytq_windowTextOf(src);
	const win = winText ? ns_cytq_windowOf(winText, tz) : null;
	let roles = ns_cytq_styleNamesOf(src).join("、");
	if (!roles) roles = ns_cytq_pickUpNamesOf(src).join("、");
	return { title, categoryClass, side: ns_cytq_SIDE_BY_CLASS[categoryClass] || "", roles, win };
}
//#endregion

//#region ③ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 详情地址：按 id 自己拼（列表 href 里带会话 token，见文件头 ①）
function ns_cytq_detailUrlOf(id) {
	return ns_cytq_DETAIL_BASE + String(id == null ? "" : id) + ns_cytq_DETAIL_PARAMS;
}

// 交叉轮/轮内共用的 id → { at, post } 缓存。生产里只受 TTL 支配；
// `ns_cytq_resetDetailCache` 只给回归用（否则"首轮 1+N / 稳态 1"这两条没法在同一个进程里各钉一次）。
let ns_cytq_detailCache = new Map();
function ns_cytq_resetDetailCache() { ns_cytq_detailCache = new Map(); }

// 这一条缓存还能用吗：窗口结束 < now - 1 天 ⇒ 永久可用（已结束的帖子档期不会再变）；
// 否则按 TTL 24h。
function ns_cytq_cacheUsable(hit, now) {
	if (!hit || !hit.post) return false;
	const w = hit.post.win;
	if (w && w.endTs != null && w.endTs < now - ns_cytq_ENDED_GRACE_MS) return true;
	return now - hit.at < ns_cytq_DETAIL_TTL_MS;
}

// 列表：**轮内**复用（缓存 Promise，两侧并发也只发一次）；轮外一律现取。
let ns_cytq_listCache = null;   // { url, round, at, promise }
async function ns_cytq_listOfUrl(url, signal) {
	const key = String(url == null ? "" : url) || ns_cytq_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_cytq_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_cytq_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		// `Accept` 显式要 HTML：`rawHeaders` 默认 `application/json`，而这条源**就是**HTML 页面
		promise = fetchText(key, { mode: "direct", signal, headers: { Accept: "text/html,application/xhtml+xml" } })
			.then((html) => ns_cytq_listOf(html));
		ns_cytq_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_cytq_listCache && ns_cytq_listCache.promise === promise) ns_cytq_listCache = null; });
	}
	return promise;
}

// 一条列表项 → 条目事实（命中缓存就不发请求）；side 由**列表**的分类 class 决定
// （详情页里也有同一个 class，但列表才是"这一帖归哪一侧"的入口）。
async function ns_cytq_postOf(it, side, signal, tz, now) {
	const hit = ns_cytq_detailCache.get(it.id);
	let post = ns_cytq_cacheUsable(hit, now) ? hit.post : null;
	if (!post) {
		const html = await fetchText(ns_cytq_detailUrlOf(it.id), {
			mode: "direct", signal, headers: { Accept: "text/html,application/xhtml+xml" }
		});
		post = ns_cytq_detailOf(html, tz);
		// `at` 用**这次刷新声明的 now**（不是再取一次 nowMs()）：TTL 判定因此与调用方同一个时钟，
		// 测试里把 now 推快 25 小时就等价于"过了 25 小时"。
		ns_cytq_detailCache.set(it.id, { at: now, post });
	}
	return {
		id: it.id,
		side,
		title: post.title || it.title,
		roles: post.roles,
		win: post.win
	};
}

// 列表 + 全部相关详情 → 条目事实数组（顺序 = 列表顺序 = 从新到旧）。
// 串行取详情：源站是 H5 页面、没有并发配额承诺，14 个并发请求既无必要也不礼貌。
async function ns_cytq_postsOf(url, signal, tz, now) {
	const list = await ns_cytq_listOfUrl(url, signal);
	const out = [];
	for (const it of list) {
		const side = ns_cytq_SIDE_BY_CLASS[it.categoryClass];
		if (!side) continue;
		out.push(await ns_cytq_postOf(it, side, signal, tz, now));
	}
	return out;
}

// 卡池侧：is-gacha 帖里有窗口的 → 条目事实 → 共用载荷生成器（同批合并 + 悬停 + `gacha[]`）
async function ns_cytq_gacha(url, signal, tz = ns_cytq_TZ, now = nowMs()) {
	const posts = await ns_cytq_postsOf(url, signal, tz, now);
	const items = [];
	const seen = new Set();
	for (const p of posts) {
		if (p.side !== "gacha" || !p.win || seen.has(p.id)) continue;
		seen.add(p.id);
		items.push({
			_i: items.length,
			banner: p.title,
			roles: p.roles,
			startTs: p.win.startTs,
			endTs: p.win.endTs,
			raw: p.win.raw,
			display: p.win.display,
			isMain: true
		});
	}
	if (items.length === 0) return null;          // 列表里没有 is-gacha 帖 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "cytq" });
}

// 活动侧：is-event / is-campaign 帖里有窗口的 → 共用活动载荷
async function ns_cytq_events(url, signal, tz = ns_cytq_TZ, now = nowMs()) {
	const posts = await ns_cytq_postsOf(url, signal, tz, now);
	const items = [];
	const seen = new Set();
	for (const p of posts) {
		if (p.side !== "event" || !p.win || seen.has(p.id)) continue;
		seen.add(p.id);
		items.push({
			_i: items.length,
			event: p.title,
			category: "",
			startTs: p.win.startTs,
			endTs: p.win.endTs,
			raw: p.win.raw,
			display: p.win.display
		});
	}
	if (items.length === 0) return null;
	// 第 5 参 = 条目 id（数组 key 前缀 `cytq:event:N`；不传会与别的来源撞 key）
	return ns_bwiki_eventPayload(items, tz, now, 0, "cytq");
}
//#endregion

//#region ④ 条目登记
// 两侧同址（同一条列表 → 各自筛自己那类帖）。`source/eventSource` 的**标签逐字** = 「官网公告」
// （B 站服官方 H5 公告页；用户 2026-11-15 复核项，见交接报告）。
// 2026-11-19 用户口径：出厂隐藏 = **至少一侧（url / eventUrl）未配置**的条目。
// cytq 两侧都有来源（官方 H5 公告）⇒ **恢复出厂展示**（`defaultHidden: false`）。
registerSource({
	id: "cytq",
	defaultHidden: false,
	tz: ns_cytq_TZ,
	// 用户原话写作「炽焰苍穹」，官方/商店/条目的正式名是「炽焰天穹」（bwiki 子站目录也叫 cytq）
	// ⇒ 显示名按正式名，id 保持用户给的 `cytq`。
	name: "炽焰天穹",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/dc/98/e4/dc98e45f-29eb-d517-0ebb-77e6867fd79f/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/512x512bb.jpg",
	url: ns_cytq_LIST_URL,
	source: "官网公告",
	eventUrl: ns_cytq_LIST_URL,
	eventSource: "官网公告"
});
GACHA_FETCHERS["cytq"] = (url, signal, tz, now) => ns_cytq_gacha(url, signal, tz, now);
EVENT_FETCHERS["cytq"] = Object.assign(EVENT_FETCHERS["cytq"] || {}, {
	default: (url, signal, tz, now) => ns_cytq_events(url, signal, tz, now)
});
//#endregion
