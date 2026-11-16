// src/client/30-game-smilegate.js —— Smilegate：卡厄斯梦境（czn）
//
// 职责（2026-11-16 按厂商重排）：czn 的条目 + 解析器 + 抓取器 + 登记都在本文件。
// 组成：
//   · 30-game-bwiki-czn-wikitext.js：bwiki `Module:Gacha/data` 的 Lua 表解析（现为卡池手动备选「Bwiki（停更）」）；
//   · 30-game-bwiki-czn-html.js：bwiki「卡池记录」页解析（实测空页，保留兜底）；
//   · 30-game-batch2.js 的 ③ 段：默认源 = TapTap topic 页 SSR（Nuxt devalue 解码，固定 2 页）；
//   · 30-game-bwiki-register.js 里 czn 的条目字段（name / icon / defaultHidden / tz）。
// 去重（2026-11-16）：czn 原先由两个文件先后 `registerSource` 合并，现合并为**一处**注册，
//   条目字段 + TapTap 默认源 + bwiki 停更备选写在同一个 registerSource 里。
// 复用关系：bwiki 公共层（30-game-bwiki-wikitext-common.js 的 wikitext helper / 载荷生成器）与
//   bwiki-html-fetchers.js（`ns_bwiki_gachaCzn`）；符号名 `ns_batch2_czn_*` / `ns_bwiki_*` 原样保留。
// 请求预算：卡池 2 次（topic p1 + p2）；活动侧复用卡池载荷 ⇒ 整轮仍 2 次。没有模块级共享缓存。

// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-czn-wikitext.js：bwiki `Module:Gacha/data` 的 Lua 表（卡池备选「Bwiki（停更）」）
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
const ns_bwiki_wikitext_CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
const ns_bwiki_wikitext_CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_RECORD_PAGE = "卡池记录";
const ns_bwiki_wikitext_CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
function ns_bwiki_wikitext_cznStamp(text) {
	const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ \t]+(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*[:：]\s*(\d{2}))?\s*$/.exec(String(text == null ? "" : text));
	if (!m) return null;
	const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// Lua 表 → 6 期 [{ id, type, char, startTs, endTs, raw }]
