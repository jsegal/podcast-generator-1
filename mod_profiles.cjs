const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add Type
code = code.replace(
  /type InstructionProfile = \{/,
  `type ShowProfile = {
  id: string;
  name: string;
  podcastName: string;
  desiredAudience: string;
  topic: string;
  introScript: string;
  outroScript: string;
};

type InstructionProfile = {`
);

// 2. Add State and functions
const stateBlock = `
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
    }
    e.target.value = ""; // reset dropdown
  };

  const saveNewShowProfile = () => {
    const defaultName = podcastName ? \`\${podcastName} Profile\` : 'New Profile';
    const name = window.prompt('Enter a name for this Show Profile:', defaultName);
    if (name && name.trim()) {
      const newProfile: ShowProfile = {
        id: Date.now().toString(),
        name: name.trim(),
        podcastName,
        desiredAudience,
        topic,
        introScript,
        outroScript,
      };
      const updated = [...showProfiles, newProfile];
      setShowProfiles(updated);
      try { localStorage.setItem('podcast_show_profiles', JSON.stringify(updated)); } catch {}
    }
  };

  const deleteShowProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this show profile?')) {
      const updated = showProfiles.filter(p => p.id !== id);
      setShowProfiles(updated);
      try { localStorage.setItem('podcast_show_profiles', JSON.stringify(updated)); } catch {}
    }
  };
`;

code = code.replace(
  /export default function App\(\) \{/,
  `export default function App() {\n${stateBlock}`
);

// 3. Add UI in Setup
// Find the header inside Setup View
const headerSearch = `              <p className="text-xs text-black">Define the core parameters for your next hit.</p>
            </div>`;

const setupUIBlock = `              <p className="text-xs text-black">Define the core parameters for your next hit.</p>
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
                  onClick={saveNewShowProfile}
                  className="px-3 py-2 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap"
                >
                  Save as Profile
                </button>
              </div>
            )}`;

code = code.replace(headerSearch, setupUIBlock);

fs.writeFileSync('src/App.tsx', code);
