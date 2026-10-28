// test/cases-ics.mjs —— 排期导出 .ics（待办第 5 项）
//
// 需求原文（README_Dev.md 第 5 项）：
//   把当期窗口导出成一次性快照（可导入手机日历）。⚠️ 只能是**快照**、不能是订阅。
//
// 本段只钉**能被机器判定**的部分：
//   ① `icsOf` 的确定性（同输入逐字节相同）+ VCALENDAR 骨架 + 空事件列表仍是合法文件；
//   ② 行结束符一律 CRLF（RFC 5545 硬性要求；`\n` 会让部分日历直接不认）；
//   ③ 折行按 **UTF-8 octets**（75）而不是字符数 —— 中文一行 25 个字就是 75 字节，
//      且折点必须在**码点边界**（代理对不许拆半）；
//   ④ 文本转义（`,` `;` `\` 换行）；
//   ⑤ 时间：源站墙钟 + 源站 tz → 绝对时刻 → `YYYYMMDDTHHMMSSZ`（UTC，与运行机器时区无关）。
//      ⚠️ 本文件里所有**绝对时刻**断言都写成 TZ-independent 的形式（显式给 tz，或用
//      sourceInstant 自己当参照），这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁读数一致；
//   ⑥ `icsEventsOf` 的"在期"判定：已结束 / 还没开始 / 没档期 / 本轮 skipped 一律不导出，
//      UID 稳定且唯一（重复导入不产生重复事件）；
//   ⑦ 静态接线：设置页那一组已有按钮里多了一个「导出 .ics」、下载走 Blob + a[download]、
//      **没有新增宿主路由**、纯函数在 core 段里（core 产物可单独 import）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

const {
	icsOf, icsEventsOf, icsWindowOf, icsUtcStamp, icsUtcHuman,
	icsEscapeText, icsFoldLine, icsFileNameOf,
	sourceInstant
} = T;

const readSrc = (rel) => readFileSync(path.join(REPO, rel), "utf8");
const stripLineComments = (s) => s.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const octets = (s) => Buffer.byteLength(String(s), "utf8");
const physLines = (s) => String(s).split("\r\n").filter(Boolean);
// 物理行 → **逻辑行**（把以空格开头的续行接回上一行；RFC 5545 的折行还原）
const logicalLines = (s) => {
	const out = [];
	for (const line of physLines(s)) {
		if (line.startsWith(" ") && out.length) out[out.length - 1] += line.slice(1);
		else out.push(line);
	}
	return out;
};
const unfold = (s) => logicalLines(s).join("");

// 固定时刻：2026-10-28 04:40Z（= 12:40 +08）。离年终还远 ⇒ 补年份的算法在两道时区门禁下同年。
const NOW = Date.UTC(2026, 9, 28, 4, 40);
const HOUR = 3600000;
// 源站墙钟文本（中国服/日服都是整点开池、xx:59 关池）
const GACHA_DATES = "10-21 11:00 ~ 11-04 10:59";
const EVENT_DATES = "10-24 11:00 ~ 11-03 03:59";
// 期望的绝对时刻（Asia/Shanghai = UTC+8）
const SHEXP = {
	gacha: [Date.UTC(2026, 9, 21, 3, 0), Date.UTC(2026, 10, 4, 2, 59)],
	event: [Date.UTC(2026, 9, 24, 3, 0), Date.UTC(2026, 10, 2, 19, 59)]
};

