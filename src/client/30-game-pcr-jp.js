// src/client/30-game-pcr-jp.js —— プリンセスコネクト！Re:Dive 日服（microCMS 官方公告：卡池 + 活动**同源**）
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"pcr-jp"`，
// 卡池侧与活动侧**共用一份公告列表**，标签逐字「官网公告（日文）」（两侧同一条）。
// 与 `30-game-pcr-tw.js`（繁中服 So-net 官网 HTML）**不是**同一套接口：日服走 microCMS JSON。
//
// ── ① 站点形态（2026-11-15 16:36 JST 实测；夹具 test/fixtures/pcr-jp-*）──────────────
//   列表 `GET https://bekr66d8pd-833ej8ymdl32y5zpbknx.microcms.io/api/v1/news`
//     `?filters=title[contains]ガチャ[or]categories[contains]イベント`
//     `&limit=20&fields=id,title,categories,display_date&orders=-display_date`
//     header **必须**带 `X-MICROCMS-API-KEY: OeGtcSAG23n5RAIQO9RtDLvroc0ROUR4m1ci`
//     200 / `application/json; charset=utf-8` / 每行 `{ id, title, categories[], display_date(ISO/UTC) }`
//     全量 `totalCount=6620`（limit 单独请求）；本条的 filter 组合 `totalCount=2072`。
//     `orders=-display_date` 让源站直接倒序；`fields` 只要 4 个键 ⇒ 响应 ~3.6 KB。
//     ⚠️ 一次 filter **同时圈住两侧**（activity 靠 `categories` 含「イベント」，卡池靠标题含「ガチャ」），
//        所以"列表 1 次"就能同时喂卡池与活动（见 ③）。
//     ⚠️ 响应带 `Access-Control-Allow-Origin: *`，且 OPTIONS 预检明确放行自定义头
//        （`Access-Control-Allow-Headers` 里有 `X-Microcms-Api-Key`；带 `Origin: dsh-app://dsh`
//        实测预检 200）⇒ 浏览器可**直连**（`mode: "direct"`），不进宿主代理白名单
//        （`tools/check-host-allow.mjs` 的 `DIRECT_HOSTS` 同步登记了这个域名）。
//   详情 `GET …/api/v1/news/{id}`（同域、同一把 key、同样 ACAO * ⇒ 直连）
//     200 / 6~9 KB JSON，字段 `id/createdAt/updatedAt/publishedAt/revisedAt/display_date/
//     categories/thumbnail/display_flag/title/body_html`；正文只在 `body_html`（HTML 串，**单行**）。
//   正文写法（实测多篇逐篇一致）：
//     `<p>■ピックアップガチャ開催期間<br>2026/11/10(火) 12:00 ～ 2026/11/30(月) 11:59<br>…</p>`
//     ⇒ 锚点行 `■…期間` + **下一行恰为日期区间**（两端 4 位年 + 时分 + `(曜日)`，分隔符 `～`/`~`）。
//     实测锚点：`■ピックアップガチャ開催期間` / `■開催期間`（活动）/ `■マスターピースつき ★3確定
//     プラチナガチャ開催期間`（非本命池，见 ②）。另有 `■イベント期間` 一类同类锚点，尾缀一律剥掉。
//     ⚠️ 只在**整行恰为区间**时认窗口：这两篇里各有一条"行内日期"陷阱（实测逐字保留在夹具里）——
//        カード池正文的 `※マスターピースつき ★3確定プラチナガチャの開催期間は2026/11/10(火) 12:00
//        ～ 2026/11/16(月) 11:59までです。`、活动正文的 `※★獲得報酬は、2026/11/19(木) 14:59まで
//        受け取ることができます。`、以及注意事項里的 `3. 2026/11/10(火) 11:59以前から…` 都**不是**档期。
//   详情里同一篇会写多个 `■…期間`（如マスターピース期間、販売期間）⇒ 只认"锚点行 + 整行区间"这一对，
//   每对产一条窗口；名字 = 锚点行去掉尾缀（`開催期間`/`イベント期間`/`販売期間`/`期間`）。
//
// ── ② 卡池 / 活动怎么分（标题 + categories）─────────────────────────────────────────
//   卡池 = 标题含「ピックアップガチャ」或「フェスガチャ」（本命池：期间限定角色 / プリンセスフェス）。
//     标题里 `期間限定キャラ「…」`/`限定キャラ「…」` 的引号内是**角色**；池名取正文锚点
//     （`ピックアップガチャ` / `プリンセスフェスガチャ`），锚点拿不到才退回标题里的 `…ガチャ`。
//     ⚠️ **不**收同期并行的其他池 —— `マスターピースつき ★3確定プラチナガチャ` / `選べるプライズガチャ` /
//        `10回目ピックアップキャラ出現率3倍ガチャ` / `コネクトコインつき ★3確定プラチナガチャ`
//        都写成 `お知らせ`、标题也不含「ピックアップガチャ」⇒ 天然落进 other。
//        （口径同 `hl-jp`：只认「期間限定建造」那种"本命池"，不收常驻/付费/次数池。）
//   活动 = `categories` 含「イベント」。标题尾巴（`開催決定！`/`開催中！`/`開催期間終了！`）剥掉；
//     `「…」` 包住的就用引号里的名字（`復刻ストーリーイベント「…」開催決定！` ⇒ 引号内）；
//     **标题已写明 `開催期間終了`/`開催終了` 的直接不收**（已结束的正文没必要再抓，省一个请求）。
//   其余（`アップデート` / `メンテナンス` / 纯 `お知らせ`）两侧都不要。
//
// ── ③ 请求预算（用户口径：列表 1 + 新公告详情；详情按 id 缓存 TTL 24h，已结束不再取）──────────
//   第 1 轮 = **列表 1 次**（两侧共用同一次请求，`fetchRoundSeqOf` + 轮内 Promise）+ 详情：
//     卡池侧 1 篇（当期本命池）、活动侧 3 篇（明日开的活动 → 无整行区间的复刻活动 → 当期活动），
//     命中当期窗口即**提前收**（`ns_pcr_JP_MAX_DETAILS` = 4 是上限，不是固定值）⇒ 实测 5 次。
//   稳态 = **1 次**（只列表；详情正文按 id 缓存 24h；已结束的（窗口全部 endTs<=抓取时刻）缓存
//     永久有效 —— "已结束不再取"，见 `ns_pcr_JP_cacheSealedOf`）。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchJson` 自己抛 `http-…`）；
//   · 列表结构变了（`{}` / 空串 / 没有 `contents` / 一条可用行都没有）⇒ **抛**（`pcr-jp-list-changed:*`）；
//   · 详情结构变了（`{}` / 空串 / 没有 `body_html` / `body_html` 不是非空字符串 / 正文里抽不出任何一行）
//     ⇒ **抛**（`pcr-jp-detail-changed:*`）；**不是** nomatch；
//   · 正文正常但**没有任何整行区间**（锚点被抹掉）⇒ 不抛，这一篇就是"没有窗口"（不进外显）；
//   · 详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 16:36 JST 实测）────────────────────────────────────────
//   卡池 = `ピックアップガチャ`（`ラッキーライラック`）11-10 12:00 ~ 11-30 11:59 在期；
//   活动 = `バトルスタジアム` 11-09 12:00 ~ 11-15 20:59 在期（当天 20:59 收）；
//   明日 11/16 12:00 开的 `エルピス討魔戦線`（11-16 12:00 ~ 11-22 04:59）抓到了但**尚未在期** ⇒
//   如实不进外显（`ns_bwiki_eventPayload` 只收覆盖 now 的条目）。
//   时区 = `Asia/Tokyo`（源站公告墙钟就是 JST；与 UTC 的换算由 `sourceInstant` 负责）。

