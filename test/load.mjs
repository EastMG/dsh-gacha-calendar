// test/load.mjs —— 加载**构建产物** lib/client.js，取回 __regression（解析器 + env 工具）
//
// 为什么不再 import 源码：2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」，
// 17 个解析器从 ESM 模块压平成了 `src/client/42-parsers-*.js`（**普通拼接段**，与 30-parsers.js 同性质）。
// 普通段没有 export，所以测试改为：先 `node build.mjs`，再加载 lib/client.js 取 `exports.__regression`
// （由 src/client/44-test-exports.js 定义、99-tail.js 挂出）。这与仓库里另外 22 套门禁脚本的做法一致。
//
// 用法：
//   import { T, REPO, loadClient } from "./load.mjs";
//   const { parseSekaiGachas } = T.parsers.sekai;
//
// 注意：`T` 是模块级单例（只加载一次）；harness 的 useFixtures 会往同一实例上注入 transport。

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..");
export const FIXTURES_DIR = path.join(HERE, "fixtures");
const CLIENT = path.join(REPO, "lib", "client.js");

// 最小 DOM / 模块加载器替身。插件运行时只需要：
//   __ModuleLoader__.load({ factory })  ← 00-head.js 用它注册模块
//   localStorage / matchMedia / document（面板与设置页在**加载期**就会读到的那些）
function makeStubs() {
	let factory = null;
	const window = {
		__ModuleLoader__: { load: (m) => { factory = m.factory; } },
		setTimeout, clearTimeout, setInterval, clearInterval,
		location: { origin: "http://test.local" },
		localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
		matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
		addEventListener: () => {}, removeEventListener: () => {}
	};
	const el = () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, setAttribute: () => {}, addEventListener: () => {} });
	const document = {
		head: el(), body: el(),
		createElement: el,
		addEventListener: () => {}, removeEventListener: () => {},
		querySelector: () => null, querySelectorAll: () => []
	};
	return { window, document, getFactory: () => factory };
}

let cached = null;

export function loadClient() {
	if (cached) return cached;
	if (!existsSync(CLIENT)) {
		throw new Error(`找不到 ${CLIENT} —— 测试跑的是构建产物，请先在本仓库根目录执行： node build.mjs`);
	}
	const src = readFileSync(CLIENT, "utf8");
	const { window, document, getFactory } = makeStubs();
	// 用 new Function 而不是 import：产物是"注册进 window.__ModuleLoader__ 的工厂"，不是 ESM
	new Function("module", "exports", "window", "document", src)({ exports: {} }, {}, window, document);
	const factory = getFactory();
	if (typeof factory !== "function") throw new Error("lib/client.js 没有调用 window.__ModuleLoader__.load（产物坏了？）");
	const mod = factory(() => ({}));   // require 替身：react / react-jsx-runtime 只在渲染时才真正用到
	if (!mod || !mod.__regression) {
		throw new Error("lib/client.js 没有导出 __regression —— 请确认 src/client/44-test-exports.js 在 build.mjs 的 ORDER 里，且已重新 build");
	}
	cached = mod.__regression;
	return cached;
}

/** 解析器与 env 工具的出口（模块级单例）。 */
export const T = loadClient();
