import { View, Text } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { formatCurrency } from "../utils";

export function TotalsSection({ totals, currency = "KES" }) {
  // totals is an array of { label, value, isTotal?, isCredit?, isDebit?, dividerBefore? }
  if (!totals || totals.length === 0) return null;

  return (
    <View style={styles.totalsContainer}>
      <View style={styles.totalsCard}>
        {totals.map((item, index) => {
          // Check if this is the grand total row
          if (item.isTotal) {
            return (
              <View key={index} style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>{item.label}</Text>
                <Text style={styles.grandTotalValue}>
                  {formatCurrency(item.value, currency)}
                </Text>
              </View>
            );
          }

          // Check if we need a divider before this item
          const needsDivider = item.dividerBefore;

          return (
            <View key={index}>
              {needsDivider && <View style={styles.totalsDivider} />}
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{item.label}</Text>
                <Text
                  style={[
                    styles.totalsValue,
                    item.isCredit && { color: colors.success },
                    item.isDebit && { color: colors.danger },
                  ]}
                >
                  {item.isCredit && "-"}
                  {formatCurrency(Math.abs(item.value), currency)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
