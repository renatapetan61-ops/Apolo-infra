package ports

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strconv"
)

type Allocator struct { DB *sql.DB; Min, Max int }

// Reserve atomically records the first free port in the configured range.
// A temporary bind check detects ports currently occupied by host processes;
// the SQLite primary key prevents concurrent daemon allocations colliding.
func (a Allocator) Reserve(ctx context.Context, purpose string) (int, error) {
	if a.DB == nil || a.Min < 1024 || a.Max > 65535 || a.Min > a.Max { return 0, fmt.Errorf("invalid port allocator configuration") }
	tx, err := a.DB.BeginTx(ctx, nil); if err != nil { return 0, err }; defer tx.Rollback()
	for port := a.Min; port <= a.Max; port++ {
		var exists int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM port_reservations WHERE port=?`, port).Scan(&exists)
		if err == nil { continue }; if err != sql.ErrNoRows { return 0, err }
		ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil { continue }
		_ = ln.Close()
		if _, err := tx.ExecContext(ctx, `INSERT INTO port_reservations(port,purpose) VALUES(?,?)`, port, purpose); err != nil { continue }
		if err := tx.Commit(); err != nil { return 0, err }
		return port, nil
	}
	return 0, fmt.Errorf("no available TCP ports in range %d-%d", a.Min, a.Max)
}

func (a Allocator) Release(ctx context.Context, port int) error {
	res, err := a.DB.ExecContext(ctx, `DELETE FROM port_reservations WHERE port=?`, port)
	if err != nil { return err }; n, err := res.RowsAffected(); if err != nil { return err }; if n == 0 { return fmt.Errorf("port %d is not reserved", port) }; return nil
}
