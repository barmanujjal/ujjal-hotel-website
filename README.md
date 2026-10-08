# Ujjal Hotel — Booking & Room Service Website

A complete starter hotel management website for a freelancing project.

## Features
- Customer registration/login
- Admin login
- Room list and date-based availability
- Customer room booking
- Customer's booking data
- In-room food menu and ordering for an active booked room
- Admin dashboard: current occupancy, available rooms, food revenue
- Admin sees every booking with customer, room and dates
- Admin sees every food order with customer, room and ordered items
- Admin can update booking status and food order status
- SQLite database is created and seeded automatically

## Demo accounts
Admin: `admin@ujjalhotel.com` / `Admin@123`
Customer: `customer@ujjalhotel.com` / `Customer@123`

## Run locally
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

The database is stored at `data/hotel.db` and is created automatically on first start.

## Important before delivering to a client
Change the demo passwords and `SESSION_SECRET`. For production, use HTTPS, a proper production session store, stronger password hashing such as bcrypt/argon2, server-side validation, backups, and a real deployment database.
