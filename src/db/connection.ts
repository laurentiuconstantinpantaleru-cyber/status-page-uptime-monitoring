import mysql, { type Connection } from 'mysql2/promise';

export interface ConnectOptions {
  /** Only the migration runner needs this: a migration file holds many statements. */
  multipleStatements?: boolean;
}

/** Opens a MySQL connection whose session runs in UTC (D-020). */
export async function connect(url: string, options: ConnectOptions = {}): Promise<Connection> {
  const conn = await mysql.createConnection({
    uri: url,
    timezone: 'Z',
    multipleStatements: options.multipleStatements ?? false,
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
  } catch (error) {
    await conn.end();
    throw error;
  }
  return conn;
}
