const fs = require('fs');
const p = 'frontend/main.js';
const s = fs.readFileSync(p,'utf8');
const stack=[];
const pairs={'{':'}','(':')','[':']'};
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='"' || ch==="'" ){ // skip strings
    const quote=ch; i++;
    while(i<s.length){ if(s[i]==='\\') { i+=2; continue;} if(s[i]===quote) break; i++; }
    continue;
  }
  if(ch==='`'){
    i++;
    while(i<s.length){ if(s[i]==='\\') { i+=2; continue;} if(s[i]==='`') break; i++; }
    continue;
  }
  if(ch==='{'||ch==='('||ch==='[') stack.push({ch,i});
  if(ch==='}'||ch===')'||ch===']'){
    if(stack.length===0){ console.log('Unmatched closing', ch, 'at', i); process.exit(2);} 
    const last=stack.pop();
    if(pairs[last.ch]!==ch){ console.log('Mismatched', last.ch, 'opened at', last.i, 'but closed by', ch, 'at', i); process.exit(3);} 
  }
}
if(stack.length) { console.log('Unclosed:', stack.map(x=>x.ch+'@'+x.i).join(',')); process.exit(4);} console.log('Braces OK');
