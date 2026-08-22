import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
  ServiceLineSheet,
  type ServiceLineEdit,
} from '@/components/ServiceLineSheet'
import { useKeyboard } from '@/lib/keyboard/useKeyboard'
import {
  serviceStatusErrorMessage,
  useEditServiceLine,
  useEditSaleTicket,
  useSetSaleDiscount,
  useSetServiceStatus,
  useTodayServices,
  type ServiceLine,
  type ServiceTicket,
} from '@/lib/queries/services'
import { boardHead, boardLabel, colors, radius, space, TAP } from '@/theme'
import { formatPeso } from '@shared/lib/currency'
import {
  SERVICE_STATUS_LABELS,
  VEHICLE_CLASS_LABELS,
  vehicleLabel,
  type ServiceStatus,
} from '@shared/lib/domain'

type Filter = ServiceStatus | 'all'

/**
 * The service record: every car rung up today, with each line's state editable
 * where the crew is standing.
 *
 * The dashboard's page laid out for one thumb — the same grouping and the same
 * three states, but the actions are full-width rows rather than a trailing
 * button cluster, because this is used beside a running wash bay with wet
 * hands.
 */
export function ServicesScreen() {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /* Refunds move money, so they are confirmed rather than fired on a tap. */
  const [refunding, setRefunding] = useState<{ line: ServiceLine; ticket: ServiceTicket } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ line: ServiceLine; ticket: ServiceTicket } | null>(
    null
  )

  const { data, isLoading, isError, refetch, isRefetching } = useTodayServices()
  const setStatus = useSetServiceStatus()
  const editLine = useEditServiceLine()
  const editTicket = useEditSaleTicket()
  const setDiscount = useSetSaleDiscount()

  const tickets = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data ?? [])
      .map((t) => ({
        ...t,
        items: t.items.filter((i) => filter === 'all' || i.status === filter),
      }))
      .filter((t) => {
        if (t.items.length === 0) return false
        if (!needle) return true
        return (
          t.plate_number?.toLowerCase().includes(needle) ||
          t.vehicle_note?.toLowerCase().includes(needle) ||
          String(t.receipt_no).includes(needle) ||
          t.employees?.name.toLowerCase().includes(needle) ||
          t.items.some((i) => i.service_name.toLowerCase().includes(needle))
        )
      })
  }, [data, search, filter])

  const counts = useMemo(() => {
    const all = (data ?? []).flatMap((t) => t.items)
    return {
      all: all.length,
      pending: all.filter((i) => i.status === 'pending').length,
      done: all.filter((i) => i.status === 'done').length,
      refunded: all.filter((i) => i.status === 'refunded').length,
    }
  }, [data])

  async function apply(line: ServiceLine, status: ServiceStatus) {
    setError(null)
    try {
      await setStatus.mutateAsync({ saleItemId: line.id, status })
    } catch (err) {
      setError(serviceStatusErrorMessage(err))
    }
  }

  async function saveEdit(edit: ServiceLineEdit) {
    const target = editing
    if (!target) return
    setError(null)
    try {
      await editLine.mutateAsync({
        saleItemId: target.line.id,
        quantity: edit.quantity,
        unitPriceCentavos: edit.unitPriceCentavos,
        employeeIds: edit.employeeIds,
      })
      // Status moves through its own RPC, and only when it actually changed --
      // `edit_sale_item` deliberately does not touch it.
      if (edit.status !== target.line.status) {
        await setStatus.mutateAsync({ saleItemId: target.line.id, status: edit.status })
      }
      // The header is a third RPC, and only when one of its fields actually
      // moved: a line edit on an untouched ticket should not write `sales`.
      // Empty is a real answer for the two optional text fields -- it clears
      // them -- so it is compared against null, not skipped.
      const nextNote = edit.vehicleNote === '' ? null : edit.vehicleNote
      const nextPlate = edit.plateNumber === '' ? null : edit.plateNumber
      if (
        edit.paymentMethod !== target.ticket.payment_method ||
        nextNote !== (target.ticket.vehicle_note ?? null) ||
        nextPlate !== (target.ticket.plate_number ?? null)
      ) {
        await editTicket.mutateAsync({
          saleId: target.ticket.id,
          paymentMethod: edit.paymentMethod,
          vehicleNote: nextNote,
          plateNumber: nextPlate,
        })
      }
      // The promo is a fourth RPC, for the same reason the header is a third:
      // it writes every line on the ticket, and must not fire on a ticket
      // whose promo nobody touched. `edit_sale_item` already re-applied this
      // line's own discount at its stored rate.
      if (edit.discountRateBp !== target.line.discount_rate_bp) {
        await setDiscount.mutateAsync({
          saleId: target.ticket.id,
          discountRateBp: edit.discountRateBp,
        })
      }
      setEditing(null)
    } catch (err) {
      setError(serviceStatusErrorMessage(err))
    }
  }

  const busy =
    setStatus.isPending ||
    editLine.isPending ||
    editTicket.isPending ||
    setDiscount.isPending

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Services</Text>
        <Text style={styles.sub}>
          {new Date().toLocaleDateString('en-PH', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </View>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Plate, receipt, service, crew"
        placeholderTextColor={colors.faint}
        style={styles.search}
        returnKeyType="search"
        autoCapitalize="characters"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
      >
        <Chip active={filter === 'all'} label={`All ${counts.all}`} onPress={() => setFilter('all')} />
        <Chip
          active={filter === 'pending'}
          label={`In progress ${counts.pending}`}
          tone={colors.warn}
          onPress={() => setFilter('pending')}
        />
        <Chip
          active={filter === 'done'}
          label={`Done ${counts.done}`}
          tone={colors.good}
          onPress={() => setFilter('done')}
        />
        <Chip
          active={filter === 'refunded'}
          label={`Refunded ${counts.refunded}`}
          tone={colors.red}
          onPress={() => setFilter('refunded')}
        />
      </ScrollView>

      {error ? (
        <Pressable onPress={() => setError(null)} style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorDismiss}>Tap to dismiss</Text>
        </Pressable>
      ) : null}

      <ScrollView
        // The search box is above the list, so the keyboard eats the bottom of
        // the tickets rather than the field. Padding by its height keeps the
        // last car scrollable into view instead of stranded behind the keys.
        contentContainerStyle={[
          styles.list,
          // `flexGrow` so a short day still fills the scroller. Content shorter
          // than the viewport cannot be dragged, which killed pull-to-refresh
          // on exactly the screens that need it — "no cars yet today" and the
          // error state, where checking again is the whole point.
          tickets.length === 0 && styles.listEmpty,
          { paddingBottom: insets.bottom + keyboard.height + space(6) },
        ]}
        // An empty list still bounces on iOS, so the gesture is available
        // before the first car of the day is rung up.
        alwaysBounceVertical
        keyboardShouldPersistTaps="handled"
        // Dragging the tickets is how a thumb puts the search keyboard away.
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            // tintColor is the iOS spinner; colors + progressBackgroundColor
            // are Android's, where the default is a white disc that reads as a
            // hole punched in the board.
            tintColor={colors.red}
            colors={[colors.red]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={colors.red} />
        ) : isError ? (
          <Empty text="Could not load today's services. Pull down to retry." />
        ) : tickets.length === 0 ? (
          <Empty
            text={
              search || filter !== 'all'
                ? 'No services match that.'
                : 'No cars rung up yet today.'
            }
          />
        ) : (
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              busy={busy}
              onSet={apply}
              onRefund={(line) => setRefunding({ line, ticket })}
              onEdit={(line) => setEditing({ line, ticket })}
            />
          ))
        )}
      </ScrollView>

      <ServiceLineSheet
        line={editing?.line ?? null}
        ticket={editing?.ticket ?? null}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />

      <ConfirmModal
        visible={refunding !== null}
        title={refunding ? `Refund ${refunding.line.service_name}?` : ''}
        message={
          refunding
            ? `${formatPeso(refunding.line.net_total_centavos)} comes off receipt #${
                refunding.ticket.receipt_no
              } and off the crew's commission for it. The line stays on the ticket marked refunded.`
            : ''
        }
        confirmLabel="Refund"
        busy={busy}
        onConfirm={async () => {
          if (refunding) await apply(refunding.line, 'refunded')
          setRefunding(null)
        }}
        onCancel={() => setRefunding(null)}
      />
    </View>
  )
}

