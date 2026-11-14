// next-sources/test/cases-b1.mjs —— 批次 B1 离线夹具测试（umapyoi / Bestdori / sekai）
//
// 三个原则（照合并前的 CONVENTIONS.md）：
//   ① 全程离线：用 `useFixtures()` 注入夹具 fetch；纯函数测试直接读 fixtures/*.txt，连 fetch 都不碰。
//   ② 确定性：所有"当期"断言都用**夹具抓取时刻**（meta.capturedAt）当 now，不随运行日期漂移
//      （否则一个月后"当期卡池"变了，测试会假失败）。抓取器把 now 作为第 4 个参数传入。
//   ③ 不拖垮共享 run.mjs：抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断别的批次。
//
// 断言里的具体值（704 条 / 1734 条 / "美咲生日纪念…" 等）都是**夹具快照值**；
// 重抓夹具后需要同步更新，届时以"形态与不变量"那一批断言为准。

import { readFileSync } from "node:fs";
import { createEngine } from "../packages/core/core.mjs";
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
		// ⚠️ uma-jp-umapyoi / bandori-bestdori 已**吸收为备选源**（分别为原 registry-p5.js 的 uma-jp.altSources
		//    与原 registry-b3.js 的 bandori.altSources/eventAltSources）；它们的 direct/proxy 取值
		//    改由 all.mjs 的「备选源登记」守卫与各条目自己的 registry 校验。
		check("sekai 用 direct（GitHub Pages 静态资源）",
			findSource("pjsk").gacha.mode === "direct" && findSource("pjsk").event.mode === "direct");
		// umapyoi 已作为 uma-jp 的**卡池备选源**；它本身仍只有卡池侧（由原 registry-extras.js 单侧登记）
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
		// ── 悬停（2026-10-03 方案 A 补漏：umapyoi 是**备选源**，此前没被审计覆盖）──
		// 旧实现：`赛马娘日服（源站为卡级数据，无卡池名；起止＝…）` + 档期在前的行 + 内部 id
		//        + 「另有 N 张常驻卡（end_date=2147483647 哨兵…）」—— 全是元信息，且档期在前。
		// 现要求：走共用 hoverPool，**只有池名与档期**，池名在档期之前，无内部 id / 无源站字段名 / 无来源说明。
		check("hover 不再含来源/实现说明（无卡池名 / 哨兵 / 无卡级数据）",
			!!uma && !/无卡池名|哨兵|卡级数据|end_date|2147483647/.test(uma.bannerHover), JSON.stringify(uma && uma.bannerHover));
		check("hover 不含内部 id",
			!!uma && !/\bid \d/.test(uma.bannerHover), JSON.stringify(uma && uma.bannerHover));
		check("hover 每池「池名」+「档期」两行、且池名在档期之前（不是档期在前）",
			!!uma && (() => {
				const L = uma.bannerHover.split("\n");
				const isDate = (s) => /^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ /.test(s);
				return L.length >= 4 && L.length % 2 === 0
					&& L.filter((_, i) => i % 2 === 0).every((s) => !isDate(s))
					&& L.filter((_, i) => i % 2 === 1).every(isDate);
			})(), JSON.stringify(uma && uma.bannerHover));
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
			!!synOut && synOut.startTs === S * 1000 && synOut.endTs === (S + 20 * 86400) * 1000,
			JSON.stringify(synOut && [synOut.startTs, synOut.endTs]));
		// 只有 1 个当期有界窗口 → hoverPool 返回 ""，不设 bannerHover（UI 走默认两行式）。
		// 旧实现会输出「卡池×1（id 3）  档期」这种带 ×n 与内部 id 的单行式 —— 已随方案 A 删除。
		check("只 1 个当期窗口 → 不设 bannerHover（也不再有 ×n / 内部 id 记法）",
			!!synOut && !("bannerHover" in synOut), JSON.stringify(synOut && synOut.bannerHover));

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
		check("长窗口（closedAt=2100 哨兵）不再被剔除：如实出现在悬停里（2026-11-11 移除常驻判定）",
			!!bdG && !/2100/.test(bdG.bannerDates) && /2100/.test(bdG.bannerHover) && /★3以上确定招募/.test(bdG.bannerHover),
			JSON.stringify(bdG && bdG.bannerHover.split("\n").slice(-2)));
		// 悬停 = 共用 hoverPool：每池「池名」+「档期」两行，按结束时间升序，**无**类型枚举 / ×n / 元信息
		check("hover 每池两行（池名 / 档期）、按结束时间升序、无类型枚举与元信息",
			!!bdG && (() => {
				const L = bdG.bannerHover.split("\n");
				const isDate = (s) => /^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ /.test(s);
				if (L.length < 4 || L.length % 2 !== 0) return false;
				if (!L.filter((_, i) => i % 2 === 0).every((s) => !isDate(s))) return false;   // 池名行不是档期
				if (!L.filter((_, i) => i % 2 === 1).every(isDate)) return false;             // 档期行是档期
				if (/（[a-z]+）|×\d|（id |未列出|哨兵/.test(bdG.bannerHover)) return false;      // 无类型枚举 / ×n / 内部 id / 元信息
				// 按**结束时刻**升序：档期文本以开始日期开头，所以只能比 ` ~ ` 之后那段
				const ends = L.filter((_, i) => i % 2 === 1).map((s) => s.split(" ~ ")[1]);
				return ends.slice().sort().join("|") === ends.join("|");
			})(), JSON.stringify(bdG && bdG.bannerHover));
		assertContract("BanG Dream 国服", "gacha", bdG);
		// 只有窗口覆盖 now 的池才可能被选中：2101 年时全部池（含 2100 哨兵）都已结束 → null
		check("没有任何池覆盖 now（2101 年，全部已结束）→ null（未公布）",
			parseBestdoriGacha(bdGachaRaw, Date.UTC(2101, 0, 1), "Asia/Shanghai") === null);

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
		check("长窗口（endAt=2099 哨兵）不再被剔除：出现在当期候选与悬停里（2026-11-11 移除常驻判定）",
			!!skG && !/2099/.test(skG.bannerDates) && /2099/.test(skG.bannerHover) && /任务招募/.test(skG.bannerHover),
			JSON.stringify(skG && skG.bannerHover.split("\n").slice(-2)));
		// 悬停排版＝本体 buildPoolHover：每池「池名」一行 + 档期一行（窗口相同则档期只在末尾写一遍），
		// 结束时间升序。**名称在前、档期在后**（用户 2026-10-03 反馈的偏差②）。
		{
			const lines = skG ? skG.bannerHover.split("\n") : [];
			// 64 行 = 32 个当期池 × （池名 + 档期）。2026-11-11 移除 120 天常驻判定后，
			// 4 个整 365 天的「新手限定★4自选阶梯招募」与 2099 哨兵池不再被剔除（20 池 → 32 池）。
			check("hover 每池「池名」+「档期」两行，结束时间升序",
				lines.length === 64 && /^T恤服装特惠招募$/.test(lines[0]) && /^09-19 12:00 ~ 10-03 11:59$/.test(lines[1]),
				JSON.stringify(lines.slice(0, 2)));
			check("长窗口池都在悬停里（新手限定×4 / ★4成员必出 / 世界入住任务 / 任务招募 / 新手应援 / 欢迎回来×4）",
				["新手限定★4自选阶梯招募", "★4成员必出招募", "世界入住任务招募", "任务招募", "[新手应援]必定获得1名★4成员10连招募券招募", "欢迎回来★4自选阶梯招募"]
					.every((n) => lines.includes(n)), JSON.stringify(lines.filter((_, i) => i % 2 === 0)));
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
		check("只有长窗口池在期时也会被选中（不再判「常驻」）",
			(() => {
				const g = parseSekaiGachas([{ id: 1, gachaType: "normal", name: "任务招募", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2099, 11, 30) }], SNAP, "Asia/Shanghai");
				return !!g && g.banner === "任务招募";
			})());
		check("全部池都已结束（2100 年）→ null（未公布）",
			parseSekaiGachas([{ id: 1, gachaType: "normal", name: "任务招募", startAt: Date.UTC(2020, 0, 1), endAt: Date.UTC(2099, 11, 30) }], Date.UTC(2100, 0, 1), "Asia/Shanghai") === null);
		// 只有 1 个当期池 → **不设 bannerHover**（由 UI 走默认两行式「banner ⏎ bannerDates」）
		{
			const one = parseSekaiGachas([
				{ id: 1, gachaType: "normal", name: "已结束的旧池", startAt: Date.UTC(2026, 7, 1), endAt: Date.UTC(2026, 8, 30) },
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
				lines.length === 3 && /^活动乙 {3}10-01 15:00 ~ 10-05 20:00$/.test(lines[0]) && /^活动甲 {3}10-01 15:00 ~ 10-09 20:00$/.test(lines[1]),
				JSON.stringify(lines));
			check("多活动 hover：结束时间升序（乙 10-05 在甲 10-09 之前）", lines.length === 3 && /活动乙/.test(lines[0]));
			// 2026-11-11：200 天长窗口不再被当作"常驻"剔除 —— 如实排在最后（结束最晚）
			check("多活动 hover：200 天长窗口如实进悬停（不再按 >120 天剔除）",
				lines.length === 3 && /^长期露演 {3}2026-10-01 15:00 ~ 2027-04-19 15:00$/.test(lines[2]), JSON.stringify(lines));
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

	// ───────── B1-5 初音未来：缤纷舞台 · 繁中服 / 韩服（2026-11-14 接入）─────────
	//
	// 与国服**同源同形**（Sekai-World 的 sekai-master-db-{tc,kr}-diff）：gachas 的
	// {id,gachaType,name,startAt,endAt} 与 events 的 {id,eventType,name,startAt,aggregateAt} 字段逐字同构，
	// 池名 / 活动名**直接就是本地语言原文**（繁中 / 韩文）。解析器**复用**国服那套 `ns_sekai_*`
	// （只换 URL 与 tz），`roles` 仍为空。
	//
	// 夹具是**裁剪过的**（源站 gachas 4.4MB / events 1.5MB —— 4MB 级不入库，见各 meta 的 note）：
	//   卡池 = 854（前一条边界，11-11 03:59Z 就结束了）/ 859（覆盖 now）/ 861（后一条边界，11-20 起）
	//   活动 = 183/184（前）/ 185（覆盖 now）/ 187/188（后）
	// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒：UTC 与 +08 两道门禁跑的是**同一份期望值**。
	const PJSK_NOW = Date.parse("2026-11-14T00:00:00Z");
	const PJSK = [
		{
			id: "pjsk-tc",
			name: "初音未来：缤纷舞台·繁中服",
			srcLabel: "Sekai World 卡池表（代理）",
			altLabel: "Sekai World 卡池表",
			evtAltLabel: "Sekai World 活动表",
			evtLabel: "Sekai World 活动表（代理）",
			tz: "Asia/Taipei",
			repo: "sekai-master-db-tc-diff",
			gachaFx: "sekai-tc-gachas",
			eventFx: "sekai-tc-events",
			srcTotal: { gachas: 58, events: 200 },
			curGachaId: 859,
			curEventId: 185,
			banner: "[復刻]於響起音樂的街角 招募",
			bannerDates: "11-12 12:00 ~ 11-21 11:59",
			gachaStart: Date.UTC(2026, 10, 12, 4, 0),
			gachaEnd: Date.UTC(2026, 10, 21, 3, 59, 59),
			event: "戰勝自我的主角",
			eventDates: "11-10 15:00 ~ 11-18 20:59",
			eventStart: Date.UTC(2026, 10, 10, 7, 0)
		},
		{
			id: "pjsk-kr",
			name: "初音未来：缤纷舞台·韩服",
			srcLabel: "Sekai World 卡池表（韩文 · 代理）",
			altLabel: "Sekai World 卡池表（韩文）",
			evtAltLabel: "Sekai World 活动表（韩文）",
			evtLabel: "Sekai World 活动表（韩文 · 代理）",
			tz: "Asia/Seoul",
			repo: "sekai-master-db-kr-diff",
			gachaFx: "sekai-kr-gachas",
			eventFx: "sekai-kr-events",
			srcTotal: { gachas: 56, events: 199 },
			curGachaId: 859,
			curEventId: 185,
			banner: "[재등장] 음악이 울리는 길목에서 뽑기",
			bannerDates: "11-12 12:00 ~ 11-21 11:59",
			gachaStart: Date.UTC(2026, 10, 12, 3, 0),
			gachaEnd: Date.UTC(2026, 10, 21, 2, 59, 59),
			event: "초월의 프로타고니스타",
			eventDates: "11-10 15:00 ~ 11-18 20:59",
			eventStart: Date.UTC(2026, 10, 10, 6, 0)
		}
	];
	// 主源 = gh-proxy 包 raw（国服惯例）；备选 = GitHub Pages（实测 200 + ACAO:*）
	const GH = (repo, file) => `https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/${repo}/main/${file}`;
	const PAGES = (repo, file) => `https://sekai-world.github.io/${repo}/${file}`;

	section("B1-5 ① 繁中服 / 韩服：注册（id / 名称 / tz / defaultHidden / URL 与标签逐字）");
	for (const R of PJSK) {
		const s = T.SOURCES.find((x) => x.id === R.id) || null;
		check(`条目已注册（id = ${R.id}）`, !!s, s ? s.id : "缺失");
		check(`${R.id} 名称逐字 = ${R.name}`, !!s && s.name === R.name, s && s.name);
		check(`${R.id} tz = ${R.tz}（源站墙钟 = 各服本地时间）`, !!s && s.tz === R.tz, s && String(s.tz));
		check(`${R.id} defaultHidden = false（2026-11-14 用户拍板：除 cytq 外全部默认展示）`,
			!!s && s.defaultHidden === false, s && String(s.defaultHidden));
		check(`${R.id} 卡池 url 逐字 = gh-proxy 包 raw（${R.repo}/gachas.json）`,
			!!s && s.url === GH(R.repo, "gachas.json"), s && String(s.url));
		check(`${R.id} 活动 eventUrl 逐字 = gh-proxy 包 raw（${R.repo}/events.json）`,
			!!s && s.eventUrl === GH(R.repo, "events.json"), s && String(s.eventUrl));
		check(`${R.id} 两侧来源标签逐字`,
			!!s && s.source === R.srcLabel && s.eventSource === R.evtLabel,
			s && JSON.stringify([s.source, s.eventSource]));
		check(`${R.id} 卡池备选 = Pages 版 1 条（label/url/fetcher 逐字）`,
			!!s && Array.isArray(s.altSources) && s.altSources.length === 1
			&& s.altSources[0].label === R.altLabel
			&& s.altSources[0].url === PAGES(R.repo, "gachas.json")
			&& s.altSources[0].fetcher === R.id,
			s && JSON.stringify(s.altSources));
		check(`${R.id} 活动备选 = Pages 版 1 条（label/url/fetcher=default 逐字）`,
			!!s && Array.isArray(s.eventAltSources) && s.eventAltSources.length === 1
			&& s.eventAltSources[0].label === R.evtAltLabel
			&& s.eventAltSources[0].url === PAGES(R.repo, "events.json")
			&& s.eventAltSources[0].fetcher === "default",
			s && JSON.stringify(s.eventAltSources));
		// 「不要把 4MB 以上的请求发两遍」：同一个大文件只挂一个主源，raw 直连不另外列一条
		const allUrls = [s && s.url, s && s.eventUrl, ...((s && s.altSources) || []).map((a) => a.url), ...((s && s.eventAltSources) || []).map((a) => a.url)].filter(Boolean);
		check(`${R.id} 没有第二个 raw.githubusercontent 入口（同一个 4MB 文件不发两遍）`,
			allUrls.length === 4 && allUrls.filter((u) => /raw\.githubusercontent\.com/.test(u)).length === 2
			&& allUrls.filter((u) => /sekai-world\.github\.io/.test(u)).length === 2,
			JSON.stringify(allUrls));
		check(`${R.id} 抓取器已登记（卡池 + 活动两侧都复用国服那套）`,
			typeof T.GACHA_FETCHERS[R.id] === "function" && !!(T.EVENT_FETCHERS[R.id] && typeof T.EVENT_FETCHERS[R.id].default === "function"),
			JSON.stringify([typeof T.GACHA_FETCHERS[R.id], typeof (T.EVENT_FETCHERS[R.id] || {}).default]));
		check(`${R.id} 图标是 http(s) 地址（沿用国服同款品牌图标）`,
			!!s && /^https?:\/\//.test(String(s.icon)), s && String(s.icon).slice(0, 60));
	}

	section("B1-5 ② 繁中服 / 韩服：解析（裁剪夹具逐字 —— 覆盖 now 的池 / 活动 + 源站 ms）");
	for (const R of PJSK) {
		const gRaw = fixture(R.gachaFx);
		const eRaw = fixture(R.eventFx);
		// 夹具卫生：裁剪过但形状不变（对象字段与源站逐字同构）
		check(`${R.id} 卡池夹具 3 条（前 / 当期 / 后）、活动夹具 5 条（前 2 / 当期 / 后 2）`,
			gRaw.length === 3 && eRaw.length === 5, JSON.stringify([gRaw.length, eRaw.length]));
		const gCur = gRaw.find((x) => x.id === R.curGachaId);
		const gBefore = gRaw.filter((x) => x.endAt <= PJSK_NOW);
		const gAfter = gRaw.filter((x) => x.startAt > PJSK_NOW);
		check(`${R.id} 夹具里恰好 1 条卡池覆盖 now（id=${R.curGachaId}），另有前后边界各 1 条`,
			gCur.startAt <= PJSK_NOW && gCur.endAt > PJSK_NOW && gBefore.length === 1 && gAfter.length === 1,
			JSON.stringify({ cur: gCur.id, before: gBefore.map((x) => x.id), after: gAfter.map((x) => x.id) }));
		check(`${R.id} 卡池对象字段形态与国服同源（${{ id: 0, gachaType: "", name: "", startAt: 0, endAt: 0 }}）`,
			typeof gCur.id === "number" && typeof gCur.gachaType === "string" && typeof gCur.name === "string"
			&& typeof gCur.startAt === "number" && typeof gCur.endAt === "number",
			JSON.stringify(Object.keys(gCur).slice(0, 8)));

		const G = parseSekaiGachas(gRaw, PJSK_NOW, R.tz);
		check(`${R.id} 当期池名逐字（${R.banner}）`, !!G && G.banner === R.banner, JSON.stringify(G && G.banner));
		check(`${R.id} roles 仍为空串（与国服一致，不新造）`, !!G && G.roles === "", JSON.stringify(G && G.roles));
		check(`${R.id} 档期 = ${R.bannerDates}（各服墙钟）`, !!G && G.bannerDates === R.bannerDates, JSON.stringify(G && G.bannerDates));
		check(`${R.id} startTs 与源站 startAt 逐毫秒一致`,
			!!G && G.startTs === gCur.startAt && G.startTs === R.gachaStart, JSON.stringify([G && G.startTs, gCur.startAt]));
		check(`${R.id} endTs 与源站 endAt 逐毫秒一致`,
			!!G && G.endTs === gCur.endAt && G.endTs === R.gachaEnd, JSON.stringify([G && G.endTs, gCur.endAt]));
		check(`${R.id} gacha[] 恰好 1 条（裁剪后只有 1 口池在期）且是 primary`,
			!!G && Array.isArray(G.gacha) && G.gacha.length === 1 && G.gacha[0].title === R.banner && G.gacha[0].source === "primary",
			JSON.stringify(G && G.gacha && G.gacha.map((x) => [x.title, x.source])));
		assertContract(`PJSK·${R.id}`, "gacha", G);

		const eCur = eRaw.find((x) => x.id === R.curEventId);
		const E = parseSekaiEvents(eRaw, PJSK_NOW, R.tz);
		check(`${R.id} 当期活动名逐字（${R.event}）`, !!E && E.event === R.event, JSON.stringify(E && E.event));
		check(`${R.id} 活动档期 = ${R.eventDates}（源站无 endAt：结束取 aggregateAt）`,
			!!E && E.eventDates === R.eventDates && E.eventDatesRaw === R.eventDates,
			JSON.stringify([E && E.eventDates, E && E.eventDatesRaw]));
		check(`${R.id} 活动 startTs 与源站 startAt 逐毫秒一致`,
			!!E && E.events[0].startTs === eCur.startAt && E.events[0].startTs === R.eventStart,
			JSON.stringify([E && E.events[0].startTs, eCur.startAt]));
		check(`${R.id} 结束时刻 = 源站 aggregateAt（数组侧按分钟取整，与国服口径相同）`,
			!!E && E.events[0].endTs === Math.floor(eCur.aggregateAt / 60000) * 60000,
			JSON.stringify([E && E.events[0].endTs, eCur.aggregateAt]));
		check(`${R.id} events[] 恰好 1 条（另 4 条不在期）且 category 原样 = ${eCur.eventType}`,
			!!E && E.events.length === 1 && E.events[0].title === R.event && E.events[0].category === eCur.eventType,
			JSON.stringify(E && E.events && E.events.map((x) => [x.title, x.category])));
		assertContract(`PJSK·${R.id}`, "event", E);

		// 抓取器端到端（走夹具 fetch；now 显式传夹具快照的同一时刻）
		const rG = await grab(() => gachaSekai(GH(R.repo, "gachas.json"), undefined, R.tz, PJSK_NOW));
		const rE = await grab(() => eventsSekai(GH(R.repo, "events.json"), undefined, R.tz, PJSK_NOW));
		check(`${R.id} 抓取器（卡池 + 活动）都能离线跑通`, rG.ok && rE.ok, [rG.err, rE.err].filter(Boolean).join(" | "));
		check(`${R.id} 抓取器结果与纯函数逐字一致`,
			rG.ok && rE.ok && rG.data.banner === G.banner && rE.data.event === E.event,
			JSON.stringify([rG.ok && rG.data.banner, rE.ok && rE.data.event]));
	}

	section("B1-5 ③ 繁中服 / 韩服：反证（拿掉关键字段 ⇒ 不进外显 / 抛错而不是 nomatch）");
	for (const R of PJSK) {
		const gRaw = fixture(R.gachaFx);
		// 反证 ①：把当期池的 startAt 抹掉 —— 当日唯一的在期池没了窗口 ⇒ 外显为空（不硬凑、不退化成别的池）
		const noStart = gRaw.map((x) => (x.id === R.curGachaId ? (() => { const y = { ...x }; delete y.startAt; return y; })() : x));
		check(`${R.id} 反证①：抹掉当期池 startAt ⇒ 卡池侧产出 null（不进外显）`,
			parseSekaiGachas(noStart, PJSK_NOW, R.tz) === null, JSON.stringify(parseSekaiGachas(noStart, PJSK_NOW, R.tz)));
		// 反证 ②：events.json 换成 {} ⇒ 抛错（不是"没有当期活动"的 nomatch）
		let evErr = null;
		try { parseSekaiEvents({}, PJSK_NOW, R.tz); } catch (e) { evErr = String((e && e.message) || e); }
		check(`${R.id} 反证②：events.json 换成 {} ⇒ 抛错 sekai-event-bad-shape（不是 nomatch）`,
			evErr === "sekai-event-bad-shape", JSON.stringify(evErr));
		// 反证 ③（对照）：把当期池的 endAt 抹掉 ⇒ 同样不进外显（证明上面是"窗口不全"这条判据在起作用）
		const noEnd = gRaw.map((x) => (x.id === R.curGachaId ? (() => { const y = { ...x }; delete y.endAt; return y; })() : x));
		check(`${R.id} 反证③：抹掉当期池 endAt ⇒ 卡池侧同样产出 null`,
			parseSekaiGachas(noEnd, PJSK_NOW, R.tz) === null, JSON.stringify(parseSekaiGachas(noEnd, PJSK_NOW, R.tz)));
		// 守卫自身没瞎：把 startAt 还回去就能解析出来
		check(`${R.id} 反证对照：夹具原样能解析出当期池（上面三条不是"恒空"）`,
			parseSekaiGachas(gRaw, PJSK_NOW, R.tz)?.banner === R.banner);
	}

	section("B1-5 ④ 繁中服 / 韩服：引擎整轮（4 次请求 / 同一个大文件不发两遍 / 两侧都不 fail）");
	{
		const bodies = {};
		for (const R of PJSK) {
			bodies[GH(R.repo, "gachas.json")] = readFileSync(new URL(`./fixtures/${R.gachaFx}/response.txt`, import.meta.url), "utf8");
			bodies[GH(R.repo, "events.json")] = readFileSync(new URL(`./fixtures/${R.eventFx}/response.txt`, import.meta.url), "utf8");
		}
		const seen = [];
		const transport = {
			async fetchRaw(url) {
				const u = String(url);
				seen.push(u);
				const body = bodies[u];
				if (body == null) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
				return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
			},
			async fetchViaProxy(url) { seen.push("proxy:" + String(url)); throw new Error("proxy-bad:404"); }
		};
		const store = new Map();
		const e = createEngine({
			transport,
			storage: { async get(k) { return store.get(k); }, async set(k, v) { store.set(k, v); } },
			now: () => PJSK_NOW,
			timer: { setTimeout, clearTimeout }
		});
		const r = await e.refresh();
		const mine = seen.filter((u) => /Sekai-World\/sekai-master-db-(tc|kr)-diff/.test(u)).sort();
		check("整轮只打了 4 次 sekai 的 tc/kr 请求（两个服 × 卡池/活动各 1 次）", mine.length === 4, JSON.stringify(mine));
		check("4 次请求两两不重复（4MB 级文件没有发两遍）", new Set(mine).size === 4, JSON.stringify(mine));
		for (const R of PJSK) {
			const rec = (r.games && r.games[R.id]) || {};
			check(`${R.id} 引擎记录：两侧都不 fail`, rec.gachaFail == null && rec.eventFail == null,
				JSON.stringify([rec.gachaFail, rec.eventFail]));
			check(`${R.id} 引擎记录：当期卡池逐字 = 解析器结果`,
				rec.banner === R.banner && rec.bannerDates === R.bannerDates,
				JSON.stringify([rec.banner, rec.bannerDates]));
			check(`${R.id} 引擎记录：当期活动逐字 = 解析器结果`,
				rec.event === R.event && rec.eventDates === R.eventDates,
				JSON.stringify([rec.event, rec.eventDates]));
		}
	}

	// run.mjs 会调用 summary()；直接 `node test/cases-b1.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-b1.mjs")) summary();
}

// 直接执行（node test/cases-b1.mjs）时自动跑；被 run.mjs import 时不自动跑
if (process.argv[1] && process.argv[1].endsWith("cases-b1.mjs")) await run();
