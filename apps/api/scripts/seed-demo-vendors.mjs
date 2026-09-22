// Sample vendor/product content for onboarding pitches — real rows in the
// live Neon DB (not a mockup), so a prospective vendor can see an actual
// working storefront during a pitch. Plain ESM .mjs, not .ts: this is run
// directly against the deployed API container over Railway SSH (piped via
// stdin — `node --input-type=module -`), which has a generated Prisma
// client but no tsx/ts-node, the same pattern used for the ETA/QuickBuy
// migration earlier. Idempotent: re-running skips any vendor whose
// businessName already exists, so it's safe to run again after adding more
// items later.
//
// Cover images: per explicit product decision, vendor cover pages are just
// the business name as text for now (VendorPage already handles a null
// logoUrl this way) — logoUrl is left null for all ten.
//
// Cluster coordinates are two points well inside the real Riverpark
// service-area polygon (prisma/seed.ts's service_area_polygon), nudged
// slightly per vendor so they don't all stack on one pin.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Verified (scratchpad/find-safe-clusters.mjs + verify-final-coords.mjs
// against prisma/seed.ts's real service_area_polygon) to stay inside the
// polygon with a 0.001°(~110m) margin even at the largest nudge offset
// below — every one of the 10 vendor pins this produces was individually
// checked with isPointInPolygon before this script was run for real.
const CLUSTER_1 = { lat: 8.983, lng: 7.337 };
const CLUSTER_3 = { lat: 8.9725, lng: 7.3465 };

function nudge(base, i) {
  // Small deterministic offset (~10-80m) so vendors in the same cluster
  // don't share an identical pin.
  const d = 0.00007 * (i + 1);
  return { lat: base.lat + d * (i % 2 === 0 ? 1 : -1), lng: base.lng + d * (i % 3 === 0 ? -1 : 1) };
}

const STORE_HOURS = {
  mon: ["08:00", "20:00"],
  tue: ["08:00", "20:00"],
  wed: ["08:00", "20:00"],
  thu: ["08:00", "20:00"],
  fri: ["08:00", "20:00"],
  sat: ["08:00", "20:00"],
  sun: ["10:00", "18:00"],
};

const RESTAURANT_HOURS = {
  mon: ["09:00", "21:00"],
  tue: ["09:00", "21:00"],
  wed: ["09:00", "21:00"],
  thu: ["09:00", "21:00"],
  fri: ["09:00", "22:00"],
  sat: ["09:00", "22:00"],
  sun: ["11:00", "21:00"],
};

