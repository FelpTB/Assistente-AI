import { google } from "googleapis";
import { config } from "./config.js";

const auth = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
auth.setCredentials({ refresh_token: config.google.refreshToken });

export const sheets = google.sheets({ version: "v4", auth });
export const calendar = google.calendar({ version: "v3", auth });
export const gmail = google.gmail({ version: "v1", auth });
