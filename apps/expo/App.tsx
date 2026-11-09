import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { api, LiveClient, type LiveEvent } from './src/api';
import type { Evaluation, Situation } from './src/types';

const USER_ID = 'demo-user'; // TODO: replace with real auth (Firebase Auth, etc.)
type Screen =
  | { name: 'home' }
  | { name: 'detail'; situation: Situation }
  | { name: 'session'; situation: Situation }
  | { name: 'progress' };

async function playBase64Audio(base64: string, mimeType: string): Promise<void> {
  const ext = mimeType.includes('wav') ? 'wav' : 'mp3';
  const file = new File(Paths.cache, `reply.${ext}`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  const sound = new Audio.Sound();
  await sound.loadAsync({ uri: file.uri });
  await sound.playAsync();
  sound.setOnPlaybackStatusUpdate((s) => { if (s.isLoaded && s.didJustFinish) void sound.unloadAsync(); });
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [situations, setSituations] = useState<Situation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listSituations()
      .then(setSituations)
      .catch((e) => setError(`Could not reach the server at ${apiBase()}: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.logo}>🦆 Situ</Text>
      {loading ? <ActivityIndicator /> : error ? <Text style={styles.error}>{error}</Text> : null}
      {screen.name === 'home' && (
        <Home situations={situations} onOpen={(s) => setScreen({ name: 'detail', situation: s })} onProgress={() => setScreen({ name: 'progress' })} />
      )}
      {screen.name === 'detail' && (
        <Detail situation={screen.situation} onBack={() => setScreen({ name: 'home' })} onStart={() => setScreen({ name: 'session', situation: screen.situation })} />
      )}
      {screen.name === 'session' && (
        <LiveSession situation={screen.situation} onBack={() => setScreen({ name: 'home' })} />
      )}
      {screen.name === 'progress' && <ProgressScreen onBack={() => setScreen({ name: 'home' })} />}
    </View>
  );
}

function apiBase(): string {
  return process.env.EXPO_PUBLIC_SITU_URL ?? 'http://localhost:3000';
}

function Home({ situations, onOpen, onProgress }: { situations: Situation[]; onOpen: (s: Situation) => void; onProgress: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.h1}>Practice situations</Text>
      <Text style={styles.sub}>Pick one, speak, get evaluated against its rubric.</Text>
      <Button title="My progress" onPress={onProgress} />
      <FlatList
        data={situations}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => onOpen(item)}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text>{item.domain} · {item.language.toUpperCase()} · {item.level}</Text>
            <Text style={styles.sub}>{item.description}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Detail({ situation, onBack, onStart }: { situation: Situation; onBack: () => void; onStart: () => void }) {
  return (
    <ScrollView>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.h1}>{situation.title}</Text>
      <Text>{situation.domain} · {situation.language.toUpperCase()} · {situation.level}</Text>
      <Text style={styles.sub}>{situation.description}</Text>
      <Text style={styles.h2}>You are: {situation.roles.user.name}</Text>
      <Text>{situation.roles.user.description}</Text>
      <Text style={styles.h2}>Talking to: {situation.roles.ai.name}</Text>
      <Text>{situation.roles.ai.description}</Text>
      <Text style={styles.h2}>Objectives</Text>
      {situation.objectives.map((o) => <Text key={o.id}>• {o.description}{o.required ? ' (required)' : ''}</Text>)}
      <Text style={styles.h2}>You pass at {Math.round(situation.rubric.passThreshold * 100)}%</Text>
      {situation.vocab?.map((v) => <Text key={v.term}>• {v.term} — {v.definition}</Text>)}
      <View style={{ marginTop: 16 }}><Button title="Start speaking" onPress={onStart} /></View>
    </ScrollView>
  );
}

function LiveSession({ situation, onBack }: { situation: Situation; onBack: () => void }) {
  const [sessionId, setSessionId] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [log, setLog] = useState<{ who: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const [met, setMet] = useState<string[]>([]);
  const liveRef = useRef<LiveClient | null>(null);
  const audioChunks = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.createSession(situation.id, USER_ID)
      .then((r) => { if (!cancelled) setSessionId(r.session.id); })
      .catch((e) => setError((e as Error).message));
    // Semi-live socket: transcript arrives first, audio streams after.
    const live = new LiveClient();
    live.onEvent = (e: LiveEvent) => {
      if (e.type === 'transcript') {
        setLog((l) => [...l, { who: situation.roles.ai.name, text: e.spokenResponse }]);
        setMet((m) => [...new Set([...m, ...situation.objectives.filter((o) => (o.keywords ?? []).some((k) => e.spokenResponse.toLowerCase().includes(k.toLowerCase()))).map((o) => o.id)])]);
      } else if (e.type === 'audio') {
        audioChunks.current[e.chunkIndex] = e.data;
        if (e.chunkIndex === e.totalChunks - 1) {
          void playBase64Audio(audioChunks.current.join(''), e.mimeType);
          audioChunks.current = [];
        }
      } else if (e.type === 'error') setError(e.error);
      else if (e.type === 'done') setBusy(false);
    };
    live.connect(situation.id, USER_ID);
    liveRef.current = live;
    return () => { cancelled = true; live.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') { setError('Microphone permission is required.'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    setRecording(rec);
  }

  async function stopAndSend() {
    if (!recording) return;
    setBusy(true);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    try {
      if (!uri) throw new Error('No recording');
      // REST fallback (works even if the socket died): send the file, play the reply.
      const turn = await api.sendTurn(sessionId, { audioUri: uri });
      setLog((l) => [...l, { who: 'You', text: turn.transcription }, { who: situation.roles.ai.name, text: turn.spokenResponse }]);
      if (turn.audioBase64) await playBase64Audio(turn.audioBase64, turn.audioMimeType);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function sendText() {
    if (!textInput.trim() || !sessionId) return;
    setBusy(true);
    try {
      const turn = await api.sendTurn(sessionId, { text: textInput });
      setLog((l) => [...l, { who: 'You', text: turn.transcription || textInput }, { who: situation.roles.ai.name, text: turn.spokenResponse }]);
      if (turn.audioBase64) await playBase64Audio(turn.audioBase64, turn.audioMimeType);
      setTextInput('');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function finish() {
    try {
      const r = await api.evaluate(sessionId);
      setEvaluation(r.evaluation);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <ScrollView>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.h1}>{situation.title}</Text>
      <Text style={styles.sub}>Objectives: {situation.objectives.map((o) => `${met.includes(o.id) ? '✅' : '⬜'} ${o.id}`).join('  ')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {log.map((m, i) => <Text key={i} style={m.who === 'You' ? styles.me : styles.ai}><Text style={{ fontWeight: 'bold' }}>{m.who}: </Text>{m.text}</Text>)}
      {busy && <ActivityIndicator />}
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        {recording
          ? <Button title="■ Stop & send" onPress={stopAndSend} />
          : <Button title="🎙 Hold to talk (tap to record)" onPress={startRecording} />}
        <Button title="Evaluate" onPress={finish} />
      </View>
      <TextInput style={styles.input} placeholder="Or type instead…" value={textInput} onChangeText={setTextInput} onSubmitEditing={sendText} />
      <Button title="Send text" onPress={sendText} />
      {evaluation && (
        <View style={styles.card}>
          <Text style={styles.h2}>Result: {Math.round(evaluation.weightedScore * 100)}% — {evaluation.completed ? '✅ Completed' : '❌ Not yet'}</Text>
          <Text>{evaluation.feedback}</Text>
          {evaluation.scores.map((s) => <Text key={s.criterionId}>• {s.criterionId}: {s.score}/{situation.rubric.scale ?? 5}</Text>)}
          <Text>Objectives met: {evaluation.objectivesMet.join(', ') || 'none yet'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function ProgressScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{ streak: number; situations: Record<string, { attempts: number; bestScore: number; completed: boolean }> } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.getProgress(USER_ID).then((r) => setData(r.progress)).catch((e) => setError((e as Error).message));
  }, []);
  return (
    <ScrollView>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.h1}>My progress</Text>
      {error ? <Text style={styles.error}>{error || 'No progress yet — finish a situation first.'}</Text> : null}
      {data && (
        <>
          <Text style={styles.h2}>🔥 Streak: {data.streak} day(s)</Text>
          {Object.entries(data.situations).map(([id, p]) => (
            <Text key={id}>• {id}: {p.completed ? '✅' : '⬜'} best {Math.round(p.bestScore * 100)}% · {p.attempts} attempt(s)</Text>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ai: { backgroundColor: '#eef6ff', borderRadius: 8, marginVertical: 4, padding: 8 },
  card: { backgroundColor: '#f5f5f5', borderRadius: 10, marginVertical: 6, padding: 12 },
  cardTitle: { fontSize: 17, fontWeight: 'bold' },
  container: { flex: 1, padding: 20, paddingTop: 48 },
  error: { color: '#b00020', marginVertical: 8 },
  h1: { fontSize: 22, fontWeight: 'bold', marginVertical: 8 },
  h2: { fontSize: 16, fontWeight: 'bold', marginTop: 12 },
  input: { borderColor: '#ccc', borderRadius: 8, borderWidth: 1, marginVertical: 8, padding: 10 },
  logo: { fontSize: 24, fontWeight: 'bold' },
  me: { backgroundColor: '#e8f5e9', borderRadius: 8, marginVertical: 4, padding: 8 },
  sub: { color: '#555', marginBottom: 8 },
});
