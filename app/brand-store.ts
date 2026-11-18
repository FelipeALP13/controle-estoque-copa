// Marca da empresa guardada em app_settings ("brand"). Se o banco falhar, o Portal segue com a marca padrão.
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import { DEFAULT_BRAND, parseBrand, type Brand } from "./brand-theme";

export const BRAND_SETTING = "brand";
type Db = ReturnType<typeof getDb>;

export async function loadBrand(db?: Db): Promise<Brand> {
  try {
    const [row] = await (db ?? getDb()).select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, BRAND_SETTING)).limit(1);
    return parseBrand(row?.value);
  } catch (error) {
    console.error("brand load failed", error);
    return DEFAULT_BRAND;
  }
}

export async function saveBrand(db: Db, brand: Brand) {
  const now = new Date().toISOString();
  const value = JSON.stringify({ ...brand, updatedAt: now });
  await db.insert(appSettings).values({ key: BRAND_SETTING, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  return parseBrand(value);
}
