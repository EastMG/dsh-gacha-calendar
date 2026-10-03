// test/cases-hover-lint.mjs —— 悬停规则静态守卫（方案 A）
//
// ── 为什么需要它 ──
// 2026-10-03 的方案 A（悬停统一走 hoverPool/hoverEvent、元信息彻底删掉）只审计了**主源**，
// 结果 6 个**备选源**（uma-jp-umapyoi / bandori-bestdori-gacha / uma-cn-bwiki / kedr-kaxi /
// uma-jp-bwiki / stellasora-bwiki）的悬停一直不合规却没被发现 —— 用户看到的正是「同一个插件里
// 悬停样式不一致」。教训是：**规则只靠人工审计守不住**，得让机器天天查。
//
// 本守卫做两件事（都是静态的，不需要网络）：
//   ① 扫 `src/client/42-parsers-*.js` 的**字符串/模板字面量**（跳过注释，免得解释性注释误报），
//      命中已知的元信息写法就失败；
//   ② 扫是否又出现了"本地自制悬停排版"（`buildPoolHover` / `buildEventHover` / `permanentLine`
//      这类函数名）—— 排版只允许有 hoverPool / hoverEvent 一处实现。
//
// ⚠️ 只扫**字面量**很关键：源码注释里会大量引用被禁的写法来解释历史（那是好事）。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "src", "client");

// 去掉注释后，抽出所有字符串 / 模板字面量的**内容**。
// ⚠️ 必须**正确识别正则字面量**：`/["']/` 这类写法里的引号会让朴素扫描器错位，
//    把后面的代码当成字符串（本守卫第一版就这样误报了 2 处）。
//    判据用经典启发式：`/` 前面是"值"（标识符/数字/`)`/`]`）时是除法，否则是正则；
//    再补上 `return` / `typeof` / `case` / `in` / `of` / `new` 这几个关键字后的正则。
const REGEX_AFTER_WORD = /^(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
function stringLiterals(src) {
	const out = [];
	let i = 0, prev = "";
	const n = src.length;
	while (i < n) {
		const c = src[i], c2 = src[i + 1];
		if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; prev = "\n"; continue; }
		if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
		if (c === "/") {
			// 往回取一个"词"，判断这个 `/` 是正则还是除号
			let j = i - 1;
			while (j >= 0 && /\s/.test(src[j])) j--;
			let k = j;
			while (k >= 0 && /[\w$]/.test(src[k])) k--;
			const word = src.slice(k + 1, j + 1);
			const valueLike = j >= 0 && /[\w$)\]]/.test(src[j]) && !REGEX_AFTER_WORD.test(word);
			if (!valueLike) {
				i++;                                  // 跳过正则字面量
				let inClass = false;
				while (i < n) {
					if (src[i] === "\\") { i += 2; continue; }
					if (src[i] === "[") inClass = true;
					else if (src[i] === "]") inClass = false;
					else if (src[i] === "/" && !inClass) { i++; break; }
					else if (src[i] === "\n") break;
					i++;
				}
				prev = "/";
				continue;
			}
		}
		if (c === '"' || c === "'" || c === "`") {
			const q = c; let buf = ""; i++;
			while (i < n) {
				if (src[i] === "\\") { buf += src[i + 1] || ""; i += 2; continue; }
				if (src[i] === q) { i++; break; }
				buf += src[i]; i++;
			}
			out.push(buf);
			prev = '"';
			continue;
		}
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out;
}

