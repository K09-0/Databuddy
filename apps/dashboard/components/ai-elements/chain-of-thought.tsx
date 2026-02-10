"use client";

import type { Icon } from "@phosphor-icons/react";
import {
	CaretDownIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	GearIcon,
} from "@phosphor-icons/react";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useContext, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ChainOfThoughtContextValue {
	isOpen: boolean;
	setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
	null
);

const useChainOfThought = () => {
	const context = useContext(ChainOfThoughtContext);
	if (!context) {
		throw new Error(
			"ChainOfThought components must be used within ChainOfThought"
		);
	}
	return context;
};

export type ChainOfThoughtProps = ComponentProps<"div"> & {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
	({
		className,
		open,
		defaultOpen = false,
		onOpenChange,
		children,
		...props
	}: ChainOfThoughtProps) => {
		const [isOpen, setIsOpen] = useControllableState({
			prop: open,
			defaultProp: defaultOpen,
			onChange: onOpenChange,
		});

		const chainOfThoughtContext = useMemo(
			() => ({ isOpen, setIsOpen }),
			[isOpen, setIsOpen]
		);

		return (
			<ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
				<div className={cn("not-prose max-w-prose space-y-1", className)} {...props}>
					{children}
				</div>
			</ChainOfThoughtContext.Provider>
		);
	}
);

export type ChainOfThoughtHeaderProps = ComponentProps<
	typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = memo(
	({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
		const { isOpen, setIsOpen } = useChainOfThought();

		return (
			<Collapsible onOpenChange={setIsOpen} open={isOpen}>
				<CollapsibleTrigger
					className={cn(
						"flex w-full items-center justify-between gap-2 py-1 text-left text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
						className
					)}
					{...props}
				>
					<span className="flex items-center gap-2">
						<GearIcon className="size-3.5 shrink-0 opacity-70" weight="duotone" />
						<span>{children ?? "Processing"}</span>
					</span>
					<CaretDownIcon
						className={cn(
							"size-3.5 shrink-0 opacity-60 transition-transform",
							isOpen ? "rotate-180" : "rotate-0"
						)}
						weight="fill"
					/>
				</CollapsibleTrigger>
			</Collapsible>
		);
	}
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
	icon?: Icon;
	label: ReactNode;
	description?: ReactNode;
	status?: "complete" | "active" | "pending";
};

export const ChainOfThoughtStep = memo(
	({
		className,
		label,
		description,
		status = "complete",
		children,
		...props
	}: ChainOfThoughtStepProps) => {
		return (
			<div
				className={cn(
					"flex items-start gap-2.5 py-1.5 text-sm",
					"fade-in-0 slide-in-from-top-1 animate-in",
					className
				)}
				{...props}
			>
				{status === "complete" ? (
					<CheckCircleIcon
						className="mt-0.5 size-3.5 shrink-0 text-primary"
						weight="fill"
					/>
				) : (
					<CircleNotchIcon
						className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground"
						weight="bold"
					/>
				)}
				<div className="min-w-0 flex-1 space-y-0.5">
					<span className="text-foreground">{label}</span>
					{description && (
						<p className="text-muted-foreground text-xs">{description}</p>
					)}
					{children && (
						<div className="pt-0.5 text-muted-foreground text-xs">{children}</div>
					)}
				</div>
			</div>
		);
	}
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
	({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
		<div className={cn("flex items-center gap-2", className)} {...props} />
	)
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
	({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
		<Badge
			className={cn("gap-1 px-2 py-0.5 font-normal text-xs", className)}
			variant="secondary"
			{...props}
		>
			{children}
		</Badge>
	)
);

export type ChainOfThoughtContentProps = ComponentProps<
	typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
	({ className, children, ...props }: ChainOfThoughtContentProps) => {
		const { isOpen } = useChainOfThought();

		return (
			<Collapsible open={isOpen}>
				<CollapsibleContent
					className={cn(
						"data-[state=closed]:hidden",
						"data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 outline-none data-[state=open]:animate-in",
						className
					)}
					{...props}
				>
					<div className="space-y-0.5 pl-5">{children}</div>
				</CollapsibleContent>
			</Collapsible>
		);
	}
);

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
	caption?: string;
};

export const ChainOfThoughtImage = memo(
	({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
		<div className={cn("mt-2 space-y-2", className)} {...props}>
			<div className="relative flex max-h-88 items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
				{children}
			</div>
			{caption && <p className="text-muted-foreground text-xs">{caption}</p>}
		</div>
	)
);

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults";
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtImage.displayName = "ChainOfThoughtImage";