// Real photos — Wikimedia Commons preferred (openly licensed, hotlink-
// friendly), Unsplash/Pexels as a fallback where no verifiable branded
// Nigerian product photo exists (Chivita, Hollandia, Golden Morn, Gala,
// Golden Penny Spaghetti, Kings Oil, Dangote Rice, Emzor syrup, vitamin C
// tablets/serum, fried rice, body lotion — all genuine, well-lit,
// category-accurate stock photos, not the specific branded package).
// Every URL individually verified (HTTP 200 + image/* content-type)
// against the live source twice, independently, before use — see
// scratchpad/product-images.json and verify-images.mjs from this session.
// "Weekly Family Meal Plan" has no single SKU photo of its own — it's a
// bundle of the same rice/stew/protein dishes already pictured elsewhere,
// so it reuses the beef stew plate as its representative image.
const IMG = {
  "Coca-Cola 35cl": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Coca-cola_50cl_can_-_Italia.jpg/1280px-Coca-cola_50cl_can_-_Italia.jpg",
  "Fanta Orange 35cl": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Fanta_Orange_Bottle.jpg/1280px-Fanta_Orange_Bottle.jpg",
  "Eva Premium Table Water 75cl": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Eva_Bottle_Water.jpg/1280px-Eva_Bottle_Water.jpg",
  "Chivita 100% Apple Juice 1L": "https://images.pexels.com/photos/27119201/pexels-photo-27119201.jpeg",
  "Hollandia Yoghurt 1L": "https://images.unsplash.com/photo-1758960605961-353a4e0958fa",
  "Milo 400g": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/1940s_Nestl%C3%A9_Milo_tin.jpg/1280px-1940s_Nestl%C3%A9_Milo_tin.jpg",
  "Peak Milk Evaporated (tin)": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Peak_Milk_01.jpg/1280px-Peak_Milk_01.jpg",
  "Golden Morn 900g": "https://images.unsplash.com/photo-1714686650962-c5c4d33213b8",
  "Lipton Yellow Label Tea (25 bags)": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Lipton_Yellow_Label_Tea_-_Locked_down_-_20230104.jpg/1280px-Lipton_Yellow_Label_Tea_-_Locked_down_-_20230104.jpg",
  "Indomie Instant Noodles": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Boxes_of_Indo_Mie_instant_noodles.jpg/1280px-Boxes_of_Indo_Mie_instant_noodles.jpg",
  "Gala Sausage Roll": "https://images.pexels.com/photos/31346253/pexels-photo-31346253.jpeg",
  "Pringles Original": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Pringles-165g-to-134g.jpg/1280px-Pringles-165g-to-134g.jpg",
  "McVitie's Digestive Biscuits": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/McVitie%27s_chocolate_digestive_biscuit.jpg/1280px-McVitie%27s_chocolate_digestive_biscuit.jpg",
  "Golden Penny Spaghetti 500g": "https://images.pexels.com/photos/4039704/pexels-photo-4039704.jpeg",
  "Kings Vegetable Oil 1L": "https://images.unsplash.com/photo-1757801333069-f7b3cabaec4a",
  "Maggi Star Seasoning Cubes": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Bouillon_KUB.JPG/1280px-Bouillon_KUB.JPG",
  "Dangote Rice 5kg": "https://images.pexels.com/photos/5472000/pexels-photo-5472000.jpeg",
  "Semovita 1kg": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Semovita.jpg/1280px-Semovita.jpg",
  "Omo Detergent 900g": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Hoog_rechthoekig_pak_Omo_wasmiddel%2C_rood%2C_wit_en_zwart%2C_objectnr_62179%281%29.JPG/1280px-Hoog_rechthoekig_pak_Omo_wasmiddel%2C_rood%2C_wit_en_zwart%2C_objectnr_62179%281%29.JPG",
  "Fresh Catfish": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Catfish_seller_in_Nigeria.jpg/1280px-Catfish_seller_in_Nigeria.jpg",
  "Frozen Croaker Fish": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Frozen_small_yellow_croaker.jpg/1280px-Frozen_small_yellow_croaker.jpg",
  "Stockfish (Okporoko)": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Stockfish_%28_Okporoko%29.jpg/1280px-Stockfish_%28_Okporoko%29.jpg",
  "Ground Crayfish": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/A_man_selling_dried_crayfish_in_african_market.jpg/1280px-A_man_selling_dried_crayfish_in_african_market.jpg",
  "Afang Leaves, chopped": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Mfumbwa_-_Gnetum_africanum%2C_leaves_bundle_and_chopped.jpg/1280px-Mfumbwa_-_Gnetum_africanum%2C_leaves_bundle_and_chopped.jpg",
  "Ugu (Pumpkin) Leaves, fresh": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Woman_chopping_ugwu.jpg/1280px-Woman_chopping_ugwu.jpg",
  "Fresh Onions (bag)": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Pile_of_Onions_at_Barkin_Dogo_Market%2C_Kaduna_North_01.jpg/1280px-Pile_of_Onions_at_Barkin_Dogo_Market%2C_Kaduna_North_01.jpg",
  "Assorted Beef Cuts": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Fresh_cut_beef_prepared_for_cooking_at_home_on_a_kitchen_counter_in_a_well-lit_space.jpg/1280px-Fresh_cut_beef_prepared_for_cooking_at_home_on_a_kitchen_counter_in_a_well-lit_space.jpg",
  "Panadol Extra": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Panadol.JPG/1280px-Panadol.JPG",
  "Emzor Paracetamol Syrup (Kids)": "https://images.unsplash.com/photo-1647572485946-fae868d8b587",
  "Vitamin C Effervescent Tablets": "https://images.unsplash.com/photo-1767116291180-1838947b6c4d",
  "Party Jollof Rice with Chicken": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Party_Nigerian_jollof_rice.jpg/1280px-Party_Nigerian_jollof_rice.jpg",
  "Fried Rice with Turkey": "https://images.pexels.com/photos/15362104/pexels-photo-15362104.jpeg",
  "Grilled Goat Meat (Peppered)": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Fried_Goat_Meat.jpg/1280px-Fried_Goat_Meat.jpg",
  "Beef Stew with Rice": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/White_rice_and_stew_%28Banga_stew%29_%28Nigerian_dish%29.jpg/1280px-White_rice_and_stew_%28Banga_stew%29_%28Nigerian_dish%29.jpg",
  "Weekly Family Meal Plan": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/White_rice_and_stew_%28Banga_stew%29_%28Nigerian_dish%29.jpg/1280px-White_rice_and_stew_%28Banga_stew%29_%28Nigerian_dish%29.jpg",
  "Shea Butter Body Cream": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Shea_butter.jpg/1280px-Shea_butter.jpg",
  "Vitamin C Face Serum": "https://images.unsplash.com/photo-1765726951362-df46f5a74cdf",
  "African Black Soap": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/African_Black_Soap.jpg/1280px-African_Black_Soap.jpg",
  "Body Lotion": "https://images.unsplash.com/photo-1632841176116-68bdbd539917",
};