// 「只留代码」版：去掉注释**并且**挖空字符串/正则内容（保留 `${}` 插值里的代码）。
// ⚠️ 不能再用 `line.replace(/\/\/.*$/, "")` —— 行内 URL 的 `//` 会被当注释，后半行整段被切掉，
//    于是"看起来查过了"其实什么都没查（本文件早期就这么错过了好几处，且会漏报而非误报，更隐蔽）。
//    判据沿用上面的正则/除号启发式（同样的坑别再踩第二次）。
function codeOnly(src) {
	let out = "", i = 0, prev = "";
	const n = src.length;
	while (i < n) {
		const c = src[i], c2 = src[i + 1];
		if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; out += "\n"; i++; prev = "\n"; continue; }
		if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; } i += 2; continue; }
		if (c === '"' || c === "'" || c === "`") {
			const q = c; i++;
			while (i < n) {
				if (src[i] === "\\") { i += 2; continue; }
				if (q === "`" && src[i] === "$" && src[i + 1] === "{") {          // 插值里是真代码
					let depth = 1, j = i + 2;
					while (j < n && depth > 0) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (!depth) break; } j++; }
					out += " " + codeOnly(src.slice(i + 2, j)) + " ";
					i = j + 1; continue;
				}
				if (src[i] === q) { i++; break; }
				if (src[i] === "\n") out += "\n";
				i++;
			}
			out += " "; prev = q; continue;
		}
		if (c === "/") {
			let j = i - 1;
			while (j >= 0 && /\s/.test(src[j])) j--;
			let k = j;
			while (k >= 0 && /[\w$]/.test(src[k])) k--;
			const valueLike = j >= 0 && /[\w$)\]]/.test(src[j]) && !REGEX_AFTER_WORD.test(src.slice(k + 1, j + 1));
			if (!valueLike) {                       // 正则字面量 → 挖空
				let p = i + 1, inClass = false, closed = false;
				while (p < n) { if (src[p] === "\\") { p += 2; continue; } if (src[p] === "\n") break; if (src[p] === "[") inClass = true; else if (src[p] === "]") inClass = false; else if (src[p] === "/" && !inClass) { closed = true; break; } p++; }
				if (closed) { p++; while (p < n && /[a-z]/i.test(src[p])) p++; out += " "; i = p; prev = "/"; continue; }
			}
		}
		out += c; i++;
		if (!/\s/.test(c)) prev = c;
	}
	return out;
}

