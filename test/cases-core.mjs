// test/cases-core.mjs —— core 产物（packages/core/core.mjs）守卫
//
// ── 为什么需要它 ──
// 2026-10-03 用户选方案 C2：把另外 17 款游戏的解析器也纳入 `CORE_ORDER`，并把
// `43-sources-register.js` 并进 `40-fetchers.js`。这带来一条**很容易踩、且症状隐蔽**的约束：
//
//   · `20-sources.js`（含 `SOURCES` 数组）在 core 里位于**模块顶层** → 所有引擎共享同一份；
//   · `40-fetchers.js` 在 **`createEngine` 内部** → **每建一个引擎就重跑一遍**；
//   · 而并进来的那段会往 `SOURCES` 里**追加**条目（17 条 + `bh3`）并给既有条目挂备选源。
//
//   于是只要有一处不是幂等的，**多建几个引擎就会让来源表越堆越长** ——
//   表现为"同一个游戏在面板里出现两次""备选源列表越来越长"，而**不会报任何错**。
//   本文件就是这条约束的回归守卫（`_core_engine_test.mjs` 恰好建了两个引擎，但它是软断言、退出码恒 0）。
//
// 顺带守一件事：core 必须**零宿主依赖**（build.mjs 有静态检查，这里再用运行时行为兜一层——
// 在纯 Node 环境里建引擎并跑一次 listGames/getCached，不碰 window/document）。

import { createEngine } from "../packages/core/core.mjs";
import { check, section } from "./harness.mjs";

export default async function runCore() {
	section("core 产物（零宿主依赖 + 注册幂等）");

	const noopTransport = {
		async fetchRaw() { throw new Error("no-network"); },
		async fetchViaProxy() { throw new Error("no-network"); }
	};
	const makeStorage = () => {
		const m = new Map();
		return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
	};

	// ① 模块顶层的 SOURCES 在多次建引擎后**不得增长**（幂等）
	{
		const e1 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const n1 = e1.__test.SOURCES.length;
		const ids1 = e1.__test.SOURCES.map((s) => s.id);
		const e2 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const n2 = e2.__test.SOURCES.length;
		const ids2 = e2.__test.SOURCES.map((s) => s.id);
		check("多次 createEngine 不会让 SOURCES 变长（注册必须幂等）", n1 === n2, `第一次=${n1} 第二次=${n2}`);
		check("多次 createEngine 后来源 id 集合完全一致", JSON.stringify(ids1) === JSON.stringify(ids2),
			`${ids1.length} vs ${ids2.length}；多出来的：${ids2.filter((i) => !ids1.includes(i)).join(",") || "无"}`);
		check("来源 id 无重复（堆叠会直接体现为重复 id）", new Set(ids1).size === ids1.length,
			ids1.filter((i, k) => ids1.indexOf(i) !== k).join(","));
		// 备选源也不能堆叠（并进来的那段会给 genshin/hsr/zzz 挂米游社备选源）
		const altMax = Math.max(...e1.__test.SOURCES.map((s) => (s.altSources || []).length), 0);
		const e3 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const altMax3 = Math.max(...e3.__test.SOURCES.map((s) => (s.altSources || []).length), 0);
		check("多次 createEngine 不会让 altSources 变长", altMax === altMax3, `${altMax} vs ${altMax3}`);
	}

	// ② core 覆盖全部 28 款（C2 之后的范围），且内置 11 款仍在
	{
		const e = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const ids = e.__test.SOURCES.map((s) => s.id);
		check("core 来源总数 = 28（内置 11 + 另外 17）", ids.length === 28, String(ids.length));
		const builtin = ["genshin", "hsr", "zzz", "wuwa", "arknights", "endfield", "ba-cn", "ba-global", "ba-jp", "r1999", "nte"];
		check("内置 11 款都还在", builtin.every((i) => ids.includes(i)), builtin.filter((i) => !ids.includes(i)).join(","));
		const extra = ["p5x", "zspms", "czn", "kedr", "ddlezj", "bh3", "stellasora", "fgo", "gf2", "bandori", "pjsk"];
		check("另外 17 款的代表条目也在（C2 后 core 不再只有内置）", extra.every((i) => ids.includes(i)), extra.filter((i) => !ids.includes(i)).join(","));
	}

	// ③ 纯 Node 环境可用（没有 window / document）
	{
		const e = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		let ok = true, err = "";
		try {
			const games = await e.listGames();
			ok = Array.isArray(games) && games.length > 0;
			await e.getCached();
		} catch (e2) { ok = false; err = String((e2 && e2.message) || e2); }
		check("纯 Node 下 listGames / getCached 可用（core 零宿主依赖）", ok, err);
		check("本测试环境确实没有 window/document（否则上面那条不算数）", typeof window === "undefined" && typeof document === "undefined");
	}
}
