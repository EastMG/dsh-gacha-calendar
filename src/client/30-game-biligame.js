// src/client/30-game-biligame.js —— biligame 官方公告系（嘟嘟脸恶作剧 / 闪耀优俊少女）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-biligame.js 的内容（原样保留；压平后见 30-game-biligame.js）══
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
//    ⇒ 本条目的**默认源已换成 TapTap 官方账号**（列表 → 详情；见本文件下方 `TapTap（2026-11-11 换源）`
//    region），这里的代码**保留**为备选源键 `ddlezj-biligame`（设置页可手动切回）。
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
// 给人看的那个页面：只用作 Referer + 文档里的取证地址（不解析它的 HTML）
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
async function ns_biligame_announce_eventsDdlezjTaptap(url, signal, tz = ns_biligame_announce_DDLEZJ_TAPTAP_TZ, now = nowMs()) {
	const ctx = await ns_biligame_announce_loadDdlezjTaptap(url, signal, tz, now);
	for (const { parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjEvent(parsed.items, now);
		if (!best) continue;
		return ns_biligame_announce_ddlezjEventPayloadOf(best, ns_biligame_announce_covering(parsed.items, now, "event"), tz, now);
	}
	return null;
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-biligame-activity.js（压平后见 30-game-biligame.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-biligame-activity.js（压平后见 30-game-biligame.js）
//
// 由 next-sources/parsers/biligame-activity.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_biligame-activity__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-biligame-activity.js（压平后见 30-game-biligame.js） —— biligame 官方公告（活动/卡池档期）
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover? }        （eventHover 缺省 = 当期只有 1 条）
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover? }
//   本文件服务两个游戏（同一套官方接口 api.biligame.com/news）：
//     ① 物华弥新 国服 —— **只做活动侧**（卡池侧仍用 B2 的 bwiki `限时招集档案`，见 registry-p9.js）
//     ② 闪耀优俊少女 国服 —— 卡池 + 活动两侧（**取代** B2 的 bwiki 推算表作主源）
//
//   ══ 悬停（hover）规则 —— 用户 2026-10-03 反馈「新增游戏的面板外显/悬停的样式、格式、规则
//      和原来的差别很大」，核实后确认三类偏差，本文件按「方案 A」全部修掉 ══
//     · 排版唯一真源 = `lib/env.js` 的 `hoverPool` / `hoverEvent`（压平后见 28-parser-hover-tools.js；与本体 buildPoolHover /
//       buildEventHover **逐字一致**），本文件**不自己拼字符串**、不排序（工具不排序，调用方排）。
//     · 活动侧 ≥2 条：每条一行「名称 + 3 空格 + 档期（fmtWindow）」，按结束时间升序；
//       只有 1 条 → 工具返回 "" → **不设** `eventHover`，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
//     · 卡池侧 ≥2 池：每池「池名：角色」⏎ 档期（窗口全同则档期只在末尾写一遍）；
//       只有 1 池 → 工具返回 "" → **不设** `bannerHover`，交回 UI 默认两行式（`banner：roles` ⏎ 档期）。
//     · 悬停里**只放名称与档期**：来源站名 / URL / API 名 / 时区推定说明 / 抓取统计 /
//       内部 id（gameExtensionId、typeId、post_id）/ 游戏名+区服前缀 / 任何「（…）」实现说明
//       一律**彻底不进悬停文本**（用户原话「元信息彻底删掉」）——只留在**代码注释**与
//       `parse*` 的返回字段里（供测试与排障），**不搬到别处、不写进别的字段**。
//       ⚠️ 例外：`bannerDatesRaw` / `eventDatesRaw` 照既有约定**保留源站原文**（本体也有条目这么做）。
//
// ── 为什么不再 import `biligame-announce.js`（原 next-sources 的嘟嘟脸解析器，已并入本文件；P6 嘟嘟脸，同形态）─────────────
//   思路/函数确实同源（列表 → 逐条详情 → 正文抽档期 → 挑覆盖 now 的窗口 → 抽不到就 null），
//   但历史上跨解析器 import 会被合并器的命名空间隔离打断（它给本文件的**声明**加 `ns_<file>_`
//   前缀，却不重命名"从别的解析器 import 进来的名字"）→ 生成物里会变成 `… is not defined`。
//   所以当时两个文件各自抄了一份 `decodeExtra` + 实体表。
//   ⚠️ 2026-10-03 更新：压平成 `src/client/` 普通源码段后**不再有命名空间合并器**，
//   而那两份 `ENT_EXTRA` / `decodeExtra` / `plain` **函数体逐字节相同、表互为子集** ——
//   已统一到 `27-parser-text.js` 的 `decodeExtra` / `htmlText` / `htmlTextTight`（并集表）。
//   本条历史记录保留，因为"跨文件同名/同源"这个坑值得记住。
//
// ══ 接口实测形态（2026-10-02 抓夹具）════════════════════════════════════════
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=<id>&positionId=2&typeId=<t>&pageNum=1&pageSize=50
//   → { request_id, data:[…], totalNum, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断), createTime, modifyTime }
//   ⚠️ `positionId=2` **必填**（省略返回空）；条目里 `displayTime` **可能缺**（实测物华弥新
//      typeId=4 有 5/36 条没有、typeId=1 有 10/17 条没有）→ 排序键必须退到 `ctime`。
//   ⚠️ 列表里的 `content` 是**截断**的 → 正文档期只能抓详情 `/news/{id}`。
// 详情：GET https://api.biligame.com/news/<id>
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   夹具里 `data.site` / `data.gameExtensionId` 是**独立印证**：
//     18419 → site=物华弥新 gid=613 ；18426 → site=闪耀！优俊少女 gid=1006 。
//
// ══ ① 物华弥新 国服（gameExtensionId=613）══════════════════════════════════
//   ⚠️⚠️ **两路 typeId 都要拉，缺一会丢档期**（实测）：
//     typeId=4（`typeName=活动`）totalNum=36，最新 2026-09-30 id=18419「经以山海」限时活动开启
//     typeId=1（`typeName=公告`）totalNum=17，**最新 2026-09-10 id=18334「无稽妄语」限时活动开启**
//       —— 18334 这条**不在 typeId=4 里**（两路 id 集合实测**零重叠**：36 ∩ 17 = ∅）
//   合并规则：按 id 去重 + 按 `displayTime||ctime` 严格倒序（实测合并后前 6 条 =
//   18419 / 18334 / 18265 / 18194 / 18109 / 18047，夹具都抓了前 5 条详情）。
//
//   ══ 正文档期形态（**注意：与任务书里的猜测不同，这里是实测原文**）══
//     `活动时间：9月23日 10:00 ~ 10月22日 09:59`      ← **不带年份、用「月日」**
//     `活动时间：9月30日 10:00 ~ 常驻`                 ← 终点是「常驻」= 无终点 → **不产出**
//     标题与档期**不在同一段**：`<p>一、旅程将启-经以山海</p>` + `<p>活动时间：…</p>`
//     ⇒ 按 `</p>` 切段后，用小节标题（`一、…`）+ 紧随其后的 `活动时间：` 行配对。
//     年份推断：源站只写「月日」→ 取**该公告 displayTime 的年份**；起月比发布月大 6 个月以上
//     视为上一年（跨年公告），终点若比起点早就 +1 年。（夹具里所有窗口都同年，无需跨年。）
//     kind：小节标题含 `招集|招募|引介|卡池|扭蛋` → 卡池侧，其余 → 活动侧（本文件活动侧只用后者）。
//
//   ══ 外显取哪一条？══
//     同一份公告里有十几条「活动时间」（登录活动、主线活动、试炼场、衣装…全都叫「活动时间」）。
//     规则：① 覆盖 now 优先；② 小节名与**标题里引号中的活动名**完全一致者优先
//     （18419 标题「经以山海」限时活动开启 → 小节`四、经以山海`；18334 → 小节`二、无稽妄语`），
//     ③ 其次结束最早；④ 并列按文档顺序。⇒ 取到的是本期**主线活动**，而不是最早结束的登录活动。
//
// ══ ② 闪耀优俊少女 国服（gameExtensionId=1006）══════════════════════════════
//   ⚠️ **只有单一 feed（typeId=1）且卡池/活动混排**（totalNum=671，一页 50）。
//     `typeId=4`（活动专类）实测**已停更**（13 条，停在 2026-04-19）→ **不用它**。
//   标题分流（任务书口径）：
//     卡池 = 标题含 `招募` / `扭蛋` / `必得`（先判卡池：`…庆典招募开放！` 里也含「活动」字样）
//     活动 = 标题含 `活动` / `赛事` / `剧情` / `举办`
//     两者都不含 → **跳过**（如`养成剧本…开放！`/`部分养成优俊少女追加进化技能！`），不抓详情。
//   ⚠️ 正文档期形如：`10/2 12:00 ～ 10/13 11:59`（**全角波浪 `～`**、**不带年份**、**月/日**），
//     且**标签常与前一段或同段共存**：
//       <p>精选招募开放期间</p><p>10/2 12:00 ～ 10/13 11:59</p>      ← 上一段是标签
//       <p>活动期间 10/1 12:00 ～ 10/711:59</p>                      ← 同段；⚠️ 源站**少了一个空格**
//     ⇒ 标签取「同段内窗口之前的文字」，空则退回「上一段非窗口段」。
//     ⚠️ 实测源站笔误 `10/711:59`（18423 活动期间）：日期与时刻**粘连**。本解析器用
//        `ns_biligame_activity_deglueDateTimes()` 归一成 `10/7 11:59`，并记 `glued:true` + `rawNorm`（供测试与排障）。
//        ⚠️ 这条说明**只留在这里**：旧版曾把它拼成一个「（源站原文…粘连…）」括号注进悬停 → 已删。
//     外显挑选：同一条公告里常有多个「…期间」（活动期间 / 奖励领取期间 / 报名期间 / 第N轮…）→
//       卡池侧优先标签含`招募`的窗口，活动侧优先`活动期间`，其次含`期间|时间`，最后其它；同级结束早者先。
//
// ══ 时区 tz = Asia/Shanghai（**推测，但有逐字交叉印证**）════════════════════
//   源站**不标时区**。交叉印证：公告 `displayTime`（B 站 CMS 发布时刻）与正文档期墙钟**逐字一致**：
//     · 18419 displayTime=2026-09-30 10:00:00 ↔ 正文`活动时间：9月30日 10:00 ~ …`
//     · 18426 displayTime=2026-10-02 12:00:00 ↔ 正文`10/2 12:00 ～ 10/13 11:59`
//   ⇒ 正文墙钟与 CMS 同一口径；B 站 CMS 为 UTC+8 → 记 Asia/Shanghai。（仍是**推定**，不是源站声明。）
//   绝对时刻一律走 `sourceInstant(...)`，文本一律走 `fmtWindow(...)`（源站墙钟原文不重解释）。
//
// ══ EdgeOne/抓取注意 ══
//   `api.biligame.com` **无 ACAO**（调研实测）→ mode 一律 "proxy"，**不可 direct**。
//   抓夹具时别并发太猛（列表+详情共 11 次请求，实测每 7~9 秒一发全部 HTTP 200）。


