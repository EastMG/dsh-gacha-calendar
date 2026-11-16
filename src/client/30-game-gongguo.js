// src/client/30-game-gongguo.js —— 上海弓谷：雷索纳斯（reso，国服）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-bwiki-reso.js 整体迁入（自包含：条目 + 解析 + 抓取 + 登记）。
// 源：卡池主源 = bwiki「活动日历」wikitext（`action=raw` + `revisions` 只补年份）；活动侧默认置空，
//   备选 = bwiki 活动档（停更）/ 官网首页内联 `notice_json`。
// 复用关系：bwiki 公共层（载荷生成器 / 悬停）；符号名 `ns_bwiki_*` 不变。
// 请求预算：每轮 2 次（同一 URL，轮内共享）。

//
// ── 落点（2026-11-15 三次调整：卡池主源留 bwiki；活动侧默认置空、原 bwiki 活动源降为备选）────────
// 唯一来源 `id:"reso"`。
// · **卡池侧**（不动，2026-11-15 二次换源的结论）：主源 = bwiki「活动日历」页的 wikitext
//   （`action=raw` + `revisions` 只补年份），标签逐字「Bwiki 活动日历」。
// · **活动侧默认置空**（用户 2026-11-15 晚口径）：`eventUrl: ""` + 不写 `eventSource`
//   ⇒ 设置页/面板显示裸「未配置」、一个请求都不发。原「Bwiki 活动日历」降为**备选源**
//   （`eventAltSources`，抓取器键 `reso-activity-stopped`），标签逐字「Bwiki 活动日历（停更）」
//   —— 实测该页**活动数据自 2024-10-08 后就没有了**（属停更，不是解析失败；夹具里活动侧本来就 0 行）。
// · **另一条备选**（`altSources` / `eventAltSources` 都有）= 官网首页 `https://soli-reso.com/`
//   的内联 `notice_json`，抓取器键 `reso-official`，标签逐字「官网公告（停更）」
//   （官方公告最后更新 2025-12-23，用户 2026-11-15 要求标「（停更）」）；只有用户在设置页
//   手动切过去时才会请求它（7.4MB 整页 + 24h 缓存，见 ⑤）。
//
// ── ① 为什么换回 bwiki（2026-11-15 实测证据，别再来回换）────────────────────────────
//   · 官网 `soli-reso.com` 的 `notice_json` **最新一条停在 2025-12-23**（id 290）⇒ 已停更 11 个月，
//     2026-11-15 两侧都是 null（不是解析失败，是源站真的没新公告）；
//   · 社区 bwiki「活动日历」页**仍在更新**：`revisions` 显示最后编辑 2026-10-26 13:11:13Z，
//     活行 8 条招募里**当期有 2 口**（见 ⑥）⇒ 它才是"当期的可靠来源"。
//   ⇒ 卡池主源 = bwiki（社区站，但仍是人工维护的滚动日历）；活动侧 2026-11-15 晚按用户口径
//     **默认置空**（该页活动数据自 2024-10-08 后就没有了 ⇒ 降为备选源「Bwiki 活动日历（停更）」）；
//     官网内联 JSON 保留为另一条备选源（解析代码全留）。
//
// ── ② 主源页面形态（夹具 test/fixtures/reso-calendar-raw / reso-revision）───────────────
//   `GET https://wiki.biligame.com/resonance/index.php?title=活动日历&action=raw`
//     ⚠️ **必须带 `Referer: https://wiki.biligame.com/`**（否则 EdgeOne WAF 回 **567** 挑战页）；
//        响应**没有 ACAO**（实测）⇒ 必须走宿主代理（域名已在 `PROXY_ALLOW_HOSTS`）。
//     200 / 3,096 B / `content-type: text/x-wiki` / `last-modified: Mon, 26 Oct 2026 13:11:13 GMT`
//   页面 = `<center>{{活动日历| …模板日历… <hr> 活行… }}</center>`：
//     · `<hr>` **之后**的若干行才是当期档期，一行一条：
//         `【联运招募】[[文件:朱月-头像.png|25px|link=朱月]][[朱月]] <small>10.22-11.18 </small><br>`
//         `【专列招募】[[文件:切茜娅-头像.png|25px|link=切茜娅]][[切茜娅]] <small>10.23-11.06 </small><br>`
//         ⇒ 形状 = `【类型】角色名 <small>月.日-月.日</small>`
//     · 活动（非招募）的写法在页面**自己的注释**里给了样板：
//         `[[红茶战争|「红茶战争」]]<small>03.21-04.10</small>`（`页面|「活动名」` + 日期）
//       ⇒ 没有 `【】` 前缀、但有链接 + `<small>月.日-月.日</small>` 的行按**活动**解析。
//     · ⚠️ 页头还有一条**条件模板**行：`{{#ifexpr:…<20230901|…[[限界挑战]]…<small>08.01-08.31</small>…}}`
//       （2023 年的死分支）。它必然含 `{{`/`}}`/`<font`，所以行过滤先把它整行跳过。
//     · ⚠️ 页面里还有两段 `<!-- … -->` 注释（`红茶战争` / `澄明异闻奇谈` + 一条 `雅莱`），里面也有
//       `<small>mm.dd-mm.dd</small>` ⇒ **先剥注释再按行扫**，否则已下架的旧档期会被当成当期。
//   实测当期（2026-11-15）活行 8 条，全是招募：联运招募 朱月 10.22-11.18 / 特设招募 蓝鹊儿 10.26-11.16 /
//   特设招募 伊卡菈 10.16-11.06 / 特设招募 亚莉奈·危情 10.02-10.28 / 专列招募 切茜娅 10.23-11.06 /
//   专列招募 奥莉薇恩 10.19-11.02 / 专列招募 帕拉笛 10.14-10.28 / 常驻招募·轮换UP 伊索斯 10.23-11.06。
//   ⇒ **活动行当前 0 条**（活动侧如实 `null` = 当期没有；页面以后按自己的写法补上活动行就会自动出现）。
//
// ── ③ 主源年份怎么补（**这一条是主源的重点**）──────────────────────────────────────────
// 行里的日期只有 `月.日-月.日`，**没有年份**。年份只能从"页面最后编辑时刻"这一份事实里拿：
//   `GET https://wiki.biligame.com/resonance/api.php?action=query&prop=revisions&titles=活动日历`
//       `&rvprop=timestamp%7Cids&rvlimit=1&format=json&formatversion=2`
//     → `{ query: { pages: [ { revisions: [ { timestamp: "2026-10-26T13:11:13Z" } ] } ] } }`
//   ⇒ 换成源站墙钟（`sourceWallParts`）得到 `{ y: 2026, mo: 10 }`，作为 `inferYear` 的线索。
//   ⚠️ **为什么不用"抓取那天的年份"**：滚动日历页在年末会写下一季的档期（12-20 更新的页面里可能有
//      `01.10-01.24`）。用抓取年份会把它们放到**同年的 1 月**（11 个月前，永不可见）；
//      用页面更新年份 + 下面的两条规则才是对的。
//   补年规则（**全部走共用工具，不自己写第二份**）：
//     ① `inferYear(null, 月, 线索)` —— 月份比线索月**晚 6 个月以上** ⇒ 其实是**上一年**
//        （例：页面 1 月更新，行里写 `12.28-01.05` ⇒ 起点是去年 12-28）；共用常量 `YEAR_HINT_MONTH_GAP`。
//     ② 镜像：月份比线索月**早 6 个月以上** ⇒ 其实是**次年**（页面 12 月更新、行里写 `01.10`）。
//        这条对"滚动日历"才成立（公告类来源不会写未来日期），所以只在本文件里做，且只借共用常量。
//     ③ 终点：`endsNextYear(起月, 起日, 终月, 终日)` ⇒ 终点排在起点之前 = 跨年，终点记次年。
//     ④ **年份拿不到就一条都不出**（`startYear == null` ⇒ 跳过该行）：宁可这一条不显示，
//        也不留一个错年份（错年份比"未公布"更糟）。
//   ⚠️ revision 请求失败 / 结构变了 ⇒ **抛**（`reso-rev-changed:*`）。理由：没有它就没有年份，
//      这一侧一个字都产不出来；把"拿不到年份"静默成"未公布"就是撒谎。
//   时刻：只有日期 ⇒ 起 00:00、止 23:59（仓库通用约定）。
//
// ── ④ 主源请求预算 / 缓存 ─────────────────────────────────────────────────────────
//   **每轮 2 次**（raw + revision）。卡池/活动两侧**同一条 URL、同一份正文** ⇒ 轮内共享同一个 Promise
//   （`fetchRoundSeqOf` + 缓存，与 `30-game-hl.js` / `30-game-cytq.js` 同一套）⇒ 两侧加起来还是 2 次。
//
// ── ⑤ 备选源：官网首页内联 JSON（只在用户选中时才抓）──────────────────────────────────
//   `GET https://soli-reso.com/`（`ns_reso_HOME`；夹具 test/fixtures/reso-home）
//     200 / `text/html; charset=utf-8` / **整页 7,451,933 B（UTF-8）** / `Transfer-Encoding: chunked` /
//     ⚠️ 响应**没有** `Access-Control-Allow-Origin`（带 `Origin: dsh-app://dsh` 实测也没有）
//        ⇒ 浏览器直连必被 CORS 拦 ⇒ 必须走宿主代理（`soli-reso.com` 已登记 `PROXY_ALLOW_HOSTS`）。
//     ⚠️ **服务端忽略 `Range`**：带 `Range: bytes=0-131071` 实测仍回 **200 + 整页 7,451,933 B**
//        ⇒ 省流量的唯一办法是"取到就缓存"：解析结果按 URL 缓存 **24h**（`ns_reso_HOME_CACHE_TTL_MS`），
//        轮内再共享一个 promise（同 30s 兜底）⇒ 稳态 0 次请求。
//   页面里是三段**双重转义**的内联 JSON（`var <名字>_json = JSON.parse("<内层 JSON 串>")`；
//   外层字面量里 `"` 是 `\u0022`、中文全是 `\uXXXX`、内层反斜杠是 `\u005C`）⇒ **要 JSON.parse 两次**。
//   三段的位置（字符偏移，实测）：`news_json` @54,918（不用）/ `notice_json` @2,880,537（**只要它**）/
//   `actii_json` @7,357,600（不用）。
//   ⚠️ 因此"只抓头部 100KB"不成立：`notice_json` 在 **2.88MB** 处，服务端又不支持 Range ⇒ **只能整页取**。
//   公告字段：`id / update_time / pub_date / title / title_img / content(HTML) / model_name`。
//   正文（`content`）是富文本 `<p>`，卡池段形如（notice 290，2025-12-23）：
//       ▌卡池相关
//       【专列招募】
//       起止时间：
//       12月22日更新后 - 1月12日 12:00
//       SSR “甜菜出动”时萝
//       获得概率提升
//   写法的实测变体（官网备选源全部吃下，夹具里各留一条）：
//       `12月22日更新后 - 1月12日 12:00`（跨年 + 「更新后」）/ `12月02日更新后 - 12月15日 12:00`（前导 0）
//       `11月26日更新后 - 12月17日 12:00` / `7月11日 12:00 - 7月18日 12:00`（起点带钟点）
//       `6月15日 更新后-7月15日 12:00`（「更新后」与分隔符之间无空格）/ `5月23日 更新后 - 5月30日 12:00`
//       `2025年1月23日 12:00 - 2025年2月19日 12:00`（**两端显式 4 位年**，notice 200）
//   官网只认 `起止时间：` 这个锚（无锚的条目不产出）；池名 = `【】` 里的招募类型；角色 = 窗口之后那行
//   `SSR X` / `X 获得概率提升` 里的 X（去掉包裹的 `“候选池名”`）。年份：`pub_date`/`update_time`
//   当线索（`inferYear` + 跨年镜像），显式 4 位年优先，定不下来就这一条不出。
//   实测（2026-11-15）100 条公告里带 `起止时间` 的 38 条**全是招募**（活动 0 条）⇒ 官网备选活动侧也是 null。
//
// ── ⑥ 当期现状（2026-11-15 16:xx +08 实测；夹具 = 同日真抓，与活网逐字节相同）────────────
//   · 主源 bwiki：活行 8 条，在期 2 口 —— `特设招募`（蓝鹊儿）10-26 00:00 ~ 11-16 23:59、
//     `联运招募`（朱月）10-22 00:00 ~ 11-18 23:59 ⇒ 外显 = 结束最早那口（特设招募：蓝鹊儿），悬停两行；
//     活动侧 0 行 ⇒ `null`（当期没有，不是失败）。
//   · 备选源官网：最新公告 2025-12-23 的窗口早已结束 ⇒ 切过去时两侧如实 null（源站停更，见 ①）。
//   时区 = `Asia/Shanghai`（国服 wiki / 官网墙钟）。

