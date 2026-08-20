import { useEffect, useState } from 'react'
import { Keyboard, Platform, type KeyboardEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface KeyboardState {
  /**
   * How far a bottom-anchored element must rise to clear the keyboard, in dp.
   * 0 when the keyboard is closed.
   */
  height: number
  visible: boolean
}

/**
 * The measured keyboard height, corrected for edge-to-edge.
 *
 * `KeyboardAvoidingView` is enough for a full screen, but it cannot move a
 * bottom sheet: the sheet is inside a `<Modal>`, and on Android a modal window
 * does not receive the activity's `adjustResize`, so the OS never shrinks it
 * and the sheet keeps sitting under the keyboard. Measuring the height and
 * padding the sheet ourselves is the only thing that works on both platforms.
 *
 * The correction is the part that was missing. The app runs `edgeToEdgeEnabled`,
 * so it already draws behind the gesture bar and every bottom-anchored element
 * pads itself by `insets.bottom`. Android reports the keyboard in *screen*
 * coordinates, which include that same inset — so lifting an element by the raw
 * number counts the gesture bar twice and leaves a dead band of empty sheet
 * under the field. Subtracting the inset yields the distance the element
 * actually has to travel, and `Math.max(…, 0)` keeps a split or floating
 * keyboard shorter than the inset from pushing it downward.
 *
 * iOS fires `keyboardWillShow` ahead of the animation, so the sheet moves with
 * the keyboard rather than after it. Android only has `keyboardDidShow`.
 */
export function useKeyboard(): KeyboardState {
  const [rawHeight, setRawHeight] = useState(0)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setRawHeight(e.endCoordinates.height)
    })
    const hide = Keyboard.addListener(hideEvent, () => setRawHeight(0))

    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  const visible = rawHeight > 0

  return {
    visible,
    height: visible ? Math.max(rawHeight - insets.bottom, 0) : 0,
  }
}
