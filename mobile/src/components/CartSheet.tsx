import { useRef } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Button } from '@/components/Button'
import { Sheet } from '@/components/Sheet'
import { formatPeso } from '@shared/lib/currency'
import {
  bpToPercent,
  cartCommissionPaid,
  cartDiscount,
  cartNetTotal,
  cartShare,
  cartTotal,
  clampDiscountBp,
  hasPromo,
  lineTotal,
  percentToBp,
  type CartLine,
} from '@shared/lib/pricing'
import { PAYMENT_LABELS, type PaymentMethod } from '@shared/lib/domain'
import { colors, boardHead, boardLabel, radius, TAP } from '@/theme'

const PAYMENTS: PaymentMethod[] = ['cash', 'gcash', 'card', 'bank_transfer']

interface CartSheetProps {
  visible: boolean
  lines: CartLine[]
  sizeLabel: string | null
  crewNames: string[]
  crewSize: number
  payment: PaymentMethod
  plate: string
  /** What the vehicle is — "Toyota Vios". Free text, optional. */
  vehicleNote: string
  /** A promo off the whole ticket, in basis points (2000 = 20%). */
  discountRateBp: number
  saving: boolean
  onClose: () => void
  onPaymentChange: (p: PaymentMethod) => void
  onPlateChange: (v: string) => void
  onVehicleNoteChange: (v: string) => void
  onDiscountChange: (bp: number) => void
  onQuantityChange: (serviceId: string, quantity: number) => void
  onRemove: (serviceId: string) => void
  onPickCrew: () => void
  onSubmit: () => void
}

/**
 * The receipt before it is a receipt.
 *
 * Commission is shown with the same functions the dashboard and Postgres use
 * (`cartCommissionPaid` / `cartShare`), so the number the cashier reads out to
 * the crew is the number payroll will pay — including the deliberate round-up
 * overage on an uneven split.
 *
 * The plate field is the last thing in the scroller, which is exactly where a
 * keyboard lands. `Sheet` lifts the whole sheet by the measured keyboard
 * height; this component's own job is to scroll that field into view once the
 * lift has happened, so the cashier can see what they are typing.
 */
