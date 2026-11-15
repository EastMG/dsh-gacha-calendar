// src/client/30-game-bwiki-reso.js —— 雷索纳斯（国服）：官网首页内联 JSON
//
// ── 落点（2026-11-15 换源；文件名 `30-game-bwiki-reso.js` 是历史命名，别再被前缀误导）──────
// 唯一来源 `id:"reso"`，卡池侧与活动侧**同一条 URL**（官网首页），标签逐字「官网公告」。
// 2026-11-15 之前取的是 bwiki「活动日历」的 wikitext（社区维护、滚动日历、年份要另请求
// `api.php?action=query&prop=revisions` 补）。用户实测确认**官网首页自带结构化公告**之后换成本源：
// 文件里那套 wikitext 解析（`<small>mm.dd-mm.dd</small>` / 注释剥除 / revisions 补年）已整段删除。
//
// ── ① 站点形态（2026-11-15 实测，夹具 test/fixtures/reso-home）────────────────────────
//   `GET https://soli-reso.com/`
//     200 / `text/html; charset=utf-8` / **整页 7,451,933 B（UTF-8）/ 7,448,083 字符**
//     `Transfer-Encoding: chunked`（无 Content-Length）/ `Vary: Accept-Encoding` /
//     ⚠️ 响应**没有** `Access-Control-Allow-Origin`（带 `Origin: dsh-app://dsh` 实测也没有）
//        ⇒ 浏览器直连必被 CORS 拦 ⇒ **必须走宿主代理**（`soli-reso.com` 已登记 `PROXY_ALLOW_HOSTS`）。
//     ⚠️ **服务端忽略 `Range`**：带 `Range: bytes=0-131071` 实测仍回 **200 + 整页 7,451,933 B**
//        （2.5s），并不是 206。⇒ 省流量的唯一办法是"取到就缓存"，见 ④。
//   页面里是三段**双重转义**的内联 JSON（`var <名字>_json = JSON.parse("<内层 JSON 串>")`；
//   外层字面量里 `"` 是 `\u0022`、`<` `>` `&` `;` `=` `-` `'` 也是 `\uXXXX`、中文全是 `\uXXXX`、
//   内层反斜杠是 `\u005C`）⇒ **要 JSON.parse 两次**才拿到数组。三段的位置（字符偏移，实测）：
//     · `news_json`    @    54,918  —— 资讯（100 条），无起止时间，本文件**不用**
//     · `notice_json`  @ 2,880,537  —— **更新公告（100 条）**，卡池起止都写在 content 里 ⇒ **只要它**
//     · `actii_json`   @ 7,357,600  —— 活动（2 条），没有 `起止时间` ⇒ 本文件不用
//   ⚠️ 因此任务书里"JSON 在前 55KB / 抓头部 80~128KB 就够"只对 `news_json` 成立：
//      `notice_json` 在 **2.88MB** 处，头部 100KB 里根本没有它（夹具里第一个负例就是拿真头部去解析）。
//      服务端又不支持 Range ⇒ **只能整页取**（7.4MB / 实测 Node fetch 约 1.4s：头 1.0s + 体 0.4s，
//      gzip 线上传输、宿主代理解压后交给渲染进程的是 7,451,933 B，代理上限 8MB 仍然容得下）。
//   公告字段：`id / update_time / pub_date / title / title_img / content(HTML) / model_name`。
//   正文（`content`）是富文本 `<p>`，卡池段形如（notice 290，2025-12-23）：
//       ▌卡池相关
//       【专列招募】
//       起止时间：
//       12月22日更新后 - 1月12日 12:00
//       SSR “甜菜出动”时萝
//       获得概率提升
//       【常驻招募】
//       起止时间：
//       12月22日更新后 - 12月29日 12:00
//       SSR 苏恩
//   写法的实测变体（本文件全部吃下，夹具里各留一条）：
//       `12月22日更新后 - 1月12日 12:00`（跨年 + 「更新后」）
//       `12月02日更新后 - 12月15日 12:00`（日期带前导 0）
//       `11月26日更新后 - 12月17日 12:00`
//       `7月11日 12:00 - 7月18日 12:00`（起点带钟点）
//       `6月15日 更新后-7月15日 12:00`（「更新后」与分隔符之间无空格）
//       `5月23日 更新后 - 5月30日 12:00`
//       `2025年1月23日 12:00 - 2025年2月19日 12:00`（**两端显式 4 位年**，notice 200）
//   池名 = `【】` 里的招募类型（`专列招募` / `常驻招募` / `特设招募`，也可能带池名 `·` 后缀）；
//   角色 = 窗口之后那行 `SSR X` / `X 获得概率提升` 里的 X（去掉包裹的 `“候选池名”`）。
//
// ── ② 只认 `起止时间：` 这个锚（无锚的条目不产出，宁缺勿造）────────────────────────────
//   notice 正文里其它日期都不认（`「出地底记」` 这类活动名后面**没有**起止时间、`截止时间：` 是礼包
//   不是卡池）。规则：
//     · 锚点：包含 `起止时间：`（全/半角冒号都认）的行；区间可以在同一行，也可以在**下一行**；
//     · 名字：锚点之前**最近的 `【…】`**（最多回看 8 行；中间的行是池名/副标题，如
//       `求索万物之中 Seek Within Everything That Happens`）；
//     · 标签含 `招募/卡池/祈愿/跃迁/寻访` ⇒ **卡池**（`banner` = 标签原文）；
//     · 标签含 `活动` ⇒ **活动**（`event` = 标签与锚点之间的行，空则用标签）；
//     · 其它标签（`【新增内容】`/`【修复内容】`…）或没有标签 ⇒ **不产出**。
//   ⚠️ 实测当期（2026-11-15）100 条公告里带 `起止时间` 的 38 条**全是招募**（活动 0 条）
//      ⇒ 活动侧如实 `null`（不是失败）。以后官网在活动段写 `起止时间：` 就会自动出现。
//   ⚠️ 没有起止时间的公告（62/100）在解析阶段就丢掉：**不产出**，绝不拿"更新公告的发布日期"凑窗口。
//   ⚠️ 源站分隔符实测是 `-`（`更新后 - 1月12日`），`raw` 原样保留；给悬停 / `bannerDatesRaw` 的
//      `rawText` 把分隔符统一成 ` ~ `（与旧 reso 的 `10.22 ~ 11.18` 同一口径 —— 悬停方案 A 的
//      "源站原文"分支只认 `名称/档期` 且 `~` 是约定分隔符，见 `26-parser-hover.js`）。
//
// ── ③ 年份（**这一条是重点**；全部走共用工具）─────────────────────────────────────────
//   正文只写 `12月22日`，没有年份。年份线索 = **该条公告自己的日期**（`pub_date`，缺失退回
//   `update_time`；`YYYY-MM-DD`，源站墙钟）⇒ `{ y, mo }`：
//     ① 起点：`inferYear(null, 月, 线索)` —— 月份比线索月**晚 6 个月以上** ⇒ 上一年
//        （1 月公告里写 `12.28` 其实是去年）。共用常量 `YEAR_HINT_MONTH_GAP`。
//     ② 镜像：月份比线索月**早 6 个月以上** ⇒ 次年（12 月底公告写 `01.10` 是明年）。
//        这条只在**公告类**来源成立（公告不会倒着写去年 1 月），沿用上一版 reso 的判据。
//     ③ 终点：显式 4 位年优先；否则 `endsNextYear(起月, 起日, 终月, 终日)` ⇒ 跨年记次年
//        （`12月22日 - 1月12日` ⇒ 终点 2026-01-12）。
//     ④ **年份定不下来（没有线索、也没有显式年）⇒ 这一条不出**（不留错年份）。
//   时刻：起点显式钟点用显式；写「更新后」而没有钟点时按**当日 00:00**（源站没说时刻，不编）；
//         终点显式钟点用显式，没有钟点按 23:59（仓库通用约定）。
//
// ── ④ 请求预算 / 缓存 ──────────────────────────────────────────────────────────────
//   **整页 7.4MB 只取一次**：解析结果（窗口条目）按 URL 缓存 **24h**（`ns_reso_CACHE_TTL_MS`），
//   快照记下 `id`（最新公告 id，便于排查"这份缓存是哪一期"）。两侧同一条 URL ⇒ **同一轮里共用同一个
//   promise**（`fetchRoundSeqOf`，同 hl / cytq / tof 那套），首轮两侧加起来仍是 **1 次**请求；
//   稳态（24h 内）**0 次**。⚠️ 若服务端以后支持 Range / 页面缩小，只需改这里。
//
// ── ⑤ 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 正文是空串 ⇒ 抛 `reso-home-changed:empty`；
//   · 找不到 `var notice_json = JSON.parse(...)`（改版 / 拿头部 100KB / 空页）⇒ 抛
//     `reso-home-changed:no-notice-json`；
//   · 外层或内层 `JSON.parse` 失败、或内层不是数组 ⇒ 抛 `reso-home-changed:bad-notice-json`；
//   · 公告数组为空、或一条带 `起止时间` 的都没有 ⇒ `null`（当期没有，不是失败）；
//   · 解出窗口但没有覆盖 now 的 ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑥ 当期现状（2026-11-15 07:49 +08 实测；夹具 = 同日真抓）─────────────────────────
//   官网 `notice_json` **最新一条停在 2025-12-23**（id 290），窗口
//     `专列招募` 时萝 `2025-12-22 00:00 ~ 2026-01-12 12:00`
//     `常驻招募` 苏恩 `2025-12-22 00:00 ~ 2025-12-29 12:00`
//   —— 相对本次抓取时刻都已结束 ⇒ 卡池侧如实 `null`、活动侧 `null`（源站 11 个月没发新更新公告；
//   这不是解析失败，判据见 `cases-new5.mjs` 的 e2e：把 now 钉到 2025-12-25 就逐字出这两口池）。
//   时区 = `Asia/Shanghai`（国服官网墙钟）。

