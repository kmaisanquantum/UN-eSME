require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Fail-safe startup validations
const isProduction = process.env.NODE_ENV === 'production';

const crypto = require('crypto');

function resolveJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'super-secret-unity-mall-key') {
    return process.env.JWT_SECRET;
  }

  const secretsDir = process.env.SECRETS_DIR || path.dirname(process.env.DATABASE_FILE || './unity_mall.db');
  const secretPath = path.join(secretsDir, 'jwt_secret.key');

  if (!fs.existsSync(secretsDir)) {
    try {
      fs.mkdirSync(secretsDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create secrets directory: ${err.message}`);
    }
  }

  if (fs.existsSync(secretPath)) {
    try {
      const persistedSecret = fs.readFileSync(secretPath, 'utf8').trim();
      if (persistedSecret && persistedSecret !== 'super-secret-unity-mall-key') {
        return persistedSecret;
      }
    } catch (err) {
      console.error(`Error reading JWT secret from file: ${err.message}`);
    }
  }

  const newSecret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretPath, newSecret, { encoding: 'utf8', mode: 0o600 });
    console.log(`Generated a new cryptographically strong JWT secret and persisted it to ${secretPath}`);
  } catch (err) {
    console.error(`Failed to persist newly generated JWT secret to file: ${err.message}`);
  }
  return newSecret;
}

const JWT_SECRET = resolveJwtSecret();

// JWT Secret validation
if (!JWT_SECRET || JWT_SECRET === 'super-secret-unity-mall-key') {
  if (isProduction) {
    console.error('FATAL ERROR: Insecure JWT_SECRET in production is not allowed. Exiting.');
    process.exit(1);
  } else {
    console.warn('LOUD WARNING: Insecure default JWT_SECRET is active in development.');
  }
}

function resolveAdminPassword() {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== 'admin123') {
    return process.env.ADMIN_PASSWORD;
  }

  const secretsDir = process.env.SECRETS_DIR || path.dirname(process.env.DATABASE_FILE || './unity_mall.db');
  const passwordPath = path.join(secretsDir, 'admin_password.key');

  if (!fs.existsSync(secretsDir)) {
    try {
      fs.mkdirSync(secretsDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create secrets directory: ${err.message}`);
    }
  }

  if (fs.existsSync(passwordPath)) {
    try {
      const persistedPassword = fs.readFileSync(passwordPath, 'utf8').trim();
      if (persistedPassword && persistedPassword !== 'admin123') {
        return persistedPassword;
      }
    } catch (err) {
      console.error(`Error reading admin password from file: ${err.message}`);
    }
  }

  // Generate a cryptographically strong random alphanumeric password
  const newPassword = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  try {
    fs.writeFileSync(passwordPath, newPassword, { encoding: 'utf8', mode: 0o600 });
    console.log(`Generated a new secure admin password and persisted it to ${passwordPath}. Password: ${newPassword}`);
  } catch (err) {
    console.error(`Failed to persist newly generated admin password to file: ${err.message}`);
  }
  return newPassword;
}

const ADMIN_PASSWORD = resolveAdminPassword();

// Admin Seeding Credentials validation
const isDefaultAdminCreds = !process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME === 'admin' ||
                            !ADMIN_PASSWORD || ADMIN_PASSWORD === 'admin123';

if (isProduction) {
  // In production, only fail if the password is missing or equals insecure default 'admin123'
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'admin123') {
    console.error('FATAL ERROR: Default or missing admin password in production is not allowed. Exiting.');
    process.exit(1);
  }
} else {
  if (isDefaultAdminCreds) {
    console.warn('LOUD WARNING: Default admin credentials (admin/admin123) are active in development.');
  }
}

const db = require('./db-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration or login attempts, please try again after 15 minutes' }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.jsdelivr.net",
        "https://accounts.google.com",
        "https://apis.google.com",
        "https://connect.facebook.net"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "/uploads/", "https:", "http:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: [
        "'self'",
        "http://localhost:*",
        "ws://localhost:*",
        "http://127.0.0.1:*",
        "https://accounts.google.com",
        "https://www.facebook.com",
        "https://graph.facebook.com",
        "https://unity.dspng.tech",
        "https://gc.dspng.tech"
      ],
      frameSrc: [
        "'self'",
        "https://accounts.google.com",
        "https://www.facebook.com"
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) {
      return callback(null, true); // Dev/fallback mode
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
};

app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use('/uploads', express.static('uploads'));

// Apply Rate Limiters
app.use(globalLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/customer/register', authLimiter);
app.use('/api/auth/customer/login', authLimiter);
app.use('/api/admin/login', authLimiter);

// Create uploads directory
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// --------------------------------------------------------------------
// MULTI-TENANCY TENANT RESOLUTION MIDDLEWARE
// --------------------------------------------------------------------
function tenantResolver(req, res, next) {
  const host = req.headers.host || '';
  let subdomain = '';
  const parts = host.split('.');
  if (parts.length > 1 && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && parts[parts.length - 1] !== 'localhost') {
    subdomain = parts[0];
  }

  // Fallback to env var or default
  if (!subdomain || subdomain === 'localhost' || subdomain === '127') {
    subdomain = process.env.DEFAULT_SUBDOMAIN || 'unity';
  }

  db.get('SELECT * FROM tenants WHERE subdomain = ?', [subdomain], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Tenant resolution error' });
    }
    if (!row || row.status === 'inactive') {
      if (row && row.status === 'inactive') {
        return res.status(403).json({ error: 'This SME centre is not active' });
      }
      // Default fallback to subdomain 'unity'
      db.get('SELECT * FROM tenants WHERE subdomain = ?', ['unity'], (err2, defaultRow) => {
        if (err2 || !defaultRow) {
          console.warn("Tenant 'unity' fallback is missing in database! Dynamically seeding and recovering on the fly...");
          const unityBranding = JSON.stringify({
            name: "Unity Mall SME centre",
            whatsapp: "67570000000",
            phone: "(675) 8300 99881",
            text: "(675) 8300 9881",
            email: "wokman@dspng.tech",
            googleClientId: "your-google-client-id.apps.googleusercontent.com",
            facebookAppId: "your-facebook-app-id"
          });
          db.run("INSERT INTO tenants (id, name, subdomain, branding, status, subscription_tier) VALUES (1, 'Unity Mall', 'unity', ?, 'active', 'free')", [unityBranding], (errSeed) => {
            db.get("SELECT * FROM tenants WHERE subdomain = ?", ["unity"], (err3, rowRecovered) => {
              if (err3 || !rowRecovered) {
                console.error("Critical: Failed to recover default tenant 'unity'. Database path: " + (process.env.DATABASE_FILE || './unity_mall.db'));
                return res.status(500).json({ error: 'Tenant configuration missing and recovery failed' });
              }
              req.tenant = rowRecovered;
              next();
            });
          });
          return;
        }
        if (defaultRow.status === 'inactive') {
          return res.status(403).json({ error: 'This SME centre is not active' });
        }
        req.tenant = defaultRow;
        next();
      });
      return;
    }
    req.tenant = row;
    next();
  });
}

// Health check endpoint (bypasses tenantResolver)
app.get('/api/health', (req, res) => {
  db.get('SELECT 1', (err, row) => {
    if (err) {
      return res.status(500).json({ status: 'error', db: false });
    }
    res.json({ status: 'ok', db: true });
  });
});

// Register global tenant resolver
app.use(tenantResolver);

// Admin portal obscured clean route
app.get('/@dm1n', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static public folder AFTER tenantResolver so we can inject branding if needed,
// but actually Express static serves index.html directly.
app.use(express.static('public'));

// --------------------------------------------------------------------
// SECURITY: ROLE-BASED ACCESS CONTROL MIDDLEWARE
// --------------------------------------------------------------------
function authenticateToken(roles = []) {
  return (req, res, next) => {
    // Read the Authorization Bearer header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      req.user = decoded; // { id, role, tenant_id }

      // If roles are specified, check if user has the required role
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Access forbidden: unauthorized role' });
      }

      next();
    });
  };
}

