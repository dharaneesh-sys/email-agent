/* Toast — fixed bottom center, amber info border 50% var(--accent-primary), charcoal+tinted shadow var(--shadow-toast), var(--shadow-tinted) */
import type { ComponentType } from 'react';
import type { ToastVariant } from '../types';
import type { IconProps } from '../icons';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from '../icons';

export interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

const TOAST_ICONS = {
  success: CheckCircleIcon,
  error: AlertTriangleIcon,
  info: InfoIcon,
} as const;

export function Toast({ toast }: { toast: ToastState | null }) {
  const isError = toast?.variant === 'error';
  const Icon: ComponentType<IconProps> | null = toast ? TOAST_ICONS[toast.variant] : null;
  return (
    <div
      className="toast-region"
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast && Icon && (
        <div
          key={toast.id}
          className={`toast toast-${toast.variant}${toast.leaving ? ' toast-leaving' : ''}`}
          role="alert"
          aria-live="polite"
        >
          <Icon size={18} />
          <span className="toast-message">{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              className="toast-action"
              onClick={toast.onAction}
              aria-label={toast.actionLabel}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