//#region ① 常量
const ns_reso_TZ = "Asia/Shanghai";

// —— 主源：bwiki「活动日历」 ——
const ns_reso_REFERER = "https://wiki.biligame.com/";
const ns_reso_PAGE = "活动日历";
// 正文（wikitext，`action=raw` 直出）
const ns_reso_RAW_URL = "https://wiki.biligame.com/resonance/index.php?title=" + ns_reso_PAGE + "&action=raw";
// 页面最后编辑时刻（只用来补年份；见文件头 ③）。
// ⚠️ 这一条**永远**打「活动日历」这一页：正文 URL 允许在设置页被改成别的地址，但年份只能从这一页拿
//    （换成别的页名 ⇒ 年份可能对不上，属"用户自定义地址"的已知边界，与其它源的同类边界一致）。
const ns_reso_REV_URL = "https://wiki.biligame.com/resonance/api.php?action=query&prop=revisions&titles="
	+ ns_reso_PAGE + "&rvprop=timestamp%7Cids&rvlimit=1&format=json&formatversion=2";
const ns_reso_SOURCE_LABEL = "Bwiki 活动日历";

// —— 备选源：官网首页内联 JSON（见文件头 ⑤；只在用户手动切过去时抓） ——
const ns_reso_HOME = "https://soli-reso.com/";
const ns_reso_HOME_REFERER = ns_reso_HOME;
// 备选源标签逐字「官网公告（停更）」：官方公告停在 2025-12-23（用户要求标停更）；
// 也不加语言后缀（后缀只给外语源，见全仓标签口径）。主源/备选靠来源名与备选列表位置区分。
const ns_reso_ALT_SOURCE_LABEL = "官网公告（停更）";
const ns_reso_ALT_FETCHER = "reso-official";
// —— 活动侧备选源：原 bwiki「活动日历」降为手动备选（2026-11-15 晚用户口径）——
// 实测该页活动数据自 2024-10-08 后就没有了 ⇒ 属**停更**（不是解析失败）；卡池侧仍以它为主源，不动。
// 抓取器键直接别名到上面的主源活动抓取器（同一份解析代码，不另造实现）。
const ns_reso_EVENT_ALT_SOURCE_LABEL = "Bwiki 活动日历（停更）";
const ns_reso_EVENT_ALT_FETCHER = "reso-activity-stopped";
// 官网整页 7.4MB（服务端不支持 Range）⇒ 解析结果按 URL 缓存 24h
const ns_reso_HOME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 轮内共享的兜底上限（同 hl / cytq / tof 的 30s）—— 主源与备选源各一份
const ns_reso_ROUND_TTL_MS = 30000;

