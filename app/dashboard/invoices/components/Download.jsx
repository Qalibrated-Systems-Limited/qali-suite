import {
  Page,
  StyleSheet,
  View,
  Document,
  Text,
  Image,
} from "@react-pdf/renderer";

function InvoicePDF({ invoice }) {
  const styles = StyleSheet.create({
    page: {
      padding: 35,
      fontFamily: "Helvetica",
      backgroundColor: "#ffffff",
      position: "relative",
    },
    watermark: {
      position: "absolute",
      top: "38%",
      left: "15%",
      fontSize: 70,
      color: "#fef3c7",
      opacity: 0.3,
      transform: "rotate(-45deg)",
      fontWeight: "bold",
    },
    invoiceBorder: {
      border: "3 solid #eab308",
      borderRadius: 6,
      padding: 20,
      position: "relative",
      backgroundColor: "#fafafa",
    },
    innerBorder: {
      border: "1 solid #fbbf24",
      borderRadius: 4,
      padding: 18,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 20,
      paddingBottom: 15,
      borderBottom: "2 solid #eab308",
    },
    companyInfo: {
      width: "55%",
    },
    logo: {
      width: 120,
      height: "auto",
      marginBottom: 10,
    },
    companyName: {
      fontSize: 18,
      fontWeight: "bold",
      color: "#1a1a1a",
      marginBottom: 4,
      letterSpacing: 1,
    },
    companyDetails: {
      fontSize: 9,
      color: "#555",
      marginBottom: 2,
      lineHeight: 1.4,
    },
    invoiceTitle: {
      width: "40%",
      alignItems: "flex-end",
    },
    invoiceLabel: {
      fontSize: 24,
      fontWeight: "bold",
      color: "#eab308",
      letterSpacing: 2,
      marginBottom: 8,
    },
    invoiceNumber: {
      fontSize: 11,
      color: "#1a1a1a",
      fontFamily: "Courier",
      marginBottom: 4,
      fontWeight: "bold",
    },
    invoiceDate: {
      fontSize: 9,
      color: "#666",
      marginBottom: 2,
    },
    statusBadge: {
      marginTop: 8,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 3,
      alignSelf: "flex-end",
    },
    statusText: {
      fontSize: 8,
      fontWeight: "bold",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    billToSection: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 25,
    },
    billToBox: {
      width: "48%",
      padding: 12,
      backgroundColor: "#fef9e7",
      borderRadius: 4,
      borderLeft: "3 solid #eab308",
    },
    sectionTitle: {
      fontSize: 10,
      fontWeight: "bold",
      color: "#eab308",
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    billToText: {
      fontSize: 9,
      color: "#1a1a1a",
      marginBottom: 3,
      lineHeight: 1.4,
    },
    billToLabel: {
      fontSize: 8,
      color: "#666",
      marginTop: 2,
    },
    table: {
      marginBottom: 20,
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: "#fef3c7",
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderBottom: "2 solid #eab308",
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderBottom: "1 solid #f3f4f6",
    },
    tableRowAlt: {
      backgroundColor: "#fefefe",
    },
    col1: { width: "8%", fontSize: 8 },
    col2: { width: "35%", fontSize: 8 },
    col3: { width: "12%", fontSize: 8, textAlign: "center" },
    col4: { width: "15%", fontSize: 8, textAlign: "right" },
    col5: { width: "15%", fontSize: 8, textAlign: "right" },
    col6: { width: "15%", fontSize: 8, textAlign: "right" },
    tableHeaderText: {
      fontWeight: "bold",
      color: "#92400e",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    itemName: {
      fontWeight: "bold",
      color: "#1a1a1a",
      marginBottom: 2,
    },
    itemDescription: {
      fontSize: 7,
      color: "#666",
      fontStyle: "italic",
    },
    skuBadge: {
      fontSize: 7,
      color: "#eab308",
      fontFamily: "Courier",
      marginTop: 2,
    },
    summarySection: {
      marginTop: 15,
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    summaryBox: {
      width: "45%",
      padding: 12,
      backgroundColor: "#ffffff",
      border: "1 solid #e5e7eb",
      borderRadius: 4,
    },
    summaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 5,
      borderBottom: "1 dashed #e5e7eb",
      marginBottom: 5,
    },
    summaryLabel: {
      fontSize: 9,
      color: "#666",
    },
    summaryValue: {
      fontSize: 9,
      color: "#1a1a1a",
      fontWeight: "bold",
    },
    discountRow: {
      backgroundColor: "#fef9e7",
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 3,
      marginBottom: 5,
    },
    discountValue: {
      color: "#dc2626",
    },
    totalRow: {
      backgroundColor: "#fef3c7",
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 4,
      marginTop: 8,
      border: "2 solid #eab308",
    },
    totalLabel: {
      fontSize: 12,
      fontWeight: "bold",
      color: "#92400e",
      textTransform: "uppercase",
    },
    totalValue: {
      fontSize: 14,
      fontWeight: "bold",
      color: "#92400e",
    },
    notesSection: {
      marginTop: 20,
      padding: 12,
      backgroundColor: "#fef9e7",
      borderRadius: 4,
      borderLeft: "3 solid #eab308",
    },
    notesTitle: {
      fontSize: 9,
      fontWeight: "bold",
      color: "#92400e",
      marginBottom: 6,
      textTransform: "uppercase",
    },
    notesText: {
      fontSize: 8,
      color: "#333",
      lineHeight: 1.5,
    },
    termsSection: {
      marginTop: 15,
      padding: 10,
      backgroundColor: "#fffbeb",
      borderRadius: 3,
    },
    termsTitle: {
      fontSize: 8,
      fontWeight: "bold",
      color: "#92400e",
      marginBottom: 5,
    },
    termsText: {
      fontSize: 7,
      color: "#666",
      lineHeight: 1.4,
      marginBottom: 2,
    },
    footer: {
      marginTop: 25,
      paddingTop: 15,
      borderTop: "2 solid #eab308",
      alignItems: "center",
    },
    footerText: {
      fontSize: 7,
      color: "#888",
      textAlign: "center",
      marginBottom: 2,
      lineHeight: 1.3,
    },
    footerBold: {
      fontSize: 8,
      fontWeight: "bold",
      color: "#1a1a1a",
      marginBottom: 3,
    },
    verificationBadge: {
      position: "absolute",
      top: 12,
      right: 12,
      width: 70,
      height: 70,
      borderRadius: 35,
      backgroundColor: "#eab308",
      alignItems: "center",
      justifyContent: "center",
      opacity: 0.95,
    },
    badgeText: {
      fontSize: 8,
      color: "#ffffff",
      fontWeight: "bold",
      textAlign: "center",
    },
    badgeIcon: {
      fontSize: 18,
      color: "#ffffff",
      marginBottom: 2,
    },
  });

  const formatCurrency = (amount) => {
    return `KES ${amount.toLocaleString("en-KE", {
      minimumFractionDigits: 0,
    })}`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "paid":
        return { backgroundColor: "#dcfce7", color: "#166534" };
      case "sent":
        return { backgroundColor: "#dbeafe", color: "#1e40af" };
      case "draft":
        return { backgroundColor: "#f3f4f6", color: "#374151" };
      default:
        return { backgroundColor: "#fef9e7", color: "#92400e" };
    }
  };

  const statusColors = getStatusColor(invoice.status);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Watermark */}
        <Text style={styles.watermark}>INVOICE</Text>

        {/* Invoice Border */}
        <View style={styles.invoiceBorder}>
          <View style={styles.innerBorder}>
            {/* Verification Badge */}
            <View style={styles.verificationBadge}>
              <Text style={styles.badgeIcon}>✓</Text>
              <Text style={styles.badgeText}>OFFICIAL</Text>
              <Text style={styles.badgeText}>INVOICE</Text>
            </View>

            {/* Header */}
            <View style={styles.header}>
              {/* Company Info */}
              <View style={styles.companyInfo}>
                <Image src="/images/qalibrated-logo.png" style={styles.logo} />
                <Text style={styles.companyName}>QALIBRATED SYSTEMS</Text>
                <Text style={styles.companyDetails}>P.O BOX 12345-00100</Text>
                <Text style={styles.companyDetails}>Nairobi, Kenya</Text>
                <Text style={styles.companyDetails}>Tel: +254 712 345 678</Text>
                <Text style={styles.companyDetails}>
                  Email: info@qalibratedsystems.com
                </Text>
                <Text style={styles.companyDetails}>
                  PIN: P051234567Z | VAT Reg: 0123456789
                </Text>
              </View>

              {/* Invoice Title */}
              <View style={styles.invoiceTitle}>
                <Text style={styles.invoiceLabel}>INVOICE</Text>
                <Text style={styles.invoiceNumber}>
                  {invoice.invoiceNumber}
                </Text>
                <Text style={styles.invoiceDate}>
                  Date: {formatDate(invoice.invoiceDate)}
                </Text>
                {invoice.dueDate && (
                  <Text style={styles.invoiceDate}>
                    Due: {formatDate(invoice.dueDate)}
                  </Text>
                )}
                <View style={[styles.statusBadge, statusColors]}>
                  <Text
                    style={[styles.statusText, { color: statusColors.color }]}
                  >
                    {invoice.status}
                  </Text>
                </View>
              </View>
            </View>

            {/* Bill To / Invoice Details */}
            <View style={styles.billToSection}>
              {/* Bill To */}
              <View style={styles.billToBox}>
                <Text style={styles.sectionTitle}>Bill To:</Text>
                <Text style={styles.billToText}>{invoice.customer.name}</Text>
                {invoice.customer.email && (
                  <Text style={[styles.billToText, styles.billToLabel]}>
                    {invoice.customer.email}
                  </Text>
                )}
                {invoice.customer.phone && (
                  <Text style={[styles.billToText, styles.billToLabel]}>
                    {invoice.customer.phone}
                  </Text>
                )}
                <Text style={[styles.billToText, { marginTop: 5 }]}>
                  {invoice.customer.address}
                </Text>
              </View>

              {/* Invoice Details */}
              <View style={styles.billToBox}>
                <Text style={styles.sectionTitle}>Payment Information:</Text>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 3,
                  }}
                >
                  <Text style={styles.billToLabel}>Payment Status:</Text>
                  <Text style={[styles.billToText, { fontWeight: "bold" }]}>
                    {invoice.paymentStatus.toUpperCase()}
                  </Text>
                </View>
                {invoice.paymentMethod && (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 3,
                    }}
                  >
                    <Text style={styles.billToLabel}>Payment Method:</Text>
                    <Text style={styles.billToText}>
                      {invoice.paymentMethod}
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 3,
                  }}
                >
                  <Text style={styles.billToLabel}>Amount Paid:</Text>
                  <Text
                    style={[
                      styles.billToText,
                      { color: "#16a34a", fontWeight: "bold" },
                    ]}
                  >
                    {formatCurrency(invoice.amountPaid)}
                  </Text>
                </View>
                {invoice.total - invoice.amountPaid > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={styles.billToLabel}>Balance Due:</Text>
                    <Text
                      style={[
                        styles.billToText,
                        { color: "#dc2626", fontWeight: "bold" },
                      ]}
                    >
                      {formatCurrency(invoice.total - invoice.amountPaid)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Items Table */}
            <View style={styles.table}>
              {/* Table Header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.col1, styles.tableHeaderText]}>#</Text>
                <Text style={[styles.col2, styles.tableHeaderText]}>
                  Item Description
                </Text>
                <Text style={[styles.col3, styles.tableHeaderText]}>Unit</Text>
                <Text style={[styles.col4, styles.tableHeaderText]}>Qty</Text>
                <Text style={[styles.col5, styles.tableHeaderText]}>Price</Text>
                <Text style={[styles.col6, styles.tableHeaderText]}>Total</Text>
              </View>

              {/* Table Rows */}
              {invoice.items.map((item, index) => (
                <View
                  key={index}
                  style={[
                    styles.tableRow,
                    index % 2 === 1 && styles.tableRowAlt,
                  ]}
                >
                  <Text style={styles.col1}>{index + 1}</Text>
                  <View style={styles.col2}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.description && (
                      <Text style={styles.itemDescription}>
                        {item.description}
                      </Text>
                    )}
                    {item.SKU && (
                      <Text style={styles.skuBadge}>SKU: {item.SKU}</Text>
                    )}
                  </View>
                  <Text style={styles.col3}>{item.unit}</Text>
                  <Text style={styles.col4}>{item.quantity}</Text>
                  <Text style={styles.col5}>
                    {formatCurrency(item.unitPrice)}
                  </Text>
                  <Text style={[styles.col6, { fontWeight: "bold" }]}>
                    {formatCurrency(item.total)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Summary */}
            <View style={styles.summarySection}>
              <View style={styles.summaryBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal:</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(invoice.subtotal)}
                  </Text>
                </View>

                {invoice.discountPercentage > 0 && (
                  <View style={[styles.summaryRow, styles.discountRow]}>
                    <Text style={styles.summaryLabel}>
                      Discount ({invoice.discountPercentage}%):
                    </Text>
                    <Text style={[styles.summaryValue, styles.discountValue]}>
                      -{formatCurrency(invoice.discountAmount)}
                    </Text>
                  </View>
                )}

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    VAT ({invoice.taxRate}%):
                  </Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(invoice.taxAmount)}
                  </Text>
                </View>

                <View style={styles.totalRow}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={styles.totalLabel}>TOTAL:</Text>
                    <Text style={styles.totalValue}>
                      {formatCurrency(invoice.total)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Notes */}
            {invoice.notes && (
              <View style={styles.notesSection}>
                <Text style={styles.notesTitle}>Notes:</Text>
                <Text style={styles.notesText}>{invoice.notes}</Text>
              </View>
            )}

            {/* Terms */}
            <View style={styles.termsSection}>
              <Text style={styles.termsTitle}>Payment Terms & Conditions:</Text>
              <Text style={styles.termsText}>
                • Payment is due within{" "}
                {invoice.dueDate ? "the specified due date" : "30 days"} from
                the invoice date
              </Text>
              <Text style={styles.termsText}>
                • Please include the invoice number in your payment reference
              </Text>
              <Text style={styles.termsText}>
                • Late payments may incur additional charges
              </Text>
              <Text style={styles.termsText}>
                • For any queries, please contact us at the details above
              </Text>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerBold}>
                Thank you for your business!
              </Text>
              <Text style={styles.footerText}>
                This is a computer-generated invoice and is valid without
                signature.
              </Text>
              <Text style={styles.footerText}>
                Qalibrated Systems - Your Trusted Inventory Management Partner
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default InvoicePDF;
