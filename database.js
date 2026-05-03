const Database = require("better-sqlite3");
const path = require("path");

class DatabaseManager {
  constructor() {
    this.db = new Database(path.join(__dirname, "database.sqlite"));
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        key_value TEXT NOT NULL UNIQUE,
        is_used INTEGER DEFAULT 0,
        order_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        message_id TEXT,
        channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `);
  }

  getDatabaseStats() {
    const products = this.db.prepare("SELECT COUNT(*) as count FROM products").get().count;
    const totalKeys = this.db.prepare("SELECT COUNT(*) as count FROM keys").get().count;
    const availableKeys = this.db.prepare("SELECT COUNT(*) as count FROM keys WHERE is_used = 0").get().count;
    const usedKeys = this.db.prepare("SELECT COUNT(*) as count FROM keys WHERE is_used = 1").get().count;
    const pendingOrders = this.db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
    const completedOrders = this.db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'completed'").get().count;

    return { products, totalKeys, availableKeys, usedKeys, pendingOrders, completedOrders };
  }

  addProduct(name, price) {
    const stmt = this.db.prepare("INSERT INTO products (name, price) VALUES (?, ?)");
    const result = stmt.run(name, price);
    return { id: result.lastInsertRowid, name, price };
  }

  getProduct(id) {
    const product = this.db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) return null;
    const stock = this.db.prepare("SELECT COUNT(*) as count FROM keys WHERE product_id = ? AND is_used = 0").get(id).count;
    return { ...product, stock };
  }

  getProducts(onlyInStock = false) {
    let query = "SELECT * FROM products";
    const products = this.db.prepare(query).all();
    
    return products.map(product => {
      const stock = this.db.prepare("SELECT COUNT(*) as count FROM keys WHERE product_id = ? AND is_used = 0").get(product.id).count;
      if (onlyInStock && stock === 0) return null;
      return { ...product, stock };
    }).filter(p => p !== null);
  }

  addKeys(productId, keys) {
    let added = 0;
    let skipped = 0;
    const stmt = this.db.prepare("INSERT INTO keys (product_id, key_value) VALUES (?, ?)");
    
    for (const key of keys) {
      try {
        stmt.run(productId, key);
        added++;
      } catch (err) {
        if (err.message.includes("UNIQUE")) skipped++;
        else throw err;
      }
    }
    
    return { added, skipped };
  }

  updateProduct(id, name, price) {
    const stmt = this.db.prepare("UPDATE products SET name = ?, price = ? WHERE id = ?");
    stmt.run(name, price, id);
  }

  deleteProduct(id) {
    const product = this.getProduct(id);
    this.db.prepare("DELETE FROM keys WHERE product_id = ?").run(id);
    this.db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return { deletedProduct: product.name };
  }

  createOrder(code, userId, productId, quantity, amount, messageId, channelId) {
    const product = this.getProduct(productId);
    const stmt = this.db.prepare(`
      INSERT INTO orders (code, user_id, product_id, product_name, quantity, amount, message_id, channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(code, userId, productId, product.name, quantity, amount, messageId, channelId);
    return { id: result.lastInsertRowid, code };
  }

  getPendingOrder(code) {
    const order = this.db.prepare(`
      SELECT o.*, p.name as product_name 
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.code = ? AND o.status = 'pending'
    `).get(code);
    return order;
  }

  reserveKeys(orderId, productId, quantity) {
    const keys = this.db.prepare(`
      SELECT id FROM keys 
      WHERE product_id = ? AND is_used = 0 
      LIMIT ?
    `).all(productId, quantity);
    
    if (keys.length < quantity) {
      throw new Error("Not enough keys available");
    }
    
    const keyIds = keys.map(k => k.id);
    const placeholders = keyIds.map(() => '?').join(',');
    this.db.prepare(`UPDATE keys SET is_used = 1, order_id = ? WHERE id IN (${placeholders})`).run(orderId, ...keyIds);
    
    return keyIds;
  }

  completeOrder(orderId) {
    const stmt = this.db.prepare(`
      UPDATE orders 
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    stmt.run(orderId);
  }

  getOrderKeys(orderId) {
    const keys = this.db.prepare(`
      SELECT key_value FROM keys WHERE order_id = ?
    `).all(orderId);
    return keys.map(k => k.key_value);
  }

  releaseKeys(orderId) {
    this.db.prepare(`UPDATE keys SET is_used = 0, order_id = NULL WHERE order_id = ?`).run(orderId);
  }

  // ============= FUNCTION CHO DASHBOARD =============
  
  getPendingOrders() {
    const stmt = this.db.prepare(`
      SELECT o.*, p.name as product_name 
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = 'pending'
      ORDER BY o.created_at DESC
    `);
    return stmt.all();
  }

  getCompletedOrders() {
    const stmt = this.db.prepare(`
      SELECT o.*, p.name as product_name 
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = 'completed'
      ORDER BY o.completed_at DESC
      LIMIT 50
    `);
    return stmt.all();
  }
}

module.exports = new DatabaseManager();