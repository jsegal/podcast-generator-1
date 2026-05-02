import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, FileText, Download, Share2, CalendarClock, Settings2, Mic2, Sparkles, AudioLines, Loader2, Music, Trash2 } from 'lucide-react';
import { cn } from './lib/utils';
import { parseScript, ScriptLine } from './services/voiceSynthesis';
import { base64ToArrayBuffer, createWavFromPcmBuffer, mergeAudioTracks, generateElevenLabsAudio } from './lib/audioUtils';
import { GoogleGenAI } from '@google/genai';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const ensureApiKeyAndGetClient = async () => {
  if (window.aistudio) {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await window.aistudio.openSelectKey();
    }
  }
  // Create a fresh client after returning from key selection
  // The system auto-injects the selected key into window context or we fallback to the default Gemini API key loaded by vite.
  const aiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  return new GoogleGenAI(aiKey ? { apiKey: aiKey } : {});
};

function RecentDropdown({ items, onSelect }: { items: string[]; onSelect: (val: string) => void }) {
  if (items.length === 0) return null;
  return (
    <select
      className="ml-auto text-[10px] uppercase font-bold tracking-wider text-black bg-transparent border-none focus:ring-0 cursor-pointer hover:text-black appearance-none text-right"
      onChange={e => {
        if (e.target.value) {
          onSelect(e.target.value);
          e.target.value = "";
        }
      }}
      defaultValue=""
      title="Recent history"
    >
      <option value="" disabled>Recent ▾</option>
      {items.map((it, idx) => (
        <option key={idx} value={it}>{it.length > 25 ? it.substring(0, 25) + '...' : it}</option>
      ))}
    </select>
  );
}

type ReferenceFile = {
  name: string;
  content: string;
};

type ShowProfile = {
  id: string;
  name: string;
  podcastName: string;
  desiredAudience: string;
  topic: string;
  introScript: string;
  outroScript: string;
  referenceFiles?: ReferenceFile[];
};

type InstructionProfile = {
  id: string;
  name: string;
  content: string;
};