//#region ① 常量
const ns_pcr_JP_TZ = "Asia/Tokyo";
const ns_pcr_JP_API_BASE = "https://bekr66d8pd-833ej8ymdl32y5zpbknx.microcms.io/api/v1/news";
// microCMS 的**读**用 API key（官方文档口径：只读 key 就是放在前端公开调用的，写 key 才有危险）
const ns_pcr_JP_API_KEY = "OeGtcSAG23n5RAIQO9RtDLvroc0ROUR4m1ci";
// 一次 filter 同时圈卡池与活动；`orders=-display_date` 让源站排好序（不在本地猜排序）
const ns_pcr_JP_LIST_URL = ns_pcr_JP_API_BASE
	+ "?filters=" + encodeURIComponent("title[contains]ガチャ[or]categories[contains]イベント")
	+ "&limit=20&fields=id,title,categories,display_date&orders=-display_date";
const ns_pcr_JP_DETAIL_BASE = ns_pcr_JP_API_BASE + "/";
const ns_pcr_JP_SOURCE_LABEL = "官网公告（日文）";
// 每侧最多取几篇详情（见文件头 ③：命中当期窗口会提前收，4 只是上限）
const ns_pcr_JP_MAX_DETAILS = 4;
// 详情正文解析结果缓存 TTL = 24h（按 id 缓存，换池不会串）
const ns_pcr_JP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq / pcr-tw 的 30s）
const ns_pcr_JP_ROUND_TTL_MS = 30000;
// 本命池 = 标题含这两个字样（见文件头 ②）
const ns_pcr_JP_GACHA_TITLE_RE = /(?:ピックアップ|フェス)ガチャ/;
const ns_pcr_JP_EVENT_CATEGORY = "イベント";
// 标题已写明"已结束"的活动公告：没必要再抓正文（省一个请求；正文里那串窗口也已过期）
const ns_pcr_JP_ENDED_TITLE_RE = /(?:開催期間終了|開催終了)[！!。]*(?:【[^】]{0,40}】)?\s*$/;
// 正文里"一整行恰为一个日期区间"：两端 4 位年 + 时分 + 可选 `(曜日)`（见文件头 ①）。
// 结束年可省（实测没出现，出现时按 `endsNextYear` 判）；分隔符 `～`/`~`/`〜` 全认。
const ns_pcr_JP_RANGE_RE = /^(\d{4})\s*[\/／]\s*(\d{1,2})\s*[\/／]\s*(\d{1,2})(?:\s*\([^)]{1,12}\))?\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*[～~〜]\s*(?:(\d{4})\s*[\/／]\s*)?(\d{1,2})\s*[\/／]\s*(\d{1,2})(?:\s*\([^)]{1,12}\))?\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
// 锚点行（`■ピックアップガチャ開催期間`）
const ns_pcr_JP_LABEL_RE = /^■\s*(.{1,60}?)\s*$/;
// 锚点行尾缀：剥掉这些词，剩下的才是"这个档期叫什么"
const ns_pcr_JP_LABEL_TAIL_RE = /(?:開催|イベント|販売|提供)?期間$/;
// 标题派生活动名要剥的尾巴（`…開催決定！` / `…開催中！`）
const ns_pcr_JP_EVENT_TAIL_RE = /(?:開催期間終了|開催終了|開催決定|開催中|開催)[！!。\s]*$/;
// 标题里的「…」：角色名（卡池）/ 活动名（活动）都从这取
const ns_pcr_JP_QUOTED_RE = /「([^「」]{1,80})」/;
//#endregion

