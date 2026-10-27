// tools/remind/lib/state.mjs —— 去重状态文件 state.json 的读写（原子写）
//
// 形状（与 tick 的 state 入参完全一致，就是一张平表，没有版本壳子）：
//   {
//     "ba-jp|event|end|1793113200000": { "fired": [72, 24] },
//     "genshin|gacha|end|1793707200000": { "fired": [2] }
//   }
//   - 键 = `gameId|side|kind|T`（T = 该方向的绝对毫秒时间戳）⇒ 新一期（T 变了）天然是新键，会重新提醒。
//   - fired = 已经打扰过的**节点小时数**；同一轮里"只发最紧急"时，其余到期节点也进这里（不再补发）。
//   - T 已过的键由 tick 清理（见 lib/tick.mjs 规则⑤）—— 本文件只管读写，不猜业务。
//
// 为什么是平表：面板 / 扩展宿主以后要读它，越直白越好；元信息（版本号、写入时间）放日志里，
// 不放数据里 —— 混进数据会让"键都是条目键"这个前提失效，清理逻辑就要开始猜哪些键是元数据。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 读状态文件。
 * - 文件不存在：空状态（首次运行，不是错误）
 * - 文件损坏：空状态 + invalid（不猜、不"半读"）—— 调用方应记日志，然后按空状态继续；
 *   最坏结果只是同一档再提醒一次，不会漏。
 *
 * @param {string} file
 * @returns {{ state: Record<string, { fired: number[] }>, status: "ok" | "missing" | "invalid", detail?: string }}
 */
export function readState(file) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") return { state: {}, status: "missing" };
		return { state: {}, status: "invalid", detail: String((err && err.message) || err) };
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { state: {}, status: "invalid", detail: "不是合法 JSON（" + String((err && err.message) || err) + "）" };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { state: {}, status: "invalid", detail: "顶层不是对象" };
	}
	return { state: parsed, status: "ok" };
}

/** 键排序后写盘：同一份状态反复写出的字节稳定，diff / 只读排查都省事。 */
function sortKeys(state) {
	const out = {};
	for (const key of Object.keys(state).sort()) out[key] = state[key];
	return out;
}

/**
 * 原子写状态：同目录 .tmp → rename。
 * 目录不存在会自动建（首次运行）。
 *
 * @param {string} file
 * @param {Record<string, { fired: number[] }>} state
 */
export function writeState(file, state) {
	mkdirSync(path.dirname(file), { recursive: true });
	// 末尾换行：用 Get-Content / git diff 看的时候不会"少一行"。
	const body = JSON.stringify(sortKeys(state), null, 2) + "\n";
	const tmp = file + ".tmp";
	writeFileSync(tmp, body, "utf8");
	renameSync(tmp, file); // 同目录 rename：原子替换
}

/** 状态里的条目数（日志 / 摘要用）。 */
export function stateCount(state) {
	return state && typeof state === "object" ? Object.keys(state).length : 0;
}
