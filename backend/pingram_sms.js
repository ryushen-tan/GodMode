const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pingram } = require("pingram");

function getRequiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return String(v).trim();
}

async function sendSmsViaPingram({ message }) {
  const recipient = getRequiredEnv("PINGRAM_RECIPIENT");

  const apiKey = getRequiredEnv("PINGRAM_API_KEY");
  const baseUrl = process.env.PINGRAM_BASE_URL ? String(process.env.PINGRAM_BASE_URL).trim() : "";
  const type = process.env.PINGRAM_SMS_TYPE ? String(process.env.PINGRAM_SMS_TYPE).trim() : "sms_compose_preview";

  const pingram = new Pingram({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  });

  // If this throws, we'll surface a clean error message to the caller.
  try {
    await pingram.send({
    type,
    to: { number: recipient },
    sms: { message },
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(msg);
  }

  return { ok: true };
}

module.exports = { sendSmsViaPingram };
