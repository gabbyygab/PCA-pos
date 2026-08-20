import type { ReactNode } from 'react'
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import { colors, radius } from '@/theme'

interface SheetProps {
  visible: boolean
  onClose: () => void
  children: ReactNode
  /** Cap on the sheet's height as a share of the screen. */
  maxHeight?: ViewStyle['maxHeight']
}

/**
 * A bottom sheet that gets out of the keyboard's way.
 *
 * Every sheet in this app has a field near its bottom edge — the plate number,
 * the crew filter — which is exactly where the keyboard lands. Two things have
 * to happen for that to work, and neither is automatic inside a `<Modal>`:
 *
 * 1. The sheet lifts by the corrected keyboard height. `KeyboardAvoidingView`
 *    is unreliable here because an Android modal window is not resized by
 *    `adjustResize`, so the view has nothing to react to.
 * 2. The safe-area bottom padding is dropped while the keyboard is up. The
 *    gesture bar is hidden behind the keyboard, so reserving room for it just
 *    adds a dead band under the field — and `useKeyboard` has already taken
 *    that inset out of the lift, so padding for it here as well would put it
 *    back.
 * 3. The body scrolls. A sheet capped at 90% of the screen with the keyboard
 *    over the bottom half has well under half the screen left, and its content
 *    was simply clipped at the fold; the cap has to come off the *remaining*
 *    space, not the whole screen.
 *
 * Tapping the backdrop dismisses the keyboard first when it is open, so the
 * cashier's first tap outside a field never also closes the sheet and loses
 * what they typed.
 */
export function Sheet({ visible, onClose, children, maxHeight = '90%' }: SheetProps) {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()
  const { height: screen } = useWindowDimensions()

  // A percentage `maxHeight` resolves against the full screen, which stops
  // being the space available the moment the keyboard covers part of it. Once
  // it is up, cap against what is actually left instead, so the sheet shrinks
  // rather than pushing its own footer off the top.
  //
  // The budget is measured against the sheet's *lifted* position: it has
  // already moved up by `keyboard.height`, so that is what to subtract, not the
  // raw OS number — subtracting the raw height would take the gesture-bar inset
  // out twice and leave the sheet needlessly short. No floor is applied: a
  // minimum taller than the real gap is exactly the overflow this is fixing.
  const cap = keyboard.visible
    ? Math.max(screen - keyboard.height - insets.top - 12, 0)
    : maxHeight

  function dismiss() {
    if (keyboard.visible) {
      Keyboard.dismiss()
      return
    }
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={dismiss} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: cap,
              marginBottom: keyboard.height,
              paddingBottom: keyboard.visible ? 12 : insets.bottom + 12,
            },
          ]}
        >
          <View style={styles.grabber} />
          {children}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 16,
    paddingTop: 10,
    // The sheet lifts on top of the keyboard, so on Android it must not also
    // be pushed by the window — the two would double up.
    ...Platform.select({ android: { elevation: 0 } }),
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 10,
  },
})
