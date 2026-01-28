import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { getPartyLabel, formatAddress } from "../utils";

export function PartyInfo({ type, party, shippingAddress }) {
  const primaryLabel = getPartyLabel(type, false);
  const secondaryLabel = getPartyLabel(type, true);

  // Handle both customer/supplier structures
  const name = party?.name || party?.companyName || "-";
  const contactPerson = party?.contactPerson || party?.contact?.name || "";
  const email = party?.email || party?.contact?.email || "";
  const phone = party?.phone || party?.contact?.phone || "";
  const address = formatAddress(party?.address);
  const pin = party?.pin || party?.taxId || "";

  return (
    <View style={styles.partySection}>
      {/* Primary Party Info */}
      <View style={styles.partyBox}>
        <Text style={styles.partyLabel}>{primaryLabel}</Text>
        <Text style={styles.partyName}>{name}</Text>
        {contactPerson && (
          <Text style={styles.partyDetail}>Attn: {contactPerson}</Text>
        )}
        {address && <Text style={styles.partyDetail}>{address}</Text>}
        {email && <Text style={styles.partyDetail}>{email}</Text>}
        {phone && <Text style={styles.partyDetail}>{phone}</Text>}
        {pin && <Text style={styles.partyDetail}>PIN: {pin}</Text>}
      </View>

      {/* Shipping Address (if different) */}
      {shippingAddress && (
        <View style={styles.partyBox}>
          <Text style={styles.partyLabel}>{secondaryLabel}</Text>
          <Text style={styles.partyName}>
            {shippingAddress.name || shippingAddress.attention || name}
          </Text>
          {shippingAddress.address && (
            <Text style={styles.partyDetail}>{formatAddress(shippingAddress.address)}</Text>
          )}
          {shippingAddress.city && (
            <Text style={styles.partyDetail}>
              {shippingAddress.city}
              {shippingAddress.postalCode && `, ${shippingAddress.postalCode}`}
            </Text>
          )}
          {shippingAddress.phone && (
            <Text style={styles.partyDetail}>{shippingAddress.phone}</Text>
          )}
        </View>
      )}
    </View>
  );
}
