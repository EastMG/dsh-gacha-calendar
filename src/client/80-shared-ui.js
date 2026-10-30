		//#region components
		// 本插件在 DSH 设置面板里的导航名；面板按钮与弹层标题也用它（唯一事实来源，90-plugin.js 注册分区时共用）。
		const SETTINGS_SECTION_LABEL = "\u4E8C\u6E38\u65E5\u5386";
		// 面板上那个「设置」按钮：**已恢复显示**（2026-10-31）—— 跳转链已按新三步重写（见
		// openPluginSettingsSection）。仍保留这个常量 gate：万一又要临时藏起来，改回 false 即可。
		const SETTINGS_BUTTON_VISIBLE = true;
		// DSH 设置面板是"点了才挂载"，打开后要等导航渲染出来才能切页；预算给足但不无限等。
		const SETTINGS_NAV_TIMEOUT_MS = 600;
		const SETTINGS_NAV_POLL_MS = 30;
		// 设置页游戏列表的「提醒」列：**已恢复显示**（2026-10-30）。
		// 它是「到期提醒（送达）」的逐游戏白名单（配置键 `remindGames`）：勾上 = 这一条到期时弹系统通知。
		// 2026-10-26 曾因为"送达未实现、勾了没效果"整列隐藏；送达侧现在真的按它过滤了
		// （宿主 runRemindRound → core 的 remindAllowedTickOf，见 65-remind.js），所以整列恢复。
		// 仍是**一个常量 gate 四处**（表头列标题 / 每行复选框 / 空列表提示 / 网格列宽）：
		// 万一又要临时藏起来，改回 false 即可，不用删代码。
		const SHOW_REMIND_COLUMN = true;
		// 游戏列表网格列宽 = 游戏 / 展示 / [提醒] / 卡池来源 / 活动来源 / 颜色 / 操作。
		// 隐藏「提醒」时把对应那一格（28px）从模板里**去掉**：留空列会把后面各列整体错位。
		const SETTINGS_GAME_GRID = SHOW_REMIND_COLUMN
			? "minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px"
			: "minmax(0,1.15fr) 28px minmax(0,1fr) minmax(0,1fr) 34px 88px";

		// 打开 DSH 设置面板并切到本插件的分区（两个面板上的「设置」齿轮都用它）。
		//
		// ⚠️ 为什么是"合成点击"而不是 API：DSH **没有**"打开设置到指定节"的官方 API
		//    （`settings.openSettingsDocument` 是给 AI 打开配置文档的，不是 UI 跳转）；`Ctrl+Alt+,`
		//    是 Electron **应用级**加速键，合成键盘事件无效。2026-10-31 在活的 DSH NEXT 上实测，
		//    唯一可用路径是点这三步（旧实现找"aria-haspopup=dialog 且名字像设置"的触发器，而那个
		//    触发器早已不存在 —— 侧栏底部只剩账号菜单，整条链因此失效，按钮也是那时被藏起来的）：
		//      ① `[data-slot="sidebar.settings"] button[aria-label*="账号"]`
		//         （兜底：侧栏底部 `[class*="settingsArea"]` 里**唯一**带 aria-haspopup 的 button）
		//      ② 等 `[role="menu"]` 出现 ⇒ 点文本以「设置」开头的项（实际文本「设置Ctrl+Alt+,」）
		//      ③ 等 `[role="dialog"]` 出现 ⇒ 点 `dialog nav` 里文本**全等**「二游日历」的按钮
		//         （兜底 aria-label 全等）
		//    每一步都轮询到 deadline（复用 SETTINGS_NAV_POLL_MS / SETTINGS_NAV_TIMEOUT_MS，
		//    不写死 sleep），失败返回 `{ ok:false, step, reason }` 并 console.warn —— 绝不静默。
		//    判定与 DOM 解耦成纯函数 settingsJumpPickOf / settingsJumpPlanOf（下面），
		//    离线用例见 test/cases-settings-jump.mjs；本函数只负责取元素、点、等。
		const SETTINGS_JUMP_STEP_ACCOUNT = "account-menu";
		const SETTINGS_JUMP_STEP_MENU = "settings-item";
		const SETTINGS_JUMP_STEP_NAV = "plugin-section";
		const SETTINGS_JUMP_REASON_ACCOUNT = "account-menu-missing";
		const SETTINGS_JUMP_REASON_MENU = "settings-item-missing";
		const SETTINGS_JUMP_REASON_DIALOG = "settings-dialog-missing";
		const SETTINGS_JUMP_REASON_NAV = "plugin-section-missing";

		// 一步的失败原因（步骤名 → reason；collector 抛错时也要给出正确的那一种）。
		function settingsJumpReasonOf(step) {
			if (step === SETTINGS_JUMP_STEP_MENU) return SETTINGS_JUMP_REASON_MENU;
			if (step === SETTINGS_JUMP_STEP_NAV) return SETTINGS_JUMP_REASON_NAV;
			return SETTINGS_JUMP_REASON_ACCOUNT;
		}

		// record = { el?, text, ariaLabel, title, visible, inOwnPanel, lane }
		//   · 纯数据、不带 DOM 方法 ⇒ 用例可以直接手写假列表；
		//   · visible === false / inOwnPanel === true 一律不认（缺省 = 可用）。
		function settingsJumpUsable(r) {
			return !!r && r.visible !== false && r.inOwnPanel !== true;
		}
		function settingsJumpHasPrefix(r, prefix) {
			return [r.text, r.ariaLabel, r.title].some((v) => typeof v === "string" && v.trim().startsWith(prefix));
		}

		// 纯判定（单步）：给定某一步的候选 record 列表 ⇒ `{ ok, step, hit }` 或 `{ ok:false, step, reason }`。
		function settingsJumpPickOf(step, records, label) {
			const list = Array.isArray(records) ? records.filter(settingsJumpUsable) : [];
			const want = typeof label === "string" && label ? label : SETTINGS_SECTION_LABEL;
			if (step === SETTINGS_JUMP_STEP_ACCOUNT) {
				// 先认主选择器（lane 缺省即主选择器）；兜底只接受**唯一**候选 —— 侧栏底部别处也出现
				// menu 类 button 时宁可不点，绝不猜。
				const primary = list.filter((r) => r.lane !== "fallback");
				if (primary.length) return { ok: true, step: step, hit: primary[0] };
				const fallback = list.filter((r) => r.lane === "fallback");
				if (fallback.length === 1) return { ok: true, step: step, hit: fallback[0] };
				return { ok: false, step: step, reason: SETTINGS_JUMP_REASON_ACCOUNT };
			}
			if (step === SETTINGS_JUMP_STEP_MENU) {
				const hit = list.find((r) => settingsJumpHasPrefix(r, "\u8BBE\u7F6E"));
				return hit ? { ok: true, step: step, hit: hit } : { ok: false, step: step, reason: SETTINGS_JUMP_REASON_MENU };
			}
			if (step === SETTINGS_JUMP_STEP_NAV) {
				// 文本全等优先（导航按钮 = svg + <span>二游日历</span>，textContent 正好是全名）；
				// 退到 aria-label 全等（外壳将来若把可见文本拆碎）。**不**做前缀/包含匹配。
				const hit = list.find((r) => r.text === want) || list.find((r) => r.ariaLabel === want);
				return hit ? { ok: true, step: step, hit: hit } : { ok: false, step: step, reason: SETTINGS_JUMP_REASON_NAV };
			}
			return { ok: false, step: step, reason: settingsJumpReasonOf(step) };
		}

		// 纯判定（整条链）：在"假 DOM 快照"上走完三步。正常 ⇒ { ok:true, account, menuItem, navItem }；
		// 三种失败各有不同 reason（缺账号菜单 / 菜单里没有设置项 / 设置开了但导航里没有本插件节）；
		// `dialogCount: 0` 另外区分出"设置面板根本没打开"。
		function settingsJumpPlanOf(snapshot) {
			const snap = snapshot || {};
			const account = settingsJumpPickOf(SETTINGS_JUMP_STEP_ACCOUNT, snap.accountMenus, snap.label);
			if (!account.ok) return account;
			const menu = settingsJumpPickOf(SETTINGS_JUMP_STEP_MENU, snap.menuItems, snap.label);
			if (!menu.ok) return menu;
			if (snap.dialogCount === 0) return { ok: false, step: SETTINGS_JUMP_STEP_NAV, reason: SETTINGS_JUMP_REASON_DIALOG };
			const nav = settingsJumpPickOf(SETTINGS_JUMP_STEP_NAV, snap.navItems, snap.label);
			if (!nav.ok) return nav;
			return { ok: true, step: SETTINGS_JUMP_STEP_NAV, account: account.hit, menuItem: menu.hit, navItem: nav.hit };
		}

		// 本插件自己的面板（.gacha-cal-pop）里的元素统统不认：面板的开关按钮 aria-label 就是同一个
		// 「二游日历」，文档级兜底会先命中它 ⇒ 点下去变成"自己开自己"（历史 bug，别退回去）。
		function isInOwnPanel(el) {
			for (let n = el; n; n = n.parentNode) if (n.classList && n.classList.contains("gacha-cal-pop")) return true;
			return false;
		}
		// 把 DOM 元素转成上面那种纯数据 record（唯一碰 DOM 的地方）。
		function settingsJumpRecordOf(el, lane) {
			const attrOf = (name) => {
				try { const v = el && el.getAttribute && el.getAttribute(name); return typeof v === "string" ? v.trim() : ""; } catch (e) { return ""; }
			};
			let visible = false;
			try { visible = !!(el && typeof el.getClientRects === "function" && el.getClientRects().length > 0); } catch (e) { visible = false; }
			return {
				el: el,
				lane: lane || "",
				text: el && typeof el.textContent === "string" ? el.textContent.trim() : "",
				ariaLabel: attrOf("aria-label"),
				title: attrOf("title"),
				visible: visible,
				inOwnPanel: isInOwnPanel(el)
			};
		}
		function settingsJumpQueryAll(root, selector) {
			if (!root || typeof root.querySelectorAll !== "function") return [];
			try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (e) { return []; }
		}
		// ① 账号菜单触发器：主选择器命中过的元素不再进兜底（同一元素只算一条）。
		function settingsAccountMenuRecords() {
			const out = [];
			const seen = [];
			for (const el of settingsJumpQueryAll(document, '[data-slot="sidebar.settings"] button[aria-label*="\u8D26\u53F7"]')) {
				seen.push(el);
				out.push(settingsJumpRecordOf(el, "primary"));
			}
			for (const area of settingsJumpQueryAll(document, '[class*="settingsArea"]')) {
				for (const el of settingsJumpQueryAll(area, "button[aria-haspopup]")) {
					if (seen.indexOf(el) >= 0) continue;
					out.push(settingsJumpRecordOf(el, "fallback"));
				}
			}
			return out;
		}
		// ② 账号菜单里的「设置」项。菜单是 body 级 portal ⇒ 只在 [role="menu"] 里找。
		function settingsMenuItemRecords() {
			return settingsJumpQueryAll(document, '[role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] a')
				.map((el) => settingsJumpRecordOf(el));
		}
		// ③ 设置 dialog 导航。只在 `dialog nav` 里找，**不做**整篇文档的兜底搜索。
		function settingsNavItemRecords() {
			const out = [];
			for (const dialog of settingsJumpQueryAll(document, '[role="dialog"]')) {
				for (const el of settingsJumpQueryAll(dialog, "nav button, nav a")) out.push(settingsJumpRecordOf(el));
			}
			return out;
		}
		// 轮询某一步直到 deadline（快的时候一步都不等）。
		function settingsJumpWaitFor(step, collect, label) {
			return new Promise((resolve) => {
				const deadline = Date.now() + SETTINGS_NAV_TIMEOUT_MS;
				const tick = () => {
					let res;
					try { res = settingsJumpPickOf(step, collect(), label); }
					catch (e) { res = { ok: false, step: step, reason: settingsJumpReasonOf(step) }; }
					if (res.ok || Date.now() >= deadline) { resolve(res); return; }
					window.setTimeout(tick, SETTINGS_NAV_POLL_MS);
				};
				tick();
			});
		}

		// 返回值：Promise<{ ok, step, reason? }> —— 失败**不抛**（面板上点一下不该炸整棵树），
		// 但会 console.warn 出卡在哪一步、为什么；调用方不需要处理异常。
		function openPluginSettingsSection() {
			const clickHit = (res) => {
				const el = res && res.ok && res.hit && res.hit.el;
				if (!el || typeof el.click !== "function") return false;
				try { el.click(); return true; } catch (e) { return false; }
			};
			const fail = (step, reason) => {
				const res = { ok: false, step: step, reason: reason };
				try { console.warn("[gacha-calendar] \u6253\u5F00\u63D2\u4EF6\u8BBE\u7F6E\u9875\u5931\u8D25\uFF1A", step, reason); } catch (e) { /* ignore */ }
				return res;
			};
			return Promise.resolve()
				.then(() => settingsJumpWaitFor(SETTINGS_JUMP_STEP_ACCOUNT, settingsAccountMenuRecords))
				.then((account) => {
					if (!account.ok) return fail(account.step, account.reason);
					if (!clickHit(account)) return fail(SETTINGS_JUMP_STEP_ACCOUNT, SETTINGS_JUMP_REASON_ACCOUNT);
					return settingsJumpWaitFor(SETTINGS_JUMP_STEP_MENU, settingsMenuItemRecords).then((menu) => {
						if (!menu.ok) return fail(menu.step, menu.reason);
						if (!clickHit(menu)) return fail(SETTINGS_JUMP_STEP_MENU, SETTINGS_JUMP_REASON_MENU);
						return settingsJumpWaitFor(SETTINGS_JUMP_STEP_NAV, settingsNavItemRecords).then((nav) => {
							if (!nav.ok) {
								// 区分"设置面板根本没开"与"开了但导航里没有本插件那一节"。
								const opened = settingsJumpQueryAll(document, '[role="dialog"]').length > 0;
								return fail(SETTINGS_JUMP_STEP_NAV, opened ? SETTINGS_JUMP_REASON_NAV : SETTINGS_JUMP_REASON_DIALOG);
							}
							if (!clickHit(nav)) return fail(SETTINGS_JUMP_STEP_NAV, SETTINGS_JUMP_REASON_NAV);
							return { ok: true, step: SETTINGS_JUMP_STEP_NAV };
						});
					});
				})
				.catch(() => fail(SETTINGS_JUMP_STEP_ACCOUNT, SETTINGS_JUMP_REASON_ACCOUNT));
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
