import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { removeBackground } from './src/services/api';

const MAX_UPLOAD_MB = 10;

export default function App() {
  const [source, setSource] = useState(null);
  const [result, setResult] = useState(null);
  const [provider, setProvider] = useState(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permissão necessária',
        permission.canAskAgain
          ? 'Libere o acesso às fotos para continuar.'
          : 'Libere o acesso às fotos nos Ajustes do aparelho.'
      );
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });

    if (picked.canceled || !picked.assets?.length) return;

    const asset = picked.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_UPLOAD_MB * 1024 * 1024) {
      Alert.alert('Imagem muito grande', `Escolha uma imagem de até ${MAX_UPLOAD_MB} MB.`);
      return;
    }

    setSource(asset);
    setResult(null);
    setProvider(null);
    setCached(false);
  }

  async function handleRemoveBackground() {
    if (!source || loading) return;
    setLoading(true);
    setResult(null);
    setProvider(null);
    setCached(false);
    try {
      const data = await removeBackground(source);
      setResult(data.image);
      setProvider(data.provider);
      setCached(Boolean(data.cached));
    } catch (err) {
      Alert.alert('Não foi possível remover o fundo', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Removedor de fundo</Text>

      <Button title="Escolher foto" onPress={pickImage} disabled={loading} />

      {source && (
        <Image source={{ uri: source.uri }} style={styles.preview} resizeMode="contain" />
      )}

      {source && (
        <Button
          title="Remover fundo"
          onPress={handleRemoveBackground}
          disabled={loading}
        />
      )}

      {loading && <ActivityIndicator size="large" style={styles.spacing} />}

      {result && (
        <View style={styles.resultBox}>
          <Image source={{ uri: result }} style={styles.preview} resizeMode="contain" />
        </View>
      )}

      {!source && (
        <Text style={styles.hint}>Escolha uma foto para remover o fundo.</Text>
      )}

      {result && provider && (
        <Text style={styles.caption}>
          Processado por: {provider}{cached ? ' (cache)' : ''}
        </Text>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  preview: {
    width: 280,
    height: 280,
    borderRadius: 8,
  },
  resultBox: {
    width: 280,
    height: 280,
    alignItems: 'center',
    backgroundColor: '#e5e5e5',
    borderRadius: 8,
  },
  caption: {
    marginTop: 8,
    color: '#555',
  },
  hint: {
    color: '#777',
    textAlign: 'center',
  },
  spacing: {
    marginVertical: 8,
  },
});