// 禁止出现在**悬停文本**里的元信息写法。
// 注意：这些词允许出现在**插件其它地方**（如设置页文案、来源标签），所以只查解析器文件。
const FORBIDDEN = [
	[/end_date\s*=|start_date\s*=/, "源站字段名（如 end_date=2147483647）"],
	[/\bclosedAt\s*=|\bpublishedAt\s*=/, "源站字段名"],
	[/哨兵/, "实现细节（哨兵值）"],
	[/未列出|未计入/, "抓取统计（另有 N 个未列出）"],
	[/非官方时刻表|按日服时差推算/, "来源/推算说明"],
	[/源站为|源站只有|无卡池名/, "来源说明"],
	[/^\s*——\s|\s——\s*$/, "分隔线装饰"],
	[/（id[ 　]/, "内部 id"],
	[/以及常驻活动\s*\$\{/, "常驻计数行（应走共用 hoverEvent 的 permanentCount）"],
	// ↓ 2026-10-03 扩：第一次只列了上面几条，漏掉下面这类"可信度/时区说明"，
	//   结果 kedr / ddlezj 的元信息行逃过了守卫（靠人工看测试断言才发现）。
	[/社区页|非官方源|非官方|社区维护|社区推算|社区数据库/, "来源可信度说明"],
	[/推测|推断|估算/, "时区/时刻推定说明"],
	[/tz\s*=|UTC[+-]\d|时区/, "时区说明（应在来源声明的 tz 字段里，不进悬停）"],
	[/自标|源站正文/, "源站字段/正文说明"],
];

export default async function run() {
	section("规则静态守卫（方案 A 悬停：只有名称与档期；选当期：只有一处判定）");
	const files = readdirSync(SRC).filter((f) => /^42-parsers-.*\.js$/.test(f)).sort();
	check("解析器文件齐备（17 个）", files.length === 17, String(files.length));

	const hit = [];
	for (const f of files) {
		const lits = stringLiterals(readFileSync(path.join(SRC, f), "utf8"));
		for (const s of lits) {
			for (const [re, why] of FORBIDDEN) {
				if (re.test(s)) hit.push(`${f}: ${why}  ← ${JSON.stringify(s.slice(0, 70))}`);
			}
		}
	}
	check("字符串里没有已知的悬停元信息写法", hit.length === 0, hit.slice(0, 6).join(" / "));

	// 排版只允许一处实现：不许再出现本地自制的 buildPoolHover / buildEventHover / permanentLine
	const LOCAL = /(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=(]/g;
	const localHover = [];
	for (const f of files) {
		const code = codeOnly(readFileSync(path.join(SRC, f), "utf8"));
		for (const m of code.matchAll(LOCAL)) {
			const name = m[1].replace(/^ns_[a-z0-9_]+?_/i, "");
			if (/^(buildPoolHover|buildEventHover|permanentLine|hoverPool|hoverEvent)$/.test(name)) {
				localHover.push(`${f}: ${m[1]}`);
			}
		}
	}
	check("没有本地自制的悬停排版实现（只允许共用 hoverPool / hoverEvent）", localHover.length === 0, localHover.join(" / "));

	// ── 「覆盖 now / 选当期」也要只有一处实现（2026-10-03 普查：曾散成 92 处 / 25 种写法）──
	// 允许的出现位置：唯一真源 `30-parsers.js` 的三个函数体内（coversNow / coversNowBounded / pickCovering）。
	{
		const INLINE = /[A-Za-z_$][\w$.]*\.startTs\s*<=\s*now\s*&&\s*[A-Za-z_$][\w$.]*\.endTs\s*>=\s*now/;
		const hits = [];
		for (const f of readdirSync(SRC).filter((x) => /^(?:30-parsers|40-fetchers|42-parsers-.*)\.js$/.test(x))) {
			const src = readFileSync(path.join(SRC, f), "utf8");
			// 把唯一真源那段挖掉（挖法同迁移脚本：从标记到 pickCovering 的返回行）
			const ia = src.indexOf("// ── 「覆盖 now」与「选当期」（**唯一真源**）");
			const ib = src.indexOf("return o.first ? (list[0] || null) : list;", ia);
			const body = ia >= 0 && ib >= 0
				? src.slice(0, ia) + src.slice(src.indexOf("\n", src.indexOf("}", ib)) + 1)
				: src;
			body.split("\n").forEach((l, i) => {
				if (l.trim().startsWith("//")) return;
				if (INLINE.test(l)) hits.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
			});
		}
		check("没有内联的「覆盖 now」判定（一律走 coversNow / coversNowBounded / pickCovering）", hits.length === 0, hits.slice(0, 4).join(" / "));
		// 反证：三个共用判定必须真的在
		const p30 = readFileSync(path.join(SRC, "30-parsers.js"), "utf8");
		check("共用判定 coversNow / coversNowBounded / pickCovering 存在",
			/function coversNow\(/.test(p30) && /function coversNowBounded\(/.test(p30) && /function pickCovering\(/.test(p30));
	}

	// ── 无年份日期的两条规则：补年份 / 跨年（2026-10-03 收敛，此前 12+ 处 4 种写法）──
	{
		const p30 = readFileSync(path.join(SRC, "30-parsers.js"), "utf8");
		check("共用 inferYear / endsNextYear / YEAR_HINT_MONTH_GAP 存在",
			/function inferYear\(/.test(p30) && /function endsNextYear\(/.test(p30) && /const YEAR_HINT_MONTH_GAP = \d+;/.test(p30));
		const bad = [];
		for (const f of readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
			const code = codeOnly(readFileSync(path.join(SRC, f), "utf8"));
			// 内联的"结束早于开始 → 次年"判定（应走 endsNextYear）
			if (/\w+\.mo\s*<\s*\w+\.mo\s*\|\||\w+\s*<\s*\w+\s*&&\s*\w+\.d\s*<\s*\w+\.d/.test(code)) bad.push(`${f}: 内联月日跨年判定`);
			if (/(?:nowYear|year|y1|lastY)\s*\+\s*1/.test(code) && !/endsNextYear|YEAR_HINT_MONTH_GAP/.test(code)) bad.push(`${f}: 内联 nowYear+1`);
			// 又出现本地 yearOf 副本
			if (/function\s+\S*yearOf\s*\(/.test(code)) bad.push(`${f}: 本地 yearOf 副本`);
		}
		// 白名单：bwiki 的**滚动列表版**（比的是"上一条的月"，语义不同，已改用共用常量）
		const allow = new Set(["42-parsers-bwiki.js", "30-parsers.js"]);
		const real = bad.filter((b) => !allow.has(b.split(":")[0]));
		check("没有内联的跨年判定 / 本地 yearOf 副本（一律走 endsNextYear / inferYear）", real.length === 0, real.slice(0, 4).join(" / "));
	}

	{
		const dup = [];
		for (const f of files) {
			const code = codeOnly(readFileSync(path.join(SRC, f), "utf8"));
			if (/(?:^|[;{}\s])(?:const|let|var)\s+\S*ENT_EXTRA\s*=/.test(code)) dup.push(`${f}: 本地 ENT_EXTRA`);
			if (/(?:^|[;{}\s])function\s+\S*(?:decodeExtra|plain)\s*\(/.test(code)) dup.push(`${f}: 本地 decodeExtra/plain`);
			// 时间戳/排序工具：2026-10-03 收敛（曾各 2~3 份，umapyoi 那份还缺 null 守卫）
			// ⚠️ 只认「被赋成函数」的：解析器里还有同名的**局部变量**（如
			//    `const toTs = parseUmaInstant(...)`），那不是工具副本，不该报。
			if (/(?:const|let|var)\s+\S*toTs\s*=\s*(?:\(|function\b|async\b)/.test(code)) dup.push(`${f}: 本地 toTs`);
			if (/(?:const|let|var)\s+\S*byNewestStart\s*=\s*(?:\(|function\b|async\b)/.test(code)) dup.push(`${f}: 本地 byNewestStart`);
		}
		check("没有本地自制的实体表/解码/时间戳/排序工具（只允许 41-sources-shared.js 那一份）", dup.length === 0, dup.slice(0, 5).join(" / "));
		const shCode = codeOnly(readFileSync(path.join(SRC, "41-sources-shared.js"), "utf8"));   // 查代码，别被解释性注释误报
		check("共用 ENTITIES_EXTRA / decodeExtra / htmlText / htmlTextTight 存在",
			/const ENTITIES_EXTRA = \{/.test(shCode) && /function decodeExtra\(/.test(shCode) && /function htmlText\(/.test(shCode) && /function htmlTextTight\(/.test(shCode));
		check("共用 numOrNull / byNewestStart 存在", /function numOrNull\(/.test(shCode) && /function byNewestStart\(/.test(shCode));
		check("常驻计数行只有本体那一份措辞（41 直接调 permanentLine，不再自带副本）",
			!/function hoverPermanentLine/.test(shCode) && /function permanentLine\(/.test(readFileSync(path.join(SRC, "30-parsers.js"), "utf8")));
		// 反证：并集表必须真的覆盖原来 5 张表里出现过的实体（抽查几个"只有个别表有"的）
		for (const e of ["middot", "yen", "hearts", "star", "trade", "thinsp", "laquo", "copy"]) {
			check(`并集表含 &${e};`, new RegExp(`\\b${e}:`).test(shCode));
		}
	}

	// ── 面板：doRefresh 必须经 ref 读"最新设置"，不能闭包冻结 ──
	// 2026-10-03 用户报「面板显示 23 条条目，计数只有 22」→ 根因：
	//   `s` 每次渲染都是新对象，而 `doRefresh` 被 useCallback 记忆化在 `[scope, engine]`，
	//   于是它闭包里的 `s` 永远停在**首次渲染**那一刻：
	//     渲染那条路用当次 s → 23 行；`doRefresh` 里算计数用冻结的 s → 只数到 22。
	//   挂载后才勾选的条目会被**整个漏出报告**（不计入分母、失败也不进明细）。
	// 之所以要机器守：这个 bug 完全不影响抓取、不报错，只让顶部那行数字差 1 —— 靠人看代码很难发现。
	{
		const comp = readFileSync(path.join(SRC, "80-components.js"), "utf8");
		const i = comp.indexOf("const doRefresh = ");
		const j = i >= 0 ? comp.indexOf("}, [scope, engine]);", i) : -1;
		check("能定位 doRefresh 函数体（守卫自身没瞎）", i >= 0 && j > i, `i=${i} j=${j}`);
		if (i >= 0 && j > i) {
			// ⚠️ 必须先在 codeOnly 上扫：解释性注释里会引用 `` `s` ``（本守卫的注释自己就这么写），
			//    直接扫原文会把注释里的示例当成代码命中 —— 这个坑本文件已经踩过好几次。
			const body = codeOnly(comp.slice(i, j));
			// 裸 `s`（`s.` / `(s)` / `s)` 等）：`sRef` 不会被误匹配，因为 `s` 后紧跟 `R` 不是词边界
			const bare = [...body.matchAll(/(?:^|[^\w$.])s\b/g)].map((m) => m[0].trim());
			check("doRefresh 里不直接读闭包中的 s（会冻结在首次渲染 → 计数少算）", bare.length === 0, "裸 s：" + bare.join(" / "));
			check("doRefresh 经 sRef.current 读最新设置", /getVisibleEntries\(sRef\.current\)/.test(body));
		}
		const compCode = codeOnly(comp);
		check("sRef 存在且每次渲染都同步最新 s", /const sRef = \(0, react\.useRef\)\(s\);/.test(compCode) && /sRef\.current = s;/.test(compCode));
	}

	// ── 配置键必须成套：DEFAULT_SETTINGS 里有的，引擎 CONFIG_KEYS 必须都读 ──
	// 2026-10-03 用户报「勾选 p5x 后点刷新，这条不刷新」→ 根因就是这里漏了一个键：
	//   `shown`（用户明确打开的条目，用来覆盖出厂 `defaultHidden`）在 10-config.js 里有、
	//   在 engine-head.js 的 CONFIG_KEYS 里**没有** → `readSettings()` 永远回落到 `[]`
	//   → `isEntryHidden` 对 `defaultHidden` 条目恒为 true → 刷新**一个请求都不给它发**。
	//   而面板直接读宿主表单快照，所以"行能显示出来" —— 正是用户看到的"显示了、但刷不动它"。
	// 为什么必须机器查：加设置项很容易（10-config.js 一行），但让它真被引擎读到需要**同时**改
	//   engine-head.js 的另一处；两处不在同一文件、没有类型约束、漏了也不报错。
	{
		const cfgText = readFileSync(path.join(SRC, "10-config.js"), "utf8");
		const i = cfgText.indexOf("const DEFAULT_SETTINGS = {");
		const defBlock = i >= 0 ? cfgText.slice(i, cfgText.indexOf("};", i)) : "";
		const defKeys = [...defBlock.matchAll(/^\t{3}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
		const ehText = readFileSync(path.join(SRC, "engine-head.js"), "utf8");
		const j = ehText.indexOf("const CONFIG_KEYS = [");
		const cfgBlock = j >= 0 ? ehText.slice(j, ehText.indexOf("];", j)) : "";
		const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
		check("能解析出 DEFAULT_SETTINGS 与 CONFIG_KEYS（守卫自身没瞎）", defKeys.length >= 10 && cfgKeys.length >= 10, `def=${defKeys.length} cfg=${cfgKeys.length}`);
		const missing = defKeys.filter((k) => !cfgKeys.includes(k));
		check("DEFAULT_SETTINGS 的每个键都在引擎 CONFIG_KEYS 里（漏了就会「设了却不生效」）", missing.length === 0, "漏读：" + missing.join(", "));
	}

	// ── P2：不许再攒死声明（2026-10-03 一次清掉 13 个）──
	// 判定：文件顶层声明，在**生产代码**里除声明行外 0 引用，且**未**被 44-test-exports.js 导出。
	// ⚠️ 排除 44-test-exports.js 是关键：测试面符号（导出给测试的纯函数）看起来"没人用"，
	//    删掉就会连带删掉测试覆盖 —— 这一步必须区分开。
	{
		const DECL = /^([ \t]*)(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
		const all = readdirSync(SRC).filter((f) => f.endsWith(".js"));
		const cache = new Map();
		for (const f of all) cache.set(f, codeOnly(readFileSync(path.join(SRC, f), "utf8")));
		const exportsCode = cache.get("44-test-exports.js") || "";
		const dead = [];
		for (const f of all) {
			if (f === "44-test-exports.js") continue;
			const lines = cache.get(f).split("\n");
			let base = null;
			for (const l of lines) {
				if (l.trim() === "" || l.trim().startsWith("//")) continue;
				const ind = l.length - l.trimStart().length;
				if (base === null || ind < base) base = ind;
			}
			for (const l of lines) {
				if (l.length - l.trimStart().length !== base) continue;
				const m = DECL.exec(l);
				if (!m) continue;
				const name = m[2];
				if (new RegExp(`\\b${name}\\b`).test(exportsCode)) continue;      // 测试面 → 不算死
				let refs = 0;
				for (const g of all) {
					if (g === "44-test-exports.js") continue;
					refs += (cache.get(g).match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
				}
				if (refs <= 1) dead.push(`${f}: ${name}`);                        // 1 = 只有声明自己
			}
		}
		check("没有死声明（顶层声明在生产代码里至少被引用一次，或已导出给测试）", dead.length === 0, dead.slice(0, 6).join(" / "));
	}

	// 反证：共用工具必须真的在（否则上面的守卫会因为"没实现"而假通过）
	const shared = readFileSync(path.join(SRC, "41-sources-shared.js"), "utf8");
	check("共用工具 hoverPool / hoverEvent 存在", /function hoverPool\(/.test(shared) && /function hoverEvent\(/.test(shared));
	check("长期/常驻阈值只有一处（本体 LONG_TERM_MAX_WINDOW_DAYS）",
		["30-parsers.js", "41-sources-shared.js", "42-parsers-bestdori.js", "42-parsers-sekai.js"]
			.every((f) => {
				const t = readFileSync(path.join(SRC, f), "utf8");
				if (f === "30-parsers.js") return /const LONG_TERM_MAX_WINDOW_DAYS = \d+;/.test(t);
				if (f === "41-sources-shared.js") return /isLongTermWindow/.test(t) && !/HOVER_MAX_WINDOW_DAYS/.test(t.replace(/\/\/.*$/gm, ""));
				return /LONG_TERM_MAX_WINDOW_DAYS \* 864e5/.test(t) && !/=\s*(?:120|400)\s*\*\s*86400e3/.test(t);
			}));
}
