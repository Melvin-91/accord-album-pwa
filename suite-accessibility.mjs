/* Accord Suite appearance preferences — identical in both apps. */
export const appearanceOptions={
 theme:{label:"Tema",values:[["copper","Antracite e rame"],["midnight","Blu notte"],["forest","Verde bosco"]]},
 textScale:{label:"Dimensione del testo",values:[["normal","Standard"],["large","Grande (+15%)"],["larger","Molto grande (+30%)"]]},
 contrast:{label:"Contrasto",values:[["standard","Standard"],["high","Elevato"]]},
 density:{label:"Densità dei controlli",values:[["touch","Comoda"],["compact","Compatta"]]}
};
export function normalizeAppearance(value={}){
 return Object.fromEntries(Object.entries(appearanceOptions).map(([k,o])=>[k,o.values.some(([v])=>v===value?.[k])?value[k]:o.values[0][0]]));
}
export function readAppearance(storage,legacy={}){
 let saved={};try{saved=JSON.parse(storage.getItem("accord-suite:appearance")||"{}")||{}}catch{}
 return normalizeAppearance({...legacy,...saved});
}
export function applyAppearance(root,value){
 const p=normalizeAppearance(value);for(const [key,v] of Object.entries(p))root.dataset[key]=v;
 return p;
}
export function mountAppearance(container,{storage,legacy={},onChange=()=>{}}){
 const doc=container.ownerDocument,root=doc.documentElement;let value=readAppearance(storage,legacy);
 applyAppearance(root,value);container.replaceChildren();
 const heading=doc.createElement("h3");heading.textContent="Aspetto e accessibilità";container.append(heading);
 const fields={};
 const save=next=>{value=applyAppearance(root,next);try{storage.setItem("accord-suite:appearance",JSON.stringify(value))}catch{}for(const [k,s] of Object.entries(fields))s.value=value[k];onChange(value)};
 for(const [key,option] of Object.entries(appearanceOptions)){
  const label=doc.createElement("label"),select=doc.createElement("select");label.textContent=option.label;
  select.id="suite-pref-"+key;for(const [v,t] of option.values){const o=doc.createElement("option");o.value=v;o.textContent=t;select.append(o)}
  fields[key]=select;select.value=value[key];select.addEventListener("change",()=>save({...value,[key]:select.value}));label.append(select);container.append(label);
 }
 const hint=doc.createElement("p");hint.className="muted";hint.textContent="Preferenze locali a questa applicazione. Il movimento ridotto segue le impostazioni del dispositivo.";container.append(hint);
 const reset=doc.createElement("button");reset.type="button";reset.className="secondary";reset.textContent="Ripristina aspetto predefinito";reset.addEventListener("click",()=>save({}));container.append(reset);
 return value;
}
