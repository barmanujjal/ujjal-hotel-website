const fs = require('fs');
const path = require('path');

function getFilePath() {
  if (process.env.VERCEL) {
    return '/tmp/ujjal_hotel_data.json';
  }
  const dir = path.join(__dirname, 'data');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'hotel_data.json');
  } catch {
    return '/tmp/ujjal_hotel_data.json';
  }
}

class Database {
  constructor() {
    this.filePath = getFilePath();
    this.data = {
      users: [],
      rooms: [],
      bookings: [],
      menu_items: [],
      food_orders: [],
      food_order_items: [],
      counters: {
        users: 0,
        rooms: 0,
        bookings: 0,
        menu_items: 0,
        food_orders: 0,
        food_order_items: 0,
      }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.users) {
          this.data = parsed;
        }
      }
    } catch {
      // Keep in-memory on error
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Ignore write errors on read-only environments
    }
  }

  pragma() {}

  exec() {}

  transaction(fn) {
    return (...args) => {
      const res = fn(...args);
      this.save();
      return res;
    };
  }

  prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();
    const self = this;

    // Users
    if (s.includes('INSERT OR IGNORE INTO users')) {
      return {
        run(name, email, password, role) {
          const exists = self.data.users.find(u => u.email === email);
          if (exists) return { lastInsertRowid: exists.id, changes: 0 };
          self.data.counters.users += 1;
          const user = { id: self.data.counters.users, name, email, password, role };
          self.data.users.push(user);
          self.save();
          return { lastInsertRowid: user.id, changes: 1 };
        }
      };
    }

    if (s.includes('INSERT INTO users(name,email,password,role)')) {
      return {
        run(name, email, password, role) {
          const exists = self.data.users.find(u => u.email === email);
          if (exists) {
            throw new Error('Email already registered');
          }
          self.data.counters.users += 1;
          const user = { id: self.data.counters.users, name, email, password, role };
          self.data.users.push(user);
          self.save();
          return { lastInsertRowid: user.id, changes: 1 };
        }
      };
    }

    if (s.includes('SELECT id,name,email,role FROM users WHERE email=? AND password=?')) {
      return {
        get(email, hash) {
          const u = self.data.users.find(x => x.email === email && x.password === hash);
          return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : undefined;
        }
      };
    }

    // Rooms
    if (s.includes('INSERT OR IGNORE INTO rooms')) {
      return {
        run(number, type, price, description, image) {
          const exists = self.data.rooms.find(r => r.number === String(number));
          if (exists) return { lastInsertRowid: exists.id, changes: 0 };
          self.data.counters.rooms += 1;
          const room = { id: self.data.counters.rooms, number: String(number), type, price: Number(price), description, image: image || '', active: 1 };
          self.data.rooms.push(room);
          self.save();
          return { lastInsertRowid: room.id, changes: 1 };
        }
      };
    }

    if (s.includes('SELECT * FROM rooms WHERE active=1 ORDER BY CAST(number AS INTEGER)')) {
      return {
        all() {
          return self.data.rooms
            .filter(r => r.active === 1)
            .sort((a, b) => Number(a.number) - Number(b.number))
            .map(r => ({ ...r }));
        }
      };
    }

    if (s.includes('SELECT * FROM rooms WHERE id=? AND active=1')) {
      return {
        get(id) {
          const r = self.data.rooms.find(x => x.id === Number(id) && x.active === 1);
          return r ? { ...r } : undefined;
        }
      };
    }

    // Menu Items
    if (s.includes('INSERT OR IGNORE INTO menu_items')) {
      return {
        run(name, category, price) {
          const exists = self.data.menu_items.find(m => m.name === name);
          if (exists) return { lastInsertRowid: exists.id, changes: 0 };
          self.data.counters.menu_items += 1;
          const item = { id: self.data.counters.menu_items, name, category, price: Number(price), available: 1 };
          self.data.menu_items.push(item);
          self.save();
          return { lastInsertRowid: item.id, changes: 1 };
        }
      };
    }

    if (s.includes('SELECT * FROM menu_items WHERE available=1 ORDER BY category,name')) {
      return {
        all() {
          return self.data.menu_items
            .filter(m => m.available === 1)
            .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
            .map(m => ({ ...m }));
        }
      };
    }

    if (s.includes('SELECT * FROM menu_items WHERE id=? AND available=1')) {
      return {
        get(id) {
          const m = self.data.menu_items.find(x => x.id === Number(id) && x.available === 1);
          return m ? { ...m } : undefined;
        }
      };
    }

    // Bookings
    if (s.includes('SELECT 1 FROM bookings WHERE room_id=?')) {
      return {
        get(roomId, checkOut, checkIn) {
          const clash = self.data.bookings.find(b =>
            b.room_id === Number(roomId) &&
            ['confirmed', 'checked_in'].includes(b.status) &&
            b.check_in < checkOut &&
            b.check_out > checkIn
          );
          return clash ? { 1: 1 } : undefined;
        }
      };
    }

    if (s.includes('INSERT INTO bookings(user_id,room_id,check_in,check_out,guests)')) {
      return {
        run(userId, roomId, checkIn, checkOut, guests) {
          self.data.counters.bookings += 1;
          const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
          const booking = {
            id: self.data.counters.bookings,
            user_id: Number(userId),
            room_id: Number(roomId),
            check_in: checkIn,
            check_out: checkOut,
            guests: Number(guests) || 1,
            status: 'confirmed',
            created_at: now
          };
          self.data.bookings.push(booking);
          self.save();
          return { lastInsertRowid: booking.id, changes: 1 };
        }
      };
    }

    if (s.includes('SELECT b.*,r.number,r.type,r.price FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.user_id=?')) {
      return {
        all(userId) {
          return self.data.bookings
            .filter(b => b.user_id === Number(userId))
            .map(b => {
              const r = self.data.rooms.find(x => x.id === b.room_id) || {};
              return {
                ...b,
                number: r.number || '',
                type: r.type || '',
                price: r.price || 0
              };
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
        }
      };
    }

    if (s.includes('SELECT * FROM bookings WHERE user_id=? AND room_id=?')) {
      return {
        get(userId, roomId) {
          const list = self.data.bookings
            .filter(b =>
              b.user_id === Number(userId) &&
              b.room_id === Number(roomId) &&
              ['confirmed', 'checked_in'].includes(b.status)
            )
            .sort((a, b) => b.check_in.localeCompare(a.check_in));
          return list[0] ? { ...list[0] } : undefined;
        }
      };
    }

    if (s.includes('SELECT COUNT(*) c FROM bookings WHERE status IN (\'confirmed\',\'checked_in\')')) {
      return {
        get() {
          const today = new Date().toISOString().slice(0, 10);
          const count = self.data.bookings.filter(b =>
            ['confirmed', 'checked_in'].includes(b.status) &&
            b.check_in <= today &&
            b.check_out > today
          ).length;
          return { c: count };
        }
      };
    }

    if (s.includes('SELECT b.*,u.name,u.email,r.number,r.type FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id ORDER BY b.created_at DESC')) {
      return {
        all() {
          return self.data.bookings
            .map(b => {
              const u = self.data.users.find(x => x.id === b.user_id) || {};
              const r = self.data.rooms.find(x => x.id === b.room_id) || {};
              return {
                ...b,
                name: u.name || '',
                email: u.email || '',
                number: r.number || '',
                type: r.type || ''
              };
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
        }
      };
    }

    if (s.includes('UPDATE bookings SET status=? WHERE id=?')) {
      return {
        run(status, id) {
          const b = self.data.bookings.find(x => x.id === Number(id));
          if (b) {
            b.status = status;
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };
    }

    // Food Orders
    if (s.includes('INSERT INTO food_orders(user_id,room_id,booking_id,total,note)')) {
      return {
        run(userId, roomId, bookingId, total, note) {
          self.data.counters.food_orders += 1;
          const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
          const order = {
            id: self.data.counters.food_orders,
            user_id: Number(userId),
            room_id: Number(roomId),
            booking_id: bookingId ? Number(bookingId) : null,
            status: 'pending',
            total: Number(total),
            note: note || '',
            created_at: now
          };
          self.data.food_orders.push(order);
          self.save();
          return { lastInsertRowid: order.id, changes: 1 };
        }
      };
    }

    if (s.includes('INSERT INTO food_order_items(order_id,menu_item_id,quantity,price)')) {
      return {
        run(orderId, menuItemId, quantity, price) {
          self.data.counters.food_order_items += 1;
          const item = {
            id: self.data.counters.food_order_items,
            order_id: Number(orderId),
            menu_item_id: Number(menuItemId),
            quantity: Number(quantity),
            price: Number(price)
          };
          self.data.food_order_items.push(item);
          self.save();
          return { lastInsertRowid: item.id, changes: 1 };
        }
      };
    }

    if (s.includes('SELECT o.*,r.number FROM food_orders o JOIN rooms r ON r.id=o.room_id WHERE o.user_id=?')) {
      return {
        all(userId) {
          return self.data.food_orders
            .filter(o => o.user_id === Number(userId))
            .map(o => {
              const r = self.data.rooms.find(x => x.id === o.room_id) || {};
              return { ...o, number: r.number || '' };
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
        }
      };
    }

    if (s.includes('SELECT COUNT(*) c FROM rooms WHERE active=1')) {
      return {
        get() {
          return { c: self.data.rooms.filter(r => r.active === 1).length };
        }
      };
    }

    if (s.includes('SELECT COUNT(*) c FROM food_orders WHERE status=\'pending\'')) {
      return {
        get() {
          return { c: self.data.food_orders.filter(o => o.status === 'pending').length };
        }
      };
    }

    if (s.includes('SELECT COALESCE(SUM(total),0) s FROM food_orders WHERE status!=\'cancelled\'')) {
      return {
        get() {
          const sum = self.data.food_orders
            .filter(o => o.status !== 'cancelled')
            .reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);
          return { s: sum };
        }
      };
    }

    if (s.includes('SELECT o.*,u.name,u.email,r.number FROM food_orders o JOIN users u ON u.id=o.user_id JOIN rooms r ON r.id=o.room_id ORDER BY o.created_at DESC')) {
      return {
        all() {
          return self.data.food_orders
            .map(o => {
              const u = self.data.users.find(x => x.id === o.user_id) || {};
              const r = self.data.rooms.find(x => x.id === o.room_id) || {};
              return {
                ...o,
                name: u.name || '',
                email: u.email || '',
                number: r.number || ''
              };
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
        }
      };
    }

    if (s.includes('SELECT i.quantity,i.price,m.name FROM food_order_items i JOIN menu_items m ON m.id=i.menu_item_id WHERE i.order_id=?')) {
      return {
        all(orderId) {
          return self.data.food_order_items
            .filter(i => i.order_id === Number(orderId))
            .map(i => {
              const m = self.data.menu_items.find(x => x.id === i.menu_item_id) || {};
              return {
                quantity: i.quantity,
                price: i.price,
                name: m.name || ''
              };
            });
        }
      };
    }

    if (s.includes('UPDATE food_orders SET status=? WHERE id=?')) {
      return {
        run(status, id) {
          const o = self.data.food_orders.find(x => x.id === Number(id));
          if (o) {
            o.status = status;
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        }
      };
    }

    // Default fallback
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => []
    };
  }
}

module.exports = Database;