const ns_biligame_activity_BILIGAME_ACTIVITY_TZ = "Asia/Shanghai";
const ns_biligame_activity_WHMX_GAME_EXTENSION_ID = 613;
const ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID = 1006;
// 物华弥新：4=活动专类 / 1=公告（两路 id 实测零重叠，缺一路就丢档期）
const ns_biligame_activity_WHMX_TYPE_IDS = [4, 1];
const ns_biligame_activity_WHMX_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, ns_biligame_activity_WHMX_TYPE_IDS[0]);
// 两路 URL（注册表只声明主 URL=typeId 4；解析器会自行派生 typeId 1 那路，见 ns_biligame_activity_whmxListUrls()）
const ns_biligame_activity_WHMX_LIST_URLS = ns_biligame_activity_WHMX_TYPE_IDS.map((t) => ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, t));
const ns_biligame_activity_UMA_CN_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID, 1);
const ns_biligame_activity_WHMX_HOME = "https://game.bilibili.com/whmx/";
const ns_biligame_activity_UMA_CN_HOME = "https://game.bilibili.com/umamusume/";
// 逐条往下抓详情的上限（公告很稀疏：一天最多 1~2 篇，但档期藏在正文里）
const ns_biligame_activity_DETAIL_LIMIT_WHMX = 6;
const ns_biligame_activity_DETAIL_LIMIT_UMA = 8;

