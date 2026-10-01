import React, { type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

// Local shadcn-compatible primitives keep the port independent of Web aliases.
export function Button({ className, variant = "default", size = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) {
  return <button className={cn("inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring",
    variant === "ghost" ? "hover:bg-accent hover:text-accent-foreground" : variant === "outline" ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground" : variant === "secondary" ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground",
    size === "icon-sm" ? "size-7" : size === "icon" ? "size-9" : size === "sm" ? "h-8 px-3" : "h-9 px-4", className)} {...props} />;
}
export function Badge({ className, variant = "secondary", ...props }: ComponentProps<"span"> & { variant?: string }) {
  return <span className={cn("inline-flex w-fit shrink-0 items-center justify-center rounded-md border border-transparent px-2 py-0.5 text-xs font-medium", variant === "secondary" ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground", className)} {...props} />;
}
export function ButtonGroup({ className, orientation = "horizontal", ...props }: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return <div role="group" className={cn("inline-flex w-fit items-stretch", orientation === "vertical" && "flex-col", className)} {...props} />;
}
export function ButtonGroupText({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center gap-2 rounded-md border bg-muted px-4 py-2 text-sm font-medium", className)} {...props} />;
}
export function TooltipProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function Tooltip({ children }: { children: ReactNode }) { return <>{children}</>; }
export function TooltipTrigger({ children }: { children: ReactNode; asChild?: boolean }) { return <>{children}</>; }
export function TooltipContent({ children }: { children: ReactNode }) { return <span className="sr-only">{children}</span>; }
export function Shimmer({ children, duration = 2, className }: { children: ReactNode; duration?: number; className?: string }) {
  return <p className={cn("relative inline-block bg-clip-text text-transparent ai-elements-official-shimmer", className)} style={{ backgroundImage: "linear-gradient(90deg, transparent 35%, var(--background) 50%, transparent 65%), linear-gradient(var(--muted-foreground), var(--muted-foreground))", backgroundSize: "250% 100%, auto", backgroundRepeat: "no-repeat, padding-box", animationDuration: `${duration}s` }}>{children}</p>;
}
export function CodeBlock({ code, language = "text" }: { code?: string; language?: string }) {
  return <pre className="overflow-x-auto rounded-md p-4 text-sm whitespace-pre" data-language={language}><code>{code}</code></pre>;
}
