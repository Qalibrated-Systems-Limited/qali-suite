import { View, Text, Image } from "@react-pdf/renderer";
import { styles } from "../styles";
import { companyInfo } from "../utils";

export function DocumentHeader({ logoSrc = "/qsl.png" }) {
  return (
    <View style={styles.header}>
      <View style={styles.logoContainer}>
        {logoSrc ? (
          <Image src={logoSrc} style={styles.logo} />
        ) : (
          <Text style={styles.companyName}>{companyInfo.name}</Text>
        )}
      </View>
      <View style={styles.companyInfo}>
        <Text style={styles.companyName}>{companyInfo.name}</Text>
        <Text style={styles.companyDetail}>{companyInfo.address}</Text>
        <Text style={styles.companyDetail}>{companyInfo.phone}</Text>
        <Text style={styles.companyDetail}>{companyInfo.email}</Text>
        <Text style={styles.companyDetail}>PIN: {companyInfo.pin}</Text>
      </View>
    </View>
  );
}
