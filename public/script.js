'use strict';

const $ = id => document.getElementById(id);
const state = { authMode:'login', user:null, products:[], history:[], users:[], audit:[], editingId:null, movingId:null, moveType:'in', picked:new Set(), restockRequests:[], sort:{key:'name',dir:1}, confirmAction:null };
const roleNames = { admin:'Администратор', office:'Кладовщик', user:'Просмотр' };
const money = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(n)||0);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lowItems = () => state.products.filter(p=>p.quantity<=p.minQty);
const totalUnits = () => state.products.reduce((s,p)=>s+p.quantity,0);
const totalValue = () => state.products.reduce((s,p)=>s+p.price*p.quantity,0);
const canWrite = () => ['admin','office'].includes(state.user?.role);
const isAdmin = () => state.user?.role === 'admin';

async function api(url, options={}) {
  const response = await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status})`);
  return data;
}
function toast(message,error=false) {
  const el=document.createElement('div'); el.className='toast'+(error?' error':''); el.textContent=message; $('toasts').append(el);
  setTimeout(()=>el.remove(),3200);
}
function confirmAction(title,message,action) {
  $('confirm-title').textContent=title; $('confirm-text').textContent=message; state.confirmAction=action; $('confirm-dialog').classList.add('show');
}
async function refresh() {
  const data=await api('/api/bootstrap'); state.products=data.products; state.history=data.history;
  state.restockRequests=await api('/api/restock').catch(()=>[]); renderAll();
}
function setRoleUI() {
  $('user-name').textContent=state.user.name;
  $('user-role').textContent=roleNames[state.user.role] || state.user.role;
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin()));
  document.querySelectorAll('.write-only').forEach(el=>el.classList.toggle('hidden',!canWrite()));
  $('btn-add').classList.toggle('hidden',!canWrite());
}
async function login(event) {
  event.preventDefault(); $('login-error').textContent='';
  try {
    const registering=state.authMode==='register';
    const endpoint=registering?'/api/auth/register':'/api/auth/login';
    const payload={email:$('login-email').value.trim(),password:$('login-password').value};
    if(registering)payload.name=$('register-name').value.trim();
    const data=await api(endpoint,{method:'POST',body:JSON.stringify(payload)});
    state.user=data.user; $('auth-screen').classList.add('hidden'); $('app').classList.remove('hidden'); setRoleUI(); await refresh();
    if(registering)toast('Аккаунт создан. Добро пожаловать в StockFlow!');
  } catch(e) {$('login-error').textContent=e.message;}
}
function setAuthMode(mode){
  state.authMode=mode;const registering=mode==='register';
  $('auth-title').textContent=registering?'Создание аккаунта':'Вход в систему';
  $('auth-description').textContent=registering?'Зарегистрируйтесь, чтобы получить доступ к складской системе.':'Управляйте товарами, остатками и движением склада в одном месте.';
  $('register-name-wrap').classList.toggle('hidden',!registering);
  $('register-name').required=registering;
  $('login-password').autocomplete=registering?'new-password':'current-password';
  $('login-password').placeholder=registering?'Не менее 10 символов':'Ваш пароль';
  $('auth-submit').textContent=registering?'Зарегистрироваться':'Войти';
  $('auth-switch').textContent=registering?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться';
  $('login-error').textContent='';
}
async function logout() {
  await api('/api/auth/logout',{method:'POST'}).catch(()=>{});
  state.user=null; state.products=[]; state.history=[]; $('app').classList.add('hidden'); $('auth-screen').classList.remove('hidden'); $('login-password').value='';
}
function switchView(view) {
  if ((view==='users'||view==='audit')&&!isAdmin()) return toast('Нет доступа',true);
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+view).classList.add('active');
  const meta={dashboard:['Дашборд','Обзор склада'],products:['Товары','Каталог и управление остатками'],history:['Операции','Журнал складских движений'],restock:['Закупки','Список пополнения'],analytics:['Аналитика','Показатели склада'],users:['Пользователи','Управление аккаунтами'],audit:['Журнал действий','История действий сотрудников']};
  $('page-title').textContent=meta[view][0]; $('page-sub').textContent=meta[view][1];
  if(view==='analytics'){drawDonut();drawBars();}
  if(view==='users')loadUsers();
  if(view==='audit')loadAudit();
}
function getRestockRows(){
  const manual=state.restockRequests.map(r=>({key:`r-${r.id}`,request:r,product:state.products.find(p=>p.id===r.productId),qty:r.qty,manual:true}));
  const automatic=lowItems().filter(p=>!manual.some(r=>r.product?.id===p.id)).map(p=>({key:`p-${p.id}`,product:p,qty:Math.max(1,p.minQty*2-p.quantity),manual:false}));
  return [...manual,...automatic];
}
function updateNavCounters(){
  // The products badge mirrors the complete catalogue; the restock badge mirrors
  // the exact rows shown in the replenishment table (without double-counting).
  $('pill-products').textContent=String(state.products.length);
  $('pill-restock').textContent=String(getRestockRows().length);
}
function renderAll(){updateNavCounters();renderDashboard();renderProducts();renderHistory();renderRestock();renderAnalytics();}
function renderDashboard(){
  $('stat-positions').textContent=state.products.length;$('stat-units').textContent=totalUnits();$('stat-value').textContent=money(totalValue());$('stat-low').textContent=lowItems().length;
  $('low-list').innerHTML=lowItems().slice(0,6).map(p=>`<div class="item"><div><b>${esc(p.name)}</b><small>${esc(p.sku)} · минимум ${p.minQty}</small></div><strong class="out">${p.quantity} шт.</strong></div>`).join('')||'<div class="empty">Все остатки в норме </div>';
  $('recent-ops').innerHTML=state.history.slice(-6).reverse().map(o=>`<div class="item"><div><b>${esc(o.productName)}</b><small>${dateFmt(o.date)} · ${o.qty} шт. · ${esc(o.userName||'')}</small></div><strong class="${o.type}">${o.type==='in'?'↑ Приход':'↓ Расход'}</strong></div>`).join('')||'<div class="empty">Операций пока нет</div>';
  drawSpark();
}
function renderProducts(){
  const q=$('search').value.trim().toLowerCase(),cat=$('filter-cat').value;
  let list=state.products.filter(p=>(!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q))&&(!cat||p.category===cat));
  if($('only-low').checked)list=list.filter(p=>p.quantity<=p.minQty);
  const {key,dir}=state.sort;list.sort((a,b)=>dir*(key==='name'||key==='sku'?String(a[key]).localeCompare(String(b[key]),'ru'):(key==='value'?a.price*a.quantity-b.price*b.quantity:a[key]-b[key])));
  $('products-body').innerHTML=list.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.sku)}</td><td>${esc(p.category||'—')}</td><td>${money(p.price)}</td><td>${p.quantity} шт. <span class="badge ${p.quantity<=p.minQty?'low':'ok'}">${p.quantity<=p.minQty?'Мало':'Норма'}</span></td><td><b>${money(p.price*p.quantity)}</b></td><td><div class="actions">${canWrite()?`<button class="btn-primary btn-mini" data-move="in" data-id="${p.id}">Приход</button><button class="btn-ghost btn-mini" data-move="out" data-id="${p.id}">Расход</button><button class="btn-ghost btn-mini" data-edit="${p.id}">Изменить</button>`:''}${isAdmin()?`<button class="btn-danger btn-mini" data-delete="${p.id}">Удалить</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Товары не найдены</td></tr>';
  const cats=[...new Set(state.products.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')),old=$('filter-cat').value;
  $('filter-cat').innerHTML='<option value="">Все категории</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');$('filter-cat').value=cats.includes(old)?old:'';
}
function dateFmt(value){const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderHistory(){
  const type=$('filter-type').value,q=$('search-history').value.trim().toLowerCase();
  const list=state.history.slice().reverse().filter(o=>(!type||o.type===type)&&(!q||`${o.productName} ${o.comment} ${o.userName||''}`.toLowerCase().includes(q)));
  $('history-body').innerHTML=list.slice(0,500).map(o=>`<tr><td>${dateFmt(o.date)}</td><td>${esc(o.productName)}</td><td class="${o.type}">${o.type==='in'?'↑ Приход':'↓ Расход'}</td><td>${o.qty} шт.</td><td>${money(o.total)}</td><td>${esc(o.userName||'—')}</td><td>${esc(o.comment||'—')}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Операций пока нет</td></tr>';
  $('history-total').textContent=`Записей: ${list.length} · Сумма операций: ${money(list.reduce((s,o)=>s+(o.total||0),0))}`;
}
function renderRestock(){
  const rows=getRestockRows();updateNavCounters();
  state.picked=new Set([...state.picked].filter(k=>rows.some(r=>r.key===k)));
  $('restock-body').innerHTML=rows.map(r=>{const p=r.product,name=p?.name||r.request?.productName||'Товар удалён',sku=p?.sku||r.request?.sku||'—';
    return `<tr><td><input type="checkbox" data-pick="${r.key}" ${state.picked.has(r.key)?'checked':''}></td><td><b>${esc(name)}</b><br><small>${esc(sku)}${r.manual?' · Заявка администратора':''}</small>${r.request?.note?`<br><small>${esc(r.request.note)}</small>`:''}</td><td>${p?.quantity??'—'}</td><td>${p?.minQty??'—'}</td><td>${r.qty}</td><td>${p?money(r.qty*p.price):'—'}</td><td>${r.manual&&isAdmin()?`<button class="btn-ghost btn-mini" data-restock-delete="${r.request.id}">Убрать</button>`:''}</td></tr>`;
  }).join('')||'<tr><td colspan="7" class="empty">Список пополнения пуст</td></tr>';
  const chosen=rows.filter(r=>state.picked.has(r.key));$('restock-total').textContent=`Выбрано позиций: ${chosen.length} · Ориентировочная стоимость: ${money(chosen.reduce((s,r)=>s+(r.product?r.qty*r.product.price:0),0))}`;
}
function renderAnalytics(){
  const top=state.products.slice().sort((a,b)=>b.price*b.quantity-a.price*a.quantity).slice(0,5);
  $('top-products').innerHTML=top.map((p,i)=>`<div class="item"><span>${i+1}. ${esc(p.name)}</span><b>${money(p.price*p.quantity)}</b></div>`).join('')||'<div class="empty">Нет товаров</div>';
  const ins=state.history.filter(o=>o.type==='in').reduce((s,o)=>s+o.qty,0),outs=state.history.filter(o=>o.type==='out').reduce((s,o)=>s+o.qty,0);
  $('summary').innerHTML=`<div><small>Категорий</small><b>${new Set(state.products.map(p=>p.category||'Без категории')).size}</b></div><div><small>Принято за всё время</small><b>${ins} шт.</b></div><div><small>Отгружено за всё время</small><b>${outs} шт.</b></div><div><small>Всего операций</small><b>${state.history.length}</b></div><div><small>Средняя стоимость единицы на складе</small><b>${money(totalUnits()?totalValue()/totalUnits():0)}</b></div><div><small>Позиций ниже минимума</small><b>${lowItems().length}</b></div>`;
  const deficit=lowItems().length,net=ins-outs;
  $('report-insight-text').textContent=`Сейчас на складе ${totalUnits()} единиц на сумму ${money(totalValue())}. ${deficit?`Ниже минимального остатка: ${deficit} поз.`:'Все товарные позиции находятся на уровне минимального остатка или выше.'} За всё время учтено ${ins} единиц прихода и ${outs} единиц расхода; разница по журналу — ${net>=0?'+':''}${net} шт.`;
}
function daily(days=14){
  const arr=[];for(let i=days-1;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);arr.push({key:d.toDateString(),label:`${d.getDate()}.${d.getMonth()+1}`,in:0,out:0});}
  state.history.forEach(o=>{const d=new Date(o.date);const b=arr.find(x=>x.key===new Date(d.getFullYear(),d.getMonth(),d.getDate()).toDateString());if(b)b[o.type]+=o.qty;});return arr;
}
function canvas(id,height){const cv=$(id);if(!cv||!cv.clientWidth)return null;const ratio=window.devicePixelRatio||1,w=cv.clientWidth;cv.width=w*ratio;cv.height=height*ratio;cv.style.height=height+'px';const ctx=cv.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return {ctx,w,h:height};}
function css(v){return getComputedStyle(document.body).getPropertyValue(v).trim();}
function drawSpark(){const c=canvas('spark',160);if(!c)return;const {ctx,w,h}=c,data=daily(),max=Math.max(1,...data.map(d=>Math.max(d.in,d.out))),pad=25;ctx.clearRect(0,0,w,h);ctx.strokeStyle=css('--border');for(let i=0;i<5;i++){let y=pad+(h-pad*2)*i/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}for(const [key,color] of [['in',css('--success')],['out',css('--danger')]]){ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();data.forEach((d,i)=>{let x=pad+(w-pad*2)*i/(data.length-1),y=h-pad-(h-pad*2)*d[key]/max;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}}
function drawBars(){const c=canvas('bars',260);if(!c)return;const {ctx,w,h}=c,data=daily(),max=Math.max(1,...data.map(d=>Math.max(d.in,d.out))),pad=24,g=(w-pad*2)/data.length,bw=Math.min(10,g/2.5);ctx.clearRect(0,0,w,h);data.forEach((d,i)=>{const x=pad+i*g+g/2-bw,base=h-22;ctx.fillStyle=css('--success');ctx.fillRect(x,base-(h-50)*d.in/max,bw,(h-50)*d.in/max);ctx.fillStyle=css('--danger');ctx.fillRect(x+bw+2,base-(h-50)*d.out/max,bw,(h-50)*d.out/max);if(i%2===0){ctx.fillStyle=css('--muted');ctx.font='10px system-ui';ctx.fillText(d.label,x-3,h-5);}});}
function drawDonut(){
  const cv=$('doughnut'),ctx=cv.getContext('2d'),dpr=devicePixelRatio||1;cv.width=260*dpr;cv.height=260*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,260,260);
  const map={};state.products.forEach(p=>{const c=p.category||'Без категории';map[c]=(map[c]||0)+p.price*p.quantity;});const entries=Object.entries(map).sort((a,b)=>b[1]-a[1]),total=entries.reduce((s,x)=>s+x[1],0);
  if(!total){ctx.fillStyle=css('--muted');ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText('Нет данных',130,130);$('donut-legend').innerHTML='';return;}
  let angle=-Math.PI/2;entries.forEach(([name,val],i)=>{const hue=(i*67+220)%360,slice=val/total*Math.PI*2;ctx.beginPath();ctx.arc(130,130,105,angle,angle+slice);ctx.arc(130,130,65,angle+slice,angle,true);ctx.closePath();ctx.fillStyle=`hsl(${hue} 68% 55%)`;ctx.fill();angle+=slice;});
  $('donut-legend').innerHTML=entries.slice(0,10).map(([name,val],i)=>`<div><span class="legend-dot" style="--dot:hsl(${(i*67+220)%360} 48% 52%)"></span>${esc(name)} — ${Math.round(val/total*100)}% (${money(val)})</div>`).join('');
}
function openProduct(id=null){
  state.editingId=id;const p=state.products.find(x=>x.id===id);$('product-dialog-title').textContent=p?'Редактировать товар':'Новый товар';
  $('f-name').value=p?.name||'';$('f-sku').value=p?.sku||'';$('f-cat').value=p?.category||'';$('f-price').value=p?.price??0;$('f-qty').value=p?.quantity??0;$('f-min').value=p?.minQty??5;$('product-dialog').classList.add('show');
}
async function saveProduct(e){
  e.preventDefault();const payload={name:$('f-name').value.trim(),sku:$('f-sku').value.trim(),category:$('f-cat').value.trim(),price:Number($('f-price').value),quantity:Number($('f-qty').value),minQty:Number($('f-min').value)};
  try{if(state.editingId)await api(`/api/products/${state.editingId}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/products',{method:'POST',body:JSON.stringify(payload)});$('product-dialog').classList.remove('show');await refresh();toast(state.editingId?'Товар обновлён':'Товар добавлен');state.editingId=null;}catch(e){toast(e.message,true);}
}
function openMove(id,type){const p=state.products.find(x=>x.id===id);if(!p)return;state.movingId=id;state.moveType=type;$('move-title').textContent=type==='in'?'Приход товара':'Расход товара';$('move-product').textContent=`${p.name} · остаток ${p.quantity} шт.`;$('move-qty').value=1;$('move-qty').max=type==='out'?p.quantity:'';$('move-comment').value='';$('move-dialog').classList.add('show');}
async function saveMove(e){e.preventDefault();try{await api('/api/operations',{method:'POST',body:JSON.stringify({productId:state.movingId,type:state.moveType,qty:Number($('move-qty').value),comment:$('move-comment').value.trim()})});$('move-dialog').classList.remove('show');await refresh();toast('Операция проведена');}catch(e){toast(e.message,true);}}
async function deleteProduct(id){const p=state.products.find(x=>x.id===id);confirmAction('Удалить товар?',`Удалить «${p?.name}»? История операций останется в журнале.`,async()=>{try{await api(`/api/products/${id}`,{method:'DELETE'});await refresh();toast('Товар удалён');}catch(e){toast(e.message,true);}});}
async function restock(){
  const rows=[...state.restockRequests.map(r=>({key:`r-${r.id}`,request:r,product:state.products.find(p=>p.id===r.productId),qty:r.qty})),
    ...lowItems().filter(p=>!state.restockRequests.some(r=>r.productId===p.id)).map(p=>({key:`p-${p.id}`,product:p,qty:Math.max(1,p.minQty*2-p.quantity)}))].filter(r=>state.picked.has(r.key));
  if(!rows.length)return toast('Отметьте позиции для пополнения',true);
  if(rows.some(r=>!r.product))return toast('В заявке есть удалённый товар. Удалите такую заявку.',true);
  confirmAction('Принять пополнение?',`Будет проведён приход по ${rows.length} позициям.`,async()=>{
    try{for(const r of rows){await api('/api/operations',{method:'POST',body:JSON.stringify({productId:r.product.id,type:'in',qty:r.qty,comment:r.request?.note||'Пополнение по списку'})});if(r.request)await api(`/api/restock/${r.request.id}`,{method:'DELETE'});}
      state.picked.clear();await refresh();toast('Пополнение проведено');
    }catch(e){toast(e.message,true);}
  });
}
async function addRestockRequest(e){
  e.preventDefault();try{await api('/api/restock',{method:'POST',body:JSON.stringify({productId:Number($('restock-product').value),qty:Number($('restock-qty').value),note:$('restock-note').value.trim()})});$('restock-dialog').classList.remove('show');$('restock-form').reset();await refresh();toast('Позиция добавлена в список');}catch(e){toast(e.message,true);}
}
async function deleteRestockRequest(id){
  confirmAction('Убрать заявку?','Позиция будет удалена из списка пополнения.',async()=>{try{await api(`/api/restock/${id}`,{method:'DELETE'});state.picked.delete(`r-${id}`);await refresh();toast('Заявка удалена');}catch(e){toast(e.message,true);}});
}
async function loadUsers(){try{state.users=await api('/api/users');$('users-body').innerHTML=state.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select data-role="${u.id}"><option value="admin" ${u.role==='admin'?'selected':''}>Администратор</option><option value="office" ${u.role==='office'?'selected':''}>Офисный сотрудник</option><option value="user" ${u.role==='user'?'selected':''}>Пользователь</option></select></td><td>${u.active?'Активен':'Отключён'}</td><td><button class="btn-ghost btn-mini" data-active="${u.id}" data-value="${u.active?0:1}">${u.active?'Отключить':'Включить'}</button></td></tr>`).join('');}catch(e){toast(e.message,true);}}
async function loadAudit(){try{state.audit=await api('/api/audit');$('audit-body').innerHTML=state.audit.map(a=>`<tr><td>${dateFmt(a.date)}</td><td>${esc(a.userName)}</td><td>${esc(a.action)}</td><td>${esc(a.details)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Записей пока нет</td></tr>';}catch(e){toast(e.message,true);}}
async function createUser(e){e.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify({name:$('new-user-name').value.trim(),email:$('new-user-email').value.trim(),password:$('new-user-password').value,role:$('new-user-role').value})});$('user-form').reset();await loadUsers();toast('Аккаунт создан');}catch(e){toast(e.message,true);}}
async function changeUser(e){const role=e.target.closest('[data-role]');const active=e.target.closest('[data-active]');try{if(role)await api(`/api/users/${role.dataset.role}`,{method:'PATCH',body:JSON.stringify({role:role.value})});if(active)await api(`/api/users/${active.dataset.active}`,{method:'PATCH',body:JSON.stringify({active:active.dataset.value==='1'})});if(role||active){await loadUsers();toast('Пользователь обновлён');}}catch(err){toast(err.message,true);await loadUsers();}}
async function exportBackup(){try{const data=await api('/api/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stockflow-backup.json';a.click();URL.revokeObjectURL(a.href);toast('Резервная копия скачана');}catch(e){toast(e.message,true);}}
async function importBackup(file){try{const data=JSON.parse(await file.text());await api('/api/import',{method:'POST',body:JSON.stringify(data)});await refresh();toast('Резервная копия восстановлена');}catch(e){toast(e.message,true);}}
function setTheme(dark){
  document.body.classList.toggle('dark',dark);localStorage.setItem('stockflow-theme',dark?'dark':'light');
  $('btn-theme').textContent=dark?'Светлая тема':'Тёмная тема';
  if($('auth-theme'))$('auth-theme').textContent=dark?'Светлая тема':'Тёмная тема';
  requestAnimationFrame(()=>{drawSpark();drawDonut();drawBars();});
}
function bind(){
  $('login-form').addEventListener('submit',login);$('auth-switch').addEventListener('click',()=>setAuthMode(state.authMode==='login'?'register':'login'));$('auth-theme').addEventListener('click',()=>setTheme(!document.body.classList.contains('dark')));$('btn-logout').addEventListener('click',logout);
  document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.goto)));
  $('btn-add').addEventListener('click',()=>openProduct());$('btn-add-side').addEventListener('click',()=>openProduct());
  $('product-form').addEventListener('submit',saveProduct);$('move-form').addEventListener('submit',saveMove);$('btn-restock-order').addEventListener('click',restock);
  $('confirm-no').addEventListener('click',()=>$('confirm-dialog').classList.remove('show'));
  $('confirm-yes').addEventListener('click',async()=>{const fn=state.confirmAction;state.confirmAction=null;$('confirm-dialog').classList.remove('show');if(fn)await fn();});
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('.overlay').classList.remove('show')));
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('show');}));
  $('products-body').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.move)openMove(Number(b.dataset.id),b.dataset.move);if(b.dataset.edit)openProduct(Number(b.dataset.edit));if(b.dataset.delete)deleteProduct(Number(b.dataset.delete));});
  $('restock-body').addEventListener('change',e=>{if(e.target.dataset.pick){const key=e.target.dataset.pick;e.target.checked?state.picked.add(key):state.picked.delete(key);renderRestock();}});
  $('restock-body').addEventListener('click',e=>{const b=e.target.closest('[data-restock-delete]');if(b)deleteRestockRequest(Number(b.dataset.restockDelete));});
  $('btn-restock-add').addEventListener('click',()=>{$('restock-product').innerHTML=state.products.map(p=>`<option value="${p.id}">${esc(p.name)} (${esc(p.sku)})</option>`).join('');$('restock-qty').value=1;$('restock-dialog').classList.add('show');});
  $('restock-form').addEventListener('submit',addRestockRequest);
  ['search','filter-cat','only-low'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',renderProducts));
  ['search-history','filter-type'].forEach(id=>$(id).addEventListener(id==='search-history'?'input':'change',renderHistory));
  $('global-search').addEventListener('input',()=>{$('search').value=$('global-search').value;switchView('products');renderProducts();});
  document.querySelectorAll('th[data-sort]').forEach(th=>th.addEventListener('click',()=>{const key=th.dataset.sort;state.sort=state.sort.key===key?{key,dir:-state.sort.dir}:{key,dir:1};renderProducts();}));
  $('btn-theme').addEventListener('click',()=>setTheme(!document.body.classList.contains('dark')));
  $('btn-export').addEventListener('click',exportBackup);$('btn-import').addEventListener('click',()=>$('file-import').click());$('file-import').addEventListener('change',e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value='';});
  $('user-form').addEventListener('submit',createUser);$('users-body').addEventListener('change',changeUser);$('users-body').addEventListener('click',changeUser);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.show').forEach(o=>o.classList.remove('show'));if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('global-search').focus();}if(!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)&&e.key.toLowerCase()==='n'&&canWrite())openProduct();});
  window.addEventListener('resize',()=>{drawSpark();if($('view-analytics').classList.contains('active')){drawDonut();drawBars();}});
}
async function init(){
  bind();setTheme(localStorage.getItem('stockflow-theme')==='dark');
  try{const data=await api('/api/auth/me');state.user=data.user;$('auth-screen').classList.add('hidden');$('app').classList.remove('hidden');setRoleUI();await refresh();requestAnimationFrame(()=>{drawSpark();});}
  catch(_){$('auth-screen').classList.remove('hidden');$('app').classList.add('hidden');}
}
document.addEventListener('DOMContentLoaded',init);
