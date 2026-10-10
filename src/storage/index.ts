import { ToeicDB } from "./dexie/db";
import { createDexieRepositories } from "./dexie/DexieRepositories";

/** 全 App 共用的 IndexedDB 連線與 Repository。畫面元件只從這裡取用。 */
export const db = new ToeicDB();
export const repos = createDexieRepositories(db);
