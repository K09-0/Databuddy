import { alarms } from "@databuddy/db/schema";
import { eq, and } from "drizzle-orm";

export const sendNotification = async (db: any, websiteId: string, status: string) => {
  const siteAlarms = await db
    .select()
    .from(alarms)
    .where(
      and(
        eq(alarms.websiteId, websiteId),
        // Условие: проверяем статус внутри JSON triggerConditions
        eq(alarms.triggerConditions, { status: status }) 
      )
    );

  for (const alarm of siteAlarms) {
    // В консоль для логов сервера
    console.log(`[Alarm] Site ${websiteId} is ${status}. Notifying: ${alarm.channels.join(", ")}`);
    
    // Интеграция с провайдерами (Slack/Discord) будет добавлена в следующих итерациях
  }
};