export function CartSheet({
  visible,
  lines,
  sizeLabel,
  crewNames,
  crewSize,
  payment,
  plate,
  vehicleNote,
  discountRateBp,
  saving,
  onClose,
  onPaymentChange,
  onPlateChange,
  onVehicleNoteChange,
  onDiscountChange,
  onQuantityChange,
  onRemove,
  onPickCrew,
  onSubmit,
}: CartSheetProps) {
  const scrollRef = useRef<ScrollView>(null)

  const total = cartTotal(lines)
  // Off the UNDISCOUNTED cart, deliberately: the promo is the shop's
  // concession to the customer, never the crew's. Postgres applies the same
  // rule, so this preview matches what the sale stores.
  const discount = cartDiscount(lines, discountRateBp)
  const netTotal = cartNetTotal(lines, discountRateBp)
  const promoOn = hasPromo(discountRateBp)
  const paid = crewSize > 0 ? cartCommissionPaid(lines, crewSize) : 0
  const each = crewSize > 0 ? cartShare(lines, crewSize) : 0

  const ready = lines.length > 0 && crewSize > 0 && Boolean(sizeLabel)

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <Text style={[boardHead, styles.title]}>Cart</Text>
        <Text style={styles.sizeTag}>{sizeLabel ?? '—'}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        // Without this the first tap on a chip or Remove while the keyboard is
        // up is swallowed by the dismiss.
        keyboardShouldPersistTaps="handled"
        // Dragging the list is how a thumb naturally puts the keyboard away.
        keyboardDismissMode="on-drag"
      >
        {lines.length === 0 ? (
          <Text style={styles.empty}>Nothing added yet.</Text>
        ) : (
          lines.map((line) => (
            <View key={line.serviceId} style={styles.line}>
              <View style={styles.lineTop}>
                <View style={styles.lineNameWrap}>
                  <Text style={styles.lineName} numberOfLines={2}>
                    {line.serviceName}
                  </Text>
                  {/* Custom lines carry a typed note; it prints with the name. */}
                  {line.description ? (
                    <Text style={styles.lineNote} numberOfLines={2}>
                      {line.description}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.lineTotal}>{formatPeso(lineTotal(line))}</Text>
              </View>

              <View style={styles.lineBottom}>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => onQuantityChange(line.serviceId, line.quantity - 1)}
                    style={styles.step}
                    accessibilityLabel={`Decrease ${line.serviceName}`}
                  >
                    <Text style={styles.stepText}>{'−'}</Text>
                  </Pressable>
                  <Text style={styles.qty}>{line.quantity}</Text>
                  <Pressable
                    onPress={() => onQuantityChange(line.serviceId, line.quantity + 1)}
                    style={styles.step}
                    accessibilityLabel={`Increase ${line.serviceName}`}
                  >
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>

                <Pressable onPress={() => onRemove(line.serviceId)} hitSlop={8}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Text style={[boardLabel, styles.section]}>Crew</Text>
        <Pressable onPress={onPickCrew} style={styles.crewBtn}>
          <Text
            style={[styles.crewText, crewNames.length === 0 && styles.crewEmpty]}
            numberOfLines={2}
          >
            {crewNames.length
              ? crewNames.join(', ')
              : 'Tap to pick who washed this car'}
          </Text>
        </Pressable>

        <Text style={[boardLabel, styles.section]}>Payment</Text>
        <View style={styles.chips}>
          {PAYMENTS.map((p) => (
            <Pressable
              key={p}
              onPress={() => onPaymentChange(p)}
              style={[styles.chip, payment === p && styles.chipOn]}
            >
              <Text style={[styles.chipText, payment === p && styles.chipTextOn]}>
                {PAYMENT_LABELS[p]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Vehicle before plate: it is what the cashier is looking at, and
            `words` capitalisation suits a model name where the plate field's
            `characters` does not. Both scroll themselves into view on focus —
            `Sheet` lifts by the keyboard height, and this puts the focused
            field above the keys rather than behind the totals bar. */}
        <Text style={[boardLabel, styles.section]}>Vehicle (optional)</Text>
        <TextInput
          value={vehicleNote}
          onChangeText={onVehicleNoteChange}
          placeholder="e.g. Toyota Vios"
          placeholderTextColor={colors.faint}
          autoCapitalize="words"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="next"
          onFocus={() =>
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180)
          }
        />

        <Text style={[boardLabel, styles.section]}>Plate (optional)</Text>
        <TextInput
          value={plate}
          onChangeText={onPlateChange}
          placeholder="ABC 1234"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="done"
          onFocus={() =>
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180)
          }
        />

        {/* The promo is last because it is the least-used field and the one
            typed while reading the total back to the customer. */}
        <Text style={[boardLabel, styles.section]}>Promo % (optional)</Text>
        <TextInput
          value={discountRateBp === 0 ? '' : String(bpToPercent(discountRateBp))}
          onChangeText={(raw) => {
            const text = raw.trim()
            if (text === '') return onDiscountChange(0)
            const pct = Number(text)
            if (!Number.isFinite(pct)) return
            // Clamped here as well as in Postgres, so the sheet can never show
            // a total the RPC would refuse to write.
            onDiscountChange(clampDiscountBp(percentToBp(Math.min(Math.max(pct, 0), 100))))
          }}
          placeholder="0"
          placeholderTextColor={colors.faint}
          keyboardType="number-pad"
          style={styles.input}
          returnKeyType="done"
          onFocus={() =>
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180)
          }
        />
      </ScrollView>

      <View style={styles.totals}>
        {promoOn ? (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.subLabel}>Subtotal</Text>
              <Text style={styles.struck}>{formatPeso(total)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.subLabel}>Promo ({bpToPercent(discountRateBp)}%)</Text>
              <Text style={styles.promoValue}>-{formatPeso(discount)}</Text>
            </View>
          </>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          {/* What the customer owes, promo already taken off. */}
          <Text style={styles.totalValue}>{formatPeso(netTotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.subLabel}>
            Commission{crewSize > 1 ? ` · ${crewSize} split` : ''}
            {promoOn ? ' · full price' : ''}
          </Text>
          <Text style={styles.subValue}>
            {formatPeso(paid)}
            {crewSize > 1 ? `  (${formatPeso(each)} each)` : ''}
          </Text>
        </View>
      </View>

      <Button
        label={saving ? 'Saving…' : 'Save sale'}
        onPress={onSubmit}
        disabled={!ready}
        loading={saving}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20 },
  sizeTag: {
    color: colors.chalk,
    fontSize: 12,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  // `minHeight: 0` is what actually lets this shrink: a scroll container's flex
  // basis is its content, and Yoga will not go below that basis without it, so
  // `flexShrink` alone left the totals and Save button off the squeezed sheet.
  body: { flexShrink: 1, minHeight: 0, marginTop: 12 },
  empty: { color: colors.faint, fontSize: 13, paddingVertical: 16 },
  line: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    padding: 12,
    marginBottom: 8,
  },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  // The flex sits on the wrapper, not the name, so a two-line note stays
  // inside the same column as the name rather than shoving the total off.
  lineNameWrap: { flex: 1 },
  lineName: { color: colors.chalk, fontSize: 14, fontWeight: '700' },
  lineNote: { color: colors.faint, fontSize: 11, marginTop: 2 },
  lineTotal: { color: colors.chalk, fontSize: 15, fontWeight: '800' },
  lineBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.chalk, fontSize: 19, fontWeight: '800' },
  qty: {
    color: colors.chalk,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 34,
    textAlign: 'center',
  },
  remove: { color: colors.faint, fontSize: 13, fontWeight: '600' },
  section: { color: colors.faint, fontSize: 10, marginTop: 16, marginBottom: 8 },
  crewBtn: {
    minHeight: TAP,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  crewText: { color: colors.chalk, fontSize: 14, fontWeight: '600' },
  crewEmpty: { color: colors.faint, fontWeight: '400' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
  },
  chipOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: colors.chalk },
  input: {
    minHeight: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.chalk,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  totals: {
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 12,
    marginTop: 12,
    marginBottom: 12,
    gap: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  totalValue: { color: colors.chalk, fontSize: 24, fontWeight: '800' },
  subLabel: { color: colors.faint, fontSize: 12 },
  struck: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  promoValue: { color: colors.red, fontSize: 12, fontWeight: '700' },
  subValue: { color: colors.muted, fontSize: 12, fontWeight: '600' },
})
