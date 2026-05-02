import { ScriptLine } from '../services/voiceSynthesis';

export async function generateElevenLabsAudio(
  scriptLines: ScriptLine[], 
  apiKey: string,
  speaker1VoiceId: string,
  speaker2VoiceId: string,
  speaker1Name: string,
  speaker2Name: string
): Promise<ArrayBuffer> {
  const lineBuffers: ArrayBuffer[] = [];
  
  const voiceMap: Record<string, string> = {
    [speaker1Name]: speaker1VoiceId || 'pNInz6obpgDQGcFmaJgB', // Default: Adam
    [speaker2Name]: speaker2VoiceId || '21m00Tcm4TlvDq8ikWAM', // Default: Rachel
  };

  for (const line of scriptLines) {
    if (line.speaker === 'System' || !line.text.trim()) continue;
    
    // Choose voice, default to Speaker 1
    const voiceId = voiceMap[line.speaker] || voiceMap[speaker1Name];
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: line.text,
        model_id: 'eleven_turbo_v2' // or eleven_monolingual_v1
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API Error: ${response.status} ${errText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    lineBuffers.push(arrayBuffer);
  }
  
  // Now decode all and merge sequentially
  const ctx = new window.AudioContext();
  const decodedBuffers = await Promise.all(lineBuffers.map(b => ctx.decodeAudioData(b)));
  
  const totalDuration = decodedBuffers.reduce((acc, buf) => acc + buf.duration, 0);
  if (totalDuration === 0) throw new Error("No audio generated from ElevenLabs");
  
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * totalDuration), ctx.sampleRate);
  
  let startTime = 0;
  for (const buf of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buf;
    source.connect(offlineCtx.destination);
    source.start(startTime);
    startTime += buf.duration;
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  return wavBlobToArrayBuffer(bufferToWavBlob(renderedBuffer));
}

async function wavBlobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function createWavFromPcmBuffer(pcmBuffer: ArrayBuffer, sampleRate: number = 24000): ArrayBuffer {
  const dataLen = pcmBuffer.byteLength;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeString(36, 'data');
  view.setUint32(40, dataLen, true);
  
  const pcmView = new Uint8Array(pcmBuffer);
  const outView = new Uint8Array(buffer, 44);
  outView.set(pcmView);
  
  return buffer;
}

export async function mergeAudioTracks(musicBufferData: ArrayBuffer | null, speechBufferData: ArrayBuffer): Promise<Blob> {
  const ctx = new window.AudioContext();
  
  const speechAudio = await ctx.decodeAudioData(speechBufferData);
  let musicAudio = null;
  if (musicBufferData) {
    try {
      musicAudio = await ctx.decodeAudioData(musicBufferData);
    } catch (err) {
      console.error("Failed to decode music audio", err);
    }
  }
  
  // Total duration: let's have music play for a few seconds solo, then duck volume while speech starts
  const musicDuration = musicAudio ? musicAudio.duration : 0;
  // Speech starts after 6 seconds (or at the end of the music if it's shorter)
  const delayForSpeech = musicAudio ? Math.min(musicDuration, 6) : 0; 
  
  const totalDuration = Math.max(musicDuration, delayForSpeech + speechAudio.duration);
  
  const offlineCtx = new OfflineAudioContext(
    Math.max(speechAudio.numberOfChannels, musicAudio ? musicAudio.numberOfChannels : 1),
    Math.ceil(ctx.sampleRate * totalDuration),
    ctx.sampleRate
  );
  
  if (musicAudio) {
    const musicSource = offlineCtx.createBufferSource();
    musicSource.buffer = musicAudio;

    // Create a GainNode to handle the ducking
    const gainNode = offlineCtx.createGain();
    
    // We want the fade-down to last about 3 seconds
    const fadeDownDuration = 3;
    const fadeDownStart = delayForSpeech; // Start fading down when speech starts
    const fadeDownEnd = Math.min(fadeDownStart + fadeDownDuration, musicDuration);

    // Ensure we start at full volume
    gainNode.gain.setValueAtTime(1, 0);
    gainNode.gain.setValueAtTime(1, fadeDownStart);
    // Linear fade down to 15% volume (background level)
    gainNode.gain.linearRampToValueAtTime(0.15, fadeDownEnd);
    
    // Fade out completely over the last 2 seconds of the music
    const finalFadeStart = Math.max(fadeDownEnd, musicDuration - 2);
    gainNode.gain.setValueAtTime(0.15, finalFadeStart);
    gainNode.gain.linearRampToValueAtTime(0, musicDuration);

    musicSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    
    musicSource.start(0);
    // Stop the music when its native duration ends
    musicSource.stop(musicDuration);
  }
  
  const speechSource = offlineCtx.createBufferSource();
  speechSource.buffer = speechAudio;
  
  // Audio leveling for the speech track
  const preGain = offlineCtx.createGain();
  preGain.gain.setValueAtTime(1.5, 0); // Boost signal into compressor

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, 0); // Compress above -24dB
  compressor.knee.setValueAtTime(30, 0);       // Soft knee
  compressor.ratio.setValueAtTime(6, 0);       // Strong compression for leveling
  compressor.attack.setValueAtTime(0.003, 0);  // Fast attack (3ms) to catch peaks
  compressor.release.setValueAtTime(0.25, 0);  // Smooth release

  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.setValueAtTime(1.5, 0);      // Make-up gain after compression

  speechSource.connect(preGain);
  preGain.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(offlineCtx.destination);
  
  speechSource.start(delayForSpeech);
  
  const renderedBuffer = await offlineCtx.startRendering();
  return bufferToWavBlob(renderedBuffer);
}

function bufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); 
  view.setUint16(22, numChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);
  
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
