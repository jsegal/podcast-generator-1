const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/border-slate-300/g, 'border-blue-400');
content = content.replace(/placeholder:text-indigo-900\/40/g, 'placeholder:text-blue-500/70');
content = content.replace(/focus:ring-indigo-500\/50/g, 'focus:ring-blue-500/50 focus:border-blue-500');

// Make text-black -> text-slate-900 for labels 
// Actually they requested NO fonts in gray color. I already replaced all text-slate-* with text-black. We'll leave them text-black.

fs.writeFileSync('src/App.tsx', content);
