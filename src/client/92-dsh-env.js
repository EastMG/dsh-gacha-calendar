		//#region DSH 环境适配（外壳专属，不进 core）
		// 把 DSH 的运行环境注入上一步定义的 core env：
		//   fetchRaw      → 浏览器原生 fetch（bwiki / PRTS 等 CORS 放行的源直接抓）
		//   fetchViaProxy → 宿主代理 /api/gacha-calendar-proxy（绕过 CORS 与 Referer 反爬）
		// 换到浏览器扩展 / 原生平台时，只需替换本文件的内容，core 一行都不用改。
		const DSH_PROXY_PREFIX = "/api/gacha-calendar-proxy";

		// 直连抓取：原样转发浏览器的 fetch（response 形态不变，调用点无需改）
		async function dshFetchRaw(url, opts) {
			return fetch(url, opts);
		}

		// 经宿主代理抓取：GET/POST + referer + 可选额外请求头 → 返回目标站原始 body 字符串。
		// 宿主侧会做白名单校验（见 lib/index.js 的 PROXY_ALLOW_HOSTS），未列入白名单的主机一律拒绝。
		async function dshFetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body } = {}) {
			let api = DSH_PROXY_PREFIX + "?url=" + encodeURIComponent(proxyUrl) + "&referer=" + encodeURIComponent(referer || "");
			if (extraHeaders) api += "&headers=" + encodeURIComponent(JSON.stringify(extraHeaders));
			const opts = { headers: { "Accept": "application/json" } };
			if (body !== void 0) {
				opts.method = "POST";
				opts.headers["Content-Type"] = "application/json; charset=utf-8";
				opts.body = JSON.stringify(body);
			}
			const res = await fetch(api, opts);
			if (!res.ok) throw new Error("proxy-http-" + res.status);
			const j = await res.json();
			if (!j || j.status !== 200 || typeof j.body !== "string") throw new Error("proxy-bad:" + (j?.error || j?.status));
			return j.body;
		}

		// 默认注入一次（供直接调用 core 内部函数的场景，如回归脚本）；正式路径由 createDshEngine 注入
		const DSH_TRANSPORT = { fetchRaw: dshFetchRaw, fetchViaProxy: dshFetchViaProxy };
		setCoreEnv({ transport: DSH_TRANSPORT });

		// DSH 的存储适配：settings scope（settings.yaml 的 gacha-calendar 命名空间）→ engine 的 storage 接口。
		// engine 只认 get(key)/set(key, value)，键名沿用既有设置键，所以设置页与历史缓存都不用迁移。
		function dshStorage(scope) {
			return {
				async get(key) {
					const snap = scope.getSnapshot();
					const value = snap && snap.value ? snap.value : {};
					return value[key];
				},
				async set(key, value) {
					await scope.set(key, value);
				}
			};
		}

		// 组装 DSH 侧的 core 引擎（面板只通过它拿 Result JSON，不再自己抓取/合并）
		function createDshEngine(scope) {
			return createEngine({
				transport: DSH_TRANSPORT,
				storage: dshStorage(scope),
				now: () => Date.now()
			});
		}
		//#endregion
