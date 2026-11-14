// tools/setup-hooks.mjs —— `npm run setup:hooks` 的实现（跨平台）
//
// WHY 不用 `git config core.hooksPath .githooks || true`：
//   Windows 上 npm 用 cmd.exe 跑脚本，`true` 不是命令 ⇒ git config 一旦失败，
//   报的是"`true` 不是内部或外部命令"，而不是"设置失败可以忽略"。
//   与 CI 无关，但会把第一次 clone 的人吓一跳。这里用 Node 包一层，失败只提示、退出 0。
import { execFileSync } from "node:child_process";

try {
	execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
	console.log("✓ core.hooksPath = .githooks（pre-commit：BOM 守卫 + src/lib 一致性守卫）");
} catch {
	console.log("（未能设置 core.hooksPath —— 若当前目录不是 git 仓库，可忽略）");
}
