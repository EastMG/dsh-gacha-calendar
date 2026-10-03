// next-sources/test/cases-p6.mjs —— 批次 P6 离线夹具测试
//   ① 嘟嘟脸恶作剧 国服（biligame 官方公告 API：列表 + 详情正文抽档期，源站自标 (UTC+9)）
//   ② 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 四个原则（照 CONVENTIONS.md 与 cases-b1/b3）：
//   ① 全程离线：useFixtures(OVERRIDES) 注入夹具 fetch；纯函数测试直接读 fixtures/*.txt。
//   ② 确定性：「当前时刻」一律用**夹具抓取时刻**（meta.capturedAt）或**显式注入的 now**，
//      绝不用 Date.now() —— 否则一个月后"当期"变了会**假失败**。
//   ③ 每个抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断 test/all.mjs。
//   ④ 断言里的硬编码值都是**夹具快照值**（重抓夹具后需同步更新），并尽量标注推导过程。
//
// 本地直接跑：node test/cases-p6.mjs

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
const { sourceInstant, sourceWallParts, fmtWindow } = T;
import { SOURCES_P6, findSourceP6, listIdsP6 } from "./registry-shim.mjs";
import { T } from "./load.mjs";

const { gachaDdlezj, eventsDdlezj, parseDdlezjList, parseDdlezjAnnouncement, parseDdlezjWindows, pickDdlezjGacha, pickDdlezjEvent, parseDdlezjStamp, ddlezjParagraphs, DDLEZJ_LIST_URL, DDLEZJ_TZ, DDLEZJ_CMS_TZ, DDLEZJ_GAME_EXTENSION_ID } = T.parsers["biligame-announce"];
const { gachaKedrWiki, parseKedrArchive, kedrSections, kedrStamp, kedrPools, kedrRoles, kedrParseUrl, KEDR_ARCHIVE_URL, KEDR_ARCHIVE_PAGE, KEDR_TZ } = T.parsers["kedr-wiki"];

// ── 夹具读取 ──
const fixtureText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const fixtureJson = (p) => JSON.parse(fixtureText(p));
const meta = (p) => JSON.parse(fixtureText(p + ".meta.json"));

// 夹具覆盖：URL → fixtures/<name>/response.txt（**显式写死**，不只依赖多人共写的 test/map.json）
// 详情夹具只抓了 17825：用**前缀键**让列表里每个 id 都命中它（harness 匹配顺序"精确 → 前缀"，
// 17825 的精确键在 map.json 里仍在，且 list URL 有精确键，不会被前缀键抢走）。
// 这样"逐条抓详情直到找到可用公告"的逻辑可离线复现，也不会因为夹具缺 404 而走进抛错分支。
const OVERRIDES = {
	[DDLEZJ_LIST_URL]: "p6-ddlezj-list/response.txt",
	"https://api.biligame.com/news/": "p6-ddlezj-detail/response.txt",
	[KEDR_ARCHIVE_URL]: "p6-kedr-archive/response.txt"
};

// 夹具抓取时刻（= 抓取那一刻）当"当前时刻"
const SNAP_LIST = Date.parse(meta("p6-ddlezj-list/response.txt").capturedAt);
const SNAP_DET = Date.parse(meta("p6-ddlezj-detail/response.txt").capturedAt);
const SNAP_KEDR = Date.parse(meta("p6-kedr-archive/response.txt").capturedAt);

// 关键"注入 now"（与系统时间无关）：
const NOW_IN_PERIOD = sourceInstant(2026, 4, 30, 12, 0, DDLEZJ_TZ);   // 2026-04-30 12:00 (UTC+9)
const NOW_AFTER_GACHA = sourceInstant(2026, 5, 7, 10, 0, DDLEZJ_TZ);  // 2026-05-07 10:00 (UTC+9) 卡池已收、活动未收
const NOW_BEFORE_ALL = sourceInstant(2026, 4, 20, 12, 0, DDLEZJ_TZ);  // 全部未开
const KEDR_NOW = sourceInstant(2026, 6, 25, 3, 0, KEDR_TZ);           // 2026-06-25 03:00 (UTC+8) → 1.0.0-1
const KEDR_NOW2 = sourceInstant(2026, 7, 1, 0, 0, KEDR_TZ);           // 2026-07-01 00:00 (UTC+8) → 1.0.0-2

// 抓取器调用包装：失败只记 ✗（不抛，避免中断共享 runner）
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }
async function throwsAsync(fn) { try { await fn(); return false; } catch { return true; } }
const wall = (ts, tz) => {
	const w = sourceWallParts(ts, tz);
	const p = (n) => String(n).padStart(2, "0");
	return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};

