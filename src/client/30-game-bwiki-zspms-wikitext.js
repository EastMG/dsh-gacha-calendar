// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    · 活动侧默认（2026-11-11 起）：`Test4/活动日历` 的结构化 `{{活动日历|名|起|止}}` 行
//    · 卡池侧默认（2026-11-10 起）：`Test4/活动旗帜` 的 `{{活动旗帜}}` 模板参数
//    · 旧源（SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期）
//      两侧都降为**手动备选**（altSources / eventAltSources），解析器与回归全部保留
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
const ns_bwiki_wikitext_ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ns_bwiki_wikitext_ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
function ns_bwiki_wikitext_zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

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
function ns_bwiki_wikitext_smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_wikitext_smwText(v[0]);
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
function ns_bwiki_wikitext_parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: ns_bwiki_wikitext_smwText(p["标题"]) || page,
			time: ns_bwiki_wikitext_smwText(p["时间"]),
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
function ns_bwiki_wikitext_zspmsNormalize(wikitext) {
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
function ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
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
const ns_bwiki_wikitext__SP = "[ \\t]*";
const ns_bwiki_wikitext__CN_DATE = "(\\d{4})" + ns_bwiki_wikitext__SP + "年" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "月" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "日";
const ns_bwiki_wikitext__CN_TIME = "(\\d{1,2})" + ns_bwiki_wikitext__SP + "[:：]" + ns_bwiki_wikitext__SP + "(\\d{2})";
const ns_bwiki_wikitext__CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const ns_bwiki_wikitext__CN_WIN_SRC = ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + "|" + ns_bwiki_wikitext__CN_REL + ")?" + ns_bwiki_wikitext__SP + "[-–—－~～至到]" + ns_bwiki_wikitext__SP
	+ ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const ns_bwiki_wikitext__GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function ns_bwiki_wikitext_cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
function ns_bwiki_wikitext_zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: ns_bwiki_wikitext_cleanHead(m[2]) });
	});
	return out;
}
function ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !ns_bwiki_wikitext__GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const ns_bwiki_wikitext__ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function ns_bwiki_wikitext_zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function ns_bwiki_wikitext_zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
function ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = ns_bwiki_wikitext_zspmsNormalize(raw);
	const maint = ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = ns_bwiki_wikitext_zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(ns_bwiki_wikitext__CN_WIN_SRC, "g");
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
			const pools = ns_bwiki_wikitext_zspmsPools(line);
			const role = ns_bwiki_wikitext_zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = ns_bwiki_wikitext__ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const ns_bwiki_wikitext__ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