// 列表 URL 构造：positionId=2 **必填**（实测省略返回空），pageSize=50 足够（两游戏都 < 700 且只取最新的）
function ns_biligame_activity_biligameListUrl(gameExtensionId, typeId, pageSize = 50) {
	return `https://api.biligame.com/news/list?gameExtensionId=${gameExtensionId}`
		+ `&positionId=2&typeId=${typeId}&pageNum=1&pageSize=${pageSize}`;
}
// 同一参数空间里换另一路 typeId（物华弥新两路都拉）——只改 typeId，其余参数原样，保证
// 「夹具 URL ⇄ 解析器实际请求的 URL」字符串完全一致（离线夹具按整串命中）
function ns_biligame_activity_siblingListUrl(listUrl, typeId) {
	try {
		const u = new URL(listUrl);
		u.searchParams.set("typeId", String(typeId));
		return u.toString();
	} catch {
		return ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, typeId);
	}
}
function ns_biligame_activity_whmxListUrls(listUrl = ns_biligame_activity_WHMX_LIST_URL) {
	const primary = listUrl || ns_biligame_activity_WHMX_LIST_URL;
	let t = ns_biligame_activity_WHMX_TYPE_IDS[0];
	try { t = Number(new URL(primary).searchParams.get("typeId")) || t; } catch { /* keep */ }
	const other = ns_biligame_activity_WHMX_TYPE_IDS.find((x) => x !== t) || t;
	const out = [primary];
	const second = ns_biligame_activity_siblingListUrl(primary, other);
	if (second !== primary) out.push(second);
	return out;
}
function ns_biligame_activity_biligameDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_activity_WHMX_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

