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

import runP5x from "./cases-p5x.mjs";
import runB1 from "./cases-b1.mjs";
import runB2 from "./cases-b2.mjs";
import runB3 from "./cases-b3.mjs";

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
		check(`${s.id} 至少一侧`, !!(s.gacha || s.event));
		for (const side of ["gacha", "event"]) {
			if (!s[side]) continue;
			const d = s[side];
			check(`${s.id}.${side} url 是 http(s)`, /^https?:\/\//.test(d.url), String(d.url));
			check(`${s.id}.${side} fetcher 是函数`, typeof d.fetcher === "function", typeof d.fetcher);
			check(`${s.id}.${side} kind 合法`, ["official-api", "official-html", "wiki", "third-party"].includes(d.kind), String(d.kind));
			check(`${s.id}.${side} mode 合法`, d.mode === "proxy" || d.mode === "direct", String(d.mode));
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
		fx.every((f) => /^(p5x|b1|bwiki|bandori|gf2|ournotes|fgo|uma|sekai|bestdori)/.test(f)), fx.slice(0, 5).join(","));
}
//#endregion

//#region 各批离线用例
const batches = [
	["P5X（参考实现）", runP5x],
	["B1 JSON 型（umapyoi / Bestdori / sekai）", runB1],
	["B2 bwiki 系（7 来源）", runB2],
	["B3 API/HTML 型（gf2 / bandori / ournotes / fgo）", runB3]
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
