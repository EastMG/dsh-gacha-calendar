		//#region components
		// 本插件在 DSH 设置面板里的导航名；面板按钮与弹层标题也用它（唯一事实来源，90-plugin.js 注册分区时共用）。
		const SETTINGS_SECTION_LABEL = "\u4E8C\u6E38\u65E5\u5386";
		// 面板上那个「设置」按钮：**临时隐藏**（用户要求）。函数与样式都保留，
		// 改回 true 即可恢复，不用重写逻辑。
		const SETTINGS_BUTTON_VISIBLE = false;
		// DSH 设置面板是"点了才挂载"，打开后要等导航渲染出来才能切页；预算给足但不无限等。
		const SETTINGS_NAV_TIMEOUT_MS = 600;
		const SETTINGS_NAV_POLL_MS = 30;
		// 设置页游戏列表的「提醒」列：**暂时隐藏**（用户要求，不是删除）。
		// 暂时隐藏：送达功能未实现 —— 这一列是「到期提醒（送达）」的逐游戏白名单（配置键 `remindGames`），
		// 送达还没做，勾了没有任何效果，摆在那儿只会让人以为勾了就真会提醒。
		// 恢复：改回 `true` 即可 —— 表头列标题 / 每行复选框 / 「全部提醒」按钮 / 表头上方概括 /
		// 网格列宽五处全部由它 gate；`remindGames` 配置键、schema、CONFIG_KEYS、纯函数
		// `remindGameAllowed` 与写入链路（setEntryRemind / resetRemindAll）都原样保留，不用重写逻辑。
		const SHOW_REMIND_COLUMN = false;
		// 游戏列表网格列宽 = 游戏 / 展示 / [提醒] / 卡池来源 / 活动来源 / 颜色 / 操作。
		// 隐藏「提醒」时把对应那一格（28px）从模板里**去掉**：留空列会把后面各列整体错位。
		const SETTINGS_GAME_GRID = SHOW_REMIND_COLUMN
			? "minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px"
			: "minmax(0,1.15fr) 28px minmax(0,1fr) minmax(0,1fr) 34px 88px";

		// 打开 DSH 设置面板并切到本插件的分区（面板上的「设置」按钮用，注释见按钮处）。
		// DSH 没有给插件"跳转设置页"的官方 API：面板是 modal，open 与 activeId 都是组件私有 state，
		// 且 activeId 每次打开都重置为 undefined，面板按 rows[0] 兜底（= 导航第一项）。所以只能：
		// ① 点侧边栏那个设置触发器；② 等面板挂载出来，按导航名点本插件那一项。
		function openPluginSettingsSection() {
			const all = [...document.querySelectorAll('[aria-haspopup="dialog"]')];
			const visible = all.filter((el) => typeof el.getClientRects === "function" && el.getClientRects().length > 0);
			const named = visible.find((el) => {
				const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
				return /\u8BBE\u7F6E|\u8A2D\u5B9A|Settings/i.test(label);
			});
			const trigger = named || visible[0] || all[0];
			if (!trigger || typeof trigger.click !== "function") return;
			trigger.click();
			const deadline = Date.now() + SETTINGS_NAV_TIMEOUT_MS;
			// 在给定根节点里找「二游排期」那一项：先按 aria-label，再按自身文本。
			// 不写死 `nav button` 结构 —— 设置外壳换布局时（0.1.7 把插件配置挪到了
			// 「插件」页）这种硬结构选择器会静默失效，表现为"点设置跳错页"。
			//
			// 必须排除本插件自己的面板：面板的开关按钮 aria-label 就是同一个标签，
			// 文档级兜底会先命中它 → 点下去变成"自己开自己"（典型症状：点设置没反应/跳错）。
			const inOwnPanel = (el) => {
				for (let n = el; n; n = n.parent) if (n.classList && n.classList.contains("gacha-cal-pop")) return true;
				return false;
			};
			const findItem = (root) => {
				if (!root || typeof root.querySelectorAll !== "function") return null;
				const items = [...root.querySelectorAll("button, a")]
					.filter((el) => el !== trigger && !inOwnPanel(el));
				const byAttr = items.find((el) => {
					const l = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
					return l === SETTINGS_SECTION_LABEL;
				});
				if (byAttr) return byAttr;
				return items.find((el) => (el.textContent || "").trim() === SETTINGS_SECTION_LABEL) || null;
			};
			const tick = () => {
				// 只在设置面板（dialog）里找，**不做整篇文档的兜底搜索**：
				// 本插件面板的开关按钮 aria-label 就是同一个标签，文档级搜索会先命中它，
				// 一点就变成"自己把自己打开"（实测就是这样：点设置只弹本插件面板、不跳页）。
				const dialogs = [...document.querySelectorAll('[role="dialog"]')];
				for (const d of dialogs) {
					const hit = findItem(d);
					if (hit) { hit.click(); return; }
				}
				if (Date.now() < deadline) window.setTimeout(tick, SETTINGS_NAV_POLL_MS);
			};
			window.setTimeout(tick, 0);
		}

		// ── 浏览器侧"下载一段文本"（排期导出 .ics 用，待办第 5 项）──
		// 为什么走 Blob + a[download] 而不是新增宿主路由：`.ics` 只是**一次性快照**，
		// 走一条 HTTP 路由等于平白多一处要鉴权、要防 SSRF/目录穿越的公开面（本项目已有 4 条路由），
		// 而浏览器原生就能存文件 —— 少一条面就少一处将来会被忘记审查的代码。
		// 返回 true = 已经触发下载；false = 环境不支持（非浏览器 / Blob 被禁用）。
		function downloadTextFile(fileName, text, mime) {
			try {
				const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = fileName;
				a.rel = "noopener";
				a.style.display = "none";
				document.body.appendChild(a);
				a.click();
				if (a.parentNode) a.parentNode.removeChild(a);
				// 立刻 revoke 在个别浏览器里会让下载拿到空文件 ⇒ 延后释放（1s 足够，不影响观感）。
				window.setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 1000);
				return true;
			} catch (e) {
				return false;
			}
		}

		// ── 游戏图标（含**降级兜底**）──
		// 为什么需要：图标全是**外链**（README 承诺"不存储任何游戏资源"，故不打包进仓库）。
		// 外链随时可能挂掉、改路径、或对第三方来源防盗链 —— 没有这一层，面板上就是一排裂图。
		// 所以：没配图标 / 图片加载失败 → 退化成「游戏名首字」小方块，信息不丢、观感不崩。
		// 换 URL 后要能重试（自定义条目改图标时），故用 useEffect 按 icon 复位 failed。
		function gameIconGlyph(name) {
			const s = String(name == null ? "" : name).replace(/[\s\u3000]+/g, "");
			if (!s) return "?";
			// 优先取第一个汉字/假名/字母/数字（跳过「·」「：」「！」这类分隔符与符号）
			const m = s.match(/[\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/);
			return m ? m[0].toUpperCase() : s.charAt(0);
		}
		function GameIcon({ icon, name, size }) {
			const px = size || 20;
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => { setFailed(false); }, [icon]);
			const box = { width: px, height: px, borderRadius: 5, flex: "none" };
			if (!icon || failed) {
				// B3：这里原先多挂了一个 className:"gacha-cal-icon-fb" —— 9 个 styles/*.css 里都**没有**这条规则
				// （该元素的造型全在下面的 inline style 上），删掉它视觉零变化（真机 computed 样式逐项相同）。
				return (0, react_jsx_runtime.jsx)("span", {
					"aria-label": name,
					title: name,
					style: Object.assign({}, box, {
						display: "inline-flex", alignItems: "center", justifyContent: "center",
						background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.2))",
						color: "var(--dsw-alias-text-l2, inherit)",
						fontSize: Math.round(px * 0.55), fontWeight: 600, lineHeight: 1,
						userSelect: "none", overflow: "hidden"
					}),
					children: gameIconGlyph(name)
				});
			}
			return (0, react_jsx_runtime.jsx)("img", {
				src: icon, alt: name, loading: "lazy", decoding: "async", style: Object.assign({}, box, { objectFit: "cover" }),
				onError: () => setFailed(true)
			});
		}

		// ── 图标**空闲预热**（治「第一次打开面板时图标一格格往里填」）──
		// 面板一开就会同时挂 20+ 张外链图标：浏览器对单域名的并发连接有限，首屏还得等握手 + TLS + 下载。
		// 这里在插件初始化后的**空闲时段**按固定并发把 URL 先取一遍，让它们进 HTTP 缓存；
		// 等 <img> 真正渲染时直接命中缓存（这些 CDN 都带 cache-control，重复请求走缓存）。
		// 三条约束（改之前先读）：
		//   ① **只预热 SOURCES 里已登记的 icon** —— 不新增白名单之外的外部请求；
		//   ② 不阻塞渲染：requestIdleCallback（无则 setTimeout 兜底），并发 ≤ 6、总时长 ≤ 10s；
		//   ③ 返回清理函数，交给 apply() 的 ctx.effect —— 面板卸载/插件重载后不再继续发请求。
		const ICON_PREWARM_CONCURRENCY = 6;
		const ICON_PREWARM_BUDGET_MS = 10000;
		function prewarmGameIcons() {
			// 非浏览器环境（离线用例 / SSR）没有 Image，直接跳过 —— 不要在这里抛错
			if (typeof Image !== "function") return () => {};
			const urls = [];
			const seen = Object.create(null);
			for (const s of SOURCES) {
				const u = s && s.icon;
				if (typeof u !== "string" || !/^https?:\/\//i.test(u) || seen[u]) continue;
				seen[u] = 1;
				urls.push(u);
			}
			let stopped = false;
			let cursor = 0;
			const active = [];
			const deadline = Date.now() + ICON_PREWARM_BUDGET_MS;
			const pump = () => {
				if (stopped) return;
				while (cursor < urls.length && active.length < ICON_PREWARM_CONCURRENCY && Date.now() < deadline) {
					const img = new Image();
					let done = false;
					const finish = () => {
						if (done) return;
						done = true;
						img.onload = img.onerror = null;
						const i = active.indexOf(img);
						if (i >= 0) active.splice(i, 1);
						pump(); // 腾出一个并发位就补下一张
					};
					img.onload = finish;
					// 单张失败**不重试、不降级**：面板那边 GameIcon 的 onError 兜底照旧负责显示字母
					img.onerror = finish;
					active.push(img);
					img.decoding = "async";
					img.src = urls[cursor++];
				}
			};
			pump();
			return () => {
				stopped = true;
				for (const img of active) { img.onload = img.onerror = null; img.src = ""; }
				active.length = 0;
			};
		}
		/** 把预热排进空闲时段；返回取消函数（给 ctx.effect 当清理器用）。 */
		function scheduleIconPrewarm() {
			let cancelled = false;
			let stopPrewarm = null;
			const run = () => {
				if (cancelled) return;
				stopPrewarm = prewarmGameIcons();
			};
			const useIdle = typeof requestIdleCallback === "function";
			// 有 requestIdleCallback 就等真空闲（timeout 3000 兜底：最多 3s 后一定执行）；
			// 没有就 1.2s 后跑 —— 两者都晚于面板首屏渲染，不会抢带宽/主线程。
			const handle = useIdle ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 1200);
			return () => {
				cancelled = true;
				if (useIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
				else clearTimeout(handle);
				if (stopPrewarm) stopPrewarm();
			};
		}