function TicketCard({
  ticket,
  busy,
  onSet,
  onRefund,
  onEdit,
}: {
  ticket: ServiceTicket
  busy: boolean
  onSet: (line: ServiceLine, status: ServiceStatus) => void
  onRefund: (line: ServiceLine) => void
  onEdit: (line: ServiceLine) => void
}) {
  const voided = ticket.voided_at !== null

  return (
    <View style={[styles.card, voided && styles.cardVoided]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            #{ticket.receipt_no} · {VEHICLE_CLASS_LABELS[ticket.vehicle_class]} {ticket.size}
          </Text>
          <Text style={styles.cardSub}>
            {[
              // The vehicle name leads: it is what someone at the bay is
              // looking at, with the plate as the tie-breaker between two of
              // the same car.
              vehicleLabel(ticket.vehicle_note, ticket.plate_number),
              ticket.employees?.name,
              new Date(ticket.sold_at).toLocaleTimeString('en-PH', {
                hour: 'numeric',
                minute: '2-digit',
              }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.cardTotal}>{formatPeso(ticket.total_centavos)}</Text>
          {voided ? <Text style={styles.voidedTag}>Voided</Text> : null}
        </View>
      </View>

      {ticket.items.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          disabled={busy || voided}
          onSet={(status) => onSet(line, status)}
          onRefund={() => onRefund(line)}
          onEdit={() => onEdit(line)}
        />
      ))}
    </View>
  )
}

function LineRow({
  line,
  disabled,
  onSet,
  onRefund,
  onEdit,
}: {
  line: ServiceLine
  disabled: boolean
  onSet: (status: ServiceStatus) => void
  onRefund: () => void
  onEdit: () => void
}) {
  const refunded = line.status === 'refunded'
  const tone =
    line.status === 'done' ? colors.good : refunded ? colors.red : colors.warn

  return (
    <View style={styles.line}>
      <View style={styles.lineTop}>
        {/* The name opens the edit sheet. A whole-row press would fight the
            action buttons sitting inside the same row. */}
        <Pressable
          onPress={onEdit}
          disabled={disabled}
          style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.6 }]}
          accessibilityLabel={`Edit ${line.service_name}`}
        >
          <Text style={[styles.lineName, refunded && styles.struck]} numberOfLines={2}>
            {line.service_name}
            {line.quantity > 1 ? `  ×${line.quantity}` : ''}
            <Text style={styles.editHint}>{'  ✎'}</Text>
          </Text>
          <Text style={[boardLabel, styles.lineStatus, { color: tone }]}>
            {SERVICE_STATUS_LABELS[line.status]}
          </Text>
        </Pressable>
        {/* A discounted line shows what the customer paid, with the board
            price struck above it. */}
        <View style={styles.priceCol}>
          {line.discount_centavos > 0 ? (
            <Text style={styles.priceWas}>{formatPeso(line.line_total_centavos)}</Text>
          ) : null}
          <Text style={[styles.linePrice, refunded && styles.struck]}>
            {formatPeso(line.net_total_centavos)}
          </Text>
          {line.discount_centavos > 0 ? (
            <Text style={styles.priceOff}>{line.discount_rate_bp / 100}% off</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        {refunded ? (
          <Action label="Undo refund" disabled={disabled} onPress={() => onSet('done')} />
        ) : (
          <>
            <Action
              label={line.status === 'done' ? '✓ Done' : 'Mark done'}
              active={line.status === 'done'}
              disabled={disabled}
              onPress={() => onSet(line.status === 'done' ? 'pending' : 'done')}
            />
            <Action label="Refund" danger disabled={disabled} onPress={onRefund} />
          </>
        )}
      </View>
    </View>
  )
}