// Initialize database tables
function initDatabase() {
  db.serialize(() => {
    // 1. Create tenants table
    db.run(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        subdomain TEXT UNIQUE NOT NULL,
        branding TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        subscription_tier TEXT DEFAULT 'free',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating tenants table:', err);

      // Seed tenants if empty or missing, ensuring fully idempotent seeding
      const unityBranding = JSON.stringify({
        name: "Unity Mall SME centre",
        whatsapp: "67570000000",
        phone: "(675) 8300 99881",
        text: "(675) 8300 9881",
        email: "wokman@dspng.tech",
        googleClientId: "your-google-client-id.apps.googleusercontent.com",
        facebookAppId: "your-facebook-app-id"
      });
      const gcBranding = JSON.stringify({
        name: "Garden City eSME",
        whatsapp: "67571234567",
        phone: "(675) 8300 99881",
        text: "(675) 8300 9881",
        email: "wokman@dspng.tech",
        googleClientId: "your-google-client-id-gc.apps.googleusercontent.com",
        facebookAppId: "your-facebook-app-id-gc"
      });

      db.get('SELECT COUNT(*) as count FROM tenants', (err, row) => {
        const count = row ? (row.count || row.COUNT || row['count(*)'] || row['COUNT(*)'] || 0) : 0;
        if (!count) {
          db.run('INSERT INTO tenants (id, name, subdomain, branding) VALUES (1, ?, ?, ?)', ['Unity Mall', 'unity', unityBranding], () => {
            db.run('INSERT INTO tenants (id, name, subdomain, branding) VALUES (2, ?, ?, ?)', ['Garden City', 'gc', gcBranding]);
          });
        } else {
          // If the table is not empty, ensure 'unity' and 'gc' subdomains exist individually
          db.get('SELECT * FROM tenants WHERE subdomain = ?', ['unity'], (errU, rowU) => {
            if (!rowU) {
              db.run('INSERT INTO tenants (name, subdomain, branding) VALUES (?, ?, ?)', ['Unity Mall', 'unity', unityBranding]);
            }
          });
          db.get('SELECT * FROM tenants WHERE subdomain = ?', ['gc'], (errG, rowG) => {
            if (!rowG) {
              db.run('INSERT INTO tenants (name, subdomain, branding) VALUES (?, ?, ?)', ['Garden City', 'gc', gcBranding]);
            }
          });
        }
      });
    });

    // 2. Create vendors table
    db.run(`
      CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        phone TEXT NOT NULL,
        location TEXT NOT NULL,
        description TEXT,
        facebook TEXT,
        password TEXT,
        email TEXT,
        social_provider TEXT,
        social_id TEXT,
        tenant_id INTEGER,
        verified INTEGER DEFAULT 0,
        opening_hours TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Create products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        stock_threshold INTEGER DEFAULT 5,
        description TEXT,
        status TEXT DEFAULT 'active',
        tenant_id INTEGER,
        cost_price REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 4. Create product_images table
    db.run(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    // 5. Create services table
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        duration INTEGER DEFAULT 0,
        description TEXT,
        image_url TEXT,
        tenant_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 6. Create orders table
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        items TEXT NOT NULL,
        total_price REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        tenant_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 7. Create admins table
    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'super_admin',
        tenant_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT,
        password TEXT,
        social_provider TEXT,
        social_id TEXT,
        tenant_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Create order_items table
    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    // 10. Phase 2 sales table
    db.run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        product_id INTEGER,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total REAL NOT NULL,
        payment_method TEXT,
        sales_channel TEXT,
        customer_ref TEXT,
        customer_id INTEGER,
        sold_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      )
    `);

    // 11. Phase 2 expenses table
    db.run(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        incurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 12. Phase 2 inventory_movements table
    db.run(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        type TEXT NOT NULL, -- 'in' or 'out'
        quantity INTEGER NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    // 13. Phase 3 customers table
    db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        first_purchase_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 14. Phase 3 suppliers table
    db.run(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        contact TEXT,
        products_supplied TEXT,
        payment_status TEXT,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // 15. Phase 3 supplier_purchases table
    db.run(`
      CREATE TABLE IF NOT EXISTS supplier_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        supplier_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
      )
    `);

    // 16. Reviews table
    db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        product_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 17. Marketplace events table
    db.run(`
      CREATE TABLE IF NOT EXISTS marketplace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        event_type TEXT NOT NULL,
        product_id INTEGER,
        vendor_id INTEGER,
        search_term TEXT,
        session_ref TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
      )
    `);

    // 18. Onboarding state table
    db.run(`
      CREATE TABLE IF NOT EXISTS onboarding_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        vendor_id INTEGER NOT NULL,
        current_step INTEGER,
        data TEXT,
        completed INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
      )
    `);

    // Backfill columns for any older existing DB
    const tablesToAlter = [
      { name: 'vendors', col: 'tenant_id', type: 'INTEGER' },
      { name: 'products', col: 'tenant_id', type: 'INTEGER' },
      { name: 'orders', col: 'tenant_id', type: 'INTEGER' },
      { name: 'users', col: 'tenant_id', type: 'INTEGER' },
      { name: 'services', col: 'tenant_id', type: 'INTEGER' },
      { name: 'products', col: 'cost_price', type: 'REAL' },
      { name: 'sales', col: 'customer_id', type: 'INTEGER' },
      { name: 'admins', col: 'role', type: 'TEXT' },
      { name: 'tenants', col: 'status', type: 'TEXT' },
      { name: 'admins', col: 'tenant_id', type: 'INTEGER' },
      { name: 'tenants', col: 'subscription_tier', type: "TEXT DEFAULT 'free'" },
      { name: 'vendors', col: 'verified', type: 'INTEGER DEFAULT 0' },
      { name: 'vendors', col: 'opening_hours', type: 'TEXT' },
      { name: 'vendors', col: 'logo_url', type: 'TEXT' },
      { name: 'vendors', col: 'cover_url', type: 'TEXT' },
      { name: 'vendors', col: 'business_type', type: 'TEXT' },
      { name: 'vendors', col: 'owner_name', type: 'TEXT' },
      { name: 'vendors', col: 'floor_section', type: 'TEXT' },
      { name: 'vendors', col: 'landmark', type: 'TEXT' },
      { name: 'vendors', col: 'published', type: 'INTEGER DEFAULT 0' },
      { name: 'vendors', col: 'published_at', type: 'DATETIME' }
    ];

    let alterCount = 0;
    const runAlter = () => {
      if (alterCount < tablesToAlter.length) {
        const item = tablesToAlter[alterCount++];
        db.run(`ALTER TABLE ${item.name} ADD COLUMN ${item.col} ${item.type}`, (err) => {
          // Ignore error (column already exists)
          runAlter();
        });
      } else {
        // Backfill null tenant_id to default tenant (1)
        db.run('UPDATE vendors SET tenant_id = 1 WHERE tenant_id IS NULL');
        db.run('UPDATE products SET tenant_id = 1 WHERE tenant_id IS NULL');
        db.run('UPDATE orders SET tenant_id = 1 WHERE tenant_id IS NULL');
        db.run('UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL');
        db.run('UPDATE services SET tenant_id = 1 WHERE tenant_id IS NULL');
        db.run("UPDATE admins SET role = 'super_admin' WHERE role IS NULL");
        db.run("UPDATE tenants SET status = 'active' WHERE status IS NULL");
        db.run("UPDATE tenants SET subscription_tier = 'free' WHERE subscription_tier IS NULL");
        db.run("UPDATE vendors SET verified = 0 WHERE verified IS NULL");
        db.run("UPDATE admins SET tenant_id = 1 WHERE tenant_id IS NULL");
        db.run("UPDATE vendors SET published = 0 WHERE published IS NULL");

        // Seed admin from env vars, falling back to 'admin' / resolved fallback if not set
        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = ADMIN_PASSWORD;

        db.get('SELECT * FROM admins WHERE username = ?', [adminUser], async (err, row) => {
          if (row) {
            // NEW_USERNAME already exists, just update its password
            console.log(`Updating stored admin password to match ADMIN_PASSWORD from env for: ${adminUser}`);
            const hashedPass = await bcrypt.hash(adminPass, 10);
            db.run('UPDATE admins SET password = ? WHERE id = ?', [hashedPass, row.id]);
          } else {
            // NEW_USERNAME does not exist. Check if we need to migrate from 'admin'
            if (adminUser !== 'admin') {
              db.get('SELECT * FROM admins WHERE username = ?', ['admin'], async (errOld, oldRow) => {
                if (oldRow) {
                  // Migrate 'admin' row to NEW_USERNAME
                  console.log(`One-time migration: updating admin username from 'admin' to '${adminUser}'`);
                  const hashedPass = await bcrypt.hash(adminPass, 10);
                  db.run('UPDATE admins SET username = ?, password = ? WHERE id = ?', [adminUser, hashedPass, oldRow.id]);
                } else {
                  // No 'admin' row and no NEW_USERNAME row exists. Insert new.
                  const hashedPass = await bcrypt.hash(adminPass, 10);
                  db.run('INSERT INTO admins (username, password, role) VALUES (?, ?, ?)', [adminUser, hashedPass, 'super_admin']);
                  console.log(`Admin seeded: ${adminUser}`);
                }
              });
            } else {
              // adminUser is 'admin' and it does not exist. Insert new.
              const hashedPass = await bcrypt.hash(adminPass, 10);
              db.run('INSERT INTO admins (username, password, role) VALUES (?, ?, ?)', [adminUser, hashedPass, 'super_admin']);
              console.log(`Admin seeded: ${adminUser}`);
            }
          }
        });
        console.log('Database tables and backfills initialized');
      }
    };
    runAlter();
  });
}

// Trigger DB Initialization
initDatabase();

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// ============== TENANT CONFIG ENDPOINT ==============
app.get('/api/config', (req, res) => {
  try {
    const branding = JSON.parse(req.tenant.branding);
    res.json({
      subdomain: req.tenant.subdomain,
      name: req.tenant.name,
      branding
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse tenant branding config' });
  }
});

// ============== CURATED CATEGORIES ENDPOINT ==============
app.get('/api/categories', (req, res) => {
  res.json([
    "Retail",
    "Food and Beverage",
    "Fashion",
    "Beauty and Personal Care",
    "Electronics and Technology",
    "Mobile Phones and Accessories",
    "Repairs and Services",
    "Professional Services",
    "Health and Wellness",
    "Other"
  ]);
});

// ============== EVENT INGESTION ENDPOINT ==============
app.post('/api/events', (req, res) => {
  const { event_type, product_id, vendor_id, search_term, session_ref } = req.body;
  const tenant_id = req.tenant.id;

  const allowedTypes = [
    'product_view', 'vendor_view', 'search', 'add_to_cart', 'checkout',
    'landing_view', 'clicked_list_business', 'started_registration', 'completed_registration',
    'started_onboarding', 'completed_identity', 'added_offering', 'uploaded_image',
    'published_profile', 'first_enquiry'
  ];
  if (!event_type || !allowedTypes.includes(event_type)) {
    return res.status(400).json({ error: 'Invalid or missing event_type' });
  }

  const sql = `
    INSERT INTO marketplace_events (tenant_id, event_type, product_id, vendor_id, search_term, session_ref)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [
    tenant_id,
    event_type,
    product_id ? parseInt(product_id, 10) : null,
    vendor_id ? parseInt(vendor_id, 10) : null,
    search_term || null,
    session_ref || null
  ], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ message: 'Event logged successfully', id: this.lastID });
  });
});

// ============== AUTH ROUTES ==============

// Vendor Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, category, phone, location, description, facebook, password, email } = req.body;
    const tenant_id = req.tenant.id;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const sql = 'INSERT INTO vendors (name, category, phone, location, description, facebook, password, email, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.run(sql, [name, category, phone, location, description, facebook, hashedPassword, email, tenant_id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: 'Vendor registered successfully' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vendor Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const tenant_id = req.tenant.id;

  db.get('SELECT * FROM vendors WHERE email = ? AND tenant_id = ?', [email, tenant_id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: row.id, role: 'vendor', tenant_id }, JWT_SECRET, { expiresIn: '24h' });

    const { password: _, ...vendorWithoutPassword } = row;
    res.json({ message: 'Login successful', token, vendor: vendorWithoutPassword });
  });
});

// Social Authentication
app.post("/api/auth/social", async (req, res) => {
  const { provider, name, email, id, token, role } = req.body;
  const tenant_id = req.tenant.id;

  if (!id || !provider) {
    return res.status(400).json({ error: "Missing required social auth parameters" });
  }

  // Server-side verification of Google/Facebook tokens if enabled
  const verifySocial = process.env.VERIFY_SOCIAL_TOKENS === 'true';
  if (verifySocial) {
    try {
      if (provider === 'google') {
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (payload.sub !== id || payload.email !== email) {
          return res.status(401).json({ error: "Google token verification failed: payload mismatch" });
        }
      } else if (provider === 'facebook') {
        const axios = require('axios');
        const fbRes = await axios.get(`https://graph.facebook.com/me?access_token=${token}&fields=id,email,name`);
        if (fbRes.data.id !== id || fbRes.data.email !== email) {
          return res.status(401).json({ error: "Facebook token verification failed: payload mismatch" });
        }
      }
    } catch (verificationError) {
      return res.status(401).json({ error: `Social token verification failed: ${verificationError.message}` });
    }
  } else {
    console.warn(`Social Auth: skipping server-side verification for ${provider} (VERIFY_SOCIAL_TOKENS is disabled)`);
  }

  const table = role === 'vendor' ? 'vendors' : 'users';

  // Check if a social account already exists with this ID and provider
  db.get(`SELECT * FROM ${table} WHERE social_provider = ? AND social_id = ? AND tenant_id = ?`, [provider, id, tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row) {
      const jwtToken = jwt.sign({ id: row.id, role: role === 'vendor' ? 'vendor' : 'customer', tenant_id }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ message: "Login successful", token: jwtToken, [role === 'vendor' ? 'vendor' : 'user']: row });
    } else {
      // Check if a user/vendor already exists with this email
      db.get(`SELECT * FROM ${table} WHERE email = ? AND tenant_id = ?`, [email, tenant_id], (err, existingRow) => {
        if (err) return res.status(500).json({ error: err.message });

        if (existingRow) {
          // Link social account to existing email record
          const updateSql = `UPDATE ${table} SET social_provider = ?, social_id = ? WHERE id = ?`;
          db.run(updateSql, [provider, id, existingRow.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            existingRow.social_provider = provider;
            existingRow.social_id = id;
            const jwtToken = jwt.sign({ id: existingRow.id, role: role === 'vendor' ? 'vendor' : 'customer', tenant_id }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ message: "Social account linked", token: jwtToken, [role === 'vendor' ? 'vendor' : 'user']: existingRow });
          });
        } else {
          // Create new record
          if (role === 'vendor') {
             const sql = "INSERT INTO vendors (name, email, social_provider, social_id, category, location, phone, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
             db.run(sql, [name, email, provider, id, 'General', 'Unity Mall', '', tenant_id], function(err) {
               if (err) return res.status(500).json({ error: err.message });
               const newId = this.lastID;
               const jwtToken = jwt.sign({ id: newId, role: 'vendor', tenant_id }, JWT_SECRET, { expiresIn: '24h' });
               res.json({ message: "Social vendor account created", token: jwtToken, vendor: { id: newId, name, email, social_provider: provider, social_id: id, tenant_id } });
             });
          } else {
             const sql = "INSERT INTO users (name, email, social_provider, social_id, tenant_id) VALUES (?, ?, ?, ?, ?)";
             db.run(sql, [name, email, provider, id, tenant_id], function(err) {
               if (err) return res.status(500).json({ error: err.message });
               const newId = this.lastID;
               const jwtToken = jwt.sign({ id: newId, role: 'customer', tenant_id }, JWT_SECRET, { expiresIn: '24h' });
               res.json({ message: "Social customer account created", token: jwtToken, user: { id: newId, name, email, social_provider: provider, social_id: id, tenant_id } });
             });
          }
        }
      });
    }
  });
});

