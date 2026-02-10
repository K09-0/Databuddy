import type { LanguageModel, StopCondition, ToolSet } from "ai";

export interface AgentContext {
	userId: string;
	websiteId: string;
	websiteDomain: string;
	timezone: string;
	chatId: string;
	requestHeaders?: Headers;
}

export type AgentType =
	| "triage"
	| "analytics"
	| "reflection"
	| "reflection-max";

export interface AgentConfig {
	model: LanguageModel;
	system: string;
	tools: ToolSet;
	stopWhen: StopCondition<ToolSet>;
	temperature: number;
	experimental_context?: unknown;
}
