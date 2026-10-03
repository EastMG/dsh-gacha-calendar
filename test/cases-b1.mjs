// next-sources/test/cases-b1.mjs —— 批次 B1 离线夹具测试（umapyoi / Bestdori / sekai）
//
// 三个原则（照 CONVENTIONS.md）：
//   ① 全程离线：用 `useFixtures()` 注入夹具 fetch；纯函数测试直接读 fixtures/*.txt，连 fetch 都不碰。
//   ② 确定性：所有"当期"断言都用**夹具抓取时刻**（meta.capturedAt）当 now，不随运行日期漂移
//      （否则一个月后"当期卡池"变了，测试会假失败）。抓取器把 now 作为第 4 个参数传入。
//   ③ 不拖垮共享 run.mjs：抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断别的批次。
//
// 断言里的具体值（704 条 / 1734 条 / "美咲生日纪念…" 等）都是**夹具快照值**；
// 重抓夹具后需要同步更新，届时以"形态与不变量"那一批断言为准。

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
const { sourceWallParts } = T;
import { findSource, SOURCES_B1 } from "./registry-shim.mjs";
import { T } from "./load.mjs";
const { parseUmapyoiGacha, gachaUmapyoi, PERMANENT_END } = T.parsers["umapyoi"];
const { parseBestdoriGacha, parseBestdoriEvents, gachaBestdori, eventsBestdori } = T.parsers["bestdori"];
const { parseSekaiGachas, parseSekaiEvents, gachaSekai, eventsSekai } = T.parsers["sekai"];

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt`, import.meta.url), "utf8"));
const meta = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}/response.txt.meta.json`, import.meta.url), "utf8"));

// 夹具快照时刻（= 抓取那一刻）；三个来源共用，作为"当前时刻"
const SNAP = Date.parse(meta("b1-umapyoi-gacha").capturedAt);

const B1_FIXTURE_URLS = {
	"https://api.umapyoi.net/api/v1/gacha": "b1-umapyoi-gacha/response.txt",
	"https://bestdori.com/api/gacha/all.5.json": "b1-bestdori-gacha/response.txt",
	"https://bestdori.com/api/events/all.5.json": "b1-bestdori-events/response.txt",
	"https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json": "b1-sekai-gachas/response.txt",
	"https://sekai-world.github.io/sekai-master-db-cn-diff/events.json": "b1-sekai-events/response.txt"
};

// 抓取器调用包装：失败只记 ✗（不抛，避免中断共享 runner）
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn, label) {
	try { fn(); return false; } catch { return true; }
}
const jst = (ts) => sourceWallParts(ts, "Asia/Tokyo");
const cst = (ts) => sourceWallParts(ts, "Asia/Shanghai");
const pad = (n) => String(n).padStart(2, "0");
const wall = (w) => `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`;

