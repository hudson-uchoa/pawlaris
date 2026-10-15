import type { ReactElement, ReactNode } from 'react';

export type ToastProps = {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
};

export type ToastProviderProps = {
  children: ReactNode;
  dismissLabel: string;
};

export type ToastController = {
  show: (message: string) => void;
  dismiss: () => void;
};

export function Toast(_props: ToastProps): ReactElement | null {
  return null;
}

export function ToastProvider(_props: ToastProviderProps): ReactElement | null {
  return null;
}

export function ToastHost(): ReactElement | null {
  return null;
}

export function useToast(): ToastController {
  throw new Error('useToast not implemented');
}
