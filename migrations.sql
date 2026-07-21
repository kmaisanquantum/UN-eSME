-- Migration SQL script for UN-eSME Multi-Tenant platform

-- 1. Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(255) UNIQUE NOT NULL,
  branding TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default tenants if they do not exist
INSERT INTO tenants (id, name, subdomain, branding) VALUES
(1, 'Unity Mall', 'unity', '{"name":"Unity Mall SME centre","whatsapp":"67570000000","phone":"(675) 8300 99881","text":"(675) 8300 9881","email":"wokman@dspng.tech","googleClientId":"your-google-client-id.apps.googleusercontent.com","facebookAppId":"your-facebook-app-id"}'),
(2, 'Garden City', 'gc', '{"name":"Garden City eSME","whatsapp":"67571234567","phone":"(675) 8300 99881","text":"(675) 8300 9881","email":"wokman@dspng.tech","googleClientId":"your-google-client-id-gc.apps.googleusercontent.com","facebookAppId":"your-facebook-app-id-gc"}')
ON CONFLICT (subdomain) DO NOTHING;

-- 2. Add tenant_id and other fields to existing tables
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
ALTER TABLE services ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;

-- Add cost_price to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC;

-- 3. Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Backfill any null tenant_ids to default tenant (1)
UPDATE vendors SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE products SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE orders SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE services SET tenant_id = 1 WHERE tenant_id IS NULL;
