import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'
import { colors, radius, TAP } from '@/theme'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const inactive = disabled || loading

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive) }}
      // Opacity on press rather than a scale transform: it reads instantly on
      // a low-end Android tablet, where a spring animation drops frames.
      style={({ pressed }) => [
        styles.base,
        variantStyle[variant],
        pressed && !inactive && pressedStyle[variant],
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.chalk} />
      ) : (
        <Text style={[styles.label, labelStyle[variant]]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
  },
  label: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
})

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.red, borderColor: colors.red },
  secondary: { backgroundColor: colors.surface2, borderColor: colors.lineStrong },
  ghost: { backgroundColor: 'transparent', borderColor: colors.line },
}

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.redDeep, borderColor: colors.redDeep },
  secondary: { backgroundColor: colors.line },
  ghost: { backgroundColor: colors.surface },
}

const labelStyle = {
  primary: { color: '#FFFFFF' },
  secondary: { color: colors.chalk },
  ghost: { color: colors.muted },
} as const
