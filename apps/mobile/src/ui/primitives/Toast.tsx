import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { borderWidth, elevation } from '../tokens/elevation';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { Button } from './Button';
import { Text } from './Text';

export type ToastProps = {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  active?: boolean;
  testID?: string;
};

export type ToastProviderProps = {
  children: ReactNode;
  dismissLabel: string;
};

export type ToastController = {
  show: (message: string) => void;
  dismiss: () => void;
};

type ToastContextValue = { message: string | null; dismissLabel: string; controller: ToastController };
const ToastContext = createContext<ToastContextValue | null>(null);

export function Toast({ message, dismissLabel, onDismiss, active = true, testID }: ToastProps): ReactElement | null {
  void active;
  const { color } = useTheme();
  return <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, backgroundColor: color.surface, borderColor: color.border,
    borderWidth, borderRadius: radius.card, elevation: elevation.card }}>
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite"
      accessibilityLabel={message} style={{ flex: 1 }}><Text>{message}</Text></View>
    <Button label={dismissLabel} accessibilityLabel={dismissLabel} onPress={onDismiss} />
  </View>;
}

export function ToastProvider({ children, dismissLabel }: ToastProviderProps): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  const controller = useMemo<ToastController>(() => ({
    show: (next) => { setMessage(next); }, dismiss: () => { setMessage(null); },
  }), []);
  const value = useMemo(() => ({ message, dismissLabel, controller }), [message, dismissLabel, controller]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export type ToastHostProps = { active?: boolean; bottomInset?: number };

export function ToastHost(props: ToastHostProps = {}): ReactElement | null {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('ToastHost requires a ToastProvider');
  if (context.message === null) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg }}>
    <Toast message={context.message} dismissLabel={context.dismissLabel} onDismiss={context.controller.dismiss}
      active={props.active ?? true} testID="toast" />
  </View>;
}

export function useToast(): ToastController {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast requires a ToastProvider');
  return context.controller;
}
