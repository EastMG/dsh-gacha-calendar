// src/client/30-game-browndust2.js —— 棕色尘埃2（棕色尘埃2 / Brown Dust 2）：第三方卡池史站点 bannerhistory.app
//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 唯一来源 `id:"browndust2"`，**只接卡池侧**（该站只有卡池史，没有活动档期）⇒ 活动侧不注册
// （设置页显示「未配置」，与 tof / gbf / kancolle 同形）。标签逐字「bannerhistory.app（英文）」。
// 时区 = `Asia/Seoul`（页面自己声明 `sourceZone:"Asia/Seoul"`；GMT+9，无夏令时）。
//
// ── ① 站点形态（2026-11-15 16:2x +08 实测；夹具 test/fixtures/bd2-pickup-history）───────
//   官方 API 被 AWS WAF 按本机 IP 拦（403 CloudFront）⇒ 用户拍板改走第三方 bannerhistory.app。
//   `GET https://bannerhistory.app/en/bd2-pickup-history`
//     200 / `text/html; charset=utf-8` / 实测 **496,268 B** / 响应**没有** `Access-Control-Allow-Origin`
//     （带 `Origin: dsh-app://dsh` 再测也是空）⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**
//     （`bannerhistory.app` 已登记 `src/index.js` 的 `PROXY_ALLOW_HOSTS`）。
//   Next.js App Router 页面：数据不在最外层 HTML 的表格里，而在 **RSC flight 负载**
//   （`<script>self.__next_f.push([1,"<行文本>"])</script>`）里的一整棵组件树。实测整页只有
//   **一个** push 含数据：`…"data":{"game":"bd2","sourceZone":"Asia/Seoul","rows":[…]…`。
//   行结构（**实测**，夹具即此形状）：
//     rows[]  ← 一批同起点的卡池（56/163 条 row 含多组）
//       ├ id            = `BD2_<YYYYMMDD>_<CharacterKey>+…`（复合 id，**不是**卡池名）
//       ├ year / startAt / endAt   （`startAt`/`endAt` = **绝对毫秒**，见 ②）
//       └ groups[] ← 每一口池
//           ├ id        = `BD2_20261105_Valze_Night_of_Betrayal`
//           ├ start/end = `YYYY-MM-DD`（**源站墙钟日期**，KST）
//           ├ startAt/endAt = 绝对毫秒
//           └ members[] ← UP 角色
//               ├ name = { en, ko, ja, zh, tw }（**服装/卡池名**，如 `Night of Betrayal`）
//               ├ sub  = { en, ko, ja, zh, tw }（**角色名**，如 `Valze`）
//               └ element / color / icon …
//   ⚠️ 站点的展示名逐字是 `服装名 (角色名)`（实测 DOM：`Last Hope (Loen)`；多角色用 ` · ` 连接）
//      ⇒ 本文件把「池名 = 服装名」「角色 = 角色名」分开，拼成仓库统一的 `池名：角色`（悬停/外显口径不变）。
//   ⚠️ flight 负载里的 `badges[].labels` 是 RSC 的 `$<row>:<path>` **去重引用**（不是真数据）；
//      本文件不读 badges（只用 `kinds`，实测是内联数组），所以引用解析不到不影响任何字段。
//
// ── ② 时间 / 时区（**起止都齐全到分**，这是选它的原因）──────────────────────────────
//   实测 245 个 group 的 `startAt` **全部**是 KST **09:00**、`endAt` 全部是 KST **08:59**
//   （例：`startAt=1795046400000` = 2026-11-19 09:00 KST = 2026-11-19 00:00 UTC；
//     `endAt` = 结束日 08:59 KST = 前一日 23:59 UTC —— 即「周四 09:00 换池、上一批到 08:59」的
//     游戏内节奏；**不是** parse 出来的墙钟，是站点自己算好的绝对毫秒）。
//   ⇒ 本文件直接用 `startAt` / `endAt` 当 `startTs` / `endTs`，**不再做墙钟换算**（绝对时刻无歧义）。
//   tz 仍取 `Asia/Seoul`：它只参与 `fmtWindow` 渲染（外显/悬停按源站墙钟）。页面若改了
//   `sourceZone`，本文件**抛错**（`browndust2-payload-changed:zone`）—— 渲染口径会跟着变，不能静默。
//   `raw` = 源站原文的日期对（`2026-11-05 ~ 2026-11-19`，source 只给到日）；`display` = 补全到分的可读文本。
//
// ── ③ 请求预算 / 缓存 ──────────────────────────────────────────────────────────────
//   一页 0.5MB 只取一次：**解析结果（窗口条目）按 URL 缓存 24h**（`ns_bd2_CACHE_TTL_MS`），
//   首轮（或缓存过期后第一次刷新）**1 次**请求、稳态（24h 内）**0 次**（与 reso 同一套口径）。
//   只有卡池一侧 ⇒ 没有"两侧同源共享"的问题；仍用 `fetchRoundSeqOf` 记一轮的并发去重兜底。
//
// ── ④ 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · HTML 是空串 ⇒ 抛 `browndust2-page-changed:empty`；
//   · 找不到任何 `self.__next_f.push([1,"…"])` / 找不到 `"data":{"game":"bd2"` ⇒ 抛
//     `browndust2-payload-changed:no-data`；
//   · 负载 JSON 解析失败 / 结构不对（`rows` 不是数组或为空 / `game` 不是 bd2）⇒ 抛
//     `browndust2-payload-changed:bad-data`；
//   · `sourceZone` 不是 `Asia/Seoul` ⇒ 抛 `browndust2-payload-changed:zone`；
//   · 结构正常但一条合法窗口都解不出（起止倒挂/非数字）⇒ 抛 `browndust2-payload-changed:no-window`（结构变）；
//   · 解出窗口但没有覆盖 now 的 ⇒ **null**（当期没有，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 16:2x +08 实测，夹具 = 同日真抓裁剪）─────────────────────
//   在期 2 口池：
//     `Night of Betrayal`（Valze）  2026-11-05 09:00 ~ 2026-11-19 08:59 KST
//     `Maid Name R`（Liatris）      2026-11-05 09:00 ~ 2026-12-03 08:59 KST
//   外显取结束最早的那口（Night of Betrayal），悬停 2 行（另一口 12-03 结束）。
//   下一批 `2026-11-19 09:00` 开池（Last Hope / Bittersweet Bunny / Shadow Bunny）。

