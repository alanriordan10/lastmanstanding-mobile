import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

export function AppHeaderTitle({ title }: { title: string }) {
  return (
    <View style={styles.wrap}>
      <Image source={require('../../assets/app-logo.png')} style={styles.logo} />
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  logo: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#020617' },
  title: { color: colors.text, fontSize: 17, fontWeight: '900', maxWidth: 220 },
});
