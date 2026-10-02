// next-sources/parsers/bwiki-wikitext.js —— 批次 P8：三个 bwiki 来源的**wikitext 形态**解析器
//
// 本文件只装 P8 的三个来源（**不动** parsers/bwiki.js —— 那是 B2 的 `prop=text` HTML 形态）：
//   ① 战双帕弥什 zspms   —— 两步：SMW `action=ask` 索引 → 取最新「版本更新公告」→ `prop=wikitext` 正文
//   ② 卡厄斯梦境 czn     —— 一步：`Module:Gacha/data` 的 **Lua 表**（`prop=wikitext`）
//   ③ 雪松 kedrgame      —— 一步：`Template:首页游戏版本内容` 的 **模板调用**（`prop=wikitext`）
//
// 契约（与 CONVENTIONS.md / 插件 40-fetchers.js 完全一致）：
//   async (url, signal, tz, now = Date.now()) → 数据对象 | null
//     · 卡池侧 { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//     · 活动侧 { event, eventDates, eventDatesRaw, eventHover }
//   `now` 一律**第 4 个参数**（铁律 2：本仓库历史上把 now 放第二位 → `startTs <= now` 恒假 → 静默"未公布"）。
//   覆盖 now 的档期一条都没有 → **返回 null（未公布）**，绝不硬凑过期档期；结构性损坏才 throw。
//
// ══ 抓取证据（2026-10-02 实抓，夹具全部为真响应）══════════════════════════════
//   fixtures/p8-zspms-ask        HTTP 200 / 20,470B  SMW ask 命中 **40 条**，最新《远信回响》20260922
//   fixtures/p8-zspms-notice     HTTP 200 / 42,908B  parse.wikitext["*"] 正文 9,846B
//   fixtures/p8-czn-module       HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006）
//   fixtures/p8-kedr-template    HTTP 200 /  3,750B  `时间进度条` **5 条**
//   fixtures/p8-czn-record       HTTP 200 /    423B  备选页 `卡池记录`（模板调用 1 条，2026/03）
//
// ⚠️ bwiki 反爬（EdgeOne WAF）：请求发太密会被拦成 **HTTP 567**（≈7KB JS 挑战页、非 JSON、页内含 requestId）。
//    实测只带 UA 也能 200，**不是请求头问题** → 抓夹具要 6~10s 间隔 + 退避重试 + 校验 body 是 JSON
//    （见 test/capture-p8.mjs）。运行期若某侧抛 `bad-json`/`proxy-http-567`，那是 WAF，不是"未公布"。
//
// ══ 时区：三个来源一律 Asia/Shanghai（**均为推测**）═══════════════════════════
//   源站**都没有**时区标注。旁证：
//     · zspms 停服维护 05:00~11:00、卡池日切 05:00（国服特征）；公告尾部写「2026年9月22日」
//     · czn `10:00:00` 开池 / `02:00:00` 关池（国服作息）
//     · kedr 每期都在 `05:00` 换池（与 P6 的雪松社区页同款旁证）
//   故记"推测"，注册表注释里同样标注。
//
// ══ 「版本更新后」这类**相对起点**的锚点策略（重要，与任务书略有出入，理由在此）══
//   stellasora.js 的先例：相对起点没有绝对时刻 → 用**该公告的发布时间**当锚点 + 标 `startInferred: true`。
//   本文件沿用该精神（相对起点必须有据可依的锚点、必须标 inferred、绝不假造时刻），但锚点优先级更细：
//     ① 源站**自己写明的停服维护窗口**的结束时刻（`…将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
//        —— "版本更新后"就是维护结束之后，这是**源站原文给的绝对锚点**，比公告发布日期精确 2 天；
//     ② 兜底：公告 `{{公告|时间=YYYYMMDD}}` 字段（**= stellasora 先例的"公告发布时间"**，本夹具里是 20260922）；
//     ③ 再兜底：该相对点**自带的日期**（`2026年9月24日版本更新后`）按当日 00:00（防御性；只要正则匹配到相对点，
//        ② 的公告时间字段就一定存在，故这条实际到不了，保留以防字段被源站删除）。
//   三条路径**都**标 `startInferred: true`，并在 `bannerHover`/`eventHover` 里如实写明推断依据。
//   （若坚持"一律用发布时间"，只需删掉 zspmsMaintenanceWindow 的调用；本文件把两种依据都打印在 hover 里。）

