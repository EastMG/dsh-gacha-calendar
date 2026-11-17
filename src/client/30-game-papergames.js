// src/client/30-game-papergames.js —— 叠纸游戏：以闪亮之名（yslz）/ 无限暖暖（wxnn）/ 闪耀暖暖（nikki4）
//
// 职责（2026-11-16 按厂商重排）：叠纸三款的条目 + 解析器 + 抓取器 + 登记都在本文件；
//   每个 id 只在此注册一次（符号名沿用原 `ns_*`）。
// 组成（三份自包含来源原样迁入）：
//   · 以闪亮之名：bwiki 卡池（`Category:限时追光` 分类成员 + 正文）+ 活动 SMW `action=ask`；
//   · 无限暖暖：官网「资讯快报」列表 + `/news/{id}` 详情（按 id 缓存 24h、已结束不再取）；
//   · 闪耀暖暖：官网首页 `__NEXT_DATA__` 精选 + `/news/{id}` 详情（同上缓存口径）。
// 复用关系：yslz 复用 bwiki 公共层（表 / 日期 / 载荷 helper）与 bwiki-html-fetchers.js 的抓取器；
//   wxnn / nikki4 只用公共层的 fmtWindow / sourceInstant / 悬停与数组生成器；三款解析器互不共享。
// 请求预算：yslz 每侧 2 次；wxnn 列表 1 + 详情（按 id 缓存 24h）；nikki4 首页 1 + 详情（按 id 缓存 24h）。

// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-yslz.js：以闪亮之名（yslz）—— bwiki 卡池分类 + 活动 SMW
// ─────────────────────────────────────────────────────────────────────────────

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
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b6/b3/23/b6b3232f-e5d5-6753-8320-b37d638d4b2d/AppIcon-1x_U007emarketing-0-8-0-0-85-220-0.png/512x512bb.jpg",
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


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-wxnn.js：无限暖暖（wxnn）—— 官网资讯列表 + 详情
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 源（两次链路：列表 1 次 + 详情按 id 缓存）────────────────────────────────────
//   ① GET https://infinitynikki.nuanpaper.com/api/news
//        200 / application/json; charset=utf-8 / 6,607 B（实测 2026-11-15）+ **无需任何 header**。
//        结构 `{ data: { allNews: [5], notices: [5], news: [5] } }`，三桶**互相重叠**（同一篇会同时出现在
//        allNews 与 notices/news 里）⇒ 按 `id` 去重后实测 **10 篇唯一**。
//        ⚠️ **没有分页**：`page` / `limit` / `section` / `offset` 全被忽略（实测四种参数回的还是同一份 6,607 B）。
//        字段：`id` / `title` / `section`(0=资讯 1=公告) / `publish_time`(ISO UTC) / `cover` / `abstract`。
//   ② GET https://infinitynikki.nuanpaper.com/news/{id}
//        200 / text/html；正文与元数据都在 `__NEXT_DATA__` 的
//        `props.pageProps.pageData.{title, publish_time(ms), content_html}` 里。
//        实测 2026-11-15：
//        · 1092「「何人消隐于祷声」限定共鸣复刻开启」— 有池名 + `➤共鸣时间`（27,586 B）
//        · 1094「2.11版本…活动开启提醒」— 一篇 5 条活动，每条 `● 活动时间：…`（18,934 B）
//        · 1095「11月13日更新预告」— **同文维护窗** `2026年11月13日10:00-11:00（UTC+8）`（16,068 B）
//        · 1093「奇想衣橱 | 万物繁生谣」— 池名在 `前往「予大地以时光」进行共鸣`、`共鸣时间` 单独一行（17,472 B）
//
// ── 两个坑（实测踩过）────────────────────────────────────────────────────────
//   · **旧 id / 不存在的 id 回 200 + 空页**，不是 404：实测 `/news/999999` = 200 / 11,793 B 的骨架页，
//     `pageData.title` 是 `undefined`、`content_html` 空串 ⇒ "拿不到 pageData = 这条不在源站（跳过）"，
//     **不能**当抓取失败抛出去。
//   · **连续快速请求会回 200 + 空 body（0 字节）**（源站短时限流）⇒ 空 body 与"页面正常"必须分开：
//     空 body ⇒ 等 2.5 秒重试，最多 3 次，仍空才跳过该条。
//
// ── 时区 ──
//   `tz = Asia/Shanghai`（国服）。后缀两种写法：`（UTC+8）` 与 `（服务器时间）` —— 国服服务器时间就是 UTC+8，
//   两者按同一时区解析（后缀在解析前剥掉，**不进悬停**）。
//
// ── 解析口径 ─────────────────────────────────────────────────────────────────
//   · 锚点：`共鸣时间` ⇒ 卡池侧；`活动时间` ⇒ 活动侧。锚点可带前缀符号（实测 `➤` / `●` / 无），
//     档期**同行**（`● 活动时间：…`）或**下一行**（`➤共鸣时间` ⏎ 档期）两种都要吃。
//   · 池名：**优先**取正文里 `前往「…」进行共鸣` 的名字（1092/1093 都有；1093 的标题是套装名，不是池名）。
//   · 活动名：该「活动时间」行**之前最近的**「…」行（最多回看 3 行）。整行只有一对括号 ⇒ 去括号；
//     带尾巴的（`「颂愿感悟之礼」系列礼包限时上架`）⇒ 保留整行。回看到上一个锚点为止。
//   · 起点常写「版本更新后」：**同批维护窗兜底** —— 同批公告里有同一天的 `停服维护 … 10:00-11:00（UTC+8）`
//     ⇒ 起点 = **维护结束时刻**。取不到就如实留空（`startTs = null`）—— 那种条目**不进外显**，只在悬停列出。
//   · `raw` = 源站原文（连接号统一成 `~`，时间后缀剥掉）；`bannerDates` / `eventDates` = 补全后的绝对窗口。
//
// ── 取数（请求数）────────────────────────────────────────────────────────────
//   列表 **1 次** + 只对**没缓存的 id** 取详情。详情按 id 缓存（24h TTL）+ **已结束的封存永不重取**
//   ⇒ 稳态每轮只有列表那 1 个请求（实测首轮 1 + 10 = 11）。缓存是**引擎实例级**（本文件在 core 里位于
//   `createEngine` 内部）。轮内复用：卡池/活动两侧靠 `fetchRoundSeqOf()` 记住那一轮的结果，整轮仍 1 次列表请求。
//
// ── 失败语义 ────────────────────────────────────────────────────────────────
//   · 列表结构变了 ⇒ **抛错**；· 单篇详情失败/空 body ⇒ 跳过该条；**全部尝试都失败且出现过硬错** ⇒ 抛错；
//   · 有数据但没有覆盖 now 的条目 ⇒ `null`（未公布）。

		// ── 常量 ──
		const WXNN_TZ = "Asia/Shanghai";
		const WXNN_LIST_URL = "https://infinitynikki.nuanpaper.com/api/news";
		const WXNN_NEWS_BASE = "https://infinitynikki.nuanpaper.com/news/";
		const WXNN_SOURCE_LABEL = "官网公告";
		const WXNN_DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
		const WXNN_CACHE_MAX = 80;
		const WXNN_EMPTY_RETRY_MS = 2500;
		const WXNN_EMPTY_RETRY = 2;
		const WXNN_NAME_LOOKBACK = 3;

		const WXNN_NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
		const WXNN_SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
		const WXNN_BLOCK_END_RE = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|table|section|blockquote)>/gi;
		const WXNN_SUFFIX_RE = /[\s]*[（(]\s*(?:UTC\s*\+\s*8|服务器时间)\s*[）)]\s*$/;
		const WXNN_GACHA_ANCHOR_RE = /^(?:[※*·●▸➤〓■□☆◆◇>＞▶]\s*)*共鸣时间\s*[】\]]?\s*[：:]?\s*(.*)$/;
		const WXNN_EVENT_ANCHOR_RE = /^(?:[※*·●▸➤〓■□☆◆◇>＞▶]\s*)*活动时间\s*[】\]]?\s*[：:]?\s*(.*)$/;
		const WXNN_WINDOW_RE = new RegExp(
			String.raw`^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*`
			+ String.raw`(?:版本更新后|版本更新完成后|更新维护后|(\d{1,2})\s*[:：]\s*(\d{2}))\s*`
			+ String.raw`[-~～—–－至到]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})$`
		);
		const WXNN_MAINT_RE = new RegExp(
			String.raw`(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*`
			+ String.raw`(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～—–－至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})`
		);
		const WXNN_POOL_NAME_RE = /前往\s*「([^」]+)」\s*进行共鸣/;
		const WXNN_BARE_NAME_RE = /^「([^」]+)」$/;
		const WXNN_LEAD_NAME_RE = /^「[^」]+」/;
		const WXNN_MAINT_LINE_RE = /维护/;

		let wxnnCache = new Map();
		let wxnnRoundCache = { seq: -1, promise: null };

		function wxnnSleep(ms) {
			return new Promise((resolve) => coreEnv.timer.setTimeout(resolve, ms));
		}

		function wxnnTimestampOf(v) {
			if (typeof v === "number" && Number.isFinite(v)) return v;
			const t = Date.parse(String(v == null ? "" : v));
			return Number.isFinite(t) ? t : 0;
		}

		function wxnnNewsIdOf(v) {
			const n = Number(v);
			return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
		}

		function wxnnListOf(raw) {
			let j;
			try { j = JSON.parse(String(raw == null ? "" : raw)); } catch { throw new Error("wxnn-list-changed:bad-json"); }
			const data = j && j.data;
			if (!data || typeof data !== "object") throw new Error("wxnn-list-changed:no-data");
			// 取 `data` 下**所有数组**的并集：实测有 4 个栏目
			//（allNews / notices / news / **activity**），写死三个会漏掉 activity 里的在期活动
			//（2026-11-15 实测：1034「致独一无二的奇旅」在 activity 里，正在期）。
			const buckets = Object.keys(data).filter((k) => Array.isArray(data[k]));
			if (buckets.length === 0) throw new Error("wxnn-list-changed:no-buckets");
			const out = [], seen = new Set();
			for (const k of buckets) {
				for (const it of data[k]) {
					const id = wxnnNewsIdOf(it && it.id);
					if (id == null || seen.has(id)) continue;
					seen.add(id);
					out.push({
						id,
						title: htmlTextTight(it.title == null ? "" : it.title),
						publishTs: wxnnTimestampOf(it.publish_time)
					});
				}
			}
			if (out.length === 0) throw new Error("wxnn-list-changed:no-news");
			return out;
		}

		function wxnnPageOf(html) {
			const m = WXNN_NEXT_DATA_RE.exec(String(html == null ? "" : html));
			if (!m) return null;
			let j;
			try { j = JSON.parse(m[1]); } catch { return null; }
			const pd = j && j.props && j.props.pageProps && j.props.pageProps.pageData;
			if (!pd || typeof pd !== "object") return null;
			const title = htmlTextTight(pd.title == null ? "" : pd.title);
			const contentHtml = String(pd.content_html == null ? "" : pd.content_html);
			if (!title && contentHtml.trim() === "") return null;
			return { title, publishTs: wxnnTimestampOf(pd.publish_time), contentHtml };
		}

		function wxnnLinesOf(contentHtml) {
			const html = String(contentHtml == null ? "" : contentHtml)
				.replace(WXNN_SCRIPT_RE, " ")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(WXNN_BLOCK_END_RE, "\n");
			return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
		}

		function wxnnMaintOf(line, hint, tz) {
			const s = String(line == null ? "" : line).replace(WXNN_SUFFIX_RE, "").trim();
			const m = WXNN_MAINT_RE.exec(s);
			if (!m) return null;
			const y = inferYear(m[1] != null ? Number(m[1]) : null, Number(m[2]), hint);
			if (y == null) return null;
			const mo = Number(m[2]), d = Number(m[3]);
			return { y, mo, d, ts: sourceInstant(y, mo, d, Number(m[6]), Number(m[7]), tz) };
		}

		function wxnnWindowOf(line, hint, tz) {
			const s = String(line == null ? "" : line).replace(WXNN_SUFFIX_RE, "").trim();
			const m = WXNN_WINDOW_RE.exec(s);
			if (!m) return null;
			const sm = Number(m[2]), sd = Number(m[3]);
			const startY = inferYear(m[1] != null ? Number(m[1]) : null, sm, hint);
			if (startY == null) return null;
			const openStart = m[4] == null;
			const startTs = openStart ? null : sourceInstant(startY, sm, sd, Number(m[4]), Number(m[5]), tz);
			const em = Number(m[7]), ed = Number(m[8]);
			const endY = m[6] != null ? Number(m[6]) : startY + (endsNextYear(sm, sd, em, ed) ? 1 : 0);
			const endTs = sourceInstant(endY, em, ed, Number(m[9]), Number(m[10]), tz);
			if (startTs != null && !(endTs > startTs)) return null;
			return {
				startTs,
				endTs,
				raw: s.replace(/\s*[-~～—–－至到]\s*/, " ~ "),
				openDate: openStart ? { y: startY, mo: sm, d: sd } : null
			};
		}

		function wxnnEventNameOf(lines, at) {
			const list = Array.isArray(lines) ? lines : [];
			const last = Math.max(0, at - WXNN_NAME_LOOKBACK);
			for (let k = at - 1; k >= last; k--) {
				const s = String(list[k] == null ? "" : list[k]).trim();
				if (!s) continue;
				if (WXNN_GACHA_ANCHOR_RE.test(s) || WXNN_EVENT_ANCHOR_RE.test(s)) return "";
				const bare = WXNN_BARE_NAME_RE.exec(s);
				if (bare) return bare[1].trim();
				if (WXNN_LEAD_NAME_RE.test(s)) return s;
			}
			return "";
		}

		function wxnnFactsOf(listItem, page, tz) {
			const lines = wxnnLinesOf(page.contentHtml);
			const hint = page.publishTs ? sourceWallParts(page.publishTs, tz) : null;
			const text = lines.join("\n");
			const pm = WXNN_POOL_NAME_RE.exec(text);
			const poolName = pm ? pm[1].trim() : "";
			const gacha = [], events = [], maint = [];
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (WXNN_MAINT_LINE_RE.test(line)) {
					const mt = wxnnMaintOf(line, hint, tz);
					if (mt) maint.push(mt);
				}
				const g = WXNN_GACHA_ANCHOR_RE.exec(line);
				if (g) {
					const w = wxnnWindowOf(String(g[1] || "").trim() || lines[i + 1] || "", hint, tz);
					if (w) gacha.push(Object.assign({ name: poolName || page.title || listItem.title }, w));
					continue;
				}
				const e = WXNN_EVENT_ANCHOR_RE.exec(line);
				if (e) {
					const w = wxnnWindowOf(String(e[1] || "").trim() || lines[i + 1] || "", hint, tz);
					if (!w) continue;
					const name = wxnnEventNameOf(lines, i);
					if (!name) continue;
					events.push(Object.assign({ name }, w));
				}
			}
			return {
				id: listItem.id,
				title: page.title || listItem.title,
				publishTs: page.publishTs || listItem.publishTs,
				gacha,
				events,
				maint
			};
		}

		function wxnnSealedOf(fact) {
			if (!fact) return true;
			const all = [].concat(fact.gacha || [], fact.events || []);
			if (all.length === 0) return true;
			const now = nowMs();
			return all.every((x) => x.endTs != null && x.endTs < now);
		}

		function wxnnCachedOf(id, now) {
			const hit = wxnnCache.get(id);
			if (!hit) return null;
			if (wxnnSealedOf(hit.fact)) return hit;
			return now - hit.at < WXNN_DETAIL_TTL_MS ? hit : null;
		}

		function wxnnPrune(list) {
			const inList = new Set((Array.isArray(list) ? list : []).map((x) => x.id));
			for (const [id, hit] of [...wxnnCache]) {
				if (!inList.has(id) && wxnnSealedOf(hit.fact)) wxnnCache.delete(id);
			}
			if (wxnnCache.size <= WXNN_CACHE_MAX) return;
			wxnnCache = new Map([...wxnnCache.entries()]
				.sort((a, b) => (b[1].fact.publishTs || 0) - (a[1].fact.publishTs || 0))
				.slice(0, WXNN_CACHE_MAX));
		}

		async function wxnnFetchFact(listItem, tz) {
			const url = WXNN_NEWS_BASE + listItem.id;
			for (let attempt = 0; ; attempt++) {
				const html = await proxyFetchText(url);
				if (String(html == null ? "" : html).trim() !== "") {
					const page = wxnnPageOf(html);
					return page ? wxnnFactsOf(listItem, page, tz) : null;
				}
				if (attempt >= WXNN_EMPTY_RETRY) return null;
				await wxnnSleep(WXNN_EMPTY_RETRY_MS);
			}
		}

		async function wxnnCollect(signal, tz) {
			const now = nowMs();
			const list = wxnnListOf(await proxyFetchText(WXNN_LIST_URL));
			let tried = 0, ok = 0;
			let firstErr = null;
			for (const it of list) {
				if (wxnnCachedOf(it.id, now)) continue;
				tried++;
				let fact = null;
				try {
					fact = await wxnnFetchFact(it, tz);
				} catch (e) {
					if (!firstErr) firstErr = e;
					continue;
				}
				if (!fact) continue;
				ok++;
				wxnnCache.set(it.id, { at: now, fact });
			}
			// 一条都没取到、却又真的试过 ⇒ 整侧如实报错（不许把封禁/改版静默成"未公布"）。
			// ⚠️ 例外：**缓存里已经有事实**时不抛 —— 那批详情只是"新公告没取到"，当期该显示的内容仍在
			//    （缓存里的档期都是绝对时刻，过期的自然被 coversNow 挡掉），下一轮还会重试那几条。
			//    不这么分，一次针对某篇公告的限流就会把整侧打成"抓取失败"，把已经拿到的当期一起丢掉。
			if (tried > 0 && ok === 0 && wxnnCache.size === 0) throw firstErr || new Error("wxnn-details-failed");
			wxnnPrune(list);
			return [...wxnnCache.values()]
				.map((x) => x.fact)
				.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
		}

		function wxnnCollectInRound(signal, tz) {
			const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
			if (round > 0 && wxnnRoundCache.seq === round && wxnnRoundCache.promise) return wxnnRoundCache.promise;
			const promise = wxnnCollect(signal, tz);
			if (round > 0) {
				wxnnRoundCache = { seq: round, promise };
				promise.catch(() => {
					if (wxnnRoundCache.promise === promise) wxnnRoundCache = { seq: -1, promise: null };
				});
			}
			return promise;
		}

		function wxnnMaintIndexOf(facts) {
			const map = new Map();
			for (const f of Array.isArray(facts) ? facts : []) {
				for (const m of f.maint || []) {
					const key = `${m.y}-${m.mo}-${m.d}`;
					const cur = map.get(key);
					if (cur == null || m.ts > cur) map.set(key, m.ts);
				}
			}
			return map;
		}

		function wxnnResolveStarts(items, maintIdx) {
			return (Array.isArray(items) ? items : []).map((x) => {
				if (x.startTs != null || !x.openDate) return x;
				const ts = maintIdx.get(`${x.openDate.y}-${x.openDate.mo}-${x.openDate.d}`);
				if (ts == null) return x;
				return Object.assign({}, x, { startTs: ts });
			});
		}

		function wxnnDedupe(items) {
			const seen = new Set(), out = [];
			for (const x of Array.isArray(items) ? items : []) {
				const key = `${x.name}|${x.startTs}|${x.endTs}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(x);
			}
			return out;
		}

		function wxnnPayloadOf(items, side, tz, now) {
			const isGacha = side === "gacha";
			const listed = (Array.isArray(items) ? items : []).filter((x) => coveredOrOpen(x, now));
			const primary = listed.filter((x) => coversNow(x, now))
				.sort((a, b) => (a.endTs - b.endTs) || (b.startTs - a.startTs))[0] || null;
			if (!primary) return null;
			const entries = isGacha ? listed.slice().sort(poolHoverOrderOf) : sortEventItems(listed);
			const hoverItems = entries.map((x) => (isGacha
				? { title: x.name, label: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }
				: { title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {};
			if (isGacha) {
				out.banner = primary.name;
				out.roles = "";
				out.bannerDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.name;
				out.eventDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(hoverItems, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "wxnn", tz }, now);
				out.gachaHoverItems = hoverItems;
			} else {
				out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "wxnn", tz }, now);
				out.eventHoverItems = hoverItems;
			}
			return out;
		}

		async function ns_wxnn_fetchWxnn(url, signal, tz) {
			const tzUse = tz || WXNN_TZ;
			const facts = await wxnnCollectInRound(signal, tzUse);
			const maintIdx = wxnnMaintIndexOf(facts);
			const gachaRaw = [], eventRaw = [];
			for (const f of facts) {
				for (const g of f.gacha || []) gachaRaw.push(g);
				for (const e of f.events || []) eventRaw.push(e);
			}
			const now = nowMs();
			const gacha = wxnnResolveStarts(wxnnDedupe(gachaRaw), maintIdx);
			const events = wxnnResolveStarts(wxnnDedupe(eventRaw), maintIdx);
			const g = wxnnPayloadOf(gacha, "gacha", tzUse, now);
			const e = wxnnPayloadOf(events, "event", tzUse, now);
			if (!g && !e) return null;
			return Object.assign({}, g || {}, e || {});
		}

		// ── 条目 ──
		registerSource({
			id: "wxnn",
			defaultHidden: false,
			tz: WXNN_TZ,
			name: "无限暖暖",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/8e/0e/e4/8e0ee433-ee2d-67f8-95ca-b00625443c4e/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: WXNN_LIST_URL,
			source: WXNN_SOURCE_LABEL,
			eventUrl: WXNN_LIST_URL,
			eventSource: WXNN_SOURCE_LABEL
		});

		GACHA_FETCHERS["wxnn"] = (url, signal, tz) => ns_wxnn_fetchWxnn(url, signal, tz);
		EVENT_FETCHERS["wxnn"] = Object.assign(EVENT_FETCHERS["wxnn"] || {}, {
			default: (url, signal, tz) => ns_wxnn_fetchWxnn(url, signal, tz)
		});


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-nikki4.js：闪耀暖暖（nikki4）—— 官网首页精选 + /news/{id}
// ─────────────────────────────────────────────────────────────────────────────

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
//
// ⚠️ 卡池侧三条请求全带 `noOrigin: true`（2026-11-18 真机修复）：`nikki4` 的 `/api/` 路径对
//    `Origin` 头敏感 —— 同一 IP / UA / Referer，只改 Origin 实测：
//      带 `Origin: https://nikki4.papegames.cn` → **403**；带 `Origin: https://example.com` → **403**；
//      **不带 Origin → 200**（列表段 + 24 篇详情 26 请求 2.8s 全 200）。
//    同域首页（活动侧）带 Origin 也是 200 ⇒ 只有 `/api/` 敏感，所以**活动侧不加**这个开关。
async function ns_nikki4_collectGachaPools(url, signal, tz, now) {
	const base = ns_nikki4_apiBaseOf(url);
	const rows = [];
	for (const sec of ns_nikki4_GACHA_SECTIONS) {
		const listUrl = `${base}?section=${sec.section}&offset=0&limit=${sec.limit}`;
		const list = await fetchJson(listUrl, { mode: "proxy", referer: ns_nikki4_NEWSLIST_URL, signal, noOrigin: true });
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
			const post = ns_nikki4_newsDetailOf(await fetchJson(`${base}/${row.id}`, { mode: "proxy", referer: ns_nikki4_NEWSLIST_URL, signal, noOrigin: true }), tz);
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
