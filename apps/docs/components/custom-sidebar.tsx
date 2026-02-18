"use client";

import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useSearchContext } from "fumadocs-ui/provider";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AsideLink } from "@/components/ui/aside-link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { contents } from "./sidebar-content";

export default function CustomSidebar() {
	const pathname = usePathname();
	const { setOpenSearch } = useSearchContext();

	const { defaultOpen, defaultNestedOpen } = useMemo(() => {
		const idx = contents.findIndex((item) =>
			item.list.some((listItem) => {
				if (listItem.href === pathname) {
					return true;
				}
				if (listItem.children) {
					return listItem.children.some((child) => child.href === pathname);
				}
				return false;
			})
		);
		const openNested = new Set<string>();
		for (const section of contents) {
			for (const item of section.list) {
				if (item.children) {
					const hasActiveChild = item.children.some(
						(child) => child.href === pathname
					);
					if (hasActiveChild) {
						openNested.add(item.title);
					}
				}
			}
		}
		return { defaultOpen: idx === -1 ? 0 : idx, defaultNestedOpen: openNested };
	}, [pathname]);

	const [prevPathname, setPrevPathname] = useState(pathname);
	const [currentOpen, setCurrentOpen] = useState<number>(defaultOpen);
	const [nestedOpen, setNestedOpen] = useState<Set<string>>(defaultNestedOpen);

	if (prevPathname !== pathname) {
		setPrevPathname(pathname);
		setCurrentOpen(defaultOpen);
		setNestedOpen(defaultNestedOpen);
	}

	const handleSearch = () => {
		setOpenSearch(true);
	};

	return (
		<div className="fixed top-16 left-0 z-30 hidden h-[calc(100vh-4rem)] md:block">
			<aside className="flex h-full w-[268px] flex-col overflow-y-auto border-border border-t border-r bg-background lg:w-[286px]">
				<div className="flex h-full flex-col">
					<button
						className="flex w-full items-center justify-start gap-3 border-border border-b px-5 py-3 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
						onClick={handleSearch}
						type="button"
					>
						<MagnifyingGlassIcon className="size-4 shrink-0" weight="duotone" />
						<span className="text-sm">Search documentation...</span>
					</button>

					<MotionConfig
						transition={{ duration: 0.4, type: "spring", bounce: 0 }}
					>
						<div className="flex flex-col">
							{contents.map((item, index) => (
								<div key={item.title}>
									<button
										className="flex w-full items-center gap-3 border-border border-b px-5 py-2.5 text-left font-medium text-foreground text-sm hover:bg-muted/50"
										onClick={() => {
											if (currentOpen === index) {
												setCurrentOpen(-1);
											} else {
												setCurrentOpen(index);
											}
										}}
										type="button"
									>
										<item.Icon
											className="size-5 shrink-0 text-foreground"
											weight="fill"
										/>
										<span className="flex-1 text-sm">{item.title}</span>
										{item.isNew ? <NewBadge /> : null}
										<motion.div
											animate={{ rotate: currentOpen === index ? 180 : 0 }}
											className="shrink-0"
										>
											<CaretDownIcon
												className="size-4 text-muted-foreground"
												weight="duotone"
											/>
										</motion.div>
									</button>
									<AnimatePresence initial={false}>
										{currentOpen === index ? (
											<motion.div
												animate={{ opacity: 1, height: "auto" }}
												className="relative overflow-hidden"
												exit={{ opacity: 0, height: 0 }}
												initial={{ opacity: 0, height: 0 }}
											>
												<motion.div className="text-sm">
													{item.list.map((listItem) => (
														<div key={listItem.title}>
															<Suspense fallback={<>Loading...</>}>
																{listItem.group ? (
																	<div className="mx-5 my-1 flex flex-row items-center gap-2">
																		<p className="bg-gradient-to-tr from-gray-900 to-stone-900 bg-clip-text text-sm text-transparent dark:from-gray-100 dark:to-stone-200">
																			{listItem.title}
																		</p>
																		<div className="h-px flex-grow bg-linear-to-r from-stone-800/90 to-stone-800/60" />
																	</div>
																) : listItem.children ? (
																	<div>
																		<button
																			className="flex w-full items-center gap-3 px-6 py-2 text-left text-muted-foreground text-sm hover:bg-muted/50 hover:text-foreground"
																			onClick={() => {
																				const newOpen = new Set(nestedOpen);
																				if (newOpen.has(listItem.title)) {
																					newOpen.delete(listItem.title);
																				} else {
																					newOpen.add(listItem.title);
																				}
																				setNestedOpen(newOpen);
																			}}
																			type="button"
																		>
																			{listItem.icon ? (
																				<listItem.icon
																					className="size-5 shrink-0"
																					weight="duotone"
																				/>
																			) : null}
																			<span className="flex-1">
																				{listItem.title}
																			</span>
																			{listItem.isNew ? <NewBadge /> : null}
																			<motion.div
																				animate={{
																					rotate: nestedOpen.has(listItem.title)
																						? 90
																						: 0,
																				}}
																				className="shrink-0"
																			>
																				<CaretDownIcon
																					className="size-3 text-muted-foreground"
																					weight="duotone"
																				/>
																			</motion.div>
																		</button>
																		<AnimatePresence initial={false}>
																			{nestedOpen.has(listItem.title) && (
																				<motion.div
																					animate={{
																						opacity: 1,
																						height: "auto",
																					}}
																					className="relative overflow-hidden"
																					exit={{ opacity: 0, height: 0 }}
																					initial={{ opacity: 0, height: 0 }}
																				>
																					<div className="ml-4 border-border border-l pl-2">
																						{listItem.children.map((child) => (
																							<AsideLink
																								activeClassName="!bg-muted !text-foreground font-medium"
																								className="flex items-center gap-3 px-6 py-2 text-muted-foreground text-sm hover:bg-muted/50 hover:text-foreground"
																								href={child.href || "#"}
																								key={child.title}
																								startWith="/docs"
																								title={child.title}
																							>
																								{child.icon ? (
																									<child.icon
																										className="size-4 shrink-0"
																										weight="duotone"
																									/>
																								) : null}
																								<span className="flex-1">
																									{child.title}
																								</span>
																								{child.isNew ? (
																									<NewBadge />
																								) : null}
																							</AsideLink>
																						))}
																					</div>
																				</motion.div>
																			)}
																		</AnimatePresence>
																	</div>
																) : (
																	<AsideLink
																		activeClassName="!bg-muted !text-foreground font-medium"
																		className="flex items-center gap-3 px-6 py-2 text-muted-foreground text-sm hover:bg-muted/50 hover:text-foreground"
																		href={listItem.href || "#"}
																		startWith="/docs"
																		title={listItem.title}
																	>
																		{listItem.icon ? (
																			<listItem.icon
																				className="size-5 shrink-0"
																				weight="duotone"
																			/>
																		) : null}
																		<span className="flex-1">
																			{listItem.title}
																		</span>
																		{listItem.isNew ? <NewBadge /> : null}
																	</AsideLink>
																)}
															</Suspense>
														</div>
													))}
												</motion.div>
											</motion.div>
										) : null}
									</AnimatePresence>
								</div>
							))}
						</div>
					</MotionConfig>
				</div>
			</aside>
		</div>
	);
}

function NewBadge({ isSelected }: { isSelected?: boolean }) {
	return (
		<div className="flex items-center justify-end">
			<Badge
				className={cn(
					"!no-underline !decoration-transparent pointer-events-none border-dashed",
					isSelected ? "!border-solid" : ""
				)}
				variant={isSelected ? "default" : "outline"}
			>
				New
			</Badge>
		</div>
	);
}
