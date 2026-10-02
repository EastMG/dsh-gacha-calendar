// next-sources/test/cases-b2.mjs —— 批次 B2（7 个 bwiki 来源）离线夹具测试
//
// 全部离线：`useFixtures()` 把 fetch 换成"按 test/map.json 查夹具"的实现（解析器无需改动）。
// 时间断言全部用**固定 now**（夹具抓取时刻 2026-10-02 01:41 +08）→ 测试永久可复现，
// 不会因为"今天超过了夹具档期"而假失败。真实 now 的路径另用一遍契约守卫覆盖（null 亦合法）。

import { useFixtures, check, section, assertContract } from "./harness.mjs";
import { setFetchImpl } from "../lib/env.js";
import { SOURCES_B2, findSourceB2 } from "../registry-b2.js";
import {
	parsePoints, windowsFromCell, detectOrientation,
	parseWhmxGacha, parseWhmxEvents, parseUmaCnGacha, parseUmaJpEvents,
	parseZspmsGacha, parseKedrGacha, parseCznGacha, parseStellasoraEvents,
	gachaKedr, eventsUmaJp, eventsStellasora
} from "../parsers/bwiki.js";

const TZ_CN = "Asia/Shanghai";
const TZ_JP = "Asia/Tokyo";
// 夹具抓取时刻：2026-10-02 01:41 +08
const NOW = Date.UTC(2026, 9, 1, 17, 41);
const SH = (ts) => new Date(ts).toISOString();

// 夹具模式（默认，run.mjs 不带参数）：用 harness 注入的夹具 fetch。
// ⚠️ 这里**不能**用全局 fetch 读夹具（那会打真实网络）；`--live` 时才改打真实网络
//    （与 run.mjs 一致，仅用于抽检夹具是否过期，不作为门禁）。
// ⚠️ `--live` 时**不能在模块顶层装夹具**，否则会污染 run.mjs 里其它批次的在线抽检。
const LIVE = process.argv.includes("--live");
const fixtureFetch = LIVE ? null : useFixtures();
const liveOrFixture = (u, o) => (LIVE ? fetch(u, o) : fixtureFetch(u, o));
async function fixtureText(url) {
	const body = await (await liveOrFixture(url)).text();
	return JSON.parse(body).parse.text;
}
async function safeCall(label, fn) {
	try { return await fn(); }
	catch (e) { check(`${label} 抓取不应抛错（夹具齐备 / 表结构未变）`, false, e && e.message); return undefined; }
}
const maxStart = (arr) => (arr.length ? arr.slice().sort((a, b) => b.startTs - a.startTs)[0] : null);

