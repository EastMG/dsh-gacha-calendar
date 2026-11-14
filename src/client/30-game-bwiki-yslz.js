// src/client/30-game-bwiki-yslz.js —— 以闪亮之名 国服（yslz）：bwiki「限时追光」分类 + 「活动」分类
//
// ── 为什么单独一个文件（而不是塞进 30-game-bwiki-register.js）────────────────────
// 2026-10-03 起本仓库的惯例是「每款/每组游戏一个**自包含**文件」（条目 + 解析器 + 抓取器 + 登记），
// 后接入的 `30-game-wqmt.js` / `30-game-pengpeng.js` / `30-game-bwiki-bjhl.js` 都按这个写法。
// 本文件复用**公共层**（`ns_bwiki_windowsFromCell` 的两份文本 / `ns_bwiki_batchGachaPayloadOf` 的
// 同批合并 / `ns_bwiki_eventPayload` 的活动档 / `hoverTextFromItems` / `dataArrayProduced*`），
// **没有**第二套时间解析、也没有第二套悬停排版、更没有一个新载荷字段。
//
// ── 源站事实（2026-11-15 实测；夹具见 test/fixtures/yslz-*）────────────────────────
// 站点：https://wiki.biligame.com/yslzgame/ （活站，最后编辑 2026-11-14）
// ⚠️ 必须带 `Referer: https://wiki.biligame.com/`，否则 EdgeOne WAF 回 `567`（挑战页）；
//    `origin=*` 由 `withBwikiCors` 在两条 transport 出口统一补（见 15-env.js），本文件不用管。
//
// ① 卡池 = `Category:限时追光` 的成员页（每期一页，**无汇总表**）：
//    实测 64 页 = 63 个 `追光·<阁名>` + 1 个 `模板:限时追光记录`（ns=10，用 `gcmnamespace=0` 排掉）。
//    每页正文是一段 `{{限时追光记录 |追光开始时间=… |追光结束时间=… |阁名=… |套装1~3=… |羁绊角色=… |羁绊名称=…
//    |复刻次数=N |第N次复刻开始/结束时间=… }}`。
//    ⚠️ 汇总页 `限时追光情况记录`（action=parse，实测 550KB / 74 张 `card-pool-row` 卡）**没有任何时间串**
//       （`data-pool-id` / `data-set-name` 之外只有抽数追踪控件）⇒ 不能当取数入口。
//    ⚠️ `action=query&list=categorymembers` 只回标题、不回正文；要正文得再发 `prop=revisions`。
//       这两条合成一次：`generator=categorymembers` + `prop=revisions&rvprop=content`。
//       **`rvprop=content` 每次最多回 50 页正文**（实测：63 页 → 第 1 次 50 页 + `rvcontinue`，
//       第 2 次 13 页）⇒ 本侧固定 2 个请求。**不做"只取新页面"的标题级缓存**：复刻是把新窗口写回
//       **同一个页面**（标题不变），按标题缓存会把某期永远钉在旧窗口上 ⇒ 当期错判（宁可多 1 个请求）。
//
// ② 活动 = `Category:活动`（实测 553 页）走 SMW `action=ask`：`[[分类:活动]]|?名称|?开始时间|?结束时间
//    |?类型|?版本|limit=500`。汇总页 `活动一览` 只是筛选按钮（7 个 `<tr>`，无数据行，JS 现查）⇒ 不能当入口。
//    ⚠️ 该 wiki 这四列是 `_txt` 不是 `_dat` ⇒ `sort=/order=` 被忽略（实测首条是 2026/8/30，不是最新），
//       所以**不能**用 dhmmr 那套"排序后只取最新 50 条"；只能分页取全：
//       `query-continue-offset=500` ⇒ 第 2 页 54 行。本侧固定 2 个请求。
//
// 请求量：首轮 4（卡池 2 + 活动 2），每轮刷新也是 4。条数再涨才各 +1（卡池每多 50 个页面 / 活动每多 500 行）。
//
// ── 日期格式（源站是脏的，全部归一）─────────────────────────────────────────────
// 实测出现四种：`2026/11/03 10:00`、`2026/11/03  09:10`（**双空格**）、`2026/8/30`（无前导零）、
// `2024/08/06`（只有日期）。解析一律走共用 `ns_bwiki_windowsFromCell`（它的 `ns_bwiki_DATE_RE` 认
// `YYYY/M/D`、`ns_bwiki_timeAfter` 的 `^\s*` 吃掉任意多个空格）⇒ 不需要给本文件写第二套正则。
// 只有日期没有时刻：起 00:00 / 止 23:59（仓库通用约定）。
// 只有一端（实测活动 553 行里 4 行缺开始、9 行缺结束：缺结束的是「2022年红包封面」这类红包封面、
// 缺开始的是「初芽新绽」这类只写截止的充值礼包）：**如实保留另一端为 null**，不猜；
// `coversNow` 两端都要 ⇒ 它们不进外显/数组（与 dhmmr 同口径）。
//
// ── 当期口径（照本仓库现成的那几条）──────────────────────────────────────────────
//   · 当期 = `coversNow`（两端都明确且覆盖 now）。**复刻窗口也算当期**：实测 2026-11-15 同时开着
//     3 个窗口 —— 主档 `追光·时砂寄念`（11-03 10:00 ~ 11-23 23:59）+ 两个复刻
//     （`追光·黯影新誓` 第 2 次 10-27 ~ 11-16 23:59 / `追光·月狩神谕` 第 1 次 11-11 ~ 12-01 23:59）。
//     所以每页产出 **1 + N 条条目**（原始档 + 每个复刻档），`isMain` 只标原始档，**不按它过滤**。
//   · 外显/悬停/数组 = 共用 `ns_bwiki_batchGachaPayloadOf`（＝"结束最早"的那口池 + **同批（endTs 相同）
//     合并角色** + 悬停列在期全部）。选它而不是 `ns_bwiki_gachaPayload` 的理由：本游戏同时开
//     主档 + 多个复刻，而后者会把**别的池**的套装并到外显那口池上（白荆回廊实测踩过同一个坑）。
//     这里每口池的 endTs 各不相同 ⇒ "同批"退化成"它自己"，角色不会串池。
//   · 活动外显/悬停/数组 = 共用 `ns_bwiki_eventPayload`（档位 → 结束最早优先）。
//
// ── 字段口径 ────────────────────────────────────────────────────────────────────
//   卡池池名 = 页面标题原文（`追光·时砂寄念`，源站自己的叫法；`阁名` 只是去掉前缀的那半截）。
//   角色 = `套装1`/`套装2`/`套装3` + `羁绊角色`，`、` 连接（去重、保序）。
//     为什么把羁绊也算进来：追光抽的是"套装 + 羁绊卡"，两者都是这一期的 UP 内容；
//     只看套装会漏掉「落言」这张卡（用户看数据时要的就是"这期能抽到什么"）。
//     若以后只想留套装：删掉 `ns_yslz_poolRolesOf` 里 `bond` 那一项即可（一行）。
//   复刻档的 `category` = `复刻`（原始档留空）—— 走 `itemFacts` 通道，不新造字段。
//   活动名 = `名称`（源站的干净名，不带页名的 `【】`）；`类型` 多值用 `、` 连成 `category`（只给档位判定用）。
//
// ── 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx / 响应不是 JSON ⇒ 抛（`fetchJson` 自己抛 `http-…` / `bad-json`）；
//   · 结构变了（没有 `query.pages` / 没有 `query.results` / 一页都解不出）⇒ **抛**（抓取失败，不是"当期没有"）；
//   · 分页第 2 页失败 ⇒ **抛**（不允许"只看了前 50 个页面"被当成完整的当期 —— 实测当期主档
//     `追光·时砂寄念` 恰好落在第 2 页，吞掉它就等于把当期误判成未公布）；
//   · 解出来了但没有任何窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。