export default async function run() {
	useFixtures(OVERRIDES);

	//#region P6-0 注册表片段
	section("P6-0 注册表片段（契约字段 / tz / mode / kind）");
	{
		check("SOURCES_P6 有 2 条", SOURCES_P6.length === 2, String(SOURCES_P6.length));
		check("id = [ddlezj, kedr]（kedr 吸收原 bwiki 卡池信息为备选源）",
			JSON.stringify(listIdsP6()) === JSON.stringify(["ddlezj", "kedr"]), listIdsP6().join(","));
		// ⚠️ B2 已占用 id `kedrgame`（registry.js 对重复 id 直接抛错）→ 本批必须用别的 id
		check("id 不叫 kedrgame（避免与 B2 的雪松卡池来源撞 id）", !listIdsP6().includes("kedrgame"), listIdsP6().join(","));
		for (const s of SOURCES_P6) {
			check(`P6 ${s.id} 声明 tz`, typeof s.tz === "string" && s.tz.length > 0, String(s.tz));
			check(`P6 ${s.id} 至少一侧`, !!(s.gacha || s.event));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`P6 ${s.id}.${side} 四要素齐备（url/fetcher/kind/mode）`,
					/^https?:\/\//.test(s[side].url) && typeof s[side].fetcher === "function"
					&& ["official-api", "official-html", "wiki", "third-party"].includes(s[side].kind)
					&& s[side].mode === "proxy",
					JSON.stringify({ url: s[side].url, kind: s[side].kind, mode: s[side].mode }));
			}
		}
		// 实测：api.biligame.com 与 bwiki 全系 ACAO 为空 → **都必须 proxy**，不许声明 direct
		check("P6 全部 mode=proxy（两条来源都不在实测 ACAO 放行的三源内）",
			SOURCES_P6.every((s) => ["gacha", "event"].every((k) => !s[k] || s[k].mode === "proxy")));
		// 嘟嘟脸：官方 API 公告；雪松：社区 wiki（官方源未找到）
		check("ddlezj.kind=official-api（B站代理官方公告 API）",
			findSourceP6("ddlezj").gacha.kind === "official-api" && findSourceP6("ddlezj").event.kind === "official-api");
		check("kedr-wiki.kind=wiki（社区结构化页，**非官方源**）", findSourceP6("kedr").gacha.kind === "wiki");
		check("ddlezj 两侧同源同 URL（一份公告里既有卡池也有活动档期）",
			findSourceP6("ddlezj").gacha.url === findSourceP6("ddlezj").event.url);
		check("kedr-wiki 只有卡池侧（该页只有动员卡池档期）",
			!!findSourceP6("kedr").gacha && !findSourceP6("kedr").event);
		// tz：ddlezj = "+540"（UTC+9 固定偏移，源站正文自标 (UTC+9)）；kedr = Asia/Shanghai（推测）
		check("tz 取值：ddlezj=+540（源站自标 UTC+9）/ kedr-wiki=Asia/Shanghai（推测）",
			findSourceP6("ddlezj").tz === "+540" && findSourceP6("kedr").tz === "Asia/Shanghai",
			JSON.stringify([findSourceP6("ddlezj").tz, findSourceP6("kedr").tz]));
		// all.mjs 的 TZ_OK 守卫：字符串要么是 IANA 名、要么是纯数字偏移
		const TZ_OK = (t) => t === "UTC" || /^[A-Za-z]+\/[A-Za-z_]+$/.test(t) || /^[+-]?\d+$/.test(t);
		check("tz 通过 all.mjs 的 TZ_OK 守卫（\"+540\" 是合法固定偏移）",
			SOURCES_P6.every((s) => TZ_OK(s.tz)), SOURCES_P6.map((s) => s.tz).join(","));
		// 雪松页名必须 percent-encode 后再拼 URL（否则夹具整串键命中不到）
		check("kedr URL 用 encodeURIComponent 页名（含 【】— 等字符已编码）",
			KEDR_ARCHIVE_URL === kedrParseUrl(KEDR_ARCHIVE_PAGE)
			&& /page=%E5%BE%80%E6%9C%9F/.test(KEDR_ARCHIVE_URL) && !/page=往期/.test(KEDR_ARCHIVE_URL),
			KEDR_ARCHIVE_URL);
		check("ddlezj 列表 URL 带 gameExtensionId=1282（双重独立印证）",
			DDLEZJ_LIST_URL.includes(`gameExtensionId=${DDLEZJ_GAME_EXTENSION_ID}`) && DDLEZJ_GAME_EXTENSION_ID === 1282);
		// test/map.json（多人共写；本批只追加）必须收录自己的 URL
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		const WANT = {
			[DDLEZJ_LIST_URL]: "p6-ddlezj-list/response.txt",
			"https://api.biligame.com/news/17825": "p6-ddlezj-detail/response.txt",
			[KEDR_ARCHIVE_URL]: "p6-kedr-archive/response.txt"
		};
		for (const url of Object.keys(WANT)) check(`map.json 收录 ${url.slice(0, 72)}…`, map[url] === WANT[url], JSON.stringify(map[url]));
	}
	//#endregion

	//#region P6-1 嘟嘟脸 列表
	section("P6-1 嘟嘟脸恶作剧 —— 公告列表形态（夹具快照：13 条）");
	const listRaw = fixtureJson("p6-ddlezj-list/response.txt");
	let list = null;
	{
		check("列表顶层 = { request_id, data, totalNum, pageNo, code, ts }",
			JSON.stringify(Object.keys(listRaw)) === JSON.stringify(["request_id", "data", "totalNum", "pageNo", "code", "ts"]),
			JSON.stringify(Object.keys(listRaw)));
		check("code=0 且 totalNum=13（任务书实测值）", listRaw.code === 0 && listRaw.totalNum === 13, JSON.stringify([listRaw.code, listRaw.totalNum]));
		check("data 有 13 条（与 totalNum 一致）", Array.isArray(listRaw.data) && listRaw.data.length === 13, String(listRaw.data.length));
		check("条目字段 = content(截断) / ctime / mtime / id / title / typeId / createTime / modifyTime / displayTime?",
			JSON.stringify(Object.keys(listRaw.data[0])) === JSON.stringify(["content", "ctime", "mtime", "id", "title", "typeId", "createTime", "modifyTime", "displayTime"]),
			JSON.stringify(Object.keys(listRaw.data[0])));
		// ⚠️ 与 bandori 同款 API 的差异：本游戏 5/13 条**没有 displayTime** → 排序键必须退到 ctime
		const noDisplay = listRaw.data.filter((x) => x.displayTime == null).map((x) => x.id);
		check("5/13 条没有 displayTime（17631/17429/17244/16948/16947）→ 排序键退 ctime",
			noDisplay.length === 5 && [17631, 17429, 17244, 16948, 16947].every((id) => noDisplay.includes(id)),
			JSON.stringify(noDisplay));
		check("列表 content 是**截断**的（末尾 `...`）→ 正文必须抓详情",
			String(listRaw.data[2].content).trim().endsWith("..."), JSON.stringify(String(listRaw.data[2].content).slice(-12)));
		check("样例条目：17825 = 「2026/04/23 活动公告」",
			listRaw.data[2].id === 17825 && listRaw.data[2].title === "2026/04/23 活动公告", JSON.stringify(listRaw.data[2].title));
		check("样例条目：17631 = 「关于 扭蛋－薛定谔的兔子 的概率」（全角连字符）",
			listRaw.data.some((x) => x.id === 17631 && x.title === "关于 扭蛋－薛定谔的兔子 的概率"));
		check("样例条目：16947 = 「《嘟嘟脸恶作剧》游戏内概率公示」",
			listRaw.data.some((x) => x.id === 16947 && x.title === "《嘟嘟脸恶作剧》游戏内概率公示"));

		list = parseDdlezjList(listRaw);
		check("parseDdlezjList → 13 条", list.length === 13, String(list.length));
		check("排序严格倒序（sortKey 单调不增）", list.every((x, i) => i === 0 || list[i - 1].sortKey >= x.sortKey));
		check("排序后首条 = 18057「嘟嘟脸恶作剧二创规则指引」（2026-06-22）",
			list[0].id === 18057 && list[0].title === "嘟嘟脸恶作剧二创规则指引", JSON.stringify([list[0].id, list[0].sortKey]));
		check("无 displayTime 的条目用 ctime 当 sortKey（17631 → 2026-03-24 11:32:42）",
			list.find((x) => x.id === 17631).sortKey === "2026-03-24 11:32:42", list.find((x) => x.id === 17631).sortKey);
		// 列表时间戳是 CMS 发布时刻（B站，UTC+8 口径，**推测**）；窗口换算与此无关（窗口用正文里的显式时刻）
		check("dateTs 用 CMS tz（Asia/Shanghai）解释 → 18057 = 2026-06-22 14:30",
			wall(parseDdlezjList(listRaw)[0].dateTs, DDLEZJ_CMS_TZ) === "2026-06-22 14:30",
			wall(list[0].dateTs, DDLEZJ_CMS_TZ));
		// 乱序输入 → 自行排序（防回归：不能信数组顺序；bandori 那边就有置顶公告打乱顺序）
		const shuffled = { code: 0, data: [
			{ id: 3, title: "旧", ctime: "2026-01-01 00:00:00" },
			{ id: 1, title: "新", displayTime: "2026-06-01 12:00:00", ctime: "2026-05-31 00:00:00" },
			{ id: 2, title: "中", ctime: "2026-03-01 00:00:00" }
		] };
		check("乱序输入 → 按 displayTime||ctime 严格倒序（1,2,3）",
			JSON.stringify(parseDdlezjList(shuffled).map((x) => x.id)) === JSON.stringify([1, 2, 3]),
			JSON.stringify(parseDdlezjList(shuffled).map((x) => x.id)));
		check("结构损坏（对象/空 data/code≠0）→ 抛错",
			throws(() => parseDdlezjList({})) && throws(() => parseDdlezjList({ code: 0 })) && throws(() => parseDdlezjList({ code: 1, data: [] })));
	}
	//#endregion

	//#region P6-2 嘟嘟脸 详情正文档期抽取
	section("P6-2 嘟嘟脸恶作剧 —— 详情正文档期抽取（含 (UTC+9) 标注）");
	const det = fixtureJson("p6-ddlezj-detail/response.txt");
	const content = String(det.data.content);
	let parsed = null;
	{
		// 详情 JSON 里 gameExtensionId / site 是"扩展 id"的第二重独立印证
		check("详情 data.gameExtensionId=1282 且 data.site=嘟嘟脸恶作剧（第二重独立印证）",
			det.data.gameExtensionId === 1282 && det.data.site === "嘟嘟脸恶作剧",
			JSON.stringify([det.data.gameExtensionId, det.data.site]));
		check("详情带完整 HTML 正文（5,121 字 = 169 个 <p> / 41 个 <br>）",
			content.length === 5121 && (content.match(/<p>/g) || []).length === 169 && (content.match(/<br\s*\/?>/gi) || []).length === 41,
			JSON.stringify([content.length, (content.match(/<p>/g) || []).length]));
		check("正文明文标注 `(UTC+9)` 共 4 处（**源站原文，不是我们换算的**）",
			(content.match(/\(UTC\+9\)/g) || []).length === 4, String((content.match(/\(UTC\+9\)/g) || []).length));
		check("ddlezjParagraphs 按 </p> 切段 → 128 段（textOf 的\"行\"会把多段粘一起，不能用）",
			ddlezjParagraphs(content).length === 128, String(ddlezjParagraphs(content).length));

		parsed = parseDdlezjAnnouncement(content, DDLEZJ_TZ);
		check("抽出 11 条档期（卡池 2 / 活动 9）",
			parsed.items.length === 11 && parsed.items.filter((x) => x.kind === "gacha").length === 2
			&& parsed.items.filter((x) => x.kind === "event").length === 9,
			JSON.stringify([parsed.items.length, parsed.items.filter((x) => x.kind === "gacha").length]));
		check("15 条「维护后」档期抽不到起点钟点 → 如实记入 skippedNoTime（不产出）",
			parsed.skippedNoTime.length === 15 && parsed.skippedNoTime.every((x) => /维护后/.test(x.raw)),
			String(parsed.skippedNoTime.length));
		check("产出的档期里**没有**任何一条带「维护后」（绝不硬凑）",
			parsed.items.every((x) => !/维护后/.test(x.raw)));
		check("带 (UTC+9) 后缀的档期正好 4 条（与正文 4 处标注一致）",
			parsed.items.filter((x) => x.suffix === "UTC+9").length === 4,
			JSON.stringify(parsed.items.filter((x) => x.suffix === "UTC+9").map((x) => x.name)));
		check("suffix 只在源站写了时才填（不带后缀的档期 suffix=\"\"，raw 里也没有 UTC）",
			parsed.items.filter((x) => !x.suffix).length === 7
			&& parsed.items.filter((x) => !x.suffix).every((x) => !/UTC/.test(x.raw)));

		// —— (UTC+9) 的绝对时刻：必须按 UTC+9 解释 ——
		const xd = parsed.items.find((x) => /希尔德/.test(x.name));
		check("(UTC+9) 档期「③精选使徒招募【万年住院医生】希尔德」按 UTC+9 换算",
			!!xd && xd.name === "精选使徒招募【万年住院医生】希尔德" && xd.suffix === "UTC+9"
			&& xd.startTs === sourceInstant(2026, 4, 30, 3, 0, DDLEZJ_TZ) && xd.endTs === sourceInstant(2026, 5, 7, 9, 59, DDLEZJ_TZ),
			JSON.stringify(xd && [xd.name, xd.startTs, xd.endTs]));
		check("绝对毫秒硬值：希尔德 起点 = 1777485600000（= 2026-04-29T18:00Z）",
			!!xd && xd.startTs === 1777485600000 && new Date(xd.startTs).toISOString() === "2026-04-29T18:00:00.000Z",
			JSON.stringify(xd && new Date(xd.startTs).toISOString()));
		// 反证：若误按 UTC+8 解释，同一墙钟会得到别的绝对时刻（差 1 小时）
		check("反证：同一墙钟若误用 UTC+8 会得到别的时刻（证明确实用了 +540）",
			!!xd && sourceInstant(2026, 4, 30, 3, 0, "Asia/Shanghai") !== xd.startTs
			&& sourceInstant(2026, 4, 30, 3, 0, "Asia/Shanghai") - xd.startTs === 3600000,
			String(xd && sourceInstant(2026, 4, 30, 3, 0, "Asia/Shanghai") - xd.startTs));
		check("raw 保留源站原文（含后缀）：`2026/04/30 03:00 ~ 2026/05/07 09:59 (UTC+9)`",
			!!xd && xd.raw === "2026/04/30 03:00 ~ 2026/05/07 09:59 (UTC+9)", JSON.stringify(xd && xd.raw));
		check("bannerDates 文本按源站墙钟渲染 = 04-30 03:00 ~ 05-07 09:59",
			!!xd && fmtWindow(xd.startTs, xd.endTs, DDLEZJ_TZ) === "04-30 03:00 ~ 05-07 09:59", xd && fmtWindow(xd.startTs, xd.endTs, DDLEZJ_TZ));

		// 不带后缀的档期同样按 UTC+9 解释（旁证：同节 BOSS登场时间 收尾 05-07 10:59 与带后缀的一致）
		const xb = parsed.items.find((x) => x.name === "七、艾利亚斯边境" && x.label === "活动时间");
		const boss = parsed.items.find((x) => x.label === "BOSS登场时间");
		check("不带后缀的档期也按 UTC+9 解释（与同节带后缀的 BOSS 档期收尾同刻）",
			!!xb && !!boss && xb.endTs === sourceInstant(2026, 5, 7, 10, 59, DDLEZJ_TZ)
			&& boss.endTs === xb.endTs && boss.suffix === "UTC+9",
			JSON.stringify([xb && xb.raw, boss && boss.raw]));
		check("七、艾利亚斯边境 活动时间 = 04-30 10:00 ~ 05-07 10:59（无后缀）",
			!!xb && fmtWindow(xb.startTs, xb.endTs, DDLEZJ_TZ) === "04-30 10:00 ~ 05-07 10:59", xb && fmtWindow(xb.startTs, xb.endTs, DDLEZJ_TZ));

		// ③梦境之地：带 (UTC+9)、起点 10:00，与 ③像素异世界（同窗口、无后缀）同刻
		const dream = parsed.items.find((x) => x.name === "梦境之地");
		const pixel = parsed.items.find((x) => x.name === "像素异世界");
		check("梦境之地（带后缀）与像素异世界（无后缀）同窗口同刻 → 整份公告统一 UTC+9",
			!!dream && !!pixel && dream.startTs === pixel.startTs && dream.endTs === pixel.endTs
			&& dream.suffix === "UTC+9" && pixel.suffix === "",
			JSON.stringify([dream && dream.startTs, pixel && pixel.startTs]));

		// 标签与分类
		check("标签解析：活动时间 / 商店兑换时间 / BOSS登场时间 / 投票收件 / 奖励领取时间 都抽到",
			["活动时间", "商店兑换时间", "BOSS登场时间", "投票收件", "奖励领取时间"].every((l) => parsed.items.some((x) => x.label === l)),
			JSON.stringify([...new Set(parsed.items.map((x) => x.label))]));
		check("kind 分类：名字含 招募/扭蛋 的进卡池侧（希尔德 / 艾达之灯）",
			parsed.items.filter((x) => x.kind === "gacha").every((x) => /招募|扭蛋/.test(x.name)),
			JSON.stringify(parsed.items.filter((x) => x.kind === "gacha").map((x) => x.name)));

		// 反例：正文里的裸月日 `04/30 03:00`（意念体开放）不算档期（要求 4 位年份）
		check("裸月日（`04/30 03:00`）不产出档期（正则要求 4 位年份）",
			parsed.items.every((x) => /^20\d{2}[\/\-.]/.test(x.raw)));
		check("`开放时间：2026/04/30 03:00 ~ 主线剧情新增至…` 这种「半截区间」不产出",
			parsed.items.every((x) => !/主线剧情/.test(x.raw)));
		check("parseDdlezjStamp：只有日期没有钟点 → null；钟点越界 → null",
			parseDdlezjStamp("2026/04/23 维护后") === null && parseDdlezjStamp("2026/04/23") === null && parseDdlezjStamp("2026/04/23 25:00") === null
			&& !!parseDdlezjStamp("2026/04/23 10:00"));

		// 选当期（纯函数，注入 now）
		const g1 = pickDdlezjGacha(parsed.items, NOW_IN_PERIOD);
		const e1 = pickDdlezjEvent(parsed.items, NOW_IN_PERIOD);
		check("now=04-30 12:00(UTC+9)：卡池取结束最早的覆盖档 = 希尔德",
			!!g1 && g1.name === "精选使徒招募【万年住院医生】希尔德", JSON.stringify(g1 && g1.name));
		check("now=04-30 12:00(UTC+9)：活动取「活动时间」档里结束最早的 = 梦境之地（并列按文档顺序）",
			!!e1 && e1.name === "梦境之地", JSON.stringify(e1 && e1.name));
		check("now=05-07 10:00：卡池全部已收 → null；活动仍覆盖（艾利亚斯边境），且优先「活动时间」档",
			pickDdlezjGacha(parsed.items, NOW_AFTER_GACHA) === null
			&& (pickDdlezjEvent(parsed.items, NOW_AFTER_GACHA) || {}).name === "七、艾利亚斯边境",
			JSON.stringify([pickDdlezjGacha(parsed.items, NOW_AFTER_GACHA), (pickDdlezjEvent(parsed.items, NOW_AFTER_GACHA) || {}).name]));
		check("now=04-20（全部未开）→ 两侧都 null", pickDdlezjGacha(parsed.items, NOW_BEFORE_ALL) === null && pickDdlezjEvent(parsed.items, NOW_BEFORE_ALL) === null);
		check("now=夹具抓取时刻（2026-10-02，全部过期）→ 两侧都 null",
			pickDdlezjGacha(parsed.items, SNAP_DET) === null && pickDdlezjEvent(parsed.items, SNAP_DET) === null);
		check("parseDdlezjWindows 便捷入口与 parseDdlezjAnnouncement 同结果",
			parseDdlezjWindows(content, DDLEZJ_TZ).length === parsed.items.length);
	}
	//#endregion

	//#region P6-3 嘟嘟脸 抓取器（夹具 + 注入 now）
	section("P6-3 嘟嘟脸恶作剧 —— 抓取器（离线夹具；now 是**第 4 个参数**）");
	{
		const src = findSourceP6("ddlezj");
		// ✅ 抗历史 bug：now 传第 4 位；若实现把 now 当第 3 位（tz），这里会得到 null / 异常
		const rg = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW_IN_PERIOD));
		check("gacha 抓取成功（now 传第 4 参）", rg.ok, rg.err);
		assertContract("嘟嘟脸恶作剧", "gacha", rg.ok ? rg.data : null);
		check("gacha banner = 精选使徒招募【万年住院医生】希尔德",
			rg.ok && rg.data && rg.data.banner === "精选使徒招募【万年住院医生】希尔德", JSON.stringify(rg.ok && rg.data && rg.data.banner));
		check("gacha 窗口 = 04-30 03:00 ~ 05-07 09:59（UTC+9 渲染）",
			rg.ok && rg.data && rg.data.bannerDates === "04-30 03:00 ~ 05-07 09:59", JSON.stringify(rg.ok && rg.data && rg.data.bannerDates));
		check("bannerDatesRaw 保留源站原文（含 (UTC+9) 后缀）",
			rg.ok && rg.data && rg.data.bannerDatesRaw === "2026/04/30 03:00 ~ 2026/05/07 09:59 (UTC+9)",
			JSON.stringify(rg.ok && rg.data && rg.data.bannerDatesRaw));
		check("gacha hover 多行：说明源站自标 UTC+9 + 列出同期卡池 + 说明「维护后」档期为何不产出",
			rg.ok && rg.data && rg.data.bannerHover.split("\n").length >= 3
			&& /UTC\+9/.test(rg.data.bannerHover) && /维护后/.test(rg.data.bannerHover),
			JSON.stringify(((rg.ok && rg.data && rg.data.bannerHover) || "").slice(0, 160)));

		const re = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_IN_PERIOD));
		check("event 抓取成功（now 传第 4 参）", re.ok, re.err);
		assertContract("嘟嘟脸恶作剧", "event", re.ok ? re.data : null);
		check("event = 梦境之地 / 04-30 10:00 ~ 05-07 09:59",
			re.ok && re.data && re.data.event === "梦境之地" && re.data.eventDates === "04-30 10:00 ~ 05-07 09:59",
			JSON.stringify(re.ok && re.data && [re.data.event, re.data.eventDates]));
		check("eventHover 逐行列覆盖当前的档期（含非「活动时间」标签的档期并标注标签）",
			re.ok && re.data && re.data.eventHover.split("\n").length >= 4 && /商店兑换时间/.test(re.data.eventHover),
			JSON.stringify(((re.ok && re.data && re.data.eventHover) || "").split("\n").length));

		// 任务硬要求：拿不到覆盖 now 的档期 → **如实返回 null**（不硬凑过期档期）
		const rNullG = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, SNAP_DET));
		const rNullE = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, SNAP_DET));
		check("夹具抓取时刻（2026-10-02）全部档期已过期 → 两侧都返回 null（未公布）",
			rNullG.ok && rNullG.data === null && rNullE.ok && rNullE.data === null,
			JSON.stringify([rNullG.ok ? rNullG.data : rNullG.err, rNullE.ok ? rNullE.data : rNullE.err]));
		// 契约守卫：null 是合法的"未公布"（assertContract 直接通过）
		check("null 通过契约守卫（= 未公布，合法）",
			assertContract("嘟嘟脸恶作剧(过期)", "gacha", rNullG.data) === true && assertContract("嘟嘟脸恶作剧(过期)", "event", rNullE.data) === true);

		// 结构性损坏/网络失败 → 抛错（不能把"源站挂了"静默降级成"未公布"）
		check("列表请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => gachaDdlezj("https://example.invalid/news/list", undefined, DDLEZJ_TZ, NOW_IN_PERIOD)));
		check("导出的抓取器可直接调用（不依赖 registry 包装）",
			(await grab(() => gachaDdlezj(DDLEZJ_LIST_URL, undefined, DDLEZJ_TZ, NOW_IN_PERIOD))).ok
			&& (await grab(() => eventsDdlezj(DDLEZJ_LIST_URL, undefined, DDLEZJ_TZ, NOW_IN_PERIOD))).ok);
	}
	//#endregion

	//#region P6-4 雪松 bwiki
	section("P6-4 雪松 —— bwiki 社区结构化页（实测 **0 张 <table>**，结构是 h1 小节 + 开始/结束两行）");
	const kedrRaw = fixtureJson("p6-kedr-archive/response.txt");
	const kedrHtml = String(kedrRaw.parse.text);
	let kedr = null;
	{
		check("响应是标准 MediaWiki `{ parse:{ title, pageid, text } }`",
			!!kedrRaw.parse && kedrRaw.parse.title === KEDR_ARCHIVE_PAGE && JSON.stringify(Object.keys(kedrRaw.parse)) === JSON.stringify(["title", "pageid", "text"]),
			JSON.stringify([kedrRaw.parse && kedrRaw.parse.title, kedrRaw.parse && kedrRaw.parse.pageid]));
		check("html 16,516 B；**<table> = 0**（所以不存在\"表格档期抽取\"，按 h1 小节解析）",
			kedrHtml.length === 16516 && (kedrHtml.match(/<table/gi) || []).length === 0,
			JSON.stringify([kedrHtml.length, (kedrHtml.match(/<table/gi) || []).length]));
		check("页名 percent-encode 后才请求（含【】—）→ 夹具 meta.url 与本模块构造的 URL 完全一致",
			meta("p6-kedr-archive/response.txt").url === KEDR_ARCHIVE_URL, meta("p6-kedr-archive/response.txt").url);
		check("档期戳形态是 `YYYY-MM-DD-HH:MM`（日期与时刻之间多一个连字符）",
			/开始时间：2026-06-22-12:00/.test(kedrHtml) && /结束时间：2026-06-29-05:00/.test(kedrHtml));

		const secs = kedrSections(kedrHtml);
		check("h1 小节 = 4 个（1.0.0-1 ~ 1.0.0-4；页首目录标题已排除）",
			secs.length === 4 && JSON.stringify(secs.map((s) => s.title)) === JSON.stringify(["1.0.0-1", "1.0.0-2", "1.0.0-3", "1.0.0-4"]),
			JSON.stringify(secs.map((s) => s.title)));
		check("小节标题去掉 `[编辑]` 尾巴", secs.every((s) => !/编辑/.test(s.title)));

		kedr = parseKedrArchive(kedrHtml, KEDR_TZ);
		check("parseKedrArchive → 4 条档期 / 0 条跳过", kedr.items.length === 4 && kedr.skipped === 0,
			JSON.stringify([kedr.items.length, kedr.skipped]));
		const k1 = kedr.items[0];
		check("1.0.0-1 = 2026-06-22-12:00 ~ 2026-06-29-05:00（起止分别来自源站两行）",
			k1.section === "1.0.0-1" && k1.raw === "2026-06-22-12:00 ~ 2026-06-29-05:00", JSON.stringify(k1.raw));
		check("1.0.0-1 卡池 = [精英集结·指挥, 演习·联合领]；UP 角色 = [安吉拉, 西尔维亚]",
			JSON.stringify(k1.pools) === JSON.stringify(["精英集结·指挥", "演习·联合领"])
			&& JSON.stringify(k1.roles) === JSON.stringify(["安吉拉", "西尔维亚"]),
			JSON.stringify([k1.pools, k1.roles]));
		check("k1 起点按 UTC+8 换算 = 1782100800000（= 2026-06-22T04:00Z）",
			k1.startTs === sourceInstant(2026, 6, 22, 12, 0, KEDR_TZ) && new Date(k1.startTs).toISOString() === "2026-06-22T04:00:00.000Z",
			JSON.stringify([k1.startTs, new Date(k1.startTs).toISOString()]));
		check("4 期窗口首尾相接（endTs(i) === startTs(i+1)，无缝隙）",
			kedr.items.slice(1).every((x, i) => x.startTs === kedr.items[i].endTs));
		// 时区旁证：4 期结束时间都落在 UTC+8 的 05:00（国服典型日切点）；首期起点 12:00（开池）
		check("时区旁证：4 期结束墙钟（UTC+8）全是 05:00、首期起点 12:00（故记 Asia/Shanghai 为\"推测\"）",
			kedr.items.every((x) => { const w = sourceWallParts(x.endTs, KEDR_TZ); return w.h === 5 && w.mi === 0; })
			&& (() => { const w = sourceWallParts(kedr.items[0].startTs, KEDR_TZ); return w.h === 12 && w.mi === 0; })(),
			JSON.stringify(kedr.items.map((x) => wall(x.startTs, KEDR_TZ) + " ~ " + wall(x.endTs, KEDR_TZ))));
		check("末条 1.0.0-4 = 07-13 05:00 ~ 07-20 05:00 / 卡池 [精英集结·侦察, 演习·扎拉布山区]",
			kedr.items[3].section === "1.0.0-4" && fmtWindow(kedr.items[3].startTs, kedr.items[3].endTs, KEDR_TZ) === "07-13 05:00 ~ 07-20 05:00"
			&& JSON.stringify(kedr.items[3].pools) === JSON.stringify(["精英集结·侦察", "演习·扎拉布山区"]),
			JSON.stringify([kedr.items[3].pools, fmtWindow(kedr.items[3].startTs, kedr.items[3].endTs, KEDR_TZ)]));
		check("kedrStamp/kedrPools/kedrRoles 单测：1.0.0-4 的角色含 娜塔莎 / 纳努莉",
			kedrRoles(secs[3].html).join("、") === "娜塔莎、纳努莉" && !!kedrStamp(secs[3].html, "开始时间") && kedrPools(secs[3].html).length === 2,
			JSON.stringify(kedrRoles(secs[3].html)));
		check("结构损坏（无小节）→ 抛错", throws(() => parseKedrArchive("<p>no headings</p>")) && throws(() => parseKedrArchive("")));
		check("缺档期的小节只计入 skipped，不影响其它小节（合成的最小页面）",
			(() => {
				const html = '<h1><span class="mw-headline" id="A">A</span></h1><p>无档期</p>'
					+ '<h1><span class="mw-headline" id="B">B</span></h1><p><b>开始时间：2026-01-01-00:00<br /></b><b>结束时间：2026-01-02-00:00<br /></b></p>';
				const r = parseKedrArchive(html, KEDR_TZ);
				return r.items.length === 1 && r.skipped === 1 && r.items[0].section === "B";
			})());

		// 抓取器（now 第 4 参）
		const src = findSourceP6("kedr");
		const rk = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, KEDR_NOW));
		check("kedr 抓取成功（now 传第 4 参）", rk.ok, rk.err);
		assertContract("雪松（bwiki）", "gacha", rk.ok ? rk.data : null);
		check("kedr banner = 1.0.0-1（精英集结·指挥 / 演习·联合领）",
			rk.ok && rk.data && rk.data.banner === "1.0.0-1（精英集结·指挥 / 演习·联合领）", JSON.stringify(rk.ok && rk.data && rk.data.banner));
		check("kedr roles = 安吉拉、西尔维亚",
			rk.ok && rk.data && rk.data.roles === "安吉拉、西尔维亚", JSON.stringify(rk.ok && rk.data && rk.data.roles));
		check("kedr 窗口 = 06-22 12:00 ~ 06-29 05:00 / raw 保留 `2026-06-22-12:00 ~ 2026-06-29-05:00`",
			rk.ok && rk.data && rk.data.bannerDates === "06-22 12:00 ~ 06-29 05:00"
			&& rk.data.bannerDatesRaw === "2026-06-22-12:00 ~ 2026-06-29-05:00",
			JSON.stringify(rk.ok && rk.data && [rk.data.bannerDates, rk.data.bannerDatesRaw]));
		check("kedr hover 如实标注「社区页 / 非官方源 / tz 为推测」",
			rk.ok && rk.data && /社区页/.test(rk.data.bannerHover) && /非官方源/.test(rk.data.bannerHover) && /推测/.test(rk.data.bannerHover),
			JSON.stringify(((rk.ok && rk.data && rk.data.bannerHover) || "").split("\n")[0]));
		const rk2 = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, KEDR_NOW2));
		check("now=07-01 → 换到下一期 1.0.0-2（06-29 05:00 ~ 07-06 05:00）",
			rk2.ok && rk2.data && rk2.data.banner === "1.0.0-2（精英集结·特射 / 演习·协约组织）" && rk2.data.bannerDates === "06-29 05:00 ~ 07-06 05:00",
			JSON.stringify(rk2.ok && rk2.data && [rk2.data.banner, rk2.data.bannerDates]));
		// 任务硬要求：无覆盖 → null（该页是「往期动员」归档页，抓取时刻 2026-10-02 早已全部结束）
		const rkNull = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, SNAP_KEDR));
		check("夹具抓取时刻（2026-10-02）归档页档期全过期 → null（未公布，不硬凑）",
			rkNull.ok && rkNull.data === null, JSON.stringify(rkNull.ok ? rkNull.data : rkNull.err));
		check("null 通过契约守卫", assertContract("雪松（过期）", "gacha", rkNull.data) === true);
	}
	//#endregion

	//#region P6-5 辅助页证据 + 夹具卫生
	section("P6-5 辅助页证据（如实记录：该页不存在 → 不作依赖）");
	{
		// 任务书提到辅助页 `游戏内部公告(2026.6/7)`（实测 358B）。抓回来一看是 MediaWiki `missingtitle`
		// → 该标题**不存在**，所以本批**不依赖**它（只把 往期动员 页作为来源）。
		const notice = fixtureJson("p6-kedr-notice/response.txt");
		check("辅助页 `游戏内部公告(2026.6/7)` 实测 missingtitle（页面不存在，故不作依赖）",
			!!notice.error && notice.error.code === "missingtitle", JSON.stringify(notice.error && notice.error.code));
	}
	//#endregion

	// run.mjs / all.mjs 会调用 summary()；直接 `node test/cases-p6.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-p6.mjs")) summary();
}

// 直接执行时自动跑（被 test/all.mjs import 时不自动跑）
if (process.argv[1] && process.argv[1].endsWith("cases-p6.mjs")) await run();
