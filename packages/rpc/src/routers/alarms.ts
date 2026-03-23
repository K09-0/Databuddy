import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { alarms } from "@databuddy/db/schema";
import { createId } from "@paralleldrive/cuid2";

export const createAlarmSchema = z.object({
  websiteId: z.string().min(1),
  channels: z.array(z.enum(["slack", "discord", "email"])).min(1),
  triggerConditions: z.object({
    status: z.enum(["down", "up", "degraded"]),
    durationMinutes: z.number().int().min(1).default(5),
  }),
});

export const updateAlarmSchema = z.object({
  id: z.string().min(1),
  data: createAlarmSchema.partial(),
});

export const alarmsRouter = router({
  list: protectedProcedure
    .input(z.object({ websiteId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db
        .select()
        .from(alarms)
        .where(eq(alarms.websiteId, input.websiteId));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(alarms)
        .where(eq(alarms.id, input.id))
        .limit(1);
      
      if (!result.length) throw new Error("Alarm not found");
      return result[0];
    }),

  create: protectedProcedure
    .input(createAlarmSchema)
    .mutation(async ({ ctx, input }) => {
      const newAlarm = await ctx.db
        .insert(alarms)
        .values({
          id: createId(),
          websiteId: input.websiteId,
          channels: input.channels,
          triggerConditions: input.triggerConditions,
        })
        .returning();
      
      return newAlarm[0];
    }),

  update: protectedProcedure
    .input(updateAlarmSchema)
    .mutation(async ({ ctx, input }) => {
      const updatedAlarm = await ctx.db
        .update(alarms)
        .set({
          ...input.data,
          updatedAt: new Date(),
        })
        .where(eq(alarms.id, input.id))
        .returning();

      if (!updatedAlarm.length) throw new Error("Alarm not found");
      return updatedAlarm[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deletedAlarm = await ctx.db
        .delete(alarms)
        .where(eq(alarms.id, input.id))
        .returning();
      
      if (!deletedAlarm.length) throw new Error("Alarm not found");
      return deletedAlarm[0];
    }),
});
