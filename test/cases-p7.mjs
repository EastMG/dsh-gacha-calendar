// next-sources/test/cases-p7.mjs —— 批次 P7 离线夹具测试（星塔旅人 国服）
//
// 三个原则（照合并前的 CONVENTIONS.md）：
//   ① 全程离线：用 `useFixtures()` 注入夹具 fetch；纯函数测试直接读 fixtures/*.txt
//   ② 确定性：所有"当期"断言都用**夹具抓取时刻**（meta.capturedAt）当 now，不随运行日期漂移
//   ③ 不拖垮共享 runner：抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断别的批次
import { readFileSync } from "node:fs";
import { useFixtures, setFetchImpl, check, section, assertContract } from "./harness.mjs";
const { sourceWallParts, hoverPool, hoverEvent } = T;
import { SOURCES_P7 } from "./registry-shim.mjs";
import { T } from "./load.mjs";
const { parseStellaList, parseStellaWindow, parseStellaWindows, stellaWindowsFromDetail, stellaIsGacha, stellaIsEvent, stellaGachaName, stellaFeatured, stellaFeaturedName, stellaRolesOf, stellaPageUrl, stellaPickOrderOf, STELLA_SCAN_SIZE, STELLA_SCAN_PAGES, gachaStellasora, eventsStellasora, STELLA_TZ } = T.parsers["stellasora"];

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt`, import.meta.url), "utf8"));
const meta = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt.meta.json`, import.meta.url), "utf8"));
const raw = (name) => readFileSync(new URL(`./fixtures/${name}/response.txt`, import.meta.url), "utf8");

// 夹具快照时刻（= 抓取那一刻）作为"当前时刻"，保证确定性
const SNAP = Date.parse(meta("p7-stella-notice").capturedAt);
const SNAP_PARTS = sourceWallParts(SNAP, STELLA_TZ);

// 抓取器会依次请求：列表 + 若干详情。全部登记到夹具映射里。
// ⚠️ 2026-11-09：列表请求的 `size` 由解析器统一改写为**扫描深度 50**（见 30-game-yostar.js 的
//    STELLA_SCAN_SIZE 与 stellaPageUrl），所以这里的键必须是 size=50 那一版；
//    `map.json` 里同一条也指向这份 10-02 夹具（解析器只关心返回了多少行，问 50 拿 20 是合法的）。
const URLS = {
	"https://stellasora.yostar.cn/api/resource/news-type": "p7-stella-types/response.txt",
	"https://stellasora.yostar.cn/api/resource/news?index=1&size=50&type=notice": "p7-stella-notice/response.txt",
	"https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=activity": "p7-stella-activity/response.txt",
	"https://stellasora.yostar.cn/api/resource/news/4761": "p7-stella-detail-4761/response.txt",
	"https://stellasora.yostar.cn/api/resource/news/4760": "p7-stella-detail-4760/response.txt",
	"https://stellasora.yostar.cn/api/resource/news/4762": "p7-stella-detail-4762/response.txt",
	"https://stellasora.yostar.cn/api/resource/news/4746": "p7-stella-detail-4746/response.txt",
	"https://stellasora.yostar.cn/api/resource/news/4732": "p7-stella-detail-4732/response.txt"
};

