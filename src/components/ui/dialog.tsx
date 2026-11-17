import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogPortal = Primitive.Portal;
export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof Primitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof Primitive.Overlay>
>(({ className, ...props }, ref) => (
  <Primitive.Overlay
    ref={ref}
    className={cn("dialog-overlay", className)}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content> & {
    showCloseButton?: boolean;
  }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <Primitive.Content
      ref={ref}
      className={cn("dialog-content", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Primitive.Close className="dialog-close" aria-label="Fechar">
          <X size={18} />
        </Primitive.Close>
      )}
    </Primitive.Content>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";
export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("dialog-header", className)} {...props} />;
}
export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("dialog-footer", className)} {...props} />;
}
export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof Primitive.Title>,
  React.ComponentPropsWithoutRef<typeof Primitive.Title>
>(({ className, ...props }, ref) => (
  <Primitive.Title
    ref={ref}
    className={cn("dialog-title", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof Primitive.Description>,
  React.ComponentPropsWithoutRef<typeof Primitive.Description>
>(({ className, ...props }, ref) => (
  <Primitive.Description
    ref={ref}
    className={cn("dialog-description", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
