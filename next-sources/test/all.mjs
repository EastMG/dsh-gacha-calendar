// next-sources/test/all.mjs —— 统一门禁：聚合注册表守卫 + 全部批次的离线用例
//
// 用法：node test/all.mjs          （离线跑夹具，**这是门禁**）
//       node test/all.mjs --live   （打真实网络抽检夹具是否过期，**不作为门禁**）
//
// 为什么单独一个入口而不是把各批塞进 run.mjs：
//   各批用例都会 `useFixtures()`（把全局 fetch 换成夹具实现），串在一个进程里跑最省事、
//   也避免"谁先 import 谁就定了 fetch 实现"的隐式耦合。run.mjs 保留为 P5X 的早期入口。

import { check, section, summary, listFixtures, counts } from "./harness.mjs";
import { NEXT_SOURCES, stats } from "../registry.js";
import { EXTRA_GACHA_FETCHERS, EXTRA_EVENT_FETCHERS } from "../registry-extras.js";

import runP5x from "./cases-p5x.mjs";
import runB1 from "./cases-b1.mjs";
import runB2 from "./cases-b2.mjs";
import runB3 from "./cases-b3.mjs";
import runP4 from "./cases-p4.mjs";
import runP5 from "./cases-p5.mjs";
import runP6 from "./cases-p6.mjs";
import runP7 from "./cases-p7.mjs";
import runP8 from "./cases-p8.mjs";
import runP9 from "./cases-p9.mjs";

const LIVE = process.argv.includes("--live");

//#region 聚合注册表守卫（在任何批次 useFixtures() 之前先跑，纯结构检查）
section("聚合注册表（全部批次合并后）");
{
	const st = stats();
	check("来源总数 ≥ 10", st.sources >= 10, String(st.sources));
	check("各批次都合并进来了（含 p5x）", st.ids.includes("p5x") && st.ids.includes("fgo") && st.ids.includes("bandori"), st.ids.join(","));
	check("id 全局无重复（registry.js 会抛错，这里再守一道）", new Set(st.ids).size === st.ids.length, st.ids.join(","));
	// 每个来源：tz 合法 + 至少一侧 + 每侧四要素齐备
	const TZ_OK = (t) => typeof t === "string" && (t === "UTC" || /^[A-Za-z]+\/[A-Za-z_]+$/.test(t) || /^[+-]?\d+$/.test(t));
	for (const s of NEXT_SOURCES) {
		check(`${s.id} 声明了合法 tz`, TZ_OK(s.tz), String(s.tz));
		// ⚠️ 「至少一侧」也接受**只挂备选源**的条目（官方接口已定位但源站暂无内容，
		//    如 `ournotes-global`：默认未配置 = 不抓取、UI 显示「未配置」，用户在设置页选源即可启用）。
		check(`${s.id} 至少一侧（或至少一个备选源）`,
			!!(s.gacha || s.event || (s.altSources || []).length || (s.eventAltSources || []).length));
		for (const side of ["gacha", "event"]) {
			if (!s[side]) continue;
			const d = s[side];
			check(`${s.id}.${side} url 是 http(s)`, /^https?:\/\//.test(d.url), String(d.url));
			check(`${s.id}.${side} fetcher 是函数`, typeof d.fetcher === "function", typeof d.fetcher);
			check(`${s.id}.${side} kind 合法`, ["official-api", "official-html", "wiki", "third-party"].includes(d.kind), String(d.kind));
			check(`${s.id}.${side} mode 合法`, d.mode === "proxy" || d.mode === "direct", String(d.mode));
		}
	}
	// 备选源登记（插件契约：卡池查扁平表；活动查 EVENT_FETCHERS[条目id]）
	for (const s of NEXT_SOURCES) {
		for (const a of s.altSources || []) {
			check(`${s.id}.altSources「${a.fetcher}」已登记在 EXTRA_GACHA_FETCHERS`, typeof EXTRA_GACHA_FETCHERS[a.fetcher] === "function", String(a.fetcher));
		}
		for (const a of s.eventAltSources || []) {
			const tbl = EXTRA_EVENT_FETCHERS[s.id];
			check(`${s.id}.eventAltSources「${a.fetcher}」已登记在 EXTRA_EVENT_FETCHERS[${JSON.stringify(s.id)}]`, !!(tbl && typeof tbl[a.fetcher] === "function"), String(a.fetcher));
		}
	}

	// mode 的取值必须有依据：调研实测只有三个源 ACAO 放行
	const DIRECT_OK = /umapyoi\.net|sekai-world\.github\.io|bang-dream-on\.bushimo\.jp/;
	for (const s of NEXT_SOURCES) {
		for (const side of ["gacha", "event"]) {
			if (!s[side] || s[side].mode !== "direct") continue;
			check(`${s.id}.${side} 声明 direct —— url 属于实测 ACAO 放行的三源之一`, DIRECT_OK.test(s[side].url), s[side].url);
		}
	}
}
//#endregion

//#region 夹具卫生
section("夹具卫生");
{
	const fx = listFixtures();
	check("夹具非空", fx.length > 0, String(fx.length));
	check("夹具数量 ≥ 20（各批都抓了真实响应）", fx.length >= 20, String(fx.length));
	check("夹具命名带批次前缀（便于溯源）",
		fx.every((f) => /^(p5x|p4|p5|p6|p7|p8|p9|b1|bwiki|bandori|gf2|ournotes|fgo|uma|sekai|bestdori)/.test(f)), fx.slice(0, 5).join(","));
}
//#endregion

//#region 各批离线用例
const batches = [
	["P5X（参考实现）", runP5x],
	["B1 JSON 型（umapyoi / Bestdori / sekai）", runB1],
	["B2 bwiki 系（7 来源）", runB2],
	["B3 API/HTML 型（gf2 / bandori / ournotes / fgo）", runB3],
	["P4 米哈游系官方公告（米游社：崩坏3/原神/星铁/绝区零）", runP4],
	["P5 赛马娘官方（日服 + 国际服）", runP5],
	["P6 嘟嘟脸恶作剧（biligame）+ 雪松（bwiki）", runP6],
	["P7 星塔旅人（悠星官方 CMS API）", runP7],
	["P8 bwiki wikitext（战双 SMW+公告 / 卡厄斯 Lua / 雪松模板）", runP8],
	["P9 biligame 官方（物华活动 / 闪耀）+ OurNotes 国际服", runP9]
];
const before = counts();
for (const [label, fn] of batches) {
	try { await fn(); }
	catch (e) {
		check(`${label} 用例未抛错`, false, e && e.message);
	}
	const now = counts();
	console.log(`  · ${label}：+${now.pass - before.pass} 通过`);
}
//#endregion

summary();
