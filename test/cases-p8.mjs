// next-sources/test/cases-p8.mjs —— 批次 P8 离线夹具测试
//   ① 战双帕弥什（SMW ask 索引 → 最新「版本更新公告」wikitext 正文抽档期）
//   ② 卡厄斯梦境（`Module:Gacha/data` 的 Lua 表）
//   ③ 雪松（`Template:首页游戏版本内容` 的 `{{时间进度条}}` 模板调用）
//
// 六条原则（照合并前的 CONVENTIONS.md 与 cases-b1/b3/p6）：
//   ① 全程离线：`useFixtures(OVERRIDES)` 注入夹具 fetch；纯函数测试直接读 fixtures/*/response.txt。
//   ② 确定性：「当前时刻」一律用**夹具抓取时刻**（meta.capturedAt）或**显式注入的 now**，
//      绝不用 Date.now() —— 否则一个月后"当期"变了会**假失败**。
//   ③ 每个抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断 test/all.mjs。
//   ④ 断言里的硬编码值都是**夹具快照值**（重抓夹具后需同步更新），并标注推导过程。
//   ⑤ `now` 一律传**第 4 个参数**，并显式验证"过期 → null"（证明 now 真的生效，不是摆设）。
//   ⑥ 悬停断言按**方案 A**（用户 2026-10-03「元信息彻底删掉」）：只断言「本体同格式」+「不含元信息」，
//      **不再**断言旧文本（来源站名/SMW 时间/tz 推定/抓取条数/起点锚点/档期在前）。见 P8-5 的两条全局守卫。
//
// 本地直接跑：node test/cases-p8.mjs

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, assertHoverConvention, setFetchImpl, summary } from "./harness.mjs";
const { sourceInstant, sourceWallParts, fmtWindow, hoverPool, hoverEvent } = T;
import { SOURCES_P8, findSourceP8, listIdsP8 } from "./registry-shim.mjs";
import { T } from "./load.mjs";

const { mediaWikiWikitext, parseZspmsAsk, zspmsNormalize, zspmsMaintenanceWindow, parseZspmsAnnouncement, gachaZspms, eventsZspms, zspmsParseUrl, zspmsNameAt, zspmsHeadings, parseCznLua, parseCznRecord, cznStamp, gachaCzn, kedrTemplateCalls, kedrStamp, kedrIsGacha, kedrIsEvent, kedrRoleFromName, parseKedrTemplate, gachaKedrTemplate, eventsKedrTemplate, kedrTemplateUrl, ZSPMS_TZ, ZSPMS_ASK_URL, ZSPMS_ASK_QUERY, ZSPMS_FLAGS_URL, ZSPMS_FLAGS_PAGE, parseZspmsFlags, gachaZspmsFlags, ZSPMS_CALENDAR_URL, ZSPMS_CALENDAR_PAGE, parseZspmsCalendar, eventsZspmsCalendar, CZN_TZ, CZN_MODULE_URL, CZN_MODULE_PAGE, CZN_RECORD_URL, KEDR_TZ, KEDR_TEMPLATE_URL, KEDR_TEMPLATE_PAGE } = T.parsers["bwiki-wikitext"];
const { ZSPMS_CDN_MENU_URL, ZSPMS_CDN_ARTICLE_BASE, ZSPMS_CDN_MAX_NOTICES, ZSPMS_CDN_TZ, eventsZspmsCdn, zspmsCdnActivitiesOfArticle, zspmsCdnArticleOf, zspmsCdnArticleUrl, zspmsCdnCleanName, zspmsCdnHintOf, zspmsCdnIsGenericName, zspmsCdnMenuRows, zspmsCdnNoticesOf, zspmsCdnTitleName, zspmsCdnWindowsOfLine } = T.parsers["zspms-official"];

// ── 夹具读取 ──
const fxText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const fxJson = (p) => JSON.parse(fxText(p));
const fxMeta = (p) => JSON.parse(fxText(p + ".meta.json"));

// 夹具快照值（重抓需同步）：SMW ask 命中的最新版本公告页名
const ZSPMS_LATEST_PAGE = "《远信回响》版本更新公告";

// 夹具覆盖：URL → fixtures/<name>/response.txt（**显式写死**，不只依赖多人共写的 test/map.json）
// 官方 CDN（2026-11-11 接入的活动侧默认源）：菜单 + 最近 3 篇「版本更新公告」详情
const CDN_ART_IDS = [5682, 5467, 5306];
const OVERRIDES = {
	[ZSPMS_ASK_URL]: "p8-zspms-ask/response.txt",
	[zspmsParseUrl(ZSPMS_LATEST_PAGE)]: "p8-zspms-notice/response.txt",
	[ZSPMS_CALENDAR_URL]: "p8-zspms-calendar/response.txt",
	[ZSPMS_CDN_MENU_URL]: "p8-zspms-cdn-menu/response.txt",
	[zspmsCdnArticleUrl(5682)]: "p8-zspms-cdn-art5682/response.txt",
	[zspmsCdnArticleUrl(5467)]: "p8-zspms-cdn-art5467/response.txt",
	[zspmsCdnArticleUrl(5306)]: "p8-zspms-cdn-art5306/response.txt",
	[CZN_MODULE_URL]: "p8-czn-module/response.txt",
	[KEDR_TEMPLATE_URL]: "p8-kedr-template/response.txt",
	[CZN_RECORD_URL]: "p8-czn-record/response.txt"
};

// 夹具抓取时刻（= 抓取那一刻）= 2026-10-02T16:33:18Z = UTC+8 的 2026-10-03 00:33
const SNAP = Date.parse(fxMeta("p8-zspms-notice/response.txt").capturedAt);
const SNAP_ASK = Date.parse(fxMeta("p8-zspms-ask/response.txt").capturedAt);
const SNAP_CZN = Date.parse(fxMeta("p8-czn-module/response.txt").capturedAt);
const SNAP_KEDR = Date.parse(fxMeta("p8-kedr-template/response.txt").capturedAt);

// 关键"注入 now"（与系统时间无关）
const ZSPMS_NOW_IN = sourceInstant(2026, 10, 3, 12, 0, ZSPMS_TZ);      // 版本公告档期内
const ZSPMS_NOW_AFTER = sourceInstant(2027, 1, 1, 0, 0, ZSPMS_TZ);     // 全部档期过期
const CZN_NOW_1 = sourceInstant(2026, 5, 30, 12, 0, CZN_TZ);           // 第 1 批（05-28~06-17）
const CZN_NOW_2 = sourceInstant(2026, 6, 20, 12, 0, CZN_TZ);           // 第 2+3 批并存
const CZN_NOW_3 = sourceInstant(2026, 7, 5, 0, 0, CZN_TZ);             // 只剩第 3 批
const KEDR_NOW_OUT = sourceInstant(2026, 9, 1, 0, 0, KEDR_TZ);         // 个人剧情未开、卡池未开
const KEDR_NOW_ONE = sourceInstant(2026, 10, 5, 12, 0, KEDR_TZ);       // 活动只剩「个人剧情」1 条在期（赛季/边境 10-04 收）
const KEDR_NOW_AFTER = sourceInstant(2026, 12, 1, 0, 0, KEDR_TZ);      // 全部过期

// 抓取器调用包装：失败只记 ✗（不抛，避免中断共享 runner）
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }
async function throwsAsync(fn) { try { await fn(); return false; } catch { return true; } }
// 反证用：按 URL 给 body 的 transport（形状与 harness 的旧式 impl 相同；代理出口回 {status, body} 信封）。
// 用完必须 `useFixtures(OVERRIDES)` 还原，否则后续用例会拿到这份临时夹具。
function cdnImpl(map) {
	return async (url) => {
		const u = String(url);
		let target = u;
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			try { target = new URL("http://x" + u).searchParams.get("url") || u; } catch { /* keep */ }
		}
		const body = map[target];
		if (body == null) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			const wrapped = JSON.stringify({ status: 200, body });
			return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => wrapped, json: async () => JSON.parse(wrapped) };
		}
		return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => body, json: async () => JSON.parse(body) };
	};
}
const wall = (ts, tz) => {
	const w = sourceWallParts(ts, tz);
	const p = (n) => String(n).padStart(2, "0");
	return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};