function ns_bwiki_wikitext_zspmsEventTier(x) { return ns_bwiki_wikitext__ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function ns_bwiki_wikitext_zspmsEventCmp(a, b) {
	return (ns_bwiki_wikitext_zspmsEventTier(a) - ns_bwiki_wikitext_zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
// ⚠️ 原先这里有个 zspmsHeader()：往悬停首行拼「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8
//    为推测；起点锚点=源站维护结束 …）」。按方案 A **整段删除**（元信息不进悬停，也不搬到别的字段）。
//    公告标题/SMW 时间/维护窗口仍是**数据字段**（announceTime / anchor / startFrom），解析逻辑不变。

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
async function ns_bwiki_wikitext_zspmsLatestNotice(url, signal) {
	const rows = ns_bwiki_wikitext_parseZspmsAsk(await fetchJson(url || ns_bwiki_wikitext_ZSPMS_ASK_URL, { referer: ns_bwiki_wikitext_ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(ns_bwiki_wikitext_zspmsParseUrl(row.page), signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	return { row, rows, wikitext };
}
async function ns_bwiki_wikitext_gachaZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	// `row`（ask 索引行）仍要传给解析器：`{{公告|时间=…}}` 缺失时用它兜底相对起点的锚点。
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
async function ns_bwiki_wikitext_eventsZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

//#region 战双：活动日历（结构化活动档期，2026-11-11 起为活动侧默认源）
// 为什么接：活动侧原先靠「版本更新公告」正文（要剥 `{{颜色引用}}`、靠标题栈取活动名），最新一版
// 《远信回响》的档期止于 2026-11-05 ⇒ 11-06 起活动列空窗。`Test4/活动日历` 与卡池侧的
// `Test4/活动旗帜` **同站、同写法**（都是一页数据模板），源站更新一行就多一条 ⇒ 比公告正文规整，
// 也不依赖标题层级。接它不等于"立刻有数据"（实测末条同样止于 2026/11/05），而是**源站一补档就自动恢复**。
//
// 页面实测（2026-11-11T00:58+08，夹具 `test/fixtures/p8-zspms-calendar`，HTTP 200 / 729B）：
//   <div class="newsOut" …><!--只允许显示8个活动-->
//      {{活动日历|「远信回响」主线|2026/09/24 11:00|2026/11/05 5:00}}
//      {{活动日历|「拟战场域」材料|2026/09/24 11:00|2026/11/05 5:00}}
//      … 共 10 行 …
//      {{活动日历|「新增涂装试玩」|2026/09/24 11:00|2026/11/05 5:00}}
//   </div>
// 模板定义（`Template:活动日历`）：位置参数 1=名称、2=开始时间、3=结束时间，另有同义具名参数
// （`名称` / `开始时间` / `结束时间`）⇒ 两种写法都吃。
// 口径：
//   · 活动名 = 参数 1 **原样**（`「远信回响」主线` 就是源站写法，不拆「」、不剥类别后缀）
//   · 起止 `YYYY/MM/DD H:MM`（**时位不补零**，如 `11/05 5:00`），tz = Asia/Shanghai（同文件头推测）
//   · raw = 两端原文（`~` 连接，与活动旗帜同约定）、display = fmtWindow（「两份文本」约定）
//   · 起止读不出 / 终点不晚于起点 ⇒ **跳过该行**（不硬造）；一条都解不出 ⇒ 抛错（模板改版 = 结构性损坏）
//   · 外显/悬停交给共用的 `eventPayload`：**两端都明确且覆盖 now** 才进外显（`coversNow` 唯一真源）
//     ⇒ 当前时刻（2026-11-11）全部已过期 ⇒ 如实返回 null（未公布），绝不把 11-05 收尾的档期当在期。
const ns_bwiki_wikitext_ZSPMS_CALENDAR_PAGE = "Test4/活动日历";
// ⚠️ 页名必须 encodeURIComponent 后再拼（`/` → `%2F`、中文 → %E…）
const ns_bwiki_wikitext_ZSPMS_CALENDAR_URL = "https://wiki.biligame.com/zspms/api.php?action=parse&page="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_CALENDAR_PAGE) + "&prop=wikitext&format=json&formatversion=2";

// 一页 wikitext → { items:[{ name, startTs, endTs, raw, display, _i }], skipped }
// 只认 `{{活动日历|…}}` 顶层调用（参数里没有花括号；与源站写法一致）。
function ns_bwiki_wikitext_parseZspmsCalendar(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const text = String(wikitext == null ? "" : wikitext);
	const items = [];
	let skipped = 0;
	const re = /\{\{活动日历\s*\|([^{}]*?)\}\}/g;
	let m;
	while ((m = re.exec(text))) {
		const pos = [], named = {};
		for (const piece of m[1].split("|")) {
			const seg = piece.trim();
			const kv = /^([^=]{1,8})\s*=\s*([\s\S]*)$/.exec(seg);
			if (kv && /^(名称|开始时间|结束时间)$/.test(kv[1].trim())) named[kv[1].trim()] = kv[2].trim();
			else pos.push(seg);
		}
		const name = named["名称"] || pos[0] || "";
		const startRaw = named["开始时间"] || pos[1] || "";
		const endRaw = named["结束时间"] || pos[2] || "";
		if (!name || !startRaw || !endRaw) { skipped++; continue; }
		const sp = ns_bwiki_parsePoints(startRaw)[0];
		const ep = ns_bwiki_parsePoints(endRaw)[0];
		if (!sp || !ep) { skipped++; continue; }
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, sp.h, sp.mi, tz);
		const endTs = sourceInstant(ep.y, ep.mo, ep.d, ep.h, ep.mi, tz);
		if (!(endTs > startTs)) { skipped++; continue; }                    // 源站错行 → 丢弃，不硬造
		items.push({
			name,
			startTs, endTs,
			raw: `${startRaw} ~ ${endRaw}`,
			display: fmtWindow(startTs, endTs, tz),
			_i: items.length
		});
	}
	if (items.length === 0) throw new Error("zspms-calendar:no-window");     // 模板改版/页面清空 = 结构性损坏
	return { items, skipped };
}

async function ns_bwiki_wikitext_eventsZspmsCalendar(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_ZSPMS_CALENDAR_URL, signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	const parsed = ns_bwiki_wikitext_parseZspmsCalendar(wikitext, tz);
	return ns_bwiki_wikitext_eventPayload(parsed.items, tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

//#region 战双：活动旗帜（结构化当期卡池，2026-11-10 起为卡池侧默认源）
// 为什么换：版本更新公告最新只到 2026-11-05（11-06 起卡池空窗），而 `Test4/活动旗帜` 是
// 结构化数据页、当期 70%UP 池到 11-12 ⇒ 更新更快、结构更稳。公告源保留为手动备选
// （卡池侧 altSources，见 `30-game-bwiki-register.js`）。
//   {{活动旗帜
//   |70%UP1=比安卡·晖暮   |70%UP2=七实·芒星之迹   |70%UP3=海伦汀·安魂
//   |70%UP开始时间=2026/10/29 07:00   |70%UP结束时间=2026/11/12 06:59
//   |100%UP1=阿德莱德·破渊   |100%UP2=时崎狂三·时崎狂三
//   |100%UP开始时间=2026/09/24 11:00   |100%UP结束时间=2026/11/05 05:00
//   <!-- 下面是移动端100%UP池参数--> …}}
// 口径（逐字照源站）：
//   · 池名 = 参数前缀原文 `70%UP` / `100%UP`（源站自己就这么分；不改写成「概率提升池」）
//   · 角色 = 前缀 + 序号 的参数（`70%UP1..3`），按序号排序、`、` 连接；**不删改**源站写法
//     （`时崎狂三·时崎狂三` 是 wiki 页面名本身就这么写，照抄不猜）
//   · 起止 `YYYY/MM/DD HH:MM`，tz = Asia/Shanghai（本源同一推测，见文件头）
//   · raw = 两端原文、display = fmtWindow（「两份文本」约定）
//   · `<!-- … -->` 之后是移动端参数（机体名/立绘…）⇒ 解析到注释就停
const ns_bwiki_wikitext_ZSPMS_FLAGS_PAGE = "Test4/活动旗帜";
// ⚠️ 页名必须 encodeURIComponent 后再拼（`/` → `%2F`、中文 → %E…）
const ns_bwiki_wikitext_ZSPMS_FLAGS_URL = "https://wiki.biligame.com/zspms/api.php?action=parse&page="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_FLAGS_PAGE) + "&prop=wikitext&format=json&formatversion=2";

// `{{活动旗帜 …}}` 的顶层参数 → { 键: 值 }（跳过空值；注释之后的移动端参数不进来）
function ns_bwiki_wikitext_zspmsFlagParams(wikitext) {
	const out = {};
	for (const line of String(wikitext == null ? "" : wikitext).split(/\r?\n/)) {
		if (/^\s*<!--/.test(line)) break;
		const m = /^\s*\|\s*([^=|\n{}]+?)\s*=\s*(.*?)\s*$/.exec(line);
		if (!m) continue;
		const k = m[1].trim(), v = m[2].trim();
		if (k && v) out[k] = v;
	}
	return out;
}

// `2026/10/29 07:00` → { y, mo, d, h, mi }；缺时刻 → null（旗帜页两端都到分）
function ns_bwiki_wikitext_zspmsFlagPoint(text) {
	const p = ns_bwiki_parsePoints(text)[0];
	if (!p || p.noTime) return null;
	return p;
}

// 活动旗帜 wikitext → [{ pool, roles, startTs, endTs, raw, display }]（源站顺序：70%UP 在前）
function ns_bwiki_wikitext_parseZspmsFlags(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const params = ns_bwiki_wikitext_zspmsFlagParams(wikitext);
	const prefixes = [];
	for (const k of Object.keys(params)) {
		if (!/开始时间$/.test(k)) continue;
		const prefix = k.slice(0, -"开始时间".length);
		if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
	}
	const out = [];
	for (const prefix of prefixes) {
		const roles = [];
		for (const k of Object.keys(params)) {
			if (k.length <= prefix.length || !k.startsWith(prefix)) continue;
			const idx = k.slice(prefix.length);
			if (!/^\d+$/.test(idx)) continue;
			roles.push({ idx: +idx, name: params[k] });
		}
		roles.sort((a, b) => a.idx - b.idx);
		const startRaw = params[prefix + "开始时间"], endRaw = params[prefix + "结束时间"];
		const sp = ns_bwiki_wikitext_zspmsFlagPoint(startRaw);
		const ep = ns_bwiki_wikitext_zspmsFlagPoint(endRaw);
		if (!sp || !ep || roles.length === 0) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, sp.h, sp.mi, tz);
		const endTs = sourceInstant(ep.y, ep.mo, ep.d, ep.h, ep.mi, tz)
		if (!(endTs > startTs)) continue;                                   // 源站错行 → 丢掉（不硬造）
		out.push({
			pool: prefix,
			roles: roles.map((r) => r.name).join("\u3001"),
			startTs, endTs,
			raw: `${startRaw} ~ ${endRaw}`,
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	if (out.length === 0) throw new Error("zspms-flags:no-pool");          // 模板被改版 = 结构性损坏
	return out;
}

async function ns_bwiki_wikitext_gachaZspmsFlags(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = nowMs()) {
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_ZSPMS_FLAGS_URL, signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	const items = ns_bwiki_wikitext_parseZspmsFlags(wikitext, tz).map((p, i) => ({
		banner: p.pool,
		roles: p.roles,
		startTs: p.startTs,
		endTs: p.endTs,
		raw: p.raw,
		display: p.display,
		isMain: true,
		_i: i
	}));
	// 同批合并角色的载荷：70%UP / 100%UP 各自一批（结束时刻不同 ⇒ 只合并同批）
	return ns_bwiki_batchGachaPayloadOf(items, tz, ns_bwiki_wikitext_nowOf(now), { id: "zspms" });
}
//#endregion