//#region ② 纯解析：列表
// 列表 JSON → `[{ id, title, categories, kind }]`（顺序 = 源站 `orders=-display_date`，本地不再排）。
// **结构变了要抛**：`{}` / 空串 / 没有 `contents` / 一条可用行都解析不出。
function ns_pcr_jp_listOf(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("pcr-jp-list-changed:bad-json");
	if (!Array.isArray(json.contents)) throw new Error("pcr-jp-list-changed:no-contents");
	const out = [];
	for (const x of json.contents) {
		if (!x || typeof x !== "object") continue;
		const id = String(x.id == null ? "" : x.id).trim();
		if (!id) continue;
		const title = String(x.title == null ? "" : x.title).trim();
		const categories = Array.isArray(x.categories) ? x.categories.map((c) => String(c == null ? "" : c).trim()) : [];
		out.push({
			id,
			title,
			categories,
			displayDate: String(x.display_date == null ? "" : x.display_date),
			kind: ns_pcr_jp_kindOf(title, categories)
		});
	}
	if (out.length === 0) throw new Error("pcr-jp-list-changed:no-item");
	return out;
}
// 标题 + categories → 哪一侧（见文件头 ②）：gacha / event / ended / other
function ns_pcr_jp_kindOf(title, categories) {
	const t = String(title == null ? "" : title);
	if (ns_pcr_JP_GACHA_TITLE_RE.test(t)) return "gacha";
	const cats = Array.isArray(categories) ? categories : [];
	if (!cats.includes(ns_pcr_JP_EVENT_CATEGORY)) return "other";
	return ns_pcr_JP_ENDED_TITLE_RE.test(t) ? "ended" : "event";
}
//#endregion