// —— 主源解析用 ——
// 日期：`<small>10.22-11.18 </small>`（月.日 两端都无年份；分隔符实测有 `-`）
const ns_reso_ROW_RE = /<small>\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*[-~～]\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*<\/small>/;
// 招募行的类型标记 `【联运招募】` / `【特设招募】` / `【常驻招募·轮换UP】`
const ns_reso_TAG_RE = /【([^】]{1,20})】/;
// wikitext 链接 `[[目标]]` / `[[目标|显示]]`
const ns_reso_LINK_RE = /\[\[([^\[\]]{1,120})\]\]/g;

// —— 备选源（官网内联 JSON）解析用 ——
// 内联公告：`var notice_json = JSON.parse("<双重转义的内层 JSON>")`（外层字面量里没有裸引号）
const ns_reso_HOME_NOTICE_VAR_RE = /var\s+notice_json\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/;
// 公告自己的日期（`pub_date` / `update_time`，`YYYY-MM-DD`）
const ns_reso_HOME_DATE_RE = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/;
// 正文里的名字标签 `【专列招募】`
const ns_reso_HOME_TAG_RE = /【([^】]{1,30})】/;
// 唯一的时间锚：`起止时间：`（全/半角冒号）
const ns_reso_HOME_TIME_LABEL_RE = /起止时间\s*[：:]/;
// 区间：`[YYYY年]M月D日[更新后][H:MM] - [YYYY年]M月D日[H:MM]`（实测变体见文件头 ⑤）
const ns_reso_HOME_WINDOW_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(?:更新|维护)\s*后)?\s*(?:(\d{1,2})\s*[:：]\s*(\d{2}))?\s*[-~～—–至]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2}))?/;
// 标签分类（卡池 / 活动 / 其它一律不产出）
const ns_reso_HOME_GACHA_TAG_RE = /招募|卡池|祈愿|跃迁|寻访/;
const ns_reso_HOME_EVENT_TAG_RE = /活动/;
// 锚点之前最多回看几行找 `【…】`（实测 1~2 行；池名/副标题可能占一行）
const ns_reso_HOME_TAG_BACK_LINES = 8;
// 窗口之后最多看几行找角色行（实测 1~2 行：中间可能隔 `招募说明：以下乘员获得概率提升`）
const ns_reso_HOME_ROLE_LINES = 4;
//#endregion