//#region ① 常量（URL 是条目的事实：登记与夹具索引都逐字比它）
const ns_yslz_TZ = "Asia/Shanghai";
const ns_yslz_API = "https://wiki.biligame.com/yslzgame/api.php";
const ns_yslz_REFERER = "https://wiki.biligame.com/";
// 分类名 = 取数入口：卡池「限时追光」、活动「活动」（两个都是 MediaWiki 分类，不是页面）
const ns_yslz_GACHA_CATEGORY = "Category:限时追光";
const ns_yslz_EVENTS_CATEGORY = "活动";
// 卡池：分类成员 + 正文一次拿（`gcmnamespace=0` 排掉 `模板:限时追光记录`）
const ns_yslz_GACHA_PARAMS = "action=query&generator=categorymembers"
	+ "&gcmtitle=" + encodeURIComponent(ns_yslz_GACHA_CATEGORY)
	+ "&gcmnamespace=0&gcmlimit=500"
	+ "&prop=revisions&rvslots=main&rvprop=content"
	+ "&format=json&formatversion=2";
const ns_yslz_GACHA_URL = ns_yslz_API + "?" + ns_yslz_GACHA_PARAMS;
// 续页 URL：`rvcontinue` 插在 `?` 之后（MediaWiki 不看参数顺序）。
// 为什么：`rvcontinue` 版默认是基准 URL 的**前缀扩展**，而夹具映射（test/harness 的
// `resolveFixtureFile`）在基准键上做"前缀命中"的兜底 ⇒ 续页会命中第 1 页（实测踩过：
// 同一个续页 URL 被请求 8 次、条目翻倍）。插到最前，两个 URL 就互不为前缀。
// `base` 传调用方那条（自定义地址也照它的 host/path 续页，而不是硬回内置地址）。
function ns_yslz_gachaPageUrl(rvcontinue, base) {
	const b = String(base == null ? "" : base) || ns_yslz_GACHA_URL;
	const t = String(rvcontinue == null ? "" : rvcontinue).trim();
	if (!t) return b;
	const i = b.indexOf("?");
	const head = i < 0 ? b : b.slice(0, i);
	const tail = i < 0 ? "" : b.slice(i + 1);
	return head + "?rvcontinue=" + encodeURIComponent(t) + (tail ? "&" + tail : "");
}
// 每页一页正文的硬上限（`rvprop=content` 一次最多 50 页）；分页保护上限 = 8 页 = 400 期
const ns_yslz_GACHA_MAX_PAGES = 8;
// 活动：SMW ask。`limit=500` 是 SMW 单页上限，超出靠 `|offset=` 续
const ns_yslz_EVENTS_PAGE_SIZE = 500;
const ns_yslz_EVENTS_QUERY = `[[分类:${ns_yslz_EVENTS_CATEGORY}]]`
	+ "|?名称|?开始时间|?结束时间|?类型|?版本"
	+ `|limit=${ns_yslz_EVENTS_PAGE_SIZE}`;