export default async function run() {
	// 夹具 fetch 已在模块顶层装好（离线）；这里再包一层确保 run.mjs 的其它批次也走同一实现
	setFetchImpl(liveOrFixture);

	//#region ① 注册表结构
	section("① 批次 B2 注册表结构（7 个 bwiki 来源）");
	{
		check("SOURCES_B2 共 4 条（uma-jp-bwiki / kedrgame / stellasora-bwiki 已吸收为备选源）", SOURCES_B2.length === 4, String(SOURCES_B2.length));
		const ids = SOURCES_B2.map((s) => s.id);
		check("id 无重复", new Set(ids).size === ids.length, ids.join(","));
		for (const s of SOURCES_B2) {
			check(`${s.id} 声明 tz`, s.tz === TZ_CN || s.tz === TZ_JP, String(s.tz));
			check(`${s.id} 至少一侧`, !!(s.gacha || s.event), JSON.stringify({ g: !!s.gacha, e: !!s.event }));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`${s.id}.${side} 是 api.php?action=parse&…&prop=text 形态`,
					/^https:\/\/wiki\.biligame\.com\/[a-z]+\/api\.php\?action=parse&page=.+&prop=text&format=json&formatversion=2$/.test(s[side].url),
					s[side].url);
				check(`${s.id}.${side} mode=proxy（bwiki 全系无 ACAO，必须走代理）`, s[side].mode === "proxy", String(s[side].mode));
				check(`${s.id}.${side} kind=wiki（社区维护，非官方源）`, s[side].kind === "wiki", String(s[side].kind));
				check(`${s.id}.${side} fetcher 是函数`, typeof s[side].fetcher === "function");
			}
		}
		check("闪耀优俊少女国服（uma-cn）只注册卡池侧", !!findSourceB2("uma-cn").gacha && !findSourceB2("uma-cn").event);
		// ⚠️ uma-jp-bwiki / kedrgame / stellasora-bwiki 三条已**吸收为备选源**（不再独立成条目）：
		//    uma-jp-bwiki     → registry-p5.js 的 uma-jp.eventAltSources（tz=Asia/Tokyo 硬标注随条目）
		//    kedrgame         → registry-p6.js 的 kedr.altSources
		//    stellasora-bwiki → registry-p7.js 的 stellasora.eventAltSources
		//    备选源的登记与 URL 命中由 all.mjs 的「备选源登记」守卫 + registry-extras.js 统一校验。
		check("B2 里不再有已吸收的 3 条（一游戏一条目）",
			!SOURCES_B2.some((s) => ["uma-jp-bwiki", "kedrgame", "stellasora-bwiki"].includes(s.id)),
			SOURCES_B2.map((s) => s.id).join(","));
	}
	//#endregion

	//#region ② 日期解析工具
	section("② 日期解析工具（跨年 / 12 小时制 / 只有日期 / 错行 / 整表朝向）");
	{
		const p = parsePoints("2026年09月30日 10:00 ~ 10月22日 09:59");
		check("省年份的终点继承起点年份", p.length === 2 && p[1].y === 2026 && p[1].mo === 10 && p[1].d === 22, JSON.stringify(p));
		check("两端时刻都解析到（10:00 / 09:59）", p[0].h === 10 && p[0].mi === 0 && p[1].h === 9 && p[1].mi === 59, JSON.stringify(p));
		const cross = parsePoints("2025年12月26日 11:00 ~ 01月08日 10:59");
		check("跨年：12 月 → 次年 1 月，终点年份 +1", cross.length === 2 && cross[1].y === 2026, JSON.stringify(cross));

		const amp = windowsFromCell("2024/03/21 10:00 AM 至 2024/04/04 09:59 AM", TZ_CN, "startFirst");
		check("12 小时制 AM 解析正确（10:00 / 09:59，UTC+8 → 02:00Z / 01:59Z）",
			amp.length === 1 && amp[0].startTs === Date.UTC(2024, 2, 21, 2, 0) && amp[0].endTs === Date.UTC(2024, 3, 4, 1, 59),
			JSON.stringify(amp.map((x) => SH(x.startTs))));

		const dateOnly = windowsFromCell("2024/12/7-2024/12/13", TZ_CN, "startFirst");
		check("只有日期无时刻：起点 00:00、终点 23:59（源站未给时刻）",
			dateOnly.length === 1 && dateOnly[0].startTs === Date.UTC(2024, 11, 6, 16, 0) && dateOnly[0].endTs === Date.UTC(2024, 11, 13, 15, 59),
			JSON.stringify(dateOnly.map((x) => `${SH(x.startTs)} ~ ${SH(x.endTs)}`)));

		check("源站只有 1 个日期点（如「2024/09/12 16:00 ~ 未定」）→ 不造窗口",
			windowsFromCell("2024/09/12 16:00 ~ 未定", TZ_CN, "startFirst").length === 0);
		check("源站错行（终点早于起点）→ 整行丢弃",
			windowsFromCell("2025/04/10 11:00~ 2024/04/18 10:59", TZ_JP, "startFirst").length === 0);

		check("整表朝向：uma 简中「已实装」表判为 endFirst（结束在前）",
			detectOrientation(["2026/10/23 11:59 ~ 2026/09/23 12:00", "2026/10/02 11:59 ~ 2026/09/21 12:00", "2026/09/28 11:59 ~ 2026/09/19 12:00"], TZ_CN) === "endFirst");
		check("整表朝向：uma 简中「预测」/ 其它表判为 startFirst",
			detectOrientation(["2026/09/01 12:00 ~ 2026/09/19 11:59", "2025/12/26 11:00~ 2026/01/08 10:59"], TZ_CN) === "startFirst");
	}
	//#endregion

	//#region ③ 物华弥新（whmx）
	section("③ 物华弥新 国服（whmx）");
	{
		const src = findSourceB2("wuhuamixin");
		const gHtml = await fixtureText(src.gacha.url);
		const eHtml = await fixtureText(src.event.url);

		const wg = parseWhmxGacha(gHtml, TZ_CN);
		check("卡池页「限时招集档案」解析出 113 行", wg.length === 113, String(wg.length));
		const top = maxStart(wg);
		check("最新一条起点 = 2026-09-30 10:00 (UTC+8) → 02:00Z", top.startTs === Date.UTC(2026, 8, 30, 2, 0), SH(top.startTs));
		check("最新一条终点 = 2026-10-22 09:59 (UTC+8) → 01:59Z", top.endTs === Date.UTC(2026, 9, 22, 1, 59), SH(top.endTs));
		check("池名取自 <img alt>（该表正文 text 是空的）", top.banner === "孤岛螺旋", top.banner);
		check("UP 器者取自 <a title>", top.roles === "凯尔特之书", top.roles);
		check("招集类型取自 tr[data-param1]", top.cat === "新实装器者·赛季通行证", top.cat);
		check("只有图片文件链接的行退化为清洗后的文件名", wg.some((x) => x.roles === "结伴同游·请调书"), JSON.stringify(wg.map((x) => x.roles).slice(0, 6)));

		const g = await safeCall("wuhuamixin.gacha", () => src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW));
		assertContract("物华弥新", "gacha", g);
		check("当期外显 = 覆盖 now 的窗口（09-30 10:00 ~ 10-22 09:59）", g && g.bannerDates === "09-30 10:00 ~ 10-22 09:59", g && g.bannerDates);
		check("当期 roles 合并同期 5 个池的 UP", g && g.roles === "凯尔特之书、错金博山炉、天球仪、小宋香炉、结伴同游·请调书", g && g.roles);
		check("bannerDatesRaw 保留源站原文（年+月+日写法）", g && g.bannerDatesRaw === "2026年09月30日 10:00 ~ 10月22日 09:59", g && g.bannerDatesRaw);
		check("bannerHover 列出同期各池（≥2 池）", g && typeof g.bannerHover === "string" && g.bannerHover.split("\n").length > 2, g && g.bannerHover);

		const we = parseWhmxEvents(eHtml, TZ_CN);
		check("活动页解析出 62 行（64 行 = 表头 1 + 数据 63，其中「未定」终点 1 行无法成窗）", we.length === 62, String(we.length));
		check("「未定」终点的行（和合·船）被跳过，不硬造终点", !we.some((x) => x.event === "和合·船"), JSON.stringify(we.map((x) => x.event).slice(0, 3)));
		const weTop = maxStart(we);
		check("⚠️ 活动页最新一条 = 2025-05-01 10:00 (UTC+8)：内容停在 2025-05", weTop.startTs === Date.UTC(2025, 4, 1, 2, 0), `${SH(weTop.startTs)} ${weTop.event}`);
		check("活动条目带名称与类型（表头 活动时间|图|名称|类型|备注）", weTop.event === "旅程将启·如邀飞光" && weTop.cat === "签到活动", `${weTop.event} / ${weTop.cat}`);

		const e = await safeCall("wuhuamixin.event", () => src.event.fetcher(src.event.url, undefined, src.tz, NOW));
		assertContract("物华弥新", "event", e);
		check("⚠️ 活动页最新一条早于 now（2025-05）→ 当期无覆盖 → 如实返回 null", e === null, JSON.stringify(e));
	}
	//#endregion

	//#region ④ 闪耀优俊少女 国服（uma-cn，简中卡池）
	section("④ 闪耀优俊少女 国服（uma-cn）—— ⚠️ 时间含 wiki 推算成分，不是官方时刻表");
	{
		const src = findSourceB2("uma-cn");
		const html = await fixtureText(src.gacha.url);
		const { live, predicted } = parseUmaCnGacha(html, TZ_CN);
		check("「已实装卡池」解析出 191 行", live.length === 191, String(live.length));
		check("「预测卡池」解析出 240 行", predicted.length === 240, String(predicted.length));
		check("rowspan=2 的「支援卡卡池」行继承同窗口日期，且不算主池",
			live[2].cat === "支援卡卡池" && live[2].startTs === live[1].startTs && live[2].isMain === false,
			JSON.stringify({ cat: live[2].cat, same: live[2].startTs === live[1].startTs, main: live[2].isMain }));
		check("已实装表时间列是「结束 ~ 开始」→ 整表判为 endFirst 并已对调",
			live[0].orient === "endFirst" && live[0].startTs === Date.UTC(2026, 8, 23, 4, 0) && live[0].endTs === Date.UTC(2026, 9, 23, 3, 59),
			`${live[0].orient} ${SH(live[0].startTs)} ~ ${SH(live[0].endTs)}`);
		check("预测表是「开始 ~ 结束」→ 同一解析器按整表多数票判朝向后也对",
			predicted[0].orient === "startFirst"
			&& predicted[0].startTs === Date.UTC(2026, 8, 1, 4, 0) && predicted[0].endTs === Date.UTC(2026, 8, 19, 3, 59),
			`${predicted[0].orient} ${SH(predicted[0].startTs)} ~ ${SH(predicted[0].endTs)}`);
		check("raw 保留源站原文（不做任何加工，含「结束在前」的原始顺序）",
			live[0].raw === "2026/10/23 11:59 ~ 2026/09/23 12:00", live[0].raw);
		check("两表每一条 endTs > startTs（窗口自洽）", live.every((x) => x.endTs > x.startTs) && predicted.every((x) => x.endTs > x.startTs));
		check("角色名去掉 wiki 链接前缀「简/」", live[0].roles.startsWith("【奇迹的胜利之星】小栗帽"), live[0].roles.slice(0, 24));
		check("⚠️ 预测表远期条目机械外推到 2029（源站原文 2029/09/26）→ 更不可当官方时刻表",
			predicted.some((x) => x.raw.includes("2029/09/26")), JSON.stringify(predicted.filter((x) => x.startTs > Date.UTC(2029, 0, 1)).slice(0, 1).map((x) => x.raw)));

		const g = await safeCall("uma-cn.gacha", () => src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW));
		assertContract("闪耀优俊少女", "gacha", g);
		check("当期外显 = 覆盖 now 且结束最早的池（3★空中神宫…，10-02 11:59 结束）",
			g && g.banner === "3★空中神宫、克里斯象征 优俊少女招募", g && g.banner);
		check("当期窗口 = 09-21 12:00 ~ 10-02 11:59", g && g.bannerDates === "09-21 12:00 ~ 10-02 11:59", g && g.bannerDates);
		check("当期 roles 合并同期覆盖的多个主池", g && g.roles.includes("空中神宫") && g.roles.includes("小栗帽"), g && g.roles.slice(0, 60));
		check("⚠️ 预测卡池结果只在 bannerHover 里、且显式标注「非官方时刻表」",
			g && /非官方时刻表/.test(g.bannerHover) && /预测卡池/.test(g.bannerHover), g && g.bannerHover);
		check("⚠️ 来源类型是社区 wiki（kind=wiki），注释写明不是官方源", src.gacha.kind === "wiki");
	}
	//#endregion

	//#region ⑤ 赛马娘 日服（bwiki 活动页；已吸收为 uma-jp 的活动备选源）
	section("⑤ 赛马娘 日服 bwiki 活动页 —— tz=Asia/Tokyo 硬标注");
	{
		// ⚠️ 该页已作为 `uma-jp`（registry-p5.js）的 eventAltSources 备选源，不再是 B2 独立条目。
		//    这里直接用解析器 + 原始 URL 测，等价于原来的经 registry 测试。
		const UMA_EVENT_URL = "https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2";
		const html = await fixtureText(UMA_EVENT_URL);
		const { items, permanent } = parseUmaJpEvents(html, TZ_JP);
		check("活动页解析出 97 行（100 行 = 表头 1 + 常驻 1 + 错行 1 + 数据 97）", items.length === 97, String(items.length));
		check("常驻行（`常驻~ 常驻`）单独计数 = 1，不进当期排序", permanent === 1, String(permanent));
		const top = maxStart(items);
		check("时区应用正确：11:00 JST = 02:00Z（若按 UTC+8 会差 1 小时）", top.startTs === Date.UTC(2025, 11, 26, 2, 0), SH(top.startTs));
		check("⚠️ 该表标题是「往期活动」，最新一条 = 2025-12-26 ~ 2026-01-08",
			top.event === "剧情活动「青涩行旅路，初春已近前」" && top.raw === "2025/12/26 11:00~ 2026/01/08 10:59", `${top.event} | ${top.raw}`);
		check("源站错行（2025/04/10 11:00~ 2024/04/18 10:59）被丢弃，无 endTs<=startTs 的行",
			items.every((x) => x.endTs > x.startTs) && !items.some((x) => x.raw.includes("2024/04/18")));

		const e = await safeCall("uma-jp-bwiki.event", () => eventsUmaJp(UMA_EVENT_URL, undefined, TZ_JP, NOW));
		assertContract("赛马娘日服(bwiki)", "event", e);
		check("⚠️ 归档最新一条止于 2026-01-08 → 当期无覆盖 → 如实返回 null", e === null, JSON.stringify(e));
	}
	//#endregion

	//#region ⑥ 战双帕弥什 国服（zspms 研发记录）
	section("⑥ 战双帕弥什 国服（zspms）—— 研发记录");
	{
		const src = findSourceB2("zspms");
		const html = await fixtureText(src.gacha.url);
		const zs = parseZspmsGacha(html, TZ_CN);
		check("107 张小表 = 107 期研发池", zs.length === 107, String(zs.length));
		const top = maxStart(zs);
		check("最新一期 = 2024/03/21 10:00 (UTC+8)：该页停在 2024Q1", top.startTs === Date.UTC(2024, 2, 21, 2, 0), SH(top.startTs));
		check("池名取自小节标题（h2）", /限时概率UP$/.test(top.banner), top.banner);
		check("UP 角色取自「效果」行的 <a title>", /露西亚·深红囚影/.test(top.roles), top.roles);
		check("日期带 12 小时制 + 「至」分隔也能解析", top.raw.includes("10:00 AM") && top.endTs === Date.UTC(2024, 3, 4, 1, 59), `${top.raw} → ${SH(top.endTs)}`);

		const g = await safeCall("zspms.gacha", () => src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW));
		assertContract("战双帕弥什", "gacha", g);
		check("⚠️ 最新一期止于 2024-04-04 → 当期无覆盖 → 如实返回 null", g === null, JSON.stringify(g));
	}
	//#endregion

	//#region ⑦ 雪松 / 卡厄斯梦境 / 星塔旅人（三个"解析不出当期内容"的来源）
	section("⑦ 雪松 bwiki 卡池信息 / 卡厄斯梦境 / 星塔旅人 bwiki —— 如实报告");
	{
		// ⚠️ 这三条里 `kedrgame` 与 `stellasora-bwiki` 已**吸收为备选源**
		//    （kedr.altSources / stellasora.eventAltSources），不再是 B2 的独立条目。
		//    这里直接用解析器 + 原始 URL 测，等价于原来经 registry 的测试。
		const KEDR_KAXI_URL = "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2";
		const STELLA_BWIKI_URL = "https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2";
		const kd = parseKedrGacha(await fixtureText(KEDR_KAXI_URL), TZ_CN);
		check("雪松「卡池信息」无表格，只解析出 1 条台架测试窗口（第二段是「？-？」）", kd.length === 1, String(kd.length));
		check("雪松窗口 = 2024/12/07 00:00 ~ 2024/12/13 23:59 (UTC+8)（源站只有日期无时刻）",
			kd[0].startTs === Date.UTC(2024, 11, 6, 16, 0) && kd[0].endTs === Date.UTC(2024, 11, 13, 15, 59),
			`${SH(kd[0].startTs)} ~ ${SH(kd[0].endTs)}`);
		check("雪松池名取自小节标题「台架测试[一]」", kd[0].banner === "台架测试[一]", kd[0].banner);
		const kg = await safeCall("kedr-kaxi.gacha", () => gachaKedr(KEDR_KAXI_URL, undefined, TZ_CN, NOW));
		assertContract("雪松", "gacha", kg);
		check("⚠️ 雪松：台架测试占位页 + 窗口停在 2024-12 → 如实返回 null（可能已停更）", kg === null, JSON.stringify(kg));

		const czn = findSourceB2("czn");
		const cz = parseCznGacha(await fixtureText(czn.gacha.url), TZ_CN);
		check("卡厄斯梦境「卡池记录」是空页（正文只有「模板:Gacha」链接）→ 0 条", cz.length === 0, String(cz.length));
		const cg = await safeCall("czn.gacha", () => czn.gacha.fetcher(czn.gacha.url, undefined, czn.tz, NOW));
		assertContract("卡厄斯梦境", "gacha", cg);
		check("⚠️ 卡厄斯梦境：页面无任何表格/日期 → 如实返回 null", cg === null, JSON.stringify(cg));

		const st = parseStellasoraEvents(await fixtureText(STELLA_BWIKI_URL), TZ_CN);
		check("星塔旅人首页「活动日历」解析出 2 项", st.length === 2, String(st.length));
		check("星塔没有活动名字段，只能取立绘文件名（Banner bossrush 5.png → bossrush 5）",
			st[0].event === "bossrush 5" && st[0].imgRaw === "Banner bossrush 5.png", JSON.stringify(st[0]));
		check("data-end-time（无时区 ISO）按国服墙钟解释：2026-04-07 10:59 +08 → 02:59Z",
			st[1].endTs === Date.UTC(2026, 3, 7, 2, 59), SH(st[1].endTs));
		const se = await safeCall("stellasora-bwiki.event", () => eventsStellasora(STELLA_BWIKI_URL, undefined, TZ_CN, NOW));
		assertContract("星塔旅人", "event", se);
		check("⚠️ 星塔旅人：两项都止于 2026-04 → 当期无覆盖 → 如实返回 null", se === null, JSON.stringify(se));
	}
	//#endregion

	//#region ⑧ 抓取器总览（真实 now + 代理形态）
	section("⑧ 7 个来源所有侧：真实 now 下不抛错、契约成立、确实走宿主代理");
	{
		const seen = [];
		setFetchImpl(async (u, o) => { seen.push(String(u)); return liveOrFixture(u, o); });
		for (const s of SOURCES_B2) {
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				const d = await safeCall(`${s.id}.${side}`, () => s[side].fetcher(s[side].url, undefined, s.tz));
				assertContract(`${s.id}.${side}`, side, d);
			}
		}
		check("bwiki 抓取全部经 /api/gacha-calendar-proxy（mode=proxy）",
			seen.length > 0 && seen.every((u) => u.startsWith("/api/gacha-calendar-proxy")), JSON.stringify(seen.slice(0, 2)));
		setFetchImpl(liveOrFixture);
	}
	//#endregion
}
