// src/client/30-game-longhun.js —— 龙魂旅人（台服官网公告：卡池 + 活动**同源**）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"longhun"`，
// 卡池侧与活动侧**共用一份 JSON 索引**（详情按 id 缓存），标签逐字「官网公告」。
// 时区 = `Asia/Bangkok`（UTC+7；公告正文明确写 (UTC+7)，见 ①末尾）。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/longhun-list / longhun-detail-{981,863,994,1287}）──
//   列表 `GET https://news.game-tree.com/jx/dtofficialnewszh/`
//     200 / **1,230 B** / 响应体是 **JSON 数组**，但 `content-type` 写的是 `text/html`（别按它判）。
//     结构 `[{ id, url, newscover, title, time:"DD-MM-YYYY" }]` —— **只有 4 条**，只给「标题 + 发布日」，
//     档期必须进详情页（见下）。
//     ⚠️ `time` 是 **DD-MM-YYYY**（`08-01-2026` = 1 月 8 日），不是 MM-DD；按 `MM` 解析会整体错位。
//     ⚠️ 实测 2026-11-15 这份**中文索引**里最新一条是 `2026-05-05`（4 条全是 2025-11 ~ 2026-05 的公测期公告）
//        ⇒ 当期必然解不出东西（见 ⑤，这是源站的陈旧，不是解析失败）。
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 PROXY_ALLOW_HOSTS）。
//   详情 `<url>` = 相对路径 `/jx/dtofficialnewszh/YYYYMMDD/{id}.html`，拼到 `https://news.game-tree.com`
//     200 / 3.7~5.1 KB / **服务端渲染**（无 JS）。整页里真正要的是三段：
//       `<h1 class="title">标题</h1>`、`<p class="time">DD-MM-YYYY</p>`、
//       `<div class="tempText">` 正文（**每行一个 `<div>`**，实体是 `&middot;` / `&nbsp;` / `&mdash;`）。
//   档期写法（实测 1287，一篇里 4 个窗口，逐字）：
//     `▌全新限定召唤卡池 - 护戒圣女·丝碧莫` ⏎ `活动时间：5月7日5:00 - 5月21日4:59 (UTC+7)`
//     `▌主题活动 - 「潜伏的厄运」`          ⏎ `活动时间：5月7日5:00 - 5月21日4:59 (UTC+7)`
//     `▌限定炼制 - 指定魔物限时UP`          ⏎ `活动时间：5月7日5:00 - 5月14日4:59 (UTC+7)`
//     `▌新一轮周活动即将开启` ⏎ `⭐本轮活动主题：神奇魔物在哪里` ⏎ `活动时间：5月7日5:00 - 5月14日4:59 (UTC+7)`
//     ⇒ 名字行 = 上一行 `▌…`（去掉 `▌` 后若含 ` - ` 取**后半段**）；
//        `▌…` 与锚点之间若还有 `本轮活动主题：X`，**X 优先**（"即将开启"不是名字）。
//     ⚠️ **`(UTC+7)` / `(UTC+9)` 在同一个索引里混着出现**（1287 写 UTC+7、994 写 UTC+9）⇒
//        后缀是跨区搬运的残留、**不可信**；按条目 tz 解析墙钟，后缀解析前剥掉、**不进悬停**（与 wxnn 同手法）。
//     ⚠️ 只有单点的写法（`开启时间：5月7日6:00 (UTC+7)`、`公测时间：2026年1月13日10:00 (UTC+9)`）
//        **不是窗口**（两端不齐不产出）；正文里 `解锁条件：通关主线2-4` 这类更不是时间。
//
// ── ② 卡池 / 活动怎么分（只认 `▌` 原句的关键词，不看清洗后的名字）──────────────────────
//   `卡池 | 召唤 | 炼制 | 扭蛋 | 招募 | 祈愿` ⇒ 卡池；`活动 | 玩法 | 挑战 | 赛季 | 签到 | 福利` ⇒ 活动；
//   两边都不沾（例：`▌时之宝匣 - 时之隙预热礼包！`）⇒ **两侧都不要**（礼包不是卡池也不是活动）。
//   ⚠️ 必须用 `▌` **原句**判定：清洗后的池名（`护戒圣女·丝碧莫`）把「召唤卡池」这个词丢了。
//
// ── ③ 请求预算（用户口径：列表 1 + 新详情，详情按 id 缓存 TTL 24h，已结束不再取）──────────
//   第 1 轮 = 列表 1 次 + 最多 4 篇详情（索引一共 4 条 ⇒ `ns_longhun_MAX_DETAILS = 4`）⇒ 实测 5 次。
//   稳态 = 1 次（只列表；详情按 id 缓存 24h，且**窗口全都结束过的详情永不重取**）。
//   两侧**共用同一次采集**：轮内靠 `fetchRoundSeqOf()` 的 promise 缓存（与 wxnn 同一套），
//   于是"卡池侧抓完、活动侧再抓"不会重复发请求。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（不是数组 / 一条合法项都没有）⇒ **抛**（`longhun-list-changed:*`）；
//   · 详情结构变了（没有 `<h1 class="title">` / 没有 `<div class="tempText">`；`{}` / 空串 / 改版页）⇒ **抛**
//     （`longhun-detail-changed:*`）；
//   · 正文正常但没有「活动时间」锚点、或锚点两端不齐 ⇒ 这一篇 0 个窗口（**不抛、也不硬凑**）；
//   · 详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 实测）──────────────────────────────────────────────────
//   中文索引 4 条的最新一条 = `2026-05-05` 的维护公告（窗口 05-07 ~ 05-21）；
//   at 2026-11-15 15:xx +08 跑**两侧都是 null（nomatch）** —— 源站中文索引已 6 个月没更新
//   （同款游戏的**英文/泰文**索引进到 2026-11-11，但那是另一个 locale 的频道，本条目按任务口径只接 `zh`）。
//   用抓取当天的时刻（2026-05-10）复跑时：卡池 = `护戒圣女·丝碧莫`（05-07 05:00 ~ 05-21 04:59）、
//   活动 = `潜伏的厄运`（05-07 05:00 ~ 05-21 04:59）+ `神奇魔物在哪里`（05-07 05:00 ~ 05-14 04:59）。
//   时区 = `Asia/Bangkok`（UTC+7；公告正文逐条写了 (UTC+7)，见 ①；后缀解析前剥掉、不进悬停）。