import { fetchJson, sourceInstant, fmtWindow, pad2 } from "../lib/env.js";

//#region 通用：MediaWiki `prop=wikitext`（fetchMediaWikiText 只取 parse.text，这里要 parse.wikitext）
// 实测两种返回形态都要兼容：
//   · 本项目抓到的 bwiki 是 `{"parse":{"title":…,"wikitext":{"*":"正文"}}}`（对象包一层 `"*"`）
//   · 部分 MediaWiki（如 fgo.wiki 的某些配置）直接给字符串 → 也兼容
export function mediaWikiWikitext(json) {
	const p = json && json.parse;
	if (!p) return null;
	const wt = p.wikitext;
	if (typeof wt === "string") return wt;
	if (wt && typeof wt === "object" && typeof wt["*"] === "string") return wt["*"];
	return null;
}
// 带 Referer 请求（浏览器真实会带；bwiki 的 EdgeOne WAF 拦的主要是"频率"，但少一个 bot 信号没坏处）。
// ⚠️ 夹具测试不受影响：离线 harness 只读代理 URL 里的 `url` 参数，忽略 referer。
async function fetchWikitext(url, signal, referer = "") {
	const json = await fetchJson(url, { referer, signal, mode: "proxy" });
	const wt = mediaWikiWikitext(json);
	if (wt == null) throw new Error("bad-json");     // 含 missingtitle（HTTP 仍 200）→ 结构性损坏
	return wt;
}
//#endregion

