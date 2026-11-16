const token = process.env.ALERTS_API_TOKEN;
if (!token) throw new Error("Missing ALERTS_API_TOKEN repository secret");
const endpoint = "https://api.alerts.in.ua/v2/iot/active_air_raid_alerts/16.json?token=" + encodeURIComponent(token);
const response = await fetch(endpoint, { headers: { "cache-control": "no-cache" } });
if (!response.ok) throw new Error("alerts.in.ua API returned HTTP " + response.status);
const raw = (await response.text()).trim().replace(/^"|"$/g, "");
if (!["R","A","Y","P","N"].includes(raw)) throw new Error("Unexpected alerts.in.ua response: " + raw.slice(0,80));
const payload = {
  region: "Харківська область",
  status: raw,
  checkedAt: new Date().toISOString(),
  source: "https://alerts.in.ua/",
  note: "Обласний статус; не є заміною офіційного оповіщення."
};
await import("node:fs/promises").then(fs => fs.writeFile("data/alert-status.json", JSON.stringify(payload, null, 2) + "\n"));
console.log("Updated Kharkiv Oblast alert status:", raw);
