// test/ui/browser.mjs —— 找 Playwright / 启动 Chromium（找不到就优雅退化）
//
// 为什么要这么绕：本仓库**没有把 Playwright 写进 devDependencies**（见 test/README.md 的说明）：
// 一旦写进去，CI（ubuntu）的 `npm ci` 就会拖一份浏览器依赖下来，而 UI harness 明确不进 CI。
// 所以运行时按下面的顺序探测，任何一步失败都**不是错误**，只意味着"这台机器上跑不了 UI harness"：
//
//   ① `import("playwright")`      —— 本机装过（全局 / 本仓库 node_modules，被 .gitignore 挡住）
//   ② `import("playwright-core")` —— 只装了 core（没有浏览器下载器）
//   ③ npx 缓存里的 playwright     —— 跑过 `npx --yes playwright@1 --version` 就有
//   ④ 启动：Playwright 自带 chromium → 本机 Chrome/Edge（executablePath）→ channel=msedge
//
// 全都不行 ⇒ harness.mjs 走 report.skip()：打印怎么装 + `结果：0 通过 / 0 失败（已跳过）` + exit 0。
// **绝不能**因为"这台机器没浏览器"让谁的门禁变红 —— 它本来就不在默认门禁里。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function pkgVersionNear(file) {
	let dir = path.dirname(file);
	for (let i = 0; i < 6; i++) {
		const p = path.join(dir, "package.json");
		if (existsSync(p)) {
			try {
				const j = JSON.parse(readFileSync(p, "utf8"));
				if (j && j.name && j.version) return `${j.name}@${j.version}`;
			} catch { /* 继续往上找 */ }
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return null;
}

/** 本机装过的 playwright / playwright-core（按 ①② 探测）。 */
function tryLocalImports() {
	const out = [];
	for (const name of ["playwright", "playwright-core"]) {
		try {
			const req = createRequire(path.join(HERE, "harness.mjs"));
			const entry = req.resolve(name);
			out.push({ name, entry });
		} catch { /* 没装 */ }
	}
	return out;
}

/** npx 缓存里的 playwright（`npx --yes playwright@1 --version` 之后就有）。 */
function npxCacheCandidates() {
	const roots = [];
	const local = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || "";
	const appdata = process.env.APPDATA || "";
	const home = process.env.HOME || process.env.USERPROFILE || "";
	roots.push(path.join(local, "npm-cache", "_npx"));
	roots.push(path.join(appdata, "npm-cache", "_npx"));
	roots.push(path.join(home, ".npm", "_npx"));
	const found = [];
	for (const root of roots) {
		if (!root || !existsSync(root)) continue;
		let dirs = [];
		try { dirs = readdirSync(root); } catch { continue; }
		for (const d of dirs) {
			const entry = path.join(root, d, "node_modules", "playwright", "index.mjs");
			if (existsSync(entry)) found.push(entry);
			const coreEntry = path.join(root, d, "node_modules", "playwright-core", "index.mjs");
			if (existsSync(coreEntry)) found.push(coreEntry);
		}
	}
	return found;
}

/**
 * 解析出可用的 Playwright 模块。
 * @returns {Promise<null | { mod: any, source: string, version: string|null }>}
 */
export async function resolvePlaywright() {
	for (const { name, entry } of tryLocalImports()) {
		try {
			const mod = await import(pathToFileURL(entry).href);
			if (mod && mod.chromium) return { mod, source: `${name}（${entry}）`, version: pkgVersionNear(entry) };
		} catch { /* 继续往下试 */ }
	}
	for (const entry of npxCacheCandidates()) {
		try {
			const mod = await import(pathToFileURL(entry).href);
			if (mod && mod.chromium) return { mod, source: `npx 缓存（${entry}）`, version: pkgVersionNear(entry) };
		} catch { /* 继续 */ }
	}
	return null;
}

/** 本机可能存在的 Chromium 系浏览器（Playwright 的 executablePath 兜底）。 */
export function candidateExecutables() {
	const out = [];
	const push = (p) => { if (p && existsSync(p) && !out.includes(p)) out.push(p); };
	push(process.env.CHROME_PATH);
	push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
	const pf = process.env.PROGRAMFILES || "C:\\Program Files";
	const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
	const localApp = process.env.LOCALAPPDATA || "";
	push(path.join(pf, "Google", "Chrome", "Application", "chrome.exe"));
	push(path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"));
	push(path.join(localApp, "Google", "Chrome", "Application", "chrome.exe"));
	push(path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"));
	push(path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"));
	return out;
}

/**
 * 依次尝试"自带 chromium → 本机 Chrome/Edge → channel=msedge"。
 * @returns {Promise<{ browser: any } | { browser: null, attempts: string[] }>}
 */
export async function launchChromium(resolved) {
	const chromium = resolved.mod.chromium;
	const attempts = [];
	const tries = [{ how: "Playwright 自带 chromium", opts: { headless: true } }];
	for (const exe of candidateExecutables()) tries.push({ how: "executablePath=" + exe, opts: { headless: true, executablePath: exe } });
	tries.push({ how: "channel=msedge", opts: { headless: true, channel: "msedge" } });
	tries.push({ how: "channel=chrome", opts: { headless: true, channel: "chrome" } });

	for (const t of tries) {
		try {
			const browser = await chromium.launch(t.opts);
			return { browser, how: t.how };
		} catch (e) {
			const msg = String((e && e.message) || e).split("\n").filter(Boolean).slice(0, 2).join(" / ");
			attempts.push(`${t.how} → ${msg}`);
		}
	}
	return { browser: null, attempts };
}