// 与面板同形的两条条目 + lastData 里那一轮的抓取结果
const ENTRIES = [
	{
		id: "ba-cn", name: "蔚蓝档案·国服", tz: "Asia/Shanghai",
		source: "蔚蓝档案国服公告", eventSource: "蔚蓝档案国服公告",
		banner: "", roles: "", bannerDates: "", event: "", eventDates: ""
	},
	{ id: "g2", name: "游戏乙", tz: "Asia/Shanghai", source: "乙官方" },
	{ id: "g3", name: "游戏丙", tz: "Asia/Shanghai", source: "丙官方" },
	{ id: "g4", name: "游戏丁", tz: "Asia/Shanghai", source: "丁官方" },
	{ id: "g5", name: "游戏戊", tz: "Asia/Shanghai", source: "戊官方" },
	{ id: "g6", name: "游戏己" }   // 自定义条目：没声明 tz
];
const SCRAPED = {
	"ba-cn": {
		banner: "限时招募【Say-Bing!】", roles: "阿露、白子",
		bannerDates: GACHA_DATES,
		event: "限时活动：Say-Bing!", eventDates: EVENT_DATES
	},
	// 已结束（卡池）+ 还没开始（活动）
	"g2": { banner: "池乙", bannerDates: "10-01 11:00 ~ 10-10 10:59", event: "活动乙", eventDates: "11-05 11:00 ~ 11-10 10:59" },
	// 没有档期文本 / 没有事项名
	"g3": { banner: "池丙", bannerDates: "", event: "", eventDates: "10-24 11:00 ~ 11-03 03:59" },
	// 本轮整条没抓（两侧都没配来源）
	"g4": { skipped: true, reason: "skipped" },
	// 档期原文不是「起 ~ 止」形态
	"g5": { banner: "池戊", bannerDates: "版本更新后 ~ 10-21 11:59" },
	// 自定义条目：没 tz ⇒ 沿用本机时区（断言用 sourceInstant 当参照，不写死绝对时刻）
	"g6": { banner: "自定池", bannerDates: "10-21 11:00 ~ 11-04 10:59" }
};

