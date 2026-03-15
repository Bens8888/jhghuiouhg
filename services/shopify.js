const axios = require('axios');
require('dotenv').config(); // Load .env variables
const SHOP = process.env.SHOPIFY_SHOP;
const API_VERSION = process.env.SHOPIFY_API_VERSION;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let token = null;
let tokenExpiresAt = 0;

// Fetch a new access token programmatically (client_credentials)
async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token; // cache

  try {
    const response = await axios.post(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, null, {
      params: {
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    token = response.data.access_token;
    tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);  // Set token expiry time
    return token;
  } catch (err) {
    console.error('Failed to get Shopify token:', err.response?.data || err.message);
    throw err;
  }
}

// Helper to get headers with dynamic token
async function getHeaders() {
  return {
    'X-Shopify-Access-Token': await getToken(),
    'Content-Type': 'application/json',
  };
}

// Fetch order by number (given order number and email)
async function getOrderByNumber(orderNumber, email) {
  try {
    const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
    const response = await axios.get(
      `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/orders.json`,
      {
        headers: await getHeaders(),
        params: {
          name,
          status: 'any',
          fields: 'id,name,email,phone,created_at,financial_status,fulfillment_status,fulfillments,line_items,shipping_address,shipping_lines,note',
        },
      }
    );

    const orders = response.data.orders || [];
    if (orders.length === 0) return null;

    const order = orders.find(o => {
      const emailMatch = email && o.email && o.email.toLowerCase() === email.toLowerCase();
      const phoneMatch = email && o.phone && normalizePhone(o.phone) === normalizePhone(email);
      return emailMatch || phoneMatch;
    });

    return order ? formatOrder(order) : null;
  } catch (err) {
    console.error('Shopify getOrder error:', err.response?.data || err.message);
    return null;
  }
}

// Format the order data
function formatOrder(raw) {
  const fulfillment = raw.fulfillments?.[0];
  const tracking = fulfillment?.tracking_info || {};
  const shippingLine = raw.shipping_lines?.[0];
  const orderAge = Math.floor((Date.now() - new Date(raw.created_at)) / (1000 * 60 * 60));

  return {
    id: raw.id,
    orderNumber: raw.name,
    email: raw.email,
    phone: raw.phone,
    createdAt: raw.created_at,
    financialStatus: raw.financial_status,
    fulfillmentStatus: raw.fulfillment_status || 'unfulfilled',
    shippingAddress: raw.shipping_address ? {
      address1: raw.shipping_address.address1,
      address2: raw.shipping_address.address2,
      city: raw.shipping_address.city,
      province: raw.shipping_address.province,
      country: raw.shipping_address.country,
      zip: raw.shipping_address.zip,
      name: raw.shipping_address.name,
      lat: raw.shipping_address.latitude,
      lng: raw.shipping_address.longitude,
    } : null,
    shippingMethod: shippingLine?.title || 'Standard Shipping',
    trackingNumber: tracking.number || fulfillment?.tracking_number || null,
    trackingUrl: tracking.url || fulfillment?.tracking_url || null,
    carrier: tracking.company || fulfillment?.tracking_company || null,
    shippedAt: fulfillment?.created_at || null,
    lineItems: (raw.line_items || []).map(item => ({
      id: item.id,
      title: item.title,
      variant: item.variant_title,
      quantity: item.quantity,
      price: item.price,
      image: item.properties?.find(p => p.name === '_image')?.value || null,
      sku: item.sku,
    })),
    orderAge,
    note: raw.note,
  };
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

module.exports = {
  getOrderByNumber,
  formatOrder,
};
