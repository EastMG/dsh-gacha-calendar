// src/client/30-game-bwiki-dhmmr.js —— 深空之眼 国服（dhmmr）：bwiki SMW「卡池列表」子对象（**只有卡池侧**）
//
// ── 源站事实（2026-11-15 实测）────────────────────────────────────────────────
//   GET https://wiki.biligame.com/dhmmr/api.php?action=ask&format=json&query=<urlencoded>
//   ⚠️ 必须带 `Referer: https://wiki.biligame.com/`，否则回 `567`（实测）；不存在的 wiki 名会 301。
//   query = [[-HasSubobject::卡池列表]][[统计属性::1]]
//           |?卡池开始时间|?卡池结束时间|?卡池名称|?卡池类型
//   ⇒ 每个子对象一行（键 = `卡池列表#探测052-1期`）。该 wiki 这三个属性是 `_txt` 类型，printouts 是
//      **字符串数组**（`["2026-07-23"]`），不是 SMW 的 `{ timestamp, raw }` —— 两种形态这里都吃。
//   实测样例：`探测052-1期` = 丝与刃之歌 / 2026-07-23 ~ 2026-09-17 / 限定、协议扩充。
//
// ── 为什么查询里多了 `|sort=卡池开始时间|order=desc`（任务书没写，**实测必需**）───────
//   `action=ask` 一次**只回 50 条**，默认按页面顺序（最老在前）：不带排序时第一页是
//   2022-08 ~ 2024-07，当期永远不在里面（`&limit=500` 实测被忽略，`query-continue-offset` 恒为 50）。
//   加上排序后**一次请求**拿到最新 50 条（2026-11-15 实测首条 = 052 期）。仍只发 1 个请求。
//   顺带排掉 `沙盒/…` 页上的同名子对象（`fulltext` 的页名部分必须恰好是 `卡池列表`）。
//
// ── 空结束时间（053 期：2026-09-17 起、`卡池结束时间` 为 `[]`）────────────────────
//   如实保留：`endTs = null`，`raw` / `display` = 源站原文（只有日期），**不猜**结束日。
//   这类行**不进外显**：当期判定只有一处（`coversNow`，两端都必须明确，见 24-parser-window.js）
//   ⇒ 载荷是 null（未公布）。这与「仓库没有『终点未知的卡池』这种载荷」是同一条规矩
//   （理由与反证见 30-game-pengpeng.js 文件头「为什么三选一里选 C」）。
//
// ── 活动侧：不接 ───────────────────────────────────────────────────────────────
//   该 wiki 的活动页是空壳（实测）⇒ 条目不写 `eventUrl`（设置页显示「未配置」），也不登记活动抓取器。
//
// ── 失败语义 ───────────────────────────────────────────────────────────────────
//   结构变了（没有 `query.results` / 一条都没回 / 一条都取不到开始时间）⇒ **抛错**（不是 nomatch）；
//   结构正常但没有任何一条覆盖 now ⇒ `null`（未公布）。
//
// ── 口径 ───────────────────────────────────────────────────────────────────────
//   · tz = Asia/Shanghai（国服；源站日期无时区标注）
//   · 只有日期没有时分：起 00:00 / 止 23:59（仓库通用约定，见 30-game-bwiki-common.js 的
//     `ns_bwiki_windowsFromCell`；换池日两期在 23:59 前有一天的重叠，属于源站只给日期的固有精度）
//   · 池别多值（`限定、协议扩充`）用 `、` 连成一个 `category` 事实，不拆数组（不新造字段）
const ns_dhmmr_TZ = "Asia/Shanghai";
const ns_dhmmr_PAGE = "卡池列表";
// 查询里出现的四个属性名 = 解析时读的四个键：**只写一处**，改名时不会只改一半。
const ns_dhmmr_KEY_START = "卡池开始时间";
const ns_dhmmr_KEY_END = "卡池结束时间";
const ns_dhmmr_KEY_NAME = "卡池名称";
const ns_dhmmr_KEY_TYPE = "卡池类型";
const ns_dhmmr_QUERY = `[[-HasSubobject::${ns_dhmmr_PAGE}]][[统计属性::1]]`
	+ `|?${ns_dhmmr_KEY_START}|?${ns_dhmmr_KEY_END}|?${ns_dhmmr_KEY_NAME}|?${ns_dhmmr_KEY_TYPE}`
	+ `|sort=${ns_dhmmr_KEY_START}|order=desc`;
const ns_dhmmr_URL = "https://wiki.biligame.com/dhmmr/api.php?action=ask&format=json&query="
	+ encodeURIComponent(ns_dhmmr_QUERY);
const ns_dhmmr_REFERER = "https://wiki.biligame.com/";

