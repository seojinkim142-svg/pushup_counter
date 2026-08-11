import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import CameraScreen from './src/components/CameraScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <CameraScreen />
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
