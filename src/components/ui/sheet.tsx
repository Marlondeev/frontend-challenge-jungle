import type { ComponentProps } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogContent,
} from "./dialog";
import { cn } from "@/lib/utils";
export {
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
  DialogHeader as SheetHeader,
  DialogFooter as SheetFooter,
};
export function SheetContent({
  className,
  side = "right",
  ...props
}: ComponentProps<typeof DialogContent> & {
  side?: "left" | "right" | "bottom";
}) {
  return (
    <DialogContent
      className={cn("sheet-content", `sheet-${side}`, className)}
      {...props}
    />
  );
}