// ask 的 printout 值 → 首个非空字符串（兼容 `["2026-07-23"]` / `[{timestamp}]` / `[{raw}]`）
function ns_dhmmr_textOf(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_dhmmr_textOf(v[0]);
	if (typeof v === "object") {
		if (typeof v.raw === "string" && v.raw.trim() !== "") return v.raw.trim();
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// `2026-07-23` / `2026/7/23` / `20260723` / `2026-07-23 12:00` → { y, mo, d, h, mi }（h/mi = null 表示只有日期）
function ns_dhmmr_pointOf(text) {
	const s = String(text == null ? "" : text).trim();
	const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
	if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? null : +m[5] };
	const m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
	if (m2) return { y: +m2[1], mo: +m2[2], d: +m2[3], h: null, mi: null };
	return null;
}
// 开始 / 结束各一个绝对时刻。`start` 只有日期 ⇒ 00:00；`end` 只有日期 ⇒ 23:59（仓库约定）。
function ns_dhmmr_tsOf(point, isEnd, tz) {
	if (!point) return null;
	if (point.h != null) return sourceInstant(point.y, point.mo, point.d, point.h, point.mi, tz);
	return isEnd
		? sourceInstant(point.y, point.mo, point.d, 23, 59, tz)
		: sourceInstant(point.y, point.mo, point.d, 0, 0, tz);
}
// ask JSON → 条目事实（`{ banner, roles, category, startTs, endTs, raw, display, isMain, _i }`）。
// 纯函数：给 JSON + tz → 数组，不碰网络 / 时钟。
function ns_dhmmr_parseAsk(json, tz = ns_dhmmr_TZ) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("dhmmr-ask:bad-json");
	const rows = [];
	let i = 0;
	for (const [page, v] of Object.entries(results)) {
		const pageName = String(page).split("#")[0];
		if (pageName !== ns_dhmmr_PAGE) continue;              // 跳过 `沙盒/…` 上的同名子对象
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const banner = ns_dhmmr_textOf(p[ns_dhmmr_KEY_NAME]).replace(/\s+/g, " ").trim();
		const startText = ns_dhmmr_textOf(p[ns_dhmmr_KEY_START]);
		if (!banner || !startText) continue;
		const startPoint = ns_dhmmr_pointOf(startText);
		if (!startPoint) continue;
		const endText = ns_dhmmr_textOf(p[ns_dhmmr_KEY_END]);
		const endPoint = endText ? ns_dhmmr_pointOf(endText) : null;
		const startTs = ns_dhmmr_tsOf(startPoint, false, tz);
		const endTs = endPoint ? ns_dhmmr_tsOf(endPoint, true, tz) : null;
		if (endTs != null && !(endTs > startTs)) continue;     // 源站错行 → 丢掉（不硬造）
		const types = (Array.isArray(p[ns_dhmmr_KEY_TYPE]) ? p[ns_dhmmr_KEY_TYPE] : [p[ns_dhmmr_KEY_TYPE]])
			.map((x) => ns_dhmmr_textOf(x)).filter(Boolean);
		const raw = endText ? `${startText} ~ ${endText}` : startText;
		rows.push({
			_i: i++,
			banner,
			roles: "",
			category: types.join("、"),
			startTs,
			endTs,
			raw,
			// `display` 只在两端明确时由 `fmtWindow` 生成；单边行**原文照出**（不补"起"/不猜终点）
			display: endTs == null ? startText : fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("dhmmr-ask:no-window");   // 属性名/页面结构改了 = 结构性损坏
	// 排序（**稳定化**，不是新口径）：同一期有多口池（052 期 3 口）时它们的 `卡池开始时间` 完全相同，
	// 而 SMW 对"排序键相同的行"**不保证顺序**（2026-11-15 两次实测：一次 丝/幻梦/奇迹，一次 幻梦/奇迹/丝）
	// ⇒ 外显会在同期几口池之间乱跳。这里按「开始 desc → 结束 asc（空结束排最后）→ 池名」定死，
	// 与 `poolHoverOrderOf`（结束 asc）不冲突：`_i` 只当最后的稳定兜底。
	rows.sort((a, b) => (b.startTs - a.startTs)
		|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
		|| (a.banner < b.banner ? -1 : a.banner > b.banner ? 1 : 0));
	rows.forEach((r, i) => { r._i = i; });
	return rows;
}
// 条目事实 → 载荷（外显/悬停/数组全部走共用工具：`ns_bwiki_gachaPayload`，
// 即「当期 = coversNow 两端都明确」+ `hoverTextFromItems` + `dataArrayProducedGachaOf`）。
function ns_dhmmr_payloadOf(items, tz, now) {
	return ns_bwiki_gachaPayload(Array.isArray(items) ? items : [], tz, now);
}
// 抓取器：契约 async (url, signal, tz, now = nowMs()) → 数据对象 | null（1 个请求）
async function ns_dhmmr_gacha(url, signal, tz = ns_dhmmr_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) || ns_dhmmr_URL;
	const json = await fetchJson(target, { referer: ns_dhmmr_REFERER, signal, mode: "proxy" });
	return ns_dhmmr_payloadOf(ns_dhmmr_parseAsk(json, tz), tz, ns_bwiki_nowOf(now));
}

// ── 注册 ───────────────────────────────────────────────────────────────────────
// 卡池来源标签按任务书提议「Bwiki 卡池列表」（等用户复核）；活动侧**留空** = 显示「未配置」。
registerSource({
	id: "dhmmr",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "深空之眼",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/fa/23/6b/fa236b90-9fab-30b2-240a-9f3057506074/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_dhmmr_URL,
	source: "Bwiki 卡池列表",
	eventUrl: ""
});
GACHA_FETCHERS["dhmmr"] = (url, signal, tz, now) => ns_dhmmr_gacha(url, signal, tz, now);