//#region ② 主源纯解析：wikitext → 行事实
// 剥 HTML 注释（页面里有两段**已下架**的旧档期，见文件头 ②），再按行切、归一空白。
function ns_reso_linesOf(raw) {
	if (typeof raw !== "string" || raw.trim() === "") throw new Error("reso-page-changed:empty");
	return String(raw).replace(/<!--[\s\S]*?-->/g, "\n").split("\n")
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 行里的名字：取**最后一个非文件链接**的显示文本（`[[文件:X-头像.png|25px|link=X]][[X]]` ⇒ `X`；
// `[[红茶战争|「红茶战争」]]` ⇒ `「红茶战争」`），再去掉包裹的「」。
function ns_reso_nameOf(head) {
	ns_reso_LINK_RE.lastIndex = 0;
	const links = [];
	let m;
	while ((m = ns_reso_LINK_RE.exec(String(head))) !== null) {
		if (/^\s*(?:文件|File|Image)\s*:/i.test(m[1])) continue;
		links.push(m[1]);
	}
	if (links.length === 0) return "";
	const parts = links[links.length - 1].split("|");
	const name = String(parts[parts.length - 1] || "").trim();
	const q = /^「([^」]{1,60})」$/.exec(name);
	return (q ? q[1] : name).trim();
}
// 一行 → `{ kind, banner|name, roles, sm, sd, em, ed, raw }`（不是档期行 ⇒ null）
function ns_reso_rowOf(line) {
	const m = ns_reso_ROW_RE.exec(String(line == null ? "" : line));
	if (!m) return null;
	const sm = +m[1], sd = +m[2], em = +m[3], ed = +m[4];
	if (sm < 1 || sm > 12 || em < 1 || em > 12 || sd < 1 || sd > 31 || ed < 1 || ed > 31) return null;
	const head = String(line).slice(0, m.index).trim();
	const name = ns_reso_nameOf(head);
	const tag = ns_reso_TAG_RE.exec(head);
	const raw = `${sm}.${sd} ~ ${em}.${ed}`;            // 源站原文的两端（分隔符统一成 `~`）
	if (tag) {
		// 招募行 = 卡池：类型当池名、角色进 roles
		const banner = tag[1].replace(/\s+/g, " ").trim();
		if (!banner) return null;
		return { kind: "gacha", banner, roles: name, sm, sd, em, ed, raw };
	}
	// 没有【】但有名字 ⇒ 活动（页面自己的写法，见文件头 ②）
	if (!name) return null;
	return { kind: "event", name, roles: "", sm, sd, em, ed, raw };
}
// 整页 → 行事实数组。**结构变了要抛**：一行活行都没有 ⇒ `reso-page-changed:no-rows`。
// 行过滤：含 `{{`/`}}`/`<font` 的是模板/条件日历行（含那条 2023 的死分支），整行跳过。
function ns_reso_rowsOf(raw) {
	const out = [];
	for (const line of ns_reso_linesOf(raw)) {
		if (/\{\{|\}\}/.test(line) || /<font/i.test(line)) continue;
		const row = ns_reso_rowOf(line);
		if (row) out.push(row);
	}
	if (out.length === 0) throw new Error("reso-page-changed:no-rows");
	return out;
}
// 行的起点年份：页面更新年的墙钟 `{ y, mo }` 当线索；**补不出 ⇒ null（这一条不产出）**。
// 规则 ① 走共用 `inferYear`（月份比线索月晚 6 个月以上 ⇒ 上一年），规则 ② 是它的镜像（见文件头 ③）。
function ns_reso_startYearOf(month, hint) {
	if (!Number.isFinite(month)) return null;
	if (!hint || !Number.isFinite(hint.y) || !Number.isFinite(hint.mo)) return null;
	const y = inferYear(null, month, hint);
	if (y == null || !Number.isFinite(y)) return null;
	return month < hint.mo - YEAR_HINT_MONTH_GAP ? y + 1 : y;
}
// 页面的最后编辑时刻（ISO 字符串）→ 绝对毫秒。**拿不到 ⇒ 抛**（没有它就没有年份，见文件头 ③）。
function ns_reso_revStampOf(json) {
	const pages = json && json.query && json.query.pages;
	const page = Array.isArray(pages) ? pages[0] : null;
	const revs = page && Array.isArray(page.revisions) ? page.revisions : null;
	const ts = revs && revs[0] ? revs[0].timestamp : null;
	if (typeof ts !== "string" || ts.trim() === "") throw new Error("reso-rev-changed:no-timestamp");
	const t = Date.parse(ts);
	if (!Number.isFinite(t)) throw new Error("reso-rev-changed:bad-timestamp");
	return t;
}
// 行事实 + 页面更新时刻 → 条目事实（两侧共用；`side` = "pools" | "events"）。
// 年份定不下来的行**直接跳过**（不留错年份）；终点不晚于起点也跳过（源站错行，不硬造）。
function ns_reso_itemsOf(rows, pageTs, tz = ns_reso_TZ, side = "pools") {
	// ⚠️ `sourceWallParts` 对非有限时刻会抛（`formatToParts` 拒绝 invalid date）⇒ 先挡一道；
	//    生产路径上 `pageTs` 由 `ns_reso_revStampOf` 校验过，这里只是让"拿不到年份"这条分支可测、可解释。
	const wall = Number.isFinite(pageTs) ? sourceWallParts(pageTs, tz) : null;
	const hint = wall ? { y: wall.y, mo: wall.mo } : null;
	const want = side === "pools" ? "gacha" : "event";
	const out = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		if (row.kind !== want) continue;
		const startY = ns_reso_startYearOf(row.sm, hint);
		if (startY == null) continue;
		const endY = endsNextYear(row.sm, row.sd, row.em, row.ed) ? startY + 1 : startY;
		const startTs = sourceInstant(startY, row.sm, row.sd, 0, 0, tz);     // 只有日期：起 00:00
		const endTs = sourceInstant(endY, row.em, row.ed, 23, 59, tz);       // 止 23:59（仓库通用约定）
		if (startTs == null || endTs == null || !(endTs > startTs)) continue;
		const item = {
			_i: out.length,
			startTs,
			endTs,
			raw: row.raw,
			display: fmtWindow(startTs, endTs, tz)
		};
		if (side === "pools") {
			item.banner = row.banner;
			item.roles = row.roles || "";
			item.isMain = true;
		} else {
			item.event = row.name;
			item.category = "";
		}
		out.push(item);
	}
	return out;
}
//#endregion

