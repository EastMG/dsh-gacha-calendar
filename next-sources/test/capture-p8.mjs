// next-sources/test/capture-p8.mjs —— P8 批次夹具抓取（bwiki 专用：限速 + 退避重试 + JSON 校验）
//
// 为什么不直接用 test/capture.mjs：
//   bwiki（EdgeOne WAF）对高频请求返回 **HTTP 567 挑战页**（~7KB JS，非 JSON，页内含 requestId）。
//   实测「不是请求头问题」（只带 UA 也能 200）→ 只能**拉长间隔 + 退避重试 + 校验 body 真是 JSON**。
//   本脚本每次请求间隔 ≥ 9s，失败按 8s→16s→32s 退避，最多 5 次；只有拿到**可解析的 JSON** 才落盘。
//
// 用法：
//   node test/capture-p8.mjs            # 幂等：夹具已存在就跳过
//   node test/capture-p8.mjs --force    # 全部重抓
//
// 落盘：fixtures/<name>/response.txt（+ .meta.json，含 capturedAt），并把 URL→夹具 追加进 test/map.json。

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const MAP_FILE = path.join(HERE, "map.json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36";
const GAP_MS = 9000;          // 相邻请求最小间隔（实测 6~10s 安全）
const FORCE = process.argv.includes("--force");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;
async function paced() {
	const wait = lastAt + GAP_MS - Date.now();
	if (wait > 0) await sleep(wait);
	lastAt = Date.now();
}

// body 是否「像一次成功响应」；返回 "" 表示 OK，否则返回原因
function bodyProblem(name, body) {
	const t = String(body || "").trim();
	if (t.length < 32) return "body 过短";
	const head = t.slice(0, 4000);
	if (/<html|EdgeOne|requestId|__waf|挑战/i.test(head)) return "疑似 WAF 挑战页（非 JSON）";
	let j = null;
	try { j = JSON.parse(t); } catch { return "非 JSON"; }
	if (/ask/.test(name) && !j.query) return "响应无 query 字段";
	if (/^p8-czn-module|^p8-kedr-template|notice|czn-module|kedr-template/.test(name)) {
		if (!j.parse && !j.error) return "响应无 parse/error 字段";
	}
	return "";
}

function register(name, url, body, status) {
	const file = path.join(FIXTURES, name, "response.txt");
	writeFileSync(file, body, "utf8");
	writeFileSync(file + ".meta.json", JSON.stringify({ url, status, capturedAt: new Date().toISOString() }, null, 2), "utf8");
	let map = {};
	if (existsSync(MAP_FILE)) { try { map = JSON.parse(readFileSync(MAP_FILE, "utf8")); } catch { map = {}; } }
	if (map[url] == null) { map[url] = `${name}/response.txt`; writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), "utf8"); }
	return file;
}

async function grab(name, url) {
	const file = path.join(FIXTURES, name, "response.txt");
	if (existsSync(file) && !FORCE) {
		const old = readFileSync(file, "utf8");
		console.log(`= ${name}：夹具已存在，跳过（${old.length}B）`);
		return old;
	}
	mkdirSync(path.join(FIXTURES, name), { recursive: true });
	let delay = 8000;
	for (let attempt = 1; attempt <= 5; attempt++) {
		await paced();
		let res = null, body = "";
		try {
			res = await fetch(url, { headers: { "user-agent": UA } });
			body = await res.text();
		} catch (e) {
			console.log(`! ${name} 第 ${attempt} 次：网络错误 ${e && e.message}`);
			await sleep(delay); delay = Math.min(delay * 2, 60000);
			continue;
		}
		const problem = res.status !== 200 ? `HTTP ${res.status}` : bodyProblem(name, body);
		if (!problem) {
			register(name, url, body, res.status);
			console.log(`✓ ${name}  HTTP 200  ${body.length}B  → fixtures/${name}/response.txt`);
			return body;
		}
		console.log(`! ${name} 第 ${attempt} 次不可用：${problem}`);
		await sleep(delay); delay = Math.min(delay * 2, 60000);
	}
	throw new Error(`${name} 抓取失败（已重试 5 次）`);
}

// ── SMW ask：取最新一条版本公告的页面名 ──
const ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query=" + encodeURIComponent(ASK_QUERY) + "&format=json";
const parseWikitextUrl = (wiki, page) =>
	`https://wiki.biligame.com/${wiki}/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;

function latestPageFromAsk(askJson) {
	const results = (askJson && askJson.query && askJson.query.results) || {};
	const rows = Object.entries(results).map(([page, v]) => {
		const raw = (v && v.printouts && v.printouts["时间"]) || [];
		const t = String(Array.isArray(raw) ? (raw[0] || "") : raw).trim();
		return { page, t };
	}).filter((x) => x.t);
	rows.sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : 0));
	return rows;
}

async function main() {
	const askBody = await grab("p8-zspms-ask", ASK_URL);
	const rows = latestPageFromAsk(JSON.parse(askBody));
	console.log(`  ask 命中 ${rows.length} 条；最新 = ${rows[0] && rows[0].page} / ${rows[0] && rows[0].t}`);
	if (!rows[0]) throw new Error("ask 无结果，无法继续抓公告正文");
	console.log(`  前 3 条：` + rows.slice(0, 3).map((x) => `${x.page}(${x.t})`).join(" | "));

	await grab("p8-zspms-notice", parseWikitextUrl("zspms", rows[0].page));
	await grab("p8-czn-module", "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json");
	await grab("p8-kedr-template", "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json");
	// 可选备选（卡厄斯「卡池记录」，只有 1 条 2026/03）
	try { await grab("p8-czn-record", parseWikitextUrl("czn", "卡池记录")); }
	catch (e) { console.log("（可选夹具 p8-czn-record 抓取失败，忽略：" + (e && e.message) + "）"); }
	console.log("\n全部完成。");
}

main().catch((e) => { console.error("抓取中断：" + (e && e.message)); process.exit(1); });
