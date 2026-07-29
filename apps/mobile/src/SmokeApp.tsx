import { StyleSheet, Text, View } from 'react-native';

export default function SmokeApp(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lyra Mobile</Text>
      <Text style={styles.body}>Startup smoke test passed.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#4f4a44',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center'
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#fbfaf7',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24
  },
  title: {
    color: '#1c1b18',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0
  }
});