function img(name) {
  const url = IMG[name];
  if (!url || url.startsWith("__IMG_")) throw new Error(`Missing image URL for "${name}"`);
  return [url];
}

// name, priceMinor (kobo), stock, categoryKey ("grocery" | "pharmacy" | "restaurant" | "beauty")
const CATALOG = {
  "Coca-Cola 35cl": [50000, 200, "grocery"],
  "Fanta Orange 35cl": [45000, 200, "grocery"],
  "Eva Premium Table Water 75cl": [30000, 300, "grocery"],
  "Chivita 100% Apple Juice 1L": [220000, 80, "grocery"],
  "Hollandia Yoghurt 1L": [250000, 60, "grocery"],
  "Milo 400g": [380000, 100, "grocery"],
  "Peak Milk Evaporated (tin)": [90000, 150, "grocery"],
  "Golden Morn 900g": [320000, 80, "grocery"],
  "Lipton Yellow Label Tea (25 bags)": [180000, 90, "grocery"],
  "Indomie Instant Noodles": [30000, 400, "grocery"],
  "Gala Sausage Roll": [30000, 150, "grocery"],
  "Pringles Original": [350000, 60, "grocery"],
  "McVitie's Digestive Biscuits": [280000, 70, "grocery"],
  "Golden Penny Spaghetti 500g": [120000, 120, "grocery"],
  "Kings Vegetable Oil 1L": [300000, 90, "grocery"],
  "Maggi Star Seasoning Cubes": [60000, 200, "grocery"],
  "Dangote Rice 5kg": [850000, 50, "grocery"],
  "Semovita 1kg": [220000, 70, "grocery"],
  "Omo Detergent 900g": [260000, 100, "grocery"],
  "Fresh Catfish": [450000, 30, "grocery"],
  "Frozen Croaker Fish": [550000, 30, "grocery"],
  "Stockfish (Okporoko)": [600000, 25, "grocery"],
  "Ground Crayfish": [350000, 40, "grocery"],
  "Afang Leaves, chopped": [200000, 35, "grocery"],
  "Ugu (Pumpkin) Leaves, fresh": [150000, 35, "grocery"],
  "Fresh Onions (bag)": [300000, 40, "grocery"],
  "Assorted Beef Cuts": [650000, 30, "grocery"],
  "Panadol Extra": [70000, 100, "pharmacy"],
  "Emzor Paracetamol Syrup (Kids)": [120000, 60, "pharmacy"],
  "Vitamin C Effervescent Tablets": [250000, 70, "pharmacy"],
  "Party Jollof Rice with Chicken": [350000, 40, "restaurant"],
  "Fried Rice with Turkey": [400000, 40, "restaurant"],
  "Grilled Goat Meat (Peppered)": [450000, 30, "restaurant"],
  "Beef Stew with Rice": [300000, 40, "restaurant"],
  "Weekly Family Meal Plan": [2500000, 15, "restaurant"],
  "Shea Butter Body Cream": [350000, 40, "beauty"],
  "Vitamin C Face Serum": [650000, 25, "beauty"],
  "African Black Soap": [150000, 60, "beauty"],
  "Body Lotion": [400000, 40, "beauty"],
};

