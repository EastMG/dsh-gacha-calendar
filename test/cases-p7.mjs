// next-sources/test/cases-p7.mjs —— 批次 P7 离线夹具测试（星塔旅人 国服）
//
// 三个原则（照 CONVENTIONS.md）：
//   ① 全程离线：用 `useFixtures()` 注入夹具 fetch；纯函数测试直接读 fixtures/*.txt
//   ② 确定性：所有"当期"断言都用**夹具抓取时刻**（meta.capturedAt）当 now，不随运行日期漂移
//   ③ 不拖垮共享 runner：抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断别的批次
import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
const { sourceWallParts, hoverPool, hoverEvent } = T;
import { SOURCES_P7 } from "./registry-shim.mjs";
import { T } from "./load.mjs";
const { parseStellaList, parseStellaWindow, parseStellaWindows, stellaWindowsFromDetail, stellaIsGacha, stellaIsEvent, stellaGachaName, stellaFeaturedName, gachaStellasora, eventsStellasora, STELLA_TZ } = T.parsers["stellasora"];

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt`, import.meta.url), "utf8"));
const meta = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt.meta.json`, import.meta.url), "utf8"));
const raw = (name) => readFileSync(new URL(`./fixtures/${name}/response.txt`, import.meta.url), "utf8");

// 夹具快照时刻（= 抓取那一刻）作为"当前时刻"，保证确定性
const SNAP = Date.parse(meta("p7-stella-notice").capturedAt);
const SNAP_PARTS = sourceWallParts(SNAP, STELLA_TZ);

// 抓取器会依次请求：列表 + 若干详情。全部登记到夹具映射里。
const URLS = {
	"https://stellasora.yostar.cn/api/resource/news-type": "p7-stella-types/response.txt",
	"https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice": "p7-stella-notice/response.txt",
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
			check("卡池 hover 档期行由 fmtWindow 格式化（MM-DD HH:MM ~ MM-DD HH:MM）",
				gl.filter((s, i) => i % 2 === 1).every((s) => /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(s)), JSON.stringify(gl));
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
			// 解析器「<2 就不设字段」的依据本身也守一道（lib/env.js 的契约）
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
			check("活动名含「活动」（分流正确）", /活动/.test(ev.event), ev.event);
			check("活动侧不带卡池字段", ev.banner === undefined);

			// ── 活动悬停（2026-10-03 修：名称在前 + 3 空格 + 档期；删掉「（起点按公告发布时刻推断）」）──
			check("活动 hover 在 eventHover 且非空",
				typeof ev.eventHover === "string" && ev.eventHover.length > 0, JSON.stringify(ev.eventHover));
			const el = String(ev.eventHover || "").split("\n");
			check("活动 hover 逐条一行（2 条当期 → 2 行）", el.length === 2, JSON.stringify(el));
			check("活动 hover 行首是**名称**不是档期（旧实现「档期在前」已改掉）",
				el.every((s) => /^「[^」]+」/.test(s) && !/^\d{2}-\d{2}/.test(s)), JSON.stringify(el));
			check("活动 hover「名称 + 3 空格 + 档期」（且档期被格式化，不是源站原文）",
				el.every((s) => {
					const parts = s.split("   ");
					return parts.length === 2
						&& /^「[^」]+」/.test(parts[0])
						&& /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(parts[1])
						&& !/20\d\d\//.test(parts[1]);
				}), JSON.stringify(el));
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
}
