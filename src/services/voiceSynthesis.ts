export interface ScriptLine {
  id: string;
  speaker: string;
  emotion: string;
  text: string;
  raw: string;
}

export function parseScript(rawScript: string): ScriptLine[] {
  const lines = rawScript.split('\n');
  const parsed: ScriptLine[] = [];
  
  // Regex: Speaker Name: [emotion] Some text here
  const regex = /^([A-Za-z0-9 _-]+):\s*\[([^\]]+)\]\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(regex);
    if (match) {
      parsed.push({
        id: `line-${i}`,
        speaker: match[1].trim(),
        emotion: match[2].trim(),
        text: match[3],
        raw: line,
      });
    } else {
      // Unmatched lines, just keep them as narrative/descriptions if any exist
      parsed.push({
        id: `line-${i}`,
        speaker: 'System',
        emotion: '',
        text: line,
        raw: line,
      });
    }
  }

  return parsed;
}

// Simple wrapper around SpeechSynthesis
export class VoiceOrchestrator {
  private voices: SpeechSynthesisVoice[] = [];
  private voiceMap: Record<string, SpeechSynthesisVoice | null> = {
    'Speaker 1': null,
    'Speaker 2': null,
  };
  
  public onStateChange?: (state: 'idle' | 'playing' | 'paused', activeLineId: string | null) => void;
  private currentLineIndex = -1;
  private script: ScriptLine[] = [];
  private isPlaying = false;
  private isPaused = false;
  
  constructor() {
    this.hydrateVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this.hydrateVoices();
    }
  }

  private hydrateVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    this.voices = window.speechSynthesis.getVoices();
    
    // Attempt to pick a distinct male/female or deep/high voice for speaker 1 vs 2
    if (this.voices.length > 0) {
      // Just grab first two distinct English voices for simplicity
      const enVoices = this.voices.filter(v => v.lang.startsWith('en'));
      this.voiceMap['Speaker 1'] = enVoices[0] || this.voices[0];
      this.voiceMap['Speaker 2'] = enVoices.length > 1 ? enVoices[enVoices.length - 1] : this.voices[0];
    }
  }

  public getAvailableVoices() {
    return this.voices;
  }
  
  public setVoice(speaker: string, voiceURI: string) {
    const v = this.voices.find(c => c.voiceURI === voiceURI);
    if (v) this.voiceMap[speaker] = v;
  }

  public loadScript(scriptText: string) {
    this.script = parseScript(scriptText);
    this.stop();
  }

  public play() {
    if (!this.script.length || typeof window === 'undefined') return;
    
    if (this.isPaused) {
      window.speechSynthesis.resume();
      this.isPaused = false;
      this.isPlaying = true;
      this.onStateChange?.('playing', this.script[this.currentLineIndex]?.id || null);
      return;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.currentLineIndex = 0;
    this.speakNext();
  }

  public pause() {
    if (!this.isPlaying) return;
    window.speechSynthesis.pause();
    this.isPaused = true;
    this.isPlaying = false;
    this.onStateChange?.('paused', this.script[this.currentLineIndex]?.id || null);
  }

  public stop() {
    if (typeof window !== 'undefined') window.speechSynthesis.cancel();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentLineIndex = -1;
    this.onStateChange?.('idle', null);
  }

  private speakNext() {
    // End of script
    if (this.currentLineIndex >= this.script.length) {
      this.stop();
      return;
    }

    const line = this.script[this.currentLineIndex];
    if (line.speaker === 'System') {
      // skip non-dialogue lines or read them with a fallback
      this.currentLineIndex++;
      this.speakNext();
      return;
    }

    this.onStateChange?.('playing', line.id);

    const utterance = new SpeechSynthesisUtterance(line.text);
    const voice = this.voiceMap[line.speaker];
    if (voice) {
      utterance.voice = voice;
    }
    
    // Add some emotional variation conceptually (pitch/rate changes based on emotion tags could be fun)
    // Basic mapping:
    const em = line.emotion.toLowerCase();
    if (em.includes('excited') || em.includes('urgent')) utterance.rate = 1.1;
    if (em.includes('calm') || em.includes('thoughtful') || em.includes('slow')) utterance.rate = 0.9;
    if (em.includes('serious')) utterance.pitch = 0.8;
    
    utterance.onend = () => {
      this.currentLineIndex++;
      this.speakNext();
    };

    utterance.onerror = (e) => {
      console.error('Speech error:', e);
      this.stop();
    };

    window.speechSynthesis.speak(utterance);
  }
}
