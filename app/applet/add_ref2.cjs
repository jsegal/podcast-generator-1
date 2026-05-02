const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add ReferenceFile type and update ShowProfile
code = code.replace(
  /type ShowProfile = \{/,
  `type ReferenceFile = {
  name: string;
  content: string;
};

type ShowProfile = {`
);

code = code.replace(
  /  outroScript: string;\n\};/,
  `  outroScript: string;
  referenceFiles?: ReferenceFile[];
};`
);

// 2. Add state for referenceFiles and include in ShowProfile functions
const stateDeclarations = `  const [introScript, setIntroScript] = useState('');
  const [outroScript, setOutroScript] = useState('');
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);`;

code = code.replace(/  const \[introScript, setIntroScript\] = useState\(''\);\n  const \[outroScript, setOutroScript\] = useState\(''\);/, stateDeclarations);

// Update loadShowProfile
const oldLoadProfile = `      setTopic(profile.topic);
      setIntroScript(profile.introScript);
      setOutroScript(profile.outroScript);`;
const newLoadProfile = `      setTopic(profile.topic);
      setIntroScript(profile.introScript);
      setOutroScript(profile.outroScript);
      setReferenceFiles(profile.referenceFiles || []);`;
code = code.replace(oldLoadProfile, newLoadProfile);

// Update confirmSaveProfile
const oldConfirmSave = `        topic,
        introScript,
        outroScript,
      };`;
const newConfirmSave = `        topic,
        introScript,
        outroScript,
        referenceFiles,
      };`;
code = code.replace(oldConfirmSave, newConfirmSave);

fs.writeFileSync('src/App.tsx', code);
