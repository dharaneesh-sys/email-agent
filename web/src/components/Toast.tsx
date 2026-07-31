import type { ComponentType } from 'react';
import type { ToastVariant } from '../types';
import type { IconProps } from '../icons';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from '../icons';

export interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
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
      aria-live="polite"
      aria-atomic="true"
    >
      {toast && Icon && (
        <div
          key={toast.id}
          className={`toast toast-${toast.variant}${toast.leaving ? ' toast-leaving' : ''}`}
        >
          <Icon size={18} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
