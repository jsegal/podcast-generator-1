const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const referenceFilesBlockStart = code.indexOf(`            {viewMode === 'setup' && (
              <div className={cn("pt-4 border-t border-slate-100", viewMode === 'setup' && "md:col-span-2 xl:col-span-2")}>
                <label className="block text-xs font-bold text-black uppercase tracking-wider mb-2">Show Reference Files</label>`);
const referenceFilesBlockEnd = code.indexOf(`              </div>
            )}

            <div className={cn("pt-4 border-t border-slate-200", viewMode === 'setup' && "md:col-span-2 xl:col-span-4")}>`) + `              </div>
            )}\n\n`.length;

const referenceFilesBlock = code.slice(referenceFilesBlockStart, referenceFilesBlockEnd);

// Remove block from Setup UI
if (referenceFilesBlockStart !== -1) {
  code = code.replace(referenceFilesBlock, '');
}

// Modify Reference Files Block for Settings UI (remove viewMode check, change styling)
const newSettingsBlock = `
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
`;

// Insert into Settings Modal after customInstructions
const targetPoint = `                    <textarea 
                      className="w-full p-3 bg-white border-2 border-blue-400 text-black shadow-sm rounded-lg text-sm h-48 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-blue-500/70"
                      placeholder="e.g. Always keep Speaker 1 as the main knowledge expert and Speaker 2 as the skeptic..."
                      value={customInstructions}
                      onChange={e => updateCustomInstructions(e.target.value)}
                    />
                  </div>`;
                  
code = code.replace(targetPoint, targetPoint + newSettingsBlock);

// Also rename "Upload Markdown File" for custom instructions to make it clear
code = code.replace(
  'Upload Markdown File\n                        <input',
  'Upload Instruction File (.md, .txt)\n                        <input'
);
code = code.replace(
  '<label className="block text-sm font-bold text-black">\n                        Instruction Profiles',
  '<label className="block text-sm font-bold text-black">\n                        System Instructions'
);

fs.writeFileSync('src/App.tsx', code);
