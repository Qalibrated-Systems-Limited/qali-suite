import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { bankDetails } from "../utils";

export function BankDetails({ showBankDetails = true }) {
  if (!showBankDetails) return null;

  return (
    <View style={styles.bankSection}>
      <Text style={styles.bankTitle}>Payment Information</Text>
      <View style={styles.bankGrid}>
        <View style={styles.bankItem}>
          <Text style={styles.bankLabel}>Bank</Text>
          <Text style={styles.bankValue}>{bankDetails.bankName}</Text>
        </View>
        <View style={styles.bankItem}>
          <Text style={styles.bankLabel}>Branch Code</Text>
          <Text style={styles.bankValue}>{bankDetails.branchCode}</Text>
        </View>
        <View style={styles.bankItem}>
          <Text style={styles.bankLabel}>Account Name</Text>
          <Text style={styles.bankValue}>{bankDetails.accountName}</Text>
        </View>
        <View style={styles.bankItem}>
          <Text style={styles.bankLabel}>Account Number</Text>
          <Text style={styles.bankValue}>{bankDetails.accountNumber}</Text>
        </View>
        <View style={styles.bankItem}>
          <Text style={styles.bankLabel}>SWIFT Code</Text>
          <Text style={styles.bankValue}>{bankDetails.swiftCode}</Text>
        </View>
      </View>
    </View>
  );
}