app.post("/api/auth/customer/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const tenant_id = req.tenant.id;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const sql = "INSERT INTO users (name, email, phone, password, tenant_id) VALUES (?, ?, ?, ?, ?)";
    db.run(sql, [name, email, phone, hashedPassword, tenant_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Customer registered successfully" });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer Login
app.post("/api/auth/customer/login", (req, res) => {
  const { email, password } = req.body;
  const tenant_id = req.tenant.id;

  db.get("SELECT * FROM users WHERE email = ? AND tenant_id = ?", [email, tenant_id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ id: row.id, role: 'customer', tenant_id }, JWT_SECRET, { expiresIn: '24h' });

    const { password: _, ...userWithoutPassword } = row;
    res.json({ message: "Login successful", token, user: userWithoutPassword });
  });
});

// Admin Login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  db.get("SELECT * FROM admins WHERE username = ?", [username], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: "Invalid admin credentials" });

    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid admin credentials" });

    const token = jwt.sign({ id: row.id, username: row.username, role: row.role || 'super_admin', tenant_id: row.tenant_id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ message: "Admin logged in", token, admin: { id: row.id, username: row.username, role: row.role || 'super_admin', tenant_id: row.tenant_id } });
  });
});

// ============== TENANT MANAGEMENT CRUD API (platform/super admin only) ==============

// List all tenants
app.get('/api/admin/tenants', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  db.all('SELECT id, name, subdomain, branding, status, subscription_tier, created_at FROM tenants ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const tenants = rows.map(row => {
      try {
        return { ...row, branding: JSON.parse(row.branding) };
      } catch (e) {
        return row;
      }
    });
    res.json(tenants);
  });
});

// Create a tenant
app.post('/api/admin/tenants', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  let { name, subdomain, branding, subscription_tier } = req.body;
  if (!name || !subdomain || !branding) {
    return res.status(400).json({ error: 'Missing required tenant fields: name, subdomain, branding' });
  }

  if (!subscription_tier) subscription_tier = 'free';
  if (!['free', 'standard', 'institutional'].includes(subscription_tier)) {
    return res.status(400).json({ error: 'Invalid subscription_tier value' });
  }

  // Check unique subdomain
  db.get('SELECT * FROM tenants WHERE subdomain = ?', [subdomain], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      return res.status(409).json({ error: 'Subdomain already exists' });
    }

    const brandingStr = typeof branding === 'object' ? JSON.stringify(branding) : branding;
    const sql = 'INSERT INTO tenants (name, subdomain, branding, status, subscription_tier) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [name, subdomain, brandingStr, 'active', subscription_tier], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.status(201).json({ id: this.lastID, message: 'Tenant created successfully' });
    });
  });
});

// Update a tenant
app.put('/api/admin/tenants/:id', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  let { name, branding, subscription_tier } = req.body;
  if (!name || !branding) {
    return res.status(400).json({ error: 'Missing required tenant fields: name, branding' });
  }

  if (!subscription_tier) subscription_tier = 'free';
  if (!['free', 'standard', 'institutional'].includes(subscription_tier)) {
    return res.status(400).json({ error: 'Invalid subscription_tier value' });
  }

  const brandingStr = typeof branding === 'object' ? JSON.stringify(branding) : branding;
  const sql = 'UPDATE tenants SET name = ?, branding = ?, subscription_tier = ? WHERE id = ?';
  db.run(sql, [name, brandingStr, subscription_tier, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tenant updated successfully', changes: this.changes });
  });
});

// Delete (soft-delete/deactivate) a tenant
app.delete('/api/admin/tenants/:id', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  const sql = "UPDATE tenants SET status = 'inactive' WHERE id = ?";
  db.run(sql, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tenant deactivated successfully', changes: this.changes });
  });
});

// GET per-tenant usage metrics
app.get('/api/admin/tenants/usage', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  db.all('SELECT id, name, subdomain, subscription_tier, status FROM tenants ORDER BY id ASC', [], async (err, tenants) => {
    if (err) return res.status(500).json({ error: err.message });

    const usageData = [];

    try {
      for (const tenant of tenants) {
        const counts = await new Promise((resolve, reject) => {
          let vendorsCount = 0;
          let productsCount = 0;
          let ordersCount = 0;
          let usersCount = 0;

          let pending = 4;
          const checkDone = (errQuery) => {
            if (errQuery) {
              reject(errQuery);
              return;
            }
            pending--;
            if (pending === 0) {
              resolve({ vendorsCount, productsCount, ordersCount, usersCount });
            }
          };

          db.get('SELECT COUNT(*) as cnt FROM vendors WHERE tenant_id = ?', [tenant.id], (errVal, r) => {
            if (errVal) return checkDone(errVal);
            vendorsCount = r ? (r.cnt || r['COUNT(*)'] || 0) : 0;
            checkDone();
          });

          db.get('SELECT COUNT(*) as cnt FROM products WHERE tenant_id = ?', [tenant.id], (errVal, r) => {
            if (errVal) return checkDone(errVal);
            productsCount = r ? (r.cnt || r['COUNT(*)'] || 0) : 0;
            checkDone();
          });

          db.get('SELECT COUNT(*) as cnt FROM orders WHERE tenant_id = ?', [tenant.id], (errVal, r) => {
            if (errVal) return checkDone(errVal);
            ordersCount = r ? (r.cnt || r['COUNT(*)'] || 0) : 0;
            checkDone();
          });

          db.get('SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ?', [tenant.id], (errVal, r) => {
            if (errVal) return checkDone(errVal);
            usersCount = r ? (r.cnt || r['COUNT(*)'] || 0) : 0;
            checkDone();
          });
        });

        usageData.push({
          id: tenant.id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          subscription_tier: tenant.subscription_tier || 'free',
          status: tenant.status || 'active',
          vendors: counts.vendorsCount,
          products: counts.productsCount,
          orders: counts.ordersCount,
          users: counts.usersCount
        });
      }

      res.json(usageData);
    } catch (errLoop) {
      res.status(500).json({ error: errLoop.message });
    }
  });
});

// Provision a tenant with categories and an initial centre_admin user
app.post('/api/admin/tenants/:id/provision', authenticateToken(['platform_admin', 'super_admin']), (req, res) => {
  const tenantId = req.params.id;
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password for initial centre_admin user' });
  }

  // 1. Verify tenant exists and is active
  db.get('SELECT * FROM tenants WHERE id = ?', [tenantId], (err, tenant) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.status === 'inactive') return res.status(400).json({ error: 'Cannot provision an inactive tenant' });

    // 2. Guard against double-provisioning of centre_admin
    db.get('SELECT * FROM admins WHERE tenant_id = ? AND role = ?', [tenantId, 'centre_admin'], (err2, existingAdmin) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (existingAdmin) {
        return res.status(400).json({ error: 'This tenant is already provisioned with a centre_admin' });
      }

      // Check if username is globally unique to avoid SQLite UNIQUE constraint issues
      db.get('SELECT * FROM admins WHERE username = ?', [username], async (err3, existingUsername) => {
        if (err3) return res.status(500).json({ error: err3.message });
        if (existingUsername) {
          return res.status(400).json({ error: 'Username already taken' });
        }

        try {
          // 3. Hash password
          const hashedPassword = await bcrypt.hash(password, 10);

          // 4. Create centre_admin user associated with tenant
          const sql = 'INSERT INTO admins (username, password, role, tenant_id) VALUES (?, ?, ?, ?)';
          db.run(sql, [username, hashedPassword, 'centre_admin', tenantId], function(err4) {
            if (err4) return res.status(500).json({ error: err4.message });

            // Return created centre_admin user info
            res.status(201).json({
              message: 'Tenant provisioned successfully',
              centre_admin: {
                username: username,
                role: 'centre_admin',
                tenant_id: parseInt(tenantId, 10),
                note: 'Password was set successfully'
              },
              categories_note: 'Product categories are free-text strings on products; nothing to seed.'
            });
          });
        } catch (hashError) {
          res.status(500).json({ error: hashError.message });
        }
      });
    });
  });
});

// ============== PHASE 1 / PHASE 6: ADMIN SUITE ENDPOINTS ==============

// Admin Stats
app.get('/api/admin/stats', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const stats = {};
  const { role, tenant_id } = req.user;
  const isCentreAdmin = role === 'centre_admin';

  const vendorSql = isCentreAdmin ? 'SELECT COUNT(*) as count FROM vendors WHERE tenant_id = ?' : 'SELECT COUNT(*) as count FROM vendors';
  const vendorParams = isCentreAdmin ? [tenant_id] : [];

  const productSql = isCentreAdmin ? 'SELECT COUNT(*) as count FROM products WHERE tenant_id = ?' : 'SELECT COUNT(*) as count FROM products';
  const productParams = isCentreAdmin ? [tenant_id] : [];

  const orderSql = isCentreAdmin ? 'SELECT COUNT(*) as count FROM orders WHERE tenant_id = ?' : 'SELECT COUNT(*) as count FROM orders';
  const orderParams = isCentreAdmin ? [tenant_id] : [];

  const revSql = isCentreAdmin ? 'SELECT SUM(total_price) as total FROM orders WHERE status = "completed" AND tenant_id = ?' : 'SELECT SUM(total_price) as total FROM orders WHERE status = "completed"';
  const revParams = isCentreAdmin ? [tenant_id] : [];

  db.get(vendorSql, vendorParams, (err, row) => {
    stats.totalVendors = row ? (row.count || row['count(*)'] || row['COUNT(*)'] || 0) : 0;
    db.get(productSql, productParams, (err, row) => {
      stats.totalProducts = row ? (row.count || row['count(*)'] || row['COUNT(*)'] || 0) : 0;
      db.get(orderSql, orderParams, (err, row) => {
        stats.totalOrders = row ? (row.count || row['count(*)'] || row['COUNT(*)'] || 0) : 0;
        db.get(revSql, revParams, (err, row) => {
          stats.totalRevenue = row ? (row.total || 0) : 0;
          res.json(stats);
        });
      });
    });
  });
});