export default async function runP7() {
	// ─────────────────────────────────────────────────────────
	section("P7 ① 星塔旅人 —— 类型目录与列表解析");
	{
		const types = fixture("p7-stella-types");
		check("类型目录 code=0", types.code === 0, String(types.code));
		const labels = types.data.map((x) => x.value);
		check("类型目录含 latest/notice/news/activity",
			["latest", "notice", "news", "activity"].every((v) => labels.includes(v)), labels.join(","));

		const list = parseStellaList(fixture("p7-stella-notice"));
		check("notice 列表解析出条目", list.length > 0, String(list.length));
		check("条目带 id/title/publishTs", list.every((x) => x.id != null && x.title && typeof x.publishTs === "number"));
		check("按 publishTs 倒序", list.every((x, i) => i === 0 || list[i - 1].publishTs >= x.publishTs));
		check("首条 = 「创业激励基金」说明（夹具快照值）", list[0].title === "「创业激励基金」说明", list[0].title);

		const act = parseStellaList(fixture("p7-stella-activity"));
		check("activity 列表 typeLabel=活动", act.every((x) => x.typeLabel === "活动"));
		check("activity 是线下/周边类（不含招募）", act.every((x) => !stellaIsGacha(x.title)));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ② 档期令牌子（纯函数，含各种写法）");
	{
		// 完整年月日
		const w1 = parseStellaWindow("2026/10/01 04:00 ~ 2026/10/31 03:59", STELLA_TZ);
		check("完整区间可解", !!w1);
		if (w1) {
			const a = sourceWallParts(w1.startTs, STELLA_TZ), b = sourceWallParts(w1.endTs, STELLA_TZ);
			check("起点 = 2026-10-01 04:00（源站墙钟）", a.y === 2026 && a.mo === 10 && a.d === 1 && a.h === 4 && a.mi === 0, JSON.stringify(a));
			check("终点 = 2026-10-31 03:59", b.y === 2026 && b.mo === 10 && b.d === 31 && b.h === 3 && b.mi === 59, JSON.stringify(b));
			check("endTs > startTs", w1.endTs > w1.startTs);
			check("raw 保留原文", w1.raw === "2026/10/01 04:00 ~ 2026/10/31 03:59", w1.raw);
			check("显式起点不算推断", w1.startInferred === false);
		}
		// 全角/波浪线分隔符
		for (const sep of ["～", "〜", "~", "–"]) {
			const w = parseStellaWindow(`2026/09/01 04:00 ${sep} 2026/10/01 03:59`, STELLA_TZ);
			check(`分隔符「${sep}」可解`, !!w && w.endTs > w.startTs);
		}
		// 缺时刻 → 起点 00:00 / 终点 23:59
		const w2 = parseStellaWindow("2026/10/01 ~ 2026/10/31", STELLA_TZ);
		check("缺时刻可解", !!w2);
		if (w2) {
			const a = sourceWallParts(w2.startTs, STELLA_TZ), b = sourceWallParts(w2.endTs, STELLA_TZ);
			check("起点补 00:00", a.h === 0 && a.mi === 0);
			check("终点补 23:59", b.h === 23 && b.mi === 59);
		}
		// 「维护结束后」起点 → 用锚点，且标 startInferred
		const anchor = Date.parse("2026-09-29T09:00:00.079Z");
		const w3 = parseStellaWindow("2026/09/29 维护结束后 ~ 2026/10/20 10:59", STELLA_TZ, anchor);
		check("「维护结束后」可解", !!w3);
		if (w3) {
			check("起点标 startInferred", w3.startInferred === true);
			check("起点 = 锚点（公告发布时刻）", w3.startTs === anchor, `${w3.startTs} vs ${anchor}`);
			const b = sourceWallParts(w3.endTs, STELLA_TZ);
			check("终点 = 2026-10-20 10:59", b.mo === 10 && b.d === 20 && b.h === 10 && b.mi === 59, JSON.stringify(b));
		}
		// 无分隔符 / 无日期 → null（不硬造）
		check("无分隔符 → null", parseStellaWindow("2026/10/01 04:00", STELLA_TZ) === null);
		check("无日期 → null", parseStellaWindow("维护结束后 ~ 另行通知", STELLA_TZ, anchor) === null);
		check("空串 → null", parseStellaWindow("", STELLA_TZ) === null);
		check("终点早于起点 → null", parseStellaWindow("2026/10/31 04:00 ~ 2026/10/01 03:59", STELLA_TZ) === null);
		// 「维护结束后」但没有锚点 → 无法定位起点 → null
		check("维护后 + 无锚点 → null", parseStellaWindow("维护结束后 ~ 2026/10/20 10:59", STELLA_TZ, null) === null);
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ③ 正文 → 带标签档期（真实夹具）");
	{
		// 4762「猎影合围Beta」活动说明：▌开放时间 2026/09/01 04:00 ~ 2026/10/01 03:59
		const w4762 = stellaWindowsFromDetail(fixture("p7-stella-detail-4762"));
		check("4762 解析出 1 条档期", w4762.length === 1, String(w4762.length));
		if (w4762[0]) {
			check("4762 标签 = 开放时间", w4762[0].label === "开放时间", w4762[0].label);
			const a = sourceWallParts(w4762[0].startTs, STELLA_TZ), b = sourceWallParts(w4762[0].endTs, STELLA_TZ);
			check("4762 起点 2026-09-01 04:00", a.mo === 9 && a.d === 1 && a.h === 4, JSON.stringify(a));
			check("4762 终点 2026-10-01 03:59", b.mo === 10 && b.d === 1 && b.h === 3 && b.mi === 59, JSON.stringify(b));
		}
		// 显式日期（无「维护结束后」）不受影响：4762 起点仍是 09-01 04:00 且**不算**推断
		check("4762 起点不是推断（无相对词）", !!(w4762[0] && w4762[0].startInferred === false));

		// 4761 卡池：▌招募时间 2026/09/29 维护结束后 ~ 2026/10/20 10:59
		// ⚠️ 源站**日期与「维护结束后」同时出现**，起点应取「维护结束后」（锚点 = 该公告自己的 publishTime）
		const d4761 = fixture("p7-stella-detail-4761");
		const anchor4761 = d4761.data.news.publishTime;
		const w4761 = stellaWindowsFromDetail(d4761);
		check("4761 解析出 1 条档期", w4761.length === 1, String(w4761.length));
		if (w4761[0]) {
			check("4761 标签 = 招募时间", w4761[0].label === "招募时间", w4761[0].label);
			check("4761 起点是推断（维护结束后）", w4761[0].startInferred === true);
			check("4761 起点 = 该公告 publishTime（锚点）", w4761[0].startTs === anchor4761, `${w4761[0].startTs} vs ${anchor4761}`);
			const a4761 = sourceWallParts(w4761[0].startTs, STELLA_TZ);
			check("4761 起点墙钟 = 09-29 17:00（不是当日 00:00）", a4761.mo === 9 && a4761.d === 29 && a4761.h === 17, JSON.stringify(a4761));
			const b = sourceWallParts(w4761[0].endTs, STELLA_TZ);
			check("4761 终点 2026-10-20 10:59", b.mo === 10 && b.d === 20 && b.h === 10 && b.mi === 59, JSON.stringify(b));
		}
		// 4746「联合讨伐」活动说明
		const w4746 = stellaWindowsFromDetail(fixture("p7-stella-detail-4746"));
		check("4746 解析出 ≥1 条档期", w4746.length >= 1, String(w4746.length));
		// 4732「灾变防线」活动说明
		const w4732 = stellaWindowsFromDetail(fixture("p7-stella-detail-4732"));
		check("4732 解析出 ≥1 条档期", w4732.length >= 1, String(w4732.length));
		// 卡池悬停「池名：角色」的**右半边**（UP 主推）来自正文，不在标题里
		const d4760 = fixture("p7-stella-detail-4760");
		check("4760 正文可提取 UP 主推 = 艾蕾",
			stellaFeaturedName(d4760.data.news.content) === "艾蕾", stellaFeaturedName(d4760.data.news.content));
		check("4761 正文可提取 UP 主推 = 睡前童话",
			stellaFeaturedName(d4761.data.news.content) === "睡前童话", stellaFeaturedName(d4761.data.news.content));
		check("只有 4 星行 → 空串（**不臆造**角色名）",
			stellaFeaturedName("<p>活动期间，4星旅人「师渺」「璟麟」招募概率提升！</p>") === "",
			stellaFeaturedName("<p>活动期间，4星旅人「师渺」「璟麟」招募概率提升！</p>"));
		check("无正文 → 空串（不抛错）", stellaFeaturedName("") === "" && stellaFeaturedName(null) === "");
		// 正文里的 `&ldquo;` 等实体应已解码
		const txt4761 = String(d4761.data.news.content);
		check("原始正文含 HTML 实体（证明解码有必要）", /&ldquo;|&amp;/.test(txt4761), txt4761.slice(0, 60));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ④ 标题分流（卡池 / 活动 / 排除）");
	{
		check("「限时招募开启」→ 卡池", stellaIsGacha("「空白的稚梦」限时招募开启"));
		check("「招募」→ 卡池", stellaIsGacha("某角色招募说明"));
		check("「活动说明」→ 活动", stellaIsEvent("「猎影合围Beta」活动说明"));
		check("「活动一览」→ 活动", stellaIsEvent("「遥远的塔」版本活动一览") === false, "版本活动一览应排除");
		check("招募标题不算活动", stellaIsEvent("「空白的稚梦」限时招募开启") === false);
		check("维护更新说明不算活动", stellaIsEvent("《星塔旅人》09月29日维护更新说明") === false);
		check("版本内容一览不算活动", stellaIsEvent("「遥远的塔」版本内容一览") === false);
		check("概率公示不算活动", stellaIsEvent("某概率公示") === false);
		check("卡池名去掉「限时招募开启」尾巴",
			stellaGachaName("「空白的稚梦」限时招募开启") === "「空白的稚梦」", stellaGachaName("「空白的稚梦」限时招募开启"));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ⑤ 星塔旅人 —— 两侧抓取器（夹具）");
	useFixtures(URLS);
	{
		const src = SOURCES_P7.find((s) => s.id === "stellasora");
		check("注册表声明了 tz", !!src.tz, String(src.tz));
		check("两侧 mode 都是 proxy（实测无 ACAO）", src.gacha.mode === "proxy" && src.event.mode === "proxy");
		check("两侧 kind 都是 official-api", src.gacha.kind === "official-api" && src.event.kind === "official-api");

		// ── 卡池侧 ──
		let g = null, gErr = "";
		try { g = await gachaStellasora(src.gacha.url, undefined, src.tz, SNAP); } catch (e) { gErr = e.message; }
		check("卡池抓取器不抛错", gErr === "", gErr);
		assertContract("stellasora", "gacha", g);
		if (g) {
			check("卡池名非空且不含「招募开启」尾巴", g.banner.length > 0 && !/招募开启$/.test(g.banner), g.banner);
			const a = sourceWallParts(g.startTs, STELLA_TZ), b = sourceWallParts(g.endTs, STELLA_TZ);
			console.log(`      · 快照 ${SNAP_PARTS.y}-${SNAP_PARTS.mo}-${SNAP_PARTS.d} → 卡池「${g.banner}」 ${g.bannerDates}`);
			check("卡池窗口覆盖快照时刻", g.startTs <= SNAP && g.endTs >= SNAP);
			check("卡池窗口 = 09-29 ~ 10-20（快照值）", a.mo === 9 && a.d === 29 && b.mo === 10 && b.d === 20, g.bannerDates);
			check("卡池侧带 bannerDatesRaw 原文", typeof g.bannerDatesRaw === "string" && g.bannerDatesRaw.length > 0, g.bannerDatesRaw);
			check("bannerDatesRaw 含「维护结束后」（源站原文）", /维护结束后/.test(g.bannerDatesRaw), g.bannerDatesRaw);

			// ── 卡池悬停（2026-10-03 修）────────────────────────────
			// 契约：卡池列的悬停字段是 **bannerHover**（面板读 `g.bannerHover || gachaTitle`）。
			// 旧实现误写 `eventHover` → 运行时被 `pickFields(g.data, GACHA_FIELDS)` 丢掉 = 悬停根本没生效。
			check("卡池 hover 在 bannerHover（且不再写 eventHover）",
				typeof g.bannerHover === "string" && g.bannerHover.length > 0 && g.eventHover === undefined,
				JSON.stringify(g.bannerHover));
			const gl = String(g.bannerHover || "").split("\n");
			check("卡池 hover = hoverPool 排版：2 池 → 4 行（池名行 + 档期行）", gl.length === 4, JSON.stringify(gl));
			check("卡池 hover 池名行是「池名：角色」（与本体 label 同构）",
				gl.filter((s, i) => i % 2 === 0).every((s) => /^「[^」]+」：.+$/.test(s)), JSON.stringify(gl));
			// 2026-11-09（悬停档期改口径）：源站原文是「2026/09/29 维护结束后 ~ …」（起点是相对表述）
			// ⇒ 档期行**逐字写原文**，不再被 fmtWindow 改写成具体时刻（那会吃掉「维护结束后」）。
			check("卡池 hover 档期行 = 源站原文（含「维护结束后」，不再格式化）",
				gl.filter((s, i) => i % 2 === 1).every((s) => s === "2026/09/29 维护结束后 ~ 2026/10/20 10:59"), JSON.stringify(gl));
			check("卡池 hover 每池带自己的 UP 主推（艾蕾 / 睡前童话）",
				/「沐于温情笑意中」：艾蕾/.test(g.bannerHover) && /「空白的稚梦」：睡前童话/.test(g.bannerHover),
				JSON.stringify(gl));
			check("卡池 hover 无元信息（来源/URL/时区推定/抓取条数/内部 id/实现说明/游戏名+区服）",
				!/来源|http|tz=|UTC|Asia\/|推定|推断|起点按|共扫描|内部|bwiki|米游社|yostar|biligame|星塔旅人|国服/.test(g.bannerHover)
				&& !/[（）()]/.test(g.bannerHover), JSON.stringify(gl));
			// 单池分支：两个当期池的起点只差 847ms（各自公告的 publishTime），
			// 取两者之间的一刻 → 只有更早的那池覆盖 now ⇒ 必须**不设** bannerHover
			const A4761 = fixture("p7-stella-detail-4761").data.news.publishTime;
			const A4760 = fixture("p7-stella-detail-4760").data.news.publishTime;
			check("前置：两池起点相差 < 1 秒（借此刻构造「单池当期」）",
				A4760 > A4761 && A4760 - A4761 < 1000, `${A4761} vs ${A4760}`);
			let g1 = null;
			try { g1 = await gachaStellasora(src.gacha.url, undefined, src.tz, A4761 + Math.floor((A4760 - A4761) / 2)); } catch (e) { g1 = "ERR:" + e.message; }
			check("单池当期 → **不设** bannerHover（交回 UI 默认两行式「池名：角色」⏎「档期」）",
				!!g1 && g1.bannerHover === undefined, JSON.stringify(g1 && g1.bannerHover));
			check("单池当期外显照常（=「空白的稚梦」）", !!g1 && g1.banner === "「空白的稚梦」", JSON.stringify(g1 && g1.banner));
			// 解析器「<2 就不设字段」的依据本身也守一道（lib/env.js 的契约，压平后见 28-parser-hover-tools.js）
			check("契约：hoverPool/hoverEvent 在不足 2 条时返回空串",
				hoverPool([{ name: "池", startTs: g.startTs, endTs: g.endTs }], STELLA_TZ) === ""
				&& hoverEvent([{ name: "活动", startTs: g.startTs, endTs: g.endTs }], STELLA_TZ) === "");
		}

		// ── 活动侧 ──
		let ev = null, evErr = "";
		try { ev = await eventsStellasora(src.event.url, undefined, src.tz, SNAP); } catch (e) { evErr = e.message; }
		check("活动抓取器不抛错", evErr === "", evErr);
		assertContract("stellasora", "event", ev);
		if (ev) {
			console.log(`      · 活动「${ev.event}」 ${ev.eventDates}`);
			// 2026-11-09（用户要求）：外显/悬停的活动名 = 源站标题**去掉尾部「活动说明」**
			// （源站是 `「联合讨伐」活动说明`）。分流仍按标题判，这里只钉"名字怎么显示"。
			check("活动名已去掉尾部「活动说明」", ev.event === "「联合讨伐」", ev.event);
			check("活动侧不带卡池字段", ev.banner === undefined);

			// ── 活动悬停（2026-10-03 修：名称在前 + 3 空格 + 档期；删掉「（起点按公告发布时刻推断）」）──
			check("活动 hover 在 eventHover 且非空",
				typeof ev.eventHover === "string" && ev.eventHover.length > 0, JSON.stringify(ev.eventHover));
			const el = String(ev.eventHover || "").split("\n");
			check("活动 hover 逐条一行（2 条当期 → 2 行）", el.length === 2, JSON.stringify(el));
			check("活动 hover 行首是**名称**不是档期（旧实现「档期在前」已改掉）",
				el.every((s) => /^「[^」]+」/.test(s) && !/^\d{2}-\d{2}/.test(s)), JSON.stringify(el));
			// 2026-11-09（悬停档期改口径）：第 1 条源站原文是「2026/09/29 维护结束后 ~ …」（相对起点）
			// ⇒ 写原文；第 2 条两端本来就是绝对时刻 ⇒ 仍然格式化 —— 同一份悬停里两种分支并存，
			// 这正是"raw 能完整解析成两端绝对时刻才格式化"的口径。
			check("活动 hover「名称 + 3 空格 + 档期」（相对表述写原文、绝对窗口格式化）",
				el[0] === "「灾变防线」   2026/09/29 维护结束后 ~ 2026/10/20 10:59"
				&& el[1] === "「联合讨伐」   10-01 04:00 ~ 10-30 22:59",
				JSON.stringify(el));
			check("活动 hover 按结束时间升序（灾变防线 10-20 在前、联合讨伐 10-30 在后）",
				/「灾变防线」/.test(el[0] || "") && /「联合讨伐」/.test(el[1] || ""), JSON.stringify(el));
			check("活动 hover 无元信息（**尤其删掉**「（起点按公告发布时刻推断）」）",
				!/来源|http|tz=|UTC|Asia\/|推定|推断|起点按|共扫描|内部|bwiki|米游社|yostar|biligame|星塔旅人|国服/.test(ev.eventHover)
				&& !/[（）()]/.test(ev.eventHover), JSON.stringify(el));
			check("悬停里包含外显的同一个活动名（同一字符串，不是标签）",
				el.some((s) => s.startsWith(`${ev.event}   `)), JSON.stringify(el));
			// 单条分支：2026-10-25 只有「联合讨伐」（10-30 止）覆盖 → 必须**不设** eventHover
			let ev1 = null;
			try { ev1 = await eventsStellasora(src.event.url, undefined, src.tz, Date.parse("2026-10-25T00:00:00Z")); } catch (e) { ev1 = "ERR:" + e.message; }
			check("单条当期活动 → **不设** eventHover（交回 UI 默认两行式「活动名」⏎「档期」）",
				!!ev1 && ev1.eventHover === undefined, JSON.stringify(ev1 && ev1.eventHover));
			check("单条当期活动外显照常（联合讨伐）", !!ev1 && /联合讨伐/.test(ev1.event), JSON.stringify(ev1 && ev1.event));
		}
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ⑥ 无覆盖档期 → null（不硬凑）");
	{
		// 快照时刻之后很久（2027-06）：所有档期都已过期 → 必须返回 null
		const FAR = Date.parse("2027-06-01T00:00:00Z");
		let g = "unset", ev = "unset";
		try { g = await gachaStellasora(SOURCES_P7[0].gacha.url, undefined, STELLA_TZ, FAR); } catch (e) { g = "ERR:" + e.message; }
		try { ev = await eventsStellasora(SOURCES_P7[0].event.url, undefined, STELLA_TZ, FAR); } catch (e) { ev = "ERR:" + e.message; }
		check("远期 now：卡池如实返回 null", g === null, JSON.stringify(g && (g.banner || g)));
		check("远期 now：活动如实返回 null", ev === null, JSON.stringify(ev && (ev.event || ev)));
		// 快照之前很久：档期还没开始 → 也 null
		const EARLY = Date.parse("2026-01-01T00:00:00Z");
		let g2 = "unset";
		try { g2 = await gachaStellasora(SOURCES_P7[0].gacha.url, undefined, STELLA_TZ, EARLY); } catch (e) { g2 = "ERR:" + e.message; }
		check("早期 now：卡池如实返回 null", g2 === null, JSON.stringify(g2 && (g2.banner || g2)));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ⑦ 夹具与源站时区口径（留痕，防后人误改）");
	{
		const noticeMeta = meta("p7-stella-notice");
		check("夹具记录了真实 URL", /stellasora\.yostar\.cn/.test(noticeMeta.url), noticeMeta.url);
		check("夹具 HTTP 200", noticeMeta.status === 200, String(noticeMeta.status));
		// 源站未标时区：确认正文里**没有** UTC/时区标注（据此才敢标"推测"）
		const all = raw("p7-stella-detail-4761") + raw("p7-stella-detail-4762") + raw("p7-stella-detail-4746");
		check("源站正文未标时区（故 tz 为推测）", !/UTC|GMT|北京时间|服务器时间/.test(all));
		// 04:00 日切是国服特征（留作推测依据）
		check("正文含 04:00/03:59 日切（国服特征）", /04:00|03:59/.test(all));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ⑧ 活动名去掉尾部「活动说明」（含反例）");
	{
		// 源站标题体裁是 `「X」活动说明`；用户 2026-11-09 要求外显/悬停只写 `「X」`。
		// 判据必须钉在**词尾**，否则会误伤名字里本来就含"说明"的活动 —— 这一节用**内存夹具**
		// （`setFetchImpl`，不走真网络）覆盖四种标题：
		//   ① `「猎影合围Beta」活动说明`     → `「猎影合围Beta」`（词尾四字，去掉）
		//   ② `「猎影合围Beta」活动说明　`    → 同上（词尾带**全角空格**，也要去掉）
		//   ③ `「说明会」活动开场`            → **原样**（含"说明"，但不以"活动说明"结尾）
		//   ④ `「创业激励基金」说明`          → **原样**（尾是「说明」不是「活动说明」；且不算活动）
		// ⚠️ 2026-11-09：列表地址的 `size` 现在由解析器改写为扫描深度 50（见 stellaPageUrl），
		// 内存夹具的键必须跟着走，否则会命中 404 —— 这正是下面那条反向证明的接线点。
		const LIST_U = "https://stellasora.yostar.cn/api/resource/news?index=1&size=50&type=notice";
		const LIST_U1 = LIST_U + "&case=only-activity-note";      // 只有 ①：验"外显去尾"
		const LIST_U2 = LIST_U + "&case=trailing-ideographic";    // 只有 ②：验"词尾全角空格也去"
		const WIN = "<p>▌活动时间<br>2026/10/01 04:00 ~ 2026/10/30 22:59</p>";
		const T0 = Date.parse("2026-09-28T00:00:00.000Z");
		const rowOf = (id, title) => ({ id, title, publishTime: T0 - (id % 1000), type: "notice", typeLabel: "公告" });
		const detailOf = (id, title) => JSON.stringify({ code: 0, data: { news: { id, title, publishTime: T0 - (id % 1000), content: WIN } } });
		const R1 = rowOf(9101, "「猎影合围Beta」活动说明");
		const R2 = rowOf(9102, "「猎影合围Beta」活动说明\u3000");
		const R3 = rowOf(9103, "「说明会」活动开场");
		const R4 = rowOf(9104, "「创业激励基金」说明");
		const listOf = (...rows) => JSON.stringify({ code: 0, data: { rows } });
		const BODIES = {
			[LIST_U]: listOf(R1, R3, R4),
			[LIST_U1]: listOf(R1),
			[LIST_U2]: listOf(R2),
			"https://stellasora.yostar.cn/api/resource/news/9101": detailOf(9101, R1.title),
			"https://stellasora.yostar.cn/api/resource/news/9102": detailOf(9102, R2.title),
			"https://stellasora.yostar.cn/api/resource/news/9103": detailOf(9103, R3.title),
			"https://stellasora.yostar.cn/api/resource/news/9104": detailOf(9104, R4.title)
		};
		// 该来源 mode=proxy ⇒ 代理包体是 { status, body }；直连形态也一并给出，免得换个 mode 就挂。
		setFetchImpl(async (url) => {
			const u = String(url);
			const isProxy = u.startsWith("/api/gacha-calendar-proxy");
			let target = u;
			if (isProxy) { try { target = new URL("http://x" + u).searchParams.get("url") || u; } catch { /* keep */ } }
			const body = BODIES[target];
			if (body == null) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
			if (isProxy) {
				const p = JSON.stringify({ status: 200, body });
				return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => p, json: async () => JSON.parse(p) };
			}
			return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => body, json: async () => JSON.parse(body) };
		});
		const NOW2 = Date.parse("2026-10-05T00:00:00Z");
		const call = async (u) => { try { return await eventsStellasora(u, undefined, STELLA_TZ, NOW2); } catch (e) { return "ERR:" + e.message; } };
		const e2 = await call(LIST_U);
		check("内存夹具：抓取器不抛错", !!e2 && typeof e2 === "object", JSON.stringify(e2));
		const names = ((e2 && e2.events) || []).map((x) => x.title);
		// ⚠️ 2026-11-09（B 项）：两条活动档期完全相同 ⇒ 并列键从「id 倒序」改成「**文档顺序**」
		// （解析时记住的原始行序：R1「猎影合围Beta」在 R3「说明会」之前）。
		// 改造前这条钉的是 id 倒序（9103 > 9101 ⇒ 说明会 在前）—— 那是 id 的偶然性，不是口径。
		check("词尾「活动说明」被去掉 ⇒ 「猎影合围Beta」；含「说明」的「说明会」活动开场原样保留",
			JSON.stringify(names) === JSON.stringify(["「猎影合围Beta」", "「说明会」活动开场"]), JSON.stringify(names));
		check("尾是「说明」不是「活动说明」⇒ 不算活动（原样留在列表里，不被改坏）",
			!names.some((n) => /创业激励基金/.test(n)), JSON.stringify(names));
		check("外显 / 数组 / 悬停都不再出现「活动说明」",
			!/活动说明/.test([e2 && e2.event, e2 && e2.eventHover].map(String).join("|") + "|" + names.join("|")),
			JSON.stringify([e2 && e2.event, names]));
		check("外显与悬停同一份名字（悬停里逐字出现外显那条；同窗口时是「名称… ⏎ 档期」折叠式）",
			!!e2 && String(e2.eventHover || "").split("\n").some((s) => s === e2.event || s.startsWith(e2.event + "   ")),
			JSON.stringify(e2 && e2.eventHover));
		// 外显侧的两条分支：只有「…活动说明」那一条在期 ⇒ 外显必须已去尾（单条没有悬停）
		const e3 = await call(LIST_U1);
		check("单条当期：外显同样去尾 = 「猎影合围Beta」（没有悬停，交回 UI 两行式）",
			!!e3 && e3.event === "「猎影合围Beta」" && e3.eventHover === undefined, JSON.stringify(e3 && [e3.event, e3.eventHover]));
		const e4 = await call(LIST_U2);
		check("词尾带**全角空格**也照样去干净（不把空格留在名字里）",
			!!e4 && e4.event === "「猎影合围Beta」", JSON.stringify(e4 && e4.event));
	}

	// ─────────────────────────────────────────────────────────
	section("P7 ⑨ A+B：每池写 roles（秘纹池留空）+ 挑池口径（同窗口优先角色池）+ 扫描深度 50 / 翻页");
	{
		// ══════════════════════════════════════════════════════════════════════
		// A 项：解析器写每池 roles
		//   旧实现只抓一个 `featured` 名字（悬停「池名：X」用），**从不写 roles**
		//   ⇒ `50-refresh.js` 的主条只能从 `rec.roles` 反算 ⇒ 恒为空 ⇒ show 永远退回池名，
		//   而并列条标题里却带着角色（用户看到「主条只有池名、并列条才有角色」）。
		//   现在：每池条目都带 roles，且**只收角色**（源站「5星旅人」）；秘纹池（「5星秘纹」）留空。
		// ══════════════════════════════════════════════════════════════════════
		const fRole = stellaFeatured("<p>活动期间，全新5星旅人「艾蕾」招募概率提升！</p>");
		check("A：旅人池 → {艾蕾, 旅人}", fRole.name === "艾蕾" && fRole.category === "旅人", JSON.stringify(fRole));
		check("A：旅人池 → roles =「艾蕾」（角色池写角色名）", stellaRolesOf(fRole) === "艾蕾", JSON.stringify(stellaRolesOf(fRole)));
		const fPat = stellaFeatured("<p>活动期间，全新5星秘纹「睡前童话」招募概率提升！</p>");
		check("A：秘纹池 → {睡前童话, 秘纹}", fPat.name === "睡前童话" && fPat.category === "秘纹", JSON.stringify(fPat));
		check("A：秘纹池 → roles = 空（秘纹不是角色）", stellaRolesOf(fPat) === "", JSON.stringify(stellaRolesOf(fPat)));
		check("A：4 星行 / 无正文 → roles 空（不臆造）",
			stellaRolesOf(stellaFeatured("<p>活动期间，4星旅人「师渺」「璟麟」招募概率提升！</p>")) === ""
			&& stellaRolesOf(stellaFeatured("")) === "");
		check("A：只有「5星「X」」没有类别词 → roles 空（宁缺勿错）",
			stellaRolesOf(stellaFeatured("<p>5星「无名」招募概率提升！</p>")) === "");
		check("A：stellaFeaturedName 仍是同一条正则的那个名字（既有导出行为不变）",
			stellaFeaturedName("<p>全新5星秘纹「睡前童话」招募概率提升！</p>") === "睡前童话");

		// ── B 项的一半：文档顺序 = 解析时记住的原始行序 ──────────────────────
		// 旧实现的兜底键是 `row.id` 倒序（id 大者胜 = 谁后发谁上），那是 id 的偶然性，不是"文档顺序"。
		const orderList = parseStellaList(fixture("p7-stella-notice"));
		const orderOf = (id) => (orderList.find((x) => x.id === id) || {}).order;
		check("B：parseStellaList 给每一行发 order（0..n-1，原始行序）",
			orderList.every((x, i) => typeof x.order === "number" && orderList.filter((y) => y.order === x.order).length === 1)
			&& Math.min(...orderList.map((x) => x.order)) === 0
			&& Math.max(...orderList.map((x) => x.order)) === orderList.length - 1,
			JSON.stringify(orderList.map((x) => x.order).slice(0, 6)));
		check("B：文档顺序 = 响应里的行序（4761 在 4760 之前；两池同窗口、旧实现却按 id 让 4760 赢）",
			orderOf(4761) < orderOf(4760), JSON.stringify([orderOf(4761), orderOf(4760)]));
		check("B：翻页时第 2 页的行序接在第 1 页之后（orderBase 生效，跨页仍是一个全序）",
			parseStellaList(fixture("p7-stella-notice"), 20).every((x) => x.order >= 20 && x.order < 40));

		// ── B 项的排序键：单测比较函数（与":266"是同一份实现）────────────────
		const C = (order, startTs, endTs, roles) => ({ row: { order }, win: { startTs, endTs }, roles });
		check("B：同窗口（起止全等）⇒ 有角色的池在前（哪怕文档序在后）",
			[C(3, 100, 200, ""), C(4, 100, 200, "火垂")].sort(stellaPickOrderOf)[0].roles === "火垂");
		check("B：同窗口且都没角色 ⇒ 文档顺序（order 小的在前，不是 id 倒序）",
			[C(7, 100, 200, ""), C(2, 100, 200, "")].sort(stellaPickOrderOf)[0].row.order === 2);
		check("B：结束最早仍是第一键（结束早的在前，即使起点更晚）",
			[C(0, 300, 400, ""), C(1, 100, 500, "")].sort(stellaPickOrderOf)[0].win.endTs === 400);
		check("B：同结束 ⇒ 起点升序",
			[C(0, 300, 400, ""), C(1, 100, 400, "")].sort(stellaPickOrderOf)[0].win.startTs === 100);
		// ⚠️ 2026-11-09（用户拍板 B，全局规则）：roles 是**第一档**，不再是「窗口全等才插手」的星塔特例。
		check("B：有角色优先**先于**时间键（窗口不同也插手：角色池结束更晚仍排在前面）",
			[C(5, 100, 500, "火垂"), C(6, 200, 300, "")].sort(stellaPickOrderOf)[0].roles === "火垂");
		check("B：没有 win.ts 的行按「无穷远」排最后（null 不参与比较）",
			[C(0, null, null, ""), C(1, 100, 200, "")].sort(stellaPickOrderOf)[0].win.endTs === 200);

		// ── B 项的另一半：扫描深度 50 + 分页 ────────────────────────────────
		check("B：扫描深度常量 = 50 条 / 最多 2 页",
			STELLA_SCAN_SIZE === 50 && STELLA_SCAN_PAGES === 2, `${STELLA_SCAN_SIZE} / ${STELLA_SCAN_PAGES}`);
		const REG_URL = "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice";
		check("B：第 1 页 = size 改写为 50（注册表里那个 size=20 只是地址模板）",
			stellaPageUrl(REG_URL, 1) === "https://stellasora.yostar.cn/api/resource/news?index=1&size=50&type=notice",
			stellaPageUrl(REG_URL, 1));
		check("B：第 2 页 = index=2（接口支持 index/size 分页）",
			stellaPageUrl(REG_URL, 2) === "https://stellasora.yostar.cn/api/resource/news?index=2&size=50&type=notice",
			stellaPageUrl(REG_URL, 2));
		check("B：非星塔主机 ⇒ 第 1 页原样、不翻页（不猜别人的分页参数）",
			stellaPageUrl("https://example.com/news?size=20", 1) === "https://example.com/news?size=20"
			&& stellaPageUrl("https://example.com/news?size=20", 2) === null);

		// ══════════════════════════════════════════════════════════════════════
		// live 2026-11-09 13:30 +08（真联网实抓夹具）：扫描深度 50 之后**有 5 口池在期**
		//   10-20 那批：星途一载 · 予缘重聚（正文没有 5 星行）/ 心意凝于剑尖（5星**秘纹**）/
		//                邂逅源初之剑（**5星旅人「尘沙(源初)」** —— 是角色池，不是秘纹池！）
		//   10-27 那批：乘光而起的星之砂（角色=火垂）/ 若能触及那片繁星（秘纹=星之所向）
		//
		// ⚠️ 2026-11-09（用户拍板 B，**全局规则**）：卡池侧挑池 = 在期 ⇒ **有角色优先** ⇒ 结束最早
		//    ⇒ 起点升序 ⇒ 文档顺序。11-09 在期里带角色的有两口：「邂逅源初之剑」（~11-10 10:59）与
		//    「乘光而起的星之砂」（~11-17 10:59）—— 同档里**先到期**的是邂逅源初之剑 ⇒ 外显是它。
		//    ⚠️ 任务书原本预期 11-09 该露「乘光而起的星之砂」，但 4930 的真夹具正文是
		//    「活动期间，全新限定5星旅人「尘沙(源初)」招募概率提升」—— 它不是秘纹池；按同一把尺
		//    （同档比结束时间）就该它先露。所谓「3 个没有角色的池」实际是 2 个：星途一载（无 5 星行）
		//    + 心意凝于剑尖（5★秘纹）。断言因此按**规则实际结果**钉，而不是按预期钉。
		// ══════════════════════════════════════════════════════════════════════
		const LIVE_LIST = "https://stellasora.yostar.cn/api/resource/news?index=1&size=50&type=notice";
		const LIVE_IDS = [4982, 4981, 4932, 4931, 4930];
		const liveMap = () => {
			const m = { [LIVE_LIST]: "p7-stella-notice-1109/response.txt" };
			for (const id of LIVE_IDS) m[`https://stellasora.yostar.cn/api/resource/news/${id}`] = `p7-stella-detail-${id}/response.txt`;
			return m;
		};
		const T1109 = Date.parse("2026-11-09T05:30:00.000Z");   // 2026-11-09 13:30 +08
		const T1112 = Date.parse("2026-11-12T05:30:00.000Z");   // 10-20 那三口已结束（11-10 10:59）
		const liveList = parseStellaList(fixture("p7-stella-notice-1109"));
		const liveIdx = (id) => liveList.findIndex((x) => x.id === id);
		check("live 夹具：50 条整（实抓 size=50）", liveList.length === 50, String(liveList.length));
		check("live 夹具：两口当期池在 #15/#16（0 基；旧 20 条刚好含住，下一批公告就出界）",
			liveIdx(4981) === 14 && liveIdx(4982) === 15, JSON.stringify([liveIdx(4981), liveIdx(4982)]));

		useFixtures(liveMap());
		let liveG = null, liveErr = "";
		try { liveG = await gachaStellasora(LIVE_LIST, undefined, STELLA_TZ, T1109); } catch (e) { liveErr = e.message; }
		check("live 11-09：卡池抓取器不抛错", liveErr === "", liveErr);
		check("live 11-09：外显 = 在期里有角色、且同档里结束最早的那口「邂逅源初之剑」（~11-10 10:59）",
			!!liveG && liveG.banner === "「邂逅源初之剑」", JSON.stringify(liveG && liveG.banner));
		check("live 11-09：这口是**角色池** ⇒ 载荷 roles 含「尘沙(源初)」、主条 show = 去修饰的角色名「尘沙」",
			!!liveG && String(liveG.roles).split("、").includes("尘沙(源初)") && liveG.gacha[0].show === "尘沙"
				&& liveG.gacha[0].roles.join(",") === "尘沙(源初)" && liveG.gacha[0].title === "「邂逅源初之剑」",
			JSON.stringify(liveG && [liveG.roles, liveG.gacha[0] && liveG.gacha[0].show, liveG.gacha[0] && liveG.gacha[0].roles]));
		const titles1109 = ((liveG && liveG.gacha) || []).map((x) => x.title);
		check("live 11-09：5 口在期池都在数组里（外显那口在最前，其余按档期序）",
			titles1109.length === 5 && titles1109[0] === "「邂逅源初之剑」", JSON.stringify(titles1109));
		const iRole = titles1109.findIndex((t) => t.indexOf("「乘光而起的星之砂」") === 0);
		const iPat = titles1109.findIndex((t) => t.indexOf("「若能触及那片繁星」") === 0);
		check("live 11-09：同窗口的两口池都在数组里（角色池 + 秘纹池）", iRole >= 0 && iPat >= 0, JSON.stringify(titles1109));
		check("live 11-09：同一窗口（10-27 12:00 ~ 11-17 10:59）⇒ 角色池排在秘纹池之前",
			iRole < iPat, JSON.stringify([iRole, iPat]));

		// ── 显示层：外显必须由「有角色优先」选出，且**旧口径会选另一条**（内建反向守卫）──
		const liveRec = Object.assign({ id: "stellasora", name: "星塔旅人", tz: STELLA_TZ }, liveG || {});
		const cell1109 = T.scheduleCellOf(liveRec, "gacha", new Date(T1109));
		check("live 11-09：面板外显 = 「邂逅源初之剑」/ show = 尘沙（有角色池，不再是只有池名的那条）",
			!!cell1109 && !!cell1109.primary && cell1109.primary.title === "「邂逅源初之剑」" && cell1109.primary.show === "尘沙",
			JSON.stringify(cell1109 && cell1109.primary && [cell1109.primary.title, cell1109.primary.show]));
		const noRoleLive = (liveG && liveG.gacha || []).find((x) => x.startTs != null && x.endTs != null
			&& x.startTs <= T1109 && x.endTs >= T1109 && !(Array.isArray(x.roles) && x.roles.length));
		check("live 11-09：在期里最早到期的是**没有角色**的「星途一载 · 予缘重聚」—— 面板却必须露有角色的那口（无角色池不再抢首行）",
			!!noRoleLive && noRoleLive.title === "「星途一载 · 予缘重聚」" && cell1109.primary.title !== noRoleLive.title,
			JSON.stringify(noRoleLive && noRoleLive.title));

		const hover1109 = String((liveG && liveG.bannerHover) || "").split("\n");
		check("live 11-09：悬停 = 5 口池 × 2 行、无元信息；行序是**档期序**（悬停首行 = 那口没有角色的星途一载）",
			hover1109.length === 10 && hover1109[0] === "「星途一载 · 予缘重聚」"
			&& hover1109.filter((ln, i) => i % 2 === 1).every((ln) => / ~ /.test(ln))
			&& hover1109.slice(2).filter((ln, i) => i % 2 === 0).every((ln) => /^「[^」]+」：.+$/.test(ln))
			&& !/来源|http|tz=|UTC|Asia\/|推定|推断|共扫描|内部/.test(String(liveG && liveG.bannerHover)),
			JSON.stringify(hover1109));

		// ── 10-20 那三口结束后（11-12）：外显必须是**角色池**，roles / show / 悬停逐字对 ──
		useFixtures(liveMap());
		let liveG2 = null, liveErr2 = "";
		try { liveG2 = await gachaStellasora(LIVE_LIST, undefined, STELLA_TZ, T1112); } catch (e) { liveErr2 = e.message; }
		check("live 11-12：卡池抓取器不抛错", liveErr2 === "", liveErr2);
		check("live 11-12：外显 = 角色池「乘光而起的星之砂」",
			!!liveG2 && liveG2.banner === "「乘光而起的星之砂」", JSON.stringify(liveG2 && liveG2.banner));
		check("live 11-12：载荷 roles = 火垂（A 项：解析器写，不再靠 rec.roles 反算）",
			!!liveG2 && liveG2.roles === "火垂", JSON.stringify(liveG2 && liveG2.roles));
		check("live 11-12：gacha[0].roles = [火垂] 且 show = 火垂（角色池显示角色名）",
			!!liveG2 && liveG2.gacha[0].roles.join(",") === "火垂" && liveG2.gacha[0].show === "火垂",
			JSON.stringify(liveG2 && [liveG2.gacha[0].roles, liveG2.gacha[0].show]));
		check("live 11-12：gacha[0].title 仍是**池名**（title=池名 / show=角色，分工不变）",
			!!liveG2 && liveG2.gacha[0].title === "「乘光而起的星之砂」", JSON.stringify(liveG2 && liveG2.gacha[0].title));
		check("live 11-12：秘纹池作并列条、roles 为空（秘纹不是角色）",
			!!liveG2 && liveG2.gacha[1] && liveG2.gacha[1].title === "「若能触及那片繁星」：星之所向"
			&& liveG2.gacha[1].roles.length === 0, JSON.stringify(liveG2 && liveG2.gacha[1]));
		check("live 11-12：悬停 = 同名同窗折叠（2 行名字 + 1 行档期），首行就是外显那口池",
			!!liveG2 && liveG2.bannerHover === "「乘光而起的星之砂」：火垂\n「若能触及那片繁星」：星之所向\n10-27 12:00 ~ 11-17 10:59",
			JSON.stringify(liveG2 && liveG2.bannerHover));
		check("live 11-12：窗口 = 10-27 12:00 ~ 11-17 10:59",
			!!liveG2 && liveG2.bannerDates === "10-27 12:00 ~ 11-17 10:59", JSON.stringify(liveG2 && liveG2.bannerDates));

		// ══════════════════════════════════════════════════════════════════════
		// 扫描深度 / 翻页的**反向证明接线点**：下面用"会真分页的虚拟接口"把两口池推到更靠后。
		//   · 压 20 条新公告 ⇒ 两池落到 #35/#36（0 基）——`STELLA_SCAN_SIZE` 退回 20 必红；
		//   · 压 60 条 ⇒ 两池落到第 2 页（#75/#76）——只翻 1 页必红；
		//   · 压 110 条 ⇒ 两池落到第 3 页 —— "最多 2 页"的守卫（必须如实 null，而不是无限翻）。
		// ══════════════════════════════════════════════════════════════════════
		const LIST_PREFIX = "https://stellasora.yostar.cn/api/resource/news?index=";
		const liveRows = fixture("p7-stella-notice-1109").data.rows;
		const padRows = (n) => Array.from({ length: n }, (_, i) => ({
			id: 7000 + i,
			title: `「压测活动${i + 1}」活动说明`,
			publishTime: Date.parse("2026-11-10T04:00:00.000Z") - i * 60000,
			type: "notice",
			typeLabel: "公告"
		}));
		const makeVirtualList = (rows, log) => async (url) => {
			const u = String(url);
			const isProxy = u.startsWith("/api/gacha-calendar-proxy");
			let target = u;
			if (isProxy) { try { target = new URL("http://x" + u).searchParams.get("url") || u; } catch { /* keep */ } }
			log.push(target);
			let body = null;
			if (target.startsWith(LIST_PREFIX)) {
				const q = new URL(target);
				const size = Number(q.searchParams.get("size") || 20);
				const page = Number(q.searchParams.get("index") || 1);
				body = JSON.stringify({ code: 0, data: { count: rows.length, rows: rows.slice((page - 1) * size, page * size) } });
			} else {
				const m = /\/api\/resource\/news\/(\d+)$/.exec(target);
				if (m && LIVE_IDS.indexOf(Number(m[1])) >= 0) body = raw(`p7-stella-detail-${m[1]}`);
			}
			if (body == null) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
			if (isProxy) {
				const p = JSON.stringify({ status: 200, body });
				return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => p, json: async () => JSON.parse(p) };
			}
			return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => body, json: async () => JSON.parse(body) };
		};
		const runVirtual = async (rows) => {
			const log = [];
			setFetchImpl(makeVirtualList(rows, log));
			let got = null;
			try { got = await gachaStellasora(LIVE_LIST, undefined, STELLA_TZ, T1112); } catch (e) { got = "ERR:" + e.message; }
			const listPages = log.filter((u) => u.startsWith(LIST_PREFIX)).length;
			return { got, listPages, log };
		};
		const deep = await runVirtual(padRows(20).concat(liveRows));
		check("扫描深度：两口池被 20 条新公告压到 #35/#36（0 基）后**仍然出得来**（旧 20 条实现 = null）",
			!!deep.got && typeof deep.got === "object" && deep.got.banner === "「乘光而起的星之砂」" && deep.got.roles === "火垂",
			JSON.stringify(deep.got && (deep.got.banner || deep.got)));
		check("扫描深度：这一页已经有「上一期已结束」的档期（10-20 那批）⇒ 只请求 1 页",
			deep.listPages === 1, String(deep.listPages));
		const page2 = await runVirtual(padRows(60).concat(liveRows));
		check("翻页：两口池落在第 2 页（#75/#76）时也能出（第 1 页全是非招募公告）",
			!!page2.got && typeof page2.got === "object" && page2.got.banner === "「乘光而起的星之砂」",
			JSON.stringify(page2.got && (page2.got.banner || page2.got)));
		check("翻页：确实翻了第 2 页（index=1 → index=2，共 2 次列表请求）",
			page2.listPages === 2 && page2.log.some((u) => /[?&]index=2[&]/.test(u)), JSON.stringify(page2.log.filter((u) => u.startsWith(LIST_PREFIX))));
		const page3 = await runVirtual(padRows(110).concat(liveRows));
		check("翻页上限：池子要到第 3 页才出现 ⇒ 最多 2 页、如实 null（不无限翻）",
			page3.got === null && page3.listPages === 2, JSON.stringify(page3.got && page3.got));

		// ══════════════════════════════════════════════════════════════════════
		// C 项（「维护结束后」的起点 = 该公告 publishTime）**本任务不修**，行为必须与改造前一致
		// ══════════════════════════════════════════════════════════════════════
		useFixtures(URLS);
		let snapG = null, snapErr = "";
		try { snapG = await gachaStellasora("https://stellasora.yostar.cn/api/resource/news?index=1&size=50&type=notice", undefined, STELLA_TZ, SNAP); } catch (e) { snapErr = e.message; }
		check("C 项：10-02 夹具下抓取器不抛错", snapErr === "", snapErr);
		// ⚠️ 2026-11-09（用户拍板 B）：「沐于温情笑意中」是角色池（艾蕾），「空白的稚梦」是秘纹池；
		// 两池窗口只差 847ms（C 项的锚点偏差）—— 旧口径按「起点最早」选到秘纹池，新口径**有角色优先**
		// 选角色池。roles 也随之如实写出（`艾蕾`），show = 去修饰的角色名。
		check("C 项：外显 = 角色池「沐于温情笑意中」（有角色优先，秘纹池不再抢占首行）",
			!!snapG && snapG.banner === "「沐于温情笑意中」", JSON.stringify(snapG && snapG.banner));
		check("C 项：「维护结束后」的起点仍**等于该公告 publishTime**（锚点偏早是已知偏差，本任务不修也不掩盖）",
			!!snapG && snapG.startTs === fixture("p7-stella-detail-4760").data.news.publishTime
			&& /维护结束后/.test(snapG.bannerDatesRaw),
			JSON.stringify(snapG && [snapG.startTs, fixture("p7-stella-detail-4760").data.news.publishTime, snapG.bannerDatesRaw]));
		check("C 项：起点墙钟仍是 09-29 17:00（锚点=发布时刻，不是当日 00:00 / 维护时刻）",
			!!snapG && (() => { const a = sourceWallParts(snapG.startTs, STELLA_TZ); return a.mo === 9 && a.d === 29 && a.h === 17 && a.mi === 0; })(),
			JSON.stringify(snapG && sourceWallParts(snapG.startTs, STELLA_TZ)));
		check("C 项：角色池 ⇒ roles = 艾蕾、show = 艾蕾（不再退回池名）",
			!!snapG && snapG.roles === "艾蕾" && snapG.gacha[0].show === "艾蕾",
			JSON.stringify(snapG && [snapG.roles, snapG.gacha[0] && snapG.gacha[0].show]));
		check("C 项：悬停首行仍是**档期序**的第一口（「空白的稚梦」）—— 外显换成角色池后，两者不再相同",
			!!snapG && String(snapG.bannerHover).split("\n")[0] === "「空白的稚梦」：睡前童话"
			&& snapG.banner !== "「空白的稚梦」",
			JSON.stringify(snapG && snapG.bannerHover));
	}
}
