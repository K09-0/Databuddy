export interface FunnelStep {
	type: "PAGE_VIEW" | "EVENT" | "CUSTOM";
	target: string;
	name: string;
	conditions?: Record<string, unknown>;
}

export interface FunnelFilter {
	field: string;
	operator: "equals" | "contains" | "not_equals" | "in" | "not_in";
	value: string | string[];
	label?: string;
}

export interface Funnel {
	id: string;
	name: string;
	description?: string | null;
	steps: FunnelStep[];
	filters?: FunnelFilter[];
	ignoreHistoricData?: boolean;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CreateFunnelData {
	name: string;
	description?: string;
	steps: FunnelStep[];
	filters?: FunnelFilter[];
	ignoreHistoricData?: boolean;
}

export interface StepErrorInsight {
	message: string;
	error_type: string;
	count: number;
}

export interface FunnelStepAnalytics {
	step_number: number;
	step_name: string;
	users: number;
	total_users: number;
	conversion_rate: number;
	dropoffs: number;
	dropoff_rate: number;
	avg_time_to_complete: number;
	error_count: number;
	error_rate: number;
	top_errors: StepErrorInsight[];
}

export interface FunnelErrorInsights {
	total_errors: number;
	sessions_with_errors: number;
	dropoffs_with_errors: number;
	error_correlation_rate: number;
}

export interface FunnelTimeSeriesPoint {
	date: string;
	users: number;
	conversions: number;
	conversion_rate: number;
	dropoffs: number;
	avg_time: number;
	errors?: number;
}

export interface FunnelAnalyticsData {
	overall_conversion_rate: number;
	total_users_entered: number;
	total_users_completed: number;
	avg_completion_time: number;
	avg_completion_time_formatted: string;
	biggest_dropoff_step: number;
	biggest_dropoff_rate: number;
	steps_analytics: FunnelStepAnalytics[];
	time_series?: FunnelTimeSeriesPoint[];
	error_insights?: FunnelErrorInsights;
}

export interface FunnelAnalyticsByReferrerResult {
	referrer: string;
	referrer_parsed: {
		name: string;
		type: string;
		domain: string;
	};
	total_users: number;
	completed_users: number;
	conversion_rate: number;
}