//#region ① 常量
// 2026-11-15 修正：源站是《Dragon Traveler》（龙魂旅人 东南亚/国际服）的官方中文公告，
// 正文自己写明服务器时间 = UTC+7（维护 5月6日13:00 (UTC+7)、卡池 5月7日5:00 - 5月21日4:59 (UTC+7)）
// ⇒ 条目时区改用 Asia/Bangkok（UTC+7）。此前按 Asia/Taipei 是错的。
const ns_longhun_TZ = "Asia/Bangkok";
const ns_longhun_ORIGIN = "https://news.game-tree.com";
const ns_longhun_LIST_URL = "https://news.game-tree.com/jx/dtofficialnewszh/";
const ns_longhun_SOURCE_LABEL = "官网公告";
// 索引一共 4 条 ⇒ 每轮最多取 4 篇详情（见文件头 ③）
const ns_longhun_MAX_DETAILS = 4;
// 详情解析结果缓存 TTL = 24h（按 id 缓存；换公告不会串）
const ns_longhun_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 列表段/正文段的字面锚点（源站改版时这里先坏，报错信息因此能定位）
const ns_longhun_TEXT_OPEN = '<div class="tempText">';
const ns_longhun_TITLE_RE = /<h1\b[^>]*\bclass="title"[^>]*>([\s\S]*?)<\/h1>/i;
const ns_longhun_DATE_RE = /<p\b[^>]*\bclass="time"[^>]*>([\s\S]*?)<\/p>/i;
// `DD-MM-YYYY`（列表 time 字段 + 详情页头，两处同一口径）
const ns_longhun_DAY_RE = /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/;
// 档期锚点：整行以「活动时间」开头（可带 `〓` 之类前缀符号），值可同行或下一行
const ns_longhun_ANCHOR_RE = /^(?:[※*·●▸➤〓■□☆◆◇>＞▶\s]*)(活动时间)\s*[：:]\s*(.*)$/;
// 名字行 / 「本轮活动主题」
const ns_longhun_NAME_LINE_RE = /^▌\s*(.+)$/;
const ns_longhun_TOPIC_RE = /本轮活动主题\s*[：:]\s*(.+)$/;
// 窗口：两端都必须是「M月D日H:MM」（年份可缺 → 借发布日补；实测 1287 两端都无年份）
const ns_longhun_WINDOW_RE = new RegExp(
	String.raw`^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*`
	+ String.raw`[-~～—–－至到]\s*`
	+ String.raw`(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})$`
);
// 时区后缀（`(UTC+7)` / `（UTC+9）` / `(GMT+8)`）—— 剥掉，不进悬停（见文件头 ①）
const ns_longhun_SUFFIX_RE = /[\s]*[（(]\s*(?:UTC|GMT)\s*[+＋-]\s*\d{1,2}(?::\d{2})?\s*[）)]\s*$/i;
// 归属关键词（只认 `▌` 原句，见文件头 ②）
const ns_longhun_GACHA_RE = /卡池|召唤|炼制|扭蛋|招募|祈愿|祈願/;
const ns_longhun_EVENT_RE = /活动|活動|玩法|挑战|挑戰|赛季|賽季|签到|簽到|福利/;
// 名字行里 ` - ` 分隔「类别 / 具体名字」（`▌全新限定召唤卡池 - 护戒圣女·丝碧莫`）
const ns_longhun_NAME_SPLIT_RE = /\s+[-—－–]\s+/;
//#endregion

