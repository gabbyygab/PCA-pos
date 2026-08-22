import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button } from '@/components/Button'
import { Sheet } from '@/components/Sheet'
import { CrewSheet } from '@/components/CrewSheet'
import { useEmployees } from '@/lib/queries/employees'
import { useLineCrew, type ServiceLine, type ServiceTicket } from '@/lib/queries/services'
import { centavosToPesos, formatPeso, pesosToCentavos } from '@shared/lib/currency'
import {
  PAYMENT_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUSES,
  type PaymentMethod,
  type ServiceStatus,
} from '@shared/lib/domain'
import {
  bpToPercent,
  clampDiscountBp,
  formatRate,
  percentToBp,
} from '@shared/lib/pricing'
import { boardHead, boardLabel, colors, radius, TAP } from '@/theme'

export interface ServiceLineEdit {
  quantity: number
  unitPriceCentavos: number
  employeeIds: string[]
  status: ServiceStatus
  /** The ticket's own fields, saved alongside the line. */
  paymentMethod: PaymentMethod
  /** Empty means "clear it" — both columns are nullable. */
  vehicleNote: string
  plateNumber: string
  /** The promo on the whole ticket, in basis points. Its own RPC writes it. */
  discountRateBp: number
}

interface ServiceLineSheetProps {
  line: ServiceLine | null
  ticket: ServiceTicket | null
  busy: boolean
  onClose: () => void
  onSave: (edit: ServiceLineEdit) => void
}

/**
 * One service line, opened for correction — the dashboard's ServiceLineDialog
 * stacked for one thumb.
 *
 * The inline row buttons cover the common case: a line finishes, the crew taps
 * Done. This is the uncommon one, and it matters most on the phone, because the
 * person who mis-typed a price is standing at the bay with it. Fixing it here
 * beats calling the owner, which is what the alternative actually is.
 *
 * It also edits the three things that belong to the car rather than the line —
 * payment method, vehicle name, plate number. The payment method is the one
 * that matters most here: the cashier who tapped GCash instead of Cash is the
 * one holding the money, and until now nothing could fix it, so one mis-tap
 * silently misfiled the whole ticket in the owner's payment breakdown. They
 * save through a second RPC, `edit_sale_ticket`.
 *
 * Two fields are shown but never editable, for the same reason in both cases:
 * they are the record of what happened. The commission RATE is snapshotted at
 * sale time so that editing a rate in Settings cannot rewrite history, and
 * letting it be retyped here would reopen that hole from the other side. The
 * service NAME is what the receipt promised and what every per-service report
 * counts. Both are corrected by refunding and re-ringing. There is likewise no
 * delete: that RPC is owner-only, so the cashier's correction is a refund,
 * which leaves the mistake visible on the ticket.
 */
