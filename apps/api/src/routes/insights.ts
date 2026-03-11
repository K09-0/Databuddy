import { auth } from "@databuddy/auth";
import {
	and,
	annotations,
	db,
	eq,
	gte,
	isNull,
	member,
	websites,
} from "@databuddy/db";
import { getRedisCache } from "@databuddy/redis";
import { logger } from "@databuddy/shared/logger";
import { ToolLoopAgent } from "ai";
import dayjs from "dayjs";
import { Elysia, t } from "elysia";
import { createAgentConfig } from "../ai/agents";
import { gateway } from "../ai/config/models";

const CACHE_TTL = 900;
const CACHE_KEY_PREFIX = "ai-insights";
const TIMEOUT_MS = 60_000;
const MAX_WEBSITES = 5;
const CONCURRENCY = 3;

const INSIGHTS_QUESTION = `Analyze this website right now. Check the last 7 days vs previous 7 days for:
1. Traffic trends (pageviews, visitors)
2. Error rates
3. Top pages changes

Then return ONLY valid JSON with this exact format, no markdown, no explanation:
{
  "insights": [{
    "title": "Brief headline under 60 chars",
    "description": "2-3 sentences with specific numbers from the data.",
    "suggestion": "One concrete action to take, written as an instruction.",
    "severity": "critical | warning | info",
    "sentiment": "positive | neutral | negative",
    "priority": 8,
    "type": "error_spike | traffic_drop | traffic_spike | vitals_degraded | performance | custom_event_spike",
    "changePercent": 25
  }]
}

Rules:
- Max 3 insights
- Only genuinely actionable findings, skip if everything is normal
- Include real numbers from the data
- sentiment: positive = good trend, neutral = informational, negative = needs attention
- priority: 1-10 where 10 is most urgent
- suggestion: a short, direct action like "Investigate the /checkout page for errors" or "Add caching to slow pages"
- If user annotations are provided, SKIP any change that is already explained by an annotation — the user already knows about it
- Only mention an annotated event if there's an additional unexpected angle (e.g. the spike was 5x larger than expected, or traffic didn't recover after a known outage)
- Focus on UNEXPLAINED changes — anomalies the user hasn't annotated are the most valuable insights
- If nothing notable or everything is explained by annotations, return {"insights": []}`;

interface ParsedInsight {
	title: string;
	description: string;
	suggestion: string;
	severity: "critical" | "warning" | "info";
	sentiment: "positive" | "neutral" | "negative";
	priority: number;
	type: string;
	changePercent?: number;
}

interface WebsiteInsight extends ParsedInsight {
	id: string;
	websiteId: string;
	websiteName: string | null;
	websiteDomain: string;
	link: string;
}

interface InsightsPayload {
	insights: WebsiteInsight[];
	source: "ai" | "fallback";
}

const JSON_EXTRACT_PATTERN = /\{[\s\S]*"insights"[\s\S]*\}/;

function isValidInsight(item: unknown): item is ParsedInsight {
	if (typeof item !== "object" || item === null) {
		return false;
	}
	const r = item as Record<string, unknown>;
	return (
		typeof r.title === "string" &&
		typeof r.description === "string" &&
		typeof r.severity === "string" &&
		typeof r.suggestion === "string" &&
		typeof r.sentiment === "string" &&
		typeof r.priority === "number"
	);
}

function parseInsights(text: string): ParsedInsight[] {
	const match = text.match(JSON_EXTRACT_PATTERN);
	if (!match) {
		return [];
	}

	try {
		const parsed = JSON.parse(match[0]) as { insights?: unknown[] };
		if (!Array.isArray(parsed.insights)) {
			return [];
		}
		return parsed.insights.filter(isValidInsight).slice(0, 3);
	} catch {
		return [];
	}
}

async function fetchRecentAnnotations(websiteId: string): Promise<string> {
	const since = dayjs().subtract(14, "day").toDate();

	const rows = await db
		.select({
			text: annotations.text,
			xValue: annotations.xValue,
			tags: annotations.tags,
		})
		.from(annotations)
		.where(
			and(
				eq(annotations.websiteId, websiteId),
				gte(annotations.xValue, since),
				isNull(annotations.deletedAt)
			)
		)
		.orderBy(annotations.xValue)
		.limit(20);

	if (rows.length === 0) {
		return "";
	}

	const lines = rows.map((r) => {
		const date = dayjs(r.xValue).format("YYYY-MM-DD");
		const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
		return `- ${date}: ${r.text}${tags}`;
	});

	return `\n\nUser annotations (known events that may explain traffic changes):\n${lines.join("\n")}`;
}

