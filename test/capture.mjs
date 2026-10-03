// test/capture.mjs —— 抓真实响应存成夹具
//
// 用法：node test/capture.mjs <name> <url> [referer]
//   · 走宿主代理形态抓取（模拟真实运行路径），存到 fixtures/ 下按 host 分目录
//   · 同时把 URL→夹具 的映射写进 test/map.json（已存在则跳过，不覆盖人工精确映射）
//
// ⚠️ 夹具是"某个时间点的真实响应"，源站改版后需要重抓。测试**默认离线**跑夹具，
//    另用 `node test/run.mjs --live` 打真实网络抽检夹具是否过期。

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ⚠️ 夹具就在 test/fixtures —— 不能用 HERE/..（那是仓库根；2026-10-03 从 next-sources/ 迁来时踩过）
const FIXTURES = path.join(HERE, "fixtures");
const MAP_FILE = path.join(HERE, "map.json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36";

export async function capture(name, url, referer = "") {
	mkdirSync(path.join(FIXTURES, name), { recursive: true });
	const res = await fetch(url, { headers: { "user-agent": UA, ...(referer ? { referer } : {}) } });
	const body = await res.text();
	const file = path.join(FIXTURES, name, "response.txt");
	writeFileSync(file, body, "utf8");
	writeFileSync(file + ".meta.json", JSON.stringify({ url, status: res.status, capturedAt: new Date().toISOString() }, null, 2), "utf8");
	// 映射
	let map = {};
	if (existsSync(MAP_FILE)) { try { map = JSON.parse(readFileSync(MAP_FILE, "utf8")); } catch { map = {}; } }
	if (map[url] == null) map[url] = `${name}/response.txt`;
	writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), "utf8");
	return { file, status: res.status, len: body.length };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("capture.mjs")) {
	const [, , name, url, referer] = process.argv;
	if (!name || !url) { console.error("用法: node test/capture.mjs <name> <url> [referer]"); process.exit(1); }
	const r = await capture(name, url, referer || "");
	console.log(`已抓取 ${url}\n  → ${r.file}  HTTP ${r.status}  ${r.len}B`);
}