//#region 通用：当期挑选 / 悬停
function nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }
// 覆盖 now 的条目（起点/终点都有绝对时刻才进候选；缺任一端的不产出）
function activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.startTs != null && it.startTs <= now && it.endTs >= now);
}
// 悬停行：窗口 + 名字；超过 limit 行折叠（悬停不是数据出口，别把 20+ 行都塞进去）
function hoverLines(items, tz, nameOf, limit = 12) {
	const lines = items.slice(0, limit).map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}   ${nameOf(x)}`);
	if (items.length > limit) lines.push(`…以及另外 ${items.length - limit} 项`);
	return lines.join("\n");
}
// 卡池侧载荷。cmp 决定"外显"优先序；默认 = 结束最早优先（越快结束越该盯住，与 bwiki.js 同口径）。
function gachaPayload(items, tz, now, opts = {}) {
	const act = activeItems(items, now);
	if (act.length === 0) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const note = first.startInferred ? `（起点「${first.startRel || "版本更新后"}」按${first.startFrom}推断）` : "";
	const hover = [opts.header, hoverLines(sorted, tz, (x) => `${x.banner}${x.roles && !String(x.banner).includes(x.roles) ? `（${x.roles}）` : ""}${x.startInferred ? "（起点推断）" : ""}`)]
		.filter(Boolean).join("\n");
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = (note ? `${note}\n${hover}` : hover);
	return out;
}
// 活动侧载荷。cmp 决定外显优先序；悬停列出**全部覆盖当期**的条目（按同一排序）。
function eventPayload(items, tz, now, opts = {}) {
	const act = activeItems(items, now);
	if (act.length === 0) return null;
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const nameOf = opts.nameOf || ((x) => x.name || x.event || "");
	const note = first.startInferred ? `（起点「${first.startRel || "版本更新后"}」按${first.startFrom}推断）` : "";
	const hover = act.length >= 2
		? [opts.header, note, hoverLines(sorted, tz, (x) => `${nameOf(x)}${x.startInferred ? "（起点推断）" : ""}`)].filter(Boolean).join("\n")
		: "";
	return {
		event: nameOf(first),
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		eventHover: hover
	};
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期
// ══════════════════════════════════════════════════════════════════════════════
export const ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
export const ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
export const ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
export function zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
export const ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

//#region 战双：SMW ask 索引
// 实测返回（fixtures/p8-zspms-ask）：
//   {"query-continue-offset":40,
//    "query":{"printrequests":[{"label":"标题",…},{"label":"时间",…}],
//             "results":{"《远信回响》版本更新公告":{"printouts":{"标题":["《远信回响》版本更新公告"],
//                                                              "时间":["20260922"]},
//                                                 "fulltext":"《远信回响》版本更新公告","fullurl":…,"namespace":0,"exists":"1"}},
//             "serializer":"SMW\\Serializers\\QueryResultSerializer","version":2,
//             "meta":{"hash":…,"count":40,"offset":0,…}}}
// ⚠️ `时间` 是**字符串** `"20260922"`（YYYYMMDD），**不是** SMW 的 timestamp 对象。
//    但仍做兼容：字符串 / 数组 / {timestamp} / {fulltext} 都吃。
function smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return smwText(v[0]);
	if (typeof v === "object") {
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// ask JSON → 按 `时间` 严格倒序的行 [{ page, title, time, fullurl }]
//   结构性损坏（无 query.results）→ 抛错；**0 条也抛错**：该查询依赖 `类别::版本`，
//   返回 0 条说明索引/属性坏了，绝不能静默降级成"未公布"（任务书明确要求）。
export function parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: smwText(p["标题"]) || page,
			time: smwText(p["时间"]),
			fullurl: (v && v.fullurl) || ""
		};
	});
	if (rows.length === 0) throw new Error("zspms-ask:no-result");
	rows.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
	return rows;
}
//#endregion

//#region 战双：正文 → 档期
// `{{颜色引用|红|2026年9月24日版本更新后 - 2026年11月5日05:00}}` —— 档期**写在模板参数里**，
// 所以必须先剥模板（保留内文），否则整段档期都看不见。处理顺序：
//   ① `{{颜色引用|<色>|<正文>}}` → 只留 <正文>（档期就在这里）  ② `{{公告|…}}` 信息模板 → 整块丢弃（时间另取）
//   ③ 其它无参/单参模板 → 无参丢、有参留最后一个参数   ④ `'''` 粗体标记 → 去掉
//   ⑤ `[[file:…]]` → 去掉   ⑥ `<br>`/块级标签 → 换行（正文是 `<br>` 分行写的）
//   ⑦ 标题 `==X==` → 独立行，并打上 `\u0001H<level>\u0001` 前缀（后面要靠标题栈取活动名）
export function zspmsNormalize(wikitext) {
	let s = String(wikitext == null ? "" : wikitext);
	s = s.replace(/\{\{颜色引用\s*\|[^|{}]*\|([\s\S]*?)\}\}/g, "$1");
	s = s.replace(/\{\{公告[\s\S]*?\}\}/g, "");
	s = s.replace(/\{\{[^{}]*\}\}/g, (m) => { const i = m.lastIndexOf("|"); return i < 0 ? "" : m.slice(i + 1, -2); });
	s = s.replace(/'''/g, "");
	s = s.replace(/\[\[(?:file|File|文件)\s*:[^\]]*\]\]/g, "");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/?(?:hr|center|div|p|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/?(?:b|i|u|span|small|big|font|sup|sub)\b[^>]*>/gi, "");
	s = s.replace(/&nbsp;/gi, " ");
	// ⚠️ 标题必须**整行**匹配（加 m + ^$）：否则表格行 `{| class="wikitable" style="…"` 里的两个 `=`
	//    会被当成一级标题，往标题栈里塞一个假标题。
	s = s.replace(/^(={1,6})\s*([^=\n]+?)\s*\1\s*$/gm, (m, eq, title) => `\u0001H${eq.length}\u0001${title}`);
	return s;
}

