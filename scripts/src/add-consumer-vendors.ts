import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

const consumerVendors = [
  {
    name: "Verizon Consumer",
    description: "Residential internet, phone, and TV bundles for homes.",
    contactEmail: "partners@verizon.com",
    website: "https://www.verizon.com",
    commission_percent: "12.00",
  },
  {
    name: "Charter Spectrum Consumer",
    description: "Cable internet, phone, and TV bundles for residential customers.",
    contactEmail: "partners@charter.com",
    website: "https://www.spectrum.com",
    commission_percent: "10.00",
  },
  {
    name: "AT&T Consumer",
    description: "Fiber and 5G internet, phone, and DirectTV bundles.",
    contactEmail: "partners@att.com",
    website: "https://www.att.com",
    commission_percent: "12.00",
  },
  {
    name: "Dish Network",
    description: "Satellite TV, internet, and phone bundles for homes.",
    contactEmail: "partners@dish.com",
    website: "https://www.dish.com",
    commission_percent: "15.00",
  },
  {
    name: "Cox Communications",
    description: "Residential cable internet, phone, and TV services.",
    contactEmail: "partners@cox.com",
    website: "https://www.cox.com",
    commission_percent: "10.00",
  },
  {
    name: "Comcast Xfinity Consumer",
    description: "Residential internet, phone, and TV bundles.",
    contactEmail: "partners@comcast.com",
    website: "https://www.xfinity.com",
    commission_percent: "12.00",
  },
];

const productsByVendor: Record<string, Array<{
  title: string;
  description: string;
  category: string;
  price: string | null;
  commission_rate: string;
}>> = {
  "Verizon Consumer": [
    {
      title: "Verizon Fios Internet + Phone",
      description: "Fiber internet with home phone service.",
      category: "ISP",
      price: "59.99",
      commission_rate: "12.00",
    },
    {
      title: "Verizon Fios + DirectTV Bundle",
      description: "Fiber internet, TV, and phone in one package.",
      category: "ISP",
      price: "99.99",
      commission_rate: "12.00",
    },
  ],
  "Charter Spectrum Consumer": [
    {
      title: "Spectrum Internet + Phone",
      description: "No-contract cable internet and home phone.",
      category: "ISP",
      price: "64.99",
      commission_rate: "10.00",
    },
    {
      title: "Spectrum Triple Play",
      description: "Internet, phone, and TV bundle.",
      category: "ISP",
      price: "109.99",
      commission_rate: "10.00",
    },
  ],
  "AT&T Consumer": [
    {
      title: "AT&T Fiber Internet + Phone",
      description: "Gigabit fiber internet with home phone service.",
      category: "ISP",
      price: "79.99",
      commission_rate: "12.00",
    },
    {
      title: "AT&T Fiber + DirectTV Bundle",
      description: "Fiber internet, TV, and phone.",
      category: "ISP",
      price: "119.99",
      commission_rate: "12.00",
    },
  ],
  "Dish Network": [
    {
      title: "Dish TV Streaming",
      description: "Over-the-air TV service with streaming apps.",
      category: "ISP",
      price: "64.99",
      commission_rate: "15.00",
    },
    {
      title: "Dish Satellite + Internet Bundle",
      description: "Satellite TV with broadband internet.",
      category: "ISP",
      price: "99.99",
      commission_rate: "15.00",
    },
  ],
  "Cox Communications": [
    {
      title: "Cox Internet + Phone",
      description: "Cable internet with home phone service.",
      category: "ISP",
      price: "59.99",
      commission_rate: "10.00",
    },
    {
      title: "Cox Triple Play Bundle",
      description: "Internet, phone, and TV service.",
      category: "ISP",
      price: "119.99",
      commission_rate: "10.00",
    },
  ],
  "Comcast Xfinity Consumer": [
    {
      title: "Xfinity Internet + Voice",
      description: "Cable internet with home phone service.",
      category: "ISP",
      price: "59.99",
      commission_rate: "12.00",
    },
    {
      title: "Xfinity Triple Play",
      description: "Internet, phone, and TV bundle.",
      category: "ISP",
      price: "109.99",
      commission_rate: "12.00",
    },
  ],
};

async function run() {
  await client.connect();
  console.log("Adding consumer service vendors to marketplace...\n");

  try {
    let vendorCount = 0;
    let productCount = 0;

    for (const vendor of consumerVendors) {
      const existing = await client.query(
        "SELECT id FROM marketplace_vendors WHERE name = $1",
        [vendor.name]
      );

      let vendorId: number;
      if (existing.rows.length > 0) {
        vendorId = existing.rows[0].id;
        console.log(`✓ Vendor exists: ${vendor.name} (id=${vendorId})`);
      } else {
        const result = await client.query(
          `INSERT INTO marketplace_vendors (name, description, contact_email, website, commission_percent, status)
           VALUES ($1, $2, $3, $4, $5, 'approved') RETURNING id`,
          [vendor.name, vendor.description, vendor.contactEmail, vendor.website, vendor.commission_percent]
        );
        vendorId = result.rows[0].id;
        vendorCount++;
        console.log(`✓ Created vendor: ${vendor.name} (id=${vendorId})`);
      }

      const products = productsByVendor[vendor.name] || [];
      for (const product of products) {
        const existingProduct = await client.query(
          "SELECT id FROM marketplace_products WHERE title = $1 AND vendor_id = $2",
          [product.title, vendorId]
        );

        if (existingProduct.rows.length > 0) {
          console.log(`  → Product exists: ${product.title}`);
          continue;
        }

        await client.query(
          `INSERT INTO marketplace_products (vendor_id, title, description, category, price, commission_rate, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
          [vendorId, product.title, product.description, product.category, product.price, product.commission_rate]
        );
        productCount++;
        console.log(`  ✓ Created: ${product.title}`);
      }
    }

    console.log(`\n✅ Done: ${vendorCount} vendors, ${productCount} products added.`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
