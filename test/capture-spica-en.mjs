// test/capture-spica-en.mjs —— OurNotes 国际服（SPICA）夹具抓取：列表页 + 数据 JSON
//
// 抓的是**两步**（与 src/client/30-game-ournotes-global.js 的抓取路径逐字对应）：
//   ① https://spica.wiki/ournotes/en/gachas         → 页面（`window._durl` 就在这里面）
//   ② https://spica.wiki + _durl                    → 数据 JSON（卡池 + 活动一次拿全）
// ① 整份原样入库（约 44 KB，和 JP 那份 spica-ournotes-gachas 同口径）；
// ② 是 1.5 MB，**机械裁剪**成只留解析器读到的字段（见 trim 说明），字段值逐字不动。
//
// 用法：
//   node test/capture-spica-en.mjs            # 幂等：夹具已存在就跳过
//   node test/capture-spica-en.mjs --force    # 重抓（`_durl` 的 hash 变了就得重抓）
//
// 落盘：test/fixtures/<name>/response.txt（+ .meta.json：url / status / capturedAt / trim），
//       并把 URL → 夹具 写进 test/map.json。

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const MAP_FILE = path.join(HERE, "map.json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36";
const PAGE_URL = "https://spica.wiki/ournotes/en/gachas";
const ORIGIN = "https://spica.wiki";
const FORCE = process.argv.includes("--force");

const PAGE_FIXTURE = "spica-en-gachas";
const DATA_FIXTURE = "spica-en-data";

async function grab(url, referer) {
	const res = await fetch(url, {
		headers: { "User-Agent": UA, Referer: referer || ORIGIN + "/", Accept: "*/*" }
	});
	const body = await res.text();
	return { status: res.status, body };
}

function register(name, url, body, status, trim) {
	mkdirSync(path.join(FIXTURES, name), { recursive: true });
	const file = path.join(FIXTURES, name, "response.txt");
	writeFileSync(file, body, "utf8");
	const meta = { url, status, capturedAt: new Date().toISOString(), bytes: Buffer.byteLength(body, "utf8"), trim };
	writeFileSync(file + ".meta.json", JSON.stringify(meta, null, 2), "utf8");
	let map = {};
	if (existsSync(MAP_FILE)) { try { map = JSON.parse(readFileSync(MAP_FILE, "utf8")); } catch { map = {}; } }
	if (map[url] == null) {
		map[url] = `${name}/response.txt`;
		writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), "utf8");
	}
	return file;
}

// ── 数据 JSON 的机械裁剪（只留解析器读到的字段；**值一个字不改**）──────────────
//   顶层：gachapages / events / members / chars / snaps（其余 40 多个键全是图鉴/歌曲/理论值，本解析器不读）
//   gachapages[]：id, name, start, end, picks          （rates / banner / ext 不读）
//   events[]：    id, slug, name, start, end, type     （story / bonus / bwh / gachas 不读）
//   members[]：   id, char                             （title / 数值 / 立绘路径不读）
//   chars：       { <charId>: { name } }               （配色 / 简介 / 生日不读）
//   snaps：       { <序号>: { id, char, chars } }        （照片标题 / 数值不读）
function trimData(raw) {
	const j = JSON.parse(raw);
	const byKeys = (v, keys) => {
		const list = Array.isArray(v) ? v : Object.values(v || {});
		return list.map((x) => {
			const out = {};
			for (const k of keys) if (x != null && x[k] !== void 0) out[k] = x[k];
			return out;
		});
	};
	const chars = {};
	for (const [k, v] of Object.entries(j.chars || {})) chars[k] = { name: v && v.name };
	const snaps = {};
	for (const [k, v] of Object.entries(j.snaps || {})) {
		snaps[k] = { id: v && v.id, char: v && v.char, chars: v && v.chars };
	}
	return JSON.stringify({
		gachapages: byKeys(j.gachapages, ["id", "name", "start", "end", "picks"]),
		events: byKeys(j.events, ["id", "slug", "name", "start", "end", "type"]),
		members: byKeys(j.members, ["id", "char"]),
		chars,
		snaps
	});
}

function durlOf(html) {
	const m = /window\._durl\s*=\s*["']([^"']+)["']/.exec(String(html || ""));
	return m ? m[1].trim() : "";
}

async function main() {
	const pageFile = path.join(FIXTURES, PAGE_FIXTURE, "response.txt");
	if (existsSync(pageFile) && !FORCE) {
		console.log(`= ${PAGE_FIXTURE}：夹具已存在，跳过（${readFileSync(pageFile, "utf8").length}B）；重抓加 --force`);
		return;
	}
	const page = await grab(PAGE_URL, ORIGIN + "/");
	if (page.status !== 200) throw new Error("页面 HTTP " + page.status);
	if (!/window\._durl/.test(page.body)) throw new Error("页面里没有 window._durl（结构变了，别落盘）");
	register(PAGE_FIXTURE, PAGE_URL, page.body, page.status,
		"整份列表页原样入库（SPA 外壳 + `window._durl` 指向的数据文件路径）。这是抓取的第一步：hash 每次都变，必须现解。");

	const durl = durlOf(page.body);
	const dataUrl = new URL(durl, ORIGIN).href;
	const data = await grab(dataUrl, PAGE_URL);
	if (data.status !== 200) throw new Error("数据 JSON HTTP " + data.status);
	const trimmed = trimData(data.body);
	if (!trimmed.includes('"gachapages"') || !trimmed.includes('"events"')) throw new Error("裁剪结果不含 gachapages/events");
	register(DATA_FIXTURE, dataUrl, trimmed, data.status,
		"顶层只留 gachapages / events / members / chars / snaps（其余图鉴/歌曲/理论值键本解析器不读）；" +
		"gachapages[] 留 id/name/start/end/picks，events[] 留 id/slug/name/start/end/type，" +
		"members[] 留 id/char，chars 留 name，snaps 留 id/char/chars —— 字段值逐字不动。");
	console.log(`✓ ${PAGE_FIXTURE} ${page.body.length}B（_durl = ${durl}）`);
	console.log(`✓ ${DATA_FIXTURE} ${data.body.length}B → 裁剪后 ${trimmed.length}B`);
}

await main();