export default async function run() {
	useFixtures(OVERRIDES);

	//#region P8-0 注册表片段
	section("P8-0 注册表片段（契约字段 / tz / mode / kind / 就地覆盖说明）");
	{
		check("SOURCES_P8 有 3 条", SOURCES_P8.length === 3, String(SOURCES_P8.length));
		check("id = [zspms, czn, kedr]（Lead 合并时按 id 就地覆盖 B2/P6 的同名条目）",
			JSON.stringify(listIdsP8()) === JSON.stringify(["zspms", "czn", "kedr"]), listIdsP8().join(","));
		check("id 无重复", new Set(listIdsP8()).size === 3, listIdsP8().join(","));
		const TZ_OK = (t) => t === "UTC" || /^[A-Za-z]+\/[A-Za-z_]+$/.test(t) || /^[+-]?\d+$/.test(t);
		for (const s of SOURCES_P8) {
			check(`P8 ${s.id} 声明合法 tz`, TZ_OK(s.tz), String(s.tz));
			check(`P8 ${s.id} 至少一侧`, !!(s.gacha || s.event));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`P8 ${s.id}.${side} 四要素齐备（url/fetcher/kind/mode）`,
					/^https?:\/\//.test(s[side].url) && typeof s[side].fetcher === "function"
					&& ["official-api", "official-html", "wiki", "third-party"].includes(s[side].kind)
					&& s[side].mode === "proxy",
					JSON.stringify({ url: s[side].url.slice(0, 80), kind: s[side].kind, mode: s[side].mode }));
			}
		}
		// 实测：bwiki 全系无 ACAO → 一律 proxy（test/all.mjs 有 direct 守卫）
		check("P8 三源 mode 全 proxy（bwiki 不在实测放行的三源内）",
			SOURCES_P8.every((s) => ["gacha", "event"].every((k) => !s[k] || s[k].mode === "proxy")));
		check("P8 三源 kind 全 wiki（都是 bwiki 社区维护页/模块）",
			SOURCES_P8.every((s) => ["gacha", "event"].every((k) => !s[k] || s[k].kind === "wiki")));
		// 侧别分布：zspms/kedr 两侧（同一份公告/模板里既有卡池也有活动）；czn 只有卡池侧
		check("zspms 两侧（同一份版本公告里既有研发池也有活动档期）",
			!!findSourceP8("zspms").gacha && !!findSourceP8("zspms").event);
		check("kedr 两侧（模板 2 条卡池 + 3 条活动）", !!findSourceP8("kedr").gacha && !!findSourceP8("kedr").event);
		check("czn 只有卡池侧（Lua 模块只登记营救池，没有活动档期）",
			!!findSourceP8("czn").gacha && !findSourceP8("czn").event);
		check("zspms 两侧 url 都是 SMW ask 索引（第 2 步的页面 URL 由抓取器推导）",
			findSourceP8("zspms").gacha.url === ZSPMS_ASK_URL && findSourceP8("zspms").event.url === ZSPMS_ASK_URL
			&& /action=ask/.test(ZSPMS_ASK_URL) && /%E5%88%86%E7%B1%BB%3A/.test(ZSPMS_ASK_URL),
			ZSPMS_ASK_URL.slice(0, 96));
		check("tz 取值：zspms/czn/kedr 都是 Asia/Shanghai（**推测**，源站未标注）",
			findSourceP8("zspms").tz === "Asia/Shanghai" && findSourceP8("czn").tz === "Asia/Shanghai" && findSourceP8("kedr").tz === "Asia/Shanghai",
			JSON.stringify([findSourceP8("zspms").tz, findSourceP8("czn").tz, findSourceP8("kedr").tz]));
		// 2026-10-05 用户要求：删除「Bwiki 卡池信息（台架测试占位）」这个占位源（备选条目 + 登记行一起删）。
		// 解析器与回归出口保留（cases-b2 仍直接单测 parseKedrGacha / gachaKedr）。
		check("kedr 已删除台架测试占位备选源（无 altSources 或为空）",
			!Array.isArray(findSourceP8("kedr").altSources) || findSourceP8("kedr").altSources.length === 0);
		// 页名/模板前缀的形态约束（写错就会命中不到夹具，也会让源站 soft-404）
		check("czn 页面名 = Module:Gacha/data（URL 里 %3A / %2F 已编码）",
			CZN_MODULE_PAGE === "Module:Gacha/data" && CZN_MODULE_URL.includes("Module%3AGacha%2Fdata"), CZN_MODULE_URL);
		check("kedr 页面名必须带 Template: 前缀（不带前缀源站返回 missingtitle）",
			KEDR_TEMPLATE_PAGE === "Template:首页游戏版本内容" && KEDR_TEMPLATE_URL.includes("Template%3A")
			&& KEDR_TEMPLATE_URL === kedrTemplateUrl(), KEDR_TEMPLATE_URL);
		// test/map.json（多人共写；本批只追加）必须收录本批全部 URL
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		const WANT = {
			[ZSPMS_ASK_URL]: "p8-zspms-ask/response.txt",
			[zspmsParseUrl(ZSPMS_LATEST_PAGE)]: "p8-zspms-notice/response.txt",
			[ZSPMS_CALENDAR_URL]: "p8-zspms-calendar/response.txt",
			[ZSPMS_CDN_MENU_URL]: "p8-zspms-cdn-menu/response.txt",
			[zspmsCdnArticleUrl(5682)]: "p8-zspms-cdn-art5682/response.txt",
			[zspmsCdnArticleUrl(5467)]: "p8-zspms-cdn-art5467/response.txt",
			[zspmsCdnArticleUrl(5306)]: "p8-zspms-cdn-art5306/response.txt",
			[CZN_MODULE_URL]: "p8-czn-module/response.txt",
			[KEDR_TEMPLATE_URL]: "p8-kedr-template/response.txt",
			[CZN_RECORD_URL]: "p8-czn-record/response.txt"
		};
		for (const url of Object.keys(WANT)) check(`map.json 收录 ${url.slice(0, 68)}…`, map[url] === WANT[url], JSON.stringify(map[url]));
	}
	//#endregion

	//#region P8-1 战双 SMW ask 索引
	section("P8-1 战双帕弥什 —— SMW ask 索引（`时间` 是**字符串** \"20260922\"）");
	const askRaw = fxJson("p8-zspms-ask/response.txt");
	{
		check("响应顶层 = { query-continue-offset, query }",
			Object.keys(askRaw).sort().join(",") === "query,query-continue-offset", JSON.stringify(Object.keys(askRaw)));
		check("query.results 是**以页面名为键的对象**（不是数组）",
			!!askRaw.query.results && typeof askRaw.query.results === "object" && !Array.isArray(askRaw.query.results));
		const keys = Object.keys(askRaw.query.results);
		check("夹具快照：命中 40 条（query.meta.count=40 印证）",
			keys.length === 40 && askRaw.query.meta.count === 40, `${keys.length}/${askRaw.query.meta.count}`);
		const first = askRaw.query.results[keys[0]];
		check("printouts 字段 = { 标题, 时间 }，两者都是**字符串数组**",
			Object.keys(first.printouts).length === 2 && !!first.printouts["标题"] && !!first.printouts["时间"]
			&& Array.isArray(first.printouts["时间"]) && typeof first.printouts["时间"][0] === "string",
			JSON.stringify(first.printouts));
		check("⚠️ `时间` 是 `\"20260922\"`（YYYYMMDD 字符串，**不是** SMW timestamp 对象）",
			first.printouts["时间"][0] === "20260922" && typeof first.printouts["时间"][0] === "string",
			JSON.stringify(first.printouts["时间"]));
		check("条目还有 fulltext/fullurl/namespace/exists（不是只有 printouts）",
			first.fulltext === ZSPMS_LATEST_PAGE && first.namespace === 0 && typeof first.fullurl === "string");

		const rows = parseZspmsAsk(askRaw);
		check("ASK URL 就是按任务书给的 query 原样 encodeURIComponent 拼的（依赖 `类别::版本`）",
			ZSPMS_ASK_URL === "https://wiki.biligame.com/zspms/api.php?action=ask&query=" + encodeURIComponent(ZSPMS_ASK_QUERY) + "&format=json"
			&& ZSPMS_ASK_QUERY === "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40"
			&& decodeURIComponent(ZSPMS_ASK_URL.split("query=")[1].split("&format=")[0]) === ZSPMS_ASK_QUERY,
			ZSPMS_ASK_QUERY);
		check("parseZspmsAsk → 40 行且**按 `时间` 严格倒序**",
			rows.length === 40 && rows.every((x, i) => i === 0 || rows[i - 1].time >= x.time));
		check("最新 = 《远信回响》/ 20260922（键即页面名，无日期后缀）",
			rows[0].page === ZSPMS_LATEST_PAGE && rows[0].time === "20260922" && rows[0].title === ZSPMS_LATEST_PAGE,
			JSON.stringify(rows[0]));
		check("前 3 条 = 远信回响 20260922 / 歧海循光 20260817 / 孑念空行 20260715（任务书实测值）",
			JSON.stringify(rows.slice(0, 3).map((x) => [x.page, x.time]))
			=== JSON.stringify([["《远信回响》版本更新公告", "20260922"], ["《歧海循光》版本更新公告", "20260817"], ["《孑念空行》版本更新公告", "20260715"]]),
			JSON.stringify(rows.slice(0, 3).map((x) => x.time)));
		check("最后一条 = 《游云鲸梦》/ 20211216（索引回溯到 2021）",
			rows[39].time === "20211216" && rows[39].page === "《游云鲸梦》版本更新公告", JSON.stringify(rows[39]));

		// 兼容性：`时间` 若换成 SMW timestamp 对象 / 裸字符串 / 缺字段，都要能解
		const synth = { query: { results: {
			A: { printouts: { "标题": ["甲"], "时间": [{ timestamp: 1790000000, fulltext: "2026" }] } },
			B: { printouts: { "标题": ["乙"], "时间": "20260101" } },
			C: { printouts: { "标题": ["丙"] } }
		} } };
		const rows2 = parseZspmsAsk(synth);
		check("兼容 `时间` 的三种形态：{timestamp} / 裸字符串 / 缺失（三种都识别，缺字段排到最后）",
			rows2.length === 3 && rows2.map((x) => x.time).includes("1790000000") && rows2.map((x) => x.time).includes("20260101")
			&& rows2[2].time === "" && rows2.map((x) => x.title).includes("甲") && rows2.map((x) => x.title).includes("乙"),
			JSON.stringify(rows2.map((x) => x.time)));
		check("排序键就是 `时间` 原文（YYYYMMDD 字符串 → 字典序 = 时间序，故不做任何数字转换）",
			parseZspmsAsk(askRaw).map((x) => x.time)[0] === "20260922");
		check("结构损坏（无 query.results）→ 抛错",
			throws(() => parseZspmsAsk({})) && throws(() => parseZspmsAsk({ query: {} })) && throws(() => parseZspmsAsk({ query: { results: [] } })));
		// ⚠️ 任务硬要求：**0 条不能静默当成"未公布"**（该查询依赖 `类别::版本`，0 条 = 索引坏了）
		check("0 条结果 → 抛错（不当'未公布'）", throws(() => parseZspmsAsk({ query: { results: {} } })));
	}
	//#endregion

	//#region P8-2 战双公告正文（wikitext）档期抽取
	section("P8-2 战双帕弥什 —— 版本更新公告 wikitext → 6 研发池 + 22 活动档期（含「版本更新后」）");
	const noticeRaw = fxJson("p8-zspms-notice/response.txt");
	const wtBody = noticeRaw.parse.wikitext["*"];
	const ann = parseZspmsAnnouncement(wtBody, ZSPMS_TZ, parseZspmsAsk(askRaw)[0]);
	{
		check("`prop=wikitext`（不是 prop=text）：parse 只有 { title, pageid, wikitext }",
			JSON.stringify(Object.keys(noticeRaw.parse).sort()) === JSON.stringify(["pageid", "title", "wikitext"]),
			JSON.stringify(Object.keys(noticeRaw.parse)));
		check("⚠️ `parse.wikitext` 是**对象**且正文在 `\"*\"` 里（字符串形态也兼容）",
			typeof noticeRaw.parse.wikitext === "object" && typeof noticeRaw.parse.wikitext["*"] === "string"
			&& wtBody.length === 9846, JSON.stringify([typeof noticeRaw.parse.wikitext, wtBody.length]));
		check("mediaWikiWikitext 兼容 { \"*\": … } 与裸字符串，缺字段返回 null",
			mediaWikiWikitext(noticeRaw) === wtBody && mediaWikiWikitext({ parse: { wikitext: "X" } }) === "X"
			&& mediaWikiWikitext({ parse: {} }) === null && mediaWikiWikitext({ error: { code: "missingtitle" } }) === null);
		check("页名 encodeURIComponent 后才请求 → 夹具 meta.url 与本模块构造的 URL 完全一致",
			fxMeta("p8-zspms-notice/response.txt").url === zspmsParseUrl(ZSPMS_LATEST_PAGE),
			fxMeta("p8-zspms-notice/response.txt").url);
		check("正文里档期**写在 `{{颜色引用|红|…}}` 模板参数里**（所以必须先剥模板）",
			/\{\{颜色引用\|红\|2026年9月24日版本更新后 - 2026年11月5日05:00\}\}/.test(wtBody));

		// —— 归一化 ——
		const norm = zspmsNormalize(wtBody);
		check("zspmsNormalize：`{{颜色引用|…}}` 已剥掉、档期文本仍在",
			!/颜色引用/.test(norm) && norm.includes("2026年9月24日版本更新后 - 2026年11月5日05:00"));
		check("zspmsNormalize：`{{公告|…}}` 信息模板整块去掉（时间字段另取）",
			!/\|文章上级页面=/.test(norm) && !/\|原文地址=/.test(norm));
		check("zspmsNormalize：标题打成 `\\u0001H<level>\\u0001` 行（标题栈取活动名用）——夹具快照 41 个标题",
			(norm.match(/\u0001H\d\u0001/g) || []).length === 41, String((norm.match(/\u0001H\d\u0001/g) || []).length));
		check("zspmsNormalize：`'''` 粗体标记已去（时崎狂三那行的三个单引号）",
			!/'''/.test(norm) && norm.includes("通过“时崎狂三狙击” “命运时崎狂三狙击”研发池获得"));

		// —— 相对锚点：源站自己写明的停服维护窗口 ——
		const maint = zspmsMaintenanceWindow(norm, ZSPMS_TZ);
		check("停服维护窗口 = 2026-09-24 05:00 - 11:00（源站原文，含相对起点的锚点）",
			!!maint && maint.raw === "2026-09-24 05:00 - 11:00"
			&& maint.startTs === sourceInstant(2026, 9, 24, 5, 0, ZSPMS_TZ)
			&& maint.endTs === sourceInstant(2026, 9, 24, 11, 0, ZSPMS_TZ),
			JSON.stringify(maint));
		check("announceTime 取自 `{{公告|时间=20260922}}`；anchor = 维护结束（不是公告日）",
			ann.announceTime === "20260922" && ann.anchor.ts === maint.endTs && ann.anchor.how === "维护结束");

		// —— 档期总账 ——
		check("共 28 条档期：**6 卡池（研发池）+ 22 活动**，0 条被跳过",
			ann.items.length === 28 && ann.skipped === 0
			&& ann.items.filter((x) => x.kind === "gacha").length === 6
			&& ann.items.filter((x) => x.kind === "event").length === 22,
			JSON.stringify([ann.items.length, ann.skipped, ann.items.filter((x) => x.kind === "gacha").length]));
		check("卡池 6 条池名 = 淬炼/狙击武器/辅助机狙击/时崎狂三狙击/联动武器狙击/异界装备狙击",
			JSON.stringify(ann.items.filter((x) => x.kind === "gacha").map((x) => x.banner))
			=== JSON.stringify([
				"淬炼活动角色 / 命运淬炼活动角色", "狙击武器", "辅助机狙击",
				"时崎狂三狙击 / 命运时崎狂三狙击", "联动武器狙击", "异界装备狙击"
			]),
			JSON.stringify(ann.items.filter((x) => x.kind === "gacha").map((x) => x.banner)));
		check("卡池 roles 取自「…」产出物 = 破渊/不孤航炬/凯尔派/时崎狂三/时针&分针/刻刻帝",
			JSON.stringify(ann.items.filter((x) => x.kind === "gacha").map((x) => x.roles))
			=== JSON.stringify(["阿德莱德·破渊", "不孤航炬", "凯尔派", "时崎狂三", "时针&分针", "刻刻帝"]),
			JSON.stringify(ann.items.filter((x) => x.kind === "gacha").map((x) => x.roles)));

		// —— 「版本更新后」相对起点 ——
		const poyuan = ann.items.find((x) => x.roles === "阿德莱德·破渊");
		check("破渊池起点是相对锚点「版本更新后」→ startInferred=true，绝对时刻 = 维护结束 09-24 11:00",
			!!poyuan && poyuan.startInferred === true && poyuan.startRel === "版本更新后"
			&& poyuan.startTs === sourceInstant(2026, 9, 24, 11, 0, ZSPMS_TZ)
			&& poyuan.startTs === 1790218800000
			&& poyuan.startFrom.includes("维护窗口"),
			JSON.stringify(poyuan && [poyuan.startTs, new Date(poyuan.startTs).toISOString(), poyuan.startFrom]));
		check("bannerDates 文本硬值：破渊池 = 09-24 11:00 ~ 11-05 05:00；raw 保留源站原文（含「版本更新后」）",
			!!poyuan && fmtWindow(poyuan.startTs, poyuan.endTs, ZSPMS_TZ) === "09-24 11:00 ~ 11-05 05:00"
			&& poyuan.raw === "2026年9月24日版本更新后 - 2026年11月5日05:00",
			JSON.stringify(poyuan && [fmtWindow(poyuan.startTs, poyuan.endTs, ZSPMS_TZ), poyuan.raw]));
		check("反证：若把「版本更新后」错当成 09-24 00:00，绝对时刻会差 11 小时",
			!!poyuan && sourceInstant(2026, 9, 24, 0, 0, ZSPMS_TZ) !== poyuan.startTs
			&& poyuan.startTs - sourceInstant(2026, 9, 24, 0, 0, ZSPMS_TZ) === 11 * 3600000);
		const kuang3 = ann.items.find((x) => x.roles === "时崎狂三");
		check("双端显式时刻的行 **不标** inferred（时崎狂三 09-29 10:00）",
			!!kuang3 && kuang3.startInferred === false && kuang3.startTs === sourceInstant(2026, 9, 29, 10, 0, ZSPMS_TZ)
			&& kuang3.raw === "2026年9月29日10:00 - 2026年11月3日23:59",
			JSON.stringify(kuang3 && [kuang3.startInferred, kuang3.raw]));
		// 无维护窗口时的兜底锚点（把维护那段删掉 → 退回 `{{公告|时间=…}}`，即 stellasora 先例的"发布时间"）
		const noMaint = wtBody.replace(/我们将于[\s\S]{0,200}?停服维护[^\n]*/g, "");
		const ann2 = parseZspmsAnnouncement(noMaint, ZSPMS_TZ, parseZspmsAsk(askRaw)[0]);
		const poyuan2 = ann2.items.find((x) => x.roles === "阿德莱德·破渊");
		check("无维护窗口时退回**公告时间 20260922**（stellasora 先例）且仍标 inferred",
			!!poyuan2 && ann2.anchor === null && poyuan2.startInferred === true
			&& poyuan2.startTs === sourceInstant(2026, 9, 22, 0, 0, ZSPMS_TZ)
			&& poyuan2.startFrom.includes("20260922"),
			JSON.stringify(poyuan2 && [poyuan2.startTs, poyuan2.startFrom]));

		// —— 活动档期（标题栈取名字）——
		check("标题栈：`4）活动时间` 这类通用容器标题会往上爬到 `四、回路演算` / `五、超频演算` / `六、忽忽破坏王`",
			ann.items.some((x) => x.name === "回路演算") && ann.items.some((x) => x.name === "超频演算")
			&& ann.items.some((x) => x.name === "忽忽破坏王"));
		check("活动名去掉了 `N）` / `一、` 前缀，也去掉了 `[编辑]`",
			ann.items.filter((x) => x.kind === "event").every((x) => !/^\d+）/.test(x.name) && !/^[一二三四五六七八九十]+、/.test(x.name) && !/编辑/.test(x.name)));
		check("zspmsNameAt 单测：回路演算那行的窗口落在 `4）活动时间` 节里 → 取父标题",
			(() => {
				const lines = zspmsNormalize(wtBody).split("\n");
				const heads = zspmsHeadings(lines);
				const idx = lines.findIndex((l) => l.includes("2026年9月29日10:00 - 2026年11月4日05:00") && !l.includes("活动时间："));
				return idx >= 0 && zspmsNameAt(heads, idx) === "超频演算";
			})(), JSON.stringify(ann.items.filter((x) => x.kind === "event").map((x) => x.name)));
		check("「开启时间：2026年9月24日版本更新后」这种**没有终点**的行不产出档期（绝不硬造）",
			ann.items.every((x) => x.raw.includes(" - ") && !/(版本更新后|维护结束后)$/.test(x.raw))
			&& ann.items.every((x) => x.raw.split(" - ").length === 2));
		check("全部 28 条都有两端绝对时刻且 endTs > startTs（没有任何一条靠假造补齐）",
			ann.items.every((x) => typeof x.startTs === "number" && typeof x.endTs === "number" && x.endTs > x.startTs));
		check("相对起点共 16 条（3 卡池 + 13 活动）全部标 startInferred 并写明推断依据；其余 12 条是显式时刻",
			ann.items.filter((x) => x.startInferred).length === 16
			&& ann.items.filter((x) => x.startInferred).every((x) => !!x.startFrom && !!x.startRel)
			&& ann.items.filter((x) => !x.startInferred).length === 12
			&& ann.items.filter((x) => !x.startInferred).every((x) => /\d{1,2}:\d{2}/.test(x.raw)),
			JSON.stringify([ann.items.filter((x) => x.startInferred).length, ann.items.filter((x) => !x.startInferred).length]));
		check("结构损坏（空正文 / 无任何档期）→ 抛错（不当'未公布'）",
			throws(() => parseZspmsAnnouncement("", ZSPMS_TZ)) && throws(() => parseZspmsAnnouncement("<p>没有档期</p>", ZSPMS_TZ)));

		// —— 抓取器（两步：ask → parse 正文）——
		const rg = await grab(() => gachaZspms(ZSPMS_ASK_URL, undefined, ZSPMS_TZ, SNAP));
		check("gacha 抓取成功（now 传第 4 参）", rg.ok, rg.err);
		assertContract("战双帕弥什", "gacha", rg.ok ? rg.data : null);
		check("卡池外显 = 结束最早的覆盖池（时崎狂三狙击 / 命运时崎狂三狙击，11-03 23:59 收）",
			rg.ok && rg.data && rg.data.banner === "时崎狂三狙击 / 命运时崎狂三狙击", JSON.stringify(rg.ok && rg.data && rg.data.banner));
		check("bannerDates = 09-29 10:00 ~ 11-03 23:59 / raw 保留源站原文",
			rg.ok && rg.data && rg.data.bannerDates === "09-29 10:00 ~ 11-03 23:59"
			&& rg.data.bannerDatesRaw === "2026年9月29日10:00 - 2026年11月3日23:59"
			&& rg.data.startTs === 1790647200000 && rg.data.endTs === 1793721540000,
			JSON.stringify(rg.ok && rg.data && [rg.data.bannerDates, rg.data.startTs, rg.data.endTs]));
		// —— 卡池 hover：方案 A（2026-10-03）后一律走共用 hoverPool ——
		// 旧的「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8 为推测；起点锚点=源站维护结束 …）」
		// 首行元信息 + 「档期在前、名称在后」两处偏差都**必须**消失。
		const zsHover = (rg.ok && rg.data && rg.data.bannerHover) || "";
		const zsLines = zsHover.split("\n");
		check("roles = 时崎狂三；hover 走共用 hoverPool：**6 池 × 2 行 = 12 行**、每池「池名：角色」+ 档期行（名称在前）",
			rg.ok && rg.data && rg.data.roles === "时崎狂三"
			&& zsLines.length === 12
			&& zsLines[0] === "时崎狂三狙击 / 命运时崎狂三狙击：时崎狂三"
			&& zsLines[1] === "09-29 10:00 ~ 11-03 23:59"
			&& zsLines.filter((l) => l.includes("：")).length === 6
			&& zsLines.filter((l) => /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(l)).length === 3
			// 2026-11-09（悬停档期改口径）：淬炼那 3 池的源站原文是「2026年9月24日版本更新后 - …」
			// （相对起点）⇒ 档期行**逐字写原文**；联动那 3 池两端绝对 ⇒ 仍是格式化（上一行）。
			&& zsLines.filter((l) => l === "2026年9月24日版本更新后 - 2026年11月5日05:00").length === 3,
			JSON.stringify(zsLines.slice(0, 4)));
		check("⚠️ 战双卡池 hover 里**不再有任何元信息**（来源站名/URL/API 名/SMW 时间/tz 推定/抓取条数/起点锚点/「（…）」实现说明）",
			rg.ok && rg.data
			&& !/bwiki|biligame|api\.php|https?:|SMW|tz\s*=|UTC|推测|推定|共\s*扫描|起点锚点|维护结束|Lua|Module:|Template:|来源|起点推断/.test(zsHover),
			JSON.stringify(zsHover.split("\n").slice(0, 1)));

		const re = await grab(() => eventsZspms(ZSPMS_ASK_URL, undefined, ZSPMS_TZ, SNAP));
		check("event 抓取成功（now 传第 4 参）", re.ok, re.err);
		assertContract("战双帕弥什", "event", re.ok ? re.data : null);
		check("活动外显 = 内容档里结束最早的（悍猎季风-BOSS挑战 09-25 ~ 10-19）",
			re.ok && re.data && re.data.event === "悍猎季风-BOSS挑战" && re.data.eventDates === "09-25 10:00 ~ 10-19 05:00",
			JSON.stringify(re.ok && re.data && [re.data.event, re.data.eventDates]));
		// —— 活动 hover：方案 A 后一律走共用 hoverEvent（名称在前 + 3 空格 + 档期，档期由 fmtWindow 格式化）——
		const zeHover = (re.ok && re.data && re.data.eventHover) || "";
		const zeLines = zeHover.split("\n");
		check("活动 hover 走共用 hoverEvent：21 条当期、**行首是名称不是日期**、「名称 + 3 空格 + 档期」；未开的活动（忽忽破坏王 10-08 起）不在外显",
			re.ok && re.data && zeLines.length === 21
			&& zeLines[0] === "悍猎季风-BOSS挑战   09-25 10:00 ~ 10-19 05:00"
			&& zeLines.every((l) => /^.+? {3}\S/.test(l))
			// 2026-11-09（悬停档期改口径）：13 条源站原文是「2026年9月24日版本更新后 - …」（相对起点）
			// ⇒ 逐字写原文；其余 8 条两端绝对 ⇒ 仍是格式化（`09-25 10:00 ~ …`）。
			&& zeLines.filter((l) => T.hoverRawIsRelative(l)).length === 13
			&& zeLines.every((l) => !/^\d{2}-\d{2} /.test(l))          // 「档期在前」必须消失
			&& re.data.event !== "忽忽破坏王",
			JSON.stringify(zeLines.slice(0, 3)));
		check("⚠️ 战双活动 hover 里**不再有任何元信息**（来源站名/tz 推定/抓取条数/「起点推断」注记/起点锚点）",
			re.ok && re.data
			&& !/bwiki|biligame|api\.php|https?:|SMW|tz\s*=|UTC|推测|推定|共\s*扫描|起点锚点|维护结束|Lua|Module:|Template:|来源|起点推断|…以及另外/.test(zeHover),
			JSON.stringify(zeLines.slice(0, 1)));

		// now 真的是第 4 参：换成 2027 → 全部过期 → 两侧都 null（不硬凑）
		const rgNull = await grab(() => gachaZspms(ZSPMS_ASK_URL, undefined, ZSPMS_TZ, ZSPMS_NOW_AFTER));
		const reNull = await grab(() => eventsZspms(ZSPMS_ASK_URL, undefined, ZSPMS_TZ, ZSPMS_NOW_AFTER));
		check("now=2027-01-01（全部过期）→ 卡池/活动两侧都返回 null（未公布，不硬凑）",
			rgNull.ok && rgNull.data === null && reNull.ok && reNull.data === null,
			JSON.stringify([rgNull.ok ? rgNull.data : rgNull.err, reNull.ok ? reNull.data : reNull.err]));
		check("null 通过契约守卫（= 未公布，合法）",
			assertContract("战双(过期)", "gacha", rgNull.data) === true && assertContract("战双(过期)", "event", reNull.data) === true);
		check("注入另一个档期内 now（10-03 12:00）仍能产出（证明 now 参与判定，不是常量）",
			(await grab(() => gachaZspms(ZSPMS_ASK_URL, undefined, ZSPMS_TZ, ZSPMS_NOW_IN))).data !== null);
		check("索引/正文请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => gachaZspms("https://example.invalid/zspms-ask", undefined, ZSPMS_TZ, SNAP)));
	}
	//#endregion

	//#region P8-3 卡厄斯梦境 Lua 模块
	section("P8-3 卡厄斯梦境 —— `Module:Gacha/data` 的 Lua 表（6 期全解出）");
	const cznRaw = fxJson("p8-czn-module/response.txt");
	const cznBody = cznRaw.parse.wikitext["*"];
	{
		check("⚠️ 页面名 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**",
			cznRaw.parse.title === "模块:Gacha/data" && CZN_MODULE_PAGE === "Module:Gacha/data",
			JSON.stringify(cznRaw.parse.title));
		check("夹具 meta.url 与 CZN_MODULE_URL 完全一致（%3A / %2F 编码一致）",
			fxMeta("p8-czn-module/response.txt").url === CZN_MODULE_URL, fxMeta("p8-czn-module/response.txt").url);
		check("正文是 Lua `return { [\"0001\"] = { … } }` 表（999B，6 个条目）",
			/^return\s*\{/.test(cznBody.trim()) && (cznBody.match(/\[\"\d{4}\"\]\s*=\s*\{/g) || []).length === 6,
			String((cznBody.match(/\[\"\d{4}\"\]\s*=\s*\{/g) || []).length));

		const items = parseCznLua(cznBody, CZN_TZ);
		check("parseCznLua → 6 期（0001~0006），id/顺序与源站一致",
			items.length === 6 && JSON.stringify(items.map((x) => x.id)) === JSON.stringify(["0001", "0002", "0003", "0004", "0005", "0006"]),
			JSON.stringify(items.map((x) => x.id)));
		check("期别内容 = 主战/辅战 × （当期/常驻/赛季限定）三批，link_char 全部解出",
			JSON.stringify(items.map((x) => [x.type, x.char])) === JSON.stringify([
				["主战员营救概率提升", "绯"], ["辅战员营救概率提升", "芮香"],
				["常驻主战员营救概率提升", "黛安娜"], ["常驻辅战员营救概率提升", "索菲亚"],
				["赛季限定主战员营救概率提升", "海德玛丽"], ["赛季限定辅战员营救概率提升", "西尔维亚"]
			]),
			JSON.stringify(items.map((x) => [x.type, x.char])));
		check("日期是 `YYYY-M-D H:MM:SS`（月/日**不补零**）→ raw 保留原文",
			items[4].raw === "2026-6-17 10:00:00 ~ 2026-7-08 02:00:00" && items[0].raw === "2026-5-28 10:00:00 ~ 2026-6-17 02:00:00",
			JSON.stringify([items[0].raw, items[4].raw]));
		check("0005 绝对时刻：起点 = 2026-06-17 10:00、终点 = 2026-07-08 02:00（UTC+8 解释）",
			items[4].startTs === sourceInstant(2026, 6, 17, 10, 0, CZN_TZ) && items[4].startTs === 1781661600000
			&& items[4].endTs === sourceInstant(2026, 7, 8, 2, 0, CZN_TZ) && items[4].endTs === 1783447200000,
			JSON.stringify([items[4].startTs, items[4].endTs]));
		check("反证：同一墙钟若误用 UTC+9 会差 1 小时（证明用了 UTC+8）",
			items[4].startTs !== sourceInstant(2026, 6, 17, 10, 0, "Asia/Tokyo")
			&& sourceInstant(2026, 6, 17, 10, 0, "Asia/Tokyo") - items[4].startTs === -3600000);
		check("03:00 开池 / 02:00 关池的国服作息旁证（tz=Asia/Shanghai 记「推测」）",
			items.every((x) => { const w = sourceWallParts(x.endTs, CZN_TZ); return w.h === 2 && w.mi === 0; })
			&& items.every((x) => { const w = sourceWallParts(x.startTs, CZN_TZ); return w.h === 10 && w.mi === 0; }));
		check("3 批两两成对（同期同窗口），且 4/5 期之间不接续（源站如此）",
			items[0].startTs === items[1].startTs && items[0].endTs === items[1].endTs
			&& items[2].startTs === items[3].startTs && items[4].startTs === items[5].startTs
			&& items[1].endTs === sourceInstant(2026, 6, 17, 2, 0, CZN_TZ) && items[4].startTs > items[1].endTs);

		check("cznStamp 单测：不补零/可省秒/非法钟点 → null",
			JSON.stringify(cznStamp("2026-6-17 10:00:00")) === JSON.stringify({ y: 2026, mo: 6, d: 17, h: 10, mi: 0 })
			&& JSON.stringify(cznStamp("2026/03/22 8:59")) === JSON.stringify({ y: 2026, mo: 3, d: 22, h: 8, mi: 59 })
			&& cznStamp("2026-6-17") !== null && cznStamp("2026-6-17 25:00") === null && cznStamp("不是日期") === null);
		check("结构损坏（空 / `return {}` / 无条目）→ 抛错（Lua 表被改版 = 抓取失败）",
			throws(() => parseCznLua("", CZN_TZ)) && throws(() => parseCznLua("return {}", CZN_TZ))
			&& throws(() => parseCznLua('return { ["0001"] = { type = "x" } }', CZN_TZ)));

		// —— 抓取器：当期语义（该 Lua 最新一期 2026-07-08 止，抓取时刻已过期 → null）——
		const rz = await grab(() => gachaCzn(CZN_MODULE_URL, undefined, CZN_TZ, SNAP));
		check("夹具抓取时刻（2026-10-03 00:33 UTC+8）最新一期已过期 → **如实 null**（任务硬要求）",
			rz.ok && rz.data === null, JSON.stringify(rz.ok ? rz.data : rz.err));
		check("null 通过契约守卫", assertContract("卡厄斯(过期)", "gacha", rz.data) === true);
		// 注入 now 到 3 个批次里，逐一验证"最新开始的覆盖档"语义
		const r1 = await grab(() => gachaCzn(CZN_MODULE_URL, undefined, CZN_TZ, CZN_NOW_1));
		const r2 = await grab(() => gachaCzn(CZN_MODULE_URL, undefined, CZN_TZ, CZN_NOW_2));
		const r3 = await grab(() => gachaCzn(CZN_MODULE_URL, undefined, CZN_TZ, CZN_NOW_3));
		check("now=05-30 → 主战员营救概率提升（绯）05-28 10:00 ~ 06-17 02:00",
			r1.ok && r1.data && r1.data.banner === "主战员营救概率提升（绯）" && r1.data.bannerDates === "05-28 10:00 ~ 06-17 02:00",
			JSON.stringify(r1.ok && r1.data && [r1.data.banner, r1.data.bannerDates]));
		check("now=06-20 → 取**开始最新**的覆盖档 = 赛季限定主战员（海德玛丽）06-17 ~ 07-08",
			r2.ok && r2.data && r2.data.banner === "赛季限定主战员营救概率提升（海德玛丽）"
			&& r2.data.bannerDates === "06-17 10:00 ~ 07-08 02:00" && r2.data.roles === "海德玛丽",
			JSON.stringify(r2.ok && r2.data && [r2.data.banner, r2.data.bannerDates]));
		assertContract("卡厄斯梦境", "gacha", r2.ok ? r2.data : null);
		check("now=07-05 → 只剩第 3 批（0005/0006）",
			r3.ok && r3.data && r3.data.banner === "赛季限定主战员营救概率提升（海德玛丽）", JSON.stringify(r3.ok && r3.data && r3.data.banner));
		// —— czn 卡池 hover：同样走共用 hoverPool（方案 A）——
		// 旧实现的首行是「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」，
		// 且每行「档期在前、名称在后」；两处偏差都必须消失（角色名在「池名：角色」里出现两次是**本体约定**：
		// UI 单条兜底也是 `banner：roles`，故不再断言「角色名只出现一次」，改为断言精确格式与无 `）（` 连写）。
		const cznHover = (r2.ok && r2.data && r2.data.bannerHover) || "";
		const cznLines = cznHover.split("\n");
		check("czn hover 走共用 hoverPool：4 池 × 2 行 = 8 行、每行「池名：角色」+ 档期（名称在前），无 `）（` 连写",
			r2.ok && r2.data && cznLines.length === 8
			&& cznLines[4] === "赛季限定主战员营救概率提升（海德玛丽）：海德玛丽"
			&& cznLines[5] === "06-17 10:00 ~ 07-08 02:00"
			&& cznLines.filter((l) => l.includes("：")).length === 4
			&& !/）（/.test(cznHover)
			&& cznLines.every((l) => !/^\d{2}-\d{2} /.test(l) || /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(l)),
			JSON.stringify(cznLines.slice(0, 3)));
		check("⚠️ czn hover 里**不再有任何元信息**（来源站名/页面名/Lua 表条数/tz 推定）",
			r2.ok && r2.data && !/bwiki|biligame|Module:|Lua|tz\s*=|UTC|推测|推定|来源|api\.php|https?:/.test(cznHover),
			JSON.stringify(cznLines.slice(0, 1)));
		check("同窗口的 2 池 → 只列池名、档期在末尾写一次（hoverPool 的 same 分支）",
			r3.ok && r3.data && r3.data.bannerHover === "赛季限定主战员营救概率提升（海德玛丽）：海德玛丽\n赛季限定辅战员营救概率提升（西尔维亚）：西尔维亚\n06-17 10:00 ~ 07-08 02:00",
			JSON.stringify(r3.ok && r3.data && r3.data.bannerHover));

		// —— 备选页 `卡池记录`（只有 1 条，本批只做纯函数解析，不挂抓取器）——
		const rec = fxJson("p8-czn-record/response.txt");
		const recItems = parseCznRecord(rec.parse.wikitext["*"], CZN_TZ);
		check("备选页 `卡池记录` 的 `{{Gacha|…}}` 模板：1 条 = 小春概率UP 2026/03/22 08:59 ~ 03/27 08:59",
			recItems.length === 1 && recItems[0].banner === "小春概率UP" && recItems[0].roles === "小春"
			&& recItems[0].category === "救援概率UP" && recItems[0].raw === "2026/03/22 8:59:00 ~ 2026/03/27 8:59:00",
			JSON.stringify(recItems));
		check("备选页那 1 条也已过期（2026-03）→ 不改变 `czn` 的当期结论（仍是 null）",
			recItems[0].endTs < SNAP);
	}
	//#endregion

	//#region P8-4 雪松模板
	section("P8-4 雪松 —— `Template:首页游戏版本内容` 的 5 条 `{{时间进度条}}`（卡池 2 / 活动 3）");
	const kedrRaw = fxJson("p8-kedr-template/response.txt");
	const kedrBody = kedrRaw.parse.wikitext["*"];
	{
		check("⚠️ 页面名 `Template:首页游戏版本内容`，返回的 `parse.title` 是 `模板:首页游戏版本内容`",
			kedrRaw.parse.title === "模板:首页游戏版本内容" && KEDR_TEMPLATE_PAGE === "Template:首页游戏版本内容",
			JSON.stringify(kedrRaw.parse.title));
		check("夹具 meta.url 与 KEDR_TEMPLATE_URL 完全一致", fxMeta("p8-kedr-template/response.txt").url === KEDR_TEMPLATE_URL);
		check("模板 wikitext 里有 5 处 `{{时间进度条|…}}`，且页尾注释块里的是 `{{板块|按钮|…}}`",
			(kedrBody.match(/\{\{时间进度条\|/g) || []).length === 5 && /<!--[\s\S]*\{\{板块\|按钮/.test(kedrBody));

		const calls = kedrTemplateCalls(kedrBody);
		check("kedrTemplateCalls → 5 条参数对象（注释块里的内容不产出）",
			calls.length === 5 && calls.every((c) => c["开始时间"] && c["结束时间"] && c["名称"]), String(calls.length));
		check("第 1 条 = 战令通行证赛季 2026/8/31 05:00 ~ 2026/10/04 05:00（倒计时名称=赛季）",
			calls[0]["名称"] === "战令通行证赛季" && calls[0]["开始时间"] === "2026/8/31 05:00"
			&& calls[0]["结束时间"] === "2026/10/04 05:00" && calls[0]["倒计时名称"] === "赛季",
			JSON.stringify(calls[0]));
		check("第 3/4 条 = 【精英集结·支援】西尔维亚 / 【演习·联合领】莫菲（同窗口 2026/10/02 ~ 10/09）",
			calls[2]["名称"] === "【精英集结·支援】西尔维亚" && calls[3]["名称"] === "【演习·联合领】莫菲"
			&& calls[2]["开始时间"] === calls[3]["开始时间"] && calls[2]["结束时间"] === calls[3]["结束时间"]);
		check("链接参数含 `=` / `?` 也解析正确（按**第一个** `=` 切分）",
			calls[2]["链接"] === "https://www.bilibili.com/opus/1254097810885705736"
			&& /^https:\/\/www\.bilibili\.com\/opus\/1242269470936793142\?spm_id_from=333\.1387\.0\.0$/.test(calls[0]["链接"]),
			JSON.stringify(calls[0]["链接"]));
		check("第 5 条 = 第三期边境防卫活动（注释里的 `往期动员` 按钮不产出）",
			calls[4]["名称"] === "第三期边境防卫活动" && calls.every((c) => !/往期动员/.test(c["名称"])));

		const kp = parseKedrTemplate(kedrBody, KEDR_TZ);
		check("parseKedrTemplate → **5 条全解出**：卡池 2 + 活动 3，0 跳过",
			kp.gacha.length === 2 && kp.event.length === 3 && kp.skipped === 0
			&& kp.gacha.length + kp.event.length === 5,
			JSON.stringify([kp.gacha.length, kp.event.length, kp.skipped]));
		check("卡池/活动分流：名称含 精英集结/演习 → 卡池；活动/赛季/通行证/剧情 → 活动",
			JSON.stringify(kp.gacha.map((x) => x.name)) === JSON.stringify(["【精英集结·支援】西尔维亚", "【演习·联合领】莫菲"])
			&& JSON.stringify(kp.event.map((x) => x.name)) === JSON.stringify(["战令通行证赛季", "个人剧情活动第1期：【新机动队故事】", "第三期边境防卫活动"]),
			JSON.stringify([kp.gacha.map((x) => x.name), kp.event.map((x) => x.name)]));
		check("kedrIsGacha/kedrIsEvent 单测（含 通行证/赛季/剧情 归类，且卡池名不会被当活动）",
			kedrIsGacha("【精英集结·支援】西尔维亚") && kedrIsGacha("【演习·联合领】莫菲")
			&& kedrIsEvent("战令通行证赛季") && kedrIsEvent("个人剧情活动第1期：【新机动队故事】") && kedrIsEvent("第三期边境防卫活动")
			&& !kedrIsEvent("【精英集结·支援】西尔维亚") && !kedrIsGacha("战令通行证赛季")
			&& kedrRoleFromName("【精英集结·支援】西尔维亚") === "西尔维亚" && kedrRoleFromName("第三期边境防卫活动") === "");
		check("kedrStamp 单测（`2026/8/31 05:00` 不补零也能解）",
			JSON.stringify(kedrStamp("2026/8/31 05:00")) === JSON.stringify({ y: 2026, mo: 8, d: 31, h: 5, mi: 0 })
			&& JSON.stringify(kedrStamp("2026/10/02 05:00")) === JSON.stringify({ y: 2026, mo: 10, d: 2, h: 5, mi: 0 })
			&& kedrStamp("2026/10/02") !== null && kedrStamp("？") === null);
		check("结构损坏（空模板 / 只有板块没有时间进度条）→ 抛错",
			throws(() => parseKedrTemplate("", KEDR_TZ)) && throws(() => parseKedrTemplate("{{板块|开始|标题=版本}}", KEDR_TZ)));

		// —— 抓取器：该模板是**当期**数据 ——
		const rg = await grab(() => gachaKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, SNAP));
		check("gacha 抓取成功（now 传第 4 参）", rg.ok, rg.err);
		assertContract("雪松", "gacha", rg.ok ? rg.data : null);
		check("卡池外显 = 【精英集结·支援】西尔维亚（10-02 05:00 ~ 10-09 05:00，覆盖抓取时刻）",
			rg.ok && rg.data && rg.data.banner === "【精英集结·支援】西尔维亚" && rg.data.roles === "西尔维亚"
			&& rg.data.bannerDates === "10-02 05:00 ~ 10-09 05:00"
			&& rg.data.bannerDatesRaw === "2026/10/02 05:00 ~ 2026/10/09 05:00"
			&& rg.data.startTs === 1790888400000 && rg.data.endTs === 1791493200000,
			JSON.stringify(rg.ok && rg.data && [rg.data.banner, rg.data.bannerDates, rg.data.startTs]));
		// —— kedr 卡池 hover：走共用 hoverPool（2 池同窗口 → 只列池名 + 档期只在末尾写一遍）——
		check("卡池 hover 走共用 hoverPool：2 池同窗口 → 3 行（池名 ×2 + 末尾一次档期），**名称在前**",
			rg.ok && rg.data && rg.data.bannerHover === "【精英集结·支援】西尔维亚：西尔维亚\n【演习·联合领】莫菲：莫菲\n10-02 05:00 ~ 10-09 05:00",
			JSON.stringify(((rg.ok && rg.data && rg.data.bannerHover) || "").split("\n")));
		check("⚠️ 雪松卡池 hover 里**不再有任何元信息**（来源站名/Template 页名/分流口径说明/tz 推定）",
			rg.ok && rg.data && !/bwiki|biligame|Template:|社区维护|分流|tz\s*=|UTC|推测|推定|来源|api\.php|https?:/.test(rg.data.bannerHover),
			JSON.stringify(((rg.ok && rg.data && rg.data.bannerHover) || "").split("\n")));

		const re = await grab(() => eventsKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, SNAP));
		check("event 抓取成功（now 传第 4 参）", re.ok, re.err);
		assertContract("雪松", "event", re.ok ? re.data : null);
		check("活动外显 = 个人剧情活动第1期：【新机动队故事】（09-25 05:00 ~ 10-09 05:00，开始最新）",
			re.ok && re.data && re.data.event === "个人剧情活动第1期：【新机动队故事】"
			&& re.data.eventDates === "09-25 05:00 ~ 10-09 05:00"
			&& re.data.eventDatesRaw === "2026/9/25 05:00 ~ 2026/10/09 05:00",
			JSON.stringify(re.ok && re.data && [re.data.event, re.data.eventDates]));
		const keHover = (re.ok && re.data && re.data.eventHover) || "";
		const keLines = keHover.split("\n");
		check("活动 hover 走共用 hoverEvent：3 条「名称 + 3 空格 + 档期」（**行首是名称**），含 战令通行证赛季 / 第三期边境防卫活动",
			re.ok && re.data && keLines.length === 3
			&& keLines[0] === "个人剧情活动第1期：【新机动队故事】   09-25 05:00 ~ 10-09 05:00"
			&& /战令通行证赛季/.test(keHover) && /第三期边境防卫活动/.test(keHover)
			&& keLines.every((l) => /\S {3}\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(l))
			&& keLines.every((l) => !/^\d{2}-\d{2} /.test(l)),
			JSON.stringify(keLines));
		check("⚠️ 雪松活动 hover 里**不再有任何元信息**（来源站名/Template 页名/分流口径说明/tz 推定）",
			re.ok && re.data && !/bwiki|biligame|Template:|社区维护|分流|tz\s*=|UTC|推测|推定|来源|api\.php|https?:/.test(keHover),
			JSON.stringify(keLines.slice(0, 1)));

		// now 注入：09-01（卡池未开 → null；活动只有赛季/边境在期）
		const rgOut = await grab(() => gachaKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_OUT));
		const reOut = await grab(() => eventsKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_OUT));
		check("now=09-01：卡池尚未开（10-02 起）→ null；活动取在期的 战令通行证赛季（08-31 ~ 10-04）",
			rgOut.ok && rgOut.data === null && reOut.ok && reOut.data
			&& reOut.data.event === "战令通行证赛季" && reOut.data.eventDates === "08-31 05:00 ~ 10-04 05:00",
			JSON.stringify([rgOut.ok ? rgOut.data : rgOut.err, reOut.ok && reOut.data && reOut.data.event]));
		check("活动 hover 的「同窗口」分支：2 条同窗口 → 只列名称 + 档期在末尾写一次（与本体同）",
			reOut.ok && reOut.data && reOut.data.eventHover === "战令通行证赛季\n第三期边境防卫活动\n08-31 05:00 ~ 10-04 05:00",
			JSON.stringify(reOut.ok && reOut.data && reOut.data.eventHover));
		const rgNull = await grab(() => gachaKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_AFTER));
		const reNull = await grab(() => eventsKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_AFTER));
		check("now=2026-12-01（全部过期）→ 两侧都 null（未公布，不硬凑）",
			rgNull.ok && rgNull.data === null && reNull.ok && reNull.data === null,
			JSON.stringify([rgNull.ok ? rgNull.data : rgNull.err, reNull.ok ? reNull.data : reNull.err]));
		// 方案 A 规则 3：**只有 1 条**当期活动 → **不设 eventHover**（交回 UI 的「活动名 ⏎ 档期」两行式）
		const rgOne = await grab(() => gachaKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_ONE));
		const reOne = await grab(() => eventsKedrTemplate(KEDR_TEMPLATE_URL, undefined, KEDR_TZ, KEDR_NOW_ONE));
		check("now=10-05：活动只剩 个人剧情 1 条在期 → **不设 eventHover 字段**（交回 UI 两行式兜底）；卡池 2 池仍是 hoverPool",
			rgOne.ok && rgOne.data && reOne.ok && reOne.data
			&& reOne.data.event === "个人剧情活动第1期：【新机动队故事】" && !("eventHover" in reOne.data)
			&& rgOne.data.bannerHover === "【精英集结·支援】西尔维亚：西尔维亚\n【演习·联合领】莫菲：莫菲\n10-02 05:00 ~ 10-09 05:00",
			JSON.stringify([reOne.ok && reOne.data, rgOne.ok && rgOne.data && rgOne.data.bannerHover]));
		check("抓取失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => gachaKedrTemplate("https://example.invalid/kedr", undefined, KEDR_TZ, SNAP)));
	}
	//#endregion

	//#region P8-6 战双帕弥什 —— 卡池默认源换成 `Test4/活动旗帜`（2026-11-10）
	// 为什么换：版本更新公告最新只到 2026-11-05（11-06 起空窗），活动旗帜的结构化当期池到 11-12。
	// 夹具 `p8-zspms-flags`（507B 真响应）。断言里 now 一律用 2026-11-10 02:50 +08。
	section("P8-6 战双帕弥什 —— 卡池默认源 = `Test4/活动旗帜`（结构化当期池；公告源降为备选）");
	const FLAGS_NOW = sourceInstant(2026, 11, 10, 2, 50, ZSPMS_TZ);
	{
		const flagsRaw = fxJson("p8-zspms-flags/response.txt");
		const wt = mediaWikiWikitext(flagsRaw);
		check("活动旗帜是**数据页**（parse.title = `Test4/活动旗帜`），页名编码后与夹具 meta.url 一致",
			flagsRaw.parse.title === ZSPMS_FLAGS_PAGE && fxMeta("p8-zspms-flags/response.txt").url === ZSPMS_FLAGS_URL,
			JSON.stringify([flagsRaw.parse.title, fxMeta("p8-zspms-flags/response.txt").url]));
		check("模板参数：70%UP 3 个角色 + 100%UP 2 个角色，两端时间齐全",
			/\|70%UP1=比安卡·晖暮/.test(wt) && /\|70%UP3=海伦汀·安魂/.test(wt)
			&& /\|70%UP开始时间=2026\/10\/29 07:00/.test(wt) && /\|70%UP结束时间=2026\/11\/12 06:59/.test(wt)
			&& /\|100%UP1=阿德莱德·破渊/.test(wt) && /\|100%UP2=时崎狂三·时崎狂三/.test(wt));

		const pools = parseZspmsFlags(wt, ZSPMS_TZ);
		check("parseZspmsFlags → 2 个池（源站顺序：70%UP 在前）",
			pools.length === 2 && pools[0].pool === "70%UP" && pools[1].pool === "100%UP",
			JSON.stringify(pools.map((x) => x.pool)));
		check("70%UP 角色 = 比安卡·晖暮、七实·芒星之迹、海伦汀·安魂（源站写法，逗号统一「、」）",
			pools[0].roles === "比安卡·晖暮、七实·芒星之迹、海伦汀·安魂", JSON.stringify(pools[0].roles));
		check("70%UP 起止 = 2026-10-29 07:00 ~ 11-12 06:59（+08），raw 两端原文、display 补全",
			pools[0].startTs === sourceInstant(2026, 10, 29, 7, 0, ZSPMS_TZ)
			&& pools[0].endTs === sourceInstant(2026, 11, 12, 6, 59, ZSPMS_TZ)
			&& pools[0].raw === "2026/10/29 07:00 ~ 2026/11/12 06:59"
			&& pools[0].display === "10-29 07:00 ~ 11-12 06:59",
			JSON.stringify([pools[0].startTs, pools[0].endTs, pools[0].raw, pools[0].display]));
		check("100%UP 角色照抄源站（`时崎狂三·时崎狂三` 是 wiki 页面名，不删改）",
			pools[1].roles === "阿德莱德·破渊、时崎狂三·时崎狂三", JSON.stringify(pools[1].roles));

		// 抓取器：now = 2026-11-10 ⇒ 70%UP 在期、100%UP（11-05 收）不进
		const rg = await grab(() => gachaZspmsFlags(ZSPMS_FLAGS_URL, undefined, ZSPMS_TZ, FLAGS_NOW));
		check("gacha 抓取成功（now 传第 4 参）", rg.ok, rg.err);
		assertContract("战双(活动旗帜)", "gacha", rg.ok ? rg.data : null);
		check("外显 = 70%UP（当期那批），角色 = 三人，档期 = 10-29 07:00 ~ 11-12 06:59",
			rg.ok && rg.data && rg.data.banner === "70%UP"
			&& rg.data.roles === "比安卡·晖暮、七实·芒星之迹、海伦汀·安魂"
			&& rg.data.bannerDates === "10-29 07:00 ~ 11-12 06:59"
			&& rg.data.bannerDatesRaw === "2026/10/29 07:00 ~ 2026/11/12 06:59",
			JSON.stringify(rg.ok && rg.data && [rg.data.banner, rg.data.roles, rg.data.bannerDates]));
		check("100%UP 池 11-05 05:00 已结束 ⇒ 只在数组外，不设 bannerHover（<2 条交回 UI 两行式）",
			rg.ok && rg.data && rg.data.gacha.length === 1 && rg.data.gacha[0].title === "70%UP" && rg.data.bannerHover === void 0,
			JSON.stringify(rg.ok && rg.data && rg.data.gacha.map((x) => x.title)));

		// 反向证明：把 70%UP 的开始时间参数删掉 ⇒ 该池**不产出**（不会拿 100%UP 的日期顶）
		const noStart = wt.replace(/\|70%UP开始时间=[^\n]*\n/, "");
		const pools2 = parseZspmsFlags(noStart, ZSPMS_TZ);
		check("反证：删掉 `70%UP开始时间` ⇒ 只剩 100%UP 一个池（不硬造 70% 的起点）",
			pools2.length === 1 && pools2[0].pool === "100%UP", JSON.stringify(pools2.map((x) => x.pool)));
		check("反证：模板参数全删 ⇒ 抛 zspms-flags:no-pool（结构性损坏 ≠ 未公布）",
			throws(() => parseZspmsFlags("{{活动旗帜}}", ZSPMS_TZ)));
		// now 注入：11-13（两批都结束）⇒ 如实 null
		const rgAfter = await grab(() => gachaZspmsFlags(ZSPMS_FLAGS_URL, undefined, ZSPMS_TZ, sourceInstant(2026, 11, 13, 0, 0, ZSPMS_TZ)));
		check("now=2026-11-13（两批都结束）⇒ 返回 null（未公布，不硬凑）", rgAfter.ok && rgAfter.data === null, JSON.stringify(rgAfter.ok ? rgAfter.data : rgAfter.err));

		// 运行时登记：默认源换成活动旗帜；旧公告路径保留为 altSources 且仍能出数据
		const live = T.SOURCES.find((x) => x.id === "zspms");
		check("运行时 zspms.url = 活动旗帜页、source = 「Bwiki 活动旗帜」",
			!!live && live.url === ZSPMS_FLAGS_URL && live.source === "Bwiki 活动旗帜",
			live ? JSON.stringify([live.url.slice(0, 90), live.source]) : "缺失");
		check("旧公告源保留在 altSources（抓取器键 `zspms-bwiki-notice` 已登记）",
			!!live && (live.altSources || []).some((a) => a.fetcher === "zspms-bwiki-notice" && a.url === ZSPMS_ASK_URL)
			&& typeof T.GACHA_FETCHERS["zspms-bwiki-notice"] === "function",
			live ? JSON.stringify(live.altSources) : "缺失");
		const rgOld = await grab(() => T.GACHA_FETCHERS["zspms-bwiki-notice"](ZSPMS_ASK_URL, undefined, ZSPMS_TZ, SNAP));
		check("备选源（版本更新公告）仍能解析：now=夹具时刻 ⇒ 时崎狂三狙击 09-29 ~ 11-03",
			rgOld.ok && rgOld.data && rgOld.data.banner === "时崎狂三狙击 / 命运时崎狂三狙击",
			JSON.stringify(rgOld.ok && rgOld.data && rgOld.data.banner));
	}
	//#endregion

	//#region P8-7 战双帕弥什 —— 活动默认源换成 `Test4/活动日历`（2026-11-11）
	// 为什么换：活动侧原先靠「版本更新公告」正文（最新一版《远信回响》档期止于 11-05 ⇒ 11-06 起空窗）；
	// `Test4/活动日历` 是同站同写法的**结构化数据页**（一行一条 `{{活动日历|名|起|止}}`），
	// 源站更新一行就多一条 ⇒ 比正文规整、也不依赖标题层级。接它不等于"立刻有数据"：实测末条同样
	// 止于 2026/11/05 ⇒ 当前全部过期、如实 null；源站一补档就自动恢复。
	// 夹具 `p8-zspms-calendar`（729B 真响应，2026-11-11T00:58+08 抓）。
	section("P8-7 战双帕弥什 —— 活动默认源 = `Test4/活动日历`（结构化档期页；末条 11-05 过期不进外显）");
	const CAL_NOW_IN = sourceInstant(2026, 10, 20, 12, 0, ZSPMS_TZ);      // 「悍猎季风」10-19 收之后的在期时刻
	const CAL_NOW_AFTER = sourceInstant(2026, 11, 6, 0, 0, ZSPMS_TZ);     // 全部档期已过期
	const CAL_SNAP = Date.parse(fxMeta("p8-zspms-calendar/response.txt").capturedAt);   // 真机抓取时刻
	{
		const calRaw = fxJson("p8-zspms-calendar/response.txt");
		const calWt = mediaWikiWikitext(calRaw);
		check("活动日历是**数据页**（parse.title = `Test4/活动日历`），页名编码后与夹具 meta.url 一致",
			calRaw.parse.title === ZSPMS_CALENDAR_PAGE && fxMeta("p8-zspms-calendar/response.txt").url === ZSPMS_CALENDAR_URL,
			JSON.stringify([calRaw.parse.title, fxMeta("p8-zspms-calendar/response.txt").url]));
		check("正文 = **10 条** `{{活动日历|名|起|止}}`（源站注释写「只允许显示8个活动」，实际挂了 10 条）",
			(calWt.match(/\{\{活动日历\|/g) || []).length === 10 && /只允许显示8个活动/.test(calWt),
			String((calWt.match(/\{\{活动日历\|/g) || []).length));
		check("模板行是**三段位置参数**（名 | 起 | 止），末条 = 「新增涂装试玩」/ 2026/09/24 11:00 / 2026/11/05 5:00",
			/\{\{活动日历\|「新增涂装试玩」\|2026\/09\/24 11:00\|2026\/11\/05 5:00\}\}/.test(calWt));

		const cal = parseZspmsCalendar(calWt, ZSPMS_TZ);
		check("parseZspmsCalendar → 10 条、0 行被跳过（模板形态稳定）",
			cal.items.length === 10 && cal.skipped === 0, JSON.stringify([cal.items.length, cal.skipped]));
		check("活动名照抄源站（「」与类别后缀都不拆）：第 1 条「远信回响」主线、第 6 条「空滞轮旋之梦」联动剧情",
			cal.items[0].name === "「远信回响」主线" && cal.items[5].name === "「空滞轮旋之梦」联动剧情",
			JSON.stringify([cal.items[0].name, cal.items[5].name]));
		check("起止 = 2026-09-24 11:00 ~ 2026-11-05 05:00（+08）；raw 两端原文、display 补全（两份文本不合并）",
			cal.items[0].startTs === sourceInstant(2026, 9, 24, 11, 0, ZSPMS_TZ)
			&& cal.items[0].endTs === sourceInstant(2026, 11, 5, 5, 0, ZSPMS_TZ)
			&& cal.items[0].raw === "2026/09/24 11:00 ~ 2026/11/05 5:00"
			&& cal.items[0].display === "09-24 11:00 ~ 11-05 05:00",
			JSON.stringify([cal.items[0].raw, cal.items[0].display]));
		check("**末条（第 10 条）止于 2026-11-05 05:00** —— 这就是「当前空窗」的边界",
			cal.items[9].name === "「新增涂装试玩」"
			&& cal.items[9].endTs === sourceInstant(2026, 11, 5, 5, 0, ZSPMS_TZ),
			JSON.stringify([cal.items[9].name, cal.items[9].display]));

		// 反向证明：单行坏（终点早于起点 / 缺参）只跳过这一行；整页没有可解析行 ⇒ 抛错（结构性损坏 ≠ 未公布）
		check("反证：整页只剩错行/缺参 ⇒ 抛 `zspms-calendar:no-window`（不当'未公布'）",
			throws(() => parseZspmsCalendar("{{活动日历|坏的|2026/11/05 5:00|2026/10/01 5:00}}\n{{活动日历|缺参|2026/11/05 5:00}}", ZSPMS_TZ)));
		const calMixed = calWt.replace(/\{\{活动日历\|「悍猎季风」头目挑战\|[^}]*\}\}/, "{{活动日历|坏的|2026/11/05 5:00|2026/10/01 5:00}}");
		check("反证：混入一行错行 ⇒ 仍解出 9 条、skipped=1（单行坏不拖垮整页）",
			(() => { const r = parseZspmsCalendar(calMixed, ZSPMS_TZ); return r.items.length === 9 && r.skipped === 1; })(),
			JSON.stringify((() => { const r = parseZspmsCalendar(calMixed, ZSPMS_TZ); return [r.items.length, r.skipped]; })()));

		// 抓取器：真机 now（2026-11-11）⇒ 全部过期 ⇒ 如实 null（末条 11-05 不冒充在期）
		const calNow = await grab(() => eventsZspmsCalendar(ZSPMS_CALENDAR_URL, undefined, ZSPMS_TZ, CAL_SNAP));
		check("now = 夹具抓取时刻（2026-11-11 00:58）⇒ 活动侧返回 null（10 条全部已过期，不硬凑）",
			calNow.ok && calNow.data === null, JSON.stringify(calNow.ok ? calNow.data : calNow.err));
		const calAfter = await grab(() => eventsZspmsCalendar(ZSPMS_CALENDAR_URL, undefined, ZSPMS_TZ, CAL_NOW_AFTER));
		check("now = 2026-11-06 00:00 ⇒ null（「末条 11-05」这类过期条目**不进外显**）",
			calAfter.ok && calAfter.data === null, JSON.stringify(calAfter.ok ? calAfter.data : calAfter.err));

		// now = 10-20 12:00：「悍猎季风」10-19 05:00 已结束 ⇒ 不进外显、也不进悬停
		const calIn = await grab(() => eventsZspmsCalendar(ZSPMS_CALENDAR_URL, undefined, ZSPMS_TZ, CAL_NOW_IN));
		check("event 抓取成功（now 传第 4 参）", calIn.ok, calIn.err);
		assertContract("战双(活动日历)", "event", calIn.ok ? calIn.data : null);
		check("外显 = 内容档里结束最早的（「空滞轮旋之梦」联动剧情 09-29 11:00 ~ 11-03 05:00）",
			calIn.ok && calIn.data && calIn.data.event === "「空滞轮旋之梦」联动剧情"
			&& calIn.data.eventDates === "09-29 11:00 ~ 11-03 05:00"
			&& calIn.data.eventDatesRaw === "2026/09/29 11:00 ~ 2026/11/03 5:00",
			JSON.stringify(calIn.ok && calIn.data && [calIn.data.event, calIn.data.eventDates, calIn.data.eventDatesRaw]));
		const calHover = (calIn.ok && calIn.data && calIn.data.eventHover) || "";
		const calLines = calHover.split("\n");
		check("悬停 = 9 条在期（「悍猎季风」头目挑战 10-19 收 ⇒ **不在**悬停里）；名称在前 + 3 空格 + 档期",
			calLines.length === 9
			&& calLines[0] === "「空滞轮旋之梦」联动剧情   09-29 11:00 ~ 11-03 05:00"
			&& calLines.every((l) => !l.includes("悍猎季风"))
			&& calLines.every((l) => /^.+? {3}\S/.test(l)),
			JSON.stringify(calLines.slice(0, 3)));
		check("⚠️ 活动日历 hover 里没有元信息（来源站名/URL/页面名/tz 推定/抓取条数）",
			!/bwiki|biligame|api\.php|https?:|tz\s*=|UTC|推测|推定|共\s*扫描|页面|模板/.test(calHover),
			JSON.stringify(calLines.slice(0, 1)));

		// 运行时登记：活动默认源 = **官方 CDN**（2026-11-11）；两个 bwiki 页面都保留为 eventAltSources
		const liveZs = T.SOURCES.find((x) => x.id === "zspms");
		check("运行时 zspms.eventUrl = 官方 CDN 菜单、eventSource = 「官方公告」",
			!!liveZs && liveZs.eventUrl === ZSPMS_CDN_MENU_URL && liveZs.eventSource === "官方公告",
			liveZs ? JSON.stringify([liveZs.eventUrl.slice(0, 90), liveZs.eventSource]) : "缺失");
		check("活动日历降为 eventAltSources（抓取器键 `zspms-bwiki-calendar` 已登记、仍能出数据）",
			!!liveZs && (liveZs.eventAltSources || []).some((a) => a.fetcher === "zspms-bwiki-calendar" && a.url === ZSPMS_CALENDAR_URL)
			&& typeof T.EVENT_FETCHERS["zspms"]["zspms-bwiki-calendar"] === "function",
			liveZs ? JSON.stringify(liveZs.eventAltSources) : "缺失");
		check("旧公告源保留在 eventAltSources（抓取器键 `zspms-bwiki-notice` 已登记）",
			!!liveZs && (liveZs.eventAltSources || []).some((a) => a.fetcher === "zspms-bwiki-notice" && a.url === ZSPMS_ASK_URL)
			&& typeof T.EVENT_FETCHERS["zspms"]["zspms-bwiki-notice"] === "function",
			liveZs ? JSON.stringify(liveZs.eventAltSources) : "缺失");
		const calAlt = await grab(() => T.EVENT_FETCHERS["zspms"]["zspms-bwiki-calendar"](ZSPMS_CALENDAR_URL, undefined, ZSPMS_TZ, CAL_NOW_IN));
		check("备选源（活动日历）手动切过去仍能出数据：now=10-20 ⇒ 空滞轮旋之梦 09-29 ~ 11-03",
			calAlt.ok && calAlt.data && calAlt.data.event === "「空滞轮旋之梦」联动剧情",
			JSON.stringify(calAlt.ok && calAlt.data && calAlt.data.event));
		const calOld = await grab(() => T.EVENT_FETCHERS["zspms"]["zspms-bwiki-notice"](ZSPMS_ASK_URL, undefined, ZSPMS_TZ, SNAP));
		check("备选源（版本更新公告）仍能解析：now=夹具时刻 ⇒ 悍猎季风-BOSS挑战 09-25 ~ 10-19（旧路一字未坏）",
			calOld.ok && calOld.data && calOld.data.event === "悍猎季风-BOSS挑战",
			JSON.stringify(calOld.ok && calOld.data && calOld.data.event));
		check("页面请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => eventsZspmsCalendar("https://example.invalid/zspms-calendar", undefined, ZSPMS_TZ, SNAP)));
	}
	//#endregion

	//#region P8-8 战双帕弥什 —— 活动默认源换成**官方 CDN**「版本更新公告」（2026-11-11）
	// 为什么换：活动日历只抄到 2026/11/05 ⇒ 面板从 11-06 起空窗；官方 CDN 的《流光抛诸寰宇》公告
	// 已经把 11-05 版本更新那批写到 12-17（12 处「2026年11月5日版本更新后 - 2026年12月17日05:00」）。
	// 夹具（2026-11-11T01:31+08 真抓，HTTP 200 / `ACAO:*`）：
	//   `p8-zspms-cdn-menu`      ArticleMenu.json（217 条）
	//   `p8-zspms-cdn-art5682`   《流光抛诸寰宇》版本更新公告（2026-11-03）
	//   `p8-zspms-cdn-art5467`   《远信回响》版本更新公告（2026-09-22）
	//   `p8-zspms-cdn-art5306`   《歧海循光》版本更新公告（2026-08-17）
	// 难点（本区逐条钉住）：正文是 HTML 富文本、活动名在 `<strong>` 里、维护窗口与活动窗口混排、
	// 起点写「版本更新后」⇒ 仓库口径要求 startTs=null（起点未知 ≠ 已开始）。
	section("P8-8 战双帕弥什 —— 活动默认源 = 官方 CDN「版本更新公告」（HTML 正文 → 档期；起点未知留 null）");
	const CDN_NOW = sourceInstant(2026, 11, 11, 12, 0, ZSPMS_TZ);      // 真机 now（11-05 版本更新那批在期）
	const CDN_NOW_BEFORE = sourceInstant(2026, 11, 5, 6, 0, ZSPMS_TZ); // 11-05 维护已结束、新版本活动还没「有起点」
	const CDN_NOW_OCT = sourceInstant(2026, 10, 1, 12, 0, ZSPMS_TZ);   // 「远信回响」批次在期（证明合并了 3 篇）
	const CDN_NOW_AFTER = sourceInstant(2026, 12, 18, 0, 0, ZSPMS_TZ); // 最近一篇的档期全部收尾
	{
		// ── ① 菜单：按标题挑，不硬编码 id ─────────────────────────────────────
		const menu = fxJson("p8-zspms-cdn-menu/response.txt");
		check("菜单夹具是真响应：JSON **数组** 217 条、meta 里 url/capturedAt/status 齐备",
			Array.isArray(menu) && menu.length === 217
			&& fxMeta("p8-zspms-cdn-menu/response.txt").url === ZSPMS_CDN_MENU_URL
			&& fxMeta("p8-zspms-cdn-menu/response.txt").status === 200
			&& Number.isFinite(Date.parse(fxMeta("p8-zspms-cdn-menu/response.txt").capturedAt)),
			JSON.stringify([Array.isArray(menu), menu.length]));
		const rows = zspmsCdnMenuRows(menu);
		check("菜单行的关键字段：articleId / articleTitle / startTime（发布时间）",
			rows.length === 217 && rows.every((r) => Number.isFinite(r.id) && r.title && typeof r.published === "string"),
			JSON.stringify(rows[0]));
		const notices = zspmsCdnNoticesOf(menu);
		check("⚠️ 菜单**不是**时间序（置顶/推荐混排）：首元素是 5687（PV，17:27:52）而最新一篇**公告**是 5682（17:26:05）⇒ 必须自己按发布时间倒序排",
			menu[0].articleId === 5687 && notices[0].id === 5682
			&& rows.slice().sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0))[0].id === 5687,
			JSON.stringify([menu[0].articleId, notices[0].id]));
		check("标题匹配「版本更新公告」类 = **49 篇**（清洗后匹配，不认单个 id；PV/版本一览/封禁公示/《遥岸方舟》版本更新 都不算）",
			notices.length === 49 && notices.every((r) => /版本更新公告/.test(zspmsCdnCleanName(r.title))),
			String(notices.length));
		check("按发布时间倒序取前 3 篇 = 5682 / 5467 / 5306（《流光抛诸寰宇》《远信回响》《歧海循光》）",
			ZSPMS_CDN_MAX_NOTICES === 3
			&& JSON.stringify(notices.slice(0, 3).map((r) => r.id)) === JSON.stringify(CDN_ART_IDS)
			&& notices.slice(0, 3).every((r, i, a) => i === 0 || a[i - 1].published >= r.published),
			JSON.stringify(notices.slice(0, 4).map((r) => [r.id, r.published])));
		check("详情地址 = article/<id>.json（与夹具 meta.url 逐字一致）",
			zspmsCdnArticleUrl(5682) === ZSPMS_CDN_ARTICLE_BASE + "5682.json"
			&& fxMeta("p8-zspms-cdn-art5682/response.txt").url === zspmsCdnArticleUrl(5682),
			zspmsCdnArticleUrl(5682));

		// ── ② 正文解析：活动名在 <strong> 里 ──────────────────────────────────
		const art = zspmsCdnArticleOf(fxJson("p8-zspms-cdn-art5682/response.txt"));
		check("详情 JSON 是**对象**（不是数组）；标题/正文/发布时间都在 articleContent 一层",
			art.title === "《流光抛诸寰宇》版本更新公告" && art.html.length > 15000 && art.published === "2026-11-03 17:26:05",
			JSON.stringify([art.title, art.html.length, art.published]));
		check("活动名确实住在 `<strong>` 里（正文是 HTML 富文本：`<span style=\"font-size: 18pt;\"><strong>四、像素嚼嚼乐</strong></span>`）",
			/<strong>四、像素嚼嚼乐<\/strong>/.test(art.html)
			&& /<strong><span[^>]*>1）活动说明<\/span><\/strong>|<strong><span[^>]*>4）活动时间<\/span><\/strong>/.test(art.html),
			JSON.stringify([/<strong>四、像素嚼嚼乐<\/strong>/.test(art.html), /<strong>4）活动时间<\/strong>/.test(art.html)]));
		const hint = zspmsCdnHintOf(art.published);
		check("发布时间 → 缺年份线索 = { 2026, 11 }",
			hint && hint.y === 2026 && hint.mo === 11, JSON.stringify(hint));
		const parsed = zspmsCdnActivitiesOfArticle(art.html, ZSPMS_TZ, hint);
		const byName = (n) => parsed.items.find((x) => x.name === n) || null;
		check("《流光抛诸寰宇》正文解出 **17 条**活动档期（3 条被跳过：句子里的研发池档期）",
			parsed.items.length === 17 && parsed.skipped === 3,
			JSON.stringify([parsed.items.length, parsed.skipped]));
		const lgy = byName("揽光一瞬");
		check("「揽光一瞬」：起点写「版本更新后」⇒ **startTs=null**（不猜）、终点绝对 12-17 05:00（+08）",
			!!lgy && lgy.startTs === null && lgy.endTs === sourceInstant(2026, 12, 17, 5, 0, ZSPMS_TZ)
			&& lgy.startRel === "版本更新后" && lgy.startInferred === true,
			JSON.stringify(lgy && [lgy.startTs, lgy.endTs, lgy.startRel]));
		check("「揽光一瞬」raw = 源站原文那一句、display = 两端补全（两份文本不合并）",
			!!lgy && lgy.raw === "2026年11月5日版本更新后 ~ 2026年12月17日05:00"
			&& lgy.display === "11-05 版本更新后 ~ 12-17 05:00",
			JSON.stringify(lgy && [lgy.raw, lgy.display]));
		const bhw = byName("诸星迷寂-BOSS挑战");
		check("「诸星迷寂-BOSS挑战」两端都绝对 = 11-06 10:00 ~ 11-30 05:00（**这一条才会进外显**）",
			!!bhw && bhw.startTs === sourceInstant(2026, 11, 6, 10, 0, ZSPMS_TZ)
			&& bhw.endTs === sourceInstant(2026, 11, 30, 5, 0, ZSPMS_TZ),
			JSON.stringify(bhw && [bhw.display, bhw.raw]));
		check("`6）「伴航补给」研发` → 活动名取引号内那段（`伴航补给`，不是整行）",
			!!byName("伴航补给") && byName("伴航补给").startTs === sourceInstant(2026, 11, 12, 10, 0, ZSPMS_TZ));
		check("`战略评定手册-栖光档案` 名字里的 `-` 不当作装饰符剥掉",
			!!byName("战略评定手册-栖光档案"));
		check("`泛用式·终 异色涂装` 名字里的 `·` 保留（`莱亚·祈星` 这类机体名靠它）",
			!!byName("泛用式·终 异色涂装"));
		check("⚠️ 研发池句子里的档期**不算活动**（`…研发池获得` 那几行）：没有 莱亚·祈星 / 扭曲缎带的边陲 / 聆璃",
			!byName("莱亚·祈星") && !byName("扭曲缎带的边陲") && !byName("聆璃")
			&& parsed.items.every((x) => !/研发池/.test(x.name)),
			JSON.stringify(parsed.items.map((x) => x.name)));

		// ── ③ 维护窗口 ≠ 活动窗口 ─────────────────────────────────────────────
		check("维护句「将于2026年11月5日05:00 - 11:00进行…停服维护」**不是**窗口（右侧没有日期）",
			zspmsCdnWindowsOfLine("我们将于2026年11月5日05:00 - 11:00进行“流光抛诸寰宇”版本更新的停服维护", ZSPMS_TZ, hint).length === 0);
		check("反证：即使写成完整两端（05:00 - 2026年11月5日11:00）也**不进活动**（该行既无时间标签、又不是整行档期）",
			zspmsCdnActivitiesOfArticle("<div><strong><span>四、维护测试</span></strong><br><span>我们将于2026年11月5日05:00 - 2026年11月5日11:00进行停服维护</span></div>", ZSPMS_TZ, hint).items.length === 0);
		check("反证：写成 `停服维护活动时间：<完整窗口>` 也不进活动（维护字样优先排除）",
			zspmsCdnActivitiesOfArticle("<div><strong><span>四、维护测试</span></strong><br><span>停服维护活动时间：2026年11月5日05:00 - 2026年11月5日11:00</span></div>", ZSPMS_TZ, hint).items.length === 0);
		check("正证：同一份正文里**活动**窗口照旧解得出来（`活动时间：` 标签那条）",
			zspmsCdnActivitiesOfArticle("<div><strong><span>四、像素嚼嚼乐</span></strong><br><strong><span>4）活动时间</span></strong><br><span>2026年11月19日10:00 - 2026年12月16日05:00</span></div>", ZSPMS_TZ, hint).items.length === 1);

		// ── ④ 缺年份 / 跨年（复用 inferYear / endsNextYear）───────────────────
		const noYear = zspmsCdnWindowsOfLine("活动时间：11月6日10:00 - 11月30日05:00", ZSPMS_TZ, hint);
		check("缺年份 ⇒ 借公告发布时间补（共用 inferYear）：11-06 10:00 ~ 11-30 05:00（2026）",
			noYear.length === 1
			&& noYear[0].startTs === sourceInstant(2026, 11, 6, 10, 0, ZSPMS_TZ)
			&& noYear[0].endTs === sourceInstant(2026, 11, 30, 5, 0, ZSPMS_TZ),
			JSON.stringify(noYear.map((w) => w.display)));
		const cross = zspmsCdnWindowsOfLine("活动时间：12月28日10:00 - 1月5日05:00", ZSPMS_TZ, { y: 2026, mo: 12 });
		check("跨年（结束月日早于开始）⇒ 结束记次年（共用 endsNextYear）：2026-12-28 ~ **2027**-01-05",
			cross.length === 1
			&& cross[0].startTs === sourceInstant(2026, 12, 28, 10, 0, ZSPMS_TZ)
			&& cross[0].endTs === sourceInstant(2027, 1, 5, 5, 0, ZSPMS_TZ),
			JSON.stringify(cross.map((w) => w.display)));
		check("没有年份线索 ⇒ **不产出**（不猜当前年）",
			zspmsCdnWindowsOfLine("活动时间：11月6日10:00 - 11月30日05:00", ZSPMS_TZ, null).length === 0);

		// ── ⑤ 抓取器：菜单 → 最近 3 篇 → 合并 → 载荷（now 传第 4 参）──────────
		const cdnNow = await grab(() => eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW));
		check("官方 CDN 抓取成功（now 传第 4 参）", cdnNow.ok, cdnNow.err);
		assertContract("战双(官方 CDN)", "event", cdnNow.ok ? cdnNow.data : null);
		const dNow = cdnNow.ok ? cdnNow.data : null;
		check("外显 = 「诸星迷寂-BOSS挑战」11-06 10:00 ~ 11-30 05:00（真机 now 下唯一两端都明确的在期活动）",
			!!dNow && dNow.event === "诸星迷寂-BOSS挑战"
			&& dNow.eventDates === "11-06 10:00 ~ 11-30 05:00"
			&& dNow.eventDatesRaw === "2026年11月6日10:00 ~ 2026年11月30日 05:00",
			JSON.stringify(dNow && [dNow.event, dNow.eventDates, dNow.eventDatesRaw]));
		const hover = (dNow && dNow.eventHover) || "";
		const hoverLines = hover ? hover.split("\n") : [];
		check("悬停首行 = 外显那条（名称 + 3 空格 + 档期）",
			hoverLines[0] === "诸星迷寂-BOSS挑战   11-06 10:00 ~ 11-30 05:00", JSON.stringify(hoverLines[0]));
		check("悬停里 11-05 版本更新那批**按源站原文**列出（起点未知 ⇒ 原文优先，例：尽心者尽美-角色试玩关 到 12-17）",
			hoverLines.includes("尽心者尽美-角色试玩关   2026年11月5日版本更新后 ~ 2026年12月17日05:00")
			&& hoverLines.includes("7日登录签到奖励   2026年11月5日版本更新后 ~ 2026年12月16日05:00"),
			JSON.stringify(hoverLines.slice(1, 3)));
		check("悬停共 14 条（在期 1 条 + 起点未知但终点未过 13 条）",
			hoverLines.length === 14, String(hoverLines.length));
		assertHoverConvention("战双(官方 CDN)", hover);
		check("⚠️ 悬停里没有元信息（域名/URL/抓取篇数/时区推定/维护窗口）",
			!/kurogame|https?:|ArticleMenu|tz\s*=|UTC|推测|推定|共\s*扫描|停服维护/.test(hover), JSON.stringify(hoverLines.slice(0, 1)));
		const evArr = (dNow && dNow.events) || [];
		check("数组：主条 = 两端明确的 诸星迷寂（startTs/endTs 都是数字），11-05 那批以 raw 原文并列",
			evArr.length === 14 && evArr[0].title === "诸星迷寂-BOSS挑战"
			&& typeof evArr[0].startTs === "number" && typeof evArr[0].endTs === "number"
			&& evArr.slice(1).every((x) => x.raw.includes("版本更新后")),
			JSON.stringify(evArr.slice(0, 2).map((x) => [x.title, x.startTs, x.endTs])));

		// now 注入：三篇合并的证据（10-01 时「远信回响」批次在期，只有合并前两篇才解得出来）
		const cdnOct = await grab(() => eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW_OCT));
		check("合并 3 篇：now=2026-10-01 ⇒ 外显 = 悍猎季风-BOSS挑战（09-25 10:00 ~ 10-19 05:00，出在第 2 篇公告里）",
			cdnOct.ok && cdnOct.data && cdnOct.data.event === "悍猎季风-BOSS挑战"
			&& cdnOct.data.eventDates === "09-25 10:00 ~ 10-19 05:00",
			JSON.stringify(cdnOct.ok && cdnOct.data && [cdnOct.data.event, cdnOct.data.eventDates]));
		const cdnBefore = await grab(() => eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW_BEFORE));
		check("⚠️ now=2026-11-05 06:00（维护后 1 小时、新活动尚无起点）⇒ 返回 null：起点未知**不冒充在期**",
			cdnBefore.ok && cdnBefore.data === null, JSON.stringify(cdnBefore.ok ? cdnBefore.data : cdnBefore.err));
		const cdnAfter = await grab(() => eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW_AFTER));
		check("now=2026-12-18（最近一篇也收尾）⇒ 返回 null（未公布，不硬凑过期档期）",
			cdnAfter.ok && cdnAfter.data === null, JSON.stringify(cdnAfter.ok ? cdnAfter.data : cdnAfter.err));

		// ── ⑥ 反证（关掉关键解析 ⇒ 抛错 / 少解）──────────────────────────────
		const noStrong = art.html.replace(/<\/?strong[^>]*>/gi, "");
		check("反证：把 `<strong>` 全去掉（= 关掉「整行加粗 = 标题」）⇒ 一篇公告**一条名字都抽不出**",
			zspmsCdnActivitiesOfArticle(noStrong, ZSPMS_TZ, hint).items.length === 0,
			JSON.stringify(zspmsCdnActivitiesOfArticle(noStrong, ZSPMS_TZ, hint).skipped));
		check("反证：菜单里没有「版本更新公告」⇒ 抛 `zspms-cdn:no-notice`（标题样式改版 ≠ 未公布）",
			(() => { try { zspmsCdnNoticesOf([{ articleId: 1, articleTitle: "《战双帕弥什》新版本PV公开", articleType: 4, startTime: "2026-11-03 17:27:52" }]); return false; } catch (e) { return String(e.message) === "zspms-cdn:no-notice"; } })());
		check("反证：正文里一个档期都没有 ⇒ 抓取器抛 `zspms-cdn:no-window`（结构性损坏 ≠ 未公布）",
			await (async () => {
				setFetchImpl(cdnImpl({
					[ZSPMS_CDN_MENU_URL]: fxText("p8-zspms-cdn-menu/response.txt"),
					[zspmsCdnArticleUrl(5682)]: JSON.stringify({ articleId: 5682, articleTitle: "《流光抛诸寰宇》版本更新公告", startTime: "2026-11-03 17:26:05", articleContent: "<div><span>尊敬的指挥官：本次版本更新没有活动档期。</span></div>" })
				}));
				try { await eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW); return false; }
				catch (e) { return String(e.message) === "zspms-cdn:no-window"; }
				finally { useFixtures(OVERRIDES); }
			})());
		check("反证：把 `版本更新后` 换成显式时刻 ⇒ 同一条立刻有 startTs（证明 null 是**判出来的**、不是丢字段）",
			(() => {
				const mutated = art.html.replace(/2026年11月5日版本更新后/g, "2026年11月5日10:00");
				const m = zspmsCdnActivitiesOfArticle(mutated, ZSPMS_TZ, hint).items.find((x) => x.name === "揽光一瞬");
				return !!m && m.startTs === sourceInstant(2026, 11, 5, 10, 0, ZSPMS_TZ) && m.startInferred === false;
			})());
		check("反证：详情 404 ⇒ 抛错（三篇全挂才算失败，单篇失败只用其余篇）",
			await (async () => {
				setFetchImpl(cdnImpl({
					[ZSPMS_CDN_MENU_URL]: fxText("p8-zspms-cdn-menu/response.txt"),
					[zspmsCdnArticleUrl(5682)]: fxText("p8-zspms-cdn-art5682/response.txt"),
					[zspmsCdnArticleUrl(5467)]: fxText("p8-zspms-cdn-art5467/response.txt")
					// 5306 不提供 ⇒ 404 ⇒ 跳过这一篇
				}));
				try {
					const r = await eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW_OCT);
					return !!(r && r.event === "悍猎季风-BOSS挑战");     // 前两篇够用
				} catch { return false; }
				finally { useFixtures(OVERRIDES); }
			})());
		check("反证：菜单三篇全 404 ⇒ 抛错（抓取失败 ≠ 未公布）",
			await (async () => {
				setFetchImpl(cdnImpl({ [ZSPMS_CDN_MENU_URL]: fxText("p8-zspms-cdn-menu/response.txt") }));
				try { await eventsZspmsCdn(ZSPMS_CDN_MENU_URL, undefined, ZSPMS_TZ, CDN_NOW); return false; }
				catch (e) { return /proxy|404|proxy-http/.test(String(e.message)); }
				finally { useFixtures(OVERRIDES); }
			})());

		// ── ⑦ 夹具卫生（官方 CDN 的 4 份）────────────────────────────────────
		for (const f of ["p8-zspms-cdn-menu", "p8-zspms-cdn-art5682", "p8-zspms-cdn-art5467", "p8-zspms-cdn-art5306"]) {
			const body = fxText(`${f}/response.txt`);
			const meta = fxMeta(`${f}/response.txt`);
			check(`夹具 ${f}：真响应（HTTP 200 + JSON + url/capturedAt/trim 元数据）`,
				body.length > 2000 && JSON.parse(body) && meta.status === 200 && !!meta.capturedAt && !!meta.url && !!meta.trim,
				JSON.stringify([body.length, meta.status]));
		}
		check("官方 CDN 夹具里**没有** HTML 错误页痕迹（WAF / <html / requestId）",
			["p8-zspms-cdn-menu", "p8-zspms-cdn-art5682"]
				.every((f) => !/requestId|<html|EdgeOne/i.test(fxText(`${f}/response.txt`).slice(0, 2000))));
	}
	//#endregion

	//#region P8-5 端到端（经 registry）+ 夹具卫生
	section("P8-5 端到端（经 registry-p8 的 5 个侧）+ 夹具卫生");
	{
		const SNAP_ALL = [SNAP, SNAP_ASK, SNAP_CZN, SNAP_KEDR];
		check("4 个夹具的 capturedAt 都是同一次抓取（2026-10-02T16:33Z 附近）",
			SNAP_ALL.every((x) => Number.isFinite(x) && Math.abs(x - SNAP) < 3 * 60000),
			JSON.stringify(SNAP_ALL.map((x) => new Date(x).toISOString())));
		check("夹具抓取时刻渲染成 UTC+8 = 2026-10-03 00:33",
			wall(SNAP, ZSPMS_TZ) === "2026-10-03 00:33", wall(SNAP, ZSPMS_TZ));
		const sides = [
			["zspms", "gacha", true], ["zspms", "event", true],
			["czn", "gacha", false],   // Lua 最新一期 2026-07-08 止 → 当期 null
			["kedr", "gacha", true], ["kedr", "event", true]
		];
		for (const [id, side, expectData] of sides) {
			const src = findSourceP8(id);
			const r = await grab(() => src[side].fetcher(src[side].url, undefined, src.tz, SNAP));
			check(`P8 ${id}.${side} 抓取成功（离线夹具，now=夹具时刻）`, r.ok, r.err);
			assertContract(`${id}.${side}`, side, r.ok ? r.data : null);
			check(`P8 ${id}.${side} 当期可用性符合实测（${expectData ? "有数据" : "如实 null"}）`,
				r.ok && (expectData ? (r.data !== null && (side === "gacha" ? r.data.banner.length > 0 : r.data.event.length > 0)) : r.data === null),
				JSON.stringify(r.ok ? (r.data && (r.data.banner || r.data.event)) : r.err));

			// ── 方案 A 守卫（用户 2026-10-03）──────────────────────────────────
			// ① 悬停里**不许**再出现元信息：来源站名/域名/URL/API 或页面名、tz 推定、抓取条数、内部 id、实现说明
			//    （卡池侧没有当期池 → 字段缺失，也合法）
			const hover = r.ok && r.data ? (side === "gacha" ? r.data.bannerHover : r.data.eventHover) : null;
			check(`P8 ${id}.${side} 悬停无元信息（无来源站名/URL/页面名/tz 推定/抓取条数/内部 id）`,
				!hover || !/bwiki|biligame\.com|api\.php|https?:|SMW|tz\s*=|UTC|推测|推定|共\s*扫描|起点锚点|维护结束|Module:|Template:|Lua 表|post_id|typeId|gameExtensionId/.test(hover),
				JSON.stringify((hover || "").split("\n").slice(0, 2)));
			// ② 排版与本体一致：**名称在前**（以日期开头的行只能是纯档期行）；活动侧档期前必须是**3 个空格**
			const lines = hover ? hover.split("\n") : [];
			const WINDOW_RE = /^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/;
			check(`P8 ${id}.${side} 悬停「名称在前」（日期开头的行必须是纯档期行）`,
				lines.every((l) => WINDOW_RE.test(l) || !/^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}/.test(l)),
				JSON.stringify(lines.slice(0, 3)));
			if (side === "event") {
				check(`P8 ${id}.event 悬停档期排版与本体逐字一致（名称 + 3 空格 + fmtWindow 档期）`,
					lines.every((l) => {
						const m = WINDOW_RE.exec(l);
						if (!m) return true;
						return m.index === 0 || / {3}$/.test(l.slice(0, m.index));
					}),
					JSON.stringify(lines.slice(0, 3)));
			}
		}
		// 夹具卫生：5 个夹具都是真响应（非空 JSON，且是预期的源站结构）
		for (const f of ["p8-zspms-ask", "p8-zspms-notice", "p8-czn-module", "p8-kedr-template", "p8-czn-record"]) {
			const body = fxText(`${f}/response.txt`);
			const meta = fxMeta(`${f}/response.txt`);
			check(`夹具 ${f}：真响应（HTTP 200 + JSON + status/capturedAt 元数据 + url）`,
				body.length > 100 && body.trim().startsWith("{") && JSON.parse(body)
				&& meta.status === 200 && !!meta.capturedAt && !!meta.url,
				JSON.stringify([body.length, meta.status]));
		}
		check("夹具里**没有** WAF 挑战页痕迹（567 / requestId / <html）",
			["p8-zspms-ask", "p8-zspms-notice", "p8-czn-module", "p8-kedr-template", "p8-czn-record"]
				.every((f) => !/requestId|<html|EdgeOne/i.test(fxText(`${f}/response.txt`).slice(0, 2000))));

		// ── 方案 A 的兜底约定（本文件三源据此决定「是否设 bannerHover / eventHover」）──
		// 共用工具对 **<2 池 / <2 条** 返回 ""（= 交回 UI 的「池名：角色 ⏎ 档期」/「event ⏎ 档期」两行式）。
		// 所以解析器必须**不设**该字段（而不是设成空串）——上面 kedr now=10-05 那条就是端到端证据。
		check("共用工具兜底：hoverPool / hoverEvent 对 <2 项返回 \"\"（解析器据此不设 hover 字段）",
			hoverPool([{ name: "唯一池：角色", startTs: SNAP, endTs: SNAP + 864e5 }], ZSPMS_TZ) === ""
			&& hoverEvent([{ name: "唯一活动", startTs: SNAP, endTs: SNAP + 864e5 }], ZSPMS_TZ) === ""
			&& hoverPool([], ZSPMS_TZ) === "" && hoverEvent([], ZSPMS_TZ) === "");
	}
	//#endregion

	// all.mjs 会调用 summary()；直接 `node test/cases-p8.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-p8.mjs")) summary();
}

// 直接执行时自动跑（被 test/all.mjs import 时不自动跑）
if (process.argv[1] && process.argv[1].endsWith("cases-p8.mjs")) await run();