//#region ③ 备选源纯解析：官网首页 HTML → `notice_json` 公告数组 → 窗口条目
// 首页 → `notice_json` 数组（**两次 JSON.parse**，外层是 JS 字符串字面量、内层才是 JSON）。
// 结构变了要抛（见文件头 ⑤）：空串 / 没有 `var notice_json = JSON.parse(...)` / 解析失败 / 不是数组。
function ns_reso_homeNoticesOf(html) {
	const src = String(html == null ? "" : html);
	if (src.trim() === "") throw new Error("reso-home-changed:empty");
	const m = ns_reso_HOME_NOTICE_VAR_RE.exec(src);
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
function ns_reso_homeNewestIdOf(notices) {
	let id = 0;
	for (const n of Array.isArray(notices) ? notices : []) {
		const v = Number(n && n.id);
		if (Number.isFinite(v) && v > id) id = v;
	}
	return id;
}
// 公告日期 → 年份线索 `{ y, mo }`（`pub_date` 优先、缺失退回 `update_time`；没有 ⇒ null）
function ns_reso_homeYearHintOf(notice) {
	const n = notice && typeof notice === "object" ? notice : {};
	const s = String(n.pub_date || n.update_time || "");
	const m = ns_reso_HOME_DATE_RE.exec(s);
	if (!m) return null;
	const y = +m[1], mo = +m[2];
	if (!(y > 0) || !(mo >= 1 && mo <= 12)) return null;
	return { y, mo };
}
// 公告正文 → 行数组（只把**块级**结束标签 / `<br>` 当行边界；`span`/`strong` 是行内的，不能断行
// —— 实测 `【特设招募 &middot;净灭八苦】` 就被 `<span>` 切成两行过）
function ns_reso_homeLinesOf(content) {
	const html = String(content == null ? "" : content)
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|section)>/gi, "\n");
	return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// 一行（或下一行）→ 窗口事实。返回的 `sy` / `ey` 只在源站**显式**写年份时非空。
