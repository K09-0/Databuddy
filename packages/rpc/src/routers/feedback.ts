import {
	and,
	desc,
	eq,
	feedback,
	feedbackRedemptions,
	sql,
} from "@databuddy/db";
import type { db as DbType } from "@databuddy/db";
import { logger } from "@databuddy/shared/logger";
import { Autumn as autumn } from "autumn-js";
import { randomUUIDv7 } from "bun";
import { z } from "zod";
import { rpcError } from "../errors";
import { sessionProcedure } from "../orpc";
import { getBillingCustomerId } from "../utils/billing";

const REWARD_TIERS = [
	{ creditsRequired: 50, rewardType: "events", rewardAmount: 1_000 },
	{ creditsRequired: 100, rewardType: "events", rewardAmount: 2_500 },
	{ creditsRequired: 200, rewardType: "events", rewardAmount: 5_000 },
	{ creditsRequired: 500, rewardType: "events", rewardAmount: 15_000 },
] as const;

const categoryEnum = z.enum([
	"bug_report",
	"feature_request",
	"ux_improvement",
	"performance",
	"documentation",
	"other",
]);

const statusEnum = z.enum(["pending", "approved", "rejected"]);

const feedbackOutputSchema = z.object({
	id: z.string(),
	userId: z.string(),
	organizationId: z.string(),
	title: z.string(),
	description: z.string(),
	category: categoryEnum,
	status: statusEnum,
	creditsAwarded: z.number(),
	adminNotes: z.string().nullable(),
	reviewedBy: z.string().nullable(),
	reviewedAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

const computeCreditsBalance = async (
	db: typeof DbType,
	userId: string,
	organizationId: string
) => {
	const [earnedResult] = await db
		.select({
			total: sql<number>`coalesce(sum(${feedback.creditsAwarded}), 0)`,
		})
		.from(feedback)
		.where(
			and(
				eq(feedback.userId, userId),
				eq(feedback.organizationId, organizationId),
				eq(feedback.status, "approved")
			)
		);

	const [spentResult] = await db
		.select({
			total: sql<number>`coalesce(sum(${feedbackRedemptions.creditsSpent}), 0)`,
		})
		.from(feedbackRedemptions)
		.where(
			and(
				eq(feedbackRedemptions.userId, userId),
				eq(feedbackRedemptions.organizationId, organizationId)
			)
		);

	const totalEarned = Number(earnedResult?.total ?? 0);
	const totalSpent = Number(spentResult?.total ?? 0);

	return {
		totalEarned,
		totalSpent,
		available: totalEarned - totalSpent,
	};
};

export const feedbackRouter = {
	submit: sessionProcedure
		.route({
			method: "POST",
			path: "/feedback/submit",
			tags: ["Feedback"],
			summary: "Submit feedback",
			description: "Submit new feedback to earn credits when approved.",
		})
		.input(
			z.object({
				title: z.string().min(3).max(200),
				description: z.string().min(10).max(5000),
				category: categoryEnum,
			})
		)
		.output(feedbackOutputSchema)
		.handler(async ({ context, input }) => {
			if (!context.organizationId) {
				throw rpcError.badRequest("Organization context is required");
			}

			const [newFeedback] = await context.db
				.insert(feedback)
				.values({
					id: randomUUIDv7(),
					userId: context.user.id,
					organizationId: context.organizationId,
					title: input.title,
					description: input.description,
					category: input.category,
				})
				.returning();

			return newFeedback;
		}),

	list: sessionProcedure
		.route({
			method: "POST",
			path: "/feedback/list",
			tags: ["Feedback"],
			summary: "List my feedback",
			description: "List current user's feedback submissions.",
		})
		.input(
			z
				.object({
					status: statusEnum.optional(),
				})
				.default({})
		)
		.output(z.array(feedbackOutputSchema))
		.handler(async ({ context, input }) => {
			if (!context.organizationId) {
				throw rpcError.badRequest("Organization context is required");
			}

			const conditions = [
				eq(feedback.userId, context.user.id),
				eq(feedback.organizationId, context.organizationId),
			];

			if (input.status) {
				conditions.push(eq(feedback.status, input.status));
			}

			return context.db
				.select()
				.from(feedback)
				.where(and(...conditions))
				.orderBy(desc(feedback.createdAt));
		}),

	getCreditsBalance: sessionProcedure
		.route({
			method: "POST",
			path: "/feedback/getCreditsBalance",
			tags: ["Feedback"],
			summary: "Get credits balance",
			description: "Get current user's feedback credits balance.",
		})
		.output(
			z.object({
				totalEarned: z.number(),
				totalSpent: z.number(),
				available: z.number(),
			})
		)
		.handler(async ({ context }) => {
			if (!context.organizationId) {
				throw rpcError.badRequest("Organization context is required");
			}

			return computeCreditsBalance(
				context.db,
				context.user.id,
				context.organizationId
			);
		}),

	getRewardTiers: sessionProcedure
		.route({
			method: "POST",
			path: "/feedback/getRewardTiers",
			tags: ["Feedback"],
			summary: "Get reward tiers",
			description: "Get available reward tiers for credit redemption.",
		})
		.output(
			z.array(
				z.object({
					creditsRequired: z.number(),
					rewardType: z.string(),
					rewardAmount: z.number(),
				})
			)
		)
		.handler(() => {
			return [...REWARD_TIERS];
		}),

	redeemCredits: sessionProcedure
		.route({
			method: "POST",
			path: "/feedback/redeemCredits",
			tags: ["Feedback"],
			summary: "Redeem credits",
			description: "Redeem feedback credits for event balance.",
		})
		.input(
			z.object({
				tierIndex: z.number().int().min(0).max(REWARD_TIERS.length - 1),
			})
		)
		.output(
			z.object({
				success: z.literal(true),
				rewardType: z.string(),
				rewardAmount: z.number(),
				creditsSpent: z.number(),
				remainingCredits: z.number(),
			})
		)
		.handler(async ({ context, input }) => {
			if (!context.organizationId) {
				throw rpcError.badRequest("Organization context is required");
			}

			const tier = REWARD_TIERS[input.tierIndex];

			const balance = await computeCreditsBalance(
				context.db,
				context.user.id,
				context.organizationId
			);

			if (balance.available < tier.creditsRequired) {
				throw rpcError.badRequest(
					`Not enough credits. You have ${balance.available} but need ${tier.creditsRequired}.`
				);
			}

			const customerId = await getBillingCustomerId(
				context.user.id,
				context.organizationId
			);

			try {
				const checkResult = await autumn.check({
					customer_id: customerId,
					feature_id: "events",
				});

				const currentBalance = checkResult.data?.balance ?? 0;
				const newBalance = currentBalance + tier.rewardAmount;

				const autumnInstance = new autumn();
				const updateResult = await autumnInstance.post(
					`customers/${customerId}/balances`,
					{
						balances: [
							{ feature_id: "events", balance: newBalance },
						],
					}
				);

				if (updateResult.error) {
					throw updateResult.error;
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				logger.error(
					{
						error: errorMessage,
						userId: context.user.id,
						customerId,
						tier,
					},
					"Failed to update Autumn balance for credit redemption"
				);
				throw rpcError.internal(
					"Failed to add events to your balance. Please try again."
				);
			}

			await context.db.insert(feedbackRedemptions).values({
				id: randomUUIDv7(),
				userId: context.user.id,
				organizationId: context.organizationId,
				creditsSpent: tier.creditsRequired,
				rewardType: tier.rewardType,
				rewardAmount: tier.rewardAmount,
			});

			const newBalance = await computeCreditsBalance(
				context.db,
				context.user.id,
				context.organizationId
			);

			logger.info(
				{
					userId: context.user.id,
					creditsSpent: tier.creditsRequired,
					rewardType: tier.rewardType,
					rewardAmount: tier.rewardAmount,
					remainingCredits: newBalance.available,
				},
				"Credits redeemed successfully"
			);

			return {
				success: true as const,
				rewardType: tier.rewardType,
				rewardAmount: tier.rewardAmount,
				creditsSpent: tier.creditsRequired,
				remainingCredits: newBalance.available,
			};
		}),

};
