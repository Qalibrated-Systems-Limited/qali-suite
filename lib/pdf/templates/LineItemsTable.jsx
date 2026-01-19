import { View, Text } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { formatCurrency, formatQuantity, truncateText } from "../utils";

export function LineItemsTable({ items, showDiscount = true, currency = "KES" }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.table}>
        <View style={[styles.tableHeader, { borderRadius: 6 }]}>
          <Text style={[styles.tableHeaderCell, { textAlign: "center", width: "100%" }]}>
            No items
          </Text>
        </View>
      </View>
    );
  }

  const lastIndex = items.length - 1;

  return (
    <View style={styles.table}>
      {/* Table Header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
        <Text style={[styles.tableHeaderCell, styles.colDescription]}>Description</Text>
        <Text style={[styles.tableHeaderCell, styles.colQuantity]}>Qty</Text>
        <Text style={[styles.tableHeaderCell, styles.colUnit]}>Unit</Text>
        <Text style={[styles.tableHeaderCell, styles.colUnitPrice]}>Price</Text>
        {showDiscount && (
          <Text style={[styles.tableHeaderCell, styles.colDiscount]}>Disc</Text>
        )}
        <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount</Text>
      </View>

      {/* Table Body */}
      <View style={styles.tableBody}>
        {items.map((item, index) => (
          <View
            key={item._id || index}
            style={[
              styles.tableRow,
              index % 2 === 1 && styles.tableRowAlt,
              index === lastIndex && styles.tableRowLast,
            ]}
          >
            <Text style={[styles.tableCell, styles.colNum]}>{index + 1}</Text>
            <View style={styles.colDescription}>
              <Text style={styles.tableCellBold}>
                {truncateText(item.description || item.product?.name || item.name || "-", 50)}
              </Text>
              {(item.product?.sku || item.SKU) && (
                <Text style={styles.tableCellMuted}>
                  SKU: {item.product?.sku || item.SKU}
                </Text>
              )}
            </View>
            <Text style={[styles.tableCell, styles.colQuantity]}>
              {formatQuantity(item.quantity)}
            </Text>
            <Text style={[styles.tableCell, styles.colUnit]}>
              {item.unit || item.product?.unit || "-"}
            </Text>
            <Text style={[styles.tableCell, styles.colUnitPrice]}>
              {formatCurrency(item.unitPrice || item.price, currency)}
            </Text>
            {showDiscount && (
              <Text style={[styles.tableCell, styles.colDiscount]}>
                {item.discount ? `${item.discount}%` : "-"}
              </Text>
            )}
            <Text style={[styles.tableCellBold, styles.colAmount]}>
              {formatCurrency(
                item.amount || item.total || item.quantity * (item.unitPrice || item.price || 0),
                currency
              )}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
