"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
	className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const currentTheme = theme ?? "system";

	const toggleTheme = () => {
		if (currentTheme === "system") {
			setTheme("light");
		} else if (currentTheme === "light") {
			setTheme("dark");
		} else {
			setTheme("system");
		}
	};

	return (
		<Button
			className={cn("relative size-8", className)}
			onClick={toggleTheme}
			size="sm"
			suppressHydrationWarning
			variant="ghost"
		>
			<SunIcon
				className={cn(
					"size-4 transition-all duration-300",
					currentTheme === "light" ? "rotate-0 scale-100" : "-rotate-90 scale-0"
				)}
				size={16}
				suppressHydrationWarning
				weight="duotone"
			/>
			<MoonIcon
				className={cn(
					"absolute size-4 transition-all duration-300",
					currentTheme === "dark" ? "rotate-0 scale-100" : "rotate-90 scale-0"
				)}
				size={16}
				suppressHydrationWarning
				weight="duotone"
			/>
			<MonitorIcon
				className={cn(
					"absolute size-4 transition-all duration-300",
					currentTheme === "system" ? "rotate-0 scale-100" : "rotate-90 scale-0"
				)}
				size={16}
				suppressHydrationWarning
				weight="duotone"
			/>
			<span className="sr-only">Toggle theme</span>
		</Button>
	);
}