function ns_reso_homeWindowOf(text) {
	const m = ns_reso_HOME_WINDOW_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	const v = (x) => (x == null || x === "" ? null : +x);
	// `raw` = 源站原文（`-` 原样）；`rawText` = 悬停/`bannerDatesRaw` 用的版本：
	// 分隔符统一成 ` ~ `（与主轴 bwiki 的 `10.22 ~ 11.18` 同一口径；悬停方案 A 只认 `名称/档期`，
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
// 起点年份：显式年优先；否则「公告年 + 共用 inferYear + 跨年镜像」（见文件头 ⑤）。
// **线索拿不到 ⇒ null（这一条不产出）**。
function ns_reso_homeStartYearOf(month, hint, explicit) {
	if (explicit != null) return Number.isFinite(explicit) ? explicit : null;
	if (!Number.isFinite(month)) return null;
	if (!hint || !Number.isFinite(hint.y) || !Number.isFinite(hint.mo)) return null;
	const y = inferYear(null, month, hint);
	if (y == null || !Number.isFinite(y)) return null;
	return month < hint.mo - YEAR_HINT_MONTH_GAP ? y + 1 : y;
}
// 锚点之前最近的 `【…】`：返回 `{ tag, at }`（`at` = 标签所在行号）；8 行内没有 ⇒ null
function ns_reso_homeTagOf(lines, at) {
	for (let j = at; j >= 0 && j >= at - ns_reso_HOME_TAG_BACK_LINES; j--) {
		const m = ns_reso_HOME_TAG_RE.exec(lines[j]);
		if (m) return { tag: m[1].replace(/\s+/g, " ").replace(/\s*·\s*/g, "·").trim(), at: j };
	}
	return null;
}
// 窗口之后的角色行 → 角色名（`SSR “池名”角色` / `角色 获得概率提升`）；取不到 ⇒ ""
function ns_reso_homeRoleOf(lines, at) {
	for (let j = at + 1; j < lines.length && j <= at + ns_reso_HOME_ROLE_LINES; j++) {
		const line = lines[j];
		if (!line || ns_reso_HOME_TIME_LABEL_RE.test(line)) continue;
		if (ns_reso_HOME_WINDOW_RE.test(line)) continue;
		if (ns_reso_HOME_TAG_RE.test(line) || /▌/.test(line)) break;   // 到下一条了
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
function ns_reso_homeRowsOf(notices, tz = ns_reso_TZ) {
	const out = [];
	const seen = new Set();
	for (const notice of Array.isArray(notices) ? notices : []) {
		const hint = ns_reso_homeYearHintOf(notice);
		const lines = ns_reso_homeLinesOf(notice && notice.content);
		for (let i = 0; i < lines.length; i++) {
			if (!ns_reso_HOME_TIME_LABEL_RE.test(lines[i])) continue;
			// 区间可能跟锚点同一行（`起止时间： 5月23日 …`），也可能在下一行
			let win = ns_reso_homeWindowOf(lines[i].replace(/^.*?起止时间\s*[：:]/, ""));
			if (!win && i + 1 < lines.length) win = ns_reso_homeWindowOf(lines[i + 1]);
			if (!win) continue;
			const tagInfo = ns_reso_homeTagOf(lines, i);
			if (!tagInfo) continue;                                   // 没有标签 ⇒ 宁缺勿造
			const isGacha = ns_reso_HOME_GACHA_TAG_RE.test(tagInfo.tag);
			const isEvent = !isGacha && ns_reso_HOME_EVENT_TAG_RE.test(tagInfo.tag);
			if (!isGacha && !isEvent) continue;                       // 【新增内容】之类：不产出
			const startY = ns_reso_homeStartYearOf(win.sm, hint, win.sy);
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
				row.roles = ns_reso_homeRoleOf(lines, i);
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
function ns_reso_homeItemsOf(rows, side) {
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

//#region ④ 主源抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_reso_pageCache = null;                // { url, round, at, promise }（轮内共享）
function ns_reso_resetCache() { ns_reso_pageCache = null; ns_reso_homeResetCache(); }
// 正文 + 页面更新时刻：**每轮 2 次请求**，两侧轮内共用同一份（见文件头 ④）
async function ns_reso_pageOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_reso_RAW_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_reso_pageCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_reso_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = (async () => {
			const raw = await fetchText(key, { mode: "proxy", referer: ns_reso_REFERER, signal });
			const rev = await fetchJson(ns_reso_REV_URL, { mode: "proxy", referer: ns_reso_REFERER, signal });
			return { raw, pageTs: ns_reso_revStampOf(rev) };
		})();
		ns_reso_pageCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_reso_pageCache && ns_reso_pageCache.promise === promise) ns_reso_pageCache = null; });
	}
	return promise;
}
// 一侧的条目事实（页面正文只取一次、解析只做一次）
async function ns_reso_sideOf(url, signal, tz, side) {
	const page = await ns_reso_pageOf(url, signal);
	return ns_reso_itemsOf(ns_reso_rowsOf(page.raw), page.pageTs, tz, side);
}
// 卡池侧：**逐池并列**（每行一口池，不按"同结束时刻"合并角色 —— 特设/专列/联运是不同池型，
// 合并会把不同池型的角色拼成一行，见 `30-game-bwiki-wikitext-common.js` 的 `ns_bwiki_wikitext_gachaPayload`）
async function ns_reso_gacha(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const items = await ns_reso_sideOf(url, signal, tz, "pools");
	if (items.length === 0) return null;              // 页面上一行招募都没有 ⇒ 未公布（不是失败）
	return ns_bwiki_wikitext_gachaPayload(items, tz, now, {});
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷（当前页面 0 行 ⇒ 如实 null）
async function ns_reso_events(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const items = await ns_reso_sideOf(url, signal, tz, "events");
	if (items.length === 0) return null;
	return ns_bwiki_wikitext_eventPayload(items, tz, now, { nameOf: (x) => x.event });
}
//#endregion

//#region ⑤ 备选源抓取器：官网首页内联 JSON（只在设置里选中该备选源时才会被调用）
let ns_reso_homeDataCache = null;            // { url, at, id, rows }（24h 快照）
let ns_reso_homePageCache = null;            // { url, round, at, promise }（轮内共享）
function ns_reso_homeResetCache() { ns_reso_homeDataCache = null; ns_reso_homePageCache = null; }
// 首页 → 窗口条目（24h 缓存；两侧同一条 URL ⇒ 轮内共享同一个 promise，见文件头 ⑤）
async function ns_reso_homeDataOf(url, signal, tz, now) {
	const key = String(url == null ? "" : url).trim() || ns_reso_HOME;
	const at = ns_bwiki_nowOf(now);
	const data = ns_reso_homeDataCache;
	if (data && data.url === key && at - data.at < ns_reso_HOME_CACHE_TTL_MS) return data;
	const round = fetchRoundSeqOf();
	const hit = ns_reso_homePageCache;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_reso_ROUND_TTL_MS) {
		return hit.promise;
	}
	const promise = (async () => {
		const html = await fetchText(key, { mode: "proxy", referer: ns_reso_HOME_REFERER, signal });
		const notices = ns_reso_homeNoticesOf(html);
		const value = { url: key, at, id: ns_reso_homeNewestIdOf(notices), rows: ns_reso_homeRowsOf(notices, tz) };
		ns_reso_homeDataCache = value;
		return value;
	})();
	ns_reso_homePageCache = { url: key, round, at, promise };
	promise.catch(() => { if (ns_reso_homePageCache && ns_reso_homePageCache.promise === promise) ns_reso_homePageCache = null; });
	return promise;
}
// 备选源卡池侧：`起止时间` 里的招募窗口 → 共用卡池载荷（没有覆盖 now 的 ⇒ null）
async function ns_reso_officialGacha(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const data = await ns_reso_homeDataOf(url, signal, tz, at);
	const items = ns_reso_homeItemsOf(data.rows, "gacha");
	if (items.length === 0) return null;          // 一条招募窗口都没有 ⇒ 未公布（不是失败）
	return ns_bwiki_wikitext_gachaPayload(items, tz, at, {});
}
// 备选源活动侧：`起止时间` 里的活动窗口 → 共用活动载荷（当前公告里 0 条 ⇒ 如实 null）
async function ns_reso_officialEvents(url, signal, tz = ns_reso_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	const data = await ns_reso_homeDataOf(url, signal, tz, at);
	const items = ns_reso_homeItemsOf(data.rows, "event");
	if (items.length === 0) return null;
	return ns_bwiki_wikitext_eventPayload(items, tz, at, { nameOf: (x) => x.event });
}
//#endregion

//#region ⑥ 条目登记
// 卡池主源 = bwiki `action=raw` 的 wikitext（标签「Bwiki 活动日历」，不动）；
// 活动侧**默认置空**（`eventUrl: ""` + 不写 `eventSource` ⇒ 未配置、不抓取），
// 原 bwiki 活动源降为备选（「Bwiki 活动日历（停更）」），官网内联 JSON 是另一条备选（「官网公告（停更）」）。
// 备选源标识 = 各自的 `url`（`altSourceId`）：两条活动备选 URL 不同（RESO_RAW_URL / RESO_HOME），不会串。
registerSource({
	id: "reso",
	defaultHidden: false,
	tz: ns_reso_TZ,
	name: "雷索纳斯",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/67/10/a4/6710a4b4-3b57-eb6a-df7a-7a143826aec4/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
	url: ns_reso_RAW_URL,
	source: ns_reso_SOURCE_LABEL,
	eventUrl: "",
	altSources: [{ label: ns_reso_ALT_SOURCE_LABEL, url: ns_reso_HOME, fetcher: ns_reso_ALT_FETCHER }],
	eventAltSources: [
		{ label: ns_reso_EVENT_ALT_SOURCE_LABEL, url: ns_reso_RAW_URL, fetcher: ns_reso_EVENT_ALT_FETCHER },
		{ label: ns_reso_ALT_SOURCE_LABEL, url: ns_reso_HOME, fetcher: ns_reso_ALT_FETCHER }
	]
});
GACHA_FETCHERS["reso"] = (url, signal, tz, now) => ns_reso_gacha(url, signal, tz, now);
// 备选源：官网首页内联 JSON（键 = altSources 的 fetcher 字段；只有选中时才被调用）
GACHA_FETCHERS[ns_reso_ALT_FETCHER] = (url, signal, tz, now) => ns_reso_officialGacha(url, signal, tz, now);
EVENT_FETCHERS["reso"] = Object.assign(EVENT_FETCHERS["reso"] || {}, {
	// 默认抓取器保留（用户把活动地址改成自定义 URL 时的兜底，与其它条目同形）；默认路径不经过它。
	default: (url, signal, tz, now) => ns_reso_events(url, signal, tz, now),
	// 活动侧备选：原 bwiki 活动档（停更）—— 直接别名到主源活动抓取器，解析代码只有一份。
	[ns_reso_EVENT_ALT_FETCHER]: (url, signal, tz, now) => ns_reso_events(url, signal, tz, now),
	[ns_reso_ALT_FETCHER]: (url, signal, tz, now) => ns_reso_officialEvents(url, signal, tz, now)
});
//#endregion
