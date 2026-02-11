import "./polyfills/compression";
import { auth } from "@databuddy/auth";
import {
	appRouter,
	createAbortSignalInterceptor,
	createRPCContext,
	recordORPCError,
	setupUncaughtErrorHandlers,
} from "@databuddy/rpc";
import { logger } from "@databuddy/shared/logger";
import cors from "@elysiajs/cors";
import { context } from "@opentelemetry/api";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { autumnHandler } from "autumn-js/elysia";
import { Elysia } from "elysia";
import {
	endRequestSpan,
	initTracing,
	shutdownTracing,
	startRequestSpan,
} from "./lib/tracing";
import { agent } from "./routes/agent";
import { health } from "./routes/health";
import { mcp } from "./routes/mcp";
import { publicApi } from "./routes/public";
import { query } from "./routes/query";
import { webhooks } from "./routes/webhooks/index";

initTracing();
setupUncaughtErrorHandlers();

async function handleRpcRoute(
	ctx: {
		request: Request;
		store: {
			tracing?: {
				activeContext?: ReturnType<typeof context.active> | null;
			};
		};
	},
	handle: (
		request: Request,
		rpcContext: Awaited<ReturnType<typeof createRPCContext>>
	) => Promise<{ matched: boolean; response?: Response }>
) {
	const { request, store } = ctx;
	try {
		const rpcContext = await createRPCContext({ headers: request.headers });
		const run = async () => {
			const result = await handle(request, rpcContext);
			return result.response ?? new Response("Not Found", { status: 404 });
		};
		const activeContext = store.tracing?.activeContext;
		return activeContext ? context.with(activeContext, run) : run();
	} catch (error) {
		if (error instanceof ORPCError) {
			recordORPCError({ code: error.code, message: error.message });
		}
		logger.error({ error }, "RPC handler failed");
		return new Response("Internal Server Error", { status: 500 });
	}
}

const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		createAbortSignalInterceptor(),
		onError((error) => {
			logger.error(error);
		}),
	],
});

const HIDDEN_FROM_DOCS = [
	"revenue",
	"agent",
	"chat",
	"sso",
	"uptime",
	"billing",
] as const;
const docsRouter = Object.fromEntries(
	Object.entries(appRouter).filter(
		([key]) =>
			!HIDDEN_FROM_DOCS.includes(key as (typeof HIDDEN_FROM_DOCS)[number])
	)
) as Omit<typeof appRouter, (typeof HIDDEN_FROM_DOCS)[number]>;

const openApiHandler = new OpenAPIHandler(docsRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
			specPath: "/spec.json",
			docsPath: "/",
			docsTitle: "Databuddy API",
			specGenerateOptions: {
				info: {
					title: "Databuddy API",
					version: "1.0.0",
					description: "Databuddy analytics and link management API",
				},
				tags: [
					{
						name: "Annotations",
						description: "Timeline annotations for marking events",
					},
					{
						name: "API Keys",
						description: "API key creation, management, and verification",
					},
					{
						name: "Autocomplete",
						description: "Autocomplete suggestions for analytics filters",
					},
					{
						name: "Export",
						description: "Analytics data export in CSV, JSON, or other formats",
					},
					{
						name: "Flags",
						description: "Feature flags for gradual rollouts and A/B testing",
					},
					{ name: "Funnels", description: "Funnel conversion analysis" },
					{ name: "Goals", description: "Conversion goals and analytics" },
					{
						name: "Insights",
						description: "Smart insights and anomaly detection",
					},
					{ name: "Links", description: "Link shortening and management" },
					{
						name: "Mini Charts",
						description: "Mini chart data for dashboard widgets",
					},
					{
						name: "Organizations",
						description: "Workspace and organization management",
					},
					{
						name: "Preferences",
						description: "User preferences for date and time formatting",
					},
					{
						name: "Target Groups",
						description: "Audience targeting for feature flags",
					},
					{
						name: "Websites",
						description: "Website management, settings, and configuration",
					},
				],
				security: [{ apiKey: [] }],
				components: {
					securitySchemes: {
						apiKey: {
							type: "apiKey",
							in: "header",
							name: "x-api-key",
							description:
								"API key. Also accepted as a Bearer token in the Authorization header.",
						},
					},
				},
			},
		}),
	],
	interceptors: [
		createAbortSignalInterceptor(),
		onError((error) => {
			logger.error(error);
		}),
	],
});