//#region ① 常量
const ns_bd2_TZ = "Asia/Seoul";
const ns_bd2_URL = "https://bannerhistory.app/en/bd2-pickup-history";
const ns_bd2_REFERER = ns_bd2_URL;
const ns_bd2_SOURCE_LABEL = "bannerhistory.app（英文）";
const ns_bd2_ICON = "https://bannerhistory.app/icons/apps/bd2.png";
// 页面自己声明的源站时区（见文件头 ②）：改了就抛错
const ns_bd2_SOURCE_ZONE = "Asia/Seoul";
// 解析结果按 URL 缓存 24h（整页 0.5MB，首轮 1 次 / 稳态 0 次，见文件头 ③）
const ns_bd2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 一轮内并发去重（同 reso / hl / cytq 的 30s）
const ns_bd2_ROUND_TTL_MS = 30000;
// RSC flight 推送（`self.__next_f.push([1,"<行文本>"])`）；`[0]` 头不带数据，不收
const ns_bd2_PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
// 数据对象在行文本里的字面锚（`"data":` 之后的 `{` 就是我们要的对象）
const ns_bd2_DATA_MARK = '"data":{"game":"bd2"';
const ns_bd2_DATA_OPEN = '"data":';
//#endregion

//#region ② 纯解析：HTML → RSC 行文本 → data 对象
// 收集全部 `[1,"…"]` 推送：每段先 JSON.parse（解掉 JS 字符串字面量的转义），再拼成 RSC 流。
// 结构变了要抛（见文件头 ④）：一段都找不到 / 某段不是合法字符串。
function ns_bd2_streamOf(html) {
	const src = String(html == null ? "" : html);
	if (src.trim() === "") throw new Error("browndust2-page-changed:empty");
	const re = new RegExp(ns_bd2_PUSH_RE.source, "g");
	const parts = [];
	let m;
	while ((m = re.exec(src))) {
		try {
			parts.push(JSON.parse(m[1]));
		} catch {
			throw new Error("browndust2-payload-changed:no-data");
		}
	}
	if (parts.length === 0) throw new Error("browndust2-payload-changed:no-data");
	return parts.join("");
}
// 从 `{` 起做平衡扫描（跳过字符串内的括号）；不闭合 ⇒ null。
function ns_bd2_balancedOf(s, from) {
	let depth = 0, inStr = false, esc = false;
	for (let i = from; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === "\\") esc = true;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') { inStr = true; continue; }
		if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") {
			depth--;
			if (depth === 0) return s.slice(from, i + 1);
		}
	}
	return null;
}
// HTML → `data` 对象（`{ game, sourceZone, rows, years, kinds }`）。
// **结构变了要抛**：没有推送流 / 没有 `"data":{"game":"bd2"` / JSON 坏 / 不是 bd2 / rows 为空。
function ns_bd2_dataOf(html) {
	const stream = ns_bd2_streamOf(html);
	const at = stream.indexOf(ns_bd2_DATA_MARK);
	if (at < 0) throw new Error("browndust2-payload-changed:no-data");
	const open = stream.indexOf(ns_bd2_DATA_OPEN, at) + ns_bd2_DATA_OPEN.length;
	const text = ns_bd2_balancedOf(stream, open);
	if (text == null) throw new Error("browndust2-payload-changed:bad-data");
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("browndust2-payload-changed:bad-data");
	}
	if (!data || typeof data !== "object" || data.game !== "bd2" || !Array.isArray(data.rows)) {
		throw new Error("browndust2-payload-changed:bad-data");
	}
	// 时区口径跟着页面走（见文件头 ②）：变了就不能静默按 Asia/Seoul 渲染
	if (String(data.sourceZone == null ? "" : data.sourceZone) !== ns_bd2_SOURCE_ZONE) {
		throw new Error("browndust2-payload-changed:zone");
	}
	return data;
}
// 多语言字段 → en 优先（回退 zh → tw → ja → ko）；都空 ⇒ ""。
function ns_bd2_langOf(obj) {
	const o = obj && typeof obj === "object" ? obj : {};
	for (const k of ["en", "zh", "tw", "ja", "ko"]) {
		const v = String(o[k] == null ? "" : o[k]).trim();
		if (v) return v;
	}
	return "";
}
// 一口池 → `{ name, role }`：`name` = 服装/卡池名（members[].name）、`role` = 角色名（members[].sub）。
// 多角色时用站点自己的分隔：池名 ` · `、角色 `、`。都取不到 ⇒ 用 group id 兜底（不产出空名）。
function ns_bd2_labelOf(group) {
	const g = group && typeof group === "object" ? group : {};
	const members = Array.isArray(g.members) ? g.members : [];
	const names = [], roles = [];
	for (const mb of members) {
		const name = ns_bd2_langOf(mb && mb.name);
		const role = ns_bd2_langOf(mb && mb.sub);
		if (name) names.push(name);
		if (role) roles.push(role);
	}
	const rawId = String(g.id == null ? "" : g.id);
	const name = names.join(" · ") || rawId.replace(/^BD2_\d{8}_/, "").replace(/_/g, " ");
	return { name, role: roles.join("、") };
}
// data → 窗口条目（只取 groups 里起止齐全的；`startAt`/`endAt` 已经是绝对毫秒 ⇒ 不再换算）。
// 一条合法窗口都没有 ⇒ 抛 `no-window`（结构变了）；个别脏行（倒挂/非数字）丢弃，不硬造。
function ns_bd2_windowsOf(data, tz = ns_bd2_TZ) {
	const out = [];
	const seen = new Set();
	for (const row of Array.isArray(data && data.rows) ? data.rows : []) {
		if (!row || typeof row !== "object") continue;
		for (const g of Array.isArray(row.groups) ? row.groups : []) {
			if (!g || typeof g !== "object") continue;
			const startTs = Number(g.startAt), endTs = Number(g.endAt);
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || !(endTs > startTs)) continue;
			const { name, role } = ns_bd2_labelOf(g);
			if (!name) continue;
			const key = `${g.id || name}|${startTs}|${endTs}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const start = String(g.start == null ? "" : g.start).trim();
			const end = String(g.end == null ? "" : g.end).trim();
			out.push({
				id: String(g.id == null ? "" : g.id),
				banner: name,
				roles: role,
				startTs,
				endTs,
				// 源站原文：它只给到「日期对」（时/分在毫秒字段里）
				raw: start && end ? `${start} ~ ${end}` : "",
				display: fmtWindow(startTs, endTs, tz)
			});
		}
	}
	if (out.length === 0) throw new Error("browndust2-payload-changed:no-window");
	return out;
}
// 窗口条目 → 共用卡池载荷生成器的入参（与 bwiki 系条目同形）
function ns_bd2_itemsOf(windows) {
	return (Array.isArray(windows) ? windows : []).map((w, i) => ({
		_i: i,
		banner: w.banner,
		roles: w.roles || "",
		startTs: w.startTs,
		endTs: w.endTs,
		raw: w.raw,
		display: w.display,
		isMain: true
	}));
}
//#endregion

//#region ③ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_bd2_dataCache = null;                  // { url, at, windows }（24h 快照）
let ns_bd2_roundCache = { round: -1, promise: null };
function ns_bd2_resetCache() { ns_bd2_dataCache = null; ns_bd2_roundCache = { round: -1, promise: null }; }
// 一页 → 窗口条目（24h 缓存；本轮并发只发一次请求，见文件头 ③）
async function ns_bd2_windowsDataOf(url, signal, tz, now) {
	const key = String(url == null ? "" : url).trim() || ns_bd2_URL;
	const at = ns_bwiki_nowOf(now);
	const hit = ns_bd2_dataCache;
	if (hit && hit.url === key && at - hit.at < ns_bd2_CACHE_TTL_MS) return hit;
	const round = fetchRoundSeqOf();
	const rc = ns_bd2_roundCache;
	if (fetchRoundActive() && rc.round === round && rc.promise && at - rc.at < ns_bd2_ROUND_TTL_MS) return rc.promise;
	const promise = (async () => {
		const html = await fetchText(key, { mode: "proxy", referer: ns_bd2_REFERER, signal });
		const windows = ns_bd2_windowsOf(ns_bd2_dataOf(html), tz);
		const value = { url: key, at, windows };
		ns_bd2_dataCache = value;
		return value;
	})();
	ns_bd2_roundCache = { round, at, promise };
	promise.catch(() => {
		if (ns_bd2_roundCache.promise === promise) ns_bd2_roundCache = { round: -1, promise: null };
	});
	return promise;
}
// 卡池侧：窗口条目 → 共用卡池载荷（没有覆盖 now 的 ⇒ null，不硬凑过期档期）
async function ns_bd2_gacha(url, signal, tz = ns_bd2_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const data = await ns_bd2_windowsDataOf(url, signal, tz, at);
	const items = ns_bd2_itemsOf(data.windows);
	if (items.length === 0) return null;
	return ns_bwiki_wikitext_gachaPayload(items, tz, at, {});
}
//#endregion

//#region ④ 条目登记（只接卡池侧）
// 该站只有卡池史（没有活动档期）⇒ 不注册活动侧：设置页显示「未配置」，不请求、不抛错。
registerSource({
	id: "browndust2",
	defaultHidden: false,
	tz: ns_bd2_TZ,
	name: "棕色尘埃2·国际服",
	icon: ns_bd2_ICON,
	url: ns_bd2_URL,
	source: ns_bd2_SOURCE_LABEL
});
GACHA_FETCHERS["browndust2"] = (url, signal, tz, now) => ns_bd2_gacha(url, signal, tz, now);
//#endregion