// 实测形态（fixtures/p8-czn-module，999B，6 期）：
//   return { ["0001"] = { type = "主战员营救概率提升", start_date = "2026-5-28 10:00:00",
//                          end_date = "2026-6-17 02:00:00", link_char = "绯", }, … }
function ns_bwiki_wikitext_parseCznLua(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = ns_bwiki_wikitext_cznStamp(f.start_date), b = ns_bwiki_wikitext_cznStamp(f.end_date);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;                       // 源站错行 → 丢弃
		items.push({
			_i: items.length,
			id: m[1],
			type: f.type || "",
			char: f.link_char || "",
			startTs, endTs,
			raw: `${f.start_date} ~ ${f.end_date}`
		});
	}
	if (items.length === 0) throw new Error("czn-lua:no-entry");   // 结构变了（Lua 表被改/页面空）→ 抓取失败
	return items;
}
// 备选页 `卡池记录`（**只有 1 条**模板调用，2026/03，已过期；本文件只导出纯函数，不挂抓取器）：
//   {{Gacha|id=TEST|title=小春概率UP|type=救援概率UP|Start_Date=2026/03/22 8:59:00|End_Date=2026/03/27 8:59:00|UP=小春|banner=…}}
function ns_bwiki_wikitext_parseCznRecord(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const callRe = /\{\{\s*Gacha\s*\|([\s\S]*?)\}\}/g;
	let m;
	while ((m = callRe.exec(src))) {
		const f = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			f[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		const a = ns_bwiki_wikitext_cznStamp(f["Start_Date"]), b = ns_bwiki_wikitext_cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			category: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
// ⚠️ 原先此处给 `ns_bwiki_wikitext_gachaPayload` 传了 header「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」
//    —— 那是悬停元信息（来源站名 / API 名 / 抓取条数 / 时区推定），按方案 A **整段删除**。
//    Lua 表页名/期数仍是**数据**（ns_bwiki_wikitext_CZN_MODULE_PAGE / items.length），注释与注册表里都有，不进悬停。
async function ns_bwiki_wikitext_gachaCzn(url, signal, tz = ns_bwiki_wikitext_CZN_TZ, now = nowMs()) {
	const items = ns_bwiki_wikitext_parseCznLua(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_CZN_MODULE_URL, signal, ns_bwiki_wikitext_CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return ns_bwiki_wikitext_gachaPayload(items, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-czn-html.js：bwiki「卡池记录」页解析（实测空页，保留兜底）
// ─────────────────────────────────────────────────────────────────────────────

//#region ⑥ 卡厄斯梦境 国服（czn / page=卡池记录）—— ⚠️ 实测为空页
// `prop=text` 全文只有 `模板:Gacha` 一个链接，**无表格、无日期**（wiki 侧该模板已不存在/不产出内容）。
// 同 wiki 站内搜索 "卡池" 只命中 4 页（卡池记录 / 首页 / 首页-PC端 / 首页-移动端），没有更好的卡池页。
// ⇒ 返回 []，抓取器据此返回 null（如实"抓到了页面但当期没内容"）。若日后 wiki 补全为 CardSelect 表，
//    本解析器按 whmx 同款表头（开放时间/活动名称）兜底解析。
function ns_bwiki_parseCznGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间"]);
	if (cands.length === 0) return [];                         // 有表但不是卡池表 → 视为无内容
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			banner: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || "卡池",
			roles: ns_bwiki_linkTitles(c1.html).join("、"),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw, display: wins[0].display
		});
	});
	return items;
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-batch2.js 的 ③ 段：默认源 = TapTap topic 页 SSR（Nuxt devalue，固定 2 页）
// ─────────────────────────────────────────────────────────────────────────────

// ── ③ 卡厄斯梦境 `czn`（卡池 + 活动）—— TapTap 官方 tab 的 **SSR HTML 页面**（robots.txt 允许）──
//   ⚠️ 2026-11-13 换路径：`https://www.taptap.cn/robots.txt` 明确
//        Disallow: /webapi/   与   /webapiv2/
//      旧实现恰好走 `webapiv2/feed` + `webapiv2/moment detail`（既被 robots 禁，又实测吃阿里云 WAF）。
//      现在只抓 **robots 允许、实测 200 / 无 WAF** 的 topic 页（2 个请求）：
//        https://www.taptap.cn/app/759688/topic?type=official
//        https://www.taptap.cn/app/759688/topic?type=official&page=2    ← 抓取器自己拼
//   SSR 数据在 `<script type="application/json" id="__NUXT_DATA__">…</script>` 里，是 **Nuxt devalue**
//   编码（一个数组：元素可为字面量或**数字引用**，对象/数组的成员是下标）。解码见
//     `ns_batch2_cznDevalueOf`（最小实现 + 兼容策略写在那段注释里）。
//   每帖取 `data.<hash>.list[].moment`：`topic.title` / `topic.summary`（正文，SSR 侧**截断在 200 字**）/
//   `created_time`（unix 秒）。实测 2026-11-13 22:29 +08：每页 10 帖，共 20 帖；卡池 / 活动都在前 20 帖。
//   · 卡池：帖子标题或正文首行含 `营救概率提升`（或正文带 `概率提升时间：` 标签）⇒ 一条池；
//       池名 = 正文首行（它就是公告标题那一行，含 `营救概率提升`）；没有首行就退帖子标题；
//       角色 = 池名里的 `「」`（正文其它地方的名字不算）；起止 = `概率提升时间：` / `活动时间：`
//       标签那一行的区间。**只看标签行**，不拿正文里别的区间凑。
//   · 「维护结束后 / 维护开始前」用**同帖/同页**维护窗（`◈更新时间：` / `维护时间：` 等）映射：
//       维护结束后 → 该次维护的**结束**时刻；维护开始前 → 该次维护的**开始**时刻。
//     匹配用"墙钟月日 +（端点写了年份时）年"；同页没有那一天维护窗 ⇒ 该端点**如实留空**
//     （实测 `2026/12/02 维护开始前` 的 12-02 维护窗不在第 1/2 页 ⇒ endTs=null，不猜）。
//   · 活动：① 同页维护窗（服务器维护，标题 = 帖子标题）；② `活动时间：` 标签（实测三种写法
//     `➤活动时间：` / `〓活动时间〓` / `【活动时间】`）的区间。
//     `营救概率提升` 帖归卡池，**不再**算成活动（双计守卫：那类帖的 `➤活动时间：` 正是池的档期）。
//     `即日起～<绝对终点>` 的起点锚在**帖子 `created_time`**（源站自己的发布时刻；没有 created_time
//     就留空，不拿 now 猜）。
//   来源标签「TapTap 官方」（卡池/活动同一份）；tz=Asia/Shanghai；响应无 ACAO ⇒ 仍走宿主代理
//   （`www.taptap.cn` 已在白名单，tools/check-host-allow.mjs 守）。
//   抓取口径：固定 2 页（`NS_BATCH2_CZN_PAGES`），任一页失败跳过、**两页都失败才抛错**；
//   卡池载荷顺手带上活动字段 ⇒ 引擎的 `reuseSameRequest` 让活动侧同一轮 0 请求（两侧仍各有独立
//   抓取器与失败归因）。**没有**模块级共享缓存 / TTL —— 每次抓取就是这 2 个请求。

const NS_BATCH2_CZN_TZ = "Asia/Shanghai";
const NS_BATCH2_CZN_REFERER = "https://www.taptap.cn/";
const NS_BATCH2_CZN_SOURCE_LABEL = "TapTap";
// 只抓 robots.txt 允许的 topic 页（`/webapi/` 与 `/webapiv2/` 都被 Disallow，旧 JSON 路径已整体删除）。
// 第 2 页由抓取器自己拼 `&page=2`（实测 200，SSR payload 与第 1 页同构）。
const NS_BATCH2_CZN_TOPIC_URL = "https://www.taptap.cn/app/759688/topic?type=official";
const NS_BATCH2_CZN_PAGES = 2;

/** 第 N 页 topic 地址（N≤1 = 注册地址；N>1 追加 `&page=N`，若自定义地址已带 `page=` 则替换）。 */
function ns_batch2_cznTopicUrlOf(page, base) {
	const b = String(base || NS_BATCH2_CZN_TOPIC_URL);
	const n = Number(page);
	if (!(n > 1)) return b;
	if (/[?&]page=\d+/.test(b)) return b.replace(/([?&])page=\d+/, "$1page=" + n);
	return b + (b.indexOf("?") >= 0 ? "&" : "?") + "page=" + n;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ 卡厄斯梦境：TapTap topic 页 SSR（Nuxt devalue）→ 卡池 / 活动条目事实
// ═══════════════════════════════════════════════════════════════════════════════

// 实测两种绝对写法（`2026/11/11 08:00 ~ 2026/11/11 13:00` / `2026年11月11日 08:00 ~ 2026年11月11日 13:00`），
// 以及无年份的中文写法（借 now 的源站年份补）。
const NS_BATCH2_CZN_SLASH_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_YMD_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_MD_RE = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

/** 一段文本里的**第一段完整绝对区间** → `{ startTs, endTs, raw, display }`；没有 ⇒ null。 */
function ns_batch2_cznWindowOf(text, now, tz) {
	const s = String(text == null ? "" : text);
	let m = NS_BATCH2_CZN_SLASH_RE.exec(s);
	if (m) {
		const startTs = sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
		const endTs = sourceInstant(Number(m[6]), Number(m[7]), Number(m[8]), Number(m[9]), Number(m[10]), tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	m = NS_BATCH2_CZN_YMD_RE.exec(s);
	if (m) {
		const startTs = sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
		const endTs = sourceInstant(Number(m[6]), Number(m[7]), Number(m[8]), Number(m[9]), Number(m[10]), tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	m = NS_BATCH2_CZN_MD_RE.exec(s);
	if (m) {
		const hint = sourceWallParts(now, tz);
		const sm = Number(m[1]), sd = Number(m[2]), sh = Number(m[3]), smi = Number(m[4]);
		const em = Number(m[5]), ed = Number(m[6]), eh = Number(m[7]), emi = Number(m[8]);
		const sy = inferYear(null, sm, hint);
		let ey = inferYear(null, em, hint);
		if (sy == null || ey == null) return null;
		if (endsNextYear(sm, sd, em, ed)) ey += 1;
		const startTs = sourceInstant(sy, sm, sd, sh, smi, tz);
		const endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	return null;
}

// ── Nuxt devalue 解码（2026-11-13 换路径的核心）────────────────────────────────
// 页面把 SSR 数据放在 `<script type="application/json" id="__NUXT_DATA__">` 里，格式是 Nuxt 用的
// **devalue**：一个 JSON 数组，根值在 `[0]`；数组元素只可能是
//   · 字面量：字符串 / 布尔 / null                    ← 直接就是值
//   · **数字**：同数组的**下标引用**                    ← 对象/数组的成员、包装容器里都是这种
//   · 特殊容器：`["ShallowReactive", idx]` / `["Reactive", idx]` / `["Ref", idx]` /
//     `["EmptyRef"]` / `["Date", "ISO"]` / `["Set", idx…]` / `["Map", keyIdx, valIdx…]` /
//     `["BigInt", "…"]` / `["RegExp", "src", "flags"]` / `["URL", "…"]` / `["Object", idx]`
// 实测（2026-11-13 抓的 p1/p2）出现过的 tag 只有 ShallowReactive / Reactive / Ref / EmptyRef / Set / Map。
// 兼容策略：只实现上面这些 tag；**未知 tag 当普通数组逐项解**（不抛错，宁可少字段）；下标越界/悬空 ⇒ null；
//   `state` 有自引用环、同一对象被多处引用 ⇒ 每个下标都 memo，且容器**先入 memo 再填内容**
//   （否则环会无限递归 —— 实测直接栈溢出）。我们只读 `data.<hash>.list[]` 下的
//   `moment.topic.title/summary` 与 `created_time`，都是普通字符串/数字。
const NS_BATCH2_CZN_NUXT_RE = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const NS_BATCH2_CZN_DEVALUE_WRAPPERS = ["ShallowReactive", "Reactive", "Ref", "ShallowRef"];
const NS_BATCH2_CZN_DEVALUE_EMPTY = ["EmptyRef", "EmptyShallowRef"];

/** 页面 → `__NUXT_DATA__` 原文。页面结构变了 ⇒ `czn-no-nuxt`（是"抓取异常"，不是"没内容"）。 */
function ns_batch2_cznNuxtTextOf(html) {
	const m = NS_BATCH2_CZN_NUXT_RE.exec(String(html == null ? "" : html));
	if (!m) throw new Error("czn-no-nuxt");
	return m[1];
}

/** Nuxt devalue 文本 → 解码后的根值（格式与兼容策略见本段开头注释）。 */
function ns_batch2_cznDevalueOf(text) {
	let arr = null;
	try { arr = JSON.parse(String(text)); } catch { throw new Error("czn-bad-nuxt"); }
	if (!Array.isArray(arr)) throw new Error("czn-bad-nuxt");
	const memo = new Map();
	const get = (idx) => {
		if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= arr.length) return null;
		if (memo.has(idx)) return memo.get(idx);
		const v = arr[idx];
		if (v === null || typeof v !== "object") { memo.set(idx, v); return v; }
		if (Array.isArray(v)) {
			const tag = typeof v[0] === "string" ? v[0] : "";
			if (NS_BATCH2_CZN_DEVALUE_WRAPPERS.indexOf(tag) >= 0) { const r = get(v[1]); memo.set(idx, r); return r; }
			if (NS_BATCH2_CZN_DEVALUE_EMPTY.indexOf(tag) >= 0) { memo.set(idx, null); return null; }
			if (tag === "Date") { const r = new Date(String(v[1])); memo.set(idx, r); return r; }
			if (tag === "BigInt") { let r = null; try { r = BigInt(String(v[1])); } catch { r = null; } memo.set(idx, r); return r; }
			if (tag === "RegExp") { const r = new RegExp(String(v[1]), v[2] == null ? "" : String(v[2])); memo.set(idx, r); return r; }
			if (tag === "URL") { let r = null; try { r = new URL(String(v[1])); } catch { r = null; } memo.set(idx, r); return r; }
			if (tag === "Set") { const out = []; memo.set(idx, out); for (let k = 1; k < v.length; k++) out.push(get(v[k])); return out; }
			if (tag === "Map") { const out = {}; memo.set(idx, out); for (let k = 1; k + 1 < v.length; k += 2) out[String(get(v[k]))] = get(v[k + 1]); return out; }
			if (tag === "Object") { const r = get(v[1]); memo.set(idx, r); return r; }
			const out = [];                                              // 未知 tag：按普通数组解
			memo.set(idx, out);
			for (const x of v) out.push(get(x));
			return out;
		}
		const out = {};
		memo.set(idx, out);
		for (const k of Object.keys(v)) out[k] = get(v[k]);
		return out;
	};
	return get(0);
}

/** 页面 → 解码后的根值。 */
function ns_batch2_cznPayloadOf(html) {
	return ns_batch2_cznDevalueOf(ns_batch2_cznNuxtTextOf(html));
}

/** 源站 `created_time` → 毫秒：实测是 **unix 秒**（1794387600）；兼容已经是毫秒的实现。 */
function ns_batch2_cznCreatedTsOf(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n > 1e12 ? n : n * 1000;
}

/**
 * 页面 → 帖子数组 `{ id, title, body, createdTs }`（源站顺序）。
 * 路径 `data.<hash>.list[].moment`：hash 每页/每次构建都可能变，所以**按"哪个节点带 list[]"找**，
 * 不写死 hash。`body` = `moment.topic.summary`（SSR 侧截断在 200 字，实测）——卡池/活动需要的
 * 标题行与时间行都在前 200 字内；源站没下发的部分不补。
 */
function ns_batch2_cznPostsOf(html) {
	const root = ns_batch2_cznPayloadOf(html);
	const data = root && typeof root === "object" ? root.data : null;
	if (!data || typeof data !== "object") throw new Error("czn-bad-page");
	const out = [];
	const seen = new Set();
	for (const key of Object.keys(data)) {
		const node = data[key];
		if (!node || typeof node !== "object" || !Array.isArray(node.list)) continue;
		for (const item of node.list) {
			const mo = item && typeof item === "object" ? item.moment : null;
			if (!mo || typeof mo !== "object") continue;
			const topic = mo.topic && typeof mo.topic === "object" ? mo.topic : null;
			const title = topic && typeof topic.title === "string" ? topic.title.replace(/\s+/g, " ").trim() : "";
			const body = topic && typeof topic.summary === "string" ? topic.summary.replace(/\r\n?/g, "\n").trim() : "";
			if (!title && !body) continue;                              // 空帖（实测有 1 条 title=undefined）跳过
			const id = mo.id_str == null ? "" : String(mo.id_str);
			if (id && seen.has(id)) continue;
			if (id) seen.add(id);
			out.push({ id, title, body, createdTs: ns_batch2_cznCreatedTsOf(mo.created_time) });
		}
	}
	if (out.length === 0) throw new Error("czn-bad-page");              // 结构变了（不是"没内容"）
	return out;
}

/** 帖子 → 解析用 doc（正文行 + 发布时刻；维护窗由同页汇总，见 `ns_batch2_cznDocsOf`）。 */
function ns_batch2_cznDocOf(post) {
	const lines = String(post && post.body ? post.body : "").split("\n")
		.map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
		.filter((l) => l !== "");
	return {
		id: post && post.id ? String(post.id) : "",
		title: post && post.title ? String(post.title) : "",
		lines,
		createdTs: post && post.createdTs != null ? post.createdTs : null,
		ownMaint: null,                                                  // 由 ns_batch2_cznDocsOf 填；单帖调用时 fallback 自己算
		maint: null
	};
}

/**
 * 一页或多页 HTML → doc 数组。
 * 每帖 `.ownMaint` = 本**帖**写的维护窗（只有那帖自己算"维护活动"）；
 * `.maint` = 同**页**所有帖维护窗的并集（供「维护结束后/前」跨帖映射 —— 实测 p1 的池帖引用的
 * 正是同页更新介绍帖里的窗）。单页解析失败跳过（≥1 页成功就返回），**全部失败才抛最后一错**。
 */
function ns_batch2_cznDocsOf(htmlList, now, tz) {
	const pages = Array.isArray(htmlList) ? htmlList : [htmlList];
	const out = [];
	let lastErr = null;
	for (const html of pages) {
		let docs = null;
		try { docs = ns_batch2_cznPostsOf(html).map(ns_batch2_cznDocOf); } catch (err) { lastErr = err; continue; }
		const maint = [];
		const seen = new Set();
		for (const doc of docs) {
			doc.ownMaint = ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
			for (const w of doc.ownMaint) {
				const key = `${w.startTs}|${w.endTs}`;
				if (seen.has(key)) continue;
				seen.add(key);
				maint.push(w);
			}
		}
		for (const doc of docs) doc.maint = maint;
		for (const doc of docs) out.push(doc);
	}
	if (out.length === 0) throw lastErr || new Error("czn-bad-page");
	return out;
}

// 同帖维护窗标签：`◈更新时间：`（简繁都收 —— 实测国服写「更新时间」）
const NS_BATCH2_CZN_MAINT_LABEL_RE = /(?:更新|维护|維護)(?:时间|時間)\s*[:：]/;

/** 同帖维护窗（`◈更新时间：` 标签之后 3 行内的第一段绝对区间；一帖可能有多段维护说明）。 */
function ns_batch2_cznMaintWindowsOf(lines, now, tz) {
	const list = Array.isArray(lines) ? lines : [];
	const out = [];
	const seen = new Set();
	for (let i = 0; i < list.length; i++) {
		if (!NS_BATCH2_CZN_MAINT_LABEL_RE.test(list[i])) continue;
		for (let j = i; j < Math.min(i + 4, list.length); j++) {
			const w = ns_batch2_cznWindowOf(list[j], now, tz);
			if (!w) continue;
			if (!seen.has(w.raw)) {
				seen.add(w.raw);
				out.push(w);
			}
			break;
		}
	}
	return out;
}

// 端点 token：`2026/11/11 维护结束后`（相对，按同帖维护窗映射）/ `2026/11/25 02:00`（绝对）。
// 年份可省（`11/11 维护结束后`）—— 省了就用同帖维护窗的墙钟月日去认年份。
const NS_BATCH2_CZN_POINT_RE = /(?:(\d{4})\s*\/\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*(维护结束后|维护开始前|维护完成后|更新后|开服后))?/g;
const NS_BATCH2_CZN_CONNECTOR_RE = /^\s*[~～]\s*$/;

/**
 * 端点 token → 绝对时刻：`undefined` = 这个端点写法不认识（整条不解，不猜）；
 * `null` = 写法认识但同帖没有对应维护窗（**如实留空**）。
 */
function ns_batch2_cznPointTsOf(tok, maint, tz) {
	if (!tok) return undefined;
	if (!tok.rel) {
		if (tok.y == null || tok.h == null) return undefined;        // 绝对端点必须写全年月日 + 时刻
		return sourceInstant(tok.y, tok.mo, tok.d, tok.h, tok.mi, tz);
	}
	const hit = (maint || []).find((w) => {
		const p = sourceWallParts(w.startTs, tz);
		return p.mo === tok.mo && p.d === tok.d && (tok.y == null || p.y === tok.y);
	});
	if (!hit) return null;                                           // 同帖没有那天的维护窗 ⇒ 留空
	return /维护开始前/.test(tok.rel) ? hit.startTs : hit.endTs;
}

/**
 * 一行区间文本（`A ~ B`）→ `{ startTs, endTs, raw, display }`。
 * 两端各自按能解析的填：绝对端点 / 维护窗端点；同帖维护窗认不出 ⇒ 该端 `null`。
 * 两端都拿不到 ⇒ 仍返回（caller 自己决定要不要用）。读不出端点写法 ⇒ null（不猜）。
 */
function ns_batch2_cznPeriodWindowOf(text, maint, tz) {
	const s = String(text == null ? "" : text);
	const toks = [];
	const g = new RegExp(NS_BATCH2_CZN_POINT_RE.source, "g");
	let m;
	while ((m = g.exec(s)) !== null) {
		if (m[0] === "") { g.lastIndex++; continue; }
		toks.push({
			start: m.index, end: m.index + m[0].length,
			y: m[1] == null ? null : Number(m[1]),
			mo: Number(m[2]), d: Number(m[3]),
			h: m[4] == null ? null : Number(m[4]),
			mi: m[5] == null ? null : Number(m[5]),
			rel: m[6] || ""
		});
	}
	for (let i = 0; i + 1 < toks.length; i++) {
		const a = toks[i], b = toks[i + 1];
		if (!NS_BATCH2_CZN_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
		const startTs = ns_batch2_cznPointTsOf(a, maint, tz);
		const endTs = ns_batch2_cznPointTsOf(b, maint, tz);
		if (startTs === undefined || endTs === undefined) continue;
		if (startTs != null && endTs != null && !(endTs > startTs)) continue;
		const raw = s.slice(a.start, b.end).replace(/\s+/g, " ").trim();
		// 两端都绝对 ⇒ 格式化；有一端留空 ⇒ 原样印源站原文（不把"未知"渲染成确定时刻）
		const display = startTs != null && endTs != null ? fmtWindow(startTs, endTs, tz) : raw;
		return { startTs: startTs == null ? null : startTs, endTs: endTs == null ? null : endTs, raw, display };
	}
	return null;
}

/** 标题/分节标题里的 `「」` 名字（角色名 / 活动名）；重复只留一次。 */
function ns_batch2_cznQuotedOf(text) {
	const out = [];
	const re = /[「『]([^」』]+)[」』]/g;
	let m;
	while ((m = re.exec(String(text == null ? "" : text))) !== null) {
		const name = m[1].trim();
		if (name && out.indexOf(name) < 0) out.push(name);
	}
	return out;
}

/** 正文行里按标签取"标签那一行的尾巴"：命中第一行就停（`活动时间：…` / `〓活动时间〓…`）。 */
function ns_batch2_cznLabelTailOf(lines, re) {
	for (const line of Array.isArray(lines) ? lines : []) {
		const m = re.exec(line);
		if (m) return { line, tail: String(m[1] == null ? "" : m[1]).trim() };
	}
	return null;
}

// 「营救概率提升」= 卡池帖（活动侧必须排除，否则双计）；期间行标签简繁都收。
const NS_BATCH2_CZN_POOL_RE = /营救概率提升/;
const NS_BATCH2_CZN_POOL_PERIOD_RE = /(?:概率提升(?:期间|時間|时间)|(?:活动|活動)(?:时间|時間))\s*[:：]\s*(.+)$/;
// 活动时间标签（实测三种写法：`➤活动时间：` / `〓活动时间〓` / `【活动时间】`）；尾段可为空（标签独占一行）。
const NS_BATCH2_CZN_EVENT_TIME_LABEL_RE = /(?:【|〓|➤|◈|■)?\s*(?:活动|活動)(?:时间|時間)\s*(?:】|〓|[:：])\s*(.*)$/;
// 「即日起 ~ <绝对终点>」：起点锚在**帖子 created_time**（源站自己的发布时刻；没有就留空，不拿 now 猜）。
const NS_BATCH2_CZN_REL_START_RE = /^(?:即日|今日|自即日|自今日|现在|自现在)起\s*[~～\-–—]\s*(.+)$/;
const NS_BATCH2_CZN_ABS_POINT_RE = /(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?\s*(\d{1,2}):(\d{2})(?::\d{2})?/;

/** 单个绝对时刻（`2026/12/1 23:59` 与 `2026年12月1日 23:59:59` 都认）→ 毫秒；读不出 ⇒ null。 */
function ns_batch2_cznAbsPointOf(text, tz) {
	const m = NS_BATCH2_CZN_ABS_POINT_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	return sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
}

/** `即日起 ~ <绝对终点>` → 窗口（起点 = 帖子 created_time；没有 created_time ⇒ startTs=null，不猜）。 */
function ns_batch2_cznEventWindowOf(text, createdTs, tz) {
	const s = String(text == null ? "" : text).trim();
	const m = NS_BATCH2_CZN_REL_START_RE.exec(s);
	if (!m) return null;
	const endTs = ns_batch2_cznAbsPointOf(m[1], tz);
	if (endTs == null) return null;
	const startTs = createdTs == null ? null : createdTs;
	if (startTs != null && !(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, display: startTs != null ? fmtWindow(startTs, endTs, tz) : s };
}

// 帖子正文的首行如果只是 `-活动内容：…` 这类列表项，就不是"标题行"（蒂菲拉那帖实测如此）。
const NS_BATCH2_CZN_BULLET_RE = /^[\s•·\-–—➤▶〓#※*＊]/;

/** 这帖算不算卡池帖（返回池名；不算 ⇒ null）。池名 = 公告标题那一行，没有就退帖子标题。 */
function ns_batch2_cznPoolHeadOf(doc) {
	const first = (doc && Array.isArray(doc.lines) && doc.lines[0]) || "";
	const title = String((doc && doc.title) || "");
	const firstIsHeadline = NS_BATCH2_CZN_POOL_RE.test(first) && !NS_BATCH2_CZN_BULLET_RE.test(first);
	const titleHit = NS_BATCH2_CZN_POOL_RE.test(title);
	if (!firstIsHeadline && !titleHit) return null;
	const name = firstIsHeadline ? first : title;
	return { name: name || title || first };
}

/**
 * doc → 卡池事实 `{ title, roles, startTs, endTs, raw, display }`（0 或 1 条）。
 * 角色 = 池名里的 `「」`（正文别处的名字不算 —— 那里常写"与「X」共享保底"）。
 * 期间只认 `概率提升时间：` / `活动时间：` 标签那一行；没有 ⇒ 不成池（不拿正文里别的区间凑）。
 */
function ns_batch2_cznPoolsOf(doc, tz, now) {
	const head = ns_batch2_cznPoolHeadOf(doc);
	if (!head) return [];
	const lab = ns_batch2_cznLabelTailOf(doc.lines, NS_BATCH2_CZN_POOL_PERIOD_RE);
	if (!lab || !lab.tail) return [];
	const maint = doc.maint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const win = ns_batch2_cznPeriodWindowOf(lab.tail, maint, tz) || ns_batch2_cznWindowOf(lab.tail, now, tz);
	if (!win || (win.startTs == null && win.endTs == null)) return [];
	return [{
		title: head.name,
		roles: ns_batch2_cznQuotedOf(head.name).join("、"),
		startTs: win.startTs,
		endTs: win.endTs,
		raw: win.raw,
		display: win.display
	}];
}

/**
 * doc → 活动事实。两处来源：
 *   ① 同页维护窗（`◈更新时间：` → 服务器维护，标题 = 帖子标题）
 *   ② `活动时间：` 标签（三种写法）的区间；`即日起` 起点锚 created_time
 * **卡池帖不算活动**（双计守卫：那类帖的 `➤活动时间：` 正是池的档期）。
 */
function ns_batch2_cznEventRowsOf(doc, tz, now) {
	const maint = doc.maint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const ownMaint = doc.ownMaint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const out = [];
	const seen = new Set();
	const push = (row) => {
		const key = `${row.title}|${row.startTs}|${row.endTs}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(row);
	};
	for (const w of ownMaint) {
		if (doc.title) push({ title: doc.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	if (ns_batch2_cznPoolHeadOf(doc)) return out;                        // 双计守卫：卡池帖不重复算活动
	const lab = ns_batch2_cznLabelTailOf(doc.lines, NS_BATCH2_CZN_EVENT_TIME_LABEL_RE);
	if (!lab) return out;
	let tail = lab.tail;
	if (!tail) {
		// 标签独占一行（实测 `〓活动时间〓` / `【活动时间】`）：窗口在**紧随其后那一行**
		const idx = doc.lines.indexOf(lab.line);
		tail = doc.lines[idx + 1] || "";
	}
	const win = ns_batch2_cznPeriodWindowOf(tail, maint, tz)
		|| ns_batch2_cznEventWindowOf(tail, doc.createdTs, tz)
		|| ns_batch2_cznWindowOf(tail, now, tz);
	if (!win || (win.startTs == null && win.endTs == null)) return out;
	const quoted = ns_batch2_cznQuotedOf(doc.title);
	push({
		title: quoted.length > 0 ? quoted[0] : (doc.title || lab.line),
		startTs: win.startTs,
		endTs: win.endTs,
		raw: win.raw,
		display: win.display
	});
	return out;
}

/**
 * 抓 topic 第 1..N 页（固定 2 个请求；`?page=N` 由本函数拼）。
 * 单页失败跳过，**两页都失败才抛最后一错**（一页 500 不再让整侧 down）。
 */
async function ns_batch2_cznPagesOf(url) {
	const pages = [];
	let lastErr = null;
	for (let p = 1; p <= NS_BATCH2_CZN_PAGES; p++) {
		try {
			pages.push(await proxyFetchText(ns_batch2_cznTopicUrlOf(p, url), NS_BATCH2_CZN_REFERER));
		} catch (err) {
			lastErr = err;                                              // 单页失败 ⇒ 跳过，不拖垮整侧
		}
	}
	if (pages.length === 0) throw lastErr || new Error("czn-no-page");
	return pages;
}

/** docs → 活动事实（卡池/活动两侧共用；**无状态**，不缓存）。 */
function ns_batch2_cznEventItemsOf(docs, tz, now) {
	const items = [];
	for (const doc of docs) for (const row of ns_batch2_cznEventRowsOf(doc, tz, now)) items.push(row);
	return items;
}

/** 卡池载荷（当期 = 覆盖 now 的最新开始；悬停/数组 = 全部 coveredOrOpen）。 */
function ns_batch2_cznGachaPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = listed.slice().sort(poolHoverOrderOf).map((x) => ({
		title: x.title,
		label: x.roles ? `${x.title}：${x.roles}` : x.title,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw
	}));
	const out = {
		banner: primary.title,
		roles: primary.roles || "",
		bannerDates: primary.display,
		bannerDatesRaw: primary.raw
	};
	const hover = hoverTextFromItems(entries, "gacha", tz);
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	out.gachaHoverItems = entries;
	return out;
}

/** 活动条目事实 → 载荷（当期 = 覆盖 now 且开始最晚的那条）。 */
function ns_batch2_cznEventPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
	const out = { event: primary.title, eventDates: primary.display, eventDatesRaw: primary.raw };
	const hover = hoverTextFromItems(entries, "event", tz);
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
	out.eventHoverItems = entries;
	return out;
}

/**
 * 卡池抓取器（2 个请求：topic p1 + p2，经宿主代理）。
 * 载荷顺手带上活动字段 ⇒ 引擎 `reuseSameRequest` 让活动侧同一轮 0 请求（两侧仍各有独立抓取器）。
 */
async function ns_batch2_fetchCznGacha(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const docs = ns_batch2_cznDocsOf(await ns_batch2_cznPagesOf(url), now, tz);
	const rows = [];
	for (const doc of docs) for (const p of ns_batch2_cznPoolsOf(doc, tz, now)) rows.push(p);
	const out = ns_batch2_cznGachaPayloadOf(rows, tz, now);
	if (!out) return null;                                              // 当期没有池 ⇒ null（不是 down）
	const events = ns_batch2_cznEventPayloadOf(ns_batch2_cznEventItemsOf(docs, tz, now), tz, now);
	if (events) Object.assign(out, events);
	return out;
}

/** 活动抓取器（同样 2 个请求；独立失败归因，不依赖卡池侧那次成功）。 */
async function ns_batch2_fetchCznEvents(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const docs = ns_batch2_cznDocsOf(await ns_batch2_cznPagesOf(url), now, tz);
	return ns_batch2_cznEventPayloadOf(ns_batch2_cznEventItemsOf(docs, tz, now), tz, now);
}

// czn 卡厄斯梦境：默认源 = **topic 页 SSR HTML**（robots 允许、无 WAF；2 个请求）。
// 旧的 `webapiv2/feed` + `webapiv2/moment detail` 已整体删除（robots.txt 明确 Disallow）。
// 卡池 / 活动两侧标签统一「TapTap 官方」；bwiki 那页降为**手动备选**（解析器 / 回归逐字保留，
// 见 30-game-bwiki-czn-wikitext.js）。

// ── 条目登记（2026-11-16 去重：czn 原先由 30-game-bwiki-register.js 首次登记、30-game-batch2.js 二次合并；
//    现合并为**这一处**：条目字段（name / icon / defaultHidden / tz）+ TapTap 默认源 + bwiki 停更备选。
registerSource({
		id: "czn",
		defaultHidden: false,
		tz: "Asia/Shanghai",
		name: "卡厄斯梦境",
		icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
		url: NS_BATCH2_CZN_TOPIC_URL,
		source: NS_BATCH2_CZN_SOURCE_LABEL,
		eventUrl: NS_BATCH2_CZN_TOPIC_URL,
		eventSource: NS_BATCH2_CZN_SOURCE_LABEL,
		altSources: [{
			label: "Bwiki（停更）",
			url: ns_bwiki_wikitext_CZN_MODULE_URL,
			fetcher: "czn-bwiki"
		}]
});
// 旧的 `webapiv2/feed` + `webapiv2/moment detail` 已整体删除（robots.txt 明确 Disallow）。
// bwiki 那页降为**手动备选**（解析器 / 回归逐字保留，见本文件上半段）。

GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_batch2_fetchCznGacha(url, signal, tz);
GACHA_FETCHERS["czn-bwiki"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
EVENT_FETCHERS["czn"] = Object.assign(EVENT_FETCHERS["czn"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchCznEvents(url, signal, tz)
});
