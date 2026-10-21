import { describe, expect, it } from "vitest";
import { datasourceUrl, poolSize } from "@/lib/db";

const URL_10 = "postgresql://u:p%40ss@db.example.com:5432/app?sslmode=require&connection_limit=10&pool_timeout=30";

describe("database pool size", () => {
  it("keeps the URL as-is on a normal server", () => {
    expect(poolSize({})).toBeNull();
    expect(datasourceUrl({ DATABASE_URL: URL_10 })).toBeUndefined();
  });

  it("caps each serverless copy at 2 connections on Vercel", () => {
    const url = new URL(datasourceUrl({ VERCEL: "1", DATABASE_URL: URL_10 })!);
    expect(url.searchParams.get("connection_limit")).toBe("2");
    expect(url.searchParams.get("pool_timeout")).toBe("30");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.password).toBe("p%40ss"); // credentials untouched
  });

  it("honours DATABASE_POOL_SIZE and ignores invalid values", () => {
    expect(poolSize({ DATABASE_POOL_SIZE: "1", VERCEL: "1" })).toBe(1);
    expect(poolSize({ DATABASE_POOL_SIZE: "4" })).toBe(4);
    expect(poolSize({ DATABASE_POOL_SIZE: "zero", VERCEL: "1" })).toBe(2);
    expect(new URL(datasourceUrl({ DATABASE_POOL_SIZE: "3", DATABASE_URL: URL_10 })!).searchParams.get("connection_limit")).toBe("3");
  });
});
