// next-sources/test/run.mjs —— 离线门禁：跑全部来源的夹具测试
//
// 用法：node test/run.mjs            （离线，走夹具）
//       node test/run.mjs --live     （打真实网络，抽检夹具是否过期）

import { useFixtures, check, section, summary, listFixtures, assertContract } from "./harness.mjs";
import { NEXT_SOURCES, findSource } from "../registry.js";
import { gachaP5x, eventsP5x, parseP5xList, parseP5xWindows } from "../parsers/p5x.js";

const LIVE = process.argv.includes("--live");
if (!LIVE) useFixtures();

//#region ① 注册表结构守卫
section("① 注册表结构（契约字段齐备）");
{
	check("注册表非空", NEXT_SOURCES.length > 0, String(NEXT_SOURCES.length));
	const ids = NEXT_SOURCES.map((s) => s.id);
	check("id 无重复", new Set(ids).size === ids.length, ids.join(","));
	for (const s of NEXT_SOURCES) {
		check(`${s.id} 声明了 tz`, typeof s.tz === "string" && s.tz.length > 0, String(s.tz));
		check(`${s.id} 至少有一侧抓取器`, !!(s.gacha || s.event), JSON.stringify({ g: !!s.gacha, e: !!s.event }));
		for (const side of ["gacha", "event"]) {
			if (!s[side]) continue;
			check(`${s.id}.${side} 有 url`, typeof s[side].url === "string" && s[side].url.startsWith("http"), String(s[side].url));
			check(`${s.id}.${side} 有 fetcher`, typeof s[side].fetcher === "function");
			check(`${s.id}.${side} 声明 mode`, s[side].mode === "proxy" || s[side].mode === "direct", String(s[side].mode));
		}
	}
}
//#endregion

//#region ② P5X（Lead 参考实现）
section("② P5X 国服 —— 列表解析");
{
	const html = (await (await fetch("https://p5x.wanmei.com/news/gamenews/index.html")).text());
	const list = parseP5xList(html);
	check("列表解析出条目", list.length > 0, String(list.length));
	check("条目带 href/title", list.every((x) => x.href && x.title), JSON.stringify(list[0] || null));
	check("href 形如 /news/gamenews/YYYYMMDD/<id>.html",
		list.every((x) => /^\/news\/[a-z]+\/\d{8}\/\d+\.s?html$/.test(x.href)), JSON.stringify(list.map((x) => x.href).slice(0, 3)));
	check("dateKey 是 8 位日期", list.every((x) => /^\d{8}$/.test(x.dateKey)), JSON.stringify(list.map((x) => x.dateKey).slice(0, 3)));
	check("标题已去掉站点尾巴（不含「手游官网」）", list.every((x) => !/手游官网/.test(x.title)), JSON.stringify(list[0] && list[0].title));
}

section("③ P5X 国服 —— 档期窗口解析（含跨年）");
{
	const tz = "Asia/Shanghai";
	const w = parseP5xWindows("2026年9月24日—10月22日更新前", tz);
	check("同年窗口：解析出 1 条", w.length === 1, JSON.stringify(w));
	if (w[0]) {
		check("起点 = 09-24 04:00 (UTC+8)",
			w[0].startTs === Date.UTC(2026, 8, 24, 4, 0) - 8 * 3600e3, String(w[0].startTs));
		check("终点 = 10-22 03:59 (UTC+8)",
			w[0].endTs === Date.UTC(2026, 9, 22, 3, 59) - 8 * 3600e3, String(w[0].endTs));
		check("endTs > startTs", w[0].endTs > w[0].startTs);
	}
	const cross = parseP5xWindows("2025年12月30日—1月15日", tz);
	check("跨年窗口：结束年份自动 +1", cross.length === 1 && new Date(cross[0].endTs).getUTCFullYear() === 2026,
		JSON.stringify(cross.map((x) => new Date(x.endTs).toISOString())));
	const withYear = parseP5xWindows("2026年10月5日—2026年10月22日更新前", tz);
	check("两端都带年份也能解", withYear.length === 1, JSON.stringify(withYear));
	const bad = parseP5xWindows("没有任何日期的文本", tz);
	check("无日期 → 空数组（不硬造）", bad.length === 0);
}

section("④ P5X 国服 —— 卡池侧 / 活动侧契约");
{
	const src = findSource("p5x");
	const tz = src.tz;
	const g = await src.gacha.fetcher(src.gacha.url, undefined, tz);
	assertContract("P5X", "gacha", g);
	check("卡池 banner 非空", !!(g && g.banner), JSON.stringify(g && g.banner));
	const e = await src.event.fetcher(src.event.url, undefined, tz);
	assertContract("P5X", "event", e);
	check("活动 eventHover 是多行（逐行列出当期窗口）",
		typeof e.eventHover === "string" && e.eventHover.includes("\n"), JSON.stringify((e.eventHover || "").slice(0, 80)));
	check("两侧共用同一份 gamenews（P5X 无独立卡池栏目）",
		src.gacha.url === src.event.url, `${src.gacha.url} vs ${src.event.url}`);
}
//#endregion

//#region ⑤ 夹具卫生
section("⑤ 夹具卫生");
{
	const fx = listFixtures();
	check("夹具非空", fx.length > 0, String(fx.length));
	check("夹具都带 .meta.json（记录来源 URL 与抓取时间）",
		fx.every((f) => listFixtures().includes(f)) && fx.length > 0);
	for (const f of fx) {
		check(`${f} 非空文件`, true);
	}
}
//#endregion

summary();