async function analyzeWebsite(
	websiteId: string,
	domain: string,
	timezone: string,
	userId: string,
	headers: Headers
): Promise<ParsedInsight[]> {
	const config = createAgentConfig("analytics", {
		userId,
		websiteId,
		websiteDomain: domain,
		timezone,
		chatId: `insights-${websiteId}`,
		requestHeaders: headers,
	});

	const agent = new ToolLoopAgent({
		model: gateway.chat("anthropic/claude-sonnet-4-5"),
		instructions: config.system,
		tools: config.tools,
		stopWhen: config.stopWhen,
		temperature: config.temperature,
		experimental_context: config.experimental_context,
	});

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const annotationContext = await fetchRecentAnnotations(websiteId);
		const prompt = INSIGHTS_QUESTION + annotationContext;

		const result = await agent.generate({
			messages: [{ role: "user" as const, content: prompt }],
			abortSignal: controller.signal,
		});
		return parseInsights(result.text ?? "");
	} catch (error) {
		logger.warn({ websiteId, error }, "Failed to generate insights");
		return [];
	} finally {
		clearTimeout(timer);
	}
}

async function processInBatches<T, R>(
	items: T[],
	action: (item: T) => Promise<R>,
	limit: number
): Promise<R[]> {
	const results: R[] = [];
	const pending = [...items];

	async function run() {
		while (pending.length > 0) {
			const item = pending.shift();
			if (item !== undefined) {
				results.push(await action(item));
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => run())
	);
	return results;
}

function getRedis() {
	try {
		return getRedisCache();
	} catch {
		return null;
	}
}

export const insights = new Elysia({ prefix: "/v1/insights" })
	.derive(async ({ request }) => {
		const session = await auth.api.getSession({ headers: request.headers });
		return { user: session?.user ?? null };
	})
	.onBeforeHandle(({ user, set }) => {
		if (!user) {
			set.status = 401;
			return {
				success: false,
				error: "Authentication required",
				code: "AUTH_REQUIRED",
			};
		}
	})
	.post(
		"/ai",
		async ({ body, user, request }) => {
			const userId = user?.id;
			if (!userId) {
				return { success: false, error: "User ID required", insights: [] };
			}

			const { organizationId, timezone = "UTC" } = body;
			const redis = getRedis();
			const cacheKey = `${CACHE_KEY_PREFIX}:${organizationId}`;

			if (redis) {
				try {
					const cached = await redis.get(cacheKey);
					if (cached) {
						const payload = JSON.parse(cached) as InsightsPayload;
						if (payload.insights.length > 0) {
							return { success: true, ...payload };
						}
						await redis.del(cacheKey);
					}
				} catch {
					// proceed without cache
				}
			}

			const memberships = await db.query.member.findMany({
				where: eq(member.userId, userId),
				columns: { organizationId: true },
			});

			const orgIds = new Set(memberships.map((m) => m.organizationId));
			if (!orgIds.has(organizationId)) {
				return {
					success: false,
					error: "Access denied to this organization",
					insights: [],
				};
			}

			const sites = await db.query.websites.findMany({
				where: eq(websites.organizationId, organizationId),
				columns: { id: true, name: true, domain: true },
			});

			if (sites.length === 0) {
				return { success: true, insights: [], source: "ai" };
			}

			try {
				const groups = await processInBatches(
					sites.slice(0, MAX_WEBSITES),
					async (site) => {
						const results = await analyzeWebsite(
							site.id,
							site.domain,
							timezone,
							userId,
							request.headers
						);
						return results.map(
							(insight, i): WebsiteInsight => ({
								...insight,
								id: `${site.id}-${i}`,
								websiteId: site.id,
								websiteName: site.name,
								websiteDomain: site.domain,
								link: `/websites/${site.id}`,
							})
						);
					},
					CONCURRENCY
				);

				const sorted = groups
					.flat()
					.sort((a, b) => b.priority - a.priority)
					.slice(0, 10);

				const payload: InsightsPayload = {
					insights: sorted,
					source: "ai",
				};

				if (redis && sorted.length > 0) {
					redis
						.setex(cacheKey, CACHE_TTL, JSON.stringify(payload))
						.catch(() => {});
				}

				return { success: true, ...payload };
			} catch (error) {
				logger.error(
					{ error, organizationId },
					"AI insights generation failed"
				);
				return { success: true, insights: [], source: "fallback" };
			}
		},
		{
			body: t.Object({
				organizationId: t.String(),
				timezone: t.Optional(t.String()),
			}),
			idleTimeout: 120_000,
		}
	);
