// Host-side entry for dsh-gacha-calendar.
// Registers the settings namespace so the browser half's Settings > 二游排期
// section can read/write persisted config through the settings scope.
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

/** Settings namespace persisted through DSH Settings. */
const GACHA_NAMESPACE = "gacha-calendar";

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
const inject = [];

export function apply(ctx, config = {}) {
	let current = () => config;
	installSettingsSection(ctx, settingsNamespace(GACHA_NAMESPACE), Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
}

export { inject };