//#region ① 常量
const ns_reso_TZ = "Asia/Shanghai";
const ns_reso_HOME = "https://soli-reso.com/";
// 卡池与活动同一条 URL（首页）
const ns_reso_URL = ns_reso_HOME;
const ns_reso_REFERER = ns_reso_HOME;
const ns_reso_SOURCE_LABEL = "官网公告";
// 解析结果按 URL 缓存 24h（整页 7.4MB，服务端不支持 Range ⇒ 只能整页取一次）
const ns_reso_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内共享兜底上限（同 hl / cytq / tof 的 30s）
const ns_reso_ROUND_TTL_MS = 30000;
// 内联公告：`var notice_json = JSON.parse("<双重转义的内层 JSON>")`（外层字面量里没有裸引号）
const ns_reso_NOTICE_VAR_RE = /var\s+notice_json\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/;
// 公告自己的日期（`pub_date` / `update_time`，`YYYY-MM-DD`）
const ns_reso_DATE_RE = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/;
// 正文里的名字标签 `【专列招募】`
const ns_reso_TAG_RE = /【([^】]{1,30})】/;
// 唯一的时间锚：`起止时间：`（全/半角冒号）
const ns_reso_TIME_LABEL_RE = /起止时间\s*[：:]/;
// 区间：`[YYYY年]M月D日[更新后][H:MM] - [YYYY年]M月D日[H:MM]`（实测变体见文件头 ①）
const ns_reso_WINDOW_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(?:更新|维护)\s*后)?\s*(?:(\d{1,2})\s*[:：]\s*(\d{2}))?\s*[-~～—–至]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2}))?/;
// 标签分类（卡池 / 活动 / 其它一律不产出）
const ns_reso_GACHA_TAG_RE = /招募|卡池|祈愿|跃迁|寻访/;
const ns_reso_EVENT_TAG_RE = /活动/;
// 锚点之前最多回看几行找 `【…】`（实测 1~2 行；池名/副标题可能占一行）
const ns_reso_TAG_BACK_LINES = 8;
// 窗口之后最多看几行找角色行（实测 1~2 行：中间可能隔 `招募说明：以下乘员获得概率提升`）
const ns_reso_ROLE_LINES = 4;
//#endregion

