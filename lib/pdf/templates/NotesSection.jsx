import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";

export function NotesSection({ notes, terms }) {
  if (!notes && !terms) return null;

  return (
    <View style={styles.notesSection}>
      {notes && (
        <View style={styles.notesBox}>
          <Text style={styles.notesTitle}>Notes</Text>
          <Text style={styles.notesText}>{notes}</Text>
        </View>
      )}
      {terms && (
        <View style={styles.notesBox}>
          <Text style={styles.notesTitle}>Terms & Conditions</Text>
          <Text style={styles.notesText}>{terms}</Text>
        </View>
      )}
    </View>
  );
}