function Action({
  label,
  onPress,
  disabled,
  active,
  danger,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        active && styles.actionActive,
        danger && styles.actionDanger,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.actionText,
          active && { color: colors.good },
          danger && { color: colors.red },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function Chip({
  label,
  active,
  onPress,
  tone,
}: {
  label: string
  active: boolean
  onPress: () => void
  tone?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { borderColor: tone ?? colors.lineStrong, backgroundColor: colors.surface2 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, active && { color: tone ?? colors.chalk }]}>{label}</Text>
    </Pressable>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  header: {
    paddingHorizontal: space(4),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  title: { ...boardHead, fontSize: 26 },
  sub: { color: colors.faint, fontSize: 12, marginTop: 2 },
  search: {
    marginHorizontal: space(4),
    height: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3),
    color: colors.chalk,
    fontSize: 15,
  },
  chipRow: { flexGrow: 0, marginTop: space(2) },
  chips: { paddingHorizontal: space(4), gap: space(2), paddingVertical: space(1) },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },

  errorBar: {
    marginHorizontal: space(4),
    marginTop: space(2),
    padding: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.red,
    backgroundColor: 'rgba(225,20,20,0.12)',
  },
  errorText: { color: colors.chalk, fontSize: 13 },
  errorDismiss: { color: colors.faint, fontSize: 11, marginTop: 2 },

  list: { padding: space(4), gap: space(3) },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardVoided: { opacity: 0.6 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    padding: space(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  cardTitle: { color: colors.chalk, fontSize: 14, fontWeight: '800' },
  cardSub: { color: colors.faint, fontSize: 11, marginTop: 2 },
  cardTotal: { color: colors.chalk, fontSize: 15, fontWeight: '800' },
  voidedTag: { ...boardLabel, color: colors.red, fontSize: 10, marginTop: 2 },

  line: { padding: space(3), borderBottomWidth: 1, borderBottomColor: colors.line },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  lineName: { color: colors.chalk, fontSize: 14 },
  lineStatus: { fontSize: 10, marginTop: 3 },
  editHint: { color: colors.faint, fontSize: 12 },
  priceCol: { alignItems: 'flex-end' },
  priceWas: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  priceOff: { color: colors.red, fontSize: 10, fontWeight: '700' },
  linePrice: { color: colors.chalk, fontSize: 14, fontWeight: '700' },
  struck: { textDecorationLine: 'line-through', color: colors.muted },

  actions: { flexDirection: 'row', gap: space(2), marginTop: space(3) },
  action: {
    flex: 1,
    minHeight: TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  actionActive: { borderColor: colors.good, backgroundColor: 'rgba(34,197,94,0.12)' },
  actionDanger: { borderColor: colors.line },
  actionText: { color: colors.muted, fontSize: 13, fontWeight: '700' },

  empty: { padding: space(10), alignItems: 'center' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
})
