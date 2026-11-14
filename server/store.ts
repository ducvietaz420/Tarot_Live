import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config, Mode, Session } from "../shared/types.ts";

export interface SavedState {
  config: Config;
  sessions: Record<Mode, Session>;
}
export class Store {
  private db: DatabaseSync;
  constructor(path = "data/tarot.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS archives (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL)",
    );
  }
  load(): SavedState | undefined {
    const row = this.db.prepare("SELECT json FROM state WHERE id=1").get() as
      | { json: string }
      | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  save(state: SavedState) {
    this.db
      .prepare(
        "INSERT INTO state(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(JSON.stringify(state));
  }
  archive(mode: Mode, session: Session) {
    this.db
      .prepare("INSERT INTO archives(mode,at,json) VALUES(?,?,?)")
      .run(mode, Date.now(), JSON.stringify(session));
  }
  history(mode: Mode) {
    return this.db
      .prepare(
        "SELECT id,mode,at FROM archives WHERE mode=? ORDER BY id DESC LIMIT 30",
      )
      .all(mode);
  }
  archived(id: number) {
    const row = this.db
      .prepare("SELECT json FROM archives WHERE id=?")
      .get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  close() {
    this.db.close();
  }
}
