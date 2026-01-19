import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { companyInfo } from "../utils";

export function DocumentFooter({ pageNumber, totalPages }) {
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerLeft}>
        <Text style={styles.footerMotto}>{companyInfo.motto}</Text>
        <Text style={styles.footerText}>{companyInfo.website}</Text>
      </View>
      <View style={styles.footerRight}>
        <Text style={styles.footerPage}>
          Page {pageNumber} of {totalPages}
        </Text>
      </View>
    </View>
  );
}