//#region ② 纯解析：首页 HTML → 公告数组
// 首页 → `notice_json` 数组（**两次 JSON.parse**，外层是 JS 字符串字面量、内层才是 JSON）。
// 结构变了要抛（见文件头 ⑤）：空串 / 没有 `var notice_json = JSON.parse(...)` / 解析失败 / 不是数组。
function ns_reso_noticesOf(html) {
	const src = String(html == null ? "" : html);
	if (src.trim() === "") throw new Error("reso-home-changed:empty");
	const m = ns_reso_NOTICE_VAR_RE.exec(src);
	if (!m) throw new Error("reso-home-changed:no-notice-json");
	let inner, notices;
	try {
		inner = JSON.parse(m[1]);                    // 第 1 次：JS 字符串字面量 → 内层 JSON 文本
	} catch {
		throw new Error("reso-home-changed:bad-notice-json");
	}
	try {
		notices = JSON.parse(inner);                 // 第 2 次：内层 JSON 文本 → 数组
	} catch {
		throw new Error("reso-home-changed:bad-notice-json");
	}
	if (!Array.isArray(notices)) throw new Error("reso-home-changed:bad-notice-json");
	return notices.filter((x) => x && typeof x === "object");
}
// 最新公告 id（只用于缓存快照标记 / 排查；取不到 ⇒ 0）
function ns_reso_newestIdOf(notices) {
	let id = 0;
	for (const n of Array.isArray(notices) ? notices : []) {
		const v = Number(n && n.id);
		if (Number.isFinite(v) && v > id) id = v;
	}
	return id;
}
// 公告日期 → 年份线索 `{ y, mo }`（`pub_date` 优先、缺失退回 `update_time`；没有 ⇒ null）
function ns_reso_yearHintOf(notice) {
	const n = notice && typeof notice === "object" ? notice : {};
	const s = String(n.pub_date || n.update_time || "");
	const m = ns_reso_DATE_RE.exec(s);
	if (!m) return null;
	const y = +m[1], mo = +m[2];
	if (!(y > 0) || !(mo >= 1 && mo <= 12)) return null;
	return { y, mo };
}
// 公告正文 → 行数组（只把**块级**结束标签 / `<br>` 当行边界；`span`/`strong` 是行内的，不能断行
// —— 实测 `【特设招募 &middot;净灭八苦】` 就被 `<span>` 切成两行过）
function ns_reso_linesOf(content) {
	const html = String(content == null ? "" : content)
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|section)>/gi, "\n");
	return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// 一行（或下一行）→ 窗口事实。返回的 `sy` / `ey` 只在源站**显式**写年份时非空。
