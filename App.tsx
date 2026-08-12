import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import AuthGate from './src/components/AuthGate';
import CameraScreen from './src/components/CameraScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <AuthGate>
        <CameraScreen />
      </AuthGate>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
});
