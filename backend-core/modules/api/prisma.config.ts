import "dotenv/config";
import { defineConfig } from "prisma/config";

const validationDatabaseUrl =
  "postgresql://prisma_validation:prisma_validation@127.0.0.1:5432/prisma_validation";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? validationDatabaseUrl
  }
});