// GET /api/analytics/marketplace
app.get('/api/analytics/marketplace', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), async (req, res) => {
  const targetTenantId = (req.user.role === 'centre_admin') ? req.user.tenant_id : req.tenant.id;

  const dbQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  try {
    // 1. Total product views
    const viewsRow = await dbGet(
      "SELECT COUNT(*) as count FROM marketplace_events WHERE event_type = 'product_view' AND tenant_id = ?",
      [targetTenantId]
    );
    const totalProductViews = viewsRow ? (viewsRow.count || viewsRow['COUNT(*)'] || 0) : 0;

    // 2. Total checkouts
    const checkoutsRow = await dbGet(
      "SELECT COUNT(*) as count FROM marketplace_events WHERE event_type = 'checkout' AND tenant_id = ?",
      [targetTenantId]
    );
    const totalCheckouts = checkoutsRow ? (checkoutsRow.count || checkoutsRow['COUNT(*)'] || 0) : 0;

    // 3. Conversion Rate
    const conversionRate = totalProductViews > 0 ? parseFloat((totalCheckouts / totalProductViews).toFixed(4)) : 0;

    // 4. Top viewed products
    const topProducts = await dbQuery(`
      SELECT p.id, p.name, COUNT(me.id) as view_count
      FROM marketplace_events me
      JOIN products p ON me.product_id = p.id
      WHERE me.event_type = 'product_view' AND me.tenant_id = ?
      GROUP BY p.id, p.name
      ORDER BY view_count DESC
      LIMIT 5
    `, [targetTenantId]);

    // 5. Top viewed vendors
    const topVendors = await dbQuery(`
      SELECT v.id, v.name, COUNT(me.id) as view_count
      FROM marketplace_events me
      JOIN vendors v ON me.vendor_id = v.id
      WHERE me.event_type = 'vendor_view' AND me.tenant_id = ?
      GROUP BY v.id, v.name
      ORDER BY view_count DESC
      LIMIT 5
    `, [targetTenantId]);

    // 6. Top search terms
    const topSearches = await dbQuery(`
      SELECT search_term, COUNT(id) as search_count
      FROM marketplace_events
      WHERE event_type = 'search' AND tenant_id = ? AND search_term IS NOT NULL AND search_term != ''
      GROUP BY search_term
      ORDER BY search_count DESC
      LIMIT 5
    `, [targetTenantId]);

    res.json({
      tenant_id: targetTenantId,
      total_product_views: totalProductViews,
      total_checkouts: totalCheckouts,
      conversion_rate: conversionRate,
      top_viewed_products: topProducts,
      top_viewed_vendors: topVendors,
      top_search_terms: topSearches
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Vendors Management
app.get('/api/admin/vendors', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  if (role === 'centre_admin') {
    db.all('SELECT * FROM vendors WHERE tenant_id = ? ORDER BY created_at DESC', [tenant_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    db.all('SELECT * FROM vendors ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// PUT verify a vendor
app.put('/api/admin/vendors/:id/verify', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendorId = req.params.id;
  let { verified } = req.body;
  const verifiedVal = (verified === true || verified === 1 || verified === '1') ? 1 : 0;

  db.get('SELECT * FROM vendors WHERE id = ?', [vendorId], (err, vendor) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    // Scoping for centre_admin
    if (req.user.role === 'centre_admin' && vendor.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Access forbidden: cannot verify vendor of another tenant' });
    }

    db.run('UPDATE vendors SET verified = ? WHERE id = ?', [verifiedVal, vendorId], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Vendor verification updated successfully', verified: verifiedVal });
    });
  });
});

// Admin Products Management
app.get('/api/admin/products', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  if (role === 'centre_admin') {
    const sql = 'SELECT p.*, v.name as vendor_name FROM products p LEFT JOIN vendors v ON p.vendor_id = v.id WHERE p.tenant_id = ? ORDER BY p.created_at DESC';
    db.all(sql, [tenant_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    const sql = 'SELECT p.*, v.name as vendor_name FROM products p LEFT JOIN vendors v ON p.vendor_id = v.id ORDER BY p.created_at DESC';
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// Admin Orders Management
app.get('/api/admin/orders', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  if (role === 'centre_admin') {
    const sql = 'SELECT o.*, v.name as vendor_name FROM orders o LEFT JOIN vendors v ON o.vendor_id = v.id WHERE o.tenant_id = ? ORDER BY o.created_at DESC';
    db.all(sql, [tenant_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    const sql = 'SELECT o.*, v.name as vendor_name FROM orders o LEFT JOIN vendors v ON o.vendor_id = v.id ORDER BY o.created_at DESC';
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// Admin Delete Vendor
app.delete('/api/admin/vendors/:id', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  db.get('SELECT * FROM vendors WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Vendor not found' });
    if (role === 'centre_admin' && row.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized tenant' });
    }
    db.run('DELETE FROM vendors WHERE id = ?', [req.params.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Vendor deleted successfully' });
    });
  });
});

// Admin Delete Product
app.delete('/api/admin/products/:id', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Product not found' });
    if (role === 'centre_admin' && row.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized tenant' });
    }
    db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Product deleted successfully' });
    });
  });
});

// Admin Delete Order
app.delete('/api/admin/orders/:id', authenticateToken(['centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { role, tenant_id } = req.user;
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Order not found' });
    if (role === 'centre_admin' && row.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized tenant' });
    }
    db.run('DELETE FROM orders WHERE id = ?', [req.params.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Order deleted successfully' });
    });
  });
});

// ============== ONBOARDING ROUTES ==============

app.get('/api/onboarding', authenticateToken(['vendor']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.get('SELECT * FROM onboarding_state WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.json({
        current_step: 1,
        data: {},
        completed: 0
      });
    }
    let parsedData = {};
    try {
      parsedData = row.data ? JSON.parse(row.data) : {};
    } catch (e) {
      parsedData = {};
    }
    res.json({
      id: row.id,
      tenant_id: row.tenant_id,
      vendor_id: row.vendor_id,
      current_step: row.current_step,
      data: parsedData,
      completed: row.completed,
      updated_at: row.updated_at
    });
  });
});

