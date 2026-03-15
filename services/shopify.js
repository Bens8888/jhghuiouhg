const axios = require('axios');

const SHOPIFY_BASE = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}`;
const HEADERS = {
  'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
  'Content-Type': 'application/json',
};

// =============================================
// SHOPIFY API HELPERS
// =============================================

async function getOrderByNumber(orderNumber, email) {
  try {
    // Shopify uses order names like #1001
    const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
    const response = await axios.get(`${SHOPIFY_BASE}/orders.json`, {
      headers: HEADERS,
      params: {
        name,
        status: 'any',
        fields: 'id,name,email,phone,created_at,financial_status,fulfillment_status,fulfillments,line_items,shipping_address,shipping_lines,note',
      },
    });

    const orders = response.data.orders || [];
    if (orders.length === 0) return null;

    // Match by email or phone for security
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

async function getOrderById(shopifyOrderId) {
  try {
    const response = await axios.get(`${SHOPIFY_BASE}/orders/${shopifyOrderId}.json`, {
      headers: HEADERS,
    });
    return formatOrder(response.data.order);
  } catch (err) {
    console.error('Shopify getOrderById error:', err.message);
    return null;
  }
}

async function updateOrderTags(shopifyOrderId, tags) {
  try {
    await axios.put(`${SHOPIFY_BASE}/orders/${shopifyOrderId}.json`, {
      order: { id: shopifyOrderId, tags },
    }, { headers: HEADERS });
    return true;
  } catch (err) {
    console.error('Shopify updateTags error:', err.message);
    return false;
  }
}

async function addOrderNote(shopifyOrderId, note) {
  try {
    await axios.put(`${SHOPIFY_BASE}/orders/${shopifyOrderId}.json`, {
      order: { id: shopifyOrderId, note },
    }, { headers: HEADERS });
    return true;
  } catch (err) {
    console.error('Shopify addNote error:', err.message);
    return false;
  }
}

// =============================================
// ORDER FORMATTER
// =============================================

function formatOrder(raw) {
  const fulfillment = raw.fulfillments?.[0];
  const tracking = fulfillment?.tracking_info || {};
  const shippingLine = raw.shipping_lines?.[0];

  // Calculate production stage from order age and status
  const orderAge = Math.floor((Date.now() - new Date(raw.created_at)) / (1000 * 60 * 60)); // hours

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

// =============================================
// PRODUCTION STAGE CALCULATOR
// =============================================

function calculateProductionStage(order, adminOverride = null) {
  if (adminOverride !== null) return adminOverride;

  const { orderAge, fulfillmentStatus, shippedAt } = order;

  if (fulfillmentStatus === 'fulfilled' || shippedAt) return 7; // Shipped
  if (orderAge < 24) return 1;     // Processing
  if (orderAge < 48) return 2;     // Waiting for stock
  if (orderAge < 120) return 3;    // Preparing batch
  if (orderAge < 168) return 4;    // Manufacturing
  if (orderAge < 216) return 5;    // Packing
  if (orderAge < 264) return 6;    // Shipping soon
  return 6;                        // Shipping soon (default max before shipped)
}

function getStageDetails() {
  return [
    {
      step: 1,
      label: 'Processing Order',
      description: 'We\'ve received your order and are verifying payment and details.',
      duration: '24 hours',
      icon: 'clipboard-check',
      color: '#3b82f6',
    },
    {
      step: 2,
      label: 'Waiting for Stock',
      description: 'Your items are being sourced and allocated from our production inventory.',
      duration: '24 hours',
      icon: 'boxes',
      color: '#8b5cf6',
    },
    {
      step: 3,
      label: 'Preparing Production Batch',
      description: 'Your order has been added to a production batch with similar items for efficient manufacturing.',
      duration: '3 days',
      icon: 'layers',
      color: '#f59e0b',
    },
    {
      step: 4,
      label: 'Manufacturing Item',
      description: 'Your item is actively being produced by our manufacturing team. Each piece is made with care.',
      duration: '2–4 days',
      icon: 'settings',
      color: '#ef4444',
    },
    {
      step: 5,
      label: 'Packing Order',
      description: 'Your item has passed quality control and is being carefully packed for safe delivery.',
      duration: '1 day',
      icon: 'package',
      color: '#10b981',
    },
    {
      step: 6,
      label: 'Shipping Soon',
      description: 'Your order is ready to dispatch. We\'re preparing the shipment and booking collection.',
      duration: '48 hours',
      icon: 'truck',
      color: '#06b6d4',
    },
    {
      step: 7,
      label: 'Shipped',
      description: 'Your order is on its way! Use your tracking number to follow it in real time.',
      duration: 'In transit',
      icon: 'map-pin',
      color: '#22c55e',
    },
  ];
}

function calculateEstimates(order, globalDelayDays = 0) {
  const created = new Date(order.createdAt);
  const delayMs = globalDelayDays * 24 * 60 * 60 * 1000;

  // Estimated ship date: ~9 days from order + delay
  const shipDate = new Date(created.getTime() + (9 * 24 * 60 * 60 * 1000) + delayMs);

  // Estimated delivery: 3-7 days after ship
  const deliveryMin = new Date(shipDate.getTime() + (3 * 24 * 60 * 60 * 1000));
  const deliveryMax = new Date(shipDate.getTime() + (7 * 24 * 60 * 60 * 1000));

  // If already shipped, use actual ship date
  if (order.shippedAt) {
    const actualShip = new Date(order.shippedAt);
    const estDeliveryMin = new Date(actualShip.getTime() + (3 * 24 * 60 * 60 * 1000));
    const estDeliveryMax = new Date(actualShip.getTime() + (7 * 24 * 60 * 60 * 1000));
    return {
      estimatedShipDate: actualShip.toISOString(),
      estimatedDeliveryMin: estDeliveryMin.toISOString(),
      estimatedDeliveryMax: estDeliveryMax.toISOString(),
      shipped: true,
    };
  }

  return {
    estimatedShipDate: shipDate.toISOString(),
    estimatedDeliveryMin: deliveryMin.toISOString(),
    estimatedDeliveryMax: deliveryMax.toISOString(),
    shipped: false,
  };
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

module.exports = {
  getOrderByNumber,
  getOrderById,
  updateOrderTags,
  addOrderNote,
  calculateProductionStage,
  getStageDetails,
  calculateEstimates,
  formatOrder,
};
