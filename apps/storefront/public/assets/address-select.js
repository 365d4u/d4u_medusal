/* Searchable controls retain the original selects as the submitted source of truth. */
(()=>{'use strict';
const widgets=new WeakMap();let opened=null;
function enhance(select){
 if(widgets.has(select))return;
 const wrapper=document.createElement('div');wrapper.className='address-select';
 select.before(wrapper);wrapper.append(select);select.classList.add('address-native-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
 const label=document.querySelector(`label[for="${select.id}"]`),name=label?.textContent.replace('*','').trim()||'Location';
 const button=document.createElement('button');button.type='button';button.className='address-select-toggle';button.id=select.id+'-toggle';button.setAttribute('aria-label',name);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
 const panel=document.createElement('div');panel.className='address-select-panel';panel.hidden=true;
 const search=document.createElement('input');search.type='search';search.placeholder='Search '+name.toLowerCase()+'…';search.setAttribute('aria-label','Search '+name);search.setAttribute('role','combobox');search.setAttribute('aria-autocomplete','list');search.autocomplete='off';
 const list=document.createElement('div');list.className='address-select-options';list.id=select.id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',name);button.setAttribute('aria-controls',list.id);search.setAttribute('aria-controls',list.id);
 panel.append(search,list);wrapper.append(button,panel);
 if(label)label.htmlFor=button.id;
 let active=-1;
 const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');search.setAttribute('aria-expanded','false');if(opened===close)opened=null;};
 function sync(){button.textContent=select.selectedOptions[0]?.textContent||'Select an option…';button.disabled=select.disabled;}
 function focusOption(index){const options=[...list.querySelectorAll('[role=option]')];if(!options.length)return;active=(index+options.length)%options.length;options.forEach((o,i)=>o.classList.toggle('is-focused',i===active));search.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
 function render(){list.replaceChildren();active=-1;search.removeAttribute('aria-activedescendant');const query=search.value.trim().toLocaleLowerCase();
  for(const option of select.options){if(!option.value||option.disabled||!(option.text+' '+option.value).toLocaleLowerCase().includes(query))continue;
   const row=document.createElement('button');row.type='button';row.tabIndex=-1;row.className='address-select-option';row.id=list.id+'-'+list.childElementCount;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.textContent=option.text;
   row.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();button.focus();};list.append(row);
  }
  if(!list.childElementCount){const empty=document.createElement('p');empty.textContent='No matches found';empty.setAttribute('role','status');list.append(empty);}
 }
 button.onclick=()=>{if(!panel.hidden){close();return;}opened?.();opened=close;search.value='';render();panel.hidden=false;button.setAttribute('aria-expanded','true');search.setAttribute('aria-expanded','true');search.focus({preventScroll:true});panel.scrollIntoView({block:'nearest'});};
 search.oninput=render;search.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();focusOption(active+(e.key==='ArrowDown'?1:-1));}else if(e.key==='Enter'){e.preventDefault();list.querySelectorAll('[role=option]')[Math.max(0,active)]?.click();}else if(e.key==='Escape'){e.preventDefault();close();button.focus();}};
 wrapper.addEventListener('focusout',()=>setTimeout(()=>{if(!wrapper.contains(document.activeElement))close();},0));
 select.addEventListener('change',sync);select.addEventListener('invalid',e=>{e.preventDefault();button.focus();button.setAttribute('aria-invalid','true');});select.addEventListener('change',()=>button.removeAttribute('aria-invalid'));
 new MutationObserver(sync).observe(select,{attributes:true,attributeFilter:['disabled']});sync();widgets.set(select,{wrapper,close});
}
function scan(){document.querySelectorAll('#shipping_country,#billing_country,#shipping_state,#billing_state').forEach(el=>{if(el.tagName==='SELECT')enhance(el);});}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.address-select'))opened?.();});
document.addEventListener('invoice-state-replaced',e=>{const old=widgets.get(e.detail.previous);if(old){old.close();old.wrapper.replaceWith(e.detail.current);}const label=document.querySelector(`label[for="${e.detail.current.id}-toggle"]`);if(label)label.htmlFor=e.detail.current.id;scan();});
scan();
})();