// 停服维护窗口（源站原文，例：`我们将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
// 只在含「停服维护/停机维护」的那一行里找 `YY…MM…DD HH:MM - HH:MM`（终点可省日期）。
export function zspmsMaintenanceWindow(text, tz = ZSPMS_TZ) {
	const line = String(text == null ? "" : text).split("\n").find((l) => /停服维护|停机维护|维护更新/.test(l) && /\d{4}\s*年/.test(l));
	if (!line) return null;
	const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(line);
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const startTs = sourceInstant(y, mo, d, +m[4], +m[5], tz);
	let endTs = sourceInstant(y, mo, d, +m[6], +m[7], tz);
	if (endTs <= startTs) endTs = sourceInstant(y, mo, d + 1, +m[6], +m[7], tz);   // 跨零点的维护（如 22:00-02:00）
	if (!(endTs > startTs)) return null;
	const raw = `${y}-${pad2(mo)}-${pad2(d)} ${pad2(+m[4])}:${m[5]} - ${pad2(+m[6])}:${m[7]}`;
	return { startTs, endTs, raw };
}

// 中文年月日「起点 - 终点」窗口（源站墙钟原文形态）：
//   `2026年9月24日版本更新后 - 2026年11月5日05:00`（相对起点）
//   `2026年9月29日10:00 - 2026年11月3日23:59`（双端显式时刻）
//   `2026年9月24日 - 2026年10月1日`（双端只有日期 → 起点 00:00 / 终点 23:59）
// ⚠️ 内部空白只用 `[ \t]`（**不许跨行**）：否则维护段 `9月24日05:00 - 11:00` 会跟下一行的日期拼成假窗口。
const _SP = "[ \\t]*";
const _CN_DATE = "(\\d{4})" + _SP + "年" + _SP + "(\\d{1,2})" + _SP + "月" + _SP + "(\\d{1,2})" + _SP + "日";
const _CN_TIME = "(\\d{1,2})" + _SP + "[:：]" + _SP + "(\\d{2})";
const _CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const _CN_WIN_SRC = _CN_DATE + _SP + "(?:" + _CN_TIME + "|" + _CN_REL + ")?" + _SP + "[-–—－~～至到]" + _SP
	+ _CN_DATE + _SP + "(?:" + _CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const _GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
