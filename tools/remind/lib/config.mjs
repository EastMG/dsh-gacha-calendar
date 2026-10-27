// tools/remind/lib/config.mjs —— 节点配置的读取与覆盖（接面板之前的唯一入口）
//
// 三层，后者覆盖前者：
//   ① 内置默认（lib/tick.mjs 的 DEFAULT_CONFIG）：结束 [72,24,6,2] / 开始 [24,2]
//   ② 配置文件，按顺序找第一个能读到的：
//        a. `%LOCALAPPDATA%\dsh-gacha-calendar\remind-config.json`（用户可以改这里，不动仓库）
//        b. `tools/remind/remind-config.json`（仓库自带示例，也是默认值的一份可见副本）
//   ③ CLI 覆盖：--hours=N（两个方向都换成单节点 N）/ --nodes=a,b,c / --start-nodes=a,b
//
// 配置文件里只放 `{ "endNodes": [72,24,6,2], "startNodes": [24,2] }`。
// **读不到 / 读坏了都回落到默认**（不因为一个配置文件让提醒停摆），坏文件会进 warnings 由日志记下来。
//
// 面板接入预留：以后面板写的就是 a 里那份 JSON。只要面板写的是同一个文件名、同样的两个键，
// 本模块不用改一行；如果面板要加别的键（比如静音时段），加独立字段、走单独读取，别塞进这两个数组。

import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, normalizeNodes } from "./tick.mjs";

/** 配置文件名（用户配置与仓库示例同名）。 */
export const CONFIG_NAME = "remind-config.json";

/**
 * 读一个配置文件。ENOENT 返回 missing（正常），其它错误返回 error（要记日志）。
 * @param {string} file
 * @returns {{ status: "ok", value: Record<string, unknown> } | { status: "missing" }
 *   | { status: "error", detail: string }}
 */
export function readConfigFile(file) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") return { status: "missing" };
		return { status: "error", detail: String((err && err.message) || err) };
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { status: "error", detail: "不是合法 JSON（" + String((err && err.message) || err) + "）" };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "error", detail: "顶层不是对象" };
	}
	return { status: "ok", value: parsed };
}

/**
 * 解析最终生效的节点配置。
 *
 * @param {{
 *   userFile?: string | null,       // %LOCALAPPDATA%\...\remind-config.json
 *   bundledFile?: string | null,    // tools/remind/remind-config.json
 *   overrides?: { endNodes?: number[] | null, startNodes?: number[] | null, hours?: number | null }
 * }} [opts]
 * @returns {{
 *   endNodes: number[],
 *   startNodes: number[],
 *   sources: { end: string, start: string },
 *   files: Array<{ file: string, status: string, detail?: string }>,
 *   warnings: string[]
 * }}
 */
export function resolveNodeConfig({ userFile = null, bundledFile = null, overrides = {} } = {}) {
	const files = [];
	const warnings = [];
	const layers = [];

	for (const file of [userFile, bundledFile]) {
		if (!file) continue;
		const res = readConfigFile(file);
		files.push({ file, status: res.status, detail: res.detail });
		if (res.status === "ok") layers.push({ file, value: res.value });
		else if (res.status === "error") warnings.push("配置文件读不了，已跳过：" + file + "（" + res.detail + "）");
	}

	const pick = (field, fallback) => {
		for (const layer of layers) {
			const nodes = normalizeNodes(layer.value[field]);
			if (nodes) return { nodes, source: layer.file };
		}
		return { nodes: [...fallback], source: "内置默认" };
	};

	// CLI 覆盖优先于任何文件。
	const hours = Number(overrides.hours);
	if (Number.isFinite(hours) && hours > 0) {
		const nodes = normalizeNodes([hours]);
		return {
			endNodes: nodes,
			startNodes: [...nodes],
			sources: { end: "--hours=" + hours, start: "--hours=" + hours },
			files,
			warnings
		};
	}

	const endOverride = normalizeNodes(overrides.endNodes);
	const startOverride = normalizeNodes(overrides.startNodes);
	const end = endOverride ? { nodes: endOverride, source: "--nodes=" + endOverride.join(",") } : pick("endNodes", DEFAULT_CONFIG.endNodes);
	const start = startOverride
		? { nodes: startOverride, source: "--start-nodes=" + startOverride.join(",") }
		: pick("startNodes", DEFAULT_CONFIG.startNodes);
	if (overrides.endNodes && !endOverride) warnings.push("--nodes 没有可用节点，已回落到配置 / 默认");
	if (overrides.startNodes && !startOverride) warnings.push("--start-nodes 没有可用节点，已回落到配置 / 默认");

	return {
		endNodes: end.nodes,
		startNodes: start.nodes,
		sources: { end: end.source, start: start.source },
		files,
		warnings
	};
}
