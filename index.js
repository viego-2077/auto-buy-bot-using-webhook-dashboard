const express = require("express");
const path = require("path");
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const db = require("./database");

const app = express();

// Middleware to handle browser preflight requests for PUT/DELETE
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Password');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 9023;
const OWNER_ID = process.env.OWNER_ID;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const processed = new Set();

function generateCode() {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
}

function createQR(code, amount) {
  return `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.ACCOUNT_NO}-compact2.png`
    + `?amount=${amount}`
    + `&addInfo=${encodeURIComponent(code)}`
    + `&accountName=${encodeURIComponent(process.env.ACCOUNT_NAME)}`;
}

function extractCode(data) {
  if (data.code) return data.code;
  if (!data.content) return null;
  const content = data.content.toUpperCase();
  if (content.includes("-")) {
    const parts = content.split("-");
    return parts[parts.length - 1].trim();
  }
  const matches = content.match(/[A-Z0-9]{6,20}/g);
  return matches ? matches[matches.length - 1] : null;
}

client.once("ready", () => {
  console.log(`Bot logged in: ${client.user.tag}`);
  
  const stats = db.getDatabaseStats();
  console.log("Database stats:", stats);
  
  const products = db.getProducts(true);
  console.log(`Available products: ${products.length}`);
  products.forEach(p => console.log(`  - ${p.name}: ${p.stock} keys, ${p.price} VND`));
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === "!stats" && msg.author.id === OWNER_ID) {
    const stats = db.getDatabaseStats();
    const embed = new EmbedBuilder()
      .setTitle("Database Statistics")
      .addFields(
        { name: "Products", value: stats.products.toString(), inline: true },
        { name: "Total Keys", value: stats.totalKeys.toString(), inline: true },
        { name: "Available Keys", value: stats.availableKeys.toString(), inline: true },
        { name: "Used Keys", value: stats.usedKeys.toString(), inline: true },
        { name: "Pending Orders", value: stats.pendingOrders.toString(), inline: true },
        { name: "Completed Orders", value: stats.completedOrders.toString(), inline: true }
      )
      .setColor(0x00FF00);
    return msg.reply({ embeds: [embed] });
  }

  if (msg.content === "!stock") {
    try {
      const allProducts = db.getProducts(false);
      
      if (!allProducts || allProducts.length === 0) {
        return msg.reply("No products in inventory.");
      }

      const embed = new EmbedBuilder()
        .setTitle("Inventory Status")
        .setColor(0x00AE86)
        .setTimestamp();

      let hasProducts = false;
      
      allProducts.forEach(item => {
        const stock = item.stock || 0;
        const price = item.price || 0;
        
        embed.addFields({
          name: `${item.name} ${stock === 0 ? '(Out of stock)' : ''}`,
          value: `Stock: ${stock} keys\nPrice: ${price.toLocaleString()} VND`,
          inline: false
        });
        
        if (stock > 0) hasProducts = true;
      });

      await msg.reply({ embeds: [embed] });
      
      if (!hasProducts && allProducts.length > 0) {
        await msg.channel.send("All products are out of stock. Admin please add new keys.");
      }
      
    } catch (error) {
      console.error("Error in !stock command:", error);
      await msg.reply("An error occurred while checking inventory.");
    }
  }

  if (msg.content === "!addproduct") {
    if (msg.author.id !== OWNER_ID) return msg.reply("You don't have permission to use this command.");
    
    const button = new ButtonBuilder()
      .setCustomId("open_addproduct_modal")
      .setLabel("Add New Product")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);
    await msg.reply({ 
      content: "Click the button below to add a new product:", 
      components: [row] 
    });
  }

  if (msg.content === "!addkey") {
    if (msg.author.id !== OWNER_ID) return msg.reply("You don't have permission to use this command.");
    
    const products = db.getProducts(false);
    
    if (products.length === 0) {
      return msg.reply("No products found. Use `!addproduct` first.");
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_product_addkey")
      .setPlaceholder("Select product to add keys");

    products.forEach(product => {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(product.name)
          .setDescription(`Price: ${product.price.toLocaleString()} VND | Stock: ${product.stock} keys`)
          .setValue(product.id.toString())
      );
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await msg.reply({ 
      content: "Select product to add keys:", 
      components: [row] 
    });
  }

  if (msg.content === "!deleteproduct") {
    if (msg.author.id !== OWNER_ID) return msg.reply("You don't have permission to use this command.");
    
    const products = db.getProducts(false);
    if (products.length === 0) return msg.reply("No products found.");

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_product_delete")
      .setPlaceholder("Select product to delete");

    products.forEach(product => {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(product.name)
          .setDescription(`Stock: ${product.stock} keys`)
          .setValue(product.id.toString())
      );
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await msg.reply({ 
      content: "Select product to delete (all keys will be deleted):", 
      components: [row] 
    });
  }

  if (msg.content === "!editproduct") {
    if (msg.author.id !== OWNER_ID) return msg.reply("You don't have permission to use this command.");
    
    const products = db.getProducts(false);
    if (products.length === 0) return msg.reply("No products found.");

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_product_edit")
      .setPlaceholder("Select product to edit");

    products.forEach(product => {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(product.name)
          .setDescription(`${product.price.toLocaleString()} VND`)
          .setValue(product.id.toString())
      );
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await msg.reply({ 
      content: "Select product to edit:", 
      components: [row] 
    });
  }

  if (msg.content === "!buy") {
    const products = db.getProducts(true);
    
    if (products.length === 0) {
      const allProducts = db.getProducts(false);
      if (allProducts.length === 0) {
        return msg.reply("No products available. Please check back later.");
      } else {
        return msg.reply("All products are out of stock. Please wait for restock.");
      }
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_product_buy")
      .setPlaceholder("Select product to purchase");

    products.forEach(product => {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(product.name)
          .setDescription(`${product.price.toLocaleString()} VND | Stock: ${product.stock} keys`)
          .setValue(product.id.toString())
      );
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await msg.reply({ 
      content: "Select the product you want to purchase:", 
      components: [row] 
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId === "open_addproduct_modal") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId("addproduct_modal")
      .setTitle("Add New Product");

    const nameInput = new TextInputBuilder()
      .setCustomId("product_name")
      .setLabel("Product Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Example: Windows 10 Pro")
      .setRequired(true);

    const priceInput = new TextInputBuilder()
      .setCustomId("product_price")
      .setLabel("Price (VND)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Example: 20000")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(priceInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "addproduct_modal") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const name = interaction.fields.getTextInputValue("product_name").trim();
    const price = parseInt(interaction.fields.getTextInputValue("product_price"));

    if (!name) return interaction.reply({ content: "Product name cannot be empty.", ephemeral: true });
    if (isNaN(price) || price <= 0) return interaction.reply({ content: "Price must be a positive number.", ephemeral: true });

    try {
      const result = db.addProduct(name, price);
      console.log(`Added product: ${name} (ID: ${result.id})`);
      await interaction.reply({ 
        content: `Added product ${name} with price ${price.toLocaleString()} VND.`,
        ephemeral: true 
      });
    } catch (err) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "select_product_addkey") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = interaction.values[0];
    const product = db.getProduct(parseInt(productId));
    
    const modal = new ModalBuilder()
      .setCustomId(`addkey_modal_${productId}`)
      .setTitle(`Add keys for ${product.name}`);

    const keyInput = new TextInputBuilder()
      .setCustomId("key_list")
      .setLabel("List of keys (one per line)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("ABCD-EFGH-IJKL\nMNOP-QRST-UVWX")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("addkey_modal_")) {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = parseInt(interaction.customId.split("_")[2]);
    const keyText = interaction.fields.getTextInputValue("key_list");
    const keys = keyText.split("\n").map(k => k.trim()).filter(Boolean);

    if (keys.length === 0) return interaction.reply({ content: "Please enter at least 1 key.", ephemeral: true });

    try {
      const result = db.addKeys(productId, keys);
      console.log(`Added ${result.added} keys for product ID ${productId}`);
      
      let message = `Added ${result.added} keys successfully.`;
      if (result.skipped > 0) {
        message += `\nSkipped ${result.skipped} duplicate keys.`;
      }
      
      await interaction.reply({ content: message, ephemeral: true });
    } catch (err) {
      console.error("Error adding keys:", err);
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "select_product_delete") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = interaction.values[0];
    const product = db.getProduct(parseInt(productId));
    
    const modal = new ModalBuilder()
      .setCustomId(`delete_confirm_${productId}`)
      .setTitle(`Delete ${product.name}`);

    const confirmInput = new TextInputBuilder()
      .setCustomId("confirm_text")
      .setLabel(`Type "DELETE" to confirm deletion`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("DELETE")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(confirmInput));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("delete_confirm_")) {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = parseInt(interaction.customId.split("_")[2]);
    const confirmText = interaction.fields.getTextInputValue("confirm_text").trim();

    if (confirmText !== "DELETE") return interaction.reply({ content: "Confirmation failed.", ephemeral: true });

    try {
      const result = db.deleteProduct(productId);
      console.log(`Deleted product: ${result.deletedProduct}`);
      await interaction.reply({ content: `Deleted ${result.deletedProduct} and all associated keys.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "select_product_edit") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = interaction.values[0];
    const product = db.getProduct(parseInt(productId));

    const modal = new ModalBuilder()
      .setCustomId(`editproduct_modal_${productId}`)
      .setTitle(`Edit ${product.name}`);

    const nameInput = new TextInputBuilder()
      .setCustomId("new_name")
      .setLabel("New name (leave empty to keep current)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(product.name)
      .setRequired(false);

    const priceInput = new TextInputBuilder()
      .setCustomId("new_price")
      .setLabel("New price (VND)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(product.price.toString())
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(priceInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("editproduct_modal_")) {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });

    const productId = parseInt(interaction.customId.split("_")[2]);
    const newName = interaction.fields.getTextInputValue("new_name").trim();
    const price = parseInt(interaction.fields.getTextInputValue("new_price"));
    const product = db.getProduct(productId);

    if (!product) return interaction.reply({ content: "Product not found.", ephemeral: true });
    if (isNaN(price) || price <= 0) return interaction.reply({ content: "Invalid price.", ephemeral: true });

    const finalName = newName || product.name;

    try {
      db.updateProduct(productId, finalName, price);
      console.log(`Updated product ID ${productId}`);
      await interaction.reply({ 
        content: `Updated to ${finalName} with price ${price.toLocaleString()} VND.`,
        ephemeral: true 
      });
    } catch (err) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "select_product_buy") {
    const productId = parseInt(interaction.values[0]);
    const product = db.getProduct(productId);
    
    if (!product) return interaction.reply({ content: "Product not found.", ephemeral: true });
    if (product.stock <= 0) return interaction.reply({ content: "Product is out of stock.", ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId(`buy_modal_${productId}`)
      .setTitle(`Purchase ${product.name}`);

    const quantityInput = new TextInputBuilder()
      .setCustomId("quantity")
      .setLabel(`Quantity (max ${product.stock})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("1")
      .setValue("1")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("buy_modal_")) {
    const productId = parseInt(interaction.customId.split("_")[2]);
    const quantity = parseInt(interaction.fields.getTextInputValue("quantity"));
    const product = db.getProduct(productId);

    if (!product) return interaction.reply({ content: "Product not found.", ephemeral: true });
    if (product.stock <= 0) return interaction.reply({ content: "Product is out of stock.", ephemeral: true });
    if (isNaN(quantity) || quantity < 1 || quantity > product.stock) {
      return interaction.reply({ content: `Invalid quantity (1-${product.stock}).`, ephemeral: true });
    }

    const totalAmount = product.price * quantity;
    const code = generateCode();
    const qr = createQR(code, totalAmount);

    const embed = new EmbedBuilder()
      .setTitle("Payment")
      .setDescription(
        `Product: ${product.name}\n` +
        `Quantity: ${quantity}\n` +
        `Unit Price: ${product.price.toLocaleString()} VND\n` +
        `Total: ${totalAmount.toLocaleString()} VND\n\n` +
        `Transfer Note: ${code}\n\n` +
        `Please transfer the exact amount with the correct note.`
      )
      .setColor(0x00AE86)
      .setImage(qr);

    const replyMessage = await interaction.reply({ 
      embeds: [embed], 
      fetchReply: true 
    });

    db.createOrder(
      code, 
      interaction.user.id, 
      productId, 
      quantity, 
      totalAmount, 
      replyMessage.id, 
      interaction.channel.id
    );
    
    console.log(`New order: ${code} - ${quantity}x ${product.name}`);

    setTimeout(async () => {
      try {
        const order = db.getPendingOrder(code);
        if (order) {
          const channel = await client.channels.fetch(interaction.channel.id);
          const message = await channel.messages.fetch(replyMessage.id);
          await message.delete();
          await interaction.channel.send(`Order ${code} has expired. <@${interaction.user.id}>`);
          console.log(`Order expired: ${code}`);
        }
      } catch (err) {
        console.log("Cleanup error:", err.message);
      }
    }, 30 * 60 * 1000);
  }
});

// ============= DASHBOARD ROUTES =============

const auth = (req, res, next) => {
  const password = req.headers["x-password"] || req.query.password;
  if (password === DASHBOARD_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

app.get("/api/stats", auth, (req, res) => {
  const stats = db.getDatabaseStats();
  res.json(stats);
});

app.get("/api/products", auth, (req, res) => {
  const products = db.getProducts(false);
  res.json(products);
});

// THIS IS THE ENDPOINT THAT WAS MISSING
app.get("/api/products/:id", auth, (req, res) => {
    try {
        const product = db.getProduct(parseInt(req.params.id));
        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }
        res.json(product);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/products", auth, (req, res) => {
  const { name, price } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: "Missing name or price" });
  }
  try {
    const product = db.addProduct(name, price);
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/products/:id/keys", auth, (req, res) => {
  const { keys } = req.body;
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Invalid keys array" });
  }
  try {
    const result = db.addKeys(parseInt(req.params.id), keys);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/products/:id", auth, (req, res) => {
  const { name, price } = req.body;
  try {
    db.updateProduct(parseInt(req.params.id), name, price);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/products/:id", auth, (req, res) => {
  try {
    const result = db.deleteProduct(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/orders/pending", auth, (req, res) => {
  const orders = db.getPendingOrders();
  res.json(orders);
});

app.get("/api/orders/completed", auth, (req, res) => {
  const orders = db.getCompletedOrders();
  res.json(orders);
});

// Phục vụ file dashboard.html
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

// ============= WEBHOOK =============

app.post("/webhook-sepay", async (req, res) => {
  const data = req.body;
  if (!data || !data.id) return res.status(200).json({ success: true });
  if (processed.has(data.id)) return res.status(200).json({ success: true });
  processed.add(data.id);

  try {
    if (data.transferType !== "in") return res.status(200).json({ success: true });

    const code = extractCode(data);
    if (!code) return res.status(200).json({ success: true });

    const order = db.getPendingOrder(code);
    if (!order) return res.status(200).json({ success: true });

    if (Number(data.transferAmount) < order.amount) {
      try {
        const user = await client.users.fetch(order.user_id);
        await user.send(
          `Payment insufficient:\n` +
          `Required: ${order.amount.toLocaleString()} VND\n` +
          `Received: ${Number(data.transferAmount).toLocaleString()} VND`
        );
      } catch (err) {}
      return res.status(200).json({ success: true });
    }

    let keyIds;
    try {
      keyIds = db.reserveKeys(order.id, order.product_id, order.quantity);
    } catch (err) {
      console.log("Insufficient keys:", err.message);
      try {
        const user = await client.users.fetch(order.user_id);
        await user.send("Product is out of stock. Please contact admin for a refund.");
      } catch (err) {}
      return res.status(200).json({ success: true });
    }

    db.completeOrder(order.id);
    const keys = db.getOrderKeys(order.id);
    const keyList = keys.join("\n");

    let sent = false;
    try {
      const channel = await client.channels.fetch(order.channel_id);
      if (channel?.isTextBased() && !channel.isDMBased()) {
        const thread = await channel.threads.create({
          name: `Order ${order.code}`,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: 10080
        });
        await thread.members.add(order.user_id);
        await thread.send({
          content: `<@${order.user_id}> Thank you for your purchase!\n\n` +
                   `Order ID: ${order.code}\n` +
                   `Product: ${order.quantity}x ${order.product_name}\n\n` +
                   `Your keys:\n\`\`\`\n${keyList}\n\`\`\`\n\n` +
                   `Support: <@${OWNER_ID}>`
        });
        sent = true;
        console.log(`Sent keys via thread to ${order.user_id}`);
      }
    } catch (err) {
      console.log("Thread creation error:", err.message);
    }

    if (!sent) {
      try {
        const user = await client.users.fetch(order.user_id);
        await user.send({
          content: `Thank you for your purchase!\n\n` +
                   `Order ID: ${order.code}\n` +
                   `Product: ${order.quantity}x Key\n\n` +
                   `Your keys:\n\`\`\`\n${keyList}\n\`\`\``
        });
        sent = true;
        console.log(`Sent keys via DM to ${order.user_id}`);
      } catch (err) {
        console.log("DM sending error:", err.message);
      }
    }

    if (!sent) {
      db.releaseKeys(order.id);
      console.log(`Released keys for order ${order.code}`);
      return res.status(200).json({ success: true });
    }

    try {
      const channel = await client.channels.fetch(order.channel_id);
      const message = await channel.messages.fetch(order.message_id);
      await message.delete();
      await channel.send(`Transaction successful! <@${order.user_id}> Please check your messages.`);
    } catch (err) {
      console.log("Cleanup error:", err.message);
    }

    console.log(`Order completed: ${order.code}`);
  } catch (err) {
    console.error("Webhook error:", err.message);
  }

  return res.status(200).json({ success: true });
});

app.get("/health", (req, res) => res.send("OK"));

// ============= KHỞI ĐỘNG =============

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`Dashboard password: ${DASHBOARD_PASSWORD}`);
});