const ns_yslz_EVENTS_MAX_PAGES = 4;
// 活动 ask 的四个列名（`_txt` 形态：printouts 是字符串数组）—— 只写一处，改名时不会只改一半
const ns_yslz_KEY_NAME = "名称";
const ns_yslz_KEY_START = "开始时间";
const ns_yslz_KEY_END = "结束时间";
const ns_yslz_KEY_TYPE = "类型";
// 卡池模板的字段名
const ns_yslz_FIELD_START = "追光开始时间";
const ns_yslz_FIELD_END = "追光结束时间";
const ns_yslz_FIELD_NAME = "阁名";
const ns_yslz_FIELD_SETS = ["套装1", "套装2", "套装3"];
const ns_yslz_FIELD_BOND = "羁绊角色";
// 复刻档的 `category` 标记
const ns_yslz_RERUN_TAG = "复刻";
// 活动 ask 第 2 页（`|offset=500`）—— URL 由**同一个 query 串**拼出来，测试与夹具都按它比对
function ns_yslz_eventsUrlOf(offset) {
	const n = Number(offset);
	const q = n > 0 ? `${ns_yslz_EVENTS_QUERY}|offset=${n}` : ns_yslz_EVENTS_QUERY;
	return `${ns_yslz_API}?action=ask&format=json&query=` + encodeURIComponent(q);
}
const ns_yslz_EVENTS_URL = ns_yslz_eventsUrlOf(0);
//#endregion

