import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums",
  {
    variants: {
      variant: {
        default: "border-border text-muted",
        live: "border-signal/40 text-signal",
        watch: "border-watch/40 text-watch",
        alert: "border-alert/40 text-alert",
        solid: "border-transparent bg-raised text-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