function ns_reso_windowOf(text) {
	const m = ns_reso_WINDOW_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	const v = (x) => (x == null || x === "" ? null : +x);
	// `raw` = 源站原文（`-` 原样）；`rawText` = 悬停/`bannerDatesRaw` 用的版本：
	// 分隔符统一成 ` ~ `（与旧 reso 的 `10.22 ~ 11.18` 同一口径；悬停方案 A 只认 `名称/档期`，
	// 档期原文里的 `-` 会被约定的「原文兜底」判成不合法，见 `26-parser-hover.js` 的 raw 分支）。
	const rawSource = m[0].replace(/\s+/g, " ").trim();
	const out = {
		sy: v(m[1]), sm: +m[2], sd: +m[3], sh: v(m[4]), smi: m[5] == null ? null : +m[5],
		ey: v(m[6]), em: +m[7], ed: +m[8], eh: v(m[9]), emi: m[10] == null ? null : +m[10],
		raw: rawSource,
		rawText: rawSource.replace(/\s*[-~～—–至]\s*/, " ~ ")
	};
	if (out.sm < 1 || out.sm > 12 || out.em < 1 || out.em > 12) return null;
	if (out.sd < 1 || out.sd > 31 || out.ed < 1 || out.ed > 31) return null;
	return out;
}
// 起点年份：显式年优先；否则「公告年 + 共用 inferYear + 跨年镜像」（见文件头 ③）。
// **线索拿不到 ⇒ null（这一条不产出）**。
function ns_reso_startYearOf(month, hint, explicit) {
	if (explicit != null) return Number.isFinite(explicit) ? explicit : null;
	if (!Number.isFinite(month)) return null;
	if (!hint || !Number.isFinite(hint.y) || !Number.isFinite(hint.mo)) return null;
	const y = inferYear(null, month, hint);
	if (y == null || !Number.isFinite(y)) return null;
	return month < hint.mo - YEAR_HINT_MONTH_GAP ? y + 1 : y;
}
// 锚点之前最近的 `【…】`：返回 `{ tag, at }`（`at` = 标签所在行号）；8 行内没有 ⇒ null
function ns_reso_tagOf(lines, at) {
	for (let j = at; j >= 0 && j >= at - ns_reso_TAG_BACK_LINES; j--) {
		const m = ns_reso_TAG_RE.exec(lines[j]);
		if (m) return { tag: m[1].replace(/\s+/g, " ").replace(/\s*·\s*/g, "·").trim(), at: j };
	}
	return null;
}
// 窗口之后的角色行 → 角色名（`SSR “池名”角色` / `角色 获得概率提升`）；取不到 ⇒ ""
function ns_reso_roleOf(lines, at) {
	for (let j = at + 1; j < lines.length && j <= at + ns_reso_ROLE_LINES; j++) {
		const line = lines[j];
		if (!line || ns_reso_TIME_LABEL_RE.test(line)) continue;
		if (ns_reso_WINDOW_RE.test(line)) continue;
		if (ns_reso_TAG_RE.test(line) || /▌/.test(line)) break;   // 到下一条了
		let role = "";
		const m = /SSR\s*(.+)$/.exec(line);
		if (m) role = m[1];
		else if (/获得概率提升/.test(line) && !/招募说明|以下乘员/.test(line)) role = line;
		if (!role) continue;
		role = role.replace(/获得概率提升/g, "").replace(/\s+/g, " ").replace(/\s*·\s*/g, "·").trim();
		// 去掉包裹池名的 `“…”`（如 `“甜菜出动”时萝` ⇒ `时萝`）；整体就是引号名时原样保留
		const stripped = role.replace(/^[“"][^”"]{1,30}[”"]\s*/, "").trim();
		return (stripped || role).trim();
	}
	return "";
}
// 公告数组 → 窗口条目事实（卡池 + 活动一起；`kind` 区分）。
// 一条公告里可以有多组；没有锚点 / 没有可识别标签 / 年份定不下来 / 起止倒挂 ⇒ 该条不产出。
function ns_reso_rowsOf(notices, tz = ns_reso_TZ) {
	const out = [];
	const seen = new Set();
	for (const notice of Array.isArray(notices) ? notices : []) {
		const hint = ns_reso_yearHintOf(notice);
		const lines = ns_reso_linesOf(notice && notice.content);
		for (let i = 0; i < lines.length; i++) {
			if (!ns_reso_TIME_LABEL_RE.test(lines[i])) continue;
			// 区间可能跟锚点同一行（`起止时间： 5月23日 …`），也可能在下一行
			let win = ns_reso_windowOf(lines[i].replace(/^.*?起止时间\s*[：:]/, ""));
			if (!win && i + 1 < lines.length) win = ns_reso_windowOf(lines[i + 1]);
			if (!win) continue;
			const tagInfo = ns_reso_tagOf(lines, i);
			if (!tagInfo) continue;                                   // 没有标签 ⇒ 宁缺勿造
			const isGacha = ns_reso_GACHA_TAG_RE.test(tagInfo.tag);
			const isEvent = !isGacha && ns_reso_EVENT_TAG_RE.test(tagInfo.tag);
			if (!isGacha && !isEvent) continue;                       // 【新增内容】之类：不产出
			const startY = ns_reso_startYearOf(win.sm, hint, win.sy);
			if (startY == null) continue;                             // 没有年份 ⇒ 这一条不出
			const endY = win.ey != null
				? win.ey
				: (endsNextYear(win.sm, win.sd, win.em, win.ed) ? startY + 1 : startY);
			const startTs = sourceInstant(startY, win.sm, win.sd, win.sh == null ? 0 : win.sh, win.smi == null ? 0 : win.smi, tz);
			const endTs = sourceInstant(endY, win.em, win.ed, win.eh == null ? 23 : win.eh, win.emi == null ? 59 : win.emi, tz);
			if (startTs == null || endTs == null || !(endTs > startTs)) continue;
			const row = {
				kind: isGacha ? "gacha" : "event",
				startTs,
				endTs,
				raw: win.raw,
				rawText: win.rawText,
				display: fmtWindow(startTs, endTs, tz),
				noticeId: notice && notice.id != null ? String(notice.id) : "",
				noticeDate: String((notice && (notice.pub_date || notice.update_time)) || "")
			};
			if (isGacha) {
				row.banner = tagInfo.tag;
				row.roles = ns_reso_roleOf(lines, i);
			} else {
				row.event = lines.slice(tagInfo.at + 1, i).join(" ").trim() || tagInfo.tag;
			}
			const key = [row.kind, row.banner, row.roles, row.event, row.startTs, row.endTs].join("|");
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(row);
		}
	}
	return out;
}
// 窗口事实 → 载荷用的条目（`side` = "gacha" | "event"；与 bwiki 系条目同形，直接喂共用载荷生成器）
function ns_reso_itemsOf(rows, side) {
	const out = [];
	for (const r of Array.isArray(rows) ? rows : []) {
		if (!r || r.kind !== side) continue;
		const item = {
			_i: out.length,
			startTs: r.startTs,
			endTs: r.endTs,
			raw: r.rawText || r.raw,
			display: r.display
		};
		if (side === "gacha") {
			item.banner = r.banner;
			item.roles = r.roles || "";
			item.isMain = true;
		} else {
			item.event = r.event;
			item.category = "";
		}
		out.push(item);
	}
	return out;
}
//#endregion

//#region ③ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_reso_dataCache = null;                 // { url, at, id, rows }（24h 快照）
let ns_reso_pageCache = null;                 // { url, round, at, promise }（轮内共享）
function ns_reso_resetCache() { ns_reso_dataCache = null; ns_reso_pageCache = null; }
// 首页 → 窗口条目（24h 缓存；两侧同一条 URL ⇒ 轮内共享同一个 promise，见文件头 ④）
async function ns_reso_dataOf(url, signal, tz, now) {
	const key = String(url == null ? "" : url).trim() || ns_reso_URL;
	const at = ns_bwiki_nowOf(now);
	const data = ns_reso_dataCache;
	if (data && data.url === key && at - data.at < ns_reso_CACHE_TTL_MS) return data;
	const round = fetchRoundSeqOf();
	const hit = ns_reso_pageCache;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_reso_ROUND_TTL_MS) {
		return hit.promise;
	}
	const promise = (async () => {
		const html = await fetchText(key, { mode: "proxy", referer: ns_reso_REFERER, signal });
		const notices = ns_reso_noticesOf(html);
		const value = { url: key, at, id: ns_reso_newestIdOf(notices), rows: ns_reso_rowsOf(notices, tz) };
		ns_reso_dataCache = value;
		return value;
	})();
	ns_reso_pageCache = { url: key, round, at, promise };
	promise.catch(() => { if (ns_reso_pageCache && ns_reso_pageCache.promise === promise) ns_reso_pageCache = null; });
	return promise;
}
// 卡池侧：`起止时间` 里的招募窗口 → 共用卡池载荷（没有覆盖 now 的 ⇒ null）
async function ns_reso_gacha(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const data = await ns_reso_dataOf(url, signal, tz, at);
	const items = ns_reso_itemsOf(data.rows, "gacha");
	if (items.length === 0) return null;          // 一条招募窗口都没有 ⇒ 未公布（不是失败）
	return ns_bwiki_wikitext_gachaPayload(items, tz, at, {});
}
// 活动侧：`起止时间` 里的活动窗口 → 共用活动载荷（当前公告里 0 条 ⇒ 如实 null）
async function ns_reso_events(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const data = await ns_reso_dataOf(url, signal, tz, at);
	const items = ns_reso_itemsOf(data.rows, "event");
	if (items.length === 0) return null;
	return ns_bwiki_wikitext_eventPayload(items, tz, at, { nameOf: (x) => x.event });
}
//#endregion

//#region ④ 条目登记
// 卡池与活动同一条 URL（官网首页，内联 JSON 同一份）；两侧标签逐字「官网公告」。
registerSource({
	id: "reso",
	defaultHidden: false,
	tz: ns_reso_TZ,
	name: "雷索纳斯",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/67/10/a4/6710a4b4-3b57-eb6a-df7a-7a143826aec4/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
	url: ns_reso_URL,
	source: ns_reso_SOURCE_LABEL,
	eventUrl: ns_reso_URL,
	eventSource: ns_reso_SOURCE_LABEL
});
GACHA_FETCHERS["reso"] = (url, signal, tz, now) => ns_reso_gacha(url, signal, tz, now);
EVENT_FETCHERS["reso"] = Object.assign(EVENT_FETCHERS["reso"] || {}, {
	default: (url, signal, tz, now) => ns_reso_events(url, signal, tz, now)
});
//#endregion
