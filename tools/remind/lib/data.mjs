// tools/remind/lib/data.mjs —— 数据来源：缓存优先，过期 / --refresh 才让 core 抓一轮
//
// 路径（缓存同目录 = 所有运行产物的家）：
//   %LOCALAPPDATA%\dsh-gacha-calendar\
//     cache.json          数据缓存 { at, source, data }（at = 写盘毫秒时间戳）
//     state.json          去重状态（由 lib/state.mjs 读写）
//     remind.log          运行日志（由 remind.mjs 追加）
//     remind-config.json  节点配置（可选，用户覆盖；见 lib/config.mjs）
//
// 环境变量 DSH_GACHA_CALENDAR_DIR 可整体改目录 —— 只给测试 / 宿主集成用，正常安装不要设。
//
// 与 demo-simple.mjs 的关系：缓存读写、TTL 判定、core 引擎注入**原样复用**（那份是跑通过的），
// 差别只有两点：① 不再在 data 里做判定；② 返回值带上 tz 注册表，交给 derive.mjs。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEngine } from "../../../packages/core/core.mjs";

/** 所有运行产物的目录（默认 `%LOCALAPPDATA%\dsh-gacha-calendar`）。 */
export const DATA_DIR = resolveDataDir();

export const CACHE_FILE = path.join(DATA_DIR, "cache.json");
export const STATE_FILE = path.join(DATA_DIR, "state.json");
export const LOG_FILE = path.join(DATA_DIR, "remind.log");
export const CONFIG_FILE = path.join(DATA_DIR, "remind-config.json");

function resolveDataDir() {
	const override = String(process.env.DSH_GACHA_CALENDAR_DIR || "").trim();
	if (override) return path.resolve(override);
	const local = String(process.env.LOCALAPPDATA || "").trim();
	if (local) return path.join(local, "dsh-gacha-calendar");
	if (process.platform === "win32") return path.join(os.homedir(), "AppData", "Local", "dsh-gacha-calendar");
	// 非 Windows：给一个 XDG 落点，tick/derive 仍然可用（送达仍只有 Windows 有实现）
	const xdg = String(process.env.XDG_DATA_HOME || "").trim();
	return path.join(xdg || path.join(os.homedir(), ".local", "share"), "dsh-gacha-calendar");
}

/**
 * 读缓存。四种结果：ok / missing / invalid（损坏一律当"没有缓存"，不猜、不降级）。
 *
 * @returns {{ kind: "ok", at: number, source: string, data: Record<string, unknown> }
 *   | { kind: "missing" } | { kind: "invalid", detail: string }}
 */
