import { createClient, type ResponseJSON } from "@clickhouse/client";
import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import SqlString from "sqlstring";
/**
 * ClickHouse table names used throughout the application
 */
export const TABLE_NAMES = {
	events: "analytics.events",
	outgoing_links: "analytics.outgoing_links",
	blocked_traffic: "analytics.blocked_traffic",
	email_events: "analytics.email_events",
	error_spans: "analytics.error_spans",
	web_vitals_spans: "analytics.web_vitals_spans",
	custom_events: "analytics.custom_events",
	ai_call_spans: "observability.ai_call_spans",
	ai_traffic_spans: "analytics.ai_traffic_spans",
};

const logger = console;

export const CLICKHOUSE_OPTIONS: NodeClickHouseClientConfigOptions = {
	max_open_connections: 30,
	request_timeout: 30_000,
	keep_alive: {
		enabled: true,
		idle_socket_ttl: 8000,
	},
	compression: {
		request: true,
		response: true,
	},
};

export const clickHouseOG = createClient({
	url: process.env.CLICKHOUSE_URL,
	...CLICKHOUSE_OPTIONS,
});

async function withRetry<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	baseDelay = 500
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const res = await operation();
			if (attempt > 0) {
				logger.info("Retry operation succeeded", { attempt });
			}
			return res;
		} catch (error: any) {
			lastError = error;

			if (
				error.message.includes("Connect") ||
				error.message.includes("socket hang up") ||
				error.message.includes("Timeout error")
			) {
				const delay = baseDelay * 2 ** attempt;
				logger.warn(
					`Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`,
					{
						error: error.message,
					}
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}

			throw error; // Non-retriable error
		}
	}

	throw lastError;
}

export const clickHouse = new Proxy(clickHouseOG, {
	get(target, property, receiver) {
		const value = Reflect.get(target, property, receiver);

		if (property === "insert") {
			return (...args: any[]) => withRetry(() => value.apply(target, args));
		}

		return value;
	},
});

export function chQueryWithMeta<T extends Record<string, any>>(
	query: string,
	params?: Record<string, unknown>
): Promise<ResponseJSON<T>> {
	const tracer = trace.getTracer("clickhouse");
	return tracer.startActiveSpan("chQuery", async (span) => {
		const preview =
			query.length > 200 ? `${query.substring(0, 200)}...` : query;
		span.setAttribute("db.system", "clickhouse");
		span.setAttribute("db.statement", preview);

		try {
			const res = await clickHouse.query({
				query,
				query_params: params,
			});
			const json = await res.json<T>();
			const keys = Object.keys(json.data[0] || {});

			span.setAttribute("db.row_count", json.data.length);
			span.setAttribute("db.stats.rows_read", json.statistics?.rows_read ?? 0);
			span.setAttribute(
				"db.stats.bytes_read",
				json.statistics?.bytes_read ?? 0
			);
			span.setAttribute("db.stats.elapsed_sec", json.statistics?.elapsed ?? 0);
			span.setStatus({ code: SpanStatusCode.OK });

			const response = {
				...json,
				data: json.data.map((item) =>
					keys.reduce(
						(acc, key) => {
							const meta = json.meta?.find((m) => m.name === key);
							acc[key] =
								item[key] && meta?.type.includes("Int")
									? Number.parseFloat(item[key] as string)
									: item[key];
							return acc;
						},
						{} as Record<string, any>
					)
				),
			};

			return response as ResponseJSON<T>;
		} catch (error) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: error instanceof Error ? error.message : String(error),
			});
			span.recordException(
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		} finally {
			span.end();
		}
	});
}

export function chQuery<T extends Record<string, any>>(
	query: string,
	params?: Record<string, unknown>
): Promise<T[]> {
	return chQueryWithMeta<T>(query, params).then((res) => res.data);
}

export async function chCommand(
	query: string,
	params?: Record<string, unknown>
): Promise<void> {
	await clickHouse.command({
		query,
		query_params: params,
		clickhouse_settings: { wait_end_of_query: 1 },
	});
}

const Z_REGEX = /Z+$/;
const DATE_REGEX = /\d{4}-\d{2}-\d{2}/;

export function formatClickhouseDate(
	date: Date | string,
	skipTime = false
): string {
	if (skipTime) {
		return new Date(date).toISOString().split("T")[0] ?? "";
	}
	return new Date(date).toISOString().replace("T", " ").replace(Z_REGEX, "");
}

export function toDate(str: string, interval?: string) {
	if (!interval || interval === "minute" || interval === "hour") {
		if (DATE_REGEX.test(str)) {
			return SqlString.escape(str);
		}

		return str;
	}

	if (DATE_REGEX.test(str)) {
		return `toDate(${SqlString.escape(str.split(" ")[0])})`;
	}

	return `toDate(${SqlString.escape(str)})`;
}

export function convertClickhouseDateToJs(date: string) {
	return new Date(`${date.replace(" ", "T")}Z`);
}
