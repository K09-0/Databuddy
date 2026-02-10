import { type LanguageModel, stepCountIs } from "ai";
import type { AppContext } from "../config/context";
import { models } from "../config/models";
import { buildAnalyticsInstructions } from "../prompts/analytics";
import { createAnnotationTools } from "../tools/annotations";
import { executeQueryBuilderTool } from "../tools/execute-query-builder";
import { executeSqlQueryTool } from "../tools/execute-sql-query";
import { createFunnelTools } from "../tools/funnels";
import { getTopPagesTool } from "../tools/get-top-pages";
import { createGoalTools } from "../tools/goals";
import { createLinksTools } from "../tools/links";
import type { AgentConfig, AgentContext } from "./types";

function createTools() {
	return {
		get_top_pages: getTopPagesTool,
		execute_query_builder: executeQueryBuilderTool,
		execute_sql_query: executeSqlQueryTool,
		...createFunnelTools(),
		...createGoalTools(),
		...createAnnotationTools(),
		...createLinksTools(),
	};
}

export const maxSteps = 5;

/**
 * Triage uses the same tools as analytics but with fewer steps.
 * Previously this was a handoff-only agent, now it handles queries directly.
 */
export function createConfig(context: AgentContext): AgentConfig {
	const appContext: AppContext = {
		userId: context.userId,
		websiteId: context.websiteId,
		websiteDomain: context.websiteDomain,
		timezone: context.timezone,
		currentDateTime: new Date().toISOString(),
		chatId: context.chatId,
		requestHeaders: context.requestHeaders,
	};

	return {
		model: models.triage as LanguageModel,
		system: buildAnalyticsInstructions(appContext),
		tools: createTools(),
		stopWhen: stepCountIs(5),
		temperature: 0.1,
		experimental_context: appContext,
	};
}
