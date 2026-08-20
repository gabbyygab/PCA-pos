import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatPeso } from '@shared/lib/currency'
import { resolvePrice } from '@shared/lib/pricing'
import { colors, boardLabel, radius } from '@/theme'
import type { CatalogService } from '@/lib/queries/catalog'

interface ServiceCardProps {
  service: CatalogService
  sizeId: string | null
  available: boolean
  inCart: boolean
  onPress: () => void
}

/**
 * One tile on the board. Two columns on a phone, so the name gets two lines
 * and the price sits underneath in the heavier weight the board uses.
 */
export function ServiceCard({
  service,
  sizeId,
  available,
  inCart,
  onPress,
}: ServiceCardProps) {
  const price = sizeId ? resolvePrice(service, sizeId) : null

  return (
    <Pressable
      onPress={onPress}
      disabled={!available}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available, selected: inCart }}
      style={({ pressed }) => [
        styles.card,
        inCart && styles.cardOn,
        pressed && available && styles.cardPressed,
        !available && styles.cardOff,
      ]}
    >
      <Text style={styles.name} numberOfLines={2}>
        {service.name}
      </Text>

      {service.inclusions.length > 0 ? (
        <Text style={styles.inclusions} numberOfLines={1}>
          {service.inclusions.join(' · ')}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.price}>
          {service.is_open_price
            ? 'Open price'
            : price !== null
              ? formatPeso(price)
              : 'Not offered'}
        </Text>
        {inCart ? <View style={styles.dot} /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 12,
    justifyContent: 'space-between',
  },
  cardOn: { borderColor: colors.red, backgroundColor: 'rgba(225,20,20,0.10)' },
  cardPressed: { backgroundColor: colors.surface2 },
  cardOff: { opacity: 0.35 },
  name: { color: colors.chalk, fontSize: 14, fontWeight: '700' },
  inclusions: { color: colors.faint, fontSize: 10, marginTop: 4 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  price: { color: colors.chalk, fontSize: 15, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
})