export function ServiceLineSheet({
  line,
  ticket,
  busy,
  onClose,
  onSave,
}: ServiceLineSheetProps) {
  const { data: employees } = useEmployees()
  const { data: crew, isLoading: crewLoading } = useLineCrew(line?.id ?? null)

  // Keyed off the line id so reopening on a different service starts from that
  // service's values rather than the last one's.
  const [draftFor, setDraftFor] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  // Held as the typed string, not a number: parsing on every keystroke turns
  // "150." into 150 and fights the cursor mid-entry.
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<ServiceStatus>('pending')
  const [employeeIds, setEmployeeIds] = useState<string[] | null>(null)
  const [crewOpen, setCrewOpen] = useState(false)

  // The ticket's own fields. They belong to the car, not to this line, but
  // this sheet is already the gesture for "these details are wrong", and the
  // cashier who notices the payment method mid-shift is looking at a line.
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [vehicleNote, setVehicleNote] = useState('')
  const [plate, setPlate] = useState('')
  // The promo the line was sold under. One percentage covers the ticket, so it
  // is read off this line and written back across all of them.
  const [promo, setPromo] = useState('')

  // Reset during render rather than in an effect: an effect would paint one
  // frame of the previous service's values before correcting itself.
  if (line && draftFor !== line.id) {
    setDraftFor(line.id)
    setQuantity(line.quantity)
    setPrice(String(centavosToPesos(line.unit_price_centavos)))
    setStatus(line.status)
    setEmployeeIds(null)
    setCrewOpen(false)
    setPromo(String(bpToPercent(line.discount_rate_bp) || ''))
    if (ticket) {
      setPayment(ticket.payment_method)
      setVehicleNote(ticket.vehicle_note ?? '')
      setPlate(ticket.plate_number ?? '')
    }
  }

  const loadedCrew = useMemo(() => (crew ?? []).map((c) => c.employee_id), [crew])
  const selectedCrew = employeeIds ?? loadedCrew

  const crewNames = useMemo(
    () =>
      selectedCrew
        .map((id) => employees?.find((e) => e.id === id)?.name)
        .filter((n): n is string => Boolean(n)),
    [selectedCrew, employees]
  )

  const parsedPrice = Number(price)
  const priceValid = price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0
  const unitPriceCentavos = priceValid
    ? pesosToCentavos(parsedPrice)
    : (line?.unit_price_centavos ?? 0)

  const parsedPromo = promo.trim() === '' ? 0 : Number(promo)
  const promoValid =
    Number.isFinite(parsedPromo) && parsedPromo >= 0 && parsedPromo <= 100
  const discountRateBp = promoValid ? clampDiscountBp(percentToBp(parsedPromo)) : 0

  const lineTotal = unitPriceCentavos * quantity
  // Rounded down, mirroring create_sale.
  const discount = Math.floor((lineTotal * discountRateBp) / 10000)
  const netTotal = lineTotal - discount
  // Mirrors shareOfCommission(): rounded once, then each share rounded up, so
  // the figure here is the one payroll will pay.
  const commission = line
    ? Math.round((lineTotal * line.commission_rate_bp) / 10000)
    : 0
  const share = selectedCrew.length ? Math.ceil(commission / selectedCrew.length) : 0
  const paid = share * selectedCrew.length

  const ready =
    priceValid && promoValid && selectedCrew.length > 0 && !busy && !crewLoading

  function save() {
    if (!ready) return
    onSave({
      quantity,
      unitPriceCentavos,
      employeeIds: selectedCrew,
      status,
      paymentMethod: payment,
      // Both are optional on the sale, so blank is a real answer — "clear it"
      // — rather than a validation failure.
      vehicleNote: vehicleNote.trim(),
      plateNumber: plate.trim(),
      discountRateBp,
    })
  }

  return (
    <>
      <Sheet visible={line !== null && !crewOpen} onClose={onClose} maxHeight="88%">
        <Text style={[boardHead, styles.title]} numberOfLines={1}>
          {ticket ? `#${ticket.receipt_no}` : ''} {line?.service_name ?? ''}
        </Text>
        <Text style={styles.hint}>
          {line ? `Commission ${formatRate(line.commission_rate_bp)}, fixed at sale time.` : ''}
        </Text>

        <ScrollView
          style={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* No name field. What was sold is the identity of the line, and it
              is already the sheet's title, so this is one line saying why it
              is not typed rather than a field-shaped box repeating it. */}
          <Text style={styles.lead}>
            Refund and re-ring to change what was sold.
          </Text>

          {/* Paired on one row — two small values do not each deserve a full
              width of phone. */}
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={[boardLabel, styles.section]}>Quantity</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  style={styles.step}
                  accessibilityLabel="Decrease quantity"
                >
                  <Text style={styles.stepText}>{'−'}</Text>
                </Pressable>
                <Text style={styles.qty}>{quantity}</Text>
                <Pressable
                  onPress={() => setQuantity((q) => q + 1)}
                  style={styles.step}
                  accessibilityLabel="Increase quantity"
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.col}>
              <Text style={[boardLabel, styles.section]}>Unit price</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
          </View>

          <Text style={[boardLabel, styles.section]}>Crew</Text>
          <Pressable onPress={() => setCrewOpen(true)} style={styles.crewBtn}>
            <Text
              style={[styles.crewText, crewNames.length === 0 && styles.crewEmpty]}
              numberOfLines={2}
            >
              {crewLoading
                ? 'Loading the crew…'
                : crewNames.length
                  ? crewNames.join(', ')
                  : 'Tap to pick who washed this car'}
            </Text>
          </Pressable>

          <Text style={[boardLabel, styles.section]}>Status</Text>
          <View style={styles.chips}>
            {SERVICE_STATUSES.map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={[
                  styles.chip,
                  status === s && s === 'done' && styles.chipDone,
                  status === s && s === 'refunded' && styles.chipRefunded,
                  status === s && s === 'pending' && styles.chipPending,
                ]}
              >
                <Text style={[styles.chipText, status === s && styles.chipTextOn]}>
                  {SERVICE_STATUS_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* The ticket, not the line. Ruled off and labelled so it is
              obvious these apply to the whole car. */}
          <View style={styles.ticketBox}>
            <Text style={[boardLabel, styles.ticketHead]}>
              {ticket ? `Receipt #${ticket.receipt_no} · whole car` : 'Whole car'}
            </Text>

            {/* One percentage covers the ticket, so a promo typed here
                rewrites every line's discount — never its commission. */}
            <Text style={[boardLabel, styles.section]}>Promo %</Text>
            <TextInput
              value={promo}
              onChangeText={setPromo}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              style={[styles.input, !promoValid && styles.inputBad]}
            />
            <Text style={styles.hint}>
              Off the customer&rsquo;s total. The crew still earns the full rate.
            </Text>

            <Text style={[boardLabel, styles.section]}>Payment method</Text>
            <View style={styles.chips}>
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setPayment(m)}
                  style={[styles.chip, payment === m && styles.chipOn]}
                >
                  <Text style={[styles.chipText, payment === m && styles.chipTextOn]}>
                    {PAYMENT_LABELS[m]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={[boardLabel, styles.section]}>Vehicle</Text>
                <TextInput
                  value={vehicleNote}
                  onChangeText={setVehicleNote}
                  placeholder="Toyota Vios"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
              </View>

              <View style={styles.col}>
                <Text style={[boardLabel, styles.section]}>Plate number</Text>
                <TextInput
                  value={plate}
                  onChangeText={setPlate}
                  placeholder="ABC 1234"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.fieldNote}>Both optional — blank clears them.</Text>
          </View>

          {/* What the edit is worth, recomputed as the fields change. Only a
              `done` line is revenue, so this says which number is counting. */}
          <View style={styles.summary}>
            {discountRateBp > 0 ? (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Before promo</Text>
                  <Text style={styles.struck}>{formatPeso(lineTotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    Promo ({bpToPercent(discountRateBp)}%)
                  </Text>
                  <Text style={styles.promoValue}>-{formatPeso(discount)}</Text>
                </View>
              </>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Line total</Text>
              <Text style={styles.summaryValue}>{formatPeso(netTotal)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                Employee cut
                {selectedCrew.length > 1 ? ` · ${formatPeso(share)} each` : ''}
              </Text>
              <Text style={styles.summarySub}>{formatPeso(paid)}</Text>
            </View>
            {/* Stated outright: this is the number a reader expects to have
                moved with the promo and which deliberately has not. */}
            {discountRateBp > 0 && line ? (
              <Text style={styles.summaryNote}>
                The cut is {formatRate(line.commission_rate_bp)} of the{' '}
                {formatPeso(lineTotal)} pre-promo price — a discount never comes
                out of the crew&rsquo;s pay.
              </Text>
            ) : null}
            <Text style={styles.summaryNote}>
              {status === 'done'
                ? 'Counts toward sales and the crew’s commission.'
                : status === 'pending'
                  ? 'Work in progress — counts toward neither until it is marked done.'
                  : 'Refunded — stays on the ticket, but the money does not count.'}
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Button label="Cancel" onPress={onClose} variant="ghost" disabled={busy} />
          <Button
            label={busy ? 'Saving…' : 'Save changes'}
            onPress={save}
            disabled={!ready}
            loading={busy}
          />
        </View>
      </Sheet>

      <CrewSheet
        visible={crewOpen}
        employees={employees ?? []}
        selected={selectedCrew}
        onChange={setEmployeeIds}
        onClose={() => setCrewOpen(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 20 },
  hint: { color: colors.faint, fontSize: 12, marginTop: 4 },
  // `minHeight: 0` is what actually lets this shrink: a scroll container's flex
  // basis is its content, and Yoga will not go below that basis without it.
  body: { flexShrink: 1, minHeight: 0, marginTop: 8 },
  section: { color: colors.faint, fontSize: 10, marginTop: 12, marginBottom: 6 },
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
  inputBad: { borderColor: colors.red },
  struck: {
    color: colors.faint,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  promoValue: { color: colors.red, fontSize: 13, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.chalk, fontSize: 20, fontWeight: '800' },
  qty: {
    color: colors.chalk,
    fontSize: 17,
    fontWeight: '800',
    minWidth: 44,
    textAlign: 'center',
  },
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
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
  },
  chipPending: { borderColor: colors.warn, backgroundColor: 'rgba(245,158,11,0.12)' },
  chipDone: { borderColor: colors.good, backgroundColor: 'rgba(34,197,94,0.12)' },
  chipRefunded: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  chipOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.12)' },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: colors.chalk },
  lead: { color: colors.faint, fontSize: 11, marginTop: 4 },
  fieldNote: { color: colors.faint, fontSize: 11, marginTop: 6 },
  // Two fields to a row: `flex: 1` on each column with `minWidth: 0` so a long
  // placeholder cannot push its neighbour off the edge.
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, minWidth: 0 },
  ticketBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ticketHead: { color: colors.faint, fontSize: 10 },
  summary: {
    marginTop: 14,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: { color: colors.faint, fontSize: 12, flexShrink: 1 },
  summaryValue: { color: colors.chalk, fontSize: 16, fontWeight: '800' },
  summarySub: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  summaryNote: {
    color: colors.faint,
    fontSize: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
})
