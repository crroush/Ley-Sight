import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

type ModalDialogProps = {
  children: ReactNode;
  className?: string;
  titleId: string;
  descriptionId?: string;
  onDismiss?: () => void;
  closeOnEscape?: boolean;
  dismissOnBackdrop?: boolean;
  initialFocus?: string;
};

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Shared accessible behavior for the application's modal dialogs. */
export function ModalDialog({
  children,
  className = "",
  titleId,
  descriptionId,
  onDismiss,
  closeOnEscape = true,
  dismissOnBackdrop = false,
  initialFocus,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const target = (initialFocus
      ? dialog?.querySelector<HTMLElement>(initialFocus)
      : null) ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
    target?.focus();

    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [initialFocus]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && closeOnEscape && onDismiss) {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (!focusable.length) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === first ||
        !focusable.includes(activeElement as HTMLElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (dismissOnBackdrop && onDismiss && event.target === event.currentTarget) {
      onDismiss();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className={`dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