export function zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: cleanHead(m[2]) });
	});
	return out;
}
export function zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !_GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const _ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
export function parseZspmsAnnouncement(wikitext, tz = ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = zspmsNormalize(raw);
	const maint = zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(_CN_WIN_SRC, "g");
	let m;
	while ((m = re.exec(text))) {
		// —— 起点：显式时刻 > 相对锚点（① 源站维护结束时刻 → ② 公告时间字段[stellasora 先例] → ③ 自带日期）
		//    三条相对锚点路径都标 startInferred=true，并把依据写进 startFrom（hover 会如实显示）
		let startTs, startInferred = false, startFrom = "", startRel = "";
		if (m[4] != null) {
			startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		} else if (m[6] != null) {
			startRel = m[6];
			startInferred = true;
			if (maint && maint.endTs != null) { startTs = maint.endTs; startFrom = `源站维护窗口 ${maint.raw} 的结束时刻`; }
			else if (annDate) { startTs = sourceInstant(annDate.y, annDate.mo, annDate.d, 0, 0, tz); startFrom = `公告时间 ${timeField}`; }
			else { startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz); startFrom = `自带日期 ${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`; }
		} else {
			startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz);
			startInferred = true;
			startFrom = "源站只给日期，起点按 00:00";
		}
		// —— 终点（缺时刻按 23:59）
		const endTs = m[10] != null
			? sourceInstant(+m[7], +m[8], +m[9], +m[10], +m[11], tz)
			: sourceInstant(+m[7], +m[8], +m[9], 23, 59, tz);
		if (!(endTs > startTs)) { skipped++; continue; }             // 源站错行 → 丢弃，不硬造

		// —— 行上下文（分类 + 池名 + 活动名都只看本行）
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		let lineEnd = text.indexOf("\n", m.index);
		if (lineEnd < 0) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd);
		const lineIdx = text.slice(0, lineStart).split("\n").length - 1;
		const isPool = /研发池/.test(line);
		const base = {
			_i: items.length,
			startTs, endTs,
			raw: m[0],
			startInferred, startFrom, startRel,
			line: line.trim()
		};
		if (isPool) {
			const pools = zspmsPools(line);
			const role = zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = _ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const _ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
export function zspmsEventTier(x) { return _ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function zspmsEventCmp(a, b) {
	return (zspmsEventTier(a) - zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
function zspmsHeader(parsed, row, side) {
	const w = parsed.anchor ? `起点锚点=源站维护结束 ${parsed.anchor.raw}` : `起点锚点=公告时间 ${parsed.announceTime || "?"}`;
	return `战双帕弥什 bwiki 版本更新公告「${(row && row.title) || "?"}」（SMW 时间=${parsed.announceTime || "?"}；${side}；tz=UTC+8 为推测；${w}）`;
}

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
export async function zspmsLatestNotice(url, signal) {
	const rows = parseZspmsAsk(await fetchJson(url || ZSPMS_ASK_URL, { referer: ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await fetchWikitext(zspmsParseUrl(row.page), signal, ZSPMS_REFERER);
	return { row, rows, wikitext };
}
export async function gachaZspms(url, signal, tz = ZSPMS_TZ, now = Date.now()) {
	const { row, wikitext } = await zspmsLatestNotice(url, signal);
	const parsed = parseZspmsAnnouncement(wikitext, tz, row);
	return gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, nowOf(now), {
		header: zspmsHeader(parsed, row, "卡池：研发池档期"),
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
export async function eventsZspms(url, signal, tz = ZSPMS_TZ, now = Date.now()) {
	const { row, wikitext } = await zspmsLatestNotice(url, signal);
	const parsed = parseZspmsAnnouncement(wikitext, tz, row);
	return eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, nowOf(now), {
		header: zspmsHeader(parsed, row, "活动：版本内限时内容档期"),
		cmp: zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
export const CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
export const CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
export const CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
export const CZN_RECORD_PAGE = "卡池记录";
export const CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
export const CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
export function cznStamp(text) {
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
export function parseCznLua(wikitext, tz = CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = cznStamp(f.start_date), b = cznStamp(f.end_date);
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
export function parseCznRecord(wikitext, tz = CZN_TZ) {
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
		const a = cznStamp(f["Start_Date"]), b = cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			cat: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
export async function gachaCzn(url, signal, tz = CZN_TZ, now = Date.now()) {
	const items = parseCznLua(await fetchWikitext(url || CZN_MODULE_URL, signal, CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return gachaPayload(items, tz, nowOf(now), {
		header: `卡厄斯梦境 bwiki ${CZN_MODULE_PAGE}（Lua 表 ${items.length} 期；tz=UTC+8 为推测）`,
		cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i)
	});
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
export const KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
export const KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
export function kedrTemplateUrl(page = KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
export const KEDR_TEMPLATE_URL = kedrTemplateUrl();
export const KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
export function kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
export function kedrStamp(text) { return cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
export function kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
export function kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
export function kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
export function parseKedrTemplate(wikitext, tz = KEDR_TZ) {
	const calls = kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = kedrStamp(p["开始时间"]), b = kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: kedrRoleFromName(name) });
		else if (kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
const _KEDR_HEADER = "雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）";
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
export async function gachaKedrTemplate(url, signal, tz = KEDR_TZ, now = Date.now()) {
	const { gacha } = parseKedrTemplate(await fetchWikitext(url || KEDR_TEMPLATE_URL, signal, KEDR_REFERER), tz);
	return gachaPayload(gacha, tz, nowOf(now), { header: _KEDR_HEADER, cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
export async function eventsKedrTemplate(url, signal, tz = KEDR_TZ, now = Date.now()) {
	const { event } = parseKedrTemplate(await fetchWikitext(url || KEDR_TEMPLATE_URL, signal, KEDR_REFERER), tz);
	return eventPayload(event, tz, nowOf(now), { header: _KEDR_HEADER, cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion
