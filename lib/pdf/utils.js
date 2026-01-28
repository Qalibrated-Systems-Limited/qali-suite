// PDF utility functions

/**
 * Format currency for display in PDF
 */
export function formatCurrency(amount, currency = "KES") {
  if (amount == null || isNaN(amount)) return `${currency} 0`;
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date for display in PDF
 */
export function formatDate(date) {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format quantity with unit
 */
export function formatQuantity(qty, unit) {
  if (qty == null) return "-";
  const formatted = Number(qty).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Get status display properties
 */
export function getStatusProps(status, paymentStatus) {
  const statusMap = {
    paid: { label: "Paid", style: "statusPaid" },
    partial: { label: "Partial", style: "statusUnpaid" },
    unpaid: { label: "Unpaid", style: "statusUnpaid" },
    overdue: { label: "Overdue", style: "statusOverdue" },
    draft: { label: "Draft", style: "statusDraft" },
    sent: { label: "Sent", style: "statusUnpaid" },
    confirmed: { label: "Confirmed", style: "statusPaid" },
    cancelled: { label: "Cancelled", style: "statusOverdue" },
    accepted: { label: "Accepted", style: "statusPaid" },
    rejected: { label: "Rejected", style: "statusOverdue" },
    expired: { label: "Expired", style: "statusOverdue" },
    completed: { label: "Completed", style: "statusPaid" },
    received: { label: "Received", style: "statusPaid" },
  };

  // Payment status takes precedence for invoices/bills
  if (paymentStatus && statusMap[paymentStatus]) {
    return statusMap[paymentStatus];
  }

  return statusMap[status] || { label: status || "Unknown", style: "statusDraft" };
}

/**
 * Company information for header
 */
export const companyInfo = {
  name: "QALIBRATED SYSTEMS LTD",
  motto: "Inventing and Making Happen",
  address: "Nairobi, Kenya",
  phone: "+254 XXX XXX XXX",
  email: "info@qalibrated.com",
  website: "www.qalibrated.com",
  pin: "P0XXXXXXXXX", // KRA PIN
};

/**
 * Bank details for payment
 */
export const bankDetails = {
  bankName: "Equity Bank",
  accountName: "QALIBRATED SYSTEMS LTD",
  accountNumber: "XXXX-XXX-XXXXXXX",
  branchCode: "XXX",
  swiftCode: "EABORXXX",
};

/**
 * Get document-specific title
 */
export function getDocumentTitle(type) {
  const titles = {
    invoice: "INVOICE",
    quote: "QUOTATION",
    purchaseOrder: "PURCHASE ORDER",
    bill: "BILL",
  };
  return titles[type] || type.toUpperCase();
}

/**
 * Get party label based on document type
 */
export function getPartyLabel(type, isSecondary = false) {
  const labels = {
    invoice: { primary: "Bill To", secondary: "Ship To" },
    quote: { primary: "Quotation For", secondary: "Delivery To" },
    purchaseOrder: { primary: "Supplier", secondary: "Deliver To" },
    bill: { primary: "Vendor", secondary: "Ship To" },
  };
  const docLabels = labels[type] || { primary: "To", secondary: "Ship To" };
  return isSecondary ? docLabels.secondary : docLabels.primary;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text, maxLength = 50) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Format address that might be stored as JSON string, JS object literal, or object
 */
export function formatAddress(address) {
  if (!address) return "";

  // If it's a string, try to parse it
  if (typeof address === "string") {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(address);
      if (typeof parsed === "object" && parsed !== null) {
        const parts = [
          parsed.street || parsed.line1,
          parsed.line2,
          parsed.city,
          parsed.state,
          parsed.postalCode,
          parsed.country,
        ].filter(Boolean);
        return parts.join(", ");
      }
    } catch {
      // Not valid JSON - check if it's a JS object literal like "{ country: 'Kenya' }"
      if (address.startsWith("{") && address.endsWith("}")) {
        try {
          const jsonStr = address
            .replace(/(\w+):/g, '"$1":')
            .replace(/'/g, '"');
          const parsed = JSON.parse(jsonStr);
          if (typeof parsed === "object" && parsed !== null) {
            const parts = [
              parsed.street || parsed.line1,
              parsed.line2,
              parsed.city,
              parsed.state,
              parsed.postalCode,
              parsed.country,
            ].filter(Boolean);
            return parts.join(", ");
          }
        } catch {
          return address;
        }
      }
      return address;
    }
  }

  // If it's an object, extract parts
  if (typeof address === "object") {
    const parts = [
      address.street || address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  }

  return "";
}
