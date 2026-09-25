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

		// 解析本插件的设置条目 id：从 configForms 的 describe 镜像里读**宿主真正 serve 的** namespace 列表，
		// 在候选里挑第一个匹配。为什么不能直接写死：0.1.7 按条目 id 寻址，而条目 id、包名、插件名
		// 三者未必同名；写死一旦对不上，表现就是"表单永远 unavailable、所有写入被拒、
		// 面板只显示 schema 默认值"——症状和"数据被清空"极像，其实只是地址找错了。
		// 拿不到镜像时回退到第一个候选，保持原行为、不更坏。
		function listServedNamespaces(configForms) {
			try {
				const mirror = configForms && typeof configForms.describe === "function" ? configForms.describe() : null;
				const view = mirror && typeof mirror.getSnapshot === "function" ? mirror.getSnapshot().view : null;
				const rows = view && Array.isArray(view.namespaces) ? view.namespaces : [];
				return rows.map((r) => r && r.ns).filter((ns) => typeof ns === "string");
			} catch (e) {
				return [];
			}
		}
		function resolveSettingsEntryId(configForms, candidates) {
			const served = listServedNamespaces(configForms);
			for (const id of candidates) if (served.indexOf(id) >= 0) return id;
			return candidates[0];
		}

		// DSH 的存储适配：插件配置表单（profile 条目 id）→ engine 的 storage 接口。
		// engine 只认 get(key)/set(key, value)，键名沿用既有设置键，所以设置页与历史缓存都不用迁移。
		//
		// DSH 0.1.7 起这个表单由 `configForms` 服务给出（旧名 `settingsScope`，已改名），
		// 快照形态也从「恒有 value」变成带状态机的 `{ status, value, base, user, revision, writable, mode }`：
		// 只有 status === "ready" 时 value 才可信（其余是 loading / unavailable）。
		// 取不到值一律回 undefined —— engine 会把 undefined 回落成 DEFAULT_SETTINGS，
		// 绝不能回落成 {} 之外的东西，否则"读不到"会被当成"读到了空配置"。
		function dshStorage(scope) {
			return {
				async get(key) {
					const snap = scope.getSnapshot();
					if (!snap || snap.status !== "ready") return undefined;
					const value = snap.value;
					if (!value || typeof value !== "object") return undefined;
					return value[key];
				},
				async set(key, value) {
					// set 返回"宿主是否接受本次写入"；engine 不消费该布尔值，
					// 但失败时抛错比静默丢数据好（静默会把"没存上"伪装成"已存"）。
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error("settings-write-rejected:" + key);
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
