import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { getDocumentTitle, getStatusProps } from "../utils";

export function DocumentTitle({ type, documentNumber, status, paymentStatus }) {
  const statusProps = getStatusProps(status, paymentStatus);

  return (
    <View style={styles.documentTitle}>
      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          <Text style={styles.titleText}>{getDocumentTitle(type)}</Text>
          <Text style={styles.documentNumber}>{documentNumber}</Text>
        </View>
        <View style={[styles.statusBadge, styles[statusProps.style]]}>
          <Text>{statusProps.label}</Text>
        </View>
      </View>
      <View style={styles.titleDivider} />
    </View>
  );
}