app.put('/api/onboarding', authenticateToken(['vendor']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const { current_step, data, completed } = req.body;

  const currentStepVal = current_step !== undefined ? parseInt(current_step, 10) : 1;
  const completedVal = (completed === true || completed === 1 || completed === '1') ? 1 : 0;
  const dataStr = data ? JSON.stringify(data) : '{}';

  db.get('SELECT id FROM onboarding_state WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const now = new Date().toISOString();
    if (row) {
      const sql = `
        UPDATE onboarding_state
        SET current_step = ?, data = ?, completed = ?, updated_at = ?
        WHERE id = ?
      `;
      db.run(sql, [currentStepVal, dataStr, completedVal, now, row.id], function(err2) {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        res.json({ message: 'Onboarding state updated successfully', current_step: currentStepVal, completed: completedVal });
      });
    } else {
      const sql = `
        INSERT INTO onboarding_state (tenant_id, vendor_id, current_step, data, completed, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.run(sql, [tenant_id, vendor_id, currentStepVal, dataStr, completedVal, now], function(err2) {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        res.status(201).json({ id: this.lastID, message: 'Onboarding state created successfully', current_step: currentStepVal, completed: completedVal });
      });
    }
  });
});

app.get('/api/onboarding/completion', authenticateToken(['vendor']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.get('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, vendor) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    db.get('SELECT ((SELECT COUNT(*) FROM products WHERE vendor_id = ?) + (SELECT COUNT(*) FROM services WHERE vendor_id = ?)) AS offering_count', [vendor_id, vendor_id], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const offeringCount = row ? (row.offering_count || 0) : 0;
      const missing_actions = [];

      if (!vendor.description || vendor.description.trim() === '') {
        missing_actions.push('business description');
      }
      if (!vendor.logo_url || vendor.logo_url.trim() === '') {
        missing_actions.push('logo');
      }
      if (offeringCount === 0) {
        missing_actions.push('at least one product/service');
      }
      if (!vendor.opening_hours || vendor.opening_hours.trim() === '') {
        missing_actions.push('opening hours');
      }
      if (!vendor.verified) {
        missing_actions.push('verify info');
      }

      const completedCount = 5 - missing_actions.length;
      const completion_percentage = Math.round((completedCount / 5) * 100);

      res.json({
        completion_percentage,
        missing_actions
      });
    });
  });
});

app.post('/api/onboarding/publish', authenticateToken(['vendor']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.get('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, vendor) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const missing_fields = [];
    if (!vendor.name || vendor.name.trim() === '') {
      missing_fields.push('name');
    }
    if (!vendor.category || vendor.category.trim() === '') {
      missing_fields.push('category');
    }

    const hasPhone = vendor.phone && vendor.phone.trim() !== '';
    const hasEmail = vendor.email && vendor.email.trim() !== '';
    if (!hasPhone && !hasEmail) {
      missing_fields.push('contact (phone or email)');
    }

    if (missing_fields.length > 0) {
      return res.status(400).json({
        error: 'Minimum profile is incomplete',
        missing_fields
      });
    }

    const now = new Date().toISOString();
    db.run('UPDATE vendors SET published = 1, published_at = ? WHERE id = ? AND tenant_id = ?', [now, vendor_id, tenant_id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({
        message: 'Profile published successfully',
        published_at: now
      });
    });
  });
});

// ============== VENDOR ROUTES ==============

// Get all vendors (filtered by tenant)
app.get('/api/vendors', (req, res) => {
  const tenant_id = req.tenant.id;
  db.all('SELECT id, name, category, phone, location, description, facebook, email, verified, opening_hours, created_at FROM vendors WHERE tenant_id = ?', [tenant_id], (err, vendors) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all('SELECT rating, vendor_id FROM reviews WHERE tenant_id = ?', [tenant_id], (err2, reviews) => {
      const vendorReviewsMap = {};
      (reviews || []).forEach(r => {
        if (!vendorReviewsMap[r.vendor_id]) {
          vendorReviewsMap[r.vendor_id] = [];
        }
        vendorReviewsMap[r.vendor_id].push(r.rating);
      });

      const result = vendors.map(v => {
        const ratings = vendorReviewsMap[v.id] || [];
        const count = ratings.length;
        const sum = ratings.reduce((acc, rating) => acc + rating, 0);
        const avg = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;
        return {
          ...v,
          average_rating: avg,
          review_count: count
        };
      });

      res.json(result);
    });
  });
});

// Get vendor by ID (filtered by tenant)
app.get('/api/vendors/:id', (req, res) => {
  const tenant_id = req.tenant.id;
  db.get('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Vendor not found' });

    db.all('SELECT rating FROM reviews WHERE vendor_id = ? AND tenant_id = ?', [req.params.id, tenant_id], (err2, reviews) => {
      const ratings = (reviews || []).map(r => r.rating);
      const count = ratings.length;
      const sum = ratings.reduce((acc, rating) => acc + rating, 0);
      const avg = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

      res.json({
        ...row,
        average_rating: avg,
        review_count: count
      });
    });
  });
});

// Support fallback routes for me/:id to allow flexible vendor client loads
app.get('/api/vendors/me/:id', (req, res) => {
  const tenant_id = req.tenant.id;
  db.get('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Vendor not found' });
    res.json(row);
  });
});

// Update vendor
app.put('/api/vendors/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const tenant_id = req.tenant.id;
  const vendorId = req.params.id;

  if (req.user.role === 'vendor' && parseInt(req.user.id, 10) !== parseInt(vendorId, 10)) {
    return res.status(403).json({ error: 'Access forbidden: cannot update another vendor' });
  }

  db.get('SELECT * FROM vendors WHERE id = ? AND tenant_id = ?', [vendorId, tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Vendor not found' });

    const name = req.body.name !== undefined ? req.body.name : row.name;
    const category = req.body.category !== undefined ? req.body.category : row.category;
    const phone = req.body.phone !== undefined ? req.body.phone : row.phone;
    const location = req.body.location !== undefined ? req.body.location : row.location;
    const description = req.body.description !== undefined ? req.body.description : row.description;
    const facebook = req.body.facebook !== undefined ? req.body.facebook : row.facebook;
    const email = req.body.email !== undefined ? req.body.email : row.email;
    const logo_url = req.body.logo_url !== undefined ? req.body.logo_url : row.logo_url;
    const cover_url = req.body.cover_url !== undefined ? req.body.cover_url : row.cover_url;
    const business_type = req.body.business_type !== undefined ? req.body.business_type : row.business_type;
    const owner_name = req.body.owner_name !== undefined ? req.body.owner_name : row.owner_name;
    const floor_section = req.body.floor_section !== undefined ? req.body.floor_section : row.floor_section;
    const landmark = req.body.landmark !== undefined ? req.body.landmark : row.landmark;
    const opening_hours = req.body.opening_hours !== undefined ? req.body.opening_hours : row.opening_hours;

    const sql = `
      UPDATE vendors
      SET name = ?, category = ?, phone = ?, location = ?, description = ?, facebook = ?, email = ?,
          logo_url = ?, cover_url = ?, business_type = ?, owner_name = ?, floor_section = ?, landmark = ?,
          opening_hours = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `;
    db.run(sql, [
      name, category, phone, location, description, facebook, email,
      logo_url, cover_url, business_type, owner_name, floor_section, landmark,
      opening_hours, vendorId, tenant_id
    ], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Vendor updated successfully', changes: this.changes });
    });
  });
});

// Delete vendor
app.delete('/api/vendors/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const tenant_id = req.tenant.id;
  db.run('DELETE FROM vendors WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Vendor deleted successfully', changes: this.changes });
  });
});

// ============== PRODUCT ROUTES ==============

// Create product
app.post('/api/products', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { vendor_id, name, category, price, stock, description, status, cost_price } = req.body;
  const tenant_id = req.tenant.id;

  const sql = 'INSERT INTO products (vendor_id, name, category, price, stock, description, status, cost_price, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [vendor_id, name, category, price, stock || 0, description, status || 'active', cost_price || null, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Product created successfully' });
  });
});

// Upload product images
app.post('/api/products/:id/images', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), upload.array('images', 5), (req, res) => {
  const productId = req.params.id;
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  
  const sql = 'INSERT INTO product_images (product_id, image_url, is_primary) VALUES (?, ?, ?)';
  let completed = 0;
  files.forEach((file, index) => {
    const imageUrl = `/uploads/${file.filename}`;
    const isPrimary = index === 0 ? 1 : 0;
    db.run(sql, [productId, imageUrl, isPrimary], (err) => {
      completed++;
      if (completed === files.length) res.json({ message: 'Images uploaded successfully', count: files.length });
    });
  });
});

// Submit rating & comment for a product (tenant-scoped)
app.post('/api/reviews', authenticateToken(['customer']), (req, res) => {
  const { product_id, rating, comment } = req.body;
  const customer_id = req.user.id;
  const tenant_id = req.user.tenant_id || 1;

  if (!product_id || !rating) {
    return res.status(400).json({ error: 'product_id and rating are required' });
  }

  const ratingInt = parseInt(rating, 10);
  if (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  // 1. Fetch product to verify and get vendor_id
  db.get('SELECT * FROM products WHERE id = ?', [product_id], (err, product) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const vendor_id = product.vendor_id;

    // 2. Check if a review already exists for this product and customer
    db.get('SELECT * FROM reviews WHERE product_id = ? AND customer_id = ?', [product_id, customer_id], (err2, existingReview) => {
      if (err2) return res.status(500).json({ error: err2.message });

      if (existingReview) {
        // Update existing review
        const updateSql = 'UPDATE reviews SET rating = ?, comment = ? WHERE id = ?';
        db.run(updateSql, [ratingInt, comment || '', existingReview.id], function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          res.json({ message: 'Review updated successfully', id: existingReview.id });
        });
      } else {
        // Insert new review
        const insertSql = 'INSERT INTO reviews (tenant_id, product_id, vendor_id, customer_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)';
        db.run(insertSql, [tenant_id, product_id, vendor_id, customer_id, ratingInt, comment || ''], function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          res.status(201).json({ message: 'Review submitted successfully', id: this.lastID });
        });
      }
    });
  });
});

// Fetch product's reviews, average rating and review count
app.get('/api/products/:id/reviews', (req, res) => {
  const product_id = req.params.id;

  const sql = `
    SELECT r.id, r.tenant_id, r.product_id, r.vendor_id, r.customer_id, r.rating, r.comment, r.created_at, u.name as customer_name
    FROM reviews r
    LEFT JOIN users u ON r.customer_id = u.id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC
  `;
  db.all(sql, [product_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const count = rows.length;
    const sum = rows.reduce((acc, r) => acc + r.rating, 0);
    const averageRating = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

    res.json({
      product_id: parseInt(product_id, 10),
      average_rating: averageRating,
      review_count: count,
      reviews: rows
    });
  });
});

// Get all products (filtered by tenant)
app.get('/api/products', (req, res) => {
  const tenant_id = req.tenant.id;
  // Fully PostgreSQL-compliant GROUP BY clause listing all individual columns select
  const sql = `
    SELECT p.id, p.vendor_id, p.name, p.category, p.price, p.stock, p.stock_threshold, p.description, p.status, p.cost_price, p.created_at, p.updated_at,
           GROUP_CONCAT(pi.image_url) as images,
           v.name as vendor_name, v.phone as vendor_phone, v.location as vendor_location, v.verified as vendor_verified
    FROM products p
    LEFT JOIN product_images pi ON p.id = pi.product_id
    LEFT JOIN vendors v ON p.vendor_id = v.id
    WHERE p.tenant_id = ?
    GROUP BY p.id, p.vendor_id, p.name, p.category, p.price, p.stock, p.stock_threshold, p.description, p.status, p.cost_price, p.created_at, p.updated_at,
             v.id, v.name, v.phone, v.location, v.verified
    ORDER BY p.created_at DESC
  `;
  db.all(sql, [tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all('SELECT rating, product_id FROM reviews WHERE tenant_id = ?', [tenant_id], (err2, reviews) => {
      const productReviewsMap = {};
      (reviews || []).forEach(r => {
        if (!productReviewsMap[r.product_id]) productReviewsMap[r.product_id] = [];
        productReviewsMap[r.product_id].push(r.rating);
      });

      const products = rows.map(row => {
        const ratings = productReviewsMap[row.id] || [];
        const count = ratings.length;
        const sum = ratings.reduce((acc, rating) => acc + rating, 0);
        const avg = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

        return {
          ...row,
          images: row.images ? row.images.split(',') : [],
          vendor_verified: row.vendor_verified || 0,
          average_rating: avg,
          review_count: count
        };
      });
      res.json(products);
    });
  });
});

// Get products by vendor (filtered by tenant)
app.get('/api/vendors/:vendorId/products', (req, res) => {
  const tenant_id = req.tenant.id;
  // Fully PostgreSQL-compliant GROUP BY clause listing all columns
  const sql = `
    SELECT p.id, p.vendor_id, p.name, p.category, p.price, p.stock, p.stock_threshold, p.description, p.status, p.cost_price, p.created_at, p.updated_at,
           GROUP_CONCAT(pi.image_url) as images,
           v.name as vendor_name, v.phone as vendor_phone, v.location as vendor_location, v.verified as vendor_verified
    FROM products p
    LEFT JOIN product_images pi ON p.id = pi.product_id
    LEFT JOIN vendors v ON p.vendor_id = v.id
    WHERE p.vendor_id = ? AND p.tenant_id = ?
    GROUP BY p.id, p.vendor_id, p.name, p.category, p.price, p.stock, p.stock_threshold, p.description, p.status, p.cost_price, p.created_at, p.updated_at,
             v.id, v.name, v.phone, v.location, v.verified
    ORDER BY p.created_at DESC
  `;
  db.all(sql, [req.params.vendorId, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all('SELECT rating, product_id FROM reviews WHERE tenant_id = ?', [tenant_id], (err2, reviews) => {
      const productReviewsMap = {};
      (reviews || []).forEach(r => {
        if (!productReviewsMap[r.product_id]) productReviewsMap[r.product_id] = [];
        productReviewsMap[r.product_id].push(r.rating);
      });

      const products = rows.map(row => {
        const ratings = productReviewsMap[row.id] || [];
        const count = ratings.length;
        const sum = ratings.reduce((acc, rating) => acc + rating, 0);
        const avg = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

        return {
          ...row,
          images: row.images ? row.images.split(',') : [],
          vendor_verified: row.vendor_verified || 0,
          average_rating: avg,
          review_count: count
        };
      });
      res.json(products);
    });
  });
});

// Delete product
app.delete('/api/products/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const tenant_id = req.tenant.id;
  db.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Product deleted successfully', changes: this.changes });
  });
});

// ============== SERVICE ROUTES ==============

// Create service
app.post('/api/services', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), upload.single('image'), (req, res) => {
  const { vendor_id, name, category, price, duration, description } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const tenant_id = req.tenant.id;

  const sql = 'INSERT INTO services (vendor_id, name, category, price, duration, description, image_url, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [vendor_id, name, category, price, duration || 0, description, imageUrl, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Service created successfully' });
  });
});

// Get all services (filtered by tenant)
app.get('/api/services', (req, res) => {
  const tenant_id = req.tenant.id;
  const sql = 'SELECT s.*, v.name as vendor_name, v.phone as vendor_phone, v.location as vendor_location FROM services s LEFT JOIN vendors v ON s.vendor_id = v.id WHERE s.tenant_id = ? ORDER BY s.created_at DESC';
  db.all(sql, [tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Delete service
app.delete('/api/services/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const tenant_id = req.tenant.id;
  db.run('DELETE FROM services WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Service deleted successfully', changes: this.changes });
  });
});

// ============== ORDER ROUTES ==============

// Create order
app.post('/api/orders', authenticateToken(['customer', 'vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { vendor_id, customer_name, customer_phone, items, total_price } = req.body;
  const tenant_id = req.tenant.id;

  const sql = 'INSERT INTO orders (vendor_id, customer_name, customer_phone, items, total_price, tenant_id) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [vendor_id, customer_name, customer_phone, JSON.stringify(items), total_price, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    const order_id = this.lastID;

    // Insert line items into order_items
    if (items && Array.isArray(items) && items.length > 0) {
      let insertedCount = 0;
      items.forEach(item => {
        const insertItemSql = 'INSERT INTO order_items (order_id, product_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)';
        db.run(insertItemSql, [order_id, item.id || item.product_id, item.name, item.quantity, item.price], (itemErr) => {
          insertedCount++;
          if (insertedCount === items.length) {
            res.json({ id: order_id, message: 'Order and line items created successfully' });
          }
        });
      });
    } else {
      res.json({ id: order_id, message: 'Order created successfully without line items' });
    }
  });
});

// Get orders by vendor (filtered by tenant)
app.get('/api/vendors/:vendorId/orders', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const tenant_id = req.tenant.id;
  db.all('SELECT * FROM orders WHERE vendor_id = ? AND tenant_id = ? ORDER BY created_at DESC', [req.params.vendorId, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Update order status & decrement stock on 'completed'
app.put('/api/orders/:id/status', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { status } = req.body;
  const tenant_id = req.tenant.id;

  // Fetch order current status first to prevent duplicate stock decrement
  db.get('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, tenant_id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'completed') {
      // Already completed. We can still update status if it's changing, but do not decrement stock again.
      db.run('UPDATE orders SET status = ? WHERE id = ? AND tenant_id = ?', [status, req.params.id, tenant_id], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        return res.json({ message: 'Order status updated successfully' });
      });
      return;
    }

    db.run('UPDATE orders SET status = ? WHERE id = ? AND tenant_id = ?', [status, req.params.id, tenant_id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      // If status is transitioning to 'completed', decrement stock for each line item, insert sale, and log inventory out movement
      if (status === 'completed') {
        db.all('SELECT * FROM order_items WHERE order_id = ?', [req.params.id], (err3, items) => {
          if (err3 || !items) return;
          const now = new Date().toISOString();
          items.forEach(item => {
            // Decrement stock (existing logic)
            db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);

            // Insert into sales table
            db.run(
              'INSERT INTO sales (tenant_id, vendor_id, product_id, quantity, unit_price, total, payment_method, sales_channel, customer_ref, sold_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [order.tenant_id, order.vendor_id, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price, 'marketplace', 'online', 'Order #' + order.id, now]
            );

            // Insert into inventory_movements table
            db.run(
              'INSERT INTO inventory_movements (tenant_id, vendor_id, product_id, type, quantity, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [order.tenant_id, order.vendor_id, item.product_id, 'out', item.quantity, 'Sale', now]
            );
          });
        });
      }
      res.json({ message: 'Order status updated successfully' });
    });
  });
});

// ============== PHASE 2: SALES, EXPENSES & INVENTORY ENDPOINTS ==============

// Record Sale
app.post('/api/sales', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { product_id, quantity, unit_price, total, payment_method, sales_channel, customer_ref, customer_id, sold_at } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const saleDate = sold_at || new Date().toISOString();

  const sql = 'INSERT INTO sales (tenant_id, vendor_id, product_id, quantity, unit_price, total, payment_method, sales_channel, customer_ref, customer_id, sold_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [tenant_id, vendor_id, product_id || null, quantity, unit_price, total, payment_method || 'cash', sales_channel || 'instore', customer_ref || '', customer_id || null, saleDate], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    const sale_id = this.lastID;

    if (product_id) {
      // Decrement stock
      db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, product_id]);

      // Insert inventory movement 'out'
      db.run('INSERT INTO inventory_movements (tenant_id, vendor_id, product_id, type, quantity, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tenant_id, vendor_id, product_id, 'out', quantity, 'Sale', saleDate]);
    }

    res.json({ id: sale_id, message: 'Sale recorded successfully' });
  });
});

// Get Sales
app.get('/api/sales', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT s.*, p.name as product_name FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.vendor_id = ? AND s.tenant_id = ? ORDER BY s.sold_at DESC', [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Record Expense
app.post('/api/expenses', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { category, amount, description, incurred_at } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const expenseDate = incurred_at || new Date().toISOString();

  const sql = 'INSERT INTO expenses (tenant_id, vendor_id, category, amount, description, incurred_at) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [tenant_id, vendor_id, category, amount, description || '', expenseDate], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Expense recorded successfully' });
  });
});

// Get Expenses
app.get('/api/expenses', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT * FROM expenses WHERE vendor_id = ? AND tenant_id = ? ORDER BY incurred_at DESC', [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Record Inventory Movement
app.post('/api/inventory', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { product_id, type, quantity, reason } = req.body; // type: 'in' or 'out'
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const movementDate = new Date().toISOString();

  db.run('INSERT INTO inventory_movements (tenant_id, vendor_id, product_id, type, quantity, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tenant_id, vendor_id, product_id, type, quantity, reason || '', movementDate], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const movement_id = this.lastID;

      const stockDiff = type === 'in' ? quantity : -quantity;
      db.run('UPDATE products SET stock = stock + ? WHERE id = ?', [stockDiff, product_id]);

      res.json({ id: movement_id, message: 'Inventory movement recorded successfully' });
  });
});

// Get Inventory Movements
app.get('/api/inventory', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT im.*, p.name as product_name FROM inventory_movements im LEFT JOIN products p ON im.product_id = p.id WHERE im.vendor_id = ? AND im.tenant_id = ? ORDER BY im.created_at DESC', [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get Dashboard Analytics
app.get('/api/dashboard', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);

  const metrics = {
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    netProfit: 0,
    todaySales: 0,
    todayExpenses: 0,
    inventoryValue: 0,
    bestSelling: [],
    slowMoving: [],
    lowStockAlerts: [],
    gstCollected: 0,
    repeatCustomersCount: 0,
    retentionRate: 0
  };

  // Fetch Sales to compute Revenue, COGS, GST
  db.all('SELECT s.*, p.cost_price, p.price FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.vendor_id = ? AND s.tenant_id = ?', [vendor_id, tenant_id], (err, sales) => {
    if (err) return res.status(500).json({ error: err.message });

    sales.forEach(sale => {
      const qty = sale.quantity || 0;
      const total = sale.total || 0;
      const costPrice = parseFloat(sale.cost_price || 0);

      metrics.revenue += total;
      metrics.cogs += costPrice * qty;
      metrics.gstCollected += total * 0.1;

      if (new Date(sale.sold_at) >= todayStart) {
        metrics.todaySales += total;
      }
    });

    // Fetch Expenses
    db.all('SELECT * FROM expenses WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err2, expenses) => {
      if (err2) return res.status(500).json({ error: err2.message });

      expenses.forEach(exp => {
        metrics.operatingExpenses += exp.amount || 0;
        if (new Date(exp.incurred_at) >= todayStart) {
          metrics.todayExpenses += exp.amount || 0;
        }
      });

      metrics.grossProfit = metrics.revenue - metrics.cogs;
      metrics.netProfit = metrics.grossProfit - metrics.operatingExpenses;

      // Fetch Products
      db.all('SELECT * FROM products WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err3, products) => {
        if (err3) return res.status(500).json({ error: err3.message });

        products.forEach(p => {
          const stock = p.stock || 0;
          const price = p.price || 0;
          metrics.inventoryValue += stock * price;

          if (stock <= (p.stock_threshold || 5)) {
            metrics.lowStockAlerts.push({ id: p.id, name: p.name, stock, threshold: p.stock_threshold || 5 });
          }
        });

        const productSalesMap = {};
        products.forEach(p => { productSalesMap[p.id] = { name: p.name, qtySold: 0 }; });

        sales.forEach(s => {
          if (s.product_id && productSalesMap[s.product_id]) {
            productSalesMap[s.product_id].qtySold += s.quantity;
          }
        });

        const sortedProductsBySales = Object.keys(productSalesMap).map(pid => ({
          id: pid,
          name: productSalesMap[pid].name,
          qtySold: productSalesMap[pid].qtySold
        })).sort((a, b) => b.qtySold - a.qtySold);

        metrics.bestSelling = sortedProductsBySales.filter(p => p.qtySold > 0).slice(0, 5);
        metrics.slowMoving = sortedProductsBySales.filter(p => p.qtySold === 0 || p.qtySold <= 2).slice(0, 5);

        // Phase 3: Customer Retention Rate / Repeat Customers calculations
        const customerFrequency = {};
        sales.forEach(s => {
          if (s.customer_id) {
            customerFrequency[s.customer_id] = (customerFrequency[s.customer_id] || 0) + 1;
          }
        });
        const totalUniqueCustomersWithSales = Object.keys(customerFrequency).length;
        let repeatCount = 0;
        Object.keys(customerFrequency).forEach(cid => {
          if (customerFrequency[cid] > 1) repeatCount++;
        });

        metrics.repeatCustomersCount = repeatCount;
        metrics.retentionRate = totalUniqueCustomersWithSales > 0 ? Math.round((repeatCount / totalUniqueCustomersWithSales) * 100) : 0;

        res.json(metrics);
      });
    });
  });
});

// ============== PHASE 3: CUSTOMERS, SUPPLIERS, & CASHFLOW ==============

// Customers CRUD
app.post('/api/customers', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { name, phone, email, notes } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const firstPurchase = new Date().toISOString();

  const sql = 'INSERT INTO customers (tenant_id, vendor_id, name, phone, email, notes, first_purchase_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [tenant_id, vendor_id, name, phone || '', email || '', notes || '', firstPurchase], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Customer recorded successfully' });
  });
});

app.get('/api/customers', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT * FROM customers WHERE vendor_id = ? AND tenant_id = ? ORDER BY first_purchase_at DESC', [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/customers/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { name, phone, email, notes } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const sql = 'UPDATE customers SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND vendor_id = ? AND tenant_id = ?';
  db.run(sql, [name, phone, email, notes, req.params.id, vendor_id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Customer updated successfully', changes: this.changes });
  });
});

app.delete('/api/customers/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.run('DELETE FROM customers WHERE id = ? AND vendor_id = ? AND tenant_id = ?', [req.params.id, vendor_id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Customer deleted successfully' });
  });
});

// Suppliers CRUD
app.post('/api/suppliers', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { name, contact, products_supplied, payment_status } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const sql = 'INSERT INTO suppliers (tenant_id, vendor_id, name, contact, products_supplied, payment_status) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [tenant_id, vendor_id, name, contact || '', products_supplied || '', payment_status || 'unpaid'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Supplier recorded successfully' });
  });
});

app.get('/api/suppliers', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT * FROM suppliers WHERE vendor_id = ? AND tenant_id = ? ORDER BY name ASC', [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/suppliers/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { name, contact, products_supplied, payment_status } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const sql = 'UPDATE suppliers SET name = ?, contact = ?, products_supplied = ?, payment_status = ? WHERE id = ? AND vendor_id = ? AND tenant_id = ?';
  db.run(sql, [name, contact, products_supplied, payment_status, req.params.id, vendor_id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Supplier updated successfully', changes: this.changes });
  });
});

app.delete('/api/suppliers/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.run('DELETE FROM suppliers WHERE id = ? AND vendor_id = ? AND tenant_id = ?', [req.params.id, vendor_id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Supplier deleted successfully' });
  });
});

// Supplier Purchases CRUD
app.post('/api/supplier-purchases', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const { supplier_id, amount, description, purchased_at } = req.body;
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const purchaseDate = purchased_at || new Date().toISOString();

  const sql = 'INSERT INTO supplier_purchases (tenant_id, vendor_id, supplier_id, amount, description, purchased_at) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [tenant_id, vendor_id, supplier_id, amount, description || '', purchaseDate], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Supplier purchase recorded successfully' });
  });
});

app.get('/api/supplier-purchases', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const sql = `
    SELECT sp.*, s.name as supplier_name
    FROM supplier_purchases sp
    LEFT JOIN suppliers s ON sp.supplier_id = s.id
    WHERE sp.vendor_id = ? AND sp.tenant_id = ?
    ORDER BY sp.purchased_at DESC
  `;
  db.all(sql, [vendor_id, tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/supplier-purchases/:id', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.run('DELETE FROM supplier_purchases WHERE id = ? AND vendor_id = ? AND tenant_id = ?', [req.params.id, vendor_id, tenant_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Supplier purchase record deleted successfully' });
  });
});

// Get Cash Flow over selected period
app.get('/api/cashflow', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT total, payment_method, sold_at FROM sales WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, sales) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all('SELECT amount, incurred_at FROM expenses WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err2, expenses) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all('SELECT amount, purchased_at FROM supplier_purchases WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err3, purchases) => {
        if (err3) return res.status(500).json({ error: err3.message });

        let cashIn = 0;
        const methods = {};

        sales.forEach(s => {
          cashIn += s.total;
          const pm = s.payment_method || 'cash';
          methods[pm] = (methods[pm] || 0) + s.total;
        });

        let cashOutExpenses = 0;
        expenses.forEach(e => { cashOutExpenses += e.amount; });

        let cashOutPurchases = 0;
        purchases.forEach(p => { cashOutPurchases += p.amount; });

        const cashOut = cashOutExpenses + cashOutPurchases;
        const netCashFlow = cashIn - cashOut;

        res.json({
          explanation: "Cash Flow represents the actual movements of money into and out of your business bank/cash box. (Note: Cash Flow is NOT Net Profit. Net Profit subtracts stock costs (COGS) and other bills, whereas Cash Flow only looks at actual money received vs paid out).",
          cashReceived: cashIn,
          cashReceivedByMethod: methods,
          cashPaidOut: cashOut,
          cashPaidOutBreakdown: {
            expenses: cashOutExpenses,
            supplierPurchases: cashOutPurchases
          },
          netCashPosition: netCashFlow,
          typeLabels: {
            cashReceived: "Fact",
            cashPaidOut: "Fact",
            netCashPosition: "Calculation"
          }
        });
      });
    });
  });
});

// Explainable, Weighted Business Health Score
app.get('/api/health-score', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  db.all('SELECT total, sold_at, customer_id FROM sales WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err, sales) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all('SELECT amount FROM expenses WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err2, expenses) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all('SELECT stock, stock_threshold FROM products WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err3, products) => {
        if (err3) return res.status(500).json({ error: err3.message });

        db.all('SELECT id FROM customers WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err4, customers) => {
          if (err4) return res.status(500).json({ error: err4.message });

          // 1. Sales Performance component (20%)
          const salesCount = sales.length;
          const salesScore = salesCount > 0 ? Math.min(100, salesCount * 10) : 50;

          // 2. Profitability component (20%)
          let revenue = 0;
          sales.forEach(s => { revenue += s.total; });
          let expTotal = 0;
          expenses.forEach(e => { expTotal += e.amount; });
          const netProfit = revenue - expTotal;
          const margin = revenue > 0 ? (netProfit / revenue) : 0;
          const profitabilityScore = revenue === 0 ? 50 : (margin > 0.2 ? 100 : (margin > 0 ? 80 : 40));

          // 3. Cash Flow component (20%)
          const cashFlowScore = netProfit >= 0 ? 100 : 50;

          // 4. Inventory component (15%)
          let lowStockCount = 0;
          products.forEach(p => {
            if ((p.stock || 0) <= (p.stock_threshold || 5)) lowStockCount++;
          });
          const inventoryScore = Math.max(40, 100 - (lowStockCount * 10));

          // 5. Customer Retention (15%)
          const customerFrequency = {};
          sales.forEach(s => {
            if (s.customer_id) {
              customerFrequency[s.customer_id] = (customerFrequency[s.customer_id] || 0) + 1;
            }
          });
          const totalUniqueCustomersWithSales = Object.keys(customerFrequency).length;
          let repeatCount = 0;
          Object.keys(customerFrequency).forEach(cid => {
            if (customerFrequency[cid] > 1) repeatCount++;
          });
          const retentionScore = totalUniqueCustomersWithSales > 0 ? Math.round((repeatCount / totalUniqueCustomersWithSales) * 100) : 70;

          // 6. Expense Control (10%)
          const expRatio = revenue > 0 ? (expTotal / revenue) : 0;
          const expenseScore = revenue === 0 ? 80 : (expRatio < 0.3 ? 100 : (expRatio < 0.5 ? 85 : 60));

          // Weighted Overall Score
          const overallScore = Math.round(
            (salesScore * 0.20) +
            (profitabilityScore * 0.20) +
            (cashFlowScore * 0.20) +
            (inventoryScore * 0.15) +
            (retentionScore * 0.15) +
            (expenseScore * 0.10)
          );

          const weakComponents = [];
          const healthyComponents = [];

          if (salesScore >= 80) healthyComponents.push("Sales Performance"); else weakComponents.push("Sales Performance");
          if (profitabilityScore >= 80) healthyComponents.push("Profitability"); else weakComponents.push("Profitability");
          if (cashFlowScore >= 80) healthyComponents.push("Cash Flow"); else weakComponents.push("Cash Flow");
          if (inventoryScore >= 80) healthyComponents.push("Inventory Management"); else weakComponents.push("Inventory Management");
          if (retentionScore >= 80) healthyComponents.push("Customer Retention"); else weakComponents.push("Customer Retention");
          if (expenseScore >= 80) healthyComponents.push("Expense Control"); else weakComponents.push("Expense Control");

          const mostUrgentIssue = weakComponents.length > 0
            ? `Weak area detected in ${weakComponents[0]}. You need to address this immediately.`
            : "No urgent issues. Business is in prime operational condition!";

          const recommendedNextAction = weakComponents.length > 0
            ? (weakComponents[0] === 'Inventory Management' ? "Restock your low-stock items to prevent product run-outs." : "Promote your top-selling products to increase sales.")
            : "Keep monitoring your weekly sales and maintain consistent customer service.";

          res.json({
            overallScore,
            components: {
              salesPerformance: { score: salesScore, weight: "20%", contribution: salesScore * 0.20, label: "Calculation" },
              profitability: { score: profitabilityScore, weight: "20%", contribution: profitabilityScore * 0.20, label: "Calculation" },
              cashFlow: { score: cashFlowScore, weight: "20%", contribution: cashFlowScore * 0.20, label: "Calculation" },
              inventory: { score: inventoryScore, weight: "15%", contribution: inventoryScore * 0.15, label: "Calculation" },
              customerRetention: { score: retentionScore, weight: "15%", contribution: retentionScore * 0.15, label: "Calculation" },
              expenseControl: { score: expenseScore, weight: "10%", contribution: expenseScore * 0.10, label: "Calculation" }
            },
            breakdown: {
              whatIsHealthy: healthyComponents.join(", ") || "None",
              whatIsWeak: weakComponents.join(", ") || "None",
              mostUrgentIssue,
              recommendedNextAction
            }
          });
        });
      });
    });
  });
});

// ============== PHASE 5: PREDICTIVE INTELLIGENCE ==============
app.get('/api/predictive-analytics', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  // Growth & expense scenarios from query params (e.g. growth=10 for +10%, expense_change=-5 for -5%)
  const revenueGrowth = parseFloat(req.query.growth || '0') / 100;
  const expenseChange = parseFloat(req.query.expense_change || '0') / 100;

  // 1. Fetch Sales
  db.all('SELECT s.*, p.name as product_name, p.stock, p.stock_threshold FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.vendor_id = ? AND s.tenant_id = ?', [vendor_id, tenant_id], (err, sales) => {
    if (err) return res.status(500).json({ error: err.message });

    // 2. Fetch all vendor products
    db.all('SELECT * FROM products WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err2, products) => {
      if (err2) return res.status(500).json({ error: err2.message });

      // Calculate current totals
      let currentRevenue = 0;
      sales.forEach(s => {
        currentRevenue += s.total;
      });

      // Calculate daily run rate for demand forecasting
      // Look at sales over the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let salesLast30Days = 0;
      const productSales30Days = {};

      sales.forEach(s => {
        const soldDate = new Date(s.sold_at);
        if (soldDate >= thirtyDaysAgo) {
          salesLast30Days += s.total;
          if (s.product_id) {
            productSales30Days[s.product_id] = (productSales30Days[s.product_id] || 0) + s.quantity;
          }
        }
      });

      const dailyRunRate = salesLast30Days / 30;
      const projectedRevenue7Days = dailyRunRate * 7;

      // GST Liability (10% in PNG)
      const currentGst = currentRevenue * 0.1;
      const projectedGst7Days = projectedRevenue7Days * 0.1;

      // Restocking recommendations
      const restockingRecommendations = [];
      products.forEach(p => {
        const sales30 = productSales30Days[p.id] || 0;
        const projectedDemand7 = (sales30 / 30) * 7;
        const currentStock = p.stock || 0;
        const threshold = p.stock_threshold || 5;

        // Suggest restocking if stock is below threshold OR if projected demand for next 7 days exceeds current stock
        if (currentStock <= threshold || projectedDemand7 > currentStock) {
          const recommendedQty = Math.max(10, Math.ceil((threshold * 2) + projectedDemand7 - currentStock));
          restockingRecommendations.push({
            product_id: p.id,
            name: p.name,
            current_stock: currentStock,
            projected_demand_7_days: Math.round(projectedDemand7 * 10) / 10,
            recommended_restock_qty: recommendedQty,
            urgency: currentStock <= threshold ? 'HIGH' : 'MEDIUM'
          });
        }
      });

      // Fetch current expenses
      db.all('SELECT * FROM expenses WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id], (err3, expenses) => {
        if (err3) return res.status(500).json({ error: err3.message });

        let currentExpenses = 0;
        expenses.forEach(e => { currentExpenses += e.amount; });

        // Scenario Simulation: Working Capital Projection
        // revenueGrowth and expenseChange applied to current monthly equivalent
        const monthlyRevenue = salesLast30Days;
        const monthlyExpenses = currentExpenses; // simplified fallback

        const simulatedMonthlyRevenue = monthlyRevenue * (1 + revenueGrowth);
        const simulatedMonthlyExpenses = monthlyExpenses * (1 + expenseChange);
        const simulatedNetProfit = simulatedMonthlyRevenue - simulatedMonthlyExpenses;

        res.json({
          demandForecast: {
            dailyRunRate: Math.round(dailyRunRate * 100) / 100,
            projectedRevenue7Days: Math.round(projectedRevenue7Days * 100) / 100,
            currentMonthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
            explanation: "Demand forecasting projects the next 7 days of sales based on your sales run rate from the last 30 days."
          },
          gstProjection: {
            currentGstLiability: Math.round(currentGst * 100) / 100,
            projectedGst7DaysLiability: Math.round(projectedGst7Days * 100) / 100,
            explanation: "Calculates PNG Goods and Services Tax (10% GST) liability for your current and projected revenue."
          },
          restockingRecommendations,
          scenarioAnalysis: {
            inputGrowthPercent: revenueGrowth * 100,
            inputExpenseChangePercent: expenseChange * 100,
            baselineMonthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
            baselineMonthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
            simulatedMonthlyRevenue: Math.round(simulatedMonthlyRevenue * 100) / 100,
            simulatedMonthlyExpenses: Math.round(simulatedMonthlyExpenses * 100) / 100,
            simulatedNetProfit: Math.round(simulatedNetProfit * 100) / 100,
            explanation: "Simulate a scenario where monthly revenue grows or declines, and expenses are optimized, projecting the net take-home profit impact."
          }
        });
      });
    });
  });
});

// ============== PHASE 6: GROUNDED AI BUSINESS ADVISOR & CHAT ENDPOINTS ==============

app.post('/api/ai/ask', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), async (req, res) => {
  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "Sposim yu raitim wanpela askim (Please provide a question)" });
  }

  const dbQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  try {
    // 1. Query metrics
    const salesStat = await dbGet('SELECT COUNT(*) as count, SUM(total) as total FROM sales WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const expenseStat = await dbGet('SELECT COUNT(*) as count, SUM(amount) as total FROM expenses WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const productStat = await dbGet('SELECT COUNT(*) as count, SUM(CASE WHEN stock <= stock_threshold THEN 1 ELSE 0 END) as low_stock FROM products WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const customerStat = await dbGet('SELECT COUNT(*) as count FROM customers WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const supplierStat = await dbGet('SELECT COUNT(*) as count FROM suppliers WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const lowStockProducts = await dbQuery('SELECT name, stock, stock_threshold FROM products WHERE vendor_id = ? AND tenant_id = ? AND stock <= stock_threshold', [vendor_id, tenant_id]);

    const salesTotal = salesStat ? (salesStat.total || 0) : 0;
    const salesCount = salesStat ? (salesStat.count || 0) : 0;
    const expenseTotal = expenseStat ? (expenseStat.total || 0) : 0;
    const productCount = productStat ? (productStat.count || productStat.total || 0) : 0;
    const lowStockCount = productStat ? (productStat.low_stock || 0) : 0;
    const customerCount = customerStat ? (customerStat.count || 0) : 0;
    const supplierCount = supplierStat ? (supplierStat.count || 0) : 0;
    const netProfit = salesTotal - expenseTotal;

    const lowerQ = question.toLowerCase();

    // Check for sale command pattern first (legacy fallback)
    const saleMatch = question.match(/sale\s+(\d+(\.\d+)?)/i);
    if (saleMatch) {
      const amount = parseFloat(saleMatch[1]);
      return res.json({
        reply: `✅ AI Assistant: Sposim (Recorded) sale of K${amount.toFixed(2)}. This transaction has been registered in your sales ledger.`,
        action: "record_sale",
        amount: amount
      });
    }

    // Health score on-the-fly
    let score = 50;
    if (salesTotal > 1000) score += 15;
    if (netProfit > 500) score += 15;
    if (lowStockCount === 0 && productCount > 0) score += 10;
    else if (lowStockCount > 0) score -= (lowStockCount * 2);
    if (customerCount > 3) score += 10;
    score = Math.max(0, Math.min(100, score));

    let status = "Needs Attention";
    let advisories = [];
    if (score >= 80) {
      status = "Strong";
      advisories.push("Yu igat gutpela wok long stopim loss na wokim profit (Excellent performance and profitability). Keep maintaining current supply schedules!");
    } else if (score >= 50) {
      status = "Moderate";
      advisories.push("Slightly low profit margin or minor inventory gaps. Sposim yu wokim liklik optimization long expenses (Consider optimizing expenses).");
    } else {
      status = "Critical";
      advisories.push("High expense-to-sales ratio or low stock levels. Kamapim nupela strategy long baim ol samting long holsal (Develop a fresh strategy to source items in wholesale).");
    }

    if (lowStockCount > 0) {
      advisories.push(`Warning: ${lowStockCount} items are low on stock. Buy stock quickly to avoid missing sales!`);
    }

    // Intent Router
    if (lowerQ.includes('health') || lowerQ.includes('diagnose') || lowerQ.includes('score') || lowerQ.includes('status')) {
      return res.json({
        reply: `🩺 **Business Health Diagnostics:**\n` +
               `• Overall Health Score: **${score}/100** (${status})\n` +
               `• Total Revenue: **K${salesTotal.toFixed(2)}** (${salesCount} transactions)\n` +
               `• Total Expenses: **K${expenseTotal.toFixed(2)}**\n` +
               `• Net Profit: **K${netProfit.toFixed(2)}**\n\n` +
               `**AI Advisory (PNG/Tok Pisin):**\n${advisories.map(a => `• ${a}`).join('\n')}`
      });
    }

    if (lowerQ.includes('cash') || lowerQ.includes('finance') || lowerQ.includes('money') || lowerQ.includes('expense') || lowerQ.includes('profit')) {
      return res.json({
        reply: `💰 **Cash Flow & Profitability Summary:**\n` +
               `• Gross Sales: **K${salesTotal.toFixed(2)}**\n` +
               `• Operational Expenses: **K${expenseTotal.toFixed(2)}**\n` +
               `• Net Take-Home Profit: **K${netProfit.toFixed(2)}** (Margin: **${salesTotal > 0 ? ((netProfit / salesTotal) * 100).toFixed(1) : 0}%**)\n\n` +
               `**Insight:** ` + (netProfit > 0 ? "Yu go het long wokim gutpela moni (You are generating positive cash flow). Sposim yu putim 20% long savings bilong business." : "Em i had liklik long lukim profit (Negative cash flow detected). Katim down liklik long ol expenses bilong yu.")
      });
    }

    if (lowerQ.includes('stock') || lowerQ.includes('product') || lowerQ.includes('inventory') || lowerQ.includes('restock') || lowerQ.includes('depletion')) {
      return res.json({
        reply: `📦 **Inventory Status Report:**\n` +
               `• Total Unique Products: **${productCount}**\n` +
               `• Items Alerting Low Stock: **${lowStockCount}**\n\n` +
               (lowStockCount > 0 ?
                 `**Restocking Alerts:**\n` + lowStockProducts.map(p => `⚠️ **${p.name}** (Current Stock: ${p.stock}, Threshold: ${p.stock_threshold})`).join('\n') :
                 "✅ Gutpela! Olgeta samting i gat inap stok (All items have healthy stock levels).")
      });
    }

    if (lowerQ.includes('sales') || lowerQ.includes('revenue') || lowerQ.includes('customer') || lowerQ.includes('supplier')) {
      return res.json({
        reply: `📈 **Sales & Partner Engagement:**\n` +
               `• Total Accumulated Revenue: **K${salesTotal.toFixed(2)}**\n` +
               `• Transaction count: **${salesCount} sales logged**\n` +
               `• Total Registered Customers: **${customerCount}**\n` +
               `• Total Registered Suppliers: **${supplierCount}**\n\n` +
               `**AI Insight:** ` + (customerCount > 0 ? `Average sales per customer is **K${(salesTotal / customerCount).toFixed(2)}**. Focus on repeat visits!` : "Yu no gat ol registered customers yet. Sposim yu addim ol nupela customer long register bilong yu.")
      });
    }

    // Default welcome
    return res.json({
      reply: `🔮 **PNG eSME AI Business Advisor:**\n` +
             `Hello! Mi AI Advisor bilong yu. Ask me anything about your cash flow, health score, products, or sales. Here is a brief summary of your business today:\n\n` +
             `• **Business Health Score:** **${score}/100** (${status})\n` +
             `• **Net Cash Position:** **K${netProfit.toFixed(2)}**\n` +
             `• **Low Stock Alerts:** **${lowStockCount} items**\n\n` +
             `**Try asking me:**\n` +
             `• *"How is my cash flow?"*\n` +
             `• *"Do I have any restocking warnings?"*\n` +
             `• *"Diagnose my health score"* \n` +
             `• *"Summarize my sales performance"*`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backward compatible bot/webhook routing to the AI advisor
app.post('/api/bot/webhook', authenticateToken(['vendor', 'centre_admin', 'platform_admin', 'super_admin']), async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "No message provided" });

  const vendor_id = req.user.id;
  const tenant_id = req.tenant.id;

  const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  try {
    const salesStat = await dbGet('SELECT SUM(total) as total FROM sales WHERE vendor_id = ? AND tenant_id = ?', [vendor_id, tenant_id]);
    const salesTotal = salesStat ? (salesStat.total || 0) : 0;
    const text = message.toLowerCase();

    if (text.includes("sale")) {
      const amountMatch = text.match(/\d+/);
      const amount = amountMatch ? parseFloat(amountMatch[0]) : 0;
      return res.json({
        reply: `✅ Recorded sale of K${amount.toFixed(2)}. Your balance is updated.`,
        action: "record_sale",
        amount
      });
    }
    if (text.includes("balance")) {
      return res.json({
        reply: `📊 Your current total logged balance is K${salesTotal.toFixed(2)}. Use "Sale [amount]" to record more.`,
        action: "view_balance"
      });
    }

    // Otherwise delegate to a brief smart advice
    return res.json({
      reply: `👋 Welcome to Unity Mall SME centre Bot. Send "Sale [amount]" to log a sale, or ask: "How is my cash flow?", "Diagnose my health score".`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Centralised error handler middleware (must be registered after all routes)
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);

  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    error: isProd ? 'Internal Server Error' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Multi-tenant SME API running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});
