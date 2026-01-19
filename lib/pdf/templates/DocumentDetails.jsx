import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { formatDate } from "../utils";

export function DocumentDetails({ details }) {
  // Filter out null/undefined values
  const validDetails = details.filter(
    (d) => d.value !== null && d.value !== undefined && d.value !== ""
  );

  if (validDetails.length === 0) return null;

  return (
    <View style={styles.detailsSection}>
      {validDetails.map((detail, index) => (
        <View key={index} style={styles.detailBox}>
          <Text style={styles.detailLabel}>{detail.label}</Text>
          <Text style={styles.detailValue}>
            {detail.isDate ? formatDate(detail.value) : detail.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
