// tools/remind/lib/notify.mjs —— 送达：调同目录的 toast.ps1（WinRT 系统通知）
//
// 平台边界：判定（tick / derive）与平台无关，**送达只有 Windows 有实现**。
// 非 Windows 上 notifySupport() 会返回不可用及原因，只有 --dry-run 能跑（宿主接扩展时要自己实现送达）。
//
// 调法（与 demo-simple.mjs 验证过的完全一致）：
//   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File toast.ps1 `
//     -Title "即将结束 · 蔚蓝档案·日服" -Body "<行1>\n<行2>" -AppName "二游日历"
//   - 用 Windows PowerShell 5.1（System32\WindowsPowerShell\v1.0\powershell.exe），不是 pwsh：
//     只有 5.1 默认带 WinRT 投影。
//   - windowsHide: true ⇒ 不闪黑窗；-NoProfile -NonInteractive ⇒ 不读用户配置、不弹输入框。
//   - toast.ps1 用**字面 `\n`** 拆行，所以正文用 String.join("\\n")，不是真换行。
//   - 失败不抛：把 { ok, code, stdout, stderr } 交回调用方记日志，一条失败不影响其它条。

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmtTs, humanSpan, nodeLabel } from "./format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库里的 toast.ps1（与本模块的父目录同级）。**不要改它** —— 它是 UTF-8 BOM，能跑通的那份。 */
export const TOAST_SCRIPT = path.join(HERE, "..", "toast.ps1");

/** 通知底部 attribution 行显示的名字（横幅顶部的应用名由 AppId 决定，改不了）。 */
export const APP_NAME = "二游日历";

function pickPowershell() {
	if (process.platform !== "win32") return null;
	const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	const ps51 = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return existsSync(ps51) ? ps51 : "powershell.exe";
}

/**
 * 当前环境能不能送达。
 * @returns {{ ok: true, exe: string } | { ok: false, reason: string }}
 */
export function notifySupport() {
	const exe = pickPowershell();
	if (!exe) return { ok: false, reason: "当前平台不是 Windows（toast.ps1 依赖 WinRT）" };
	if (!existsSync(TOAST_SCRIPT)) return { ok: false, reason: "找不到 toast.ps1：" + TOAST_SCRIPT };
	return { ok: true, exe };
}

/** 通知标题：方向 + 游戏名（toast.ps1 会做 XML 转义）。 */
export function toastTitle(notify) {
	return (notify.kind === "end" ? "即将结束 · " : "即将开始 · ") + notify.gameName;
}

/** 通知正文各行（返回数组，调用方用 `\\n` 拼给 toast.ps1）。 */
export function toastBodyLines(notify, now) {
	const title = notify.sideLabel + "「" + (notify.title || notify.gameName) + "」";
	const node = nodeLabel(notify.node);
	if (notify.kind === "end") {
		return [
			title,
			fmtTs(notify.startTs) + " → " + fmtTs(notify.endTs) + " 结束",
			"还剩 " + humanSpan(notify.T - now) + "（" + fmtTs(notify.T) + " 截止 · " + node + " 提醒）"
		];
	}
	return [
		title,
		fmtTs(notify.startTs) + " 开始 · 至 " + fmtTs(notify.endTs),
		humanSpan(notify.T - now) + "后开始（" + node + " 提醒）"
	];
}

/**
 * 弹一条。**永不 reject**：失败信息原样交回，由调用方决定退出码 / 日志。
 *
 * @param {{ notify: Record<string, unknown>, exe: string, now: number }} input
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string, title: string, body: string }>}
 */
export function sendOne({ notify, exe, now }) {
	const title = toastTitle(notify);
	const body = toastBodyLines(notify, now).join("\\n");
	return new Promise((resolve) => {
		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			TOAST_SCRIPT,
			"-Title",
			title,
			"-Body",
			body,
			"-AppName",
			APP_NAME
		];
		execFile(exe, args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
			resolve({
				ok: !err,
				code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
				stdout: String(stdout || "").trim(),
				stderr: String(stderr || "").trim() || (err ? String(err.message || "") : ""),
				title,
				body
			});
		});
	});
}
