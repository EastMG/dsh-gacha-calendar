// next-sources/test/harness.mjs —— 离线夹具测试框架
//
// 为什么这样设计：解析器必须能**离线复跑**（不依赖实时网络），否则源站一改版测试就假失败。
// 做法：把真实响应存成夹具文件，测试时把 fetch 换成"按 URL 查夹具"的实现。
//
// 夹具约定（fixtures/<source>/<name>）：纯文本 = 响应体；
//   若同目录存在 <name>.meta.json，则读取其中的 { status, url }（默认 status=200）。
//   URL 映射写在 test/map.json：{ "<url 或 url 前缀>": "<source>/<name>" }
//
// 用法：node test/run.mjs [--live]
//   --live：跳过夹具，打真实网络（用于"夹具是否已过期"的抽检，不作为门禁）

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setFetchImpl } from "../lib/env.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const MAP_FILE = path.join(HERE, "map.json");

let pass = 0, fail = 0;
const failures = [];

export function check(name, ok, detail) {
	if (ok) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? "   -> " + detail : ""}`); }
}
export function section(title) { console.log(`\n--- ${title} ---`); }

// 建立一个"夹具模式的 fetch"
export function useFixtures(overrides = {}) {
	const map = Object.assign({}, JSON.parse(readFileSync(MAP_FILE, "utf8")), overrides);
	const impl = async (url) => {
		const u = String(url);
		// 代理前缀 → 取被代理的真实 url
		let target = u;
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			try { target = new URL("http://x" + u).searchParams.get("url") || u; } catch { /* keep */ }
		}
		// 精确 → 前缀 → 带 origin=* 去掉后 再匹配
		const candidates = [target, target.replace(/[?&]origin=\*/, ""), u];
		let hit = null;
		for (const c of candidates) {
			if (map[c] != null) { hit = map[c]; break; }
			const key = Object.keys(map).find((k) => c.startsWith(k));
			if (key) { hit = map[key]; break; }
		}
		if (!hit) {
			return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		}
		const file = path.join(FIXTURES, hit);
		if (!existsSync(file)) {
			return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		}
		const body = readFileSync(file, "utf8");
		const metaFile = file + ".meta.json";
		const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
		const status = meta.status || 200;
		// 代理响应需要包一层 { status, body }
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			const proxyBody = JSON.stringify({ status, body });
			return {
				ok: true, status: 200,
				headers: { get: () => "application/json" },
				text: async () => proxyBody,
				json: async () => JSON.parse(proxyBody)
			};
		}
		return {
			ok: status >= 200 && status < 300, status,
			headers: { get: () => "text/html" },
			text: async () => body,
			json: async () => JSON.parse(body)
		};
	};
	setFetchImpl(impl);
	return impl;
}

// 列出所有夹具（用于"夹具覆盖度"守卫）
export function listFixtures() {
	if (!existsSync(FIXTURES)) return [];
	const out = [];
	for (const d of readdirSync(FIXTURES)) {
		const dir = path.join(FIXTURES, d);
		if (!statSync(dir).isDirectory()) continue;
		for (const f of readdirSync(dir)) {
			if (f.endsWith(".meta.json")) continue;
			out.push(d + "/" + f);
		}
	}
	return out;
}

// 所有解析器必须满足的契约守卫：返回对象形状 / 类型
export function assertContract(label, side, data) {
	if (data == null) return true;   // null = 未公布，合法
	if (typeof data !== "object") { check(`${label} 返回对象或 null`, false, typeof data); return false; }
	if (side === "gacha") {
		check(`${label} 卡池侧带 banner`, typeof data.banner === "string" && data.banner.length > 0, JSON.stringify(data.banner));
		check(`${label} 卡池侧带 bannerDates`, typeof data.bannerDates === "string" && data.bannerDates.length > 0, JSON.stringify(data.bannerDates));
		check(`${label} 卡池侧 bannerDates 形如 "MM-DD HH:MM ~ MM-DD HH:MM"`,
			/^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/.test(data.bannerDates), data.bannerDates);
		if (data.startTs != null) check(`${label} startTs 是数字`, typeof data.startTs === "number", typeof data.startTs);
		if (data.endTs != null) check(`${label} endTs 是数字`, typeof data.endTs === "number", typeof data.endTs);
		if (data.startTs != null && data.endTs != null) {
			check(`${label} endTs > startTs`, data.endTs > data.startTs, `${data.startTs} → ${data.endTs}`);
		}
	} else {
		check(`${label} 活动侧带 event`, typeof data.event === "string" && data.event.length > 0, JSON.stringify(data.event));
		check(`${label} 活动侧带 eventDates`, typeof data.eventDates === "string" && data.eventDates.length > 0, JSON.stringify(data.eventDates));
	}
	return true;
}

export function summary() {
	console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
	if (failures.length) console.log("失败项：" + failures.join(" | "));
	process.exit(fail === 0 ? 0 : 1);
}
export function counts() { return { pass, fail }; }
