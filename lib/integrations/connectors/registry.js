// ============================================
// CONNECTOR REGISTRY
// Maps connectorType → Connector class.
// Add new verticals here when built.
// ============================================

// Connectors are lazy-imported so unused verticals
// don't load unnecessary modules on every request.

// `logistics` and `miller` are NOT here, and were: they mapped to
// ./logistics.js and ./miller.js, neither of which exists. Because
// `getConnector` picks the loader by key BEFORE it can fall back to generic, a
// request naming either type threw on the dynamic import rather than degrading
// to the generic connector the fallback was written for. An unbuilt vertical
// belongs out of the registry, not in it pointing at nothing.
const REGISTRY = {
  weighbridge:  () => import("./weighbridge.js").then((m) => m.WeighbridgeConnector),
  coffee_coop:  () => import("./coffee-coop.js").then((m) => m.CoffeeCoopConnector),
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