// 按 </p> 切段（公告正文的每个逻辑单元都是 <p>；textOf 的行会把多段粘一起，不能用）
function ns_biligame_activity_biligameParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => htmlText(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 悬停排版（**只有名称与档期**，见文件头「悬停规则」）
// 本区域只做两件事：① 从「覆盖 now 的档期」里取出名称；② 按结束时间升序排好交给共用工具。
// 排版（3 空格 / 档期格式化 / 窗口全同只写一遍 / <2 条返回 ""）**全在 lib/env.js**（压平后见 28-parser-hover-tools.js），这里绝不自拼。
//
// ⚠️ 为什么这里有注释而悬停里没有：来源/URL/tz 推定/抓取条数/内部 id 都是**排障信息**，
//    用户明确要求「元信息彻底删掉」→ 只留在代码注释与 `parse*` 的返回字段（skipped / section /
//    label / raw…）里，**不搬到别处、不写进别的字段**。
// ⚠️ 「常驻不产出」「源站日期与时刻粘连」这类**实现说明**同样不进悬停（旧版曾拼在 hover 里）。
function ns_biligame_activity_byEndAsc(a, b) { return (a.endTs - b.endTs) || (a.startTs - b.startTs); }
// 覆盖 now 的档期 → 悬停行（`name` 由调用方给的 nameOf 决定；空名行直接丢弃，不硬造占位名）
function ns_biligame_activity_hoverRows(covering, nameOf) {
	return (covering || [])
		.slice()
		.sort(ns_biligame_activity_byEndAsc)
		.map((x) => {
			const name = String(nameOf(x) || "").trim();
			// `name` 给 hoverPool 用（它的过滤/显示读 name），`title` 给**条目反生成**与数组收口用
			// （`dataArrayExtrasFromEntriesOf` 读 title/label）—— 同一行两种形状，值相同。
			return name ? { name, title: name, startTs: x.startTs, endTs: x.endTs, raw: x.raw } : null;
		})
		.filter(Boolean);
}
// ① 物华弥新 活动侧：名称 = 源站小节名（`四、经以山海` → `经以山海`），缺小节时退回段落标签
// ⚠️ P5 清理（2026-11-08）：原来这里还有三个只给测试用的包装
// （`ns_biligame_activity_whmxEventHover` / `umaCnEventHover` / `umaCnPoolHover`）——
// 它们各自只是 `hoverEvent/hoverPool(hoverRows(covering, nameOf), tz)` 的一句，生产调用方
// 早就改成直接 `hoverRows(...)` + `dataArrayProduced*Of` 了。名字投影（nameOf）现在写在各调用点
// 与回归里，包装层已删。
//#endregion

//#region 列表
// 列表 JSON → [{ id, title, typeId, displayTime, ctime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_activity_parseBiligameList(json) {
	if (!json || typeof json !== "object") throw new Error("biligame-bad-json");
	if (json.code !== 0) throw new Error("biligame-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("biligame-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测大量条目缺 displayTime → 退 ctime
			return {
				id: x.id,
				title: decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				sortKey,
				dateTs: ns_biligame_activity_parseCmsStamp(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
// "2026-09-30 10:00:00"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_activity_parseCmsStamp(s, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
// 多路 feed 合并：按 id 去重（先到先得）+ 严格倒序（实测两路 id 零重叠，但去重仍必要）
function ns_biligame_activity_mergeBiligameLists(groups) {
	const seen = new Set();
	const out = [];
	for (const g of groups || []) {
		for (const it of g || []) {
			if (seen.has(it.id)) continue;
			seen.add(it.id);
			out.push(it);
		}
	}
	return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
//#endregion

//#region 档期抽取：源站墙钟（月日、可能缺年份）→ 窗口
// ⚠️ 实测源站笔误：`10/711:59`（日期与时刻粘连，见 18423 活动期间）。
//    只处理「日期数字 ≥3 位且紧跟 HH:MM」的形态（正常运行写法 `10/7 11:59` / `9月23日 10:00` 不受影响），
//    按「末 2 位为小时」优先切分（`711` → 7 日 11 时），若日不合法再试「末 1 位为小时」。
//    ins（可选）：收集插入的空格位置，供 `raw` 回到**源站原文**（契约要求 raw 保留原文）。
const ns_biligame_activity_GLUE_RE = /([\/\-.]|月|日)(\d{2,4})\s*[:：]\s*(\d{2})/g;
function ns_biligame_activity_deglueDateTimes(s, ins = null) {
	const src = String(s == null ? "" : s);
	let out = "", last = 0;
	ns_biligame_activity_GLUE_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_GLUE_RE.exec(src)) !== null) {
		if (m[0] === "") { ns_biligame_activity_GLUE_RE.lastIndex++; continue; }
		const run = m[2];
		if (run.length < 3) continue;                 // 正常写法（`日 10:00` / `10:00`）→ 原样
		let day = null, hour = null;
		const d2 = run.slice(0, run.length - 2), h2 = run.slice(-2);
		if (d2 !== "" && +d2 >= 1 && +d2 <= 31 && +h2 <= 23) { day = d2; hour = h2; }
		else {
			const d1 = run.slice(0, run.length - 1), h1 = run.slice(-1);
			if (d1 !== "" && +d1 >= 1 && +d1 <= 31 && +h1 <= 23) { day = d1; hour = h1; }
		}
		if (day == null) continue;
		out += src.slice(last, m.index) + m[1] + day;
		if (ins) ins.push({ normIndex: out.length, srcIndex: m.index + m[1].length + run.length });
		out += " " + hour + ":" + m[3];
		last = m.index + m[0].length;
	}
	return out + src.slice(last);
}
// 归一化坐标 → 源站坐标（因为只插入了空格，逐个抵消即可）
function ns_biligame_activity_toSourceRange(normStart, normEnd, ins) {
	let s = normStart, e = normEnd;
	for (const p of ins) {
		if (p.normIndex < normStart) s--;
		if (p.normIndex < normEnd) e--;
	}
	return { s, e };
}
// 令牌表：① 完整「日期+时刻」 ② 只有日期（止点缺时刻时兜底） ③ 区间分隔符 ④ 「常驻/永久」= 无终点
//   日期形态涵盖实测两种：`9月23日 10:00`（无年）与 `2026/09/30 10:00`（带年）
const ns_biligame_activity_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|永久)"
].join("|"), "g");
function ns_biligame_activity_tokenizeWindows(text) {
	const out = [];
	ns_biligame_activity_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_TOK_RE.exec(text)) !== null) {
		if (m[0] === "") { ns_biligame_activity_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) out.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) out.push(t);
		} else if (g.sep != null) {
			out.push({ kind: "sep", text: g.sep, at, end });
		} else if (g.perm != null) {
			out.push({ kind: "perm", text: g.perm, at, end });
		}
	}
	return out;
}
// 一段文本 → { norm, windows:[{ startTs, endTs, raw(源站原文), rawNorm(归一化后), glued, perm? }] }
//   · 起点必须带时刻（令牌 ①）  · 终点可以是时刻/日期（缺时刻 → 23:59）/「常驻」
//   · 年份抽不出来（源站无年份且公告也没年份）→ 该窗口进 skipped，不产出
function ns_biligame_activity_extractWindowsDetailed(text, yearHint, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const src = String(text == null ? "" : text);
	const ins = [];
	const norm = ns_biligame_activity_deglueDateTimes(src, ins);
	const glued = ins.length > 0;
	const toks = ns_biligame_activity_tokenizeWindows(norm);
	const windows = [], skipped = [];
	const rawOf = (a, b) => {
		const r = ns_biligame_activity_toSourceRange(a.at, b.end, ins);
		return { src: src.slice(r.s, r.e).trim(), norm: norm.slice(a.at, b.end).trim() };
	};
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raws = rawOf(a, b);
		const y1 = inferYear(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "no-year" }); i += 2; continue; }
		if (b.kind === "perm") {
			skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "perm" });   // 「常驻」= 无终点 → 不产出
			i += 2;
			continue;
		}
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const h1 = a.h, mi1 = a.mi;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;
		const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw: raws.src, rawNorm: raws.norm, glued, at: a.at, end: b.end });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