export default function runIcs() {
	section("排期导出 .ics（快照 / CRLF / 75 octets 折行 / 转义 / 在期判定）");

	// ── ① 确定性与骨架 ───────────────────────────────────────────────────────
	{
		const a = icsOf([], NOW, { calName: "二游日历" });
		const b = icsOf([], NOW, { calName: "二游日历" });
		check("icsOf 存在（60-helpers.js 的纯函数）", typeof icsOf === "function");
		check("同样的输入**逐字节**相同（确定性：不读时钟、不读时区、不随机）", a === b);
		check("空事件列表仍然产出合法骨架：BEGIN/END:VCALENDAR + VERSION 2.0 + PRODID + CALSCALE",
			a.startsWith("BEGIN:VCALENDAR\r\n") && a.endsWith("END:VCALENDAR\r\n")
			&& a.includes("\r\nVERSION:2.0\r\n") && a.includes("\r\nPRODID:")
			&& a.includes("\r\nCALSCALE:GREGORIAN\r\n"), JSON.stringify(a));
		check("空事件列表里没有 VEVENT", !a.includes("BEGIN:VEVENT"));
		check("没有 UTF-8 BOM（BOM 会让部分日历解析失败）", a.charCodeAt(0) !== 0xfeff);
		// 坏条目（缺时间 / 时间非法）不许产出半截 VEVENT
		const dirty = icsOf([
			{ summary: "缺时间", startTs: 0 },
			{ summary: "非法", startTs: NaN, endTs: NaN },
			{ summary: "正常", startTs: NOW - HOUR, endTs: NOW + HOUR }
		], NOW);
		check("坏条目被整条跳过（不产出半截 VEVENT / 不抛）",
			(dirty.match(/BEGIN:VEVENT/g) || []).length === 1
			&& (dirty.match(/END:VEVENT/g) || []).length === 1
			&& dirty.includes("SUMMARY:正常"), dirty.replace(/\r\n/g, " | "));
	}

	// ── ② CRLF：行结束符只能是一个 \r\n ───────────────────────────────────────
	{
		const { events } = icsEventsOf(ENTRIES, SCRAPED, NOW);
		const text = icsOf(events, NOW);
		check("有真实事件可断言（守卫自身没瞎）", events.length >= 3, String(events.length));
		check("除了 \\r\\n 之外没有任何裸换行（`\\n` 会被部分日历判成非法）",
			!/[^\r]\n/.test(text) && !/\r[^\n]/.test(text) && !text.includes("\r\r"));
		check("文件以 CRLF 结尾（最后一行 END:VCALENDAR 也带 CRLF）",
			text.endsWith("END:VCALENDAR\r\n"));
		check("每一条 VEVENT 的起止成对出现（BEGIN/END 数量相等）",
			(text.match(/BEGIN:VEVENT\r\n/g) || []).length === (text.match(/END:VEVENT\r\n/g) || []).length
			&& (text.match(/BEGIN:VEVENT\r\n/g) || []).length === events.length);
	}

	// ── ③ 折行：按 UTF-8 octets（中文 3 字节/字），折点必须在码点边界 ──────────
	{
		const han = "汉".repeat(40);                       // 120 字节
		const line = "SUMMARY:" + han;
		const folded = icsFoldLine(line);
		const segs = folded.split("\r\n");
		check("长中文行确实折了（>1 条物理行）", segs.length > 1, String(segs.length));
		check("每条物理行 ≤ 75 octets（含续行开头的那个空格）",
			segs.every((s) => octets(s) <= 75), segs.map((s) => octets(s)).join(","));
		check("首行按 octets 折到极限（74 ≤ 首行 ≤ 75 —— 不是按字符数 75 折）",
			octets(segs[0]) >= 74 && octets(segs[0]) <= 75, String(octets(segs[0])));
		check("折行不丢字节、不插字节：展开后与原始逻辑行逐字相同",
			unfold(folded) === line, JSON.stringify(unfold(folded).slice(0, 20)));
		check("续行都以**恰好一个**空格开头（RFC 5545 的折行标记）",
			segs.slice(1).every((s) => s.startsWith(" ") && !s.startsWith("  ")));
		check("中文按 3 字节算（40 个汉字 + 8 字节属性名 = 128 字节 ⇒ 至少 2 折）",
			segs.length >= 2 && octets(han) === 120, String(octets(han)));
		// 4 字节码点（emoji）不许被拆成两个半个代理对
		const emoji = "🎉".repeat(30);
		const f2 = icsFoldLine("SUMMARY:" + emoji);
		const segs2 = f2.split("\r\n");
		check("emoji（4 字节）折行后不出现替换字符 / 半个代理对",
			segs2.every((s) => !s.includes("\uFFFD") && !/[\uD800-\uDBFF]$/.test(s)),
			segs2.map((s) => octets(s)).join(","));
		check("emoji 行展开后与原始行相同", unfold(f2) === "SUMMARY:" + emoji);
		check("短行不折（不无脑加空格）", icsFoldLine("VERSION:2.0") === "VERSION:2.0");
		// 整个文件逐行校验
		const text = icsOf(icsEventsOf(ENTRIES, SCRAPED, NOW).events, NOW);
		const tooLong = physLines(text).filter((s) => octets(s) > 75);
		check("整份 .ics 的每条物理行都 ≤ 75 octets", tooLong.length === 0, tooLong.slice(0, 2).join(" | "));
	}

	// ── ④ 文本转义：`\` `;` `,` 换行 ──────────────────────────────────────────
	{
		check("反斜杠先转：`a\\b` ⇒ `a\\\\b`", icsEscapeText("a\\b") === "a\\\\b", icsEscapeText("a\\b"));
		check("分号转义：`a;b` ⇒ `a\\;b`", icsEscapeText("a;b") === "a\\;b", icsEscapeText("a;b"));
		check("逗号转义：`a,b` ⇒ `a\\,b`", icsEscapeText("a,b") === "a\\,b", icsEscapeText("a,b"));
		check("换行转成字面量 `\\n`（CRLF / LF / CR 三种都算）",
			icsEscapeText("a\nb") === "a\\nb" && icsEscapeText("a\r\nb") === "a\\nb" && icsEscapeText("a\rb") === "a\\nb");
		check("四种一起：`a,b;c\\d` + 换行 + `e` 逐字符合 RFC（顺序不能错：反斜杠必须第一个换）",
			icsEscapeText("a,b;c\\d\ne") === "a\\,b\\;c\\\\d\\ne", icsEscapeText("a,b;c\\d\ne"));
		check("null / undefined / 数字安全（空串 / 字符串化，不抛）",
			icsEscapeText(null) === "" && icsEscapeText(void 0) === "" && icsEscapeText(12) === "12");
		const ev = {
			uid: "x:gacha:1-2@test", summary: "游戏名 · 池,名;副\\本",
			startTs: NOW - HOUR, endTs: NOW + HOUR,
			description: "第一行\n第二行"
		};
		const text = icsOf([ev], NOW);
		const logical = physLines(text).filter(Boolean);
		check("SUMMARY 里的 `,` `;` `\\` 都被转义（正文里不出现裸的控制字符）",
			logical.some((l) => l.indexOf("SUMMARY:游戏名 · 池\\,名\\;副\\\\本") === 0),
			logical.filter((l) => l.startsWith("SUMMARY:")).join(" | "));
		check("DESCRIPTION 里的换行变成字面量 `\\n`（没有真的多出一个换行 = 没有多出一条属性）",
			logical.some((l) => l.indexOf("DESCRIPTION:第一行\\n第二行") === 0),
			logical.filter((l) => l.startsWith("DESCRIPTION:")).join(" | "));
	}

	// ── ⑤ 时间：源站墙钟 + tz → UTC（`YYYYMMDDTHHMMSSZ`）──────────────────────
	{
		check("icsUtcStamp：0 ⇒ 19700101T000000Z", icsUtcStamp(0) === "19700101T000000Z", icsUtcStamp(0));
		check("icsUtcStamp：2026-10-21T03:00Z ⇒ 20261021T030000Z（全 UTC 字段，`Z` 结尾）",
			icsUtcStamp(Date.UTC(2026, 9, 21, 3, 0)) === "20261021T030000Z", icsUtcStamp(Date.UTC(2026, 9, 21, 3, 0)));
		check("icsUtcStamp：坏值 ⇒ 空串（调用方据此跳过该条，不产出 1970 的假事件）",
			icsUtcStamp(NaN) === "" && icsUtcStamp("abc") === "" && icsUtcStamp(void 0) === "");
		check("icsUtcHuman：同一时刻给一句 UTC 人话（DESCRIPTION 的生成时间用）",
			icsUtcHuman(Date.UTC(2026, 9, 28, 4, 40)) === "2026-10-28 04:40 UTC",
			icsUtcHuman(Date.UTC(2026, 9, 28, 4, 40)));

		// 源站墙钟（Asia/Shanghai）+ tz ⇒ 正确的绝对时刻（与跑测机器时区无关）
		const w = icsWindowOf(GACHA_DATES, "Asia/Shanghai", NOW);
		check("icsWindowOf：源站墙钟 + Asia/Shanghai ⇒ 绝对窗口（11:00 +08 = 03:00Z）",
			!!w && w.startTs === SHEXP.gacha[0] && w.endTs === SHEXP.gacha[1],
			w ? icsUtcStamp(w.startTs) + " ~ " + icsUtcStamp(w.endTs) : "null");
		const wu = icsWindowOf(GACHA_DATES, "UTC", NOW);
		check("同一串文本 + tz=UTC ⇒ 不偏移（11:00Z）",
			!!wu && wu.startTs === Date.UTC(2026, 9, 21, 11, 0), wu ? icsUtcStamp(wu.startTs) : "null");
		const wj = icsWindowOf(GACHA_DATES, "Asia/Tokyo", NOW);
		check("同一串文本 + Asia/Tokyo ⇒ 11:00 +09 = 02:00Z（时区真的在起作用）",
			!!wj && wj.startTs === Date.UTC(2026, 9, 21, 2, 0), wj ? icsUtcStamp(wj.startTs) : "null");

		// 与面板外显/倒计时**同一条链**（localDatesOf → parseDisplayRange）算出的结果必须一致
		const panel = T.dueWindowOf({ bannerDates: GACHA_DATES, tz: "Asia/Shanghai" }, true, new Date(NOW));
		check("与面板那条链（dueWindowOf）算出的绝对窗口**逐毫秒相同**（导出与面板不同源就会差一小时）",
			!!panel && !!w && panel.startTs === w.startTs && panel.endTs === w.endTs,
			panel ? icsUtcStamp(panel.startTs) + " vs " + icsUtcStamp(w.startTs) : "null");

		// 跨年：源站原文自带 4 位年份（`fmtWindow` 的跨年形态）⇒ 照原文，不猜
		const wy = icsWindowOf("2026-12-30 11:00 ~ 2027-01-05 10:59", "Asia/Shanghai", NOW);
		check("跨年原文（两端带年份）也能读：2026-12-30 11:00 +08 ~ 2027-01-05 10:59 +08",
			!!wy && wy.startTs === Date.UTC(2026, 11, 30, 3, 0) && wy.endTs === Date.UTC(2027, 0, 5, 2, 59),
			wy ? icsUtcStamp(wy.startTs) + " ~ " + icsUtcStamp(wy.endTs) : "null");
		// 跨年：两端都没年份（12 月底 ~ 1 月初）⇒ 结束端补一年（12-30 11:00 +08 ~ 次年 01-05 10:59 +08）
		const wn = icsWindowOf("12-30 11:00 ~ 01-05 10:59", "Asia/Shanghai", NOW);
		check("跨年原文（两端都没年份）⇒ 结束端补到下一年",
			!!wn && wn.startTs === Date.UTC(2026, 11, 30, 3, 0) && wn.endTs === Date.UTC(2027, 0, 5, 2, 59),
			wn ? icsUtcStamp(wn.startTs) + " ~ " + icsUtcStamp(wn.endTs) : "null");

		// 没声明 tz（自定义条目）⇒ 沿用本机时区（与 sourceInstant 同口径），不写死绝对时刻
		const local = icsWindowOf(GACHA_DATES, null, NOW);
		check("没声明 tz ⇒ 沿用本机时区（= sourceInstant 的 null 分支，不是另一套猜法）",
			!!local && local.startTs === sourceInstant(2026, 10, 21, 11, 0, null),
			local ? icsUtcStamp(local.startTs) : "null");
		// 读不出的档期一律 null（绝不给一个猜的时刻）
		check("「版本更新后 ~ 10-21 11:59」⇒ null（缺起点不猜）",
			icsWindowOf("版本更新后 ~ 10-21 11:59", "Asia/Shanghai", NOW) === null);
		check("「长期」⇒ null；只有一端 ⇒ null；空串 ⇒ null",
			icsWindowOf("长期", "Asia/Shanghai", NOW) === null
			&& icsWindowOf("10-21 11:00", "Asia/Shanghai", NOW) === null
			&& icsWindowOf("", "Asia/Shanghai", NOW) === null);
		check("月份/日期越界 ⇒ null（13-40 这种不是档期）",
			icsWindowOf("13-40 11:00 ~ 14-50 10:59", "Asia/Shanghai", NOW) === null);

		// 导出的文本里 DTSTART/DTEND 一律是 UTC 硬值（不在跑测机器时区上打转）
		const { events } = icsEventsOf(ENTRIES, SCRAPED, NOW);
		const text = icsOf(events, NOW);
		const starts = physLines(text).filter((l) => l.startsWith("DTSTART:")).map((l) => l.slice(8));
		const ends = physLines(text).filter((l) => l.startsWith("DTEND:")).map((l) => l.slice(6));
		check("每条 DTSTART/DTEND 都是 `YYYYMMDDTHHMMSSZ`（UTC，Z 结尾）",
			starts.length === events.length && starts.every((s) => /^\d{8}T\d{6}Z$/.test(s))
			&& ends.length === events.length && ends.every((s) => /^\d{8}T\d{6}Z$/.test(s)),
			starts.join(","));
		check("卡池的起止 = 源站墙钟换算后的 UTC 硬值（20261021T030000Z ~ 20261104T025900Z）",
			starts.includes("20261021T030000Z") && ends.includes("20261104T025900Z"));
		check("活动的起止同样换算（20261024T030000Z ~ 20261102T195900Z）",
			starts.includes("20261024T030000Z") && ends.includes("20261102T195900Z"));
		check("DTSTAMP = 生成时刻（同一份文件里所有 VEVENT 相同）",
			text.split("\r\n").filter((l) => l.startsWith("DTSTAMP:")).every((l) => l === "DTSTAMP:20261028T044000Z"));
	}

	// ── ⑥ 在期判定 + 跳过原因 + UID 稳定唯一 ──────────────────────────────────
	{
		const r = icsEventsOf(ENTRIES, SCRAPED, NOW);
		const byKey = (arr) => arr.map((x) => x.gameId + ":" + (x.side || "-") + ":" + x.reason).sort().join(",");
		check("只有**覆盖当前时刻**的两侧进事件清单（ba-cn 卡池 + ba-cn 活动 + g6 卡池）",
			r.events.map((e) => e.gameId + ":" + e.side).sort().join(",") === "ba-cn:event,ba-cn:gacha,g6:gacha",
			r.events.map((e) => e.gameId + ":" + e.side).join(","));
		check("已结束 / 还没开始 / 没档期 / 没标题 / 原文读不出 全部进 skipped（且原因分得清）",
			byKey(r.skipped) === [
				"g2:event:not-started", "g2:gacha:ended",
				"g3:event:no-title", "g3:gacha:no-dates",
				"g4:-:skipped",
				"g5:event:no-title", "g5:gacha:bad-window",
				"g6:event:no-title"
			].sort().join(","), byKey(r.skipped));
		check("`skipped` 条目（本轮没抓）**整条**跳过，两侧都不产出；原因单独记成 skipped（不伪装成「已结束」）",
			r.skipped.filter((s) => s.gameId === "g4").length === 1
			&& r.skipped.find((s) => s.gameId === "g4").reason === "skipped"
			&& r.skipped.find((s) => s.gameId === "g4").side === ""
			&& !r.events.some((e) => e.gameId === "g4"));
		check("已结束的条目**不出现在文本里**（用户要求）",
			!icsOf(r.events, NOW).includes("池乙"));
		check("SUMMARY = 游戏名 + 「 · 」 + 事项名；卡池侧用**角色名**（与面板/轮播同口径）",
			r.events.some((e) => e.summary === "蔚蓝档案·国服 · 阿露、白子")
			&& r.events.some((e) => e.summary === "蔚蓝档案·国服 · 限时活动：Say-Bing!"),
			r.events.map((e) => e.summary).join(" | "));
		check("卡池没有角色名时退回卡池名（g6 只剩 banner）",
			r.events.some((e) => e.summary === "游戏己 · 自定池"));
		check("UID 稳定：`条目id:侧:起-止@域`，同一份数据重复导出逐字相同",
			r.events.every((e) => e.uid === e.gameId + ":" + e.side + ":" + e.startTs + "-" + e.endTs + "@gacha-calendar"),
			r.events.map((e) => e.uid).join(" | "));
		check("UID 唯一（同一份文件里不会出现两条一样的 UID ⇒ 导入不会互相覆盖）",
			new Set(r.events.map((e) => e.uid)).size === r.events.length);
		// 同一份数据在两个「现在」下导出 ⇒ UID 不变（时间戳来自档期，不来自 now）
		const r2 = icsEventsOf(ENTRIES, SCRAPED, NOW + HOUR);
		check("UID 与生成时刻无关（NOW 与 NOW+1h 得到同一组 UID）",
			r2.events.map((e) => e.uid).join(",") === r.events.map((e) => e.uid).join(","));
		// 确定性：同一输入两次调用逐字节相同
		check("icsEventsOf 也是确定性的（两次调用逐字节相同）",
			JSON.stringify(icsEventsOf(ENTRIES, SCRAPED, NOW)) === JSON.stringify(r));
		check("坏输入不炸：entries / scraped 传 null ⇒ 空清单",
			icsEventsOf(null, null, NOW).events.length === 0 && icsEventsOf(null, null, NOW).skipped.length === 0);
		check("entries 里有坏条目（null / 非对象）时跳过、不影响其它条目",
			icsEventsOf([null, 5, ENTRIES[0]], SCRAPED, NOW).events.length === 2);
		// DESCRIPTION = 一句来源说明（来源站名 + 侧 + 生成时间），不带悬停长文
		const text = icsOf(r.events, NOW);
		// ⚠️ 用**逻辑行**（先把续行接回去）：这句中文本身就 >75 octets，一定会被折行
		const logical = logicalLines(text);
		const descs = logical.filter((l) => l.startsWith("DESCRIPTION:"));
		check("DESCRIPTION 是「来源：<站名> · <卡池/活动> · 导出 <UTC 时间>」一句",
			descs.includes("DESCRIPTION:来源：蔚蓝档案国服公告 · 卡池 · 导出 2026-10-28 04:40 UTC")
			&& descs.includes("DESCRIPTION:来源：蔚蓝档案国服公告 · 活动 · 导出 2026-10-28 04:40 UTC"),
			descs.join(" | "));
		check("DESCRIPTION 里没有源站档期原文那种长悬停文案（不超过一句）",
			descs.every((d) => d.length <= 80 && !d.includes("~")), descs.join(" | "));
		check("没写 source 的条目回落一句通用来源，不留空",
			icsOf([{ summary: "x · y", startTs: NOW - 1, endTs: NOW + 1 }], NOW).includes("DESCRIPTION:来源：各游戏官方/维基来源"));
		// 自定义日历名走 X-WR-CALNAME（导入后日历列表里显示中文名）
		check("X-WR-CALNAME 用 opts.calName（默认「二游日历」）",
			icsOf([], NOW).includes("\r\nX-WR-CALNAME:二游日历\r\n")
			&& icsOf([], NOW, { calName: "测试名" }).includes("\r\nX-WR-CALNAME:测试名\r\n"));
	}

	// ── ⑦ 文件名：带日期（**本机**日历日 —— 与面板上"今天"同一口径）─────────────────
	{
		// ⚠️ 2026-10-28 修（"只在某些时区红"）：原来期望写死 `二游日历-2026-10-28.ics`，
		// 理由是"2026-10-28 04:40Z 在 +08 也是 10-28" —— 只有 UTC~+08 那段时区成立。
		// TZ=America/Los_Angeles 下同一个时刻是本地 10-27 21:40，产品按本机日历日给出
		// `二游日历-2026-10-27.ics`（这是**对的**：用户看到的就是 10-27），红的是期望值。
		// 所以期望也从同一个 Date 现算本机日历日，不在期望里写死某个时区的日期。
		const d = new Date(NOW);
		const localDay = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
		check("icsFileNameOf：`二游日历-<本机日历日>.ics`（年月日 = 那一时刻在**本机时区**的日历日）",
			icsFileNameOf(NOW) === "二游日历-" + localDay + ".ics",
			icsFileNameOf(NOW) + " / 本机日历日 " + localDay);
		check("坏值 ⇒ 不带日期的兜底文件名（不产出 `-NaN-NaN-NaN`）",
			icsFileNameOf(NaN) === "二游日历.ics", icsFileNameOf(NaN));
	}

	// ── ⑧ 静态接线：设置页按钮 + Blob 下载 + **没有新路由** + core 里也有这段 ──
	{
		const comp = readSrc(path.join("src", "client", "80-components.js"));
		const helpers = readSrc(path.join("src", "client", "60-helpers.js"));
		const host = readSrc(path.join("src", "index.js"));
		const core = readSrc(path.join("packages", "core", "core.mjs"));
		const codes = stripLineComments(comp);

		check("设置页有「导出 .ics」按钮（文案就是用户点名的四个字）",
			comp.includes('children: "导出 .ics"'));
		check("按钮的 onClick 走 exportIcs，处理函数真在组件里",
			comp.includes("onClick: exportIcs") && comp.includes("const exportIcs = () => {"));
		// 塞进**已有**按钮组（与「重置排序」「恢复条目」同一个 flex 组），不新起一行
		const groupAt = comp.indexOf('(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [');
		const groupEnd = groupAt >= 0 ? comp.indexOf("] })", groupAt) : -1;
		const group = groupAt >= 0 && groupEnd > groupAt ? comp.slice(groupAt, groupEnd) : "";
		check("导出按钮在**已有**按钮组里（同一组还有「重置排序」「恢复条目」）",
			group.includes("导出 .ics") && group.includes("重置排序") && group.includes("恢复条目"),
			group.slice(0, 120).replace(/\n/g, " "));
		check("没有为导出新起一行 / 新起一个卡片（全文件只有这一个 flex gap 6 按钮组）",
			(comp.match(/style: \{ display: "flex", gap: 6 \}/g) || []).length === 1);
		check("数据源与面板同一条链：展示中条目 + 用户排序 + lastData 那一轮",
			comp.includes("icsEventsOf(applyOrder(getVisibleEntries(s), s.order), scraped, now)")
			&& comp.includes("parseJsonStr(s.lastData, {})"));
		check("格式全交给纯函数：导出时调 icsOf(events, now.getTime(), …)，渲染层不拼 iCalendar",
			comp.includes("icsOf(result.events, now.getTime(),") && !comp.includes("BEGIN:VEVENT"));
		// 下载：Blob + a[download]，不新增宿主路由
		check("下载走浏览器侧 Blob + a[download]（不新增宿主路由）",
			comp.includes("function downloadTextFile(") && comp.includes("new Blob([text]")
			&& comp.includes("URL.createObjectURL(blob)") && comp.includes("a.download = fileName")
			&& comp.includes("a.click()"));
		check("下载用的 MIME 是 text/calendar（不是 text/plain，手机才认）",
			comp.includes('downloadTextFile(icsFileNameOf(now), text, "text/calendar")'));
		check("导出**不**发网络请求：处理函数里没有 fetch / 新接口路径",
			!/\/api\/[a-z-]*ics/.test(codes)
			&& !/function downloadTextFile[\s\S]{0,600}?fetch\(/.test(codes));
		check("宿主没有任何 `.ics` 路由（webServer.register 仍是 4 条：proxy / snapshot / 通知身份 / 测试通知）",
			(host.match(/webServer\.register\(/g) || []).length === 4 && !/\.ics\b/.test(host),
			String((host.match(/webServer\.register\(/g) || []).length));
		check("导出结果有一行小字（已导出 N 条 / 跳过 M 条），不弹窗、不落盘",
			comp.includes('setIcsNote(') && !codes.includes('commit("ics') && !codes.includes('commit("icsNote'));
		// 纯函数在 core 段：core 产物里能直接找到（且不碰宿主 API —— build 的纯净度守卫也守这条）
		check("core 产物里有 icsOf / icsEventsOf / icsWindowOf（60-helpers.js 属 core 共用段）",
			core.includes("function icsOf(") && core.includes("function icsEventsOf(")
			&& core.includes("function icsWindowOf("));
		const region = helpers.slice(helpers.indexOf("//#region 排期导出 .ics"), helpers.indexOf("//#endregion", helpers.indexOf("//#region 排期导出 .ics")));
		check("纯函数那段不碰宿主（没有 document / window / fetch / localStorage）",
			region.length > 2000 && !/document|window\.|fetch\(|localStorage/.test(region),
			String(region.length));
		check("CRLF 是源码里写死的 `\\r\\n`（不是 `\\n`）",
			helpers.includes('join("\\r\\n") + "\\r\\n"'));
	}
}
