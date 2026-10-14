import type { SqlDriver } from './driver';
import { migrations } from './migrations';

export function openDatabase(driver: SqlDriver): void {
  driver.transaction(() => {
    const version = driver.all<{ user_version: number }>('PRAGMA user_version')[0]?.user_version ?? 0;
    migrations.slice(version).forEach((sql, index) => {
      driver.run(sql);
      driver.run(`PRAGMA user_version = ${version + index + 1}`);
    });
  });
}