//#region ① 物华弥新 活动正文档期
// 小节标题 `一、旅程将启-经以山海` / `十三、试炼场`
const ns_biligame_activity_WHMX_SECTION_RE = /^[一二三四五六七八九十百]+\s*[、.．]\s*(.+)$/;
// 小节名含这些词 → 卡池侧（本文件活动侧不用；保留 kind 便于测试断言）
const ns_biligame_activity_GACHA_SEC_RE = /招集|招募|引介|卡池|扭蛋/;
const ns_biligame_activity_WHMX_LABEL_RE = /^([^\s：:]{2,12})\s*[：:]/;
// 正文 HTML → { items:[{ name, section, label, startTs, endTs, raw, glued, kind }], skipped, paragraphs }
function ns_biligame_activity_parseWhmxActivity(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let section = "";
	for (const para of paragraphs) {
		const sec = ns_biligame_activity_WHMX_SECTION_RE.exec(para);
		if (sec) { section = sec[1].trim(); continue; }     // 标题独占一段（实测）
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, section });
			continue;
		}
		const labelM = ns_biligame_activity_WHMX_LABEL_RE.exec(para);
		const label = labelM ? labelM[1] : "";
		for (const w of windows) {
			items.push({
				name: section || label,
				section,
				label,
				startTs: w.startTs,
				endTs: w.endTs,
				raw: w.raw,
				rawNorm: w.rawNorm,
				glued: w.glued,
				kind: ns_biligame_activity_GACHA_SEC_RE.test(section) ? "gacha" : "event"
			});
		}
		for (const s of sk) skipped.push({ ...s, section });
	}
	return { items, skipped, paragraphs };
}
//#endregion

