import { useEffect, useState } from "react";
import { Check, Info, X, AlertCircle } from "lucide-react";
type Kind = "success" | "error" | "info";
interface Toast {
  id: string;
  message: string;
  kind: Kind;
}
export function notify(message: string, kind: Kind = "info") {
  window.dispatchEvent(
    new CustomEvent("kurio:toast", {
      detail: { id: crypto.randomUUID(), message, kind },
    }),
  );
}
export function useToast() {
  return {
    notify,
    toast: ({
      title,
      description,
      variant,
    }: {
      title: string;
      description?: string;
      variant?: string;
    }) =>
      notify(
        [title, description].filter(Boolean).join(" "),
        variant === "destructive" ? "error" : "info",
      ),
  };
}
export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const receive = (event: Event) => {
      const toast = (event as CustomEvent<Toast>).detail;
      setToasts((items) => [...items.slice(-3), toast]);
      timers.add(
        setTimeout(
          () =>
            setToasts((items) => items.filter((item) => item.id !== toast.id)),
          5000,
        ),
      );
    };
    window.addEventListener("kurio:toast", receive);
    return () => {
      window.removeEventListener("kurio:toast", receive);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="toast-region" role="region" aria-label="Notificações">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "success" ? (
            <Check size={18} />
          ) : toast.kind === "error" ? (
            <AlertCircle size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{toast.message}</span>
          <button
            aria-label="Dispensar notificação"
            onClick={() =>
              setToasts((items) => items.filter((item) => item.id !== toast.id))
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
