import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/Button'
import { colors, boardHead, radius } from '@/theme'

interface ConfirmModalProps {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A deliberate yes/no, matching the dashboard's own ConfirmModal.
 *
 * The one thing it guards here is sign-out. That is a heavier action on the
 * counter phone than it looks: the cashier is signed in for the whole shift,
 * the button sits in the header a thumb's width from the class row, and
 * signing back in means finding the shop password mid-queue.
 *
 * Cancel is the wide, calm choice and the backdrop also cancels — the modal
 * only ever loses the session when someone means it.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onCancel}
      statusBarTranslucent
    >
      <View style={styles.wrap}>
        {/* A stray backdrop tap must not cancel mid-request. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onCancel}
        />
        <View style={styles.card}>
          <Text style={[boardHead, styles.title]}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              variant="ghost"
              onPress={onCancel}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              loading={busy}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    padding: 18,
  },
  title: { fontSize: 18 },
  message: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
})
