import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// This tells Drizzle to explicitly read your .env.local file
dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});