export function readCache() {
	let text;
	try {
		text = readFileSync(CACHE_FILE, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") return { kind: "missing" };
		return { kind: "invalid", detail: String((err && err.message) || err) };
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { kind: "invalid", detail: "不是合法 JSON（" + String((err && err.message) || err) + "）" };
	}
	if (!parsed || typeof parsed !== "object") return { kind: "invalid", detail: "顶层不是对象" };
	if (!Number.isFinite(parsed.at)) return { kind: "invalid", detail: "缺 at 时间戳" };
	const data = parsed.data;
	if (!data || typeof data !== "object") return { kind: "invalid", detail: "缺 data" };
	if (!data.games || typeof data.games !== "object") return { kind: "invalid", detail: "data.games 不是对象" };
	return { kind: "ok", at: Number(parsed.at), source: String(parsed.source || ""), data };
}

/**
 * 写缓存：先写同目录 .tmp 再 rename —— 中途崩了也不会留下半截 JSON。
 * @param {Record<string, unknown>} data core.refresh() 的原样返回值
 * @returns {number} 写盘时刻的毫秒时间戳（下一轮算 TTL 的起点）
 */
export function writeCache(data) {
	mkdirSync(DATA_DIR, { recursive: true });
	const at = Date.now();
	const body = JSON.stringify({ at, source: "core", data }, null, 2) + "\n";
	const tmp = CACHE_FILE + ".tmp";
	writeFileSync(tmp, body, "utf8");
	renameSync(tmp, CACHE_FILE);
	return at;
}

function createCoreEngine() {
	// 引擎实例只用来抓数据；建实例本身不联网（tz 注册表是代码元信息，本地就有）。
	return createEngine({
		transport: {
			async fetchRaw(url, opts) {
				return fetch(url, opts);
			},
			async fetchViaProxy(url, { referer, headers, body, contentType } = {}) {
				const h = { Accept: "application/json" };
				if (referer) h.Referer = referer;
				if (headers && typeof headers === "object") Object.assign(h, headers);
				const init = { headers: h, method: body !== void 0 ? "POST" : "GET" };
				if (body !== void 0) {
					const ct = contentType || "application/json; charset=utf-8";
					h["Content-Type"] = ct;
					init.body = typeof body === "string" ? body : JSON.stringify(body);
				}
				const res = await fetch(url, init);
				if (!res.ok) throw new Error("proxy-http-" + res.status);
				return await res.text();
			}
		},
		// 一轮数据就够：内存 Map，不落盘（缓存由本文件自己写）
		storage: (() => {
			const map = new Map();
			return {
				async get(key) {
					return map.get(key);
				},
				async set(key, value) {
					map.set(key, value);
				}
			};
		})(),
		now: () => Date.now()
	});
}

/**
 * 取一轮数据：命中缓存就不发网络请求；否则让 core 抓一次并写回缓存。
 * 抓取失败**向上抛**（由 remind.mjs 记日志并 exit 1）—— 不静默降级成"没数据"。
 *
 * @param {{ now?: number, ttlHours?: number, refresh?: boolean }} [opts]
 * @returns {Promise<{
 *   data: Record<string, unknown>,
 *   tzById: Map<string, unknown>,
 *   hiddenIds: string[],
 *   origin: "cache" | "fetch",
 *   reasonToFetch: string,
 *   cacheAt: number | null,
 *   cacheAgeMs: number,
 *   fetchMs: number,
 *   gamesCount: number,
 *   downCount: number
 * }>}
 */
export async function loadData({ now = Date.now(), ttlHours = 6, refresh = false } = {}) {
	const nowTs = Number(now);
	const engine = createCoreEngine();
	const sources = (engine.__test && engine.__test.SOURCES) || [];
	const tzById = new Map(sources.map((s) => [s.id, s.tz === void 0 ? null : s.tz]));
	const hiddenIds = sources.filter((s) => s.defaultHidden).map((s) => s.id);

	const cached = readCache();
	const ttlMs = ttlHours * 3600000;
	let reasonToFetch = "";
	let cacheAgeMs = -1;

	if (refresh) reasonToFetch = "--refresh 强制刷新";
	else if (cached.kind === "missing") reasonToFetch = "缓存不存在";
	else if (cached.kind === "invalid") reasonToFetch = "缓存损坏（" + cached.detail + "）";
	else {
		cacheAgeMs = Math.max(0, nowTs - cached.at);
		if (cacheAgeMs >= ttlMs) reasonToFetch = "缓存过期（" + Math.floor(cacheAgeMs / 60000) + " 分钟 > TTL " + ttlHours + " 小时）";
	}

	let data;
	let origin;
	let cacheAt = cached.kind === "ok" ? cached.at : null;
	let fetchMs = 0;

	if (reasonToFetch) {
		const t0 = Date.now();
		data = await engine.refresh();
		fetchMs = Date.now() - t0;
		cacheAt = writeCache(data);
		cacheAgeMs = 0;
		origin = "fetch";
	} else {
		data = cached.data;
		origin = "cache";
	}

	const games = (data && data.games) || {};
	const downCount = Object.values(games).filter(
		(g) => g && ((g.gachaFail && g.gachaFail.kind === "down") || (g.eventFail && g.eventFail.kind === "down"))
	).length;

	return {
		data,
		tzById,
		hiddenIds,
		origin,
		reasonToFetch,
		cacheAt,
		cacheAgeMs,
		fetchMs,
		gamesCount: Object.keys(games).length,
		downCount
	};
}