export default function App() {

  const [showProfiles, setShowProfiles] = useState<ShowProfile[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('podcast_show_profiles') || '[]');
    } catch { return []; }
  });
  
  const loadShowProfile = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    const profile = showProfiles.find(p => p.id === id);
    if (profile) {
      setPodcastName(profile.podcastName);
      setDesiredAudience(profile.desiredAudience);
      setTopic(profile.topic);
      setIntroScript(profile.introScript);
      setOutroScript(profile.outroScript);
      setReferenceFiles(profile.referenceFiles || []);
    }
    e.target.value = ""; // reset dropdown
  };

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showProfileName, setShowProfileName] = useState('');

  const handleSaveProfileClick = () => {
    setShowProfileName(podcastName ? `${podcastName} Profile` : 'New Profile');
    setShowProfileModal(true);
  };

  const confirmSaveProfile = () => {
    if (showProfileName && showProfileName.trim()) {
      const newProfile: ShowProfile = {
        id: Date.now().toString(),
        name: showProfileName.trim(),
        podcastName,
        desiredAudience,
        topic,
        introScript,
        outroScript,
        referenceFiles,
      };
      const updated = [...showProfiles, newProfile];
      setShowProfiles(updated);
      try { localStorage.setItem('podcast_show_profiles', JSON.stringify(updated)); } catch {}
    }
    setShowProfileModal(false);
  };

  const deleteShowProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this show profile?')) {
      const updated = showProfiles.filter(p => p.id !== id);
      setShowProfiles(updated);
      try { localStorage.setItem('podcast_show_profiles', JSON.stringify(updated)); } catch {}
    }
  };

  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [podcastName, setPodcastName] = useState('');
  const [desiredAudience, setDesiredAudience] = useState(() => localStorage.getItem('podcast_desired_audience') || '');
  const [introScript, setIntroScript] = useState('');
  const [outroScript, setOutroScript] = useState('');
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  
  const [viewMode, setViewMode] = useState<'setup' | 'studio'>('setup');
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [isSuggestingTopics, setIsSuggestingTopics] = useState(false);
  
  const [recentTopics, setRecentTopics] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('podcast_recent_topics') || '[]'); } catch { return []; } });
  const [recentPodcastNames, setRecentPodcastNames] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('podcast_recent_names') || '[]'); } catch { return []; } });
  const [recentIntros, setRecentIntros] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('podcast_recent_intros') || '[]'); } catch { return []; } });
  const [recentOutros, setRecentOutros] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('podcast_recent_outros') || '[]'); } catch { return []; } });

  const saveToHistory = (val: string, list: string[], setList: (l: string[]) => void, key: string) => {
    if (!val.trim()) return;
    const trimmed = val.trim();
    const newList = [trimmed, ...list.filter(item => item !== trimmed)].slice(0, 5);
    setList(newList);
    try { localStorage.setItem(key, JSON.stringify(newList)); } catch (e) { console.warn(e); }
  };
  const [includeMusic, setIncludeMusic] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [script, setScript] = useState<string>('');
  
  const [parsedScript, setParsedScript] = useState<ScriptLine[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [themeMusicBase64, setThemeMusicBase64] = useState<string | null>(() => localStorage.getItem('podcast_theme_music'));
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [instructionProfiles, setInstructionProfiles] = useState<InstructionProfile[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('podcast_instruction_profiles') || '[]');
      if (saved.length > 0) return saved;
    } catch {}
    const legacy = localStorage.getItem('podcast_custom_instructions') || '';
    return [{ id: 'default', name: 'Default Profile', content: legacy }];
  });
  const [activeProfileId, setActiveProfileId] = useState<string>(() => localStorage.getItem('podcast_active_profile_id') || 'default');
  
  const activeProfile = instructionProfiles.find(p => p.id === activeProfileId) || instructionProfiles[0];
  const customInstructions = activeProfile.content;

  const updateCustomInstructions = (content: string) => {
    setInstructionProfiles(prev => prev.map(p => p.id === activeProfile.id ? { ...p, content } : p));
  };

  const handleCreateProfile = () => {
    setProfileInputValue('');
    setProfileModalMode('create');
  };

  const handleDeleteProfile = () => {
    if (instructionProfiles.length <= 1) return;
    setProfileModalMode('delete');
  };

  const handleRenameProfile = () => {
    setProfileInputValue(activeProfile.name);
    setProfileModalMode('rename');
  };
  
  const submitProfileModal = () => {
    if (profileModalMode === 'create' && profileInputValue.trim()) {
      const newProfile = { id: Date.now().toString(), name: profileInputValue.trim(), content: '' };
      setInstructionProfiles([...instructionProfiles, newProfile]);
      setActiveProfileId(newProfile.id);
    } else if (profileModalMode === 'rename' && profileInputValue.trim()) {
      setInstructionProfiles(prev => prev.map(p => p.id === activeProfile.id ? { ...p, name: profileInputValue.trim() } : p));
    } else if (profileModalMode === 'delete') {
      const newProfiles = instructionProfiles.filter(p => p.id !== activeProfile.id);
      setInstructionProfiles(newProfiles);
      setActiveProfileId(newProfiles[0].id);
    }
    setProfileModalMode(null);
  };
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState<string>(() => localStorage.getItem('podcast_elevenlabs_key') || '');
  const [useElevenLabs, setUseElevenLabs] = useState<boolean>(() => localStorage.getItem('podcast_use_elevenlabs') === 'true');
  const [speaker1VoiceId, setSpeaker1VoiceId] = useState<string>(() => localStorage.getItem('elevenlabs_voice_1') || 'pNInz6obpgDQGcFmaJgB');
  const [speaker2VoiceId, setSpeaker2VoiceId] = useState<string>(() => localStorage.getItem('elevenlabs_voice_2') || '21m00Tcm4TlvDq8ikWAM');
  const [speaker1Name, setSpeaker1Name] = useState<string>(() => localStorage.getItem('podcast_speaker1_name') || 'Speaker 1');
  const [speaker2Name, setSpeaker2Name] = useState<string>(() => localStorage.getItem('podcast_speaker2_name') || 'Speaker 2');
  const [availableVoices, setAvailableVoices] = useState<{voice_id: string, name: string}[]>([]);
  const [isFetchingVoices, setIsFetchingVoices] = useState(false);
    const [profileModalMode, setProfileModalMode] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [profileInputValue, setProfileInputValue] = useState('');
  const [refinePrompt, setRefinePrompt] = useState('');
  const [isRefiningScript, setIsRefiningScript] = useState(false);
  
  const [showSettings, setShowSettings] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('podcast_desired_audience', desiredAudience);
    } catch (e) {
      console.warn('Could not save audience to local storage', e);
    }
  }, [desiredAudience]);

  useEffect(() => {
    try {
      if (themeMusicBase64) {
        localStorage.setItem('podcast_theme_music', themeMusicBase64);
      } else {
        localStorage.removeItem('podcast_theme_music');
      }
    } catch (e) {
      console.warn('Could not save theme music to local storage', e);
    }
  }, [themeMusicBase64]);

  useEffect(() => {
    try {
      localStorage.setItem('podcast_instruction_profiles', JSON.stringify(instructionProfiles));
      localStorage.setItem('podcast_active_profile_id', activeProfile.id);
      localStorage.setItem('podcast_custom_instructions', customInstructions);
    } catch (e) {
      console.warn('Could not save instruction profiles to local storage', e);
    }
  }, [instructionProfiles, activeProfile.id, customInstructions]);

  useEffect(() => {
    try {
      localStorage.setItem('podcast_elevenlabs_key', elevenLabsApiKey);
      localStorage.setItem('podcast_use_elevenlabs', String(useElevenLabs));
      localStorage.setItem('elevenlabs_voice_1', speaker1VoiceId);
      localStorage.setItem('elevenlabs_voice_2', speaker2VoiceId);
      localStorage.setItem('podcast_speaker1_name', speaker1Name);
      localStorage.setItem('podcast_speaker2_name', speaker2Name);
    } catch (e) {
      console.warn('Could not save elevenlabs settings to local storage', e);
    }
  }, [elevenLabsApiKey, useElevenLabs, speaker1VoiceId, speaker2VoiceId, speaker1Name, speaker2Name]);

  const fetchElevenLabsVoices = async () => {
    if (!elevenLabsApiKey) return;
    setIsFetchingVoices(true);
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': elevenLabsApiKey }
      });
      if (!response.ok) throw new Error('Failed to fetch voices');
      const data = await response.json();
      setAvailableVoices(data.voices || []);
    } catch (error) {
      console.error(error);
      alert('Could not fetch voices. Please check your API key.');
    } finally {
      setIsFetchingVoices(false);
    }
  };

  useEffect(() => {
    if (script) {
      setParsedScript(parseScript(script));
      setAudioUrl(null); // Reset audio when script changes
    } else {
      setParsedScript([]);
    }
  }, [script]);

  const handleSuggestTopics = async () => {
    setIsSuggestingTopics(true);
    try {
      const ai = await ensureApiKeyAndGetClient();
      const prompt = `Podcast Name: ${podcastName || 'The Daily Pulse'}
Desired Audience: ${desiredAudience || 'General audience'}
Previously suggested topics: ${recentTopics.join(', ')}

Please suggest 5 creative, compelling episode topics or premises for this podcast. Give your response ONLY as a JSON array of strings. Do not include markdown blocks, just a raw JSON array, e.g. ["Topic 1", "Topic 2", ...]`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      const text = response.text || '';
      try {
        const matches = text.match(/\[[\s\S]*\]/);
        if (matches) {
          const topics = JSON.parse(matches[0]);
          if (Array.isArray(topics)) {
            setSuggestedTopics(topics);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to parse suggested topics JSON', e);
      }
      alert('Failed to generate topics correctly. Please try again.');
    } catch (e) {
      console.error(e);
      alert('Failed to generate topics. Please check your API key.');
    } finally {
      setIsSuggestingTopics(false);
    }
  };

  const handleSuggestNextBatch = () => {
    // Add current suggestions to recent topics so they aren't repeated
    const newHistory = [...recentTopics, ...suggestedTopics].slice(0, 20);
    setRecentTopics(newHistory);
    try { localStorage.setItem('podcast_recent_topics', JSON.stringify(newHistory)); } catch (e) {}
    handleSuggestTopics();
  };

  const handleGenerateScript = async () => {
    if (!topic.trim() || !podcastName.trim()) {
      alert("Please provide both a Topic and a Podcast Name.");
      return;
    }
    setViewMode('studio');
    setIsGeneratingScript(true);
    setScript('');
    
    saveToHistory(topic, recentTopics, setRecentTopics, 'podcast_recent_topics');
    if (podcastName.trim()) saveToHistory(podcastName, recentPodcastNames, setRecentPodcastNames, 'podcast_recent_names');
    if (introScript.trim()) saveToHistory(introScript, recentIntros, setRecentIntros, 'podcast_recent_intros');
    if (outroScript.trim()) saveToHistory(outroScript, recentOutros, setRecentOutros, 'podcast_recent_outros');

    try {
      const ai = await ensureApiKeyAndGetClient();
      const lengthMinutes = length === 'short' ? '3-5' : length === 'long' ? '15-20' : '8-12';

      const systemPrompt = `You are an expert podcast scriptwriter. 
Write a two-speaker podcast script following the precise structure and tone below.

PODCAST SCRIPT STRUCTURE TEMPLATE:
1. Pain point opening (Sharp, emotionally relevant business problem. Start with a consequence.)
2. Fast hook (Surprising stat, bold claim, or contrast. Fast momentum.)
3. Stakes and urgency (Escalate the problem, cost of inaction.)
4. Preview and promise (Tell listener what episode delivers and why to stay.)
5. Standard show intro (Consistent, branded, familiar.)
6. Main body (Numbered reasons, mistakes, or strategies, covering ${lengthMinutes} minutes of content. Alternate explanation and illustration. Short blocks of dialogue.)
7. Practical solution section (Fix the problem, focus on modern/AI tools if applicable, shift to empowerment.)
8. Action-oriented recap (Practical challenge or audit, benefit-focused reinforcement.)
9. Outro (Friendly sign-off.)

FORMATTING CONVENTIONS:
- Short alternating lines between "${speaker1Name}" and "${speaker2Name}".
- Include emotive cues in brackets for EVERY line immediately following the speaker name. Example: \`${speaker1Name}: [thoughtful] Text goes here.\`
- Typical cues: [serious], [warm], [thoughtful], [urgent], [motivational], [friendly], [excited], [curious], [story], [practical], [empathetic], [clear], [quick], [laughs], [smiles], [nods], [calm], [strong], [uplifted], [closing].
- Include occasional natural conversational artifacts (e.g., "huh," "oh wow," "hmmm interesting," "ahhh yes, I see", "totally, that makes sense"). Ensure they sound natural.
- ${speaker1Name} usually handles: Stats, explanations, story setups, warm reassurance, closing takeaways.
- ${speaker2Name} usually handles: Hooks, urgency, emotive reactions, punchlines, practical transitions, calls to action.
- Target Episode Length: ${lengthMinutes} minutes (generate enough substance for this duration).
- Overall Tone: ${tone}.
${customInstructions ? `\nUSER CUSTOM INSTRUCTIONS & PREFERENCES:\n${customInstructions}\n` : ''}
OUTPUT REQUIREMENT:
return strictly the script dialogue with speaker tags and emotive brackets. Do not include any meta-descriptions or markdown notes outside the script lines.`;

      let referenceFilesContext = '';
      if (referenceFiles.length > 0) {
        referenceFilesContext = '\nREFERENCE MATERIALS PROVIDED BY USER:\n' + referenceFiles.map(f => `--- START FILE: ${f.name} ---\n${f.content}\n--- END FILE: ${f.name} ---`).join('\n\n') + '\nPlease strongly utilize these reference materials to inform the content of the podcast.\n';
      }

      const prompt = `Topic for this episode: ${topic}. 
Podcast Name: ${podcastName || 'The Daily Pulse'}
Desired Audience: ${desiredAudience || 'General audience'}
Standard Intro Script: ${introScript || 'Welcome to the podcast. Let\'s get started.'}
Standard Outro Script: ${outroScript || 'Thanks for listening! See you next time.'}
${referenceFilesContext}
Please generate the podcast script now adhering to the template format. Tailor the tone, content, and the emotive brackets entirely towards the Desired Audience (e.g. inject [excited] tags for entrepreneurs, or [concerned] for activists). Ensure you use the provided Standard Intro Script accurately in the 'Standard show intro' section, and use the Standard Outro Script in the 'Outro' section. Reference the Podcast Name prominently.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }
        ],
        config: {
          temperature: 0.7,
        }
      });

      const scriptText = response?.text || '';

      if (!scriptText) {
        throw new Error('No content generated');
      }

      setScript(scriptText);
    } catch (e: any) {
      console.error(e);
      alert('Failed to generate script: ' + (e?.message || ''));
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRefineScript = async () => {
    if (!script || !refinePrompt.trim()) return;
    setIsRefiningScript(true);
    try {
      const ai = await ensureApiKeyAndGetClient();

      const systemPrompt = `You are an expert podcast scriptwriter. 
The user has an existing podcast script and wants to revise it based on their instructions.
Keep the strict Formatting conventions!
FORMATTING CONVENTIONS:
- Short alternating lines between "${speaker1Name}" and "${speaker2Name}".
- Include emotive cues in brackets for EVERY line immediately following the speaker name. Example: \`${speaker1Name}: [thoughtful] Text goes here.\`
- Do not include any meta-descriptions or markdown notes outside the script lines. Output pure dialogue.
${customInstructions ? `\nUSER CUSTOM INSTRUCTIONS & PREFERENCES:\n${customInstructions}\n` : ''}`;

      let referenceFilesContext = '';
      if (referenceFiles.length > 0) {
        referenceFilesContext = '\nREFERENCE MATERIALS PROVIDED BY USER:\n' + referenceFiles.map(f => `--- START FILE: ${f.name} ---\n${f.content}\n--- END FILE: ${f.name} ---`).join('\n\n') + '\nPlease strongly utilize these reference materials to inform the content of the revised podcast.\n';
      }

      const prompt = `EXISTING SCRIPT:\n${script}\n\nDESIRED AUDIENCE: ${desiredAudience || 'General audience'}\n\nUSER REVISION REQUEST: ${refinePrompt}\n${referenceFilesContext}\nPlease output the fully revised script now, ensuring the tone and voice cues match the Desired Audience.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }
        ],
        config: { temperature: 0.7 }
      });

      const scriptText = response?.text || '';

      if (!scriptText) {
        throw new Error('No content generated');
      }
      setScript(scriptText);
      setRefinePrompt('');
    } catch (e: any) {
      console.error(e);
      alert('Failed to refine script: ' + (e?.message || ''));
    } finally {
      setIsRefiningScript(false);
    }
  };

  const handleGenerateThemeMusic = async () => {
    setIsGeneratingTheme(true);
    try {
      const ai = await ensureApiKeyAndGetClient();
      const response = await ai.models.generateContent({
        model: "lyria-3-clip-preview",
        contents: `A professional, engaging ${tone} podcast intro theme for ${podcastName || 'The Daily Pulse'}, catering to an audience of: ${desiredAudience || 'General audience'}.`,
      });

      const mParts = response.candidates?.[0]?.content?.parts;
      const audioBase64 = mParts?.find(p => p.inlineData?.data)?.inlineData?.data;

      if (audioBase64) {
        setThemeMusicBase64(audioBase64);
        alert('Theme music generated and saved globally for future episodes!');
      } else {
        throw new Error('No audio data received');
      }
    } catch (e: any) {
      console.error(e);
      alert('Failed to generate theme music: ' + e.message);
    } finally {
      setIsGeneratingTheme(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!script) return;
    setIsGeneratingAudio(true);
    try {
      const ai = await ensureApiKeyAndGetClient();
      
      // 1. Generate TTS
      let speechWavBuffer: ArrayBuffer;
      
      if (useElevenLabs && elevenLabsApiKey) {
        speechWavBuffer = await generateElevenLabsAudio(parsedScript, elevenLabsApiKey, speaker1VoiceId, speaker2VoiceId, speaker1Name, speaker2Name);
      } else {
        const textToRead = parsedScript
          .filter(l => l.speaker !== 'System')
          .map(l => `${l.speaker}: ${l.text}`)
          .join('\n');
          
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: textToRead }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: speaker1Name,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
                  },
                  {
                    speaker: speaker2Name,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
                  }
                ]
              }
            }
          }
        });
        
        const parts = response.candidates?.[0]?.content?.parts;
        const base64Audio = parts?.[0]?.inlineData?.data;

        if (!base64Audio) {
          throw new Error('No audio generated from TTS API.');
        }
        
        const pcmBuffer = base64ToArrayBuffer(base64Audio);
        speechWavBuffer = createWavFromPcmBuffer(pcmBuffer, 24000);
      }
      
      // 2. Generate Music (optional)
      let musicBuffer: ArrayBuffer | null = null;
      if (includeMusic) {
        if (themeMusicBase64) {
          musicBuffer = base64ToArrayBuffer(themeMusicBase64);
        } else {
          alert('You requested to include music, but no Theme Music was generated. The audio will be rendered without an intro theme. Generate a Theme Music track in the left panel to include it!');
        }
      }
      
      // 3. Merge Tracks
      const finalBlob = await mergeAudioTracks(musicBuffer, speechWavBuffer);
      const url = URL.createObjectURL(finalBlob);
      setAudioUrl(url);

    } catch (e: any) {
      console.error(e);
      alert('Failed to generate audio: ' + e.message);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `podcast-audio-${topic.toLowerCase().replace(/[^a-z0-9]/g, '-')}.wav`;
    link.click();
  };

  const handleShare = () => {
    navigator.clipboard.writeText(script);
    alert('Script copied to clipboard!');
  };

  const handleReferenceFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        alert(`File ${file.name} is too large. Please keep reference files under 2MB each.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        if (typeof content === 'string') {
          setReferenceFiles(prev => {
            const currentSize = prev.reduce((acc, f) => acc + f.content.length, 0);
            if (currentSize + content.length > 4 * 1024 * 1024) {
              alert("Storage limit reached for reference files. Can't add " + file.name);
              return prev;
            }
            return [...prev, { name: file.name, content }];
          });
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        updateCustomInstructions(content);
      }
    };
    reader.readAsText(file);
  };

  const handleNewEpisode = () => {
    setViewMode('setup');
    setTopic('');
    setScript('');
    setParsedScript([]);
    setAudioUrl(null);
  };

  return (
    <div className="min-h-screen flex flex-col items-stretch overflow-hidden bg-slate-100 text-black font-sans">
      {/* Header */}
      <header className="flex-shrink-0 h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">StudioCast AI</h1>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium text-black">
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-1.5 hover:text-black transition-colors">
            <Settings2 className="w-4 h-4" /> Settings
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left Side: Controls */}
        <motion.div 
          layout
          initial={false}
          className={cn(
            "flex-shrink-0 bg-white flex flex-col overflow-y-auto z-10 custom-scrollbar border-slate-200",
            viewMode === 'setup' 
              ? "w-full max-w-[1400px] mx-auto my-6 border rounded-2xl shadow-xl p-8 h-max self-start"
              : "w-80 h-full border-r p-6"
          )}
        >
          
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className={cn("font-semibold text-black", viewMode === 'setup' ? "text-2xl" : "text-lg")}>Create Episode</h2>
              <p className="text-xs text-black">Define the core parameters for your next hit.</p>
            </div>
            {viewMode === 'setup' && (
              <div className="flex items-center gap-2 mt-4 md:mt-0">
                <select 
                  className="p-2 border-2 border-slate-200 rounded-lg text-xs font-semibold text-black bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 cursor-pointer max-w-[160px]"
                  onChange={loadShowProfile}
                  defaultValue=""
                >
                  <option value="" disabled>Load Profile...</option>
                  {showProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button 
                  onClick={handleSaveProfileClick}
                  className="px-3 py-2 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap"
                >
                  Save as Profile
                </button>
              </div>
            )}
            {viewMode === 'studio' && (
              <button 
                onClick={() => setViewMode('setup')}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg"
              >
                Back to Setup
              </button>
            )}
          </div>

          <div className={cn("gap-x-6 gap-y-5", viewMode === 'setup' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 items-start" : "flex flex-col gap-6")}>
            <div>
              <div className="flex items-center mb-2">
                <label className="block text-xs font-bold text-black uppercase tracking-wider">Podcast Name</label>
                <RecentDropdown items={recentPodcastNames} onSelect={setPodcastName} />
              </div>
              <input 
                type="text"
                className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                placeholder="e.g. The Daily Pulse"
                value={podcastName}
                onChange={e => setPodcastName(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center mb-2">
                <label className="block text-xs font-bold text-black uppercase tracking-wider">Desired Audience</label>
              </div>
              <input 
                type="text"
                className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                placeholder="e.g. B2B Founders, Tech Enthusiasts..."
                value={desiredAudience}
                onChange={e => setDesiredAudience(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Podcast Tone</label>
              <select 
                className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70 appearance-none"
                value={tone}
                onChange={e => setTone(e.target.value)}
              >
                <option value="professional">Professional & Informative</option>
                <option value="casual">Casual & Friendly</option>
                <option value="energetic">Energetic & Fast-Paced</option>
                <option value="serious">Hard-Hitting & Serious</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Duration (Est.)</label>
              <div className="grid grid-cols-3 gap-2">
                {(['short', 'medium', 'long'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => setLength(l)}
                    className={cn(
                      "py-2 rounded-md text-xs font-semibold uppercase tracking-wide transition-all border",
                      length === l 
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm" 
                        : "bg-white border-slate-200 text-black hover:text-black hover:bg-slate-50"
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn(viewMode === 'setup' && "md:col-span-2 xl:col-span-2")}>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-black uppercase tracking-wider">Topic or Premise</label>
                <div className="flex items-center gap-2">
                  <button onClick={handleSuggestTopics} disabled={isSuggestingTopics} className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50 px-2 py-1 rounded disabled:opacity-50 flex items-center gap-1">
                    {isSuggestingTopics ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {isSuggestingTopics ? 'Suggesting...' : 'Suggest Topics'}
                  </button>
                  <RecentDropdown items={recentTopics} onSelect={setTopic} />
                </div>
              </div>
              
              {suggestedTopics.length > 0 && (
                <div className="mb-3 flex flex-col gap-2">
                  <p className="text-xs text-black font-medium">Suggestions:</p>
                  <div className={cn("grid gap-1.5", viewMode === 'setup' ? "grid-cols-2" : "grid-cols-1")}>
                    {suggestedTopics.map((st, i) => (
                      <button 
                        key={i} 
                        onClick={() => { setTopic(st); setSuggestedTopics([]); }} 
                        className="text-left text-xs bg-indigo-50/50 hover:bg-indigo-100 border border-indigo-100 p-2 rounded-md transition-colors text-indigo-900"
                      >
                        {st}
                      </button>
                    ))}
                    <button onClick={handleSuggestNextBatch} className="text-xs font-medium text-black hover:text-indigo-600 py-2 transition-colors border border-dashed border-indigo-200 rounded-md hover:border-indigo-400">
                      Wait, give me 5 more...
                    </button>
                  </div>
                </div>
              )}

              <textarea 
                className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                placeholder="e.g. The impact of LLMs on urban planning in 2024..."
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>

            <div className={cn(viewMode === 'setup' && "md:col-span-2 xl:col-span-2")}>
              <div className="flex items-center mb-2">
                <label className="block text-xs font-bold text-black uppercase tracking-wider">Standard Intro Script</label>
                <RecentDropdown items={recentIntros} onSelect={setIntroScript} />
              </div>
              <textarea 
                className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                placeholder="Welcome to our podcast! I'm your host..."
                value={introScript}
                onChange={e => setIntroScript(e.target.value)}
              />
            </div>

            <div className={cn(viewMode === 'setup' && "md:col-span-2 xl:col-span-2")}>
              <div className="flex items-center mb-2">
                <label className="block text-xs font-bold text-black uppercase tracking-wider">Standard Outro Script</label>
                <RecentDropdown items={recentOutros} onSelect={setOutroScript} />
              </div>
              <textarea 
                className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                placeholder="Thanks for listening! Make sure to subscribe..."
                value={outroScript}
                onChange={e => setOutroScript(e.target.value)}
              />
            </div>

            <div className={cn("pt-4 border-t border-slate-200", viewMode === 'setup' && "md:col-span-2 xl:col-span-4")}>
              <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Podcast Theme Music</label>
              
              {!themeMusicBase64 ? (
                <button
                  onClick={handleGenerateThemeMusic}
                  disabled={isGeneratingTheme}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-slate-100 border border-slate-200 text-black text-xs font-semibold rounded-md hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  {isGeneratingTheme ? <Loader2 className="w-4 h-4 animate-spin" /> : <Music className="w-4 h-4" />}
                  {isGeneratingTheme ? 'Generating Theme...' : 'Generate Reusable Theme Music'}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    const audio = new Audio(`data:audio/wav;base64,${themeMusicBase64}`);
                    audio.play();
                  }} className="flex items-center justify-center gap-2 flex-1 px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold rounded-md hover:bg-indigo-100 transition-all">
                    <Play className="w-3.5 h-3.5" /> Preview Theme
                  </button>
                  <button onClick={() => setThemeMusicBase64(null)} className="px-3 py-2 bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100" title="Delete Theme">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-[10px] text-black mt-2">Saved locally. Reused across episodes.</p>
            </div>
            
            <div className={cn("pt-2", viewMode === 'setup' && "md:col-span-2 xl:col-span-4")}>
              <button
                onClick={handleGenerateScript}
                disabled={isGeneratingScript || !topic.trim()}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 border-2 border-indigo-200 text-indigo-600 text-sm font-semibold rounded-md hover:bg-indigo-50 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all"
              >
                {isGeneratingScript ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Drafting...</>
                ) : (
                  <><FileText className="w-4 h-4" /> Generate Script</>
                )}
              </button>
            </div>
            
            {script && (
              <div className={cn("pt-4 border-t border-slate-100 flex flex-col gap-4", viewMode === 'setup' && "md:col-span-2 xl:col-span-4")}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includeMusic} onChange={e => setIncludeMusic(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                  <span className="text-sm font-medium text-black flex items-center gap-1"><Music className="w-4 h-4 text-black" /> Include Music Intro</span>
                </label>

                <button
                  onClick={handleGenerateAudio}
                  disabled={isGeneratingAudio}
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-md shadow-sm hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all"
                >
                  {isGeneratingAudio ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Rendering Audio...</>
                  ) : (
                    <><AudioLines className="w-4 h-4" /> Render Final Audio</>
                  )}
                </button>
              </div>
            )}
          </div>
        </motion.div>

        {/* Right Side: Script and Audio Viewer */}
        <AnimatePresence>
          {viewMode === 'studio' && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: 0.3 }}
              className="flex-1 bg-slate-50 relative flex flex-col h-full overflow-hidden"
            >
              {script ? (
            <>
              {/* Script Render Area */}
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar scroll-smooth flex flex-col">
                <div className="flex items-center justify-between mb-6 max-w-4xl mx-auto w-full">
                  <h3 className="text-xs font-bold text-black uppercase tracking-[0.2em]">Generated Segments Flow</h3>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-xs text-black font-medium whitespace-nowrap">
                      Time: {length === 'short' ? '3-5' : length === 'long' ? '15-20' : '8-12'}m
                    </span>
                  </div>
                </div>

                <div className="max-w-4xl mx-auto w-full space-y-4">
                  {parsedScript.map((line, index) => (
                    <div 
                      key={line.id} 
                      className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all duration-300 hover:border-blue-400"
                    >
                      {line.speaker === 'System' ? (
                        <p className="text-sm text-black italic px-8">{line.text}</p>
                      ) : (
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-7 h-7 flex items-center justify-center rounded text-xs font-bold shrink-0",
                                line.speaker.toLowerCase().includes('1') 
                                  ? "bg-indigo-500 text-white" 
                                  : "bg-slate-100 text-black"
                              )}>
                                {(index + 1).toString().padStart(2, '0')}
                              </div>
                              <h4 className="font-semibold text-sm text-black">
                                {line.speaker.toUpperCase()}
                              </h4>
                              <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-black px-2 py-0.5 rounded">
                                {line.emotion}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm text-black leading-relaxed ml-10">"{line.text}"</p>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* AI Refinement Area */}
                  <div className="mt-8 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center shadow-sm">
                    <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 hidden sm:block" />
                    <input
                      type="text"
                      placeholder="Tell AI to change the script (e.g., 'Make speaker 2 sound more skeptical')"
                      value={refinePrompt}
                      onChange={e => setRefinePrompt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRefineScript();
                      }}
                      className="flex-1 w-full bg-white px-4 py-2.5 border-2 border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                    />
                    <button
                      onClick={handleRefineScript}
                      disabled={isRefiningScript || !refinePrompt.trim()}
                      className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center min-w-[130px] shadow-sm"
                    >
                      {isRefiningScript ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refine Script'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Action Bar */}
              <footer className="h-20 bg-white border-t border-slate-200 px-8 flex items-center justify-between shrink-0">
                <div className="flex gap-4 items-center flex-1">
                  {audioUrl ? (
                    <audio src={audioUrl} controls className="h-10 w-full max-w-sm" />
                  ) : (
                    <span className="text-sm font-medium text-black italic">Render audio to preview here...</span>
                  )}
                </div>
                
                <div className="flex gap-4 items-center">
                  <button 
                    onClick={handleDownload} 
                    disabled={!audioUrl}
                    className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-black hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Download WAV
                  </button>
                  <div className="flex items-center gap-3 pr-4 border-r border-slate-200">
                    <span className="text-xs font-medium text-black">Share:</span>
                    <div className="flex gap-1.5">
                      <button onClick={handleShare} className="w-7 h-7 bg-slate-100 hover:bg-slate-200 transition-colors rounded flex items-center justify-center text-black">
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <button onClick={handleNewEpisode} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50">
                    Create New Episode
                  </button>
                </div>
              </footer>
            </>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-50">
              <div className="w-20 h-20 mb-6 rounded-2xl bg-white flex items-center justify-center border border-slate-200 shadow-sm">
                <FileText className="w-8 h-8 text-indigo-400" />
              </div>
              <h3 className="text-xl font-bold text-black mb-2">Ready to broadcast</h3>
              <p className="text-sm text-black max-w-sm">
                Enter your topic on the left and our AI will synthesize a complete dual-host podcast script.
              </p>
            </div>
          )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast Notifier for Scheduling */}
      {showSchedule && (
        <div className="absolute bottom-24 right-8 bg-slate-900 text-white px-5 py-4 rounded-xl shadow-2xl shadow-slate-900/20 flex items-center gap-3 animate-in slide-in-from-bottom-5 z-50">
          <div className="bg-indigo-500/20 p-2 rounded-lg text-indigo-400">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium">Episode successfully scheduled!</div>
        </div>
      )}

      
      {/* Show Profile Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 p-6">
            <h2 className="text-xl font-bold mb-4 text-black">Save Show Profile</h2>
            <div className="mb-6">
              <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Profile Name</label>
              <input 
                type="text"
                autoFocus
                className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                value={showProfileName}
                onChange={e => setShowProfileName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmSaveProfile(); }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 border border-slate-200 text-black rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmSaveProfile}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      
      {/* Profile Action Modal */}
      {profileModalMode && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="text-lg font-bold text-black mb-4">
              {profileModalMode === 'create' ? 'Create Instruction Profile' : profileModalMode === 'rename' ? 'Rename Profile' : 'Delete Profile'}
            </h3>
            
            {profileModalMode === 'delete' ? (
              <p className="text-sm text-slate-600 mb-6">Are you sure you want to delete "{activeProfile.name}"? This cannot be undone.</p>
            ) : (
              <div className="mb-6">
                <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Profile Name</label>
                <input 
                  type="text"
                  autoFocus
                  className="w-full p-2 border-2 border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  value={profileInputValue}
                  onChange={e => setProfileInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitProfileModal()}
                />
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setProfileModalMode(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={submitProfileModal}
                disabled={(profileModalMode !== 'delete' && !profileInputValue.trim())}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${
                  profileModalMode === 'delete' 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50'
                }`}
              >
                {profileModalMode === 'delete' ? 'Delete' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2 text-black">
                <Settings2 className="w-6 h-6 text-indigo-500" /> Podcast Settings
              </h2>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-2 text-black hover:text-black hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Square className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                {/* Column 1: Profiles & Instructions */}
                <div>
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-bold text-black">
                        System Instructions
                      </label>
                      <div className="flex gap-2 text-xs font-medium">
                        <button onClick={handleRenameProfile} className="text-indigo-600 hover:text-indigo-800 transition-colors">Rename</button>
                        {instructionProfiles.length > 1 && <button onClick={handleDeleteProfile} className="text-red-500 hover:text-red-700 transition-colors">Delete</button>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <select 
                        className="flex-1 p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70 appearance-none font-semibold text-black"
                        value={activeProfileId}
                        onChange={e => setActiveProfileId(e.target.value)}
                      >
                        {instructionProfiles.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button onClick={handleCreateProfile} className="px-4 py-2 bg-slate-100 text-black rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors whitespace-nowrap">
                        + New
                      </button>
                    </div>

                    <div className="flex items-center gap-4 mb-3">
                      <label className="flex-1 shrink-0 flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-black text-sm font-medium rounded-lg cursor-pointer transition-colors">
                        <FileText className="w-4 h-4" />
                        Upload Instruction File (.md, .txt)
                        <input 
                          type="file" 
                          accept=".md,.txt" 
                          className="hidden" 
                          onChange={handleFileUpload}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-black mb-2">Or enter your instructions manually below:</p>
                    <textarea 
                      className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm h-48 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                      placeholder="e.g. Always keep Speaker 1 as the main knowledge expert and Speaker 2 as the skeptic..."
                      value={customInstructions}
                      onChange={e => updateCustomInstructions(e.target.value)}
                    />
                  </div>
                  <div className="mt-8">
                    <label className="block text-sm font-bold text-black mb-2">
                      Reference Files
                    </label>
                    <p className="text-xs text-black mb-4">
                      Upload source material (articles, transcripts, notes) for the AI to base the episode on.
                    </p>
                    <div className="grid grid-cols-1 gap-2 mb-3">
                      {referenceFiles.map((file, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-indigo-50 border border-indigo-100 rounded-lg">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                            <span className="text-xs font-semibold text-indigo-900 truncate">{file.name}</span>
                          </div>
                          <button onClick={() => setReferenceFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 p-1">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <label className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-black text-sm font-medium rounded-lg cursor-pointer transition-colors w-full">
                      <FileText className="w-4 h-4" />
                      Add Reference Files (.txt, .md, .csv)
                      <input 
                        type="file" 
                        multiple 
                        accept=".txt,.md,.csv,.json" 
                        className="hidden" 
                        onChange={handleReferenceFilesUpload}
                      />
                    </label>
                  </div>

                </div>

                {/* Column 2: Speakers & Voice Settings */}
                <div className="flex flex-col gap-8">
                  <div>
                    <label className="block text-sm font-bold text-black mb-4">
                      Speaker Names
                    </label>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-2">Host 1 Name</label>
                        <input 
                          type="text"
                          className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                          value={speaker1Name}
                          onChange={e => setSpeaker1Name(e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-2">Host 2 Name</label>
                        <input 
                          type="text"
                          className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                          value={speaker2Name}
                          onChange={e => setSpeaker2Name(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-slate-100">
                    <label className="flex items-center gap-2 text-sm font-bold text-black mb-4 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-indigo-600 rounded border-blue-400 focus:ring-indigo-500"
                        checked={useElevenLabs}
                        onChange={(e) => setUseElevenLabs(e.target.checked)}
                      />
                      Use ElevenLabs API for Voice Gen
                    </label>
                    
                    {useElevenLabs && (
                      <div>
                        <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">
                          ElevenLabs API Key
                        </label>
                        <input 
                          type="password"
                          className="w-full p-2.5 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                          placeholder="sk_..."
                          value={elevenLabsApiKey}
                          onChange={e => setElevenLabsApiKey(e.target.value)}
                        />
                        <p className="text-[10px] text-black mt-2">
                          Your key is saved locally in your browser. Audio will be generated per-line, which may take longer than the default Gemini TTS API.
                        </p>
                        {elevenLabsApiKey && (
                          <div className="mt-4 pt-4 border-t border-slate-100">
                            <div className="flex items-center justify-between mb-3">
                              <label className="block text-xs font-bold text-black uppercase tracking-wider">Voice Selection</label>
                              <button
                                onClick={fetchElevenLabsVoices}
                                disabled={isFetchingVoices}
                                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 disabled:opacity-50"
                              >
                                {isFetchingVoices ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Fetch My Voices
                              </button>
                            </div>
                            
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">{speaker1Name}</label>
                                <select
                                  className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded text-sm min-h-[38px] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                                  value={speaker1VoiceId}
                                  onChange={e => setSpeaker1VoiceId(e.target.value)}
                                >
                                  <option value="pNInz6obpgDQGcFmaJgB">Adam (Default)</option>
                                  {availableVoices.map(v => (
                                    <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">{speaker2Name}</label>
                                <select
                                  className="w-full p-2 bg-white border-2 border-blue-400 text-black shadow-sm rounded text-sm min-h-[38px] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                                  value={speaker2VoiceId}
                                  onChange={e => setSpeaker2VoiceId(e.target.value)}
                                >
                                  <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Default)</option>
                                  {availableVoices.map(v => (
                                    <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 shrink-0 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