const app = new Elysia()
	.state("tracing", {
		span: null as ReturnType<typeof startRequestSpan>["span"] | null,
		activeContext: null as ReturnType<typeof context.active> | null | undefined,
		startTime: 0,
	})
	.use(
		cors({
			credentials: true,
			origin: [
				/(?:^|\.)databuddy\.cc$/,
				...(process.env.NODE_ENV === "development"
					? ["http://localhost:3000"]
					: []),
			],
		})
	)
	.use(publicApi)
	.use(health)
	.get(
		"/.well-known/oauth-authorization-server",
		() =>
			new Response(null, {
				status: 404,
				headers: { "Cache-Control": "no-store" },
			})
	)
	.use(webhooks)
	.onBeforeHandle(function startTrace({ request, path, store }) {
		const method = request.method;
		const startTime = Date.now();

		const route = path.startsWith("/rpc/")
			? path.slice(5)
			: path.startsWith("/api/")
				? path.slice(5)
				: path;
		const { span, activeContext } = startRequestSpan(
			method,
			request.url,
			route
		);

		store.tracing = {
			span,
			activeContext,
			startTime,
		};
	})
	.onAfterHandle(function endTrace({ response, store }) {
		if (store.tracing?.span && store.tracing.startTime) {
			const statusCode = response instanceof Response ? response.status : 200;
			endRequestSpan(store.tracing.span, statusCode, store.tracing.startTime);
		}
	})
	.use(
		autumnHandler({
			identify: async ({ request }) => {
				try {
					const session = await auth.api.getSession({
						headers: request.headers,
					});

					if (!session?.user) {
						return null;
					}

					return {
						customerId: session.user.id,
						customerData: {
							name: session.user.name,
							email: session.user.email,
						},
					};
				} catch (error) {
					logger.error({ error }, "Failed to get session for autumn handler");
					return null;
				}
			},
		})
	)
	.use(query)
	.use(agent)
	.use(mcp)
	.all(
		"/rpc/*",
		(ctx) =>
			handleRpcRoute(ctx, (request, rpcContext) =>
				rpcHandler.handle(request, {
					prefix: "/rpc",
					context: rpcContext,
				})
			),
		{ parse: "none" }
	)
	.all(
		"/api/*",
		(ctx) =>
			handleRpcRoute(ctx, (request, rpcContext) =>
				openApiHandler.handle(request, {
					prefix: "/api",
					context: rpcContext,
				})
			),
		{ parse: "none" }
	)
	.onError(function handleError({ error, code, store }) {
		const statusCode = code === "NOT_FOUND" ? 404 : 500;
		if (store.tracing?.span && store.tracing.startTime) {
			endRequestSpan(store.tracing.span, statusCode, store.tracing.startTime);
		}

		const errorMessage = error instanceof Error ? error.message : String(error);
		const isDevelopment = process.env.NODE_ENV === "development";
		logger.error({ error, code }, errorMessage);

		return new Response(
			JSON.stringify({
				success: false,
				error: isDevelopment
					? errorMessage
					: "An internal server error occurred",
				code: code ?? "INTERNAL_SERVER_ERROR",
			}),
			{ status: statusCode, headers: { "Content-Type": "application/json" } }
		);
	});

export default {
	fetch: app.fetch,
	port: Number.parseInt(process.env.PORT ?? "3001", 10),
};

process.on("SIGINT", async () => {
	logger.info("SIGINT received, shutting down gracefully...");
	await shutdownTracing().catch((error) =>
		logger.error({ error }, "Shutdown error")
	);
	process.exit(0);
});

process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, shutting down gracefully...");
	await shutdownTracing().catch((error) =>
		logger.error({ error }, "Shutdown error")
	);
	process.exit(0);
});
