// relay.js — ESM entry point for the FreeNova local relay.
//
// The implementation lives in relay.cjs, because web-panel/package.json sets
// "type": "module": a .js file in this package cannot call require(), so the
// original copy of this file (byte-identical to relay.cjs) died immediately with
//   ReferenceError: require is not defined in ES module scope
// Both entry points are supported and share one implementation:
//   node relay.cjs     (CommonJS — what README-DEPLOY.md documents)
//   node relay.js      (ESM — this shim)
//
// Usage is unchanged: PANEL_URL=https://panel.<host> node relay.js
import "./relay.cjs"
