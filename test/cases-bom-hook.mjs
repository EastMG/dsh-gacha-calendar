// test/cases-bom-hook.mjs —— 跨平台 BOM 守卫（tools/check-bom.mjs + .githooks/pre-commit）
//
// ── 为什么需要它 ──
// 2026-11-14 跨系统审查发现：钩子里的 BOM 扫描用 `read -r -d ''`（bash 专有），
// Ubuntu 的 /bin/sh = dash ⇒ `read: Illegal option -d` ⇒ 循环不执行、守卫**静默放行**
// （WSL 实测：带 BOM 的文件被 git commit 成功）。macOS（bash3.2）与 Git Bash（bash5）正常，
// 所以这个洞只在 Linux 上开；CI 又不跑钩子，于是没人发现。
//
// 修法：扫描逻辑搬到 tools/check-bom.mjs（Node，三平台同一份），钩子只调用它。
// 本段守三件事：
//   ① 脚本行为：暂存 BOM 文本 ⇒ exit 1 + 报文件名 + 修复命令里是**字面量** \xEF\xBB\xBF；
//      干净文本 ⇒ 0；非文本扩展名（.png）⇒ 0；不在 git 仓库里 ⇒ 0（安静退出）
//   ② 钩子不再用 `read -d`，且确实调用 tools/check-bom.mjs
//   ③ `npm run setup:hooks` 是 Node 实现（Windows cmd.exe 没有 `true` 命令）
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHECKER = path.join(ROOT, "tools", "check-bom.mjs");

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const runChecker = (cwd) => {
	try {
		const out = execFileSync(process.execPath, [CHECKER], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { status: 0, stdout: out, stderr: "" };
	} catch (e) {
		return { status: e.status == null ? -1 : e.status, stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
	}
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export default async function runBomHook() {
	section("BOM 守卫（tools/check-bom.mjs / pre-commit）：三平台同一份逻辑 + 字面量修复命令");
	{
		const dir = mkdtempSync(path.join(tmpdir(), "dsh-bom-"));
		try {
			git(dir, "init", "-q");
			git(dir, "config", "user.email", "t@example.invalid");
			git(dir, "config", "user.name", "t");

			// ① 带 BOM 的文本文件 ⇒ exit 1
			writeFileSync(path.join(dir, "bom.txt"), Buffer.concat([BOM, Buffer.from("hello\n")]));
			git(dir, "add", "bom.txt");
			const bad = runChecker(dir);
			check("暂存 BOM 文本 ⇒ exit 1", bad.status === 1, String(bad.status));
			check("报出文件名", /bom\.txt/.test(bad.stderr), bad.stderr.split("\n")[1] || "");
			check("修复命令里是**字面量** \\xEF\\xBB\\xBF（不是真正的 BOM 字符）",
				bad.stderr.includes("\\xEF\\xBB\\xBF") && !bad.stderr.includes("\uFEFF"), JSON.stringify(bad.stderr.slice(0, 160)));

			// ② 去掉 BOM ⇒ exit 0
			writeFileSync(path.join(dir, "bom.txt"), "hello\n");
			git(dir, "add", "bom.txt");
			const ok = runChecker(dir);
			check("干净文本 ⇒ exit 0", ok.status === 0, String(ok.status));

			// ③ 非文本扩展名即使有 BOM 也不管 ⇒ exit 0
			writeFileSync(path.join(dir, "img.png"), Buffer.concat([BOM, Buffer.from([1, 2, 3])]));
			git(dir, "add", "img.png");
			const png = runChecker(dir);
			check("非文本扩展名（.png）⇒ 跳过、exit 0", png.status === 0, String(png.status));

			// ④ 不在 git 仓库里 ⇒ 安静退出 0
			const plain = mkdtempSync(path.join(tmpdir(), "dsh-bom-plain-"));
			try {
				const none = runChecker(plain);
				check("非 git 目录 ⇒ exit 0（不抛）", none.status === 0, String(none.status));
			} finally {
				rmSync(plain, { recursive: true, force: true });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		// ⑤ 钩子静态：不再用 bash 专有的 read -d；确实调用 Node 检查器
		const fs = await import("node:fs");
		const hook = fs.readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf8");
		// 只看**代码行**（注释里会引用旧写法来解释历史，那是好事）
		const hookCode = hook.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
		check("钩子代码里不再用 `read -r -d ''`（dash 不支持 ⇒ Linux 上会静默失效）",
			!hookCode.includes("read -r -d ''"), hookCode.slice(0, 0));
		check("钩子调用 tools/check-bom.mjs", hook.includes("tools/check-bom.mjs"));

		// ⑥ setup:hooks 是 Node 实现（Windows cmd.exe 没有 `true`）
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
		check("setup:hooks 改为 Node 脚本（不再 `|| true`）",
			/^node tools\/setup-hooks\.mjs$/.test(pkg.scripts["setup:hooks"] || ""), pkg.scripts["setup:hooks"]);
		check("check:bom 脚本存在", pkg.scripts["check:bom"] === "node tools/check-bom.mjs", pkg.scripts["check:bom"]);
	}
}
