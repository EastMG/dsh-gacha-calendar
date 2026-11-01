// test/ui/report.mjs —— UI harness 的极简报告器
//
// 为什么不用 test/harness.mjs 的 check/summary：那一份在 import 时就会 `loadClient()`
// （加载构建产物 lib/client.js，见 test/load.mjs 末尾的 `export const T = loadClient()`）。
// UI harness 只看**真实 CSS + 真实 DOM**，不需要跑一遍产物；而且它允许在没装浏览器的机器上
// 退化 skip —— 那时连 build 都不该被要求跑过。所以这里自带一套。
//
// 输出格式与仓库其余门禁**逐字一致**（`结果：N 通过 / M 失败` + `失败项：… | …`），
// 让人一眼能对上门禁读数。

let pass = 0;
let fail = 0;
const failures = [];
/** 不参与计分的诊断信息（`⚠` 前缀）—— 用来交代"这条断言为什么今天必然成立"之类的事实。 */
const notes = [];

/** 一条断言。`detail` 只在失败时打印（成功时行尾保持干净，与既有门禁的观感一致）。 */
export function check(name, ok, detail) {
	if (ok) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		failures.push(name);
		console.log(`  ✗ ${name}${detail ? "\n      " + String(detail).replace(/\n/g, "\n      ") : ""}`);
	}
}

/** 诊断行：不计分、不改退出码。 */
export function note(msg) {
	console.log(`  ⚠ ${msg}`);
	notes.push(msg);
}

export function section(title) {
	console.log(`\n--- ${title} ---`);
}

export function counts() {
	return { pass, fail };
}

/**
 * 失败明细的统一格式：组名 / 期望 vs 实测 / 选择器 / 关键矩形。
 * 单独抽出来是为了**每一条**几何断言都长得一样 —— 看报告的人不用逐条适应排版。
 */
export function detail(group, expected, actual, selector, rects) {
	const parts = [`组=${group}`, `期望=${expected}`, `实测=${actual}`];
	if (selector) parts.push(`选择器=${selector}`);
	if (rects != null) parts.push(`矩形=${typeof rects === "string" ? rects : JSON.stringify(rects)}`);
	return parts.join("  ");
}

/** 矩形压缩成一行（失败信息里用；不带无意义的精度）。 */
export function rectBrief(r) {
	if (!r) return "null";
	const n = (v) => Math.round(v * 100) / 100;
	return `x=${n(r.x)} y=${n(r.y)} w=${n(r.w)} h=${n(r.h)} right=${n(r.right)} bottom=${n(r.bottom)}`;
}

/**
 * 优雅 skip：没装 Playwright / 没有浏览器时走这里。
 * **必须 exit 0** —— UI harness 不在默认门禁里，装不上浏览器绝不能把别人搞红。
 */
export function skip(title, lines) {
	section(title);
	for (const l of lines) console.log("  " + l);
	console.log("\n结果：0 通过 / 0 失败（已跳过）");
	process.exit(0);
}

export function summary() {
	console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
	if (failures.length) console.log("失败项：" + failures.join(" | "));
	process.exit(fail === 0 ? 0 : 1);
}