//#region ② 闪耀优俊少女 正文/标题
// 标题分流：卡池（招募/扭蛋/必得）优先；其次活动（活动/赛事/剧情/举办）；都不含 → null（跳过，不抓详情）
const ns_biligame_activity_UMA_GACHA_RE = /招募|扭蛋|必得/;
const ns_biligame_activity_UMA_EVENT_RE = /活动|赛事|剧情|举办/;
function ns_biligame_activity_classifyUmaCnTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_biligame_activity_UMA_GACHA_RE.test(t)) return "gacha";
	if (ns_biligame_activity_UMA_EVENT_RE.test(t)) return "event";
	return null;
}
// 正文 HTML → { items:[{ name:标签, label, startTs, endTs, raw, glued }], skipped, paragraphs }
//   标签：同段内窗口之前的文字（`活动期间 10/1 12:00 ～ …`）→ 空则退回上一段非窗口段
function ns_biligame_activity_parseUmaCnAnnouncement(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let prevLabel = "";
	for (const para of paragraphs) {
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, label: prevLabel });
			// 记录「可能是标签」的短段（供下一段的窗口使用）：实测标签形如
			// `精选招募开放期间` / `开放期间` / `活动期间` / `角色剧情开放期间` → 需含 期间|时间 等词
			if (para.length <= 24 && !/[。！？，,；;：:]/.test(para) && /期间|时间|开放|活动/.test(para)) prevLabel = para;
			continue;
		}
		for (const w of windows) {
			const head = norm.slice(0, w.at).replace(/^[※·・\-—\s]+/, "").replace(/[：:]\s*$/, "").trim();
			const label = head || prevLabel;
			items.push({ name: label || "（无标签）", label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawNorm: w.rawNorm, glued: w.glued });
		}
		for (const s of sk) skipped.push({ ...s, label: prevLabel });
	}
	return { items, skipped, paragraphs };
}
// 外显挑选：卡池侧优先标签含`招募`；活动侧优先`活动期间`，其次含`期间|时间`，最后其它细分期间。
// 同级取结束最早，并列按文档顺序。（实测：18425 活动期间 / 18423 活动期间 都是 rank0）
function ns_biligame_activity_pickUmaWindow(items, now, want) {
	const act = (items || []).filter((x) => coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		const l = String(x.label || "");
		if (want === "gacha") return /招募/.test(l) ? 0 : 1;
		if (/^(活动期间|活动时间)/.test(l)) return 0;
		if (/期间|时间/.test(l)) return 1;
		return 2;
	};
	return act.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || (a.w.endTs - b.w.endTs) || (a.i - b.i))[0].w;
}
// UP 角色/协助卡名（可选字段）：只认 `★★★ [系列名]角色名` 这种明确行（协助卡列表没有 ★★★ → 不产出）
function ns_biligame_activity_umaRoles(paragraphs) {
	const out = [];
	for (const p of paragraphs || []) {
		const m = /^★★★\s*(?:\[[^\]]*\]|【[^】]*】)?\s*([^\s（(＜【\[]+)/.exec(p);
		if (m && m[1] && !out.includes(m[1])) out.push(m[1]);
		if (out.length >= 6) break;
	}
	return out;
}
//#endregion

//#region 文字清洗 / 标题里的活动名
// 标题清洗：去掉尾部的动作尾巴（`开放！`/`即将开放！`/`举办中！`/`开启`…），保留活动/卡池名
const ns_biligame_activity_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|现已|正在|已)?(?:开放|开启|举办|登场|上线|开始|结束|预告|推出)[中]?[！!。]?\s*$/;
function ns_biligame_activity_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_biligame_activity_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
// 标题里引号中的活动名：`「经以山海」限时活动开启` → 经以山海
// （物华弥新用它把外显锁定到本期主线活动小节，而不是最早结束的登录活动）
function ns_biligame_activity_quotedName(title) {
	const m = /[「“"【]([^」”"】]{2,14})[」”"】]/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}
//#endregion

//#region 物华弥新 外显挑选 / 抓取器
function ns_biligame_activity_pickWhmxEvent(items, now, preferName = "") {
	const act = (items || []).filter((x) => x.kind === "event" && coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		if (!preferName) return 1;
		if (x.section === preferName) return 0;
		if (x.section.includes(preferName)) return 1;
		return 2;
	};
	return act.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 选当期事件：**直接用共用 pickCovering**（覆盖 now + kind 过滤 + 按开始时间升序）
function ns_biligame_activity_coveringWhmxEvents(items, now) {
	return pickCovering(items, { now, kind: "event", sort: (a, b) => (a.startTs - b.startTs) || 0 });
}
// ⚠️ 曾经这里有 `WHMX_TZ_NOTE`（时区推定说明）与 `skipNote()`（「常驻不产出」说明），两者都只用于
//    拼旧悬停 → 用户要求「元信息彻底删掉」后**已整体删除**（时区推定的依据仍在文件头 ① 的交叉印证里，
//    「常驻」为何不进 items 仍在 `ns_biligame_activity_extractWindowsDetailed` 的注释与 `skipped[].reason` 里）。
function ns_biligame_activity_yearHintOf(item, tz) {
	const ts = item && item.dateTs != null ? item.dateTs : null;
	return ts == null ? null : sourceWallParts(ts, tz);
}
// 活动侧抓取器（契约：async (url, signal, tz, now = nowMs()) → 对象 | null）
//   两路 typeId（4 与 1）**都拉** → 合并去重倒序 → 逐条抓详情（≤6 篇）→ 正文抽档期 → 挑覆盖 now 的
//   · 抓到公告但没有任何覆盖 now 的活动档期 → null（未公布）
//   · 所有详情请求都失败 → 抛错（不能把「源站挂了」静默降级成「未公布」）
//   · 一路 feed 失败且最终没找到覆盖 now 的档期 → 抛错（此时不能声称「未公布」）
async function ns_biligame_activity_eventsWhmxOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const listUrl = url || ns_biligame_activity_WHMX_LIST_URL;
	const merged = [];
	const feedErrors = [];
	let okFeeds = 0;
	for (const u of ns_biligame_activity_whmxListUrls(listUrl)) {
		try {
			const items = ns_biligame_activity_parseBiligameList(await fetchJson(u, { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" }));
			merged.push(items);
			okFeeds++;
		} catch (e) {
			feedErrors.push(e);
		}
	}
	if (okFeeds === 0) throw feedErrors[0];
	const list = ns_biligame_activity_mergeBiligameLists(merged);
	if (!list.length) return null;                     // 两路都是空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_WHMX)) {
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const title = decodeExtra(d.title || it.title || "").replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseWhmxActivity(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickWhmxEvent(parsed.items, now, ns_biligame_activity_quotedName(title));
		if (!best) continue;
		// 悬停 = 覆盖 now 的全部活动档期，逐行「小节名 + 3 空格 + 档期」（**条目反生成**，按结束时间升序）。
		// 只有 1 条 → 生成器返回 "" → **不设** eventHover，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=613，typeId=4/1…
		// 共 N 篇）」「物华弥新 国服 · 标题 + tz 推定」「▶ 标出外显那条」「另有 N 条常驻不产出」
		// 全部是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────
		const eventItems = ns_biligame_activity_hoverRows(ns_biligame_activity_coveringWhmxEvents(parsed.items, now), (x) => x.section || x.label);
		const eventHover = hoverTextFromItems(eventItems, "event", tz);
		const eventDates = fmtWindow(best.startTs, best.endTs, tz);
		const out = {
			event: ns_biligame_activity_cleanTitle(title) || best.section || best.label,
			eventDates,
			eventDatesRaw: best.raw,
			...(eventHover ? { eventHover } : {})
		};
		out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
		out.eventHoverItems = eventItems;
		return out;
	}
	if (loaded === 0 && firstErr) throw firstErr;
	if (feedErrors.length) throw feedErrors[0];        // 一路 feed 失败 → 不能声称「未公布」
	return null;
}
//#endregion

//#region 闪耀优俊少女 抓取器（卡池 + 活动，同一 feed 靠标题分流）
// 单一 feed（typeId=1）→ 逐条往下（≤8 篇）→ 标题分流 → 只抓**本侧相关**的详情 → 正文抽档期
async function ns_biligame_activity_loadUmaCn(url, signal, tz, now, want) {
	const listUrl = url || ns_biligame_activity_UMA_CN_LIST_URL;
	const list = ns_biligame_activity_parseBiligameList(await fetchJson(listUrl, { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;                     // 空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_UMA)) {
		const title = decodeExtra(it.title || "").replace(/\s+/g, " ").trim();
		if (ns_biligame_activity_classifyUmaCnTitle(title) !== want) continue;   // 标题分流：不相关的不抓详情（省请求）
		tried++;
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const dt = decodeExtra(d.title || title).replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseUmaCnAnnouncement(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickUmaWindow(parsed.items, now, want);
		if (!best) continue;
		// 覆盖 now 的全部期间（**当期判定不变**，与旧版同一集合），按结束时间升序排好供悬停排版。
		// 悬停文本由调用方按侧拼（卡池 `hoverPool` / 活动 `hoverEvent`）——本函数不再返回 hover，
		// 因为两侧排版不同（卡池要「池名：角色」+ 每池两行），旧版共用一份 hover 正是偏差来源之一。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=1006，单一 feed
		// typeId=1 卡池/活动混排，按标题分流）」「闪耀！优俊少女 国服 · 标题 + tz 推定」「▶ 支线」
		// 与「源站原文粘连 → 按 … 解析」全是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const active = parsed.items
			.filter((x) => coversNow(x, now))
			.sort(ns_biligame_activity_byEndAsc);
		return { title: dt, best, active, roles: want === "gacha" ? ns_biligame_activity_umaRoles(parsed.paragraphs) : [] };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全都失败 → 抛错
	return null;
}
// 卡池侧
async function ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, active, roles } = hit;
	const banner = ns_biligame_activity_cleanTitle(title) || best.label;
	const rolesText = roles.join("、");
	// 悬停 = 全部当期池（每池「池名：角色」+ 档期）；只有 1 个当期池 → "" → **不设** bannerHover，
	// 交回 UI 默认两行式（`banner：roles` ⏎ `bannerDates`）。
	// ── P3b：条目事实 → 悬停 + `gacha` 数组 ──────────────────────────────────
	const poolItems = ns_biligame_activity_hoverRows(active, (x) => `${x.label || banner}${rolesText ? `：${rolesText}` : ""}`);
	const bannerHover = hoverTextFromItems(poolItems, "gacha", tz);
	const out = {
		banner,
		roles: rolesText,
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, poolItems, { tz }, now);
	out.gachaHoverItems = poolItems;
	return out;
}
// 活动侧
async function ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, active } = hit;
	const event = ns_biligame_activity_cleanTitle(title) || best.label;
	// 悬停 = 全部当期期间，逐行「期间名 + 3 空格 + 档期」（档期由 fmtWindow 格式化：源站粘连笔误
	// `10/711:59` 在这里如实显示为 `10-07 11:59`）；只有 1 条 → "" → **不设** eventHover。
	// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────────
	const eventItems = ns_biligame_activity_hoverRows(active, (x) => x.label || event);
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}
//#endregion

		// ── 条目 ──
		// 2026-11-11 换源：卡池/活动两侧默认 = **TapTap 官方账号（国服）的列表 → 详情**；
		// 原 B 站代理官方公告 API（self 2026-06 起冻结）降为 `altSources` / `eventAltSources` 的手动备选，
		// 抓取器键保留为 `ddlezj-biligame`（该源正文自标 UTC+9 ⇒ 抓取器自己钉 `+540`，不随条目 tz）。
		registerSource({
				id: "ddlezj",
				defaultHidden: true,
				// 条目 tz = TapTap 正文的墙钟口径（国服 UTC+8；正文里标过一次 `(UTC+8)`）
				tz: ns_biligame_announce_DDLEZJ_TAPTAP_TZ,
				name: "嘟嘟脸恶作剧",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/64/f0/21/64f02145-182e-857a-133c-8de0151425d9/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: ns_biligame_announce_ddlezjTaptapApiUrl(0),
				source: "TapTap",
				eventUrl: ns_biligame_announce_ddlezjTaptapApiUrl(0),
				eventSource: "TapTap",
				altSources: [
					{ label: "B站官方公告（停更）", url: ns_biligame_announce_DDLEZJ_LIST_URL, fetcher: "ddlezj-biligame" }
				],
				eventAltSources: [
					{ label: "B站官方公告（停更）", url: ns_biligame_announce_DDLEZJ_LIST_URL, fetcher: "ddlezj-biligame" }
				],
		});

		registerSource({
				id: "uma-cn",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "闪耀！优俊少女",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/23/bc/ca23bc1f-5dff-c21a-1881-66c48d02f5b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
				altSources: [{"label":"Bwiki 简中社区推算卡池","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2","fetcher":"uma-cn-bwiki"}],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["uma-cn"] = (url, signal, tz) => ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz);
		// ddlezj：默认 = TapTap；`ddlezj-biligame` = 旧 B 站公告（备选，tz 钉死 +540 —— 那份正文自标 UTC+9）
		GACHA_FETCHERS["ddlezj"] = (url, signal, tz) => ns_biligame_announce_gachaDdlezjTaptap(url, signal, tz);
		GACHA_FETCHERS["ddlezj-biligame"] = (url, signal) => ns_biligame_announce_gachaDdlezj(url, signal, ns_biligame_announce_DDLEZJ_TZ);
		EVENT_FETCHERS["uma-cn"] = Object.assign(EVENT_FETCHERS["uma-cn"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz) });
		EVENT_FETCHERS["ddlezj"] = Object.assign(EVENT_FETCHERS["ddlezj"] || {}, {
			default: (url, signal, tz) => ns_biligame_announce_eventsDdlezjTaptap(url, signal, tz),
			"ddlezj-biligame": (url, signal) => ns_biligame_announce_eventsDdlezj(url, signal, ns_biligame_announce_DDLEZJ_TZ)
		});
		GACHA_FETCHERS["uma-cn-bwiki"] = (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz);