//#region ③ 纯解析：详情（body_html → 行 → 整行区间 → 条目事实）
// body_html → 行数组。`<br>` / `</p>` / 块级收尾都当行边界，**其余标签不插分隔符**；
// 实体再解一遍（`&nbsp;` 等）。抽不出任何一行 ⇒ 返回空数组（调用方当结构变了抛）。
function ns_pcr_jp_linesOf(bodyHtml) {
	return String(bodyHtml == null ? "" : bodyHtml)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情 JSON → `{ title, windows:[{ label, startTs, endTs, raw, display }] }`。
// **没有 body_html（`{}` / 空串 / 改版页）⇒ 抛**；正文正常但没有整行区间 ⇒ `windows: []`（不抛）。
function ns_pcr_jp_detailOf(json, tz = ns_pcr_JP_TZ) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("pcr-jp-detail-changed:bad-json");
	const body = json.body_html;
	if (typeof body !== "string" || body.trim() === "") throw new Error("pcr-jp-detail-changed:no-body");
	const lines = ns_pcr_jp_linesOf(body);
	if (lines.length === 0) throw new Error("pcr-jp-detail-changed:no-lines");
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const w = ns_pcr_jp_windowOf(lines[i], tz);
		if (!w) continue;
		const label = ns_pcr_jp_labelOf(lines, i);
		const key = `${w.startTs}|${w.endTs}|${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({ label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	return { title: String(json.title == null ? "" : json.title).trim(), windows };
}
// 一整行 → 窗口；不是"整行恰为区间"⇒ null（行内日期 / 前瞻句都落这里）
function ns_pcr_jp_windowOf(line, tz) {
	const raw = String(line == null ? "" : line).trim();
	const m = ns_pcr_JP_RANGE_RE.exec(raw);
	if (!m) return null;
	const y1 = +m[1], mo1 = +m[2], d1 = +m[3], h1 = +m[4], mi1 = +m[5];
	let y2 = m[6] == null ? y1 : +m[6];
	const mo2 = +m[7], d2 = +m[8], h2 = +m[9], mi2 = +m[10];
	if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || h1 > 23 || mi1 > 59) return null;
	if (mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31 || h2 > 23 || mi2 > 59) return null;
	// 结束年没写且终点月日排在起点前面 ⇒ 跨年（实测没出现，出现时用共用判定，不自己写一套）
	if (m[6] == null && endsNextYear(mo1, d1, mo2, d2)) y2 = y1 + 1;
	const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
	const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
	if (endTs == null || startTs == null || !(endTs > startTs)) return null;   // 源站错行 ⇒ 丢掉，不硬造
	return { startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) };
}
// 区间行的名字：往上最多 3 行找 `■…`，剥掉尾缀；找不到 / 剥完是空（`■開催期間`）⇒ 空串
function ns_pcr_jp_labelOf(lines, at) {
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const m = ns_pcr_JP_LABEL_RE.exec(lines[j]);
		if (!m) continue;
		return m[1].replace(ns_pcr_JP_LABEL_TAIL_RE, "").replace(/\s+/g, " ").trim();
	}
	return "";
}
// 卡池名：正文锚点拿不到时，从标题里取 `ピックアップガチャ` / `プリンセスフェスガチャ`
function ns_pcr_jp_poolNameOf(title) {
	const m = /((?:プリンセス)?フェスガチャ|ピックアップガチャ)/.exec(String(title == null ? "" : title));
	return m ? m[1] : "";
}
// 卡池角色：标题里 `…キャラ「X」` 的 X（`期間限定キャラ「ラッキーライラック」`）
function ns_pcr_jp_rolesOf(title) {
	const m = /キャラ(?:クター)?「([^「」]{1,40})」/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}
// 活动名：标题里 `「…」` 包住的就留里面；没有引号才剥尾巴（`バトルスタジアム開催中！` ⇒ `バトルスタジアム`）
function ns_pcr_jp_eventNameOf(title) {
	const t = String(title == null ? "" : title).trim();
	const q = ns_pcr_JP_QUOTED_RE.exec(t);
	if (q) return q[1].trim();
	let s = t;
	for (let i = 0; i < 3; i++) {
		const n = s.replace(ns_pcr_JP_EVENT_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || t;
}
// 详情 → 卡池条目事实（每个整行区间一口池；没有窗口 ⇒ 空数组）
function ns_pcr_jp_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const title = String(d.title || "");
	const fallback = ns_pcr_jp_poolNameOf(title);
	const roles = ns_pcr_jp_rolesOf(title);
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		const banner = w.label || fallback;
		if (!banner) continue;                       // 池名都拿不到 ⇒ 这一条不产出（不留空池名）
		items.push({
			_i: items.length,
			banner,
			roles,
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display,
			isMain: true
		});
	}
	return items;
}
// 详情 → 活动条目事实（活动名取标题派生名；`■開催期間` 这种通用锚点不是活动名）
function ns_pcr_jp_eventItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const name = ns_pcr_jp_eventNameOf(String(d.title || ""));
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		items.push({
			_i: items.length,
			event: name || "活动",
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
let ns_pcr_jp_listCache = null;              // { url, round, at, promise }
let ns_pcr_jp_detailCache = new Map();       // id → { at, value:{ title, windows }, sealed }
function ns_pcr_jp_resetCache() { ns_pcr_jp_listCache = null; ns_pcr_jp_detailCache = new Map(); }
// 详情地址（按 id）
function ns_pcr_jp_detailUrlOf(id) { return ns_pcr_JP_DETAIL_BASE + String(id == null ? "" : id); }
// 缓存是否可用：TTL 内，或**已结束**（窗口全部 endTs<=抓取时刻）⇒ 永久有效（"已结束不再取"）
function ns_pcr_jp_cacheValidOf(entry, now) {
	if (!entry || !entry.value) return false;
	if (entry.sealed) return true;
	return now - entry.at < ns_pcr_JP_CACHE_TTL_MS;
}
// 这篇是不是"已结束"（有窗口且全部在 at 之前收）⇒ 封存，后续轮次不再取
function ns_pcr_jp_cacheSealedOf(detail, at) {
	const ws = detail && Array.isArray(detail.windows) ? detail.windows : [];
	return ws.length > 0 && ws.every((w) => w.endTs <= at);
}
// 列表：一轮刷新里两侧共用同一次请求（轮外 / 设置页「测试来源」一律现取）
async function ns_pcr_jp_rowsOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_pcr_JP_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_pcr_jp_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_pcr_JP_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchJson(key, { mode: "direct", signal, headers: { "X-MICROCMS-API-KEY": ns_pcr_JP_API_KEY } })
			.then((json) => ns_pcr_jp_listOf(json));
		ns_pcr_jp_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_pcr_jp_listCache && ns_pcr_jp_listCache.promise === promise) ns_pcr_jp_listCache = null; });
	}
	return promise;
}
// 单篇详情：按 id 缓存（TTL 24h；已结束的永久有效）。结构变了就抛（不吞成"没有窗口"）
async function ns_pcr_jp_detailOfId(id, signal, tz, now) {
	const hit = ns_pcr_jp_detailCache.get(id);
	if (hit && !hit.sealed) hit.sealed = ns_pcr_jp_cacheSealedOf(hit.value, now);   // 到期前已结束 ⇒ 当场封存
	if (ns_pcr_jp_cacheValidOf(hit, now)) return hit.value;
	const json = await fetchJson(ns_pcr_jp_detailUrlOf(id), {
		mode: "direct",
		signal,
		headers: { "X-MICROCMS-API-KEY": ns_pcr_JP_API_KEY }
	});
	const value = ns_pcr_jp_detailOf(json, tz);
	const entry = { at: now, value, sealed: ns_pcr_jp_cacheSealedOf(value, now) };
	ns_pcr_jp_detailCache.set(id, entry);
	return value;
}
// 一侧的条目：按 kind 筛 → 最多 4 篇详情 → 条目事实；**命中当期窗口就停**（省后面的详情请求）。
// 详情全部失败且一条都没解析出来 ⇒ 抛（抓取失败 ≠ 未公布）。
async function ns_pcr_jp_itemsOf(url, signal, tz, now, side) {
	const rows = await ns_pcr_jp_rowsOf(url, signal);
	const want = side === "pools" ? "gacha" : "event";
	const cand = rows.filter((r) => r.kind === want).slice(0, ns_pcr_JP_MAX_DETAILS);
	const out = [];
	let firstErr = null, parsed = 0;
	for (const row of cand) {
		let detail;
		try {
			detail = await ns_pcr_jp_detailOfId(row.id, signal, tz, now);
			parsed++;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;                              // 单篇失败不整体崩；全失败才抛（见下）
		}
		for (const it of side === "pools" ? ns_pcr_jp_poolItemsOf(detail) : ns_pcr_jp_eventItemsOf(detail)) {
			out.push(Object.assign({}, it, { _i: out.length }));
		}
		if (out.some((it) => coversNow(it, now))) break;   // 当期窗口到手 ⇒ 后面的更早公告不用再抓
	}
	if (parsed === 0 && firstErr) throw firstErr;      // 详情全失败 ⇒ 抛
	return out;
}
// 卡池侧：同批（同结束时刻）合并角色 —— 换池通常整批换（轮换池一期同收）
async function ns_pcr_jp_gacha(url, signal, tz = ns_pcr_JP_TZ, now = nowMs()) {
	const items = await ns_pcr_jp_itemsOf(url, signal, tz, now, "pools");
	if (items.length === 0) return null;              // 没有带窗口的本命池 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "pcr-jp" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷
async function ns_pcr_jp_events(url, signal, tz = ns_pcr_JP_TZ, now = nowMs()) {
	const items = await ns_pcr_jp_itemsOf(url, signal, tz, now, "events");
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "pcr-jp");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条列表**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告（日文）」。
registerSource({
	id: "pcr-jp",
	defaultHidden: false,
	tz: ns_pcr_JP_TZ,
	name: "公主连结Re:Dive·日服",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/6c/ce/1a/6cce1a8b-f385-0410-f799-072435e5707c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_pcr_JP_LIST_URL,
	source: ns_pcr_JP_SOURCE_LABEL,
	eventUrl: ns_pcr_JP_LIST_URL,
	eventSource: ns_pcr_JP_SOURCE_LABEL
});
GACHA_FETCHERS["pcr-jp"] = (url, signal, tz, now) => ns_pcr_jp_gacha(url, signal, tz, now);
EVENT_FETCHERS["pcr-jp"] = Object.assign(EVENT_FETCHERS["pcr-jp"] || {}, {
	default: (url, signal, tz, now) => ns_pcr_jp_events(url, signal, tz, now)
});
//#endregion
