const express = require('express');
const session = require('express-session');
const Database = require('./db');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database();
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin')));
CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE NOT NULL, type TEXT NOT NULL, price REAL NOT NULL, description TEXT NOT NULL, image TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, room_id INTEGER NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL, guests INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(room_id) REFERENCES rooms(id));
CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, available INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS food_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, room_id INTEGER NOT NULL, booking_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', total REAL NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(room_id) REFERENCES rooms(id), FOREIGN KEY(booking_id) REFERENCES bookings(id));
CREATE TABLE IF NOT EXISTS food_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, menu_item_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL, FOREIGN KEY(order_id) REFERENCES food_orders(id) ON DELETE CASCADE, FOREIGN KEY(menu_item_id) REFERENCES menu_items(id));
`);

function seed() {
  const hash = p => crypto.createHash('sha256').update(p).digest('hex');
  const addUser = db.prepare('INSERT OR IGNORE INTO users(name,email,password,role) VALUES(?,?,?,?)');
  addUser.run('Ujjal Hotel Admin','admin@ujjalhotel.com',hash('Admin@123'),'admin');
  addUser.run('Demo Customer','customer@ujjalhotel.com',hash('Customer@123'),'customer');
  const rooms = [
    ['101','Deluxe Room',2200,'Comfortable room with king bed, Wi-Fi, TV and attached bathroom',''],
    ['102','Deluxe Room',2200,'Spacious room with king bed and mountain-facing window',''],
    ['201','Premium Room',3200,'Premium room with balcony, breakfast and scenic view',''],
    ['202','Premium Room',3200,'Premium room with balcony and king bed',''],
    ['301','Family Suite',4800,'Large suite for families with two beds and living area',''],
    ['302','Family Suite',4800,'Large family suite with two bedrooms and lounge','']
  ];
  const addRoom = db.prepare('INSERT OR IGNORE INTO rooms(number,type,price,description,image) VALUES(?,?,?,?,?)');
  rooms.forEach(r => addRoom.run(...r));
  const menu = [
    ['Veg Thali','Main Course',180],['Chicken Biryani','Main Course',260],['Paneer Butter Masala','Main Course',220],['Fried Rice','Main Course',160],['French Fries','Snacks',120],['Chicken Momos','Snacks',170],['Masala Tea','Beverage',60],['Cold Coffee','Beverage',110],['Mineral Water','Beverage',30]
  ];
  const addMenu = db.prepare('INSERT OR IGNORE INTO menu_items(name,category,price) VALUES(?,?,?)');
  menu.forEach(m => addMenu.run(...m));
}
seed();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET || 'ujjal-hotel-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,maxAge:1000*60*60*24}}));
app.use(express.static(path.join(__dirname,'public')));

const authTokens = new Map();

function getUser(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (authTokens.has(token)) {
      return authTokens.get(token);
    }
  }
  return (req.session && req.session.user) ? req.session.user : null;
}

function auth(req,res,next){
  const user = getUser(req);
  if(!user) return res.status(401).json({error:'Please login first'});
  req.user = user;
  if (req.session) req.session.user = user;
  next();
}

function admin(req,res,next){
  const user = getUser(req);
  if(!user || user.role!=='admin') return res.status(403).json({error:'Admin access required'});
  req.user = user;
  if (req.session) req.session.user = user;
  next();
}
function validDates(a,b){ return /^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a < b; }

app.post('/api/login',(req,res)=>{
  const {email,password}=req.body; const hash=crypto.createHash('sha256').update(password||'').digest('hex');
  const user=db.prepare('SELECT id,name,email,role FROM users WHERE email=? AND password=?').get(email,hash);
  if(!user) return res.status(401).json({error:'Invalid email or password'});
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, user);
  if (req.session) req.session.user = user;
  res.json({user, token});
});
app.post('/api/register',(req,res)=>{
  const {name,email,password}=req.body;
  if(!name||!email||!password||password.length<6) return res.status(400).json({error:'Name, email and password (6+ chars) are required'});
  try {
    const hash=crypto.createHash('sha256').update(password).digest('hex');
    const info=db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,hash,'customer');
    const user={id:info.lastInsertRowid,name,email,role:'customer'};
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.set(token, user);
    if (req.session) req.session.user = user;
    res.json({user, token});
  } catch(e){ res.status(400).json({error:'Email already registered'}); }
});
app.post('/api/logout',(req,res)=>{
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authTokens.delete(authHeader.slice(7).trim());
  }
  if (req.session) {
    req.session.destroy(()=>res.json({ok:true}));
  } else {
    res.json({ok:true});
  }
});
app.get('/api/me',(req,res)=>res.json({user:getUser(req)}));

app.get('/api/rooms',(req,res)=>{
  const {checkIn,checkOut}=req.query; let rooms=db.prepare('SELECT * FROM rooms WHERE active=1 ORDER BY CAST(number AS INTEGER)').all();
  if(validDates(checkIn||'',checkOut||'')){
    rooms=rooms.map(r=>{const booking=db.prepare(`SELECT 1 FROM bookings WHERE room_id=? AND status IN ('confirmed','checked_in') AND check_in < ? AND check_out > ? LIMIT 1`).get(r.id,checkOut,checkIn); return {...r,available:!booking};});
  } else rooms=rooms.map(r=>({...r,available:true}));
  res.json({rooms});
});
app.get('/api/menu',(req,res)=>res.json({items:db.prepare('SELECT * FROM menu_items WHERE available=1 ORDER BY category,name').all()}));

app.post('/api/bookings',auth,(req,res)=>{
  const {roomId,checkIn,checkOut,guests}=req.body;
  if(!validDates(checkIn,checkOut)) return res.status(400).json({error:'Choose valid check-in and check-out dates'});
  const room=db.prepare('SELECT * FROM rooms WHERE id=? AND active=1').get(roomId); if(!room) return res.status(404).json({error:'Room not found'});
  const clash=db.prepare(`SELECT 1 FROM bookings WHERE room_id=? AND status IN ('confirmed','checked_in') AND check_in < ? AND check_out > ? LIMIT 1`).get(roomId,checkOut,checkIn);
  if(clash) return res.status(409).json({error:'Room is already booked for those dates'});
  const info=db.prepare('INSERT INTO bookings(user_id,room_id,check_in,check_out,guests) VALUES(?,?,?,?,?)').run(req.user.id,roomId,checkIn,checkOut,Math.max(1,Number(guests)||1));
  res.json({ok:true,bookingId:info.lastInsertRowid});
});
app.get('/api/my-bookings',auth,(req,res)=>res.json({bookings:db.prepare(`SELECT b.*,r.number,r.type,r.price FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.user_id=? ORDER BY b.created_at DESC`).all(req.user.id)}));

app.post('/api/orders',auth,(req,res)=>{
  const {roomId,items,note}=req.body;
  if(!roomId || !Array.isArray(items) || !items.length) return res.status(400).json({error:'Select food items and a room'});
  const booking=db.prepare(`SELECT * FROM bookings WHERE user_id=? AND room_id=? AND status IN ('confirmed','checked_in') ORDER BY check_in DESC LIMIT 1`).get(req.user.id,roomId);
  if(!booking) return res.status(400).json({error:'Food can be ordered only for one of your active booked rooms'});
  let total=0; const clean=[];
  for(const x of items){const m=db.prepare('SELECT * FROM menu_items WHERE id=? AND available=1').get(x.menuItemId); const q=Math.max(1,Number(x.quantity)||1); if(m){total+=m.price*q;clean.push({m,q});}}
  if(!clean.length) return res.status(400).json({error:'No valid food items'});
  const tx=db.transaction(()=>{const o=db.prepare('INSERT INTO food_orders(user_id,room_id,booking_id,total,note) VALUES(?,?,?,?,?)').run(req.user.id,roomId,booking.id,total,note||''); const add=db.prepare('INSERT INTO food_order_items(order_id,menu_item_id,quantity,price) VALUES(?,?,?,?)'); clean.forEach(x=>add.run(o.lastInsertRowid,x.m.id,x.q,x.m.price)); return o.lastInsertRowid;});
  res.json({ok:true,orderId:tx()});
});
app.get('/api/my-orders',auth,(req,res)=>res.json({orders:db.prepare(`SELECT o.*,r.number FROM food_orders o JOIN rooms r ON r.id=o.room_id WHERE o.user_id=? ORDER BY o.created_at DESC`).all(req.user.id)}));

app.get('/api/admin/summary',admin,(req,res)=>{
  const rooms=db.prepare('SELECT COUNT(*) c FROM rooms WHERE active=1').get().c;
  const booked=db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status IN ('confirmed','checked_in') AND check_in<=date('now') AND check_out>date('now')`).get().c;
  const pendingOrders=db.prepare(`SELECT COUNT(*) c FROM food_orders WHERE status='pending'`).get().c;
  const revenue=db.prepare(`SELECT COALESCE(SUM(total),0) s FROM food_orders WHERE status!='cancelled'`).get().s;
  res.json({rooms,booked,available:rooms-booked,pendingOrders,revenue});
});
app.get('/api/admin/bookings',admin,(req,res)=>res.json({bookings:db.prepare(`SELECT b.*,u.name,u.email,r.number,r.type FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id ORDER BY b.created_at DESC`).all()}));
app.patch('/api/admin/bookings/:id',admin,(req,res)=>{const {status}=req.body; if(!['confirmed','checked_in','checked_out','cancelled'].includes(status)) return res.status(400).json({error:'Invalid status'}); db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,req.params.id); res.json({ok:true});});
app.get('/api/admin/orders',admin,(req,res)=>{
  const orders=db.prepare(`SELECT o.*,u.name,u.email,r.number FROM food_orders o JOIN users u ON u.id=o.user_id JOIN rooms r ON r.id=o.room_id ORDER BY o.created_at DESC`).all();
  const get=db.prepare(`SELECT i.quantity,i.price,m.name FROM food_order_items i JOIN menu_items m ON m.id=i.menu_item_id WHERE i.order_id=?`); orders.forEach(o=>o.items=get.all(o.id)); res.json({orders});
});
app.patch('/api/admin/orders/:id',admin,(req,res)=>{const {status}=req.body;if(!['pending','preparing','delivered','cancelled'].includes(status))return res.status(400).json({error:'Invalid status'});db.prepare('UPDATE food_orders SET status=? WHERE id=?').run(status,req.params.id);res.json({ok:true});});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Ujjal Hotel running at http://0.0.0.0:${PORT}`));
}

module.exports = app;