//#region ② 纯解析：卡池页正文 / 活动 ask JSON → 条目事实
// wikitext 里取一个字段（`|名=值`，值到行尾或下一个 `|` / `}` 为止：套装名里不会有这两个字符，
// 而 `限定散件&妆容` 那种 `{{图标A|…}}` 多值字段我们**不读**，所以不需要括号配对）
function ns_yslz_fieldOf(text, name) {
	const m = new RegExp("\\|\\s*" + name + "\\s*=\\s*([^\\n|}]*)[ \\t]*").exec(String(text == null ? "" : text));
	return m ? m[1].trim() : "";
}
// 该页所有复刻窗口（`第N次复刻开始时间` / `第N次复刻结束时间`），按 N 升序。
// **不读 `复刻次数`**：那只是个计数，字段本身才是事实 —— 计数漏填时按字段扫仍不会少一期。
function ns_yslz_rerunsOf(text) {
	const map = new Map();
	const re = /\|\s*第(\d+)次复刻(开始|结束)时间\s*=\s*([^\n|}]*)/g;
	let m;
	while ((m = re.exec(String(text == null ? "" : text)))) {
		const k = Number(m[1]);
		const cur = map.get(k) || { start: "", end: "" };
		if (m[2] === "开始") cur.start = m[3].trim();
		else cur.end = m[3].trim();
		map.set(k, cur);
	}
	return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ k, start: v.start, end: v.end }));
}
// 两端文本 → 窗口（`{ startTs, endTs, raw, display }`）。**归一在这里，解析交给共用工具**：
//   · 两端都有：拼成 `起 ~ 止` 交给 `ns_bwiki_windowsFromCell`（双空格 / 无前导零都能吃，`~` 是仓库统一分隔符）；
//     它判 `endTs > startTs` 不成立时返回空数组 ⇒ 本条**丢掉**（源站错行不硬造）。
//   · 只有一端：那一端换算成绝对时刻，另一端 null（不猜、不补"起/止"）。
function ns_yslz_windowOf(startText, endText, tz) {
	const s = String(startText == null ? "" : startText).trim();
	const e = String(endText == null ? "" : endText).trim();
	if (!s && !e) return null;
	const raw = [s, e].filter(Boolean).join(" ~ ");
	if (s && e) {
		const w = ns_bwiki_windowsFromCell(`${s} ~ ${e}`, tz, "startFirst")[0];
		if (w) return w;
		// 两端都在、但窗口不成立（源站错行：实测 `【仙喵神游记】2026/04/07 ~ 2025/04/21`）
		// ⇒ 原文照留、两端给 null（不猜年份、更不硬造一个"在期"）
		return { startTs: null, endTs: null, raw, display: raw };
	}
	const sp = s ? ns_bwiki_parsePoints(s)[0] : null;
	const ep = e ? ns_bwiki_parsePoints(e)[0] : null;
	if (!sp && !ep) return { startTs: null, endTs: null, raw, display: raw };
	return {
		startTs: sp ? ns_bwiki_pointTs(sp, tz) : null,
		endTs: ep ? ns_bwiki_pointTs(ep.noTime ? { ...ep, h: 23, mi: 59 } : ep, tz) : null,
		raw,
		// 单边不补全：外显永远拿不到它（`coversNow` 两端都要），这里只让 `display` 有原文可回
		display: raw
	};
}
// 这一期的 UP 内容 = 套装1~3 + 羁绊角色（去重、保序、`、` 连接）
function ns_yslz_poolRolesOf(fields) {
	const out = [], seen = new Set();
	for (const name of ns_yslz_FIELD_SETS.concat([ns_yslz_FIELD_BOND])) {
		const v = String(fields && fields[name] != null ? fields[name] : "").trim();
		if (!v || seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out.join("、");
}
// 卡池：`query.pages[]`（generator 的返回）→ 条目事实。
// 一页 → 1 + N 条：原始档（`isMain: true`）+ 每个复刻档（`category: "复刻"`）。
// 形状 = `{ _i, banner, roles, category, startTs, endTs, raw, display, isMain }`（与 whmx / bjhl 同形）。
function ns_yslz_parsePools(pages, tz = ns_yslz_TZ) {
	const items = [];
	let i = 0;
	for (const p of (Array.isArray(pages) ? pages : [])) {
		const title = String(p && p.title != null ? p.title : "").trim();
		const content = String(p && p.content != null ? p.content : "");
		// `模板:限时追光记录` 在分类里（ns=10）：正常由 `gcmnamespace=0` 排掉，这里再挡一道
		if (!title || /^(模板|Template)\s*[:：]/i.test(title)) continue;
		// 模板页的 `<noinclude><pre>` 里是用法示例（同一串字段名但值是占位符）⇒ 整段挖掉
		const body = content.replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, "");
		const fields = {};
		for (const name of [ns_yslz_FIELD_START, ns_yslz_FIELD_END, ns_yslz_FIELD_NAME]
			.concat(ns_yslz_FIELD_SETS, [ns_yslz_FIELD_BOND])) {
			fields[name] = ns_yslz_fieldOf(body, name);
		}
		// 一个字段都读不到 = 这页不是「限时追光记录」模板（或模板被改名）⇒ 跳过（整体为空由调用方抛错）
		if (!fields[ns_yslz_FIELD_START] && !fields[ns_yslz_FIELD_END]) continue;
		const roles = ns_yslz_poolRolesOf(fields);
		const main = ns_yslz_windowOf(fields[ns_yslz_FIELD_START], fields[ns_yslz_FIELD_END], tz);
		if (main) {
			items.push({ _i: i++, banner: title, roles, category: "", startTs: main.startTs, endTs: main.endTs, raw: main.raw, display: main.display, isMain: true });
		}
		for (const r of ns_yslz_rerunsOf(body)) {
			const w = ns_yslz_windowOf(r.start, r.end, tz);
			if (!w) continue;
			items.push({ _i: i++, banner: title, roles, category: ns_yslz_RERUN_TAG, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display, isMain: false });
		}
	}
	return items;
}
// ask 的 printout 值 → 首个非空字符串（兼容 `["2026-07-23"]` / `[{ timestamp }]` / `[{ raw }]`）
function ns_yslz_textOf(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_yslz_textOf(v[0]);
	if (typeof v === "object") {
		if (typeof v.raw === "string" && v.raw.trim() !== "") return v.raw.trim();
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// 活动：ask JSON → 条目事实（`{ _i, event, category, startTs, endTs, raw, display }`）。
// `名称` 是干净名（页名带 `【】`）；`类型` 是多值（`限时、免费、占星物语`）⇒ 连成一个 `category`。
// 缺点 / 缺结束的行**如实保留**（那端 null），由 `coversNow` 挡在外显之外。
function ns_yslz_parseEvents(json, tz = ns_yslz_TZ) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("yslz-events-changed:bad-json");
	const items = [];
	let i = 0;
	for (const [page, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const event = ns_yslz_textOf(p[ns_yslz_KEY_NAME]).replace(/\s+/g, " ").trim()
			|| String(page).replace(/[【】]/g, "").trim();
		if (!event) continue;
		const startText = ns_yslz_textOf(p[ns_yslz_KEY_START]);
		const endText = ns_yslz_textOf(p[ns_yslz_KEY_END]);
		const w = ns_yslz_windowOf(startText, endText, tz);
		const types = (Array.isArray(p[ns_yslz_KEY_TYPE]) ? p[ns_yslz_KEY_TYPE] : [p[ns_yslz_KEY_TYPE]])
			.map((x) => ns_yslz_textOf(x)).filter(Boolean);
		items.push({
			_i: i++,
			event,
			category: types.join("、"),
			startTs: w ? w.startTs : null,
			endTs: w ? w.endTs : null,
			raw: w ? w.raw : "",
			display: w ? w.display : ""
		});
	}
	if (items.length === 0) throw new Error("yslz-events-changed:no-rows");
	return items;
}
//#endregion

//#region ③ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 一个请求（走宿主代理 + `Referer`；`origin=*` 由 transport 出口统一补）
async function ns_yslz_json(url, signal) {
	return fetchJson(String(url == null ? "" : url), { referer: ns_yslz_REFERER, signal, mode: "proxy" });
}
// 卡池：分类成员 + 正文，按 `rvcontinue` 续页（`rvprop=content` 每次最多 50 页）
async function ns_yslz_pagesOf(url, signal) {
	const base = String(url == null ? "" : url) || ns_yslz_GACHA_URL;
	const out = [];
	let next = base;
	for (let page = 0; page < ns_yslz_GACHA_MAX_PAGES; page++) {
		const json = await ns_yslz_json(next, signal);
		const q = json && json.query;
		if (!q || !Array.isArray(q.pages)) throw new Error("yslz-gacha-changed:no-pages");
		for (const p of q.pages) {
			const rev = p && Array.isArray(p.revisions) ? p.revisions[0] : null;
			const content = rev && rev.slots && rev.slots.main ? rev.slots.main.content : null;
			if (typeof content !== "string") continue;
			out.push({ title: String(p.title == null ? "" : p.title), content });
		}
		const cont = json.continue && json.continue.rvcontinue;
		if (!cont) return out;
		next = ns_yslz_gachaPageUrl(cont, base);
	}
	return out;
}
// 卡池侧：一页都解不出 ⇒ **抛**（源站改版），不是"当期没有"
async function ns_yslz_gacha(url, signal, tz = ns_yslz_TZ, now) {
	const items = ns_yslz_parsePools(await ns_yslz_pagesOf(url, signal), tz);
	if (items.length === 0) throw new Error("yslz-gacha-changed:no-pools");
	// 同批（endTs 相同）合并角色 + 悬停列在期全部：与白荆回廊 / 无期迷途同一份载荷生成器
	return ns_bwiki_batchGachaPayloadOf(items, tz, ns_bwiki_nowOf(now), { id: "yslz" });
}
// 活动：`|offset=` 续页（SMW 单页 500 行）。
// ⚠️ 续页用 `ns_yslz_eventsUrlOf(offset)` 这条**规范地址**（offset 夹在编码过的 query 串里，
//    没法从任意自定义地址安全地重拼）；自定义活动地址只会用到它的第 1 页。
async function ns_yslz_eventsOf(url, signal) {
	const base = String(url == null ? "" : url) || ns_yslz_EVENTS_URL;
	const merged = { query: { results: {} } };
	let offset = 0;
	for (let page = 0; page < ns_yslz_EVENTS_MAX_PAGES; page++) {
		const json = await ns_yslz_json(page === 0 ? base : ns_yslz_eventsUrlOf(offset), signal);
		const results = json && json.query && json.query.results;
		if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("yslz-events-changed:bad-json");
		Object.assign(merged.query.results, results);
		const next = Number(json["query-continue-offset"]);
		if (!Number.isFinite(next) || next <= offset) return merged;
		offset = next;
	}
	return merged;
}
async function ns_yslz_events(url, signal, tz = ns_yslz_TZ, now) {
	const items = ns_yslz_parseEvents(await ns_yslz_eventsOf(url, signal), tz);
	// 第 5 参 = 条目 id（只在**自己的**数组 key 上加前缀 `yslz:event:N`；不传的既有来源行为不变）
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), 0, "yslz");
}
//#endregion

//#region ④ 条目登记
registerSource({
	id: "yslz",
	defaultHidden: false,
	tz: ns_yslz_TZ,
	name: "以闪亮之名",
	// 两侧都是 bwiki，但**入口形态不同**：卡池走 MediaWiki 分类成员 + 正文，活动走 SMW ask
	url: ns_yslz_GACHA_URL,
	source: "Bwiki 限时追光",
	eventUrl: ns_yslz_EVENTS_URL,
	eventSource: "Bwiki 活动一览"
});
GACHA_FETCHERS["yslz"] = (url, signal, tz, now) => ns_yslz_gacha(url, signal, tz, now);
EVENT_FETCHERS["yslz"] = Object.assign(EVENT_FETCHERS["yslz"] || {}, {
	default: (url, signal, tz, now) => ns_yslz_events(url, signal, tz, now)
});
//#endregion
