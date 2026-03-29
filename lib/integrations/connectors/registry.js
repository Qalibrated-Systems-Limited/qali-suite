// ============================================
// CONNECTOR REGISTRY
// Maps connectorType → Connector class.
// Add new verticals here when built.
// ============================================

// Connectors are lazy-imported so unused verticals
// don't load unnecessary modules on every request.

const REGISTRY = {
  weighbridge:  () => import("./weighbridge.js").then((m) => m.WeighbridgeConnector),
  coffee_coop:  () => import("./coffee-coop.js").then((m) => m.CoffeeCoopConnector),
  logistics:    () => import("./logistics.js").then((m) => m.LogisticsConnector),
  miller:       () => import("./miller.js").then((m) => m.MillerConnector),
  generic:      () => import("./generic.js").then((m) => m.GenericConnector),
};

/**
 * Get a connector instance for the given type.
 * Falls back to GenericConnector for unknown types.
 *
 * @param {string} connectorType
 * @param {string} companyId
 * @param {string} keyId
 * @param {string} event
 * @returns {BaseConnector}
 */
export async function getConnector(connectorType, companyId, keyId, event) {
  const loader = REGISTRY[connectorType] ?? REGISTRY.generic;
  const ConnectorClass = await loader();
  const instance = new ConnectorClass(companyId, keyId, event);
  instance.connectorType = connectorType;
  return instance;
}

/**
 * List all registered connector types.
 */
export function getConnectorTypes() {
  return Object.keys(REGISTRY);
}
