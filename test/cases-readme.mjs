// test/cases-readme.mjs —— README 结构图 / 事实性守卫
//
// ── 为什么需要它 ──
// 2026-10-03 用户问「README 的结构图是不是不太对」。一查确实烂了：`test/` 子树只列了 4 项（实际 16 项）、
// `all.mjs` 写着「10 个批次」（实际 11 段）、`42-parsers-bwiki.js` 的游戏列表和 P2 删代码后对不上、
// `90-plugin.js` 还写着已改名的 `settingsScope`、顶层漏了 `tools/`……
//
// 根因：**结构图没有任何机器校验**。仓库侧原有守卫只核对「`src/client/` 的文件是否都在树里」，
// 而 `test/` 子树、每行的**描述文字**、以及各种**数字**（段数 / 符号数）全靠人记 —— 人一定会忘。
//
// 所以本文件只守**能被机器判定的事实**（主观描述不碰）：
//   ① 结构树必须列出 `src/client/` 的每个文件（文件增删时树必须同步）
//   ② 结构树必须列出 `test/` 的每个顶层文件与 `map.json`（`cases-*.mjs` 允许用一行通配覆盖）
//   ③ 结构树必须列出 `tools/`（`package.json` 的 publish:* 依赖它）
//   ④ `README.md` 与 `test/README.md` 里写的「N 段用例」必须等于 `all.mjs` 实际段数
//
// ⚠️ 刻意**不**校验解析器符号数这类"每次加解析器就变"的数字 —— 那种数字应该从文档里删掉，
//    而不是钉一个会持续漂移的断言（`test/README.md` 里原来的「283 个解析器符号」就是这么过时的）。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
const testReadme = readFileSync(path.join(REPO, "test", "README.md"), "utf8");
// 结构树已搬到开发者文档（用户版 README 只留一行指针）
const dev = readFileSync(path.join(REPO, "README_Dev.md"), "utf8");

export default function runReadme() {
	section("README / README_Dev 结构图与事实性");

	// ① src/client/ 的每个文件都要在树里
	{
		const actual = readdirSync(path.join(REPO, "src", "client")).filter((f) => f.endsWith(".js"));
		const missing = actual.filter((f) => !dev.includes(f));
		check("结构树列出了 src/client/ 的全部文件", missing.length === 0, "缺：" + missing.join(", "));
	}

	// ② test/ 的顶层文件（树里允许用 `*` 通配覆盖成族的脚本，如 cases-*.mjs / capture*.mjs）
	{
		const actual = readdirSync(path.join(REPO, "test")).filter((f) => f.endsWith(".mjs") || f === "map.json");
		// 收集树里出现过的"带通配的文件名"模式，转成正则
		const globs = [...dev.matchAll(/[A-Za-z0-9_-]*\*[A-Za-z0-9_*-]*\.mjs/g)]
			.map((m) => new RegExp("^" + m[0].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$"));
		const missing = actual.filter((f) => {
			if (dev.includes(f)) return false;
			return !globs.some((re) => re.test(f));
		});
		check("结构树列出了 test/ 的每个顶层文件（可用 `*` 通配成族覆盖）", missing.length === 0, "缺：" + missing.join(", "));
		// 反证：通配不能变成"什么都不用列"的借口 —— test/README.md 与 map.json 必须显式出现
		check("结构树显式列出 test/README.md 与 map.json", dev.includes("test/README.md") && dev.includes("map.json"));
	}

	// ③ tools/（package.json 的 publish:* 依赖它）
	check("结构树列出了 tools/", /├──\s*tools\//.test(dev));

	// ④ 段数：README 写的 N 段 == all.mjs 的 batches 长度
	{
		const allSrc = readFileSync(path.join(REPO, "test", "all.mjs"), "utf8");
		const i = allSrc.indexOf("const batches = [");
		const j = i >= 0 ? allSrc.indexOf("];", i) : -1;
		check("能在 all.mjs 里定位 batches（守卫自身没瞎）", i >= 0 && j > i, `i=${i} j=${j}`);
		const actual = i >= 0 && j > i ? [...allSrc.slice(i, j).matchAll(/^\t\["/gm)].length : 0;
		const numIn = (text, label) => {
			const m = /(\d+)\s*段/.exec(text);
			if (!m) { check(`${label} 里写明了段数`, false, "没找到「N 段」"); return null; }
			return Number(m[1]);
		};
		const a = numIn(dev, "README_Dev.md");
		const b = numIn(testReadme, "test/README.md");
		check("README_Dev.md 的段数与 all.mjs 实际段数一致", a === actual, `README=${a} 实际=${actual}`);
		check("test/README.md 的段数与 all.mjs 实际段数一致", b === actual, `test/README=${b} 实际=${actual}`);
	}
}
