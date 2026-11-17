import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Button pattern, themed to Kurio's design tokens.
const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-light",
        outline:
          "border border-primary bg-transparent text-primary hover:bg-primary/10",
        ghost: "bg-transparent text-foreground hover:bg-surface",
        secondary: "bg-surface text-foreground hover:bg-raised",
      },
      size: {
        default: "h-11 rounded-md px-5 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        icon: "size-10 rounded-full p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
export { buttonVariants };
