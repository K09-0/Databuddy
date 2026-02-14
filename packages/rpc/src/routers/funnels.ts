import {
	and,
	desc,
	eq,
	funnelDefinitions,
	isNull,
	member,
	sql,
} from "@databuddy/db";
import { createDrizzleCache, redis } from "@databuddy/redis";
import { GATED_FEATURES } from "@databuddy/shared/types/features";
import { ORPCError } from "@orpc/server";
import { randomUUIDv7 } from "bun";
import { z } from "zod";
import {
	type AnalyticsStep,
	processFunnelAnalytics,
	processFunnelAnalyticsByReferrer,
} from "../lib/analytics-utils";
import { protectedProcedure, publicProcedure } from "../orpc";
import { requireFeature, requireUsageWithinLimit } from "../types/billing";
import { authorizeWebsiteAccess } from "../utils/auth";

const cache = createDrizzleCache({ redis, namespace: "funnels" });

const CACHE_TTL = 300;
const ANALYTICS_CACHE_TTL = 180;

const stepSchema = z.object({
	type: z.enum(["PAGE_VIEW", "EVENT", "CUSTOM"]),
	target: z.string().min(1),
	name: z.string().min(1),
	conditions: z.record(z.string(), z.unknown()).optional(),
});

const filterSchema = z.object({
	field: z.string(),
	operator: z.enum(["equals", "contains", "not_equals", "in", "not_in"]),
	value: z.union([z.string(), z.array(z.string())]),
});

type Step = z.infer<typeof stepSchema>;
type Filter = z.infer<typeof filterSchema>;

const getDefaultDateRange = () => {
	const endDate = new Date().toISOString().split("T")[0];
	const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		.toISOString()
		.split("T")[0];
	return { startDate, endDate };
};

const getEffectiveStartDate = (
	requestedStartDate: string,
	createdAt: Date | null,
	ignoreHistoricData: boolean
): string => {
	if (!(ignoreHistoricData && createdAt)) {
		return requestedStartDate;
	}

	const createdDate = new Date(createdAt).toISOString().split("T")[0];
	return new Date(requestedStartDate) > new Date(createdDate)
		? requestedStartDate
		: createdDate;
};

const invalidateFunnelsCache = async (websiteId: string, funnelId?: string) => {
	const keys = [`list:${websiteId}`];
	if (funnelId) {
		keys.push(`byId:${funnelId}:${websiteId}`);
	}
	const operations: Promise<void>[] = keys.map((key) =>
		cache.invalidateByKey(key)
	);
	if (funnelId) {
		operations.push(cache.invalidateByTags([`funnel:${funnelId}`]));
	}
	await Promise.all(operations);
};

const toAnalyticsSteps = (steps: Step[]): AnalyticsStep[] =>
	steps.map((step, index) => ({
		step_number: index + 1,
		type: step.type as "PAGE_VIEW" | "EVENT",
		target: step.target,
		name: step.name,
	}));

const funnelListOutputSchema = z.object({
	createdAt: z.coerce.date(),
	description: z.string().nullable(),
	filters: z.unknown().nullable(),
	id: z.string(),
	ignoreHistoricData: z.boolean(),
	isActive: z.boolean(),
	name: z.string(),
	steps: z.unknown(),
	updatedAt: z.coerce.date(),
});

const funnelOutputSchema = z.object({
	createdAt: z.coerce.date(),
	createdBy: z.string(),
	deletedAt: z.nullable(z.coerce.date()),
	description: z.string().nullable(),
	filters: z.unknown().nullable(),
	id: z.string(),
	ignoreHistoricData: z.boolean(),
	isActive: z.boolean(),
	name: z.string(),
	steps: z.unknown(),
	updatedAt: z.coerce.date(),
	websiteId: z.string(),
});

const successOutputSchema = z.object({ success: z.literal(true) });

