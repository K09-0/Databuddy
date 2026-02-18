import {
	MCP_DATE_PRESETS,
	resolveDatePreset as resolveDatePresetForMcp,
} from "../../lib/date-presets";
import { QueryBuilders } from "../../query/builders";
import type { QueryRequest } from "../../query/types";
import type { DatePreset } from "../../schemas/query-schemas";

export {
	MCP_DATE_PRESETS,
	resolveDatePreset as resolveDatePresetForMcp,
} from "../../lib/date-presets";
export { CLICKHOUSE_SCHEMA_DOCS } from "../config/schema-docs";

export interface McpQueryItem {
	type: string;
	preset?: string;
	from?: string;
	to?: string;
	timeUnit?: "minute" | "hour" | "day" | "week" | "month";
	limit?: number;
	filters?: Array<{
		field: string;
		op: string;
		value: string | number | (string | number)[];
		target?: string;
		having?: boolean;
	}>;
	groupBy?: string[];
	orderBy?: string;
}

export function buildBatchQueryRequests(
	items: McpQueryItem[],
	websiteId: string,
	timezone: string
): { requests: QueryRequest[] } | { error: string } {
	const requests: QueryRequest[] = [];
	for (const q of items) {
		if (!(q.type in QueryBuilders)) {
			return { error: `Unknown type: ${q.type}` };
		}
		let from = q.from;
		let to = q.to;
		const preset = q.preset ?? (from && to ? undefined : "last_7d");
		if (preset && MCP_DATE_PRESETS.includes(preset as DatePreset)) {
			const resolved = resolveDatePresetForMcp(preset as DatePreset, timezone);
			from = resolved.from;
			to = resolved.to;
		}
		if (!(from && to)) {
			return { error: "Either preset or both from and to required" };
		}
		requests.push({
			projectId: websiteId,
			type: q.type,
			from,
			to,
			timeUnit: q.timeUnit,
			limit: q.limit,
			timezone,
			filters: q.filters as QueryRequest["filters"],
			groupBy: q.groupBy,
			orderBy: q.orderBy,
		});
	}
	return { requests };
}

const SCHEMA_SUMMARY =
	"analytics.events (client_id, path, time, country, device_type, referrer, utm_*); analytics.error_spans; analytics.web_vitals_hourly. Filter: client_id = {websiteId:String}.";

interface QueryTypeInfo {
	description: string;
	allowedFilters?: string[];
	customizable?: boolean;
}

export function getQueryTypeDescriptions(): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, config] of Object.entries(QueryBuilders)) {
		const fallback =
			"Analytics: " +
			key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
		result[key] = config?.meta?.description ?? fallback;
	}
	return result;
}

export function getQueryTypeDetails(): Record<string, QueryTypeInfo> {
	const result: Record<string, QueryTypeInfo> = {};
	for (const [key, config] of Object.entries(QueryBuilders)) {
		const fallback =
			"Analytics: " +
			key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
		result[key] = {
			description: config?.meta?.description ?? fallback,
			...(config?.allowedFilters?.length && {
				allowedFilters: config.allowedFilters,
			}),
			...(config?.customizable !== undefined && {
				customizable: config.customizable,
			}),
		};
	}
	return result;
}

export function getSchemaSummary(): string {
	return SCHEMA_SUMMARY;
}
