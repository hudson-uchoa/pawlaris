import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewProps } from 'react-native';

export type KeyboardAwareFormProps = Omit<ScrollViewProps, 'children' | 'keyboardShouldPersistTaps'> & {
  children: ReactNode;
  keyboardVerticalOffset?: number;
};

export function KeyboardAwareForm({ children, keyboardVerticalOffset = 0, style,
  contentContainerStyle, ...props }: KeyboardAwareFormProps): ReactElement {
  const container = useRef<View>(null);
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    // Keyboard coordinates are in the window; modal/navigation headers put
    // the form below its origin, so include that inset in native avoidance.
    container.current?.measureInWindow((_x, y) => { setTop(y); });
  }, []);
  return <View ref={container} onLayout={measure} style={{ flex: 1 }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset + top} style={{ flex: 1 }}>
      <ScrollView {...props} style={[{ flex: 1 }, style]} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}