function product(name, isQuickBuy = false) {
  const [priceMinor, stock, categoryKey] = CATALOG[name];
  return { name, priceMinor, stock, categoryKey, isQuickBuy, images: img(name) };
}

const VENDORS = [
  {
    phone: "+2348010000001",
    businessName: "Bental",
    categoryKey: "grocery",
    description: "Your neighbourhood supermarket for everyday groceries, drinks and household essentials.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, beside the estate gate",
    avgDeliveryMinutes: 20,
    reliabilityScore: 4.60,
    products: [
      product("Coca-Cola 35cl", true),
      product("Fanta Orange 35cl"),
      product("Eva Premium Table Water 75cl"),
      product("Chivita 100% Apple Juice 1L"),
      product("Hollandia Yoghurt 1L"),
      product("Milo 400g", true),
      product("Peak Milk Evaporated (tin)", true),
      product("Golden Morn 900g"),
      product("Lipton Yellow Label Tea (25 bags)"),
      product("Indomie Instant Noodles", true),
      product("Gala Sausage Roll"),
      product("Pringles Original"),
      product("McVitie's Digestive Biscuits"),
      product("Golden Penny Spaghetti 500g"),
      product("Kings Vegetable Oil 1L"),
      product("Maggi Star Seasoning Cubes"),
      product("Dangote Rice 5kg"),
      product("Semovita 1kg"),
      product("Omo Detergent 900g", true),
    ],
  },
  {
    phone: "+2348010000002",
    businessName: "Grachi Pharmacy",
    categoryKey: "pharmacy",
    description: "Pharmacy and everyday convenience — medication alongside drinks, snacks and household basics.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, opposite the estate clinic",
    avgDeliveryMinutes: 15,
    reliabilityScore: 4.40,
    products: [
      product("Panadol Extra", true),
      product("Emzor Paracetamol Syrup (Kids)"),
      product("Vitamin C Effervescent Tablets", true),
      product("Coca-Cola 35cl"),
      product("Eva Premium Table Water 75cl", true),
      product("Indomie Instant Noodles"),
      product("Gala Sausage Roll"),
      product("Milo 400g"),
      product("Peak Milk Evaporated (tin)"),
    ],
  },
  {
    phone: "+2348010000003",
    businessName: "Maklay Pharmacy",
    categoryKey: "pharmacy",
    description: "Pharmacy and everyday convenience — medication alongside drinks, snacks and household basics.",
    cluster: CLUSTER_3,
    landmark: "Riverpark Cluster 3, along the estate ring road",
    avgDeliveryMinutes: 18,
    reliabilityScore: 4.30,
    products: [
      product("Panadol Extra", true),
      product("Emzor Paracetamol Syrup (Kids)", true),
      product("Vitamin C Effervescent Tablets"),
      product("Coca-Cola 35cl"),
      product("Fanta Orange 35cl"),
      product("Lipton Yellow Label Tea (25 bags)"),
      product("Hollandia Yoghurt 1L"),
      product("Golden Morn 900g"),
    ],
  },
  {
    phone: "+2348010000004",
    businessName: "Bifar Pharmacy",
    categoryKey: "pharmacy",
    description: "Pharmacy and everyday convenience — medication alongside drinks, snacks and household basics.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, near the estate shopping row",
    avgDeliveryMinutes: 15,
    reliabilityScore: 4.50,
    products: [
      product("Panadol Extra", true),
      product("Emzor Paracetamol Syrup (Kids)"),
      product("Vitamin C Effervescent Tablets", true),
      product("Eva Premium Table Water 75cl"),
      product("Milo 400g"),
      product("Pringles Original"),
      product("McVitie's Digestive Biscuits"),
    ],
  },
  {
    phone: "+2348010000005",
    businessName: "Uni Frozen Foods",
    categoryKey: "grocery",
    description: "Raw meat, fish and fresh vegetables — catfish, croaker, stockfish, crayfish, Afang and Ugu leaves, onions and assorted beef cuts.",
    cluster: CLUSTER_3,
    landmark: "Riverpark Cluster 3, by the estate market square",
    avgDeliveryMinutes: 25,
    reliabilityScore: 4.70,
    products: [
      product("Fresh Catfish", true),
      product("Frozen Croaker Fish"),
      product("Stockfish (Okporoko)"),
      product("Ground Crayfish", true),
      product("Afang Leaves, chopped"),
      product("Ugu (Pumpkin) Leaves, fresh"),
      product("Fresh Onions (bag)"),
      product("Assorted Beef Cuts", true),
    ],
  },
  {
    phone: "+2348010000006",
    businessName: "Myl's Groceries",
    categoryKey: "grocery",
    description: "Everyday groceries, drinks and pantry staples for Cluster 3.",
    cluster: CLUSTER_3,
    landmark: "Riverpark Cluster 3, opposite the estate playground",
    avgDeliveryMinutes: 22,
    reliabilityScore: 4.50,
    products: [
      product("Coca-Cola 35cl"),
      product("Fanta Orange 35cl"),
      product("Eva Premium Table Water 75cl"),
      product("Chivita 100% Apple Juice 1L"),
      product("Hollandia Yoghurt 1L"),
      product("Golden Morn 900g"),
      product("Lipton Yellow Label Tea (25 bags)"),
      product("Indomie Instant Noodles", true),
      product("Gala Sausage Roll"),
      product("Pringles Original"),
      product("Golden Penny Spaghetti 500g"),
      product("Kings Vegetable Oil 1L", true),
      product("Maggi Star Seasoning Cubes", true),
      product("Dangote Rice 5kg", true),
      product("Omo Detergent 900g"),
    ],
  },
  {
    phone: "+2348010000007",
    businessName: "Anishoks Supermarket",
    categoryKey: "grocery",
    description: "Everyday groceries, drinks and pantry staples for Cluster 3.",
    cluster: CLUSTER_3,
    landmark: "Riverpark Cluster 3, near the estate water tank",
    avgDeliveryMinutes: 20,
    reliabilityScore: 4.40,
    products: [
      product("Coca-Cola 35cl"),
      product("Fanta Orange 35cl"),
      product("Eva Premium Table Water 75cl"),
      product("Milo 400g", true),
      product("Peak Milk Evaporated (tin)", true),
      product("McVitie's Digestive Biscuits"),
      product("Semovita 1kg", true),
      product("Golden Penny Spaghetti 500g"),
      product("Kings Vegetable Oil 1L"),
      product("Dangote Rice 5kg"),
      product("Omo Detergent 900g"),
      product("Maggi Star Seasoning Cubes"),
    ],
  },
  {
    phone: "+2348010000008",
    businessName: "Offiong's Restaurant",
    categoryKey: "restaurant",
    description: "Garnished party jollof and fried rice, grilled proteins, and weekly meal plans mixing rice, stew, chicken, beef, eggs and toast.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, along the estate food row",
    avgDeliveryMinutes: 40,
    reliabilityScore: 4.80,
    products: [
      product("Party Jollof Rice with Chicken", true),
      product("Fried Rice with Turkey", true),
      product("Grilled Goat Meat (Peppered)"),
      product("Beef Stew with Rice"),
      product("Weekly Family Meal Plan"),
    ],
  },
  {
    phone: "+2348010000009",
    businessName: "E&E",
    categoryKey: "grocery",
    description: "Supermarket and restaurant in one — everyday groceries plus garnished jollof, fried rice and stew, cooked fresh.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, opposite the estate mall",
    avgDeliveryMinutes: 30,
    reliabilityScore: 4.60,
    products: [
      product("Party Jollof Rice with Chicken", true),
      product("Fried Rice with Turkey"),
      product("Beef Stew with Rice"),
      product("Coca-Cola 35cl", true),
      product("Fanta Orange 35cl"),
      product("Eva Premium Table Water 75cl"),
      product("Indomie Instant Noodles", true),
      product("Milo 400g"),
      product("Peak Milk Evaporated (tin)"),
      product("Golden Penny Spaghetti 500g"),
      product("Dangote Rice 5kg"),
      product("Omo Detergent 900g"),
    ],
  },
  {
    phone: "+2348010000010",
    businessName: "PureGlow Skincare",
    categoryKey: "beauty",
    description: "Skincare essentials — shea butter, black soap, vitamin C serum and body lotion.",
    cluster: CLUSTER_1,
    landmark: "Riverpark Cluster 1, near the estate salon row",
    avgDeliveryMinutes: 20,
    reliabilityScore: 4.50,
    products: [
      product("Shea Butter Body Cream", true),
      product("African Black Soap", true),
      product("Vitamin C Face Serum"),
      product("Body Lotion"),
    ],
  },
];

