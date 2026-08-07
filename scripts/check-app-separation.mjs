import { readFileSync } from "node:fs";

const cosChat = readFileSync(new URL("../cos/src/pages/ChatPage.tsx", import.meta.url), "utf8");
const parkingPage = readFileSync(new URL("../cos/src/pages/ParkingPage.tsx", import.meta.url), "utf8");
const parkingAuth = readFileSync(new URL("../cos/src/contexts/ParkingAuthContext.tsx", import.meta.url), "utf8");
const parkingConfig = readFileSync(new URL("../cos/vite.parking.config.ts", import.meta.url), "utf8");
const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");

if (cosChat.includes("ParkingHome") || cosChat.includes("getCurrentParking")) {
  throw new Error("COS must not load the Parking home card.");
}
if (!/base:\s*['"]\/parking\/['"]/.test(parkingConfig) || !/outDir:\s*['"]\.\.\/\.\.\/dist\/parking['"]/.test(parkingConfig)) {
  throw new Error("Parking must build as its own /parking application.");
}
if (!redirects.includes("/parking/* /parking/index.html 200")) {
  throw new Error("Parking needs its own SPA fallback.");
}
if (!parkingPage.includes("Parking checklist") || !parkingPage.includes("getCurrentParking")) {
  throw new Error("Parking must own the static card and parking checklist.");
}
if (!parkingAuth.includes("parking_token") || parkingAuth.includes("cos_token")) {
  throw new Error("Parking must have a separate browser PIN session from COS.");
}

console.log("COS and Parking are separated.");
