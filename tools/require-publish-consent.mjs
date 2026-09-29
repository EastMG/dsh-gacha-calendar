#!/usr/bin/env node
// 发布门禁：没有 DSH_ALLOW_PUBLISH=1 就拒绝继续。
//
// WHY：用户 2026-09-30 明确定下流程 ——
//   改代码 + commit + push 自动做；**版本号升级 / tag / GitHub Release / npm 发布
//   一律等用户明确指令**，没有指令不自动进行。
// 光靠"我记得"是不够的：历史上就有"用户说先不发 npm，而发布命令已经执行"的事故。
// 所以把这条规则做成**硬门禁**，放在 publish:plugin / publish:core 的最前面。
//
// 用法（只有拿到用户明确指令时才这样调）：
//   PowerShell:  $env:DSH_ALLOW_PUBLISH='1'; npm run publish:plugin
//   POSIX:       DSH_ALLOW_PUBLISH=1 npm run publish:plugin
//
// 详细规则见交接说明 §0「开发流程铁律」。

const ok = process.env.DSH_ALLOW_PUBLISH === "1";

if (!ok) {
	process.stderr.write(
		[
			"",
			"==============================================================",
			"  已阻止 npm 发布：未获得本次发布的明确指令",
			"==============================================================",
			"",
			"  规则（交接说明 §0）：版本号升级 / tag / Release / npm 发布",
			"  都必须先有用户的明确指令；改代码后自动做的是 commit + push。",
			"",
			"  若用户本轮确实明确要求发布，则显式放行：",
			"    PowerShell : $env:DSH_ALLOW_PUBLISH='1'; npm run publish:plugin",
			"    POSIX      : DSH_ALLOW_PUBLISH=1 npm run publish:plugin",
			"",
		].join("\n")
	);
	process.exit(1);
}

process.stdout.write("发布门禁已放行（DSH_ALLOW_PUBLISH=1）\n");
