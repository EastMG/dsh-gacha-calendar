// src/client/30-game-epidgames.js —— EPIDGames：嘟嘟脸恶作剧（ddlezj，国服；B 站发行）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-biligame.js 迁入 ddlezj 的两套来源；
//   条目 + 解析器 + 抓取器 + 登记都在本文件（符号名 `ns_biligame_announce_*` 原样保留）。
// 源：
//   · B 站官方公告 API（api.biligame.com/news）—— 自 2026-06 起冻结，降为两侧手动备选（键 ddlezj-biligame）；
//   · TapTap 官方账号 —— 活动侧默认 = 允许路径的 tab 页 SSR（`__NUXT_DATA__`）；卡池侧默认置空
//     （robots 不允许 webapiv2），仅保留为手动备选「TapTap（不可靠）」（键 ddlezj-taptap-gacha）。
// 复用关系：公共层（fetchJson / fmtWindow / decodeExtra / 悬停与数组生成器）；没有本地自制当期判定。
// 请求预算：活动 1~3 次（覆盖当前窗口就停）；卡池默认 0 次（url="" 未配置）。

// src/client/42-parsers-biligame.js —— biligame 官方公告系（物华弥新 / 闪耀优俊少女 / 嘟嘟脸恶作剧）（压平后见 30-game-biligame.js）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-biligame-announce.js    嘟嘟脸恶作剧（biligame 官方公告）（压平后见 30-game-biligame.js）
//      · 42-parsers-biligame-activity.js    物华弥新 / 闪耀优俊少女（biligame 官方公告）（压平后见 30-game-biligame.js）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-biligame-announce.js（压平后见 30-game-biligame.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-biligame-announce.js（压平后见 30-game-biligame.js）
//
// 由 next-sources/parsers/biligame-announce.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_biligame-announce__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-biligame-announce.js（压平后见 30-game-biligame.js） —— 嘟嘟脸恶作剧 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null（null = 未公布）
//   · 卡池侧：{ banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   两侧都读**同一份官方公告**（同 `30-game-bandori.js`：一份公告里既有活动档期也有招募档期）。
//
// ⚠️ 2026-11-11：这条 B 站公告 API **自 2026-06 起冻结**（列表最新一条 = 2026-06-22，游戏却仍在运营）
//    ⇒ 本条目的**默认源已换成 TapTap 官方账号**（见本文件下方 `TapTap（2026-11-11 换源）` region），
//    这里的代码**保留**为备选源键 `ddlezj-biligame`（设置页可手动切回）。
// ⚠️ 2026-11-13：默认源再改一次 —— TapTap 只抓**允许路径的 tab 页 SSR**（活动侧），
//    卡池侧因 robots 而**置空未配置**；Web 接口那一套降为手动备选「TapTap（不可靠）」。
//    B 站公告仍是活动/卡池两侧的备选，行为不变。
//
// ══ 实测形态（2026-10-02 抓夹具：fixtures/p6-ddlezj-list、fixtures/p6-ddlezj-detail）══
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50
//   → { request_id, data:[13 条], totalNum:13, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断，末尾 `...`) }
//   ⚠️ 三处实测细节（都与 bandori 同款 API 的表现不同，别照抄结论）：
//     ① 本游戏列表**本身就按时间倒序**（13 条严格递减）；bandori 那批是"置顶公告打乱顺序"。
//        仍然自行排序：排序键 = `displayTime || ctime`（字符串比较，形如 `YYYY-MM-DD HH:MM:SS`）。
//     ② **5/13 条没有 displayTime**（17631 / 17429 / 17244 / 16948 / 16947）→ 必须退到 ctime。
//     ③ 列表里的 content 是**截断**的 → 正文只能抓详情 /news/{id}。
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   ⚠️ `/news/17825` 的 data 里 `gameExtensionId=1282` + `site=嘟嘟脸恶作剧` —— 这是扩展 id 的
//      **第二重独立印证**（第一重：官网页面的网络请求自身就带 gameExtensionId=1282）。
//      参数空间实测：positionId 只有 `2` 有数据；typeId=1 主公告(13) / 2 预约(1) / 3~8 空。
//
// ══ 正文结构（HTML 富文本：169 个 <p> / 41 个 <br>）══
//   每个 <p> 是一个逻辑单元，**标题与档期经常各占一个 <p>**：
//     <p>一、主题剧院【凝聚滴落的回忆之池】</p>
//     <p>活动时间：2026/04/23 &nbsp;维护后 - 2026/05/07 09:59</p>
//     <p>③梦境之地</p>
//     <p>活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)</p>
//     <p>三、招募UP中 使徒招募 ①精选使徒招募【积极心态】雨伊 活动时间：…  ← 标题与档期同段</p>
//   `textOf()` 会把 `<br>` 换成换行、把 `</p><p>` 换成**空格** → 用 textOf 的"行"会把同段多个
//   `<p>` 粘成一长行（夹具里就是这样）。所以本解析器**按 `</p>` 切段**再净化
//   （与 fgo.js / bwiki.js 自写 HTML 工具的做法一致），段内再把空白压平。
//
// ══ 时区：条目 tz = "+540"（UTC+9 固定偏移）—— **源站原文标 UTC+9，不是我们换算的** ══
//   正文里 `(UTC+9)` 出现 **4 处**，例如：
//     `活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)`
//   这是**源站原文**。国服公告却用日本时区，**属源站如此**（本项目不改源站口径）。
//   另有大量档期**不带后缀**（`活动时间：2026/04/30 10:00 - 2026/05/07 10:59`），但同一份公告里
//   同一天的收尾时刻与带后缀的严格一致（七、艾利亚斯边境 活动时间收尾 `05-07 10:59`
//   ↔ 同节 BOSS登场时间 `2026/05/07 10:59 (UTC+9)`）→ 整份公告统一按 UTC+9 解释。
//   raw 字段里保留源站**是否写了后缀**（写了就带上），不做任何改写。
//
// ══ 「维护后」不猜时刻（任务书明确要求：抽不到就返回 null）══
//   大量档期写作 `2026/04/23 维护后 - 2026/05/07 09:59`：起点只有"维护后"、**没有钟点**。
//   公告的 displayTime 是**发布时刻**（17825 = 2026-04-27 12:00），不等于该次维护的结束时刻
//   （维护发生在 04-23）→ 用它补齐会把窗口起点写错。故：**起点无钟点的档期一律不产出**
//   （计入 `skippedNoTime`，只在 hover 里如实说明），绝不硬凑。
//   同一份公告里所有档期都抽不出"覆盖当前时刻"的窗口 → 抓取器返回 null（未公布）。

const ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID = 1282;
const ns_biligame_announce_DDLEZJ_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50";
// 条目 tz：源站正文自标 (UTC+9)，故用固定偏移分钟数 "+540"（≡ Asia/Tokyo，无夏令时）
const ns_biligame_announce_DDLEZJ_TZ = "+540";
// ⚠️ 只有公告**正文档期**用 UTC+9；列表/详情里的 displayTime|ctime 是 B 站 CMS 的**发布时刻**，
//    实测口径是国服 UTC+8（**推测**，源站未标注）→ 单独一个常量，只用于 dateTs（排序/诊断）。
//    排序键本身是原始字符串，窗口换算完全不受它影响。
const ns_biligame_announce_DDLEZJ_CMS_TZ = "Asia/Shanghai";
const ns_biligame_announce_DDLEZJ_HOME = "https://game.bilibili.com/trickcal/news/";
// 一条公告最多往下抓几篇详情（公告很稀疏：全站只有 13 篇）
const ns_biligame_announce_DETAIL_LIMIT = 6;


//#region 列表
// 列表条目 → [{ id, title, displayTime, ctime, mtime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_announce_parseDdlezjList(json) {
	if (!json || typeof json !== "object") throw new Error("ddlezj-bad-json");
	if (json.code !== 0) throw new Error("ddlezj-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("ddlezj-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测 5/13 条没有 displayTime → 退 ctime
			return {
				id: x.id,
				title: decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				mtime: x.mtime || "",
				sortKey,
				dateTs: ns_biligame_announce_parseDdlezjDate(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}
// "2026-06-22 14:21:07"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_announce_parseDdlezjDate(s, tz = ns_biligame_announce_DDLEZJ_CMS_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
function ns_biligame_announce_ddlezjDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_announce_DDLEZJ_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}
//#endregion

//#region 正文 → 段落
// 按 </p> 切段（标题/档期各占一段，或同段）：去标签 + 还原实体 + 空白压平
function ns_biligame_announce_ddlezjParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => htmlText(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 档期抽取
// 段落里的「标签：起 - 止[(UTC±N)]」。要点：
//   · 标签限定 2~12 个非空白非冒号字符（`活动时间` / `商店兑换时间` / `BOSS登场时间` / `投票收件`…）
//   · 起止都必须是 **带 4 位年份** 的日期（能滤掉正文里 `04/30 03:00` 这种裸月日）
//   · 起点的钟点可缺（`维护后`）→ 仍匹配上来，但由调用方判定为"抽不到"并跳过
//   · 终点必须带钟点
// 分段拼装（一条大正则手写括号极易出错）：组序 = 1 标签 / 2 起 / 3 起后缀 / 4 止 / 5 止后缀
//   ⚠️ 后缀必须在**捕获组之外**：否则 `2026/05/07 09:59 (UTC+9)` 会被整段当成"止"，
//      再送去解析时刻就必然失败（第一版就踩了这个坑，4 条 (UTC+9) 档期全被误判成"抽不到"）。
const ns_biligame_announce_RE_LABEL = "[^\\s：:]{2,12}";
const ns_biligame_announce_RE_DATE = "\\d{4}\\s*[/\\-.]\\s*\\d{1,2}\\s*[/\\-.]\\s*\\d{1,2}";
const ns_biligame_announce_RE_TIME = "\\d{1,2}\\s*[:：]\\s*\\d{2}";
const ns_biligame_announce_RE_UTC = "UTC[+-]\\d{1,2}";
const ns_biligame_announce_RE_START = `(${ns_biligame_announce_RE_DATE}(?:\\s*(?:${ns_biligame_announce_RE_TIME}|维护后))?)(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_RE_END = `(${ns_biligame_announce_RE_DATE}\\s*${ns_biligame_announce_RE_TIME})(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_WIN_RE = new RegExp(
	`(${ns_biligame_announce_RE_LABEL})[：:]\\s*${ns_biligame_announce_RE_START}\\s*(?:~|～|至|到|-|–|—)\\s*${ns_biligame_announce_RE_END}`,
	"g"
);
const ns_biligame_announce_STAMP = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
function ns_biligame_announce_parseDdlezjStamp(s) {
	const m = ns_biligame_announce_STAMP.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// 段落里的标题段：`一、…` / `① …` / 小标题 `使徒招募` `卡片扭蛋` / 纯括号名 `【冒险通行证】`
//   （实测：`九、通行证` 与 `【冒险通行证】` 各占一段，不把后者当小标题就会两期都叫「九、通行证」）
const ns_biligame_announce_HEAD_SEC = /^[一二三四五六七八九十百]+\s*[、.．]/;
const ns_biligame_announce_HEAD_ITEM = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]/;
const ns_biligame_announce_HEAD_SUB = /^(使徒招募|卡片扭蛋)$/;
const ns_biligame_announce_HEAD_PURE = /^【[^】]{1,12}】$/;
// 段内标题（档期与标题同段时用）：取最后 1~2 个空白分词，滤掉长描述句
function ns_biligame_announce_pickTitle(prefix, fallback) {
	const toks = String(prefix || "").split(/\s+/).filter(Boolean);
	const ok = (t) => {
		const s = String(t).replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		return s && s.length <= 22 && !/[。，,！!？?；;]/.test(s) ? s : "";
	};
	for (let i = toks.length - 1; i >= 0 && i >= toks.length - 2; i--) {
		const s = ok(toks[i]);
		if (!s) continue;
		// 末段过短（如 `【冒险通行证】`）→ 与上一段拼起来，名字更完整
		if (s.length <= 7 && i > 0) {
			const p = ok(toks[i - 1]);
			if (p) return p + " " + s;
		}
		return s;
	}
	return String(fallback || "").trim();
}
// 招募/扭蛋 = 卡池侧；其余 = 活动侧（与 `30-game-bandori.js` 的 `GACHA_SEC_RE` 同口径）
const ns_biligame_announce_GACHA_RE = /招募|扭蛋|卡池|精选/;

// 正文 HTML → { items:[{name,label,startTs,endTs,suffix,raw,kind}], skippedNoTime:[…] }
//   kind: "gacha" | "event"；suffix: 源站原文里的 `UTC+9`（没写就是 ""）
function ns_biligame_announce_parseDdlezjAnnouncement(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	const paragraphs = ns_biligame_announce_ddlezjParagraphs(html);
	const items = [];
	const skippedNoTime = [];
	let current = "";                                  // 最近的标题段
	for (const para of paragraphs) {
		ns_biligame_announce_WIN_RE.lastIndex = 0;
		let m, hadWindow = false;
		while ((m = ns_biligame_announce_WIN_RE.exec(para)) !== null) {
			hadWindow = true;
			const label = m[1];
			const startText = m[2].trim();
			const endText = m[4].trim();
			const suffix = m[5] || m[3] || "";         // (UTC+9) 写在起或止之后都认
			const name = ns_biligame_announce_pickTitle(para.slice(0, m.index), current);
			const raw = `${startText} ~ ${endText}${suffix ? ` (${suffix})` : ""}`;
			if (m[0] === "") ns_biligame_announce_WIN_RE.lastIndex++;
			// 起点无钟点（`维护后`）→ 不猜，如实记入 skippedNoTime
			if (!/\d\s*[:：]\s*\d{2}\s*$/.test(startText)) {
				skippedNoTime.push({ name, label, raw });
				continue;
			}
			const a = ns_biligame_announce_parseDdlezjStamp(startText);
			const b = ns_biligame_announce_parseDdlezjStamp(endText);
			if (!a || !b) { skippedNoTime.push({ name, label, raw }); continue; }
			const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
			const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
			if (!(endTs > startTs)) continue;          // 源站错行 → 丢掉，不硬造
			items.push({
				name: name || label,
				label,
				startTs, endTs,
				suffix,
				raw,
				kind: ns_biligame_announce_GACHA_RE.test(name) ? "gacha" : "event"
			});
		}
		if (hadWindow) continue;
		if (ns_biligame_announce_HEAD_SEC.test(para) || ns_biligame_announce_HEAD_ITEM.test(para) || ns_biligame_announce_HEAD_SUB.test(para) || ns_biligame_announce_HEAD_PURE.test(para)) {
			current = para.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		}
	}
	return { items, skippedNoTime, paragraphs };
}
// 纯函数便捷入口：只要窗口（不含标题推断结果里的 kind 之外的加工）
function ns_biligame_announce_parseDdlezjWindows(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	return ns_biligame_announce_parseDdlezjAnnouncement(html, tz).items;
}
//#endregion

//#region 选当期（覆盖 now；不覆盖 → null，不硬凑过期档期）
// 卡池：覆盖当前的招募档里取**结束最早**的（越快结束越该盯住，与插件 selectCurrent 同口径）；
//       并列按文档顺序。
function ns_biligame_announce_pickDdlezjGacha(items, now) {
	const act = (items || []).filter((x) => x.kind === "gacha" && coversNow(x, now));
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 活动：覆盖当前的**活动档**（label=`活动时间`）优先，其次其它标签（商店兑换时间 / BOSS登场时间…）；
//       同级内结束最早优先，并列按文档顺序。
function ns_biligame_announce_pickDdlezjEvent(items, now) {
	const act = (items || []).filter((x) => x.kind === "event" && coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => (x.label === "活动时间" ? 0 : 1);
	return act.map((x, i) => ({ x, i })).sort((a, b) => (rank(a.x) - rank(b.x)) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 选当期条目：**直接用共用 pickCovering**（覆盖 now + kind 过滤 + 按结束时间升序）
function ns_biligame_announce_covering(items, now, kind) {
	return pickCovering(items, { now, kind, sort: (a, b) => (a.endTs - b.endTs) || 0 });
}
// ⚠️ 2026-10-03 删：这里原本有两个只服务于**悬停元信息**的常量/函数 ——
//   · `skipNote(parsed)` → `—— 另有 N 条档期起点写作「维护后」（源站未给钟点、…）→ 不产出，绝不硬凑 ——`
//   · `TZ_NOTE = "（源站正文自标 (UTC+9)，本条目 tz=+540）"`
//   两者都进了 `bannerHover` / `eventHover`：分隔线装饰 + 抓取统计 + 时区说明 + 内部 tz 值，
//   而方案 A 要求悬停**只**有名称与档期。
//   「本条目 tz=+540」这类信息本来就在**来源声明**里（条目 tz 字段），不需要在悬停里复述。
//   `parsed.skippedNoTime` 本身仍保留（测试要断言"维护后档期不产出"），只是不再写进悬停。
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 对象 | null；now 在最后、有默认值）
// 列表倒序 → 逐条往下抓详情（最多 ns_biligame_announce_DETAIL_LIMIT 篇），由调用方从每篇里挑"覆盖当前时刻"的档期；
// 单条详情失败（网络/404）不整体崩，继续下一条，
// **但若所有详情请求都失败** → 抛错（不能把"源站挂了"静默降级成"未公布"）。
// 实测（2026-10-02）：13 篇里只有「活动公告」类带档期，最新几篇是规则/开发者笔记（0 条档期）
// → 必须往下走几篇才可能命中当期，故 limit 取 6。
async function ns_biligame_announce_loadDdlezj(listUrl, signal, tz) {
	const list = ns_biligame_announce_parseDdlezjList(await fetchJson(listUrl, { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null, loaded = 0;
	const seen = [];
	for (const it of list.slice(0, ns_biligame_announce_DETAIL_LIMIT)) {
		try {
			const detail = await fetchJson(ns_biligame_announce_ddlezjDetailUrl(listUrl, it.id), { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			loaded++;
			seen.push({ item: it, data: d, parsed: ns_biligame_announce_parseDdlezjAnnouncement(d.content, tz) });
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (loaded === 0 && firstErr) throw firstErr;
	return { seen };
}
// 卡池侧
// 覆盖 now 的档期 → 悬停行（P3b：`title` 给条目反生成/数组收口；顺序 = hoverPool 的结束时间升序）
function ns_biligame_announce_hoverRows(items) {
	return (items || [])
		.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: "" }))
		.filter((x) => String(x.title || "").trim() !== "")
		.sort(poolHoverOrderOf);
}
// 条目事实 → 卡池载荷（**两条链路共用**：bilibili 官方公告 / TapTap 公告）
// 输入 = `pickDdlezjGacha` 选出的当期池 + `covering` 收的全部在期池；输出 = 面板卡池列 + `gacha` 数组。
function ns_biligame_announce_ddlezjGachaPayloadOf(best, act, tz, now) {
	// 悬停 = 条目反生成（池名 ⏎ 档期）；元信息（来源/公告标题/时区说明/维护后统计）一律不进
	// ── P3b：条目事实 → 悬停 + `gacha` 数组 ──────────────────────────────
	const poolItems = ns_biligame_announce_hoverRows(act);
	const hover = hoverTextFromItems(poolItems, "gacha", tz);
	const out = {
		banner: best.name,
		roles: "",                                  // 源站为公告正文，无结构化角色名单（池名里已带角色）
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, poolItems, { tz }, now);
	out.gachaHoverItems = poolItems;
	return out;
}
// 条目事实 → 活动载荷（同上，两条链路共用；逐字与改造前一致）
function ns_biligame_announce_ddlezjEventPayloadOf(best, act, tz, now) {
	// 非「活动时间」标签的档期在**名称**里标注它是什么窗口（内容，不是元信息）
	// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────
	const eventItems = (act || [])
		.map((x) => ({
			title: `${x.name}${x.label === "活动时间" ? "" : `（${x.label}）`}`,
			startTs: x.startTs, endTs: x.endTs, raw: ""
		}))
		.filter((x) => x.title);   // 顺序 = covering 的 endTs 升序（与原 hoverEvent 收到的一致，不另排）
	const hover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(hover ? { eventHover: hover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}
// 卡池侧（B站官方公告 API —— **源站已停更**，2026-11-11 起降为 `altSources` 手动备选）
async function ns_biligame_announce_gachaDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = nowMs()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjGacha(parsed.items, now);
		if (!best) continue;
		return ns_biligame_announce_ddlezjGachaPayloadOf(best, ns_biligame_announce_covering(parsed.items, now, "gacha"), tz, now);
	}
	return null;                                       // 抓到公告但当期无覆盖 → 未公布
}
// 活动侧（同上：B站官方公告，现为备选）
async function ns_biligame_announce_eventsDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = nowMs()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjEvent(parsed.items, now);
		if (!best) continue;
		return ns_biligame_announce_ddlezjEventPayloadOf(best, ns_biligame_announce_covering(parsed.items, now, "event"), tz, now);
	}
	return null;
}
//#endregion

//#region TapTap（2026-11-11 换源：**列表 → 详情**）
// ══ 为什么换 ══
// 卡池/活动两侧此前都读 B 站代理的官方公告 API（`api.biligame.com/news/list`）。
// ⚠️ 该 API **自 2026-06 起冻结**：`/news/list` 最新一条 = 2026-06-22（13 条全在 6 月前），
//   而游戏仍在运营（11-05 才开新版本）⇒ 面板两侧常年「未命中」，且**不是抓取失败**。
// 官方渠道改成 TapTap 官方账号（国服）：`https://www.taptap.cn/app/755194/topic?type=official`
//   （`group_id=957044` 来自该页 SSR payload；app id = 755194）。
//
// ── 2026-11-13：活动侧改读 **tab 页 SSR**，webapiv2 只留作卡池侧的手动备选 ───────────
// `www.taptap.cn/robots.txt` 的 `Disallow: /webapi/` 与 `Disallow: /webapiv2/` 是硬事实
// ⇒ 下面这套「列表接口 + 逐帖详情」**不能**再作为默认抓取（违反 robots，且会被 WAF 拦）。
// 允许的是给人看的 tab 页 `/app/755194/topic?type=official`：SSR 的 `topic.summary` 里就有
// 活动档期那一行（`活动时间：2026/11/05 维护后 - 2026/11/19 09:59`），一页 1 个请求就够当期；
// 而**卡池正文不在 SSR 里**（「活动更新一览」帖只渲染成摘要卡，前 200 字截断在「开启条件」）
// ⇒ 卡池侧**默认置空**（注册项 `url: ""` = 未配置、不抓），webapiv2 卡池抓取器原样保留为
// `altSources[0]`，标签逐字写「TapTap（不可靠）」—— 只有用户手动切过去才会请求它。
// 下面的 `loadDdlezjTaptap` / `gachaDdlezjTaptap` 因此只剩一条用途：那个手动备选源。
//
// ══ 响应形态（2026-11-11 实测，夹具 p6-ddlezj-taptap-feed-p1 / -p2 / -detail-*）══
// 列表 GET https://www.taptap.cn/webapiv2/feed/v7/by-group
//        ?X-UA=<页面自己发的客户端身份>&type=official&group_id=957044&limit=10&sort=created&from=<偏移>
//   → { data: { list: [ { moment: { id_str, created_time, topic: { id_str, title, summary } } } ],
//               total: 411, next_page: "…" } }
//   ⚠️ **列表里的 `topic.summary` 只有 200 字**（实测截断在「一、主题剧院…活动时间：…开启条件：通关世界」），
//      卡池段在正文深处（二、新使徒…）⇒ 只读列表永远拿不到卡池。**必须抓详情**。
// 详情 GET https://www.taptap.cn/webapiv2/moment/v3/detail?X-UA=<同串>&id=<id_str>
//   → { data: { moment: {…}, first_post: { contents: { json: [ {type:"paragraph",children:[{text:"…"}]}
//                                                              | {type:"image",…} , … ] } } } }
//   正文 = `contents.json` 的段落块（实测 166 段 + 11 张图 / 64 KB；**不是** HTML）。
//   `moment.topic.summary` 在详情里**仍只有 200 字** ⇒ 正文只能从 `first_post.contents` 取。
// `X-UA` 是 TapTap 的客户端身份串（缺了 → 400 `INVALID_XUA`，与夜幕之下同款）：
//   · 必须 `encodeURIComponent` 后作为**一个** query 值发（值里自带 `=`/`&`，不编码就会被拆成参数）；
//   · `UID=` 留空即可（实测空 UID 与真 UUID 都 200）⇒ 不把会话 UUID 写死进源码。
// 仍需宿主代理：响应**无 ACAO**（`www.taptap.cn` 已在 PROXY_ALLOW_HOSTS）。
//
// ══ 时区：国服墙钟 = UTC+8 ══
// 正文里出现过自标 `开放时间：2026/09/17 03:00 (UTC+8)`（09-10 那篇），且「10:00 维护 / 09:59 收池」
// 是国服口径 ⇒ 条目 tz = Asia/Shanghai。**B 站那份公告的 +540（UTC+9）只属于那个源**：
// 备选源抓取器自己钉死 `+540`（见文件末尾的 `ddlezj-biligame` 两个键），不拿条目 tz 覆盖。
//
// ══ 「维护后」的起点：用同帖顶部那次维护的时刻（源站明写，不是猜）══
// 每篇都有 `…即将在2026/11/05 10:00 进行维护更新…` ⇒ `2026/11/05 维护后` 的起点 = 该帖维护时刻。
// ⚠️ 只有**日期相同**才认这个锚点：`2026/10/15 维护后`（同帖里 10-08 那篇的 10-15 小节）不是
//    10-08 那次维护 —— 拿它当起点会把窗口提前 7 天。日期不同的「维护后」⇒ 起点未知，**不产出**
//    （记入 `skippedNoTime`，与 bilibili 那份同一口径：不猜钟点）。
// 其余绝对时刻（`2026/11/12 03:00`）走既有 `parseDdlezjStamp` + `sourceInstant`，**不另写一套**。
//
// ══ 正文 → 条目（复用现有窗口解析，只补「谁拥有这个窗口」的扫描）══
// 正文有两种形态，都要能读：
//   ① 新格式（2026-07 起）：**一行一段**，标题独占一行（`①全新使徒【波朗】限时概率上升`），
//      档期下一行（`活动时间：2026/11/05  维护后 - 2026/11/19 09:59`）；
//   ② 旧格式（2026-06）：多个小节**挤在一段里**（`二、新使徒、新卡片①全新使徒【莉丝迪】限时概率上升活动时间：…`）。
// 做法：先把一段按标记切成 token —— `一、`/`二、、`（段标题，要求前一个字符不是汉字/字母/数字）
// 与 `①`…`⑳`（小节标题）——再按顺序把**后面那个**窗口挂给"最近的标题"。
// 卡池 = 标题命中 `限时概率上升 / 精选使徒招募 / 卡片扭蛋` 的那些小节：
//   · 小节自带档期 → 用它；
//   · 小节在**段级档期之后**（源站把「三、其他精选使徒招募和精选卡片扭蛋」的档期写在 ①②③ 之前）
//     → 继承同段内**前面最近**的那个段级档期（并把那个段级窗口从活动侧移除，避免重复）；
//   · 两者都没有 → 不产出（不猜档期）。
// 活动 = 其余窗口（名称 = 最近的标题；非「活动时间」标签在名称后括注标签，与改造前一致）。
//
// ══ 翻页与早停 ══
// 每页 10 帖，`from` 是**偏移**（0 / 10 / 20…），`MAX_PAGES = 3` 封顶（老帖的标题里没有日期，
// 没法按标题排序，只能按列表顺序）。只给「版本更新公告」这几种标题抓详情
// （`活动更新一览` / `活动更新速览` / `活动速览` / `版本更新`），其余帖（兑换码、参展、开发者笔记）
// 只读标题跳过 —— 详情一次 64 KB，不能见帖就抓。
// 早停：某帖的档期**全都已结束** ⇒ 更早的帖子只会更旧，立即停（实测 11-11 只发 3 个请求：
// 列表 p1 + 11-03 详情 + 10-08 详情）。`MAX_DETAILS = 6` 是第二道闸。
const ns_biligame_announce_DDLEZJ_TAPTAP_TZ = "Asia/Shanghai";
const ns_biligame_announce_DDLEZJ_TAPTAP_API = "https://www.taptap.cn/webapiv2/feed/v7/by-group";
const ns_biligame_announce_DDLEZJ_TAPTAP_DETAIL = "https://www.taptap.cn/webapiv2/moment/v3/detail";
// 给人看的那个页面 = **活动侧的抓取地址**（2026-11-13 起解析它的 SSR；见上方 region 头的说明）
// 同时用作卡池备选（webapiv2）请求的 Referer。
const ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL = "https://www.taptap.cn/app/755194/topic?type=official";
// 页面自己请求里那串客户端身份（缺了 → 400 INVALID_XUA）。`UID=` 留空，不写死会话 UUID。
const ns_biligame_announce_DDLEZJ_TAPTAP_XUA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=100000000&LOC=CN&PLT=PC&DS=Android&UID=&OS=Windows&OSV=10&DT=PC";
const ns_biligame_announce_DDLEZJ_TAPTAP_GROUP_ID = "957044";
const ns_biligame_announce_DDLEZJ_TAPTAP_LIMIT = 10;
const ns_biligame_announce_DDLEZJ_TAPTAP_MAX_PAGES = 3;
// 详情是 64 KB 一份，翻页时逐帖抓 → 第二道闸（正常一两次就早停，这条只防源站结构大变）
const ns_biligame_announce_DDLEZJ_TAPTAP_MAX_DETAILS = 6;
// 只给这几种标题抓详情（版本更新公告；其余帖没有档期）
const ns_biligame_announce_DDLEZJ_TAPTAP_ANNOUNCE_RE = /活动更新|活动速览|活动一览|更新一览|版本更新/;

// 列表接口地址：`from` 是**偏移**（不是页码）
function ns_biligame_announce_ddlezjTaptapApiUrl(from) {
	return ns_biligame_announce_DDLEZJ_TAPTAP_API
		+ "?X-UA=" + encodeURIComponent(ns_biligame_announce_DDLEZJ_TAPTAP_XUA)
		+ "&type=official&group_id=" + ns_biligame_announce_DDLEZJ_TAPTAP_GROUP_ID
		+ "&limit=" + ns_biligame_announce_DDLEZJ_TAPTAP_LIMIT
		+ "&sort=created"
		+ "&from=" + (Number(from) || 0);
}
function ns_biligame_announce_ddlezjTaptapDetailUrl(id) {
	return ns_biligame_announce_DDLEZJ_TAPTAP_DETAIL
		+ "?X-UA=" + encodeURIComponent(ns_biligame_announce_DDLEZJ_TAPTAP_XUA)
		+ "&id=" + encodeURIComponent(String(id == null ? "" : id));
}
// 页码 → 偏移（第 1/2/3 页 = 0 / 10 / 20）
function ns_biligame_announce_ddlezjTaptapPageUrl(base, page) {
	const u = String(base == null ? "" : base).trim() || ns_biligame_announce_ddlezjTaptapApiUrl(0);
	const n = Math.max(1, Math.floor(Number(page) || 1));
	if (n <= 1) return u;
	const from = (n - 1) * ns_biligame_announce_DDLEZJ_TAPTAP_LIMIT;
	if (/[?&]from=\d+/.test(u)) return u.replace(/([?&])from=\d+/, "$1from=" + from);
	return u + (u.includes("?") ? "&" : "?") + "from=" + from;
}

// 列表 JSON → [{ id, title, createdTime }]（顺序 = 源站顺序 = 从新到旧）
function ns_biligame_announce_parseDdlezjTaptapList(json) {
	const data = json && typeof json === "object" ? json.data : null;
	if (!data || typeof data !== "object") throw new Error("ddlezj-taptap-bad-list");
	const list = data.list;
	if (!Array.isArray(list)) throw new Error("ddlezj-taptap-bad-list");
	const out = [];
	for (const it of list) {
		const mo = it && it.moment;
		if (!mo || typeof mo !== "object") continue;
		const topic = mo.topic && typeof mo.topic === "object" ? mo.topic : {};
		const id = mo.id_str == null ? "" : String(mo.id_str);
		const title = decodeEntities(String(topic.title == null ? "" : topic.title)).replace(/\s+/g, " ").trim();
		if (!id || !title) continue;
		out.push({ id, title, createdTime: Number(mo.created_time) || 0 });
	}
	return out;
}

// 详情 JSON → 段落数组（`first_post.contents.json` 的文字块；图片块没有文字，跳过）
// ⚠️ 结构变了要**抛错**（抓取失败 ≠ 未公布）：所以"没有 contents / 一段都没有"都是错误。
function ns_biligame_announce_parseDdlezjTaptapBody(json) {
	const d = json && typeof json === "object" ? json.data : null;
	const fp = d && typeof d === "object" ? d.first_post : null;
	const c = fp && typeof fp === "object" ? fp.contents : null;
	const blocks = Array.isArray(c) ? c : (c && Array.isArray(c.json) ? c.json : null);
	if (!blocks) throw new Error("ddlezj-taptap-bad-body");
	const out = [];
	for (const b of blocks) {
		if (!b || b.type !== "paragraph") continue;
		const kids = Array.isArray(b.children) ? b.children : [];
		out.push(kids.map((k) => (k && typeof k.text === "string" ? k.text : "")).join(""));
	}
	if (out.length === 0) throw new Error("ddlezj-taptap-bad-body");
	return out;
}

// 维护锚点：`…即将在2026/11/05 10:00 进行维护更新…` → { y, mo, d, ts, raw }
// 这是「维护后」那批窗口的起点（源站明写；只认**同一天**，见文件头）。
const ns_biligame_announce_DDLEZJ_TAPTAP_MAINT_RE = /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*进行维护更新/;
function ns_biligame_announce_ddlezjTaptapAnchor(paragraphs, tz) {
	for (const p of Array.isArray(paragraphs) ? paragraphs : []) {
		const m = ns_biligame_announce_DDLEZJ_TAPTAP_MAINT_RE.exec(String(p == null ? "" : p));
		if (!m) continue;
		const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
		if (h > 23 || mi > 59) continue;
		return { y, mo, d, ts: sourceInstant(y, mo, d, h, mi, tz), raw: m[0].replace(/\s+/g, " ") };
	}
	return null;
}

// 档期标签白名单（源站实测出现过的；`[^\s：:]{2,12}` 那版会在**挤在一段**的旧格式里把
// `②登录！暗网活动时间` 整段吃成标签名 ⇒ 显式列举，长标签在前）
const ns_biligame_announce_DDLEZJ_TAPTAP_LABELS = "(商店兑换时间|奖励领取时间|BOSS登场时间|投票时间|活动时间|开放时间|更新时间|折扣时间|开启时间|结束时间)";
// 组序：1 标签 / 2 起 / 3 起后缀 / 4 止 / 5 止后缀（与 bilibili 那条 `WIN_RE` **完全一致**，
// 因为 `RE_START` / `RE_END` 是同一份；⚠️ `LABELS` 自带括号，这里**不能**再套一层，否则组号整体右移）
const ns_biligame_announce_DDLEZJ_TAPTAP_WIN_RE = new RegExp(
	`${ns_biligame_announce_DDLEZJ_TAPTAP_LABELS}[：:]\\s*${ns_biligame_announce_RE_START}\\s*(?:~|～|至|到|-|–|—)\\s*${ns_biligame_announce_RE_END}`,
	"g"
);

// 一段文字里的**标题标记** → [{ kind: "section"|"item", name }]（按出现顺序）
//   `一、主题剧院【…】` → section；`①全新使徒【…】` → item
//   段标题要求前一个字符不是汉字/字母/数字（否则「…一次、…」会被当成新章节）；
//   小节标记（①②…）本身就是列表符号，不设边界。
function ns_biligame_announce_ddlezjTaptapTitlesOf(text) {
	const s = String(text == null ? "" : text);
	const hits = [];
	const sec = /([一二三四五六七八九十百]+)\s*[、.．]+/g;
	let m;
	while ((m = sec.exec(s))) {
		const before = m.index === 0 ? "" : s[m.index - 1];
		if (before && /[0-9A-Za-z\u4e00-\u9fa5]/.test(before)) { sec.lastIndex = m.index + 1; continue; }
		hits.push({ at: m.index, end: m.index + m[0].length, kind: "section" });
	}
	const item = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;
	while ((m = item.exec(s))) hits.push({ at: m.index, end: m.index + m[0].length, kind: "item" });
	hits.sort((a, b) => a.at - b.at);
	const out = [];
	for (let i = 0; i < hits.length; i++) {
		const h = hits[i];
		const stop = i + 1 < hits.length ? hits[i + 1].at : s.length;
		// 名称 = 标记之后到下一个标记之前（首尾空白去掉）。
		// ⚠️ 旧格式里「标题 + 档期 + 说明」挤在同一段 ⇒ 名称必须截在**冒号 / 下一个档期标签**之前，
		//    否则会拼出「便装上架【莉丝迪】-可爱黑客兔女郎开放时间：2026/06/04 维护后…」这种长串。
		let name = s.slice(h.end, stop).replace(/\s+/g, " ").trim();
		const cut = name.search(/[：:]|活动时间|开放时间|商店兑换时间|奖励领取时间|BOSS登场时间|投票时间|更新时间|折扣时间|活动说明|活动介绍|获得方式|获取方式/);
		if (cut >= 0) name = name.slice(0, cut).trim();
		if (name.length > 40) name = name.slice(0, 40).trim();
		if (!name) continue;
		out.push({ kind: h.kind, name });
	}
	return out;
}

// 卡池小节名（命中即卡池侧；含「限时概率上升」这种不带"招募/扭蛋"字样的标题）
const ns_biligame_announce_DDLEZJ_TAPTAP_POOL_RE = /限时概率上升|概率上升|精选使徒招募|使徒招募|精选卡片扭蛋|卡片扭蛋|扭蛋|招募|卡池/;

// 一个窗口 token → { startTs, endTs, raw, display } | null（null = 起点/终点解析不出 ⇒ 不产出）
function ns_biligame_announce_ddlezjTaptapWindowOf(tok, anchor, tz) {
	const startText = String(tok.startText == null ? "" : tok.startText);
	const endText = String(tok.endText == null ? "" : tok.endText);
	const rel = /维护后|版本更新后|更新维护后|维护结束后|更新后/.test(startText)
		&& !/\d\s*[:：]\s*\d{2}\s*$/.test(startText);
	let startTs = null;
	if (rel) {
		// 「维护后」：只认同一天那次维护（锚点 = 同帖顶部的 `YYYY/MM/DD HH:MM 进行维护更新`）
		const md = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/.exec(startText);
		if (!md || !anchor) return null;
		if (+md[1] !== anchor.y || +md[2] !== anchor.mo || +md[3] !== anchor.d) return null;
		startTs = anchor.ts;
	} else {
		const a = ns_biligame_announce_parseDdlezjStamp(startText);
		if (!a) return null;
		startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
	}
	const b = ns_biligame_announce_parseDdlezjStamp(endText);
	if (!b) return null;
	const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
	if (!(endTs > startTs)) return null;
	// raw = 源站原文（`维护后` 保留）；display = 补全后的可读文本（起点用锚点时刻）
	return { startTs, endTs, raw: tok.raw, display: fmtWindow(startTs, endTs, tz) };
}

// 正文段落 → { items, anchor, skippedNoTime }
//   items[].kind: "gacha" | "event"（与 bilibili 那份同一套 `pick*` 消费）
function ns_biligame_announce_parseDdlezjTaptapText(paragraphs, tz = ns_biligame_announce_DDLEZJ_TAPTAP_TZ) {
	const list = Array.isArray(paragraphs) ? paragraphs : [];
	const anchor = ns_biligame_announce_ddlezjTaptapAnchor(list, tz);
	// ① 切 token：标题（段/小节）与窗口，按正文顺序
	const toks = [];
	for (const para of list) {
		const p = String(para == null ? "" : para);
		let pos = 0;
		ns_biligame_announce_DDLEZJ_TAPTAP_WIN_RE.lastIndex = 0;
		let m;
		while ((m = ns_biligame_announce_DDLEZJ_TAPTAP_WIN_RE.exec(p)) !== null) {
			if (m[0] === "") { ns_biligame_announce_DDLEZJ_TAPTAP_WIN_RE.lastIndex++; continue; }
			const head = ns_biligame_announce_ddlezjTaptapTitlesOf(p.slice(pos, m.index));
			for (const t of head) toks.push(t);
			pos = m.index + m[0].length;
			const suffix = m[5] || m[3] || "";
			toks.push({
				kind: "win",
				label: m[1],
				startText: m[2].trim(),
				endText: m[4].trim(),
				suffix,
				raw: `${m[2].trim()} ~ ${m[4].trim()}${suffix ? ` (${suffix})` : ""}`.replace(/\s+/g, " ")
			});
		}
		for (const t of ns_biligame_announce_ddlezjTaptapTitlesOf(p.slice(pos))) toks.push(t);
	}
	// ② 窗口 → 事实（挂在"最近的标题"上；没有标题就退回标签名）
	const skippedNoTime = [];
	const factOf = new Map();          // token 下标 → 事实
	let section = "", item = "";
	for (let i = 0; i < toks.length; i++) {
		const tok = toks[i];
		if (tok.kind === "section") { section = tok.name; item = ""; continue; }
		if (tok.kind === "item") { item = tok.name; continue; }
		const name = item || section;
		const win = ns_biligame_announce_ddlezjTaptapWindowOf(tok, anchor, tz);
		if (!win) { skippedNoTime.push({ name: name || tok.label, label: tok.label, raw: tok.raw }); continue; }
		factOf.set(i, {
			name: name || tok.label,
			label: tok.label,
			startTs: win.startTs,
			endTs: win.endTs,
			raw: win.raw,
			display: win.display,
			kind: ns_biligame_announce_DDLEZJ_TAPTAP_POOL_RE.test(name) ? "gacha" : "event",
			// 这条窗口的归属是**段标题**（而不是某个小节）⇒ 允许被同段的卡池小节继承
			fromSection: !item
		});
	}
	// ③ 卡池小节 → 卡池条目（自带档期优先；否则继承同段内前面最近的**段级**档期）
	const poolItems = [];
	const consumed = new Set();        // 被卡池小节继承掉的段级窗口（不再算活动，也不单独算卡池）
	for (let i = 0; i < toks.length; i++) {
		const tok = toks[i];
		if (tok.kind !== "item" || !ns_biligame_announce_DDLEZJ_TAPTAP_POOL_RE.test(tok.name)) continue;
		let src = -1;
		// 自己的档期：紧跟其后的窗口（遇到下一个标题就说明没有）
		if (i + 1 < toks.length && toks[i + 1].kind === "win" && factOf.has(i + 1)) src = i + 1;
		// 继承：同段内往前找最近的段级窗口（源站把「三、其他…」的档期写在 ①②③ 之前）
		if (src < 0) {
			for (let j = i - 1; j >= 0; j--) {
				if (toks[j].kind === "section") break;
				const f = factOf.get(j);
				if (f && f.fromSection) { src = j; break; }
			}
		}
		if (src < 0) continue;                     // 没有档期可用 ⇒ 不产出（不猜）
		const f = factOf.get(src);
		poolItems.push({
			name: tok.name,
			label: f.label,
			startTs: f.startTs,
			endTs: f.endTs,
			raw: f.raw,
			display: f.display,
			kind: "gacha",
			fromSection: false
		});
		if (src !== i + 1) consumed.add(src);
	}
	// ④ 汇总：活动 = 非池子窗口；卡池 = 池子小节 + （没被继承的）段级池子窗口
	const seen = new Set();
	const items = [];
	const push = (x) => {
		const k = `${x.name}|${x.startTs}|${x.endTs}`;
		if (seen.has(k)) return;
		seen.add(k);
		items.push(x);
	};
	for (let i = 0; i < toks.length; i++) {
		const f = factOf.get(i);
		if (!f) continue;
		if (f.kind === "gacha" && consumed.has(i)) continue;
		push(f);
	}
	for (const p of poolItems) push(p);
	return { items, anchor, skippedNoTime };
}

// 列表 → 详情（只抓「版本更新公告」；早停：某帖档期全结束就不再往后翻）
async function ns_biligame_announce_loadDdlezjTaptap(listUrl, signal, tz, now) {
	const base = String(listUrl == null ? "" : listUrl).trim() || ns_biligame_announce_ddlezjTaptapApiUrl(0);
	const seen = [];
	let firstErr = null, details = 0;
	for (let page = 1; page <= ns_biligame_announce_DDLEZJ_TAPTAP_MAX_PAGES; page++) {
		let json;
		try {
			json = await fetchJson(ns_biligame_announce_ddlezjTaptapPageUrl(base, page), {
				signal, mode: "proxy", referer: ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL
			});
		} catch (e) {
			if (page === 1) throw e;                 // 第 1 页失败 = 真失败
			break;                                   // 后续页失败 ⇒ 用手上已有结果
		}
		const posts = ns_biligame_announce_parseDdlezjTaptapList(json);
		if (posts.length === 0) break;               // 列表空了 = 到底
		let stop = false;
		for (const post of posts) {
			if (!ns_biligame_announce_DDLEZJ_TAPTAP_ANNOUNCE_RE.test(post.title)) continue;
			if (details >= ns_biligame_announce_DDLEZJ_TAPTAP_MAX_DETAILS) { stop = true; break; }
			details++;
			let parsed;
			try {
				const dj = await fetchJson(ns_biligame_announce_ddlezjTaptapDetailUrl(post.id), {
					signal, mode: "proxy", referer: ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL
				});
				parsed = ns_biligame_announce_parseDdlezjTaptapText(ns_biligame_announce_parseDdlezjTaptapBody(dj), tz);
			} catch (e) {
				if (!firstErr) firstErr = e;
				continue;                            // 单帖失败不整体崩
			}
			if (parsed.items.length === 0) continue; // 这帖没有档期 ⇒ 看下一帖（不算"已结束"）
			seen.push({ post, parsed });
			// 「上一条已结束」即停：这一帖的档期全都过了 ⇒ 更早的帖子只会更旧
			if (!parsed.items.some((x) => x.endTs >= now)) { stop = true; break; }
		}
		if (stop) break;
	}
	if (seen.length === 0 && firstErr) throw firstErr;   // 详情全失败 ⇒ 抛错（抓取失败 ≠ 未公布）
	return { seen };
}

// 卡池侧（TapTap 官方公告：列表 → 详情）
async function ns_biligame_announce_gachaDdlezjTaptap(url, signal, tz = ns_biligame_announce_DDLEZJ_TAPTAP_TZ, now = nowMs()) {
	const ctx = await ns_biligame_announce_loadDdlezjTaptap(url, signal, tz, now);
	for (const { parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjGacha(parsed.items, now);
		if (!best) continue;
		return ns_biligame_announce_ddlezjGachaPayloadOf(best, ns_biligame_announce_covering(parsed.items, now, "gacha"), tz, now);
	}
	return null;                                       // 抓到公告但当期无覆盖 → 未公布
}

// 活动侧（同上）
// ⚠️ 2026-11-13 起**不再是默认**：默认活动侧改读 tab 页 SSR（见下面 `eventsDdlezjTopic`）。
// 保留它是因为 `loadDdlezjTaptap` 仍是卡池备选源（`altSources[0]` = 「TapTap（不可靠）」）的链路。
async function ns_biligame_announce_eventsDdlezjTaptap(url, signal, tz = ns_biligame_announce_DDLEZJ_TAPTAP_TZ, now = nowMs()) {
	const ctx = await ns_biligame_announce_loadDdlezjTaptap(url, signal, tz, now);
	for (const { parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjEvent(parsed.items, now);
		if (!best) continue;
		return ns_biligame_announce_ddlezjEventPayloadOf(best, ns_biligame_announce_covering(parsed.items, now, "event"), tz, now);
	}
	return null;
}

// ── 活动侧默认源（2026-11-13）：tab 页 SSR（robots 允许的路径，1 个请求）──
// 每篇「活动更新一览 / 速览」帖的摘要里，第一个 `一、主题剧院【…】` + `活动时间：…` 就是当期；
// 「维护后」的起点用**同帖顶部**那句 `YYYY/MM/DD HH:MM 进行维护更新`（`parseDdlezjTaptapText`
// 里的锚点逻辑原样复用，日期不同就不产出）。摘要只有前 200 字 ⇒ 一帖只出 1 条活动档期，
// 这对"当期活动"够用；更多档期本来就在正文里（SSR 没有），不在这里硬凑。
// 翻页：第 1 页有任何一条**覆盖当前时刻**就停（实测 11-13 只发 1 个请求）；
// 第 2 页只在第 1 页覆盖不到时抓（最多 `NS_TAPTAP_TOPIC_MAX_PAGES` 页）。
// 只解析标题命中 `ANNOUNCE_RE` 的帖：其余帖（兑换码 / 参展 / 开发者笔记）即使写了日期，
// 也不是游戏内活动档期（例如 BW 参展那帖的 `活动时间：2026年7月10日-7月12日`）。
async function ns_biligame_announce_eventsDdlezjTopic(url, signal, tz = ns_biligame_announce_DDLEZJ_TAPTAP_TZ, now = nowMs()) {
	const base = String(url == null ? "" : url).trim() || ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL;
	const rows = [];
	let postCount = 0;
	for (let page = 1; page <= NS_TAPTAP_TOPIC_MAX_PAGES; page++) {
		let html;
		try {
			html = await fetchText(ns_taptap_topicPageUrl(base, page), {
				signal, mode: "proxy", referer: base
			});
		} catch (e) {
			if (page === 1) throw e;                       // 第 1 页失败 = 真失败
			break;                                         // 后续页失败 ⇒ 用手上已有结果
		}
		const posts = ns_taptap_topicPostsOf(html);        // 结构变了 ⇒ 抛错（不是"未公布"）
		postCount += posts.length;
		for (const post of posts) {
			if (!ns_biligame_announce_DDLEZJ_TAPTAP_ANNOUNCE_RE.test(post.title)) continue;
			const parsed = ns_biligame_announce_parseDdlezjTaptapText(post.text.split("\n"), tz);
			for (const x of parsed.items) {
				if (x.kind === "event") rows.push(x);
			}
		}
		// 第 1 页已经覆盖当前窗口 ⇒ 不再翻（更早的帖子只会更旧）
		if (rows.some((x) => coversNow(x, now))) break;
	}
	if (postCount === 0) throw new Error("taptap-topic:no-post");   // 有响应但一帖都没有 = 结构变了
	const best = ns_biligame_announce_pickDdlezjEvent(rows, now);
	if (!best) return null;                                     // 抓到公告但当期无覆盖 → 未公布
	return ns_biligame_announce_ddlezjEventPayloadOf(best, ns_biligame_announce_covering(rows, now, "event"), tz, now);
}
//#endregion

		// ── 条目 ──
		// 2026-11-13：**卡池侧置空**（`url: ""` = 未配置、不抓）—— SSR tab 页里没有卡池正文
		//   （「活动更新一览」帖只渲染成摘要卡），而能拿到卡池正文的 webapiv2 接口在 robots 的
		//   `Disallow` 路径下 ⇒ 只保留为手动备选 `altSources[0]`（标签逐字「TapTap（不可靠）」）。
		// 活动侧默认 = **tab 页 SSR**（允许路径，1 个请求）；旧的 webapiv2 活动链路不再注册为默认。
		// 原 B 站代理官方公告 API（自 2026-06 起冻结）两侧都保留为手动备选，抓取器键 `ddlezj-biligame`
		// （该源正文自标 UTC+9 ⇒ 抓取器自己钉 `+540`，不随条目 tz）。
		registerSource({
				id: "ddlezj",
				defaultHidden: false,
				// 条目 tz = TapTap 正文的墙钟口径（国服 UTC+8；正文里标过一次 `(UTC+8)`）
				tz: ns_biligame_announce_DDLEZJ_TAPTAP_TZ,
				name: "嘟嘟脸恶作剧",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/64/f0/21/64f02145-182e-857a-133c-8de0151425d9/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				// 卡池侧未配置：SSR 里没有卡池正文 ⇒ 不抓、面板写「未配置」（不是失败）。
				// ⚠️ 这里**不写 `source`**：设置页下拉的规则是「有 source 就给 source，否则 url 空
				// ⇒ 裸「未配置」」；留着「TapTap」会让用户以为卡池有源、实际一个请求都不发。
				url: "",
				eventUrl: ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL,
				eventSource: "TapTap",
				altSources: [
					// 手动备选 ①：webapiv2 的「列表 → 详情」卡池链（**违反 robots**，仅手动启用）
					{ label: "TapTap（不可靠）", url: ns_biligame_announce_ddlezjTaptapApiUrl(0), fetcher: "ddlezj-taptap-gacha" },
					// 手动备选 ②：旧的 B 站官方公告 API（源站已停更）
					{ label: "B站官方公告（停更）", url: ns_biligame_announce_DDLEZJ_LIST_URL, fetcher: "ddlezj-biligame" }
				],
				eventAltSources: [
					{ label: "B站官方公告（停更）", url: ns_biligame_announce_DDLEZJ_LIST_URL, fetcher: "ddlezj-biligame" }
				],
		});

		// ddlezj 卡池：默认键保留（老配置里的自定义地址仍可用），但注册项 `url` 已置空 ⇒ 默认不抓。
		// `ddlezj-taptap-gacha` = 手动备选源「TapTap（不可靠）」的键（同一条 webapiv2 链路）。
		// `ddlezj-biligame` = 旧 B 站公告（备选，tz 钉死 +540 —— 那份正文自标 UTC+9）。
		GACHA_FETCHERS["ddlezj"] = (url, signal, tz) => ns_biligame_announce_gachaDdlezjTaptap(url, signal, tz);
		GACHA_FETCHERS["ddlezj-taptap-gacha"] = (url, signal, tz) => ns_biligame_announce_gachaDdlezjTaptap(url, signal, tz);
		GACHA_FETCHERS["ddlezj-biligame"] = (url, signal) => ns_biligame_announce_gachaDdlezj(url, signal, ns_biligame_announce_DDLEZJ_TZ);

		EVENT_FETCHERS["ddlezj"] = Object.assign(EVENT_FETCHERS["ddlezj"] || {}, {
			// 默认 = tab 页 SSR（robots 允许的路径）；webapiv2 活动链路不再注册
			default: (url, signal, tz) => ns_biligame_announce_eventsDdlezjTopic(url, signal, tz),
			"ddlezj-biligame": (url, signal) => ns_biligame_announce_eventsDdlezj(url, signal, ns_biligame_announce_DDLEZJ_TZ)
		});
