// Host-side entry for dsh-gacha-calendar.
// 1) Registers the settings namespace so the browser half's Settings > 二游排期
//    section can read/write persisted config through the settings scope.
// 2) Registers a same-origin HTTP proxy route on DSH's webServer so the browser
//    half can fetch external sources that block cross-origin browser requests
//    (CORS / Referer anti-scrape) — the host runs Node fetch with full control
//    over headers, bypassing browser-only restrictions.
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

/** Settings namespace persisted through DSH Settings. */
const GACHA_NAMESPACE = "gacha-calendar";

/** Route prefix owned by this plugin on DSH's webServer. */
const PROXY_PREFIX = "/api/gacha-calendar-proxy";

/**
 * Proxy allow-list: only these hostnames may be fetched through the proxy
 * (SSRF guard — the route otherwise becomes an arbitrary-server requestor).
 * Entry matches the hostname exactly or any subdomain of it.
 */
const PROXY_ALLOW_HOSTS = [
	"forum.nexon.com",
	"endfield.wiki.gg",
	"endfield.hypergryph.com",
	"end.canmoe.com",
	"wiki.biligame.com",
	"prts.wiki",
	"gachatracker.app",
	"www.gamekee.com",
	"api-cdn.gamekee.com",
	"bluearchive-cn.com",
	"re.bluepoch.com",
	"game.xiaomi.com"
];

/** Default outgoing request headers (browser-like, to satisfy anti-scrape). */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"access-control-allow-origin": "*"
	});
	res.end(body);
}

/** Check a target hostname against the allow-list (exact or subdomain). */
function hostAllowed(hostname) {
	return PROXY_ALLOW_HOSTS.some((allow) => hostname === allow || hostname.endsWith("." + allow));
}

/**
 * Same-origin proxy handler: `GET/POST /api/gacha-calendar-proxy?url=<enc>&referer=<enc>`
 * fetches `url` from the host (Node fetch, no CORS), sends back
 * `{ status, contentType, body }` JSON. `referer` overrides the outgoing
 * Referer header when the target checks it (nexon/wiki.gg style anti-scrape).
 * POST 请求体（JSON）原样透传给目标（如重返未来官网资讯 API 需要 POST body）。
 */
async function proxyHandler(req, res) {
	let parsed;
	try {
		parsed = new URL(req.url ?? "/", "http://dsh.internal");
	} catch {
		sendJson(res, 400, { error: "bad-request" });
		return;
	}
	const targetRaw = parsed.searchParams.get("url");
	if (!targetRaw) {
		sendJson(res, 400, { error: "missing url" });
		return;
	}
	let target;
	try {
		target = new URL(targetRaw);
	} catch {
		sendJson(res, 400, { error: "invalid url" });
		return;
	}
	if (!hostAllowed(target.hostname)) {
		sendJson(res, 403, { error: `host not allowed: ${target.hostname}` });
		return;
	}
	const referer = parsed.searchParams.get("referer") || target.origin + "/";
	const headers = {
		"User-Agent": UA,
		Accept: "application/json, text/plain, */*",
		Referer: referer,
		Origin: target.origin
	};
	// 可选额外头（JSON）：如 GameKee 需 "game-alias":"ba"
	const extra = parsed.searchParams.get("headers");
	if (extra) {
		try {
			const obj = JSON.parse(extra);
			if (obj && typeof obj === "object") {
				for (const [k, v] of Object.entries(obj)) {
					if (typeof v === "string" || typeof v === "number") headers[k] = String(v);
				}
			}
		} catch { /* ignore malformed headers param */ }
	}
	// POST 时读取请求体（JSON 原样透传），目标以 POST + body 请求
	let body = "";
	if (req.method === "POST") {
		body = await new Promise((resolve) => {
			let data = "";
			req.on("data", (chunk) => {
				data += chunk;
				if (data.length > 2 * 1024 * 1024) req.destroy();
			});
			req.on("end", () => resolve(data));
			req.on("error", () => resolve(data));
		});
	}
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		const fetchOpts = { headers, signal: controller.signal, redirect: "follow" };
		if (body !== "") {
			headers["Content-Type"] = parsed.searchParams.get("contentType") || "application/json; charset=utf-8";
			fetchOpts.method = "POST";
			fetchOpts.body = body;
		}
		const response = await fetch(target, fetchOpts);
		clearTimeout(timeout);
		const responseBody = await response.text();
		sendJson(res, 200, {
			status: response.status,
			contentType: response.headers.get("content-type") ?? "",
			body: responseBody
		});
	} catch (err) {
		sendJson(res, 502, { error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) });
	}
}

/** Cordis configuration schema for this plugin's persisted settings. */
const Config = z.object({
	autoRefresh: z.boolean().default(true),
	refreshMinutes: z.number().min(1).max(60480).default(1440),
	order: z.array(z.string()).default([]),
	lastRefresh: z.number().default(0),
	lastSource: z.string().default("builtin"),
	lastData: z.string().default(""),
	hidden: z.array(z.string()).default([]),
	removed: z.array(z.string()).default([]),
	customUrls: z.string().default("{}"),
	customEventUrls: z.string().default("{}"),
	customEntries: z.string().default("[]")
});

/** Required services (host side). */
const inject = ["webServer"];

export function apply(ctx, config = {}) {
	installSettingsSection(ctx, settingsNamespace(GACHA_NAMESPACE), Config, config, {
		// hooks 为 dsh-settings 要求的回调位（source 同步 / 配置变更通知），当前版本无需额外处理
		setSource: () => {},
		onChange: () => {}
	});
	ctx.inject(["webServer"], (injected) => {
		const webServer = injected.get("webServer");
		if (webServer === void 0) return;
		return webServer.register({
			kind: "prefixes",
			path: PROXY_PREFIX,
			handler: proxyHandler
		});
	});
}

export { inject };
