// next-sources/test/cases-p5x.mjs —— P5X 国服（Lead 参考实现）的离线用例
// 从 run.mjs 抽出，便于被 test/all.mjs 统一组合。
import { useFixtures, check, section, assertContract } from "./harness.mjs";
import { findSource } from "./registry-shim.mjs";
import { T } from "./load.mjs";
const { parseP5xList, parseP5xWindows } = T.parsers["p5x"];

export default async function run() {
	useFixtures();

	section("P5X 国服 —— 列表解析");
	{
		const t = await (await fetch("https://p5x.wanmei.com/news/gamenews/index.html")).text();
		const list = parseP5xList(t);
		check("列表解析出条目", list.length > 0, String(list.length));
		check("条目带 href/title", list.every((x) => x.href && x.title), JSON.stringify(list[0] || null));
		check("href 形如 /news/gamenews/YYYYMMDD/<id>.html",
			list.every((x) => /^\/news\/[a-z]+\/\d{8}\/\d+\.s?html$/.test(x.href)), JSON.stringify(list.map((x) => x.href).slice(0, 3)));
		check("dateKey 是 8 位日期", list.every((x) => /^\d{8}$/.test(x.dateKey)), JSON.stringify(list.map((x) => x.dateKey).slice(0, 3)));
		check("标题已去掉站点尾巴（不含「手游官网」）", list.every((x) => !/手游官网/.test(x.title)), JSON.stringify(list[0] && list[0].title));
		check("无重复 href（去重生效）", new Set(list.map((x) => x.href)).size === list.length);
	}

	section("P5X 国服 —— 档期窗口解析（含跨年 / 双年份）");
	{
		const tz = "Asia/Shanghai";
		const w = parseP5xWindows("2026年9月24日—10月22日更新前", tz);
		check("同年窗口：解析出 1 条", w.length === 1, JSON.stringify(w));
		if (w[0]) {
			check("起点 = 09-24 04:00 (UTC+8)", w[0].startTs === Date.UTC(2026, 8, 24, 4, 0) - 8 * 3600e3, String(w[0].startTs));
			check("终点 = 10-22 03:59 (UTC+8)", w[0].endTs === Date.UTC(2026, 9, 22, 3, 59) - 8 * 3600e3, String(w[0].endTs));
			check("endTs > startTs", w[0].endTs > w[0].startTs);
		}
		const cross = parseP5xWindows("2025年12月30日—1月15日", tz);
		check("跨年窗口：结束年份自动 +1",
			cross.length === 1 && new Date(cross[0].endTs).getUTCFullYear() === 2026,
			JSON.stringify(cross.map((x) => new Date(x.endTs).toISOString())));
		const withYear = parseP5xWindows("2026年10月5日—2026年10月22日更新前", tz);
		check("两端都带年份也能解", withYear.length === 1, JSON.stringify(withYear));
		check("无日期 → 空数组（不硬造）", parseP5xWindows("没有任何日期的文本", tz).length === 0);
	}

	section("P5X 国服 —— 卡池侧 / 活动侧契约");
	{
		const src = findSource("p5x");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz);
		assertContract("P5X", "gacha", g);
		check("卡池 banner 非空", !!(g && g.banner), JSON.stringify(g && g.banner));
		check("卡池 bannerDatesRaw 保留源站原文", !!(g && g.bannerDatesRaw), JSON.stringify(g && g.bannerDatesRaw));
		const e = await src.event.fetcher(src.event.url, undefined, src.tz);
		assertContract("P5X", "event", e);
		check("活动 eventHover 是多行（逐行列出当期窗口）",
			typeof e.eventHover === "string" && e.eventHover.includes("\n"), JSON.stringify((e.eventHover || "").slice(0, 80)));
		check("两侧共用同一份 gamenews（P5X 无独立卡池栏目）", src.gacha.url === src.event.url);
		check("P5X 声明 mode=proxy（wanmei 实测无 ACAO）",
			src.gacha.mode === "proxy" && src.event.mode === "proxy");
	}

	section("P5X 国服 —— 「不覆盖当前时刻则返回 null」语义");
	{
		// 夹具是 2026-09-24 起的档期。用一个**远早于它**的时刻跑不出覆盖 → 应得 null。
		// 用 Date 打桩太侵入；这里直接验 parseP5xWindows + 覆盖判定逻辑本身：
		const tz = "Asia/Shanghai";
		const wins = parseP5xWindows("2020年1月1日—2020年2月1日", tz);
		check("解析出过期窗口", wins.length === 1);
		const now = Date.now();
		check("过期窗口不覆盖当前时刻（→ 抓取器会返回 null，而不是显示旧档期）",
			!(wins[0].startTs <= now && wins[0].endTs >= now));
	}
}