export default async function run() {
	useFixtures();

	// ───────────────────────── 注册表片段 ─────────────────────────
	section("B1-0 注册表片段（契约字段齐备）");
	{
		check("SOURCES_B1 有 1 条（另 2 条已吸收为备选源，见 registry-extras.js）", SOURCES_B1.length === 1, String(SOURCES_B1.length));
		const ids = SOURCES_B1.map((s) => s.id);
		check("id = [pjsk]（uma-jp-umapyoi / bandori-bestdori 已移入 altSources）", JSON.stringify(ids) === JSON.stringify(["pjsk"]), ids.join(","));
		check("id 无重复", new Set(ids).size === ids.length, ids.join(","));
		for (const s of SOURCES_B1) {
			check(`${s.id} 声明了 tz`, typeof s.tz === "string" && s.tz.length > 0, String(s.tz));
			check(`${s.id} 至少有一侧抓取器`, !!(s.gacha || s.event));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`${s.id}.${side} 有 url/fetcher/mode`,
					typeof s[side].url === "string" && s[side].url.startsWith("http") && typeof s[side].fetcher === "function" && (s[side].mode === "proxy" || s[side].mode === "direct"),
					JSON.stringify({ url: s[side].url, mode: s[side].mode }));
			}
		}
		// 调研实测：只有 api.umapyoi.net / sekai-world.github.io 可直连，bestdori 必须走代理
		// ⚠️ uma-jp-umapyoi / bandori-bestdori 已**吸收为备选源**（分别为 registry-p5.js 的 uma-jp.altSources
		//    与 registry-b3.js 的 bandori.altSources/eventAltSources）；它们的 direct/proxy 取值
		//    改由 all.mjs 的「备选源登记」守卫与各条目自己的 registry 校验。
		check("sekai 用 direct（GitHub Pages 静态资源）",
			findSource("pjsk").gacha.mode === "direct" && findSource("pjsk").event.mode === "direct");
		// umapyoi 已作为 uma-jp 的**卡池备选源**；它本身仍只有卡池侧（由 registry-extras.js 单侧登记）
		// 共享 test/map.json 必须能查到本批次 5 个 URL（否则合并进 run.mjs 后 useFixtures() 会 404）
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		for (const url of Object.keys(B1_FIXTURE_URLS)) {
			check(`map.json 收录 ${url}`, map[url] === B1_FIXTURE_URLS[url], JSON.stringify(map[url]));
		}
	}

	// ───────────────────────── 1. umapyoi ─────────────────────────
	section("B1-1 赛马娘 日服（umapyoi）—— 夹具形态 + 解析");
	const umaRaw = fixture("b1-umapyoi-gacha");
	let uma = null;
	{
		check("夹具是数组", Array.isArray(umaRaw), typeof umaRaw);
		check("夹具快照：704 条 / 38 张常驻哨兵",
			umaRaw.length === 704 && umaRaw.filter((x) => x.end_date === PERMANENT_END).length === 38,
			`${umaRaw.length} 条 / ${umaRaw.filter((x) => x.end_date === PERMANENT_END).length} 常驻`);
		check("字段形态 = {card_type,id,start_date,end_date,type}（秒级时间戳）",
			typeof umaRaw[0].start_date === "number" && umaRaw[0].start_date < 1e10 && typeof umaRaw[0].card_type === "string",
			JSON.stringify(umaRaw[0]));

		// 时区依据②（夹具自洽）：有界结束时间 100% 落在 JST 11:59:59；起点绝大多数落在 JST 12:00
		const bounded = umaRaw.filter((x) => x.end_date != null && x.end_date !== PERMANENT_END);
		check("时区依据②：全部有界 end_date 都是 JST 11:59:59",
			bounded.length > 0 && bounded.every((x) => { const w = jst(x.end_date * 1000); return w.h === 11 && w.mi === 59; }),
			String(bounded.length));
		const noon = umaRaw.filter((x) => { const w = jst(x.start_date * 1000); return w.h === 12 && w.mi === 0; }).length;
		check("时区依据②：≥90% start_date 落在 JST 12:00（日服卡池 12:00 更新）",
			noon / umaRaw.length >= 0.9, `${noon}/${umaRaw.length}`);

		uma = parseUmapyoiGacha(umaRaw, SNAP, "Asia/Tokyo");
		check("当期窗口取最新有界批次（夹具快照：10-01 起）",
			uma && uma.startTs === 1790823600000 && uma.endTs === 1793588399000,
			JSON.stringify(uma && [uma.startTs, uma.endTs]));
		check("banner 为合成文本（源站无卡池名）且带卡类型",
			!!uma && uma.banner === "赛马娘日服卡池（Outfit、Support Card）", JSON.stringify(uma && uma.banner));
		check("bannerDates = 10-01 12:00 ~ 11-02 11:59（JST 渲染）",
			!!uma && uma.bannerDates === "10-01 12:00 ~ 11-02 11:59", JSON.stringify(uma && uma.bannerDates));
		check("起点墙钟 JST = 12:00 / 终点墙钟 JST = 11:59",
			!!uma && jst(uma.startTs).h === 12 && jst(uma.endTs).h === 11 && jst(uma.endTs).mi === 59);
		check("常驻哨兵没有被当成真实结束时刻",
			!!uma && uma.endTs < PERMANENT_END * 1000 && !/2147483647/.test(uma.bannerDates));
		check("hover 如实说明 banner 是合成的（源站只有卡级数据）",
			!!uma && uma.bannerHover.includes("无卡池名"));
		check("hover 多行且列出同期窗口 + 常驻卡张数",
			!!uma && uma.bannerHover.split("\n").length >= 4 && /另有 38 张常驻卡/.test(uma.bannerHover),
			JSON.stringify((uma && uma.bannerHover || "").split("\n").slice(-1)[0]));
		assertContract("赛马娘日服", "gacha", uma);

		// 回归守卫：**不能只按 start_date 分组**。实测 29 个 start_date 挂多组不同 end_date，
		// 混组会把过期的结束时间带进当期窗口（旧实现在 2026-03-11 那批上把所有常驻卡判成过期）。
		const S = Math.floor(SNAP / 1000) - 10 * 86400;
		const syn = [
			{ card_type: "Outfit", id: 1, start_date: S, end_date: S + 2 * 86400, type: 3 },      // 已过期
			{ card_type: "Support Card", id: 2, start_date: S, end_date: S + 20 * 86400, type: 3 }, // 在架
			{ card_type: "Outfit", id: 3, start_date: S, end_date: PERMANENT_END, type: 5 }        // 常驻（同一 start）
		];
		const synOut = parseUmapyoiGacha(syn, SNAP, "Asia/Tokyo");
		check("同 start 不同 end：各成窗口，当期只算在架那张",
			!!synOut && synOut.startTs === S * 1000 && synOut.endTs === (S + 20 * 86400) * 1000 && synOut.bannerHover.includes("×1"),
			JSON.stringify(synOut && [synOut.startTs, synOut.endTs]));

		check("结构损坏（对象/空数组）→ 抛错", throws(() => parseUmapyoiGacha({}), "obj") && throws(() => parseUmapyoiGacha([]), "empty"));
		// 夹具快照之后很久（2030）再看：全部窗口都过期 → null（未公布），而不是硬造一个
		check("过期数据 → null（未公布）", parseUmapyoiGacha(umaRaw, Date.UTC(2030, 0, 1), "Asia/Tokyo") === null);
	}

	// ───────────────────────── 2. Bestdori ─────────────────────────
	section("B1-2 BanG Dream! 国服（Bestdori）—— 夹具形态 + 解析");
	const bdGachaRaw = fixture("b1-bestdori-gacha");
	const bdEventRaw = fixture("b1-bestdori-events");
	let bdG = null, bdE = null;
	{
		check("gacha 夹具是以 id 为 key 的对象（2149 条）",
			!Array.isArray(bdGachaRaw) && typeof bdGachaRaw === "object" && Object.keys(bdGachaRaw).length === 2149,
			String(Object.keys(bdGachaRaw).length));
		check("时间是**字符串**毫秒（不是数字）",
			typeof bdGachaRaw["1"].publishedAt[3] === "string" && typeof bdEventRaw["1"].startAt[3] === "string",
			JSON.stringify([bdGachaRaw["1"].publishedAt[3], bdEventRaw["1"].startAt[3]]));
		// 下标 3 = 简中服（用 gacha 1 的五连名称验证：[2] 繁体 / [3] 简体）
		check("下标 3 = 简中服（[2]=遊戲上線紀念轉蛋 / [3]=开服纪念招募）",
			bdGachaRaw["1"].gachaName[3] === "开服纪念招募" && bdGachaRaw["1"].gachaName[2] === "遊戲上線紀念轉蛋",
			JSON.stringify(bdGachaRaw["1"].gachaName));
		const cnTimed = Object.keys(bdGachaRaw).filter((k) => Array.isArray(bdGachaRaw[k].publishedAt) && bdGachaRaw[k].publishedAt[3] != null).length;
		check("夹具快照：1734/2149 个卡池带简中时间", cnTimed === 1734, String(cnTimed));
		const cnEvents = Object.keys(bdEventRaw).filter((k) => Array.isArray(bdEventRaw[k].startAt) && bdEventRaw[k].startAt[3] != null).length;
		check("夹具快照：325/345 个活动带简中时间", cnEvents === 325, String(cnEvents));
		check("时间数组长度都是 5（5 个服区）",
			Object.values(bdGachaRaw).every((v) => (v.publishedAt || []).length === 5) && Object.values(bdEventRaw).every((v) => (v.startAt || []).length === 5));

		// 时区交叉验证：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt 02:00Z
		check("时区交叉验证：gacha 1799 简中 startAt → UTC+8 的 2026-09-29 10:00",
			wall(cst(Number(bdGachaRaw["1799"].publishedAt[3]))) === "2026-09-29 10:00",
			wall(cst(Number(bdGachaRaw["1799"].publishedAt[3]))));
		// 同一时刻用 UTC+9 渲染会变成 11:00 → 说明 tz 必须是 UTC+8（不是日本时区）
		check("同一 startAt 在 UTC+9 下是 11:00（排除误用 Asia/Tokyo）",
			wall(jst(Number(bdGachaRaw["1799"].publishedAt[3]))) === "2026-09-29 11:00");

		bdG = parseBestdoriGacha(bdGachaRaw, SNAP, "Asia/Shanghai");
		check("当期卡池 = 最新开始的有界简中卡池（夹具快照：美咲生日纪念）",
			!!bdG && bdG.banner === "美咲生日纪念Special&Precious birthday！招募", JSON.stringify(bdG && bdG.banner));
		check("窗口 = 10-01 00:00 ~ 10-03 23:59（绝对 UTC 毫秒按 UTC+8 渲染）",
			!!bdG && bdG.bannerDates === "10-01 00:00 ~ 10-03 23:59" && bdG.startTs === 1790784000000 && bdG.endTs === 1791043199000,
			JSON.stringify(bdG && [bdG.bannerDates, bdG.startTs, bdG.endTs]));
		check("长期/常驻卡池（closedAt=2100 哨兵）不参与当期",
			!!bdG && !/2100/.test(bdG.bannerDates) && /另有 9 个长期\/常驻卡池/.test(bdG.bannerHover),
			JSON.stringify(bdG && bdG.bannerHover.split("\n").slice(-1)[0]));
		check("hover 列出同期有界卡池（≥10 行）", !!bdG && bdG.bannerHover.split("\n").length >= 10, String(bdG && bdG.bannerHover.split("\n").length));
		assertContract("BanG Dream 国服", "gacha", bdG);
		// 只有长期池在期（或全都过期）→ null，而不是把 2100 哨兵当成当期
		check("没有在架有界卡池 → null（未公布）", parseBestdoriGacha(bdGachaRaw, Date.UTC(2035, 0, 1), "Asia/Shanghai") === null);

		bdE = parseBestdoriEvents(bdEventRaw, SNAP, "Asia/Shanghai");
		check("当期活动 = All☆Stars CiRCRiNG Fes!（简中名）", !!bdE && bdE.event === "All☆Stars CiRCRiNG Fes!", JSON.stringify(bdE && bdE.event));
		check("活动窗口 = 09-29 10:00 ~ 10-14 22:59", !!bdE && bdE.eventDates === "09-29 10:00 ~ 10-14 22:59", JSON.stringify(bdE && bdE.eventDates));
		check("只 1 期在期时 eventHover 为空（由 UI 兜底展示）", !!bdE && bdE.eventHover === "");
		assertContract("BanG Dream 国服", "event", bdE);
		check("活动侧结构损坏 → 抛错", throws(() => parseBestdoriEvents([], SNAP)) && throws(() => parseBestdoriGacha([], SNAP)));
	}

	// ───────────────────────── 3. sekai（PJSK） ─────────────────────────
	section("B1-3 PJSK 缤纷舞台（sekai-master-db cn-diff）—— 夹具形态 + 解析");
	const skGachaRaw = fixture("b1-sekai-gachas");
	const skEventRaw = fixture("b1-sekai-events");
	let skG = null, skE = null;
	{
		check("gachas 夹具 59 条 / events 夹具 198 条（夹具快照）",
			skGachaRaw.length === 59 && skEventRaw.length === 198, `${skGachaRaw.length}/${skEventRaw.length}`);
		// ⚠️ 任务给的字段形态里 `endAt` 是**不存在的**：活动侧只有 aggregateAt / closedAt / distributionEndAt
		check("events **没有 endAt** 字段（任务给的形态需纠正 → 结束取 aggregateAt）",
			skEventRaw.every((e) => !("endAt" in e)) && skEventRaw.every((e) => typeof e.aggregateAt === "number"),
			JSON.stringify(Object.keys(skEventRaw[0])));
		check("gachaType/eventType 是字符串枚举（不是数字）",
			typeof skGachaRaw[0].gachaType === "string" && typeof skEventRaw[0].eventType === "string",
			JSON.stringify([skGachaRaw[0].gachaType, skEventRaw[0].eventType]));
		check("时间是数字 epoch 毫秒", typeof skGachaRaw[0].startAt === "number" && skGachaRaw[0].startAt > 1e12);

		// 时区依据：生日池必须落在 UTC+8 的 00:00（若误用 UTC+9 会变成 01:00，日期也不对）
		const g836 = skGachaRaw.find((g) => g.id === 836);
		check("时区依据①：生日池 836 → UTC+8 的 2026-10-01 00:00（桐谷遥生日当天）",
			wall(cst(g836.startAt)) === "2026-10-01 00:00", wall(cst(g836.startAt)));
		check("时区依据①（反证）：同一时刻在 UTC+9 下是 2026-10-01 01:00",
			wall(jst(g836.startAt)) === "2026-10-01 01:00", wall(jst(g836.startAt)));
		const g802 = skGachaRaw.find((g) => g.id === 802);
		check("时区依据②：月卡池 802 → UTC+8 的 2026-09-01 04:00（每月 1 日 04:00 换月卡）",
			wall(cst(g802.startAt)) === "2026-09-01 04:00", wall(cst(g802.startAt)));

		skG = parseSekaiGachas(skGachaRaw, SNAP, "Asia/Shanghai");
		check("当期招募 = 最新开始的有界池（夹具快照：桐谷遥生日池）",
			!!skG && skG.banner === "[桐谷遥]HAPPY BIRTHDAY 2026招募", JSON.stringify(skG && skG.banner));
		check("窗口 = 10-01 00:00 ~ 10-07 23:59",
			!!skG && skG.bannerDates === "10-01 00:00 ~ 10-07 23:59" && skG.startTs === 1790784000000 && skG.endTs === 1791388799000,
			JSON.stringify(skG && [skG.bannerDates, skG.startTs, skG.endTs]));
		check("长期池（endAt=2099 哨兵）不参与当期，也不进悬停",
			!!skG && !/2099/.test(skG.bannerDates) && !/2099/.test(skG.bannerHover) && !/长期|常驻招募/.test(skG.bannerHover),
			JSON.stringify(skG && skG.bannerHover.split("\n").slice(-2)));
		// 悬停排版＝本体 buildPoolHover：每池「池名」一行 + 档期一行（窗口相同则档期只在末尾写一遍），
		// 结束时间升序。**名称在前、档期在后**（用户 2026-10-03 反馈的偏差②）。
		{
			const lines = skG ? skG.bannerHover.split("\n") : [];
			// 40 行 = 20 个当期有界池 × （池名 + 档期）。
			// 阈值 2026-10-03 由 400 天收紧到 **120 天**（对齐本体 EVENT_MAX_WINDOW_DAYS）后，
			// 4 个整 365 天的「新手限定★4自选阶梯招募」被正确判为长期池剔除 → 24 池降为 20 池。
			check("hover 每池「池名」+「档期」两行，结束时间升序",
				lines.length === 40 && /^T恤服装特惠招募$/.test(lines[0]) && /^09-19 12:00 ~ 10-03 11:59$/.test(lines[1]),
				JSON.stringify(lines.slice(0, 2)));
			check("hover 行首是名称、档期行不是行首（不是「档期在前」）",
				lines.filter((_, i) => i % 2 === 0).every((l) => l.trim() !== "" && !/^\d{2}-\d{2} \d{2}:\d{2} ~ /.test(l))
				&& lines.filter((_, i) => i % 2 === 1).every((l) => /^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/.test(l)));
			// 同名同窗的 4 条阶梯招募各自成行（不再合并成「×4」这种非源站原文的记法）
			check("同名同窗不再合并成 ×n，而是各自成行",
				lines.filter((l) => l === "[1.5周年纪念]阶梯招募").length === 4 && !/×\d/.test(skG.bannerHover));
		}
		// 守护：悬停里**不能**再出现任何元信息 / 实现说明（用户 2026-10-03：「元信息彻底删掉」）
		check("hover 不含元信息（来源/URL/tz=/推定/抓取统计/gachaType 后缀/实现说明）",
			!!skG && !/来源|https?:|api\.|bwiki|米游社|官网|tz=|推定|共扫描|取详情|抓取|（[^）]*）|×\d/.test(skG.bannerHover),
			JSON.stringify(skG && skG.bannerHover.split("\n").slice(0, 4)));
		assertContract("PJSK", "gacha", skG);
		check("只有长期池在期 → null（未公布）",
			parseSekaiGachas([{ id: 1, gachaType: "normal", name: "任务招募", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2099, 11, 30) }], SNAP, "Asia/Shanghai") === null);
		// 只有 1 个当期有界池 → **不设 bannerHover**（由 UI 走默认两行式「banner ⏎ bannerDates」）
		{
			const one = parseSekaiGachas([
				{ id: 1, gachaType: "normal", name: "任务招募", startAt: Date.UTC(2026, 9, 1), endAt: Date.UTC(2099, 11, 30) },
				{ id: 2, gachaType: "ceil", name: "独苗招募", startAt: Date.UTC(2026, 9, 1), endAt: Date.UTC(2026, 9, 20) }
			], Date.UTC(2026, 9, 2), "Asia/Shanghai");
			check("只有 1 个当期池 → 不设 bannerHover",
				!!one && one.banner === "独苗招募" && !("bannerHover" in one), JSON.stringify(one && Object.keys(one)));
		}

		skE = parseSekaiEvents(skEventRaw, SNAP, "Asia/Shanghai");
		const ev181 = skEventRaw.find((e) => e.id === 181);
		check("当期活动 = Our Golden Days（夹具快照）", !!skE && skE.event === "Our Golden Days", JSON.stringify(skE && skE.event));
		check("活动窗口 = startAt ~ aggregateAt（源站无 endAt）",
			!!skE && skE.eventDates === "09-30 15:00 ~ 10-09 20:59",
			JSON.stringify(skE && skE.eventDates));
		check("活动结束时刻 = 该条的 aggregateAt（不是 closedAt / distributionEndAt）",
			!!skE && skE.eventDates === "09-30 15:00 ~ 10-09 20:59"
			&& wall(cst(ev181.aggregateAt)) === "2026-10-09 20:59" && wall(cst(ev181.closedAt)) === "2026-10-11 14:59",
			JSON.stringify([wall(cst(ev181.aggregateAt)), wall(cst(ev181.closedAt))]));
		// ⚠️ 2026-10-03 变更：实现说明**任何外显字段都不许出现**。
		// 旧版把「（源站无 endAt：结束取 aggregateAt；closedAt=… 为结果公布）」拼进 `eventDatesRaw`，
		// 而 UI 的默认两行式就是 `eventDatesRaw || eventDates` → 说明**照样出现在面板上**
		// （用户要求「元信息彻底删掉」）。现在 raw 与 dates 同值，说明只留在代码注释。
		check("eventDatesRaw 就是档期本身（不再夹带实现说明）",
			!!skE && skE.eventDatesRaw === skE.eventDates, JSON.stringify(skE && skE.eventDatesRaw));
		check("eventDates / eventDatesRaw 都不含实现说明（源站/aggregateAt/closedAt/括号）",
			!!skE && !/[（(]|源站|aggregateAt|closedAt|endAt/.test(skE.eventDates)
			&& !/[（(]|源站|aggregateAt|closedAt|endAt/.test(skE.eventDatesRaw),
			JSON.stringify(skE && [skE.eventDates, skE.eventDatesRaw]));
		// 只有 1 条当期活动 → **不设 eventHover**，由 UI 走默认两行式「event ⏎ eventDates」
		check("只 1 条当期活动 → 不设 eventHover（UI 兜底）", !!skE && !("eventHover" in skE), JSON.stringify(skE && Object.keys(skE)));
		// 多活动（合成夹具）：hoverEvent 逐行「名称 + 3 空格 + 档期」，**名称在前**，结束时间升序
		{
			const t = (d, h) => Date.UTC(2026, 9, d, h);
			const many = parseSekaiEvents([
				{ id: 1, name: "活动甲", eventType: "marathon", startAt: t(1, 7), aggregateAt: t(9, 12), closedAt: t(11, 6) },
				{ id: 2, name: "活动乙", eventType: "cheerful_carnival", startAt: t(1, 7), aggregateAt: t(5, 12), closedAt: t(7, 6) },
				{ id: 3, name: "长期露演", eventType: "world_bloom", startAt: t(1, 7), aggregateAt: t(1, 7) + 200 * 86400e3, closedAt: null }
			], t(2, 12), "Asia/Shanghai");
			const lines = many ? (many.eventHover || "").split("\n") : [];
			check("多活动 hover：行首是名称（不是日期）、名称与档期之间是 3 空格",
				lines.length === 2 && /^活动乙 {3}10-01 15:00 ~ 10-05 20:00$/.test(lines[0]) && /^活动甲 {3}10-01 15:00 ~ 10-09 20:00$/.test(lines[1]),
				JSON.stringify(lines));
			check("多活动 hover：结束时间升序（乙 10-05 在甲 10-09 之前）", lines.length === 2 && /活动乙/.test(lines[0]));
			check("多活动 hover：长期活动（>120 天）不进悬停", !/长期露演/.test(many ? many.eventHover : ""));
			check("多活动 hover 不含元信息（源站字段名 / eventType / aggregateAt / closedAt / 来源 / 推定）",
				!!many && !!many.eventHover && !/来源|https?:|tz=|推定|aggregateAt|closedAt|eventType|marathon|cheerful|（|）/.test(many.eventHover),
				JSON.stringify(many && many.eventHover));
		}
		assertContract("PJSK", "event", skE);
		check("活动侧结构损坏 → 抛错", throws(() => parseSekaiEvents({}, SNAP)) && throws(() => parseSekaiGachas({}, SNAP)));
	}

	// ───────────────────────── 4. 抓取器端到端（离线走夹具） ─────────────────────────
	section("B1-4 抓取器端到端（夹具 fetch，now=夹具快照时刻）");
	{
		// ⚠️ uma-jp-umapyoi / bandori-bestdori 已吸收为**备选源**，不再是 SOURCES_B1 的独立条目。
		//    这里直接用**原始导出函数**测端到端（备选源最终也是调用同一个函数），
		//    等价于原来"经 registry 包装层"的测试。
		const r1 = await grab(() => gachaUmapyoi("https://api.umapyoi.net/api/v1/gacha", undefined, "Asia/Tokyo", SNAP));
		check("umapyoi.gacha 抓取成功", r1.ok, r1.err);
		assertContract("赛马娘日服", "gacha", r1.ok ? r1.data : null);
		check("umapyoi.gacha 与纯函数结果一致", r1.ok && r1.data && r1.data.bannerDates === uma.bannerDates, JSON.stringify(r1.ok && r1.data && r1.data.bannerDates));

		const r2 = await grab(() => gachaBestdori("https://bestdori.com/api/gacha/all.5.json", undefined, "Asia/Shanghai", SNAP));
		check("bestdori.gacha 抓取成功", r2.ok, r2.err);
		assertContract("BanG Dream 国服", "gacha", r2.ok ? r2.data : null);
		check("bestdori.gacha 与纯函数结果一致", r2.ok && r2.data && r2.data.banner === bdG.banner, JSON.stringify(r2.ok && r2.data && r2.data.banner));
		const r3 = await grab(() => eventsBestdori("https://bestdori.com/api/events/all.5.json", undefined, "Asia/Shanghai", SNAP));
		check("bestdori.event 抓取成功", r3.ok, r3.err);
		assertContract("BanG Dream 国服", "event", r3.ok ? r3.data : null);
		check("bestdori.event 与纯函数结果一致", r3.ok && r3.data && r3.data.event === bdE.event, JSON.stringify(r3.ok && r3.data && r3.data.event));

		const skSrc = findSource("pjsk");
		const r4 = await grab(() => skSrc.gacha.fetcher(skSrc.gacha.url, undefined, skSrc.tz, SNAP));
		check("sekai.gacha 抓取成功", r4.ok, r4.err);
		assertContract("PJSK", "gacha", r4.ok ? r4.data : null);
		check("sekai.gacha 与纯函数结果一致", r4.ok && r4.data && r4.data.banner === skG.banner, JSON.stringify(r4.ok && r4.data && r4.data.banner));
		const r5 = await grab(() => skSrc.event.fetcher(skSrc.event.url, undefined, skSrc.tz, SNAP));
		check("sekai.event 抓取成功", r5.ok, r5.err);
		assertContract("PJSK", "event", r5.ok ? r5.data : null);
		check("sekai.event 与纯函数结果一致", r5.ok && r5.data && r5.data.event === skE.event, JSON.stringify(r5.ok && r5.data && r5.data.event));

		// 三个来源的原始导出函数也直接测一遍（防止只测 registry 包装层）
		const r6 = await grab(() => gachaUmapyoi("https://api.umapyoi.net/api/v1/gacha", undefined, "Asia/Tokyo", SNAP));
		const r7 = await grab(() => gachaBestdori("https://bestdori.com/api/gacha/all.5.json", undefined, "Asia/Shanghai", SNAP));
		const r8 = await grab(() => eventsBestdori("https://bestdori.com/api/events/all.5.json", undefined, "Asia/Shanghai", SNAP));
		const r9 = await grab(() => gachaSekai("https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json", undefined, "Asia/Shanghai", SNAP));
		const r10 = await grab(() => eventsSekai("https://sekai-world.github.io/sekai-master-db-cn-diff/events.json", undefined, "Asia/Shanghai", SNAP));
		check("5 个导出的抓取器都能离线跑通（mode=direct/proxy 自动选对分支）",
			r6.ok && r7.ok && r8.ok && r9.ok && r10.ok,
			[r6, r7, r8, r9, r10].map((r) => r.err || "ok").join(" | "));
	}

	// run.mjs 会调用 summary()；直接 `node test/cases-b1.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-b1.mjs")) summary();
}

// 直接执行（node test/cases-b1.mjs）时自动跑；被 run.mjs import 时不自动跑
if (process.argv[1] && process.argv[1].endsWith("cases-b1.mjs")) await run();