export const funnelsRouter = {
	list: publicProcedure
		.route({
			description:
				"Returns all funnels for a website. Requires website read permission.",
			method: "POST",
			path: "/funnels/list",
			summary: "List funnels",
			tags: ["Funnels"],
		})
		.input(z.object({ websiteId: z.string() }))
		.output(z.array(funnelListOutputSchema))
		.handler(({ context, input }) =>
			cache.withCache({
				key: `list:${input.websiteId}`,
				ttl: CACHE_TTL,
				tables: ["funnelDefinitions"],
				queryFn: async () => {
					await authorizeWebsiteAccess(context, input.websiteId, "read");
					return context.db
						.select({
							id: funnelDefinitions.id,
							name: funnelDefinitions.name,
							description: funnelDefinitions.description,
							steps: funnelDefinitions.steps,
							filters: funnelDefinitions.filters,
							ignoreHistoricData: funnelDefinitions.ignoreHistoricData,
							isActive: funnelDefinitions.isActive,
							createdAt: funnelDefinitions.createdAt,
							updatedAt: funnelDefinitions.updatedAt,
						})
						.from(funnelDefinitions)
						.where(
							and(
								eq(funnelDefinitions.websiteId, input.websiteId),
								isNull(funnelDefinitions.deletedAt),
								sql`jsonb_array_length(${funnelDefinitions.steps}) > 1`
							)
						)
						.orderBy(desc(funnelDefinitions.createdAt));
				},
			})
		),

	getById: protectedProcedure
		.route({
			description:
				"Returns a single funnel by id. Requires website read permission.",
			method: "POST",
			path: "/funnels/getById",
			summary: "Get funnel",
			tags: ["Funnels"],
		})
		.input(z.object({ id: z.string(), websiteId: z.string() }))
		.output(funnelOutputSchema)
		.handler(({ context, input, errors }) =>
			cache.withCache({
				key: `byId:${input.id}:${input.websiteId}`,
				ttl: CACHE_TTL,
				tables: ["funnelDefinitions"],
				queryFn: async () => {
					await authorizeWebsiteAccess(context, input.websiteId, "read");
					const [funnel] = await context.db
						.select()
						.from(funnelDefinitions)
						.where(
							and(
								eq(funnelDefinitions.id, input.id),
								eq(funnelDefinitions.websiteId, input.websiteId),
								isNull(funnelDefinitions.deletedAt)
							)
						)
						.limit(1);

					if (!funnel) {
						throw errors.NOT_FOUND({
							message: "Funnel not found",
							data: { resourceType: "funnel", resourceId: input.id },
						});
					}
					return funnel;
				},
			})
		),

	create: protectedProcedure
		.route({
			description:
				"Creates a new funnel. Requires funnels feature and website update permission.",
			method: "POST",
			path: "/funnels/create",
			summary: "Create funnel",
			tags: ["Funnels"],
		})
		.input(
			z.object({
				websiteId: z.string(),
				name: z.string().min(1).max(100),
				description: z.string().optional(),
				steps: z.array(stepSchema).min(2).max(10),
				filters: z.array(filterSchema).optional(),
				ignoreHistoricData: z.boolean().optional(),
			})
		)
		.output(funnelOutputSchema)
		.handler(async ({ context, input }) => {
			const website = await authorizeWebsiteAccess(
				context,
				input.websiteId,
				"update"
			);

			let createdBy: string;
			if (context.user) {
				createdBy = context.user.id;
			} else if (context.apiKey) {
				if (!website.organizationId) {
					throw new ORPCError("FORBIDDEN", {
						message: "Website must belong to a workspace",
					});
				}
				const orgId = context.apiKey.organizationId ?? website.organizationId;
				const [ownerRow] = await context.db
					.select({ userId: member.userId })
					.from(member)
					.where(
						and(eq(member.organizationId, orgId), eq(member.role, "owner"))
					)
					.limit(1);
				if (!ownerRow) {
					throw new ORPCError("FORBIDDEN", {
						message: "Could not resolve organization owner for API key",
					});
				}
				createdBy = ownerRow.userId;
			} else {
				throw new ORPCError("UNAUTHORIZED", {
					message: "Authentication is required",
				});
			}

			requireFeature(context.billing?.planId, GATED_FEATURES.FUNNELS);

			const existingFunnels = await context.db
				.select({ id: funnelDefinitions.id })
				.from(funnelDefinitions)
				.where(
					and(
						eq(funnelDefinitions.websiteId, input.websiteId),
						isNull(funnelDefinitions.deletedAt)
					)
				);

			// Enforce plan limit before creating new funnel
			requireUsageWithinLimit(
				context.billing?.planId,
				GATED_FEATURES.FUNNELS,
				existingFunnels.length
			);

			const [newFunnel] = await context.db
				.insert(funnelDefinitions)
				.values({
					id: randomUUIDv7(),
					websiteId: input.websiteId,
					name: input.name,
					description: input.description,
					steps: input.steps,
					filters: input.filters,
					ignoreHistoricData: input.ignoreHistoricData ?? false,
					createdBy,
				})
				.returning();

			await invalidateFunnelsCache(input.websiteId);
			return newFunnel;
		}),

	update: protectedProcedure
		.route({
			description:
				"Updates an existing funnel. Requires website update permission.",
			method: "POST",
			path: "/funnels/update",
			summary: "Update funnel",
			tags: ["Funnels"],
		})
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
				description: z.string().optional(),
				steps: z.array(stepSchema).min(2).max(10).optional(),
				filters: z.array(filterSchema).optional(),
				ignoreHistoricData: z.boolean().optional(),
				isActive: z.boolean().optional(),
			})
		)
		.output(funnelOutputSchema)
		.handler(async ({ context, input, errors }) => {
			const [existingFunnel] = await context.db
				.select({ websiteId: funnelDefinitions.websiteId })
				.from(funnelDefinitions)
				.where(
					and(
						eq(funnelDefinitions.id, input.id),
						isNull(funnelDefinitions.deletedAt)
					)
				)
				.limit(1);

			if (!existingFunnel) {
				throw errors.NOT_FOUND({
					message: "Funnel not found",
					data: { resourceType: "funnel", resourceId: input.id },
				});
			}

			await authorizeWebsiteAccess(context, existingFunnel.websiteId, "update");

			const { id, ...updates } = input;
			const [updatedFunnel] = await context.db
				.update(funnelDefinitions)
				.set({ ...updates, updatedAt: new Date() })
				.where(
					and(eq(funnelDefinitions.id, id), isNull(funnelDefinitions.deletedAt))
				)
				.returning();

			await invalidateFunnelsCache(existingFunnel.websiteId, id);
			return updatedFunnel;
		}),

	delete: protectedProcedure
		.route({
			description: "Soft-deletes a funnel. Requires website delete permission.",
			method: "POST",
			path: "/funnels/delete",
			summary: "Delete funnel",
			tags: ["Funnels"],
		})
		.input(z.object({ id: z.string() }))
		.output(successOutputSchema)
		.handler(async ({ context, input, errors }) => {
			const [existingFunnel] = await context.db
				.select({ websiteId: funnelDefinitions.websiteId })
				.from(funnelDefinitions)
				.where(
					and(
						eq(funnelDefinitions.id, input.id),
						isNull(funnelDefinitions.deletedAt)
					)
				)
				.limit(1);

			if (!existingFunnel) {
				throw errors.NOT_FOUND({
					message: "Funnel not found",
					data: { resourceType: "funnel", resourceId: input.id },
				});
			}

			await authorizeWebsiteAccess(context, existingFunnel.websiteId, "delete");

			await context.db
				.update(funnelDefinitions)
				.set({ deletedAt: new Date(), isActive: false })
				.where(
					and(
						eq(funnelDefinitions.id, input.id),
						isNull(funnelDefinitions.deletedAt)
					)
				);

			await invalidateFunnelsCache(existingFunnel.websiteId, input.id);
			return { success: true };
		}),

	getAnalytics: publicProcedure
		.route({
			description:
				"Returns funnel conversion analytics. Requires website read permission.",
			method: "POST",
			path: "/funnels/getAnalytics",
			summary: "Get funnel analytics",
			tags: ["Funnels"],
		})
		.input(
			z.object({
				funnelId: z.string(),
				websiteId: z.string(),
				startDate: z.string().optional(),
				endDate: z.string().optional(),
			})
		)
		.output(z.record(z.string(), z.unknown()))
		.handler(async ({ context, input, errors }) => {
			await authorizeWebsiteAccess(context, input.websiteId, "read");

			const { startDate, endDate } =
				input.startDate && input.endDate
					? { startDate: input.startDate, endDate: input.endDate }
					: getDefaultDateRange();

			const [funnel] = await context.db
				.select()
				.from(funnelDefinitions)
				.where(
					and(
						eq(funnelDefinitions.id, input.funnelId),
						eq(funnelDefinitions.websiteId, input.websiteId),
						isNull(funnelDefinitions.deletedAt)
					)
				)
				.limit(1);

			if (!funnel) {
				throw errors.NOT_FOUND({
					message: "Funnel not found",
					data: { resourceType: "funnel", resourceId: input.funnelId },
				});
			}

			const steps = funnel.steps as Step[];
			if (!steps?.length) {
				throw errors.BAD_REQUEST({ message: "Funnel has no steps" });
			}

			const effectiveStartDate = getEffectiveStartDate(
				startDate,
				funnel.createdAt,
				funnel.ignoreHistoricData
			);

			const cacheKey = `analytics:${input.funnelId}:${effectiveStartDate}:${endDate}`;

			return cache.withCache({
				key: cacheKey,
				ttl: ANALYTICS_CACHE_TTL,
				tables: ["funnelDefinitions"],
				tag: `funnel:${input.funnelId}`,
				queryFn: () =>
					processFunnelAnalytics(
						toAnalyticsSteps(steps),
						(funnel.filters as Filter[]) || [],
						{
							websiteId: input.websiteId,
							startDate: effectiveStartDate,
							endDate: `${endDate} 23:59:59`,
						}
					),
			});
		}),

	getAnalyticsByReferrer: publicProcedure
		.route({
			description:
				"Returns funnel analytics broken down by referrer. Requires website read permission.",
			method: "POST",
			path: "/funnels/getAnalyticsByReferrer",
			summary: "Get funnel analytics by referrer",
			tags: ["Funnels"],
		})
		.input(
			z.object({
				funnelId: z.string(),
				websiteId: z.string(),
				startDate: z.string().optional(),
				endDate: z.string().optional(),
			})
		)
		.output(z.record(z.string(), z.unknown()))
		.handler(async ({ context, input, errors }) => {
			await authorizeWebsiteAccess(context, input.websiteId, "read");

			const { startDate, endDate } =
				input.startDate && input.endDate
					? { startDate: input.startDate, endDate: input.endDate }
					: getDefaultDateRange();

			const [funnel] = await context.db
				.select()
				.from(funnelDefinitions)
				.where(
					and(
						eq(funnelDefinitions.id, input.funnelId),
						eq(funnelDefinitions.websiteId, input.websiteId),
						isNull(funnelDefinitions.deletedAt)
					)
				)
				.limit(1);

			if (!funnel) {
				throw errors.NOT_FOUND({
					message: "Funnel not found",
					data: { resourceType: "funnel", resourceId: input.funnelId },
				});
			}

			const steps = funnel.steps as Step[];
			if (!steps?.length) {
				throw errors.BAD_REQUEST({ message: "Funnel has no steps" });
			}

			const effectiveStartDate = getEffectiveStartDate(
				startDate,
				funnel.createdAt,
				funnel.ignoreHistoricData
			);

			const cacheKey = `analyticsByReferrer:${input.funnelId}:${effectiveStartDate}:${endDate}`;

			return cache.withCache({
				key: cacheKey,
				ttl: ANALYTICS_CACHE_TTL,
				tables: ["funnelDefinitions"],
				tag: `funnel:${input.funnelId}`,
				queryFn: () =>
					processFunnelAnalyticsByReferrer(
						toAnalyticsSteps(steps),
						(funnel.filters as Filter[]) || [],
						{
							websiteId: input.websiteId,
							startDate: effectiveStartDate,
							endDate: `${endDate} 23:59:59`,
						}
					),
			});
		}),
};