async function main() {
  const categories = await prisma.category.findMany();
  const categoryId = (key) => {
    const name = { grocery: "Food & Groceries", pharmacy: "Pharmacy", restaurant: "Restaurants", beauty: "Beauty" }[key];
    const cat = categories.find((c) => c.name === name);
    if (!cat) throw new Error(`Category "${name}" not found — run prisma/seed.ts first.`);
    return cat.id;
  };

  let vendorsCreated = 0;
  let productsCreated = 0;

  for (let i = 0; i < VENDORS.length; i++) {
    const v = VENDORS[i];
    const existingVendor = await prisma.vendorProfile.findFirst({ where: { businessName: v.businessName } });
    if (existingVendor) {
      console.log(`SKIP (exists): ${v.businessName}`);
      continue;
    }

    const existingUser = await prisma.user.findUnique({ where: { phone: v.phone } });
    const user =
      existingUser ??
      (await prisma.user.create({
        data: { phone: v.phone, role: "vendor", phoneVerifiedAt: new Date() },
      }));

    const pos = nudge(v.cluster, i);
    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: user.id,
        businessName: v.businessName,
        categoryId: categoryId(v.categoryKey),
        description: v.description,
        logoUrl: null, // cover page is just the business name as text, per product decision
        pickupLat: pos.lat,
        pickupLng: pos.lng,
        pickupLandmark: v.landmark,
        pickupPhone: v.phone,
        status: "approved",
        isOpen: true,
        supportsPickup: true,
        openingHours: v.categoryKey === "restaurant" ? RESTAURANT_HOURS : STORE_HOURS,
        reliabilityScore: v.reliabilityScore,
        avgDeliveryMinutes: v.avgDeliveryMinutes,
      },
    });
    vendorsCreated++;

    for (const p of v.products) {
      await prisma.product.create({
        data: {
          vendorId: vendor.id,
          categoryId: categoryId(p.categoryKey),
          name: p.name,
          priceMinor: p.priceMinor,
          images: p.images,
          stock: p.stock,
          isActive: true,
          isQuickBuy: p.isQuickBuy,
        },
      });
      productsCreated++;
    }

    console.log(`CREATED: ${v.businessName} (${v.products.length} products)`);
  }

  console.log(`\nDone. Vendors created: ${vendorsCreated}. Products created: ${productsCreated}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
