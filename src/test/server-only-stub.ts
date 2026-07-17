// Vitest stub for the "server-only" marker package: in Next.js it throws when a
// server module is imported from client code; in node-based tests it must be a
// no-op so server modules (pdf extraction, crypto, …) stay unit-testable.
export {};