//#region ② 纯解析：列表
// JSON 索引 → `[{ id, url, title, date, dateTs }]`，按发布日期倒序（同日按 id 倒序）。
// **结构变了要抛**：不是数组 / 一条合法项都没有（`{}` / 空串 / 改版页都落这里）。
function ns_longhun_listOf(raw) {
	let j;
	try { j = JSON.parse(String(raw == null ? "" : raw)); } catch { throw new Error("longhun-list-changed:bad-json"); }
	if (!Array.isArray(j)) throw new Error("longhun-list-changed:not-array");
	const out = [];
	for (const it of j) {
		if (!it || typeof it !== "object") continue;
		const id = String(it.id == null ? "" : it.id).trim();
		const url = ns_longhun_absUrlOf(it.url);
		const title = htmlTextTight(it.title == null ? "" : it.title);
		const dm = ns_longhun_DAY_RE.exec(String(it.time == null ? "" : it.time).trim());
		if (!id || !url || !title || !dm) continue;
		const mo = Number(dm[2]), d = Number(dm[1]);
		if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
		out.push({
			id,
			url,
			title,
			date: String(it.time).trim(),
			dateTs: sourceInstant(Number(dm[3]), mo, d, 0, 0, ns_longhun_TZ)
		});
	}
	if (out.length === 0) throw new Error("longhun-list-changed:no-item");
	return out.sort((x, y) => ((y.dateTs || 0) - (x.dateTs || 0)) || (Number(y.id) - Number(x.id)));
}
// 索引里的 `url` 是 `/jx/…` 相对路径 ⇒ 拼成绝对地址（已经是绝对地址就原样）
function ns_longhun_absUrlOf(u) {
	const s = String(u == null ? "" : u).trim();
	if (!s) return "";
	if (/^https?:\/\//i.test(s)) return s;
	return ns_longhun_ORIGIN + (s.startsWith("/") ? s : "/" + s);
}
//#endregion

//#region ③ 纯解析：详情（正文行 → 整行区间 → 条目事实）
// 详情页 → 正文行数组。取 `<div class="tempText">` 到 `</body>` 这一段（内层还有大量 `<div>`，
// 所以**不能**找第一个 `</div>`）；块级收尾当行边界，其余标签不插分隔符（实体再解一遍）。
// 没有 `tempText` 段 ⇒ null（结构变了，调用方抛）。
function ns_longhun_linesOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_longhun_TEXT_OPEN);
	if (a < 0) return null;
	const b = src.indexOf("</body>", a);
	const seg = b > a ? src.slice(a, b) : src.slice(a);
	return seg
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:div|p|li|h[1-6]|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情页 → `{ title, date, windows:[{ name, kind, startTs, endTs, raw, display }] }`。
// **没有标题 / 没有正文段 ⇒ 抛**（`{}` / 空串 / 改版页）；有正文但没有窗口 ⇒ `windows: []`。
function ns_longhun_detailOf(html, tz = ns_longhun_TZ) {
	const src = String(html == null ? "" : html);
	const tm = ns_longhun_TITLE_RE.exec(src);
	if (!tm) throw new Error("longhun-detail-changed:no-title");
	const lines = ns_longhun_linesOf(src);
	if (lines == null) throw new Error("longhun-detail-changed:no-body");
	const title = decodeExtra(stripTags(tm[1])).replace(/\s+/g, " ").trim();
	const dm = ns_longhun_DATE_RE.exec(src);
	const date = dm ? decodeExtra(stripTags(dm[1])).trim() : "";
	const hint = ns_longhun_hintOf(date);
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const m = ns_longhun_ANCHOR_RE.exec(lines[i]);
		if (!m) continue;
		const text = String(m[2] || "").trim() || lines[i + 1] || "";
		const w = ns_longhun_windowOf(text, hint, tz);
		if (!w) continue;                                    // 单点 / 两端不齐 ⇒ 不是窗口（不硬凑）
		const named = ns_longhun_nameOf(lines, i);
		if (!named) continue;                                // 没有名字行 ⇒ 不产出（宁可不产出）
		const kind = ns_longhun_kindOf(`${named.source} ${named.name}`);
		if (!kind) continue;                                 // 礼包 / 说明类 ⇒ 两侧都不要
		const key = `${kind}|${w.startTs}|${w.endTs}|${named.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({
			name: ns_longhun_cleanNameOf(named.name),
			kind,
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display
		});
	}
	return { title, date, windows };
}
// 详情页头日期（`DD-MM-YYYY`）→ 年份线索 `{ y, mo }`（给无年份的窗口行补年）
function ns_longhun_hintOf(date) {
	const m = ns_longhun_DAY_RE.exec(String(date == null ? "" : date).trim());
	if (!m) return null;
	return { y: Number(m[3]), mo: Number(m[2]) };
}
// 一段档期文本 → `{ startTs, endTs, raw, display }`；两端不齐 ⇒ null（不硬凑）。
function ns_longhun_windowOf(text, hint, tz = ns_longhun_TZ) {
	const s = String(text == null ? "" : text).replace(ns_longhun_SUFFIX_RE, "").trim();
	const m = ns_longhun_WINDOW_RE.exec(s);
	if (!m) return null;
	const sm = Number(m[2]), sd = Number(m[3]);
	const startY = inferYear(m[1] != null ? Number(m[1]) : null, sm, hint);
	if (startY == null) return null;
	const em = Number(m[7]), ed = Number(m[8]);
	const endY = m[6] != null ? Number(m[6]) : startY + (endsNextYear(sm, sd, em, ed) ? 1 : 0);
	const startTs = sourceInstant(startY, sm, sd, Number(m[4]), Number(m[5]), tz);
	const endTs = sourceInstant(endY, em, ed, Number(m[9]), Number(m[10]), tz);
	if (!(endTs > startTs)) return null;             // 源站错行 ⇒ 丢掉，不硬造
	return {
		startTs,
		endTs,
		raw: s,
		display: fmtWindow(startTs, endTs, tz)
	};
}
// 窗口行往上最多 3 行找名字：`本轮活动主题：X` 优先，其次 `▌…`；都没有 ⇒ null（不产出）。
// 返回 `{ name, source }`：`name` = 可读名（`source` 里取出的那一段），
// `source` = **判定归属用的原句**（`▌新一轮周活动即将开启` 本身带「活动」，清洗后的名字不带 —— 见文件头 ②）。
function ns_longhun_nameOf(lines, at) {
	const list = Array.isArray(lines) ? lines : [];
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const line = String(list[j] == null ? "" : list[j]);
		const topic = ns_longhun_TOPIC_RE.exec(line);
		if (topic) return { name: String(topic[1] || "").trim(), source: line };
	}
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const line = String(list[j] == null ? "" : list[j]);
		const nm = ns_longhun_NAME_LINE_RE.exec(line);
		if (nm) return { name: String(nm[1] || "").trim(), source: line };
	}
	return null;
}
// `▌` 原句 → 归属（见文件头 ②；**用原句**，因为清洗后的池名会把「召唤卡池」丢掉）
function ns_longhun_kindOf(nameLine) {
	const s = String(nameLine == null ? "" : nameLine);
	if (ns_longhun_GACHA_RE.test(s)) return "gacha";
	if (ns_longhun_EVENT_RE.test(s)) return "event";
	return "";
}
// `▌` 原句 → 可读名：含 ` - ` 取后半段（`全新限定召唤卡池 - 护戒圣女·丝碧莫` ⇒ `护戒圣女·丝碧莫`）；
// 整名被一对「」包住就留里面的（`主题活动 - 「潜伏的厄运」` ⇒ `潜伏的厄运`）。
function ns_longhun_cleanNameOf(nameLine) {
	let s = String(nameLine == null ? "" : nameLine).replace(/^▌\s*/, "").replace(/\s+/g, " ").trim();
	const parts = s.split(ns_longhun_NAME_SPLIT_RE);
	if (parts.length > 1 && parts[parts.length - 1].trim()) s = parts[parts.length - 1].trim();
	const q = /^「([^」]{1,60})」$/.exec(s);
	if (q) s = q[1].trim();
	return s;
}
// 详情 → 卡池条目事实（每个卡池窗口一口池；roles 留空 —— 源站没给「池名：角色」的分离写法）
function ns_longhun_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		if (w.kind !== "gacha") continue;
		items.push({
			_i: items.length,
			banner: w.name,
			roles: "",
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display,
			isMain: true
		});
	}
	return items;
}
// 详情 → 活动条目事实（活动名 = 清洗后的名字；类别留空）
function ns_longhun_eventItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		if (w.kind !== "event") continue;
		items.push({
			_i: items.length,
			event: w.name,
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
// 缓存两级：`ns_longhun_detailCache` 按 id（TTL 24h；**窗口全都结束过的详情永不重取**），
// `ns_longhun_roundCache` 轮内共享同一份采集 promise（两侧同源 ⇒ 整轮只发一遍请求）。
let ns_longhun_detailCache = new Map();       // id → { at, fact }
let ns_longhun_roundCache = { round: -1, promise: null };
function ns_longhun_resetCache() { ns_longhun_detailCache = new Map(); ns_longhun_roundCache = { round: -1, promise: null }; }
// 这篇详情还会不会有新信息：一个窗口都没有、或窗口全都结束过 ⇒ 封存（不再重取）
function ns_longhun_sealedOf(fact, now) {
	const all = (fact && Array.isArray(fact.windows)) ? fact.windows : [];
	if (all.length === 0) return true;
	return all.every((w) => w.endTs != null && w.endTs < now);
}
function ns_longhun_cachedOf(id, now) {
	const hit = ns_longhun_detailCache.get(id);
	if (!hit) return null;
	if (ns_longhun_sealedOf(hit.fact, now)) return hit;
	return now - hit.at < ns_longhun_CACHE_TTL_MS ? hit : null;
}
// 列表 → 详情 → 事实数组。详情全部失败且一条都没解析出来 ⇒ 抛（抓取失败 ≠ 未公布）。
async function ns_longhun_collect(url, signal, tz, now) {
	const listUrl = String(url == null ? "" : url).trim() || ns_longhun_LIST_URL;
	const rows = ns_longhun_listOf(await fetchText(listUrl, { mode: "proxy", referer: ns_longhun_LIST_URL, signal }));
	const facts = [];
	let firstErr = null, parsed = 0;
	for (const row of rows.slice(0, ns_longhun_MAX_DETAILS)) {
		const hit = ns_longhun_cachedOf(row.id, now);
		if (hit) { facts.push(hit.fact); continue; }
		try {
			const html = await fetchText(row.url, { mode: "proxy", referer: ns_longhun_LIST_URL, signal });
			const fact = ns_longhun_detailOf(html, tz);
			ns_longhun_detailCache.set(row.id, { at: now, fact });
			parsed++;
			facts.push(fact);
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (parsed === 0 && firstErr) throw firstErr;
	return facts;
}
// 轮内共享（`fetchRoundSeqOf`）：卡池侧先跑、活动侧后跑，同一轮只采集一次
function ns_longhun_collectInRound(url, signal, tz, now) {
	const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
	if (round > 0 && ns_longhun_roundCache.round === round && ns_longhun_roundCache.promise) return ns_longhun_roundCache.promise;
	const promise = ns_longhun_collect(url, signal, tz, now);
	if (round > 0) {
		ns_longhun_roundCache = { round, promise };
		promise.catch(() => { if (ns_longhun_roundCache.promise === promise) ns_longhun_roundCache = { round: -1, promise: null }; });
	}
	return promise;
}
async function ns_longhun_gacha(url, signal, tz = ns_longhun_TZ, now = nowMs()) {
	const facts = await ns_longhun_collectInRound(url, signal, tz, now);
	const items = [];
	for (const fact of facts) for (const it of ns_longhun_poolItemsOf(fact)) items.push(Object.assign({}, it, { _i: items.length }));
	if (items.length === 0) return null;                       // 没有带窗口的卡池公告 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "longhun" });
}
async function ns_longhun_events(url, signal, tz = ns_longhun_TZ, now = nowMs()) {
	const facts = await ns_longhun_collectInRound(url, signal, tz, now);
	const items = [];
	for (const fact of facts) for (const it of ns_longhun_eventItemsOf(fact)) items.push(Object.assign({}, it, { _i: items.length }));
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "longhun");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条 JSON 索引**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告」。
registerSource({
	id: "longhun",
	defaultHidden: false,
	tz: ns_longhun_TZ,
	name: "龙魂旅人·东南亚服",
	icon: "https://media.zlongame.com/media/pictures/cn/lhlr/img/fav.png",
	url: ns_longhun_LIST_URL,
	source: ns_longhun_SOURCE_LABEL,
	eventUrl: ns_longhun_LIST_URL,
	eventSource: ns_longhun_SOURCE_LABEL
});
GACHA_FETCHERS["longhun"] = (url, signal, tz, now) => ns_longhun_gacha(url, signal, tz, now);
EVENT_FETCHERS["longhun"] = Object.assign(EVENT_FETCHERS["longhun"] || {}, {
	default: (url, signal, tz, now) => ns_longhun_events(url, signal, tz, now)
});
//#endregion
