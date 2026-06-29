
### Server‑Side README (`README.md` in your backend repo)

```markdown
# ArtHub – Backend API (Express + MongoDB)

This is the **Express backend** for ArtHub. It provides all REST API endpoints for authentication, artwork management, transactions, comments, analytics, and Stripe payment processing.

## Key Features
- **User authentication** – Email/password and Google OAuth via Better Auth
- **JWT + session fallback** – Dual‑layer authorization middleware
- **Role‑based access control** – Admin, Artist, User roles with `requireRole()`
- **Ownership checks** – Users can only access their own purchases/sales (admin bypass)
- **Stripe integration** – Checkout sessions for purchases and subscriptions (webhook free)
- **Artwork CRUD** – Public browse, artist‑only create/update/delete
- **Comment system** – Purchase‑protected comments with edit/delete
- **Admin analytics** – Total users, revenue, category breakdown, sales chart
- **imgBB integration** – (handled by client, backend stores URLs)
- **Data isolation** – Ownership verification on sensitive endpoints

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express
- **Database**: MongoDB (via native driver)
- **Authentication**: Better Auth + JWT
- **Payments**: Stripe
- **Validation**: Manual (JSON body parsing)

## Project Structure
```
arthub-server/
├── index.js          # Main Express server with all routes
├── auth.js           # Better Auth configuration (dynamic imports)
├── package.json
└── .env              # Environment variables (gitignored)
```

## API Endpoints Overview

### Public
- `GET /api/artworks` – Browse/search/filter artworks
- `GET /api/artworks/:id` – Single artwork
- `GET /api/artworks/featured` – 6 latest artworks
- `GET /api/artists/top` – Top 3 artists by sales
- `GET /api/artists/:id` – Artist profile with artworks

### Protected (requireAuth)
- `POST /api/stripe/create-purchase-session` – Start artwork purchase
- `POST /api/stripe/create-subscription-session` – Start subscription
- `GET /api/stripe/session/:sessionId` – Finalize payment
- `GET /api/users/:id/purchases` – User’s purchase history (ownership)
- `GET /api/artists/:id/sales` – Artist’s sales history (ownership)
- `POST /api/artworks/:id/comments` – Add comment (purchase required)
- `PUT /api/comments/:id` – Edit own comment
- `DELETE /api/comments/:id` – Delete own comment
- `POST /api/artworks` – Add artwork (artist)
- `PUT /api/artworks/:id` – Update artwork (owner)
- `DELETE /api/artworks/:id` – Delete artwork (owner)

### Admin (requireRole('admin'))
- `GET /api/admin/stats` – Dashboard statistics
- `GET /api/admin/transactions` – All transactions (with category)
- `GET /api/admin/users` – List all users
- `PUT /api/admin/users/:id/role` – Change user role

## Getting Started
1. **Clone the repo**
   ```bash
   git clone <server-repo-url>
   cd arthub-server
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Set up environment variables**
   Create a `.env` file with:
   ```env
   MONGO_DB_URI=your-mongodb-uri
   AUTH_DB_NAME=arthub_db
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_PREMIUM_PRICE_ID=price_...
   CLIENT_URL=http://localhost:3000
   BETTER_AUTH_SECRET=your-secret
   BETTER_AUTH_URL=http://localhost:3000
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   JWT_SECRET=your-jwt-secret
   ```
4. **Start the server**
   ```bash
   node index.js
   ```
   The server will run on `http://localhost:5000`.

## Deployment
Deployed as a serverless function on Vercel. The code is exported (`module.exports = app`) and `listen` is skipped when `VERCEL=1`.

## NPM Packages (Key)
- `express`, `cors`
- `mongodb`
- `stripe`
- `jsonwebtoken`
- `better-auth`
- `dotenv`
```

You can adjust the repository URLs and any specific details as needed.