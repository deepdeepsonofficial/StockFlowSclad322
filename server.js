'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA, { recursive: true });
const files = Object.fromEntries(['users','products','history','audit','sessions','restock'].map(k => [k, path.join(DATA, `${k}.json`)]));
function read(key, fallback=[]) { try { return JSON.parse(fs.readFileSync(files[key], 'utf8')); } catch { return fallback; } }
function write(key, value) { const tmp=files[key]+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(value,null,2)); fs.renameSync(tmp,files[key]); }
for (const k of Object.keys(files)) if (!fs.existsSync(files[k])) write(k, []);
let users=read('users'), products=read('products'), history=read('history'), auditLog=read('audit'), sessions=read('sessions'), restockList=read('restock');
const now=()=>new Date().toISOString();
const ago=(days,hour=10,minute=0)=>{const d=new Date();d.setDate(d.getDate()-days);d.setHours(hour,minute,0,0);return d.toISOString();};
const nextId=arr=>arr.reduce((m,x)=>Math.max(m,Number(x.id)||0),0)+1;
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active});
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`; }
function verifyPassword(password,stored) { try { const [salt,hex]=stored.split(':'); const a=Buffer.from(crypto.scryptSync(password,salt,64).toString('hex'),'hex'),b=Buffer.from(hex,'hex'); return a.length===b.length&&crypto.timingSafeEqual(a,b); } catch { return false; } }

function seedIfEmpty() {
  if (!users.length) {
    const adminPassword=process.env.ADMIN_PASSWORD || 'ChangeThisPassword123!';
    users.push({id:1,name:process.env.ADMIN_NAME||'Главный администратор',email:(process.env.ADMIN_EMAIL||'admin@example.com').toLowerCase(),passwordHash:hashPassword(adminPassword),role:'admin',active:true,createdAt:now()});
    users.push({id:2,name:'Анна Смирнова',email:'anna.smirnova@example.com',passwordHash:hashPassword('Warehouse2026!'),role:'office',active:true,createdAt:ago(45)});
    users.push({id:3,name:'Илья Кузнецов',email:'ilya.kuznetsov@example.com',passwordHash:hashPassword('Warehouse2026!'),role:'user',active:true,createdAt:ago(32)});
    write('users',users);
    console.log(`Создан администратор: ${users[0].email}`);
    if (!process.env.ADMIN_PASSWORD) console.warn('Временный пароль администратора: ChangeThisPassword123! Смените его перед использованием.');
  }
  if (!products.length) {
    const seed = [
      ['Бумага офисная A4','OFF-001','Канцелярия',420,34,10],
      ['Папка-регистратор','OFF-002','Канцелярия',185,18,8],
      ['Ручка шариковая синяя','OFF-003','Канцелярия',32,120,30],
      ['Картридж лазерный HP 85A','PRN-001','Расходные материалы',3950,7,4],
      ['Мышь проводная','IT-001','Компьютерная техника',690,16,5],
      ['Клавиатура USB','IT-002','Компьютерная техника',1190,9,5],
      ['Кабель HDMI 2 м','IT-003','Компьютерная техника',450,3,6],
      ['Блокнот A5','OFF-004','Канцелярия',95,42,12],
      ['Тонер универсальный','PRN-002','Расходные материалы',2100,5,4],
      ['Скотч упаковочный','PKG-001','Упаковка',110,28,10],
      ['Коробка архивная','PKG-002','Упаковка',145,14,6],
      ['Флеш-накопитель 64 ГБ','IT-004','Компьютерная техника',790,11,5]
    ];
    products=seed.map((x,i)=>({id:i+1,name:x[0],sku:x[1],category:x[2],price:x[3],quantity:x[4],minQty:x[5],createdAt:ago(60-i),updatedAt:ago(i%8)}));
    write('products',products);
  }
  if (!history.length && products.length) {
    const events = [
      [0,'in',24,'Поставка от ООО «ОфисСнаб»',2,12],
      [2,'out',15,'Выдача в отдел продаж',1,10],
      [4,'in',8,'Поставка оборудования',4,11],
      [6,'out',2,'Выдача сотрудникам',3,9],
      [3,'out',1,'Замена картриджа',2,15],
      [1,'in',10,'Плановое пополнение',6,10],
      [7,'out',6,'Выдача в бухгалтерию',5,14],
      [9,'in',20,'Поставка упаковки',8,12],
      [5,'out',3,'Комплектация рабочих мест',9,11],
      [8,'in',4,'Поставка расходных материалов',12,10],
      [0,'out',5,'Выдача сотрудникам',14,16],
      [11,'in',6,'Поставка накопителей',17,13],
      [6,'in',10,'Пополнение запаса',19,10],
      [2,'out',12,'Выдача в отдел',22,15],
      [10,'out',3,'Архивирование документов',25,12],
      [4,'out',2,'Выдача сотрудникам',28,10]
    ];
    history=events.map((e,i)=>{const p=products[e[0]];return {id:i+1,productId:p.id,productName:p.name,type:e[1],qty:e[2],price:p.price,total:e[2]*p.price,comment:e[3],userName:e[4]===1?'Главный администратор':e[4]===2?'Анна Смирнова':'Илья Кузнецов',date:ago(e[5],e[5]%2?15:10,i*3)};});
    write('history',history);
  }
}
seedIfEmpty();

function saveAll(){for(const k of ['users','products','history','audit','sessions','restock'])write(k,({users,products,history,audit:auditLog,sessions,restock:restockList})[k]);}
function audit(user,action,details=''){auditLog.unshift({id:nextId(auditLog),userName:user.name,action,details:String(details).slice(0,500),date:now()});auditLog=auditLog.slice(0,2000);write('audit',auditLog);}
function parseCookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));}
function sessionUser(req){const token=parseCookies(req).stockflow_session;const s=sessions.find(x=>x.token===token&&x.expires>Date.now());return s?users.find(x=>x.id===s.userId&&x.active)||null:null;}
function cleanProduct(b){const p={name:String(b.name||'').trim(),sku:String(b.sku||'').trim(),category:String(b.category||'').trim(),price:Number(b.price??0),quantity:Number(b.quantity??0),minQty:Number(b.minQty??5)};if(!p.name||!p.sku)throw Error('Название и артикул обязательны');if(p.name.length>160||p.sku.length>80||p.category.length>100)throw Error('Слишком длинное поле');if(!Number.isFinite(p.price)||p.price<0||!Number.isInteger(p.quantity)||p.quantity<0||!Number.isInteger(p.minQty)||p.minQty<0)throw Error('Проверьте цену и количество');return p;}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>2_000_000)throw Error('Слишком большой запрос');}return s?JSON.parse(s):{};}
function addHistory(p,type,qty,comment,user){history.push({id:nextId(history),productId:p.id,productName:p.name,type,qty,price:p.price,total:qty*p.price,comment,userName:user.name,date:now()});write('history',history);}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname),method=req.method;
    if(pathname.startsWith('/api/')){
      let b={};if(!['GET','HEAD'].includes(method))b=await body(req);
      if(pathname==='/api/health')return send(res,200,{ok:true});
      if(pathname==='/api/auth/register'&&method==='POST'){
        const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
        if(name.length<2||name.length>80)return send(res,400,{error:'Имя должно содержать от 2 до 80 символов'});
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190)return send(res,400,{error:'Укажите корректный email'});
        if(password.length<10||password.length>200)return send(res,400,{error:'Пароль должен содержать от 10 до 200 символов'});
        if(users.some(x=>x.email===email))return send(res,409,{error:'Аккаунт с таким email уже существует'});
        const u={id:nextId(users),name,email,passwordHash:hashPassword(password),role:'user',active:true,createdAt:now()};
        users.push(u);write('users',users);audit(u,'Самостоятельная регистрация','Создан аккаунт пользователя');
        const token=crypto.randomBytes(32).toString('hex');sessions=sessions.filter(x=>x.expires>Date.now());sessions.push({token,userId:u.id,expires:Date.now()+8*60*60*1000});write('sessions',sessions);
        return send(res,201,{user:publicUser(u)},{'Set-Cookie':`stockflow_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`});
      }
      if(pathname==='/api/auth/login'&&method==='POST'){
        const email=String(b.email||'').trim().toLowerCase(),u=users.find(x=>x.email===email);
        if(!u||!u.active||!verifyPassword(String(b.password||''),u.passwordHash))return send(res,401,{error:'Неверный email или пароль'});
        const token=crypto.randomBytes(32).toString('hex');sessions=sessions.filter(x=>x.expires>Date.now());sessions.push({token,userId:u.id,expires:Date.now()+8*60*60*1000});write('sessions',sessions);
        return send(res,200,{user:publicUser(u)},{'Set-Cookie':`stockflow_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`});
      }
      if(pathname==='/api/auth/logout'&&method==='POST'){const token=parseCookies(req).stockflow_session;sessions=sessions.filter(x=>x.token!==token);write('sessions',sessions);return send(res,200,{ok:true},{'Set-Cookie':'stockflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
      const user=sessionUser(req);if(!user)return send(res,401,{error:'Требуется авторизация'});
      const admin=user.role==='admin',writer=admin||user.role==='office',denied=()=>send(res,403,{error:'Недостаточно прав'});
      if(pathname==='/api/auth/me'&&method==='GET')return send(res,200,{user:publicUser(user)});
      if(pathname==='/api/bootstrap'&&method==='GET')return send(res,200,{products:[...products].sort((a,b)=>a.name.localeCompare(b.name,'ru')),history:history.slice(-1000),user:publicUser(user)});
      if(pathname==='/api/products'&&method==='POST'){if(!writer)return denied();const p=cleanProduct(b);if(products.some(x=>x.sku.toLowerCase()===p.sku.toLowerCase()))return send(res,409,{error:'Артикул уже существует'});p.id=nextId(products);p.createdAt=p.updatedAt=now();products.push(p);if(p.quantity)addHistory(p,'in',p.quantity,'Начальный остаток',user);write('products',products);audit(user,'Добавление товара',`${p.name} (${p.sku})`);return send(res,201,{id:p.id});}
      let m=pathname.match(/^\/api\/products\/(\d+)$/);
      if(m&&method==='PUT'){if(!writer)return denied();const id=+m[1],i=products.findIndex(x=>x.id===id);if(i<0)return send(res,404,{error:'Товар не найден'});const p=cleanProduct(b);if(products.some(x=>x.id!==id&&x.sku.toLowerCase()===p.sku.toLowerCase()))return send(res,409,{error:'Артикул уже существует'});const old=products[i];products[i]={...old,...p,updatedAt:now()};const delta=p.quantity-old.quantity;if(delta)addHistory(products[i],delta>0?'in':'out',Math.abs(delta),'Корректировка остатка',user);write('products',products);audit(user,'Изменение товара',`${old.name} → ${p.name}`);return send(res,200,{ok:true});}
      if(m&&method==='DELETE'){if(!admin)return denied();const id=+m[1],p=products.find(x=>x.id===id);if(!p)return send(res,404,{error:'Товар не найден'});products=products.filter(x=>x.id!==id);write('products',products);audit(user,'Удаление товара',`${p.name} (${p.sku})`);return send(res,200,{ok:true});}
      if(pathname==='/api/operations'&&method==='POST'){if(!writer)return denied();const p=products.find(x=>x.id===Number(b.productId)),qty=Number(b.qty),type=b.type;if(!p)return send(res,404,{error:'Товар не найден'});if(!['in','out'].includes(type)||!Number.isInteger(qty)||qty<=0)return send(res,400,{error:'Некорректная операция'});if(type==='out'&&qty>p.quantity)return send(res,400,{error:`Недостаточно товара: на складе ${p.quantity} шт.`});p.quantity+=type==='in'?qty:-qty;p.updatedAt=now();write('products',products);addHistory(p,type,qty,String(b.comment||'').slice(0,250),user);audit(user,type==='in'?'Приход':'Расход',`${p.name}, ${qty} шт.`);return send(res,201,{ok:true});}
      if(pathname==='/api/restock'&&method==='GET')return send(res,200,restockList);
      if(pathname==='/api/restock'&&method==='POST'){
        if(!admin)return denied();
        const product=products.find(p=>p.id===Number(b.productId)),qty=Number(b.qty),note=String(b.note||'').trim().slice(0,200);
        if(!product)return send(res,404,{error:'Товар не найден'});
        if(!Number.isInteger(qty)||qty<1||qty>100000)return send(res,400,{error:'Количество должно быть целым числом больше нуля'});
        const item={id:nextId(restockList),productId:product.id,productName:product.name,sku:product.sku,qty,note,createdAt:now(),createdBy:user.name};
        restockList.push(item);write('restock',restockList);audit(user,'Добавление в список пополнения',`${product.name}, ${qty} шт.`);
        return send(res,201,item);
      }
      m=pathname.match(/^\/api\/restock\/(\d+)$/);
      if(m&&method==='DELETE'){if(!admin)return denied();const id=+m[1];restockList=restockList.filter(x=>x.id!==id);write('restock',restockList);audit(user,'Удаление из списка пополнения',`Заявка #${id}`);return send(res,200,{ok:true});}
      if(pathname==='/api/users'&&method==='GET'){if(!admin)return denied();return send(res,200,users.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,createdAt:u.createdAt})).reverse());}
      if(pathname==='/api/users'&&method==='POST'){if(!admin)return denied();const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),role=b.role;if(!name||!email||password.length<10||!['admin','office','user'].includes(role))return send(res,400,{error:'Укажите имя, email, пароль от 10 символов и роль'});if(users.some(u=>u.email===email))return send(res,409,{error:'Такой email уже существует'});const u={id:nextId(users),name,email,passwordHash:hashPassword(password),role,active:true,createdAt:now()};users.push(u);write('users',users);audit(user,'Создание пользователя',`${email}, роль: ${role}`);return send(res,201,{id:u.id});}
      m=pathname.match(/^\/api\/users\/(\d+)$/);if(m&&method==='PATCH'){if(!admin)return denied();const id=+m[1],u=users.find(x=>x.id===id);if(!u)return send(res,404,{error:'Пользователь не найден'});if(id===user.id&&b.active===false)return send(res,400,{error:'Нельзя отключить собственный аккаунт'});const role=b.role??u.role;if(!['admin','office','user'].includes(role))return send(res,400,{error:'Некорректная роль'});u.role=role;if(b.active!==undefined)u.active=!!b.active;write('users',users);audit(user,'Изменение пользователя',`${u.email}, роль: ${role}, active: ${u.active}`);return send(res,200,{ok:true});}
      if(pathname==='/api/audit'&&method==='GET'){if(!admin)return denied();return send(res,200,auditLog.slice(0,300));}
      if(pathname==='/api/export'&&method==='GET'){if(!admin)return denied();return send(res,200,{version:2,exportedAt:now(),products,history,restock:restockList});}
      if(pathname==='/api/import'&&method==='POST'){if(!admin)return denied();if(!Array.isArray(b.products)||!Array.isArray(b.history))return send(res,400,{error:'Неверный формат резервной копии'});const np=[];for(const raw of b.products){const p=cleanProduct(raw);if(np.some(x=>x.sku.toLowerCase()===p.sku.toLowerCase()))return send(res,400,{error:'Повторяющийся артикул'});np.push({...p,id:nextId(np),createdAt:now(),updatedAt:now()});}products=np;restockList=Array.isArray(b.restock)?b.restock.filter(x=>Number.isInteger(Number(x.productId))&&Number.isInteger(Number(x.qty))&&Number(x.qty)>0).map((x,i)=>({...x,id:i+1})):[];write('restock',restockList);history=b.history.filter(h=>['in','out'].includes(h.type)&&Number(h.qty)>0).map((h,i)=>({...h,id:i+1}));write('products',products);write('history',history);audit(user,'Импорт резервной копии',`Товаров: ${products.length}`);return send(res,200,{ok:true});}
      return send(res,404,{error:'Маршрут API не найден'});
    }
    const requested=pathname==='/'?'index.html':pathname.replace(/^\/+/,'');
    const full=path.resolve(PUBLIC,requested);
    if(!full.startsWith(PUBLIC+path.sep)&&full!==path.join(PUBLIC,'index.html'))return send(res,403,{error:'Forbidden'});
    if(!fs.existsSync(full)||!fs.statSync(full).isFile())return send(res,404,{error:'Файл не найден'});
    res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(full).pipe(res);
  } catch(e){console.error(e);if(!res.headersSent)send(res,400,{error:e.message||'Ошибка запроса'});else res.destroy();}
});
function send(res,status,obj,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj));}
server.listen(PORT,()=>console.log(`StockFlow запущен: http://localhost:${PORT}`));
