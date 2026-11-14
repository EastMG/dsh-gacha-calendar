// tools/check-bom.mjs —— 跨平台 BOM 守卫（pre-commit 钩子调用；也可单跑）
//
// WHY 用 Node 而不是 sh：
//   原实现是钩子里的 `... | while IFS= read -r -d '' f; do`。`read -d` 是 **bash 专有**，
//   Ubuntu 的 /bin/sh 是 dash ⇒ 直接报 `read: Illegal option -d`，循环一次都不执行，
//   守卫**静默失效**（2026-11-14 在 WSL/Ubuntu 实测：带 BOM 的文件被成功提交）。
//   macOS（bash 3.2）与 Git Bash（bash 5）支持 -d，所以只有 Linux 上坏 —— CI 又不跑钩子，
//   于是"本地钩子"这条防线在 Linux 上一直是纸糊的。改成 Node 后三平台同一份逻辑、可单测。
//
// 契约：
//   · 读暂存区（--cached）里 Added/Copied/Modified 的**文本类**文件，首 3 字节 = EF BB BF ⇒ 拦
//   · 不在 git 仓库里（手动跑）时安静退出 0
//   · 命中时退出 1，并把文件名与修复命令打到 stderr（修复命令里保留字面量 \xEF\xBB\xBF）
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";

const TEXT_EXT = new Set(["json", "js", "mjs", "cjs", "ts", "jsonc", "yml", "yaml", "md", "toml", "txt"]);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function stagedFiles() {
	try {
		const buf = execFileSync(
			"git",
			["-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"],
			{ encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] }
		);
		return buf.toString("utf8").split("\0").filter(Boolean);
	} catch {
		return [];   // 不是 git 仓库 / git 不可用 ⇒ 没有暂存区可查
	}
}

function extOf(p) {
	const i = p.lastIndexOf(".");
	return i < 0 ? "" : p.slice(i + 1).toLowerCase();
}

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function hasBom(p) {
	const fd = openSync(p, "r");
	try {
		const head = Buffer.alloc(3);
		const n = readSync(fd, head, 0, 3, 0);
		return n === 3 && head.equals(BOM);
	} finally {
		closeSync(fd);
	}
}

const hits = stagedFiles().filter((p) => TEXT_EXT.has(extOf(p)) && isFile(p) && hasBom(p));
if (hits.length === 0) process.exit(0);

process.stderr.write("ERROR: UTF-8 BOM detected in staged file(s):\n");
for (const f of hits) {
	process.stderr.write("  " + f + "\n");
	// \x 写成双反斜杠 ⇒ 打印的是**字面量** \xEF\xBB\xBF（不随 shell 的 echo/printf 语义变化）
	process.stderr.write("    Fix: strip BOM, then re-add — sed -i '1s/^\\xEF\\xBB\\xBF//' \"" + f + "\" && git add \"" + f + "\"\n");
}
process.stderr.write("  This breaks DSH plugin loading (JSON.parse does not strip BOM). Commit blocked.\n");
process.stderr.write("  (Or save the file as 'UTF-8 without BOM' in your editor.)\n");
process.exit(1);
